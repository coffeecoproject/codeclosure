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

export type GoalRevision = Brand<number, 'GoalRevision'>;
export type WorkflowVersion = Brand<number, 'WorkflowVersion'>;
export type AggregateVersion = Brand<number, 'AggregateVersion'>;
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

export const goalRevision = (value: number): GoalRevision =>
  parsePositiveInteger(value, 'GoalRevision');
export const workflowVersion = (value: number): WorkflowVersion =>
  parsePositiveInteger(value, 'WorkflowVersion');
export const aggregateVersion = (value: number): AggregateVersion =>
  parsePositiveInteger(value, 'AggregateVersion');

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
