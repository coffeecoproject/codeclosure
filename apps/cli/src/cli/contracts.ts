import type {
  DrivenGoalCommandResult,
  GoalAuditView,
  GoalReadResult,
  GoalStatusView,
  RuntimeCommandResult,
  WorkflowDriveSummary,
} from '@codeclosure/runtime';

export const CliOperation = {
  GOAL_CREATE: 'goal create',
  GOAL_START: 'goal start',
  GOAL_STATUS: 'goal status',
  GOAL_RESUME: 'goal resume',
  GOAL_CANCEL: 'goal cancel',
  AUDIT_SHOW: 'audit show',
  DEMO_RUN: 'demo run',
} as const;
export type CliOperation = (typeof CliOperation)[keyof typeof CliOperation];

export const CliDemoScenario = {
  HAPPY_PATH: 'happy-path',
  LYING_WORKER: 'lying-worker',
  MISSING_EVIDENCE: 'missing-evidence',
  FAILING_EVIDENCE: 'failing-evidence',
  STALE_CLOSEOUT: 'stale-closeout',
  RESTART_RESUME: 'restart-resume',
  DUPLICATE_RESULT: 'duplicate-result',
  CANDIDATE_DRIFT: 'candidate-drift',
} as const;
export type CliDemoScenario = (typeof CliDemoScenario)[keyof typeof CliDemoScenario];

export const CliDemoProofCode = {
  HAPPY_PATH_EXACT_CLOSEOUT: 'HAPPY_PATH_EXACT_CLOSEOUT',
  LYING_WORKER_REJECTED: 'LYING_WORKER_REJECTED',
  MISSING_EVIDENCE_FAILED_CLOSED: 'MISSING_EVIDENCE_FAILED_CLOSED',
  FAILING_EVIDENCE_REPAIR_REQUIRED: 'FAILING_EVIDENCE_REPAIR_REQUIRED',
  STALE_CLOSEOUT_INVALIDATED: 'STALE_CLOSEOUT_INVALIDATED',
  RESTART_RESUME_FRESH_ATTEMPT: 'RESTART_RESUME_FRESH_ATTEMPT',
  DUPLICATE_RESULT_DEDUPLICATED: 'DUPLICATE_RESULT_DEDUPLICATED',
  CANDIDATE_DRIFT_INVALIDATED: 'CANDIDATE_DRIFT_INVALIDATED',
} as const;
export type CliDemoProofCode = (typeof CliDemoProofCode)[keyof typeof CliDemoProofCode];

export const CliErrorCode = {
  USAGE: 'CLI_USAGE',
  GOAL_NOT_FOUND: 'CLI_GOAL_NOT_FOUND',
  INTERNAL: 'CLI_INTERNAL_FAILURE',
} as const;
export type CliErrorCode = (typeof CliErrorCode)[keyof typeof CliErrorCode];

export interface CliCommandResultEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'COMMAND_RESULT';
  readonly operation: typeof CliOperation.GOAL_CREATE;
  readonly result: RuntimeCommandResult;
}

export interface CliGoalStatusEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'GOAL_STATUS';
  readonly operation: typeof CliOperation.GOAL_STATUS;
  readonly result: GoalReadResult<GoalStatusView>;
}

export interface CliDrivenCommandResultEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'DRIVEN_COMMAND_RESULT';
  readonly operation: typeof CliOperation.GOAL_START | typeof CliOperation.GOAL_RESUME;
  readonly result: DrivenGoalCommandResult;
}

export interface CliCancelCommandResultEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'COMMAND_RESULT';
  readonly operation: typeof CliOperation.GOAL_CANCEL;
  readonly result: RuntimeCommandResult;
}

export interface CliGoalAuditEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'GOAL_AUDIT';
  readonly operation: typeof CliOperation.AUDIT_SHOW;
  readonly result: GoalReadResult<GoalAuditView>;
}

export interface CliDemoProofResult {
  readonly schemaVersion: 1;
  readonly scenario: CliDemoScenario;
  readonly passed: true;
  readonly proofCode: CliDemoProofCode;
  readonly goalId: GoalStatusView['goalId'];
  readonly finalStatus: GoalStatusView;
  readonly reopenedStatus: GoalStatusView;
  readonly audit: GoalAuditView;
  readonly finalDrive: WorkflowDriveSummary;
  readonly intermediateStatus?: GoalStatusView;
  readonly startupRecovery?: {
    readonly schemaVersion: 1;
    readonly scannedCount: number;
    readonly reconciledCount: number;
    readonly recoveryIds: readonly string[];
  };
}

export interface CliDemoResultEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'DEMO_RESULT';
  readonly operation: typeof CliOperation.DEMO_RUN;
  readonly result: CliDemoProofResult;
}

export interface CliErrorEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'CLI_ERROR';
  readonly error: {
    readonly code: CliErrorCode;
    readonly message: string;
  };
}

export type CliEnvelope =
  | CliCommandResultEnvelope
  | CliDrivenCommandResultEnvelope
  | CliCancelCommandResultEnvelope
  | CliGoalStatusEnvelope
  | CliGoalAuditEnvelope
  | CliDemoResultEnvelope
  | CliErrorEnvelope;

export const CliExitCode = {
  SUCCESS: 0,
  USAGE: 2,
  REJECTED: 3,
  GOVERNED_STOP: 4,
  INTERNAL: 5,
} as const;
export type CliExitCode = (typeof CliExitCode)[keyof typeof CliExitCode];
