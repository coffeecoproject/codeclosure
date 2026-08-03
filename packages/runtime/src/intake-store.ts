import type {
  AnswerOnlyResponse,
  AuditEventId,
  ClarificationAnswerBinding,
  ClarificationQuestion,
  ClarificationQuestionSpec,
  CommandId,
  Goal,
  GoalMaterializationRecord,
  GoalStartAuthorization,
  IntakeCommandOutcome,
  IntakeCommandReservation,
  IntakeFailureRecord,
  IntakeManifest,
  IntakeRun,
  IntentAdmissionDecision,
  IntentAdmissionPolicy,
  IntentAdmissionPolicyInstallInput,
  IntentAnalysisProposal,
  IntentProjectionRevisionRecord,
  IsoTimestamp,
  MaterialAmbiguitySet,
  RawRequest,
  RawRequestRevisionRecord,
  Sha256Digest,
  WorkflowInstance,
} from '@codeclosure/domain';

export const IntakeAuditAggregateType = {
  INTAKE_RUN: 'INTAKE_RUN',
  RAW_REQUEST: 'RAW_REQUEST',
  INTENT_PROJECTION: 'INTENT_PROJECTION',
  INTENT_ADMISSION_DECISION: 'INTENT_ADMISSION_DECISION',
  CLARIFICATION_QUESTION: 'CLARIFICATION_QUESTION',
  GOAL_MATERIALIZATION: 'GOAL_MATERIALIZATION',
  GOAL_START_AUTHORIZATION: 'GOAL_START_AUTHORIZATION',
  INTAKE_COMMAND: 'INTAKE_COMMAND',
} as const;
export type IntakeAuditAggregateType =
  (typeof IntakeAuditAggregateType)[keyof typeof IntakeAuditAggregateType];

export const IntakeAuditEventType = {
  RAW_REQUEST_ADMITTED: 'RAW_REQUEST_ADMITTED',
  INTAKE_RUN_CREATED: 'INTAKE_RUN_CREATED',
  INTAKE_RUN_UPDATED: 'INTAKE_RUN_UPDATED',
  INTAKE_COMMAND_RESERVED: 'INTAKE_COMMAND_RESERVED',
  INTAKE_COMMAND_REJECTED: 'INTAKE_COMMAND_REJECTED',
  INTAKE_MANIFEST_RECORDED: 'INTAKE_MANIFEST_RECORDED',
  INTENT_ANALYSIS_RECORDED: 'INTENT_ANALYSIS_RECORDED',
  INTENT_PROJECTION_RECORDED: 'INTENT_PROJECTION_RECORDED',
  INTENT_ADMISSION_DECIDED: 'INTENT_ADMISSION_DECIDED',
  CLARIFICATION_QUESTION_ACTIVATED: 'CLARIFICATION_QUESTION_ACTIVATED',
  CLARIFICATION_ANSWER_BOUND: 'CLARIFICATION_ANSWER_BOUND',
  ANSWER_ONLY_RESPONSE_RECORDED: 'ANSWER_ONLY_RESPONSE_RECORDED',
  INTAKE_FAILURE_RECORDED: 'INTAKE_FAILURE_RECORDED',
  GOAL_MATERIALIZED: 'GOAL_MATERIALIZED',
  GOAL_START_AUTHORIZED: 'GOAL_START_AUTHORIZED',
  INTAKE_COMMAND_COMPLETED: 'INTAKE_COMMAND_COMPLETED',
} as const;
export type IntakeAuditEventType = (typeof IntakeAuditEventType)[keyof typeof IntakeAuditEventType];

