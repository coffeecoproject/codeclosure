import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RunStatus,
  WorkerResultKind,
  WorkflowPhase,
  attemptId,
  candidateGenerationId,
  candidateId,
  contextManifestId,
  createCandidate,
  createCandidateGeneration,
  createGoal,
  createWorkflow,
  decodeContextPackage,
  decodeWorkflowSnapshot,
  deriveCapabilityGrant,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  successCriterionId,
  workerSessionId,
  workflowId,
  workflowVersion,
  type AttemptId,
} from '@codeclosure/domain';
import {
  CandidateWorkspaceAccessMode,
  candidateWorkspaceAllowedPathProjection,
  candidateWorkspaceLeaseProjection,
  createWorkerRequest,
  decodeCandidateWorkspaceLease,
  digestCandidateWorkspaceValue,
  validateCandidateWorkspaceLeaseRequest,
  type CandidateWorkspaceLease,
  type CandidateWorkspaceLeaseRequest,
  type WorkerPort,
  type WorkerRequest,
} from '@codeclosure/runtime';
import {
  createCandidateLeasedWorker,
  type CandidateLeasedWorkerFactory,
} from '@codeclosure/runtime/composition';

const occurredAt = isoTimestamp('2026-07-31T00:00:00.000Z');
const sourceRoot = '/fixture/candidate-leased-worker-source';
const baseDigest = sha256Digest(`sha256:${'a'.repeat(64)}`);
const profileDigest = sha256Digest(`sha256:${'b'.repeat(64)}`);
const policyDigest = sha256Digest(`sha256:${'c'.repeat(64)}`);
const manifestDigest = sha256Digest(`sha256:${'d'.repeat(64)}`);
const packageDigest = sha256Digest(`sha256:${'e'.repeat(64)}`);
const sourceGitMetadataDigest = sha256Digest(`sha256:${'f'.repeat(64)}`);

interface CandidateAuthorityFixture {
  readonly attemptId: AttemptId;
  readonly goal: ReturnType<typeof createGoal>;
  readonly workflow: ReturnType<typeof decodeWorkflowSnapshot>;
  readonly candidate: ReturnType<typeof createCandidate>;
  readonly generation: ReturnType<typeof createCandidateGeneration>;
}

function candidateAuthority(runStatus: typeof RunStatus.RUNNING | typeof RunStatus.READY) {
  const activeAttemptId = attemptId('attempt_candidate-leased-worker');
  const goal = createGoal({
    id: goalId('goal_candidate-leased-worker'),
    revision: goalRevision(1),
    objective: 'Exercise the current IMPLEMENT Candidate lease boundary',
    successCriteria: Object.freeze([
      Object.freeze({
        id: successCriterionId('criterion_candidate-leased-worker'),
        description: 'Only the current Attempt can receive a mutable Candidate lease',
        required: true,
      }),
    ]),
    scope: Object.freeze({ projectPath: sourceRoot, allowedPaths: Object.freeze(['src']) }),
    nonGoals: Object.freeze(['No filesystem process execution']),
    createdAt: occurredAt,
  });
  const initialWorkflow = createWorkflow({
    id: workflowId('workflow_candidate-leased-worker'),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt: occurredAt,
  });
  const candidate = createCandidate({
    id: candidateId('candidate_candidate-leased-worker'),
    goalId: goal.id,
    baseProjectIdentity: `source:${sourceRoot}`,
  });
  const generation = createCandidateGeneration({
    id: candidateGenerationId('generation_candidate-leased-worker'),
    candidateId: candidate.id,
    sequence: 1,
    workspaceIdentity: '/fixture/candidate-leased-worker-workspace',
    baseDigest,
    createdAt: occurredAt,
  });
  const workflow = decodeWorkflowSnapshot({
    ...initialWorkflow,
    phase: WorkflowPhase.IMPLEMENT,
    runStatus,
    version: workflowVersion(4),
    ...(runStatus === RunStatus.RUNNING ? { activeAttemptId } : {}),
    activeCandidateGenerationId: generation.id,
    updatedAt: occurredAt,
  });
  return Object.freeze({ activeAttemptId, goal, workflow, candidate, generation });
}

