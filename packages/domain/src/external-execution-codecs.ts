import { z } from 'zod';

import {
  ExternalApprovalPolicy,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  ExternalCommandNetworkPolicy,
  ExternalCompactionPolicy,
  ExternalContinuityPolicy,
  ExternalExecutionState,
  ExternalFallbackPolicy,
  ExternalInterruptionPolicy,
  ExternalMaintenanceKind,
  ExternalMaintenanceState,
  ExternalPhaseCwdKind,
  ExternalPhaseResponseSchemaPolicy,
  ExternalPhaseSourceAuthorityKind,
  ExternalProcessGroupKind,
  ExternalProjectConfigurationPolicy,
  ExternalRetentionPolicy,
  ExternalThreadPolicy,
  ExternalWorkerDispatchPolicy,
  assertExternalBackendCapabilityRecordInvariant,
  assertExternalExecutionIntentInvariant,
  assertExternalExecutionObservationInvariant,
  assertExternalExecutionProfileDefinitionInvariant,
  assertExternalExecutionRecordInvariant,
  assertExternalMaintenanceIntentInvariant,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionIntent,
  type ExternalExecutionObservation,
  type ExternalExecutionProfileDefinition,
  type ExternalExecutionRecord,
  type ExternalMaintenanceIntent,
  type ExternalProcessIdentity,
  type ExternalThreadDirective,
} from './external-execution.js';
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
} from './identifiers.js';
import { WorkflowPhase } from './model.js';

const boundedNonBlankStringSchema = z
  .string()
  .max(16_384)
  .refine((value) => value.trim().length > 0 && !value.includes('\u0000'));
const digestSchema = z.string();
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const backendCapabilitySchema = z.enum(Object.values(ExternalBackendCapability));
const capabilityClassificationSchema = z.enum(
  Object.values(ExternalBackendCapabilityClassification),
);
const continuityPolicySchema = z.enum(Object.values(ExternalContinuityPolicy));
const compactionPolicySchema = z.enum(Object.values(ExternalCompactionPolicy));
const retentionPolicySchema = z.enum(Object.values(ExternalRetentionPolicy));
const fallbackPolicySchema = z.enum(Object.values(ExternalFallbackPolicy));
const interruptionPolicySchema = z.enum(Object.values(ExternalInterruptionPolicy));
const externalExecutionStateSchema = z.enum(Object.values(ExternalExecutionState));
const externalObservationStateSchema = z.enum([
  ExternalExecutionState.PROCESS_OBSERVED,
  ExternalExecutionState.SESSION_OBSERVED,
  ExternalExecutionState.OPERATION_RUNNING,
  ExternalExecutionState.COMPLETED,
  ExternalExecutionState.INTERRUPTED,
  ExternalExecutionState.FAILED,
]);
const maintenanceStateSchema = z.enum(Object.values(ExternalMaintenanceState));
const workerPhaseSchema = z.enum([
  WorkflowPhase.DISCOVERY,
  WorkflowPhase.PLAN,
  WorkflowPhase.IMPLEMENT,
]);

const threadDirectiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(ExternalThreadPolicy.FRESH) }).strict(),
  z
    .object({
      kind: z.literal(ExternalThreadPolicy.RESUME_EXACT),
      backendSessionRef: boundedNonBlankStringSchema,
      resumeBindingDigest: digestSchema,
    })
    .strict(),
]);

const capabilityRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    backendKind: boundedNonBlankStringSchema,
    binaryIdentityDigest: digestSchema,
    protocolSchemaDigest: digestSchema,
    configurationProfileDigest: digestSchema,
    capabilityEntries: z.array(
      z
        .object({
          capability: backendCapabilitySchema,
          classification: capabilityClassificationSchema,
          proofKind: boundedNonBlankStringSchema,
          proofDigest: digestSchema.optional(),
        })
        .strict(),
    ),
    observedAt: z.string(),
    recordDigest: digestSchema,
  })
  .strict();

