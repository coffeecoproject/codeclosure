import { z } from 'zod';

import {
  AttemptFailureClass,
  WorkerResultKind,
  attemptId,
  commandId,
  contextManifestId,
  decodeContextPackage,
  executionProfileId,
  isoTimestamp,
  sha256Digest,
  workerEventId,
  workerSessionId,
  workflowId,
  workflowVersion,
  type AttemptId,
  type ContextManifestId,
  type ContextPackage,
  type ExecutionProfileId,
  type CommandId,
  type IsoTimestamp,
  type Sha256Digest,
  type WorkerEventId,
  type WorkerSessionId,
  type WorkflowId,
  type WorkflowVersion,
} from '@codeclosure/domain';

import { canonicalizeJson } from './canonical-json.js';

export interface WorkerRequest {
  readonly schemaVersion: 2;
  readonly workerSessionId: WorkerSessionId;
  readonly attemptId: AttemptId;
  readonly contextManifestId: ContextManifestId;
  readonly contextManifestDigest: Sha256Digest;
  readonly packageDigest: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly contextPackage: ContextPackage;
}

interface WorkerEventBase {
  readonly schemaVersion: 1;
  readonly id: WorkerEventId;
  readonly workerSessionId: WorkerSessionId;
  readonly attemptId: AttemptId;
  readonly contextManifestId: ContextManifestId;
  readonly contextManifestDigest: Sha256Digest;
  readonly packageDigest: Sha256Digest;
  readonly observedAt: IsoTimestamp;
}

export interface WorkerProposal {
  readonly kind: string;
  readonly summary: string;
  readonly sourceRefs: readonly string[];
}

export interface WorkerProposalsResult {
  readonly kind: typeof WorkerResultKind.PROPOSALS;
  readonly proposals: readonly WorkerProposal[];
}

export interface WorkerCompletionRequestResult {
  readonly kind: typeof WorkerResultKind.COMPLETION_REQUEST;
  readonly claimedScope: string;
  readonly summary: string;
  readonly proposedEvidenceRefs: readonly string[];
}

export type WorkerResult = WorkerProposalsResult | WorkerCompletionRequestResult;

export interface WorkerResultEvent extends WorkerEventBase {
  readonly type: 'WORKER_RESULT';
  readonly result: WorkerResult;
}

export const WorkerFailureReasonCode = {
  BACKEND_FAILURE: 'WORKER_BACKEND_FAILURE',
} as const;
export type WorkerFailureReasonCode =
  (typeof WorkerFailureReasonCode)[keyof typeof WorkerFailureReasonCode];

export const WorkerPortFailureReasonCode = {
  NON_ASYNC_STREAM: 'WORKER_PORT_NON_ASYNC_STREAM',
  INVOCATION_FAILED: 'WORKER_PORT_INVOCATION_FAILED',
  NO_TERMINAL_EVENT: 'WORKER_STREAM_NO_TERMINAL_EVENT',
  NO_ADMITTED_TERMINAL_EVENT: 'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT',
} as const;
export type WorkerPortFailureReasonCode =
  (typeof WorkerPortFailureReasonCode)[keyof typeof WorkerPortFailureReasonCode];

export interface WorkerFailureEvent extends WorkerEventBase {
  readonly type: 'WORKER_FAILURE';
  readonly reasonCode: WorkerFailureReasonCode;
}

export type WorkerEvent = WorkerResultEvent | WorkerFailureEvent;

export const WorkerEventDisposition = {
  ADMITTED: 'ADMITTED',
  IGNORED: 'IGNORED',
} as const;
export type WorkerEventDisposition =
  (typeof WorkerEventDisposition)[keyof typeof WorkerEventDisposition];

export const WorkerEventNonAdmissionClass = {
  UNTRUSTED_DELIVERY: 'UNTRUSTED_DELIVERY',
  CONTROL_PLANE_FAILURE: 'CONTROL_PLANE_FAILURE',
} as const;
export type WorkerEventNonAdmissionClass =
  (typeof WorkerEventNonAdmissionClass)[keyof typeof WorkerEventNonAdmissionClass];

