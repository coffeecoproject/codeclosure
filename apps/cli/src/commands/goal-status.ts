import type { CodeClosureApplication } from '@codeclosure/runtime';

import { CliOperation, type CliGoalStatusEnvelope } from '../cli/contracts.js';
import type { GoalStatusInvocation } from '../cli/parser.js';

export function executeGoalStatus(
  application: CodeClosureApplication,
  goalId: GoalStatusInvocation['goalId'],
): CliGoalStatusEnvelope {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'GOAL_STATUS',
    operation: CliOperation.GOAL_STATUS,
    result: application.getGoalStatus(goalId),
  });
}
