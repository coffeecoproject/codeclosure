import {
  answerOnlyResponseId,
  clarificationAnswerBindingId,
  clarificationQuestionId,
  commandId,
  executionProfileId,
  goalId,
  goalMaterializationId,
  goalRevision,
  goalStartAuthorizationId,
  intakeFailureRecordId,
  intakeOperationId,
  intakeRunId,
  intakeRunVersion,
  intentAdmissionDecisionId,
  intentAdmissionPolicyId,
  intentAnalysisProposalId,
  intentProjectionId,
  intentProjectionRevision,
  isoTimestamp,
  materialAmbiguityId,
  policyBundleId,
  principalId,
  rawRequestId,
  rawRequestRevision,
  sha256Digest,
  workflowId,
  workflowVersion,
  type AnswerOnlyResponseId,
  type ClarificationAnswerBindingId,
  type ClarificationQuestionId,
  type CommandId,
  type ExecutionProfileId,
  type GoalId,
  type GoalMaterializationId,
  type GoalRevision,
  type GoalStartAuthorizationId,
  type IntakeFailureRecordId,
  type IntakeManifestId,
  type IntakeOperationId,
  type IntakeRunId,
  type IntakeRunVersion,
  type IntentAdmissionDecisionId,
  type IntentAdmissionPolicyId,
  type IntentAnalysisProposalId,
  type IntentProjectionId,
  type IntentProjectionRevision,
  type IsoTimestamp,
  type MaterialAmbiguityId,
  type PolicyBundleId,
  type PrincipalId,
  type RawRequestId,
  type RawRequestRevision,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import { DomainInvariantError } from './workflow.js';

export const IntakeInteractionAction = {
  ANSWER_ONLY: 'ANSWER_ONLY',
  MATERIALIZE_ONLY: 'MATERIALIZE_ONLY',
  GOVERNED_EXECUTION: 'GOVERNED_EXECUTION',
} as const;
export type IntakeInteractionAction =
  (typeof IntakeInteractionAction)[keyof typeof IntakeInteractionAction];

export const IntentExecutionDisposition = {
  NONE: 'NONE',
  LEAVE_READY: 'LEAVE_READY',
  AUTHORIZE_START: 'AUTHORIZE_START',
} as const;
export type IntentExecutionDisposition =
  (typeof IntentExecutionDisposition)[keyof typeof IntentExecutionDisposition];

export const IntakeRunStatus = {
  ANALYZING: 'ANALYZING',
  NEEDS_CLARIFICATION: 'NEEDS_CLARIFICATION',
  MATERIALIZED: 'MATERIALIZED',
  NO_EXECUTION: 'NO_EXECUTION',
  FAILED: 'FAILED',
} as const;
export type IntakeRunStatus = (typeof IntakeRunStatus)[keyof typeof IntakeRunStatus];

export const IntentProjectionField = {
  PROJECT_IDENTITY: 'PROJECT_IDENTITY',
  OBJECTIVE: 'OBJECTIVE',
  REQUIRED_CRITERION: 'REQUIRED_CRITERION',
  SCOPE: 'SCOPE',
  NON_GOAL: 'NON_GOAL',
  ASSUMPTION: 'ASSUMPTION',
  REQUESTED_EXECUTION_DISPOSITION: 'REQUESTED_EXECUTION_DISPOSITION',
} as const;
export type IntentProjectionField =
  (typeof IntentProjectionField)[keyof typeof IntentProjectionField];

export const SourceAuthorityClass = {
  USER_STATED: 'USER_STATED',
  POLICY_DERIVED: 'POLICY_DERIVED',
  PROJECT_OBSERVED: 'PROJECT_OBSERVED',
  MODEL_PROPOSED: 'MODEL_PROPOSED',
  UNRESOLVED: 'UNRESOLVED',
} as const;
export type SourceAuthorityClass = (typeof SourceAuthorityClass)[keyof typeof SourceAuthorityClass];

export const MaterialAmbiguityStatus = {
  UNRESOLVED: 'UNRESOLVED',
  RESOLVED: 'RESOLVED',
} as const;
export type MaterialAmbiguityStatus =
  (typeof MaterialAmbiguityStatus)[keyof typeof MaterialAmbiguityStatus];

export const MaterialAmbiguityReasonCode = {
  PROJECT_IDENTITY_UNRESOLVED: 'PROJECT_IDENTITY_UNRESOLVED',
  OBJECTIVE_UNRESOLVED: 'OBJECTIVE_UNRESOLVED',
  REQUIRED_CRITERION_UNRESOLVED: 'REQUIRED_CRITERION_UNRESOLVED',
  SCOPE_UNRESOLVED: 'SCOPE_UNRESOLVED',
  ASSUMPTION_UNRESOLVED: 'ASSUMPTION_UNRESOLVED',
  NON_GOAL_UNRESOLVED: 'NON_GOAL_UNRESOLVED',
} as const;
export type MaterialAmbiguityReasonCode =
  (typeof MaterialAmbiguityReasonCode)[keyof typeof MaterialAmbiguityReasonCode];

export const ClarificationAnswerSchemaKind = {
  TEXT: 'TEXT',
  PROJECT_PATH: 'PROJECT_PATH',
} as const;
export type ClarificationAnswerSchemaKind =
  (typeof ClarificationAnswerSchemaKind)[keyof typeof ClarificationAnswerSchemaKind];

export const IntentAdmissionDecisionKind = {
  PRE_ANALYSIS_NO_EXECUTION: 'PRE_ANALYSIS_NO_EXECUTION',
  PROJECTED_NO_EXECUTION: 'PROJECTED_NO_EXECUTION',
  CLARIFY: 'CLARIFY',
  MATERIALIZE: 'MATERIALIZE',
} as const;
export type IntentAdmissionDecisionKind =
  (typeof IntentAdmissionDecisionKind)[keyof typeof IntentAdmissionDecisionKind];

export const IntentAdmissionOutcome = {
  NO_EXECUTION: 'NO_EXECUTION',
  CLARIFY: 'CLARIFY',
  MATERIALIZE: 'MATERIALIZE',
} as const;
export type IntentAdmissionOutcome =
  (typeof IntentAdmissionOutcome)[keyof typeof IntentAdmissionOutcome];

export const IntentAdmissionReasonCode = {
  ANSWER_ONLY: 'ANSWER_ONLY',
  POLICY_DENIED: 'POLICY_DENIED',
  UNSUPPORTED: 'UNSUPPORTED',
  ABANDONED: 'ABANDONED',
  MATERIAL_AMBIGUITY: 'MATERIAL_AMBIGUITY',
  MATERIALIZE_ONLY_ADMITTED: 'MATERIALIZE_ONLY_ADMITTED',
  GOVERNED_EXECUTION_ADMITTED: 'GOVERNED_EXECUTION_ADMITTED',
} as const;
export type IntentAdmissionReasonCode =
  (typeof IntentAdmissionReasonCode)[keyof typeof IntentAdmissionReasonCode];

export const IntentAdmissionRuleTraceOutcome = {
  MATCHED: 'MATCHED',
  NOT_MATCHED: 'NOT_MATCHED',
} as const;
export type IntentAdmissionRuleTraceOutcome =
  (typeof IntentAdmissionRuleTraceOutcome)[keyof typeof IntentAdmissionRuleTraceOutcome];

export const AnswerOnlyResponseKind = {
  ANSWER_RETURNED: 'ANSWER_RETURNED',
  ANSWER_FAILED: 'ANSWER_FAILED',
} as const;
export type AnswerOnlyResponseKind =
  (typeof AnswerOnlyResponseKind)[keyof typeof AnswerOnlyResponseKind];

export const AnswerOnlyFailureReasonCode = {
  ASSISTANT_UNAVAILABLE: 'ASSISTANT_UNAVAILABLE',
  ASSISTANT_TIMEOUT: 'ASSISTANT_TIMEOUT',
  ASSISTANT_PROTOCOL_ERROR: 'ASSISTANT_PROTOCOL_ERROR',
  RESPONSE_REJECTED: 'RESPONSE_REJECTED',
  INTERRUPTED_ANSWER_DELIVERY: 'INTERRUPTED_ANSWER_DELIVERY',
} as const;
export type AnswerOnlyFailureReasonCode =
  (typeof AnswerOnlyFailureReasonCode)[keyof typeof AnswerOnlyFailureReasonCode];

export const IntakeFailedOperation = {
  INTENT_ANALYSIS: 'INTENT_ANALYSIS',
  PROJECT_OBSERVATION: 'PROJECT_OBSERVATION',
  ADMISSION_PREPARATION: 'ADMISSION_PREPARATION',
} as const;
export type IntakeFailedOperation =
  (typeof IntakeFailedOperation)[keyof typeof IntakeFailedOperation];

export const IntakeFailureReasonCode = {
  ASSISTANT_UNAVAILABLE: 'ASSISTANT_UNAVAILABLE',
  ASSISTANT_TIMEOUT: 'ASSISTANT_TIMEOUT',
  ASSISTANT_PROTOCOL_ERROR: 'ASSISTANT_PROTOCOL_ERROR',
  RESPONSE_REJECTED: 'RESPONSE_REJECTED',
  INTERRUPTED_ANALYSIS: 'INTERRUPTED_ANALYSIS',
  PROJECT_OBSERVATION_FAILED: 'PROJECT_OBSERVATION_FAILED',
  INTAKE_PREPARATION_FAILED: 'INTAKE_PREPARATION_FAILED',
} as const;
export type IntakeFailureReasonCode =
  (typeof IntakeFailureReasonCode)[keyof typeof IntakeFailureReasonCode];

export const IntakeCommandOperationKind = {
  INTENT_ANALYSIS: 'INTENT_ANALYSIS',
  ANSWER_ONLY: 'ANSWER_ONLY',
  CLARIFICATION_ANALYSIS: 'CLARIFICATION_ANALYSIS',
  ABANDON_CLARIFICATION: 'ABANDON_CLARIFICATION',
  IMMEDIATE_NO_EXECUTION: 'IMMEDIATE_NO_EXECUTION',
} as const;
export type IntakeCommandOperationKind =
  (typeof IntakeCommandOperationKind)[keyof typeof IntakeCommandOperationKind];

export const IntakeCommandDisposition = {
  APPLIED: 'APPLIED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;
export type IntakeCommandDisposition =
  (typeof IntakeCommandDisposition)[keyof typeof IntakeCommandDisposition];

export const IntakeAnswerDisposition = {
  NOT_REQUESTED: 'NOT_REQUESTED',
  ANSWER_RETURNED: 'ANSWER_RETURNED',
  ANSWER_FAILED: 'ANSWER_FAILED',
} as const;
export type IntakeAnswerDisposition =
  (typeof IntakeAnswerDisposition)[keyof typeof IntakeAnswerDisposition];

export const IntakeMaterializationDisposition = {
  NO_GOAL: 'NO_GOAL',
  MATERIALIZED_READY: 'MATERIALIZED_READY',
} as const;
export type IntakeMaterializationDisposition =
  (typeof IntakeMaterializationDisposition)[keyof typeof IntakeMaterializationDisposition];

export const IntakeStartDisposition = {
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  READY_PENDING_START: 'READY_PENDING_START',
  START_COMMAND_APPLIED: 'START_COMMAND_APPLIED',
  START_COMMAND_REJECTED: 'START_COMMAND_REJECTED',
  START_INFRASTRUCTURE_FAILURE: 'START_INFRASTRUCTURE_FAILURE',
} as const;
export type IntakeStartDisposition =
  (typeof IntakeStartDisposition)[keyof typeof IntakeStartDisposition];

export const IntakeManifestOperation = {
  INTENT_ANALYSIS: 'INTENT_ANALYSIS',
  ANSWER_ONLY: 'ANSWER_ONLY',
} as const;
export type IntakeManifestOperation =
  (typeof IntakeManifestOperation)[keyof typeof IntakeManifestOperation];

export const IntakeManifestEntryKind = {
  RAW_REQUEST_REVISION: 'RAW_REQUEST_REVISION',
  INTENT_PROJECTION: 'INTENT_PROJECTION',
  CLARIFICATION_QUESTION: 'CLARIFICATION_QUESTION',
  CLARIFICATION_ANSWER_BINDING: 'CLARIFICATION_ANSWER_BINDING',
  DECLARED_PROJECT: 'DECLARED_PROJECT',
  ADMISSION_POLICY: 'ADMISSION_POLICY',
} as const;
export type IntakeManifestEntryKind =
  (typeof IntakeManifestEntryKind)[keyof typeof IntakeManifestEntryKind];

export interface VersionedDigestRef {
  readonly id: string;
  readonly version: string;
  readonly digest: Sha256Digest;
}

export interface DeclaredProjectRef {
  readonly schemaVersion: 1;
  readonly normalizedPath: string;
  readonly identityDigest: Sha256Digest;
}

export interface AnsweredQuestionBinding {
  readonly clarificationQuestionId: ClarificationQuestionId;
  readonly questionSpecDigest: Sha256Digest;
  readonly questionDigest: Sha256Digest;
  readonly intentAdmissionDecisionId: IntentAdmissionDecisionId;
  readonly intentAdmissionDecisionDigest: Sha256Digest;
}

export interface RawRequestRevisionRef {
  readonly rawRequestId: RawRequestId;
  readonly revision: RawRequestRevision;
  readonly digest: Sha256Digest;
}

export interface RawRequest {
  readonly schemaVersion: 1;
  readonly id: RawRequestId;
  readonly intakeRunId: IntakeRunId;
  readonly createdAt: IsoTimestamp;
}

export interface RawRequestRevisionRecord {
  readonly schemaVersion: 1;
  readonly rawRequestId: RawRequestId;
  readonly intakeRunId: IntakeRunId;
  readonly revision: RawRequestRevision;
  readonly parentRevision?: RawRequestRevision;
  readonly answeredQuestionBinding?: AnsweredQuestionBinding;
  readonly principalRef: PrincipalId;
  readonly interactionAction: IntakeInteractionAction;
  readonly admittedUserContent: string;
  readonly admittedContentDigest: Sha256Digest;
  readonly declaredProjectRef?: DeclaredProjectRef;
  readonly declaredConstraints: readonly string[];
  readonly retentionProfile: VersionedDigestRef;
  readonly submittedAt: IsoTimestamp;
  readonly rawRequestDigest: Sha256Digest;
}

export interface CandidateSourceSpanSuggestion {
  readonly projectionFieldRef:
    | typeof IntentProjectionField.OBJECTIVE
    | typeof IntentProjectionField.REQUIRED_CRITERION
    | typeof IntentProjectionField.SCOPE
    | typeof IntentProjectionField.NON_GOAL
    | typeof IntentProjectionField.ASSUMPTION;
  readonly itemIndex?: number;
  readonly rawRequestRevision: RawRequestRevision;
  readonly startByte: number;
  readonly endByte: number;
}

export interface IntentAnalysisProposal {
  readonly id: IntentAnalysisProposalId;
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly rawRequestRevision: RawRequestRevision;
  readonly rawRequestDigest: Sha256Digest;
  readonly assistantAdapterId: string;
  readonly assistantAdapterVersion: string;
  readonly responseContractDigest: Sha256Digest;
  readonly proposedObjective?: string;
  readonly proposedCriteria: readonly string[];
  readonly proposedScope?: string;
  readonly proposedNonGoals: readonly string[];
  readonly proposedAssumptions: readonly string[];
  readonly proposedQuestions: readonly string[];
  readonly candidateSourceSpanSuggestions: readonly CandidateSourceSpanSuggestion[];
  readonly proposedClassification?: string;
  readonly proposalDigest: Sha256Digest;
  readonly observedAt: IsoTimestamp;
}

export interface SourceByteSpan {
  readonly startByte: number;
  readonly endByte: number;
}

export interface DerivationPolicyRef extends VersionedDigestRef {
  readonly orderedInputBindingDigests: readonly Sha256Digest[];
}

interface SourceBindingBase {
  readonly schemaVersion: 1;
  readonly projectionFieldRef: IntentProjectionField;
  readonly sourceRecordRef: string;
  readonly sourceRevision: number;
  readonly sourceDigest: Sha256Digest;
  readonly bindingDigest: Sha256Digest;
}

export interface UserStatedSourceBinding extends SourceBindingBase {
  readonly authorityClass: typeof SourceAuthorityClass.USER_STATED;
  readonly sourceSpan: SourceByteSpan;
}

export interface PolicyDerivedSourceBinding extends SourceBindingBase {
  readonly authorityClass: typeof SourceAuthorityClass.POLICY_DERIVED;
  readonly sourceFieldPath: string;
  readonly derivationPolicyRef: DerivationPolicyRef;
}

export interface ProjectObservedSourceBinding extends SourceBindingBase {
  readonly authorityClass: typeof SourceAuthorityClass.PROJECT_OBSERVED;
  readonly sourceFieldPath: string;
  readonly observationRef: string;
}

export interface ModelProposedSourceBinding extends SourceBindingBase {
  readonly authorityClass: typeof SourceAuthorityClass.MODEL_PROPOSED;
  readonly sourceFieldPath: string;
}

export interface UnresolvedSourceBinding extends SourceBindingBase {
  readonly authorityClass: typeof SourceAuthorityClass.UNRESOLVED;
  readonly sourceFieldPath: string;
}

export type SourceBinding =
  | UserStatedSourceBinding
  | PolicyDerivedSourceBinding
  | ProjectObservedSourceBinding
  | ModelProposedSourceBinding
  | UnresolvedSourceBinding;

export interface IntentProjectionScope {
  readonly projectPath?: string;
  readonly allowedPaths: readonly string[];
}

export interface IntentAnalysisProposalRef {
  readonly id: IntentAnalysisProposalId;
  readonly digest: Sha256Digest;
}

export interface IntentProjectionRevisionRecord {
  readonly id: IntentProjectionId;
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly revision: IntentProjectionRevision;
  readonly parentRevision?: IntentProjectionRevision;
  readonly rawRequestRevision: RawRequestRevision;
  readonly intentAnalysisProposalRef: IntentAnalysisProposalRef;
  readonly objective: string;
  readonly requiredCriteria: readonly string[];
  readonly optionalCriteria: readonly string[];
  readonly scope: IntentProjectionScope;
  readonly nonGoals: readonly string[];
  readonly assumptions: readonly string[];
  readonly requestedExecutionDisposition:
    | typeof IntentExecutionDisposition.LEAVE_READY
    | typeof IntentExecutionDisposition.AUTHORIZE_START;
  readonly sourceBindings: readonly SourceBinding[];
  readonly materialAmbiguityRefs: readonly MaterialAmbiguityId[];
  readonly canonicalProfileVersion: string;
  readonly projectionDigest: Sha256Digest;
  readonly createdAt: IsoTimestamp;
}

export type MaterialityPolicyRef = VersionedDigestRef;

export interface MaterialAmbiguity {
  readonly id: MaterialAmbiguityId;
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly basedOnProjectionRevision?: IntentProjectionRevision;
  readonly reasonCode: MaterialAmbiguityReasonCode;
  readonly affectedFields: readonly IntentProjectionField[];
  readonly sourceRefs: readonly Sha256Digest[];
  readonly materialityPolicyRef: MaterialityPolicyRef;
  readonly status: MaterialAmbiguityStatus;
  readonly createdAt: IsoTimestamp;
  readonly resolvedByRawRequestRevision?: RawRequestRevision;
}

export interface MaterialAmbiguitySet {
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly intentProjectionId: IntentProjectionId;
  readonly intentProjectionRevision: IntentProjectionRevision;
  readonly intentProjectionDigest: Sha256Digest;
  readonly ambiguities: readonly MaterialAmbiguity[];
  readonly ambiguitySetDigest: Sha256Digest;
}

export type ClarificationAnswerSchema =
  | Readonly<{
      schemaVersion: 1;
      kind: typeof ClarificationAnswerSchemaKind.TEXT;
      maxUtf8Bytes: number;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: typeof ClarificationAnswerSchemaKind.PROJECT_PATH;
    }>;

export interface ClarificationQuestionSpec {
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly basedOnProjectionRevision?: IntentProjectionRevision;
  readonly ambiguityRef: MaterialAmbiguityId;
  readonly prompt: string;
  readonly affectedFields: readonly IntentProjectionField[];
  readonly answerSchema: ClarificationAnswerSchema;
  readonly questionSpecDigest: Sha256Digest;
}

export interface QuestionPlanBinding {
  readonly questionId: ClarificationQuestionId;
  readonly questionSpecDigest: Sha256Digest;
}

export interface ClarificationQuestion {
  readonly id: ClarificationQuestionId;
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly intentAdmissionDecisionId: IntentAdmissionDecisionId;
  readonly intentAdmissionDecisionDigest: Sha256Digest;
  readonly basedOnProjectionRevision?: IntentProjectionRevision;
  readonly ambiguityRef: MaterialAmbiguityId;
  readonly prompt: string;
  readonly affectedFields: readonly IntentProjectionField[];
  readonly answerSchema: ClarificationAnswerSchema;
  readonly questionSpecDigest: Sha256Digest;
  readonly createdAt: IsoTimestamp;
  readonly questionDigest: Sha256Digest;
}

export interface ClarificationAnswerBinding {
  readonly id: ClarificationAnswerBindingId;
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly clarificationQuestionId: ClarificationQuestionId;
  readonly questionSpecDigest: Sha256Digest;
  readonly questionDigest: Sha256Digest;
  readonly intentAdmissionDecisionId: IntentAdmissionDecisionId;
  readonly intentAdmissionDecisionDigest: Sha256Digest;
  readonly rawRequestId: RawRequestId;
  readonly rawRequestRevision: RawRequestRevision;
  readonly rawRequestDigest: Sha256Digest;
  readonly commandId: CommandId;
  readonly canonicalCommandInputDigest: Sha256Digest;
  readonly answeredAt: IsoTimestamp;
  readonly answerBindingDigest: Sha256Digest;
}

export interface ProjectionAdmissionBinding {
  readonly intentAnalysisProposalId: IntentAnalysisProposalId;
  readonly intentAnalysisProposalDigest: Sha256Digest;
  readonly intentProjectionId: IntentProjectionId;
  readonly intentProjectionRevision: IntentProjectionRevision;
  readonly intentProjectionDigest: Sha256Digest;
  readonly sourceBindingDigests: readonly Sha256Digest[];
  readonly materialAmbiguityRefs: readonly MaterialAmbiguityId[];
}

export interface AbandonClarificationReservationBinding {
  readonly clarificationQuestionId: ClarificationQuestionId;
  readonly questionSpecDigest: Sha256Digest;
  readonly questionDigest: Sha256Digest;
  readonly issuingClarifyDecisionId: IntentAdmissionDecisionId;
  readonly issuingClarifyDecisionDigest: Sha256Digest;
}

export interface AbandonmentBinding extends AbandonClarificationReservationBinding {
  readonly commandId: CommandId;
  readonly canonicalCommandInputDigest: Sha256Digest;
}

export interface IntentAdmissionRuleTraceEntry {
  readonly ruleId: string;
  readonly outcome: IntentAdmissionRuleTraceOutcome;
  readonly reasonCode: string;
  readonly inputRefs: readonly string[];
}

interface IntentAdmissionDecisionCommon {
  readonly id: IntentAdmissionDecisionId;
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly intakeRunVersion: IntakeRunVersion;
  readonly principalRef: PrincipalId;
  readonly interactionAction: IntakeInteractionAction;
  readonly rawRequestRevision: RawRequestRevision;
  readonly rawRequestDigest: Sha256Digest;
  readonly admissionPolicyId: IntentAdmissionPolicyId;
  readonly admissionPolicyVersion: string;
  readonly admissionPolicyDigest: Sha256Digest;
  readonly orderedReasonTrace: readonly IntentAdmissionRuleTraceEntry[];
  readonly decidedAt: IsoTimestamp;
  readonly decisionDigest: Sha256Digest;
}

export interface PreAnalysisNoExecutionDecision extends IntentAdmissionDecisionCommon {
  readonly kind: typeof IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION;
  readonly projectOrScopeRef?: DeclaredProjectRef;
  readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
  readonly reasonCode:
    | typeof IntentAdmissionReasonCode.ANSWER_ONLY
    | typeof IntentAdmissionReasonCode.POLICY_DENIED
    | typeof IntentAdmissionReasonCode.UNSUPPORTED;
  readonly executionDisposition: typeof IntentExecutionDisposition.NONE;
}

export interface ProjectedNoExecutionDecision extends IntentAdmissionDecisionCommon {
  readonly kind: typeof IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION;
  readonly projectionBinding: ProjectionAdmissionBinding;
  readonly abandonmentBinding?: AbandonmentBinding;
  readonly projectOrScopeRef?: DeclaredProjectRef;
  readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
  readonly reasonCode:
    | typeof IntentAdmissionReasonCode.POLICY_DENIED
    | typeof IntentAdmissionReasonCode.UNSUPPORTED
    | typeof IntentAdmissionReasonCode.ABANDONED;
  readonly executionDisposition: typeof IntentExecutionDisposition.NONE;
}

export interface ClarifyIntentDecision extends IntentAdmissionDecisionCommon {
  readonly kind: typeof IntentAdmissionDecisionKind.CLARIFY;
  readonly projectionBinding: ProjectionAdmissionBinding;
  readonly questionPlanBinding: QuestionPlanBinding;
  readonly projectOrScopeRef?: DeclaredProjectRef;
  readonly outcome: typeof IntentAdmissionOutcome.CLARIFY;
  readonly reasonCode: typeof IntentAdmissionReasonCode.MATERIAL_AMBIGUITY;
  readonly executionDisposition: typeof IntentExecutionDisposition.NONE;
}

export interface MaterializeIntentDecision extends IntentAdmissionDecisionCommon {
  readonly kind: typeof IntentAdmissionDecisionKind.MATERIALIZE;
  readonly projectionBinding: ProjectionAdmissionBinding;
  readonly projectOrScopeRef: DeclaredProjectRef;
  readonly outcome: typeof IntentAdmissionOutcome.MATERIALIZE;
  readonly reasonCode:
    | typeof IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED
    | typeof IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED;
  readonly executionDisposition:
    | typeof IntentExecutionDisposition.LEAVE_READY
    | typeof IntentExecutionDisposition.AUTHORIZE_START;
}

export type IntentAdmissionDecision =
  | PreAnalysisNoExecutionDecision
  | ProjectedNoExecutionDecision
  | ClarifyIntentDecision
  | MaterializeIntentDecision;

export interface ActiveQuestionRef {
  readonly clarificationQuestionId: ClarificationQuestionId;
  readonly questionSpecDigest: Sha256Digest;
  readonly questionDigest: Sha256Digest;
  readonly issuingDecisionId: IntentAdmissionDecisionId;
  readonly issuingDecisionDigest: Sha256Digest;
}

export interface AdmissionDecisionRef {
  readonly id: IntentAdmissionDecisionId;
  readonly digest: Sha256Digest;
  readonly outcome: IntentAdmissionOutcome;
  readonly reasonCode: IntentAdmissionReasonCode;
}

export interface IntakeFailureRef {
  readonly id: IntakeFailureRecordId;
  readonly digest: Sha256Digest;
}

export interface AnswerOnlyResponseRef {
  readonly id: AnswerOnlyResponseId;
  readonly digest: Sha256Digest;
  readonly kind: AnswerOnlyResponseKind;
}

export interface MaterializedGoalRef {
  readonly goalMaterializationId: GoalMaterializationId;
  readonly materializationDigest: Sha256Digest;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
}

interface IntakeRunCommon {
  readonly id: IntakeRunId;
  readonly schemaVersion: 1;
  readonly version: IntakeRunVersion;
  readonly principalRef: PrincipalId;
  readonly projectRef?: DeclaredProjectRef;
  readonly activeRawRequestRevision: RawRequestRevisionRef;
  readonly activeIntentProjectionRevision?: Readonly<{
    id: IntentProjectionId;
    revision: IntentProjectionRevision;
    digest: Sha256Digest;
  }>;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface AnalyzingIntakeRun extends IntakeRunCommon {
  readonly status: typeof IntakeRunStatus.ANALYZING;
}

export interface NeedsClarificationIntakeRun extends IntakeRunCommon {
  readonly status: typeof IntakeRunStatus.NEEDS_CLARIFICATION;
  readonly activeQuestionRef: ActiveQuestionRef;
}

export interface MaterializedIntakeRun extends IntakeRunCommon {
  readonly status: typeof IntakeRunStatus.MATERIALIZED;
  readonly terminalDecisionRef: AdmissionDecisionRef & {
    readonly outcome: typeof IntentAdmissionOutcome.MATERIALIZE;
  };
  readonly materializedGoalRef: MaterializedGoalRef;
}

export interface AnswerOnlyNoExecutionIntakeRun extends IntakeRunCommon {
  readonly status: typeof IntakeRunStatus.NO_EXECUTION;
  readonly terminalDecisionRef: AdmissionDecisionRef & {
    readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
    readonly reasonCode: typeof IntentAdmissionReasonCode.ANSWER_ONLY;
  };
  readonly answerOnlyResponseRef: AnswerOnlyResponseRef;
}

export interface OtherNoExecutionIntakeRun extends IntakeRunCommon {
  readonly status: typeof IntakeRunStatus.NO_EXECUTION;
  readonly terminalDecisionRef: AdmissionDecisionRef & {
    readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
    readonly reasonCode:
      | typeof IntentAdmissionReasonCode.POLICY_DENIED
      | typeof IntentAdmissionReasonCode.UNSUPPORTED
      | typeof IntentAdmissionReasonCode.ABANDONED;
  };
}

export interface FailedIntakeRun extends IntakeRunCommon {
  readonly status: typeof IntakeRunStatus.FAILED;
  readonly terminalFailureRef: IntakeFailureRef;
}

export type IntakeRun =
  | AnalyzingIntakeRun
  | NeedsClarificationIntakeRun
  | MaterializedIntakeRun
  | AnswerOnlyNoExecutionIntakeRun
  | OtherNoExecutionIntakeRun
  | FailedIntakeRun;

interface AnswerOnlyResponseCommon {
  readonly id: AnswerOnlyResponseId;
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly rawRequestRevision: RawRequestRevision;
  readonly rawRequestDigest: Sha256Digest;
  readonly intentAdmissionDecisionId: IntentAdmissionDecisionId;
  readonly intentAdmissionDecisionDigest: Sha256Digest;
  readonly assistantAdapterId: string;
  readonly assistantAdapterVersion: string;
  readonly responseContractDigest: Sha256Digest;
  readonly observedAt: IsoTimestamp;
  readonly responseDigest: Sha256Digest;
}

export interface AnswerReturned extends AnswerOnlyResponseCommon {
  readonly kind: typeof AnswerOnlyResponseKind.ANSWER_RETURNED;
  readonly answerContent: string;
  readonly answerContentDigest: Sha256Digest;
}

export interface AnswerFailed extends AnswerOnlyResponseCommon {
  readonly kind: typeof AnswerOnlyResponseKind.ANSWER_FAILED;
  readonly failureReasonCode: AnswerOnlyFailureReasonCode;
}

export type AnswerOnlyResponse = AnswerReturned | AnswerFailed;

export interface IntakeFailureRecord {
  readonly id: IntakeFailureRecordId;
  readonly schemaVersion: 1;
  readonly commandId: CommandId;
  readonly intakeRunId: IntakeRunId;
  readonly intakeRunVersion: IntakeRunVersion;
  readonly rawRequestRevision: RawRequestRevision;
  readonly rawRequestDigest: Sha256Digest;
  readonly failedOperation: IntakeFailedOperation;
  readonly assistantAdapterId?: string;
  readonly assistantAdapterVersion?: string;
  readonly responseContractDigest?: Sha256Digest;
  readonly reasonCode: IntakeFailureReasonCode;
  readonly retryDisposition: 'NEW_INTAKE_RUN_REQUIRED';
  readonly failedAt: IsoTimestamp;
  readonly failureDigest: Sha256Digest;
}

export interface IntakeManifestEntry {
  readonly kind: IntakeManifestEntryKind;
  readonly sourceRef: string;
  readonly sourceRevision?: number;
  readonly sourceDigest: Sha256Digest;
  readonly authorityClass: SourceAuthorityClass;
}

export interface IntakeManifestOmission {
  readonly sourceRef: string;
  readonly reasonCode: string;
}

export interface IntakeManifest {
  readonly id: IntakeManifestId;
  readonly schemaVersion: 1;
  readonly operation: IntakeManifestOperation;
  readonly intakeRunId: IntakeRunId;
  readonly rawRequestRevisions: readonly RawRequestRevisionRef[];
  readonly currentProjectionRef?: Readonly<{
    id: IntentProjectionId;
    revision: IntentProjectionRevision;
    digest: Sha256Digest;
  }>;
  readonly questionRefs: readonly ActiveQuestionRef[];
  readonly answerBindingDigests: readonly Sha256Digest[];
  readonly declaredProjectRef?: DeclaredProjectRef;
  readonly admissionPolicy: VersionedDigestRef;
  readonly assistantAdapter: Readonly<{ id: string; version: string }>;
  readonly responseContract: VersionedDigestRef;
  readonly budgetProfile: VersionedDigestRef;
  readonly entries: readonly IntakeManifestEntry[];
  readonly omissions: readonly IntakeManifestOmission[];
  readonly packageDigest: Sha256Digest;
  readonly createdAt: IsoTimestamp;
  readonly manifestDigest: Sha256Digest;
}

export interface ClarificationCommandBinding extends AbandonClarificationReservationBinding {
  readonly answerSchema: ClarificationAnswerSchema;
}

export type IntakeCommandInput =
  | Readonly<{
      schemaVersion: 1;
      kind: 'SUBMIT';
      commandId: CommandId;
      principalRef: PrincipalId;
      interactionAction: IntakeInteractionAction;
      admittedUserContent: string;
      declaredProjectRef?: DeclaredProjectRef;
      declaredConstraints: readonly string[];
      canonicalCommandInputDigest: Sha256Digest;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'CLARIFY';
      commandId: CommandId;
      principalRef: PrincipalId;
      intakeRunId: IntakeRunId;
      expectedIntakeRunVersion: IntakeRunVersion;
      clarificationQuestionId: ClarificationQuestionId;
      answer: string;
      declaredProjectRef?: DeclaredProjectRef;
      canonicalCommandInputDigest: Sha256Digest;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'ABANDON';
      commandId: CommandId;
      principalRef: PrincipalId;
      intakeRunId: IntakeRunId;
      expectedIntakeRunVersion: IntakeRunVersion;
      canonicalCommandInputDigest: Sha256Digest;
    }>;

interface IntakeCommandReservationBase {
  readonly schemaVersion: 1;
  readonly commandId: CommandId;
  readonly operationKind: IntakeCommandOperationKind;
  readonly principalRef: PrincipalId;
  readonly rawRequestId: RawRequestId;
  readonly intakeRunId: IntakeRunId;
  readonly canonicalCommandInputDigest: Sha256Digest;
  readonly expectedIntakeRunVersion?: IntakeRunVersion;
  readonly observedIntakeRunVersion: IntakeRunVersion;
  readonly operationId: IntakeOperationId;
  readonly reservedAt: IsoTimestamp;
}

export interface IntakeExternalOperationBinding {
  readonly manifestId: IntakeManifestId;
  readonly manifestDigest: Sha256Digest;
  readonly admissionPolicyId: IntentAdmissionPolicyId;
  readonly admissionPolicyVersion: string;
  readonly admissionPolicyDigest: Sha256Digest;
  readonly assistantAdapterId: string;
  readonly assistantAdapterVersion: string;
  readonly responseContractDigest: Sha256Digest;
}

export interface ExternalIntakeCommandReservation extends IntakeCommandReservationBase {
  readonly operationKind:
    | typeof IntakeCommandOperationKind.INTENT_ANALYSIS
    | typeof IntakeCommandOperationKind.ANSWER_ONLY;
  readonly externalOperationBinding: IntakeExternalOperationBinding;
}

export interface ClarificationIntakeCommandReservation extends IntakeCommandReservationBase {
  readonly operationKind: typeof IntakeCommandOperationKind.CLARIFICATION_ANALYSIS;
  readonly clarificationBinding: ClarificationCommandBinding;
  readonly externalOperationBinding: IntakeExternalOperationBinding;
}

export interface ImmediateNoExecutionReservation extends IntakeCommandReservationBase {
  readonly operationKind: typeof IntakeCommandOperationKind.IMMEDIATE_NO_EXECUTION;
}

export interface AppliedAbandonClarificationReservation extends IntakeCommandReservationBase {
  readonly operationKind: typeof IntakeCommandOperationKind.ABANDON_CLARIFICATION;
  readonly abandonClarificationBinding: AbandonClarificationReservationBinding;
}

export interface RejectedAbandonClarificationReservation extends IntakeCommandReservationBase {
  readonly operationKind: typeof IntakeCommandOperationKind.ABANDON_CLARIFICATION;
}

export type IntakeCommandReservation =
  | ExternalIntakeCommandReservation
  | ClarificationIntakeCommandReservation
  | ImmediateNoExecutionReservation
  | AppliedAbandonClarificationReservation
  | RejectedAbandonClarificationReservation;

export type AppliedIntakeResult =
  | Readonly<{
      schemaVersion: 1;
      kind: 'CLARIFICATION_REQUIRED';
      intakeRunId: IntakeRunId;
      intakeRunVersion: IntakeRunVersion;
      decisionRef: AdmissionDecisionRef & {
        readonly outcome: typeof IntentAdmissionOutcome.CLARIFY;
      };
      activeQuestionRef: ActiveQuestionRef;
      answerDisposition: typeof IntakeAnswerDisposition.NOT_REQUESTED;
      materializationDisposition: typeof IntakeMaterializationDisposition.NO_GOAL;
      startDisposition: typeof IntakeStartDisposition.NOT_AUTHORIZED;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'NO_EXECUTION';
      intakeRunId: IntakeRunId;
      intakeRunVersion: IntakeRunVersion;
      decisionRef: AdmissionDecisionRef & {
        readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
      };
      answerDisposition: IntakeAnswerDisposition;
      answerOnlyResponseRef?: AnswerOnlyResponseRef;
      materializationDisposition: typeof IntakeMaterializationDisposition.NO_GOAL;
      startDisposition: typeof IntakeStartDisposition.NOT_AUTHORIZED;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'MATERIALIZED';
      intakeRunId: IntakeRunId;
      intakeRunVersion: IntakeRunVersion;
      decisionRef: AdmissionDecisionRef & {
        readonly outcome: typeof IntentAdmissionOutcome.MATERIALIZE;
      };
      materializedGoalRef: MaterializedGoalRef;
      goalStartAuthorizationRef?: Readonly<{
        id: GoalStartAuthorizationId;
        digest: Sha256Digest;
        startCommandId: CommandId;
      }>;
      answerDisposition: typeof IntakeAnswerDisposition.NOT_REQUESTED;
      materializationDisposition: typeof IntakeMaterializationDisposition.MATERIALIZED_READY;
      startDisposition: IntakeStartDisposition;
    }>;

export interface RejectedIntakeResult {
  readonly schemaVersion: 1;
  readonly kind: 'REJECTED';
  readonly intakeRunId: IntakeRunId;
  readonly observedIntakeRunVersion: IntakeRunVersion;
  readonly detailCode: string;
}

export interface FailedIntakeResult {
  readonly schemaVersion: 1;
  readonly kind: 'FAILED';
  readonly intakeRunId: IntakeRunId;
  readonly intakeRunVersion: IntakeRunVersion;
  readonly failureRef: IntakeFailureRef;
}

export type IntakeCommandResult = AppliedIntakeResult | RejectedIntakeResult | FailedIntakeResult;

export type IntakeCommandOutcome =
  | Readonly<{
      schemaVersion: 1;
      disposition: typeof IntakeCommandDisposition.APPLIED;
      commandId: CommandId;
      intakeRunId: IntakeRunId;
      canonicalCommandInputDigest: Sha256Digest;
      observedIntakeRunVersion: IntakeRunVersion;
      result: AppliedIntakeResult;
      resultDigest: Sha256Digest;
      completedAt: IsoTimestamp;
      outcomeDigest: Sha256Digest;
    }>
  | Readonly<{
      schemaVersion: 1;
      disposition: typeof IntakeCommandDisposition.REJECTED;
      commandId: CommandId;
      intakeRunId: IntakeRunId;
      canonicalCommandInputDigest: Sha256Digest;
      observedIntakeRunVersion: IntakeRunVersion;
      result: RejectedIntakeResult;
      resultDigest: Sha256Digest;
      completedAt: IsoTimestamp;
      outcomeDigest: Sha256Digest;
    }>
  | Readonly<{
      schemaVersion: 1;
      disposition: typeof IntakeCommandDisposition.FAILED;
      commandId: CommandId;
      intakeRunId: IntakeRunId;
      canonicalCommandInputDigest: Sha256Digest;
      observedIntakeRunVersion: IntakeRunVersion;
      result: FailedIntakeResult;
      resultDigest: Sha256Digest;
      completedAt: IsoTimestamp;
      outcomeDigest: Sha256Digest;
    }>;

export interface GoalMaterializationRecord {
  readonly id: GoalMaterializationId;
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly rawRequestRevision: RawRequestRevision;
  readonly rawRequestDigest: Sha256Digest;
  readonly intentAdmissionDecisionId: IntentAdmissionDecisionId;
  readonly intentAdmissionDecisionDigest: Sha256Digest;
  readonly intentProjectionId: IntentProjectionId;
  readonly intentProjectionRevision: IntentProjectionRevision;
  readonly intentProjectionDigest: Sha256Digest;
  readonly projectOrScopeRef: DeclaredProjectRef;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly materializedAt: IsoTimestamp;
  readonly materializationDigest: Sha256Digest;
}

export interface GoalStartAuthorization {
  readonly id: GoalStartAuthorizationId;
  readonly schemaVersion: 1;
  readonly principalRef: PrincipalId;
  readonly rawRequestRevision: RawRequestRevision;
  readonly rawRequestDigest: Sha256Digest;
  readonly intentAdmissionDecisionId: IntentAdmissionDecisionId;
  readonly intentAdmissionDecisionDigest: Sha256Digest;
  readonly goalMaterializationId: GoalMaterializationId;
  readonly goalMaterializationDigest: Sha256Digest;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly startCommandId: CommandId;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly authorizedAt: IsoTimestamp;
  readonly authorizationDigest: Sha256Digest;
}

function assertKnown<Value extends string>(
  values: Readonly<Record<string, Value>>,
  value: unknown,
  name: string,
): asserts value is Value {
  if (!Object.values(values).some((candidate) => candidate === value)) {
    throw new DomainInvariantError(`${name} is unknown`);
  }
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new DomainInvariantError(`${name} must not be blank`);
  }
}

function assertUnique(values: readonly string[], name: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertNonBlank(value, name);
    if (seen.has(value)) {
      throw new DomainInvariantError(`${name} must not contain duplicates`);
    }
    seen.add(value);
  }
}

function assertSafeNonNegative(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainInvariantError(`${name} must be a non-negative safe integer`);
  }
}

