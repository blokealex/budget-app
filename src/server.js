// Local web app: http://localhost:3000
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { parseStatement } from './csv.js';
import { openDb, insertTransactions, recategoriseAll, setCategory, months } from './db.js';
import { loadBudgets, makeCategoriser, addRule, addCategory } from './config.js';
import { monthReport } from './report.js';
import { findRegularPayments } from './recurring.js';

const PORT = Number(process.env.PORT ?? 3000);
const db = openDb();
// Read on every request so page changes show up with a browser refresh.
const page = () => readFileSync(new URL('./page.html', import.meta.url), 'utf8');

const currentMonth = () => new Date().toISOString().slice(0, 7);

function readBody(req, limit = 5_000_000) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { fail(new Error('File too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page(), 'text/html; charset=utf-8');

    if (req.method === 'GET' && url.pathname === '/api/report') {
      const month = url.searchParams.get('month') ?? months(db)[0] ?? currentMonth();
      const budgets = loadBudgets();
      // Every category ever used, so ones you've created (e.g. "Work") are available in every month.
      const used = db.prepare('SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL').all().map(r => r.category);
      const report = monthReport(db, month, budgets, new Date(), used);
      const cats = new Set([...(budgets._categories ?? []), ...Object.keys(budgets).filter(k => !k.startsWith('_')), ...used]);
      ['Income', 'Transfers', 'Uncategorised'].forEach(c => cats.add(c));
      return send(res, 200, { ...report, months: months(db), allCategories: [...cats].sort(),
        regular: findRegularPayments(db) });
    }

    if (req.method === 'POST' && url.pathname === '/api/import') {
      const { transactions, skippedLines } = parseStatement(await readBody(req));
      const result = insertTransactions(db, transactions, makeCategoriser());
      const latest = transactions.map(t => t.date).sort().at(-1).slice(0, 7);
      return send(res, 200, { ...result, skippedLines, latestMonth: latest });
    }

    if (req.method === 'POST' && url.pathname === '/api/category') {
      const { id, category, rule, ruleAmount } = JSON.parse(await readBody(req));
      if (!category?.trim()) return send(res, 400, { error: 'Category required' });
      if (rule?.trim()) {
        // "Always categorise things like this" — save a rule and apply it everywhere.
        addRule(rule.trim(), category.trim(), ruleAmount);
        recategoriseAll(db, makeCategoriser());
      }
      if (id) setCategory(db, id, category.trim());
      addCategory(category.trim()); // remember new categories even if no transaction uses them later
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

// Bound to localhost only: your financial data never leaves your machine.
server.listen(PORT, '127.0.0.1', () => console.log(`Budget app running at http://localhost:${PORT}`));
