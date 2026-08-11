import { copyFileSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  CODEX_M251_WORKER_DISABLED_FEATURES,
  assertM251EffectiveConfiguration,
  createCodexWorkerAdapter,
  createCodexWorkerDirectiveV3,
  decodeCodexCandidateWorkspaceLease,
  digestCanonical,
  type CodexAdapterDiagnosticEvent,
  type CodexWorkerPhaseDirectiveV1,
  type CodexWorkerRequestBindingV3,
  type CodexWorkerSharedProfileDirectiveV1,
  type CodexWorkerSourceAuthorityV1,
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
  ExternalFallbackPolicy,
  ExternalPhaseSourceAuthorityKind,
  ExternalRetentionPolicy,
  ExternalThreadPolicy,
  RunStatus,
  WorkflowPhase,
  externalBackendCapabilityRecordProjection,
  externalExecutionPhaseDispatchEntryProjection,
  isoTimestamp,
  sha256Digest,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionIntent,
  type ExternalExecutionPhaseDispatchEntry,
  type ExternalExecutionProfileDefinitionV3,
  type Sha256Digest,
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

import type { M251PhaseExecutionAuthorityInput } from './m251-execution-authority.js';

export const M251_CODEX_PERMISSION_PROFILE_ID = 'codeclosure-m2-5-1-worker';
export const M251_CODEX_CONFIGURATION_PROFILE_ID = 'codeclosure-m2-5-1-controlled-worker-config-v1';
export const M251_CODEX_INSTRUCTION_MANIFEST_ID =
  'codeclosure-m2-5-1-automatic-instructions-empty-v1';

const supportedCodexVersion = 'codex-cli 0.146.1';
const supportedProtocolSnapshotDigest =
  'sha256:312156edfdf765f134ce5f754419a9509fd34186798a1bdbb0c219ac7c19c610';
const terminalTimeoutMilliseconds = 300_000;
const capabilityObservedAt = isoTimestamp('2026-08-10T00:00:00.000Z');

const selectedCapabilities = Object.freeze(
  [
    ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
    ExternalBackendCapability.FRESH_SESSION,
    ExternalBackendCapability.OPERATION_INTERRUPT,
    ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
  ].toSorted(),
);

export interface M251TrustedCodexRoots {
  readonly codexHome: string;
  readonly probeWorkspace: string;
  readonly processHome: string;
  readonly stateRoot: string;
  readonly temporaryDirectory: string;
}

export interface M251TrustedCodexProfileAuthority {
  readonly capabilityRecord: ExternalBackendCapabilityRecord;
  readonly configurationProfileDigest: Sha256Digest;
  readonly installation: VerifiedCodexInstallation;
  readonly phaseAuthorities: readonly M251PhaseExecutionAuthorityInput[];
  readonly roots: M251TrustedCodexRoots;
  readonly sharedProfile: CodexWorkerSharedProfileDirectiveV1;
}

export interface PrepareM251TrustedCodexProfileInput {
  readonly authSource: string;
  readonly candidateWorkspaceRoot: string;
  readonly executableSearchPath?: string;
  readonly forbiddenRoots: readonly string[];
  readonly model: string;
  readonly projectReadWorkspaceRoot: string;
  readonly roots: M251TrustedCodexRoots;
}

function codexRootPaths(roots: M251TrustedCodexRoots): readonly string[] {
  return Object.freeze([
    roots.codexHome,
    roots.probeWorkspace,
    roots.processHome,
    roots.stateRoot,
    roots.temporaryDirectory,
  ]);
}

function sameOrWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function assertExactNormalizedAbsolutePath(path: string, field: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || path !== path.normalize('NFC')) {
    throw new TypeError(`${field} must be an exact normalized absolute path`);
  }
}

function assertSeparated(paths: readonly string[]): void {
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      const leftPath = paths[left];
      const rightPath = paths[right];
      if (
        leftPath === undefined ||
        rightPath === undefined ||
        sameOrWithin(leftPath, rightPath) ||
        sameOrWithin(rightPath, leftPath)
      ) {
        throw new TypeError('M2.5.1 Codex Profile roots must be pairwise separated');
      }
    }
  }
}

