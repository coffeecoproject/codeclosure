import type { GoalStatusView } from '@codeclosure/runtime';

import { openCliSqliteAuthority, type OpenCliSqliteAuthorityOptions } from './sqlite-authority.js';

export type M1RestartProofObservationOptions = OpenCliSqliteAuthorityOptions;

export type ClaimedActiveAttemptId = NonNullable<GoalStatusView['activeAttemptRef']>['id'];

export type ClaimedActiveAttemptObservation = Readonly<{
  attemptId: ClaimedActiveAttemptId;
  phase: NonNullable<GoalStatusView['activeAttemptRef']>['phase'];
  workflowVersion: GoalStatusView['workflowVersion'];
}>;

export type M1RestartProofObservationResult =
  | Readonly<{ status: 'OBSERVED'; observation: ClaimedActiveAttemptObservation }>
  | Readonly<{ status: 'NOT_YET_RETAINED' }>
  | Readonly<{ status: 'TEMPORARILY_BUSY' }>;

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'SQLITE_BUSY';
}

/**
 * Narrow, read-only proof capability. It reveals only the current claimed
 * Attempt identity, phase, and claimed Workflow version; the Store never
 * crosses this module boundary and the observation cannot release work or
 * authorize recovery. A verified-open writer conflict is reported separately
 * so the owning proof deadline, rather than SQLite, remains the retry budget.
 */
export function observeClaimedActiveAttempt(
  options: M1RestartProofObservationOptions,
  goalId: GoalStatusView['goalId'],
): M1RestartProofObservationResult {
  let store: ReturnType<typeof openCliSqliteAuthority>;
  try {
    store = openCliSqliteAuthority(options);
  } catch (error) {
    if (isSqliteBusy(error)) {
      return Object.freeze({ status: 'TEMPORARILY_BUSY' });
    }
    throw error;
  }
  try {
    const owner = store.getGoalWithWorkflow(goalId);
    if (owner?.workflow.activeAttemptId === undefined) {
      return Object.freeze({ status: 'NOT_YET_RETAINED' });
    }
    const activeAttemptId = owner.workflow.activeAttemptId;
    const attempt = store.getAttempt(activeAttemptId);
    const claim = store.getWorkerDispatchClaim(activeAttemptId);
    if (attempt === undefined || claim === undefined) {
      return Object.freeze({ status: 'NOT_YET_RETAINED' });
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
      status: 'OBSERVED',
      observation: Object.freeze({
        attemptId: activeAttemptId,
        phase: attempt.phase,
        workflowVersion: claim.workflowVersion,
      }),
    });
  } finally {
    store.close();
  }
}
