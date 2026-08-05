import { randomBytes } from 'node:crypto';

import {
  acceptanceDecisionId,
  acceptanceCriticalVerificationPlanId,
  answerOnlyResponseId,
  attemptId,
  auditEventId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  commandId,
  contextManifestId,
  clarificationAnswerBindingId,
  clarificationQuestionId,
  evidenceId,
  externalExecutionId,
  externalExecutionObservationId,
  externalMaintenanceIntentId,
  goalId,
  goalMaterializationId,
  goalStartAuthorizationId,
  intakeFailureRecordId,
  intakeManifestId,
  intakeOperationId,
  intakeRunId,
  intentAdmissionDecisionId,
  intentAnalysisProposalId,
  intentProjectionId,
  isoTimestamp,
  materialAmbiguityId,
  rawRequestId,
  recoveryReconciliationId,
  successCriterionId,
  verificationObligationId,
  workerSessionId,
  workflowId,
  type AcceptanceDecisionId,
  type AcceptanceCriticalVerificationPlanId,
  type AnswerOnlyResponseId,
  type AttemptId,
  type AuditEventId,
  type CandidateGenerationId,
  type CandidateId,
  type CheckSpecificationId,
  type CommandId,
  type ContextManifestId,
  type ClarificationAnswerBindingId,
  type ClarificationQuestionId,
  type EvidenceId,
  type ExternalExecutionId,
  type ExternalExecutionObservationId,
  type ExternalMaintenanceIntentId,
  type GoalId,
  type GoalMaterializationId,
  type GoalStartAuthorizationId,
  type IntakeFailureRecordId,
  type IntakeManifestId,
  type IntakeOperationId,
  type IntakeRunId,
  type IntentAdmissionDecisionId,
  type IntentAnalysisProposalId,
  type IntentProjectionId,
  type IsoTimestamp,
  type MaterialAmbiguityId,
  type RawRequestId,
  type RecoveryReconciliationId,
  type SuccessCriterionId,
  type VerificationObligationId,
  type WorkerSessionId,
  type WorkflowId,
} from '@codeclosure/domain';

import type { CandidateEvidenceIdentityGenerator } from './candidate-evidence-contracts.js';
import type {
  AcceptanceIdentityGenerator,
  Clock,
  ExternalExecutionIdentityGenerator,
  GoalCreationIdentityGenerator,
  RecoveryIdentityGenerator,
  WorkerIdentityGenerator,
} from './ports.js';

/** UTC wall-clock adapter for trusted local composition. */
export class SystemUtcClock implements Clock {
  public now(): IsoTimestamp {
    return isoTimestamp(new Date().toISOString());
  }
}

/**
 * Process-independent identity source for trusted local composition.
 *
 * Each identifier receives 128 bits from the operating-system CSPRNG and is
 * then passed through the owning domain parser. No process-local sequence is
 * treated as a durable identity authority.
 */
