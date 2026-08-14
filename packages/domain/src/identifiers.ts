declare const brand: unique symbol;

type Brand<Value, Name extends string> = Value & { readonly [brand]: Name };

export type GoalId = Brand<string, 'GoalId'>;
export type SuccessCriterionId = Brand<string, 'SuccessCriterionId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type AttemptId = Brand<string, 'AttemptId'>;
export type CandidateId = Brand<string, 'CandidateId'>;
export type CandidateGenerationId = Brand<string, 'CandidateGenerationId'>;
export type FactId = Brand<string, 'FactId'>;
export type DecisionId = Brand<string, 'DecisionId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type VerificationObligationId = Brand<string, 'VerificationObligationId'>;
export type CheckSpecificationId = Brand<string, 'CheckSpecificationId'>;
export type PendingIssueId = Brand<string, 'PendingIssueId'>;
export type AcceptanceDecisionId = Brand<string, 'AcceptanceDecisionId'>;
export type PolicyBundleId = Brand<string, 'PolicyBundleId'>;
export type ExecutionProfileId = Brand<string, 'ExecutionProfileId'>;
export type RecoveryReconciliationId = Brand<string, 'RecoveryReconciliationId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type WorkerSessionId = Brand<string, 'WorkerSessionId'>;
export type ContextManifestId = Brand<string, 'ContextManifestId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type WorkerEventId = Brand<string, 'WorkerEventId'>;
export type ExternalExecutionId = Brand<string, 'ExternalExecutionId'>;
export type ExternalExecutionObservationId = Brand<string, 'ExternalExecutionObservationId'>;
export type ExternalMaintenanceIntentId = Brand<string, 'ExternalMaintenanceIntentId'>;
export type AcceptanceCriticalVerificationPlanId = Brand<
  string,
  'AcceptanceCriticalVerificationPlanId'
>;
export type PrincipalId = Brand<string, 'PrincipalId'>;
export type RawRequestId = Brand<string, 'RawRequestId'>;
export type IntakeRunId = Brand<string, 'IntakeRunId'>;
export type IntakeManifestId = Brand<string, 'IntakeManifestId'>;
export type IntakeOperationId = Brand<string, 'IntakeOperationId'>;
export type IntentAnalysisProposalId = Brand<string, 'IntentAnalysisProposalId'>;
export type IntentProjectionId = Brand<string, 'IntentProjectionId'>;
export type MaterialAmbiguityId = Brand<string, 'MaterialAmbiguityId'>;
export type ClarificationQuestionId = Brand<string, 'ClarificationQuestionId'>;
export type ClarificationAnswerBindingId = Brand<string, 'ClarificationAnswerBindingId'>;
export type IntentAdmissionDecisionId = Brand<string, 'IntentAdmissionDecisionId'>;
export type IntentAdmissionPolicyId = Brand<string, 'IntentAdmissionPolicyId'>;
export type AnswerOnlyResponseId = Brand<string, 'AnswerOnlyResponseId'>;
export type IntakeFailureRecordId = Brand<string, 'IntakeFailureRecordId'>;
export type GoalMaterializationId = Brand<string, 'GoalMaterializationId'>;
export type GoalStartAuthorizationId = Brand<string, 'GoalStartAuthorizationId'>;
export type ProjectSourceReadAuthorityId = Brand<string, 'ProjectSourceReadAuthorityId'>;
export type ProjectReadSnapshotId = Brand<string, 'ProjectReadSnapshotId'>;
export type ProjectReadWorkspaceAuthoritySnapshotId = Brand<
  string,
  'ProjectReadWorkspaceAuthoritySnapshotId'
>;
export type ProjectReadWorkspaceObservationId = Brand<string, 'ProjectReadWorkspaceObservationId'>;
export type ProjectReadSnapshotCleanupGrantId = Brand<string, 'ProjectReadSnapshotCleanupGrantId'>;
export type ProjectReadSnapshotCleanupObservationId = Brand<
  string,
  'ProjectReadSnapshotCleanupObservationId'
>;
export type ProjectReadSnapshotCleanupOutcomeId = Brand<
  string,
  'ProjectReadSnapshotCleanupOutcomeId'
