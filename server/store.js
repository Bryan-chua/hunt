import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// One server process owns this file. Bind parameters prevent SQL interpolation.
export class SqliteStore {
  constructor(file = 'data/events.sqlite') {
    if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, payload TEXT NOT NULL);');
    this.put = this.db.prepare('INSERT INTO events (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
    this.del = this.db.prepare('DELETE FROM events WHERE id=?');
  }
  load() { return this.db.prepare('SELECT payload FROM events').all().map(row => JSON.parse(row.payload)); }
  save(game) { this.put.run(game.id, JSON.stringify(game)); }
  delete(id) { this.del.run(id); }
  close() { this.db.close(); }
}
