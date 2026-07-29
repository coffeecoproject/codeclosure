import { isDeepStrictEqual } from 'node:util';

import type { CodeClosureApplication, GoalAuditView, GoalStatusView } from '@codeclosure/runtime';

export function requireM1ProofStatus(
  application: CodeClosureApplication,
  goalId: GoalStatusView['goalId'],
): GoalStatusView {
  const result = application.getGoalStatus(goalId);
  if (result.status !== 'FOUND') {
    throw new TypeError('M1 proof Goal status is unavailable');
  }
  return result.view;
}

export function requireM1ProofAudit(
  application: CodeClosureApplication,
  goalId: GoalStatusView['goalId'],
): GoalAuditView {
  const result = application.getGoalAudit(goalId);
  if (result.status !== 'FOUND') {
    throw new TypeError('M1 proof Goal audit is unavailable');
  }
  return result.view;
}

export function assertM1ProofReopen(
  expectedStatus: GoalStatusView,
  reopenedStatus: GoalStatusView,
  expectedAudit: GoalAuditView,
  reopenedAudit: GoalAuditView,
): void {
  if (
    !isDeepStrictEqual(reopenedStatus, expectedStatus) ||
    !isDeepStrictEqual(reopenedAudit, expectedAudit)
  ) {
    throw new TypeError('M1 proof final authority did not survive strict reopen');
  }
}