function assertVersionedDigestRef(value: VersionedDigestRef, name: string): void {
  assertNonBlank(value.id, `${name} ID`);
  assertNonBlank(value.version, `${name} version`);
  sha256Digest(value.digest);
}

export function assertDeclaredProjectRefInvariant(reference: DeclaredProjectRef): void {
  assertNonBlank(reference.normalizedPath, 'Declared Project path');
  if (!reference.normalizedPath.startsWith('/')) {
    throw new DomainInvariantError('Declared Project path must be normalized and absolute');
  }
  sha256Digest(reference.identityDigest);
}

export function assertRawRequestInvariant(record: RawRequest): void {
  rawRequestId(record.id);
  intakeRunId(record.intakeRunId);
  isoTimestamp(record.createdAt);
}

export function assertRawRequestRevisionInvariant(record: RawRequestRevisionRecord): void {
  rawRequestId(record.rawRequestId);
  intakeRunId(record.intakeRunId);
  rawRequestRevision(record.revision);
  principalId(record.principalRef);
  assertKnown(IntakeInteractionAction, record.interactionAction, 'Intake interaction action');
  assertNonBlank(record.admittedUserContent, 'Raw Request admitted user content');
  sha256Digest(record.admittedContentDigest);
  assertUnique(record.declaredConstraints, 'Raw Request declared constraint');
  assertVersionedDigestRef(record.retentionProfile, 'Raw Request retention profile');
  isoTimestamp(record.submittedAt);
  sha256Digest(record.rawRequestDigest);
  if (record.revision === 1) {
    if (record.parentRevision !== undefined || record.answeredQuestionBinding !== undefined) {
      throw new DomainInvariantError('Raw Request revision 1 cannot answer a Question');
    }
  } else {
    if (record.parentRevision !== record.revision - 1) {
      throw new DomainInvariantError('Raw Request revision must bind its immediate parent');
    }
    if (record.answeredQuestionBinding === undefined) {
      throw new DomainInvariantError(
        'A later Raw Request revision must bind its answered Question',
      );
    }
  }
  if (record.declaredProjectRef !== undefined) {
    assertDeclaredProjectRefInvariant(record.declaredProjectRef);
  }
  if (record.answeredQuestionBinding !== undefined) {
    clarificationQuestionId(record.answeredQuestionBinding.clarificationQuestionId);
    sha256Digest(record.answeredQuestionBinding.questionSpecDigest);
    sha256Digest(record.answeredQuestionBinding.questionDigest);
    intentAdmissionDecisionId(record.answeredQuestionBinding.intentAdmissionDecisionId);
    sha256Digest(record.answeredQuestionBinding.intentAdmissionDecisionDigest);
  }
}

