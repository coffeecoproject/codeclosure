import {
  CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
  CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
  CODEX_M251_WORKER_ADAPTER_ID,
  CODEX_M251_WORKER_ADAPTER_VERSION,
  CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST,
  CODEX_M251_WORKER_ISOLATION_PROFILE_ID,
  codexM251WorkerIsolationProfileDigest,
  type CodexWorkerPhaseIsolationInputV1,
} from '@codeclosure/adapter-codex';
import {
  ExternalApprovalPolicy,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  ExternalCommandNetworkPolicy,
  ExternalCompactionPolicy,
  ExternalContinuityPolicy,
  ExternalFallbackPolicy,
  ExternalInterruptionPolicy,
  ExternalPhaseCwdKind,
  ExternalPhaseResponseSchemaPolicy,
  ExternalPhaseSourceAuthorityKind,
  ExternalProjectConfigurationPolicy,
  ExternalRetentionPolicy,
  ExternalThreadPolicy,
  ExternalWorkerDispatchPolicy,
  WorkflowPhase,
  auditEventId,
  decodeExecutionProfileDefinition,
  decodeExternalBackendCapabilityRecord,
  decodeExternalExecutionProfileDefinition,
  deriveCapabilityGrant,
  executionProfileId,
  executionProfileProjection,
  externalBackendCapabilityRecordProjection,
  sha256Digest,
  type ExecutionProfile,
  type ExecutionProfileDefinition,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionPhaseDispatchEntry,
  type ExternalInstructionSourceBinding,
  type Sha256Digest,
} from '@codeclosure/domain';
import {
  M251_CANDIDATE_SOURCE_ID,
  M251_CANDIDATE_SOURCE_VERSION,
  M251_POLICY_BUNDLE_ID,
  M251_POLICY_BUNDLE_VERSION,
  M251_REAL_CODEX_EXECUTION_PROFILE_ID,
  M251_REAL_CODEX_EXECUTION_PROFILE_VERSION,
  M251_VERIFICATION_RUNNER_ID,
  M251_VERIFICATION_RUNNER_VERSION,
  canonicalizeJson,
  createExecutionProfileInstaller,
  createM251PolicyBundleDefinition,
  createPolicyInstaller,
  m1WorkerResponseContract,
  type Clock,
  type DigestProvider,
  type ExternalExecutionControlStore,
  type GovernedExecutionPreflight,
  type IdGenerator,
  type InstalledExecutionProfile,
  type InstalledPolicyBundle,
  type WorkerControlStore,
} from '@codeclosure/runtime';
import {
  bindRuntimeExecutionProfileAuthority,
  type RuntimeExecutionProfile,
  type RuntimeExecutionProfileResolver,
} from '@codeclosure/runtime/composition';

export const M251_DRIVER_VERSION = 'm2-5-1-driver-v1';

const m251WorkerPhases = Object.freeze([
  WorkflowPhase.DISCOVERY,
  WorkflowPhase.IMPLEMENT,
  WorkflowPhase.PLAN,
]);

const m251SelectedCapabilities = Object.freeze(
  [
    ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
    ExternalBackendCapability.FRESH_SESSION,
    ExternalBackendCapability.OPERATION_INTERRUPT,
    ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
  ].toSorted(),
);

type M251AuthorityStore = Pick<
  WorkerControlStore,
  'getExecutionProfile' | 'getPolicyBundle' | 'installExecutionProfile' | 'installPolicyBundle'
> &
  Pick<
    ExternalExecutionControlStore,
    'getExternalBackendCapabilityRecord' | 'installExternalBackendCapabilityRecord'
  >;

export interface M251PhaseExecutionAuthorityInput {
  readonly phase:
    typeof WorkflowPhase.DISCOVERY | typeof WorkflowPhase.IMPLEMENT | typeof WorkflowPhase.PLAN;
  readonly permissionProfileId: string;
  readonly permissionProfileDigest: Sha256Digest;
  readonly executionConfigDigest: Sha256Digest;
  readonly instructionSourceManifestId: string;
  readonly instructionSources: readonly ExternalInstructionSourceBinding[];
  readonly allowedRoots: readonly string[];
  readonly forbiddenRoots: readonly string[];
}

export interface M251FormalExecutionProfileInput {
  readonly capabilityRecord: ExternalBackendCapabilityRecord;
  readonly managedRequirementsDigest: Sha256Digest;
  readonly controlledStateRootIdentity: string;
  readonly environmentProjectionDigest: Sha256Digest;
  readonly model: string;
  readonly modelProvider: string;
  readonly serviceTier: string | null;
  readonly reasoningEffort: string;
  readonly phaseAuthorities: readonly M251PhaseExecutionAuthorityInput[];
}

function exactValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertCapabilityRecord(
  rawRecord: ExternalBackendCapabilityRecord,
  digests: DigestProvider,
): ExternalBackendCapabilityRecord {
  const record = decodeExternalBackendCapabilityRecord(rawRecord);
  const { recordDigest: ignoredDigest, ...withoutDigest } = record;
  void ignoredDigest;
  const expectedDigest = sha256Digest(
    digests.digest(externalBackendCapabilityRecordProjection(withoutDigest)),
  );
  const supported = record.capabilityEntries
    .filter(
      ({ classification }) => classification === ExternalBackendCapabilityClassification.SUPPORTED,
    )
    .map(({ capability }) => capability);
  if (
    record.backendKind !== 'CODEX_APP_SERVER' ||
    record.recordDigest !== expectedDigest ||
    !exactValues(supported, m251SelectedCapabilities) ||
    record.capabilityEntries.length !== m251SelectedCapabilities.length
  ) {
    throw new TypeError('M2.5.1 requires one exact supported real-Codex capability record');
  }
  return record;
}

function phaseAuthorityMap(
  values: readonly M251PhaseExecutionAuthorityInput[],
): ReadonlyMap<string, M251PhaseExecutionAuthorityInput> {
  const byPhase = new Map<string, M251PhaseExecutionAuthorityInput>();
  for (const value of values) {
    if (byPhase.has(value.phase)) {
      throw new TypeError('M2.5.1 phase authority contains a duplicate phase');
    }
    byPhase.set(value.phase, value);
  }
  if (
    byPhase.size !== m251WorkerPhases.length ||
    m251WorkerPhases.some((phase) => !byPhase.has(phase))
  ) {
    throw new TypeError('M2.5.1 phase authority must cover the exact canonical phase set');
  }
  return byPhase;
}

function phaseDispatchEntry(
  input: M251PhaseExecutionAuthorityInput,
  configurationProfileDigest: Sha256Digest,
  digests: DigestProvider,
): ExternalExecutionPhaseDispatchEntry {
  const candidateFree = input.phase !== WorkflowPhase.IMPLEMENT;
  const instructionSources = Object.freeze(
    input.instructionSources.map((source) => Object.freeze({ ...source })),
  );
  const isolationInput = Object.freeze({
    phase: input.phase,
    workerAdapter: CODEX_M251_WORKER_ADAPTER_ID,
    workerAdapterVersion: CODEX_M251_WORKER_ADAPTER_VERSION,
    cwdKind: candidateFree
      ? ExternalPhaseCwdKind.PROJECT_READ_SNAPSHOT
      : ExternalPhaseCwdKind.CANDIDATE_WORKSPACE,
    sourceAuthorityKind: candidateFree
      ? ExternalPhaseSourceAuthorityKind.PROJECT_READ
      : ExternalPhaseSourceAuthorityKind.CANDIDATE,
    permissionProfileId: input.permissionProfileId,
    permissionProfileDigest: input.permissionProfileDigest,
    projectConfigurationPolicy: ExternalProjectConfigurationPolicy.DISABLED,
    configurationProfileDigest,
    executionConfigDigest: input.executionConfigDigest,
    disabledIntegrationsDigest: sha256Digest(CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST),
    instructionSourceManifestId: input.instructionSourceManifestId,
    instructionSourceManifestDigest: digests.digest({ instructionSources }),
    instructionSources,
    capabilityGrantDigest: digests.digest({
      schemaVersion: 1,
      capabilityGrant: deriveCapabilityGrant(input.phase),
    }),
    responseContractDigest: digests.digest({
      schemaVersion: 1,
      responseContract: m1WorkerResponseContract(input.phase),
    }),
    responseSchemaPolicy: candidateFree
      ? ExternalPhaseResponseSchemaPolicy.PROPOSALS_V1
      : ExternalPhaseResponseSchemaPolicy.COMPLETION_REQUEST_V1,
    workerActivityPolicyId: CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
    workerActivityPolicyDigest: sha256Digest(CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST),
    commandNetworkPolicy: ExternalCommandNetworkPolicy.DENIED,
    approvalPolicy: ExternalApprovalPolicy.NEVER,
    continuityPolicy: ExternalContinuityPolicy.SAME_SESSION_BOUNDED_OPERATION,
    compactionPolicy: ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
    fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
    allowedRoots: Object.freeze([...input.allowedRoots]),
    forbiddenRoots: Object.freeze([...input.forbiddenRoots]),
  }) satisfies CodexWorkerPhaseIsolationInputV1;
  return Object.freeze({
    ...isolationInput,
    isolationProfileId: CODEX_M251_WORKER_ISOLATION_PROFILE_ID,
    isolationProfileDigest: sha256Digest(codexM251WorkerIsolationProfileDigest(isolationInput)),
  });
}

