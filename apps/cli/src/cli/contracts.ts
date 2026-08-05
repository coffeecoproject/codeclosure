import type {
  DrivenGoalCommandResult,
  ExternalFailureCodeView,
  GoalAuditView,
  GoalReadResult,
  GoalStatusView,
  IntakeAuditView,
  IntakeCoordinatorCommandResult,
  IntakeStatusView,
  RuntimeCommandResult,
  WorkflowDriveSummary,
} from '@codeclosure/runtime';
export type CliExternalFailureCode = ExternalFailureCodeView;
export type CliExternalItemRejectionCode =
  | 'COMMAND_ACTIONS'
  | 'COMMAND_CWD'
  | 'COMMAND_DURATION'
  | 'COMMAND_EXIT_CODE'
  | 'COMMAND_FIELD_SET'
  | 'COMMAND_ID'
  | 'COMMAND_OUTPUT'
  | 'COMMAND_PLUGIN_BINDING'
  | 'COMMAND_PROCESS_ID'
  | 'COMMAND_SOURCE'
  | 'COMMAND_STATUS'
  | 'COMMAND_TEXT'
  | 'ITEM_SCHEMA'
  | 'UNSELECTED_ITEM_TYPE';
export type CliExternalDiagnostic =
  | Readonly<{
      schemaVersion: 1;
      kind: 'NOTIFICATION_LIMIT';
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'UNSUPPORTED_NOTIFICATION';
      method: string;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'MALFORMED_ITEM';
      location: 'COMPLETED' | 'STARTED' | 'TERMINAL';
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'ITEM_POLICY_UNAVAILABLE';
      location: 'COMPLETED' | 'STARTED' | 'TERMINAL';
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'UNSUPPORTED_ITEM';
      itemType: string;
      location: 'COMPLETED' | 'STARTED' | 'TERMINAL';
      reasonCode: CliExternalItemRejectionCode;
    }>;

export interface CliRuntimeStopDiagnostic {
  readonly schemaVersion: 1;
  readonly stage: 'INITIAL_DRIVE' | 'REPAIR_DRIVE';
  readonly commandStatus: RuntimeCommandResult['status'];
  readonly externalExecution: Readonly<{
    readonly schemaVersion: 1;
    readonly id: string;
    readonly attemptId: string;
    readonly state:
      | 'AUTHORIZED'
      | 'PROCESS_OBSERVED'
      | 'SESSION_OBSERVED'
      | 'OPERATION_RUNNING'
      | 'COMPLETED'
      | 'INTERRUPTED'
      | 'FAILED'
      | 'ABANDONED';
    readonly failureCode: CliExternalFailureCode | null;
  }> | null;
  readonly drive: Readonly<{
    readonly schemaVersion: 1;
    readonly stopReason: WorkflowDriveSummary['stopReason'];
    readonly detailCode: string;
    readonly operationCount: number;
  }> | null;
}

export const CliOperation = {
  INTAKE_SUBMIT: 'intake submit',
  INTAKE_CLARIFY: 'intake clarify',
  INTAKE_ABANDON: 'intake abandon',
  INTAKE_STATUS: 'intake status',
  INTAKE_AUDIT: 'intake audit',
  GOAL_CREATE: 'goal create',
  GOAL_START: 'goal start',
  GOAL_STATUS: 'goal status',
  GOAL_RESUME: 'goal resume',
  GOAL_CANCEL: 'goal cancel',
  AUDIT_SHOW: 'audit show',
  DEMO_RUN: 'demo run',
} as const;
export type CliOperation = (typeof CliOperation)[keyof typeof CliOperation];

export const CliIntakeAction = {
  ANSWER_ONLY: 'answer-only',
  MATERIALIZE_ONLY: 'materialize-only',
  GOVERNED_EXECUTION: 'governed-execution',
} as const;
export type CliIntakeAction = (typeof CliIntakeAction)[keyof typeof CliIntakeAction];

export const CliDemoScenario = {
  HAPPY_PATH: 'happy-path',
  LYING_WORKER: 'lying-worker',
  MISSING_EVIDENCE: 'missing-evidence',
  FAILING_EVIDENCE: 'failing-evidence',
  STALE_CLOSEOUT: 'stale-closeout',
  RESTART_RESUME: 'restart-resume',
  DUPLICATE_RESULT: 'duplicate-result',
  CANDIDATE_DRIFT: 'candidate-drift',
  M2_PROTECTED_REPAIR: 'm2-protected-repair',
  M2_PROTECTED_FAILED_REPAIR: 'm2-protected-failed-repair',
  M2_ADAPTER_FAILURE: 'm2-adapter-failure',
  M2_LIVE: 'm2-live',
  M2_LIVE_REPAIR_HANDOFF: 'm2-live-repair-handoff',
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
  M2_PROTECTED_REPAIR_ACCEPTED: 'M2_PROTECTED_REPAIR_ACCEPTED',
  M2_PROTECTED_FAILED_REPAIR_STOPPED: 'M2_PROTECTED_FAILED_REPAIR_STOPPED',
  M2_ADAPTER_FAILURE_GOVERNED: 'M2_ADAPTER_FAILURE_GOVERNED',
  M2_LIVE_NATURAL_BRANCH_CLOSED: 'M2_LIVE_NATURAL_BRANCH_CLOSED',
  M2_LIVE_REPAIR_HANDOFF_CLOSED: 'M2_LIVE_REPAIR_HANDOFF_CLOSED',
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

export interface CliIntakeCommandResultEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'INTAKE_COMMAND_RESULT';
  readonly operation:
    | typeof CliOperation.INTAKE_SUBMIT
    | typeof CliOperation.INTAKE_CLARIFY
    | typeof CliOperation.INTAKE_ABANDON;
  readonly result: IntakeCoordinatorCommandResult;
}

