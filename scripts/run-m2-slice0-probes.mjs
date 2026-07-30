import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  compareGeneratedManifests,
  generatedDirectoryManifest,
  sha256Bytes,
  validateCandidateWorkspaceLeaseRoot,
} from './m2-slice0-probe-lib.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  throw new TypeError(message);
}

function resolveLauncher(raw) {
  if (raw !== undefined) {
    return resolve(raw);
  }
  return execFileSync('/usr/bin/which', ['codex'], { encoding: 'utf8' }).trim();
}

function digestFile(path) {
  return sha256Bytes(readFileSync(path));
}

function run(executable, args, options = {}) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function assertRequiredProtocolSurface(tsRoot) {
  const sources = [
    readFileSync(join(tsRoot, 'ClientRequest.ts'), 'utf8'),
    readFileSync(join(tsRoot, 'ServerRequest.ts'), 'utf8'),
    readFileSync(join(tsRoot, 'ServerNotification.ts'), 'utf8'),
    readFileSync(join(tsRoot, 'v2', 'ThreadItem.ts'), 'utf8'),
  ].join('\n');
  const required = [
    'initialize',
    'thread/start',
    'thread/resume',
    'thread/compact/start',
    'turn/start',
    'turn/interrupt',
    'turn/steer',
    'turn/completed',
    'contextCompaction',
    'thread/compacted',
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/tool/requestUserInput',
    'mcpServer/elicitation/request',
    'item/tool/call',
  ];
  const missing = required.filter((method) => !sources.includes(`"${method}"`));
  if (missing.length !== 0) {
    fail(`Generated protocol surface is missing: ${missing.join(', ')}`);
  }
  return Object.freeze(required);
}

function assertRequiredConfigurationSurface(tsRoot) {
  const configSource = readFileSync(join(tsRoot, 'v2', 'Config.ts'), 'utf8');
  const required = Object.freeze([
    Object.freeze({
      field: 'model_auto_compact_token_limit',
      declaration: 'model_auto_compact_token_limit: bigint | null',
    }),
    Object.freeze({
      field: 'model_auto_compact_token_limit_scope',
      declaration: 'model_auto_compact_token_limit_scope: AutoCompactTokenLimitScope | null',
    }),
  ]);
  const missing = required
    .filter(({ declaration }) => !configSource.includes(declaration))
    .map(({ field }) => field);
  if (missing.length !== 0) {
    fail(`Generated configuration surface is missing: ${missing.join(', ')}`);
  }
  return Object.freeze(required.map(({ field }) => field));
}

function schemaProbe(launcher, temporaryRoot) {
  const tsA = join(temporaryRoot, 'ts-a');
  const tsB = join(temporaryRoot, 'ts-b');
  const jsonA = join(temporaryRoot, 'json-a');
  const jsonB = join(temporaryRoot, 'json-b');
  for (const path of [tsA, tsB, jsonA, jsonB]) {
    mkdirSync(path);
  }
  for (const path of [tsA, tsB]) {
    run(launcher, ['app-server', 'generate-ts', '--out', path]);
  }
  for (const path of [jsonA, jsonB]) {
    run(launcher, ['app-server', 'generate-json-schema', '--out', path]);
  }

  const tsFirst = generatedDirectoryManifest(tsA, 'RAW_BYTES');
  const tsSecond = generatedDirectoryManifest(tsB, 'RAW_BYTES');
  const jsonFirst = generatedDirectoryManifest(jsonA, 'RFC8785_JSON');
  const jsonSecond = generatedDirectoryManifest(jsonB, 'RFC8785_JSON');
  const tsComparison = compareGeneratedManifests(tsFirst, tsSecond);
  const jsonComparison = compareGeneratedManifests(jsonFirst, jsonSecond);
  if (!tsComparison.equal || !jsonComparison.equal) {
    fail('Repeated App Server schema generation contains semantic drift');
  }
  return Object.freeze({
    typescript: Object.freeze({
      fileCount: tsFirst.fileCount,
      digest: tsFirst.digest,
      repeatedRawBytesEqual: tsComparison.equal,
    }),
    jsonSchema: Object.freeze({
      fileCount: jsonFirst.fileCount,
      canonicalDigest: jsonFirst.digest,
      repeatedCanonicalBytesEqual: jsonComparison.equal,
      rawOrderDifferenceCount: jsonComparison.rawDifferences.length,
      rawOrderDifferencePaths: jsonComparison.rawDifferences,
    }),
    requiredStableSurface: assertRequiredProtocolSurface(tsA),
    requiredStableConfigurationFields: assertRequiredConfigurationSurface(tsA),
  });
}

