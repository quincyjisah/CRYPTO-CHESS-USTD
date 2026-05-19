import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type Redis from "ioredis";
import { REDIS_KEYS } from "./redisBus";

export interface SessionTokenPayload {
  userId: string;
  gameIds?: string[];
  role?: "player" | "viewer" | "admin";
  exp: number;
  iat?: number;
  nbf?: number;
  jti: string;
  kid: string;
}

export interface VerifiedSession extends SessionTokenPayload {
  token: string;
}

const DEFAULT_SESSION_SECRET = "dev-only-change-me";
const DEFAULT_KID = "k1";

function parseSessionSecrets(raw: string | undefined): Map<string, string> {
  const fallback = new Map<string, string>([
    [DEFAULT_KID, DEFAULT_SESSION_SECRET],
  ]);
  if (!raw) {
    return fallback;
  }

  const parsed = new Map<string, string>();
  for (const item of raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [kid, secret] = item.split(":");
    if (!kid || !secret) {
      continue;
    }
    parsed.set(kid.trim(), secret.trim());
  }

  return parsed.size > 0 ? parsed : fallback;
}

function getSigningMaterial(): {
  activeKid: string;
  activeSecret: string;
  allSecrets: Map<string, string>;
} {
  const allSecrets = parseSessionSecrets(process.env.SESSION_SECRETS);
  const activeKid =
    process.env.SESSION_ACTIVE_KID?.trim() ||
    allSecrets.keys().next().value ||
    DEFAULT_KID;
  const activeSecret =
    allSecrets.get(activeKid) ?? allSecrets.values().next().value;

  if (!activeSecret) {
    throw new Error("No session signing secret is configured.");
  }

  return { activeKid, activeSecret, allSecrets };
}

function toBase64Url(input: Buffer | string): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

function signBodyWithSecret(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function signSessionToken(
  payload: Omit<SessionTokenPayload, "jti" | "kid"> &
    Partial<Pick<SessionTokenPayload, "jti" | "kid">>,
): string {
  const now = Date.now();
  const signing = getSigningMaterial();
  const completePayload: SessionTokenPayload = {
    ...payload,
    iat: payload.iat ?? now,
    nbf: payload.nbf ?? now,
    jti: payload.jti ?? randomUUID(),
    kid: payload.kid ?? signing.activeKid,
  };

  const body = toBase64Url(JSON.stringify(completePayload));
  const signature = signBodyWithSecret(body, signing.activeSecret);
  return `${body}.${toBase64Url(signature)}`;
}

export function verifySessionToken(
  token: string,
  now = Date.now(),
): VerifiedSession {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    throw new Error("Malformed session token.");
  }

  const payload = JSON.parse(
    fromBase64Url(body).toString("utf8"),
  ) as SessionTokenPayload;
  if (!payload.userId) {
    throw new Error("Session token missing userId.");
  }
  if (!payload.kid) {
    throw new Error("Session token missing key id.");
  }
  if (!payload.jti) {
    throw new Error("Session token missing jti.");
  }

  const signing = getSigningMaterial();
  const secret = signing.allSecrets.get(payload.kid);
  if (!secret) {
    throw new Error(`Unknown session signing key id: ${payload.kid}.`);
  }

  const expectedSignature = signBodyWithSecret(body, secret);
  const providedSignature = fromBase64Url(signature);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error("Invalid session token signature.");
  }

  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new Error("Session token expired.");
  }
  if (payload.nbf && payload.nbf > now) {
    throw new Error("Session token not active yet.");
  }

  return { ...payload, token };
}

export async function assertSessionNotRevoked(
  redis: Redis,
  session: VerifiedSession,
): Promise<void> {
  const key = REDIS_KEYS.revokedSession(session.jti);
  const revoked = await redis.get(key);
  if (revoked) {
    throw new Error("Session token has been revoked.");
  }
}

export async function revokeSessionToken(
  redis: Redis,
  session: VerifiedSession,
  reason = "manual-revocation",
): Promise<void> {
  const ttlMs = Math.max(1_000, session.exp - Date.now());
  await redis.set(REDIS_KEYS.revokedSession(session.jti), reason, "PX", ttlMs);
}

export function assertGameAccess(
  session: VerifiedSession,
  gameId: string,
): void {
  if (session.role === "admin") {
    return;
  }

  if (!session.gameIds || !session.gameIds.includes(gameId)) {
    throw new Error(`Session does not grant access to game ${gameId}.`);
  }
}
