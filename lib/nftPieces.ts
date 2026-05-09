import { randomUUID } from "node:crypto";

export type PieceKind =
  | "king"
  | "queen"
  | "rook"
  | "bishop"
  | "knight"
  | "pawn";
export type PieceRarity = "common" | "rare" | "epic" | "legendary";

export interface NftPieceMetadata {
  tokenId: string;
  ownerUserId: string;
  piece: PieceKind;
  rarity: PieceRarity;
  name: string;
  imageUri: string;
  attributes: Record<string, string | number | boolean>;
  transferable: boolean;
  createdAt: number;
}

const rarityWeights: Record<PieceRarity, number> = {
  common: 70,
  rare: 22,
  epic: 7,
  legendary: 1,
};

export function mintSimulatedPiece(
  ownerUserId: string,
  piece: PieceKind,
  seed = Math.random(),
): NftPieceMetadata {
  const rarity = pickRarity(seed);
  return {
    tokenId: randomUUID(),
    ownerUserId,
    piece,
    rarity,
    name: `${rarity[0].toUpperCase()}${rarity.slice(1)} ${piece}`,
    imageUri: `ipfs://metadata-placeholder/${piece}-${rarity}.json`,
    attributes: {
      piece,
      rarity,
      chainReady: false,
      standard: "ERC-721-ready-simulation",
    },
    transferable: true,
    createdAt: Date.now(),
  };
}

export function transferSimulatedPiece(
  piece: NftPieceMetadata,
  newOwnerUserId: string,
): NftPieceMetadata {
  if (!piece.transferable) {
    throw new Error(`NFT piece ${piece.tokenId} is not transferable.`);
  }

  return { ...piece, ownerUserId: newOwnerUserId };
}

export function pickRarity(seed: number): PieceRarity {
  if (!Number.isFinite(seed) || seed < 0 || seed > 1) {
    throw new Error("Rarity seed must be a number from 0 to 1.");
  }

  const roll = seed * 100;
  let cumulative = 0;
  for (const [rarity, weight] of Object.entries(rarityWeights) as [
    PieceRarity,
    number,
  ][]) {
    cumulative += weight;
    if (roll <= cumulative) {
      return rarity;
    }
  }

  return "legendary";
}
