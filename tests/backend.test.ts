import {
  assertGameAccess,
  assertSessionNotRevoked,
  revokeSessionToken,
  signSessionToken,
  verifySessionToken,
} from "../lib/auth";
import { describe, expect, it } from "vitest";
import {
  createLedgerEntry,
  replayGame,
  verifyLedgerEntries,
} from "../lib/ledger";
import { calculateEconomy, PLATFORM_FEE_BASIS_POINTS } from "../lib/economy";
import {
  mintSimulatedPiece,
  pickRarity,
  transferSimulatedPiece,
} from "../lib/nftPieces";

class FakeRedisRevocation {
  private data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<string> {
    this.data.set(key, value);
    return "OK";
  }
}

describe("hardened ledger", () => {
  it("verifies and replays a hash-linked move chain", () => {
    const first = createLedgerEntry({
      gameId: "game-1",
      userId: "white",
      san: "e4",
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      moveNumber: 1,
    });
    const second = createLedgerEntry(
      {
        gameId: "game-1",
        userId: "black",
        san: "e5",
        fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        moveNumber: 2,
      },
      first,
    );

    expect(verifyLedgerEntries([first, second])).toEqual({
      valid: true,
      entriesChecked: 2,
    });
    expect(replayGame([first, second])).toBe(
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    );
  });

  it("detects tampering", () => {
    const entry = createLedgerEntry({
      gameId: "game-1",
      userId: "white",
      san: "e4",
      fen: "fen",
      moveNumber: 1,
    });

    expect(verifyLedgerEntries([{ ...entry, san: "d4" }]).valid).toBe(false);
  });
});

describe("wager economy", () => {
  it("charges a transparent 2 percent winner fee", () => {
    const result = calculateEconomy(10);

    expect(result.feeBasisPoints).toBe(PLATFORM_FEE_BASIS_POINTS);
    expect(result.totalPot).toBe(20);
    expect(result.platformFee).toBe(0.4);
    expect(result.winnerPayout).toBe(19.6);
  });
});

describe("NFT piece simulation", () => {
  it("mints transferable ERC-721-ready metadata without touching a chain", () => {
    const piece = mintSimulatedPiece("user-1", "queen", 0.995);
    const transferred = transferSimulatedPiece(piece, "user-2");

    expect(piece.rarity).toBe("legendary");
    expect(transferred.ownerUserId).toBe("user-2");
    expect(pickRarity(0)).toBe("common");
  });
});

describe("session auth", () => {
  it("signs and verifies session tokens", () => {
    const token = signSessionToken({
      userId: "alice",
      gameIds: ["g1"],
      role: "player",
      exp: Date.now() + 60_000,
    });

    const session = verifySessionToken(token);
    expect(session.userId).toBe("alice");
    expect(() => assertGameAccess(session, "g1")).not.toThrow();
    expect(() => assertGameAccess(session, "g2")).toThrow();
  });

  it("supports key rotation via kid/secret mapping", () => {
    process.env.SESSION_SECRETS = "k1:alpha-secret,k2:beta-secret";
    process.env.SESSION_ACTIVE_KID = "k2";

    const token = signSessionToken({
      userId: "alice",
      exp: Date.now() + 60_000,
    });

    const session = verifySessionToken(token);
    expect(session.kid).toBe("k2");
  });

  it("supports revocation checks", async () => {
    process.env.SESSION_SECRETS = "k1:alpha-secret";
    process.env.SESSION_ACTIVE_KID = "k1";

    const token = signSessionToken({
      userId: "alice",
      exp: Date.now() + 60_000,
    });
    const session = verifySessionToken(token);
    const redis = new FakeRedisRevocation();

    await assertSessionNotRevoked(redis as never, session);
    await revokeSessionToken(redis as never, session, "test");
    await expect(
      assertSessionNotRevoked(redis as never, session),
    ).rejects.toThrow("Session token has been revoked.");
  });

  it("rejects expired tokens", () => {
    const token = signSessionToken({
      userId: "alice",
      exp: Date.now() - 1,
    });

    expect(() => verifySessionToken(token)).toThrow("Session token expired.");
  });
});