function git(executable, args, cwd) {
  return run(executable, args, { cwd });
}

function workspaceProbe(temporaryRoot) {
  const source = join(temporaryRoot, 'source');
  const worktree = join(temporaryRoot, 'git-worktree');
  const authority = join(temporaryRoot, 'authority');
  const owned = join(temporaryRoot, 'owned-workspaces');
  const generationOne = join(owned, 'generation-1');
  const generationTwo = join(owned, 'generation-2');
  for (const path of [source, authority, generationOne, generationTwo]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(source, 'fixture.txt'), 'M2 Slice 0 fixture\n');
  git('/usr/bin/git', ['init', '--quiet'], source);
  git('/usr/bin/git', ['add', 'fixture.txt'], source);
  git(
    '/usr/bin/git',
    [
      '-c',
      'user.name=CodeClosure Slice 0',
      '-c',
      'user.email=slice0@invalid.example',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    source,
  );
  git('/usr/bin/git', ['worktree', 'add', '--quiet', '--detach', worktree, 'HEAD'], source);
  const gitEntry = join(worktree, '.git');
  const worktreeMutatesSourceGitMetadata =
    lstatSync(gitEntry).isFile() &&
    readFileSync(gitEntry, 'utf8').includes(`${join(source, '.git', 'worktrees')}/`);
  git('/usr/bin/git', ['worktree', 'remove', '--force', worktree], source);

  const alias = join(temporaryRoot, 'generation-alias');
  run('/bin/ln', ['-s', generationOne, alias]);
  validateCandidateWorkspaceLeaseRoot({
    ownedRoot: owned,
    registeredRoot: generationOne,
    requestedRoot: generationOne,
    forbiddenRoots: [source, authority],
  });
  const rejectedTargets = [];
  for (const [label, requestedRoot] of [
    ['source', source],
    ['authority', authority],
    ['sibling-generation', generationTwo],
    ['symlink-alias', alias],
  ]) {
    try {
      validateCandidateWorkspaceLeaseRoot({
        ownedRoot: owned,
        registeredRoot: generationOne,
        requestedRoot,
        forbiddenRoots: [source, authority],
      });
    } catch {
      rejectedTargets.push(label);
    }
  }
  if (rejectedTargets.length !== 4) {
    fail('Candidate lease containment probe did not reject every unsafe target');
  }
  return Object.freeze({
    selectedMechanism: 'RUNTIME_MANAGED_CONTROLLED_COPY',
    rejectedMechanism: 'DETACHED_GIT_WORKTREE',
    worktreeMutatesSourceGitMetadata,
    controlledCopyGitMetadataPolicy: 'EXCLUDE_DOT_GIT_AND_BIND_GIT_METADATA_SEPARATELY',
    unsafeLeaseTargetsRejected: Object.freeze(rejectedTargets),
  });
}

const launcher = resolveLauncher(argument('--codex'));
const native = argument('--native');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m2-slice0-probe-'));
try {
  const launcherTarget = realpathSync(launcher);
  const output = {
    schemaVersion: 1,
    probe: 'codeclosure-m2-slice0',
    codex: {
      launcher,
      launcherTarget,
      launcherDigest: digestFile(launcher),
      version: run(launcher, ['--version']).trim(),
      ...(native === undefined
        ? {}
        : {
            delegatedExecutable: resolve(native),
            delegatedExecutableDigest: digestFile(resolve(native)),
          }),
    },
    schema: schemaProbe(launcher, temporaryRoot),
    workspace: workspaceProbe(join(temporaryRoot, 'workspace-probe')),
  };
  const digest = createHash('sha256')
    .update('codeclosure-m2-slice0-probe-v1\0', 'utf8')
    .update(JSON.stringify(output), 'utf8')
    .digest('hex');
  process.stdout.write(
    `${JSON.stringify({ ...output, probeDigest: `sha256:${digest}` }, null, 2)}\n`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
