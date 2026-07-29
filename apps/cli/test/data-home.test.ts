import assert from 'node:assert/strict';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import test from 'node:test';

import {
  ProtectedPathKind,
  ProtectedPathIdentityState,
  assertPreparedCodeClosureDataHome,
  assertPreparedCodeClosureStateDatabase,
  prepareCodeClosureAuthorityIsolationLease,
  prepareCodeClosureDataHome,
  prepareCodeClosureStateDatabase,
  resolveCodeClosureDataHomePath,
} from '../src/composition/data-home.ts';

function temporaryRoot(t: test.TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-data-home-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

void test('platform defaults and absolute override resolve exactly once', () => {
  assert.equal(
    resolveCodeClosureDataHomePath({ platform: 'darwin', environment: { HOME: '/Users/demo' } }),
    '/Users/demo/Library/Application Support/CodeClosure',
  );
  assert.equal(
    resolveCodeClosureDataHomePath({ platform: 'linux', environment: { HOME: '/home/demo' } }),
    '/home/demo/.local/share/codeclosure',
  );
  assert.equal(
    resolveCodeClosureDataHomePath({
      platform: 'linux',
      environment: { HOME: '/home/demo', XDG_DATA_HOME: '/var/demo-data' },
    }),
    '/var/demo-data/codeclosure',
  );
  assert.equal(
    resolveCodeClosureDataHomePath({
      platform: 'win32',
      environment: { LOCALAPPDATA: String.raw`C:\Users\demo\AppData\Local` },
    }),
    win32.join(String.raw`C:\Users\demo\AppData\Local`, 'CodeClosure'),
  );
  assert.equal(
    resolveCodeClosureDataHomePath({
      platform: 'linux',
      environment: { CODECLOSURE_HOME: '/srv/codeclosure', HOME: '/ignored' },
    }),
    '/srv/codeclosure',
  );
});

void test('relative, root, missing, and unsupported data-home inputs fail closed', () => {
  assert.throws(
    () =>
      resolveCodeClosureDataHomePath({
        platform: 'linux',
        environment: { CODECLOSURE_HOME: 'relative/home' },
      }),
    /must be an absolute path/,
  );
  assert.throws(
    () =>
      resolveCodeClosureDataHomePath({
        platform: 'linux',
        environment: { CODECLOSURE_HOME: '/' },
      }),
    /must not be a filesystem root/,
  );
  assert.throws(
    () => resolveCodeClosureDataHomePath({ platform: 'darwin', environment: {} }),
    /HOME must be a non-empty absolute path/,
  );
  assert.throws(
    () => resolveCodeClosureDataHomePath({ platform: 'freebsd', environment: { HOME: '/home' } }),
    /Unsupported CodeClosure data-home platform/,
  );
});

void test('preparation creates an owner-only stable authority directory', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const prepared = prepareCodeClosureDataHome({
    path: join(root, 'authority', 'codeclosure'),
    protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
  });

  assert.equal(prepared.databasePath, join(prepared.realPath, 'state.sqlite'));
  if (process.platform !== 'win32') {
    assert.equal(statSync(prepared.realPath).mode & 0o777, 0o700);
  }
  assert.doesNotThrow(() => assertPreparedCodeClosureDataHome(prepared));
});

void test('project and candidate overlap is rejected before authority creation', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const candidate = join(root, 'candidate');
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(candidate, { mode: 0o700 });

  const cases = [
    {
      path: project,
      protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
    },
    {
      path: join(project, '.codeclosure'),
      protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
    },
    {
      path: join(candidate, 'authority'),
      protectedPaths: [{ kind: ProtectedPathKind.CANDIDATE, path: candidate }],
    },
  ];
  for (const fixture of cases) {
    assert.throws(() => prepareCodeClosureDataHome(fixture), /must not equal or be nested inside/);
  }
});

