import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  auditPackageDependencies,
  collectModuleSpecifiers,
  importViolation,
  m25CodexIntakeAdapterAllowedNodeBuiltins,
  m25CodexIntakeAdapterDependencyExpectation,
  m25CodexIntakeAdapterImportViolation,
  modulePackageName,
  parsePnpmLockImporters,
} from './check-dependencies-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

void test('module scanning finds static imports, exports, dynamic imports, require, and import types', () => {
  const specifiers = collectModuleSpecifiers(
    `
import value from '@scope/package/subpath';
export { item } from 'exported-package';
const dynamic = import('dynamic-package');
const required = require('required-package');
type Imported = import('typed-package').Value;
void value; void dynamic; void required;
`,
    '/fixture/source.ts',
  );
  assert.deepEqual(specifiers, [
    '@scope/package/subpath',
    'dynamic-package',
    'exported-package',
    'required-package',
    'typed-package',
  ]);
  assert.equal(modulePackageName('@scope/package/subpath'), '@scope/package');
  assert.equal(modulePackageName('package/subpath'), 'package');
});

void test('pnpm lock importer parsing retains direct specifiers and resolved versions', () => {
  const importers = parsePnpmLockImporters(`
lockfileVersion: '9.0'

importers:

  packages/example:
    dependencies:
      '@scope/dependency':
        specifier: 1.2.3
        version: 1.2.3(peer@4.5.6)

packages:
`);
  assert.deepEqual(importers.get('packages/example')?.dependencies.get('@scope/dependency'), {
    specifier: '1.2.3',
    version: '1.2.3(peer@4.5.6)',
  });
  const emptyImporters = parsePnpmLockImporters(`
lockfileVersion: '9.0'

importers:

  packages/empty: {}

packages:
`);
  assert.deepEqual(emptyImporters.get('packages/empty'), {
    dependencies: new Map(),
    devDependencies: new Map(),
  });
});

void test('the current manifest, lockfile, and actual source dependency graph are closed', () => {
  const audit = auditPackageDependencies(repositoryRoot);
  assert.equal(audit.packageCount, 10);
  assert.deepEqual(audit.violations, []);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/adapter-codex'), [
    '@codeclosure/codex-app-server-client',
    '@codeclosure/runtime',
  ]);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/codex-app-server-client'), []);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/adapter-codex-intake'), [
    '@codeclosure/codex-app-server-client',
    '@codeclosure/runtime',
  ]);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/domain'), ['zod']);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/runtime'), [
    '@codeclosure/domain',
    'zod',
  ]);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/workspace-local'), [
    '@codeclosure/runtime',
  ]);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/verification-local'), [
    '@codeclosure/runtime',
  ]);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/store-sqlite'), [
    '@codeclosure/domain',
    '@codeclosure/runtime',
    'better-sqlite3',
    'zod',
  ]);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/testing'), [
    '@codeclosure/domain',
    '@codeclosure/runtime',
  ]);
  assert.deepEqual(audit.productionGraph.get('@codeclosure/cli'), [
    '@codeclosure/adapter-codex',
    '@codeclosure/adapter-codex-intake',
    '@codeclosure/codex-app-server-client',
    '@codeclosure/domain',
    '@codeclosure/runtime',
    '@codeclosure/store-sqlite',
    '@codeclosure/testing',
    '@codeclosure/verification-local',
    '@codeclosure/workspace-local',
    'zod',
  ]);
});

void test('the lower App Server client reverse fixture rejects every CodeClosure authority import', () => {
  const packageRoot = resolve(repositoryRoot, 'packages/codex-app-server-client');
  const sourcePath = resolve(packageRoot, 'src/client.ts');
  const available = new Set(['@codeclosure/codex-app-server-client']);
  for (const forbidden of [
    '@codeclosure/domain',
    '@codeclosure/runtime',
    '@codeclosure/store-sqlite',
    '@codeclosure/testing',
    '@codeclosure/cli',
  ]) {
    assert.equal(
      importViolation(forbidden, sourcePath, packageRoot, available),
      `undeclared package import ${forbidden}`,
    );
  }
});

void test('the Codex adapter reverse fixture cannot import authority owners or protocol subpaths', () => {
  const packageRoot = resolve(repositoryRoot, 'packages/adapter-codex');
  const sourcePaths = [
    resolve(packageRoot, 'src/adapter.ts'),
    resolve(packageRoot, 'src/contracts.ts'),
    resolve(packageRoot, 'src/index.ts'),
    resolve(packageRoot, 'src/protocol.ts'),
  ];
  const available = new Set([
    '@codeclosure/adapter-codex',
    '@codeclosure/codex-app-server-client',
    '@codeclosure/runtime',
  ]);
  for (const sourcePath of sourcePaths) {
    for (const forbidden of [
      '@codeclosure/domain',
      '@codeclosure/store-sqlite',
      '@codeclosure/testing',
      '@codeclosure/cli',
    ]) {
      assert.notEqual(importViolation(forbidden, sourcePath, packageRoot, available), undefined);
    }
    const specifiers = collectModuleSpecifiers(readFileSync(sourcePath, 'utf8'), sourcePath);
    assert.equal(
      specifiers.some(
        (specifier) =>
          specifier.startsWith('@codeclosure/runtime/') ||
          specifier.startsWith('@codeclosure/codex-app-server-client/'),
      ),
      false,
    );
  }
});

