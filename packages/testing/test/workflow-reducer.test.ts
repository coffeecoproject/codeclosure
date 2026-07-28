import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
  GuardOutcome,
  RunStatus,
  WORKFLOW_PHASES,
  WorkflowGuard,
  WorkflowPhase,
  WorkflowRejectionCode,
  applyWorkflowEvent,
  assertWorkflowInvariant,
  attemptId,
  candidateGenerationId,
  commandId,
  createWorkflow,
  decideWorkflow,
  goalId,
  goalRevision,
  isoTimestamp,
  requiredGuardsForTransition,
  workflowId,
  workflowVersion,
  type CandidateGenerationId,
  type GuardResult,
  type RequestPhaseTransition,
  type WorkflowDecision,
  type WorkflowEvent,
  type WorkflowInstance,
  type WorkflowPhase as WorkflowPhaseType,
} from '@codeclosure/domain';

const occurredAt = isoTimestamp('2026-07-27T00:00:00.000Z');
const laterAt = isoTimestamp('2026-07-27T00:00:00.001Z');
const beforeCreation = isoTimestamp('2026-07-26T23:59:59.999Z');
const firstGenerationId = candidateGenerationId('generation_first');
const secondGenerationId = candidateGenerationId('generation_second');

function newWorkflow(): WorkflowInstance {
  return createWorkflow({
    id: workflowId('workflow_reducer'),
    goalId: goalId('goal_reducer'),
    goalRevision: goalRevision(1),
    createdAt: occurredAt,
  });
}

function passingGuards(from: WorkflowPhaseType, to: WorkflowPhaseType): readonly GuardResult[] {
  const guards = requiredGuardsForTransition(from, to);
  if (guards === undefined) {
    throw new TypeError(`No legal transition exists for ${from} -> ${to}`);
  }
  return guards.map((guard) => ({
    guard,
    outcome: GuardOutcome.PASS,
    reasonCode: 'TEST_PROOF',
    supportingRefs: [`test:${guard.toLowerCase()}`],
  }));
}

function transitionCommand(
  workflow: WorkflowInstance,
  requestedPhase: WorkflowPhaseType,
  guardResults = passingGuards(workflow.phase, requestedPhase),
  nextCandidateGenerationId?: CandidateGenerationId,
): RequestPhaseTransition {
  const base = {
    type: 'REQUEST_PHASE_TRANSITION' as const,
    commandId: commandId(
      `command_${workflow.phase.toLowerCase().replaceAll('_', '-')}-${requestedPhase
        .toLowerCase()
        .replaceAll('_', '-')}`,
    ),
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt,
    reason: `advance ${workflow.phase} to ${requestedPhase}`,
    requestedPhase,
    guardResults,
  };
  return nextCandidateGenerationId === undefined ? base : { ...base, nextCandidateGenerationId };
}

function acceptedEvent(decision: WorkflowDecision): WorkflowEvent {
  if (!decision.accepted) {
    assert.fail(`Expected accepted decision, received ${decision.rejection.code}`);
  }
  return decision.events[0];
}

function advance(
  workflow: WorkflowInstance,
  to: WorkflowPhaseType,
  nextCandidateGenerationId?: CandidateGenerationId,
): WorkflowInstance {
  return applyWorkflowEvent(
    workflow,
    acceptedEvent(
      decideWorkflow(
        workflow,
        transitionCommand(workflow, to, undefined, nextCandidateGenerationId),
      ),
    ),
  );
}

function finalVerifyWorkflow(): WorkflowInstance {
  let workflow = newWorkflow();
  workflow = advance(workflow, WorkflowPhase.PLAN);
  workflow = advance(workflow, WorkflowPhase.IMPLEMENT, firstGenerationId);
  workflow = advance(workflow, WorkflowPhase.SOURCE_FREEZE);
  workflow = advance(workflow, WorkflowPhase.EVIDENCE_BUILD);
  return advance(workflow, WorkflowPhase.FINAL_VERIFY);
}

