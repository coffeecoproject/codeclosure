import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';

import {
  M251_ACCEPTANCE_MATRIX_CONTRACT_DIGEST,
  M251_PREFLIGHT_BINDING_ROOT_KINDS,
  M251_REQUIRED_NON_CLAIMS,
  M251_REVIEW_EXCLUSION,
  M251_SOURCE_PATH_MANIFEST_KIND,
  M251_STAGE_ORDER,
  M251AcceptanceOutcome,
  M251AcceptanceStage,
  M251AssessmentMeaning,
  buildM251MatrixResults,
  m251AssessmentOutcome,
  m251PreflightProofSupportSatisfied,
  m251Sha256Bytes,
  m251Sha256Text,
  m251SourceIdentitiesMatch,
  parseM251AcceptanceMatrix,
  projectM251PreflightProofEvidence,
  validateM251AssessmentEnvironment,
  validateM251EvidenceManifest,
} from './m2.5.1-acceptance-lib.mjs';
import {
  M251_LIVE_COMPOSITION_RECEIPT_KIND,
  assertM251LiveCompositionMetadataOnly,
  validateM251LiveCompositionReceipt,
} from './m2.5.1-live-composition-lib.mjs';
import {
  M251_LIVE_CONTAINMENT_RECEIPT_KIND,
  assertM251LiveContainmentMetadataOnly,
  validateM251LiveContainmentReceipt,
} from './m2.5.1-live-containment-lib.mjs';
import {
  M251_LIVE_INTAKE_RECEIPT_KIND,
  assertM251MetadataOnly,
  validateM251LiveReceipt,
} from './m2.5.1-live-intake-lib.mjs';
import {
  M25AcceptanceOutcome,
  m25SourceIdentitiesMatch,
  parseNodeTestNames,
  parseNodeTestSummaries,
  validateM25EvidenceManifest,
} from './m2.5-acceptance-lib.mjs';
import { M2AcceptanceOutcome, parseM2CurrentSourceRegressionResult } from './m2-acceptance-lib.mjs';
import { parseJsonRejectingDuplicateKeys } from './m2-slice0-probe-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const acceptancePlanPath = join(repositoryRoot, 'docs', 'plans', 'm2.5.1-acceptance-plan.md');
const slice0ContractPath = join(
  repositoryRoot,
  'scripts',
  'fixtures',
  'm2.5.1',
  'slice0-contract.json',
);
const packageManifestPath = join(repositoryRoot, 'package.json');
const lockfilePath = join(repositoryRoot, 'pnpm-lock.yaml');
const protectedCheckPath = join(
  repositoryRoot,
  'scripts',
  'fixtures',
  'm2.5.1',
  'payment-idempotency-check.mjs',
);
const maximumOutputBytes = 128 * 1024 * 1024;
const liveAuthorizationEnvironment = 'CODECLOSURE_M251_ACCEPTANCE_LIVE_AUTHORIZED';
const executionRootPrefix = 'codeclosure-m2-5-1-acceptance-execution-';

const stageDefinitions = Object.freeze([
  Object.freeze({
    id: M251AcceptanceStage.PREFLIGHT,
    commandId: 'm251-environment-and-isolation-preflight',
    commands: Object.freeze([]),
    requireTests: false,
  }),
  Object.freeze({
    id: M251AcceptanceStage.QUALITY,
    commandId: 'm251-complete-quality-gate',
    commands: Object.freeze([Object.freeze(['corepack', 'pnpm', 'gate:quality'])]),
    requireTests: true,
  }),
  Object.freeze({
    id: M251AcceptanceStage.V1_COMPATIBILITY,
    commandId: 'm251-v1-compatibility-and-reopen',
    commands: Object.freeze([
      Object.freeze([
        process.execPath,
        'scripts/run-node-tests.mjs',
        'packages/store-sqlite/test/m2.5.1-intake-compatibility.test.ts',
        'packages/store-sqlite/test/m2.5.1-external-compatibility.test.ts',
        'packages/testing/test/m2.5.1-contracts.test.ts',
      ]),
    ]),
    requireTests: true,
  }),
  Object.freeze({
    id: M251AcceptanceStage.INTAKE_PROTOCOL,
    commandId: 'm251-intake-protocol-and-failure-closure',
    commands: Object.freeze([
      Object.freeze([
        process.execPath,
        'scripts/run-node-tests.mjs',
        'packages/adapter-codex-intake/test/adapter-v2.test.ts',
        'scripts/m2.5.1-slice0-contract.test.mjs',
        'scripts/check-dependencies.test.mjs',
      ]),
    ]),
    requireTests: true,
  }),
  Object.freeze({
    id: M251AcceptanceStage.LIVE_INTAKE,
    commandId: 'm251-live-intake-compatibility',
    commands: Object.freeze([]),
    requireTests: false,
  }),
  Object.freeze({
    id: M251AcceptanceStage.PROFILE_START,
    commandId: 'm251-profile-and-start-binding',
    commands: Object.freeze([
      Object.freeze([
        process.execPath,
        'scripts/run-node-tests.mjs',
        'apps/cli/test/m2.5.1-composition.test.ts',
        'packages/store-sqlite/test/m2.5.1-materialization-start.test.ts',
        'scripts/check-dependencies.test.mjs',
      ]),
    ]),
    requireTests: true,
  }),
  Object.freeze({
    id: M251AcceptanceStage.DETERMINISTIC_COMPOSITION,
    commandId: 'm251-deterministic-composition-and-recovery',
    commands: Object.freeze([
      Object.freeze([
        'corepack',
        'pnpm',
        '--filter',
        '@codeclosure/store-sqlite',
        'exec',
        process.execPath,
        '../../scripts/run-node-tests.mjs',
        'test/project-read-authority.test.ts',
      ]),
      Object.freeze([
        'corepack',
        'pnpm',
        '--filter',
        '@codeclosure/workspace-local',
        'exec',
        process.execPath,
        '../../scripts/run-node-tests.mjs',
        'test/project-read-cleanup.test.ts',
      ]),
      Object.freeze([
        'corepack',
        'pnpm',
        '--filter',
        '@codeclosure/adapter-codex',
        'exec',
        process.execPath,
        '../../scripts/run-node-tests.mjs',
        'test/candidate-free-adapter.test.ts',
      ]),
      Object.freeze([
        'corepack',
        'pnpm',
        '--filter',
        '@codeclosure/testing',
        'exec',
        process.execPath,
        '../../scripts/run-node-tests.mjs',
        'test/m2.5.1-contracts.test.ts',
      ]),
    ]),
    requireTests: true,
  }),
  Object.freeze({
    id: M251AcceptanceStage.LIVE_COMPOSITION,
    commandId: 'm251-live-intake-to-codex-and-containment',
    commands: Object.freeze([]),
    requireTests: false,
  }),
  Object.freeze({
    id: M251AcceptanceStage.INTEGRITY,
    commandId: 'm251-candidate-and-acceptance-integrity',
    commands: Object.freeze([
      Object.freeze([
        process.execPath,
        'scripts/run-node-tests.mjs',
        'packages/store-sqlite/test/m2.5.1-candidate-change-containment.test.ts',
        'packages/workspace-local/test/project-read-workspace.test.ts',
        'apps/cli/test/m2.5.1-composition.test.ts',
        'scripts/check-dependencies.test.mjs',
      ]),
    ]),
    requireTests: true,
  }),
  Object.freeze({
    id: M251AcceptanceStage.M1_REGRESSION,
    commandId: 'm251-m1-regression',
    commands: Object.freeze([Object.freeze(['corepack', 'pnpm', 'accept:m1'])]),
    requireTests: false,
  }),
  Object.freeze({
    id: M251AcceptanceStage.M2_REGRESSION,
    commandId: 'm251-m2-current-source-regression',
    commands: Object.freeze([Object.freeze(['corepack', 'pnpm', 'regress:m2'])]),
    requireTests: false,
  }),
  Object.freeze({
    id: M251AcceptanceStage.M25_REGRESSION,
    commandId: 'm251-m2-5-current-source-regression',
    commands: Object.freeze([Object.freeze(['corepack', 'pnpm', 'regress:m2.5'])]),
    requireTests: false,
  }),
  Object.freeze({
    id: M251AcceptanceStage.SOURCE_CLOSURE,
    commandId: 'm251-source-closure-and-manifest',
    commands: Object.freeze([Object.freeze(['corepack', 'pnpm', 'docs:check'])]),
    requireTests: false,
  }),
]);

