import { z } from 'zod';

import {
  RunStatus,
  WorkflowPhase,
  commandId,
  decodeWorkflowSnapshot,
  goalId,
  workflowId,
  workflowVersion,
  type CommandId,
  type GoalId,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowVersion,
} from '@codeclosure/domain';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const RuntimeErrorCode = {
  NOT_FOUND: 'NOT_FOUND',
  DOMAIN_REJECTED: 'DOMAIN_REJECTED',
  STALE_GOAL_REVISION: 'STALE_GOAL_REVISION',
  STALE_WORKFLOW_VERSION: 'STALE_WORKFLOW_VERSION',
  COMMAND_ID_CONFLICT: 'COMMAND_ID_CONFLICT',
  INVALID_STORED_OUTCOME: 'INVALID_STORED_OUTCOME',
  EVALUATION_FAILURE: 'EVALUATION_FAILURE',
  PERSISTENCE_FAILURE: 'PERSISTENCE_FAILURE',
  INTERNAL_FAILURE: 'INTERNAL_FAILURE',
} as const;
export type RuntimeErrorCode = (typeof RuntimeErrorCode)[keyof typeof RuntimeErrorCode];

export interface CommandError {
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly detailCode: string;
}

export type DeterministicCommandErrorCode =
  | typeof RuntimeErrorCode.NOT_FOUND
  | typeof RuntimeErrorCode.DOMAIN_REJECTED
  | typeof RuntimeErrorCode.STALE_GOAL_REVISION
  | typeof RuntimeErrorCode.STALE_WORKFLOW_VERSION;

export interface DeterministicCommandError extends CommandError {
  readonly code: DeterministicCommandErrorCode;
}

export interface SuccessfulCommandOutput {
  readonly schemaVersion: 1;
  readonly commandId: CommandId;
  readonly ok: true;
  readonly goalId: GoalId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: WorkflowPhase;
  readonly runStatus: RunStatus;
}

export interface FailedCommandOutput {
  readonly schemaVersion: 1;
  readonly commandId: CommandId;
  readonly ok: false;
  readonly error: CommandError;
}

export interface DeterministicFailedCommandOutput extends FailedCommandOutput {
  readonly error: DeterministicCommandError;
}

export type CommandOutput = SuccessfulCommandOutput | FailedCommandOutput;

export type CommandTarget =
  | { readonly aggregateType: 'GOAL'; readonly aggregateId: GoalId }
  | { readonly aggregateType: 'WORKFLOW'; readonly aggregateId: WorkflowId };

export const StoredCommandDisposition = {
  APPLIED: 'APPLIED',
  REJECTED: 'REJECTED',
} as const;
export type StoredCommandDisposition =
  (typeof StoredCommandDisposition)[keyof typeof StoredCommandDisposition];

export interface StoredWorkflowSnapshot {
  readonly id: WorkflowId;
  readonly version: WorkflowVersion;
  readonly phase: WorkflowPhase;
  readonly runStatus: RunStatus;
}

/**
 * Authority-bearing replay records. Applied and rejected commands are separate
 * variants so a caller cannot attach a failed output to a committed mutation,
 * or a successful output to a recorded rejection.
 */
export interface StoredAppliedCommandOutcomeEnvelope {
  readonly schemaVersion: 3;
  readonly disposition: typeof StoredCommandDisposition.APPLIED;
  readonly target: CommandTarget;
  readonly goalId: GoalId;
  readonly workflow: StoredWorkflowSnapshot;
  readonly output: SuccessfulCommandOutput;
}

export interface StoredRejectedCommandOutcomeEnvelope {
  readonly schemaVersion: 3;
  readonly disposition: typeof StoredCommandDisposition.REJECTED;
  readonly target: CommandTarget;
  readonly goalId: GoalId;
  readonly workflow: StoredWorkflowSnapshot;
  readonly output: DeterministicFailedCommandOutput;
}

export type StoredCommandOutcomeEnvelope =
  StoredAppliedCommandOutcomeEnvelope | StoredRejectedCommandOutcomeEnvelope;

export type RuntimeCommandResult =
  | { readonly status: 'APPLIED'; readonly output: SuccessfulCommandOutput }
  | { readonly status: 'REPLAYED'; readonly output: CommandOutput }
  | { readonly status: 'REJECTED'; readonly output: FailedCommandOutput };

