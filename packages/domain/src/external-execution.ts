import {
  attemptId,
  contextManifestId,
  executionProfileId,
  externalExecutionId,
  externalExecutionObservationId,
  externalMaintenanceIntentId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  workerEventId,
  workerSessionId,
  workflowId,
  workflowVersion,
  type AttemptId,
  type ContextManifestId,
  type ExecutionProfileId,
  type ExternalExecutionId,
  type ExternalExecutionObservationId,
  type ExternalMaintenanceIntentId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type PolicyBundleId,
  type Sha256Digest,
  type WorkerEventId,
  type WorkerSessionId,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import { WorkflowPhase, type WorkflowPhase as WorkflowPhaseType } from './model.js';

export const ExternalBackendCapability = {
  FRESH_SESSION: 'FRESH_SESSION',
  EXACT_SESSION_RESUME: 'EXACT_SESSION_RESUME',
  SAME_SESSION_BOUNDED_OPERATION: 'SAME_SESSION_BOUNDED_OPERATION',
  MANUAL_COMPACTION: 'MANUAL_COMPACTION',
  POST_COMPACTION_CONTINUATION: 'POST_COMPACTION_CONTINUATION',
  OPERATION_INTERRUPT: 'OPERATION_INTERRUPT',
  CONTROLLED_STATE_REOPEN: 'CONTROLLED_STATE_REOPEN',
} as const;
export type ExternalBackendCapability =
  (typeof ExternalBackendCapability)[keyof typeof ExternalBackendCapability];

export const ExternalBackendCapabilityClassification = {
  SUPPORTED: 'SUPPORTED',
  UNSUPPORTED: 'UNSUPPORTED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ExternalBackendCapabilityClassification =
  (typeof ExternalBackendCapabilityClassification)[keyof typeof ExternalBackendCapabilityClassification];

export interface ExternalBackendCapabilityEntry {
  readonly capability: ExternalBackendCapability;
  readonly classification: ExternalBackendCapabilityClassification;
  readonly proofKind: string;
  readonly proofDigest?: Sha256Digest;
}

export interface ExternalBackendCapabilityRecord {
  readonly schemaVersion: 1;
  readonly backendKind: string;
  readonly binaryIdentityDigest: Sha256Digest;
  readonly protocolSchemaDigest: Sha256Digest;
  readonly configurationProfileDigest: Sha256Digest;
  readonly capabilityEntries: readonly ExternalBackendCapabilityEntry[];
  readonly observedAt: IsoTimestamp;
  readonly recordDigest: Sha256Digest;
}

export const ExternalThreadPolicy = {
  FRESH: 'FRESH',
  RESUME_EXACT: 'RESUME_EXACT',
} as const;
export type ExternalThreadPolicy = (typeof ExternalThreadPolicy)[keyof typeof ExternalThreadPolicy];

export type ExternalThreadDirective =
  | Readonly<{ readonly kind: typeof ExternalThreadPolicy.FRESH }>
  | Readonly<{
      readonly kind: typeof ExternalThreadPolicy.RESUME_EXACT;
      readonly backendSessionRef: string;
      readonly resumeBindingDigest: Sha256Digest;
    }>;

export const ExternalContinuityPolicy = {
  SAME_SESSION_BOUNDED_OPERATION: 'SAME_SESSION_BOUNDED_OPERATION',
} as const;
export type ExternalContinuityPolicy =
  (typeof ExternalContinuityPolicy)[keyof typeof ExternalContinuityPolicy];

export const ExternalCompactionPolicy = {
  FAIL_ON_OBSERVATION: 'FAIL_ON_OBSERVATION',
  MANUAL_BEFORE_OPERATION: 'MANUAL_BEFORE_OPERATION',
} as const;
export type ExternalCompactionPolicy =
  (typeof ExternalCompactionPolicy)[keyof typeof ExternalCompactionPolicy];

export const ExternalRetentionPolicy = {
  CONTROLLED: 'CONTROLLED',
} as const;
export type ExternalRetentionPolicy =
  (typeof ExternalRetentionPolicy)[keyof typeof ExternalRetentionPolicy];

export const ExternalFallbackPolicy = {
  FAIL_CLOSED: 'FAIL_CLOSED',
} as const;
export type ExternalFallbackPolicy =
  (typeof ExternalFallbackPolicy)[keyof typeof ExternalFallbackPolicy];

export const ExternalInterruptionPolicy = {
  INTERRUPT_OPERATION: 'INTERRUPT_OPERATION',
} as const;
export type ExternalInterruptionPolicy =
  (typeof ExternalInterruptionPolicy)[keyof typeof ExternalInterruptionPolicy];

export const ExternalWorkerDispatchPolicy = {
  ALL_SELECTED_ATTEMPTS: 'ALL_SELECTED_ATTEMPTS',
  ACCEPTANCE_REPAIR_ONLY: 'ACCEPTANCE_REPAIR_ONLY',
} as const;
export type ExternalWorkerDispatchPolicy =
  (typeof ExternalWorkerDispatchPolicy)[keyof typeof ExternalWorkerDispatchPolicy];

/**
 * Non-secret, canonical external-execution portion of Execution Profile v2.
 * Values are backend-neutral identities and policies; no process handle,
 * credential, Codex DTO, or function belongs in this record.
 */
interface ExternalExecutionProfileDefinitionBase {
  readonly backendKind: string;
  readonly capabilityRecordDigest: Sha256Digest;
  readonly selectedCapabilities: readonly ExternalBackendCapability[];
  readonly workerPhases: readonly WorkflowPhaseType[];
  readonly binaryIdentityDigest: Sha256Digest;
  readonly protocolSchemaDigest: Sha256Digest;
  readonly configurationProfileDigest: Sha256Digest;
  readonly executionConfigDigest: Sha256Digest;
  readonly managedRequirementsDigest: Sha256Digest;
  readonly instructionSourceManifestDigest: Sha256Digest;
  readonly controlledStateRootIdentity: string;
  readonly environmentProjectionDigest: Sha256Digest;
  readonly permissionProfileId: string;
  readonly permissionProfileDigest: Sha256Digest;
  readonly model: string;
  readonly modelProvider: string;
  readonly serviceTier: string | null;
  readonly reasoningEffort: string;
  readonly responseSchemaPolicy: string;
  readonly disabledIntegrationsDigest: Sha256Digest;
  readonly defaultThreadPolicy: typeof ExternalThreadPolicy.FRESH;
  readonly continuityPolicy: ExternalContinuityPolicy;
  readonly compactionPolicy: ExternalCompactionPolicy;
  readonly retentionPolicy: ExternalRetentionPolicy;
  readonly fallbackPolicy: ExternalFallbackPolicy;
  readonly interruptionPolicy: ExternalInterruptionPolicy;
}

/** Original Slice 6 meaning: every selected phase Attempt uses the external Worker. */
export interface ExternalExecutionProfileDefinitionV1 extends ExternalExecutionProfileDefinitionBase {
  readonly schemaVersion: 1;
}

/** Slice 7 adds a profile-bound repair-only handoff without adapter discretion. */
export interface ExternalExecutionProfileDefinitionV2 extends ExternalExecutionProfileDefinitionBase {
  readonly schemaVersion: 2;
  readonly workerDispatchPolicy: ExternalWorkerDispatchPolicy;
}

export type ExternalExecutionProfileDefinition =
  ExternalExecutionProfileDefinitionV1 | ExternalExecutionProfileDefinitionV2;

export const ExternalExecutionState = {
  AUTHORIZED: 'AUTHORIZED',
  PROCESS_OBSERVED: 'PROCESS_OBSERVED',
  SESSION_OBSERVED: 'SESSION_OBSERVED',
  OPERATION_RUNNING: 'OPERATION_RUNNING',
  COMPLETED: 'COMPLETED',
  INTERRUPTED: 'INTERRUPTED',
  FAILED: 'FAILED',
  ABANDONED: 'ABANDONED',
} as const;
export type ExternalExecutionState =
  (typeof ExternalExecutionState)[keyof typeof ExternalExecutionState];

export const ExternalProcessGroupKind = {
  POSIX_PROCESS_GROUP: 'POSIX_PROCESS_GROUP',
  WINDOWS_PROCESS: 'WINDOWS_PROCESS',
} as const;
export type ExternalProcessGroupKind =
  (typeof ExternalProcessGroupKind)[keyof typeof ExternalProcessGroupKind];

/**
 * Protocol-neutral identity for one Runtime-authorized external process.
 * The launch nonce is issued before spawn; the remaining fields are admitted
 * only after the host confirms the process start.
 */
export interface ExternalProcessIdentity {
  readonly schemaVersion: 1;
  readonly launchNonce: Sha256Digest;
  readonly processId: number;
  readonly processGroupId: number;
  readonly processGroupKind: ExternalProcessGroupKind;
  readonly processStartIdentity: string;
  readonly executableIdentityDigest: Sha256Digest;
  readonly controlledStateRootIdentity: string;
  readonly identityDigest: Sha256Digest;
}

export const ExternalMaintenanceKind = {
  WORKING_CONTEXT_COMPACTION: 'WORKING_CONTEXT_COMPACTION',
} as const;
export type ExternalMaintenanceKind =
  (typeof ExternalMaintenanceKind)[keyof typeof ExternalMaintenanceKind];

export const ExternalMaintenanceState = {
  AUTHORIZED: 'AUTHORIZED',
  OBSERVED: 'OBSERVED',
  FAILED: 'FAILED',
  ABANDONED: 'ABANDONED',
} as const;
export type ExternalMaintenanceState =
  (typeof ExternalMaintenanceState)[keyof typeof ExternalMaintenanceState];

export interface ExternalExecutionIntent {
  readonly schemaVersion: 1;
  readonly id: ExternalExecutionId;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersionAtAuthorization: WorkflowVersion;
  readonly phase: WorkflowPhaseType;
  readonly phaseVersion: WorkflowVersion;
  readonly attemptId: AttemptId;
  readonly workerSessionId: WorkerSessionId;
  readonly dispatchClaimDigest: Sha256Digest;
  readonly contextManifestId: ContextManifestId;
  readonly contextManifestDigest: Sha256Digest;
  readonly contextPackageDigest: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly backendKind: string;
  readonly binaryIdentityDigest: Sha256Digest;
  readonly binaryProtocolSchemaDigest: Sha256Digest;
  readonly executionConfigDigest: Sha256Digest;
  readonly managedRequirementsDigest: Sha256Digest;
  readonly instructionSourceManifestDigest: Sha256Digest;
  readonly controlledStateRootIdentity: string;
  readonly processLaunchNonce: Sha256Digest;
  readonly thread: ExternalThreadDirective;
  readonly continuityPolicy: ExternalContinuityPolicy;
  readonly compactionPolicy: ExternalCompactionPolicy;
  readonly retentionPolicy: ExternalRetentionPolicy;
  readonly fallbackPolicy: ExternalFallbackPolicy;
  readonly interruptionPolicy: ExternalInterruptionPolicy;
  readonly candidateWorkspaceLeaseId?: string;
  readonly candidateWorkspaceLeaseDigest?: Sha256Digest;
  readonly candidateWorkspaceCwdIdentity?: string;
  readonly authorizedAt: IsoTimestamp;
  readonly intentDigest: Sha256Digest;
}

export interface ExternalExecutionRecord extends ExternalExecutionIntent {
  readonly version: number;
  readonly state: ExternalExecutionState;
  readonly processIdentity?: ExternalProcessIdentity;
  readonly backendSessionRef?: string;
  readonly backendOperationRef?: string;
  readonly compactionCount: number;
  readonly turnInterruptCount: number;
  readonly failureCode?: string;
  readonly resultEventId?: WorkerEventId;
  readonly updatedAt: IsoTimestamp;
  readonly terminalAt?: IsoTimestamp;
  readonly lastObservationId?: ExternalExecutionObservationId;
  readonly auditSequence: number;
  readonly recordDigest: Sha256Digest;
}

export interface ExternalExecutionObservation {
  readonly schemaVersion: 1;
  readonly id: ExternalExecutionObservationId;
  readonly externalExecutionId: ExternalExecutionId;
  readonly intentDigest: Sha256Digest;
  readonly expectedRecordVersion: number;
  readonly state: Exclude<ExternalExecutionState, 'AUTHORIZED' | 'ABANDONED'>;
  readonly processIdentity?: ExternalProcessIdentity;
  readonly backendSessionRef?: string;
  readonly backendOperationRef?: string;
  readonly compactionCount: number;
  readonly turnInterruptCount: number;
  readonly failureCode?: string;
  readonly resultEventId?: WorkerEventId;
  readonly observedAt: IsoTimestamp;
  readonly observationDigest: Sha256Digest;
}

export interface ExternalMaintenanceIntent {
  readonly schemaVersion: 1;
  readonly id: ExternalMaintenanceIntentId;
  readonly externalExecutionId: ExternalExecutionId;
  readonly sequence: number;
  readonly kind: typeof ExternalMaintenanceKind.WORKING_CONTEXT_COMPACTION;
  readonly state: ExternalMaintenanceState;
  readonly authorizedAt: IsoTimestamp;
  readonly observedAt?: IsoTimestamp;
  readonly failureCode?: string;
  readonly intentDigest: Sha256Digest;
  readonly recordDigest: Sha256Digest;
}

function known<Value extends string>(
  values: Readonly<Record<string, Value>>,
  value: unknown,
): value is Value {
  return Object.values(values).some((candidate) => candidate === value);
}

function rawField(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

function nonBlank(value: string, name: string, maximum = 4_096): void {
  if (
    value.trim().length === 0 ||
    value.includes('\u0000') ||
    Buffer.byteLength(value, 'utf8') > maximum
  ) {
    throw new TypeError(`${name} must be a bounded non-blank string`);
  }
}

function positive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function nonNegative(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function terminalState(state: ExternalExecutionState): boolean {
  return (
    state === ExternalExecutionState.COMPLETED ||
    state === ExternalExecutionState.INTERRUPTED ||
    state === ExternalExecutionState.FAILED ||
    state === ExternalExecutionState.ABANDONED
  );
}

export function externalBackendCapabilityRecordProjection(
  record: Omit<ExternalBackendCapabilityRecord, 'recordDigest'>,
): unknown {
  return {
    schemaVersion: record.schemaVersion,
    backendKind: record.backendKind,
    binaryIdentityDigest: record.binaryIdentityDigest,
    protocolSchemaDigest: record.protocolSchemaDigest,
    configurationProfileDigest: record.configurationProfileDigest,
    capabilityEntries: record.capabilityEntries,
    observedAt: record.observedAt,
  };
}

export function assertExternalBackendCapabilityRecordInvariant(
  record: ExternalBackendCapabilityRecord,
): void {
  if (rawField(record, 'schemaVersion') !== 1) {
    throw new TypeError('External backend capability schema is unsupported');
  }
  nonBlank(record.backendKind, 'External backend kind');
  sha256Digest(record.binaryIdentityDigest);
  sha256Digest(record.protocolSchemaDigest);
  sha256Digest(record.configurationProfileDigest);
  let previous: string | undefined;
  for (const entry of record.capabilityEntries) {
    if (
      !known(ExternalBackendCapability, entry.capability) ||
      !known(ExternalBackendCapabilityClassification, entry.classification)
    ) {
      throw new TypeError('External backend capability entry is unknown');
    }
    if (previous !== undefined && entry.capability <= previous) {
      throw new TypeError('External backend capabilities must be uniquely sorted');
    }
    previous = entry.capability;
    nonBlank(entry.proofKind, 'External backend capability proof kind');
    if (entry.proofDigest !== undefined) {
      sha256Digest(entry.proofDigest);
    }
  }
  if (record.capabilityEntries.length === 0) {
    throw new TypeError('External backend capability record cannot be empty');
  }
  isoTimestamp(record.observedAt);
  sha256Digest(record.recordDigest);
}

export function assertExternalExecutionProfileDefinitionInvariant(
  profile: ExternalExecutionProfileDefinition,
): void {
  if (rawField(profile, 'schemaVersion') !== 1 && rawField(profile, 'schemaVersion') !== 2) {
    throw new TypeError('External Execution Profile definition schema is unsupported');
  }
  nonBlank(profile.backendKind, 'External backend kind');
  for (const digest of [
    profile.capabilityRecordDigest,
    profile.binaryIdentityDigest,
    profile.protocolSchemaDigest,
    profile.configurationProfileDigest,
    profile.executionConfigDigest,
    profile.managedRequirementsDigest,
    profile.instructionSourceManifestDigest,
    profile.environmentProjectionDigest,
    profile.permissionProfileDigest,
    profile.disabledIntegrationsDigest,
  ]) {
    sha256Digest(digest);
  }
  if (profile.selectedCapabilities.length === 0) {
    throw new TypeError('External Execution Profile must select capabilities');
  }
  if (profile.workerPhases.length === 0) {
    throw new TypeError('External Execution Profile must select Worker-backed phases');
  }
  if (
    profile.schemaVersion === 2 &&
    (!known(ExternalWorkerDispatchPolicy, profile.workerDispatchPolicy) ||
      (profile.workerDispatchPolicy === ExternalWorkerDispatchPolicy.ACCEPTANCE_REPAIR_ONLY &&
        (profile.workerPhases.length !== 1 || profile.workerPhases[0] !== WorkflowPhase.IMPLEMENT)))
  ) {
    throw new TypeError('External Worker dispatch policy is invalid for the selected phases');
  }
  let previousPhase: string | undefined;
  for (const phase of profile.workerPhases) {
    if (
      phase !== WorkflowPhase.DISCOVERY &&
      phase !== WorkflowPhase.PLAN &&
      phase !== WorkflowPhase.IMPLEMENT
    ) {
      throw new TypeError('External Execution Profile selected a non-Worker phase');
    }
    if (previousPhase !== undefined && phase <= previousPhase) {
      throw new TypeError('External Worker phases must be uniquely sorted');
    }
    previousPhase = phase;
  }
  let previous: string | undefined;
  for (const capability of profile.selectedCapabilities) {
    if (!known(ExternalBackendCapability, capability)) {
      throw new TypeError('External Execution Profile selected an unknown capability');
    }
    if (previous !== undefined && capability <= previous) {
      throw new TypeError('External Execution Profile capabilities must be uniquely sorted');
    }
    previous = capability;
  }
  const requiredCapabilities = [
    ExternalBackendCapability.FRESH_SESSION,
    ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
    ExternalBackendCapability.OPERATION_INTERRUPT,
    ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
    ...(profile.compactionPolicy === ExternalCompactionPolicy.MANUAL_BEFORE_OPERATION
      ? [
          ExternalBackendCapability.MANUAL_COMPACTION,
          ExternalBackendCapability.POST_COMPACTION_CONTINUATION,
        ]
      : []),
  ];
  if (
    requiredCapabilities.some((capability) => !profile.selectedCapabilities.includes(capability))
  ) {
    throw new TypeError('External Execution Profile lacks a capability required by its policy');
  }
  for (const [value, name] of [
    [profile.controlledStateRootIdentity, 'controlled state root'],
    [profile.permissionProfileId, 'permission profile ID'],
    [profile.model, 'model'],
    [profile.modelProvider, 'model provider'],
    [profile.reasoningEffort, 'reasoning effort'],
    [profile.responseSchemaPolicy, 'response schema policy'],
  ] as const) {
    nonBlank(value, `External ${name}`);
  }
  if (profile.serviceTier !== null) {
    nonBlank(profile.serviceTier, 'External service tier');
  }
  if (
    rawField(profile, 'defaultThreadPolicy') !== ExternalThreadPolicy.FRESH ||
    !known(ExternalContinuityPolicy, profile.continuityPolicy) ||
    !known(ExternalCompactionPolicy, profile.compactionPolicy) ||
    !known(ExternalRetentionPolicy, profile.retentionPolicy) ||
    !known(ExternalFallbackPolicy, profile.fallbackPolicy) ||
    !known(ExternalInterruptionPolicy, profile.interruptionPolicy)
  ) {
    throw new TypeError('External Execution Profile policy is unknown');
  }
}

export function externalExecutionIntentProjection(
  intent: Omit<ExternalExecutionIntent, 'intentDigest'>,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: intent.schemaVersion,
    id: intent.id,
    goalId: intent.goalId,
    goalRevision: intent.goalRevision,
    workflowId: intent.workflowId,
    workflowVersionAtAuthorization: intent.workflowVersionAtAuthorization,
    phase: intent.phase,
    phaseVersion: intent.phaseVersion,
    attemptId: intent.attemptId,
    workerSessionId: intent.workerSessionId,
    dispatchClaimDigest: intent.dispatchClaimDigest,
    contextManifestId: intent.contextManifestId,
    contextManifestDigest: intent.contextManifestDigest,
    contextPackageDigest: intent.contextPackageDigest,
    executionProfileId: intent.executionProfileId,
    executionProfileDigest: intent.executionProfileDigest,
    policyBundleId: intent.policyBundleId,
    policyBundleDigest: intent.policyBundleDigest,
    backendKind: intent.backendKind,
    binaryIdentityDigest: intent.binaryIdentityDigest,
    binaryProtocolSchemaDigest: intent.binaryProtocolSchemaDigest,
    executionConfigDigest: intent.executionConfigDigest,
    managedRequirementsDigest: intent.managedRequirementsDigest,
    instructionSourceManifestDigest: intent.instructionSourceManifestDigest,
    controlledStateRootIdentity: intent.controlledStateRootIdentity,
    processLaunchNonce: intent.processLaunchNonce,
    thread: intent.thread,
    continuityPolicy: intent.continuityPolicy,
    compactionPolicy: intent.compactionPolicy,
    retentionPolicy: intent.retentionPolicy,
    fallbackPolicy: intent.fallbackPolicy,
    interruptionPolicy: intent.interruptionPolicy,
    ...(intent.candidateWorkspaceLeaseId === undefined
      ? {}
      : { candidateWorkspaceLeaseId: intent.candidateWorkspaceLeaseId }),
    ...(intent.candidateWorkspaceLeaseDigest === undefined
      ? {}
      : { candidateWorkspaceLeaseDigest: intent.candidateWorkspaceLeaseDigest }),
    ...(intent.candidateWorkspaceCwdIdentity === undefined
      ? {}
      : { candidateWorkspaceCwdIdentity: intent.candidateWorkspaceCwdIdentity }),
    authorizedAt: intent.authorizedAt,
  };
}

export function externalProcessIdentityProjection(
  identity: Omit<ExternalProcessIdentity, 'identityDigest'>,
): unknown {
  return {
    schemaVersion: identity.schemaVersion,
    launchNonce: identity.launchNonce,
    processId: identity.processId,
    processGroupId: identity.processGroupId,
    processGroupKind: identity.processGroupKind,
    processStartIdentity: identity.processStartIdentity,
    executableIdentityDigest: identity.executableIdentityDigest,
    controlledStateRootIdentity: identity.controlledStateRootIdentity,
  };
}

export function assertExternalProcessIdentityInvariant(identity: ExternalProcessIdentity): void {
  if (
    rawField(identity, 'schemaVersion') !== 1 ||
    !known(ExternalProcessGroupKind, identity.processGroupKind)
  ) {
    throw new TypeError('External process identity is invalid');
  }
  sha256Digest(identity.launchNonce);
  positive(identity.processId, 'External process ID');
  positive(identity.processGroupId, 'External process-group ID');
  nonBlank(identity.processStartIdentity, 'External process start identity');
  sha256Digest(identity.executableIdentityDigest);
  nonBlank(identity.controlledStateRootIdentity, 'External process controlled state root');
  sha256Digest(identity.identityDigest);
}

function assertThreadDirective(thread: ExternalThreadDirective): void {
  if (thread.kind === ExternalThreadPolicy.FRESH) {
    return;
  }
  if (rawField(thread, 'kind') !== ExternalThreadPolicy.RESUME_EXACT) {
    throw new TypeError('External Thread policy is unknown');
  }
  nonBlank(thread.backendSessionRef, 'External backend session reference');
  sha256Digest(thread.resumeBindingDigest);
}

export function assertExternalExecutionIntentInvariant(intent: ExternalExecutionIntent): void {
  if (rawField(intent, 'schemaVersion') !== 1) {
    throw new TypeError('External execution intent schema is unsupported');
  }
  externalExecutionId(intent.id);
  goalId(intent.goalId);
  goalRevision(intent.goalRevision);
  workflowId(intent.workflowId);
  workflowVersion(intent.workflowVersionAtAuthorization);
  workflowVersion(intent.phaseVersion);
  if (
    intent.phase !== WorkflowPhase.DISCOVERY &&
    intent.phase !== WorkflowPhase.PLAN &&
    intent.phase !== WorkflowPhase.IMPLEMENT
  ) {
    throw new TypeError('External execution phase is not Worker-backed');
  }
  if (intent.phaseVersion !== intent.workflowVersionAtAuthorization) {
    throw new TypeError('External phase version must bind authorization Workflow version');
  }
  attemptId(intent.attemptId);
  workerSessionId(intent.workerSessionId);
  contextManifestId(intent.contextManifestId);
  executionProfileId(intent.executionProfileId);
  policyBundleId(intent.policyBundleId);
  for (const digest of [
    intent.dispatchClaimDigest,
    intent.contextManifestDigest,
    intent.contextPackageDigest,
    intent.executionProfileDigest,
    intent.policyBundleDigest,
    intent.binaryIdentityDigest,
    intent.binaryProtocolSchemaDigest,
    intent.executionConfigDigest,
    intent.managedRequirementsDigest,
    intent.instructionSourceManifestDigest,
    intent.processLaunchNonce,
    intent.intentDigest,
  ]) {
    sha256Digest(digest);
  }
  nonBlank(intent.backendKind, 'External backend kind');
  nonBlank(intent.controlledStateRootIdentity, 'External controlled state-root identity');
  assertThreadDirective(intent.thread);
  if (
    !known(ExternalContinuityPolicy, intent.continuityPolicy) ||
    !known(ExternalCompactionPolicy, intent.compactionPolicy) ||
    !known(ExternalRetentionPolicy, intent.retentionPolicy) ||
    !known(ExternalFallbackPolicy, intent.fallbackPolicy) ||
    !known(ExternalInterruptionPolicy, intent.interruptionPolicy)
  ) {
    throw new TypeError('External execution policy is unknown');
  }
  const leaseId = intent.candidateWorkspaceLeaseId;
  const leaseDigest = intent.candidateWorkspaceLeaseDigest;
  const leaseCwdIdentity = intent.candidateWorkspaceCwdIdentity;
  const leaseParts = [leaseId, leaseDigest, leaseCwdIdentity];
  if (
    leaseParts.some((value) => value !== undefined) &&
    leaseParts.some((value) => value === undefined)
  ) {
    throw new TypeError('External Candidate lease identity must be complete');
  }
  if (intent.phase === WorkflowPhase.IMPLEMENT && leaseParts[0] === undefined) {
    throw new TypeError('External IMPLEMENT execution requires a Candidate workspace lease');
  }
  if (intent.phase !== WorkflowPhase.IMPLEMENT && leaseParts[0] !== undefined) {
    throw new TypeError('Only external IMPLEMENT execution may bind a Candidate workspace lease');
  }
  if (leaseId !== undefined && leaseDigest !== undefined && leaseCwdIdentity !== undefined) {
    nonBlank(leaseId, 'External Candidate workspace lease ID');
    sha256Digest(leaseDigest);
    nonBlank(leaseCwdIdentity, 'External Candidate workspace cwd identity', 16_384);
  }
  isoTimestamp(intent.authorizedAt);
}

export function externalExecutionRecordProjection(
  record: Omit<ExternalExecutionRecord, 'recordDigest'>,
): unknown {
  return {
    ...externalExecutionIntentProjection(record),
    intentDigest: record.intentDigest,
    version: record.version,
    state: record.state,
    ...(record.processIdentity === undefined ? {} : { processIdentity: record.processIdentity }),
    ...(record.backendSessionRef === undefined
      ? {}
      : { backendSessionRef: record.backendSessionRef }),
    ...(record.backendOperationRef === undefined
      ? {}
      : { backendOperationRef: record.backendOperationRef }),
    compactionCount: record.compactionCount,
    turnInterruptCount: record.turnInterruptCount,
    ...(record.failureCode === undefined ? {} : { failureCode: record.failureCode }),
    ...(record.resultEventId === undefined ? {} : { resultEventId: record.resultEventId }),
    updatedAt: record.updatedAt,
    ...(record.terminalAt === undefined ? {} : { terminalAt: record.terminalAt }),
    ...(record.lastObservationId === undefined
      ? {}
      : { lastObservationId: record.lastObservationId }),
    auditSequence: record.auditSequence,
  };
}

export function assertExternalExecutionRecordInvariant(record: ExternalExecutionRecord): void {
  assertExternalExecutionIntentInvariant(record);
  positive(record.version, 'External execution version');
  if (!known(ExternalExecutionState, record.state)) {
    throw new TypeError('External execution state is unknown');
  }
  if (record.processIdentity !== undefined) {
    assertExternalProcessIdentityInvariant(record.processIdentity);
    if (
      record.processIdentity.launchNonce !== record.processLaunchNonce ||
      record.processIdentity.executableIdentityDigest !== record.binaryIdentityDigest ||
      record.processIdentity.controlledStateRootIdentity !== record.controlledStateRootIdentity
    ) {
      throw new TypeError('External process identity does not bind its execution intent');
    }
  }
  nonNegative(record.compactionCount, 'External compaction count');
  nonNegative(record.turnInterruptCount, 'External interrupt count');
  if (record.backendSessionRef !== undefined) {
    nonBlank(record.backendSessionRef, 'External backend session reference');
  }
  if (record.backendOperationRef !== undefined) {
    nonBlank(record.backendOperationRef, 'External backend operation reference');
  }
  if (record.failureCode !== undefined) {
    nonBlank(record.failureCode, 'External failure code');
  }
  if (record.resultEventId !== undefined) {
    workerEventId(record.resultEventId);
  }
  if (
    (record.state === ExternalExecutionState.COMPLETED && record.resultEventId === undefined) ||
    (record.state === ExternalExecutionState.FAILED &&
      (record.failureCode === 'BACKEND_TURN_FAILED') !== (record.resultEventId !== undefined)) ||
    (record.state !== ExternalExecutionState.COMPLETED &&
      record.state !== ExternalExecutionState.FAILED &&
      record.resultEventId !== undefined)
  ) {
    throw new TypeError('External execution result Event does not match terminal state');
  }
  isoTimestamp(record.updatedAt);
  if (record.updatedAt < record.authorizedAt) {
    throw new TypeError('External execution update predates authorization');
  }
  const terminal = terminalState(record.state);
  if (terminal !== (record.terminalAt !== undefined)) {
    throw new TypeError('External execution terminal time must match state');
  }
  if (record.terminalAt !== undefined) {
    isoTimestamp(record.terminalAt);
    if (record.terminalAt !== record.updatedAt) {
      throw new TypeError('External terminal and update times must match');
    }
  }
  if (record.lastObservationId !== undefined) {
    externalExecutionObservationId(record.lastObservationId);
  }
  if (record.state === ExternalExecutionState.AUTHORIZED && record.version !== 1) {
    throw new TypeError('Authorized external execution must be version 1');
  }
  if (
    (record.state === ExternalExecutionState.PROCESS_OBSERVED ||
      record.state === ExternalExecutionState.SESSION_OBSERVED ||
      record.state === ExternalExecutionState.OPERATION_RUNNING) &&
    record.processIdentity === undefined
  ) {
    throw new TypeError('Observed external execution state requires process identity');
  }
  if (record.state === ExternalExecutionState.AUTHORIZED && record.processIdentity !== undefined) {
    throw new TypeError('Authorized external execution cannot pre-observe a process');
  }
  if (record.backendSessionRef !== undefined && record.processIdentity === undefined) {
    throw new TypeError('External backend session requires process identity');
  }
  if (
    record.state === ExternalExecutionState.SESSION_OBSERVED &&
    record.backendSessionRef === undefined
  ) {
    throw new TypeError('External session state requires its reference');
  }
  if (
    record.state === ExternalExecutionState.OPERATION_RUNNING &&
    (record.backendSessionRef === undefined || record.backendOperationRef === undefined)
  ) {
    throw new TypeError('External operation state requires session and operation references');
  }
  if (record.state === ExternalExecutionState.COMPLETED && record.failureCode !== undefined) {
    throw new TypeError('Completed external execution cannot retain failure');
  }
  if (!terminal && record.failureCode !== undefined) {
    throw new TypeError('Non-terminal external execution cannot retain failure');
  }
  if (
    (record.state === ExternalExecutionState.FAILED ||
      record.state === ExternalExecutionState.INTERRUPTED ||
      record.state === ExternalExecutionState.ABANDONED) &&
    record.failureCode === undefined
  ) {
    throw new TypeError('Non-success terminal external execution requires failure code');
  }
  positive(record.auditSequence, 'External execution audit sequence');
  sha256Digest(record.recordDigest);
}

export function externalExecutionObservationProjection(
  observation: Omit<ExternalExecutionObservation, 'observationDigest'>,
): unknown {
  return {
    schemaVersion: observation.schemaVersion,
    id: observation.id,
    externalExecutionId: observation.externalExecutionId,
    intentDigest: observation.intentDigest,
    expectedRecordVersion: observation.expectedRecordVersion,
    state: observation.state,
    ...(observation.processIdentity === undefined
      ? {}
      : { processIdentity: observation.processIdentity }),
    ...(observation.backendSessionRef === undefined
      ? {}
      : { backendSessionRef: observation.backendSessionRef }),
    ...(observation.backendOperationRef === undefined
      ? {}
      : { backendOperationRef: observation.backendOperationRef }),
    compactionCount: observation.compactionCount,
    turnInterruptCount: observation.turnInterruptCount,
    ...(observation.failureCode === undefined ? {} : { failureCode: observation.failureCode }),
    ...(observation.resultEventId === undefined
      ? {}
      : { resultEventId: observation.resultEventId }),
    observedAt: observation.observedAt,
  };
}

export function assertExternalExecutionObservationInvariant(
  observation: ExternalExecutionObservation,
): void {
  if (rawField(observation, 'schemaVersion') !== 1) {
    throw new TypeError('External execution observation schema is unsupported');
  }
  externalExecutionObservationId(observation.id);
  externalExecutionId(observation.externalExecutionId);
  sha256Digest(observation.intentDigest);
  positive(observation.expectedRecordVersion, 'External observation expected record version');
  if (!known(ExternalExecutionState, observation.state)) {
    throw new TypeError('External execution observation state is invalid');
  }
  if (observation.processIdentity !== undefined) {
    assertExternalProcessIdentityInvariant(observation.processIdentity);
  }
  if (
    (observation.state === ExternalExecutionState.PROCESS_OBSERVED) !==
    (observation.processIdentity !== undefined)
  ) {
    throw new TypeError('Only process-start observation carries external process identity');
  }
  if (observation.backendSessionRef !== undefined) {
    nonBlank(observation.backendSessionRef, 'External backend session reference');
  }
  if (observation.backendOperationRef !== undefined) {
    nonBlank(observation.backendOperationRef, 'External backend operation reference');
  }
  if (
    observation.state === ExternalExecutionState.SESSION_OBSERVED &&
    observation.backendSessionRef === undefined
  ) {
    throw new TypeError('External session observation requires its reference');
  }
  if (
    observation.state === ExternalExecutionState.OPERATION_RUNNING &&
    (observation.backendSessionRef === undefined || observation.backendOperationRef === undefined)
  ) {
    throw new TypeError('External operation observation requires both references');
  }
  nonNegative(observation.compactionCount, 'External compaction count');
  nonNegative(observation.turnInterruptCount, 'External interrupt count');
  if (observation.failureCode !== undefined) {
    nonBlank(observation.failureCode, 'External observation failure code');
  }
  if (
    observation.state === ExternalExecutionState.COMPLETED &&
    observation.failureCode !== undefined
  ) {
    throw new TypeError('Completed external observation cannot retain failure');
  }
  if (
    observation.state !== ExternalExecutionState.COMPLETED &&
    observation.state !== ExternalExecutionState.FAILED &&
    observation.state !== ExternalExecutionState.INTERRUPTED &&
    observation.failureCode !== undefined
  ) {
    throw new TypeError('Non-terminal external observation cannot retain failure');
  }
  if (
    (observation.state === ExternalExecutionState.FAILED ||
      observation.state === ExternalExecutionState.INTERRUPTED) &&
    observation.failureCode === undefined
  ) {
    throw new TypeError('Non-success external observation requires a failure code');
  }
  if (observation.resultEventId !== undefined) {
    workerEventId(observation.resultEventId);
  }
  if (
    (observation.state === ExternalExecutionState.COMPLETED &&
      observation.resultEventId === undefined) ||
    (observation.state === ExternalExecutionState.FAILED &&
      (observation.failureCode === 'BACKEND_TURN_FAILED') !==
        (observation.resultEventId !== undefined)) ||
    (observation.state !== ExternalExecutionState.COMPLETED &&
      observation.state !== ExternalExecutionState.FAILED &&
      observation.resultEventId !== undefined)
  ) {
    throw new TypeError('External observation result Event does not match terminal state');
  }
  isoTimestamp(observation.observedAt);
  sha256Digest(observation.observationDigest);
}

export function externalMaintenanceAuthorizationProjection(
  intent: Pick<
    ExternalMaintenanceIntent,
    'schemaVersion' | 'id' | 'externalExecutionId' | 'sequence' | 'kind' | 'authorizedAt'
  >,
): unknown {
  return { ...intent };
}

export function externalMaintenanceRecordProjection(
  intent: Omit<ExternalMaintenanceIntent, 'recordDigest'>,
): unknown {
  return {
    schemaVersion: intent.schemaVersion,
    id: intent.id,
    externalExecutionId: intent.externalExecutionId,
    sequence: intent.sequence,
    kind: intent.kind,
    state: intent.state,
    authorizedAt: intent.authorizedAt,
    ...(intent.observedAt === undefined ? {} : { observedAt: intent.observedAt }),
    ...(intent.failureCode === undefined ? {} : { failureCode: intent.failureCode }),
    intentDigest: intent.intentDigest,
  };
}

export function assertExternalMaintenanceIntentInvariant(intent: ExternalMaintenanceIntent): void {
  if (
    rawField(intent, 'schemaVersion') !== 1 ||
    rawField(intent, 'kind') !== ExternalMaintenanceKind.WORKING_CONTEXT_COMPACTION ||
    !known(ExternalMaintenanceState, intent.state)
  ) {
    throw new TypeError('External maintenance intent is invalid');
  }
  externalMaintenanceIntentId(intent.id);
  externalExecutionId(intent.externalExecutionId);
  positive(intent.sequence, 'External maintenance sequence');
  isoTimestamp(intent.authorizedAt);
  if (intent.observedAt !== undefined) {
    isoTimestamp(intent.observedAt);
    if (intent.observedAt < intent.authorizedAt) {
      throw new TypeError('External maintenance observation predates authorization');
    }
  }
  if (intent.state === ExternalMaintenanceState.AUTHORIZED) {
    if (intent.observedAt !== undefined || intent.failureCode !== undefined) {
      throw new TypeError('Authorized external maintenance cannot have a terminal observation');
    }
  } else if (intent.observedAt === undefined) {
    throw new TypeError('Terminal external maintenance requires its observation time');
  }
  if (
    (intent.state === ExternalMaintenanceState.FAILED ||
      intent.state === ExternalMaintenanceState.ABANDONED) !==
    (intent.failureCode !== undefined)
  ) {
    throw new TypeError('External maintenance failure details do not match state');
  }
  if (intent.failureCode !== undefined) {
    nonBlank(intent.failureCode, 'External maintenance failure');
  }
  sha256Digest(intent.intentDigest);
  sha256Digest(intent.recordDigest);
}