function fail(message) {
  throw new TypeError(message);
}

function log(message) {
  process.stderr.write(`[accept:m2.5.1] ${message}\n`);
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !['--auth-source', '--project'].includes(name) ||
      value === undefined ||
      value.length === 0 ||
      values.has(name)
    ) {
      fail('Usage: run-m2.5.1-acceptance.mjs [--auth-source <file> --project <directory>]');
    }
    values.set(name, value);
  }
  return Object.freeze({
    authSource: values.get('--auth-source'),
    project: values.get('--project'),
  });
}

function readUniqueJson(path, label) {
  try {
    return parseJsonRejectingDuplicateKeys(readFileSync(path, 'utf8'), label);
  } catch {
    fail(`${label} is not unique-key JSON`);
  }
}

function run(executable, arguments_, options = {}) {
  return spawnSync(executable, arguments_, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: maximumOutputBytes,
    timeout: options.timeoutMilliseconds ?? 900_000,
  });
}

function successful(result) {
  return result.error === undefined && result.signal === null && result.status === 0;
}

function commandProjection(command) {
  return command.map((part) => {
    if (typeof part !== 'string') return String(part);
    if (isAbsolute(part)) return `<ABSOLUTE:${part === process.execPath ? 'NODE' : 'BOUND'}>`;
    return part;
  });
}

function commandDigest(definition, commands = definition.commands) {
  return m251Sha256Text(
    JSON.stringify({
      schemaVersion: 1,
      commandId: definition.commandId,
      commands: commands.map(commandProjection),
    }),
  );
}

function emptyCounts() {
  return {
    executed: 0,
    passed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    waived: 0,
    expectedFailure: 0,
    unexpectedNotApplicable: 0,
    sourceDrift: 0,
    unexplainedWarning: 0,
  };
}

function passingCounts(executed) {
  return { ...emptyCounts(), executed, passed: executed };
}

function failedCounts() {
  return { ...emptyCounts(), executed: 1, failed: 1 };
}

function blockedCounts() {
  return emptyCounts();
}

function artifactPathForStage(stageId) {
  const index = M251_STAGE_ORDER.indexOf(stageId) + 1;
  return `artifacts/${String(index).padStart(2, '0')}-${stageId}.json`;
}