const workflowPhaseSchema = z.enum([
  WorkflowPhase.DISCOVERY,
  WorkflowPhase.PLAN,
  WorkflowPhase.IMPLEMENT,
  WorkflowPhase.SOURCE_FREEZE,
  WorkflowPhase.EVIDENCE_BUILD,
  WorkflowPhase.FINAL_VERIFY,
  WorkflowPhase.CLOSEOUT,
]);
const runStatusSchema = z.enum([
  RunStatus.READY,
  RunStatus.RUNNING,
  RunStatus.WAITING_FOR_INPUT,
  RunStatus.BLOCKED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
  RunStatus.CLOSED,
]);
const runtimeErrorCodeSchema = z.enum([
  RuntimeErrorCode.NOT_FOUND,
  RuntimeErrorCode.DOMAIN_REJECTED,
  RuntimeErrorCode.STALE_GOAL_REVISION,
  RuntimeErrorCode.STALE_WORKFLOW_VERSION,
  RuntimeErrorCode.COMMAND_ID_CONFLICT,
  RuntimeErrorCode.INVALID_STORED_OUTCOME,
  RuntimeErrorCode.EVALUATION_FAILURE,
  RuntimeErrorCode.PERSISTENCE_FAILURE,
  RuntimeErrorCode.INTERNAL_FAILURE,
]);
const deterministicRuntimeErrorCodeSchema = z.enum([
  RuntimeErrorCode.NOT_FOUND,
  RuntimeErrorCode.DOMAIN_REJECTED,
  RuntimeErrorCode.STALE_GOAL_REVISION,
  RuntimeErrorCode.STALE_WORKFLOW_VERSION,
]);
const errorSchema = z
  .object({
    code: runtimeErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    detailCode: z.string().min(1),
  })
  .strict();
const successfulOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: z.string(),
    ok: z.literal(true),
    goalId: z.string(),
    workflowVersion: z.number().int().positive(),
    phase: workflowPhaseSchema,
    runStatus: runStatusSchema,
  })
  .strict();
const failedOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: z.string(),
    ok: z.literal(false),
    error: errorSchema,
  })
  .strict();
const deterministicFailedOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: z.string(),
    ok: z.literal(false),
    error: z
      .object({
        code: deterministicRuntimeErrorCodeSchema,
        message: z.string().min(1),
        retryable: z.boolean(),
        detailCode: z.string().min(1),
      })
      .strict(),
  })
  .strict();
const commandOutputSchema = z.union([successfulOutputSchema, failedOutputSchema]);
const commandTargetSchema = z.discriminatedUnion('aggregateType', [
  z
    .object({
      aggregateType: z.literal('GOAL'),
      aggregateId: z.string(),
    })
    .strict(),
  z
    .object({
      aggregateType: z.literal('WORKFLOW'),
      aggregateId: z.string(),
    })
    .strict(),
]);
const storedWorkflowSnapshotSchema = z
  .object({
    id: z.string(),
    version: z.number().int().positive(),
    phase: workflowPhaseSchema,
    runStatus: runStatusSchema,
  })
  .strict();
const storedAppliedCommandOutcomeEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(3),
    disposition: z.literal(StoredCommandDisposition.APPLIED),
    target: commandTargetSchema,
    goalId: z.string(),
    workflow: storedWorkflowSnapshotSchema,
    output: successfulOutputSchema,
  })
  .strict();
const storedRejectedCommandOutcomeEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(3),
    disposition: z.literal(StoredCommandDisposition.REJECTED),
    target: commandTargetSchema,
    goalId: z.string(),
    workflow: storedWorkflowSnapshotSchema,
    output: deterministicFailedOutputSchema,
  })
  .strict();
const storedCommandOutcomeEnvelopeSchema = z.discriminatedUnion('disposition', [
  storedAppliedCommandOutcomeEnvelopeSchema,
  storedRejectedCommandOutcomeEnvelopeSchema,
]);

