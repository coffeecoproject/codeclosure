import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  CandidateGenerationState,
  aggregateVersion,
  applyCandidateEvent,
  attemptId,
  candidateGenerationId,
  candidateId,
  commandId,
  createCandidateGeneration,
  decideCandidate,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  projectSourceReadAuthorityId,
  sha256Digest,
  workflowId,
  workflowVersion,
  type CandidateGeneration,
  type CandidateStateChanged,
  type FrozenCandidateGeneration,
} from '@codeclosure/domain';
import {
  CandidateWorkspaceAccessMode,
  CandidatePreparationDisposition,
  CandidateWorkspaceRetention,
  candidateChangesStayWithinAllowedPaths,
  candidateWorkspaceAllowedPathProjection,
  candidateWorkspaceAuthorityProjection,
  decodeCandidateFreezeObservation,
  decodeCandidateFreezeObservationV2,
  decodeCandidatePreparation,
  decodeCandidatePreparationV2,
  decodeCandidateRepairPreparation,
  decodeCandidateWorkspaceAuthoritySnapshot,
  decodeCandidateWorkspaceLease,
  decodeFrozenCandidateIntegrityObservation,
  digestCandidateWorkspaceValue,
  type CandidateFreezeRequestV2,
  type CandidateWorkspaceAuthoritySnapshot,
  type CandidateWorkspaceExpectedGeneration,
  type CandidateWorkspaceLease,
} from '@codeclosure/runtime';
import {
  LocalCandidateWorkspaceError,
  LocalCandidateWorkspaceFailureCode,
  WorkspaceReconciliationClassification,
  createLocalCandidateWorkspace,
  observeLocalCandidateSourceIdentity,
  type LocalCandidateWorkspace,
} from '@codeclosure/workspace-local';
import {
  assertPortableCandidatePathSetForTesting,
  captureProjectReadSourceSnapshotForTesting,
  createLocalCandidateWorkspaceForTesting,
  type CandidateWorkspaceFaultHooks,
} from '@codeclosure/workspace-local/testing';

const createdAt = isoTimestamp('2026-07-31T10:00:00.000Z');
const freezeStartedAt = isoTimestamp('2026-07-31T10:00:00.001Z');
const freezeCompletedAt = isoTimestamp('2026-07-31T10:00:00.002Z');

interface Fixture {
  readonly authorityRoot: string;
  readonly root: string;
  readonly sourceRoot: string;
  readonly workspace: LocalCandidateWorkspace;
  readonly workspaceRoot: string;
}

function git(root: string, arguments_: readonly string[]): string {
  return execFileSync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initializeSource(sourceRoot: string): void {
  mkdirSync(join(sourceRoot, 'src'), { recursive: true });
  mkdirSync(join(sourceRoot, 'scripts'));
  writeFileSync(join(sourceRoot, '.gitignore'), 'ignored.log\n');
  writeFileSync(join(sourceRoot, 'README.md'), '# fixture\n');
  writeFileSync(join(sourceRoot, 'src', 'order.ts'), 'export const charge = "once";\n');
  writeFileSync(join(sourceRoot, 'scripts', 'tool.sh'), '#!/bin/sh\necho fixture\n');
  chmodSync(join(sourceRoot, 'scripts', 'tool.sh'), 0o755);
  git(sourceRoot, ['init', '--quiet']);
  git(sourceRoot, ['config', 'user.name', 'CodeClosure Test']);
  git(sourceRoot, ['config', 'user.email', 'codeclosure@example.invalid']);
  git(sourceRoot, ['add', '.']);
  git(sourceRoot, ['commit', '--quiet', '-m', 'fixture']);
  writeFileSync(join(sourceRoot, 'src', 'order.ts'), 'export const charge = "dirty-once";\n');
  writeFileSync(join(sourceRoot, 'src', 'note.txt'), 'untracked note\n');
  writeFileSync(join(sourceRoot, 'ignored.log'), 'must not copy\n');
}

function removeFixtureRoot(root: string): void {
  if (!existsSync(root)) {
    return;
  }
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    const stat = lstatSync(current);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      chmodSync(current, 0o700);
      for (const name of readdirSync(current)) {
        pending.push(join(current, name));
      }
    } else if (stat.isFile()) {
      chmodSync(current, 0o600);
    }
  }
  rmSync(root, { force: true, recursive: true });
}

function fixture(t: TestContext, hooks: CandidateWorkspaceFaultHooks = {}): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-workspace-local-')));
  t.after(() => removeFixtureRoot(root));
  const sourceRoot = join(root, 'source');
  const workspaceRoot = join(root, 'workspace');
  const authorityRoot = join(root, 'authority');
  mkdirSync(sourceRoot);
  mkdirSync(authorityRoot);
  initializeSource(sourceRoot);
  const options = {
    authorityRoots: Object.freeze([realpathSync(authorityRoot)]),
    ownerId: 'workspace-owner_test',
    workspaceRoot,
  } as const;
  return {
    authorityRoot,
    root,
    sourceRoot,
    workspace:
      Object.keys(hooks).length === 0
        ? createLocalCandidateWorkspace(options)
        : createLocalCandidateWorkspaceForTesting(options, hooks),
    workspaceRoot,
  };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedGeneration(
  generation: CandidateGeneration,
  suffix: string,
  retention: CandidateWorkspaceExpectedGeneration['retention'] = CandidateWorkspaceRetention.CURRENT,
): CandidateWorkspaceExpectedGeneration {
  return Object.freeze({
    generation,
    goalId: goalId(`goal_${suffix}`),
    goalRevision: goalRevision(1),
    retention,
    workflowId: workflowId(`workflow_${suffix}`),
    workflowVersion: workflowVersion(1),
  });
}

function authoritySnapshot(
  label: string,
  expectedGenerations: readonly CandidateWorkspaceExpectedGeneration[] = Object.freeze([]),
  authoritySequence = 1,
): CandidateWorkspaceAuthoritySnapshot {
  const sorted = Object.freeze(
    [...expectedGenerations].sort((left, right) =>
      left.generation.id.localeCompare(right.generation.id),
    ),
  );
  const withoutDigest = Object.freeze({
    authoritySequence,
    expectedGenerations: sorted,
    id: `workspace-authority_${label}_${String(authoritySequence)}`,
    issuedAt: freezeCompletedAt,
    schemaVersion: 1,
  } as const);
  return decodeCandidateWorkspaceAuthoritySnapshot({
    ...withoutDigest,
    authorityDigest: digestCandidateWorkspaceValue(
      candidateWorkspaceAuthorityProjection(withoutDigest),
    ),
  });
}

