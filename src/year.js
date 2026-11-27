// Year-to-date view: totals and month-by-month spend per category over a period.

const ym = d => d.slice(0, 7);
const pad = n => String(n).padStart(2, '0');

// Period boundaries as YYYY-MM-DD (inclusive from, exclusive to).
export function periodRange(period, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth() + 1, d = today.getDate();
  const tomorrow = new Date(y, m - 1, d + 1);
  const to = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  if (period === 'tax') {
    // UK tax year starts on 6 April.
    const startYear = (m > 4 || (m === 4 && d >= 6)) ? y : y - 1;
    return { from: `${startYear}-04-06`, to, label: `Tax year ${startYear}/${String(startYear + 1).slice(2)} so far` };
  }
  if (period === 'last12') {
    const start = new Date(y, m - 12, 1);
    return { from: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`, to, label: 'Last 12 months' };
  }
  return { from: `${y}-01-01`, to, label: `${y} so far` };
}

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const end = ym(to);
  while (`${y}-${pad(m)}` <= end) {
    out.push(`${y}-${pad(m)}`);
    m++; if (m === 13) { m = 1; y++; }
  }
  // "to" is exclusive; drop its month if the period ends on the 1st.
  if (to.endsWith('-01') && out.at(-1) === ym(to)) out.pop();
  return out;
}

export function yearReport(db, period, budgets, knownCategories = [], today = new Date()) {
  const { from, to, label } = periodRange(period, today);
  const months = monthsBetween(from, to);
  const rows = db.prepare(`SELECT substr(date,1,7) AS m, category, SUM(amount) AS total
    FROM transactions WHERE date >= ? AND date < ? GROUP BY m, category`).all(from, to);

  const income = Object.fromEntries(months.map(m => [m, 0]));
  const spent = Object.fromEntries(months.map(m => [m, 0]));
  const byCat = new Map();
  for (const r of rows) {
    if (r.category === 'Transfers') continue;
    if (r.category === 'Income') { income[r.m] += r.total; continue; }
    spent[r.m] -= r.total;
    if (!byCat.has(r.category)) byCat.set(r.category, {});
    byCat.get(r.category)[r.m] = -r.total;
  }

  // Average over months that actually have transactions, so a part-imported
  // period doesn't drag the average down.
  const dataMonths = months.filter(m => income[m] !== 0 || spent[m] !== 0);
  const n = Math.max(dataMonths.length, 1);

  const order = budgets._categories ?? [];
  const targets = Object.fromEntries(Object.entries(budgets).filter(([k, v]) => !k.startsWith('_') && typeof v === 'number'));
  const names = new Set([...order, ...Object.keys(targets), ...knownCategories, ...byCat.keys()]);
  ['Income', 'Transfers'].forEach(x => names.delete(x));

  const categories = [...names].map(name => {
    const byMonth = byCat.get(name) ?? {};
    const total = Object.values(byMonth).reduce((a, b) => a + b, 0);
    const target = targets[name] != null ? Math.round(targets[name] * 100) : null;
    return { name, byMonth, total, avg: Math.round(total / n),
             target, targetTotal: target == null ? null : target * n };
  }).filter(c => c.total !== 0 || order.includes(c.name) || c.target != null)
    .sort((a, b) => (b.target != null) - (a.target != null)
      || (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99)
      || b.total - a.total);

  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  return {
    period, label, from, to, months, dataMonths, income, spent, categories,
    totals: { income: sum(income), spent: sum(spent), net: sum(income) - sum(spent),
              avgIncome: Math.round(sum(income) / n), avgSpent: Math.round(sum(spent) / n) },
  };
}
