// Parses bank CSV exports (built for HSBC UK, tolerant of other layouts).
// HSBC's download is typically: Date, Description, Amount  (no header,
// DD/MM/YYYY dates, amounts like "-1,234.56"). Some exports instead have a
// header with separate "Paid in" / "Paid out" columns — both are handled.

export function parseCsvText(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

export function parseAmount(s) {
  if (s == null) return null;
  let t = String(s).trim().replace(/[£,\s]/g, '');
  if (t === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); } // (12.34)
  if (/DR$/i.test(t)) { neg = true; t = t.slice(0, -2); }
  if (/CR$/i.test(t)) t = t.slice(0, -2);
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  // Store money as integer pence to avoid floating-point drift.
  return Math.round((neg ? -n : n) * 100);
}

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

export function parseDate(s) {
  const t = String(s).trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // DD/MM/YYYY (UK)
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return iso(+y, +mo, +d);
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); // YYYY-MM-DD
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[A-Za-z]*[\s\-](\d{2,4})$/); // 05 Nov 2026
  if (m && MONTHS[m[2].toLowerCase()]) {
    let y = m[3].length === 2 ? '20' + m[3] : m[3];
    return iso(+y, MONTHS[m[2].toLowerCase()], +m[1]);
  }
  return null;
}

function iso(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Turns CSV text into [{ date, description, amount }] (amount in pence,
// negative = money out). Throws if no rows could be understood.
export function parseStatement(text) {
  const rows = parseCsvText(text);
  if (!rows.length) throw new Error('The file is empty.');

  let cols = { date: 0, desc: 1, amount: 2, paidIn: -1, paidOut: -1 };
  let start = 0;
  const header = rows[0].map(h => h.trim().toLowerCase());
  if (parseDate(rows[0][0]) === null && header.some(h => h.includes('date'))) {
    start = 1;
    const find = (...keys) => header.findIndex(h => keys.some(k => h.includes(k)));
    cols = {
      date: find('date'),
      desc: find('description', 'details', 'narrative', 'payee', 'name', 'memo'),
      // midata (HSBC's 12-month download) uses one signed "Debit/Credit" column.
      amount: find('amount', 'value', 'debit/credit'),
      paidIn: find('paid in', 'credit', 'money in'),
      paidOut: find('paid out', 'debit', 'money out'),
    };
    // A single signed column must not also be read as separate in/out columns.
    if (cols.amount !== -1) {
      if (cols.paidIn === cols.amount) cols.paidIn = -1;
      if (cols.paidOut === cols.amount) cols.paidOut = -1;
    }
    if (cols.desc === -1) cols.desc = 1;
  }

  const out = [], skipped = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDate(r[cols.date] ?? '');
    let amount = null;
    if (cols.amount !== -1) amount = parseAmount(r[cols.amount]);
    if (amount === null && (cols.paidIn !== -1 || cols.paidOut !== -1)) {
      const pin = parseAmount(r[cols.paidIn]) ?? 0;
      const pout = parseAmount(r[cols.paidOut]) ?? 0;
      if (pin || pout) amount = pin - Math.abs(pout);
    }
    const description = (r[cols.desc] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || amount === null) { skipped.push(i + 1); continue; }
    out.push({ date, description, amount });
  }
  if (!out.length) throw new Error("Couldn't find any transactions — is this a CSV export from online banking?");
  return { transactions: out, skippedLines: skipped };
}