function directoryProjection(root: string): string {
  const entries: { readonly digest: string; readonly mode: string; readonly path: string }[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const relativePath = relative(root, path).split('\\').join('/');
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        pending.push(path);
      } else if (stat.isSymbolicLink()) {
        entries.push({ digest: sha256(readlinkSync(path)), mode: 'SYMLINK', path: relativePath });
      } else if (stat.isFile()) {
        entries.push({
          digest: sha256(readFileSync(path)),
          mode: (stat.mode & 0o111) === 0 ? 'REGULAR' : 'EXECUTABLE',
          path: relativePath,
        });
      }
    }
  }
  return sha256(JSON.stringify(entries.sort((left, right) => left.path.localeCompare(right.path))));
}

function prepare(
  fixtureValue: Fixture,
  suffix = 'first',
): {
  readonly generation: CandidateGeneration;
  readonly preparation: ReturnType<typeof decodeCandidatePreparation>;
} {
  const preparation = decodeCandidatePreparation(
    fixtureValue.workspace.prepare({
      candidateId: candidateId(`candidate_${suffix}`),
      generationId: candidateGenerationId(`generation_${suffix}`),
      goalId: goalId(`goal_${suffix}`),
      goalRevision: goalRevision(1),
      projectPath: fixtureValue.sourceRoot,
      schemaVersion: 1,
      workflowId: workflowId(`workflow_${suffix}`),
    }),
  );
  return {
    preparation,
    generation: createCandidateGeneration({
      baseDigest: preparation.baseDigest,
      candidateId: preparation.candidateId,
      createdAt,
      id: preparation.generationId,
      sequence: 1,
      workspaceIdentity: `m2-workspace:${preparation.generationId}`,
    }),
  };
}

function lease(
  fixtureValue: Fixture,
  generation: CandidateGeneration,
  suffix = 'first',
  accessMode: CandidateWorkspaceAccessMode = CandidateWorkspaceAccessMode.MUTABLE,
  leaseId = `lease_${suffix}_${accessMode.toLowerCase()}`,
): CandidateWorkspaceLease {
  return decodeCandidateWorkspaceLease(
    fixtureValue.workspace.issueLease({
      accessMode,
      allowedPaths: Object.freeze(['src']),
      forbiddenRoots: Object.freeze(
        [realpathSync(fixtureValue.authorityRoot), realpathSync(fixtureValue.sourceRoot)].sort(),
      ),
      generation,
      goalId: goalId(`goal_${suffix}`),
      goalRevision: goalRevision(1),
      id: leaseId,
      issuedAt: freezeStartedAt,
      schemaVersion: 1,
      version: 1,
      workflowId: workflowId(`workflow_${suffix}`),
      workflowVersion: workflowVersion(1),
    }),
  );
}

function event(decision: ReturnType<typeof decideCandidate>): CandidateStateChanged {
  if (!decision.accepted) {
    assert.fail(`Candidate transition rejected: ${decision.rejection.code}`);
  }
  return decision.events[0];
}

function beginFreeze(generation: CandidateGeneration, suffix: string): CandidateGeneration {
  return applyCandidateEvent(
    generation,
    event(
      decideCandidate(generation, {
        candidateGenerationId: generation.id,
        commandId: commandId(`command_begin-${suffix.replaceAll('_', '-')}`),
        expectedVersion: generation.version,
        occurredAt: freezeStartedAt,
        type: 'BEGIN_CANDIDATE_FREEZE',
      }),
    ),
  );
}

function freezeRequestV2(
  generation: CandidateGeneration,
  suffix: string,
  allowedPaths: readonly string[] = Object.freeze(['src']),
): CandidateFreezeRequestV2 {
  const retainedAllowedPaths = Object.freeze([...allowedPaths]);
  return Object.freeze({
    allowedPathPolicyDigest: digestCandidateWorkspaceValue(
      candidateWorkspaceAllowedPathProjection(retainedAllowedPaths),
    ),
    allowedPaths: retainedAllowedPaths,
    attemptId: attemptId(`attempt_${suffix}`),
    generation,
    goalId: goalId(`goal_${suffix}`),
    goalRevision: goalRevision(1),
    policyBundleDigest: sha256Digest(`sha256:${'d'.repeat(64)}`),
    policyBundleId: policyBundleId(`policy_${suffix}`),
    schemaVersion: 2,
    workflowId: workflowId(`workflow_${suffix}`),
    workflowVersion: workflowVersion(1),
  });
}

function freeze(
  fixtureValue: Fixture,
  mutable: CandidateGeneration,
  suffix: string,
): {
  readonly frozen: FrozenCandidateGeneration;
  readonly observation: ReturnType<typeof decodeCandidateFreezeObservation>;
} {
  const freezing = beginFreeze(mutable, suffix);
  const observation = decodeCandidateFreezeObservation(
    fixtureValue.workspace.observeFreeze({
      attemptId: attemptId(`attempt_${suffix}`),
      generation: freezing,
      goalId: goalId(`goal_${suffix}`),
      goalRevision: goalRevision(1),
      policyBundleDigest: sha256Digest(`sha256:${'a'.repeat(64)}`),
      policyBundleId: policyBundleId('policy_m2-workspace'),
      schemaVersion: 1,
      workflowId: workflowId(`workflow_${suffix}`),
      workflowVersion: workflowVersion(1),
    }),
  );
  const frozen = applyCandidateEvent(
    freezing,
    event(
      decideCandidate(freezing, {
        candidateGenerationId: freezing.id,
        commandId: commandId(`command_complete-${suffix.replaceAll('_', '-')}`),
        expectedVersion: freezing.version,
        frozenDigest: observation.secondSourceDigest,
        occurredAt: freezeCompletedAt,
        type: 'COMPLETE_CANDIDATE_FREEZE',
      }),
    ),
  );
  if (frozen.state !== CandidateGenerationState.FROZEN) {
    assert.fail('Freeze helper did not produce a frozen Candidate');
  }
  return { frozen, observation };
}