interface WorkerEventReceiptBase {
  readonly schemaVersion: 1;
  readonly eventId: WorkerEventId;
  readonly payloadDigest: Sha256Digest;
  readonly workerSessionId: WorkerSessionId;
  readonly workflowId: WorkflowId;
  readonly observedWorkflowVersion: WorkflowVersion;
  readonly attemptId: AttemptId;
  readonly contextManifestId: ContextManifestId;
  readonly contextManifestDigest: Sha256Digest;
  readonly packageDigest: Sha256Digest;
  readonly receivedAt: IsoTimestamp;
}

export interface AdmittedWorkerEventReceipt extends WorkerEventReceiptBase {
  readonly disposition: typeof WorkerEventDisposition.ADMITTED;
  readonly internalCommandId: CommandId;
  readonly reasonCode?: never;
}

export interface IgnoredWorkerEventReceipt extends WorkerEventReceiptBase {
  readonly disposition: typeof WorkerEventDisposition.IGNORED;
  readonly internalCommandId?: never;
  readonly reasonCode: string;
}

export type WorkerEventReceipt = AdmittedWorkerEventReceipt | IgnoredWorkerEventReceipt;

export interface WorkerDispatchClaim {
  readonly schemaVersion: 2;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly attemptId: AttemptId;
  readonly workerSessionId: WorkerSessionId;
  readonly contextManifestId: ContextManifestId;
  readonly contextManifestDigest: Sha256Digest;
  readonly packageDigest: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly claimedAt: IsoTimestamp;
}

export type WorkerDispatchResult =
  | { readonly status: 'CLAIMED'; readonly claim: WorkerDispatchClaim }
  | { readonly status: 'ALREADY_CLAIMED'; readonly claim: WorkerDispatchClaim }
  | { readonly status: 'NOT_ELIGIBLE'; readonly reasonCode: string }
  | { readonly status: 'FAILED'; readonly reasonCode: string; readonly message: string };

export type WorkerEventAdmissionResult =
  | {
      readonly status: 'ADMITTED';
      readonly eventId: WorkerEventId;
      readonly internalCommandId: CommandId;
      readonly workflowVersion: WorkflowVersion;
    }
  | {
      readonly status: 'DUPLICATE';
      readonly eventId: WorkerEventId;
      readonly originalDisposition: WorkerEventDisposition;
    }
  | {
      readonly status: 'IGNORED';
      readonly eventId: WorkerEventId;
      readonly reasonCode: string;
      readonly receiptRecorded: boolean;
      readonly nonAdmissionClass: WorkerEventNonAdmissionClass;
    }
  | {
      readonly status: 'REJECTED';
      readonly eventId?: WorkerEventId;
      readonly reasonCode: string;
      readonly message: string;
      readonly nonAdmissionClass: WorkerEventNonAdmissionClass;
    };

const WORKER_TEXT_LIMIT_CHARACTERS = 65_536;
const WORKER_COLLECTION_LIMIT = 128;
const nonBlankStringSchema = z
  .string()
  .max(WORKER_TEXT_LIMIT_CHARACTERS)
  .refine((value) => value.trim().length > 0, {
    error: 'String must not be blank',
  });

const workerFailureReasonCodeSchema = z.enum(Object.values(WorkerFailureReasonCode));
const workerPortFailureReasonCodeSchema = z.enum(Object.values(WorkerPortFailureReasonCode));

const workerRequestSchema = z
  .object({
    schemaVersion: z.literal(2),
    workerSessionId: z.string(),
    attemptId: z.string(),
    contextManifestId: z.string(),
    contextManifestDigest: z.string(),
    packageDigest: z.string(),
    executionProfileId: z.string(),
    executionProfileDigest: z.string(),
    contextPackage: z.unknown(),
  })
  .strict();

const workerEventBaseSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  workerSessionId: z.string(),
  attemptId: z.string(),
  contextManifestId: z.string(),
  contextManifestDigest: z.string(),
  packageDigest: z.string(),
  observedAt: z.string(),
});

