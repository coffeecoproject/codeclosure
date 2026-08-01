import {
  attemptId,
  acceptanceDecisionId,
  auditEventId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  commandId,
  contextManifestId,
  goalId,
  evidenceId,
  externalExecutionId,
  externalExecutionObservationId,
  externalMaintenanceIntentId,
  isoTimestamp,
  recoveryReconciliationId,
  successCriterionId,
  workerEventId,
  workerSessionId,
  verificationObligationId,
  workflowId,
  type AttemptId,
  type AcceptanceDecisionId,
  type AuditEventId,
  type CandidateGenerationId,
  type CandidateId,
  type CheckSpecificationId,
  type CommandId,
  type ContextManifestId,
  type GoalId,
  type EvidenceId,
  type ExternalExecutionId,
  type ExternalExecutionObservationId,
  type ExternalMaintenanceIntentId,
  type IsoTimestamp,
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

  public nextWorkflowId(): WorkflowId {
    return workflowId(`workflow_${this.nextSuffix()}`);
  }

  public nextSuccessCriterionId(): SuccessCriterionId {
    return successCriterionId(`criterion_${this.nextSuffix()}`);
  }

  public nextRecoveryReconciliationId(): RecoveryReconciliationId {
    return recoveryReconciliationId(`recovery_${this.nextSuffix()}`);
  }

  public nextAttemptId(): AttemptId {
    return attemptId(`attempt_${this.nextSuffix()}`);
  }

  public nextAuditEventId(): AuditEventId {
    return auditEventId(`audit_${this.nextSuffix()}`);
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
