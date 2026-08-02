import { copyFileSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  CODEX_WORKER_DISABLED_FEATURES,
  CODEX_WORKER_CANDIDATE_TRUST_POLICY,
  CODEX_WORKER_PROMPT_PROFILE,
  CODEX_WORKER_PROMPT_TEMPLATE_DIGEST,
  createCodexWorkerDirective,
  createCodexWorkerAdapter,
  digestCanonical,
  type CodexExecutionProfileDirective,
  type CodexWorkerRequestBinding,
} from '@codeclosure/adapter-codex';
import {
  createControlledAppServerLaunch,
  isJsonObject,
  startAppServerClient,
  verifyBundledCodexInstallation,
  type AppServerProcessLaunch,
  type JsonValue,
  type VerifiedCodexInstallation,
} from '@codeclosure/codex-app-server-client';
import {
  CandidateGenerationState,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  ExternalCompactionPolicy,
  ExternalContinuityPolicy,
  ExternalFallbackPolicy,
  ExternalInterruptionPolicy,
  ExternalRetentionPolicy,
  ExternalThreadPolicy,
  ExternalWorkerDispatchPolicy,
  RunStatus,
  WorkflowPhase,
  externalBackendCapabilityRecordProjection,
  isoTimestamp,
  sha256Digest,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionIntent,
  type ExternalExecutionProfileDefinition,
} from '@codeclosure/domain';
import {
  CandidateWorkspaceAccessMode,
  canonicalizeJson,
  decodeCandidateWorkspaceLease,
  type CandidateWorkspaceLease,
  type CandidateWorkspaceLeaseAuthorityPort,
  type CandidateWorkspaceLeasePort,
  type Clock,
  type ExternalObservedWorkerPort,
  type ExternalWorkerInvocationPort,
  type PreparedExternalWorkerInvocation,
  type WorkerRequest,
} from '@codeclosure/runtime';
import type { CandidateLeasedWorkerAuthorityReader } from '@codeclosure/runtime/composition';

const disabledIntegrations = Object.freeze([
  'APPS',
  'DYNAMIC_TOOLS',
  'HOOKS',
  'MCP',
  'PLUGINS',
  'SKILLS',
  'SUBAGENTS',
  'WEB_SEARCH',
]);
const selectedCapabilities = Object.freeze(
  [
    ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
    ExternalBackendCapability.FRESH_SESSION,
    ExternalBackendCapability.OPERATION_INTERRUPT,
    ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
  ].sort(),
);

export const M2_CODEX_PERMISSION_PROFILE_ID = 'codeclosure-m2';
const M2_CODEX_SERVICE_TIER = 'default';
const M2_CODEX_TERMINAL_TIMEOUT_MILLISECONDS = 300_000;

type M2CodexItemRejectionCode =
  | 'COMMAND_ACTIONS'
  | 'COMMAND_CWD'
  | 'COMMAND_DURATION'
  | 'COMMAND_EXIT_CODE'
  | 'COMMAND_FIELD_SET'
  | 'COMMAND_ID'
  | 'COMMAND_OUTPUT'
  | 'COMMAND_PLUGIN_BINDING'
  | 'COMMAND_PROCESS_ID'
  | 'COMMAND_SOURCE'
  | 'COMMAND_STATUS'
  | 'COMMAND_TEXT'
  | 'ITEM_SCHEMA'
  | 'UNSELECTED_ITEM_TYPE';

export type M2CodexAdapterDiagnostic =
  | Readonly<{ schemaVersion: 1; kind: 'NOTIFICATION_LIMIT' }>
  | Readonly<{ schemaVersion: 1; kind: 'UNSUPPORTED_NOTIFICATION'; method: string }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'MALFORMED_ITEM' | 'ITEM_POLICY_UNAVAILABLE';
      location: 'COMPLETED' | 'STARTED' | 'TERMINAL';
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'UNSUPPORTED_ITEM';
      itemType: string;
      location: 'COMPLETED' | 'STARTED' | 'TERMINAL';
      reasonCode: M2CodexItemRejectionCode;
    }>;

export interface TrustedCodexRoots {
  readonly codexHome: string;
  readonly processHome: string;
  readonly stateRoot: string;
  readonly temporaryDirectory: string;
}

