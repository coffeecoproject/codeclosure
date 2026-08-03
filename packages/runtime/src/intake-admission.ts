import type {
  ClarificationQuestionSpec,
  DeclaredProjectRef,
  ExecutionProfileId,
  IntakeRun,
  IntentAdmissionDecision,
  IntentAdmissionDecisionId,
  IntentAdmissionPolicy,
  IntentAnalysisProposal,
  IntentProjectionRevisionRecord,
  IsoTimestamp,
  MaterialAmbiguitySet,
  PolicyBundleId,
  RawRequestRevisionRecord,
  Sha256Digest,
} from '@codeclosure/domain';

interface IntentAdmissionInputViewCommon {
  readonly intakeRun: IntakeRun;
  readonly rawRequestRevision: RawRequestRevisionRecord;
  readonly admissionPolicy: IntentAdmissionPolicy;
}

/** Runtime-owned, immutable input for a decision that requires no assistant analysis. */
export interface PreAnalysisIntentAdmissionInputView extends IntentAdmissionInputViewCommon {
  readonly kind: 'PRE_ANALYSIS';
}

/** Runtime-owned, immutable input carrying one complete source-bound Projection view. */
export interface ProjectedIntentAdmissionInputView extends IntentAdmissionInputViewCommon {
  readonly kind: 'PROJECTED';
  readonly intentAnalysisProposal: IntentAnalysisProposal;
  readonly intentProjection: IntentProjectionRevisionRecord;
  readonly materialAmbiguitySet: MaterialAmbiguitySet;
  readonly clarificationQuestionSpec?: ClarificationQuestionSpec;
  readonly projectOrScopeRef?: DeclaredProjectRef;
  readonly governedExecutionPreflight?: GovernedExecutionPreflight;
}

export type IntentAdmissionInputView =
  PreAnalysisIntentAdmissionInputView | ProjectedIntentAdmissionInputView;

export interface GovernedExecutionPreflight {
  readonly schemaVersion: 1;
  readonly workflowPolicyId: PolicyBundleId;
  readonly workflowPolicyVersion: string;
  readonly workflowPolicyDigest: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileVersion: string;
  readonly executionProfileDigest: Sha256Digest;
}

export interface IssueIntentAdmissionDecisionRequest {
  readonly decisionId: IntentAdmissionDecisionId;
  readonly decidedAt: IsoTimestamp;
  readonly input: IntentAdmissionInputView;
}

/**
 * Sole pre-Goal admission authority. Implementations are supplied in later slices and MUST NOT
 * call an assistant, construct a Goal, mutate Workflow state, or issue technical Acceptance.
 */
export interface IntentAdmissionEngine {
  issueDecision(request: IssueIntentAdmissionDecisionRequest): IntentAdmissionDecision;
}
