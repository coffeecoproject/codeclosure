import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AttemptFailureClass,
  AttemptInterruptionReason,
  AttemptRejectionCode,
  AttemptStatus,
  CandidateAccess,
  PhaseAction,
  RetryClassification,
  RunStatus,
  WORKFLOW_PHASES,
  WorkflowPhase,
  applyAttemptEvent,
  applyWorkflowCancellationToAttempt,
  attemptId,
  candidateGenerationId,
  capabilityAllows,
  classifyAttemptFailure,
  commandId,
  createWorkflow,
  decideAttempt,
  decideWorkflow,
  deriveCapabilityGrant,
  goalId,
  goalRevision,
  isCanonicalCapabilityGrant,
  isoTimestamp,
  workflowId,
  workflowVersion,
  type Attempt,
  type AttemptDecision,
  type AttemptEvent,
  type AttemptStarted,
  type WorkflowEvent,
  type WorkflowInstance,
  type WorkflowPhase as WorkflowPhaseType,
} from '@codeclosure/domain';

const startedAt = isoTimestamp('2026-07-27T01:00:00.000Z');
const finishedAt = isoTimestamp('2026-07-27T01:00:01.000Z');
const laterWorkflowAt = isoTimestamp('2026-07-27T01:00:02.000Z');
const activeAttemptId = attemptId('attempt_reducer-1');

function readyWorkflow(phase: WorkflowPhaseType = WorkflowPhase.DISCOVERY): WorkflowInstance {
  const initial = createWorkflow({
    id: workflowId('workflow_attempt-reducer'),
    goalId: goalId('goal_attempt-reducer'),
    goalRevision: goalRevision(1),
    createdAt: startedAt,
  });
  if (phase === WorkflowPhase.DISCOVERY) {
    return initial;
  }
  return Object.freeze({
    ...initial,
    phase,
    ...(phase === WorkflowPhase.IMPLEMENT ||
    phase === WorkflowPhase.SOURCE_FREEZE ||
    phase === WorkflowPhase.EVIDENCE_BUILD ||
    phase === WorkflowPhase.FINAL_VERIFY ||
    phase === WorkflowPhase.CLOSEOUT
      ? { activeCandidateGenerationId: candidateGenerationId('generation_attempt-reducer') }
      : {}),
    ...(phase === WorkflowPhase.CLOSEOUT ? { runStatus: RunStatus.CLOSED } : {}),
  });
}

function acceptedAttemptEvent(decision: AttemptDecision): AttemptEvent {
  if (!decision.accepted) {
    assert.fail(`Expected accepted Attempt decision, received ${decision.rejection.code}`);
  }
  return decision.events[0];
}