function writeJsonArtifact(evidenceRoot, relativePath, value) {
  const absolutePath = join(evidenceRoot, relativePath);
  mkdirSync(dirname(absolutePath), { mode: 0o700, recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  writeFileSync(absolutePath, bytes, { mode: 0o600 });
  return Object.freeze({ bytes, digest: m251Sha256Bytes(bytes) });
}

function expectedOwners(stageId, rows) {
  return rows
    .filter((row) => row.stageId === stageId)
    .map(({ proofOwner }) => proofOwner)
    .sort();
}

function proofOwnerParts(owner) {
  const separator = owner.indexOf('#');
  return Object.freeze({
    owner,
    path: owner.slice(0, separator),
    marker: owner.slice(separator + 1),
  });
}

function ownersForPath(stageId, rows, path) {
  return expectedOwners(stageId, rows)
    .map(proofOwnerParts)
    .filter((owner) => owner.path === path)
    .map(({ owner }) => owner)
    .sort();
}

function executedProofTestNames(stageId, rows, output) {
  const markers = expectedOwners(stageId, rows)
    .map(proofOwnerParts)
    .filter(({ path }) => /(?:\.test\.(?:mjs|ts))$/u.test(path))
    .map(({ marker }) => marker);
  return sortedUnique(
    parseNodeTestNames(output).filter((testName) =>
      markers.some((marker) => testName.includes(marker)),
    ),
  );
}

function observedTestProofOwners(stageId, rows, executedProofTestNames) {
  return expectedOwners(stageId, rows)
    .map(proofOwnerParts)
    .filter(
      ({ path, marker }) =>
        /(?:\.test\.(?:mjs|ts))$/u.test(path) &&
        executedProofTestNames.some((testName) => testName.includes(marker)),
    )
    .map(({ owner }) => owner)
    .sort();
}

function sortedUnique(values) {
  return Object.freeze([...new Set(values)].sort());
}

function completeProofObservation(stageId, rows, observedProofOwners) {
  return JSON.stringify(observedProofOwners) === JSON.stringify(expectedOwners(stageId, rows));
}

function assertStageDefinitions(rows) {
  if (JSON.stringify(stageDefinitions.map(({ id }) => id)) !== JSON.stringify(M251_STAGE_ORDER)) {
    fail('M2.5.1 runner stage definitions differ from the canonical order');
  }
  for (const definition of stageDefinitions) {
    for (const owner of expectedOwners(definition.id, rows).map(proofOwnerParts)) {
      const absolutePath = resolve(repositoryRoot, owner.path);
      const stat = lstatSync(absolutePath);
      if (
        !sameOrWithin(absolutePath, repositoryRoot) ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        realpathSync(absolutePath) !== absolutePath
      ) {
        fail(`M2.5.1 proof owner ${owner.path} is not one exact repository file`);
      }
      const ownerSource = readFileSync(absolutePath, 'utf8');
      if (
        owner.path !== 'scripts/run-m2.5.1-acceptance.mjs' &&
        !ownerSource.includes(owner.marker)
      ) {
        fail(`M2.5.1 proof owner ${owner.path} does not declare its frozen marker`);
      }
    }
  }
}

function sourceGit(arguments_) {
  const result = run('git', arguments_, {
    timeoutMilliseconds: 30_000,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
    },
  });
  if (!successful(result)) fail('Git source identity command failed');
  return result.stdout ?? '';
}

function captureSourceManifest(evidenceRoot, side) {
  const relativeArtifactPath = `artifacts/source-${side}.json`;
  try {
    const paths = sourceGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      .split('\0')
      .filter((path) => path.length !== 0 && path !== M251_REVIEW_EXCLUSION)
      .sort();
    const entries = paths.map((path) => {
      const absolutePath = resolve(repositoryRoot, path);
      if (!existsSync(absolutePath)) {
        return Object.freeze({ path, kind: 'DELETED', contentDigest: null });
      }
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        return Object.freeze({
          path,
          kind: 'SYMLINK',
          contentDigest: m251Sha256Text(readlinkSync(absolutePath)),
        });
      }
      if (!stat.isFile()) fail('Git-listed M2.5.1 source is not a file or symbolic link');
      return Object.freeze({
        path,
        kind: (stat.mode & 0o111) === 0 ? 'REGULAR' : 'EXECUTABLE',
        contentDigest: m251Sha256Bytes(readFileSync(absolutePath)),
      });
    });
    const manifest = Object.freeze({
      schemaVersion: 1,
      kind: M251_SOURCE_PATH_MANIFEST_KIND,
      reviewExclusion: M251_REVIEW_EXCLUSION,
      entries: Object.freeze(entries),
    });
    const artifact = writeJsonArtifact(evidenceRoot, relativeArtifactPath, manifest);
    const digest = (() => {
      const hash = createHash('sha256');
      hash.update('codeclosure-source-manifest-v1\0', 'utf8');
      for (const entry of entries) {
        if (entry.kind === 'DELETED') {
          hash.update(`deleted\0${entry.path}\0`, 'utf8');
        } else {
          hash.update(
            `${entry.kind.toLowerCase()}\0${entry.path}\0${entry.contentDigest.slice(7)}\0`,
            'utf8',
          );
        }
      }
      return `sha256:${hash.digest('hex')}`;
    })();
    const status = sourceGit(['status', '--porcelain=v1']);
    const identity = Object.freeze({
      availability: 'AVAILABLE',
      baseGitRevision: sourceGit(['rev-parse', 'HEAD']).trim(),
      gitBranch: sourceGit(['branch', '--show-current']).trim() || 'DETACHED',
      workingTreeState: status.length === 0 ? 'clean' : 'modified',
      manifestSchema: 'codeclosure-source-manifest-v1',
      pathCount: entries.length,
      digest,
      reviewExclusion: M251_REVIEW_EXCLUSION,
    });
    return Object.freeze({
      identity,
      reference: Object.freeze({
        availability: 'AVAILABLE',
        artifactPath: relativeArtifactPath,
        artifactDigest: artifact.digest,
      }),
    });
  } catch {
    return Object.freeze({
      identity: Object.freeze({
        availability: 'UNAVAILABLE',
        reasonCode: `${side.toUpperCase()}_SOURCE_IDENTITY_UNAVAILABLE`,
      }),
      reference: Object.freeze({
        availability: 'UNAVAILABLE',
        reasonCode: `${side.toUpperCase()}_SOURCE_IDENTITY_UNAVAILABLE`,
      }),
    });
  }
}

function sameOrWithin(path, parent) {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function pathsOverlap(left, right) {
  return sameOrWithin(left, right) || sameOrWithin(right, left);
}

function assertPairwiseSeparated(paths) {
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      if (pathsOverlap(paths[left], paths[right])) {
        fail('M2.5.1 preflight roots are not pairwise separated');
      }
    }
  }
}

function exactRegularFile(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) fail(`${label} is unavailable`);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    fail(`${label} must be one exact regular file`);
  }
  return absolute;
}

function exactDirectory(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) fail(`${label} is unavailable`);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    fail(`${label} must be one exact directory`);
  }
  return absolute;
}

function removeExecutionRoot(path) {
  const exact = exactDirectory(path, 'Assessment execution root');
  const exactTemporaryRoot = realpathSync(tmpdir());
  if (dirname(exact) !== exactTemporaryRoot || !basename(exact).startsWith(executionRootPrefix)) {
    fail('Assessment execution root is outside its exact owned temporary boundary');
  }
  rmSync(exact, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 });
  if (existsSync(exact)) fail('Assessment execution root cleanup did not close');
}

function pathDigest(kind, path) {
  return Object.freeze({
    kind,
    pathDigest: m251Sha256Text(JSON.stringify(['m251-assessment-root-v1', path])),
  });
}

function comparableSourceIdentity(identity) {
  if (identity.availability === 'AVAILABLE') {
    return Object.freeze({
      baseGitRevision: identity.baseGitRevision,
      gitBranch: identity.gitBranch,
      workingTreeState: identity.workingTreeState,
      manifestSchema: identity.manifestSchema,
      pathCount: identity.pathCount,
      digest: identity.digest,
      reviewExclusion: identity.reviewExclusion,
    });
  }
  return identity;
}

function assertReceiptSource(receiptSource, openingSourceIdentity, label) {
  if (
    openingSourceIdentity.availability !== 'AVAILABLE' ||
    JSON.stringify(receiptSource.opening) !==
      JSON.stringify(comparableSourceIdentity(openingSourceIdentity)) ||
    JSON.stringify(receiptSource.closing) !== JSON.stringify(receiptSource.opening)
  ) {
    fail(`${label} differs from the canonical opening source identity`);
  }
}

function projectBaseline(projectPath, contract) {
  const git = (arguments_) => {
    const result = run('git', arguments_, {
      cwd: projectPath,
      timeoutMilliseconds: 30_000,
      env: {
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
        PATH: process.env.PATH ?? '/usr/bin:/bin',
      },
    });
    if (!successful(result)) fail('Demonstration project Git preflight failed');
    return (result.stdout ?? '').trim();
  };
  const observation = Object.freeze({
    gitCommit: git(['rev-parse', 'HEAD']),
    gitTree: git(['rev-parse', 'HEAD^{tree}']),
    workingTreeState: git(['status', '--porcelain=v2']).length === 0 ? 'clean' : 'modified',
  });
  if (
    observation.gitCommit !== contract.demonstration.gitCommit ||
    observation.gitTree !== contract.demonstration.gitTree ||
    observation.workingTreeState !== 'clean'
  ) {
    fail('Demonstration project differs from the frozen M2.5.1 baseline');
  }
  return observation;
}