export class CryptographicIdentityGenerator
  implements
    GoalCreationIdentityGenerator,
    WorkerIdentityGenerator,
    CandidateEvidenceIdentityGenerator,
    AcceptanceIdentityGenerator,
    ExternalExecutionIdentityGenerator,
    RecoveryIdentityGenerator
{
  public nextGoalId(): GoalId {
    return goalId(`goal_${this.nextSuffix()}`);
  }

  public nextRawRequestId(): RawRequestId {
    return rawRequestId(`raw-request_${this.nextSuffix()}`);
  }

  public nextIntakeRunId(): IntakeRunId {
    return intakeRunId(`intake_${this.nextSuffix()}`);
  }

  public nextIntakeManifestId(): IntakeManifestId {
    return intakeManifestId(`intake-manifest_${this.nextSuffix()}`);
  }

  public nextIntakeOperationId(): IntakeOperationId {
    return intakeOperationId(`intake-operation_${this.nextSuffix()}`);
  }

  public nextIntentAnalysisProposalId(): IntentAnalysisProposalId {
    return intentAnalysisProposalId(`intent-proposal_${this.nextSuffix()}`);
  }

  public nextIntentProjectionId(): IntentProjectionId {
    return intentProjectionId(`intent-projection_${this.nextSuffix()}`);
  }

  public nextMaterialAmbiguityId(): MaterialAmbiguityId {
    return materialAmbiguityId(`ambiguity_${this.nextSuffix()}`);
  }

  public nextIntentAdmissionDecisionId(): IntentAdmissionDecisionId {
    return intentAdmissionDecisionId(`intent-admission_${this.nextSuffix()}`);
  }

  public nextClarificationQuestionId(): ClarificationQuestionId {
    return clarificationQuestionId(`clarification-question_${this.nextSuffix()}`);
  }

  public nextClarificationAnswerBindingId(): ClarificationAnswerBindingId {
    return clarificationAnswerBindingId(`clarification-answer_${this.nextSuffix()}`);
  }

  public nextAnswerOnlyResponseId(): AnswerOnlyResponseId {
    return answerOnlyResponseId(`answer-response_${this.nextSuffix()}`);
  }

  public nextIntakeFailureRecordId(): IntakeFailureRecordId {
    return intakeFailureRecordId(`intake-failure_${this.nextSuffix()}`);
  }

  public nextGoalMaterializationId(): GoalMaterializationId {
    return goalMaterializationId(`materialization_${this.nextSuffix()}`);
  }

  public nextGoalStartAuthorizationId(): GoalStartAuthorizationId {
    return goalStartAuthorizationId(`start-authorization_${this.nextSuffix()}`);
  }

  public nextWorkflowId(): WorkflowId {
    return workflowId(`workflow_${this.nextSuffix()}`);
  }

  public nextSuccessCriterionId(): SuccessCriterionId {
    return successCriterionId(`criterion_${this.nextSuffix()}`);
  }

  public nextAttemptId(): AttemptId {
    return attemptId(`attempt_${this.nextSuffix()}`);
  }

  public nextAuditEventId(): AuditEventId {
    return auditEventId(`audit_${this.nextSuffix()}`);
  }

  public nextCommandId(): CommandId {
    return commandId(`command_${this.nextSuffix()}`);
  }

  public nextContextManifestId(): ContextManifestId {
    return contextManifestId(`context_${this.nextSuffix()}`);
  }

  public nextWorkerSessionId(): WorkerSessionId {
    return workerSessionId(`worker_${this.nextSuffix()}`);
  }

  public nextExternalExecutionId(): ExternalExecutionId {
    return externalExecutionId(`external_${this.nextSuffix()}`);
  }

  public nextExternalExecutionObservationId(): ExternalExecutionObservationId {
    return externalExecutionObservationId(`external-observation_${this.nextSuffix()}`);
  }

  public nextExternalMaintenanceIntentId(): ExternalMaintenanceIntentId {
    return externalMaintenanceIntentId(`maintenance_${this.nextSuffix()}`);
  }

  public nextCandidateId(): CandidateId {
    return candidateId(`candidate_${this.nextSuffix()}`);
  }

  public nextCandidateGenerationId(): CandidateGenerationId {
    return candidateGenerationId(`generation_${this.nextSuffix()}`);
  }

  public nextCheckSpecificationId(): CheckSpecificationId {
    return checkSpecificationId(`check_${this.nextSuffix()}`);
  }

  public nextEvidenceId(): EvidenceId {
    return evidenceId(`evidence_${this.nextSuffix()}`);
  }

  public nextVerificationObligationId(): VerificationObligationId {
    return verificationObligationId(`obligation_${this.nextSuffix()}`);
  }

  public nextAcceptanceDecisionId(): AcceptanceDecisionId {
    return acceptanceDecisionId(`acceptance_${this.nextSuffix()}`);
  }

  public nextAcceptanceCriticalVerificationPlanId(): AcceptanceCriticalVerificationPlanId {
    return acceptanceCriticalVerificationPlanId(`verification-plan_${this.nextSuffix()}`);
  }

  public nextRecoveryReconciliationId(): RecoveryReconciliationId {
    return recoveryReconciliationId(`recovery_${this.nextSuffix()}`);
  }

  private nextSuffix(): string {
    return randomBytes(16).toString('hex');
  }
}