const workerProposalSchema = z
  .object({
    kind: nonBlankStringSchema,
    summary: nonBlankStringSchema,
    sourceRefs: z.array(nonBlankStringSchema).max(WORKER_COLLECTION_LIMIT),
  })
  .strict();

const workerResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal(WorkerResultKind.PROPOSALS),
      proposals: z.array(workerProposalSchema).max(WORKER_COLLECTION_LIMIT),
    })
    .strict(),
  z
    .object({
      kind: z.literal(WorkerResultKind.COMPLETION_REQUEST),
      claimedScope: nonBlankStringSchema,
      summary: nonBlankStringSchema,
      proposedEvidenceRefs: z.array(nonBlankStringSchema).max(WORKER_COLLECTION_LIMIT),
    })
    .strict(),
]);

const workerEventSchema = z.discriminatedUnion('type', [
  workerEventBaseSchema
    .extend({
      type: z.literal('WORKER_RESULT'),
      result: workerResultSchema,
    })
    .strict(),
  workerEventBaseSchema
    .extend({
      type: z.literal('WORKER_FAILURE'),
      reasonCode: workerFailureReasonCodeSchema,
    })
    .strict(),
]);

const workerEventReceiptSchema = z.discriminatedUnion('disposition', [
  z
    .object({
      schemaVersion: z.literal(1),
      eventId: z.string(),
      payloadDigest: z.string(),
      workerSessionId: z.string(),
      workflowId: z.string(),
      observedWorkflowVersion: z.number().int().positive(),
      attemptId: z.string(),
      contextManifestId: z.string(),
      contextManifestDigest: z.string(),
      packageDigest: z.string(),
      receivedAt: z.string(),
      disposition: z.literal(WorkerEventDisposition.ADMITTED),
      internalCommandId: z.string(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      eventId: z.string(),
      payloadDigest: z.string(),
      workerSessionId: z.string(),
      workflowId: z.string(),
      observedWorkflowVersion: z.number().int().positive(),
      attemptId: z.string(),
      contextManifestId: z.string(),
      contextManifestDigest: z.string(),
      packageDigest: z.string(),
      receivedAt: z.string(),
      disposition: z.literal(WorkerEventDisposition.IGNORED),
      reasonCode: nonBlankStringSchema,
    })
    .strict(),
]);

const workerDispatchClaimSchema = z
  .object({
    schemaVersion: z.literal(2),
    workflowId: z.string(),
    workflowVersion: z.number().int().positive(),
    attemptId: z.string(),
    workerSessionId: z.string(),
    contextManifestId: z.string(),
    contextManifestDigest: z.string(),
    packageDigest: z.string(),
    executionProfileId: z.string(),
    executionProfileDigest: z.string(),
    claimedAt: z.string(),
  })
  .strict();

export function decodeWorkerRequest(value: unknown): WorkerRequest {
  const parsed = workerRequestSchema.parse(value);
  const contextPackage = decodeContextPackage(parsed.contextPackage);
  const request: WorkerRequest = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    workerSessionId: workerSessionId(parsed.workerSessionId),
    attemptId: attemptId(parsed.attemptId),
    contextManifestId: contextManifestId(parsed.contextManifestId),
    contextManifestDigest: sha256Digest(parsed.contextManifestDigest),
    packageDigest: sha256Digest(parsed.packageDigest),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    contextPackage,
  });
  if (
    request.attemptId !== contextPackage.attemptId ||
    request.executionProfileId !== contextPackage.executionProfileId ||
    request.executionProfileDigest !== contextPackage.executionProfileDigest
  ) {
    throw new TypeError('Worker Request identity is internally inconsistent');
  }
  return request;
}

function materializeWorkerResult(parsed: z.infer<typeof workerResultSchema>): WorkerResult {
  return parsed.kind === WorkerResultKind.PROPOSALS
    ? Object.freeze({
        kind: parsed.kind,
        proposals: Object.freeze(
          parsed.proposals.map((proposal) =>
            Object.freeze({
              ...proposal,
              sourceRefs: Object.freeze([...proposal.sourceRefs]),
            }),
          ),
        ),
      })
    : Object.freeze({
        kind: parsed.kind,
        claimedScope: parsed.claimedScope,
        summary: parsed.summary,
        proposedEvidenceRefs: Object.freeze([...parsed.proposedEvidenceRefs]),
      });
}