>;
export type InteractionSessionId = Brand<string, 'InteractionSessionId'>;
export type InteractionMessageId = Brand<string, 'InteractionMessageId'>;
export type InteractionOperationId = Brand<string, 'InteractionOperationId'>;
export type FocusBindingId = Brand<string, 'FocusBindingId'>;
export type RouteProposalId = Brand<string, 'RouteProposalId'>;
export type RouteDecisionId = Brand<string, 'RouteDecisionId'>;
export type PendingActionId = Brand<string, 'PendingActionId'>;
export type PendingActionResolutionId = Brand<string, 'PendingActionResolutionId'>;
export type InteractionActionReservationId = Brand<string, 'InteractionActionReservationId'>;
export type InteractionActionOutcomeId = Brand<string, 'InteractionActionOutcomeId'>;
export type InteractionMessageHandoffId = Brand<string, 'InteractionMessageHandoffId'>;
export type FrontstageAnswerId = Brand<string, 'FrontstageAnswerId'>;
export type FrontstageContextManifestId = Brand<string, 'FrontstageContextManifestId'>;
export type InteractionRoutingPolicyId = Brand<string, 'InteractionRoutingPolicyId'>;
export type InteractionConfirmationPolicyId = Brand<string, 'InteractionConfirmationPolicyId'>;

export type GoalRevision = Brand<number, 'GoalRevision'>;
export type WorkflowVersion = Brand<number, 'WorkflowVersion'>;
export type AggregateVersion = Brand<number, 'AggregateVersion'>;
export type RawRequestRevision = Brand<number, 'RawRequestRevision'>;
export type IntakeRunVersion = Brand<number, 'IntakeRunVersion'>;
export type IntentProjectionRevision = Brand<number, 'IntentProjectionRevision'>;
export type InteractionSessionVersion = Brand<number, 'InteractionSessionVersion'>;
export type InteractionOperationVersion = Brand<number, 'InteractionOperationVersion'>;
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;
export type Sha256Digest = Brand<string, 'Sha256Digest'>;

const identifierSuffixPattern = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

function parseIdentifier<Name extends string>(
  prefix: string,
  value: string,
  name: Name,
): Brand<string, Name> {
  const expectedPrefix = `${prefix}_`;
  const suffix = value.startsWith(expectedPrefix) ? value.slice(expectedPrefix.length) : '';

  if (!identifierSuffixPattern.test(suffix)) {
    throw new TypeError(`${name} must use the ${expectedPrefix}<lowercase-id> format`);
  }

  return value as Brand<string, Name>;
}

function parsePositiveInteger<Name extends string>(value: number, name: Name): Brand<number, Name> {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }

  return value as Brand<number, Name>;
}

export const goalId = (value: string): GoalId => parseIdentifier('goal', value, 'GoalId');
export const successCriterionId = (value: string): SuccessCriterionId =>
  parseIdentifier('criterion', value, 'SuccessCriterionId');
export const workflowId = (value: string): WorkflowId =>
  parseIdentifier('workflow', value, 'WorkflowId');
export const attemptId = (value: string): AttemptId =>
  parseIdentifier('attempt', value, 'AttemptId');
export const candidateId = (value: string): CandidateId =>
  parseIdentifier('candidate', value, 'CandidateId');
export const candidateGenerationId = (value: string): CandidateGenerationId =>
  parseIdentifier('generation', value, 'CandidateGenerationId');
export const factId = (value: string): FactId => parseIdentifier('fact', value, 'FactId');
export const decisionId = (value: string): DecisionId =>
  parseIdentifier('decision', value, 'DecisionId');
export const evidenceId = (value: string): EvidenceId =>
  parseIdentifier('evidence', value, 'EvidenceId');
export const verificationObligationId = (value: string): VerificationObligationId =>
  parseIdentifier('obligation', value, 'VerificationObligationId');
export const checkSpecificationId = (value: string): CheckSpecificationId =>
  parseIdentifier('check', value, 'CheckSpecificationId');
export const pendingIssueId = (value: string): PendingIssueId =>
  parseIdentifier('issue', value, 'PendingIssueId');
export const acceptanceDecisionId = (value: string): AcceptanceDecisionId =>
  parseIdentifier('acceptance', value, 'AcceptanceDecisionId');
export const policyBundleId = (value: string): PolicyBundleId =>
  parseIdentifier('policy', value, 'PolicyBundleId');
export const executionProfileId = (value: string): ExecutionProfileId =>
  parseIdentifier('profile', value, 'ExecutionProfileId');
export const recoveryReconciliationId = (value: string): RecoveryReconciliationId =>
  parseIdentifier('recovery', value, 'RecoveryReconciliationId');
export const auditEventId = (value: string): AuditEventId =>
  parseIdentifier('audit', value, 'AuditEventId');
export const workerSessionId = (value: string): WorkerSessionId =>
  parseIdentifier('worker', value, 'WorkerSessionId');
export const contextManifestId = (value: string): ContextManifestId =>
  parseIdentifier('context', value, 'ContextManifestId');
export const commandId = (value: string): CommandId =>
  parseIdentifier('command', value, 'CommandId');