export function assertSourceBindingInvariant(binding: SourceBinding): void {
  assertKnown(IntentProjectionField, binding.projectionFieldRef, 'Projection field reference');
  assertNonBlank(binding.sourceRecordRef, 'Source Binding record reference');
  if (!Number.isSafeInteger(binding.sourceRevision) || binding.sourceRevision < 1) {
    throw new DomainInvariantError('Source Binding revision must be a positive safe integer');
  }
  sha256Digest(binding.sourceDigest);
  sha256Digest(binding.bindingDigest);
  switch (binding.authorityClass) {
    case SourceAuthorityClass.USER_STATED:
      assertSafeNonNegative(binding.sourceSpan.startByte, 'Source Binding start byte');
      if (
        !Number.isSafeInteger(binding.sourceSpan.endByte) ||
        binding.sourceSpan.endByte <= binding.sourceSpan.startByte
      ) {
        throw new DomainInvariantError('Source Binding end byte must be after its start byte');
      }
      break;
    case SourceAuthorityClass.POLICY_DERIVED:
      assertNonBlank(binding.sourceFieldPath, 'Policy-derived source field path');
      assertVersionedDigestRef(binding.derivationPolicyRef, 'Derivation policy');
      for (const digest of binding.derivationPolicyRef.orderedInputBindingDigests) {
        sha256Digest(digest);
      }
      break;
    case SourceAuthorityClass.PROJECT_OBSERVED:
      assertNonBlank(binding.sourceFieldPath, 'Project-observed source field path');
      assertNonBlank(binding.observationRef, 'Project observation reference');
      break;
    case SourceAuthorityClass.MODEL_PROPOSED:
    case SourceAuthorityClass.UNRESOLVED:
      assertNonBlank(binding.sourceFieldPath, 'Source field path');
      break;
  }
}

