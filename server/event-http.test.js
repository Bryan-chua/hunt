import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.js';
import { GameEngine } from './game.js';
import { SqliteStore } from './store.js';
import { createApp } from './index.js';

test('50-player HTTP event: join, assign, ready, reveal, reconnect, pause, resume, capture, results', async () => {
  let now = 1000000; const store = new SqliteStore(':memory:'), games = new GameEngine(() => now, store);
  const server = createApp(new Engine(), games); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, token, body) { const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const data = await response.json(); assert.equal(response.status < 300, true, `${path}: ${response.status} ${JSON.stringify(data)}`); return data; }
  try {
    const h = await call('/games', null, { name: 'Field rehearsal', durationMinutes: 5, headStartMinutes: 1, boundary: { latitude: 1, longitude: 103, radius: 500 } });
    const hp = `/games/${h.id}/`, host = () => call(hp + 'state', h.token);
    const code = (await host()).code, players = [];
    for (let i = 0; i < 50; i++) players.push(await call('/games/join', null, { code, name: `Player ${i}` }));
    const roster = (await host()).players.filter(p => !p.owner);
    for (let i = 0; i < 10; i++) await call(hp + 'assign', h.token, { playerId: roster[i].id, role: 'hunter' });
    for (const p of players) await call(hp + 'ready', p.token, { ready: true, consent: true, permissions: true, capturedAt: now });
    const started = await call(hp + 'start', h.token, {}); now = started.startAt - 1000;
    for (let i = 0; i < 50; i++) await call(hp + 'locations', players[i].token, { latitude: 1 + i / 100000, longitude: 103, accuracy: 10, capturedAt: now, epoch: started.trackingEpoch });
    now = started.startAt; games.tick();
    const hunters = await Promise.all(players.slice(0, 10).map(p => call(hp + 'state', p.token)));
    assert.equal(hunters[0].batch.runners.length, 40); for (const s of hunters) { assert.deepEqual(s.batch, hunters[0].batch); assert.equal(s.live, undefined); assert.equal(s.audit, undefined); }
    const runnerView = await call(hp + 'state', players[10].token); assert.equal(runnerView.batch, undefined); assert.equal(runnerView.live, undefined);
    const original = structuredClone(hunters[0].batch); now += 1000;
    await call(hp + 'locations', players[10].token, { latitude: 2, longitude: 103, accuracy: 10, capturedAt: now, epoch: started.trackingEpoch });
    assert.deepEqual((await call(hp + 'state', players[0].token)).batch, original);
    await call(hp + 'pause', h.token, { reason: 'Crossing' }); now += 120000;
    const resumed = await call(hp + 'resume', h.token, {}); assert.equal(resumed.endAt, started.endAt + 120000);
    for (const p of players.slice(10)) await call(hp + 'capture', p.token, { key: `capture-${p.id}-${p.token.slice(0, 4)}` });
    const ended = await host(); assert.equal(ended.result.winner, 'hunters'); assert.equal(ended.phase, 'finished');
    assert.equal(ended.result.players.length, 50); assert.equal(ended.live, undefined);
    assert.ok(Object.values(store.load()[0].members).every(p => p.samples.length === 0));
    assert.equal((await fetch(base + hp + 'locations', { headers: { Authorization: `Bearer ${players[0].token}` } })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
