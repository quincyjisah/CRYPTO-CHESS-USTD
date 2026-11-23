import type { BoardSquare, ChessBoard, ChessColor, ChessPiece } from "./types";

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

export function getPieceIcon(square: BoardSquare): string {
  if (!square) return "";
  return pieceIcons[square.color][square.piece];
}
