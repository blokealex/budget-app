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

    -- Extra fingerprints that point at an existing transaction. Used when a
    -- masked midata row ("******") is filled in from a normal CSV, so both
    -- versions of the statement line are recognised on future imports.
    CREATE TABLE IF NOT EXISTS fingerprint_aliases (
      fingerprint TEXT PRIMARY KEY,
      tx_id       INTEGER NOT NULL REFERENCES transactions(id)
    );

    -- Date + amount pairs you've said are genuinely separate payments.
    CREATE TABLE IF NOT EXISTS not_duplicates (
      date   TEXT NOT NULL,
      amount INTEGER NOT NULL,
      PRIMARY KEY (date, amount)
    );
  `);
  // Soft delete: deleted rows stay (so re-importing doesn't bring them back)
  // but are hidden everywhere via the "live" view.
  const cols = db.prepare('PRAGMA table_info(transactions)').all().map(c => c.name);
  if (!cols.includes('deleted_at')) db.exec('ALTER TABLE transactions ADD COLUMN deleted_at TEXT');
  db.exec('CREATE VIEW IF NOT EXISTS live AS SELECT * FROM transactions WHERE deleted_at IS NULL');
  return db;
}

// "******", "**** ****" etc.: midata sometimes hides the description.
export const isMasked = description => /^[\s*]*$/.test(description) && description.includes('*');

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
  const known = db.prepare(`SELECT 1 FROM transactions WHERE fingerprint = ?
    UNION ALL SELECT 1 FROM fingerprint_aliases WHERE fingerprint = ?`);
  const insert = db.prepare(`INSERT INTO transactions
    (fingerprint, date, description, amount, category) VALUES (?, ?, ?, ?, ?)`);
  const sameDateAmount = db.prepare(`SELECT id, description, manual FROM transactions
    WHERE date = ? AND amount = ? AND deleted_at IS NULL ORDER BY id`);
  const fill = db.prepare(`UPDATE transactions SET description = ?,
    category = CASE manual WHEN 1 THEN category ELSE ? END WHERE id = ?`);
  const alias = db.prepare('INSERT OR IGNORE INTO fingerprint_aliases (fingerprint, tx_id) VALUES (?, ?)');

  let added = 0, duplicates = 0, filled = 0;
  db.exec('BEGIN');
  try {
    transactions.forEach((t, i) => {
      if (known.get(fps[i], fps[i])) { duplicates++; return; }
      // A masked midata row for the same payment? Fill it in rather than duplicating it.
      if (!isMasked(t.description)) {
        const masked = sameDateAmount.all(t.date, t.amount).find(r => isMasked(r.description));
        if (masked) {
          fill.run(t.description, categorise(t), masked.id);
          alias.run(fps[i], masked.id);
          filled++;
          return;
        }
      }
      insert.run(fps[i], t.date, t.description, t.amount, categorise(t));
      added++;
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { added, duplicates, filled };
}

export function deleteTransaction(db, id) {
  db.prepare("UPDATE transactions SET deleted_at = datetime('now') WHERE id = ?").run(id);
}
export function restoreTransaction(db, id) {
  db.prepare('UPDATE transactions SET deleted_at = NULL WHERE id = ?').run(id);
}

// Groups of live transactions with the same date and amount that you haven't
// marked as genuinely separate. Money out and in both count.
export function possibleDuplicates(db) {
  const groups = db.prepare(`SELECT date, amount, COUNT(*) AS n FROM live
    WHERE NOT EXISTS (SELECT 1 FROM not_duplicates nd WHERE nd.date = live.date AND nd.amount = live.amount)
    GROUP BY date, amount HAVING n > 1 ORDER BY date DESC`).all();
  const rows = db.prepare('SELECT * FROM live WHERE date = ? AND amount = ? ORDER BY id');
  return groups.map(g => ({ date: g.date, amount: g.amount, transactions: rows.all(g.date, g.amount) }));
}

export function markNotDuplicates(db, date, amount) {
  db.prepare('INSERT OR IGNORE INTO not_duplicates (date, amount) VALUES (?, ?)').run(date, amount);
}

// Re-apply rules to every transaction not categorised by hand.
export function recategoriseAll(db, categorise) {
  const rows = db.prepare('SELECT id, description, amount FROM live WHERE manual = 0').all();
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
  return db.prepare(`SELECT * FROM live WHERE substr(date,1,7) = ?
    ORDER BY date DESC, id DESC`).all(month);
}

export function months(db) {
  return db.prepare(`SELECT DISTINCT substr(date,1,7) AS m FROM live ORDER BY m DESC`)
    .all().map(r => r.m);
}