void test('[I-007][M2-F04] source identity observes tree bytes separately from Git metadata', (t) => {
  const value = fixture(t);
  const before = observeLocalCandidateSourceIdentity(value.sourceRoot);

  writeFileSync(join(value.sourceRoot, 'src', 'order.ts'), 'export const charge = "changed";\n');
  const contentChanged = observeLocalCandidateSourceIdentity(value.sourceRoot);
  assert.notEqual(contentChanged.sourceTreeDigest, before.sourceTreeDigest);

  git(value.sourceRoot, ['add', 'src/order.ts']);
  const indexChanged = observeLocalCandidateSourceIdentity(value.sourceRoot);
  assert.equal(indexChanged.sourceTreeDigest, contentChanged.sourceTreeDigest);
  assert.notEqual(indexChanged.sourceGitMetadataDigest, contentChanged.sourceGitMetadataDigest);
});

void test('[I-005][I-008][M251-F08][M251-X09] preparation v2 creates a Candidate only for the exact admitted PLAN source', (t) => {
  const matching = fixture(t);
  const matchingPlan = captureProjectReadSourceSnapshotForTesting(matching.sourceRoot);
  const matchingResult = decodeCandidatePreparationV2(
    matching.workspace.prepare({
      schemaVersion: 2,
      candidateId: candidateId('candidate_plan-source-match'),
      generationId: candidateGenerationId('generation_plan-source-match'),
      goalId: goalId('goal_plan-source-match'),
      goalRevision: goalRevision(1),
      workflowId: workflowId('workflow_plan-source-match'),
      projectPath: matching.sourceRoot,
      planProjectReadAuthorityId: projectSourceReadAuthorityId('project-read_plan-source-match'),
      planProjectReadAuthorityRecordDigest: sha256Digest(`sha256:${'a'.repeat(64)}`),
      expectedSourceTree: matchingPlan.sourceTree,
      expectedGitState: matchingPlan.gitState,
    }),
  );
  assert.equal(matchingResult.disposition, CandidatePreparationDisposition.PREPARED);
  const matchingGeneration = createCandidateGeneration({
    id: matchingResult.generationId,
    candidateId: matchingResult.candidateId,
    sequence: 1,
    workspaceIdentity: `m2-workspace:${matchingResult.generationId}`,
    baseDigest: matchingResult.baseDigest,
    createdAt,
  });
  const matchingLease = lease(matching, matchingGeneration, 'plan-source-match');
  matching.workspace.releaseLease(matchingLease);

  const changed = fixture(t);
  const admittedPlan = captureProjectReadSourceSnapshotForTesting(changed.sourceRoot);
  writeFileSync(
    join(changed.sourceRoot, 'src', 'order.ts'),
    'export const charge = "changed-after-plan";\n',
  );
  const changedResult = decodeCandidatePreparationV2(
    changed.workspace.prepare({
      schemaVersion: 2,
      candidateId: candidateId('candidate_plan-source-changed'),
      generationId: candidateGenerationId('generation_plan-source-changed'),
      goalId: goalId('goal_plan-source-changed'),
      goalRevision: goalRevision(1),
      workflowId: workflowId('workflow_plan-source-changed'),
      projectPath: changed.sourceRoot,
      planProjectReadAuthorityId: projectSourceReadAuthorityId('project-read_plan-source-changed'),
      planProjectReadAuthorityRecordDigest: sha256Digest(`sha256:${'b'.repeat(64)}`),
      expectedSourceTree: admittedPlan.sourceTree,
      expectedGitState: admittedPlan.gitState,
    }),
  );
  assert.equal(changedResult.disposition, CandidatePreparationDisposition.SOURCE_NOT_CURRENT);
  assert.notEqual(
    changedResult.observedSourceTree.projectionDigest,
    admittedPlan.sourceTree.projectionDigest,
  );
  assert.deepEqual(changed.workspace.reconcile(authoritySnapshot('plan-source-changed')), []);
});

void test('[I-014][I-023][M251-C11] freeze v2 derives one canonical stable Candidate change set', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'change-set-v2');
  const mutableLease = lease(value, prepared.generation, 'change-set-v2');
  writeFileSync(
    join(mutableLease.root, 'src', 'order.ts'),
    'export const charge = "bounded-v2";\n',
  );
  writeFileSync(join(mutableLease.root, 'src', 'added.ts'), 'export const added = true;\n');
  unlinkSync(join(mutableLease.root, 'src', 'note.txt'));
  const freezing = beginFreeze(prepared.generation, 'change-set-v2');
  const allowedPaths = Object.freeze(['src']);
  const freezeRequest = freezeRequestV2(freezing, 'change-set-v2', allowedPaths);
  assert.throws(
    () =>
      value.workspace.observeFreeze({
        ...freezeRequest,
        allowedPathPolicyDigest: sha256Digest(`sha256:${'e'.repeat(64)}`),
      }),
    /allowed-path policy digest is inconsistent/,
  );
  const observation = decodeCandidateFreezeObservationV2(
    value.workspace.observeFreeze(freezeRequest),
  );
  assert.equal(observation.baseSourceDigest, prepared.generation.baseDigest);
  assert.equal(observation.firstSourceDigest, observation.secondSourceDigest);
  assert.equal(observation.allowedPathPolicyDigest, freezeRequest.allowedPathPolicyDigest);
  assert.deepEqual(
    observation.changes.map(({ kind, path }) => ({ kind, path })),
    [
      { kind: 'ADDED', path: 'src/added.ts' },
      { kind: 'DELETED', path: 'src/note.txt' },
      { kind: 'MODIFIED', path: 'src/order.ts' },
    ],
  );
  assert.equal(candidateChangesStayWithinAllowedPaths(observation.changes, allowedPaths), true);
  assert.equal(
    candidateChangesStayWithinAllowedPaths(observation.changes, ['src/order.ts']),
    false,
  );
  assert.throws(
    () =>
      decodeCandidateFreezeObservationV2({
        ...observation,
        changes: [...observation.changes].reverse(),
      }),
    /uniquely path-sorted/,
  );
  assert.throws(
    () =>
      decodeCandidateFreezeObservationV2({
        ...observation,
        changeSetDigest: sha256Digest(`sha256:${'e'.repeat(64)}`),
      }),
    /digest is inconsistent/,
  );
});