export function assertIntentProjectionInvariant(record: IntentProjectionRevisionRecord): void {
  intentProjectionId(record.id);
  intakeRunId(record.intakeRunId);
  intentProjectionRevision(record.revision);
  rawRequestRevision(record.rawRequestRevision);
  intentAnalysisProposalId(record.intentAnalysisProposalRef.id);
  sha256Digest(record.intentAnalysisProposalRef.digest);
  assertNonBlank(record.objective, 'Intent Projection objective');
  assertUnique(record.requiredCriteria, 'Intent Projection required Criterion');
  assertUnique(record.optionalCriteria, 'Intent Projection optional Criterion');
  if (record.scope.projectPath !== undefined) {
    assertNonBlank(record.scope.projectPath, 'Intent Projection project path');
  }
  assertUnique(record.scope.allowedPaths, 'Intent Projection allowed path');
  assertUnique(record.nonGoals, 'Intent Projection non-goal');
  assertUnique(record.assumptions, 'Intent Projection assumption');
  if (
    record.parentRevision === undefined
      ? record.revision !== 1
      : record.parentRevision !== record.revision - 1
  ) {
    throw new DomainInvariantError('Intent Projection revision must bind its immediate parent');
  }
  for (const binding of record.sourceBindings) {
    assertSourceBindingInvariant(binding);
  }
  const bindingDigests = record.sourceBindings.map(({ bindingDigest }) => bindingDigest);
  if (new Set(bindingDigests).size !== bindingDigests.length) {
    throw new DomainInvariantError('Intent Projection Source Bindings must be unique');
  }
  for (const ambiguityId of record.materialAmbiguityRefs) {
    materialAmbiguityId(ambiguityId);
  }
  if (new Set(record.materialAmbiguityRefs).size !== record.materialAmbiguityRefs.length) {
    throw new DomainInvariantError('Intent Projection ambiguity references must be unique');
  }
  assertNonBlank(record.canonicalProfileVersion, 'Intent Projection canonical profile version');
  sha256Digest(record.projectionDigest);
  isoTimestamp(record.createdAt);
}

