import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionTokenPayload {
  userId: string;
  gameIds?: string[];
  role?: "player" | "viewer" | "admin";
  exp: number;
}

export interface VerifiedSession extends SessionTokenPayload {
  token: string;
}

const DEFAULT_SESSION_SECRET = "dev-only-change-me";

function getSessionSecret(): string {
  return process.env.SESSION_SECRET ?? DEFAULT_SESSION_SECRET;
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

export function signSessionToken(payload: SessionTokenPayload): string {
  const body = toBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", getSessionSecret())
    .update(body)
    .digest();
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

  const expectedSignature = createHmac("sha256", getSessionSecret())
    .update(body)
    .digest();
  const providedSignature = fromBase64Url(signature);

  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error("Invalid session token signature.");
  }

  const payload = JSON.parse(
    fromBase64Url(body).toString("utf8"),
  ) as SessionTokenPayload;
  if (!payload.userId) {
    throw new Error("Session token missing userId.");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new Error("Session token expired.");
  }

  return { ...payload, token };
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
