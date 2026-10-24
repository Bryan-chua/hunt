import { createHash, randomBytes, randomInt } from 'node:crypto';

export const REVEAL_MS = 180_000;
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const secret = () => randomBytes(24).toString('base64url');
const hash = value => createHash('sha256').update(value || '').digest('hex');
const code = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
const text = (value, label, max = 40) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} must be 1–${max} characters`);
  return value.trim();
};
const number = (value, low, high, label) => {
  if (!Number.isFinite(value) || value < low || value > high) fail(400, `Invalid ${label}`);
  return value;
};
export function settings(input) {
  const b = input.boundary;
  if (!b || typeof b !== 'object') fail(400, 'A circular boundary is required');
  return { name: text(input.name, 'Event name', 80),
    durationMinutes: number(input.durationMinutes ?? 45, 1, 180, 'duration'),
    headStartMinutes: number(input.headStartMinutes ?? 3, 0, 15, 'head start'),
    boundary: { latitude: number(b.latitude, -90, 90, 'latitude'), longitude: number(b.longitude, -180, 180, 'longitude'), radius: number(b.radius, 100, 5000, 'radius') } };
}

export class GameEngine {
  constructor(clock = Date.now, store = null) {
    this.clock = clock; this.store = store;
    this.games = new Map((store?.load() || []).map(g => [g.id, g]));
    this.tick();
  }
  save(g) { this.store?.save(g); this.games.set(g.id, g); }
  advance(g) {
    const now = this.clock();
    // An abandoned/paused event cannot retain player coordinates indefinitely.
    if (!['finished', 'canceled'].includes(g.phase) && now - g.createdAt >= 24 * 60 * 60_000) { this.finish(g, null, 'Event expired after 24 hours'); return; }
    if (!['head-start', 'hunt'].includes(g.phase)) return;
    if (now >= g.endAt) { this.finish(g, 'runners', 'Time expired'); return; }
    if (g.phase === 'head-start' && now >= g.startAt) g.phase = 'hunt';
    if (g.phase === 'hunt' && now >= g.nextRevealAt) {
      const steps = Math.floor((now - g.nextRevealAt) / REVEAL_MS) + 1;
      const cutoff = g.nextRevealAt + (steps - 1) * REVEAL_MS;
      g.revealNumber += steps;
      g.batch = { number: g.revealNumber, revealedAt: cutoff, runners: Object.values(g.members)
        .filter(p => p.role === 'runner' && p.status === 'active').map(p => {
          const sample = p.samples.filter(x => x.receivedAt <= cutoff && x.capturedAt <= cutoff && x.capturedAt >= cutoff - 30_000)
            .sort((a, b) => b.capturedAt - a.capturedAt)[0];
          return { id: p.id, name: p.name, sample: sample ? { ...sample } : null };
        }) };
      g.nextRevealAt = cutoff + REVEAL_MS;
      this.save(g);
    }
  }
  game(id) { const g = this.games.get(id); if (!g) fail(404, 'Event not found'); this.advance(g); return g; }
  actor(g, token, touch = true) {
    const p = g.members[hash(token)];
    if (!p || p.status === 'removed' || p.status === 'withdrawn') fail(401, 'Access revoked or invalid credential');
    if (touch) {
      if (this.clock() - p.lastSeen > 45_000 && g.phase === 'lobby') { p.ready = false; p.preflightAt = null; }
      p.lastSeen = this.clock();
    }
    return p;
  }
  admin(g, token) { const p = this.actor(g, token); if (!p.admin) fail(403, 'Organizer permission required'); return p; }
  lobby(g) { if (g.phase !== 'lobby') fail(409, 'This action is only available in the lobby'); }
  log(g, actor, action, detail = '') { g.audit.push({ at: this.clock(), actor: actor.id, action, detail }); if (g.audit.length > 1000) g.audit.shift(); }
  create(input) {
    if (this.games.size >= 100) fail(429, 'Too many retained events');
    const token = secret(), id = randomBytes(8).toString('hex').toUpperCase();
    let joinCode; do { joinCode = code(); } while ([...this.games.values()].some(g => g.code === joinCode));
    const host = { id: secret(), name: text(input.hostName || 'Organizer', 'Host name'), role: 'host', admin: true, owner: true,
      status: 'active', ready: false, consent: false, lastSeen: this.clock(), samples: [], capturedAt: null, preflightAt: null };
    const g = { id, code: joinCode, settings: settings(input), createdAt: this.clock(), phase: 'lobby', locked: false,
      members: { [hash(token)]: host }, audit: [], startAt: null, endAt: null, nextRevealAt: null, batch: null,
      revealNumber: 0, paused: null, result: null, finishedAt: null };
    this.log(g, host, 'created'); this.save(g);
    return { id, token };
  }
  join(input) {
    const g = [...this.games.values()].find(g => g.code === input.code);
    if (!g) fail(404, 'Event code not found');
    this.lobby(g); if (g.locked) fail(409, 'Lobby is locked');
    if (Object.values(g.members).length >= 100 || Object.values(g.members).filter(p => p.role !== 'host' && p.status === 'active').length >= 50) fail(409, 'Event is full');
    const token = secret();
    const p = { id: secret(), name: text(input.name, 'Name'), role: 'runner', admin: false, owner: false,
      status: 'active', ready: false, consent: false, lastSeen: this.clock(), samples: [], capturedAt: null, preflightAt: null };
    g.members[hash(token)] = p; this.log(g, p, 'joined'); this.save(g);
    return { id: g.id, token };
  }
  state(id, token) {
    const g = this.game(id), me = this.actor(g, token);
    const players = Object.values(g.members).map(p => ({ id: p.id, name: p.name, role: p.role, admin: p.admin,
      owner: p.owner, status: p.status, readyConfirmed: p.ready, ready: p.ready && this.clock() - p.lastSeen <= 45_000 && this.clock() - p.preflightAt <= 30_000,
      connected: this.clock() - p.lastSeen <= 45_000, capturedAt: p.capturedAt }));
    this.save(g);
    const data = { id, name: g.settings.name, settings: g.settings, code: me.admin && g.phase === 'lobby' ? g.code : undefined,
      locked: g.locked, phase: g.phase, serverNow: this.clock(), startAt: g.startAt, endAt: g.endAt,
      nextRevealAt: g.nextRevealAt, me: players.find(p => p.id === me.id), players, result: g.result,
      paused: g.paused, trackingEpoch: g.trackingEpoch,
      ownBoundary: me.samples.length ? boundaryStatus(me.samples.at(-1), g.settings.boundary) : 'unknown',
      trackingAllowed: ['head-start', 'hunt'].includes(g.phase) && me.role !== 'host' && me.status === 'active' && me.consent };
    if (me.role === 'hunter' && me.status === 'active' && ['hunt', 'paused'].includes(g.phase)) data.batch = g.batch;
    if (me.status === 'active' && ['head-start', 'hunt', 'paused'].includes(g.phase)) data.self = me.samples.at(-1) || null;
    if (me.admin) {
      data.audit = g.audit.slice(-50);
      data.diagnostics = Object.values(g.members).map(p => { const sample = p.samples.at(-1); return {
        id: p.id, lastSeen: p.lastSeen, lastFixAt: sample?.capturedAt ?? null, accuracy: sample?.accuracy ?? null,
        boundaryStatus: sample ? boundaryStatus(sample, g.settings.boundary) : 'unknown' }; });
      if (me.role === 'host' && ['head-start', 'hunt', 'paused'].includes(g.phase)) data.live = Object.values(g.members)
        .filter(p => p.status === 'active' && p.role !== 'host').map(p => ({ id: p.id, name: p.name, role: p.role, sample: p.samples.at(-1) || null }));
    }
    return data;
  }
  assign(id, token, input) {
    const g = this.game(id), actor = this.admin(g, token); this.lobby(g);
    const p = Object.values(g.members).find(p => p.id === input.playerId && p.status === 'active');
    if (!p || !['host', 'hunter', 'runner'].includes(input.role)) fail(400, 'Invalid player or role');
    if (p.admin && !actor.owner && p.id !== actor.id) fail(403, 'Only the owner changes another organizer');
    if (input.role === 'host' && !actor.owner) fail(403, 'Only the event owner appoints organizers');
    if (input.role === 'host' && p.role !== 'host' && Object.values(g.members).filter(x => x.role === 'host' && x.status === 'active').length >= 5) fail(409, 'At most five non-playing organizers');
    if (p.owner && actor.id !== p.id) fail(403, 'Owner controls their own role');
    if (input.role !== 'host' && p.role === 'host' && Object.values(g.members).filter(x => x.role !== 'host' && x.status === 'active').length >= 50) fail(409, 'Event is full');
    p.role = input.role; p.admin = p.owner || input.role === 'host'; p.ready = false; p.consent = false; p.preflightAt = null;
    this.log(g, actor, 'assigned', `${p.id}:${input.role}`); this.save(g); return this.state(id, token);
  }
  configure(id, token, input) {
    const g = this.game(id), p = this.admin(g, token); this.lobby(g);
    g.settings = settings(input); for (const member of Object.values(g.members)) member.ready = false;
    this.log(g, p, 'settings changed'); this.save(g); return this.state(id, token);
  }
  ready(id, token, input) {
    const g = this.game(id), p = this.actor(g, token); this.lobby(g);
    if (p.role === 'host') fail(409, 'Non-playing organizers do not need readiness');
    if (input.ready !== true) { p.ready = false; p.consent = false; p.preflightAt = null; }
    else {
      if (input.consent !== true || input.permissions !== true || !Number.isFinite(input.capturedAt) || Math.abs(this.clock() - input.capturedAt) > 30_000) fail(400, 'Consent, background permission and a fresh GPS preflight are required');
      p.ready = true; p.consent = true; p.preflightAt = input.capturedAt;
    }
    this.save(g); return this.state(id, token);
  }
  admission(id, token, input) {
    const g = this.game(id), p = this.admin(g, token); this.lobby(g);
    if (typeof input.locked === 'boolean') g.locked = input.locked;
    if (input.rotate === true) { let next; do { next = code(); } while ([...this.games.values()].some(x => x.code === next)); g.code = next; }
    this.log(g, p, 'admission changed'); this.save(g); return this.state(id, token);
  }
  start(id, token) {
    const g = this.game(id), actor = this.admin(g, token); this.lobby(g);
    const players = Object.values(g.members).filter(p => p.role !== 'host' && p.status === 'active');
    if (!players.some(p => p.role === 'hunter') || !players.some(p => p.role === 'runner')) fail(409, 'At least one hunter and one runner are required');
    if (players.some(p => !p.ready || !p.consent || this.clock() - p.lastSeen > 45_000 || this.clock() - p.preflightAt > 30_000)) fail(409, 'All included players need a fresh ready check');
    g.phase = 'head-start'; g.collectionFrom = this.clock(); g.trackingEpoch = secret();
    g.startAt = this.clock() + g.settings.headStartMinutes * 60_000;
    g.endAt = g.startAt + g.settings.durationMinutes * 60_000;
    g.nextRevealAt = g.startAt; g.locked = true;
    this.log(g, actor, 'started'); this.save(g); return this.state(id, token);
  }
  pause(id, token, input = {}) {
    const g = this.game(id), actor = this.admin(g, token);
    if (!['head-start', 'hunt'].includes(g.phase)) fail(409, 'Round is not running');
    const reason = text(input.reason || 'Organizer paused the round', 'Pause reason', 120);
    g.paused = { at: this.clock(), phase: g.phase, reason, remainingHunt: g.endAt - this.clock(),
      remainingHeadStart: Math.max(0, g.startAt - this.clock()), remainingReveal: g.nextRevealAt - this.clock() };
    g.phase = 'paused'; g.trackingEpoch = secret();
    this.log(g, actor, 'paused', reason); this.save(g); return this.state(id, token);
  }
  resume(id, token) {
    const g = this.game(id), actor = this.admin(g, token);
    if (g.phase !== 'paused') fail(409, 'Round is not paused');
    const delta = this.clock() - g.paused.at;
    g.startAt += delta; g.endAt += delta; g.nextRevealAt += delta;
    g.phase = g.paused.phase; g.paused = null; g.trackingEpoch = secret(); g.collectionFrom = this.clock();
    // Pre-pause fixes must never masquerade as new post-resume GPS.
    for (const p of Object.values(g.members)) p.samples = [];
    this.log(g, actor, 'resumed'); this.save(g); return this.state(id, token);
  }
  upload(id, token, input) {
    const g = this.game(id), p = this.actor(g, token), now = this.clock();
    if (!['head-start', 'hunt'].includes(g.phase) || p.status !== 'active' || p.role === 'host' || !p.consent) fail(409, 'Tracking is not active');
    if (input.epoch !== g.trackingEpoch) fail(409, 'Tracking generation changed; refresh state');
    const { latitude, longitude, accuracy, capturedAt } = input;
    if (![latitude, longitude, accuracy, capturedAt].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0 || capturedAt > now + 5000 || capturedAt < now - 30_000 || capturedAt < g.collectionFrom) fail(400, 'Invalid, stale or pre-resume GPS sample');
    p.samples = p.samples.filter(x => x.receivedAt > now - 60_000);
    if (p.samples.length >= 120) fail(429, 'Too many samples');
    p.samples.push({ latitude, longitude, accuracy, capturedAt, receivedAt: now });
    this.save(g); return { acceptedAt: now };
  }
  elapsed(g) {
    if (g.phase === 'lobby' || g.phase === 'head-start') return 0;
    const remaining = g.phase === 'paused' ? g.paused.remainingHunt : Math.max(0, g.endAt - this.clock());
    return Math.max(0, Math.min(g.settings.durationMinutes * 60_000, g.settings.durationMinutes * 60_000 - remaining));
  }
  finish(g, winner, reason) {
    const elapsed = this.elapsed(g);
    g.result = { winner, reason, elapsedMs: elapsed, players: Object.values(g.members).filter(p => p.role !== 'host').map(p => ({
      id: p.id, name: p.name, role: p.role, status: winner === 'runners' && p.role === 'runner' && p.status === 'active' ? 'survived' : p.status, capturedAt: p.capturedAt,
      survivalMs: p.role === 'runner' ? p.capturedElapsed ?? p.withdrawnElapsed ?? elapsed : null })) };
    g.phase = winner ? 'finished' : 'canceled'; g.finishedAt = this.clock(); g.nextRevealAt = null; g.paused = null; g.batch = null;
    g.trackingEpoch = secret();
    for (const p of Object.values(g.members)) { p.samples = []; p.consent = false; }
    this.save(g);
  }
  end(id, token, input = {}) { const g = this.game(id), p = this.admin(g, token); if (!['finished', 'canceled'].includes(g.phase)) { const reason = text(input.reason || 'Ended early by organizer', 'End reason', 120); this.log(g, p, 'ended', reason); this.finish(g, null, reason); } return this.state(id, token); }
  capture(id, token, input) {
    const g = this.game(id), p = this.actor(g, token);
    const key = text(input.key, 'Capture request key', 100);
    if (p.captureKey === key && p.status === 'caught') return this.state(id, token);
    if (g.phase !== 'hunt' || p.role !== 'runner' || p.status !== 'active') fail(409, 'Only an active runner can confirm capture during the hunt');
    this.catchPlayer(g, p); p.captureKey = key; this.log(g, p, 'capture confirmed');
    if (!Object.values(g.members).some(x => x.role === 'runner' && x.status === 'active')) this.finish(g, 'hunters', 'All remaining runners caught');
    this.save(g); return this.state(id, token);
  }
  catchPlayer(g, p) {
    p.capturedElapsed = this.elapsed(g); p.capturedAt = this.clock(); p.status = 'caught'; p.samples = []; p.consent = false;
    if (g.batch) g.batch = { ...g.batch, runners: g.batch.runners.filter(r => r.id !== p.id) };
  }
  correctCapture(id, token, input) {
    const g = this.game(id), actor = this.admin(g, token), reason = text(input.reason, 'Correction reason', 120);
    if (g.phase !== 'hunt' && !(g.phase === 'paused' && g.paused.phase === 'hunt')) fail(409, 'Corrections require a running or paused hunt');
    const p = Object.values(g.members).find(p => p.id === input.playerId && p.role === 'runner');
    if (!p) fail(400, 'Runner not found');
    if (input.undo === true) {
      if (p.status !== 'caught') fail(409, 'Runner is not caught');
      p.status = 'active'; p.capturedAt = null; p.capturedElapsed = null; p.captureKey = null; p.consent = false;
    } else {
      if (p.status !== 'active') fail(409, 'Runner is not active'); this.catchPlayer(g, p);
      if (!Object.values(g.members).some(x => x.role === 'runner' && x.status === 'active')) this.finish(g, 'hunters', 'All remaining runners caught');
    }
    this.log(g, actor, input.undo ? 'capture undone' : 'capture corrected', `${p.id}: ${reason}`); this.save(g); return this.state(id, token);
  }
  consent(id, token, input = { consent: true }) {
    const g = this.game(id), p = this.actor(g, token);
    if (!['head-start', 'hunt', 'paused'].includes(g.phase) || p.role === 'host' || p.status !== 'active') fail(409, 'Player is not active');
    p.consent = input.consent === true;
    if (!p.consent) { p.samples = []; if (g.batch) g.batch = { ...g.batch, runners: g.batch.runners.filter(r => r.id !== p.id) }; }
    this.save(g); return this.state(id, token);
  }
  remove(id, token, input) {
    const g = this.game(id), actor = this.admin(g, token), p = Object.values(g.members).find(p => p.id === input.playerId);
    const reason = text(input.reason, 'Removal reason', 120);
    if (!p || p.owner || p.id === actor.id || (p.admin && !actor.owner)) fail(403, 'Cannot remove this player');
    this.withdraw(g, p, 'removed'); this.log(g, actor, 'removed', `${p.id}: ${reason}`); this.save(g); return this.state(id, token);
  }
  withdraw(g, p, status) {
    p.withdrawnElapsed = this.elapsed(g); p.status = status; p.ready = false; p.consent = false; p.samples = [];
    if (g.batch) g.batch = { ...g.batch, runners: g.batch.runners.filter(r => r.id !== p.id) };
    if (['head-start', 'hunt', 'paused'].includes(g.phase)) {
      const active = Object.values(g.members).filter(x => x.status === 'active');
      if (!active.some(x => x.role === 'runner')) this.finish(g, null, 'No active runners');
      else if (!active.some(x => x.role === 'hunter')) this.finish(g, null, 'No active hunters');
    }
  }
  leave(id, token) {
    const g = this.game(id), p = this.actor(g, token);
    if (p.owner) { if (!['finished', 'canceled'].includes(g.phase)) this.finish(g, null, 'Owner left event'); p.status = 'withdrawn'; }
    else this.withdraw(g, p, 'withdrawn');
    this.log(g, p, 'left'); this.save(g); return { left: true };
  }
  tick() {
    for (const g of this.games.values()) {
      this.advance(g);
      if (g.finishedAt !== null && this.clock() - g.finishedAt >= 30 * 24 * 60 * 60_000) { this.store?.delete(g.id); this.games.delete(g.id); }
    }
  }
}

export function boundaryStatus(sample, boundary) {
  const rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(sample.latitude - boundary.latitude) / 2) ** 2 + Math.cos(rad(boundary.latitude)) * Math.cos(rad(sample.latitude)) * Math.sin(rad(sample.longitude - boundary.longitude) / 2) ** 2;
  const distance = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  if (distance - sample.accuracy > boundary.radius) return 'outside';
  if (distance + sample.accuracy > boundary.radius) return 'uncertain';
  return 'inside';
}