export function assertMaterialAmbiguityInvariant(ambiguity: MaterialAmbiguity): void {
  materialAmbiguityId(ambiguity.id);
  intakeRunId(ambiguity.intakeRunId);
  if (ambiguity.basedOnProjectionRevision !== undefined) {
    intentProjectionRevision(ambiguity.basedOnProjectionRevision);
  }
  assertKnown(MaterialAmbiguityReasonCode, ambiguity.reasonCode, 'Material Ambiguity reason');
  if (ambiguity.affectedFields.length === 0) {
    throw new DomainInvariantError('Material Ambiguity must affect at least one field');
  }
  for (const field of ambiguity.affectedFields) {
    assertKnown(IntentProjectionField, field, 'Material Ambiguity affected field');
  }
  if (new Set(ambiguity.affectedFields).size !== ambiguity.affectedFields.length) {
    throw new DomainInvariantError('Material Ambiguity affected fields must be unique');
  }
  for (const sourceRef of ambiguity.sourceRefs) {
    sha256Digest(sourceRef);
  }
  assertVersionedDigestRef(ambiguity.materialityPolicyRef, 'Materiality policy');
  assertKnown(MaterialAmbiguityStatus, ambiguity.status, 'Material Ambiguity status');
  isoTimestamp(ambiguity.createdAt);
  if (
    (ambiguity.status === MaterialAmbiguityStatus.RESOLVED) !==
    (ambiguity.resolvedByRawRequestRevision !== undefined)
  ) {
    throw new DomainInvariantError('Material Ambiguity resolution must match its status');
  }
  if (ambiguity.resolvedByRawRequestRevision !== undefined) {
    rawRequestRevision(ambiguity.resolvedByRawRequestRevision);
  }
}

