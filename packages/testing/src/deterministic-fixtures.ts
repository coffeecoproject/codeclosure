import {
  acceptanceCriticalVerificationPlanId,
  attemptId,
  acceptanceDecisionId,
  auditEventId,
  answerOnlyResponseId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  commandId,
  contextManifestId,
  goalId,
  goalMaterializationId,
  goalStartAuthorizationId,
  evidenceId,
  externalExecutionId,
  externalExecutionObservationId,
  externalMaintenanceIntentId,
  clarificationAnswerBindingId,
  clarificationQuestionId,
  intakeManifestId,
  intakeFailureRecordId,
  intakeOperationId,
  intakeRunId,
  intentAdmissionDecisionId,
  intentAnalysisProposalId,
  intentProjectionId,
  isoTimestamp,
  materialAmbiguityId,
  projectReadSnapshotCleanupGrantId,
  projectReadSnapshotCleanupOutcomeId,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectSourceReadAuthorityId,
  rawRequestId,
  recoveryReconciliationId,
  successCriterionId,
  workerEventId,
  workerSessionId,
  verificationObligationId,
  workflowId,
  type AcceptanceCriticalVerificationPlanId,
  type AttemptId,
  type AcceptanceDecisionId,
  type AuditEventId,
  type AnswerOnlyResponseId,
  type CandidateGenerationId,
  type CandidateId,
  type CheckSpecificationId,
  type CommandId,
  type ContextManifestId,
  type GoalId,
  type GoalMaterializationId,
  type GoalStartAuthorizationId,
  type EvidenceId,
  type ExternalExecutionId,
  type ExternalExecutionObservationId,
  type ExternalMaintenanceIntentId,
  type ClarificationAnswerBindingId,
  type ClarificationQuestionId,
  type IntakeManifestId,
  type IntakeFailureRecordId,
  type IntakeOperationId,
  type IntakeRunId,
  type IntentAdmissionDecisionId,
  type IntentAnalysisProposalId,
  type IntentProjectionId,
  type IsoTimestamp,
  type MaterialAmbiguityId,
  type ProjectReadSnapshotCleanupGrantId,
  type ProjectReadSnapshotCleanupOutcomeId,
  type ProjectReadSnapshotId,
  type ProjectReadWorkspaceAuthoritySnapshotId,
  type ProjectSourceReadAuthorityId,
  type RawRequestId,
  type RecoveryReconciliationId,
  type SuccessCriterionId,
  type WorkerEventId,
  type WorkerSessionId,
  type VerificationObligationId,
  type WorkflowId,
} from '@codeclosure/domain';

export class DeterministicClock {
  readonly #timestamps: readonly IsoTimestamp[];
  #index = 0;

  public constructor(timestamps: readonly string[]) {
    if (timestamps.length === 0) {
      throw new TypeError('DeterministicClock requires at least one timestamp');
    }
    this.#timestamps = Object.freeze(timestamps.map((value) => isoTimestamp(value)));
  }

  public now(): IsoTimestamp {
    const timestamp = this.#timestamps[this.#index];
    if (timestamp === undefined) {
      throw new RangeError('DeterministicClock timeline is exhausted');
    }
    this.#index += 1;
    return timestamp;
  }
}

export class DeterministicIds {
  readonly #namespace: string;
  #sequence = 0;

  public constructor(namespace = 'fixture') {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(namespace)) {
      throw new TypeError('DeterministicIds namespace must be lowercase alphanumeric with hyphens');
    }
    this.#namespace = namespace;
  }

  public nextGoalId(): GoalId {
    return goalId(`goal_${this.nextSuffix()}`);
  }

  public nextGoalMaterializationId(): GoalMaterializationId {
    return goalMaterializationId(`materialization_${this.nextSuffix()}`);
  }

  public nextGoalStartAuthorizationId(): GoalStartAuthorizationId {
    return goalStartAuthorizationId(`start-authorization_${this.nextSuffix()}`);
  }

  public nextAcceptanceCriticalVerificationPlanId(): AcceptanceCriticalVerificationPlanId {
    return acceptanceCriticalVerificationPlanId(`verification-plan_${this.nextSuffix()}`);
  }

  public nextWorkflowId(): WorkflowId {
    return workflowId(`workflow_${this.nextSuffix()}`);
  }

  public nextSuccessCriterionId(): SuccessCriterionId {
    return successCriterionId(`criterion_${this.nextSuffix()}`);
  }

  public nextRecoveryReconciliationId(): RecoveryReconciliationId {
    return recoveryReconciliationId(`recovery_${this.nextSuffix()}`);
  }

  public nextProjectReadSnapshotCleanupOutcomeId(): ProjectReadSnapshotCleanupOutcomeId {
    return projectReadSnapshotCleanupOutcomeId(`project-read-cleanup-outcome_${this.nextSuffix()}`);
  }

  public nextProjectSourceReadAuthorityId(): ProjectSourceReadAuthorityId {
    return projectSourceReadAuthorityId(`project-read_${this.nextSuffix()}`);
  }

  public nextProjectReadSnapshotId(): ProjectReadSnapshotId {
    return projectReadSnapshotId(`project-read-snapshot_${this.nextSuffix()}`);
  }

  public nextProjectReadWorkspaceAuthoritySnapshotId(): ProjectReadWorkspaceAuthoritySnapshotId {
    return projectReadWorkspaceAuthoritySnapshotId(
      `project-read-authority-snapshot_${this.nextSuffix()}`,
    );
  }

  public nextProjectReadSnapshotCleanupGrantId(): ProjectReadSnapshotCleanupGrantId {
    return projectReadSnapshotCleanupGrantId(`project-read-cleanup-grant_${this.nextSuffix()}`);
  }

  public nextAttemptId(): AttemptId {
    return attemptId(`attempt_${this.nextSuffix()}`);
  }

  public nextAuditEventId(): AuditEventId {
    return auditEventId(`audit_${this.nextSuffix()}`);
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

  public nextAnswerOnlyResponseId(): AnswerOnlyResponseId {
    return answerOnlyResponseId(`answer-response_${this.nextSuffix()}`);
  }

  public nextIntakeFailureRecordId(): IntakeFailureRecordId {
    return intakeFailureRecordId(`intake-failure_${this.nextSuffix()}`);
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

  public nextAcceptanceDecisionId(): AcceptanceDecisionId {
    return acceptanceDecisionId(`acceptance_${this.nextSuffix()}`);
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

  public nextWorkerEventId(): WorkerEventId {
    return workerEventId(`worker-event_${this.nextSuffix()}`);
  }

  private nextSuffix(): string {
    this.#sequence += 1;
    return `${this.#namespace}-${String(this.#sequence).padStart(4, '0')}`;
  }
}
