import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStatement, parseAmount, parseDate } from '../src/csv.js';
import { openDb, insertTransactions } from '../src/db.js';
import { makeCategoriser } from '../src/config.js';
import { monthReport } from '../src/report.js';

test('amounts in pence', () => {
  assert.equal(parseAmount('"2,350.00"'.replace(/"/g, '')), 235000);
  assert.equal(parseAmount('-0.1'), -10);
  assert.equal(parseAmount('12.34 DR'), -1234);
  assert.equal(parseDate('05/11/2026'), '2026-11-05');
});

test('import, dedupe, report', () => {
  const csv = readFileSync(new URL('./sample-hsbc.csv', import.meta.url), 'utf8');
  const { transactions } = parseStatement(csv);
  assert.equal(transactions.length, 12);
  const db = openDb(':memory:');
  const cat = makeCategoriser([
    { match: 'TESCO', category: 'Groceries' },
    { match: 'AMZN', category: 'Shopping' },
  ]);
  assert.deepEqual(insertTransactions(db, transactions, cat), { added: 12, duplicates: 0, filled: 0 });
  assert.deepEqual(insertTransactions(db, transactions, cat), { added: 0, duplicates: 12, filled: 0 }); // re-import safe
  const r = monthReport(db, '2026-11', { Groceries: 350, Shopping: 50 }, new Date(2026, 10, 26));
  const g = r.categories.find(c => c.name === 'Groceries');
  assert.equal(g.spent, 13028);
  const s = r.categories.find(c => c.name === 'Shopping');
  assert.equal(s.spent, 5299);          // refund netted off
  assert.equal(s.status, 'over');
  assert.equal(r.income, 235000);
});

test('header with paid in / paid out columns', () => {
  const { transactions } = parseStatement('Date,Description,Paid out,Paid in\n01/11/2026,TESCO,10.00,\n02/11/2026,PAY,,100.00\n');
  assert.deepEqual(transactions.map(t => t.amount), [-1000, 10000]);
});

test('HSBC midata export (signed Debit/Credit column, £ signs, balance)', () => {
  const csv = 'Date,Type,Merchant/Description,Debit/Credit,Balance\n' +
    '27/11/2026,VIS,TESCO STORES 3297,-£42.18,"£1,203.55"\n' +
    '26/11/2026,CR,SALARY ACME,"£2,350.00","£1,245.73"\n' +
    '25/11/2026,DD,BRITISH GAS,£-220.00,£-1104.27\n' +
    '\n' +
    'Arranged overdraft limit,27/11/2026,£500.00\n';
  const { transactions } = parseStatement(csv);
  assert.deepEqual(transactions.map(t => [t.date, t.description, t.amount]), [
    ['2026-11-27', 'TESCO STORES 3297', -4218],
    ['2026-11-26', 'SALARY ACME', 235000],
    ['2026-11-25', 'BRITISH GAS', -22000],
  ]);
});

test('regular payments: finds bills, ignores the weekly shop, spots changes', async () => {
  const { findRegularPayments } = await import('../src/recurring.js');
  const db = openDb(':memory:');
  const tx = [];
  const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  months.forEach((m, i) => {
    tx.push({ date: `${m}-01`, description: 'SKY DIGITAL 44123' + i, amount: i < 5 ? -10100 : -10800 }); // went up
    tx.push({ date: `${m}-07`, description: 'MANCHESTER CC COUNCIL TAX', amount: -15000 });
    for (const d of ['03', '10', '17', '24']) tx.push({ date: `${m}-${d}`, description: 'TESCO STORES 3297', amount: -4000 - i });
  });
  ['2026-06', '2026-07', '2026-08'].forEach(m => tx.push({ date: `${m}-15`, description: 'OLD GYM', amount: -3000 }));
  insertTransactions(db, tx, () => 'Uncategorised');
  const { payments } = findRegularPayments(db);
  const by = Object.fromEntries(payments.map(p => [p.key, p]));
  assert.equal(by['SKY DIGITAL'].status, 'up');
  assert.equal(by['SKY DIGITAL'].change, 700);
  assert.equal(by['MANCHESTER CC COUNCIL'].status, 'ok');
  assert.equal(by['MANCHESTER CC COUNCIL'].day, 7);
  assert.equal(by['OLD GYM'].status, 'stopped');
  assert.equal(by['TESCO STORES'], undefined); // weekly shop isn't a bill
});

test('GoCardless: rules by amount, and two identical subs count as one regular line', async () => {
  const { findRegularPayments } = await import('../src/recurring.js');
  const cat = makeCategoriser([
    { match: 'GOCARDLESS DD', category: 'Kids', amount: 13 },
    { match: 'GOCARDLESS DD', category: 'Self Care', amount: 30 },
  ]);
  assert.equal(cat({ description: 'GOCARDLESS DD', amount: -1300 }), 'Kids');
  assert.equal(cat({ description: 'GOCARDLESS DD', amount: -3000 }), 'Self Care');
  assert.equal(cat({ description: 'GOCARDLESS DD', amount: -999 }), 'Uncategorised');

  const db = openDb(':memory:');
  const tx = [];
  for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    tx.push({ date: `${m}-05`, description: 'GOCARDLESS DD', amount: -1300 });
    tx.push({ date: `${m}-05`, description: 'GOCARDLESS DD', amount: -1300 });
    tx.push({ date: `${m}-01`, description: 'GOCARDLESS DD', amount: -3000 });
  }
  insertTransactions(db, tx, cat);
  const { payments } = findRegularPayments(db);
  const subs = payments.find(p => p.key === 'GOCARDLESS DD 13.00');
  assert.equal(subs.perMonth, 2);
  assert.equal(subs.last, 2600);
  assert.equal(subs.category, 'Kids');
  assert.ok(payments.find(p => p.key === 'GOCARDLESS DD 30.00'));
});

test('masked midata rows get filled in from a normal CSV instead of duplicated', () => {
  const db = openDb(':memory:');
  const cat = makeCategoriser([{ match: 'NETFLIX', category: 'Entertainment' }]);
  // midata: two masked lines, one normal
  insertTransactions(db, [
    { date: '2026-09-03', description: '******', amount: -1799 },
    { date: '2026-09-03', description: '******', amount: -1799 },
    { date: '2026-09-04', description: 'TESCO STORES', amount: -4218 },
  ], cat);
  // normal CSV covering the same days
  const r = insertTransactions(db, [
    { date: '2026-09-03', description: 'NETFLIX.COM', amount: -1799 },
    { date: '2026-09-03', description: 'DISNEY PLUS', amount: -1799 },
    { date: '2026-09-04', description: 'TESCO STORES 3297 MANCHESTER', amount: -4218 },
  ], cat);
  assert.equal(r.filled, 2);
  const rows = db.prepare('SELECT description, category FROM live ORDER BY id').all();
  assert.deepEqual(rows.map(x => x.description), ['NETFLIX.COM', 'DISNEY PLUS', 'TESCO STORES', 'TESCO STORES 3297 MANCHESTER']);
  assert.equal(rows[0].category, 'Entertainment');
  // Re-importing either file again changes nothing.
  assert.equal(insertTransactions(db, [{ date: '2026-09-03', description: 'NETFLIX.COM', amount: -1799 }], cat).duplicates, 1);
  assert.equal(insertTransactions(db, [{ date: '2026-09-03', description: '******', amount: -1799 }], cat).duplicates, 1);
});

test('delete, undo, duplicates review', async () => {
  const { deleteTransaction, restoreTransaction, possibleDuplicates, markNotDuplicates } = await import('../src/db.js');
  const db = openDb(':memory:');
  insertTransactions(db, [
    { date: '2026-09-04', description: 'TESCO STORES', amount: -4218 },
    { date: '2026-09-04', description: 'TESCO STORES 3297 MANCHESTER', amount: -4218 },
    { date: '2026-09-05', description: 'GOCARDLESS DD', amount: -1300 },
    { date: '2026-09-05', description: 'GOCARDLESS DD', amount: -1300 },
  ], () => 'Food');
  assert.equal(possibleDuplicates(db).length, 2);
  markNotDuplicates(db, '2026-09-05', -1300);           // the two Beavers subs
  const [g] = possibleDuplicates(db);
  assert.equal(g.transactions.length, 2);
  deleteTransaction(db, g.transactions[0].id);
  assert.equal(possibleDuplicates(db).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM live').get().n, 3);
  // A deleted row doesn't come back when the same statement is imported again.
  assert.equal(insertTransactions(db, [{ date: '2026-09-04', description: 'TESCO STORES', amount: -4218 }], () => 'Food').duplicates, 1);
  restoreTransaction(db, g.transactions[0].id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM live').get().n, 4);
});