function validateDeclaredRootEnvelope(input: PrepareM251TrustedCodexProfileInput): void {
  const paths = [
    input.candidateWorkspaceRoot,
    input.projectReadWorkspaceRoot,
    ...codexRootPaths(input.roots),
    ...input.forbiddenRoots,
  ];
  paths.forEach((path, index) =>
    assertExactNormalizedAbsolutePath(path, `M2.5.1 Codex Profile path ${String(index + 1)}`),
  );
  assertSeparated(paths);
}

function exactRealDirectory(path: string, field: string): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`${field} must be a real directory`);
  }
  const real = realpathSync(path);
  if (real !== path) {
    throw new TypeError(`${field} must use its exact real path`);
  }
  return real;
}

function prepareRoots(roots: M251TrustedCodexRoots): M251TrustedCodexRoots {
  for (const path of codexRootPaths(roots)) {
    mkdirSync(path, { mode: 0o700, recursive: true });
  }
  return Object.freeze({
    codexHome: exactRealDirectory(roots.codexHome, 'M2.5.1 Codex home'),
    probeWorkspace: exactRealDirectory(roots.probeWorkspace, 'M2.5.1 Codex probe workspace'),
    processHome: exactRealDirectory(roots.processHome, 'M2.5.1 Codex process home'),
    stateRoot: exactRealDirectory(roots.stateRoot, 'M2.5.1 Codex state root'),
    temporaryDirectory: exactRealDirectory(
      roots.temporaryDirectory,
      'M2.5.1 Codex temporary directory',
    ),
  });
}

function controlledConfiguration(model: string, stateRoot: string): string {
  const disabledFeatures = CODEX_M251_WORKER_DISABLED_FEATURES.map(
    (feature) => `${feature} = false`,
  ).join('\n');
  return `model = ${JSON.stringify(model)}
model_provider = "openai"
model_reasoning_effort = "low"
approval_policy = "never"
approvals_reviewer = "user"
default_permissions = "${M251_CODEX_PERMISSION_PROFILE_ID}"
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

[permissions.${M251_CODEX_PERMISSION_PROFILE_ID}]
description = "CodeClosure M2.5.1 phase-bound worker"

[permissions.${M251_CODEX_PERMISSION_PROFILE_ID}.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"

[permissions.${M251_CODEX_PERMISSION_PROFILE_ID}.filesystem.":workspace_roots"]
"." = "write"
".codex" = "deny"
".git" = "deny"
".agents" = "deny"
"AGENTS.md" = "deny"

[permissions.${M251_CODEX_PERMISSION_PROFILE_ID}.network]
enabled = false
`;
}

function selectedPermissionProfile(value: JsonValue): JsonValue {
  if (!isJsonObject(value) || !isJsonArray(value['data'])) {
    throw new TypeError('M2.5.1 Codex permission-profile response is malformed');
  }
  const selected = value['data'].filter(
    (entry): entry is Readonly<Record<string, JsonValue>> =>
      isJsonObject(entry) && entry['id'] === M251_CODEX_PERMISSION_PROFILE_ID,
  );
  if (
    selected.length !== 1 ||
    selected[0]?.['allowed'] !== true ||
    (value['nextCursor'] !== undefined && value['nextCursor'] !== null)
  ) {
    throw new TypeError('The exact M2.5.1 Codex permission profile is unavailable');
  }
  return selected[0];
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function observedString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function capabilityRecord(
  installation: VerifiedCodexInstallation,
  configurationProfileDigest: Sha256Digest,
): ExternalBackendCapabilityRecord {
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    backendKind: 'CODEX_APP_SERVER',
    binaryIdentityDigest: sha256Digest(installation.profile.delegatedExecutableDigest),
    protocolSchemaDigest: sha256Digest(installation.profile.snapshotDigest),
    configurationProfileDigest,
    capabilityEntries: Object.freeze(
      selectedCapabilities.map((capability) =>
        Object.freeze({
          capability,
          classification: ExternalBackendCapabilityClassification.SUPPORTED,
          proofKind: 'M251_PINNED_VERSION_PROFILE_PROBE',
        }),
      ),
    ),
    observedAt: capabilityObservedAt,
  });
  return Object.freeze({
    ...withoutDigest,
    recordDigest: sha256Digest(
      digestCanonical(externalBackendCapabilityRecordProjection(withoutDigest)),
    ),
  });
}