export function assertClarificationQuestionSpecInvariant(spec: ClarificationQuestionSpec): void {
  intakeRunId(spec.intakeRunId);
  if (spec.basedOnProjectionRevision !== undefined) {
    intentProjectionRevision(spec.basedOnProjectionRevision);
  }
  materialAmbiguityId(spec.ambiguityRef);
  assertNonBlank(spec.prompt, 'Clarification Question prompt');
  if (spec.affectedFields.length === 0) {
    throw new DomainInvariantError('Clarification Question must affect at least one field');
  }
  for (const field of spec.affectedFields) {
    assertKnown(IntentProjectionField, field, 'Clarification Question affected field');
  }
  if (spec.answerSchema.kind === ClarificationAnswerSchemaKind.TEXT) {
    if (
      !Number.isSafeInteger(spec.answerSchema.maxUtf8Bytes) ||
      spec.answerSchema.maxUtf8Bytes < 1
    ) {
      throw new DomainInvariantError('Clarification text answer budget must be positive');
    }
  }
  sha256Digest(spec.questionSpecDigest);
}

export function assertClarificationQuestionInvariant(question: ClarificationQuestion): void {
  clarificationQuestionId(question.id);
  intentAdmissionDecisionId(question.intentAdmissionDecisionId);
  sha256Digest(question.intentAdmissionDecisionDigest);
  assertClarificationQuestionSpecInvariant(question);
  isoTimestamp(question.createdAt);
  sha256Digest(question.questionDigest);
}

export function assertClarificationAnswerBindingInvariant(
  binding: ClarificationAnswerBinding,
): void {
  clarificationAnswerBindingId(binding.id);
  intakeRunId(binding.intakeRunId);
  clarificationQuestionId(binding.clarificationQuestionId);
  sha256Digest(binding.questionSpecDigest);
  sha256Digest(binding.questionDigest);
  intentAdmissionDecisionId(binding.intentAdmissionDecisionId);
  sha256Digest(binding.intentAdmissionDecisionDigest);
  rawRequestId(binding.rawRequestId);
  rawRequestRevision(binding.rawRequestRevision);
  sha256Digest(binding.rawRequestDigest);
  commandId(binding.commandId);
  sha256Digest(binding.canonicalCommandInputDigest);
  isoTimestamp(binding.answeredAt);
  sha256Digest(binding.answerBindingDigest);
}

function assertProjectionAdmissionBinding(binding: ProjectionAdmissionBinding): void {
  intentAnalysisProposalId(binding.intentAnalysisProposalId);
  sha256Digest(binding.intentAnalysisProposalDigest);
  intentProjectionId(binding.intentProjectionId);
  intentProjectionRevision(binding.intentProjectionRevision);
  sha256Digest(binding.intentProjectionDigest);
  for (const digest of binding.sourceBindingDigests) {
    sha256Digest(digest);
  }
  if (new Set(binding.sourceBindingDigests).size !== binding.sourceBindingDigests.length) {
    throw new DomainInvariantError('Admission Source Binding digests must be unique');
  }
  for (const ambiguityRef of binding.materialAmbiguityRefs) {
    materialAmbiguityId(ambiguityRef);
  }
  if (new Set(binding.materialAmbiguityRefs).size !== binding.materialAmbiguityRefs.length) {
    throw new DomainInvariantError('Admission ambiguity references must be unique');
  }
}

export function assertIntentAdmissionDecisionInvariant(decision: IntentAdmissionDecision): void {
  intentAdmissionDecisionId(decision.id);
  intakeRunId(decision.intakeRunId);
  intakeRunVersion(decision.intakeRunVersion);
  principalId(decision.principalRef);
  assertKnown(IntakeInteractionAction, decision.interactionAction, 'Admission interaction action');
  rawRequestRevision(decision.rawRequestRevision);
  sha256Digest(decision.rawRequestDigest);
  intentAdmissionPolicyId(decision.admissionPolicyId);
  assertNonBlank(decision.admissionPolicyVersion, 'Admission Policy version');
  sha256Digest(decision.admissionPolicyDigest);
  if (decision.orderedReasonTrace.length === 0) {
    throw new DomainInvariantError('Admission Decision must contain a reason trace');
  }
  for (const trace of decision.orderedReasonTrace) {
    assertNonBlank(trace.ruleId, 'Admission reason-trace rule');
    assertKnown(IntentAdmissionRuleTraceOutcome, trace.outcome, 'Admission trace outcome');
    assertNonBlank(trace.reasonCode, 'Admission trace reason');
    assertUnique(trace.inputRefs, 'Admission trace input reference');
  }
  isoTimestamp(decision.decidedAt);
  sha256Digest(decision.decisionDigest);
  if (decision.projectOrScopeRef !== undefined) {
    assertDeclaredProjectRefInvariant(decision.projectOrScopeRef);
  }
  switch (decision.kind) {
    case IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION:
      break;
    case IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION:
      assertProjectionAdmissionBinding(decision.projectionBinding);
      if (
        (decision.reasonCode === IntentAdmissionReasonCode.ABANDONED) !==
        (decision.abandonmentBinding !== undefined)
      ) {
        throw new DomainInvariantError('Only ABANDONED requires an Abandonment Binding');
      }
      if (decision.abandonmentBinding !== undefined) {
        clarificationQuestionId(decision.abandonmentBinding.clarificationQuestionId);
        sha256Digest(decision.abandonmentBinding.questionSpecDigest);
        sha256Digest(decision.abandonmentBinding.questionDigest);
        intentAdmissionDecisionId(decision.abandonmentBinding.issuingClarifyDecisionId);
        sha256Digest(decision.abandonmentBinding.issuingClarifyDecisionDigest);
        commandId(decision.abandonmentBinding.commandId);
        sha256Digest(decision.abandonmentBinding.canonicalCommandInputDigest);
      }
      break;
    case IntentAdmissionDecisionKind.CLARIFY:
      assertProjectionAdmissionBinding(decision.projectionBinding);
      clarificationQuestionId(decision.questionPlanBinding.questionId);
      sha256Digest(decision.questionPlanBinding.questionSpecDigest);
      if (decision.projectionBinding.materialAmbiguityRefs.length === 0) {
        throw new DomainInvariantError(
          'CLARIFY requires unresolved ambiguity and NONE disposition',
        );
      }
      break;
    case IntentAdmissionDecisionKind.MATERIALIZE:
      assertProjectionAdmissionBinding(decision.projectionBinding);
      assertDeclaredProjectRefInvariant(decision.projectOrScopeRef);
      if (
        (decision.interactionAction === IntakeInteractionAction.MATERIALIZE_ONLY &&
          decision.executionDisposition !== IntentExecutionDisposition.LEAVE_READY) ||
        (decision.interactionAction === IntakeInteractionAction.GOVERNED_EXECUTION &&
          decision.executionDisposition !== IntentExecutionDisposition.AUTHORIZE_START) ||
        decision.interactionAction === IntakeInteractionAction.ANSWER_ONLY
      ) {
        throw new DomainInvariantError('MATERIALIZE disposition must match trusted action');
      }
      break;
  }
}

export function assertIntakeRunInvariant(run: IntakeRun): void {
  intakeRunId(run.id);
  intakeRunVersion(run.version);
  principalId(run.principalRef);
  rawRequestId(run.activeRawRequestRevision.rawRequestId);
  rawRequestRevision(run.activeRawRequestRevision.revision);
  sha256Digest(run.activeRawRequestRevision.digest);
  if (run.projectRef !== undefined) {
    assertDeclaredProjectRefInvariant(run.projectRef);
  }
  if (run.activeIntentProjectionRevision !== undefined) {
    intentProjectionId(run.activeIntentProjectionRevision.id);
    intentProjectionRevision(run.activeIntentProjectionRevision.revision);
    sha256Digest(run.activeIntentProjectionRevision.digest);
  }
  isoTimestamp(run.createdAt);
  isoTimestamp(run.updatedAt);
  if (run.updatedAt < run.createdAt) {
    throw new DomainInvariantError('Intake Run update cannot predate creation');
  }
  switch (run.status) {
    case IntakeRunStatus.ANALYZING:
      break;
    case IntakeRunStatus.NEEDS_CLARIFICATION:
      clarificationQuestionId(run.activeQuestionRef.clarificationQuestionId);
      sha256Digest(run.activeQuestionRef.questionSpecDigest);
      sha256Digest(run.activeQuestionRef.questionDigest);
      intentAdmissionDecisionId(run.activeQuestionRef.issuingDecisionId);
      sha256Digest(run.activeQuestionRef.issuingDecisionDigest);
      break;
    case IntakeRunStatus.MATERIALIZED:
      goalMaterializationId(run.materializedGoalRef.goalMaterializationId);
      sha256Digest(run.materializedGoalRef.materializationDigest);
      goalId(run.materializedGoalRef.goalId);
      goalRevision(run.materializedGoalRef.goalRevision);
      workflowId(run.materializedGoalRef.workflowId);
      workflowVersion(run.materializedGoalRef.workflowVersion);
      break;
    case IntakeRunStatus.NO_EXECUTION:
      if ('answerOnlyResponseRef' in run) {
        answerOnlyResponseId(run.answerOnlyResponseRef.id);
        sha256Digest(run.answerOnlyResponseRef.digest);
      }
      break;
    case IntakeRunStatus.FAILED:
      intakeFailureRecordId(run.terminalFailureRef.id);
      sha256Digest(run.terminalFailureRef.digest);
      break;
  }
}

export function assertAnswerOnlyResponseInvariant(response: AnswerOnlyResponse): void {
  answerOnlyResponseId(response.id);
  intakeRunId(response.intakeRunId);
  rawRequestRevision(response.rawRequestRevision);
  sha256Digest(response.rawRequestDigest);
  intentAdmissionDecisionId(response.intentAdmissionDecisionId);
  sha256Digest(response.intentAdmissionDecisionDigest);
  assertNonBlank(response.assistantAdapterId, 'Answer-only adapter ID');
  assertNonBlank(response.assistantAdapterVersion, 'Answer-only adapter version');
  sha256Digest(response.responseContractDigest);
  isoTimestamp(response.observedAt);
  sha256Digest(response.responseDigest);
  if (response.kind === AnswerOnlyResponseKind.ANSWER_RETURNED) {
    assertNonBlank(response.answerContent, 'Answer-only content');
    sha256Digest(response.answerContentDigest);
  } else {
    assertKnown(AnswerOnlyFailureReasonCode, response.failureReasonCode, 'Answer-only failure');
  }
}

