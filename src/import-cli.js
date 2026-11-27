// Usage: npm run import -- path/to/statement.csv [more.csv ...]
import { readFileSync } from 'node:fs';
import { parseStatement } from './csv.js';
import { openDb, insertTransactions } from './db.js';
import { makeCategoriser } from './config.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: npm run import -- statement.csv');
  process.exit(1);
}
const db = openDb();
const categorise = makeCategoriser();
for (const f of files) {
  try {
    const { transactions, skippedLines } = parseStatement(readFileSync(f, 'utf8'));
    const { added, duplicates } = insertTransactions(db, transactions, categorise);
    console.log(`${f}: ${added} new, ${duplicates} already imported` +
      (skippedLines.length ? `, skipped lines ${skippedLines.join(', ')}` : ''));
  } catch (e) {
    console.error(`${f}: ${e.message}`);
    process.exitCode = 1;
  }
}