const externalExecutionProfileFields = {
  backendKind: boundedNonBlankStringSchema,
  capabilityRecordDigest: digestSchema,
  selectedCapabilities: z.array(backendCapabilitySchema),
  workerPhases: z.array(workerPhaseSchema),
  binaryIdentityDigest: digestSchema,
  protocolSchemaDigest: digestSchema,
  configurationProfileDigest: digestSchema,
  executionConfigDigest: digestSchema,
  managedRequirementsDigest: digestSchema,
  instructionSourceManifestDigest: digestSchema,
  controlledStateRootIdentity: boundedNonBlankStringSchema,
  environmentProjectionDigest: digestSchema,
  permissionProfileId: boundedNonBlankStringSchema,
  permissionProfileDigest: digestSchema,
  model: boundedNonBlankStringSchema,
  modelProvider: boundedNonBlankStringSchema,
  serviceTier: boundedNonBlankStringSchema.nullable(),
  reasoningEffort: boundedNonBlankStringSchema,
  responseSchemaPolicy: boundedNonBlankStringSchema,
  disabledIntegrationsDigest: digestSchema,
  defaultThreadPolicy: z.literal(ExternalThreadPolicy.FRESH),
  continuityPolicy: continuityPolicySchema,
  compactionPolicy: compactionPolicySchema,
  retentionPolicy: retentionPolicySchema,
  fallbackPolicy: fallbackPolicySchema,
  interruptionPolicy: interruptionPolicySchema,
} as const;

const externalInstructionSourceBindingSchema = z
  .object({
    path: boundedNonBlankStringSchema,
    digest: digestSchema,
  })
  .strict();

const externalExecutionPhaseDispatchEntrySchema = z
  .object({
    phase: workerPhaseSchema,
    workerAdapter: boundedNonBlankStringSchema,
    workerAdapterVersion: boundedNonBlankStringSchema,
    cwdKind: z.enum(ExternalPhaseCwdKind),
    sourceAuthorityKind: z.enum(ExternalPhaseSourceAuthorityKind),
    permissionProfileId: boundedNonBlankStringSchema,
    permissionProfileDigest: digestSchema,
    isolationProfileId: boundedNonBlankStringSchema,
    isolationProfileDigest: digestSchema,
    projectConfigurationPolicy: z.literal(ExternalProjectConfigurationPolicy.DISABLED),
    configurationProfileDigest: digestSchema,
    executionConfigDigest: digestSchema,
    disabledIntegrationsDigest: digestSchema,
    instructionSourceManifestId: boundedNonBlankStringSchema,
    instructionSourceManifestDigest: digestSchema,
    instructionSources: z.array(externalInstructionSourceBindingSchema),
    capabilityGrantDigest: digestSchema,
    responseContractDigest: digestSchema,
    responseSchemaPolicy: z.enum(ExternalPhaseResponseSchemaPolicy),
    workerActivityPolicyId: boundedNonBlankStringSchema,
    workerActivityPolicyDigest: digestSchema,
    commandNetworkPolicy: z.literal(ExternalCommandNetworkPolicy.DENIED),
    approvalPolicy: z.literal(ExternalApprovalPolicy.NEVER),
    continuityPolicy: continuityPolicySchema,
    compactionPolicy: compactionPolicySchema,
    fallbackPolicy: z.literal(ExternalFallbackPolicy.FAIL_CLOSED),
    allowedRoots: z.array(boundedNonBlankStringSchema),
    forbiddenRoots: z.array(boundedNonBlankStringSchema),
  })
  .strict();