async function preflightEvidence(input) {
  const { assessmentInputs, environment, arguments_, executionRoot, opening } = input;
  const { slice0Contract: contract, packageManifest } = assessmentInputs;
  if (process.env[liveAuthorizationEnvironment] !== '1') {
    if (process.env[liveAuthorizationEnvironment] === undefined) {
      return Object.freeze({
        outcome: M251AcceptanceOutcome.BLOCKED,
        authorization: Object.freeze({
          availability: 'UNAVAILABLE',
          reasonCode: 'AUTHORIZATION_NOT_PROVIDED',
        }),
        reasonCode: 'AUTHORIZATION_NOT_PROVIDED',
      });
    }
    return Object.freeze({
      outcome: M251AcceptanceOutcome.FAIL,
      authorization: Object.freeze({
        availability: 'UNAVAILABLE',
        reasonCode: 'AUTHORIZATION_INVALID',
      }),
      reasonCode: 'AUTHORIZATION_INVALID',
    });
  }
  try {
    validateM251AssessmentEnvironment(environment, assessmentInputs);
    if (arguments_.authSource === undefined || arguments_.project === undefined) {
      return Object.freeze({
        outcome: M251AcceptanceOutcome.BLOCKED,
        authorization: Object.freeze({ availability: 'EXPLICIT' }),
        reasonCode: 'REQUIRED_LIVE_BINDING_UNAVAILABLE',
      });
    }
    if (
      opening.identity.availability !== 'AVAILABLE' ||
      opening.reference.availability !== 'AVAILABLE'
    ) {
      fail('M2.5.1 opening source identity is unavailable');
    }
    const authSource = exactRegularFile(arguments_.authSource, 'Codex auth source');
    const projectPath = exactDirectory(arguments_.project, 'Demonstration project');
    const protectedCheck = exactRegularFile(protectedCheckPath, 'Protected Check asset');
    const credentialRoot = realpathSync(dirname(authSource));
    const protectedAssetRoot = realpathSync(dirname(protectedCheck));
    const exactExecutionRoot = exactDirectory(executionRoot, 'Assessment execution root');
    assertPairwiseSeparated([repositoryRoot, projectPath, credentialRoot, exactExecutionRoot]);
    const project = projectBaseline(projectPath, contract);
    const pnpmResult = run('corepack', ['pnpm', '--version'], { timeoutMilliseconds: 30_000 });
    if (
      !successful(pnpmResult) ||
      (pnpmResult.stdout ?? '').trim() !== packageManifest.engines.pnpm
    ) {
      fail('Corepack pnpm differs from the root toolchain contract');
    }
    const client = await import('../packages/codex-app-server-client/dist/index.js');
    const installation = client.verifyBundledCodexInstallation();
    const selected = contract.toolchain.selected;
    if (
      installation.profile.version !== selected.codexVersion ||
      installation.profile.snapshotProfile !== selected.snapshotProfile ||
      installation.profile.snapshotDigest !== selected.snapshotDigest ||
      installation.profile.launcherDigest !== selected.launcherDigest ||
      installation.profile.delegatedExecutableDigest !== selected.delegatedExecutableDigest
    ) {
      fail('Installed Codex differs from the frozen M2.5.1 toolchain');
    }
    const bindingRootPaths = Object.freeze({
      SOURCE_CHECKOUT: repositoryRoot,
      DEMONSTRATION_PROJECT: projectPath,
      CREDENTIAL_ROOT: credentialRoot,
      PROTECTED_ASSET_ROOT: protectedAssetRoot,
      EXECUTION_ROOT: exactExecutionRoot,
    });
    return Object.freeze({
      outcome: M251AcceptanceOutcome.PASS,
      authorization: Object.freeze({ availability: 'EXPLICIT' }),
      bindings: Object.freeze({ authSource, projectPath }),
      evidence: Object.freeze({
        environment: Object.freeze({
          nodeVersion: environment.nodeVersion,
          pnpmVersion: environment.pnpmVersion,
          packageManager: environment.packageManager,
          lockfileDigest: environment.lockfileDigest,
        }),
        openingSource: Object.freeze({
          identityDigest: opening.identity.digest,
          artifactDigest: opening.reference.artifactDigest,
        }),
        selectedToolchain: Object.freeze({ ...selected }),
        retainedHistoricalToolchain: Object.freeze({ ...contract.toolchain.retainedHistorical }),
        project,
        bindingRoots: Object.freeze(
          M251_PREFLIGHT_BINDING_ROOT_KINDS.map((kind) => pathDigest(kind, bindingRootPaths[kind])),
        ),
        candidateAuthorityAllocated: false,
      }),
    });
  } catch {
    return Object.freeze({
      outcome: M251AcceptanceOutcome.BLOCKED,
      authorization: Object.freeze({ availability: 'EXPLICIT' }),
      reasonCode: 'PREFLIGHT_BINDING_UNAVAILABLE',
    });
  }
}

function assessmentEnvironment(inputs) {
  const {
    slice0Contract: contract,
    slice0ContractDigest,
    packageManifest,
    lockfileDigest,
  } = inputs;
  return Object.freeze({
    nodeVersion: process.version,
    pnpmVersion: packageManifest.engines.pnpm,
    packageManager: packageManifest.packageManager,
    lockfileDigest,
    slice0ContractId: contract.contractId,
    slice0ContractVersion: contract.contractVersion,
    slice0ContractDigest,
    selectedToolchain: Object.freeze({ ...contract.toolchain.selected }),
  });
}

function stageEnvironment(definition, executionRoot, bindings) {
  const stageTemporaryRoot = join(executionRoot, 'stages', definition.id);
  mkdirSync(stageTemporaryRoot, { mode: 0o700, recursive: true });
  const environment = {
    ...process.env,
    CI: '1',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CODECLOSURE_NODE_TEST_EVIDENCE: '1',
    TMPDIR: stageTemporaryRoot,
    TMP: stageTemporaryRoot,
    TEMP: stageTemporaryRoot,
  };
  if (bindings !== undefined) {
    environment.CODECLOSURE_M2_AUTH_SOURCE = bindings.authSource;
  }
  if (definition.id === M251AcceptanceStage.M2_REGRESSION) {
    environment.CODECLOSURE_M2_REVIEW_EXCLUSION = M251_REVIEW_EXCLUSION;
    environment.CODECLOSURE_M2_LIVE_AUTHORIZED = '1';
  }
  if (definition.id === M251AcceptanceStage.M25_REGRESSION) {
    environment.CODECLOSURE_M25_REVIEW_EXCLUSION = M251_REVIEW_EXCLUSION;
    environment.CODECLOSURE_M2_LIVE_AUTHORIZED = '1';
  }
  return environment;
}