function materializeSuccessfulCommandOutput(
  parsed: z.infer<typeof successfulOutputSchema>,
): SuccessfulCommandOutput {
  return Object.freeze({
    ...parsed,
    commandId: commandId(parsed.commandId),
    goalId: goalId(parsed.goalId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
  });
}

function materializeFailedCommandOutput(
  parsed: z.infer<typeof failedOutputSchema>,
): FailedCommandOutput {
  return Object.freeze({
    ...parsed,
    commandId: commandId(parsed.commandId),
    error: Object.freeze(parsed.error),
  });
}

function materializeDeterministicFailedCommandOutput(
  parsed: z.infer<typeof deterministicFailedOutputSchema>,
): DeterministicFailedCommandOutput {
  return Object.freeze({
    ...parsed,
    commandId: commandId(parsed.commandId),
    error: Object.freeze(parsed.error),
  });
}

function materializeCommandOutput(parsed: z.infer<typeof commandOutputSchema>): CommandOutput {
  return parsed.ok
    ? materializeSuccessfulCommandOutput(parsed)
    : materializeFailedCommandOutput(parsed);
}

function targetsEqual(left: CommandTarget, right: CommandTarget): boolean {
  return left.aggregateType === right.aggregateType && left.aggregateId === right.aggregateId;
}

function assertIntrinsicOutcomeBinding(envelope: StoredCommandOutcomeEnvelope): void {
  if (envelope.target.aggregateType === 'GOAL' && envelope.target.aggregateId !== envelope.goalId) {
    throw new TypeError('Stored Goal command outcome targets another Goal');
  }
  if (
    envelope.target.aggregateType === 'WORKFLOW' &&
    envelope.target.aggregateId !== envelope.workflow.id
  ) {
    throw new TypeError('Stored Workflow command outcome targets another Workflow');
  }
  if (envelope.disposition === StoredCommandDisposition.APPLIED) {
    if (envelope.output.goalId !== envelope.goalId) {
      throw new TypeError('Stored successful command output identifies another Goal');
    }
    if (
      envelope.output.workflowVersion !== envelope.workflow.version ||
      envelope.output.phase !== envelope.workflow.phase ||
      envelope.output.runStatus !== envelope.workflow.runStatus
    ) {
      throw new TypeError('Stored successful command output disagrees with its Workflow snapshot');
    }
  }
}

export function decodeCommandOutput(value: JsonValue): CommandOutput {
  return materializeCommandOutput(commandOutputSchema.parse(value));
}

function decodeJsonValueInternal(value: unknown, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError('JSON numbers must be finite and integer values must be safe');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Value is not JSON-compatible');
  }
  if (ancestors.has(value)) {
    throw new TypeError('JSON values cannot contain cycles');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some(
          (key) =>
            typeof key !== 'string' ||
            (key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)),
        )
      ) {
        throw new TypeError('JSON arrays cannot contain named or symbol properties');
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
          throw new TypeError('JSON arrays must be dense data arrays');
        }
        result.push(decodeJsonValueInternal(descriptor.value, ancestors));
      }
      return Object.freeze(result);
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('JSON objects must be plain records');
    }
    const result: Record<string, JsonValue> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw new TypeError('JSON objects cannot contain symbol properties');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('JSON objects must contain enumerable data properties only');
      }
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        value: decodeJsonValueInternal(descriptor.value, ancestors),
        writable: false,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

export function decodeJsonValue(value: unknown): JsonValue {
  return decodeJsonValueInternal(value, new Set<object>());
}

export function decodeCommandTarget(value: unknown): CommandTarget {
  const parsed = commandTargetSchema.parse(value);
  return parsed.aggregateType === 'GOAL'
    ? Object.freeze({
        aggregateType: parsed.aggregateType,
        aggregateId: goalId(parsed.aggregateId),
      })
    : Object.freeze({
        aggregateType: parsed.aggregateType,
        aggregateId: workflowId(parsed.aggregateId),
      });
}

export function decodeDeterministicCommandError(value: unknown): DeterministicCommandError {
  const parsed = deterministicFailedOutputSchema.shape.error.parse(value);
  return Object.freeze(parsed);
}

function storedWorkflowSnapshot(workflow: WorkflowInstance): StoredWorkflowSnapshot {
  return Object.freeze({
    id: workflow.id,
    version: workflow.version,
    phase: workflow.phase,
    runStatus: workflow.runStatus,
  });
}

export function createAppliedStoredCommandOutcome(
  target: CommandTarget,
  workflow: WorkflowInstance,
  commandIdentifier: CommandId,
): StoredAppliedCommandOutcomeEnvelope {
  const validatedWorkflow = decodeWorkflowSnapshot(workflow);
  const validatedTarget = decodeCommandTarget(target);
  const validatedCommandId = commandId(commandIdentifier);
  const envelope = Object.freeze({
    schemaVersion: 3 as const,
    disposition: StoredCommandDisposition.APPLIED,
    target: validatedTarget,
    goalId: validatedWorkflow.goalId,
    workflow: storedWorkflowSnapshot(validatedWorkflow),
    output: Object.freeze({
      schemaVersion: 1 as const,
      commandId: validatedCommandId,
      ok: true as const,
      goalId: validatedWorkflow.goalId,
      workflowVersion: validatedWorkflow.version,
      phase: validatedWorkflow.phase,
      runStatus: validatedWorkflow.runStatus,
    }),
  });
  storedCommandOutcomeEnvelopeSchema.parse(envelope);
  assertIntrinsicOutcomeBinding(envelope);
  return envelope;
}