/**
 * Activates the pinned lower toolchain without starting a model Turn. The auth
 * bytes are copied only inside this lower-boundary function and are never
 * returned in the activation record.
 */
export async function prepareM251TrustedCodexProfile(
  input: PrepareM251TrustedCodexProfileInput,
): Promise<M251TrustedCodexProfileAuthority> {
  validateDeclaredRootEnvelope(input);
  const authStat = lstatSync(input.authSource);
  if (!authStat.isFile() || authStat.isSymbolicLink()) {
    throw new TypeError('M2.5.1 Codex auth source must be a regular file');
  }
  const authSource = realpathSync(input.authSource);
  if (authSource !== input.authSource) {
    throw new TypeError('M2.5.1 Codex auth source must use its exact real path');
  }
  const projectReadWorkspaceRoot = exactRealDirectory(
    input.projectReadWorkspaceRoot,
    'M2.5.1 ProjectRead workspace root',
  );
  const candidateWorkspaceRoot = exactRealDirectory(
    input.candidateWorkspaceRoot,
    'M2.5.1 Candidate workspace root',
  );
  const roots = prepareRoots(input.roots);
  assertSeparated([
    candidateWorkspaceRoot,
    projectReadWorkspaceRoot,
    ...codexRootPaths(roots),
    ...input.forbiddenRoots,
  ]);
  const configuration = controlledConfiguration(input.model, roots.stateRoot);
  writeFileSync(join(roots.codexHome, 'config.toml'), configuration, { mode: 0o600 });
  copyFileSync(authSource, join(roots.codexHome, 'auth.json'));

  const installation = verifyBundledCodexInstallation();
  if (
    installation.profile.version !== supportedCodexVersion ||
    installation.profile.snapshotDigest !== supportedProtocolSnapshotDigest
  ) {
    throw new TypeError('M2.5.1 selected Codex installation does not match the frozen baseline');
  }
  const launch = createControlledAppServerLaunch({
    codexHome: roots.codexHome,
    cwd: roots.probeWorkspace,
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
        name: 'codeclosure_m251_profile_probe',
        title: 'CodeClosure M2.5.1 Profile Probe',
        version: '0.0.0',
      },
    },
    launch,
    launchNonce: digestCanonical({ profile: M251_CODEX_CONFIGURATION_PROFILE_ID }),
  });
  let observation:
    | Readonly<{ requirements: JsonValue; config: JsonValue; permissionProfile: JsonValue }>
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
      { cwd: roots.probeWorkspace, includeLayers: true },
      (value) => value,
    );
    const permissionProfile = selectedPermissionProfile(
      await client.request(
        'permissionProfile/list',
        { cwd: roots.probeWorkspace },
        (value) => value,
      ),
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
  if (close.code !== 0 || close.failureCode !== undefined || observation === undefined) {
    throw new TypeError('M2.5.1 Codex profile probe did not close cleanly');
  }

  const configurationProfileDigest = sha256Digest(
    digestCanonical({
      profile: M251_CODEX_CONFIGURATION_PROFILE_ID,
      configuration,
      effectiveFeatures: Object.freeze({
        ...Object.fromEntries(CODEX_M251_WORKER_DISABLED_FEATURES.map((key) => [key, false])),
        remote_control: false,
      }),
    }),
  );
  const instructionSources = Object.freeze([]);
  const executionConfigDigest = sha256Digest(digestCanonical(observation.config));
  assertM251EffectiveConfiguration(observation.config, {
    executionConfigDigest,
    model: input.model,
    modelProvider: 'openai',
    permissionProfileId: M251_CODEX_PERMISSION_PROFILE_ID,
    reasoningEffort: 'low',
  });
  const permissionProfileDigest = sha256Digest(digestCanonical(observation.permissionProfile));
  const forbiddenRoots = Object.freeze(
    [...input.forbiddenRoots, ...codexRootPaths(roots)].toSorted(),
  );
  const phaseAuthorities = Object.freeze(
    [WorkflowPhase.DISCOVERY, WorkflowPhase.IMPLEMENT, WorkflowPhase.PLAN].map((phase) =>
      Object.freeze({
        phase,
        permissionProfileId: M251_CODEX_PERMISSION_PROFILE_ID,
        permissionProfileDigest,
        executionConfigDigest,
        instructionSourceManifestId: M251_CODEX_INSTRUCTION_MANIFEST_ID,
        instructionSources,
        allowedRoots: Object.freeze([
          phase === WorkflowPhase.IMPLEMENT ? candidateWorkspaceRoot : projectReadWorkspaceRoot,
        ]),
        forbiddenRoots: Object.freeze(
          [
            ...forbiddenRoots,
            phase === WorkflowPhase.IMPLEMENT ? projectReadWorkspaceRoot : candidateWorkspaceRoot,
          ].toSorted(),
        ),
      }),
    ),
  );
  return Object.freeze({
    capabilityRecord: capabilityRecord(installation, configurationProfileDigest),
    configurationProfileDigest,
    installation,
    phaseAuthorities,
    roots,
    sharedProfile: Object.freeze({
      codexVersion: launch.summary.codexVersion,
      controlledStateRootIdentity: launch.summary.codexHome,
      delegatedExecutableDigest: launch.summary.delegatedExecutableDigest,
      environmentNames: launch.summary.environmentNames,
      launcherDigest: launch.summary.launcherDigest,
      managedRequirementsDigest: digestCanonical(observation.requirements),
      maximumPromptBytes: 256 * 1024,
      model: input.model,
      modelProvider: 'openai',
      nonSecretEnvironmentDigest: digestCanonical(launch.summary.nonSecretEnvironment),
      protocolSnapshotDigest: launch.summary.protocolSnapshotDigest,
      reasoningEffort: 'low',
      retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
      serviceTier: null,
      secretEnvironmentNames: launch.summary.secretEnvironmentNames,
      terminalTimeoutMilliseconds,
      thread: Object.freeze({ kind: ExternalThreadPolicy.FRESH }),
    }),
  });
}

