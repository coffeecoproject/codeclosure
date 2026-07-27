import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  AttemptStatus,
  GuardOutcome,
  PhaseAction,
  RunStatus,
  WorkflowPhase,
  applyAttemptEvent,
  applyWorkflowCancellationToAttempt,
  applyWorkflowEvent,
  commandId,
  createWorkflow,
  goalId,
  goalRevision,
  requiredGuardsForTransition,
  sha256Digest,
  workflowId,
  type AppliedAttemptEvent,
  type Attempt,
  type AttemptId,
  type CommandId,
  type GuardResult,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  RuntimeErrorCode,
  WorkflowRuntime,
  type CommitAttemptEvent,
  type CommitWorkflowEvent,
  type DigestProvider,
  type JsonValue,
  type ProcessedCommandView,
  type StoreCommandResult,
  type WorkflowControlStore,
} from '@codeclosure/runtime';

import { DeterministicClock, DeterministicIds } from '../src/deterministic-fixtures.ts';

class FixtureDigestProvider implements DigestProvider {
  public digest(value: unknown): Sha256Digest {
    const serialized = JSON.stringify({ value });
    return sha256Digest(`sha256:${createHash('sha256').update(serialized).digest('hex')}`);
  }
}

class InMemoryWorkflowStore implements WorkflowControlStore {
  #workflow: WorkflowInstance;
  readonly #attempts = new Map<string, Attempt>();
  readonly #processed = new Map<string, ProcessedCommandView>();
  public attemptCommits = 0;
  public workflowCommits = 0;

  public constructor(workflow: WorkflowInstance) {
    this.#workflow = workflow;
  }

  public getWorkflow(identifier: WorkflowId): WorkflowInstance | undefined {
    return identifier === this.#workflow.id ? this.#workflow : undefined;
  }

  public getAttempt(identifier: AttemptId): Attempt | undefined {
    return this.#attempts.get(identifier);
  }

  public getProcessedCommand(identifier: CommandId): ProcessedCommandView | undefined {
    return this.#processed.get(identifier);
  }

  public nextAttemptSequence(identifier: WorkflowId): number {
    if (identifier !== this.#workflow.id) {
      throw new TypeError('Unknown Workflow');
    }
    return this.#attempts.size + 1;
  }

  public commitAttemptEvent(input: CommitAttemptEvent): StoreCommandResult<AppliedAttemptEvent> {
    const replay = this.replay(input.event.commandId, input.inputDigest, input.event.workflowId);
    if (replay !== undefined) {
      return replay;
    }
    this.assertWorkflowVersion(input.event.fromWorkflowVersion);
    const currentAttempt =
      input.event.type === 'ATTEMPT_STARTED'
        ? this.#workflow.activeAttemptId === undefined
          ? undefined
          : this.#attempts.get(this.#workflow.activeAttemptId)
        : this.#attempts.get(input.event.attemptId);
    const applied = applyAttemptEvent(this.#workflow, currentAttempt, input.event);
    this.#workflow = applied.workflow;
    this.#attempts.set(applied.attempt.id, applied.attempt);
    this.#processed.set(
      input.event.commandId,
      this.processed(
        input.event.commandId,
        input.inputDigest,
        input.event.workflowId,
        input.outcome,
      ),
    );
    this.attemptCommits += 1;
    return { status: 'APPLIED', outcome: input.outcome, value: applied };
  }

  public commitWorkflowEvent(input: CommitWorkflowEvent): StoreCommandResult<WorkflowInstance> {
    const replay = this.replay(input.event.commandId, input.inputDigest, input.event.workflowId);
    if (replay !== undefined) {
      return replay;
    }
    this.assertWorkflowVersion(input.event.fromVersion);
    if (input.event.type === 'WORKFLOW_CANCELLED') {
      const currentAttempt =
        input.event.interruptedAttemptId === undefined
          ? undefined
          : this.#attempts.get(input.event.interruptedAttemptId);
      const applied = applyWorkflowCancellationToAttempt(
        this.#workflow,
        currentAttempt,
        input.event,
      );
      this.#workflow = applied.workflow;
      if (applied.attempt !== undefined) {
        this.#attempts.set(applied.attempt.id, applied.attempt);
      }
    } else {
      this.#workflow = applyWorkflowEvent(this.#workflow, input.event);
    }
    this.#processed.set(
      input.event.commandId,
      this.processed(
        input.event.commandId,
        input.inputDigest,
        input.event.workflowId,
        input.outcome,
      ),
    );
    this.workflowCommits += 1;
    return { status: 'APPLIED', outcome: input.outcome, value: this.#workflow };
  }

