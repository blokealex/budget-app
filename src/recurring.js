import { isGeneric } from './config.js';

// Works out your real regular payments (direct debits, standing orders,
// subscriptions) from transaction history, so the app shows what is actually
// going out rather than what a spreadsheet says should be.

// "SKY DIGITAL 4412345678" and "SKY DIGITAL 4412349999" are the same payee.
export function normalise(description) {
  return description.toUpperCase()
    .replace(/[^A-Z0-9&' ]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !/\d/.test(w))   // drop reference numbers, dates, store numbers
    .slice(0, 3)
    .join(' ');
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const monthIndex = ym => { const [y, m] = ym.split('-').map(Number); return y * 12 + m; };

export function findRegularPayments(db) {
  const rows = db.prepare(`SELECT id, date, description, amount, category
    FROM transactions WHERE amount < 0 AND category != 'Transfers' ORDER BY date, id`).all();
  if (!rows.length) return { payments: [], monthlyTotal: 0, latestMonth: null };
  const latestMonth = rows.at(-1).date.slice(0, 7);

  const groups = new Map();
  for (const r of rows) {
    let key = normalise(r.description);
    if (!key) continue;
    // "GOCARDLESS DD" could be anyone: tell them apart by amount.
    if (isGeneric(r.description)) key += ' ' + (-r.amount / 100).toFixed(2);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const payments = [];
  for (const [key, txs] of groups) {
    const months = new Set(txs.map(t => t.date.slice(0, 7)));
    if (months.size < 3) continue;                       // needs a pattern
    const amounts = txs.map(t => -t.amount);
    const perMonth = Math.round(txs.length / months.size);
    const sameAmount = amounts.every(a => a === amounts[0]);
    // Weekly shop etc. isn't a bill, but two identical subs on the same day can be.
    if (txs.length / months.size > 1.5 && !(sameAmount && perMonth <= 3)) continue;
    const usual = median(amounts);
    const similar = amounts.filter(a => Math.abs(a - usual) <= Math.max(200, usual * 0.25)).length;
    if (similar / amounts.length < 0.7) continue;        // amounts all over the place: not a bill

    const last = txs.at(-1), prev = txs.at(-2);
    const lastAmount = -last.amount, prevAmount = -prev.amount;
    const gap = monthIndex(latestMonth) - monthIndex(last.date.slice(0, 7));
    const firstSeen = txs[0].date.slice(0, 7);
    // Two identical payments a month (e.g. two kids' subs) aren't a price change.
    const change = perMonth > 1 ? 0 : lastAmount - prevAmount;

    let status = 'ok';
    if (gap >= 2) status = 'stopped';
    else if (monthIndex(latestMonth) - monthIndex(firstSeen) <= 3) status = 'new';
    else if (Math.abs(change) >= 100 && Math.abs(change) >= prevAmount * 0.02) status = change > 0 ? 'up' : 'down';

    payments.push({
      key, name: last.description, category: last.category,
      usual, last: lastAmount * Math.max(1, perMonth), perMonth: Math.max(1, perMonth),
      change, lastDate: last.date,
      day: median(txs.map(t => Number(t.date.slice(8, 10)))),
      monthsSeen: months.size, firstSeen, status,
    });
  }

  payments.sort((a, b) => (a.status === 'stopped') - (b.status === 'stopped') || b.usual - a.usual);
  const monthlyTotal = payments.filter(p => p.status !== 'stopped').reduce((n, p) => n + p.last, 0);
  return { payments, monthlyTotal, latestMonth };
}