function parseOneJsonDocument(output, expectedKind, label) {
  let value;
  try {
    value = parseJsonRejectingDuplicateKeys(output.trim(), label);
  } catch {
    fail(`${label} did not emit one unique-key JSON document`);
  }
  if (value.kind !== expectedKind) fail(`${label} emitted an unexpected receipt kind`);
  return value;
}

function parseM25RegressionResult(output) {
  const candidates = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const value = parseJsonRejectingDuplicateKeys(trimmed, 'M2.5 regression result');
      if (value.kind === 'M25_CURRENT_SOURCE_REGRESSION_RESULT') candidates.push(value);
    } catch {
      // Non-result command output is not retained by the enclosing assessment.
    }
  }
  if (candidates.length !== 1) fail('M2.5 regression emitted no unique structured result');
  return candidates[0];
}

function summarizeM25Regression(result, openingSourceIdentity) {
  if (
    result.schemaVersion !== 1 ||
    result.outcome !== M25AcceptanceOutcome.PASS ||
    result.assessmentMeaning !== 'READY_FOR_INDEPENDENT_REVIEW' ||
    result.reviewExclusion !== M251_REVIEW_EXCLUSION ||
    result.claimScope !== 'CURRENT_SOURCE_M2_5_REGRESSION_BASELINE' ||
    result.canonicalCommand !== 'corepack pnpm regress:m2.5' ||
    result.historicalM25MilestoneVerdictReissued !== false ||
    result.milestoneStatusMutationAuthorized !== false ||
    result.independentReviewRequired !== false ||
    typeof result.evidenceDirectory !== 'string' ||
    typeof result.evidenceManifest !== 'string'
  ) {
    fail('M2.5 current-source regression result weakened its non-verdict contract');
  }
  const evidenceDirectory = realpathSync(result.evidenceDirectory);
  const manifestPath = realpathSync(result.evidenceManifest);
  if (
    dirname(manifestPath) !== evidenceDirectory ||
    lstatSync(manifestPath).isSymbolicLink() ||
    !lstatSync(manifestPath).isFile()
  ) {
    fail('M2.5 regression evidence manifest is outside its owned evidence root');
  }
  const manifestBytes = readFileSync(manifestPath);
  const manifest = parseJsonRejectingDuplicateKeys(
    manifestBytes.toString('utf8'),
    'M2.5 regression evidence manifest',
  );
  validateM25EvidenceManifest(
    manifest,
    (artifactPath) => readFileSync(join(evidenceDirectory, artifactPath)),
    { reviewExclusion: M251_REVIEW_EXCLUSION },
  );
  if (
    manifest.outcome !== M25AcceptanceOutcome.PASS ||
    openingSourceIdentity.availability !== 'AVAILABLE' ||
    !m25SourceIdentitiesMatch(manifest.openingSourceIdentity, openingSourceIdentity) ||
    !m25SourceIdentitiesMatch(manifest.closingSourceIdentity, openingSourceIdentity)
  ) {
    fail('M2.5 regression does not bind the enclosing source identity');
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: result.kind,
    outcome: result.outcome,
    reviewExclusion: result.reviewExclusion,
    matrixContractDigest: manifest.matrixContractDigest,
    manifestDigest: m251Sha256Bytes(manifestBytes),
    stageCount: manifest.stages.length,
    matrixRowCount: manifest.matrixResults.length,
    historicalM25MilestoneVerdictReissued: false,
  });
}

function testCounts(output, requireTests, fallbackCount) {
  const summaries = parseNodeTestSummaries(output, { requireTests });
  if (summaries.length === 0) return passingCounts(fallbackCount);
  return passingCounts(summaries.reduce((total, summary) => total + summary.tests, 0));
}

function stageArtifact(stage, evidence, reasonCode) {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'CODECLOSURE_M2_5_1_STAGE_EVIDENCE_V1',
    stageId: stage.id,
    commandId: stage.commandId,
    commandDigest: stage.commandDigest,
    durationMilliseconds: stage.durationMilliseconds,
    exitCode: stage.exitCode,
    outcome: stage.outcome,
    counts: stage.counts,
    safeWarningCodes: stage.safeWarningCodes,
    observedProofOwners: stage.observedProofOwners,
    executedProofTestNames: stage.executedProofTestNames,
    evidence,
    reasonCode: reasonCode ?? null,
    privacy: Object.freeze({
      rawCommandOutputRetained: false,
      rawExceptionRetained: false,
      rawUserOrModelContentRetained: false,
      credentialOrAccountContentRetained: false,
      sourceBytesRetained: false,
    }),
  });
}

function materializeStage(
  definition,
  rows,
  evidenceRoot,
  outcome,
  counts,
  evidence,
  reasonCode,
  observedProofOwners = [],
  executedProofTestNames = [],
  exitCode,
  durationMilliseconds = 0,
  commands = definition.commands,
) {
  const owners = sortedUnique(observedProofOwners);
  const testNames = sortedUnique(executedProofTestNames);
  const resolvedExitCode =
    exitCode ??
    (outcome === M251AcceptanceOutcome.PASS
      ? 0
      : outcome === M251AcceptanceOutcome.BLOCKED
        ? 2
        : 1);
  const stage = Object.freeze({
    id: definition.id,
    outcome,
    commandId: definition.commandId,
    commandDigest: commandDigest(definition, commands),
    durationMilliseconds,
    exitCode: resolvedExitCode,
    counts,
    safeWarningCodes: Object.freeze([]),
    observedProofOwners: owners,
    executedProofTestNames: testNames,
  });
  const relativeArtifactPath = artifactPathForStage(definition.id);
  const artifact = writeJsonArtifact(
    evidenceRoot,
    relativeArtifactPath,
    stageArtifact(stage, evidence, reasonCode),
  );
  return Object.freeze({
    ...stage,
    artifactPath: relativeArtifactPath,
    artifactDigest: artifact.digest,
  });
}

function blockedStage(definition, rows, evidenceRoot, reasonCode) {
  return materializeStage(
    definition,
    rows,
    evidenceRoot,
    M251AcceptanceOutcome.BLOCKED,
    blockedCounts(),
    Object.freeze({ availability: 'UNAVAILABLE' }),
    reasonCode,
    [],
    [],
    2,
  );
}