void test('symlink-mediated overlap and a symlink home fail closed', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const projectAlias = join(root, 'project-alias');
  mkdirSync(project, { mode: 0o700 });
  symlinkSync(project, projectAlias, 'dir');

  assert.throws(
    () =>
      prepareCodeClosureDataHome({
        path: join(projectAlias, 'authority'),
        protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
      }),
    /must not equal or be nested inside/,
  );

  const safeHome = join(root, 'safe-home');
  mkdirSync(safeHome, { mode: 0o700 });
  const homeAlias = join(root, 'home-alias');
  symlinkSync(safeHome, homeAlias, 'dir');
  assert.throws(
    () => prepareCodeClosureDataHome({ path: homeAlias, protectedPaths: [] }),
    /must not itself be a symbolic link/,
  );
});

void test('unsafe existing directory permissions and non-directory homes fail closed', (t) => {
  const root = temporaryRoot(t);
  const broad = join(root, 'broad');
  mkdirSync(broad, { mode: 0o700 });
  if (process.platform !== 'win32') {
    chmodSync(broad, 0o755);
    assert.throws(
      () => prepareCodeClosureDataHome({ path: broad, protectedPaths: [] }),
      /owner-only 0700 permissions/,
    );
  }

  const file = join(root, 'ordinary-file');
  writeFileSync(file, 'not a directory', { mode: 0o600 });
  assert.throws(
    () => prepareCodeClosureDataHome({ path: file, protectedPaths: [] }),
    /not a directory/,
  );
});

void test('prepared home and protected-path replacement are detected before Store open', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const prepared = prepareCodeClosureDataHome({
    path: join(root, 'authority'),
    protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
  });

  renameSync(prepared.realPath, join(root, 'old-authority'));
  mkdirSync(prepared.realPath, { mode: 0o700 });
  assert.throws(
    () => assertPreparedCodeClosureDataHome(prepared),
    /identity changed before or during Store use/,
  );

  const second = prepareCodeClosureDataHome({
    path: join(root, 'second-authority'),
    protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
  });
  renameSync(project, join(root, 'old-project'));
  mkdirSync(project, { mode: 0o700 });
  assert.throws(
    () => assertPreparedCodeClosureDataHome(second),
    /protected-path identity changed before or during Store use/,
  );
});

void test('a missing project binds a planned identity that fails closed when it appears', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'future', 'project');
  const home = prepareCodeClosureDataHome({
    path: join(root, 'authority'),
    protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
  });
  const preparedProject = home.protectedPaths[0];
  assert.ok(preparedProject);
  assert.equal(preparedProject.identityState, ProtectedPathIdentityState.PLANNED);
  assert.deepEqual(preparedProject.missingSegments, ['future', 'project']);

  const database = prepareCodeClosureStateDatabase(home);
  const lease = prepareCodeClosureAuthorityIsolationLease({
    preparedHome: home,
    preparedDatabase: database,
    discoveredProtectedPaths: [],
    allowedProjectPaths: [project],
  });
  assert.doesNotThrow(() => lease.assertCurrent());
  assert.doesNotThrow(() => lease.assertProjectPathAllowed(project));

  mkdirSync(project, { mode: 0o700, recursive: true });
  assert.throws(() => lease.assertCurrent(), /protected-path identity changed/);
});

void test('retained project identities discovered from SQLite remain revalidatable', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'retained-project');
  mkdirSync(project, { mode: 0o700 });
  const home = prepareCodeClosureDataHome({ path: join(root, 'authority'), protectedPaths: [] });
  const database = prepareCodeClosureStateDatabase(home);
  const lease = prepareCodeClosureAuthorityIsolationLease({
    preparedHome: home,
    preparedDatabase: database,
    discoveredProtectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
    allowedProjectPaths: [],
  });

  renameSync(project, join(root, 'old-retained-project'));
  mkdirSync(project, { mode: 0o700 });
  assert.throws(() => lease.assertCurrent(), /protected-path identity changed/);
});