export type CliIntakeReadResult<View> =
  | Readonly<{ status: 'FOUND'; view: View }>
  | Readonly<{ status: 'NOT_FOUND'; intakeRunId: string }>;

export interface CliIntakeStatusEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'INTAKE_STATUS';
  readonly operation: typeof CliOperation.INTAKE_STATUS;
  readonly result: CliIntakeReadResult<IntakeStatusView>;
}

export interface CliIntakeAuditEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'INTAKE_AUDIT';
  readonly operation: typeof CliOperation.INTAKE_AUDIT;
  readonly result: CliIntakeReadResult<IntakeAuditView>;
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

export interface CliM2AcceptanceTrace {
  readonly schemaVersion: 1;
  readonly plan: Readonly<{
    id: string;
    digest: string;
    workflowVersionAtLock: number;
    criterionIds: readonly string[];
    acceptanceRuleIds: readonly string[];
    protectedAssetManifestDigest: string;
    protectedAssets: readonly Readonly<{
      logicalAssetId: string;
      executionPath: string;
      contentDigest: string;
      byteLength: number;
      protectionMode: string;
    }>[];
    semanticCheck: Readonly<{
      version: string;
      executableDigest: string;
      isolationProfileId: string;
      isolationProfileDigest: string;
    }>;
  }>;
  readonly dispatches: readonly Readonly<{
    attemptId: string;
    workerSessionId: string;
    contextManifestId: string;
    contextManifestDigest: string;
    contextPackageDigest: string;
    candidateGenerationId?: string;
    candidateDigest?: string;
    repairContextDigest?: string;
    priorAttemptFeedbackDigest?: string;
    contextSources: readonly Readonly<{
      kind: string;
      sourceRef: string;
      sourceRevision: string;
      sourceDigest?: string;
      authorityClass: string;
      renderedDigest: string;
    }>[];
    repair?: Readonly<{
      acceptanceRepairDigest: string;
      acceptanceDecisionId: string;
      acceptanceDecisionDigest: string;
      evidenceSetDigest: string;
      rejectedCandidateGenerationId: string;
      rejectedCandidateDigest: string;
      repairCandidateGenerationId: string;
      parentChangeSetDigest: string;
      failedEvidence: readonly Readonly<{
        evidenceId: string;
        evidenceRecordDigest: string;
        verificationObligationId: string;
        checkSpecificationId: string;
        checkSpecificationDigest: string;
      }>[];
      constraintsToPreserve: readonly Readonly<{
        kind: string;
        sourceRef: string;
        sourceDigest: string;
      }>[];
    }>;
    priorAttemptFeedback?: Readonly<{
      digest: string;
      itemKinds: readonly string[];
      sourceRefs: readonly string[];
      sourceDigests: readonly string[];
    }>;
  }>[];
  readonly verification: readonly Readonly<{
    candidateGenerationId: string;
    candidateDigest: string;
    attemptId: string;
    verificationObligationId: string;
    checkId: string;
    checkVersion: string;
    checkDigest: string;
    protectedAssetReadLeaseDigest: string;
    isolationProfileId: string;
    isolationProfileDigest: string;
    environmentDigest: string;
    evidenceId: string;
    evidenceDigest: string;
    result: 'FAIL' | 'PASS';
  }>[];
  readonly externalExecutions: readonly Readonly<{
    id: string;
    attemptId: string;
    workerSessionId: string;
    contextManifestId: string;
    state: string;
    backendSessionRef?: string;
    backendOperationRef?: string;
    controlledStateRootIdentity: string;
    binaryIdentityDigest: string;
    protocolSchemaDigest: string;
    executionConfigDigest: string;
    managedRequirementsDigest: string;
    instructionSourceManifestDigest: string;
    compactionCount: number;
    turnInterruptCount: number;
    intentDigest: string;
    recordDigest: string;
  }>[];
  readonly repair?: Readonly<{
    acceptanceDecisionId: string;
    acceptanceDecisionDigest: string;
    inputManifestDigest: string;
    rejectedCandidateGenerationId: string;
    rejectedCandidateDigest: string;
    repairCandidateGenerationId: string;
    repairCandidateSequence: number;
    repairCandidateBaseDigest: string;
    verificationCheckId: string;
    verificationObligationIds: readonly string[];
    evidenceSetDigest: string;
    repairDigest: string;
  }>;
  readonly acceptance?: Readonly<{
    decisionId: string;
    decisionDigest: string;
    outcome: string;
    dominantReasonCode: string;
    inputManifestDigest: string;
    evidenceSetDigest: string;
    candidateGenerationId: string;
    candidateDigest: string;
    closeout?: Readonly<{
      acceptanceDecisionId: string;
      acceptanceDecisionDigest: string;
      inputManifestDigest: string;
      candidateGenerationId: string;
      candidateDigest: string;
      evidenceSetDigest: string;
      closedAt: string;
    }>;
  }>;
}

