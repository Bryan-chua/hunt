import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from './store.js';
import { GameEngine } from './game.js';

test('SQLite preserves lobby credentials by hash, phase, snapshots and pause across reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dgc-db-')), file = join(directory, 'events.sqlite');
  let store, now = 1000000;
  try {
    store = new SqliteStore(file); let e = new GameEngine(() => now, store);
    const h = e.create({ name: 'Persisted event', durationMinutes: 10, headStartMinutes: 1, boundary: { latitude: 1, longitude: 103, radius: 500 } });
    const r = e.join({ code: e.state(h.id, h.token).code, name: 'Runner' }), c = e.join({ code: e.state(h.id, h.token).code, name: 'Hunter' });
    e.assign(h.id, h.token, { playerId: e.state(c.id, c.token).me.id, role: 'hunter' });
    for (const p of [r, c]) e.ready(p.id, p.token, { ready: true, consent: true, permissions: true, capturedAt: now });
    const start = e.start(h.id, h.token); now = start.startAt - 5000;
    e.upload(r.id, r.token, { latitude: 1.001, longitude: 103.001, accuracy: 10, capturedAt: now, epoch: start.trackingEpoch });
    now = start.startAt; e.tick(); const batch = e.state(c.id, c.token).batch;
    e.pause(h.id, h.token, { reason: 'Break' }); const remaining = e.state(h.id, h.token).paused.remainingReveal;
    store.close(); store = new SqliteStore(file); e = new GameEngine(() => now, store);
    assert.equal(e.state(h.id, h.token).phase, 'paused'); assert.deepEqual(e.state(c.id, c.token).batch, batch);
    now += 60000; const resumed = e.resume(h.id, h.token);
    assert.equal(resumed.nextRevealAt - now, remaining);
    const persisted = store.load()[0];
    assert.equal(JSON.stringify(persisted).includes(h.token), false);
    assert.equal(JSON.stringify(persisted).includes(r.token), false);
    e.end(h.id, h.token); assert.equal(store.load()[0].batch, null);
    assert.ok(Object.values(store.load()[0].members).every(p => p.samples.length === 0));
    assert.equal(e.state(c.id, c.token).result.reason, 'Ended early by organizer');
    store.close(); store = null;
    // secure_delete and DELETE journaling remove obsolete player fixes from this file.
    assert.equal(readFileSync(file).includes(Buffer.from('"latitude":1.001')), false);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('24-hour abandoned events clear locations; 30-day results are deleted', () => {
  let now = 1000000; const store = new SqliteStore(':memory:');
  try {
    const e = new GameEngine(() => now, store);
    const h = e.create({ name: 'Abandoned', boundary: { latitude: 1, longitude: 103, radius: 500 } });
    now += 24 * 60 * 60_000; e.tick();
    assert.equal(e.state(h.id, h.token).phase, 'canceled');
    assert.equal(e.state(h.id, h.token).result.reason, 'Event expired after 24 hours');
    now += 30 * 24 * 60 * 60_000; e.tick(); assert.equal(store.load().length, 0);
    assert.throws(() => e.state(h.id, h.token), { status: 404 });
  } finally { store.close(); }
});