void test('[I-012][I-014][M251-C11] freeze v2 exposes instability and leaves the Candidate unsafe', (t) => {
  const value = fixture(t, {
    afterFirstFreezeScan: ({ candidateRoot }) => {
      const path = join(candidateRoot, 'src', 'order.ts');
      chmodSync(path, 0o644);
      writeFileSync(path, 'export const charge = "changed-during-freeze-v2";\n');
    },
  });
  const prepared = prepare(value, 'freeze-drift-v2');
  const mutableLease = lease(value, prepared.generation, 'freeze-drift-v2');
  const freezing = beginFreeze(prepared.generation, 'freeze-drift-v2');
  const observation = decodeCandidateFreezeObservationV2(
    value.workspace.observeFreeze(freezeRequestV2(freezing, 'freeze-drift-v2')),
  );
  assert.equal(observation.baseSourceDigest, prepared.generation.baseDigest);
  assert.notEqual(observation.firstSourceDigest, observation.secondSourceDigest);
  assert.throws(() => value.workspace.assertLeaseCurrent(mutableLease), /active lease|stale/);
  assert.equal(
    value.workspace.reconcile(authoritySnapshot('freeze-drift-v2'))[0]?.classification,
    WorkspaceReconciliationClassification.UNSAFE,
  );
});

void test('[I-012][I-014][I-027][M251-C11] freeze v2 observation construction failure leaves the Candidate unsafe', (t) => {
  const value = fixture(t, {
    beforeFreezeV2Observation: () => {
      throw new Error('fixture freeze-v2 observation failure');
    },
  });
  const prepared = prepare(value, 'freeze-observation-failure-v2');
  const mutableLease = lease(value, prepared.generation, 'freeze-observation-failure-v2');
  const freezing = beginFreeze(prepared.generation, 'freeze-observation-failure-v2');
  assert.throws(
    () => value.workspace.observeFreeze(freezeRequestV2(freezing, 'freeze-observation-failure-v2')),
    /fixture freeze-v2 observation failure/u,
  );
  assert.throws(() => value.workspace.assertLeaseCurrent(mutableLease), /active lease|stale/u);
  assert.equal(
    value.workspace.reconcile(authoritySnapshot('freeze-observation-failure-v2'))[0]
      ?.classification,
    WorkspaceReconciliationClassification.UNSAFE,
  );
});

void test('[I-007][I-011][M2-D01][M2-D02][M2-D09] controlled copy preserves exact dirty bytes and source authority', (t) => {
  const value = fixture(t);
  const sourceBefore = directoryProjection(value.sourceRoot);
  const gitBefore = {
    head: git(value.sourceRoot, ['rev-parse', 'HEAD']),
    index: git(value.sourceRoot, ['ls-files', '--stage']),
    status: git(value.sourceRoot, ['status', '--porcelain=v2', '--untracked-files=all']),
  };
  const prepared = prepare(value);
  const candidateLease = lease(value, prepared.generation);

  assert.equal(
    readFileSync(join(candidateLease.root, 'src', 'order.ts'), 'utf8'),
    'export const charge = "dirty-once";\n',
  );
  assert.equal(
    readFileSync(join(candidateLease.root, 'src', 'note.txt'), 'utf8'),
    'untracked note\n',
  );
  assert.equal(existsSync(join(candidateLease.root, 'ignored.log')), false);
  assert.equal(existsSync(join(candidateLease.root, '.git')), false);
  assert.notEqual(lstatSync(join(candidateLease.root, 'scripts', 'tool.sh')).mode & 0o111, 0);
  assert.equal(candidateLease.root.startsWith(`${realpathSync(value.workspaceRoot)}/`), true);
  assert.equal(candidateLease.root.startsWith(`${realpathSync(value.sourceRoot)}/`), false);

  writeFileSync(
    join(candidateLease.root, 'src', 'order.ts'),
    'export const charge = "candidate-only";\n',
  );
  assert.equal(
    readFileSync(join(value.sourceRoot, 'src', 'order.ts'), 'utf8'),
    'export const charge = "dirty-once";\n',
  );
  assert.equal(directoryProjection(value.sourceRoot), sourceBefore);
  assert.deepEqual(
    {
      head: git(value.sourceRoot, ['rev-parse', 'HEAD']),
      index: git(value.sourceRoot, ['ls-files', '--stage']),
      status: git(value.sourceRoot, ['status', '--porcelain=v2', '--untracked-files=all']),
    },
    gitBefore,
  );
  assert.equal(
    value.workspace.assertLeaseCurrent(candidateLease).leaseDigest,
    candidateLease.leaseDigest,
  );
  value.workspace.releaseLease(candidateLease);
});

void test('[I-007][I-027][I-029][M2-D01][M2-D07][M2-D08] a workspace nested in source is rejected before any directory creation', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-workspace-overlap-')));
  t.after(() => removeFixtureRoot(root));
  const sourceRoot = join(root, 'source');
  const authorityRoot = join(root, 'authority');
  const workspaceRoot = join(sourceRoot, '.runtime-workspace');
  mkdirSync(sourceRoot);
  mkdirSync(authorityRoot);
  initializeSource(sourceRoot);
  const sourceBefore = directoryProjection(sourceRoot);
  const workspace = createLocalCandidateWorkspace({
    authorityRoots: Object.freeze([realpathSync(authorityRoot)]),
    ownerId: 'workspace-owner_overlap',
    workspaceRoot,
  });
  assert.equal(existsSync(workspaceRoot), false);
  assert.throws(
    () =>
      workspace.prepare({
        candidateId: candidateId('candidate_overlap'),
        generationId: candidateGenerationId('generation_overlap'),
        goalId: goalId('goal_overlap'),
        goalRevision: goalRevision(1),
        projectPath: sourceRoot,
        schemaVersion: 1,
        workflowId: workflowId('workflow_overlap'),
      }),
    /must remain disjoint/,
  );
  assert.equal(existsSync(workspaceRoot), false);
  assert.equal(directoryProjection(sourceRoot), sourceBefore);
  const missingGeneration = createCandidateGeneration({
    baseDigest: sha256Digest(`sha256:${'f'.repeat(64)}`),
    candidateId: candidateId('candidate_overlap'),
    createdAt,
    id: candidateGenerationId('generation_overlap'),
    sequence: 1,
    workspaceIdentity: 'm2-workspace:generation_overlap',
  });
  const missing = workspace.reconcile(
    authoritySnapshot('overlap', [expectedGeneration(missingGeneration, 'overlap')]),
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.classification, WorkspaceReconciliationClassification.UNSAFE);
  assert.match(missing[0].reason, /no initialized workspace ownership/);
});