function materializePreflightStage(
  definition,
  rows,
  evidenceRoot,
  preflight,
  executedStages,
  durationMilliseconds,
) {
  if (preflight.outcome !== M251AcceptanceOutcome.PASS) {
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      preflight.outcome,
      preflight.outcome === M251AcceptanceOutcome.FAIL ? failedCounts() : blockedCounts(),
      preflight.evidence ?? Object.freeze({ availability: 'UNAVAILABLE' }),
      preflight.reasonCode,
      [],
      [],
      preflight.outcome === M251AcceptanceOutcome.FAIL ? 1 : 2,
      durationMilliseconds,
    );
  }
  try {
    if (!m251PreflightProofSupportSatisfied(executedStages)) {
      return materializeStage(
        definition,
        rows,
        evidenceRoot,
        M251AcceptanceOutcome.BLOCKED,
        blockedCounts(),
        Object.freeze({ earlyGatePassed: true, proofSupportAvailable: false }),
        'PREFLIGHT_PROOF_DEPENDENCY_NOT_SATISFIED',
        [],
        [],
        2,
        durationMilliseconds,
      );
    }
    const evidence = projectM251PreflightProofEvidence(preflight.evidence, executedStages);
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.PASS,
      passingCounts(expectedOwners(definition.id, rows).length),
      evidence,
      undefined,
      expectedOwners(definition.id, rows),
      [],
      0,
      durationMilliseconds,
    );
  } catch {
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.FAIL,
      failedCounts(),
      Object.freeze({ earlyGatePassed: true, proofSupportRejected: true }),
      'PREFLIGHT_PROOF_EVIDENCE_REJECTED',
      [],
      [],
      1,
      durationMilliseconds,
    );
  }
}

function runCommandStage(
  definition,
  rows,
  evidenceRoot,
  executionRoot,
  bindings,
  openingSourceIdentity,
) {
  const started = Date.now();
  const environment = stageEnvironment(definition, executionRoot, bindings);
  const outputs = [];
  let failure;
  for (const [index, command] of definition.commands.entries()) {
    const [executable, ...arguments_] = command;
    log(`RUN ${definition.id} command ${String(index + 1)}/${String(definition.commands.length)}`);
    const result = run(executable, arguments_, { env: environment });
    outputs.push(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    if (!successful(result)) {
      failure = Object.freeze({
        commandIndex: index,
        exitCode: result.status,
        signalObserved: result.signal !== null,
        launchErrorObserved: result.error !== undefined,
      });
      break;
    }
  }
  const output = outputs.join('\n');
  const proofTestNames = executedProofTestNames(definition.id, rows, output);
  const testProofOwners = observedTestProofOwners(definition.id, rows, proofTestNames);
  if (failure !== undefined) {
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      failure.exitCode === 2 ? M251AcceptanceOutcome.BLOCKED : M251AcceptanceOutcome.FAIL,
      failure.exitCode === 2 ? blockedCounts() : failedCounts(),
      failure,
      failure.exitCode === 2 ? 'COMMAND_BLOCKED' : 'COMMAND_FAILED',
      testProofOwners,
      proofTestNames,
      failure.exitCode === 2 ? 2 : 1,
      Date.now() - started,
    );
  }
  try {
    let evidence = Object.freeze({ commandCount: definition.commands.length });
    let counts = testCounts(output, definition.requireTests, definition.commands.length);
    let observedProofOwners = [...testProofOwners];
    if (definition.id === M251AcceptanceStage.M2_REGRESSION) {
      const result = parseM2CurrentSourceRegressionResult(output, openingSourceIdentity);
      if (result.verdict !== M2AcceptanceOutcome.PASS)
        fail('M2 current-source regression did not pass');
      evidence = result;
      counts = passingCounts(result.tests.tests);
      observedProofOwners.push(
        ...ownersForPath(definition.id, rows, 'scripts/run-m2.5.1-acceptance.mjs'),
      );
    } else if (definition.id === M251AcceptanceStage.M25_REGRESSION) {
      evidence = summarizeM25Regression(parseM25RegressionResult(output), openingSourceIdentity);
      counts = passingCounts(evidence.matrixRowCount);
      observedProofOwners.push(
        ...ownersForPath(definition.id, rows, 'scripts/run-m2.5.1-acceptance.mjs'),
      );
    } else if (
      [
        M251AcceptanceStage.QUALITY,
        M251AcceptanceStage.M1_REGRESSION,
        M251AcceptanceStage.SOURCE_CLOSURE,
      ].includes(definition.id)
    ) {
      observedProofOwners.push(
        ...ownersForPath(definition.id, rows, 'scripts/run-m2.5.1-acceptance.mjs').filter(
          (owner) =>
            definition.id !== M251AcceptanceStage.SOURCE_CLOSURE ||
            owner.endsWith('#documentation-consistency'),
        ),
      );
    }
    observedProofOwners = sortedUnique(observedProofOwners);
    if (
      definition.id !== M251AcceptanceStage.SOURCE_CLOSURE &&
      !completeProofObservation(definition.id, rows, observedProofOwners)
    ) {
      return materializeStage(
        definition,
        rows,
        evidenceRoot,
        M251AcceptanceOutcome.FAIL,
        failedCounts(),
        Object.freeze({
          commandCount: definition.commands.length,
          proofOwnerCoverageRejected: true,
        }),
        'PROOF_OWNER_NOT_OBSERVED',
        observedProofOwners,
        proofTestNames,
        1,
        Date.now() - started,
      );
    }
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.PASS,
      counts,
      evidence,
      undefined,
      observedProofOwners,
      proofTestNames,
      0,
      Date.now() - started,
    );
  } catch {
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.FAIL,
      failedCounts(),
      Object.freeze({ validationFailureObserved: true }),
      'COMMAND_EVIDENCE_REJECTED',
      testProofOwners,
      proofTestNames,
      1,
      Date.now() - started,
    );
  }
}

function runLiveIntakeStage(
  definition,
  rows,
  evidenceRoot,
  executionRoot,
  bindings,
  openingSourceIdentity,
) {
  const started = Date.now();
  const command = Object.freeze([
    process.execPath,
    'scripts/run-m2.5.1-live-intake.mjs',
    '--auth-source',
    bindings.authSource,
    '--review-exclusion',
    M251_REVIEW_EXCLUSION,
  ]);
  const environment = {
    ...stageEnvironment(definition, executionRoot, bindings),
    CODECLOSURE_M251_LIVE_AUTHORIZED: '1',
  };
  log(`RUN ${definition.id}`);
  const result = run(command[0], command.slice(1), { env: environment });
  if (!successful(result)) {
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.FAIL,
      failedCounts(),
      Object.freeze({ liveFailureObserved: true }),
      'LIVE_INTAKE_FAILED',
      [],
      [],
      1,
      Date.now() - started,
      [command],
    );
  }
  try {
    const receipt = parseOneJsonDocument(
      result.stdout ?? '',
      M251_LIVE_INTAKE_RECEIPT_KIND,
      'Live Intake receipt',
    );
    validateM251LiveReceipt(receipt, M251_REVIEW_EXCLUSION);
    assertReceiptSource(receipt.source, openingSourceIdentity, 'Live Intake source identity');
    assertM251MetadataOnly(receipt, [bindings.authSource]);
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.PASS,
      passingCounts(expectedOwners(definition.id, rows).length),
      Object.freeze({ receipt }),
      undefined,
      expectedOwners(definition.id, rows),
      [],
      0,
      Date.now() - started,
      [command],
    );
  } catch {
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.FAIL,
      failedCounts(),
      Object.freeze({ receiptRejected: true }),
      'LIVE_INTAKE_RECEIPT_REJECTED',
      [],
      [],
      1,
      Date.now() - started,
      [command],
    );
  }
}

