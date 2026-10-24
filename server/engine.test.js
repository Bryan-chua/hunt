import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, INTERVAL } from './engine.js';
import { createApp } from './index.js';

function fixture() {
  let now = 1_000_000; const e = new Engine(() => now), host = e.create();
  const runner = e.join(host.id, { invite: host.runnerInvite, name: 'Runner' });
  const hunter = e.join(host.id, { invite: host.hunterInvite, name: 'Hunter' });
  const hunter2 = e.join(host.id, { invite: host.hunterInvite, name: 'Hunter 2' });
  e.start(host.id, host.token);
  const upload = (latitude = 1) => e.upload(host.id, runner.token, { latitude, longitude: 103, accuracy: 12, capturedAt: now });
  return { e, host, runner, hunter, hunter2, upload, at: value => { now = value; }, state: token => e.state(host.id, token), start: now + 30_000 };
}
test('hunter cannot upload or read raw positions; all hunters get identical frozen batches', () => {
  const f = fixture(); f.upload();
  assert.equal(f.state(f.hunter.token).batch, undefined);
  assert.throws(() => f.e.upload(f.host.id, f.hunter.token, {}), { status: 403 });
  assert.throws(() => f.state('unknown'), { status: 401 });
  f.at(f.start); f.e.tick();
  assert.equal(f.state(f.hunter.token).batch.runners[0].sample.latitude, 1);
  const batch = structuredClone(f.state(f.hunter.token).batch);
  f.at(f.start + 1000); f.upload(2);
  assert.deepEqual(f.state(f.hunter.token).batch, batch);
  assert.deepEqual(f.state(f.hunter2.token).batch, batch);
  assert.equal(f.state(f.runner.token).batch, undefined);
  assert.equal(f.state(f.host.token).batch, undefined);
  assert.equal(JSON.stringify(f.state(f.runner.token)).includes('latitude'), false);
});
test('late arrival cannot backfill a reveal and next batch honestly reports missing fresh GPS', () => {
  const f = fixture(); f.at(f.start + 100); f.upload();
  assert.equal(f.state(f.hunter.token).batch.runners[0].sample, null);
  f.at(f.start + INTERVAL); f.e.tick();
  assert.equal(f.state(f.hunter.token).batch.number, 2);
  assert.equal(f.state(f.hunter.token).batch.runners[0].sample, null);
});
test('scheduled cutoff uses only samples received before it, despite scheduler lag', () => {
  const f = fixture(); f.at(f.start - 1000); f.upload(3);
  f.at(f.start + 1500); f.e.tick();
  assert.equal(f.state(f.hunter.token).batch.revealedAt, f.start);
  assert.equal(f.state(f.hunter.token).batch.runners[0].sample.latitude, 3);
});
test('leave revokes access, removes marker and clears raw data; ending rejects uploads', () => {
  const f = fixture(); f.upload(); f.at(f.start); f.e.tick();
  f.e.leave(f.host.id, f.runner.token);
  assert.throws(() => f.state(f.runner.token), { status: 401 });
  assert.equal(f.state(f.hunter.token).batch.runners.length, 0);
  f.e.end(f.host.id, f.host.token);
  assert.equal(f.state(f.hunter.token).phase, 'ended');
  assert.equal(f.state(f.hunter.token).batch, undefined);
});
test('deadline ends session with no final reveal and deletes locations', () => {
  const f = fixture(); f.upload(); f.at(f.start + 30 * 60_000);
  assert.equal(f.state(f.hunter.token).phase, 'ended');
  assert.throws(f.upload, { status: 409 });
  assert.equal(f.e.sessions.get(f.host.id).players.get(f.runner.token).samples.length, 0);
});
test('bad coordinates, clock skew, invitation and late join rejected', () => {
  const f = fixture();
  assert.throws(() => f.e.upload(f.host.id, f.runner.token, { latitude: 91, longitude: 103, accuracy: 1, capturedAt: f.start }), { status: 400 });
  assert.throws(() => f.e.join(f.host.id, { invite: f.host.runnerInvite, name: 'Late' }), { status: 409 });
  const e = new Engine(), h = e.create();
  assert.throws(() => e.join(h.id, { invite: 'bad', name: 'A' }), { status: 403 });
});
test('50 players share batches across reconnects without receiving raw positions', () => {
  let now = 1000000; const e = new Engine(() => now), h = e.create(), players = [];
  for (let i = 0; i < 50; i++) players.push(e.join(h.id, { invite: i < 10 ? h.hunterInvite : h.runnerInvite, name: `P${i}` }));
  e.start(h.id, h.token);
  for (const p of players.slice(10)) e.upload(h.id, p.token, { latitude: 1, longitude: 103, accuracy: 10, capturedAt: now });
  now += 30000; e.tick();
  const batch = e.state(h.id, players[0].token).batch;
  assert.equal(batch.runners.length, 40);
  for (const p of players.slice(0, 10)) assert.deepEqual(e.state(h.id, p.token).batch, batch);
});
test('HTTP layer enforces credentials, rejects malformed JSON and hides nonexistent raw endpoint', async () => {
  const server = createApp(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const h = await (await fetch(base + '/sessions', { method: 'POST' })).json();
    assert.equal((await fetch(base + `/sessions/${h.id}/state`)).status, 401);
    assert.equal((await fetch(base + `/sessions/${h.id}/raw`, { headers: { Authorization: `Bearer ${h.token}` } })).status, 404);
    assert.equal((await fetch(base + `/sessions/${h.id}/join`, { method: 'POST', body: '{' })).status, 400);
    assert.equal((await fetch(base + `/sessions/${h.id}/state`, { headers: { Authorization: `Bearer ${h.token}` } })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
