function createGame() {
  // Minimal board representation: 8x8 with nulls
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  return { board };
}

function move(game, from, to) {
  // Very small validation for scaffold purposes
  if (!from || !to) throw new Error('from and to required');
  // from/to expected as [r,c]
  const [fr, fc] = from;
  const [tr, tc] = to;
  if (
    fr < 0 || fr > 7 || fc < 0 || fc > 7 ||
    tr < 0 || tr > 7 || tc < 0 || tc > 7
  ) {
    throw new Error('invalid coordinates');
  }
  const piece = game.board[fr][fc];
  game.board[fr][fc] = null;
  game.board[tr][tc] = piece || 'P'; // place a pawn placeholder
}

function getState(game) {
  return { board: game.board };
}

module.exports = { createGame, move, getState };