void test('CreateGoal admission is limited to the exact invocation project path', (t) => {
  const root = temporaryRoot(t);
  const selectedProject = join(root, 'selected-project');
  const otherProject = join(root, 'other-project');
  mkdirSync(selectedProject, { mode: 0o700 });
  mkdirSync(otherProject, { mode: 0o700 });
  const home = prepareCodeClosureDataHome({
    path: join(root, 'authority'),
    protectedPaths: [
      { kind: ProtectedPathKind.PROJECT, path: selectedProject },
      { kind: ProtectedPathKind.PROJECT, path: otherProject },
    ],
  });
  const database = prepareCodeClosureStateDatabase(home);
  const lease = prepareCodeClosureAuthorityIsolationLease({
    preparedHome: home,
    preparedDatabase: database,
    discoveredProtectedPaths: [],
    allowedProjectPaths: [selectedProject],
  });

  assert.doesNotThrow(() => lease.assertProjectPathAllowed(selectedProject));
  assert.throws(
    () => lease.assertProjectPathAllowed(otherProject),
    /not authorized by this verified invocation/,
  );
  assert.throws(
    () => lease.assertProjectPathAllowed(`${selectedProject}/../selected-project`),
    /not authorized by this verified invocation/,
  );
});

void test('a retained project overlap discovered after home preparation still fails closed', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const home = prepareCodeClosureDataHome({
    path: join(project, 'authority'),
    protectedPaths: [],
  });
  const database = prepareCodeClosureStateDatabase(home);

  assert.throws(
    () =>
      prepareCodeClosureAuthorityIsolationLease({
        preparedHome: home,
        preparedDatabase: database,
        discoveredProtectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
        allowedProjectPaths: [],
      }),
    /must not equal or be nested inside project path/,
  );
});

void test('state database is created owner-only and retains exact file identity', (t) => {
  const root = temporaryRoot(t);
  const home = prepareCodeClosureDataHome({
    path: join(root, 'authority'),
    protectedPaths: [],
  });
  const database = prepareCodeClosureStateDatabase(home);
  assert.equal(database.path, home.databasePath);
  if (process.platform !== 'win32') {
    assert.equal(statSync(database.path).mode & 0o777, 0o600);
  }
  assert.doesNotThrow(() => assertPreparedCodeClosureStateDatabase(home, database));

  renameSync(database.path, join(home.realPath, 'old-state.sqlite'));
  writeFileSync(database.path, '', { mode: 0o600 });
  assert.throws(
    () => assertPreparedCodeClosureStateDatabase(home, database),
    /state-database identity changed/,
  );
});

void test('symbolic-link, hard-link, broad-permission, and directory database paths fail closed', (t) => {
  const root = temporaryRoot(t);

  const symlinkHome = prepareCodeClosureDataHome({
    path: join(root, 'symlink-home'),
    protectedPaths: [],
  });
  const outside = join(root, 'outside.sqlite');
  writeFileSync(outside, '', { mode: 0o600 });
  symlinkSync(outside, symlinkHome.databasePath, 'file');
  assert.throws(() => prepareCodeClosureStateDatabase(symlinkHome), /must not be a symbolic link/);

  const hardLinkHome = prepareCodeClosureDataHome({
    path: join(root, 'hard-link-home'),
    protectedPaths: [],
  });
  writeFileSync(hardLinkHome.databasePath, '', { mode: 0o600 });
  linkSync(hardLinkHome.databasePath, join(root, 'state-alias.sqlite'));
  assert.throws(
    () => prepareCodeClosureStateDatabase(hardLinkHome),
    /must not have hard-link aliases/,
  );

  const broadHome = prepareCodeClosureDataHome({
    path: join(root, 'broad-database-home'),
    protectedPaths: [],
  });
  writeFileSync(broadHome.databasePath, '', { mode: 0o600 });
  if (process.platform !== 'win32') {
    chmodSync(broadHome.databasePath, 0o644);
    assert.throws(() => prepareCodeClosureStateDatabase(broadHome), /owner-only 0600 permissions/);
  }

  const directoryHome = prepareCodeClosureDataHome({
    path: join(root, 'directory-database-home'),
    protectedPaths: [],
  });
  mkdirSync(directoryHome.databasePath, { mode: 0o700 });
  assert.throws(() => prepareCodeClosureStateDatabase(directoryHome), /not a regular file/);
});