export interface TrustedCodexProfileAuthority {
  readonly adapterProfile: CodexExecutionProfileDirective;
  readonly capabilityRecord: ExternalBackendCapabilityRecord;
  readonly configurationProfileDigest: ReturnType<typeof sha256Digest>;
  readonly externalExecution: ExternalExecutionProfileDefinition;
  readonly installation: VerifiedCodexInstallation;
  readonly roots: TrustedCodexRoots;
}

export interface PrepareTrustedCodexProfileInput {
  readonly authSource?: string;
  readonly executableSearchPath?: string;
  readonly expectedInputMode?: 'CURRENT' | 'CONFIG_DIGEST_MISMATCH';
  readonly model: string;
  readonly projectRoots?: readonly string[];
  readonly probeWorkspace: string;
  readonly roots: TrustedCodexRoots;
  readonly terminalTimeoutMilliseconds?: number;
  readonly workerDispatchPolicy?: ExternalWorkerDispatchPolicy;
}

function controlledConfiguration(
  model: string,
  stateRoot: string,
  projectRoots: readonly string[],
): string {
  const projects = projectRoots
    .map((path) => `\n[projects.${JSON.stringify(path)}]\ntrust_level = "untrusted"\n`)
    .join('');
  const disabledFeatures = CODEX_WORKER_DISABLED_FEATURES.map(
    (feature) => `${feature} = false`,
  ).join('\n');
  return `model = ${JSON.stringify(model)}
model_provider = "openai"
model_reasoning_effort = "low"
approval_policy = "never"
approvals_reviewer = "user"
default_permissions = "${M2_CODEX_PERMISSION_PROFILE_ID}"
web_search = "disabled"
check_for_update_on_startup = false
allow_login_shell = false
cli_auth_credentials_store = "file"
sqlite_home = ${JSON.stringify(stateRoot)}
include_apps_instructions = false
include_collaboration_mode_instructions = false

[analytics]
enabled = false

[feedback]
enabled = false

[history]
persistence = "none"

[agents]
enabled = false

[apps._default]
enabled = false
destructive_enabled = false
open_world_enabled = false

[features]
${disabledFeatures}

[orchestrator.mcp]
enabled = false

[orchestrator.skills]
enabled = false

[skills]
include_instructions = false

[skills.bundled]
enabled = false

[shell_environment_policy]
inherit = "none"
experimental_use_profile = false

[permissions.${M2_CODEX_PERMISSION_PROFILE_ID}]
description = "CodeClosure M2 controlled Candidate workspace"

[permissions.${M2_CODEX_PERMISSION_PROFILE_ID}.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"

[permissions.${M2_CODEX_PERMISSION_PROFILE_ID}.filesystem.":workspace_roots"]
"." = "write"
".codex" = "read"
".git" = "read"
".agents" = "read"
"AGENTS.md" = "read"

[permissions.${M2_CODEX_PERMISSION_PROFILE_ID}.network]
enabled = false
${projects}`;
}

function exactRealDirectory(path: string, field: string): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`${field} must be a real directory`);
  }
  return realpathSync(path);
}

function prepareRoots(roots: TrustedCodexRoots): TrustedCodexRoots {
  for (const path of [
    roots.codexHome,
    roots.processHome,
    roots.stateRoot,
    roots.temporaryDirectory,
  ]) {
    mkdirSync(path, { mode: 0o700, recursive: true });
  }
  return Object.freeze({
    codexHome: exactRealDirectory(roots.codexHome, 'Codex home'),
    processHome: exactRealDirectory(roots.processHome, 'Codex process home'),
    stateRoot: exactRealDirectory(roots.stateRoot, 'Codex state root'),
    temporaryDirectory: exactRealDirectory(roots.temporaryDirectory, 'Codex temporary root'),
  });
}

function selectedPermissionProfile(value: JsonValue): JsonValue {
  if (!isJsonObject(value) || !Array.isArray(value['data'])) {
    throw new TypeError('Codex permission profile response is malformed');
  }
  const data = value['data'] as readonly JsonValue[];
  const selected = data.filter(
    (entry): entry is Readonly<Record<string, JsonValue>> =>
      isJsonObject(entry) && entry['id'] === M2_CODEX_PERMISSION_PROFILE_ID,
  );
  if (selected.length !== 1 || selected[0]?.['allowed'] !== true) {
    throw new TypeError('The exact CodeClosure permission profile is unavailable');
  }
  return selected[0];
}

