import { z } from 'zod';

import {
  RunStatus,
  WorkflowPhase,
  commandId,
  goalId,
  workflowVersion,
  type CommandId,
  type GoalId,
  type WorkflowVersion,
} from '@codeclosure/domain';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const RuntimeErrorCode = {
  NOT_FOUND: 'NOT_FOUND',
  DOMAIN_REJECTED: 'DOMAIN_REJECTED',
  STALE_WORKFLOW_VERSION: 'STALE_WORKFLOW_VERSION',
  COMMAND_ID_CONFLICT: 'COMMAND_ID_CONFLICT',
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
  INVALID_STORED_OUTCOME: 'INVALID_STORED_OUTCOME',
  PERSISTENCE_FAILURE: 'PERSISTENCE_FAILURE',
  EFFECT_FAILURE: 'EFFECT_FAILURE',
} as const;
export type RuntimeErrorCode = (typeof RuntimeErrorCode)[keyof typeof RuntimeErrorCode];

export interface CommandError {
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly detailCode: string;
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

export type CommandOutput = SuccessfulCommandOutput | FailedCommandOutput;

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
  RuntimeErrorCode.STALE_WORKFLOW_VERSION,
  RuntimeErrorCode.COMMAND_ID_CONFLICT,
  RuntimeErrorCode.CAPABILITY_DENIED,
  RuntimeErrorCode.INVALID_STORED_OUTCOME,
  RuntimeErrorCode.PERSISTENCE_FAILURE,
  RuntimeErrorCode.EFFECT_FAILURE,
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

export function decodeCommandOutput(value: JsonValue): CommandOutput {
  const parsed = z.union([successfulOutputSchema, failedOutputSchema]).parse(value);
  if (parsed.ok) {
    return Object.freeze({
      ...parsed,
      commandId: commandId(parsed.commandId),
      goalId: goalId(parsed.goalId),
      workflowVersion: workflowVersion(parsed.workflowVersion),
    });
  }
  return Object.freeze({
    ...parsed,
    commandId: commandId(parsed.commandId),
    error: Object.freeze(parsed.error),
  });
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
