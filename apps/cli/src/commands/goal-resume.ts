import type { CodeClosureApplication, ResumeGoalRequest } from '@codeclosure/runtime';

import { CliOperation, type CliDrivenCommandResultEnvelope } from '../cli/contracts.js';
import { loadGoalCommandTarget } from './goal-command-target.js';

export interface ExecuteGoalResumeOptions {
  readonly application: CodeClosureApplication;
  readonly commandId: ResumeGoalRequest['commandId'];
  readonly goalId: ResumeGoalRequest['goalId'];
}

export async function executeGoalResume(
  options: ExecuteGoalResumeOptions,
): Promise<CliDrivenCommandResultEnvelope> {
  const current = loadGoalCommandTarget(options.application, options.goalId);
  const result = await options.application.resumeGoal({
    commandId: options.commandId,
    goalId: options.goalId,
    expectedGoalRevision: current.goalRevision,
    expectedWorkflowVersion: current.workflowVersion,
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: 'DRIVEN_COMMAND_RESULT',
    operation: CliOperation.GOAL_RESUME,
    result,
  });
}