  private replay(
    identifier: CommandId,
    inputDigest: Sha256Digest,
    aggregateId: WorkflowId,
  ): { readonly status: 'REPLAYED'; readonly outcome: JsonValue } | undefined {
    const existing = this.#processed.get(identifier);
    if (existing === undefined) {
      return undefined;
    }
    if (
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== 'WORKFLOW' ||
      existing.aggregateId !== aggregateId
    ) {
      const error = new Error('Command ID conflict');
      error.name = 'CommandIdConflictError';
      throw error;
    }
    return { status: 'REPLAYED', outcome: existing.outcome };
  }

  private processed(
    identifier: CommandId,
    inputDigest: Sha256Digest,
    aggregateId: WorkflowId,
    outcome: JsonValue,
  ): ProcessedCommandView {
    return Object.freeze({
      commandId: identifier,
      inputDigest,
      aggregateType: 'WORKFLOW',
      aggregateId,
      outcome,
    });
  }

  private assertWorkflowVersion(expected: number): void {
    if (this.#workflow.version !== expected) {
      const error = new Error('Stale Workflow mutation');
      error.name = 'OptimisticConcurrencyError';
      throw error;
    }
  }
}

function fixture(): {
  readonly runtime: WorkflowRuntime;
  readonly store: InMemoryWorkflowStore;
  readonly workflow: WorkflowInstance;
} {
  const createdAt = '2026-07-27T02:00:00.000Z';
  const clock = new DeterministicClock([
    '2026-07-27T02:00:00.001Z',
    '2026-07-27T02:00:00.002Z',
    '2026-07-27T02:00:00.003Z',
    '2026-07-27T02:00:00.004Z',
  ]);
  const workflow = createWorkflow({
    id: workflowId('workflow_runtime-commands'),
    goalId: goalId('goal_runtime-commands'),
    goalRevision: goalRevision(1),
    createdAt: clockTimestamp(createdAt),
  });
  const store = new InMemoryWorkflowStore(workflow);
  return {
    workflow,
    store,
    runtime: new WorkflowRuntime({
      store,
      clock,
      ids: new DeterministicIds('runtime'),
      digests: new FixtureDigestProvider(),
    }),
  };
}

function clockTimestamp(value: string): ReturnType<DeterministicClock['now']> {
  return new DeterministicClock([value]).now();
}

function planGuards(): readonly GuardResult[] {
  const required = requiredGuardsForTransition(WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN);
  if (required === undefined) {
    assert.fail('DISCOVERY -> PLAN must be legal');
  }
  return required.map((guard) => ({
    guard,
    outcome: GuardOutcome.PASS,
    reasonCode: 'RUNTIME_TEST_PROOF',
    supportingRefs: [`test:${guard.toLowerCase()}`],
  }));
}

void test('[I-008] runtime handlers start, replay, route a result, and advance by guards', () => {
  const { runtime, store, workflow } = fixture();
  const beginRequest = {
    commandId: commandId('command_runtime-begin'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
  };

  const began = runtime.startGoal(beginRequest);
  const replayed = runtime.startGoal(beginRequest);
  assert.equal(began.status, 'APPLIED');
  assert.equal(began.output.runStatus, RunStatus.RUNNING);
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.output, began.output);
  assert.equal(store.attemptCommits, 1);

  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Runtime must persist a Workflow with an active Attempt');
  }
  assert.equal(running.runStatus, RunStatus.RUNNING);
  const activeAttempt = store.getAttempt(running.activeAttemptId);
  if (activeAttempt === undefined) {
    assert.fail('Runtime must persist the active Attempt');
  }
  assert.equal(activeAttempt.status, AttemptStatus.RUNNING);

  const result = runtime.recordAttemptResult({
    commandId: commandId('command_runtime-result'),
    workflowId: workflow.id,
    expectedWorkflowVersion: running.version,
    attemptId: activeAttempt.id,
    reason: 'validated result routed',
  });
  assert.equal(result.status, 'APPLIED');
  assert.equal(result.output.phase, WorkflowPhase.DISCOVERY);
  assert.equal(result.output.runStatus, RunStatus.READY);
  assert.equal(store.getAttempt(activeAttempt.id)?.status, AttemptStatus.RESULT_RECORDED);

  const ready = store.getWorkflow(workflow.id);
  if (ready === undefined) {
    assert.fail('Workflow must remain persisted');
  }
  const transitioned = runtime.requestPhaseTransition({
    commandId: commandId('command_runtime-plan'),
    workflowId: workflow.id,
    expectedWorkflowVersion: ready.version,
    requestedPhase: WorkflowPhase.PLAN,
    guardResults: planGuards(),
    reason: 'discovery obligations passed',
  });
  assert.equal(transitioned.status, 'APPLIED');
  assert.equal(transitioned.output.phase, WorkflowPhase.PLAN);
  assert.equal(store.workflowCommits, 1);
});

