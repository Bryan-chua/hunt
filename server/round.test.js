import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, boundaryStatus } from './game.js';

function setup(extra = {}) {
  let now = 1_000_000; const e = new GameEngine(() => now);
  const h = e.create({ name: 'Round', durationMinutes: 10, headStartMinutes: 1, boundary: { latitude: 1, longitude: 103, radius: 500 }, ...extra });
  const host = () => e.state(h.id, h.token), join = name => e.join({ name, code: host().code });
  const r = join('Runner'), r2 = join('Runner 2'), c = join('Hunter');
  const state = p => e.state(p.id, p.token);
  e.assign(h.id, h.token, { playerId: state(c).me.id, role: 'hunter' });
  const ready = () => { for (const p of [r, r2, c]) e.ready(p.id, p.token, { ready: true, consent: true, permissions: true, capturedAt: now }); };
  const start = () => { ready(); return e.start(h.id, h.token); };
  const upload = (p, latitude = 1, capturedAt = now, epoch = host().trackingEpoch) => e.upload(p.id, p.token, { latitude, longitude: 103, accuracy: 10, capturedAt, epoch });
  return { e, h, r, r2, c, host, state, start, upload, at: value => { now = value; }, now: () => now };
}
test('start enforces roles, readiness, fresh preflight and forbids late join', () => {
  const f = setup(); assert.throws(() => f.e.start(f.h.id, f.h.token), { status: 409 });
  const s = f.start(); assert.equal(s.phase, 'head-start');
  assert.equal(s.startAt, f.now() + 60_000); assert.equal(s.endAt, s.startAt + 600_000);
  assert.throws(() => f.e.join({ name: 'Late', code: s.code }), { status: 404 });
  assert.throws(() => f.e.pause(f.h.id, f.r.token), { status: 403 });
});
test('head-start and hunt pause preserve remaining timers and invalidate old tracking', () => {
  const f = setup(), s = f.start(); f.at(f.now() + 10000); const epoch = f.host().trackingEpoch;
  f.e.pause(f.h.id, f.h.token, { reason: 'Traffic' });
  assert.throws(() => f.upload(f.r), { status: 409 });
  f.at(f.now() + 70000); const resumed = f.e.resume(f.h.id, f.h.token);
  assert.equal(resumed.startAt, s.startAt + 70000); assert.equal(resumed.nextRevealAt, resumed.startAt);
  assert.throws(() => f.upload(f.r, 1, f.now(), epoch), { status: 409 });
  f.upload(f.r); f.at(resumed.startAt); f.e.tick();
  const before = f.host(); f.e.pause(f.h.id, f.h.token);
  f.at(f.now() + 90000); const again = f.e.resume(f.h.id, f.h.token);
  assert.equal(again.endAt, before.endAt + 90000); assert.equal(again.nextRevealAt, before.nextRevealAt + 90000);
  assert.equal(f.state(f.c).batch.number, 1);
});
test('three-minute snapshots never expose raw coordinates and stay identical between releases', () => {
  const f = setup(), s = f.start(); f.at(s.startAt - 5000); f.upload(f.r, 1.001); f.upload(f.c, 1.002);
  assert.equal(f.state(f.c).batch, undefined);
  f.at(s.startAt); f.e.tick(); const batch = structuredClone(f.state(f.c).batch);
  assert.equal(batch.runners[0].sample.latitude, 1.001);
  f.at(f.now() + 1000); f.upload(f.r, 1.003);
  assert.deepEqual(f.state(f.c).batch, batch);
  assert.equal(f.state(f.r).batch, undefined); assert.equal(f.state(f.r).live, undefined);
  assert.equal(f.host().live.find(p => p.role === 'hunter').sample.latitude, 1.002);
  // A host who plays a hunter must lose the organizer's live-map access.
});
test('playing host is bound by team visibility and organizer data is access-controlled', () => {
  const f = setup(); const hostId = f.host().me.id;
  f.e.assign(f.h.id, f.h.token, { playerId: hostId, role: 'hunter' });
  f.e.ready(f.h.id, f.h.token, { ready: true, consent: true, permissions: true, capturedAt: f.now() });
  const s = f.start(); f.at(s.startAt - 5000); f.upload(f.r); f.at(s.startAt);
  assert.equal(f.host().live, undefined); assert.ok(f.host().batch);
  assert.equal(f.state(f.r).audit, undefined); assert.equal(f.state(f.c).diagnostics, undefined);
});
test('capture is idempotent, stops sharing, and final capture determines hunters winner', () => {
  const f = setup(), s = f.start(); f.at(s.startAt);
  const first = f.e.capture(f.r.id, f.r.token, { key: 'one' });
  assert.equal(first.me.status, 'caught'); assert.equal(first.trackingAllowed, false);
  assert.equal(f.e.capture(f.r.id, f.r.token, { key: 'one' }).me.status, 'caught');
  assert.throws(() => f.upload(f.r), { status: 409 });
  const final = f.e.capture(f.r2.id, f.r2.token, { key: 'two' });
  assert.equal(final.phase, 'finished'); assert.equal(final.result.winner, 'hunters');
  assert.equal(f.state(f.c).batch, undefined); assert.equal(f.host().live, undefined);
});
test('capture correction needs a reason and restored runner must consent again', () => {
  const f = setup(), s = f.start(); f.at(s.startAt); f.e.capture(f.r.id, f.r.token, { key: 'one' });
  const id = f.state(f.r).me.id;
  assert.throws(() => f.e.correctCapture(f.h.id, f.h.token, { playerId: id, undo: true }), { status: 400 });
  f.e.correctCapture(f.h.id, f.h.token, { playerId: id, undo: true, reason: 'Mistaken tap' });
  assert.equal(f.state(f.r).trackingAllowed, false);
  f.e.consent(f.r.id, f.r.token); assert.equal(f.state(f.r).trackingAllowed, true);
});
test('timeout wins for runners; late capture cannot rewrite results', () => {
  const f = setup(), s = f.start(); f.at(s.endAt);
  assert.equal(f.host().result.winner, 'runners');
  assert.throws(() => f.e.capture(f.r.id, f.r.token, { key: 'late' }), { status: 409 });
  assert.equal(f.host().nextRevealAt, null);
});
test('withdrawal revokes credentials and an empty team cancels without a false capture win', () => {
  const f = setup(); f.start(); f.e.leave(f.r.id, f.r.token);
  assert.throws(() => f.state(f.r), { status: 401 });
  f.e.leave(f.r2.id, f.r2.token); assert.equal(f.host().phase, 'canceled'); assert.equal(f.host().result.winner, null);
});
test('boundary classification takes GPS accuracy into account', () => {
  const b = { latitude: 1, longitude: 103, radius: 500 };
  assert.equal(boundaryStatus({ latitude: 1, longitude: 103, accuracy: 10 }, b), 'inside');
  assert.equal(boundaryStatus({ latitude: 1.01, longitude: 103, accuracy: 10 }, b), 'outside');
  assert.equal(boundaryStatus({ latitude: 1, longitude: 103, accuracy: 600 }, b), 'uncertain');
});
test('stale readiness blocks start even with an otherwise connected roster', () => {
  const f = setup();
  for (const p of [f.r, f.r2, f.c]) f.e.ready(p.id, p.token, { ready: true, consent: true, permissions: true, capturedAt: f.now() });
  f.at(f.now() + 31000);
  for (const p of [f.r, f.r2, f.c]) f.state(p);
  assert.throws(() => f.e.start(f.h.id, f.h.token), { status: 409 });
});
test('capture cannot be corrected during head start or after a terminal result', () => {
  const f = setup(), s = f.start(), id = f.state(f.r).me.id;
  f.e.pause(f.h.id, f.h.token);
  assert.throws(() => f.e.correctCapture(f.h.id, f.h.token, { playerId: id, reason: 'Mistake' }), { status: 409 });
  f.e.resume(f.h.id, f.h.token); f.at(s.endAt + 1000); f.e.tick();
  assert.throws(() => f.e.correctCapture(f.h.id, f.h.token, { playerId: id, reason: 'Mistake', undo: true }), { status: 409 });
  assert.equal(f.host().result.players.find(p => p.id === id).status, 'survived');
});
test('host removal revokes access immediately without relabeling withdrawal as a capture', () => {
  const f = setup(); f.start(); const id = f.state(f.r).me.id;
  f.e.remove(f.h.id, f.h.token, { playerId: id, reason: 'Left the event' });
  assert.throws(() => f.state(f.r), { status: 401 });
  assert.throws(() => f.upload(f.r), { status: 401 });
  assert.equal(f.host().players.find(p => p.id === id).status, 'removed');
});
test('co-organizers cannot grant permissions or change another organizer', () => {
  const f = setup(), cId = f.state(f.c).me.id, rId = f.state(f.r).me.id;
  f.e.assign(f.h.id, f.h.token, { playerId: cId, role: 'host' });
  f.e.assign(f.h.id, f.h.token, { playerId: rId, role: 'host' });
  assert.throws(() => f.e.assign(f.h.id, f.c.token, { playerId: rId, role: 'hunter' }), { status: 403 });
  assert.throws(() => f.e.assign(f.h.id, f.c.token, { playerId: f.state(f.r2).me.id, role: 'host' }), { status: 403 });
});
test('revoking sharing consent purges the runner location and requires explicit re-consent', () => {
  const f = setup(), s = f.start(); f.at(s.startAt - 1000); f.upload(f.r);
  f.at(s.startAt); f.e.tick(); assert.ok(f.state(f.c).batch.runners.find(p => p.id === f.state(f.r).me.id));
  const stopped = f.e.consent(f.r.id, f.r.token, { consent: false });
  assert.equal(stopped.trackingAllowed, false); assert.equal(stopped.self, null);
  assert.throws(() => f.upload(f.r), { status: 409 });
  assert.equal(f.state(f.c).batch.runners.some(p => p.id === stopped.me.id), false);
  f.e.consent(f.r.id, f.r.token, { consent: true }); f.upload(f.r);
});
test('survival time excludes pause duration and missed reveals do not flood reconnecting players', () => {
  const f = setup(), s = f.start(); f.at(s.startAt + 30000);
  f.e.pause(f.h.id, f.h.token); f.at(f.now() + 120000); f.e.resume(f.h.id, f.h.token);
  f.e.capture(f.r.id, f.r.token, { key: 'capture' });
  f.at(f.now() + 400000); const next = f.state(f.c);
  assert.equal(next.batch.number, 3);
  assert.equal(next.batch.runners.find(p => p.id === f.state(f.r2).me.id).sample, null);
  f.e.end(f.h.id, f.h.token);
  assert.equal(f.host().result.players.find(p => p.id === f.state(f.r).me.id).survivalMs, 30000);
});
