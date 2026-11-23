import { describe, expect, it } from "vitest";
import { getAdSenseConfig, renderAdSenseSlot } from "../src/adsense";
import {
  createDemoMatch,
  createInitialBoard,
  formatUsdt,
  getEscrowTotal,
  getPieceIcon,
  validateWalletAddress,
} from "../src/chess";
import {
  calculateMatchEconomy,
  PLATFORM_FEE_BASIS_POINTS,
} from "../src/economy";
import { defaultNftRules, streamingDestinations } from "../src/platform";

describe("chess board helpers", () => {
  it("creates a standard 8x8 starting board", () => {
    const board = createInitialBoard();

    expect(board).toHaveLength(8);
    expect(board.every((rank) => rank.length === 8)).toBe(true);
    expect(board[0][4]).toEqual({ color: "black", piece: "king" });
    expect(board[7][4]).toEqual({ color: "white", piece: "king" });
  });

  it("renders piece icons and empty squares", () => {
    expect(getPieceIcon({ color: "white", piece: "queen" })).toBe("♕");
    expect(getPieceIcon(null)).toBe("");
  });
});

describe("wager helpers", () => {
  it("formats USDT amounts consistently", () => {
    expect(formatUsdt(100)).toBe("100.00 USDT");
    expect(formatUsdt(1234.5)).toBe("1,234.50 USDT");
  });

  it("calculates escrow totals from both player stakes", () => {
    expect(getEscrowTotal({ stakeUsdt: 75 })).toBe(150);
  });

  it("validates EVM-style wallet addresses", () => {
    expect(
      validateWalletAddress("0x742d35Cc6634C0532925a3b844Bc454e4438f44e"),
    ).toBe(true);
    expect(validateWalletAddress("not-a-wallet")).toBe(false);
  });

  it("creates a demo match with valid escrow metadata", () => {
    const match = createDemoMatch();

    expect(match.players).toHaveLength(2);
    expect(validateWalletAddress(match.escrowAddress)).toBe(true);
    expect(getEscrowTotal(match)).toBe(20);
  });

  it("takes a 2 percent platform fee from the winner payout", () => {
    const economy = calculateMatchEconomy({ playerStakeUsdt: 10 });

    expect(economy.platformFeeBasisPoints).toBe(PLATFORM_FEE_BASIS_POINTS);
    expect(economy.totalEscrowUsdt).toBe(20);
    expect(economy.platformFeeUsdt).toBe(0.4);
    expect(economy.winnerPayoutUsdt).toBe(19.6);
  });

  it("rejects invalid wager amounts", () => {
    expect(() => calculateMatchEconomy({ playerStakeUsdt: 0 })).toThrow(
      "Player stake must be a positive finite number.",
    );
  });
});

describe("platform readiness configuration", () => {
  it("keeps livestream integrations disabled until approved backends exist", () => {
    expect(streamingDestinations).toHaveLength(6);
    expect(
      streamingDestinations.every((destination) => !destination.enabled),
    ).toBe(true);
  });

  it("documents future NFT winner-badge rules without enabling minting", () => {
    expect(defaultNftRules.enabled).toBe(false);
    expect(defaultNftRules.mintOnWin).toBe(true);
  });
});

describe("AdSense configuration", () => {
  it("enables only valid public AdSense publisher clients", () => {
    const enabled = getAdSenseConfig({
      VITE_ADSENSE_CLIENT: "ca-pub-8165457408564080",
      VITE_ADSENSE_SLOT: "1234567890",
    } as ImportMetaEnv);
    const disabled = getAdSenseConfig({
      VITE_ADSENSE_CLIENT: "not-a-public-adsense-client",
    } as ImportMetaEnv);

    expect(enabled.enabled).toBe(true);
    expect(renderAdSenseSlot(enabled)).toContain("ca-pub-8165457408564080");
    expect(disabled.enabled).toBe(false);
  });
});
