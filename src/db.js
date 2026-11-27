// SQLite storage using Node's built-in node:sqlite (no npm install needed).
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = resolve(process.env.BUDGET_DB ?? 'data/budget.db');

export function openDb(path = DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY,
      fingerprint TEXT UNIQUE NOT NULL,
      date        TEXT NOT NULL,          -- YYYY-MM-DD
      description TEXT NOT NULL,
      amount      INTEGER NOT NULL,       -- pence; negative = money out
      category    TEXT,
      manual      INTEGER NOT NULL DEFAULT 0  -- 1 = category set by hand, don't overwrite
    );
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
  `);
  return db;
}

// Same date + description + amount can legitimately happen twice (two coffees),
// so the fingerprint includes how many times we've seen it in this file.
// Re-importing an overlapping statement therefore doesn't create duplicates.
export function fingerprints(transactions) {
  const seen = new Map();
  return transactions.map(t => {
    const key = `${t.date}|${t.description.toUpperCase()}|${t.amount}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return createHash('sha1').update(`${key}|${n}`).digest('hex');
  });
}

export function insertTransactions(db, transactions, categorise) {
  const fps = fingerprints(transactions);
  const stmt = db.prepare(`INSERT OR IGNORE INTO transactions
    (fingerprint, date, description, amount, category) VALUES (?, ?, ?, ?, ?)`);
  let added = 0;
  db.exec('BEGIN');
  try {
    transactions.forEach((t, i) => {
      const r = stmt.run(fps[i], t.date, t.description, t.amount, categorise(t));
      added += Number(r.changes);
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { added, duplicates: transactions.length - added };
}

// Re-apply rules to every transaction not categorised by hand.
export function recategoriseAll(db, categorise) {
  const rows = db.prepare('SELECT id, description, amount FROM transactions WHERE manual = 0').all();
  const upd = db.prepare('UPDATE transactions SET category = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const r of rows) upd.run(categorise(r), r.id);
  db.exec('COMMIT');
  return rows.length;
}

export function setCategory(db, id, category) {
  db.prepare('UPDATE transactions SET category = ?, manual = 1 WHERE id = ?').run(category, id);
}

export function monthTransactions(db, month) { // month = 'YYYY-MM'
  return db.prepare(`SELECT * FROM transactions WHERE substr(date,1,7) = ?
    ORDER BY date DESC, id DESC`).all(month);
}

export function months(db) {
  return db.prepare(`SELECT DISTINCT substr(date,1,7) AS m FROM transactions ORDER BY m DESC`)
    .all().map(r => r.m);
}