/** Constructs the exact formal Profile without installing or publishing a facade. */
export function createM251FormalExecutionProfileDefinition(
  input: M251FormalExecutionProfileInput,
  digests: DigestProvider,
): ExecutionProfileDefinition {
  const capability = assertCapabilityRecord(input.capabilityRecord, digests);
  const phases = phaseAuthorityMap(input.phaseAuthorities);
  const phaseDispatch = Object.freeze(
    m251WorkerPhases.map((phase) => {
      const authority = phases.get(phase);
      if (authority === undefined) {
        throw new TypeError(`M2.5.1 phase authority is unavailable for ${phase}`);
      }
      return phaseDispatchEntry(authority, capability.configurationProfileDigest, digests);
    }),
  );
  const externalExecution = decodeExternalExecutionProfileDefinition({
    schemaVersion: 3,
    backendKind: capability.backendKind,
    capabilityRecordDigest: capability.recordDigest,
    selectedCapabilities: m251SelectedCapabilities,
    workerPhases: m251WorkerPhases,
    binaryIdentityDigest: capability.binaryIdentityDigest,
    protocolSchemaDigest: capability.protocolSchemaDigest,
    managedRequirementsDigest: input.managedRequirementsDigest,
    controlledStateRootIdentity: input.controlledStateRootIdentity,
    environmentProjectionDigest: input.environmentProjectionDigest,
    model: input.model,
    modelProvider: input.modelProvider,
    serviceTier: input.serviceTier,
    reasoningEffort: input.reasoningEffort,
    defaultThreadPolicy: ExternalThreadPolicy.FRESH,
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
    workerDispatchPolicy: ExternalWorkerDispatchPolicy.ALL_SELECTED_ATTEMPTS,
    phaseDispatch,
  });
  return decodeExecutionProfileDefinition({
    id: executionProfileId(M251_REAL_CODEX_EXECUTION_PROFILE_ID),
    schemaVersion: 2,
    version: M251_REAL_CODEX_EXECUTION_PROFILE_VERSION,
    workerAdapter: CODEX_M251_WORKER_ADAPTER_ID,
    workerAdapterVersion: CODEX_M251_WORKER_ADAPTER_VERSION,
    candidateSource: M251_CANDIDATE_SOURCE_ID,
    candidateSourceVersion: M251_CANDIDATE_SOURCE_VERSION,
    verificationRunner: M251_VERIFICATION_RUNNER_ID,
    verificationRunnerVersion: M251_VERIFICATION_RUNNER_VERSION,
    driverVersion: M251_DRIVER_VERSION,
    externalExecution,
  });
}

export interface InstalledM251ExecutionAuthority {
  readonly policy: InstalledPolicyBundle;
  readonly capability: ExternalBackendCapabilityRecord;
  readonly profile: InstalledExecutionProfile;
  readonly governedExecutionPreflight: GovernedExecutionPreflight;
}

export interface InstallM251ExecutionAuthorityInput extends M251FormalExecutionProfileInput {
  readonly store: M251AuthorityStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly digests: DigestProvider;
}

function governedExecutionPreflight(
  policy: InstalledPolicyBundle,
  profile: InstalledExecutionProfile,
): GovernedExecutionPreflight {
  if (
    policy.bundle.id !== M251_POLICY_BUNDLE_ID ||
    policy.bundle.version !== M251_POLICY_BUNDLE_VERSION ||
    profile.profile.id !== M251_REAL_CODEX_EXECUTION_PROFILE_ID ||
    profile.profile.version !== M251_REAL_CODEX_EXECUTION_PROFILE_VERSION
  ) {
    throw new TypeError('M2.5.1 governed preflight authority was substituted');
  }
  return Object.freeze({
    schemaVersion: 1,
    workflowPolicyId: policy.bundle.id,
    workflowPolicyVersion: policy.bundle.version,
    workflowPolicyDigest: policy.bundle.digest,
    executionProfileId: profile.profile.id,
    executionProfileVersion: profile.profile.version,
    executionProfileDigest: profile.profile.digest,
  });
}

