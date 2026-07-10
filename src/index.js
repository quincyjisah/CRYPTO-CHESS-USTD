const express = require('express');
const { createGame, move, getState } = require('./game');

const app = express();
app.use(express.json());

const games = new Map();

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/games', (req, res) => {
  const id = `g-${Date.now()}`;
  const game = createGame();
  games.set(id, game);
  res.status(201).json({ id });
});

app.post('/games/:id/move', (req, res) => {
  const { id } = req.params;
  const { from, to } = req.body;
  if (!games.has(id)) return res.status(404).json({ error: 'Game not found' });
  try {
    move(games.get(id), from, to);
    res.json({ state: getState(games.get(id)) });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get('/games/:id', (req, res) => {
  const { id } = req.params;
  if (!games.has(id)) return res.status(404).json({ error: 'Game not found' });
  res.json({ state: getState(games.get(id)) });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server listening on ${port}`));
}

module.exports = app;
