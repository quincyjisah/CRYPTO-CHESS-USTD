const request = require('supertest');
const app = require('../src/index');
const { createGame, move, getState } = require('../src/game');

describe('game module', () => {
  test('createGame returns board', () => {
    const g = createGame();
    expect(g).toHaveProperty('board');
    expect(g.board.length).toBe(8);
  });

  test('move throws with invalid coordinates', () => {
    const g = createGame();
    expect(() => move(g, [-1,0], [0,0])).toThrow();
  });
});

describe('api', () => {
  test('health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('create game and fetch', async () => {
    const create = await request(app).post('/games').send();
    expect(create.status).toBe(201);
    const id = create.body.id;
    const get = await request(app).get(`/games/${id}`);
    expect(get.status).toBe(200);
    expect(get.body).toHaveProperty('state');
  });
});