/** Installs all persisted B1 authority before any execution facade can be published. */
export function installM251ExecutionAuthority(
  input: InstallM251ExecutionAuthorityInput,
): InstalledM251ExecutionAuthority {
  const profileDefinition = createM251FormalExecutionProfileDefinition(input, input.digests);
  const policyResult = createPolicyInstaller(input).installPolicyBundle(
    createM251PolicyBundleDefinition(input.digests),
  );
  if (policyResult.status === 'POLICY_CONFLICT') {
    throw new TypeError(
      `M2.5.1 Workflow Policy conflicts with retained authority: ${policyResult.message}`,
    );
  }
  const capabilityRecord = assertCapabilityRecord(input.capabilityRecord, input.digests);
  const capabilityResult = input.store.installExternalBackendCapabilityRecord({
    record: capabilityRecord,
    auditEventId: auditEventId(input.ids.nextAuditEventId()),
    payloadDigest: capabilityRecord.recordDigest,
  });
  if (capabilityResult.status === 'CAPABILITY_CONFLICT') {
    throw new TypeError(
      `M2.5.1 external capability conflicts with retained authority: ${capabilityResult.message}`,
    );
  }
  const profileResult =
    createExecutionProfileInstaller(input).installExecutionProfile(profileDefinition);
  if (profileResult.status === 'PROFILE_CONFLICT') {
    throw new TypeError(
      `M2.5.1 Execution Profile conflicts with retained authority: ${profileResult.message}`,
    );
  }
  const policy = input.store.getPolicyBundle(M251_POLICY_BUNDLE_ID);
  const capability = input.store.getExternalBackendCapabilityRecord(capabilityRecord.recordDigest);
  const profile = input.store.getExecutionProfile(
    executionProfileId(M251_REAL_CODEX_EXECUTION_PROFILE_ID),
  );
  if (
    policy?.bundle.digest !== policyResult.value.bundle.digest ||
    capability?.recordDigest !== capabilityResult.value.recordDigest ||
    profile?.profile.digest !== profileResult.value.profile.digest ||
    canonicalizeJson(executionProfileProjection(profile.profile)) !==
      canonicalizeJson(executionProfileProjection(profileResult.value.profile))
  ) {
    throw new TypeError('M2.5.1 installed authority did not strictly reopen');
  }
  return Object.freeze({
    policy,
    capability,
    profile,
    governedExecutionPreflight: governedExecutionPreflight(policy, profile),
  });
}

type RuntimeProfileV2 = Extract<RuntimeExecutionProfile, { readonly schemaVersion: 2 }>;

export type M251RuntimeProfileCapabilities = Required<
  Pick<
    RuntimeProfileV2,
    | 'worker'
    | 'candidateSource'
    | 'verification'
    | 'externalWorker'
    | 'projectRead'
    | 'localCommandVerification'
    | 'protectedVerification'
  >
>;

export interface M251RuntimeProfileRegistry {
  readonly startProfile: RuntimeProfileV2;
  readonly resolver: RuntimeExecutionProfileResolver;
}

/** Creates the exact in-process capability binding without invoking the Driver or Codex. */
export function createM251RuntimeProfileRegistry(
  installed: InstalledExecutionProfile,
  capabilities: M251RuntimeProfileCapabilities,
  digests: DigestProvider,
): M251RuntimeProfileRegistry {
  const profile = installed.profile;
  if (
    profile.id !== M251_REAL_CODEX_EXECUTION_PROFILE_ID ||
    profile.version !== M251_REAL_CODEX_EXECUTION_PROFILE_VERSION ||
    profile.schemaVersion !== 2 ||
    profile.externalExecution.schemaVersion !== 3 ||
    profile.digest !== sha256Digest(digests.digest(executionProfileProjection(profile)))
  ) {
    throw new TypeError('M2.5.1 Runtime Profile capabilities do not bind formal authority');
  }
  const bound = bindRuntimeExecutionProfileAuthority(
    Object.freeze({
      schemaVersion: 2,
      profileId: profile.id,
      profileDigest: profile.digest,
      driverVersion: profile.driverVersion,
      ...capabilities,
    }),
    profile,
    true,
  );
  if (bound.schemaVersion !== 2) {
    throw new TypeError('M2.5.1 Runtime Profile did not retain external Worker authority');
  }
  const startProfile: RuntimeProfileV2 = bound;
  return Object.freeze({
    startProfile,
    resolver: Object.freeze({
      resolve: (candidate: ExecutionProfile): unknown => {
        if (
          candidate.id !== profile.id ||
          candidate.version !== profile.version ||
          candidate.digest !== profile.digest ||
          candidate.driverVersion !== profile.driverVersion ||
          candidate.digest !==
            sha256Digest(digests.digest(executionProfileProjection(candidate))) ||
          canonicalizeJson(executionProfileProjection(candidate)) !==
            canonicalizeJson(executionProfileProjection(profile))
        ) {
          throw new TypeError(
            'Installed Execution Profile has no exact trusted M2.5.1 capability binding',
          );
        }
        return startProfile;
      },
    }),
  });
}
