import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'sellersplace.db'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sell','wtb')),
  brand TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  size TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  price INTEGER,
  negotiable INTEGER NOT NULL DEFAULT 0,
  exchange INTEGER NOT NULL DEFAULT 0,
  city TEXT NOT NULL DEFAULT '',
  meetup INTEGER NOT NULL DEFAULT 1,
  delivery TEXT NOT NULL DEFAULT '[]',
  garant INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',
  -- awaiting_payment (оплата у админа в ЛС) → published / rejected; без оплаты: pending → published / rejected;
  -- published → sold / archived
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  channel_message_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status, kind, published_at);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, listing_id)
);
`);

// Миграции: добавляем колонки, если их нет
const cols = db.prepare('PRAGMA table_info(listings)').all().map((c) => c.name);
for (const [name, def] of [['amount', 'INTEGER'], ['paid_at', 'TEXT']]) {
  if (!cols.includes(name)) db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${def}`);
}

const JSON_FIELDS = ['delivery', 'photos', 'channel_message_ids'];
const BOOL_FIELDS = ['negotiable', 'exchange', 'meetup', 'garant'];

export function hydrate(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of JSON_FIELDS) out[f] = JSON.parse(out[f] || '[]');
  for (const f of BOOL_FIELDS) out[f] = !!out[f];
  return out;
}

export function upsertUser(u) {
  db.prepare(
    `INSERT INTO users (id, username, first_name) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name`
  ).run(u.id, u.username || null, u.first_name || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
}

export function getListing(id) {
  return hydrate(
    db.prepare(
      `SELECT l.*, u.username, u.first_name FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?`
    ).get(id)
  );
}

export function setStatus(id, status, extra = {}) {
  const sets = ['status = ?'];
  const vals = [status];
  if (status === 'published') sets.push("published_at = COALESCE(published_at, datetime('now'))");
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k} = ?`);
    vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
  }
  db.prepare(`UPDATE listings SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return getListing(id);
}