export interface IntakeAuditWrite {
  readonly id: AuditEventId;
  readonly aggregateType: IntakeAuditAggregateType;
  readonly aggregateId: string;
  readonly eventType: IntakeAuditEventType;
  readonly payloadDigest: Sha256Digest;
  readonly occurredAt: IsoTimestamp;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export type IntentAdmissionPolicyInstallResult =
  | { readonly status: 'INSTALLED'; readonly policy: IntentAdmissionPolicy }
  | { readonly status: 'EXISTING'; readonly policy: IntentAdmissionPolicy }
  | { readonly status: 'POLICY_CONFLICT'; readonly message: string };

export type IntakeReservationStoreResult =
  | {
      readonly status: 'RESERVED';
      readonly reservation: IntakeCommandReservation;
      readonly intakeRun: IntakeRun;
    }
  | {
      readonly status: 'ACTIVE';
      readonly reservation: IntakeCommandReservation;
      readonly intakeRun: IntakeRun;
    }
  | { readonly status: 'REPLAYED'; readonly outcome: IntakeCommandOutcome }
  | { readonly status: 'VERSION_CONFLICT'; readonly message: string }
  | { readonly status: 'COMMAND_CONFLICT'; readonly message: string };

export type IntakeCommitStoreResult =
  | {
      readonly status: 'APPLIED';
      readonly outcome: IntakeCommandOutcome;
      readonly intakeRun: IntakeRun;
    }
  | {
      readonly status: 'REPLAYED';
      readonly outcome: IntakeCommandOutcome;
      readonly intakeRun: IntakeRun;
    }
  | { readonly status: 'VERSION_CONFLICT'; readonly message: string }
  | { readonly status: 'COMMAND_CONFLICT'; readonly message: string };

export interface ReserveInitialIntakeOperation {
  readonly rawRequest: RawRequest;
  readonly rawRequestRevision: RawRequestRevisionRecord;
  readonly intakeRun: Extract<IntakeRun, { readonly status: 'ANALYZING' }>;
  readonly manifest: IntakeManifest;
  readonly reservation: IntakeCommandReservation & {
    readonly operationKind: 'INTENT_ANALYSIS' | 'ANSWER_ONLY';
  };
  readonly auditEvents: readonly IntakeAuditWrite[];
}

export interface ReserveClarificationIntakeOperation {
  readonly rawRequestRevision: RawRequestRevisionRecord;
  readonly answerBinding: ClarificationAnswerBinding;
  readonly intakeRun: Extract<IntakeRun, { readonly status: 'ANALYZING' }>;
  readonly manifest: IntakeManifest;
  readonly reservation: IntakeCommandReservation & {
    readonly operationKind: 'CLARIFICATION_ANALYSIS';
  };
  readonly auditEvents: readonly IntakeAuditWrite[];
}

export interface CommitAnalyzedIntakeBase {
  readonly commandId: CommandId;
  readonly proposal: IntentAnalysisProposal;
  readonly projection: IntentProjectionRevisionRecord;
  readonly ambiguitySet: MaterialAmbiguitySet;
  readonly decision: IntentAdmissionDecision;
  readonly completedAt: IsoTimestamp;
  readonly auditEvents: readonly IntakeAuditWrite[];
}

export type CommitAnalyzedIntake =
  | (CommitAnalyzedIntakeBase &
      Readonly<{
        kind: 'CLARIFY';
        decision: Extract<IntentAdmissionDecision, { readonly kind: 'CLARIFY' }>;
        questionSpec: ClarificationQuestionSpec;
        question: ClarificationQuestion;
        intakeRun: Extract<IntakeRun, { readonly status: 'NEEDS_CLARIFICATION' }>;
      }>)
  | (CommitAnalyzedIntakeBase &
      Readonly<{
        kind: 'NO_EXECUTION';
        decision: Extract<IntentAdmissionDecision, { readonly kind: 'PROJECTED_NO_EXECUTION' }>;
        intakeRun: Extract<IntakeRun, { readonly status: 'NO_EXECUTION' }>;
        answerOnlyResponse?: never;
      }>);

export type CommitIntakeNoExecution =
  | Readonly<{
      kind: 'IMMEDIATE';
      rawRequest: RawRequest;
      rawRequestRevision: RawRequestRevisionRecord;
      reservation: IntakeCommandReservation & {
        readonly operationKind: 'IMMEDIATE_NO_EXECUTION';
      };
      decision: Extract<IntentAdmissionDecision, { readonly kind: 'PRE_ANALYSIS_NO_EXECUTION' }>;
      intakeRun: Extract<IntakeRun, { readonly status: 'NO_EXECUTION' }>;
      completedAt: IsoTimestamp;
      auditEvents: readonly IntakeAuditWrite[];
    }>
  | Readonly<{
      kind: 'ABANDONMENT';
      reservation: IntakeCommandReservation & {
        readonly operationKind: 'ABANDON_CLARIFICATION';
      };
      decision: Extract<IntentAdmissionDecision, { readonly kind: 'PROJECTED_NO_EXECUTION' }>;
      intakeRun: Extract<IntakeRun, { readonly status: 'NO_EXECUTION' }>;
      completedAt: IsoTimestamp;
      auditEvents: readonly IntakeAuditWrite[];
    }>
  | Readonly<{
      kind: 'ANSWER_ONLY';
      commandId: CommandId;
      decision: Extract<IntentAdmissionDecision, { readonly kind: 'PRE_ANALYSIS_NO_EXECUTION' }>;
      response: AnswerOnlyResponse;
      intakeRun: Extract<IntakeRun, { readonly status: 'NO_EXECUTION' }>;
      completedAt: IsoTimestamp;
      auditEvents: readonly IntakeAuditWrite[];
    }>;

export interface CommitIntakeFailure {
  readonly commandId: CommandId;
  readonly failure: IntakeFailureRecord;
  readonly intakeRun: Extract<IntakeRun, { readonly status: 'FAILED' }>;
  readonly completedAt: IsoTimestamp;
  readonly auditEvents: readonly IntakeAuditWrite[];
}

export interface CommitIntakeCommandRejection {
  readonly reservation: IntakeCommandReservation;
  readonly observedIntakeRun: IntakeRun;
  readonly detailCode: string;
  readonly completedAt: IsoTimestamp;
  readonly auditEvents: readonly IntakeAuditWrite[];
}

export interface CommitIntakeMaterialization extends CommitAnalyzedIntakeBase {
  readonly kind: 'MATERIALIZE';
  readonly decision: Extract<IntentAdmissionDecision, { readonly kind: 'MATERIALIZE' }>;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly materialization: GoalMaterializationRecord;
  readonly startAuthorization?: GoalStartAuthorization;
  readonly intakeRun: Extract<IntakeRun, { readonly status: 'MATERIALIZED' }>;
  readonly goalAuditEventId: AuditEventId;
  readonly workflowAuditEventId: AuditEventId;
  readonly goalCreationPayloadDigest: Sha256Digest;
}

export interface IntakeAuthorityView {
  readonly intakeRun: IntakeRun;
  readonly rawRequest: RawRequest;
  readonly rawRequestRevisions: readonly RawRequestRevisionRecord[];
  readonly manifests: readonly IntakeManifest[];
  readonly proposals: readonly IntentAnalysisProposal[];
  readonly projections: readonly IntentProjectionRevisionRecord[];
  readonly ambiguitySets: readonly MaterialAmbiguitySet[];
  readonly decisions: readonly IntentAdmissionDecision[];
  readonly questions: readonly ClarificationQuestion[];
  readonly answerBindings: readonly ClarificationAnswerBinding[];
  readonly answerOnlyResponses: readonly AnswerOnlyResponse[];
  readonly failures: readonly IntakeFailureRecord[];
  readonly reservations: readonly IntakeCommandReservation[];
  readonly outcomes: readonly IntakeCommandOutcome[];
  readonly materialization?: GoalMaterializationRecord;
  readonly startAuthorization?: GoalStartAuthorization;
}

export interface IntakeControlStore {
  installIntentAdmissionPolicy(
    input: IntentAdmissionPolicyInstallInput,
  ): IntentAdmissionPolicyInstallResult;
  getIntentAdmissionPolicy(policyId: string): IntentAdmissionPolicy | undefined;
  reserveInitialIntake(input: ReserveInitialIntakeOperation): IntakeReservationStoreResult;
  reserveClarificationIntake(
    input: ReserveClarificationIntakeOperation,
  ): IntakeReservationStoreResult;
  commitAnalyzedIntake(input: CommitAnalyzedIntake): IntakeCommitStoreResult;
  commitIntakeNoExecution(input: CommitIntakeNoExecution): IntakeCommitStoreResult;
  commitIntakeFailure(input: CommitIntakeFailure): IntakeCommitStoreResult;
  commitIntakeCommandRejection(input: CommitIntakeCommandRejection): IntakeCommitStoreResult;
  commitIntakeMaterialization(input: CommitIntakeMaterialization): IntakeCommitStoreResult;
  getIntakeAuthority(intakeRunId: string): IntakeAuthorityView | undefined;
  getIntakeCommandReservation(commandId: CommandId): IntakeCommandReservation | undefined;
  getIntakeCommandOutcome(commandId: CommandId): IntakeCommandOutcome | undefined;
}