export const workerEventId = (value: string): WorkerEventId =>
  parseIdentifier('worker-event', value, 'WorkerEventId');
export const externalExecutionId = (value: string): ExternalExecutionId =>
  parseIdentifier('external', value, 'ExternalExecutionId');
export const externalExecutionObservationId = (value: string): ExternalExecutionObservationId =>
  parseIdentifier('external-observation', value, 'ExternalExecutionObservationId');
export const externalMaintenanceIntentId = (value: string): ExternalMaintenanceIntentId =>
  parseIdentifier('maintenance', value, 'ExternalMaintenanceIntentId');
export const acceptanceCriticalVerificationPlanId = (
  value: string,
): AcceptanceCriticalVerificationPlanId =>
  parseIdentifier('verification-plan', value, 'AcceptanceCriticalVerificationPlanId');
export const principalId = (value: string): PrincipalId =>
  parseIdentifier('principal', value, 'PrincipalId');
export const rawRequestId = (value: string): RawRequestId =>
  parseIdentifier('raw-request', value, 'RawRequestId');
export const intakeRunId = (value: string): IntakeRunId =>
  parseIdentifier('intake', value, 'IntakeRunId');
export const intakeManifestId = (value: string): IntakeManifestId =>
  parseIdentifier('intake-manifest', value, 'IntakeManifestId');
export const intakeOperationId = (value: string): IntakeOperationId =>
  parseIdentifier('intake-operation', value, 'IntakeOperationId');
export const intentAnalysisProposalId = (value: string): IntentAnalysisProposalId =>
  parseIdentifier('intent-proposal', value, 'IntentAnalysisProposalId');
export const intentProjectionId = (value: string): IntentProjectionId =>
  parseIdentifier('intent-projection', value, 'IntentProjectionId');
export const materialAmbiguityId = (value: string): MaterialAmbiguityId =>
  parseIdentifier('ambiguity', value, 'MaterialAmbiguityId');
export const clarificationQuestionId = (value: string): ClarificationQuestionId =>
  parseIdentifier('clarification-question', value, 'ClarificationQuestionId');
export const clarificationAnswerBindingId = (value: string): ClarificationAnswerBindingId =>
  parseIdentifier('clarification-answer', value, 'ClarificationAnswerBindingId');
export const intentAdmissionDecisionId = (value: string): IntentAdmissionDecisionId =>
  parseIdentifier('intent-admission', value, 'IntentAdmissionDecisionId');
export const intentAdmissionPolicyId = (value: string): IntentAdmissionPolicyId =>
  parseIdentifier('admission-policy', value, 'IntentAdmissionPolicyId');
export const answerOnlyResponseId = (value: string): AnswerOnlyResponseId =>
  parseIdentifier('answer-response', value, 'AnswerOnlyResponseId');
export const intakeFailureRecordId = (value: string): IntakeFailureRecordId =>
  parseIdentifier('intake-failure', value, 'IntakeFailureRecordId');
export const goalMaterializationId = (value: string): GoalMaterializationId =>
  parseIdentifier('materialization', value, 'GoalMaterializationId');
export const goalStartAuthorizationId = (value: string): GoalStartAuthorizationId =>
  parseIdentifier('start-authorization', value, 'GoalStartAuthorizationId');
export const projectSourceReadAuthorityId = (value: string): ProjectSourceReadAuthorityId =>
  parseIdentifier('project-read', value, 'ProjectSourceReadAuthorityId');
export const projectReadSnapshotId = (value: string): ProjectReadSnapshotId =>
  parseIdentifier('project-read-snapshot', value, 'ProjectReadSnapshotId');
export const projectReadWorkspaceAuthoritySnapshotId = (
  value: string,
): ProjectReadWorkspaceAuthoritySnapshotId =>
  parseIdentifier(
    'project-read-authority-snapshot',
    value,
    'ProjectReadWorkspaceAuthoritySnapshotId',
  );
export const projectReadWorkspaceObservationId = (
  value: string,
): ProjectReadWorkspaceObservationId =>
  parseIdentifier('project-read-observation', value, 'ProjectReadWorkspaceObservationId');
export const projectReadSnapshotCleanupGrantId = (
  value: string,
): ProjectReadSnapshotCleanupGrantId =>
  parseIdentifier('project-read-cleanup-grant', value, 'ProjectReadSnapshotCleanupGrantId');
export const projectReadSnapshotCleanupObservationId = (
  value: string,
): ProjectReadSnapshotCleanupObservationId =>
  parseIdentifier(
    'project-read-cleanup-observation',
    value,
    'ProjectReadSnapshotCleanupObservationId',
  );