function capabilityRecord(
  installation: VerifiedCodexInstallation,
  configurationProfileDigest: ReturnType<typeof sha256Digest>,
): ExternalBackendCapabilityRecord {
  const withoutDigest: Omit<ExternalBackendCapabilityRecord, 'recordDigest'> = Object.freeze({
    schemaVersion: 1,
    backendKind: 'CODEX_APP_SERVER',
    binaryIdentityDigest: sha256Digest(installation.profile.delegatedExecutableDigest),
    protocolSchemaDigest: sha256Digest(installation.profile.snapshotDigest),
    configurationProfileDigest,
    capabilityEntries: Object.freeze(
      selectedCapabilities.map((capability) =>
        Object.freeze({
          capability,
          classification: ExternalBackendCapabilityClassification.SUPPORTED,
          proofKind: 'M2_VERSION_BOUND_PROFILE',
        }),
      ),
    ),
    observedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
  });
  return Object.freeze({
    ...withoutDigest,
    recordDigest: sha256Digest(
      digestCanonical(externalBackendCapabilityRecordProjection(withoutDigest)),
    ),
  });
}

export async function prepareTrustedCodexProfile(
  input: PrepareTrustedCodexProfileInput,
): Promise<TrustedCodexProfileAuthority> {
  const roots = prepareRoots(input.roots);
  const probeWorkspace = exactRealDirectory(input.probeWorkspace, 'Codex profile probe workspace');
  const configuration = controlledConfiguration(
    input.model,
    roots.stateRoot,
    Object.freeze(
      [probeWorkspace, ...(input.projectRoots ?? [])]
        .map((path) => realpathSync(path))
        .sort()
        .filter((path, index, paths) => index === 0 || path !== paths[index - 1]),
    ),
  );
  writeFileSync(join(roots.codexHome, 'config.toml'), configuration, { mode: 0o600 });
  if (input.authSource !== undefined) {
    const sourceStat = lstatSync(input.authSource);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new TypeError('Codex authentication source must be a regular file');
    }
    const source = realpathSync(input.authSource);
    copyFileSync(source, join(roots.codexHome, 'auth.json'));
  }
  const installation = verifyBundledCodexInstallation();
  const launch = createControlledAppServerLaunch({
    codexHome: roots.codexHome,
    cwd: probeWorkspace,
    executableSearchPath:
      input.executableSearchPath ?? `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    installation,
    processHome: roots.processHome,
    temporaryDirectory: roots.temporaryDirectory,
  });
  const client = await startAppServerClient({
    initialize: {
      capabilities: {
        experimentalApi: false,
        mcpServerOpenaiFormElicitation: false,
        requestAttestation: false,
      },
      clientInfo: {
        name: 'codeclosure_m2_profile_probe',
        title: 'CodeClosure M2 Profile Probe',
        version: '0.0.0',
      },
    },
    launch,
    launchNonce: digestCanonical({ profile: 'm2-codex-profile-probe', cwd: probeWorkspace }),
  });
  let observation:
    | Readonly<{
        requirements: JsonValue;
        config: JsonValue;
        permissionProfile: JsonValue;
      }>
    | undefined;
  let requestFailure: Readonly<{ cause: unknown }> | undefined;
  try {
    const requirements = await client.request(
      'configRequirements/read',
      undefined,
      (value) => value,
    );
    const config = await client.request(
      'config/read',
      { cwd: probeWorkspace, includeLayers: true },
      (value) => value,
    );
    const permissionProfile = selectedPermissionProfile(
      await client.request('permissionProfile/list', { cwd: probeWorkspace }, (value) => value),
    );
    observation = Object.freeze({ requirements, config, permissionProfile });
  } catch (cause) {
    requestFailure = Object.freeze({ cause });
  }
  let close: Awaited<ReturnType<typeof client.shutdown>>;
  try {
    close = await client.shutdown();
  } catch (cause) {
    if (requestFailure !== undefined) {
      throw requestFailure.cause;
    }
    throw cause;
  }
  if (requestFailure !== undefined) {
    throw requestFailure.cause;
  }
  if (close.code !== 0) {
    throw new TypeError('Codex profile probe did not close cleanly');
  }
  if (observation === undefined) {
    throw new TypeError('Codex profile probe returned no observation');
  }
  const { requirements, config, permissionProfile } = observation;
  const instructionSources = Object.freeze([]);
  const actualConfigReadDigest = digestCanonical(config);
  const configReadDigest =
    input.expectedInputMode === 'CONFIG_DIGEST_MISMATCH'
      ? digestCanonical({ expectedProfile: 'intentional-adapter-failure' })
      : actualConfigReadDigest;
  const adapterProfile: CodexExecutionProfileDirective = Object.freeze({
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    candidateTrustPolicy: CODEX_WORKER_CANDIDATE_TRUST_POLICY,
    codexVersion: launch.summary.codexVersion,
    compactionPolicy: ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
    configReadDigest,
    controlledStateRootIdentity: launch.summary.codexHome,
    delegatedExecutableDigest: launch.summary.delegatedExecutableDigest,
    disabledIntegrations,
    environmentNames: launch.summary.environmentNames,
    fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
    instructionSourceManifestDigest: digestCanonical({ instructionSources }),
    instructionSources,
    launcherDigest: launch.summary.launcherDigest,
    managedRequirementsDigest: digestCanonical(requirements),
    maximumPromptBytes: 256 * 1024,
    model: input.model,
    modelProvider: 'openai',
    networkAccess: false,
    nonSecretEnvironmentDigest: digestCanonical(launch.summary.nonSecretEnvironment),
    permissionProfileDigest: digestCanonical(permissionProfile),
    permissionProfileId: M2_CODEX_PERMISSION_PROFILE_ID,
    promptProfile: CODEX_WORKER_PROMPT_PROFILE,
    promptTemplateDigest: CODEX_WORKER_PROMPT_TEMPLATE_DIGEST,
    protocolSnapshotDigest: launch.summary.protocolSnapshotDigest,
    reasoningEffort: 'low',
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    secretEnvironmentNames: launch.summary.secretEnvironmentNames,
    serviceTier: M2_CODEX_SERVICE_TIER,
    terminalTimeoutMilliseconds:
      input.terminalTimeoutMilliseconds ?? M2_CODEX_TERMINAL_TIMEOUT_MILLISECONDS,
    thread: Object.freeze({ kind: ExternalThreadPolicy.FRESH }),
  });
  const configurationProfileDigest = sha256Digest(
    digestCanonical({
      profile: 'codeclosure-m2-controlled-config-v1',
      configuration,
      candidateTrustPolicy: CODEX_WORKER_CANDIDATE_TRUST_POLICY,
    }),
  );
  const capability = capabilityRecord(installation, configurationProfileDigest);
  const externalExecutionBase = {
    backendKind: capability.backendKind,
    capabilityRecordDigest: capability.recordDigest,
    selectedCapabilities,
    workerPhases: Object.freeze([WorkflowPhase.IMPLEMENT]),
    binaryIdentityDigest: sha256Digest(adapterProfile.delegatedExecutableDigest),
    protocolSchemaDigest: sha256Digest(adapterProfile.protocolSnapshotDigest),
    configurationProfileDigest,
    executionConfigDigest: sha256Digest(
      digestCanonical({
        configReadDigest: adapterProfile.configReadDigest,
        candidateTrustPolicy: adapterProfile.candidateTrustPolicy,
      }),
    ),
    managedRequirementsDigest: sha256Digest(adapterProfile.managedRequirementsDigest),
    instructionSourceManifestDigest: sha256Digest(adapterProfile.instructionSourceManifestDigest),
    controlledStateRootIdentity: adapterProfile.controlledStateRootIdentity,
    environmentProjectionDigest: sha256Digest(adapterProfile.nonSecretEnvironmentDigest),
    permissionProfileId: adapterProfile.permissionProfileId,
    permissionProfileDigest: sha256Digest(adapterProfile.permissionProfileDigest),
    model: adapterProfile.model,
    modelProvider: adapterProfile.modelProvider,
    serviceTier: adapterProfile.serviceTier,
    reasoningEffort: adapterProfile.reasoningEffort,
    responseSchemaPolicy: 'M2_CLOSED_WORKER_RESULT_V1',
    disabledIntegrationsDigest: sha256Digest(digestCanonical(disabledIntegrations)),
    defaultThreadPolicy: ExternalThreadPolicy.FRESH,
    continuityPolicy: ExternalContinuityPolicy.SAME_SESSION_BOUNDED_OPERATION,
    compactionPolicy: ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
    interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
  };
  const externalExecution: ExternalExecutionProfileDefinition =
    input.workerDispatchPolicy === undefined
      ? Object.freeze({ schemaVersion: 1, ...externalExecutionBase })
      : Object.freeze({
          schemaVersion: 2,
          ...externalExecutionBase,
          workerDispatchPolicy: input.workerDispatchPolicy,
        });
  return Object.freeze({
    adapterProfile,
    capabilityRecord: capability,
    configurationProfileDigest,
    externalExecution,
    installation,
    roots,
  });
}

function requestBinding(request: WorkerRequest): CodexWorkerRequestBinding {
  const context = request.contextPackage;
  if (
    context.phase !== WorkflowPhase.IMPLEMENT ||
    context.candidateGenerationId === undefined ||
    context.candidateDigest === undefined
  ) {
    throw new TypeError('Codex invocation requires an exact IMPLEMENT Candidate binding');
  }
  return Object.freeze({
    attemptId: request.attemptId,
    candidateDigest: context.candidateDigest,
    candidateGenerationId: context.candidateGenerationId,
    contextManifestDigest: request.contextManifestDigest,
    contextManifestId: request.contextManifestId,
    executionProfileDigest: request.executionProfileDigest,
    executionProfileId: request.executionProfileId,
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    packageDigest: request.packageDigest,
    phase: context.phase,
    policyBundleDigest: context.policyBundleDigest,
    policyBundleId: context.policyBundleId,
    workerSessionId: request.workerSessionId,
    workflowId: context.workflowId,
    workflowVersion: context.workflowVersion,
  });
}

function assertIntentBinding(
  intent: ExternalExecutionIntent,
  request: WorkerRequest,
  lease: CandidateWorkspaceLease,
  authority: TrustedCodexProfileAuthority,
): void {
  const profile = authority.externalExecution;
  if (
    intent.attemptId !== request.attemptId ||
    intent.workerSessionId !== request.workerSessionId ||
    intent.contextManifestId !== request.contextManifestId ||
    intent.contextManifestDigest !== request.contextManifestDigest ||
    intent.contextPackageDigest !== request.packageDigest ||
    intent.candidateWorkspaceLeaseId !== lease.id ||
    intent.candidateWorkspaceLeaseDigest !== lease.leaseDigest ||
    intent.candidateWorkspaceCwdIdentity !== lease.root ||
    intent.processLaunchNonce.length === 0 ||
    intent.backendKind !== profile.backendKind ||
    intent.binaryIdentityDigest !== profile.binaryIdentityDigest ||
    intent.binaryProtocolSchemaDigest !== profile.protocolSchemaDigest ||
    intent.executionConfigDigest !== profile.executionConfigDigest ||
    intent.managedRequirementsDigest !== profile.managedRequirementsDigest ||
    intent.instructionSourceManifestDigest !== profile.instructionSourceManifestDigest ||
    intent.controlledStateRootIdentity !== profile.controlledStateRootIdentity ||
    intent.thread.kind !== ExternalThreadPolicy.FRESH ||
    intent.compactionPolicy !== profile.compactionPolicy
  ) {
    throw new TypeError('Runtime external intent does not bind the trusted Codex directive');
  }
}

export interface CreateTrustedCodexInvocationInput {
  readonly authority: CandidateLeasedWorkerAuthorityReader;
  readonly clock: Clock;
  readonly forbiddenRoots: readonly string[];
  readonly onAdapterDiagnostic?: (event: M2CodexAdapterDiagnostic) => void;
  readonly profile: TrustedCodexProfileAuthority;
  readonly onCandidateLease?: (lease: CandidateWorkspaceLease) => void;
  readonly workspace: CandidateWorkspaceLeasePort & CandidateWorkspaceLeaseAuthorityPort;
}

class TrustedCodexInvocation implements ExternalWorkerInvocationPort {
  readonly #input: CreateTrustedCodexInvocationInput;

  public constructor(input: CreateTrustedCodexInvocationInput) {
    this.#input = Object.freeze({
      ...input,
      forbiddenRoots: Object.freeze([...input.forbiddenRoots]),
    });
  }

  public prepare(
    input: Parameters<ExternalWorkerInvocationPort['prepare']>[0],
  ): PreparedExternalWorkerInvocation {
    if (
      input.thread.kind !== ExternalThreadPolicy.FRESH ||
      canonicalizeJson(input.profile) !== canonicalizeJson(this.#input.profile.externalExecution) ||
      (input.profile.schemaVersion === 2 &&
        input.profile.workerDispatchPolicy ===
          ExternalWorkerDispatchPolicy.ACCEPTANCE_REPAIR_ONLY &&
        input.request.contextPackage.repairContext === undefined)
    ) {
      throw new TypeError('Runtime requested an unsupported Codex execution profile');
    }
    const request = input.request;
    const context = request.contextPackage;
    const owner = this.#input.authority.getGoalWithWorkflow(context.goalId);
    const candidate = this.#input.authority.getCandidateAuthorityForWorkflow(context.workflowId);
    if (
      context.phase !== WorkflowPhase.IMPLEMENT ||
      owner === undefined ||
      candidate === undefined ||
      owner.goal.id !== context.goalId ||
      owner.goal.revision !== context.goalRevision ||
      owner.workflow.id !== context.workflowId ||
      owner.workflow.version !== context.workflowVersion ||
      owner.workflow.phase !== WorkflowPhase.IMPLEMENT ||
      owner.workflow.runStatus !== RunStatus.RUNNING ||
      owner.workflow.activeAttemptId !== request.attemptId ||
      owner.workflow.activeCandidateGenerationId !== candidate.generation.id ||
      candidate.workflowId !== owner.workflow.id ||
      candidate.candidate.goalId !== owner.goal.id ||
      candidate.generation.candidateId !== candidate.candidate.id ||
      candidate.generation.state !== CandidateGenerationState.MUTABLE ||
      candidate.generation.id !== context.candidateGenerationId ||
      candidate.generation.baseDigest !== context.candidateDigest ||
      owner.goal.scope.allowedPaths.length === 0
    ) {
      throw new TypeError('Codex invocation Candidate authority is stale or incomplete');
    }
    const lease = decodeCandidateWorkspaceLease(
      this.#input.workspace.issueLease({
        schemaVersion: 1,
        id: `worker:${request.attemptId}`,
        version: 1,
        issuedAt: this.#input.clock.now(),
        accessMode: CandidateWorkspaceAccessMode.MUTABLE,
        goalId: owner.goal.id,
        goalRevision: owner.goal.revision,
        workflowId: owner.workflow.id,
        workflowVersion: owner.workflow.version,
        generation: candidate.generation,
        allowedPaths: owner.goal.scope.allowedPaths,
        forbiddenRoots: this.#input.forbiddenRoots,
      }),
    );
    this.#input.workspace.assertLeaseCurrent(lease);
    this.#input.onCandidateLease?.(lease);
    const launch: AppServerProcessLaunch = createControlledAppServerLaunch({
      codexHome: this.#input.profile.roots.codexHome,
      cwd: lease.root,
      executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      installation: this.#input.profile.installation,
      processHome: this.#input.profile.roots.processHome,
      temporaryDirectory: this.#input.profile.roots.temporaryDirectory,
    });
    let released = false;
    let workerCreated = false;
    const release = (): void => {
      if (released) {
        return;
      }
      this.#input.workspace.releaseLease(lease);
      released = true;
    };
    return Object.freeze({
      candidateWorkspaceLeaseId: lease.id,
      candidateWorkspaceLeaseDigest: lease.leaseDigest,
      candidateWorkspaceCwdIdentity: lease.root,
      createWorker: ({
        intent,
        onLifecycleEvent,
      }: Parameters<
        PreparedExternalWorkerInvocation['createWorker']
      >[0]): ExternalObservedWorkerPort => {
        if (workerCreated || released) {
          throw new TypeError('Prepared Codex invocation is no longer available');
        }
        workerCreated = true;
        assertIntentBinding(intent, request, lease, this.#input.profile);
        const profile = Object.freeze({
          ...this.#input.profile.adapterProfile,
          thread: Object.freeze({ kind: ExternalThreadPolicy.FRESH }),
        });
        const directive = createCodexWorkerDirective({
          externalExecutionIntentDigest: intent.intentDigest,
          processLaunchNonce: intent.processLaunchNonce,
          profile,
          request: requestBinding(request),
          schemaVersion: 2,
          workspaceLease: lease,
        });
        const adapter = createCodexWorkerAdapter({
          directive,
          launch,
          ...(this.#input.onAdapterDiagnostic === undefined
            ? {}
            : { onDiagnosticEvent: this.#input.onAdapterDiagnostic }),
          onLifecycleEvent,
          observedAt: () => this.#input.clock.now(),
        });
        return Object.freeze({
          run: (workerRequest: WorkerRequest, signal: AbortSignal) =>
            adapter.run(workerRequest, signal),
          observation: () => adapter.runtimeObservation(),
        });
      },
      release,
    });
  }
}

export function createTrustedCodexInvocation(
  input: CreateTrustedCodexInvocationInput,
): ExternalWorkerInvocationPort {
  return new TrustedCodexInvocation(input);
}