export function assertIntakeFailureRecordInvariant(record: IntakeFailureRecord): void {
  intakeFailureRecordId(record.id);
  commandId(record.commandId);
  intakeRunId(record.intakeRunId);
  intakeRunVersion(record.intakeRunVersion);
  rawRequestRevision(record.rawRequestRevision);
  sha256Digest(record.rawRequestDigest);
  assertKnown(IntakeFailedOperation, record.failedOperation, 'Intake failed operation');
  const hasAssistantId = record.assistantAdapterId !== undefined;
  const hasAssistantVersion = record.assistantAdapterVersion !== undefined;
  const hasContract = record.responseContractDigest !== undefined;
  if (hasAssistantId !== hasAssistantVersion || hasAssistantVersion !== hasContract) {
    throw new DomainInvariantError('Intake Failure assistant binding must be all or nothing');
  }
  if (record.assistantAdapterId !== undefined) {
    assertNonBlank(record.assistantAdapterId, 'Failure adapter ID');
    assertNonBlank(record.assistantAdapterVersion ?? '', 'Failure adapter version');
    sha256Digest(record.responseContractDigest ?? '');
  }
  assertKnown(IntakeFailureReasonCode, record.reasonCode, 'Intake failure reason');
  isoTimestamp(record.failedAt);
  sha256Digest(record.failureDigest);
}

export function assertIntakeCommandClosureInvariant(
  reservation: IntakeCommandReservation,
  outcome: IntakeCommandOutcome,
): void {
  commandId(reservation.commandId);
  intakeRunId(reservation.intakeRunId);
  rawRequestId(reservation.rawRequestId);
  principalId(reservation.principalRef);
  sha256Digest(reservation.canonicalCommandInputDigest);
  intakeRunVersion(reservation.observedIntakeRunVersion);
  intakeOperationId(reservation.operationId);
  isoTimestamp(reservation.reservedAt);
  commandId(outcome.commandId);
  intakeRunId(outcome.intakeRunId);
  sha256Digest(outcome.canonicalCommandInputDigest);
  intakeRunVersion(outcome.observedIntakeRunVersion);
  sha256Digest(outcome.resultDigest);
  isoTimestamp(outcome.completedAt);
  sha256Digest(outcome.outcomeDigest);
  if (
    reservation.commandId !== outcome.commandId ||
    reservation.intakeRunId !== outcome.intakeRunId ||
    reservation.canonicalCommandInputDigest !== outcome.canonicalCommandInputDigest ||
    reservation.observedIntakeRunVersion !== outcome.observedIntakeRunVersion
  ) {
    throw new DomainInvariantError('Intake reservation and outcome bindings must match exactly');
  }
  if (outcome.completedAt < reservation.reservedAt) {
    throw new DomainInvariantError('Intake outcome cannot predate its reservation');
  }
  if (reservation.operationKind === IntakeCommandOperationKind.ABANDON_CLARIFICATION) {
    const hasBinding = 'abandonClarificationBinding' in reservation;
    if (outcome.disposition === IntakeCommandDisposition.APPLIED) {
      if (
        !hasBinding ||
        outcome.result.kind !== 'NO_EXECUTION' ||
        outcome.result.decisionRef.reasonCode !== IntentAdmissionReasonCode.ABANDONED
      ) {
        throw new DomainInvariantError(
          'Applied abandonment requires its complete binding and result',
        );
      }
    } else if (outcome.disposition === IntakeCommandDisposition.REJECTED) {
      if (hasBinding) {
        throw new DomainInvariantError('Rejected abandonment must use the base-only reservation');
      }
    } else {
      throw new DomainInvariantError('Abandonment cannot retain a FAILED outcome');
    }
  }
}

export function assertGoalMaterializationInvariant(record: GoalMaterializationRecord): void {
  goalMaterializationId(record.id);
  intakeRunId(record.intakeRunId);
  rawRequestRevision(record.rawRequestRevision);
  sha256Digest(record.rawRequestDigest);
  intentAdmissionDecisionId(record.intentAdmissionDecisionId);
  sha256Digest(record.intentAdmissionDecisionDigest);
  intentProjectionId(record.intentProjectionId);
  intentProjectionRevision(record.intentProjectionRevision);
  sha256Digest(record.intentProjectionDigest);
  assertDeclaredProjectRefInvariant(record.projectOrScopeRef);
  goalId(record.goalId);
  goalRevision(record.goalRevision);
  if (record.goalRevision !== 1) {
    throw new DomainInvariantError('Goal Materialization creates only Goal revision 1');
  }
  workflowId(record.workflowId);
  workflowVersion(record.workflowVersion);
  isoTimestamp(record.materializedAt);
  sha256Digest(record.materializationDigest);
}

export function assertGoalStartAuthorizationInvariant(record: GoalStartAuthorization): void {
  goalStartAuthorizationId(record.id);
  principalId(record.principalRef);
  rawRequestRevision(record.rawRequestRevision);
  sha256Digest(record.rawRequestDigest);
  intentAdmissionDecisionId(record.intentAdmissionDecisionId);
  sha256Digest(record.intentAdmissionDecisionDigest);
  goalMaterializationId(record.goalMaterializationId);
  sha256Digest(record.goalMaterializationDigest);
  goalId(record.goalId);
  goalRevision(record.goalRevision);
  workflowId(record.workflowId);
  workflowVersion(record.workflowVersion);
  commandId(record.startCommandId);
  policyBundleId(record.policyBundleId);
  sha256Digest(record.policyBundleDigest);
  executionProfileId(record.executionProfileId);
  sha256Digest(record.executionProfileDigest);
  isoTimestamp(record.authorizedAt);
  sha256Digest(record.authorizationDigest);
}

export function rawRequestRevisionProjection(record: RawRequestRevisionRecord): unknown {
  return {
    schemaVersion: record.schemaVersion,
    rawRequestId: record.rawRequestId,
    intakeRunId: record.intakeRunId,
    revision: record.revision,
    ...(record.parentRevision === undefined ? {} : { parentRevision: record.parentRevision }),
    ...(record.answeredQuestionBinding === undefined
      ? {}
      : { answeredQuestionBinding: record.answeredQuestionBinding }),
    principalRef: record.principalRef,
    interactionAction: record.interactionAction,
    admittedContentDigest: record.admittedContentDigest,
    ...(record.declaredProjectRef === undefined
      ? {}
      : { declaredProjectRef: record.declaredProjectRef }),
    declaredConstraints: record.declaredConstraints,
    retentionProfile: record.retentionProfile,
  };
}

export function intentAnalysisProposalProjection(record: IntentAnalysisProposal): unknown {
  return {
    schemaVersion: record.schemaVersion,
    intakeRunId: record.intakeRunId,
    rawRequestRevision: record.rawRequestRevision,
    rawRequestDigest: record.rawRequestDigest,
    assistantAdapterId: record.assistantAdapterId,
    assistantAdapterVersion: record.assistantAdapterVersion,
    responseContractDigest: record.responseContractDigest,
    ...(record.proposedObjective === undefined
      ? {}
      : { proposedObjective: record.proposedObjective }),
    proposedCriteria: record.proposedCriteria,
    ...(record.proposedScope === undefined ? {} : { proposedScope: record.proposedScope }),
    proposedNonGoals: record.proposedNonGoals,
    proposedAssumptions: record.proposedAssumptions,
    proposedQuestions: record.proposedQuestions,
    candidateSourceSpanSuggestions: record.candidateSourceSpanSuggestions,
    ...(record.proposedClassification === undefined
      ? {}
      : { proposedClassification: record.proposedClassification }),
  };
}

export function sourceBindingProjection(binding: SourceBinding): unknown {
  const base = {
    schemaVersion: binding.schemaVersion,
    projectionFieldRef: binding.projectionFieldRef,
    authorityClass: binding.authorityClass,
    sourceRecordRef: binding.sourceRecordRef,
    sourceRevision: binding.sourceRevision,
    sourceDigest: binding.sourceDigest,
  };
  switch (binding.authorityClass) {
    case SourceAuthorityClass.USER_STATED:
      return { ...base, sourceSpan: binding.sourceSpan };
    case SourceAuthorityClass.POLICY_DERIVED:
      return {
        ...base,
        sourceFieldPath: binding.sourceFieldPath,
        derivationPolicyRef: binding.derivationPolicyRef,
      };
    case SourceAuthorityClass.PROJECT_OBSERVED:
      return {
        ...base,
        sourceFieldPath: binding.sourceFieldPath,
        observationRef: binding.observationRef,
      };
    case SourceAuthorityClass.MODEL_PROPOSED:
    case SourceAuthorityClass.UNRESOLVED:
      return { ...base, sourceFieldPath: binding.sourceFieldPath };
  }
}

export function intentProjectionRevisionProjection(
  record: IntentProjectionRevisionRecord,
): unknown {
  return {
    schemaVersion: record.schemaVersion,
    intakeRunId: record.intakeRunId,
    revision: record.revision,
    ...(record.parentRevision === undefined ? {} : { parentRevision: record.parentRevision }),
    rawRequestRevision: record.rawRequestRevision,
    intentAnalysisProposalRef: record.intentAnalysisProposalRef,
    objective: record.objective,
    requiredCriteria: record.requiredCriteria,
    optionalCriteria: record.optionalCriteria,
    scope: record.scope,
    nonGoals: record.nonGoals,
    assumptions: record.assumptions,
    requestedExecutionDisposition: record.requestedExecutionDisposition,
    sourceBindings: record.sourceBindings.map((binding) => sourceBindingProjection(binding)),
    materialAmbiguityRefs: record.materialAmbiguityRefs,
    canonicalProfileVersion: record.canonicalProfileVersion,
  };
}

export function materialAmbiguitySetProjection(set: MaterialAmbiguitySet): unknown {
  return {
    schemaVersion: set.schemaVersion,
    intakeRunId: set.intakeRunId,
    intentProjectionId: set.intentProjectionId,
    intentProjectionRevision: set.intentProjectionRevision,
    intentProjectionDigest: set.intentProjectionDigest,
    ambiguities: set.ambiguities,
  };
}