function requestBinding(request: WorkerRequest): CodexWorkerRequestBindingV3 {
  const context = request.contextPackage;
  const base = {
    attemptId: request.attemptId,
    contextManifestDigest: request.contextManifestDigest,
    contextManifestId: request.contextManifestId,
    executionProfileDigest: request.executionProfileDigest,
    executionProfileId: request.executionProfileId,
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    packageDigest: request.packageDigest,
    policyBundleDigest: context.policyBundleDigest,
    policyBundleId: context.policyBundleId,
    workerSessionId: request.workerSessionId,
    workflowId: context.workflowId,
    workflowVersion: context.workflowVersion,
  };
  if (context.phase === WorkflowPhase.IMPLEMENT) {
    if (context.candidateGenerationId === undefined || context.candidateDigest === undefined) {
      throw new TypeError('M2.5.1 IMPLEMENT request lacks Candidate Context authority');
    }
    return Object.freeze({
      ...base,
      candidateDigest: context.candidateDigest,
      candidateGenerationId: context.candidateGenerationId,
      phase: context.phase,
    });
  }
  if (context.phase !== WorkflowPhase.DISCOVERY && context.phase !== WorkflowPhase.PLAN) {
    throw new TypeError('M2.5.1 Codex invocation selected a non-Worker phase');
  }
  return Object.freeze({ ...base, phase: context.phase });
}

function phaseEntry(
  profile: ExternalExecutionProfileDefinitionV3,
  request: WorkerRequest,
): ExternalExecutionPhaseDispatchEntry {
  const selected = profile.phaseDispatch.find(
    (entry) => entry.phase === request.contextPackage.phase,
  );
  if (selected === undefined) {
    throw new TypeError('M2.5.1 Profile has no phase entry for the Worker request');
  }
  return selected;
}

