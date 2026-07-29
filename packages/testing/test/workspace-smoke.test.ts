import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('workspace packages resolve through public ESM exports', async () => {
  const modules = await Promise.all([
    import('@codeclosure/domain'),
    import('@codeclosure/runtime'),
  ]);

  assert.equal(modules.length, 2);
});

void test('[I-001][I-003][I-007] CLI declares the trusted production Store package root', () => {
  const packageJson: unknown = JSON.parse(
    readFileSync(new URL('../../../apps/cli/package.json', import.meta.url), 'utf8'),
  );
  assert.ok(typeof packageJson === 'object' && packageJson !== null);
  assert.ok('dependencies' in packageJson);
  const dependencies = packageJson.dependencies;
  assert.ok(typeof dependencies === 'object' && dependencies !== null);
  assert.equal('@codeclosure/runtime' in dependencies, true);
  assert.equal('@codeclosure/store-sqlite' in dependencies, true);
});
