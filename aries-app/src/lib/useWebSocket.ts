/**
 * useWebSocket.ts — Aries Protocol Frontend WebSocket Client
 *
 * Connects to the production WebSocket cluster at wss://ws.ariesprotocol.app/ws
 * Handles:
 *  - Authentication via Firebase ID token
 *  - Automatic reconnection with exponential backoff
 *  - Message routing to registered handlers
 *  - Heartbeat (ping/pong every 25 seconds)
 *  - Connection state tracking
 *  - Tab-switch telemetry for anti-cheat
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { auth } from './firebase';

const WS_URL = (import.meta as any).env?.VITE_WS_URL || 'wss://ws.ariesprotocol.app/ws';

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error';

export type WsMessageType =
  | 'auth_ok' | 'auth_fail'
  | 'queue_matched' | 'game_start'
  | 'move_accepted' | 'move_rejected' | 'move_broadcast'
  | 'game_over' | 'reconnect_state'
  | 'spectate_state'
  | 'draw_offer' | 'draw_accept' | 'draw_decline'
  | 'chat_broadcast' | 'tip_broadcast'
  | 'pong' | 'error';

export interface WsMessage {
  type:    WsMessageType;
  gameId?: string;
  data?:   Record<string, unknown>;
  ts:      number;
}

type MessageHandler = (msg: WsMessage) => void;

interface UseWebSocketReturn {
  status:    WsStatus;
  send:      (msg: Record<string, unknown>) => void;
  on:        (type: WsMessageType, handler: MessageHandler) => () => void;
  off:       (type: WsMessageType, handler: MessageHandler) => void;
  reconnect: () => void;
  latencyMs: number;
}

const MAX_RECONNECT_DELAY = 30_000;
const PING_INTERVAL_MS    = 25_000;

export function useWebSocket(): UseWebSocketReturn {
  const [status,    setStatus]    = useState<WsStatus>('disconnected');
  const [latencyMs, setLatencyMs] = useState(0);

  const wsRef         = useRef<WebSocket | null>(null);
  const handlersRef   = useRef<Map<WsMessageType, Set<MessageHandler>>>(new Map());
  const reconnectRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingTimeRef   = useRef<number>(0);
  const retryCountRef = useRef(0);
  const unmountedRef  = useRef(false);

  // ─── Connect ───────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (unmountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');

    // Get fresh Firebase ID token for authentication
    let token: string | null = null;
    try {
      token = await auth.currentUser?.getIdToken(false) || null;
    } catch {
      token = null;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      setStatus('connected');
      retryCountRef.current = 0;

      // Authenticate immediately on connect
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', data: { token }, ts: Date.now() }));
      }

      // Start heartbeat
      if (pingRef.current) clearInterval(pingRef.current);
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          pingTimeRef.current = Date.now();
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);

        // Handle pong — compute latency
        if (msg.type === 'pong') {
          setLatencyMs(Date.now() - pingTimeRef.current);
          return;
        }

        // Handle auth confirmation
        if (msg.type === 'auth_ok') {
          setStatus('authenticated');
        }

        if (msg.type === 'auth_fail') {
          setStatus('error');
          ws.close();
          return;
        }

        // Route to registered handlers
        const handlers = handlersRef.current.get(msg.type);
        if (handlers) {
          handlers.forEach(h => {
            try { h(msg); } catch (err) { console.error('[WS] Handler error:', err); }
          });
        }
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    };

    ws.onclose = (event: CloseEvent) => {
      if (pingRef.current) clearInterval(pingRef.current);
      if (unmountedRef.current) return;

      // 1008 = policy violation (auth failed) — don't reconnect
      if (event.code === 1008) {
        setStatus('error');
        return;
      }

      setStatus('disconnected');

      // Exponential backoff reconnect
      const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), MAX_RECONNECT_DELAY);
      retryCountRef.current++;

      reconnectRef.current = setTimeout(() => {
        if (!unmountedRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      setStatus('error');
    };
  }, []);

  // ─── Tab visibility — anti-cheat telemetry ─────────────────────────────────
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && wsRef.current?.readyState === WebSocket.OPEN) {
        // Send tab-switch signal to server for anti-cheat analysis
        wsRef.current.send(JSON.stringify({
          type: 'tab_switch',
          data: { hidden: true },
          ts:   Date.now(),
        }));
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // ─── Connect on mount, reconnect when auth changes ─────────────────────────
  useEffect(() => {
    connect();
    return () => {
      unmountedRef.current = true;
      if (pingRef.current)      clearInterval(pingRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close(1000, 'Component unmounted');
    };
  }, [connect]);

  // ─── Reconnect when Firebase auth state changes ─────────────────────────────
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'Re-authenticating');
      }
    });
    return () => unsub();
  }, []);

  // ─── Send message ──────────────────────────────────────────────────────────
  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send — not connected');
      return;
    }
    ws.send(JSON.stringify({ ...msg, ts: Date.now() }));
  }, []);

  // ─── Register handler ──────────────────────────────────────────────────────
  const on = useCallback((type: WsMessageType, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    // Return unsubscribe function
    return () => handlersRef.current.get(type)?.delete(handler);
  }, []);

  const off = useCallback((type: WsMessageType, handler: MessageHandler) => {
    handlersRef.current.get(type)?.delete(handler);
  }, []);

  const reconnect = useCallback(() => {
    wsRef.current?.close();
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  return { status, send, on, off, reconnect, latencyMs };
}
