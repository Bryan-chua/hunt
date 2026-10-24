import { randomBytes } from 'node:crypto';

export const INTERVAL = 180_000;
const secret = () => randomBytes(24).toString('base64url');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// Memory-only research spike. No location history is written to disk.
export class Engine {
  constructor(clock = Date.now) { this.clock = clock; this.sessions = new Map(); }
  create() {
    this.clean();
    if (this.sessions.size >= 100) fail(429, 'Too many test sessions');
    const id = randomBytes(5).toString('hex').toUpperCase();
    const session = { id, host: secret(), runnerInvite: secret(), hunterInvite: secret(),
      createdAt: this.clock(), startAt: null, endAt: null, ended: false, players: new Map(), batch: null };
    this.sessions.set(id, session);
    return { id, token: session.host, runnerInvite: session.runnerInvite, hunterInvite: session.hunterInvite };
  }
  clean() {
    for (const [id, s] of this.sessions) if (this.clock() - s.createdAt > 3_600_000) this.sessions.delete(id);
  }
  session(id) { this.clean(); const s = this.sessions.get(id); if (!s) fail(404, 'Test session not found or expired'); this.advance(s); return s; }
  auth(s, token) {
    if (token === s.host) return { role: 'host' };
    const p = s.players.get(token); if (!p || p.left) fail(401, 'Invalid session credential'); return p;
  }
  join(id, { invite, name }) {
    const s = this.session(id);
    if (s.startAt !== null || s.ended) fail(409, 'Joining closes when the test starts');
    const role = invite === s.runnerInvite ? 'runner' : invite === s.hunterInvite ? 'hunter' : null;
    if (!role) fail(403, 'Invalid role invitation');
    if (typeof name !== 'string' || !name.trim() || name.length > 40) fail(400, 'Name must be 1–40 characters');
    if (s.players.size >= 50) fail(409, 'Session full');
    const token = secret();
    s.players.set(token, { id: secret(), role, name: name.trim(), samples: [], left: false });
    return { id, token, role };
  }
  start(id, token) {
    const s = this.session(id); if (this.auth(s, token).role !== 'host') fail(403, 'Host only');
    if (s.startAt !== null || s.ended) fail(409, 'Test already started or ended');
    if (![...s.players.values()].some(p => p.role === 'runner' && !p.left)) fail(409, 'Join a runner first');
    s.startAt = this.clock() + 30_000; s.endAt = s.startAt + 30 * 60_000;
    return this.state(id, token);
  }
  advance(s) {
    const now = this.clock();
    if (s.ended) return;
    if (s.endAt !== null && now >= s.endAt) { this.finish(s); return; }
    if (s.startAt === null || now < s.startAt) return;
    const number = Math.floor((now - s.startAt) / INTERVAL) + 1;
    if (s.batch?.number === number) return;
    const revealedAt = s.startAt + (number - 1) * INTERVAL;
    const runners = [...s.players.values()].filter(p => p.role === 'runner' && !p.left).map(p => {
      const sample = p.samples.filter(x => x.receivedAt <= revealedAt && x.capturedAt <= revealedAt && x.capturedAt >= revealedAt - 30_000)
        .sort((a, b) => b.capturedAt - a.capturedAt)[0];
      return { id: p.id, name: p.name, sample: sample ? { ...sample } : null };
    });
    s.batch = { number, revealedAt, runners };
  }
  upload(id, token, sample) {
    const s = this.session(id), p = this.auth(s, token), now = this.clock();
    if (p.role !== 'runner') fail(403, 'Runner only');
    if (s.startAt === null || s.ended) fail(409, 'Tracking not active');
    const { latitude, longitude, accuracy, capturedAt } = sample;
    if (![latitude, longitude, accuracy, capturedAt].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0 || capturedAt > now + 5000 || capturedAt < now - 30_000) fail(400, 'Invalid or stale GPS sample; check device clock');
    // Bound raw storage; keep enough recent samples for the next cutoff.
    p.samples = p.samples.filter(x => x.receivedAt > now - 60_000);
    if (p.samples.length >= 120) fail(429, 'Too many samples');
    p.samples.push({ latitude, longitude, accuracy, capturedAt, receivedAt: now });
    return { acceptedAt: now };
  }
  state(id, token) {
    const s = this.session(id), p = this.auth(s, token), now = this.clock();
    const phase = s.ended ? 'ended' : s.startAt === null ? 'lobby' : now < s.startAt ? 'head-start' : 'hunt';
    const data = { id, role: p.role, phase, serverNow: now, startAt: s.startAt, endAt: s.endAt,
      nextRevealAt: ['hunt', 'head-start'].includes(phase) ? (phase === 'head-start' ? s.startAt : Math.min(s.endAt, s.startAt + Math.floor((now - s.startAt) / INTERVAL + 1) * INTERVAL)) : null,
      players: [...s.players.values()].filter(x => !x.left).map(x => ({ id: x.id, name: x.name, role: x.role })) };
    if (p.role === 'hunter' && phase === 'hunt') data.batch = s.batch;
    return data;
  }
  finish(s) { s.ended = true; s.batch = null; for (const p of s.players.values()) p.samples = []; }
  end(id, token) { const s = this.session(id); if (this.auth(s, token).role !== 'host') fail(403, 'Host only'); this.finish(s); return { ended: true }; }
  leave(id, token) { const s = this.session(id), p = this.auth(s, token); if (p.role === 'host') return this.end(id, token); p.left = true; p.samples = []; if (s.batch) s.batch = { ...s.batch, runners: s.batch.runners.filter(x => x.id !== p.id) }; return { left: true }; }
  tick() { this.clean(); for (const s of this.sessions.values()) this.advance(s); }
}
