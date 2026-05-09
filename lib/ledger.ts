import { createHash, createVerify } from "node:crypto";
import { Chess } from "chess.js";
import type Redis from "ioredis";
import { REDIS_KEYS } from "./redisBus";

export interface MoveSignature {
  algorithm: "RSA-SHA256" | "SHA256";
  publicKeyPem: string;
  signatureBase64: string;
}

export interface LedgerMovePayload {
  gameId: string;
  userId: string;
  san: string;
  fen: string;
  lan?: string;
  moveNumber: number;
  signature?: MoveSignature;
}

export interface LedgerEntry {
  index: number;
  timestamp: number;
  gameId: string;
  userId: string;
  san: string;
  fen: string;
  lan?: string;
  moveNumber: number;
  prevHash: string;
  hash: string;
  signature?: MoveSignature;
}

export interface LedgerVerificationResult {
  valid: boolean;
  entriesChecked: number;
  reason?: string;
}

const GENESIS_HASH = "0".repeat(64);

export function stableLedgerPayload(entry: Omit<LedgerEntry, "hash">): string {
  return JSON.stringify({
    index: entry.index,
    timestamp: entry.timestamp,
    gameId: entry.gameId,
    userId: entry.userId,
    san: entry.san,
    fen: entry.fen,
    lan: entry.lan,
    moveNumber: entry.moveNumber,
    prevHash: entry.prevHash,
    signature: entry.signature,
  });
}

export function hashLedgerEntry(entry: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256").update(stableLedgerPayload(entry)).digest("hex");
}

export function createLedgerEntry(
  payload: LedgerMovePayload,
  previousEntry?: LedgerEntry,
  timestamp = Date.now(),
): LedgerEntry {
  const entryWithoutHash: Omit<LedgerEntry, "hash"> = {
    index: previousEntry ? previousEntry.index + 1 : 0,
    timestamp,
    gameId: payload.gameId,
    userId: payload.userId,
    san: payload.san,
    fen: payload.fen,
    lan: payload.lan,
    moveNumber: payload.moveNumber,
    prevHash: previousEntry?.hash ?? GENESIS_HASH,
    signature: payload.signature,
  };

  return {
    ...entryWithoutHash,
    hash: hashLedgerEntry(entryWithoutHash),
  };
}

export async function appendLedgerEntry(
  redis: Redis,
  payload: LedgerMovePayload,
): Promise<LedgerEntry> {
  const key = REDIS_KEYS.ledger(payload.gameId);
  const previousRaw = await redis.lindex(key, -1);
  const previousEntry = previousRaw
    ? (JSON.parse(previousRaw) as LedgerEntry)
    : undefined;
  const entry = createLedgerEntry(payload, previousEntry);

  await redis.rpush(key, JSON.stringify(entry));
  return entry;
}

export async function getLedger(
  redis: Redis,
  gameId: string,
): Promise<LedgerEntry[]> {
  const rows = await redis.lrange(REDIS_KEYS.ledger(gameId), 0, -1);
  return rows.map((row) => JSON.parse(row) as LedgerEntry);
}

export function verifyLedgerEntries(
  entries: LedgerEntry[],
): LedgerVerificationResult {
  let previousHash = GENESIS_HASH;

  for (const [expectedIndex, entry] of entries.entries()) {
    if (entry.index !== expectedIndex) {
      return {
        valid: false,
        entriesChecked: expectedIndex,
        reason: `Unexpected index ${entry.index}`,
      };
    }

    if (entry.prevHash !== previousHash) {
      return {
        valid: false,
        entriesChecked: expectedIndex,
        reason: `Broken prevHash at index ${entry.index}`,
      };
    }

    const { hash, ...entryWithoutHash } = entry;
    const expectedHash = hashLedgerEntry(entryWithoutHash);
    if (hash !== expectedHash) {
      return {
        valid: false,
        entriesChecked: expectedIndex,
        reason: `Hash mismatch at index ${entry.index}`,
      };
    }

    if (entry.signature && !verifyMoveSignature(entry)) {
      return {
        valid: false,
        entriesChecked: expectedIndex,
        reason: `Invalid signature at index ${entry.index}`,
      };
    }

    previousHash = entry.hash;
  }

  return { valid: true, entriesChecked: entries.length };
}

export async function verifyLedger(
  redis: Redis,
  gameId: string,
): Promise<LedgerVerificationResult> {
  return verifyLedgerEntries(await getLedger(redis, gameId));
}

export function replayGame(entries: LedgerEntry[]): string {
  const verification = verifyLedgerEntries(entries);
  if (!verification.valid) {
    throw new Error(`Cannot replay corrupted ledger: ${verification.reason}`);
  }

  const chess = new Chess();
  for (const entry of entries) {
    const move = chess.move(entry.san);
    if (!move) {
      throw new Error(
        `Ledger contains illegal move at index ${entry.index}: ${entry.san}`,
      );
    }
  }

  return chess.fen();
}

export function verifyMoveSignature(entry: LedgerEntry): boolean {
  if (!entry.signature) {
    return true;
  }

  const verifier = createVerify(entry.signature.algorithm);
  verifier.update(
    `${entry.gameId}:${entry.userId}:${entry.san}:${entry.moveNumber}`,
  );
  verifier.end();
  return verifier.verify(
    entry.signature.publicKeyPem,
    entry.signature.signatureBase64,
    "base64",
  );
}
