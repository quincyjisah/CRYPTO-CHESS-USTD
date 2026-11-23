import { createInitialBoard } from "./board";
import type { WagerMatch } from "./types";

export function validateWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

export function createDemoMatch(): WagerMatch {
  return {
    id: "demo-match-001",
    stakeUsdt: 10,
    stablecoinSymbol: "USDT",
    escrowAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    timeControlMinutes: 10,
    players: [
      {
        name: "White Hat",
        walletAddress: "0x1111111111111111111111111111111111111111",
        color: "white",
      },
      {
        name: "Black Bishop",
        walletAddress: "0x2222222222222222222222222222222222222222",
        color: "black",
      },
    ],
    board: createInitialBoard(),
  };
}