void test('[I-027][M2-D03] portable path aliases, traversal, links, and reserved paths fail closed', (t) => {
  assert.throws(
    () => assertPortableCandidatePathSetForTesting(['Source/a.ts', 'source/b.ts']),
    /alias collision/,
  );
  assert.throws(() => assertPortableCandidatePathSetForTesting(['../outside']), /non-portable/);
  assert.throws(() => assertPortableCandidatePathSetForTesting(['src/.git/config']), /reserved/);
  assert.throws(() => assertPortableCandidatePathSetForTesting(['src/e\u0301.ts']), /normalized/);

  const value = fixture(t);
  symlinkSync('../README.md', join(value.sourceRoot, 'src', 'linked.md'));
  git(value.sourceRoot, ['add', 'src/linked.md']);
  assert.throws(
    () => prepare(value, 'symlink'),
    (error) =>
      error instanceof LocalCandidateWorkspaceError &&
      error.code === LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
  );
});

void test('[I-027][M2-D03] special files and gitlinks are rejected instead of guessed', (t) => {
  const special = fixture(t);
  execFileSync('mkfifo', [join(special.sourceRoot, 'src', 'events.pipe')]);
  assert.throws(
    () => prepare(special, 'fifo'),
    (error) =>
      error instanceof LocalCandidateWorkspaceError &&
      error.code === LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
  );

  const gitlink = fixture(t);
  const head = git(gitlink.sourceRoot, ['rev-parse', 'HEAD']);
  mkdirSync(join(gitlink.sourceRoot, 'vendor', 'module'), { recursive: true });
  git(gitlink.sourceRoot, ['update-index', '--add', '--cacheinfo', `160000,${head},vendor/module`]);
  assert.throws(() => prepare(gitlink, 'gitlink'), /Gitlinks/);
});

void test('[I-007][I-011][I-027][M2-D01][M2-D03] leases require complete real forbidden roots and contained non-link paths', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'containment');
  assert.throws(
    () =>
      value.workspace.issueLease({
        accessMode: CandidateWorkspaceAccessMode.MUTABLE,
        allowedPaths: Object.freeze(['src']),
        forbiddenRoots: Object.freeze([realpathSync(value.sourceRoot)]),
        generation: prepared.generation,
        goalId: goalId('goal_containment'),
        goalRevision: goalRevision(1),
        id: 'lease_missing-authority',
        issuedAt: freezeStartedAt,
        schemaVersion: 1,
        version: 1,
        workflowId: workflowId('workflow_containment'),
        workflowVersion: workflowVersion(1),
      }),
    /forbidden roots are incomplete/,
  );

  const valid = lease(value, prepared.generation, 'containment');
  value.workspace.releaseLease(valid);
  symlinkSync('../README.md', join(valid.root, 'link'));
  assert.throws(
    () =>
      value.workspace.issueLease({
        accessMode: CandidateWorkspaceAccessMode.MUTABLE,
        allowedPaths: Object.freeze(['link']),
        forbiddenRoots: valid.forbiddenRoots,
        generation: prepared.generation,
        goalId: goalId('goal_containment'),
        goalRevision: goalRevision(1),
        id: 'lease_alias',
        issuedAt: freezeStartedAt,
        schemaVersion: 1,
        version: 1,
        workflowId: workflowId('workflow_containment'),
        workflowVersion: workflowVersion(1),
      }),
    /symbolic-link alias/,
  );
});

void test('[I-012][M2-D04][M2-D05] freeze revokes mutation leases and frozen drift is observable', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'freeze');
  const mutableLease = lease(value, prepared.generation, 'freeze');
  writeFileSync(join(mutableLease.root, 'src', 'order.ts'), 'export const charge = "fixed";\n');
  const result = freeze(value, prepared.generation, 'freeze');
  assert.equal(result.observation.firstSourceDigest, result.observation.secondSourceDigest);
  assert.throws(() => value.workspace.assertLeaseCurrent(mutableLease), /active lease|stale/);
  assert.throws(() => value.workspace.releaseLease(mutableLease), /active lease/);

  const readOnlyLease = lease(
    value,
    result.frozen,
    'freeze',
    CandidateWorkspaceAccessMode.READ_ONLY,
  );
  assert.equal(value.workspace.assertLeaseCurrent(readOnlyLease).root, mutableLease.root);
  value.workspace.releaseLease(readOnlyLease);

  const frozenFile = join(mutableLease.root, 'src', 'order.ts');
  chmodSync(frozenFile, 0o644);
  writeFileSync(frozenFile, 'export const charge = "drift";\n');
  chmodSync(frozenFile, 0o444);
  assert.throws(
    () => lease(value, result.frozen, 'freeze', CandidateWorkspaceAccessMode.READ_ONLY),
    /identity is stale/,
  );
  const integrity = decodeFrozenCandidateIntegrityObservation(
    value.workspace.observeFrozen({
      generation: result.frozen,
      goalId: goalId('goal_freeze'),
      schemaVersion: 1,
      workflowId: workflowId('workflow_freeze'),
    }),
  );
  assert.notEqual(integrity.observedDigest, result.frozen.frozenDigest);
});