export function decodeWorkerEvent(value: unknown): WorkerEvent {
  const parsed = workerEventSchema.parse(value);
  const common = {
    schemaVersion: parsed.schemaVersion,
    id: workerEventId(parsed.id),
    workerSessionId: workerSessionId(parsed.workerSessionId),
    attemptId: attemptId(parsed.attemptId),
    contextManifestId: contextManifestId(parsed.contextManifestId),
    contextManifestDigest: sha256Digest(parsed.contextManifestDigest),
    packageDigest: sha256Digest(parsed.packageDigest),
    observedAt: isoTimestamp(parsed.observedAt),
  };
  return parsed.type === 'WORKER_RESULT'
    ? Object.freeze({
        ...common,
        type: parsed.type,
        result: materializeWorkerResult(parsed.result),
      })
    : Object.freeze({
        ...common,
        type: parsed.type,
        reasonCode: parsed.reasonCode,
      });
}

export function workerPortFailureReasonCode(value: unknown): WorkerPortFailureReasonCode {
  return workerPortFailureReasonCodeSchema.parse(value);
}

export function attemptFailureClassForWorkerReasonCode(
  rawReasonCode: WorkerFailureReasonCode,
): AttemptFailureClass {
  const reasonCode = workerFailureReasonCodeSchema.parse(rawReasonCode);
  const failureClass = attemptFailureClassForKnownWorkerReasonCode(reasonCode);
  if (failureClass === undefined) {
    throw new TypeError(`Worker failure reason ${reasonCode} has no authoritative classification`);
  }
  return failureClass;
}

export function attemptFailureClassForWorkerPortReasonCode(
  rawReasonCode: WorkerPortFailureReasonCode,
): AttemptFailureClass {
  const reasonCode = workerPortFailureReasonCodeSchema.parse(rawReasonCode);
  const failureClass = attemptFailureClassForKnownWorkerReasonCode(reasonCode);
  if (failureClass === undefined) {
    throw new TypeError(`Worker port reason ${reasonCode} has no authoritative classification`);
  }
  return failureClass;
}

export function attemptFailureClassForKnownWorkerReasonCode(
  reasonCode: string,
): AttemptFailureClass | undefined {
  switch (reasonCode) {
    case WorkerFailureReasonCode.BACKEND_FAILURE:
      return AttemptFailureClass.TRANSIENT_BACKEND;
    case WorkerPortFailureReasonCode.INVOCATION_FAILED:
      return AttemptFailureClass.ABRUPT_TERMINATION;
    case WorkerPortFailureReasonCode.NON_ASYNC_STREAM:
    case WorkerPortFailureReasonCode.NO_TERMINAL_EVENT:
    case WorkerPortFailureReasonCode.NO_ADMITTED_TERMINAL_EVENT:
      return AttemptFailureClass.PROTOCOL_ERROR;
    default:
      return undefined;
  }
}

export function assertWorkerEventWithinResponseContract(
  event: WorkerEvent,
  request: WorkerRequest,
): void {
  const encodedBytes = Buffer.byteLength(canonicalizeJson(event), 'utf8');
  if (encodedBytes > request.contextPackage.responseContract.maxEventBytes) {
    throw new TypeError('Worker Event exceeds the bound response contract');
  }
}

export function decodeWorkerEventReceipt(value: unknown): WorkerEventReceipt {
  const parsed = workerEventReceiptSchema.parse(value);
  const common = {
    schemaVersion: parsed.schemaVersion,
    eventId: workerEventId(parsed.eventId),
    payloadDigest: sha256Digest(parsed.payloadDigest),
    workerSessionId: workerSessionId(parsed.workerSessionId),
    workflowId: workflowId(parsed.workflowId),
    observedWorkflowVersion: workflowVersion(parsed.observedWorkflowVersion),
    attemptId: attemptId(parsed.attemptId),
    contextManifestId: contextManifestId(parsed.contextManifestId),
    contextManifestDigest: sha256Digest(parsed.contextManifestDigest),
    packageDigest: sha256Digest(parsed.packageDigest),
    receivedAt: isoTimestamp(parsed.receivedAt),
  };
  return parsed.disposition === WorkerEventDisposition.ADMITTED
    ? Object.freeze({
        ...common,
        disposition: parsed.disposition,
        internalCommandId: commandId(parsed.internalCommandId),
      })
    : Object.freeze({
        ...common,
        disposition: parsed.disposition,
        reasonCode: parsed.reasonCode,
      });
}

