import type { CodeClosureApplication, CreateGoalRequest } from '@codeclosure/runtime';

import { CliOperation, type CliCommandResultEnvelope } from '../cli/contracts.js';

export interface ExecuteGoalCreateOptions {
  readonly application: CodeClosureApplication;
  readonly commandId: CreateGoalRequest['commandId'];
  readonly objective: string;
  readonly projectPath: string;
  readonly criteria: readonly string[];
}

export function executeGoalCreate(options: ExecuteGoalCreateOptions): CliCommandResultEnvelope {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'COMMAND_RESULT',
    operation: CliOperation.GOAL_CREATE,
    result: options.application.createGoal({
      commandId: options.commandId,
      objective: options.objective,
      projectPath: options.projectPath,
      criteria: options.criteria,
    }),
  });
}