void test('[I-012][I-027][M2-D04][M2-D05][M2-D07] unrepresented directories and restored write bits fail frozen identity closed', (t) => {
  const emptyDirectory = fixture(t);
  const preparedEmpty = prepare(emptyDirectory, 'empty-directory');
  const mutableLease = lease(emptyDirectory, preparedEmpty.generation, 'empty-directory');
  mkdirSync(join(mutableLease.root, 'src', 'empty-output'));
  const freezing = beginFreeze(preparedEmpty.generation, 'empty-directory');
  assert.throws(
    () =>
      emptyDirectory.workspace.observeFreeze({
        attemptId: attemptId('attempt_empty-directory'),
        generation: freezing,
        goalId: goalId('goal_empty-directory'),
        goalRevision: goalRevision(1),
        policyBundleDigest: sha256Digest(`sha256:${'c'.repeat(64)}`),
        policyBundleId: policyBundleId('policy_empty-directory'),
        schemaVersion: 1,
        workflowId: workflowId('workflow_empty-directory'),
        workflowVersion: workflowVersion(1),
      }),
    /empty directories/,
  );
  assert.equal(
    emptyDirectory.workspace.reconcile(authoritySnapshot('empty-directory'))[0]?.classification,
    WorkspaceReconciliationClassification.UNSAFE,
  );

  const writable = fixture(t);
  const preparedWritable = prepare(writable, 'write-bit');
  const frozen = freeze(writable, preparedWritable.generation, 'write-bit').frozen;
  const candidateRoot = writable.workspace
    .reconcile(authoritySnapshot('write-bit-current', [expectedGeneration(frozen, 'write-bit')]))
    .find((entry) => entry.generationId === frozen.id)?.candidateRoot;
  assert.ok(candidateRoot !== undefined);
  chmodSync(join(candidateRoot, 'src'), 0o755);
  assert.throws(
    () => lease(writable, frozen, 'write-bit', CandidateWorkspaceAccessMode.READ_ONLY),
    /regained filesystem write permission/,
  );
  assert.equal(
    writable.workspace.reconcile(
      authoritySnapshot('write-bit-drift', [expectedGeneration(frozen, 'write-bit')], 2),
    )[0]?.classification,
    WorkspaceReconciliationClassification.UNSAFE,
  );
});

void test('[I-027][M2-D07][M2-D08] active lease overflow is rejected before an invalid ownership record is persisted', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'lease-limit');
  const frozen = freeze(value, prepared.generation, 'lease-limit').frozen;
  const leases = Array.from({ length: 16 }, (_, index) =>
    lease(
      value,
      frozen,
      'lease-limit',
      CandidateWorkspaceAccessMode.READ_ONLY,
      `lease_limit_${String(index).padStart(2, '0')}`,
    ),
  );
  assert.throws(
    () =>
      lease(value, frozen, 'lease-limit', CandidateWorkspaceAccessMode.READ_ONLY, 'lease_limit_16'),
    /active-lease limit/,
  );
  const firstLease = leases[0];
  assert.ok(firstLease !== undefined);
  assert.equal(value.workspace.assertLeaseCurrent(firstLease).state, 'ACTIVE');
  for (const activeLease of leases) {
    value.workspace.releaseLease(activeLease);
  }
  assert.equal(
    value.workspace.reconcile(
      authoritySnapshot('lease-limit', [expectedGeneration(frozen, 'lease-limit')]),
    )[0]?.classification,
    WorkspaceReconciliationClassification.OWNED_CURRENT,
  );
});

void test('[I-012][I-027][M2-D04][M2-D05][M2-D07] a concurrent freeze mutation never becomes frozen authority', (t) => {
  const value = fixture(t, {
    afterFirstFreezeScan: ({ candidateRoot }) => {
      const path = join(candidateRoot, 'src', 'order.ts');
      chmodSync(path, 0o644);
      writeFileSync(path, 'export const charge = "changed-during-freeze";\n');
    },
  });
  const prepared = prepare(value, 'freeze-drift');
  const mutableLease = lease(value, prepared.generation, 'freeze-drift');
  const freezing = beginFreeze(prepared.generation, 'freeze-drift');
  const observation = decodeCandidateFreezeObservation(
    value.workspace.observeFreeze({
      attemptId: attemptId('attempt_freeze-drift'),
      generation: freezing,
      goalId: goalId('goal_freeze-drift'),
      goalRevision: goalRevision(1),
      policyBundleDigest: sha256Digest(`sha256:${'b'.repeat(64)}`),
      policyBundleId: policyBundleId('policy_freeze-drift'),
      schemaVersion: 1,
      workflowId: workflowId('workflow_freeze-drift'),
      workflowVersion: workflowVersion(1),
    }),
  );
  assert.notEqual(observation.firstSourceDigest, observation.secondSourceDigest);
  assert.throws(() => value.workspace.assertLeaseCurrent(mutableLease), /active lease|stale/);
  assert.equal(
    value.workspace.reconcile(authoritySnapshot('freeze-drift'))[0]?.classification,
    WorkspaceReconciliationClassification.UNSAFE,
  );
});

void test('[I-013][M2-D06] repair copies the exact frozen parent and leaves it byte-identical', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'repair');
  const mutableLease = lease(value, prepared.generation, 'repair');
  writeFileSync(
    join(mutableLease.root, 'src', 'order.ts'),
    'export const charge = "parent-fixed";\n',
  );
  const parent = freeze(value, prepared.generation, 'repair').frozen;
  const parentBefore = directoryProjection(mutableLease.root);
  const childPreparation = decodeCandidateRepairPreparation(
    value.workspace.prepareRepair({
      candidateId: parent.candidateId,
      expectedBaseDigest: parent.frozenDigest,
      generationId: candidateGenerationId('generation_repair-child'),
      goalId: goalId('goal_repair'),
      goalRevision: goalRevision(1),
      parentGenerationId: parent.id,
      projectPath: value.sourceRoot,
      schemaVersion: 1,
      workflowId: workflowId('workflow_repair'),
    }),
  );
  const child = createCandidateGeneration({
    baseDigest: childPreparation.baseDigest,
    candidateId: childPreparation.candidateId,
    createdAt: freezeCompletedAt,
    id: childPreparation.generationId,
    parentGenerationId: childPreparation.parentGenerationId,
    sequence: 2,
    workspaceIdentity: 'm2-workspace:generation_repair-child',
  });
  const childLease = lease(value, child, 'repair');
  assert.notEqual(childLease.root, mutableLease.root);
  assert.equal(directoryProjection(mutableLease.root), parentBefore);
  assert.equal(
    readFileSync(join(childLease.root, 'src', 'order.ts'), 'utf8'),
    'export const charge = "parent-fixed";\n',
  );
  writeFileSync(join(childLease.root, 'src', 'order.ts'), 'export const charge = "child-only";\n');
  assert.equal(directoryProjection(mutableLease.root), parentBefore);
  value.workspace.releaseLease(childLease);
});

