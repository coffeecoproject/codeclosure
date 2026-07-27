import {
  goalId,
  goalRevision,
  isoTimestamp,
  successCriterionId,
  type AttemptId,
  type CandidateGenerationId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type SuccessCriterionId,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';

export const GoalStatus = {
  ACTIVE: 'ACTIVE',
  WAITING_FOR_INPUT: 'WAITING_FOR_INPUT',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
  CLOSED: 'CLOSED',
} as const;
export type GoalStatus = (typeof GoalStatus)[keyof typeof GoalStatus];

export const WorkflowPhase = {
  DISCOVERY: 'DISCOVERY',
  PLAN: 'PLAN',
  IMPLEMENT: 'IMPLEMENT',
  SOURCE_FREEZE: 'SOURCE_FREEZE',
  EVIDENCE_BUILD: 'EVIDENCE_BUILD',
  FINAL_VERIFY: 'FINAL_VERIFY',
  CLOSEOUT: 'CLOSEOUT',
} as const;
export type WorkflowPhase = (typeof WorkflowPhase)[keyof typeof WorkflowPhase];

export const WORKFLOW_PHASES = Object.freeze(Object.values(WorkflowPhase));

export const RunStatus = {
  READY: 'READY',
  RUNNING: 'RUNNING',
  WAITING_FOR_INPUT: 'WAITING_FOR_INPUT',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  CLOSED: 'CLOSED',
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export function deriveGoalStatus(runStatus: RunStatus): GoalStatus {
  switch (runStatus) {
    case RunStatus.READY:
    case RunStatus.RUNNING:
      return GoalStatus.ACTIVE;
    case RunStatus.WAITING_FOR_INPUT:
      return GoalStatus.WAITING_FOR_INPUT;
    case RunStatus.BLOCKED:
    case RunStatus.FAILED:
      return GoalStatus.BLOCKED;
    case RunStatus.CANCELLED:
      return GoalStatus.CANCELLED;
    case RunStatus.CLOSED:
      return GoalStatus.CLOSED;
  }
}

export const AttemptStatus = {
  RUNNING: 'RUNNING',
  RESULT_RECORDED: 'RESULT_RECORDED',
  FAILED: 'FAILED',
  INTERRUPTED: 'INTERRUPTED',
} as const;
export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

export const CandidateGenerationState = {
  MUTABLE: 'MUTABLE',
  FREEZING: 'FREEZING',
  FROZEN: 'FROZEN',
  INVALIDATED: 'INVALIDATED',
  REJECTED: 'REJECTED',
  ACCEPTED: 'ACCEPTED',
} as const;
export type CandidateGenerationState =
  (typeof CandidateGenerationState)[keyof typeof CandidateGenerationState];

export interface SuccessCriterion {
  readonly id: SuccessCriterionId;
  readonly description: string;
  readonly required: boolean;
}

export interface GoalScope {
  readonly projectPath: string;
  readonly allowedPaths: readonly string[];
}

export interface Goal {
  readonly id: GoalId;
  readonly revision: GoalRevision;
  readonly objective: string;
  readonly successCriteria: readonly SuccessCriterion[];
  readonly scope: GoalScope;
  readonly nonGoals: readonly string[];
  readonly status: GoalStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface WorkflowInstance {
  readonly id: WorkflowId;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly phase: WorkflowPhase;
  readonly runStatus: RunStatus;
  readonly version: WorkflowVersion;
  readonly activeAttemptId?: AttemptId;
  readonly activeCandidateGenerationId?: CandidateGenerationId;
  readonly suspendedReason?: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface CreateGoalInput {
  readonly id: GoalId;
  readonly revision: GoalRevision;
  readonly objective: string;
  readonly successCriteria: readonly SuccessCriterion[];
  readonly scope: GoalScope;
  readonly nonGoals?: readonly string[];
  readonly createdAt: IsoTimestamp;
}

export function assertGoalInvariant(goal: Goal): void {
  goalId(goal.id);
  goalRevision(goal.revision);
  isoTimestamp(goal.createdAt);
  isoTimestamp(goal.updatedAt);

  if (!Object.values(GoalStatus).some((status) => status === goal.status)) {
    throw new TypeError('Goal status is unknown');
  }
  if (goal.objective.trim().length === 0) {
    throw new TypeError('Goal objective must not be empty');
  }
  if (goal.scope.projectPath.trim().length === 0) {
    throw new TypeError('Goal projectPath must not be empty');
  }
  if (goal.successCriteria.length === 0) {
    throw new TypeError('Goal must contain at least one success criterion');
  }

  const criterionIds = new Set<string>();
  for (const criterion of goal.successCriteria) {
    successCriterionId(criterion.id);
    if (criterionIds.has(criterion.id)) {
      throw new TypeError('Goal success criterion IDs must be unique');
    }
    criterionIds.add(criterion.id);
    if (criterion.description.trim().length === 0) {
      throw new TypeError('Success criterion description must not be empty');
    }
    if (typeof criterion.required !== 'boolean') {
      throw new TypeError('Success criterion required flag must be boolean');
    }
  }
  if (
    goal.scope.allowedPaths.some((path) => path.trim().length === 0) ||
    goal.nonGoals.some((nonGoal) => nonGoal.trim().length === 0)
  ) {
    throw new TypeError('Goal path and non-goal entries must not be empty');
  }
  if (goal.updatedAt < goal.createdAt) {
    throw new TypeError('Goal updatedAt cannot precede createdAt');
  }
}

export function createGoal(input: CreateGoalInput): Goal {
  const objective = input.objective.trim();
  const projectPath = input.scope.projectPath.trim();

  if (objective.length === 0) {
    throw new TypeError('Goal objective must not be empty');
  }
  if (projectPath.length === 0) {
    throw new TypeError('Goal projectPath must not be empty');
  }
  if (input.successCriteria.length === 0) {
    throw new TypeError('Goal must contain at least one success criterion');
  }
  if (input.successCriteria.some((criterion) => criterion.description.trim().length === 0)) {
    throw new TypeError('Success criterion description must not be empty');
  }

  const goal = Object.freeze({
    id: input.id,
    revision: input.revision,
    objective,
    successCriteria: Object.freeze(
      input.successCriteria.map((criterion) =>
        Object.freeze({
          id: criterion.id,
          description: criterion.description,
          required: criterion.required,
        }),
      ),
    ),
    scope: Object.freeze({
      projectPath,
      allowedPaths: Object.freeze([...input.scope.allowedPaths]),
    }),
    nonGoals: Object.freeze([...(input.nonGoals ?? [])]),
    status: GoalStatus.ACTIVE,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  assertGoalInvariant(goal);
  return goal;
}