const externalExecutionProfileV3Fields = {
  backendKind: boundedNonBlankStringSchema,
  capabilityRecordDigest: digestSchema,
  selectedCapabilities: z.array(backendCapabilitySchema),
  workerPhases: z.array(workerPhaseSchema),
  binaryIdentityDigest: digestSchema,
  protocolSchemaDigest: digestSchema,
  managedRequirementsDigest: digestSchema,
  controlledStateRootIdentity: boundedNonBlankStringSchema,
  environmentProjectionDigest: digestSchema,
  model: boundedNonBlankStringSchema,
  modelProvider: boundedNonBlankStringSchema,
  serviceTier: boundedNonBlankStringSchema.nullable(),
  reasoningEffort: boundedNonBlankStringSchema,
  defaultThreadPolicy: z.literal(ExternalThreadPolicy.FRESH),
  retentionPolicy: z.literal(ExternalRetentionPolicy.CONTROLLED),
  interruptionPolicy: z.literal(ExternalInterruptionPolicy.INTERRUPT_OPERATION),
  workerDispatchPolicy: z.literal(ExternalWorkerDispatchPolicy.ALL_SELECTED_ATTEMPTS),
  phaseDispatch: z.array(externalExecutionPhaseDispatchEntrySchema),
} as const;

const externalExecutionProfileSchema = z.discriminatedUnion('schemaVersion', [
  z.object({ schemaVersion: z.literal(1), ...externalExecutionProfileFields }).strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      ...externalExecutionProfileFields,
      workerDispatchPolicy: z.enum(ExternalWorkerDispatchPolicy),
    })
    .strict(),
  z.object({ schemaVersion: z.literal(3), ...externalExecutionProfileV3Fields }).strict(),
]);

const externalExecutionIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    goalId: z.string(),
    goalRevision: positiveSafeIntegerSchema,
    workflowId: z.string(),
    workflowVersionAtAuthorization: positiveSafeIntegerSchema,
    phase: workerPhaseSchema,
    phaseVersion: positiveSafeIntegerSchema,
    attemptId: z.string(),
    workerSessionId: z.string(),
    dispatchClaimDigest: digestSchema,
    contextManifestId: z.string(),
    contextManifestDigest: digestSchema,
    contextPackageDigest: digestSchema,
    executionProfileId: z.string(),
    executionProfileDigest: digestSchema,
    policyBundleId: z.string(),
    policyBundleDigest: digestSchema,
    backendKind: boundedNonBlankStringSchema,
    binaryIdentityDigest: digestSchema,
    binaryProtocolSchemaDigest: digestSchema,
    executionConfigDigest: digestSchema,
    managedRequirementsDigest: digestSchema,
    instructionSourceManifestDigest: digestSchema,
    controlledStateRootIdentity: boundedNonBlankStringSchema,
    processLaunchNonce: digestSchema,
    thread: threadDirectiveSchema,
    continuityPolicy: continuityPolicySchema,
    compactionPolicy: compactionPolicySchema,
    retentionPolicy: retentionPolicySchema,
    fallbackPolicy: fallbackPolicySchema,
    interruptionPolicy: interruptionPolicySchema,
    candidateWorkspaceLeaseId: boundedNonBlankStringSchema.optional(),
    candidateWorkspaceLeaseDigest: digestSchema.optional(),
    candidateWorkspaceCwdIdentity: boundedNonBlankStringSchema.optional(),
    authorizedAt: z.string(),
    intentDigest: digestSchema,
  })
  .strict();

const externalProcessIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    launchNonce: digestSchema,
    processId: positiveSafeIntegerSchema,
    processGroupId: positiveSafeIntegerSchema,
    processGroupKind: z.enum(Object.values(ExternalProcessGroupKind)),
    processStartIdentity: boundedNonBlankStringSchema,
    executableIdentityDigest: digestSchema,
    controlledStateRootIdentity: boundedNonBlankStringSchema,
    identityDigest: digestSchema,
  })
  .strict();

