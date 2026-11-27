import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Catches a syntax error in the dashboard's script before it reaches the browser.
test('dashboard script parses', () => {
  const html = readFileSync(new URL('../src/page.html', import.meta.url), 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'page has a <script> block');
  assert.doesNotThrow(() => new Function(m[1]));
});