function assertIntentBinding(
  intent: ExternalExecutionIntent,
  request: WorkerRequest,
  profile: ExternalExecutionProfileDefinitionV3,
  selectedPhase: ExternalExecutionPhaseDispatchEntry,
  source: CodexWorkerSourceAuthorityV1,
): asserts intent is Extract<ExternalExecutionIntent, { readonly schemaVersion: 2 }> {
  const context = request.contextPackage;
  const sourceMatches =
    source.kind === ExternalPhaseSourceAuthorityKind.PROJECT_READ
      ? intent.schemaVersion === 2 &&
        intent.sourceAuthority.kind === source.kind &&
        intent.sourceAuthority.projectReadAuthorityId === source.authorityRecord.id &&
        intent.sourceAuthority.projectReadAuthorityRecordDigest ===
          source.authorityRecord.recordDigest &&
        intent.sourceAuthority.snapshotCwdIdentity === source.authorityRecord.snapshotLeafRealpath
      : intent.schemaVersion === 2 &&
        intent.sourceAuthority.kind === source.kind &&
        intent.sourceAuthority.candidateWorkspaceLeaseId === source.workspaceLease.id &&
        intent.sourceAuthority.candidateWorkspaceLeaseDigest ===
          source.workspaceLease.leaseDigest &&
        intent.sourceAuthority.candidateWorkspaceCwdIdentity === source.workspaceLease.root;
  if (
    intent.schemaVersion !== 2 ||
    intent.attemptId !== request.attemptId ||
    intent.workerSessionId !== request.workerSessionId ||
    intent.contextManifestId !== request.contextManifestId ||
    intent.contextManifestDigest !== request.contextManifestDigest ||
    intent.contextPackageDigest !== request.packageDigest ||
    intent.executionProfileId !== request.executionProfileId ||
    intent.executionProfileDigest !== request.executionProfileDigest ||
    intent.goalId !== context.goalId ||
    intent.goalRevision !== context.goalRevision ||
    intent.workflowId !== context.workflowId ||
    intent.phase !== context.phase ||
    intent.policyBundleId !== context.policyBundleId ||
    intent.policyBundleDigest !== context.policyBundleDigest ||
    intent.phaseDispatchEntryDigest !==
      sha256Digest(digestCanonical(externalExecutionPhaseDispatchEntryProjection(selectedPhase))) ||
    intent.backendKind !== profile.backendKind ||
    intent.binaryIdentityDigest !== profile.binaryIdentityDigest ||
    intent.binaryProtocolSchemaDigest !== profile.protocolSchemaDigest ||
    intent.executionConfigDigest !== selectedPhase.executionConfigDigest ||
    intent.managedRequirementsDigest !== profile.managedRequirementsDigest ||
    intent.instructionSourceManifestDigest !== selectedPhase.instructionSourceManifestDigest ||
    intent.controlledStateRootIdentity !== profile.controlledStateRootIdentity ||
    intent.thread.kind !== ExternalThreadPolicy.FRESH ||
    observedString(intent.continuityPolicy) !== selectedPhase.continuityPolicy ||
    intent.compactionPolicy !== selectedPhase.compactionPolicy ||
    observedString(intent.fallbackPolicy) !== ExternalFallbackPolicy.FAIL_CLOSED ||
    observedString(intent.retentionPolicy) !== profile.retentionPolicy ||
    observedString(intent.interruptionPolicy) !== profile.interruptionPolicy ||
    !sourceMatches
  ) {
    throw new TypeError('Runtime external intent does not bind the trusted M2.5.1 directive');
  }
}

export interface CreateM251TrustedCodexInvocationInput {
  readonly authority: CandidateLeasedWorkerAuthorityReader;
  readonly clock: Clock;
  readonly forbiddenRoots: readonly string[];
  readonly onAdapterDiagnostic?: (event: CodexAdapterDiagnosticEvent) => void;
  readonly profile: M251TrustedCodexProfileAuthority;
  readonly expectedExternalProfile: ExternalExecutionProfileDefinitionV3;
  readonly workspace: CandidateWorkspaceLeasePort & CandidateWorkspaceLeaseAuthorityPort;
}

class M251TrustedCodexInvocation implements ExternalWorkerInvocationPort {
  readonly #input: CreateM251TrustedCodexInvocationInput;