const externalExecutionRecordSchema = externalExecutionIntentSchema
  .extend({
    version: positiveSafeIntegerSchema,
    state: externalExecutionStateSchema,
    processIdentity: externalProcessIdentitySchema.optional(),
    backendSessionRef: boundedNonBlankStringSchema.optional(),
    backendOperationRef: boundedNonBlankStringSchema.optional(),
    compactionCount: nonNegativeSafeIntegerSchema,
    turnInterruptCount: nonNegativeSafeIntegerSchema,
    failureCode: boundedNonBlankStringSchema.optional(),
    resultEventId: z.string().optional(),
    updatedAt: z.string(),
    terminalAt: z.string().optional(),
    lastObservationId: z.string().optional(),
    auditSequence: positiveSafeIntegerSchema,
    recordDigest: digestSchema,
  })
  .strict();

const externalExecutionObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    externalExecutionId: z.string(),
    intentDigest: digestSchema,
    expectedRecordVersion: positiveSafeIntegerSchema,
    state: externalObservationStateSchema,
    processIdentity: externalProcessIdentitySchema.optional(),
    backendSessionRef: boundedNonBlankStringSchema.optional(),
    backendOperationRef: boundedNonBlankStringSchema.optional(),
    compactionCount: nonNegativeSafeIntegerSchema,
    turnInterruptCount: nonNegativeSafeIntegerSchema,
    failureCode: boundedNonBlankStringSchema.optional(),
    resultEventId: z.string().optional(),
    observedAt: z.string(),
    observationDigest: digestSchema,
  })
  .strict();

const maintenanceIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    externalExecutionId: z.string(),
    sequence: positiveSafeIntegerSchema,
    kind: z.literal(ExternalMaintenanceKind.WORKING_CONTEXT_COMPACTION),
    state: maintenanceStateSchema,
    authorizedAt: z.string(),
    observedAt: z.string().optional(),
    failureCode: boundedNonBlankStringSchema.optional(),
    intentDigest: digestSchema,
    recordDigest: digestSchema,
  })
  .strict();

function threadDirective(parsed: z.infer<typeof threadDirectiveSchema>): ExternalThreadDirective {
  return parsed.kind === ExternalThreadPolicy.FRESH
    ? Object.freeze({ kind: parsed.kind })
    : Object.freeze({
        kind: parsed.kind,
        backendSessionRef: parsed.backendSessionRef,
        resumeBindingDigest: sha256Digest(parsed.resumeBindingDigest),
      });
}

function intentFromParsed(
  parsed: z.infer<typeof externalExecutionIntentSchema>,
): ExternalExecutionIntent {
  const intent: ExternalExecutionIntent = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    id: externalExecutionId(parsed.id),
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersionAtAuthorization: workflowVersion(parsed.workflowVersionAtAuthorization),
    phase: parsed.phase,
    phaseVersion: workflowVersion(parsed.phaseVersion),
    attemptId: attemptId(parsed.attemptId),
    workerSessionId: workerSessionId(parsed.workerSessionId),
    dispatchClaimDigest: sha256Digest(parsed.dispatchClaimDigest),
    contextManifestId: contextManifestId(parsed.contextManifestId),
    contextManifestDigest: sha256Digest(parsed.contextManifestDigest),
    contextPackageDigest: sha256Digest(parsed.contextPackageDigest),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    backendKind: parsed.backendKind,
    binaryIdentityDigest: sha256Digest(parsed.binaryIdentityDigest),
    binaryProtocolSchemaDigest: sha256Digest(parsed.binaryProtocolSchemaDigest),
    executionConfigDigest: sha256Digest(parsed.executionConfigDigest),
    managedRequirementsDigest: sha256Digest(parsed.managedRequirementsDigest),
    instructionSourceManifestDigest: sha256Digest(parsed.instructionSourceManifestDigest),
    controlledStateRootIdentity: parsed.controlledStateRootIdentity,
    processLaunchNonce: sha256Digest(parsed.processLaunchNonce),
    thread: threadDirective(parsed.thread),
    continuityPolicy: parsed.continuityPolicy,
    compactionPolicy: parsed.compactionPolicy,
    retentionPolicy: parsed.retentionPolicy,
    fallbackPolicy: parsed.fallbackPolicy,
    interruptionPolicy: parsed.interruptionPolicy,
    ...(parsed.candidateWorkspaceLeaseId === undefined
      ? {}
      : { candidateWorkspaceLeaseId: parsed.candidateWorkspaceLeaseId }),
    ...(parsed.candidateWorkspaceLeaseDigest === undefined
      ? {}
      : { candidateWorkspaceLeaseDigest: sha256Digest(parsed.candidateWorkspaceLeaseDigest) }),
    ...(parsed.candidateWorkspaceCwdIdentity === undefined
      ? {}
      : { candidateWorkspaceCwdIdentity: parsed.candidateWorkspaceCwdIdentity }),
    authorizedAt: isoTimestamp(parsed.authorizedAt),
    intentDigest: sha256Digest(parsed.intentDigest),
  });
  assertExternalExecutionIntentInvariant(intent);
  return intent;
}

