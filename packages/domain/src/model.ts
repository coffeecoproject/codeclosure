import type {
  AttemptId,
  CandidateGenerationId,
  GoalId,
  GoalRevision,
  IsoTimestamp,
  SuccessCriterionId,
  WorkflowId,
  WorkflowVersion,
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

  return Object.freeze({
    id: input.id,
    revision: input.revision,
    objective,
    successCriteria: Object.freeze([...input.successCriteria]),
    scope: Object.freeze({
      projectPath,
      allowedPaths: Object.freeze([...input.scope.allowedPaths]),
    }),
    nonGoals: Object.freeze([...(input.nonGoals ?? [])]),
    status: GoalStatus.ACTIVE,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}
