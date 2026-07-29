import type { GoalAuditView, GoalStatusView } from '@codeclosure/runtime';

const WORKER_EVENT_ID_PATTERN = /^worker-event_[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

export interface M1ClaimedActiveAttemptObservation {
  readonly attemptId: string;
  readonly phase: GoalStatusView['phase'];
  readonly workflowVersion: number;
}

type ProofAuditEvent = GoalAuditView['events'][number];

function requireSingleAttemptAudit(
  audit: GoalAuditView,
  eventType: 'ATTEMPT_STARTED' | 'ATTEMPT_FINISHED' | 'WORKER_DISPATCH_CLAIMED',
  attemptId: string,
): ProofAuditEvent {
  const matches = audit.events.filter(
    (event) => event.eventType === eventType && event.aggregateId === attemptId,
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new TypeError(`Restart proof expected one ${eventType} audit for Attempt ${attemptId}`);
  }
  return matches[0];
}

/**
 * Proves only relationships available in the public Goal audit. It does not
 * authorize recovery, dispatch, phase transition, Acceptance, or closeout.
 */
export function assertFreshReplacementDispatch(
  audit: GoalAuditView,
  abandoned: M1ClaimedActiveAttemptObservation,
  recoveredStatus: GoalStatusView,
): void {
  const recoveryAudits = audit.events.filter(
    (event) => event.eventType === 'RECOVERY_RECONCILIATION_RECORDED',
  );
  const startupRecovery = recoveryAudits[0];
  const resumeRecovery = recoveryAudits[1];
  if (
    recoveryAudits.length !== 2 ||
    startupRecovery === undefined ||
    resumeRecovery === undefined
  ) {
    throw new TypeError('Restart proof did not retain exact startup and resume reconciliations');
  }

  const abandonedStart = requireSingleAttemptAudit(audit, 'ATTEMPT_STARTED', abandoned.attemptId);
  const abandonedClaim = requireSingleAttemptAudit(
    audit,
    'WORKER_DISPATCH_CLAIMED',
    abandoned.attemptId,
  );
  const abandonedFinish = requireSingleAttemptAudit(audit, 'ATTEMPT_FINISHED', abandoned.attemptId);
  if (
    abandoned.phase !== 'DISCOVERY' ||
    recoveredStatus.phase !== abandoned.phase ||
    abandonedStart.afterVersion !== abandoned.workflowVersion ||
    abandonedClaim.beforeVersion !== abandoned.workflowVersion ||
    abandonedClaim.afterVersion !== abandoned.workflowVersion ||
    abandonedFinish.beforeVersion !== abandoned.workflowVersion ||
    abandonedFinish.afterVersion !== startupRecovery.afterVersion ||
    startupRecovery.beforeVersion !== abandoned.workflowVersion ||
    recoveredStatus.workflowVersion !== startupRecovery.afterVersion ||
    !(abandonedStart.sequence < abandonedClaim.sequence) ||
    !(abandonedClaim.sequence < abandonedFinish.sequence) ||
    !(abandonedFinish.sequence < startupRecovery.sequence) ||
    !(startupRecovery.sequence < resumeRecovery.sequence)
  ) {
    throw new TypeError('Restart proof did not retain the abandoned DISCOVERY dispatch chain');
  }

  if (
    resumeRecovery.beforeVersion !== recoveredStatus.workflowVersion ||
    resumeRecovery.afterVersion === undefined ||
    resumeRecovery.afterVersion === resumeRecovery.beforeVersion
  ) {
    throw new TypeError('Resume reconciliation did not advance exact recovered authority');
  }
  const freshStart = audit.events.find(
    (event) => event.eventType === 'ATTEMPT_STARTED' && event.sequence > resumeRecovery.sequence,
  );
  if (freshStart === undefined || freshStart.aggregateId === abandoned.attemptId) {
    throw new TypeError('Resume did not create a fresh replacement Attempt identity');
  }
  const phaseChangedBeforeFreshStart = audit.events.some(
    (event) =>
      event.eventType === 'WORKFLOW_PHASE_TRANSITIONED' &&
      event.sequence > resumeRecovery.sequence &&
      event.sequence < freshStart.sequence,
  );
  const freshClaim = requireSingleAttemptAudit(
    audit,
    'WORKER_DISPATCH_CLAIMED',
    freshStart.aggregateId,
  );
  const freshFinish = requireSingleAttemptAudit(audit, 'ATTEMPT_FINISHED', freshStart.aggregateId);
  if (freshFinish.commandId === undefined) {
    throw new TypeError('Fresh replacement Attempt finish has no Runtime command identity');
  }
  const pairedWorkflowFinishes = audit.events.filter(
    (event) =>
      event.eventType === 'WORKFLOW_ATTEMPT_FINISHED' &&
      event.aggregateType === 'WORKFLOW' &&
      event.aggregateId === recoveredStatus.workflowId &&
      event.commandId === freshFinish.commandId,
  );
  const pairedWorkflowFinish = pairedWorkflowFinishes[0];
  if (pairedWorkflowFinishes.length !== 1 || pairedWorkflowFinish === undefined) {
    throw new TypeError(
      'Fresh replacement Attempt requires one unique paired WORKFLOW_ATTEMPT_FINISHED',
    );
  }
  if (
    freshFinish.causationId === undefined ||
    !WORKER_EVENT_ID_PATTERN.test(freshFinish.causationId)
  ) {
    throw new TypeError('Fresh replacement Attempt finish causation must be a valid WorkerEventId');
  }
  if (
    pairedWorkflowFinish.commandId !== freshFinish.commandId ||
    pairedWorkflowFinish.beforeVersion !== freshFinish.beforeVersion ||
    pairedWorkflowFinish.afterVersion !== freshFinish.afterVersion ||
    pairedWorkflowFinish.causationId !== freshFinish.causationId
  ) {
    throw new TypeError('Fresh replacement Attempt and Workflow finish authority does not match');
  }
  if (
    phaseChangedBeforeFreshStart ||
    freshStart.beforeVersion !== resumeRecovery.afterVersion ||
    freshStart.afterVersion === undefined ||
    freshClaim.beforeVersion !== freshStart.afterVersion ||
    freshClaim.afterVersion !== freshStart.afterVersion ||
    freshFinish.beforeVersion !== freshStart.afterVersion ||
    freshFinish.afterVersion === undefined ||
    freshFinish.afterVersion === freshFinish.beforeVersion ||
    !(resumeRecovery.sequence < freshStart.sequence) ||
    !(freshStart.sequence < freshClaim.sequence) ||
    !(freshClaim.sequence < freshFinish.sequence) ||
    !(freshFinish.sequence < pairedWorkflowFinish.sequence)
  ) {
    throw new TypeError(
      'Fresh replacement work did not preserve DISCOVERY phase and Attempt-dispatch ordering',
    );
  }
}