function processIdentityFromParsed(
  parsed: z.infer<typeof externalProcessIdentitySchema>,
): ExternalProcessIdentity {
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    launchNonce: sha256Digest(parsed.launchNonce),
    processId: parsed.processId,
    processGroupId: parsed.processGroupId,
    processGroupKind: parsed.processGroupKind,
    processStartIdentity: parsed.processStartIdentity,
    executableIdentityDigest: sha256Digest(parsed.executableIdentityDigest),
    controlledStateRootIdentity: parsed.controlledStateRootIdentity,
    identityDigest: sha256Digest(parsed.identityDigest),
  });
}

export function decodeExternalProcessIdentity(value: unknown): ExternalProcessIdentity {
  return processIdentityFromParsed(externalProcessIdentitySchema.parse(value));
}

export function decodeExternalBackendCapabilityRecord(
  value: unknown,
): ExternalBackendCapabilityRecord {
  const parsed = capabilityRecordSchema.parse(value);
  const record: ExternalBackendCapabilityRecord = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    backendKind: parsed.backendKind,
    binaryIdentityDigest: sha256Digest(parsed.binaryIdentityDigest),
    protocolSchemaDigest: sha256Digest(parsed.protocolSchemaDigest),
    configurationProfileDigest: sha256Digest(parsed.configurationProfileDigest),
    capabilityEntries: Object.freeze(
      parsed.capabilityEntries.map((entry) =>
        Object.freeze({
          capability: entry.capability,
          classification: entry.classification,
          proofKind: entry.proofKind,
          ...(entry.proofDigest === undefined
            ? {}
            : { proofDigest: sha256Digest(entry.proofDigest) }),
        }),
      ),
    ),
    observedAt: isoTimestamp(parsed.observedAt),
    recordDigest: sha256Digest(parsed.recordDigest),
  });
  assertExternalBackendCapabilityRecordInvariant(record);
  return record;
}