void test('[I-013][I-027][M2-D05][M2-D06][M2-D07] concurrent repair-parent drift removes the partial child', (t) => {
  const value = fixture(t, {
    beforeRepairParentRecheck: ({ parentRoot }) => {
      const path = join(parentRoot, 'src', 'order.ts');
      chmodSync(path, 0o644);
      writeFileSync(path, 'export const charge = "parent-drift";\n');
    },
  });
  const prepared = prepare(value, 'repair-drift');
  const parentLease = lease(value, prepared.generation, 'repair-drift');
  const parent = freeze(value, prepared.generation, 'repair-drift').frozen;
  assert.throws(
    () =>
      value.workspace.prepareRepair({
        candidateId: parent.candidateId,
        expectedBaseDigest: parent.frozenDigest,
        generationId: candidateGenerationId('generation_repair-drift-child'),
        goalId: goalId('goal_repair-drift'),
        goalRevision: goalRevision(1),
        parentGenerationId: parent.id,
        projectPath: value.sourceRoot,
        schemaVersion: 1,
        workflowId: workflowId('workflow_repair-drift'),
      }),
    /changed during child creation/,
  );
  const reconciliation = value.workspace.reconcile(authoritySnapshot('repair-drift'));
  assert.equal(
    reconciliation.some((entry) => entry.generationId === 'generation_repair-drift-child'),
    false,
  );
  assert.equal(
    reconciliation.find((entry) => entry.generationId === parent.id)?.classification,
    WorkspaceReconciliationClassification.UNSAFE,
  );
  assert.equal(existsSync(parentLease.root), true);
});

void test('[I-027][M2-D07] partial copy and concurrent source change leave no current Candidate', (t) => {
  const partial = fixture(t, {
    afterCopiedFile: ({ copiedFileCount }) => {
      if (copiedFileCount === 1) {
        throw new Error('injected partial copy failure');
      }
    },
  });
  assert.throws(() => prepare(partial, 'partial'), /injected partial copy failure/);
  assert.deepEqual(partial.workspace.reconcile(authoritySnapshot('partial')), []);

  const sourceDrift = fixture(t, {
    beforeSourceRecheck: ({ sourceRoot }) => {
      writeFileSync(join(sourceRoot, 'src', 'order.ts'), 'export const charge = "changed";\n');
    },
  });
  assert.throws(
    () => prepare(sourceDrift, 'source-drift'),
    (error) =>
      error instanceof LocalCandidateWorkspaceError &&
      error.code === LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT,
  );
  assert.deepEqual(sourceDrift.workspace.reconcile(authoritySnapshot('source-drift')), []);
});

void test('[I-007][I-029][M2-D08] restart classifies authority and cleanup removes only one exact owned orphan', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'reopen');
  const candidateLease = lease(value, prepared.generation, 'reopen');
  value.workspace.releaseLease(candidateLease);
  const userOwned = join(value.workspaceRoot, 'candidates', 'user-owned-data');
  mkdirSync(userOwned);
  writeFileSync(join(userOwned, 'keep.txt'), 'keep\n');
  const sourceBefore = directoryProjection(value.sourceRoot);
  const authoritySentinel = join(value.authorityRoot, 'keep.txt');
  writeFileSync(authoritySentinel, 'keep\n');

  const reopened = createLocalCandidateWorkspace({
    authorityRoots: Object.freeze([realpathSync(value.authorityRoot)]),
    ownerId: 'workspace-owner_test',
    workspaceRoot: value.workspaceRoot,
  });
  const currentEntries = reopened.reconcile(
    authoritySnapshot('reopen-current', [expectedGeneration(prepared.generation, 'reopen')]),
  );
  assert.equal(
    currentEntries.some(
      (entry) =>
        entry.generationId === prepared.generation.id &&
        entry.classification === WorkspaceReconciliationClassification.OWNED_CURRENT,
    ),
    true,
  );
  assert.equal(
    currentEntries.some(
      (entry) => entry.classification === WorkspaceReconciliationClassification.UNSAFE,
    ),
    true,
  );

  const orphan = reopened
    .reconcile(authoritySnapshot('reopen-orphan', [], 2))
    .find((entry) => entry.generationId === prepared.generation.id);
  assert.ok(orphan !== undefined);
  assert.equal(orphan.classification, WorkspaceReconciliationClassification.OWNED_ORPHANED);
  assert.ok(orphan.ownershipDigest !== null);
  const staleCleanupGrant = orphan.cleanupGrant;
  assert.ok(staleCleanupGrant !== null);
  reopened.reconcile(
    authoritySnapshot(
      'reopen-current-again',
      [expectedGeneration(prepared.generation, 'reopen')],
      3,
    ),
  );
  assert.throws(
    () => reopened.cleanupOrphanedGeneration(staleCleanupGrant),
    /stale|current reconciliation/,
  );
  assert.equal(existsSync(candidateLease.root), true);
  const currentOrphan = reopened
    .reconcile(authoritySnapshot('reopen-final-orphan', [], 4))
    .find((entry) => entry.generationId === prepared.generation.id);
  assert.ok(currentOrphan !== undefined);
  const currentCleanupGrant = currentOrphan.cleanupGrant;
  assert.ok(currentCleanupGrant !== null);
  reopened.cleanupOrphanedGeneration(currentCleanupGrant);
  assert.equal(existsSync(candidateLease.root), false);
  assert.equal(readFileSync(join(userOwned, 'keep.txt'), 'utf8'), 'keep\n');
  assert.equal(readFileSync(authoritySentinel, 'utf8'), 'keep\n');
  assert.equal(directoryProjection(value.sourceRoot), sourceBefore);
});

