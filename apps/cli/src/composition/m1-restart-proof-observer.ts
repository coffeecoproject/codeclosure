import type { GoalStatusView } from '@codeclosure/runtime';

import { openCliSqliteAuthority, type OpenCliSqliteAuthorityOptions } from './sqlite-authority.js';

export type M1RestartProofObservationOptions = OpenCliSqliteAuthorityOptions;

export type ClaimedActiveAttemptId = NonNullable<GoalStatusView['activeAttemptRef']>['id'];

/**
 * Narrow, read-only proof capability. It reveals only the current claimed
 * Attempt identity, phase, and claimed Workflow version; the Store never
 * crosses this module boundary and the observation cannot release work or
 * authorize recovery.
 */
export function observeClaimedActiveAttempt(
  options: M1RestartProofObservationOptions,
  goalId: GoalStatusView['goalId'],
):
  | Readonly<{
      attemptId: ClaimedActiveAttemptId;
      phase: NonNullable<GoalStatusView['activeAttemptRef']>['phase'];
      workflowVersion: GoalStatusView['workflowVersion'];
    }>
  | undefined {
  const store = openCliSqliteAuthority(options);
  try {
    const owner = store.getGoalWithWorkflow(goalId);
    if (owner?.workflow.activeAttemptId === undefined) {
      return undefined;
    }
    const activeAttemptId = owner.workflow.activeAttemptId;
    const attempt = store.getAttempt(activeAttemptId);
    const claim = store.getWorkerDispatchClaim(activeAttemptId);
    if (attempt === undefined || claim === undefined) {
      return undefined;
    }
    if (
      attempt.status !== 'RUNNING' ||
      attempt.workflowId !== owner.workflow.id ||
      attempt.phase !== owner.workflow.phase ||
      claim.workflowId !== owner.workflow.id ||
      claim.workflowVersion !== owner.workflow.version ||
      claim.attemptId !== attempt.id
    ) {
      throw new TypeError('Restart proof dispatch observation is not current exact authority');
    }
    return Object.freeze({
      attemptId: activeAttemptId,
      phase: attempt.phase,
      workflowVersion: claim.workflowVersion,
    });
  } finally {
    store.close();
  }
}
