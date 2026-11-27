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

export function addRule(match, category) {
  const rules = loadRules();
  rules.unshift({ match, category }); // newest rule wins
  writeFileSync(RULES, JSON.stringify(rules, null, 2) + '\n');
}

// First rule whose text appears in the description wins.
// Money in with no matching rule is "Income"; money out is "Uncategorised".
export function makeCategoriser(rules = loadRules()) {
  const compiled = rules.map(r => ({ needle: r.match.toUpperCase(), category: r.category }));
  return ({ description, amount }) => {
    const d = description.toUpperCase();
    const hit = compiled.find(r => d.includes(r.needle));
    if (hit) return hit.category;
    return amount > 0 ? 'Income' : 'Uncategorised';
  };
}
