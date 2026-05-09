export type ChessColor = "white" | "black";

export type ChessPiece =
  | "king"
  | "queen"
  | "rook"
  | "bishop"
  | "knight"
  | "pawn";

export interface BoardPiece {
  color: ChessColor;
  piece: ChessPiece;
}

export type BoardSquare = BoardPiece | null;
export type ChessBoard = BoardSquare[][];

export interface Player {
  name: string;
  walletAddress: string;
  color: ChessColor;
}

export interface WagerMatch {
  id: string;
  stakeUsdt: number;
  stablecoinSymbol: "USDT" | "USTD";
  escrowAddress: string;
  timeControlMinutes: number;
  players: [Player, Player];
  board: ChessBoard;
}

const backRank: ChessPiece[] = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];

const pieceIcons: Record<ChessColor, Record<ChessPiece, string>> = {
  white: {
    king: "♔",
    queen: "♕",
    rook: "♖",
    bishop: "♗",
    knight: "♘",
    pawn: "♙",
  },
  black: {
    king: "♚",
    queen: "♛",
    rook: "♜",
    bishop: "♝",
    knight: "♞",
    pawn: "♟",
  },
};

export function createInitialBoard(): ChessBoard {
  return [
    backRank.map((piece) => ({ color: "black", piece })),
    Array.from({ length: 8 }, () => ({ color: "black", piece: "pawn" })),
    ...Array.from({ length: 4 }, () => Array<BoardSquare>(8).fill(null)),
    Array.from({ length: 8 }, () => ({ color: "white", piece: "pawn" })),
    backRank.map((piece) => ({ color: "white", piece })),
  ];
}

export function formatUsdt(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(amount)
    .replace("$", "")
    .concat(" USDT");
}

export function validateWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

export function getEscrowTotal(match: Pick<WagerMatch, "stakeUsdt">): number {
  return match.stakeUsdt * 2;
}

export function getPieceIcon(square: BoardSquare): string {
  if (!square) {
    return "";
  }

  return pieceIcons[square.color][square.piece];
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