void test('[I-007][I-029][M2-D08] authority snapshots advance monotonically without rollback or equivocation', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'authority-monotonic');
  const candidateLease = lease(value, prepared.generation, 'authority-monotonic');
  value.workspace.releaseLease(candidateLease);
  const currentAuthority = authoritySnapshot(
    'authority-monotonic-current',
    [expectedGeneration(prepared.generation, 'authority-monotonic')],
    3,
  );

  assert.equal(
    value.workspace.reconcile(currentAuthority)[0]?.classification,
    WorkspaceReconciliationClassification.OWNED_CURRENT,
  );
  assert.throws(
    () => value.workspace.reconcile(authoritySnapshot('authority-monotonic-stale', [], 2)),
    (error) =>
      error instanceof LocalCandidateWorkspaceError &&
      error.code === LocalCandidateWorkspaceFailureCode.STALE_AUTHORITY_SNAPSHOT,
  );
  const replayed = value.workspace.reconcile(currentAuthority)[0];
  assert.equal(replayed?.classification, WorkspaceReconciliationClassification.OWNED_CURRENT);
  assert.equal(replayed.cleanupGrant, null);
  assert.equal(existsSync(candidateLease.root), true);

  const advanced = value.workspace
    .reconcile(authoritySnapshot('authority-monotonic-advanced', [], 4))
    .find((entry) => entry.generationId === prepared.generation.id);
  assert.equal(advanced?.classification, WorkspaceReconciliationClassification.OWNED_ORPHANED);
  const cleanupGrant = advanced.cleanupGrant;
  assert.ok(cleanupGrant !== null);
  assert.throws(
    () =>
      value.workspace.reconcile(
        authoritySnapshot(
          'authority-monotonic-conflict',
          [expectedGeneration(prepared.generation, 'authority-monotonic')],
          4,
        ),
      ),
    (error) =>
      error instanceof LocalCandidateWorkspaceError &&
      error.code === LocalCandidateWorkspaceFailureCode.AUTHORITY_SNAPSHOT_CONFLICT,
  );
  assert.throws(
    () => value.workspace.reconcile(currentAuthority),
    (error) =>
      error instanceof LocalCandidateWorkspaceError &&
      error.code === LocalCandidateWorkspaceFailureCode.STALE_AUTHORITY_SNAPSHOT,
  );
  value.workspace.cleanupOrphanedGeneration(cleanupGrant);
  assert.equal(existsSync(candidateLease.root), false);
});

void test('[I-027][I-029][M2-D07][M2-D08] reconciliation requires exact persisted lifecycle and source authority', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'authority-match');
  const mutableLease = lease(value, prepared.generation, 'authority-match');
  value.workspace.releaseLease(mutableLease);

  const freezing = beginFreeze(prepared.generation, 'authority-match');
  assert.equal(
    value.workspace.reconcile(
      authoritySnapshot('authority-freezing', [expectedGeneration(freezing, 'authority-match')]),
    )[0]?.classification,
    WorkspaceReconciliationClassification.UNSAFE,
  );

  const wrongBase = Object.freeze({
    ...prepared.generation,
    baseDigest: sha256Digest(`sha256:${'e'.repeat(64)}`),
  });
  assert.equal(
    value.workspace.reconcile(
      authoritySnapshot('authority-base', [expectedGeneration(wrongBase, 'authority-match')], 2),
    )[0]?.classification,
    WorkspaceReconciliationClassification.UNSAFE,
  );

  assert.equal(
    value.workspace.reconcile(
      authoritySnapshot(
        'authority-current',
        [expectedGeneration(prepared.generation, 'authority-match')],
        3,
      ),
    )[0]?.classification,
    WorkspaceReconciliationClassification.OWNED_CURRENT,
  );
});

void test('[I-029][M2-D08] restart retains unresolved active leases as unsafe', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'active-reopen');
  lease(value, prepared.generation, 'active-reopen');
  const reopened = createLocalCandidateWorkspace({
    authorityRoots: Object.freeze([realpathSync(value.authorityRoot)]),
    ownerId: 'workspace-owner_test',
    workspaceRoot: value.workspaceRoot,
  });
  const entry = reopened
    .reconcile(authoritySnapshot('active-reopen'))
    .find((candidate) => candidate.generationId !== null);
  assert.ok(entry !== undefined);
  assert.equal(entry.classification, WorkspaceReconciliationClassification.UNSAFE);
  assert.match(entry.reason, /unresolved active leases/);
});

void test('[I-007][I-027][I-029][M2-D03][M2-D08] workspace aliases and non-owned roots cannot be claimed or deleted', (t) => {
  const value = fixture(t);
  const alias = join(value.root, 'workspace-alias');
  symlinkSync(value.workspaceRoot, alias);
  assert.throws(
    () =>
      createLocalCandidateWorkspace({
        authorityRoots: Object.freeze([realpathSync(value.authorityRoot)]),
        ownerId: 'workspace-owner_test',
        workspaceRoot: alias,
      }),
    /alias|real directory/,
  );

  const unowned = join(value.root, 'unowned');
  mkdirSync(unowned);
  writeFileSync(join(unowned, 'user.txt'), 'user data\n');
  assert.throws(
    () =>
      createLocalCandidateWorkspace({
        authorityRoots: Object.freeze([realpathSync(value.authorityRoot)]),
        ownerId: 'other-owner',
        workspaceRoot: unowned,
      }),
    /cannot be claimed/,
  );
  assert.equal(readFileSync(join(unowned, 'user.txt'), 'utf8'), 'user data\n');
});

void test('[M2-D02] lease binding rejects wrong Candidate identity and digests the Runtime generation version', (t) => {
  const value = fixture(t);
  const prepared = prepare(value, 'binding');
  assert.throws(
    () =>
      lease(
        value,
        Object.freeze({
          ...prepared.generation,
          candidateId: candidateId('candidate_wrong'),
        }),
        'binding',
      ),
    /does not bind/,
  );
  const first = lease(value, prepared.generation, 'binding');
  value.workspace.releaseLease(first);
  const nextVersion = lease(
    value,
    Object.freeze({ ...prepared.generation, version: aggregateVersion(2) }),
    'binding',
    CandidateWorkspaceAccessMode.MUTABLE,
    'lease_binding_version-2',
  );
  assert.equal(nextVersion.candidateGenerationVersion, 2);
  assert.notEqual(nextVersion.leaseDigest, first.leaseDigest);
  value.workspace.releaseLease(nextVersion);
  assert.equal(prepared.generation.state, CandidateGenerationState.MUTABLE);
});