export function decodeExternalExecutionProfileDefinition(
  value: unknown,
): ExternalExecutionProfileDefinition {
  const parsed = externalExecutionProfileSchema.parse(value);
  const shared = {
    backendKind: parsed.backendKind,
    capabilityRecordDigest: sha256Digest(parsed.capabilityRecordDigest),
    selectedCapabilities: Object.freeze([...parsed.selectedCapabilities]),
    workerPhases: Object.freeze([...parsed.workerPhases]),
    binaryIdentityDigest: sha256Digest(parsed.binaryIdentityDigest),
    protocolSchemaDigest: sha256Digest(parsed.protocolSchemaDigest),
    managedRequirementsDigest: sha256Digest(parsed.managedRequirementsDigest),
    controlledStateRootIdentity: parsed.controlledStateRootIdentity,
    environmentProjectionDigest: sha256Digest(parsed.environmentProjectionDigest),
    model: parsed.model,
    modelProvider: parsed.modelProvider,
    serviceTier: parsed.serviceTier,
    reasoningEffort: parsed.reasoningEffort,
    defaultThreadPolicy: parsed.defaultThreadPolicy,
    retentionPolicy: parsed.retentionPolicy,
    interruptionPolicy: parsed.interruptionPolicy,
  } as const;
  const profile: ExternalExecutionProfileDefinition =
    parsed.schemaVersion === 3
      ? Object.freeze({
          ...shared,
          schemaVersion: parsed.schemaVersion,
          workerDispatchPolicy: parsed.workerDispatchPolicy,
          phaseDispatch: Object.freeze(
            parsed.phaseDispatch.map((entry) =>
              Object.freeze({
                ...entry,
                permissionProfileDigest: sha256Digest(entry.permissionProfileDigest),
                isolationProfileDigest: sha256Digest(entry.isolationProfileDigest),
                configurationProfileDigest: sha256Digest(entry.configurationProfileDigest),
                executionConfigDigest: sha256Digest(entry.executionConfigDigest),
                disabledIntegrationsDigest: sha256Digest(entry.disabledIntegrationsDigest),
                instructionSourceManifestDigest: sha256Digest(
                  entry.instructionSourceManifestDigest,
                ),
                instructionSources: Object.freeze(
                  entry.instructionSources.map((source) =>
                    Object.freeze({ path: source.path, digest: sha256Digest(source.digest) }),
                  ),
                ),
                capabilityGrantDigest: sha256Digest(entry.capabilityGrantDigest),
                responseContractDigest: sha256Digest(entry.responseContractDigest),
                workerActivityPolicyDigest: sha256Digest(entry.workerActivityPolicyDigest),
                allowedRoots: Object.freeze([...entry.allowedRoots]),
                forbiddenRoots: Object.freeze([...entry.forbiddenRoots]),
              }),
            ),
          ),
        })
      : parsed.schemaVersion === 1
        ? Object.freeze({
            ...shared,
            schemaVersion: parsed.schemaVersion,
            configurationProfileDigest: sha256Digest(parsed.configurationProfileDigest),
            executionConfigDigest: sha256Digest(parsed.executionConfigDigest),
            instructionSourceManifestDigest: sha256Digest(parsed.instructionSourceManifestDigest),
            permissionProfileId: parsed.permissionProfileId,
            permissionProfileDigest: sha256Digest(parsed.permissionProfileDigest),
            responseSchemaPolicy: parsed.responseSchemaPolicy,
            disabledIntegrationsDigest: sha256Digest(parsed.disabledIntegrationsDigest),
            continuityPolicy: parsed.continuityPolicy,
            compactionPolicy: parsed.compactionPolicy,
            fallbackPolicy: parsed.fallbackPolicy,
          })
        : Object.freeze({
            ...shared,
            schemaVersion: parsed.schemaVersion,
            configurationProfileDigest: sha256Digest(parsed.configurationProfileDigest),
            executionConfigDigest: sha256Digest(parsed.executionConfigDigest),
            instructionSourceManifestDigest: sha256Digest(parsed.instructionSourceManifestDigest),
            permissionProfileId: parsed.permissionProfileId,
            permissionProfileDigest: sha256Digest(parsed.permissionProfileDigest),
            responseSchemaPolicy: parsed.responseSchemaPolicy,
            disabledIntegrationsDigest: sha256Digest(parsed.disabledIntegrationsDigest),
            continuityPolicy: parsed.continuityPolicy,
            compactionPolicy: parsed.compactionPolicy,
            fallbackPolicy: parsed.fallbackPolicy,
            workerDispatchPolicy: parsed.workerDispatchPolicy,
          });
  assertExternalExecutionProfileDefinitionInvariant(profile);
  return profile;
}

export function decodeExternalExecutionIntent(value: unknown): ExternalExecutionIntent {
  return intentFromParsed(externalExecutionIntentSchema.parse(value));
}