export function clarificationQuestionSpecProjection(spec: ClarificationQuestionSpec): unknown {
  return {
    schemaVersion: spec.schemaVersion,
    intakeRunId: spec.intakeRunId,
    ...(spec.basedOnProjectionRevision === undefined
      ? {}
      : { basedOnProjectionRevision: spec.basedOnProjectionRevision }),
    ambiguityRef: spec.ambiguityRef,
    prompt: spec.prompt,
    affectedFields: spec.affectedFields,
    answerSchema: spec.answerSchema,
  };
}

export function clarificationQuestionProjection(question: ClarificationQuestion): unknown {
  return {
    id: question.id,
    schemaVersion: question.schemaVersion,
    intakeRunId: question.intakeRunId,
    intentAdmissionDecisionId: question.intentAdmissionDecisionId,
    intentAdmissionDecisionDigest: question.intentAdmissionDecisionDigest,
    ...(question.basedOnProjectionRevision === undefined
      ? {}
      : { basedOnProjectionRevision: question.basedOnProjectionRevision }),
    ambiguityRef: question.ambiguityRef,
    prompt: question.prompt,
    affectedFields: question.affectedFields,
    answerSchema: question.answerSchema,
    questionSpecDigest: question.questionSpecDigest,
  };
}

export function clarificationAnswerBindingProjection(binding: ClarificationAnswerBinding): unknown {
  return {
    schemaVersion: binding.schemaVersion,
    intakeRunId: binding.intakeRunId,
    clarificationQuestionId: binding.clarificationQuestionId,
    questionSpecDigest: binding.questionSpecDigest,
    questionDigest: binding.questionDigest,
    intentAdmissionDecisionId: binding.intentAdmissionDecisionId,
    intentAdmissionDecisionDigest: binding.intentAdmissionDecisionDigest,
    rawRequestId: binding.rawRequestId,
    rawRequestRevision: binding.rawRequestRevision,
    rawRequestDigest: binding.rawRequestDigest,
    commandId: binding.commandId,
    canonicalCommandInputDigest: binding.canonicalCommandInputDigest,
  };
}

export function abandonClarificationReservationBindingProjection(
  binding: AbandonClarificationReservationBinding,
): unknown {
  return {
    clarificationQuestionId: binding.clarificationQuestionId,
    questionSpecDigest: binding.questionSpecDigest,
    questionDigest: binding.questionDigest,
    issuingClarifyDecisionId: binding.issuingClarifyDecisionId,
    issuingClarifyDecisionDigest: binding.issuingClarifyDecisionDigest,
  };
}

export function abandonmentBindingProjection(binding: AbandonmentBinding): unknown {
  return {
    clarificationQuestionId: binding.clarificationQuestionId,
    questionSpecDigest: binding.questionSpecDigest,
    questionDigest: binding.questionDigest,
    issuingClarifyDecisionId: binding.issuingClarifyDecisionId,
    issuingClarifyDecisionDigest: binding.issuingClarifyDecisionDigest,
    commandId: binding.commandId,
    canonicalCommandInputDigest: binding.canonicalCommandInputDigest,
  };
}

export function intentAdmissionDecisionProjection(decision: IntentAdmissionDecision): unknown {
  const common = {
    schemaVersion: decision.schemaVersion,
    intakeRunId: decision.intakeRunId,
    intakeRunVersion: decision.intakeRunVersion,
    principalRef: decision.principalRef,
    interactionAction: decision.interactionAction,
    rawRequestRevision: decision.rawRequestRevision,
    rawRequestDigest: decision.rawRequestDigest,
    admissionPolicyId: decision.admissionPolicyId,
    admissionPolicyVersion: decision.admissionPolicyVersion,
    admissionPolicyDigest: decision.admissionPolicyDigest,
    orderedReasonTrace: decision.orderedReasonTrace,
    kind: decision.kind,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
    executionDisposition: decision.executionDisposition,
    ...(decision.projectOrScopeRef === undefined
      ? {}
      : { projectOrScopeRef: decision.projectOrScopeRef }),
  };
  switch (decision.kind) {
    case IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION:
      return common;
    case IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION:
      return {
        ...common,
        projectionBinding: decision.projectionBinding,
        ...(decision.abandonmentBinding === undefined
          ? {}
          : { abandonmentBinding: abandonmentBindingProjection(decision.abandonmentBinding) }),
      };
    case IntentAdmissionDecisionKind.CLARIFY:
      return {
        ...common,
        projectionBinding: decision.projectionBinding,
        questionPlanBinding: {
          questionSpecDigest: decision.questionPlanBinding.questionSpecDigest,
        },
      };
    case IntentAdmissionDecisionKind.MATERIALIZE:
      return { ...common, projectionBinding: decision.projectionBinding };
  }
}

export function answerOnlyResponseProjection(response: AnswerOnlyResponse): unknown {
  const common = {
    schemaVersion: response.schemaVersion,
    intakeRunId: response.intakeRunId,
    rawRequestRevision: response.rawRequestRevision,
    rawRequestDigest: response.rawRequestDigest,
    intentAdmissionDecisionId: response.intentAdmissionDecisionId,
    intentAdmissionDecisionDigest: response.intentAdmissionDecisionDigest,
    assistantAdapterId: response.assistantAdapterId,
    assistantAdapterVersion: response.assistantAdapterVersion,
    responseContractDigest: response.responseContractDigest,
    kind: response.kind,
  };
  return response.kind === AnswerOnlyResponseKind.ANSWER_RETURNED
    ? {
        ...common,
        answerContent: response.answerContent,
        answerContentDigest: response.answerContentDigest,
      }
    : { ...common, failureReasonCode: response.failureReasonCode };
}

export function intakeFailureRecordProjection(record: IntakeFailureRecord): unknown {
  return {
    schemaVersion: record.schemaVersion,
    commandId: record.commandId,
    intakeRunId: record.intakeRunId,
    intakeRunVersion: record.intakeRunVersion,
    rawRequestRevision: record.rawRequestRevision,
    rawRequestDigest: record.rawRequestDigest,
    failedOperation: record.failedOperation,
    ...(record.assistantAdapterId === undefined
      ? {}
      : {
          assistantAdapterId: record.assistantAdapterId,
          assistantAdapterVersion: record.assistantAdapterVersion,
          responseContractDigest: record.responseContractDigest,
        }),
    reasonCode: record.reasonCode,
    retryDisposition: record.retryDisposition,
  };
}

export function intakeManifestProjection(manifest: IntakeManifest): unknown {
  return {
    schemaVersion: manifest.schemaVersion,
    operation: manifest.operation,
    intakeRunId: manifest.intakeRunId,
    rawRequestRevisions: manifest.rawRequestRevisions,
    ...(manifest.currentProjectionRef === undefined
      ? {}
      : { currentProjectionRef: manifest.currentProjectionRef }),
    questionRefs: manifest.questionRefs,
    answerBindingDigests: manifest.answerBindingDigests,
    ...(manifest.declaredProjectRef === undefined
      ? {}
      : { declaredProjectRef: manifest.declaredProjectRef }),
    admissionPolicy: manifest.admissionPolicy,
    assistantAdapter: manifest.assistantAdapter,
    responseContract: manifest.responseContract,
    budgetProfile: manifest.budgetProfile,
    entries: manifest.entries,
    omissions: manifest.omissions,
    packageDigest: manifest.packageDigest,
  };
}

export function intakeCommandInputProjection(input: IntakeCommandInput): unknown {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'canonicalCommandInputDigest'),
  );
}

export function intakeCommandReservationProjection(reservation: IntakeCommandReservation): unknown {
  const projection = Object.fromEntries(
    Object.entries(reservation).filter(([key]) => key !== 'reservedAt'),
  );
  return 'abandonClarificationBinding' in reservation
    ? {
        ...projection,
        abandonClarificationBinding: abandonClarificationReservationBindingProjection(
          reservation.abandonClarificationBinding,
        ),
      }
    : projection;
}

export function intakeCommandResultProjection(result: IntakeCommandResult): unknown {
  return result;
}

export function intakeCommandOutcomeProjection(outcome: IntakeCommandOutcome): unknown {
  return {
    schemaVersion: outcome.schemaVersion,
    disposition: outcome.disposition,
    commandId: outcome.commandId,
    intakeRunId: outcome.intakeRunId,
    canonicalCommandInputDigest: outcome.canonicalCommandInputDigest,
    observedIntakeRunVersion: outcome.observedIntakeRunVersion,
    resultDigest: outcome.resultDigest,
  };
}

export function goalMaterializationProjection(record: GoalMaterializationRecord): unknown {
  return {
    schemaVersion: record.schemaVersion,
    intakeRunId: record.intakeRunId,
    rawRequestRevision: record.rawRequestRevision,
    rawRequestDigest: record.rawRequestDigest,
    intentAdmissionDecisionId: record.intentAdmissionDecisionId,
    intentAdmissionDecisionDigest: record.intentAdmissionDecisionDigest,
    intentProjectionId: record.intentProjectionId,
    intentProjectionRevision: record.intentProjectionRevision,
    intentProjectionDigest: record.intentProjectionDigest,
    projectOrScopeRef: record.projectOrScopeRef,
    goalId: record.goalId,
    goalRevision: record.goalRevision,
    workflowId: record.workflowId,
    workflowVersion: record.workflowVersion,
  };
}

export function goalStartAuthorizationProjection(record: GoalStartAuthorization): unknown {
  return {
    schemaVersion: record.schemaVersion,
    principalRef: record.principalRef,
    rawRequestRevision: record.rawRequestRevision,
    rawRequestDigest: record.rawRequestDigest,
    intentAdmissionDecisionId: record.intentAdmissionDecisionId,
    intentAdmissionDecisionDigest: record.intentAdmissionDecisionDigest,
    goalMaterializationId: record.goalMaterializationId,
    goalMaterializationDigest: record.goalMaterializationDigest,
    goalId: record.goalId,
    goalRevision: record.goalRevision,
    workflowId: record.workflowId,
    workflowVersion: record.workflowVersion,
    startCommandId: record.startCommandId,
    policyBundleId: record.policyBundleId,
    policyBundleDigest: record.policyBundleDigest,
    executionProfileId: record.executionProfileId,
    executionProfileDigest: record.executionProfileDigest,
  };
}
