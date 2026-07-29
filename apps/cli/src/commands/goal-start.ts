import type { CodeClosureApplication, StartGoalRequest } from '@codeclosure/runtime';

import { CliOperation, type CliDrivenCommandResultEnvelope } from '../cli/contracts.js';
import { loadGoalCommandTarget } from './goal-command-target.js';

export interface ExecuteGoalStartOptions {
  readonly application: CodeClosureApplication;
  readonly commandId: StartGoalRequest['commandId'];
  readonly goalId: StartGoalRequest['goalId'];
}

export async function executeGoalStart(
  options: ExecuteGoalStartOptions,
): Promise<CliDrivenCommandResultEnvelope> {
  const current = loadGoalCommandTarget(options.application, options.goalId);
  const result = await options.application.startGoal({
    commandId: options.commandId,
    goalId: options.goalId,
    expectedGoalRevision: current.goalRevision,
    expectedWorkflowVersion: current.workflowVersion,
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: 'DRIVEN_COMMAND_RESULT',
    operation: CliOperation.GOAL_START,
    result,
  });
}