void test('[I-008] every documented legal phase edge succeeds with passing guards', () => {
  let workflow = newWorkflow();

  workflow = advance(workflow, WorkflowPhase.PLAN);
  assert.equal(workflow.phase, WorkflowPhase.PLAN);

  workflow = advance(workflow, WorkflowPhase.IMPLEMENT, firstGenerationId);
  assert.equal(workflow.activeCandidateGenerationId, firstGenerationId);

  workflow = advance(workflow, WorkflowPhase.SOURCE_FREEZE);
  workflow = advance(workflow, WorkflowPhase.EVIDENCE_BUILD);
  workflow = advance(workflow, WorkflowPhase.FINAL_VERIFY);

  const beforeCloseout = workflow;
  const closed = advance(beforeCloseout, WorkflowPhase.CLOSEOUT);
  assert.equal(closed.phase, WorkflowPhase.CLOSEOUT);
  assert.equal(closed.runStatus, RunStatus.CLOSED);

  const repaired = advance(beforeCloseout, WorkflowPhase.IMPLEMENT, secondGenerationId);
  assert.equal(repaired.phase, WorkflowPhase.IMPLEMENT);
  assert.equal(repaired.activeCandidateGenerationId, secondGenerationId);
});

void test('[I-008] every undocumented phase pair fails closed', () => {
  const legalEdges = new Set([
    'DISCOVERY->PLAN',
    'PLAN->IMPLEMENT',
    'IMPLEMENT->SOURCE_FREEZE',
    'SOURCE_FREEZE->EVIDENCE_BUILD',
    'EVIDENCE_BUILD->FINAL_VERIFY',
    'FINAL_VERIFY->CLOSEOUT',
    'FINAL_VERIFY->IMPLEMENT',
  ]);
  const phaseArbitrary = fc.constantFrom(...WORKFLOW_PHASES);

  fc.assert(
    fc.property(phaseArbitrary, phaseArbitrary, (from, to) => {
      fc.pre(!legalEdges.has(`${from}->${to}`));
      const workflow: WorkflowInstance = {
        ...newWorkflow(),
        phase: from,
        runStatus: from === WorkflowPhase.CLOSEOUT ? RunStatus.CLOSED : RunStatus.READY,
        activeCandidateGenerationId: firstGenerationId,
      };
      const command = transitionCommand(
        workflow,
        to,
        [],
        to === WorkflowPhase.IMPLEMENT ? secondGenerationId : undefined,
      );

      const decision = decideWorkflow(workflow, command);
      assert.equal(decision.accepted, false);
    }),
  );
});

void test('[I-003][I-008] a completion request cannot jump from IMPLEMENT to CLOSEOUT', () => {
  let workflow = newWorkflow();
  workflow = advance(workflow, WorkflowPhase.PLAN);
  workflow = advance(workflow, WorkflowPhase.IMPLEMENT, firstGenerationId);

  const decision = decideWorkflow(
    workflow,
    transitionCommand(workflow, WorkflowPhase.CLOSEOUT, []),
  );

  assert.equal(decision.accepted, false);
  assert.equal(decision.rejection.code, WorkflowRejectionCode.ILLEGAL_TRANSITION);
});

void test('[I-008] stale aggregate versions cannot mutate workflow state', () => {
  const workflow = newWorkflow();
  const command = {
    ...transitionCommand(workflow, WorkflowPhase.PLAN),
    expectedVersion: workflowVersion(2),
  };

  const decision = decideWorkflow(workflow, command);

  assert.equal(decision.accepted, false);
  assert.equal(decision.rejection.code, WorkflowRejectionCode.STALE_VERSION);
  assert.equal(workflow.phase, WorkflowPhase.DISCOVERY);
  assert.equal(workflow.version, workflowVersion(1));
});

void test('[I-008] guard sets reject missing, failed, unsupported, duplicate, and extra proof', () => {
  const workflow = newWorkflow();
  const valid = passingGuards(WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN);
  const first = valid[0];
  if (first === undefined) {
    assert.fail('Discovery guard set must not be empty');
  }

  const cases: readonly [readonly GuardResult[], WorkflowRejectionCode][] = [
    [valid.slice(1), WorkflowRejectionCode.MISSING_GUARD],
    [
      [{ ...first, outcome: GuardOutcome.FAIL }, ...valid.slice(1)],
      WorkflowRejectionCode.FAILED_GUARD,
    ],
    [
      [{ ...first, outcome: GuardOutcome.UNKNOWN }, ...valid.slice(1)],
      WorkflowRejectionCode.FAILED_GUARD,
    ],
    [
      [{ ...first, supportingRefs: [] }, ...valid.slice(1)],
      WorkflowRejectionCode.GUARD_MISSING_SUPPORT,
    ],
    [[...valid, first], WorkflowRejectionCode.DUPLICATE_GUARD],
    [
      [
        ...valid,
        {
          guard: WorkflowGuard.CURRENT_ACCEPTANCE,
          outcome: GuardOutcome.PASS,
          reasonCode: 'WRONG_PHASE',
          supportingRefs: ['test:acceptance'],
        },
      ],
      WorkflowRejectionCode.UNEXPECTED_GUARD,
    ],
  ];

  for (const [guardResults, expectedCode] of cases) {
    const decision = decideWorkflow(
      workflow,
      transitionCommand(workflow, WorkflowPhase.PLAN, guardResults),
    );
    assert.equal(decision.accepted, false);
    assert.equal(decision.rejection.code, expectedCode);
  }
});