export const projectReadSnapshotCleanupOutcomeId = (
  value: string,
): ProjectReadSnapshotCleanupOutcomeId =>
  parseIdentifier('project-read-cleanup-outcome', value, 'ProjectReadSnapshotCleanupOutcomeId');
export const interactionSessionId = (value: string): InteractionSessionId =>
  parseIdentifier('interaction-session', value, 'InteractionSessionId');
export const interactionMessageId = (value: string): InteractionMessageId =>
  parseIdentifier('interaction-message', value, 'InteractionMessageId');
export const interactionOperationId = (value: string): InteractionOperationId =>
  parseIdentifier('interaction-operation', value, 'InteractionOperationId');
export const focusBindingId = (value: string): FocusBindingId =>
  parseIdentifier('focus-binding', value, 'FocusBindingId');
export const routeProposalId = (value: string): RouteProposalId =>
  parseIdentifier('route-proposal', value, 'RouteProposalId');
export const routeDecisionId = (value: string): RouteDecisionId =>
  parseIdentifier('route-decision', value, 'RouteDecisionId');
export const pendingActionId = (value: string): PendingActionId =>
  parseIdentifier('pending-action', value, 'PendingActionId');
export const pendingActionResolutionId = (value: string): PendingActionResolutionId =>
  parseIdentifier('pending-action-resolution', value, 'PendingActionResolutionId');
export const interactionActionReservationId = (value: string): InteractionActionReservationId =>
  parseIdentifier('interaction-action-reservation', value, 'InteractionActionReservationId');
export const interactionActionOutcomeId = (value: string): InteractionActionOutcomeId =>
  parseIdentifier('interaction-action-outcome', value, 'InteractionActionOutcomeId');
export const interactionMessageHandoffId = (value: string): InteractionMessageHandoffId =>
  parseIdentifier('interaction-message-handoff', value, 'InteractionMessageHandoffId');
export const frontstageAnswerId = (value: string): FrontstageAnswerId =>
  parseIdentifier('frontstage-answer', value, 'FrontstageAnswerId');
export const frontstageContextManifestId = (value: string): FrontstageContextManifestId =>
  parseIdentifier('frontstage-context-manifest', value, 'FrontstageContextManifestId');
export const interactionRoutingPolicyId = (value: string): InteractionRoutingPolicyId =>
  parseIdentifier('interaction-routing-policy', value, 'InteractionRoutingPolicyId');
export const interactionConfirmationPolicyId = (value: string): InteractionConfirmationPolicyId =>
  parseIdentifier('interaction-confirmation-policy', value, 'InteractionConfirmationPolicyId');

export const goalRevision = (value: number): GoalRevision =>
  parsePositiveInteger(value, 'GoalRevision');
export const workflowVersion = (value: number): WorkflowVersion =>
  parsePositiveInteger(value, 'WorkflowVersion');
export const aggregateVersion = (value: number): AggregateVersion =>
  parsePositiveInteger(value, 'AggregateVersion');
export const rawRequestRevision = (value: number): RawRequestRevision =>
  parsePositiveInteger(value, 'RawRequestRevision');
export const intakeRunVersion = (value: number): IntakeRunVersion =>
  parsePositiveInteger(value, 'IntakeRunVersion');
export const intentProjectionRevision = (value: number): IntentProjectionRevision =>
  parsePositiveInteger(value, 'IntentProjectionRevision');
export const interactionSessionVersion = (value: number): InteractionSessionVersion =>
  parsePositiveInteger(value, 'InteractionSessionVersion');
export const interactionOperationVersion = (value: number): InteractionOperationVersion =>
  parsePositiveInteger(value, 'InteractionOperationVersion');

export const nextWorkflowVersion = (value: WorkflowVersion): WorkflowVersion =>
  workflowVersion(value + 1);
export const nextAggregateVersion = (value: AggregateVersion): AggregateVersion =>
  aggregateVersion(value + 1);

export function isoTimestamp(value: string): IsoTimestamp {
  if (!timestampPattern.test(value) || new Date(value).toISOString() !== value) {
    throw new TypeError('IsoTimestamp must be RFC 3339 UTC with fixed millisecond precision');
  }

  return value as IsoTimestamp;
}

export function latestIsoTimestamp(
  first: IsoTimestamp,
  ...remaining: readonly IsoTimestamp[]
): IsoTimestamp {
  return remaining.reduce((latest, timestamp) => (timestamp > latest ? timestamp : latest), first);
}

export function sha256Digest(value: string): Sha256Digest {
  if (!sha256Pattern.test(value)) {
    throw new TypeError('Sha256Digest must use sha256:<64 lowercase hex characters>');
  }

  return value as Sha256Digest;
}
