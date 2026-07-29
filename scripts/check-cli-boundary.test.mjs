import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { checkCliBoundary, findCliBoundaryViolationsInSource } from './check-cli-boundary-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const handlerFixturePath = resolve(repositoryRoot, 'apps/cli/src/commands/fixture.ts');
const compositionFixturePath = resolve(repositoryRoot, 'apps/cli/src/composition/fixture.ts');
const entryPointFixturePath = resolve(repositoryRoot, 'apps/cli/src/index.ts');

function violations(source, filePath = handlerFixturePath) {
  return findCliBoundaryViolationsInSource(source, filePath, repositoryRoot);
}

void test('CLI boundary accepts only narrow public Runtime capability imports', () => {
  assert.deepEqual(
    violations(
      "import { RuntimeErrorCode, type CodeClosureApplication } from '@codeclosure/runtime';",
    ),
    [],
  );
  assert.deepEqual(checkCliBoundary(repositoryRoot), []);
});

void test('CLI boundary rejects Store, testing, composition, and internal path imports', () => {
  const forbidden = [
    "import { openSqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { WorkflowRuntimeKernel } from '@codeclosure/runtime/testing/workflow-runtime';",
    "import { createWorkflowDriver } from '@codeclosure/runtime/composition';",
    "import { FakeWorker } from '@codeclosure/testing';",
    "import { WorkflowRuntimeKernel } from '../../../../packages/runtime/src/workflow-runtime.js';",
  ];
  for (const source of forbidden) {
    assert.equal(violations(source).length, 1, source);
  }
});

void test('CLI boundary rejects non-facade Runtime names and namespace or dynamic bypasses', () => {
  const forbidden = [
    "import * as runtime from '@codeclosure/runtime';",
    "import type { WorkflowControlStore } from '@codeclosure/runtime';",
    "import { CanonicalJsonSha256DigestProvider } from '@codeclosure/runtime';",
    "import { createCodeClosureApplication as createApp } from '@codeclosure/runtime';",
    "export * from '@codeclosure/runtime';",
    "const module = await import('@codeclosure/runtime/testing/workflow-runtime');",
    "const store = require('@codeclosure/store-sqlite');",
    "type Store = import('@codeclosure/runtime').WorkflowControlStore;",
  ];
  for (const source of forbidden) {
    assert.equal(violations(source).length, 1, source);
  }
});

void test('trusted composition may use explicit package exports needed to construct the facade', () => {
  const source = [
    "import { createCodeClosureApplication } from '@codeclosure/runtime';",
    "import { createWorkflowDriver } from '@codeclosure/runtime/composition';",
    "import { openVerifiedSqliteControlStore, type SqliteAuthorityIsolationSnapshot } from '@codeclosure/store-sqlite';",
    "import { FakeWorker } from '@codeclosure/testing';",
  ].join('\n');
  assert.deepEqual(violations(source, compositionFixturePath), []);
});

void test('trusted production composition rejects raw or alternate Store open paths', () => {
  const forbidden = [
    "import { openSqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { SqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { applyMigrations } from '@codeclosure/store-sqlite';",
  ];
  for (const source of forbidden) {
    assert.equal(violations(source, compositionFixturePath).length, 1, source);
  }
});

void test('trusted production composition accepts only the closed M1 Fake registry', () => {
  assert.deepEqual(
    violations(
      "import { FakeCandidateSource, FakeVerificationRunner, FakeWorker, M1FakeExecutionProfileName, m1FakeExecutionProfileRecipe, m1FakeExecutionProfileRecipes } from '@codeclosure/testing';",
      compositionFixturePath,
    ),
    [],
  );
  assert.equal(
    violations("import { DeterministicIds } from '@codeclosure/testing';", compositionFixturePath)
      .length,
    1,
  );
});

void test('trusted composition cannot use internal subpaths, implicit imports, or re-export control capabilities', () => {
  const forbidden = [
    "import { WorkflowRuntimeKernel } from '@codeclosure/runtime/testing/workflow-runtime';",
    "import { openSqliteControlStore } from '@codeclosure/store-sqlite/internal';",
    "import * as store from '@codeclosure/store-sqlite';",
    "const store = await import('@codeclosure/store-sqlite');",
    "export { openSqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { openVerifiedSqliteControlStore } from '@codeclosure/store-sqlite'; export { openVerifiedSqliteControlStore };",
    "import { WorkflowRuntimeKernel } from '../../../../packages/runtime/src/workflow-runtime.js';",
  ];
  for (const source of forbidden) {
    assert.equal(violations(source, compositionFixturePath).length, 1, source);
  }
});

void test('only the CLI entry point may invoke the local trusted composition module', () => {
  const source = "import { createCliComposition } from '../composition/index.js';";
  assert.equal(violations(source).length, 1);
  assert.deepEqual(
    violations(
      "import { createCliComposition } from './composition/index.js';",
      entryPointFixturePath,
    ),
    [],
  );
  assert.equal(
    violations(
      "import { openCliSqliteAuthority } from './composition/sqlite-authority.js';",
      entryPointFixturePath,
    ).length,
    1,
  );
  assert.equal(
    violations("export * from './composition/index.js';", entryPointFixturePath).length,
    1,
  );
});
