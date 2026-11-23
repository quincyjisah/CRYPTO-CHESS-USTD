import { describe, expect, it } from "vitest";
import { moderateChatMessage } from "../../src/features/chat/moderation";
import { createSeededRoundOne } from "../../src/features/tournaments/bracket";
import {
  compressReplayPayload,
  createReplaySnapshot,
  getReplayFrame,
} from "../../src/features/replay/timeline";
import { consumeRateLimit } from "../../src/shared/rateLimit";

describe("chat moderation anti-phishing", () => {
  it("blocks wallet-drain prompts", () => {
    const result = moderateChatMessage(
      "Send your seed phrase to verify payout",
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("credential-phishing-pattern");
  });
});

describe("tournament pairing", () => {
  it("pairs highest vs lowest for seeded round one", () => {
    const pairings = createSeededRoundOne([
      { id: "p1", rating: 2000 },
      { id: "p2", rating: 1800 },
      { id: "p3", rating: 1600 },
      { id: "p4", rating: 1400 },
    ]);

    expect(pairings[0]).toEqual({ round: 1, whiteId: "p1", blackId: "p4" });
    expect(pairings[1]).toEqual({ round: 1, whiteId: "p2", blackId: "p3" });
  });
});

describe("replay timeline", () => {
  it("retrieves frame by cursor and compresses payload", () => {
    const moves = [
      { ply: 1, san: "e4", fen: "fen-1", ts: 100 },
      { ply: 2, san: "e5", fen: "fen-2", ts: 200 },
    ];
    const snap = createReplaySnapshot("g1", moves);
    expect(getReplayFrame(snap, 1)?.san).toBe("e5");
    expect(compressReplayPayload(moves).length).toBeGreaterThan(0);
  });
});

describe("rate limiting", () => {
  it("enforces fixed-window bounds", () => {
    let state = consumeRateLimit(null, 0, 2, 1000);
    expect(state.allowed).toBe(true);
    state = consumeRateLimit(state.bucket, 1, 2, 1000);
    expect(state.allowed).toBe(true);
    state = consumeRateLimit(state.bucket, 2, 2, 1000);
    expect(state.allowed).toBe(false);
  });
});
