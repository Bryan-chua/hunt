import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './game.js';
export function fixture(extra = {}) {
  let now = 1_000_000; const e = new GameEngine(() => now);
  const host = e.create({ name: 'Park event', durationMinutes: 45, headStartMinutes: 3, boundary: { latitude: 1.3, longitude: 103.8, radius: 500 }, ...extra });
  const state = () => e.state(host.id, host.token);
  const join = name => e.join({ code: state().code, name });
  const runner = join('Runner'), hunter = join('Hunter');
  const player = p => e.state(p.id, p.token).me;
  e.assign(host.id, host.token, { playerId: player(hunter).id, role: 'hunter' });
  const ready = p => e.ready(p.id, p.token, { ready: true, consent: true, permissions: true, capturedAt: now });
  return { e, host, runner, hunter, state, join, player, ready, now: () => now, at: value => { now = value; } };
}
test('private lobby has six-character code; joins are runners until host assigns', () => {
  const f = fixture(); assert.equal(f.state().code.length, 6);
  assert.equal(f.player(f.runner).role, 'runner'); assert.equal(f.player(f.hunter).role, 'hunter');
  assert.equal(f.e.state(f.runner.id, f.runner.token).code, undefined);
  assert.throws(() => f.e.assign(f.host.id, f.runner.token, { playerId: f.player(f.runner).id, role: 'host' }), { status: 403 });
});
test('lobby locking, code rotation and settings invalidate readiness', () => {
  const f = fixture(); f.ready(f.runner); const old = f.state().code;
  f.e.admission(f.host.id, f.host.token, { locked: true, rotate: true });
  assert.throws(() => f.e.join({ code: old, name: 'Outsider' }), { status: 404 });
  assert.throws(() => f.join('Late'), { status: 409 });
  f.e.configure(f.host.id, f.host.token, { ...f.state().settings, durationMinutes: 30 });
  assert.equal(f.player(f.runner).ready, false);
});
test('readiness requires explicit consent, permissions and recent preflight', () => {
  const f = fixture();
  assert.throws(() => f.e.ready(f.runner.id, f.runner.token, { ready: true }), { status: 400 });
  f.ready(f.runner); assert.equal(f.player(f.runner).ready, true);
  const runnerId = f.player(f.runner).id;
  f.at(f.now() + 46_000); assert.equal(f.state().players.find(p => p.id === runnerId).ready, false);
  assert.equal(f.player(f.runner).ready, false);
});
test('50-player cap excludes organizer but includes a playing host', () => {
  const f = fixture(); for (let i = 2; i < 50; i++) f.join(`P${i}`);
  assert.throws(() => f.join('P51'), { status: 409 });
  assert.throws(() => f.e.assign(f.host.id, f.host.token, { playerId: f.state().me.id, role: 'hunter' }), { status: 409 });
});