export function decodeExternalExecutionRecord(value: unknown): ExternalExecutionRecord {
  const parsed = externalExecutionRecordSchema.parse(value);
  const record: ExternalExecutionRecord = Object.freeze({
    ...intentFromParsed(parsed),
    version: parsed.version,
    state: parsed.state,
    ...(parsed.processIdentity === undefined
      ? {}
      : { processIdentity: processIdentityFromParsed(parsed.processIdentity) }),
    ...(parsed.backendSessionRef === undefined
      ? {}
      : { backendSessionRef: parsed.backendSessionRef }),
    ...(parsed.backendOperationRef === undefined
      ? {}
      : { backendOperationRef: parsed.backendOperationRef }),
    compactionCount: parsed.compactionCount,
    turnInterruptCount: parsed.turnInterruptCount,
    ...(parsed.failureCode === undefined ? {} : { failureCode: parsed.failureCode }),
    ...(parsed.resultEventId === undefined
      ? {}
      : { resultEventId: workerEventId(parsed.resultEventId) }),
    updatedAt: isoTimestamp(parsed.updatedAt),
    ...(parsed.terminalAt === undefined ? {} : { terminalAt: isoTimestamp(parsed.terminalAt) }),
    ...(parsed.lastObservationId === undefined
      ? {}
      : { lastObservationId: externalExecutionObservationId(parsed.lastObservationId) }),
    auditSequence: parsed.auditSequence,
    recordDigest: sha256Digest(parsed.recordDigest),
  });
  assertExternalExecutionRecordInvariant(record);
  return record;
}

export function decodeExternalExecutionObservation(value: unknown): ExternalExecutionObservation {
  const parsed = externalExecutionObservationSchema.parse(value);
  const observation: ExternalExecutionObservation = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    id: externalExecutionObservationId(parsed.id),
    externalExecutionId: externalExecutionId(parsed.externalExecutionId),
    intentDigest: sha256Digest(parsed.intentDigest),
    expectedRecordVersion: parsed.expectedRecordVersion,
    state: parsed.state,
    ...(parsed.processIdentity === undefined
      ? {}
      : { processIdentity: processIdentityFromParsed(parsed.processIdentity) }),
    ...(parsed.backendSessionRef === undefined
      ? {}
      : { backendSessionRef: parsed.backendSessionRef }),
    ...(parsed.backendOperationRef === undefined
      ? {}
      : { backendOperationRef: parsed.backendOperationRef }),
    compactionCount: parsed.compactionCount,
    turnInterruptCount: parsed.turnInterruptCount,
    ...(parsed.failureCode === undefined ? {} : { failureCode: parsed.failureCode }),
    ...(parsed.resultEventId === undefined
      ? {}
      : { resultEventId: workerEventId(parsed.resultEventId) }),
    observedAt: isoTimestamp(parsed.observedAt),
    observationDigest: sha256Digest(parsed.observationDigest),
  });
  assertExternalExecutionObservationInvariant(observation);
  return observation;
}

export function decodeExternalMaintenanceIntent(value: unknown): ExternalMaintenanceIntent {
  const parsed = maintenanceIntentSchema.parse(value);
  const intent: ExternalMaintenanceIntent = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    id: externalMaintenanceIntentId(parsed.id),
    externalExecutionId: externalExecutionId(parsed.externalExecutionId),
    sequence: parsed.sequence,
    kind: parsed.kind,
    state: parsed.state,
    authorizedAt: isoTimestamp(parsed.authorizedAt),
    ...(parsed.observedAt === undefined ? {} : { observedAt: isoTimestamp(parsed.observedAt) }),
    ...(parsed.failureCode === undefined ? {} : { failureCode: parsed.failureCode }),
    intentDigest: sha256Digest(parsed.intentDigest),
    recordDigest: sha256Digest(parsed.recordDigest),
  });
  assertExternalMaintenanceIntentInvariant(intent);
  return intent;
}
