// Loads your categorisation rules and monthly budgets from config/*.json.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RULES = resolve('config/rules.json');
const BUDGETS = resolve('config/budgets.json');

// Your real config files are git-ignored so personal figures never reach GitHub.
// On first run they're created from the committed *.example.json versions.
function ensure(path) {
  if (!existsSync(path)) copyFileSync(path.replace(/\.json$/, '.example.json'), path);
  return path;
}

export const loadRules = () => JSON.parse(readFileSync(ensure(RULES), 'utf8'));
export const loadBudgets = () => JSON.parse(readFileSync(ensure(BUDGETS), 'utf8'));

// amount (optional, pounds) narrows a rule to one exact payment amount.
// Needed for payments like "GOCARDLESS DD" where the description alone
// doesn't say who it's for.
export function addRule(match, category, amount) {
  const rules = loadRules();
  const rule = { match, category };
  if (amount != null && amount !== '') rule.amount = Number(amount);
  rules.unshift(rule); // newest rule wins
  writeFileSync(RULES, JSON.stringify(rules, null, 2) + '\n');
}

// Adds a category you created in the app to budgets.json's _categories list.
const SYSTEM = new Set(['Income', 'Transfers', 'Uncategorised']);
export function addCategory(name) {
  if (SYSTEM.has(name)) return;
  const budgets = loadBudgets();
  budgets._categories ??= [];
  if (budgets._categories.includes(name)) return;
  budgets._categories.push(name);
  writeFileSync(BUDGETS, JSON.stringify(budgets, null, 2) + '\n');
}

// First rule whose text appears in the description wins.
// Money in with no matching rule is "Income"; money out is "Uncategorised".
export function makeCategoriser(rules = loadRules()) {
  const compiled = rules.map(r => ({
    needle: r.match.toUpperCase(), category: r.category,
    pence: r.amount != null ? Math.round(Math.abs(r.amount) * 100) : null,
  }));
  return ({ description, amount }) => {
    const d = description.toUpperCase();
    const hit = compiled.find(r => d.includes(r.needle) && (r.pence == null || r.pence === Math.abs(amount)));
    if (hit) return hit.category;
    return amount > 0 ? 'Income' : 'Uncategorised';
  };
}

// Descriptions that don't identify who was paid; the amount has to.
export const GENERIC_PAYEES = ['GOCARDLESS', 'PAYPAL', 'STRIPE', 'SUMUP', 'SQUARE'];
export const isGeneric = description => GENERIC_PAYEES.some(g => description.toUpperCase().includes(g));