function begin(workflow = readyWorkflow()): {
  readonly workflow: WorkflowInstance;
  readonly attempt: Attempt;
  readonly event: AttemptStarted;
} {
  const event = acceptedAttemptEvent(
    decideAttempt(workflow, undefined, {
      type: 'BEGIN_ATTEMPT',
      commandId: commandId('command_begin-attempt-reducer'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: activeAttemptId,
      sequence: 1,
      occurredAt: startedAt,
    }),
  );
  if (event.type !== 'ATTEMPT_STARTED') {
    assert.fail('BeginAttempt must emit ATTEMPT_STARTED');
  }
  const applied = applyAttemptEvent(workflow, undefined, event);
  return { ...applied, event };
}

function acceptedWorkflowEvent(decision: ReturnType<typeof decideWorkflow>): WorkflowEvent {
  if (!decision.accepted) {
    assert.fail(`Expected accepted Workflow decision, received ${decision.rejection.code}`);
  }
  return decision.events[0];
}

void test('[I-008][I-023] beginning an Attempt advances the owning Workflow version', () => {
  const initial = readyWorkflow();
  const running = begin(initial);

  assert.equal(running.attempt.status, AttemptStatus.RUNNING);
  assert.equal(running.workflow.runStatus, RunStatus.RUNNING);
  assert.equal(running.workflow.activeAttemptId, running.attempt.id);
  assert.equal(running.workflow.version, 2);
  assert.equal(running.attempt.phase, initial.phase);
  assert.equal(isCanonicalCapabilityGrant(running.attempt.capabilityGrant), true);
});

void test('[I-002] recording a worker result does not advance phase or imply success', () => {
  const running = begin();
  const event = acceptedAttemptEvent(
    decideAttempt(running.workflow, running.attempt, {
      type: 'RECORD_ATTEMPT_RESULT',
      commandId: commandId('command_record-result'),
      workflowId: running.workflow.id,
      expectedWorkflowVersion: running.workflow.version,
      attemptId: running.attempt.id,
      occurredAt: finishedAt,
      reason: 'validated result routed to the runtime',
    }),
  );
  const finished = applyAttemptEvent(running.workflow, running.attempt, event);

  assert.equal(finished.attempt.status, AttemptStatus.RESULT_RECORDED);
  assert.equal(finished.workflow.phase, WorkflowPhase.DISCOVERY);
  assert.equal(finished.workflow.runStatus, RunStatus.READY);
  assert.equal(finished.workflow.activeAttemptId, undefined);
  assert.equal(finished.workflow.version, 3);
});

void test('[I-027] failure classes produce explicit retry, reconciliation, or terminal states', () => {
  const expected = new Map<
    AttemptFailureClass,
    readonly [
      RetryClassification,
      typeof RunStatus.READY | typeof RunStatus.BLOCKED | typeof RunStatus.FAILED,
    ]
  >([
    [AttemptFailureClass.TRANSIENT_BACKEND, [RetryClassification.RETRYABLE, RunStatus.READY]],
    [AttemptFailureClass.TIMEOUT, [RetryClassification.RECONCILE_FIRST, RunStatus.BLOCKED]],
    [
      AttemptFailureClass.ABRUPT_TERMINATION,
      [RetryClassification.RECONCILE_FIRST, RunStatus.BLOCKED],
    ],
    [AttemptFailureClass.PROTOCOL_ERROR, [RetryClassification.NON_RETRYABLE, RunStatus.FAILED]],
    [
      AttemptFailureClass.INTEGRITY_VIOLATION,
      [RetryClassification.NON_RETRYABLE, RunStatus.FAILED],
    ],
    [AttemptFailureClass.PERMANENT_BACKEND, [RetryClassification.NON_RETRYABLE, RunStatus.FAILED]],
    [AttemptFailureClass.UNKNOWN, [RetryClassification.NON_RETRYABLE, RunStatus.FAILED]],
  ]);

  for (const [failureClass, [classification, runStatus]] of expected) {
    const running = begin();
    const event = acceptedAttemptEvent(
      decideAttempt(running.workflow, running.attempt, {
        type: 'RECORD_ATTEMPT_FAILURE',
        commandId: commandId(`command_fail-${failureClass.toLowerCase().replaceAll('_', '-')}`),
        workflowId: running.workflow.id,
        expectedWorkflowVersion: running.workflow.version,
        attemptId: running.attempt.id,
        failureClass,
        occurredAt: finishedAt,
        reason: `observed ${failureClass}`,
      }),
    );
    const failed = applyAttemptEvent(running.workflow, running.attempt, event);

    assert.equal(classifyAttemptFailure(failureClass), classification);
    assert.equal(failed.attempt.status, AttemptStatus.FAILED);
    assert.equal(failed.workflow.runStatus, runStatus);
  }
});

void test('[I-008] interruption closes one Attempt and releases the Workflow explicitly', () => {
  const running = begin();
  const event = acceptedAttemptEvent(
    decideAttempt(running.workflow, running.attempt, {
      type: 'INTERRUPT_ATTEMPT',
      commandId: commandId('command_interrupt-attempt'),
      workflowId: running.workflow.id,
      expectedWorkflowVersion: running.workflow.version,
      attemptId: running.attempt.id,
      interruptionReason: AttemptInterruptionReason.RECOVERY_RECONCILIATION,
      resultingRunStatus: RunStatus.BLOCKED,
      occurredAt: finishedAt,
      reason: 'external state must be reconciled',
    }),
  );
  const interrupted = applyAttemptEvent(running.workflow, running.attempt, event);

  assert.equal(interrupted.attempt.status, AttemptStatus.INTERRUPTED);
  assert.equal(interrupted.workflow.runStatus, RunStatus.BLOCKED);
  assert.match(interrupted.attempt.terminationReason, /^RECOVERY_RECONCILIATION:/);
});

void test('[I-008] stale, non-active, and terminal Attempt commands fail closed', () => {
  const running = begin();
  const stale = decideAttempt(running.workflow, running.attempt, {
    type: 'RECORD_ATTEMPT_RESULT',
    commandId: commandId('command_stale-attempt-result'),
    workflowId: running.workflow.id,
    expectedWorkflowVersion: workflowVersion(1),
    attemptId: running.attempt.id,
    occurredAt: finishedAt,
    reason: 'late result',
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.rejection.code, AttemptRejectionCode.STALE_WORKFLOW_VERSION);

  const other = decideAttempt(running.workflow, running.attempt, {
    type: 'RECORD_ATTEMPT_RESULT',
    commandId: commandId('command_other-attempt-result'),
    workflowId: running.workflow.id,
    expectedWorkflowVersion: running.workflow.version,
    attemptId: attemptId('attempt_other'),
    occurredAt: finishedAt,
    reason: 'wrong Attempt',
  });
  assert.equal(other.accepted, false);
  assert.equal(other.rejection.code, AttemptRejectionCode.ATTEMPT_ID_MISMATCH);

  const resultEvent = acceptedAttemptEvent(
    decideAttempt(running.workflow, running.attempt, {
      type: 'RECORD_ATTEMPT_RESULT',
      commandId: commandId('command_finish-before-terminal-check'),
      workflowId: running.workflow.id,
      expectedWorkflowVersion: running.workflow.version,
      attemptId: running.attempt.id,
      occurredAt: finishedAt,
      reason: 'first terminal result',
    }),
  );
  const finished = applyAttemptEvent(running.workflow, running.attempt, resultEvent);
  const terminal = decideAttempt(finished.workflow, finished.attempt, {
    type: 'RECORD_ATTEMPT_RESULT',
    commandId: commandId('command_second-terminal-result'),
    workflowId: finished.workflow.id,
    expectedWorkflowVersion: finished.workflow.version,
    attemptId: finished.attempt.id,
    occurredAt: finishedAt,
    reason: 'second terminal result',
  });
  assert.equal(terminal.accepted, false);
  assert.equal(terminal.rejection.code, AttemptRejectionCode.ACTIVE_ATTEMPT_MISMATCH);
});

void test('[I-008] Attempt commands and events cannot predate owning Workflow state', () => {
  const running = begin();
  const currentWorkflow = Object.freeze({
    ...running.workflow,
    updatedAt: laterWorkflowAt,
  });
  const decision = decideAttempt(currentWorkflow, running.attempt, {
    type: 'RECORD_ATTEMPT_RESULT',
    commandId: commandId('command_attempt-time-regression'),
    workflowId: currentWorkflow.id,
    expectedWorkflowVersion: currentWorkflow.version,
    attemptId: running.attempt.id,
    occurredAt: finishedAt,
    reason: 'older result must fail closed',
  });
  assert.equal(decision.accepted, false);
  assert.equal(decision.rejection.code, AttemptRejectionCode.INVALID_TIMESTAMP_ORDER);

  const olderEvent = acceptedAttemptEvent(
    decideAttempt(running.workflow, running.attempt, {
      type: 'RECORD_ATTEMPT_RESULT',
      commandId: commandId('command_attempt-time-event'),
      workflowId: running.workflow.id,
      expectedWorkflowVersion: running.workflow.version,
      attemptId: running.attempt.id,
      occurredAt: finishedAt,
      reason: 'prepare an event before advancing the causal floor',
    }),
  );
  assert.throws(
    () => applyAttemptEvent(currentWorkflow, running.attempt, olderEvent),
    /event time cannot precede current Workflow state/,
  );
});

void test('[I-023][I-024] capability grants are canonical and phase actions fail closed', () => {
  for (const phase of WORKFLOW_PHASES) {
    const grant = deriveCapabilityGrant(phase);
    assert.equal(isCanonicalCapabilityGrant(grant), true);
    assert.equal(new Set(grant.allowedActions).size, grant.allowedActions.length);
    for (const action of Object.values(PhaseAction)) {
      assert.equal(capabilityAllows(grant, action), grant.allowedActions.includes(action));
    }
  }

  const discovery = deriveCapabilityGrant(WorkflowPhase.DISCOVERY);
  const implementation = deriveCapabilityGrant(WorkflowPhase.IMPLEMENT);
  const evidence = deriveCapabilityGrant(WorkflowPhase.EVIDENCE_BUILD);
  assert.equal(
    isCanonicalCapabilityGrant({ ...discovery, projectRead: 'truthy-but-not-boolean' }),
    false,
  );
  assert.equal(capabilityAllows(discovery, PhaseAction.WRITE_CANDIDATE_SOURCE), false);
  assert.equal(capabilityAllows(implementation, PhaseAction.WRITE_CANDIDATE_SOURCE), true);
  assert.equal(capabilityAllows(evidence, PhaseAction.WRITE_CANDIDATE_SOURCE), false);
});

void test('[I-023] event application rejects a fabricated phase capability grant', () => {
  const workflow = readyWorkflow();
  const started = begin(workflow).event;
  const forged: AttemptEvent = {
    ...started,
    attempt: {
      ...started.attempt,
      capabilityGrant: {
        ...started.attempt.capabilityGrant,
        candidateAccess: CandidateAccess.MUTABLE_WRITE,
      },
    },
  };

  assert.throws(
    () => applyAttemptEvent(workflow, undefined, forged),
    /Attempt identity or capability invariant/,
  );
});

void test('[I-006][I-008] event application rejects terminal fields on a forged RUNNING Attempt', () => {
  const workflow = readyWorkflow();
  const started = begin(workflow).event;
  const forged = {
    ...started,
    attempt: {
      ...started.attempt,
      terminationReason: 'fabricated terminal state',
      endedAt: finishedAt,
    },
  } as unknown as AttemptEvent;

  assert.throws(
    () => applyAttemptEvent(workflow, undefined, forged),
    /RUNNING Attempt contains terminal lifecycle fields/,
  );
});

void test('[I-006][I-008] reducers reject every poisoned current RUNNING Attempt shape', () => {
  const running = begin();
  const resultEvent = acceptedAttemptEvent(
    decideAttempt(running.workflow, running.attempt, {
      type: 'RECORD_ATTEMPT_RESULT',
      commandId: commandId('command_poisoned-current-result'),
      workflowId: running.workflow.id,
      expectedWorkflowVersion: running.workflow.version,
      attemptId: running.attempt.id,
      occurredAt: finishedAt,
      reason: 'valid event prepared before poisoning current state',
    }),
  );
  const cancellationEvent = acceptedWorkflowEvent(
    decideWorkflow(running.workflow, {
      type: 'CANCEL_WORKFLOW',
      commandId: commandId('command_poisoned-current-cancel'),
      workflowId: running.workflow.id,
      expectedVersion: running.workflow.version,
      occurredAt: finishedAt,
      reason: 'validate cancellation against poisoned current state',
    }),
  );
  if (cancellationEvent.type !== 'WORKFLOW_CANCELLED') {
    assert.fail('Cancellation command must emit WORKFLOW_CANCELLED');
  }

  for (const terminalFields of [
    { failureClass: AttemptFailureClass.UNKNOWN },
    { terminationReason: 'fabricated terminal reason' },
    { endedAt: finishedAt },
  ]) {
    const poisoned = { ...running.attempt, ...terminalFields } as unknown as Attempt;
    assert.throws(
      () =>
        decideAttempt(running.workflow, poisoned, {
          type: 'RECORD_ATTEMPT_RESULT',
          commandId: commandId('command_poisoned-current-decision'),
          workflowId: running.workflow.id,
          expectedWorkflowVersion: running.workflow.version,
          attemptId: running.attempt.id,
          occurredAt: finishedAt,
          reason: 'poisoned state must fail closed',
        }),
      /RUNNING Attempt contains terminal lifecycle fields/,
    );
    assert.throws(
      () => applyAttemptEvent(running.workflow, poisoned, resultEvent),
      /RUNNING Attempt contains terminal lifecycle fields/,
    );
    assert.throws(
      () => applyWorkflowCancellationToAttempt(running.workflow, poisoned, cancellationEvent),
      /RUNNING Attempt contains terminal lifecycle fields/,
    );
  }
});

void test('[I-008] result and cancellation share one Workflow version so only one can win', () => {
  const running = begin();
  const resultEvent = acceptedAttemptEvent(
    decideAttempt(running.workflow, running.attempt, {
      type: 'RECORD_ATTEMPT_RESULT',
      commandId: commandId('command_race-result'),
      workflowId: running.workflow.id,
      expectedWorkflowVersion: running.workflow.version,
      attemptId: running.attempt.id,
      occurredAt: finishedAt,
      reason: 'result arrived',
    }),
  );
  const cancellationEvent = acceptedWorkflowEvent(
    decideWorkflow(running.workflow, {
      type: 'CANCEL_WORKFLOW',
      commandId: commandId('command_race-cancel'),
      workflowId: running.workflow.id,
      expectedVersion: running.workflow.version,
      occurredAt: finishedAt,
      reason: 'user cancelled',
    }),
  );
  if (cancellationEvent.type !== 'WORKFLOW_CANCELLED') {
    assert.fail('Cancellation command must emit WORKFLOW_CANCELLED');
  }

  const resultWon = applyAttemptEvent(running.workflow, running.attempt, resultEvent);
  assert.throws(
    () =>
      applyWorkflowCancellationToAttempt(resultWon.workflow, resultWon.attempt, cancellationEvent),
    /identity or version/,
  );

  const cancellationWon = applyWorkflowCancellationToAttempt(
    running.workflow,
    running.attempt,
    cancellationEvent,
  );
  assert.equal(cancellationWon.workflow.runStatus, RunStatus.CANCELLED);
  assert.equal(cancellationWon.attempt?.status, AttemptStatus.INTERRUPTED);
  assert.throws(
    () => applyAttemptEvent(cancellationWon.workflow, cancellationWon.attempt, resultEvent),
    /identity or version/,
  );
});