function runLiveCompositionStage(
  definition,
  rows,
  evidenceRoot,
  executionRoot,
  bindings,
  openingSourceIdentity,
) {
  const started = Date.now();
  const commands = Object.freeze([
    Object.freeze([
      process.execPath,
      'scripts/run-m2.5.1-live-containment.mjs',
      '--auth-source',
      bindings.authSource,
      '--project',
      bindings.projectPath,
      '--review-exclusion',
      M251_REVIEW_EXCLUSION,
    ]),
    Object.freeze([
      process.execPath,
      'scripts/run-m2.5.1-live-composition.mjs',
      '--auth-source',
      bindings.authSource,
      '--project',
      bindings.projectPath,
      '--review-exclusion',
      M251_REVIEW_EXCLUSION,
    ]),
  ]);
  const environments = [
    {
      ...stageEnvironment(definition, executionRoot, bindings),
      CODECLOSURE_M251_CONTAINMENT_LIVE_AUTHORIZED: '1',
    },
    {
      ...stageEnvironment(definition, executionRoot, bindings),
      CODECLOSURE_M251_COMPOSITION_LIVE_AUTHORIZED: '1',
    },
  ];
  const outputs = [];
  for (const [index, command] of commands.entries()) {
    log(`RUN ${definition.id} command ${String(index + 1)}/2`);
    const result = run(command[0], command.slice(1), { env: environments[index] });
    if (!successful(result)) {
      return materializeStage(
        definition,
        rows,
        evidenceRoot,
        M251AcceptanceOutcome.FAIL,
        failedCounts(),
        Object.freeze({ commandIndex: index, liveFailureObserved: true }),
        'LIVE_COMPOSITION_FAILED',
        [],
        [],
        1,
        Date.now() - started,
        commands,
      );
    }
    outputs.push(result.stdout ?? '');
  }
  try {
    const containment = parseOneJsonDocument(
      outputs[0],
      M251_LIVE_CONTAINMENT_RECEIPT_KIND,
      'Live containment receipt',
    );
    validateM251LiveContainmentReceipt(
      containment,
      {
        source: containment.source,
        toolchainIdentity: containment.toolchainIdentity,
        profileIdentity: containment.profileIdentity,
        projectIdentity: containment.projectIdentity,
        rootIdentity: containment.rootIdentity,
      },
      M251_REVIEW_EXCLUSION,
    );
    assertReceiptSource(
      containment.source,
      openingSourceIdentity,
      'Live containment source identity',
    );
    const composition = parseOneJsonDocument(
      outputs[1],
      M251_LIVE_COMPOSITION_RECEIPT_KIND,
      'Live composition receipt',
    );
    validateM251LiveCompositionReceipt(
      composition,
      {
        source: composition.source.opening,
        project: composition.projectClosure.opening,
        roots: composition.roots,
        profile: composition.profile,
      },
      M251_REVIEW_EXCLUSION,
    );
    assertReceiptSource(
      composition.source,
      openingSourceIdentity,
      'Live composition source identity',
    );
    assertM251LiveContainmentMetadataOnly(containment, [bindings.authSource, bindings.projectPath]);
    assertM251LiveCompositionMetadataOnly(composition, [bindings.authSource, bindings.projectPath]);
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.PASS,
      passingCounts(expectedOwners(definition.id, rows).length),
      Object.freeze({ containment, composition }),
      undefined,
      expectedOwners(definition.id, rows),
      [],
      0,
      Date.now() - started,
      commands,
    );
  } catch {
    return materializeStage(
      definition,
      rows,
      evidenceRoot,
      M251AcceptanceOutcome.FAIL,
      failedCounts(),
      Object.freeze({ receiptRejected: true }),
      'LIVE_COMPOSITION_RECEIPT_REJECTED',
      [],
      [],
      1,
      Date.now() - started,
      commands,
    );
  }
}