void test('[I-008][I-010] runtime cancellation interrupts the active Attempt', () => {
  const { runtime, store, workflow } = fixture();
  const began = runtime.beginAttempt({
    commandId: commandId('command_runtime-cancel-begin'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(began.status, 'APPLIED');
  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Workflow must have an active Attempt');
  }

  const cancelled = runtime.cancelWorkflow({
    commandId: commandId('command_runtime-cancel'),
    workflowId: workflow.id,
    expectedWorkflowVersion: running.version,
    reason: 'user cancelled',
  });

  assert.equal(cancelled.status, 'APPLIED');
  assert.equal(cancelled.output.runStatus, RunStatus.CANCELLED);
  assert.equal(store.getAttempt(running.activeAttemptId)?.status, AttemptStatus.INTERRUPTED);
});

void test('[I-009][I-027] runtime recovery blocks replacement work until reconciliation', () => {
  const { runtime, store, workflow } = fixture();
  const began = runtime.beginAttempt({
    commandId: commandId('command_runtime-recovery-begin'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(began.status, 'APPLIED');
  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Workflow must have an active Attempt');
  }

  const reconciled = runtime.reconcileAttemptAfterRestart({
    commandId: commandId('command_runtime-recovery'),
    workflowId: workflow.id,
    expectedWorkflowVersion: running.version,
    attemptId: running.activeAttemptId,
    reason: 'previous worker control cannot be proven after restart',
  });

  assert.equal(reconciled.status, 'APPLIED');
  assert.equal(reconciled.output.runStatus, RunStatus.BLOCKED);
  assert.equal(store.getAttempt(running.activeAttemptId)?.status, AttemptStatus.INTERRUPTED);
  const replacement = runtime.beginAttempt({
    commandId: commandId('command_runtime-replacement-before-resume'),
    workflowId: workflow.id,
    expectedWorkflowVersion: reconciled.output.workflowVersion,
  });
  assert.equal(replacement.status, 'REJECTED');
  assert.equal(replacement.output.error.detailCode, 'WORKFLOW_NOT_READY');
});

void test('[I-008] runtime returns typed stale and command-conflict errors without persistence', () => {
  const { runtime, store, workflow } = fixture();
  const command = commandId('command_runtime-conflict');
  const began = runtime.beginAttempt({
    commandId: command,
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(began.status, 'APPLIED');

  const conflict = runtime.beginAttempt({
    commandId: command,
    workflowId: workflow.id,
    expectedWorkflowVersion: began.output.workflowVersion,
  });
  assert.equal(conflict.status, 'REJECTED');
  assert.equal(conflict.output.error.code, RuntimeErrorCode.COMMAND_ID_CONFLICT);
  assert.equal(store.attemptCommits, 1);

  const stale = runtime.recordAttemptResult({
    commandId: commandId('command_runtime-stale'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    attemptId: store.getWorkflow(workflow.id)?.activeAttemptId ?? assert.fail('missing Attempt'),
    reason: 'stale result',
  });
  assert.equal(stale.status, 'REJECTED');
  assert.equal(stale.output.error.code, RuntimeErrorCode.STALE_WORKFLOW_VERSION);
  assert.equal(store.attemptCommits, 1);
});

void test('[I-023][I-024] denied actions reach neither effect dispatch nor persistence', async () => {
  const { runtime, store, workflow } = fixture();
  const began = runtime.beginAttempt({
    commandId: commandId('command_runtime-capability-begin'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(began.status, 'APPLIED');
  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Workflow must have an active Attempt');
  }
  let effects = 0;
  const commitsBefore = store.attemptCommits + store.workflowCommits;

  const denied = await runtime.executeAuthorizedEffect(
    {
      workflowId: workflow.id,
      expectedWorkflowVersion: running.version,
      attemptId: running.activeAttemptId,
      action: PhaseAction.WRITE_CANDIDATE_SOURCE,
    },
    () => {
      effects += 1;
      return 'must not run';
    },
  );

  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, RuntimeErrorCode.CAPABILITY_DENIED);
  assert.equal(effects, 0);
  assert.equal(store.attemptCommits + store.workflowCommits, commitsBefore);

  const allowed = await runtime.executeAuthorizedEffect(
    {
      workflowId: workflow.id,
      expectedWorkflowVersion: running.version,
      attemptId: running.activeAttemptId,
      action: PhaseAction.READ_PROJECT,
    },
    () => {
      effects += 1;
      return 'observed';
    },
  );
  assert.deepEqual(allowed, { ok: true, value: 'observed' });
  assert.equal(effects, 1);
});
