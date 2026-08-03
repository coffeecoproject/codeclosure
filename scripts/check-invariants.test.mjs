import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  auditInvariantCoverage,
  buildInvariantCoverage,
  collectTestMetadataFromSource,
  parseInvariantCatalog,
} from './check-invariants-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

void test('invariant catalog and executable test metadata produce exact coverage', () => {
  const catalog = parseInvariantCatalog(`
### I-001 — First rule

Text.

### I-002 — Second rule
`);
  const metadata = collectTestMetadataFromSource(
    `
import test from 'node:test';
void test('[I-001] first proof', () => {});
void test(\`[I-002] dynamic proof \${fixture}\`, () => {});
`,
    '/fixture/proof.test.ts',
  );
  const report = buildInvariantCoverage(catalog, metadata.executable);

  assert.deepEqual(
    catalog.map((entry) => entry.id),
    ['I-001', 'I-002'],
  );
  assert.deepEqual(report.violations, []);
  assert.equal(report.coverage.get('I-001')?.length, 1);
  assert.equal(report.coverage.get('I-002')?.length, 1);
});

void test('skipped, todo, focused, and conditional tests cannot supply executable metadata', () => {
  const metadata = collectTestMetadataFromSource(
    `
import test from 'node:test';
test.skip('[I-001] skipped', () => {});
test.todo('[I-001] todo');
test.only('[I-001] focused', () => {});
test('[I-001] conditional', { skip: true }, () => {});
`,
    '/fixture/controlled.test.ts',
  );
  assert.deepEqual(metadata.executable, []);
  assert.deepEqual(
    metadata.controls.map((control) => control.kind),
    ['NON_EXECUTABLE', 'NON_EXECUTABLE', 'FOCUSED', 'skip'],
  );
});

void test('coverage fails closed on missing, unknown, and malformed invariant tags', () => {
  const catalog = parseInvariantCatalog('### I-001 — Only rule\n');
  const metadata = collectTestMetadataFromSource(
    `
import test from 'node:test';
test('[I-002][I-2] wrong metadata', () => {});
`,
    '/fixture/wrong.test.ts',
  );
  const report = buildInvariantCoverage(catalog, metadata.executable);
  assert.ok(report.violations.some((item) => item.includes('unknown invariant tag I-002')));
  assert.ok(report.violations.some((item) => item.includes('malformed invariant tag I-2')));
  assert.ok(report.violations.some((item) => item.includes('I-001 has no executable')));
});

void test('the repository has executable metadata for every runtime invariant', () => {
  const audit = auditInvariantCoverage(repositoryRoot);
  assert.equal(audit.catalog.length, 32);
  assert.deepEqual(audit.violations, []);
});
