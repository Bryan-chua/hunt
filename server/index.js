import { createServer } from 'node:http';
import { Engine } from './engine.js';
import { pathToFileURL } from 'node:url';
import { GameEngine } from './game.js';
import { SqliteStore } from './store.js';
export function createApp(engine = new Engine(), games = new GameEngine()) {
  const attempts = new Map();
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const now = Date.now(), ip = req.socket.remoteAddress;
      if (attempts.size > 1000) for (const [key, value] of attempts) if (value.reset < now) attempts.delete(key);
      const rate = attempts.get(ip);
      if (!rate || rate.reset < now) attempts.set(ip, { count: 1, reset: now + 60_000 });
      else if (++rate.count > 3000) throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'POST' && (path === '/sessions' || path === '/games' || path.endsWith('/join'))) {
        const key = `admission:${ip}`, admission = attempts.get(key);
        if (!admission || admission.reset < now) attempts.set(key, { count: 1, reset: now + 60_000 });
        else if (++admission.count > 60) throw Object.assign(new Error('Too many creation/join attempts'), { status: 429 });
      }
      if (req.method === 'GET' && path === '/health') return res.end(JSON.stringify({ ok: true }));
      let body = {};
      if (req.method === 'POST') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) throw Object.assign(new Error('Body too large'), { status: 413 }); }
        try { body = raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Expected JSON object'), { status: 400 });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      if (req.method === 'POST' && path === '/games') { res.statusCode = 201; return res.end(JSON.stringify(games.create(body))); }
      if (req.method === 'POST' && path === '/games/join') return res.end(JSON.stringify(games.join(body)));
      const gameRoute = path.match(/^\/games\/([A-F0-9]+)\/(state|assign|configure|ready|admission|start|pause|resume|locations|capture|correctCapture|consent|remove|end|leave)$/);
      if (gameRoute) {
        const [, id, action] = gameRoute;
        if (req.method !== (action === 'state' ? 'GET' : 'POST')) throw Object.assign(new Error('Method not allowed'), { status: 405 });
        const result = action === 'locations' ? games.upload(id, token, body) : games[action](id, token, body);
        return res.end(JSON.stringify(result));
      }
      if (req.method === 'POST' && path === '/sessions') { res.statusCode = 201; return res.end(JSON.stringify(engine.create())); }
      const match = path.match(/^\/sessions\/([A-Z0-9]+)\/(join|state|start|locations|end|leave)$/);
      if (!match) throw Object.assign(new Error('Not found'), { status: 404 });
      const [, id, action] = match;
      if (req.method !== (action === 'state' ? 'GET' : 'POST')) throw Object.assign(new Error('Method not allowed'), { status: 405 });
      let result;
      switch (action) {
        case 'join': result = engine.join(id, body); break;
        case 'state': result = engine.state(id, token); break;
        case 'start': result = engine.start(id, token); break;
        case 'locations': result = engine.upload(id, token, body); break;
        case 'end': result = engine.end(id, token); break;
        case 'leave': result = engine.leave(id, token); break;
      }
      res.end(JSON.stringify(result));
    } catch (error) { res.statusCode = error.status || 500; res.end(JSON.stringify({ error: error.status ? error.message : 'Internal error' })); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new SqliteStore(process.env.DATA_FILE || 'data/events.sqlite');
  const engine = new Engine(), games = new GameEngine(Date.now, store); const server = createApp(engine, games);
  const timer = setInterval(() => { try { engine.tick(); games.tick(); } catch { console.error('Event persistence failed; check database permissions and disk space.'); } }, 250); timer.unref();
  server.listen(Number(process.env.PORT || 8787), '0.0.0.0', () => console.log('Game server listening on port ' + (process.env.PORT || 8787)));
  const shutdown = () => { clearInterval(timer); server.close(() => { store.close(); process.exit(0); }); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
