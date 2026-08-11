import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { m251ProjectTreeIdentity } from './m2.5.1-live-intake-lib.mjs';
import { parseSourceIdentity } from './m2-acceptance-lib.mjs';

const maximumChildOutputBytes = 16 * 1024 * 1024;
const assessmentRootPrefixes = Object.freeze([
  'codeclosure-m2-5-1-live-composition-',
  'codeclosure-m2-5-1-live-containment-',
]);

function fail(message) {
  throw new TypeError(message);
}

export function runM251LiveCommand(executable, arguments_, options = {}) {
  return spawnSync(executable, arguments_, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: maximumChildOutputBytes,
    timeout: options.timeoutMilliseconds ?? 30_000,
  });
}

export function m251SuccessfulOutput(result, label) {
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    fail(`${label} failed`);
  }
  return result.stdout ?? '';
}

export function m251ExactSourceIdentity(repositoryRoot, reviewExclusion) {
  const result = runM251LiveCommand(
    process.execPath,
    ['scripts/source-identity.mjs', '--review-exclusion', reviewExclusion],
    { cwd: repositoryRoot },
  );
  return parseSourceIdentity(m251SuccessfulOutput(result, 'M2.5.1 source-identity preflight'));
}

export function m251ExactAuthSource(selected, environment = process.env) {
  const path =
    selected ?? environment.CODECLOSURE_M2_AUTH_SOURCE ?? join(homedir(), '.codex', 'auth.json');
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    fail('The trusted Codex authentication source is unavailable');
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    fail('The trusted Codex authentication source must be one exact regular file');
  }
  return absolute;
}

export function m251FileDigest(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

export function m251MetadataFingerprint(path) {
  const stat = lstatSync(path);
  return Object.freeze({
    device: stat.dev,
    inode: stat.ino,
    mode: stat.mode,
    size: stat.size,
    modifiedMilliseconds: stat.mtimeMs,
  });
}

export function m251ProjectObservation(projectPath, observeLocalCandidateSourceIdentity) {
  const git = (arguments_) =>
    m251SuccessfulOutput(
      runM251LiveCommand('git', arguments_, {
        cwd: projectPath,
        env: {
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C',
          PATH: process.env.PATH ?? '/usr/bin:/bin',
        },
      }),
      'M2.5.1 demonstration Git preflight',
    ).trim();
  const source = observeLocalCandidateSourceIdentity(projectPath);
  return Object.freeze({
    gitCommit: git(['rev-parse', 'HEAD']),
    gitTree: git(['rev-parse', 'HEAD^{tree}']),
    sourceTreeDigest: source.sourceTreeDigest,
    sourceGitMetadataDigest: source.sourceGitMetadataDigest,
    workingTreeState: git(['status', '--porcelain=v2']).length === 0 ? 'clean' : 'modified',
    projectTree: m251ProjectTreeIdentity(projectPath),
  });
}

export function m251PnpmVersion(repositoryRoot) {
  return m251SuccessfulOutput(
    runM251LiveCommand('corepack', ['pnpm', '--version'], { cwd: repositoryRoot }),
    'M2.5.1 pnpm preflight',
  ).trim();
}

export function m251RootPathDigest(kind, path) {
  return Object.freeze({
    kind,
    pathDigest: `sha256:${createHash('sha256')
      .update(JSON.stringify(['codeclosure-m2-5-1-live-root-v1', realpathSync(path)]), 'utf8')
      .digest('hex')}`,
  });
}

export function m251RemoveOwnedAssessmentRoot(root) {
  if (!existsSync(root)) {
    return;
  }
  const exactRoot = realpathSync(root);
  const exactTemporaryRoot = realpathSync(tmpdir());
  if (
    exactRoot !== resolve(root) ||
    dirname(exactRoot) !== exactTemporaryRoot ||
    !assessmentRootPrefixes.some((prefix) => basename(exactRoot).startsWith(prefix))
  ) {
    fail('Assessment cleanup target is not one exact owned root');
  }
  const pending = [exactRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      fail('Assessment cleanup encountered a symbolic link');
    }
    if (stat.isDirectory()) {
      chmodSync(current, 0o700);
      pending.push(...readdirSync(current).map((name) => join(current, name)));
    } else if (stat.isFile()) {
      chmodSync(current, 0o600);
    } else {
      fail('Assessment cleanup encountered a special filesystem entry');
    }
  }
  rmSync(exactRoot, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
}