function workerRequest(
  authority: CandidateAuthorityFixture,
  phase: typeof WorkflowPhase.IMPLEMENT | typeof WorkflowPhase.DISCOVERY = WorkflowPhase.IMPLEMENT,
): WorkerRequest {
  const contextPackage = decodeContextPackage({
    schemaVersion: 2,
    goalId: authority.goal.id,
    goalRevision: authority.goal.revision,
    workflowId: authority.workflow.id,
    workflowVersion: authority.workflow.version,
    phase,
    attemptId: authority.attemptId,
    ...(phase === WorkflowPhase.IMPLEMENT
      ? {
          candidateGenerationId: authority.generation.id,
          candidateDigest: authority.generation.baseDigest,
        }
      : {}),
    phaseObjective: 'Exercise one bounded Worker dispatch.',
    capabilityGrant: deriveCapabilityGrant(phase),
    goal: {
      objective: authority.goal.objective,
      successCriteria: authority.goal.successCriteria,
      scope: authority.goal.scope,
      nonGoals: authority.goal.nonGoals,
    },
    selectedEntries: [],
    executionProfileId: executionProfileId('profile_candidate-leased-worker'),
    executionProfileDigest: profileDigest,
    policyBundleId: policyBundleId('policy_candidate-leased-worker'),
    policyBundleDigest: policyDigest,
    responseContract: {
      schemaVersion: 1,
      workerEventSchemaVersion: 1,
      allowedResultKinds: [
        phase === WorkflowPhase.IMPLEMENT
          ? WorkerResultKind.COMPLETION_REQUEST
          : WorkerResultKind.PROPOSALS,
      ],
      unknownFields: 'REJECT',
      maxEventBytes: 65_536,
    },
  });
  return createWorkerRequest(
    workerSessionId('worker_candidate-leased-worker'),
    contextManifestId('context_candidate-leased-worker'),
    manifestDigest,
    packageDigest,
    contextPackage,
  );
}

class TrackingWorkspace {
  public issueCount = 0;
  public assertCount = 0;
  public releaseCount = 0;
  public failAssertion = false;
  public failRelease = false;
  readonly #active = new Map<string, CandidateWorkspaceLease>();

  public issueLease(rawRequest: CandidateWorkspaceLeaseRequest): unknown {
    this.issueCount += 1;
    const request = validateCandidateWorkspaceLeaseRequest(rawRequest);
    const workspaceRootIdentity = '/fixture/candidate-leased-worker-workspace';
    const forbiddenRoots = Object.freeze(
      [...new Set([...request.forbiddenRoots, sourceRoot])].sort(),
    );
    const leaseWithoutDigest = Object.freeze({
      accessMode: CandidateWorkspaceAccessMode.MUTABLE,
      allowedPathPolicyDigest: digestCandidateWorkspaceValue(
        candidateWorkspaceAllowedPathProjection(request.allowedPaths),
      ),
      allowedPaths: request.allowedPaths,
      candidateId: request.generation.candidateId,
      candidateDigest: request.generation.baseDigest,
      candidateGenerationId: request.generation.id,
      candidateGenerationVersion: request.generation.version,
      forbiddenRoots,
      generationSequence: request.generation.sequence,
      goalId: request.goalId,
      goalRevision: request.goalRevision,
      id: request.id,
      issuedAt: request.issuedAt,
      lifecyclePolicy: 'REVOKE_ON_FREEZE' as const,
      parentGenerationId: request.generation.parentGenerationId ?? null,
      reservedPathPolicy: 'M2_CONTROLLED_COPY_V1' as const,
      retentionPolicy: 'RUNTIME_OWNED' as const,
      root: `${workspaceRootIdentity}/candidates/${request.generation.id}`,
      schemaVersion: 1 as const,
      sourceGitMetadataDigest,
      sourceProjectRoot: sourceRoot,
      sourceTreeDigest: request.generation.baseDigest,
      state: 'ACTIVE' as const,
      version: request.version,
      workspaceRootIdentity,
      workflowId: request.workflowId,
      workflowVersion: request.workflowVersion,
    });
    const lease = decodeCandidateWorkspaceLease({
      ...leaseWithoutDigest,
      leaseDigest: digestCandidateWorkspaceValue(
        candidateWorkspaceLeaseProjection(leaseWithoutDigest),
      ),
    });
    this.#active.set(lease.id, lease);
    return lease;
  }

  public assertLeaseCurrent(lease: CandidateWorkspaceLease): CandidateWorkspaceLease {
    this.assertCount += 1;
    if (this.failAssertion) {
      throw new TypeError('Candidate lease is no longer current');
    }
    const active = this.#active.get(lease.id);
    if (active?.leaseDigest !== lease.leaseDigest) {
      throw new TypeError('Candidate lease is unavailable');
    }
    return active;
  }

  public releaseLease(lease: CandidateWorkspaceLease): void {
    this.releaseCount += 1;
    this.#active.delete(lease.id);
    if (this.failRelease) {
      throw new Error('Candidate lease release failed');
    }
  }
}

function emptyWorker(onRun: () => void = () => undefined): WorkerPort {
  return Object.freeze({
    async *run(): AsyncIterable<unknown> {
      onRun();
      await Promise.resolve();
      yield* Object.freeze([]);
    },
  });
}

async function drain(worker: WorkerPort, request: WorkerRequest): Promise<void> {
  for await (const event of worker.run(request, new AbortController().signal)) {
    void event;
  }
}