export interface CliM2DemoDetail {
  readonly acceptanceTrace: CliM2AcceptanceTrace;
  readonly branch:
    | 'REPAIR_ACCEPTED'
    | 'REPAIR_FAILED_STOP'
    | 'ADAPTER_FAILURE'
    | 'LIVE_FIRST_PASS_ACCEPTED'
    | 'LIVE_REPAIR_ACCEPTED'
    | 'LIVE_REPAIR_FAILED_STOP'
    | 'LIVE_REPAIR_HANDOFF_ACCEPTED'
    | 'LIVE_REPAIR_HANDOFF_FAILED_STOP';
  readonly evidence: readonly Readonly<{
    candidateGenerationId: string;
    candidateDigest: string;
    checkId: string;
    evidenceDigest: string;
    result: 'FAIL' | 'PASS';
  }>[];
  readonly generationCount: number;
  readonly initialDriveStop: WorkflowDriveSummary['stopReason'];
  readonly planId: string;
  readonly planDigest: string;
  readonly sourceIdentity: {
    readonly schemaVersion: 1;
    readonly sourceGitMetadataDigest: string;
    readonly sourceTreeDigest: string;
  };
  readonly sourceUnchanged: true;
  readonly workerWritableTestPassed?: true;
  readonly externalExecutionCount?: number;
  readonly externalFailureCode?: CliExternalFailureCode;
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
  readonly m2?: CliM2DemoDetail;
}

export interface CliDemoFailedResult {
  readonly schemaVersion: 3;
  readonly scenario: typeof CliDemoScenario.M2_LIVE | typeof CliDemoScenario.M2_LIVE_REPAIR_HANDOFF;
  readonly passed: false;
  readonly outcome: 'FAILED';
  readonly failureCode: 'LIVE_VERIFICATION_FAILED';
  readonly message: string;
  readonly goalId: GoalStatusView['goalId'];
  readonly finalStatus: GoalStatusView;
  readonly reopenedStatus: GoalStatusView;
  readonly audit: GoalAuditView;
  readonly finalDrive: WorkflowDriveSummary;
  readonly m2: CliM2DemoDetail;
}

interface CliDemoBlockedResultBase {
  readonly scenario:
    | typeof CliDemoScenario.M2_ADAPTER_FAILURE
    | typeof CliDemoScenario.M2_LIVE
    | typeof CliDemoScenario.M2_LIVE_REPAIR_HANDOFF;
  readonly passed: false;
  readonly outcome: 'BLOCKED';
  readonly blockerCode:
    | 'AUTH_UNAVAILABLE'
    | 'BACKEND_UNAVAILABLE'
    | 'BINARY_UNAVAILABLE'
    | 'MODEL_UNAVAILABLE'
    | 'NETWORK_UNAVAILABLE'
    | 'PROTOCOL_INCOMPATIBLE';
  readonly message: string;
}

export type CliDemoBlockedResult = CliDemoBlockedResultBase &
  (
    | Readonly<{ readonly schemaVersion: 2; readonly externalFailureCode?: never }>
    | Readonly<{
        readonly schemaVersion: 3;
        readonly externalFailureCode: CliExternalFailureCode;
        readonly externalDiagnostic?: never;
      }>
    | Readonly<{
        readonly schemaVersion: 4;
        readonly externalFailureCode: CliExternalFailureCode;
        readonly externalDiagnostic: CliExternalDiagnostic;
      }>
    | (Readonly<{
        readonly schemaVersion: 5;
        readonly runtimeStop: CliRuntimeStopDiagnostic;
      }> &
        (
          | Readonly<{
              readonly externalFailureCode?: never;
              readonly externalDiagnostic?: never;
            }>
          | Readonly<{
              readonly externalFailureCode: CliExternalFailureCode;
              readonly externalDiagnostic?: never;
            }>
          | Readonly<{
              readonly externalFailureCode: CliExternalFailureCode;
              readonly externalDiagnostic: CliExternalDiagnostic;
            }>
        ))
  );

export type CliDemoResult = CliDemoProofResult | CliDemoFailedResult | CliDemoBlockedResult;

export interface CliDemoResultEnvelope {
  readonly schemaVersion: 1;
  readonly kind: 'DEMO_RESULT';
  readonly operation: typeof CliOperation.DEMO_RUN;
  readonly result: CliDemoResult;
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
  | CliIntakeCommandResultEnvelope
  | CliIntakeStatusEnvelope
  | CliIntakeAuditEnvelope
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
