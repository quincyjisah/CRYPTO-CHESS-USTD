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
