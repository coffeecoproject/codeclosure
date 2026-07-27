import {
  attemptId,
  auditEventId,
  candidateGenerationId,
  candidateId,
  commandId,
  goalId,
  isoTimestamp,
  workflowId,
  type AttemptId,
  type AuditEventId,
  type CandidateGenerationId,
  type CandidateId,
  type CommandId,
  type GoalId,
  type IsoTimestamp,
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

  public nextAttemptId(): AttemptId {
    return attemptId(`attempt_${this.nextSuffix()}`);
  }

  public nextAuditEventId(): AuditEventId {
    return auditEventId(`audit_${this.nextSuffix()}`);
  }

  public nextCandidateId(): CandidateId {
    return candidateId(`candidate_${this.nextSuffix()}`);
  }

  public nextCandidateGenerationId(): CandidateGenerationId {
    return candidateGenerationId(`generation_${this.nextSuffix()}`);
  }

  public nextCommandId(): CommandId {
    return commandId(`command_${this.nextSuffix()}`);
  }

  private nextSuffix(): string {
    this.#sequence += 1;
    return `${this.#namespace}-${String(this.#sequence).padStart(4, '0')}`;
  }
}