void test('[I-003] FINAL_VERIFY cannot close without current Acceptance proof', () => {
  const workflow = finalVerifyWorkflow();
  const decision = decideWorkflow(
    workflow,
    transitionCommand(workflow, WorkflowPhase.CLOSEOUT, []),
  );

  assert.equal(decision.accepted, false);
  assert.equal(decision.rejection.code, WorkflowRejectionCode.MISSING_GUARD);
  assert.equal(decision.rejection.failedGuard, WorkflowGuard.CURRENT_ACCEPTANCE);
});

void test('[I-014] repair requires a fresh Candidate generation', () => {
  const workflow = finalVerifyWorkflow();

  const missing = decideWorkflow(
    workflow,
    transitionCommand(workflow, WorkflowPhase.IMPLEMENT, undefined),
  );
  assert.equal(missing.accepted, false);
  assert.equal(missing.rejection.code, WorkflowRejectionCode.MISSING_NEXT_CANDIDATE);

  const reused = decideWorkflow(
    workflow,
    transitionCommand(workflow, WorkflowPhase.IMPLEMENT, undefined, firstGenerationId),
  );
  assert.equal(reused.accepted, false);
  assert.equal(reused.rejection.code, WorkflowRejectionCode.CANDIDATE_GENERATION_REUSE);
});

void test('[I-010] cancellation remains distinct from successful closeout', () => {
  const workflow = newWorkflow();
  const decision = decideWorkflow(workflow, {
    type: 'CANCEL_WORKFLOW',
    commandId: commandId('command_cancel'),
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt,
    reason: 'user cancelled the goal',
  });
  const cancelled = applyWorkflowEvent(workflow, acceptedEvent(decision));

  assert.equal(cancelled.runStatus, RunStatus.CANCELLED);
  assert.notEqual(cancelled.runStatus, RunStatus.CLOSED);
  assert.notEqual(cancelled.phase, WorkflowPhase.CLOSEOUT);

  const followUp = decideWorkflow(cancelled, {
    ...transitionCommand(cancelled, WorkflowPhase.PLAN),
    expectedVersion: cancelled.version,
  });
  assert.equal(followUp.accepted, false);
  assert.equal(followUp.rejection.code, WorkflowRejectionCode.TERMINAL_WORKFLOW);
});

void test('[I-005][I-008] an integrity failure preserves phase and Candidate while failing the Workflow', () => {
  let workflow = newWorkflow();
  workflow = advance(workflow, WorkflowPhase.PLAN);
  workflow = advance(workflow, WorkflowPhase.IMPLEMENT, firstGenerationId);
  workflow = advance(workflow, WorkflowPhase.SOURCE_FREEZE);
  workflow = advance(workflow, WorkflowPhase.EVIDENCE_BUILD);

  const decision = decideWorkflow(workflow, {
    type: 'FAIL_WORKFLOW_INTEGRITY',
    commandId: commandId('command_integrity-failure'),
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt: laterAt,
    reason: 'frozen Candidate digest changed',
  });
  const event = acceptedEvent(decision);
  assert.equal(event.type, 'WORKFLOW_INTEGRITY_FAILED');

  const failed = applyWorkflowEvent(workflow, event);
  assert.equal(failed.phase, WorkflowPhase.EVIDENCE_BUILD);
  assert.equal(failed.runStatus, RunStatus.FAILED);
  assert.equal(failed.activeAttemptId, undefined);
  assert.equal(failed.activeCandidateGenerationId, firstGenerationId);
  assert.equal(failed.version, workflowVersion(workflow.version + 1));
  assert.equal(failed.suspendedReason, 'frozen Candidate digest changed');
});

