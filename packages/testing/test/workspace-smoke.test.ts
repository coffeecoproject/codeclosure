import assert from 'node:assert/strict';
import test from 'node:test';

void test('workspace packages resolve through public ESM exports', async () => {
  const modules = await Promise.all([
    import('@codeclosure/domain'),
    import('@codeclosure/runtime'),
  ]);

  assert.equal(modules.length, 2);
});