export function decodeWorkerDispatchClaim(value: unknown): WorkerDispatchClaim {
  const parsed = workerDispatchClaimSchema.parse(value);
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    attemptId: attemptId(parsed.attemptId),
    workerSessionId: workerSessionId(parsed.workerSessionId),
    contextManifestId: contextManifestId(parsed.contextManifestId),
    contextManifestDigest: sha256Digest(parsed.contextManifestDigest),
    packageDigest: sha256Digest(parsed.packageDigest),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    claimedAt: isoTimestamp(parsed.claimedAt),
  });
}

export function workerDispatchClaimProjection(claim: WorkerDispatchClaim): unknown {
  const decoded = decodeWorkerDispatchClaim(claim);
  return {
    schemaVersion: decoded.schemaVersion,
    workflowId: decoded.workflowId,
    workflowVersion: decoded.workflowVersion,
    attemptId: decoded.attemptId,
    workerSessionId: decoded.workerSessionId,
    contextManifestId: decoded.contextManifestId,
    contextManifestDigest: decoded.contextManifestDigest,
    packageDigest: decoded.packageDigest,
    executionProfileId: decoded.executionProfileId,
    executionProfileDigest: decoded.executionProfileDigest,
    claimedAt: decoded.claimedAt,
  };
}

export function assertWorkerEventBindsRequest(event: WorkerEvent, request: WorkerRequest): void {
  if (
    event.workerSessionId !== request.workerSessionId ||
    event.attemptId !== request.attemptId ||
    event.contextManifestId !== request.contextManifestId ||
    event.contextManifestDigest !== request.contextManifestDigest ||
    event.packageDigest !== request.packageDigest
  ) {
    throw new TypeError('Worker Event does not bind the dispatched Worker Request');
  }
  if (
    event.type === 'WORKER_RESULT' &&
    !request.contextPackage.responseContract.allowedResultKinds.includes(event.result.kind)
  ) {
    throw new TypeError('Worker Event result kind is not allowed by the response contract');
  }
}

export function assertWorkerDispatchClaimBindsRequest(
  claim: WorkerDispatchClaim,
  request: WorkerRequest,
): void {
  if (
    claim.workflowId !== request.contextPackage.workflowId ||
    claim.workflowVersion !== request.contextPackage.workflowVersion ||
    claim.attemptId !== request.attemptId ||
    claim.workerSessionId !== request.workerSessionId ||
    claim.contextManifestId !== request.contextManifestId ||
    claim.contextManifestDigest !== request.contextManifestDigest ||
    claim.packageDigest !== request.packageDigest ||
    claim.executionProfileId !== request.executionProfileId ||
    claim.executionProfileDigest !== request.executionProfileDigest
  ) {
    throw new TypeError('Worker dispatch claim does not bind the Worker Request');
  }
}

export function createWorkerRequest(
  workerSessionIdentifier: WorkerSessionId,
  contextManifestIdentifier: ContextManifestId,
  contextManifestDigest: Sha256Digest,
  packageDigest: Sha256Digest,
  contextPackage: ContextPackage,
): WorkerRequest {
  return decodeWorkerRequest({
    schemaVersion: 2,
    workerSessionId: workerSessionIdentifier,
    attemptId: contextPackage.attemptId,
    contextManifestId: contextManifestIdentifier,
    contextManifestDigest,
    packageDigest,
    executionProfileId: contextPackage.executionProfileId,
    executionProfileDigest: contextPackage.executionProfileDigest,
    contextPackage,
  });
}