  public constructor(input: CreateM251TrustedCodexInvocationInput) {
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
      input.profile.schemaVersion !== 3 ||
      canonicalizeJson(input.profile) !== canonicalizeJson(this.#input.expectedExternalProfile)
    ) {
      throw new TypeError('Runtime requested an unsupported M2.5.1 Codex Profile');
    }
    const profile = input.profile;
    const selectedPhase = phaseEntry(profile, input.request);
    const request = input.request;
    const context = request.contextPackage;
    let lease: CandidateWorkspaceLease | undefined;
    if (context.phase === WorkflowPhase.IMPLEMENT) {
      const owner = this.#input.authority.getGoalWithWorkflow(context.goalId);
      const candidate = this.#input.authority.getCandidateAuthorityForWorkflow(context.workflowId);
      if (
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
        candidate.generation.state !== CandidateGenerationState.MUTABLE ||
        candidate.generation.id !== context.candidateGenerationId ||
        candidate.generation.baseDigest !== context.candidateDigest
      ) {
        throw new TypeError('M2.5.1 Candidate invocation authority is stale or incomplete');
      }
      lease = decodeCandidateWorkspaceLease(
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
    } else if (context.phase !== WorkflowPhase.DISCOVERY && context.phase !== WorkflowPhase.PLAN) {
      throw new TypeError('M2.5.1 Codex invocation selected a non-Worker phase');
    }

    let released = false;
    let workerCreated = false;
    const release = (): void => {
      if (!released) {
        if (lease !== undefined) {
          this.#input.workspace.releaseLease(lease);
        }
        released = true;
      }
    };
    return Object.freeze({
      ...(lease === undefined
        ? {}
        : {
            candidateWorkspaceLeaseId: lease.id,
            candidateWorkspaceLeaseDigest: lease.leaseDigest,
            candidateWorkspaceCwdIdentity: lease.root,
          }),
      createWorker: ({
        intent,
        projectReadAuthority,
        onLifecycleEvent,
      }: Parameters<
        PreparedExternalWorkerInvocation['createWorker']
      >[0]): ExternalObservedWorkerPort => {
        if (workerCreated || released) {
          throw new TypeError('Prepared M2.5.1 Codex invocation is no longer available');
        }
        workerCreated = true;
        let sourceAuthority: CodexWorkerSourceAuthorityV1;
        if (selectedPhase.sourceAuthorityKind === ExternalPhaseSourceAuthorityKind.PROJECT_READ) {
          if (lease !== undefined || projectReadAuthority === undefined) {
            throw new TypeError('Candidate-free invocation lacks exact ProjectRead authority');
          }
          sourceAuthority = Object.freeze({
            kind: ExternalPhaseSourceAuthorityKind.PROJECT_READ,
            authorityRecord: projectReadAuthority,
          });
        } else {
          if (lease === undefined || projectReadAuthority !== undefined) {
            throw new TypeError('IMPLEMENT invocation lacks exact Candidate authority');
          }
          sourceAuthority = Object.freeze({
            kind: ExternalPhaseSourceAuthorityKind.CANDIDATE,
            workspaceLease: decodeCodexCandidateWorkspaceLease(lease),
          });
        }
        assertIntentBinding(intent, request, profile, selectedPhase, sourceAuthority);
        const directive = createCodexWorkerDirectiveV3({
          externalExecutionIntentDigest: intent.intentDigest,
          phaseDispatchEntryDigest: intent.phaseDispatchEntryDigest,
          processLaunchNonce: intent.processLaunchNonce,
          profile: Object.freeze({
            phase: Object.freeze({ ...selectedPhase }) as CodexWorkerPhaseDirectiveV1,
            shared: this.#input.profile.sharedProfile,
          }),
          request: requestBinding(request),
          schemaVersion: 3,
          sourceAuthority,
        });
        const cwd =
          sourceAuthority.kind === ExternalPhaseSourceAuthorityKind.PROJECT_READ
            ? sourceAuthority.authorityRecord.snapshotLeafRealpath
            : sourceAuthority.workspaceLease.root;
        const launch: AppServerProcessLaunch = createControlledAppServerLaunch({
          codexHome: this.#input.profile.roots.codexHome,
          cwd,
          executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
          installation: this.#input.profile.installation,
          processHome: this.#input.profile.roots.processHome,
          temporaryDirectory: this.#input.profile.roots.temporaryDirectory,
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

export function createM251TrustedCodexInvocation(
  input: CreateM251TrustedCodexInvocationInput,
): ExternalWorkerInvocationPort {
  return new M251TrustedCodexInvocation(input);
}
