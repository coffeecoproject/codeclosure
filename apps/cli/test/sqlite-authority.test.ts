import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  CanonicalJsonSha256DigestProvider,
  createCodeClosureApplication,
  type GoalExecutionCapability,
  type NormalizedProjectPathPort,
} from '@codeclosure/runtime';
import { CryptographicIdentityGenerator, SystemUtcClock } from '@codeclosure/runtime/composition';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';

import { ProtectedPathKind } from '../src/composition/data-home.ts';
import { openCliSqliteAuthority } from '../dist/composition/sqlite-authority.js';

function temporaryRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-cli-authority-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

const unavailableExecution: GoalExecutionCapability = Object.freeze({
  startGoal: () => Promise.reject(new Error('fixture does not execute a Goal')),
  resumeGoal: () => Promise.reject(new Error('fixture does not resume a Goal')),
  cancelGoal: () => {
    throw new Error('fixture does not cancel a Goal');
  },
});

const normalizedProjectPaths: NormalizedProjectPathPort = Object.freeze({
  parseNormalizedAbsolute: (path: string) => {
    if (!isAbsolute(path) || normalize(path) !== path) {
      throw new TypeError('fixture project path must be normalized and absolute');
    }
    return path;
  },
});

void test('[I-006][I-007] trusted CLI composition uses verified SQLite activation', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const store = openCliSqliteAuthority({
    dataHomePath: join(root, 'authority'),
    protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
    allowedProjectPaths: [project],
  });
  t.after(() => store.close());

  assert.equal(store.appliedMigrations().length, 22);
  assert.deepEqual(store.listStartupRecoveryCatalog(), []);
});

void test('[I-007] explicit project overlap fails before SQLite authority is created', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(project, '.authority');
  mkdirSync(project, { mode: 0o700 });

  assert.throws(
    () =>
      openCliSqliteAuthority({
        dataHomePath,
        protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
        allowedProjectPaths: [project],
      }),
    /must not equal or be nested inside project path/,
  );
  assert.equal(existsSync(join(dataHomePath, 'state.sqlite')), false);
});

void test('[I-006][I-007] retained project overlap is denied by one verified open path', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(project, '.authority');
  const databasePath = join(dataHomePath, 'state.sqlite');
  mkdirSync(dataHomePath, { mode: 0o700, recursive: true });
  const rawStore = openSqliteControlStore({ filename: databasePath });
  const ids = new CryptographicIdentityGenerator();
  const application = createCodeClosureApplication({
    store: rawStore,
    clock: new SystemUtcClock(),
    creationIds: ids,
    digests: new CanonicalJsonSha256DigestProvider(),
    projectPaths: normalizedProjectPaths,
    execution: unavailableExecution,
  });
  assert.equal(
    application.createGoal({
      commandId: ids.nextCommandId(),
      objective: 'Retain an unsafe bootstrap fixture',
      projectPath: project,
      criteria: ['The verified composition rejects this retained overlap'],
    }).status,
    'APPLIED',
  );
  rawStore.close();
  if (process.platform !== 'win32') {
    chmodSync(databasePath, 0o600);
  }

  assert.throws(
    () =>
      openCliSqliteAuthority({
        dataHomePath,
        protectedPaths: [],
        allowedProjectPaths: [],
      }),
    /must not equal or be nested inside project path/,
  );
});

void test('[I-007][I-008] verified Store operations recheck a planned project identity', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'future-project');
  const store = openCliSqliteAuthority({
    dataHomePath: join(root, 'authority'),
    protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
    allowedProjectPaths: [project],
  });
  t.after(() => store.close());

  mkdirSync(project, { mode: 0o700 });
  assert.throws(() => store.listStartupRecoveryCatalog(), /protected-path identity changed/);
});
