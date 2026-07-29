import type { CodeClosureApplication, GoalStatusView } from '@codeclosure/runtime';

export class CliGoalNotFoundError extends Error {
  public readonly goalId: Parameters<CodeClosureApplication['getGoalStatus']>[0];

  public constructor(goalId: Parameters<CodeClosureApplication['getGoalStatus']>[0]) {
    super(`Goal not found: ${goalId}`);
    this.name = 'CliGoalNotFoundError';
    this.goalId = goalId;
  }
}

/** Reads the optimistic-concurrency boundary; Runtime still revalidates it in the command. */
export function loadGoalCommandTarget(
  application: CodeClosureApplication,
  goalId: Parameters<CodeClosureApplication['getGoalStatus']>[0],
): GoalStatusView {
  const current = application.getGoalStatus(goalId);
  if (current.status === 'NOT_FOUND') {
    throw new CliGoalNotFoundError(goalId);
  }
  return current.view;
}
