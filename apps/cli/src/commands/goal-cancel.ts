import type { CancelGoalRequest, CodeClosureApplication } from '@codeclosure/runtime';

import { CliOperation, type CliCancelCommandResultEnvelope } from '../cli/contracts.js';
import { loadGoalCommandTarget } from './goal-command-target.js';

const CLI_CANCELLATION_REASON = 'CLI_USER_REQUESTED_CANCELLATION';

export interface ExecuteGoalCancelOptions {
  readonly application: CodeClosureApplication;
  readonly commandId: CancelGoalRequest['commandId'];
  readonly goalId: CancelGoalRequest['goalId'];
}

export function executeGoalCancel(
  options: ExecuteGoalCancelOptions,
): CliCancelCommandResultEnvelope {
  const current = loadGoalCommandTarget(options.application, options.goalId);
  return Object.freeze({
    schemaVersion: 1,
    kind: 'COMMAND_RESULT',
    operation: CliOperation.GOAL_CANCEL,
    result: options.application.cancelGoal({
      commandId: options.commandId,
      goalId: options.goalId,
      expectedGoalRevision: current.goalRevision,
      expectedWorkflowVersion: current.workflowVersion,
      reason: CLI_CANCELLATION_REASON,
    }),
  });
}