void test('the Codex Intake adapter has one closed package edge and production capability set', () => {
  assert.deepEqual(m25CodexIntakeAdapterDependencyExpectation, {
    path: 'packages/adapter-codex-intake',
    name: '@codeclosure/adapter-codex-intake',
    dependencies: {
      '@codeclosure/codex-app-server-client': 'workspace:*',
      '@codeclosure/runtime': 'workspace:*',
    },
    devDependencies: { '@codeclosure/domain': 'workspace:*' },
  });
  assert.deepEqual(m25CodexIntakeAdapterAllowedNodeBuiltins, [
    'node:buffer',
    'node:crypto',
    'node:fs',
    'node:path',
    'node:timers',
  ]);

  const packageRoot = resolve(repositoryRoot, 'packages/adapter-codex-intake');
  const sourcePath = resolve(packageRoot, 'src/adapter.ts');
  for (const allowed of [
    '@codeclosure/codex-app-server-client',
    '@codeclosure/runtime',
    'node:buffer',
    'node:crypto',
    'node:fs',
    'node:path',
    'node:timers',
  ]) {
    assert.equal(m25CodexIntakeAdapterImportViolation(allowed, sourcePath, packageRoot), undefined);
  }
  for (const forbidden of [
    '@codeclosure/adapter-codex',
    '@codeclosure/cli',
    '@codeclosure/domain',
    '@codeclosure/store-sqlite',
    '@codeclosure/testing',
    '@codeclosure/verification-local',
    '@codeclosure/workspace-local',
    '@codeclosure/runtime/composition',
    '@codeclosure/runtime/testing/workflow-runtime',
    '@codeclosure/codex-app-server-client/testing',
    'node:child_process',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:worker_threads',
  ]) {
    assert.notEqual(
      m25CodexIntakeAdapterImportViolation(forbidden, sourcePath, packageRoot),
      undefined,
    );
  }

  for (const file of ['adapter.ts', 'contracts.ts', 'index.ts', 'protocol.ts']) {
    const actualSourcePath = resolve(packageRoot, 'src', file);
    const specifiers = collectModuleSpecifiers(
      readFileSync(actualSourcePath, 'utf8'),
      actualSourcePath,
    );
    for (const specifier of specifiers) {
      assert.equal(
        m25CodexIntakeAdapterImportViolation(specifier, actualSourcePath, packageRoot),
        undefined,
      );
    }
  }
});

void test('the local workspace adapter depends only on public Runtime Candidate contracts', () => {
  const packageRoot = resolve(repositoryRoot, 'packages/workspace-local');
  const sourcePaths = [
    resolve(packageRoot, 'src/contracts.ts'),
    resolve(packageRoot, 'src/git-source.ts'),
    resolve(packageRoot, 'src/index.ts'),
    resolve(packageRoot, 'src/local-candidate-workspace.ts'),
    resolve(packageRoot, 'src/manifests.ts'),
    resolve(packageRoot, 'src/records.ts'),
  ];
  const available = new Set(['@codeclosure/runtime', '@codeclosure/workspace-local']);
  for (const sourcePath of sourcePaths) {
    for (const forbidden of [
      '@codeclosure/adapter-codex',
      '@codeclosure/cli',
      '@codeclosure/codex-app-server-client',
      '@codeclosure/domain',
      '@codeclosure/store-sqlite',
      '@codeclosure/testing',
    ]) {
      assert.notEqual(importViolation(forbidden, sourcePath, packageRoot, available), undefined);
    }
    const specifiers = collectModuleSpecifiers(readFileSync(sourcePath, 'utf8'), sourcePath);
    assert.equal(
      specifiers.some((specifier) => specifier.startsWith('@codeclosure/runtime/')),
      false,
    );
  }
});

void test('the local verification adapter depends only on public Runtime verification contracts', () => {
  const packageRoot = resolve(repositoryRoot, 'packages/verification-local');
  const sourcePaths = [
    resolve(packageRoot, 'src/errors.ts'),
    resolve(packageRoot, 'src/index.ts'),
    resolve(packageRoot, 'src/local-command-runner.ts'),
    resolve(packageRoot, 'src/protected-assets.ts'),
    resolve(packageRoot, 'src/seatbelt-isolation.ts'),
  ];
  const available = new Set(['@codeclosure/runtime', '@codeclosure/verification-local']);
  for (const sourcePath of sourcePaths) {
    for (const forbidden of [
      '@codeclosure/adapter-codex',
      '@codeclosure/cli',
      '@codeclosure/codex-app-server-client',
      '@codeclosure/domain',
      '@codeclosure/store-sqlite',
      '@codeclosure/testing',
      '@codeclosure/workspace-local',
    ]) {
      assert.notEqual(importViolation(forbidden, sourcePath, packageRoot, available), undefined);
    }
    const specifiers = collectModuleSpecifiers(readFileSync(sourcePath, 'utf8'), sourcePath);
    assert.equal(
      specifiers.some((specifier) => specifier.startsWith('@codeclosure/runtime/')),
      false,
    );
  }
});