void test('[I-008] integrity failure rejects an active Attempt and forged state bindings', () => {
  let workflow = newWorkflow();
  workflow = advance(workflow, WorkflowPhase.PLAN);
  workflow = advance(workflow, WorkflowPhase.IMPLEMENT, firstGenerationId);
  const running = Object.freeze({
    ...workflow,
    runStatus: RunStatus.RUNNING,
    activeAttemptId: attemptId('attempt_integrity-running'),
  });
  const rejected = decideWorkflow(running, {
    type: 'FAIL_WORKFLOW_INTEGRITY',
    commandId: commandId('command_integrity-running'),
    workflowId: running.id,
    expectedVersion: running.version,
    occurredAt: laterAt,
    reason: 'must use the owning compound failure transaction',
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.rejection.code, WorkflowRejectionCode.RUN_STATUS_NOT_READY);

  const decision = decideWorkflow(workflow, {
    type: 'FAIL_WORKFLOW_INTEGRITY',
    commandId: commandId('command_integrity-forgery'),
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt: laterAt,
    reason: 'candidate integrity failed',
  });
  const event = acceptedEvent(decision);
  if (event.type !== 'WORKFLOW_INTEGRITY_FAILED') {
    assert.fail('Expected a Workflow integrity failure event');
  }
  assert.throws(
    () => applyWorkflowEvent(workflow, { ...event, phase: WorkflowPhase.PLAN }),
    /does not match a READY Workflow/,
  );
});

void test('[I-008] terminal Workflow immutability is enforced during event application', () => {
  const workflow = newWorkflow();
  const firstEvent = acceptedEvent(
    decideWorkflow(workflow, {
      type: 'CANCEL_WORKFLOW',
      commandId: commandId('command_cancel-first'),
      workflowId: workflow.id,
      expectedVersion: workflow.version,
      occurredAt,
      reason: 'first cancellation',
    }),
  );
  if (firstEvent.type !== 'WORKFLOW_CANCELLED') {
    assert.fail('Cancellation command must emit WORKFLOW_CANCELLED');
  }
  const cancelled = applyWorkflowEvent(workflow, firstEvent);
  const forgedFreshEvent = {
    ...firstEvent,
    commandId: commandId('command_cancel-forged-fresh'),
    fromVersion: cancelled.version,
    toVersion: workflowVersion(cancelled.version + 1),
    occurredAt: laterAt,
  };

  assert.throws(
    () => applyWorkflowEvent(cancelled, forgedFreshEvent),
    /Terminal Workflow cannot apply another event/,
  );
  assert.equal(cancelled.version, workflowVersion(2));
  assert.equal(cancelled.runStatus, RunStatus.CANCELLED);
});

void test('[I-008] Workflow snapshots, commands, and events cannot move time backward', () => {
  const workflow = newWorkflow();
  assert.throws(
    () => assertWorkflowInvariant({ ...workflow, updatedAt: beforeCreation }),
    /updatedAt cannot precede createdAt/,
  );

  const current = Object.freeze({ ...workflow, updatedAt: laterAt });
  const decision = decideWorkflow(current, transitionCommand(current, WorkflowPhase.PLAN));
  assert.equal(decision.accepted, false);
  assert.equal(decision.rejection.code, WorkflowRejectionCode.INVALID_TIMESTAMP_ORDER);

  const olderEvent = acceptedEvent(
    decideWorkflow(workflow, transitionCommand(workflow, WorkflowPhase.PLAN)),
  );
  assert.throws(
    () => applyWorkflowEvent(current, olderEvent),
    /event time cannot precede current state/,
  );
});

void test('[I-008] event application rejects state or version mismatches', () => {
  const workflow = newWorkflow();
  const event = acceptedEvent(
    decideWorkflow(workflow, transitionCommand(workflow, WorkflowPhase.PLAN)),
  );
  if (event.type !== 'WORKFLOW_PHASE_TRANSITIONED') {
    assert.fail('Expected a phase-transition event');
  }
  const advanced = applyWorkflowEvent(workflow, event);

  assert.throws(() => applyWorkflowEvent(advanced, event), /version does not match/);
  assert.throws(
    () => applyWorkflowEvent(workflow, { ...event, toPhase: WorkflowPhase.CLOSEOUT }),
    /illegal phase edge/,
  );
  assert.throws(
    () => applyWorkflowEvent(workflow, { ...event, toVersion: workflowVersion(3) }),
    /version exactly once/,
  );
});