export function createRejectedStoredCommandOutcome(
  target: CommandTarget,
  workflow: WorkflowInstance,
  commandIdentifier: CommandId,
  error: DeterministicCommandError,
): StoredRejectedCommandOutcomeEnvelope {
  const validatedWorkflow = decodeWorkflowSnapshot(workflow);
  const validatedTarget = decodeCommandTarget(target);
  const validatedCommandId = commandId(commandIdentifier);
  const validatedError = decodeDeterministicCommandError(error);
  const envelope = Object.freeze({
    schemaVersion: 3 as const,
    disposition: StoredCommandDisposition.REJECTED,
    target: validatedTarget,
    goalId: validatedWorkflow.goalId,
    workflow: storedWorkflowSnapshot(validatedWorkflow),
    output: Object.freeze({
      schemaVersion: 1 as const,
      commandId: validatedCommandId,
      ok: false as const,
      error: validatedError,
    }),
  });
  storedCommandOutcomeEnvelopeSchema.parse(envelope);
  assertIntrinsicOutcomeBinding(envelope);
  return envelope;
}

export function decodeStoredCommandOutcome(value: JsonValue): StoredCommandOutcomeEnvelope {
  const parsed = storedCommandOutcomeEnvelopeSchema.parse(value);
  const target: CommandTarget =
    parsed.target.aggregateType === 'GOAL'
      ? Object.freeze({
          aggregateType: parsed.target.aggregateType,
          aggregateId: goalId(parsed.target.aggregateId),
        })
      : Object.freeze({
          aggregateType: parsed.target.aggregateType,
          aggregateId: workflowId(parsed.target.aggregateId),
        });
  const common = {
    schemaVersion: parsed.schemaVersion,
    target,
    goalId: goalId(parsed.goalId),
    workflow: Object.freeze({
      id: workflowId(parsed.workflow.id),
      version: workflowVersion(parsed.workflow.version),
      phase: parsed.workflow.phase,
      runStatus: parsed.workflow.runStatus,
    }),
  };
  const envelope: StoredCommandOutcomeEnvelope =
    parsed.disposition === StoredCommandDisposition.APPLIED
      ? Object.freeze({
          ...common,
          disposition: parsed.disposition,
          output: materializeSuccessfulCommandOutput(parsed.output),
        })
      : Object.freeze({
          ...common,
          disposition: parsed.disposition,
          output: materializeDeterministicFailedCommandOutput(parsed.output),
        });
  assertIntrinsicOutcomeBinding(envelope);
  return envelope;
}

export function assertStoredCommandOutcomeBinding(
  envelope: StoredCommandOutcomeEnvelope,
  expectedCommandId: CommandId,
  expectedTarget: CommandTarget,
  expectedGoalId: GoalId,
  expectedWorkflowId: WorkflowId,
  expectedDisposition?: StoredCommandDisposition,
): void {
  assertIntrinsicOutcomeBinding(envelope);
  if (envelope.output.commandId !== expectedCommandId) {
    throw new TypeError('Stored command outcome identifies another command');
  }
  if (!targetsEqual(envelope.target, expectedTarget)) {
    throw new TypeError('Stored command outcome identifies another aggregate');
  }
  if (envelope.goalId !== expectedGoalId) {
    throw new TypeError('Stored command outcome identifies another owning Goal');
  }
  if (envelope.workflow.id !== expectedWorkflowId) {
    throw new TypeError('Stored command outcome identifies another owning Workflow');
  }
  if (expectedDisposition !== undefined && envelope.disposition !== expectedDisposition) {
    throw new TypeError('Stored command outcome has the wrong command disposition');
  }
}

export function commandOutputToJson(output: CommandOutput): JsonValue {
  if (output.ok) {
    return {
      schemaVersion: output.schemaVersion,
      commandId: output.commandId,
      ok: output.ok,
      goalId: output.goalId,
      workflowVersion: output.workflowVersion,
      phase: output.phase,
      runStatus: output.runStatus,
    };
  }
  return {
    schemaVersion: output.schemaVersion,
    commandId: output.commandId,
    ok: output.ok,
    error: {
      code: output.error.code,
      message: output.error.message,
      retryable: output.error.retryable,
      detailCode: output.error.detailCode,
    },
  };
}

export function storedCommandOutcomeToJson(envelope: StoredCommandOutcomeEnvelope): JsonValue {
  storedCommandOutcomeEnvelopeSchema.parse(envelope);
  assertIntrinsicOutcomeBinding(envelope);
  return {
    schemaVersion: envelope.schemaVersion,
    disposition: envelope.disposition,
    target: {
      aggregateType: envelope.target.aggregateType,
      aggregateId: envelope.target.aggregateId,
    },
    goalId: envelope.goalId,
    workflow: {
      id: envelope.workflow.id,
      version: envelope.workflow.version,
      phase: envelope.workflow.phase,
      runStatus: envelope.workflow.runStatus,
    },
    output: commandOutputToJson(envelope.output),
  };
}
