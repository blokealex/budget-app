// One month: targets (e.g. Food) vs actual, and for everything else,
// this month vs what you usually spend.
import { monthTransactions } from './db.js';

const NON_SPEND = new Set(['Income', 'Transfers']);

function previousMonths(month, n) {
  let [y, m] = month.split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    m--; if (m === 0) { m = 12; y--; }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

// Average monthly net spend per category over the previous 3 months that have data.
function usualSpend(db, month) {
  const prev = previousMonths(month, 3);
  const rows = db.prepare(`SELECT substr(date,1,7) AS m, category, -SUM(amount) AS spent
    FROM live WHERE substr(date,1,7) IN (?, ?, ?)
    GROUP BY m, category`).all(...prev);
  const monthsWithData = new Set(rows.map(r => r.m)).size;
  const usual = new Map();
  if (!monthsWithData) return usual;
  for (const r of rows) usual.set(r.category, (usual.get(r.category) ?? 0) + r.spent);
  for (const [k, v] of usual) usual.set(k, Math.round(v / monthsWithData));
  return usual;
}

export function monthReport(db, month, budgets, today = new Date(), knownCategories = []) {
  const txs = monthTransactions(db, month);
  const spent = new Map();
  let income = 0, totalOut = 0;
  for (const t of txs) {
    if (t.category === 'Transfers') continue;
    if (t.category === 'Income') { income += t.amount; continue; }
    // Net per category, so a refund reduces that category's spend.
    spent.set(t.category, (spent.get(t.category) ?? 0) - t.amount);
    totalOut -= t.amount;
  }

  const order = budgets._categories ?? [];
  const targets = Object.fromEntries(Object.entries(budgets).filter(([k, v]) => !k.startsWith('_') && typeof v === 'number'));
  const names = new Set([...order, ...Object.keys(targets), ...knownCategories.filter(c => c !== 'Uncategorised'), ...spent.keys()]);
  const usual = usualSpend(db, month);

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrent = today.getFullYear() === y && today.getMonth() + 1 === m;
  const fractionGone = isCurrent ? today.getDate() / daysInMonth : 1;

  const categories = [...names].filter(n => !NON_SPEND.has(n)).map(name => {
    const target = targets[name] != null ? Math.round(targets[name] * 100) : null;
    const s = spent.get(name) ?? 0;
    let status = 'none';
    if (target != null) {
      if (s > target) status = 'over';
      else if (isCurrent && s > target * fractionGone * 1.1) status = 'ahead'; // spending faster than the month is passing
      else status = 'ok';
    }
    return { name, spent: s, target, remaining: target == null ? null : target - s,
             usual: usual.get(name) ?? null, status };
  }).sort((a, b) => (b.target != null) - (a.target != null)
      || (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99)
      || b.spent - a.spent);

  return { month, isCurrent, fractionGone, income, totalOut, net: income - totalOut, categories, transactions: txs };
}
