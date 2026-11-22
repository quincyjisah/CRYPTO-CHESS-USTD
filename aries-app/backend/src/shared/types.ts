/**
 * shared/types.ts — Aries Protocol canonical type definitions
 *
 * Every service imports from here. No type drift between services.
 */

// ─── Chess / Game ─────────────────────────────────────────────────────────────

export type Color     = 'white' | 'black';
export type GamePhase = 'waiting' | 'active' | 'finished' | 'disputed' | 'aborted';
export type Currency  = 'USDT' | 'USDC' | 'DAI' | 'FREE';
export type TimeControl = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface ChessMove {
  from:        string;
  to:          string;
  promotion?:  string;
  san:         string;          // Standard Algebraic Notation
  fen:         string;          // Position after move
  timestamp:   number;          // Unix ms
  thinkMs:     number;          // Time player spent thinking
  hash:        string;          // SHA-256(prevHash + san + fen) — ledger chain
}

export interface GameSession {
  gameId:       string;
  whiteUid:     string;
  blackUid:     string;
  whiteHandle:  string;
  blackHandle:  string;
  wager:        number;
  currency:     Currency;
  timeControl:  TimeControl;
  initialFen:   string;
  moves:        ChessMove[];
  fen:          string;         // Current position
  pgn:          string;
  turn:         Color;
  status:       GamePhase;
  result:       Color | 'draw' | null;
  endReason:    string | null;  // 'checkmate' | 'timeout' | 'resign' | 'draw' | 'fraud'
  settled:      boolean;
  createdAt:    number;
  lastMoveAt:   number;
  wsNodeId:     string;         // Which WS node is hosting
  isPublic?:    boolean;        // Spectator access is opt-in
}

// ─── WebSocket Messages ────────────────────────────────────────────────────────

export type WsMessageType =
  | 'auth'
  | 'auth_ok'
  | 'auth_fail'
  | 'queue_join'
  | 'queue_cancel'
  | 'queue_matched'
  | 'game_start'
  | 'move_submit'
  | 'move_accepted'
  | 'move_rejected'
  | 'move_broadcast'
  | 'game_over'
  | 'resign'
  | 'draw_offer'
  | 'draw_accept'
  | 'draw_decline'
  | 'spectate_join'
  | 'spectate_state'
  | 'chat_send'
  | 'chat_broadcast'
  | 'tip_send'
  | 'tip_broadcast'
  | 'ping'
  | 'pong'
  | 'error'
  | 'reconnect_state';

export interface WsMessage {
  type:    WsMessageType;
  gameId?: string;
  data?:   Record<string, unknown>;
  ts:      number;   // client timestamp
}

export interface WsMoveSubmit {
  gameId:     string;
  from:       string;
  to:         string;
  promotion?: string;
  thinkMs:    number;
}

// ─── Anti-Cheat ───────────────────────────────────────────────────────────────

export type TrustLevel  = 'clean' | 'suspicious' | 'flagged' | 'banned';
export type CheatSignal = 'engine_correlation' | 'timing_anomaly' | 'accuracy_spike'
                        | 'tabswitch' | 'move_entropy' | 'collusion' | 'smurf';

export interface AntiCheatEvent {
  gameId:    string;
  uid:       string;
  signal:    CheatSignal;
  severity:  1 | 2 | 3;       // 1=info, 2=warning, 3=critical
  data:      Record<string, unknown>;
  timestamp: number;
}

export interface MoveMetrics {
  uid:          string;
  gameId:       string;
  moveNumber:   number;
  thinkMs:      number;
  cpLoss:       number;         // Centipawn loss (from Stockfish eval)
  accuracy:     number;         // 0–100
  topEngineMove: string;        // Was this the engine's first choice?
  tabSwitches:  number;
  mouseEntropy: number;
}

export interface TrustProfile {
  uid:          string;
  trustScore:   number;         // 0–100 (100 = clean)
  trustLevel:   TrustLevel;
  flags:        CheatSignal[];
  gamesReviewed: number;
  lastUpdated:  number;
}

// ─── Tournament ───────────────────────────────────────────────────────────────

export type TournamentFormat  = 'swiss' | 'round_robin' | 'elimination' | 'arena';
export type TournamentStatus  = 'upcoming' | 'registration' | 'active' | 'completed';

export interface Tournament {
  id:           string;
  name:         string;
  format:       TournamentFormat;
  status:       TournamentStatus;
  entryFee:     number;
  currency:     Currency;
  prizePool:    number;
  maxPlayers:   number;
  players:      string[];       // UIDs
  rounds:       TournamentRound[];
  startsAt:     number;
  endsAt:       number | null;
  timeControl:  TimeControl;
  createdBy:    string;
}

export interface TournamentRound {
  roundNumber: number;
  pairings:    TournamentPairing[];
  startedAt:   number | null;
  completedAt: number | null;
}

export interface TournamentPairing {
  gameId:    string;
  whiteUid:  string;
  blackUid:  string;
  result:    Color | 'draw' | 'bye' | null;
}

// ─── Economy ──────────────────────────────────────────────────────────────────

export interface EscrowRecord {
  escrowId:   string;
  gameId:     string;
  whiteUid:   string;
  blackUid:   string;
  amount:     number;           // Per player
  currency:   Currency;
  status:     'locked' | 'released' | 'refunded' | 'disputed';
  lockedAt:   number;
  releasedAt: number | null;
}

export interface SettlementRecord {
  gameId:      string;
  winnerUid:   string;
  loserUid:    string;
  pot:         number;
  fee:         number;          // 2% of pot
  payout:      number;          // pot - fee
  currency:    Currency;
  onChainTxHash: string | null;
  settledAt:   number;
}

// ─── NFT ──────────────────────────────────────────────────────────────────────

export type NftRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'genesis';

export interface NftPieceSet {
  tokenId:     number;
  name:        string;
  description: string;
  image:       string;          // ipfs:// URI
  animation:   string | null;   // ipfs:// URI for animated variant
  rarity:      NftRarity;
  pieceType:   'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn' | 'full_set';
  creator:     string;          // Ethereum address
  royaltyBps:  number;          // Basis points (500 = 5%)
  attributes:  { trait_type: string; value: string | number }[];
  isCosmetic:  true;            // NFTs NEVER provide gameplay advantages
  ownedBy:     string | null;
}

// ─── Replay ───────────────────────────────────────────────────────────────────

export interface ReplayRecord {
  gameId:        string;
  pgn:           string;
  moves:         ChessMove[];
  whiteHandle:   string;
  blackHandle:   string;
  wager:         number;
  currency:      Currency;
  result:        string;
  endReason:     string;
  accuracy:      { white: number; black: number };
  topMovePct:    { white: number; black: number };
  blunders:      { white: number; black: number };
  playedAt:      number;
  durationMs:    number;
  isPublic:      boolean;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface MatchmakingEvent {
  uid:        string;
  event:      'join' | 'cancel' | 'matched' | 'timeout';
  wager:      number;
  waitMs:     number;
  timestamp:  number;
}

export interface PlayerAnalytics {
  uid:           string;
  totalGames:    number;
  winRate:       number;
  avgAccuracy:   number;
  avgWager:      number;
  totalWagered:  number;
  totalEarned:   number;
  peakRating:    number;
  currentRating: number;
  lastActive:    number;
}