function leasedWorker(
  authority: CandidateAuthorityFixture,
  workspace: TrackingWorkspace,
  factory: CandidateLeasedWorkerFactory,
  nonCandidateWorker: WorkerPort = emptyWorker(),
): WorkerPort {
  return createCandidateLeasedWorker({
    authority: Object.freeze({
      getGoalWithWorkflow: () =>
        Object.freeze({ goal: authority.goal, workflow: authority.workflow }),
      getCandidateAuthorityForWorkflow: () =>
        Object.freeze({
          candidate: authority.candidate,
          generation: authority.generation,
          workflowId: authority.workflow.id,
        }),
    }),
    workspace,
    clock: Object.freeze({ now: () => occurredAt }),
    forbiddenRoots: Object.freeze(['/fixture/candidate-leased-worker-authority']),
    nonCandidateWorker,
    implementationWorker: factory,
  });
}

void test('[I-003][I-010][M2-D02] idle IMPLEMENT authority cannot issue a Candidate Worker lease', async () => {
  const idle = candidateAuthority(RunStatus.READY);
  const authority: CandidateAuthorityFixture = Object.freeze({
    attemptId: idle.activeAttemptId,
    goal: idle.goal,
    workflow: idle.workflow,
    candidate: idle.candidate,
    generation: idle.generation,
  });
  const workspace = new TrackingWorkspace();
  let factoryCalls = 0;
  const worker = leasedWorker(
    authority,
    workspace,
    Object.freeze({
      create: () => {
        factoryCalls += 1;
        return emptyWorker();
      },
    }),
  );

  await assert.rejects(drain(worker, workerRequest(authority)), /stale or incomplete/);
  assert.equal(workspace.issueCount, 0);
  assert.equal(factoryCalls, 0);
});

void test('[I-008][I-010][M2-D02] stale lease assertion failure still releases the issued lease', async () => {
  const current = candidateAuthority(RunStatus.RUNNING);
  const authority: CandidateAuthorityFixture = Object.freeze({
    attemptId: current.activeAttemptId,
    goal: current.goal,
    workflow: current.workflow,
    candidate: current.candidate,
    generation: current.generation,
  });
  const workspace = new TrackingWorkspace();
  workspace.failAssertion = true;
  workspace.failRelease = true;
  let factoryCalls = 0;
  const worker = leasedWorker(
    authority,
    workspace,
    Object.freeze({
      create: () => {
        factoryCalls += 1;
        return emptyWorker();
      },
    }),
  );

  await assert.rejects(drain(worker, workerRequest(authority)), /no longer current/);
  assert.equal(workspace.issueCount, 1);
  assert.equal(workspace.assertCount, 1);
  assert.equal(workspace.releaseCount, 1);
  assert.equal(factoryCalls, 0);
});

void test('[I-008][I-010][M2-D02] Candidate Worker factory failure releases the current lease', async () => {
  const current = candidateAuthority(RunStatus.RUNNING);
  const authority: CandidateAuthorityFixture = Object.freeze({
    attemptId: current.activeAttemptId,
    goal: current.goal,
    workflow: current.workflow,
    candidate: current.candidate,
    generation: current.generation,
  });
  const workspace = new TrackingWorkspace();
  let factoryCalls = 0;
  const worker = leasedWorker(
    authority,
    workspace,
    Object.freeze({
      create: () => {
        factoryCalls += 1;
        throw new Error('Candidate Worker factory failed');
      },
    }),
  );

  await assert.rejects(drain(worker, workerRequest(authority)), /factory failed/);
  assert.equal(workspace.issueCount, 1);
  assert.equal(workspace.assertCount, 1);
  assert.equal(workspace.releaseCount, 1);
  assert.equal(factoryCalls, 1);
});

void test('[I-010][M2-D02] non-IMPLEMENT dispatch delegates without Candidate lease authority', async () => {
  const current = candidateAuthority(RunStatus.RUNNING);
  const authority: CandidateAuthorityFixture = Object.freeze({
    attemptId: current.activeAttemptId,
    goal: current.goal,
    workflow: current.workflow,
    candidate: current.candidate,
    generation: current.generation,
  });
  const workspace = new TrackingWorkspace();
  let delegated = 0;
  const worker = leasedWorker(
    authority,
    workspace,
    Object.freeze({
      create: () => {
        throw new Error('IMPLEMENT factory must not run');
      },
    }),
    emptyWorker(() => {
      delegated += 1;
    }),
  );

  await drain(worker, workerRequest(authority, WorkflowPhase.DISCOVERY));
  assert.equal(delegated, 1);
  assert.equal(workspace.issueCount, 0);
  assert.equal(workspace.assertCount, 0);
  assert.equal(workspace.releaseCount, 0);
});