function privacyProjection() {
  return Object.freeze({
    userContentRetained: false,
    assistantOrModelContentRetained: false,
    credentialOrAccountContentRetained: false,
    reasoningOrTranscriptRetained: false,
    rawProtocolRetained: false,
    rawExceptionRetained: false,
    sourceBytesRetained: false,
    unrestrictedCommandOutputRetained: false,
  });
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const packageManifest = readUniqueJson(packageManifestPath, 'package.json');
  const slice0ContractBytes = readFileSync(slice0ContractPath);
  const contract = parseJsonRejectingDuplicateKeys(
    slice0ContractBytes.toString('utf8'),
    'M2.5.1 Slice 0 contract',
  );
  const acceptancePlan = readFileSync(acceptancePlanPath, 'utf8');
  const rows = parseM251AcceptanceMatrix(acceptancePlan, contract.proofOwners);
  assertStageDefinitions(rows);
  const evidenceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m2-5-1-acceptance-')));
  const executionRoot = realpathSync(mkdtempSync(join(tmpdir(), executionRootPrefix)));
  let executionRootRemoved = false;
  try {
    mkdirSync(join(evidenceRoot, 'artifacts'), { mode: 0o700 });
    const opening = captureSourceManifest(evidenceRoot, 'opening');
    const lockfileDigest = m251Sha256Bytes(readFileSync(lockfilePath));
    const assessmentInputs = Object.freeze({
      slice0Contract: contract,
      slice0ContractDigest: m251Sha256Bytes(slice0ContractBytes),
      packageManifest,
      lockfileDigest,
    });
    const environment = assessmentEnvironment(assessmentInputs);
    const preflightDefinition = stageDefinitions[0];
    const started = Date.now();
    const preflight = await preflightEvidence({
      assessmentInputs,
      environment,
      arguments_,
      executionRoot,
      opening,
    });
    const preflightDurationMilliseconds = Date.now() - started;
    const stages = [];
    let priorPassed = preflight.outcome === M251AcceptanceOutcome.PASS;
    for (const definition of stageDefinitions.slice(1, -1)) {
      if (!priorPassed) {
        stages.push(blockedStage(definition, rows, evidenceRoot, 'PRIOR_STAGE_NOT_SATISFIED'));
        continue;
      }
      let stage;
      if (definition.id === M251AcceptanceStage.LIVE_INTAKE) {
        stage = runLiveIntakeStage(
          definition,
          rows,
          evidenceRoot,
          executionRoot,
          preflight.bindings,
          opening.identity,
        );
      } else if (definition.id === M251AcceptanceStage.LIVE_COMPOSITION) {
        stage = runLiveCompositionStage(
          definition,
          rows,
          evidenceRoot,
          executionRoot,
          preflight.bindings,
          opening.identity,
        );
      } else {
        stage = runCommandStage(
          definition,
          rows,
          evidenceRoot,
          executionRoot,
          preflight.bindings,
          opening.identity,
        );
      }
      stages.push(stage);
      priorPassed = stage.outcome === M251AcceptanceOutcome.PASS;
    }
    stages.unshift(
      materializePreflightStage(
        preflightDefinition,
        rows,
        evidenceRoot,
        preflight,
        stages,
        preflightDurationMilliseconds,
      ),
    );
    const sourceDefinition = stageDefinitions.at(-1);
    const documentationStage = priorPassed
      ? runCommandStage(
          sourceDefinition,
          rows,
          evidenceRoot,
          executionRoot,
          preflight.bindings,
          opening.identity,
        )
      : undefined;
    const closing = captureSourceManifest(evidenceRoot, 'closing');
    removeExecutionRoot(executionRoot);
    executionRootRemoved = true;
    const sourceDrifted =
      !m251SourceIdentitiesMatch(opening.identity, closing.identity) ||
      opening.reference.artifactDigest !== closing.reference.artifactDigest;
    if (!priorPassed) {
      const counts = blockedCounts();
      if (sourceDrifted) counts.sourceDrift = 1;
      stages.push(
        materializeStage(
          sourceDefinition,
          rows,
          evidenceRoot,
          M251AcceptanceOutcome.BLOCKED,
          counts,
          Object.freeze({
            documentationCheckExecuted: false,
            executionRootRemoved: true,
            sourceDriftObserved: counts.sourceDrift === 1,
          }),
          'PRIOR_STAGE_NOT_SATISFIED',
          [],
          [],
          2,
        ),
      );
    } else if (documentationStage.outcome !== M251AcceptanceOutcome.PASS) {
      stages.push(
        materializeStage(
          sourceDefinition,
          rows,
          evidenceRoot,
          documentationStage.outcome,
          sourceDrifted
            ? Object.freeze({ ...documentationStage.counts, sourceDrift: 1 })
            : documentationStage.counts,
          Object.freeze({
            documentationCheckExecuted: true,
            documentationCheckPassed: false,
            executionRootRemoved: true,
            sourceDriftObserved: sourceDrifted,
          }),
          documentationStage.outcome === M251AcceptanceOutcome.BLOCKED
            ? 'DOCUMENTATION_CHECK_BLOCKED'
            : 'DOCUMENTATION_CHECK_FAILED',
          documentationStage.observedProofOwners,
          documentationStage.executedProofTestNames,
          documentationStage.exitCode,
          documentationStage.durationMilliseconds,
        ),
      );
    } else if (sourceDrifted) {
      const driftCounts = blockedCounts();
      driftCounts.sourceDrift = 1;
      stages.push(
        materializeStage(
          sourceDefinition,
          rows,
          evidenceRoot,
          M251AcceptanceOutcome.BLOCKED,
          driftCounts,
          Object.freeze({
            documentationCheckExecuted: true,
            documentationCheckPassed: true,
            executionRootRemoved: true,
            sourceDriftObserved: true,
          }),
          'SOURCE_IDENTITY_DRIFTED',
          documentationStage.observedProofOwners,
          documentationStage.executedProofTestNames,
          2,
          documentationStage.durationMilliseconds,
        ),
      );
    } else {
      stages.push(
        materializeStage(
          sourceDefinition,
          rows,
          evidenceRoot,
          M251AcceptanceOutcome.PASS,
          documentationStage.counts,
          Object.freeze({
            documentationCheckExecuted: true,
            documentationCheckPassed: true,
            executionRootRemoved: true,
            sourceIdentityClosed: true,
          }),
          undefined,
          expectedOwners(sourceDefinition.id, rows),
          documentationStage.executedProofTestNames,
          0,
          documentationStage.durationMilliseconds,
        ),
      );
    }
    const matrixResults = buildM251MatrixResults(rows, stages);
    const outcome = m251AssessmentOutcome(matrixResults);
    const manifest = Object.freeze({
      schemaVersion: 1,
      kind: 'CODECLOSURE_M2_5_1_EXECUTABLE_ASSESSMENT_V1',
      assessmentMeaning:
        outcome === M251AcceptanceOutcome.PASS
          ? M251AssessmentMeaning.READY
          : M251AssessmentMeaning.NOT_READY,
      reviewExclusion: M251_REVIEW_EXCLUSION,
      authorization: preflight.authorization,
      environment,
      matrixContractDigest: M251_ACCEPTANCE_MATRIX_CONTRACT_DIGEST,
      openingSourceIdentity: opening.identity,
      closingSourceIdentity: closing.identity,
      sourceManifests: Object.freeze({ opening: opening.reference, closing: closing.reference }),
      stages: Object.freeze(stages),
      matrixResults,
      outcome,
      nonClaims: M251_REQUIRED_NON_CLAIMS,
      privacy: privacyProjection(),
    });
    let finalOutcome = outcome;
    try {
      validateM251EvidenceManifest(manifest, {
        acceptancePlanMarkdown: acceptancePlan,
        slice0ContractBytes,
        packageManifest,
        lockfileDigest,
        readArtifact: (artifactPath) => readFileSync(join(evidenceRoot, artifactPath)),
      });
    } catch {
      finalOutcome = M251AcceptanceOutcome.FAIL;
    }
    const manifestPath = join(evidenceRoot, 'evidence-manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const result = Object.freeze({
      schemaVersion: 1,
      kind: 'CODECLOSURE_M2_5_1_EXECUTABLE_ASSESSMENT_RESULT_V1',
      outcome: finalOutcome,
      assessmentMeaning:
        finalOutcome === M251AcceptanceOutcome.PASS
          ? M251AssessmentMeaning.READY
          : M251AssessmentMeaning.NOT_READY,
      evidenceDirectory: evidenceRoot,
      evidenceManifest: manifestPath,
      reviewExclusion: M251_REVIEW_EXCLUSION,
      milestoneStatusMutationAuthorized: false,
      independentReviewRequired: true,
      stageOrder: M251_STAGE_ORDER,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode =
      finalOutcome === M251AcceptanceOutcome.PASS
        ? 0
        : finalOutcome === M251AcceptanceOutcome.BLOCKED
          ? 2
          : 1;
  } finally {
    if (!executionRootRemoved && existsSync(executionRoot)) removeExecutionRoot(executionRoot);
  }
}

await main();
