import { Buffer } from 'node:buffer';
import { isAbsolute, relative, sep } from 'node:path';

import { parseBoundedJson, type JsonValue } from '@codeclosure/codex-app-server-client';
import {
  decodeProjectSourceReadAuthorityRecord,
  projectSourceReadAuthorityProjection,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';
import { canonicalizeJson, decodeWorkerRequest, type WorkerRequest } from '@codeclosure/runtime';

import {
  decodeCodexCandidateWorkspaceLease,
  digestCanonical,
  type CandidateWorkspaceLease,
  type CodexInstructionSourceBinding,
  type CodexThreadDirective,
} from './contracts.js';

const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export const CODEX_M251_WORKER_ADAPTER_ID = 'codex-app-server-worker';
export const CODEX_M251_WORKER_ADAPTER_VERSION = 'codeclosure-m2-5-1-worker-v1';
export const CODEX_M251_WORKER_ACTIVITY_POLICY_ID =
  'codex-worker-activity-policy_codeclosure-m2-5-1-real';
export const CODEX_M251_WORKER_ACTIVITY_POLICY_VERSION = 'codeclosure-m2-5-1-worker-activity-v1';
export const CODEX_M251_WORKER_ISOLATION_PROFILE_ID = 'codeclosure-m2-5-1-codex-phase-isolation';
export const CODEX_M251_WORKER_ISOLATION_PROFILE_VERSION =
  'codeclosure-m2-5-1-codex-phase-isolation-v1';

/**
 * Exact 0.146.1 Worker feature-denial set. The command execution features used
 * by the bounded Worker are intentionally absent. Historical M2 configuration
 * keeps its own 0.146.0 list and identity.
 */
export const CODEX_M251_WORKER_DISABLED_FEATURES = Object.freeze(
  [
    'apps',
    'apply_patch_streaming_events',
    'artifact',
    'auth_elicitation',
    'browser_use',
    'browser_use_external',
    'browser_use_full_cdp_access',
    'chronicle',
    'code_mode',
    'code_mode_buffered_exec',
    'code_mode_host',
    'code_mode_only',
    'computer_use',
    'concurrent_reasoning_summaries',
    'current_time_reminder',
    'default_mode_request_user_input',
    'deferred_executor',
    'deferred_tool_world_state',
    'enable_mcp_apps',
    'enable_request_compression',
    'exec_permission_approvals',
    'executor_capability_discovery',
    'external_agent_memory_import',
    'fast_mode',
    'goals',
    'guardian_approval',
    'guardianv2',
    'hooks',
    'image_generation',
    'in_app_browser',
    'in_app_updates',
    'local_thread_store_compression',
    'mcp_2026_07_28',
    'memories',
    'mentions_v2',
    'multi_agent',
    'multi_agent_v2',
    'network_proxy',
    'non_prefixed_mcp_tool_names',
    'personality',
    'plugin_sharing',
    'plugins',
    'prevent_idle_sleep',
    'realtime_conversation',
    'remote_compaction_v2',
    'remote_plugin',
    'request_permissions_tool',
    'respect_system_proxy',
    'rollout_budget',
    'runtime_metrics',
    'secret_auth_storage',
    'shell_snapshot',
    'shell_zsh_fork',
    'skill_mcp_dependency_install',
    'skill_search',
    'standalone_web_search',
    'terminal_visualization_instructions',
    'token_budget',
    'tool_call_mcp_elicitation',
    'tool_suggest',
    'unified_exec_zsh_fork',
    'use_agent_identity',
    'workspace_dependencies',
  ].sort(),
);

export const CODEX_M251_WORKER_DISABLED_INTEGRATIONS_PROJECTION = Object.freeze({
  schemaVersion: 1,
  profile: 'codeclosure-m2-5-1-worker-disabled-integrations-v1',
  disabledFeatures: CODEX_M251_WORKER_DISABLED_FEATURES,
  webSearch: 'DISABLED',
  apps: 'DISABLED',
  collaborationInstructions: 'DISABLED',
  mcpServers: 'EMPTY',
  orchestratorMcp: 'DISABLED',
  orchestratorSkills: 'DISABLED',
  skillInstructions: 'DISABLED',
  bundledSkills: 'DISABLED',
});

export const CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST = digestCanonical(
  CODEX_M251_WORKER_DISABLED_INTEGRATIONS_PROJECTION,
);

/** Exact effective 0.146.1 feature projection after the closed Worker flags are applied. */
export const CODEX_M251_WORKER_EFFECTIVE_FEATURES = Object.freeze({
  ...Object.fromEntries(CODEX_M251_WORKER_DISABLED_FEATURES.map((feature) => [feature, false])),
  remote_control: false,
});

export const CODEX_M251_WORKER_ACTIVITY_DISPOSITIONS = Object.freeze({
  DISCOVERY: Object.freeze({
    lifecycle: 'ADMIT_NON_AUTHORITATIVE',
    commandExecution: 'ADMIT_SNAPSHOT_READ_ONLY',
    bestEffortUnknownCommandAction: 'REJECT_DISCARD_RESULT',
    fileChange: 'REJECT_DISCARD_RESULT',
    maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
    forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
  }),
  IMPLEMENT: Object.freeze({
    lifecycle: 'ADMIT_NON_AUTHORITATIVE',
    commandExecution: 'ADMIT_CANDIDATE_BOUND',
    bestEffortUnknownCommandAction: 'REJECT_UNTIL_FREEZE_V2_COMPOSED_THEN_ADMIT_CANDIDATE_BOUND',
    fileChange: 'ADMIT_CANDIDATE_ALLOWED_PATHS',
    maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
    forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
  }),
  PLAN: Object.freeze({
    lifecycle: 'ADMIT_NON_AUTHORITATIVE',
    commandExecution: 'ADMIT_SNAPSHOT_READ_ONLY',
    bestEffortUnknownCommandAction: 'REJECT_DISCARD_RESULT',
    fileChange: 'REJECT_DISCARD_RESULT',
    maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
    forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
  }),
});

export const CODEX_M251_WORKER_ACTIVITY_POLICY_PROJECTION = Object.freeze({
  schemaVersion: 1,
  id: CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
  version: CODEX_M251_WORKER_ACTIVITY_POLICY_VERSION,
  phaseDispositions: CODEX_M251_WORKER_ACTIVITY_DISPOSITIONS,
  implementUnknownCommandActionPrerequisite: Object.freeze({
    activation: 'REQUIRED_BEFORE_IMPLEMENT_UNKNOWN_COMMAND_ACTION',
    changeSetProfile: 'candidate-change-set-v2',
    evidenceObservationSchemaVersion: 2,
    observationSchemaVersion: 2,
    requestSchemaVersion: 2,
  }),
});

export const CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST = digestCanonical(
  CODEX_M251_WORKER_ACTIVITY_POLICY_PROJECTION,
);

export type CodexM251WorkerPhase = 'DISCOVERY' | 'IMPLEMENT' | 'PLAN';

interface CodexWorkerRequestBindingV3Base {
  readonly attemptId: string;
  readonly contextManifestDigest: string;
  readonly contextManifestId: string;
  readonly executionProfileDigest: string;
  readonly executionProfileId: string;
  readonly goalId: string;
  readonly goalRevision: number;
  readonly packageDigest: string;
  readonly policyBundleDigest: string;
  readonly policyBundleId: string;
  readonly workerSessionId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
}

export type CodexWorkerRequestBindingV3 =
  | (CodexWorkerRequestBindingV3Base &
      Readonly<{
        readonly phase: 'DISCOVERY' | 'PLAN';
      }>)
  | (CodexWorkerRequestBindingV3Base &
      Readonly<{
        readonly candidateDigest: string;
        readonly candidateGenerationId: string;
        readonly phase: 'IMPLEMENT';
      }>);

export interface CodexProjectReadSourceAuthorityV1 {
  readonly kind: 'PROJECT_READ';
  readonly authorityRecord: ProjectSourceReadAuthorityRecord;
}

export interface CodexCandidateSourceAuthorityV1 {
  readonly kind: 'CANDIDATE';
  readonly workspaceLease: CandidateWorkspaceLease;
}

export type CodexWorkerSourceAuthorityV1 =
  CodexProjectReadSourceAuthorityV1 | CodexCandidateSourceAuthorityV1;

export interface CodexWorkerPhaseDirectiveV1 {
  readonly phase: CodexM251WorkerPhase;
  readonly workerAdapter: string;
  readonly workerAdapterVersion: string;
  readonly cwdKind: 'PROJECT_READ_SNAPSHOT' | 'CANDIDATE_WORKSPACE';
  readonly sourceAuthorityKind: 'PROJECT_READ' | 'CANDIDATE';
  readonly permissionProfileId: string;
  readonly permissionProfileDigest: string;
  readonly isolationProfileId: string;
  readonly isolationProfileDigest: string;
  readonly projectConfigurationPolicy: 'DISABLED';
  readonly configurationProfileDigest: string;
  readonly executionConfigDigest: string;
  readonly disabledIntegrationsDigest: string;
  readonly instructionSourceManifestId: string;
  readonly instructionSourceManifestDigest: string;
  readonly instructionSources: readonly CodexInstructionSourceBinding[];
  readonly capabilityGrantDigest: string;
  readonly responseContractDigest: string;
  readonly responseSchemaPolicy: 'PROPOSALS_V1' | 'COMPLETION_REQUEST_V1';
  readonly workerActivityPolicyId: string;
  readonly workerActivityPolicyDigest: string;
  readonly commandNetworkPolicy: 'DENIED';
  readonly approvalPolicy: 'NEVER';
  readonly continuityPolicy: 'SAME_SESSION_BOUNDED_OPERATION';
  readonly compactionPolicy: 'FAIL_ON_OBSERVATION' | 'MANUAL_BEFORE_OPERATION';
  readonly fallbackPolicy: 'FAIL_CLOSED';
  readonly allowedRoots: readonly string[];
  readonly forbiddenRoots: readonly string[];
}

export type CodexWorkerPhaseIsolationInputV1 = Omit<
  CodexWorkerPhaseDirectiveV1,
  'isolationProfileId' | 'isolationProfileDigest'
>;

export function codexM251WorkerIsolationProfileProjection(
  phase: CodexWorkerPhaseIsolationInputV1,
): unknown {
  const candidateFree = phase.phase !== 'IMPLEMENT';
  return Object.freeze({
    schemaVersion: 1,
    id: CODEX_M251_WORKER_ISOLATION_PROFILE_ID,
    version: CODEX_M251_WORKER_ISOLATION_PROFILE_VERSION,
    phase: phase.phase,
    cwdKind: phase.cwdKind,
    sourceAuthorityKind: phase.sourceAuthorityKind,
    sourceRootPolicy: 'EXACT_ATTEMPT_SOURCE_WITHIN_REGISTERED_ROOT',
    permissionProfileId: phase.permissionProfileId,
    permissionProfileDigest: phase.permissionProfileDigest,
    projectConfigurationPolicy: phase.projectConfigurationPolicy,
    configurationProfileDigest: phase.configurationProfileDigest,
    executionConfigDigest: phase.executionConfigDigest,
    disabledIntegrationsDigest: phase.disabledIntegrationsDigest,
    instructionSourceManifestId: phase.instructionSourceManifestId,
    instructionSourceManifestDigest: phase.instructionSourceManifestDigest,
    commandNetworkPolicy: phase.commandNetworkPolicy,
    approvalPolicy: phase.approvalPolicy,
    sandboxPolicy: candidateFree
      ? Object.freeze({ type: 'READ_ONLY', networkAccess: false })
      : Object.freeze({
          type: 'WORKSPACE_WRITE',
          networkAccess: false,
          writableRootPolicy: 'EXACT_SOURCE_CWD',
        }),
    allowedRoots: phase.allowedRoots,
    forbiddenRoots: phase.forbiddenRoots,
  });
}

export function codexM251WorkerIsolationProfileDigest(
  phase: CodexWorkerPhaseIsolationInputV1,
): string {
  return digestCanonical(codexM251WorkerIsolationProfileProjection(phase));
}

export interface CodexWorkerSharedProfileDirectiveV1 {
  readonly codexVersion: string;
  readonly controlledStateRootIdentity: string;
  readonly delegatedExecutableDigest: string;
  readonly environmentNames: readonly string[];
  readonly launcherDigest: string;
  readonly managedRequirementsDigest: string;
  readonly maximumPromptBytes: number;
  readonly model: string;
  readonly modelProvider: string;
  readonly nonSecretEnvironmentDigest: string;
  readonly protocolSnapshotDigest: string;
  readonly reasoningEffort: string;
  readonly retentionPolicy: 'CONTROLLED';
  readonly serviceTier: string | null;
  readonly secretEnvironmentNames: readonly string[];
  readonly terminalTimeoutMilliseconds: number;
  readonly thread: CodexThreadDirective;
}

export interface CodexWorkerDirectiveV3 {
  readonly directiveDigest: string;
  readonly externalExecutionIntentDigest: string;
  readonly phaseDispatchEntryDigest: string;
  readonly processLaunchNonce: string;
  readonly profile: Readonly<{
    readonly phase: CodexWorkerPhaseDirectiveV1;
    readonly shared: CodexWorkerSharedProfileDirectiveV1;
  }>;
  readonly request: CodexWorkerRequestBindingV3;
  readonly schemaVersion: 3;
  readonly sourceAuthority: CodexWorkerSourceAuthorityV1;
}

export type CodexWorkerActivityAdmissionDisposition = 'PENDING' | 'ADMITTED' | 'REJECTED_DISCARDED';

export type CodexWorkerSourceAuthorityReceiptV1 =
  | Readonly<{
      readonly kind: 'PROJECT_READ';
      readonly projectReadAuthorityId: string;
      readonly projectReadAuthorityRecordDigest: string;
      readonly snapshotCwdIdentity: string;
    }>
  | Readonly<{
      readonly kind: 'CANDIDATE';
      readonly candidateWorkspaceCwdIdentity: string;
      readonly candidateWorkspaceLeaseDigest: string;
      readonly candidateWorkspaceLeaseId: string;
    }>;

export interface CodexAdapterObservationV2 {
  readonly activityDisposition: CodexWorkerActivityAdmissionDisposition;
  readonly approvalRequestCount: number;
  readonly backendOperationRef?: string;
  readonly backendSessionRef?: string;
  readonly compactionCount: number;
  readonly directiveDigest: string;
  readonly externalExecutionIntentDigest: string;
  readonly failureCode?: string;
  readonly notificationCount: number;
  readonly phase: CodexM251WorkerPhase;
  readonly phaseDispatchEntryDigest: string;
  readonly processLaunchCount: number;
  readonly requestAttemptId: string;
  readonly requestWorkerSessionId: string;
  readonly resultEventId?: string;
  readonly schemaVersion: 2;
  readonly sourceAuthority: CodexWorkerSourceAuthorityReceiptV1;
  readonly state: 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
  readonly threadRequestCount: number;
  readonly turnInterruptCount: number;
  readonly turnRequestCount: number;
  readonly workerActivityPolicyDigest: string;
  readonly workerActivityPolicyId: string;
}

export type CodexWorkerResultV3 =
  | Readonly<{
      readonly kind: 'PROPOSALS';
      readonly proposals: readonly Readonly<{
        readonly kind: string;
        readonly sourceRefs: readonly string[];
        readonly summary: string;
      }>[];
    }>
  | Readonly<{
      readonly claimedScope: string;
      readonly kind: 'COMPLETION_REQUEST';
      readonly proposedEvidenceRefs: readonly string[];
      readonly summary: string;
    }>;

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new TypeError(`${field} has unknown or missing fields`);
  }
}

function nonBlankString(value: unknown, field: string, maximumBytes = 16_384): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.includes('\u0000') ||
    Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    throw new TypeError(`${field} must be a bounded non-blank string`);
  }
  return value;
}

function digest(value: unknown, field: string): string {
  const decoded = nonBlankString(value, field, 71);
  if (!digestPattern.test(decoded)) {
    throw new TypeError(`${field} must be a sha256 digest`);
  }
  return decoded;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function exactLiteral<const Value extends string | number | boolean | null>(
  value: unknown,
  expected: Value,
  field: string,
): Value {
  if (value !== expected) {
    throw new TypeError(`${field} is unsupported`);
  }
  return expected;
}

function sortedUniqueStrings(
  value: unknown,
  field: string,
  options: Readonly<{ absolute?: boolean; nonEmpty?: boolean }> = {},
): readonly string[] {
  if (!Array.isArray(value) || (options.nonEmpty === true && value.length === 0)) {
    throw new TypeError(`${field} must be an array`);
  }
  const decoded = value.map((entry) => nonBlankString(entry, field));
  for (let index = 0; index < decoded.length; index += 1) {
    const current = decoded[index];
    if (
      current === undefined ||
      (options.absolute === true && !isAbsolute(current)) ||
      (index > 0 && (decoded[index - 1] ?? '') >= current)
    ) {
      throw new TypeError(
        `${field} must be uniquely sorted${options.absolute === true ? ' absolute paths' : ''}`,
      );
    }
  }
  return Object.freeze(decoded);
}

function isSameOrWithin(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrWithin(left, right) || isSameOrWithin(right, left);
}

function decodeInstructionSources(value: unknown): readonly CodexInstructionSourceBinding[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError('phase instructionSources must be a bounded array');
  }
  const decoded = value.map((entry, index) => {
    const input = object(entry, `phase instructionSources[${String(index)}]`);
    exactKeys(input, ['digest', 'path'], 'phase instruction source');
    const path = nonBlankString(input['path'], 'phase instruction source path');
    if (!isAbsolute(path)) {
      throw new TypeError('phase instruction source path must be absolute');
    }
    return Object.freeze({
      digest: digest(input['digest'], 'phase instruction source digest'),
      path,
    });
  });
  for (let index = 1; index < decoded.length; index += 1) {
    if ((decoded[index - 1]?.path ?? '') >= (decoded[index]?.path ?? '')) {
      throw new TypeError('phase instruction sources must be uniquely sorted by path');
    }
  }
  return Object.freeze(decoded);
}

function decodeThread(value: unknown): CodexThreadDirective {
  const input = object(value, 'shared profile thread');
  if (input['kind'] === 'FRESH') {
    exactKeys(input, ['kind'], 'shared profile thread');
    return Object.freeze({ kind: 'FRESH' });
  }
  if (input['kind'] === 'RESUME') {
    exactKeys(input, ['backendSessionRef', 'kind', 'resumeBindingDigest'], 'shared profile thread');
    return Object.freeze({
      backendSessionRef: nonBlankString(input['backendSessionRef'], 'thread backendSessionRef'),
      kind: 'RESUME',
      resumeBindingDigest: digest(input['resumeBindingDigest'], 'thread resumeBindingDigest'),
    });
  }
  throw new TypeError('shared profile thread is unsupported');
}

function decodeSharedProfile(value: unknown): CodexWorkerSharedProfileDirectiveV1 {
  const input = object(value, 'Codex Worker v3 shared profile');
  exactKeys(
    input,
    [
      'codexVersion',
      'controlledStateRootIdentity',
      'delegatedExecutableDigest',
      'environmentNames',
      'launcherDigest',
      'managedRequirementsDigest',
      'maximumPromptBytes',
      'model',
      'modelProvider',
      'nonSecretEnvironmentDigest',
      'protocolSnapshotDigest',
      'reasoningEffort',
      'retentionPolicy',
      'serviceTier',
      'secretEnvironmentNames',
      'terminalTimeoutMilliseconds',
      'thread',
    ],
    'Codex Worker v3 shared profile',
  );
  const controlledStateRootIdentity = nonBlankString(
    input['controlledStateRootIdentity'],
    'shared controlled state root',
  );
  if (!isAbsolute(controlledStateRootIdentity)) {
    throw new TypeError('shared controlled state root must be absolute');
  }
  const serviceTier = input['serviceTier'];
  if (serviceTier !== null && typeof serviceTier !== 'string') {
    throw new TypeError('shared service tier is invalid');
  }
  return Object.freeze({
    codexVersion: nonBlankString(input['codexVersion'], 'shared Codex version'),
    controlledStateRootIdentity,
    delegatedExecutableDigest: digest(
      input['delegatedExecutableDigest'],
      'shared delegated executable digest',
    ),
    environmentNames: sortedUniqueStrings(input['environmentNames'], 'shared environment names'),
    launcherDigest: digest(input['launcherDigest'], 'shared launcher digest'),
    managedRequirementsDigest: digest(
      input['managedRequirementsDigest'],
      'shared managed requirements digest',
    ),
    maximumPromptBytes: positiveInteger(input['maximumPromptBytes'], 'shared maximum prompt bytes'),
    model: nonBlankString(input['model'], 'shared model'),
    modelProvider: nonBlankString(input['modelProvider'], 'shared model provider'),
    nonSecretEnvironmentDigest: digest(
      input['nonSecretEnvironmentDigest'],
      'shared non-secret environment digest',
    ),
    protocolSnapshotDigest: digest(
      input['protocolSnapshotDigest'],
      'shared protocol snapshot digest',
    ),
    reasoningEffort: nonBlankString(input['reasoningEffort'], 'shared reasoning effort'),
    retentionPolicy: exactLiteral(
      input['retentionPolicy'],
      'CONTROLLED',
      'shared retention policy',
    ),
    serviceTier: serviceTier === null ? null : nonBlankString(serviceTier, 'shared service tier'),
    secretEnvironmentNames: sortedUniqueStrings(
      input['secretEnvironmentNames'],
      'shared secret environment names',
    ),
    terminalTimeoutMilliseconds: positiveInteger(
      input['terminalTimeoutMilliseconds'],
      'shared terminal timeout',
    ),
    thread: decodeThread(input['thread']),
  });
}

function decodePhase(value: unknown): CodexWorkerPhaseDirectiveV1 {
  const input = object(value, 'Codex Worker v3 phase profile');
  exactKeys(
    input,
    [
      'allowedRoots',
      'approvalPolicy',
      'capabilityGrantDigest',
      'commandNetworkPolicy',
      'compactionPolicy',
      'configurationProfileDigest',
      'continuityPolicy',
      'cwdKind',
      'disabledIntegrationsDigest',
      'executionConfigDigest',
      'fallbackPolicy',
      'forbiddenRoots',
      'instructionSourceManifestDigest',
      'instructionSourceManifestId',
      'instructionSources',
      'isolationProfileDigest',
      'isolationProfileId',
      'permissionProfileDigest',
      'permissionProfileId',
      'phase',
      'projectConfigurationPolicy',
      'responseContractDigest',
      'responseSchemaPolicy',
      'sourceAuthorityKind',
      'workerActivityPolicyDigest',
      'workerActivityPolicyId',
      'workerAdapter',
      'workerAdapterVersion',
    ],
    'Codex Worker v3 phase profile',
  );
  const phase = input['phase'];
  if (phase !== 'DISCOVERY' && phase !== 'IMPLEMENT' && phase !== 'PLAN') {
    throw new TypeError('Codex Worker v3 phase is unsupported');
  }
  const candidateFree = phase !== 'IMPLEMENT';
  const cwdKind = candidateFree
    ? exactLiteral(input['cwdKind'], 'PROJECT_READ_SNAPSHOT', 'phase cwd kind')
    : exactLiteral(input['cwdKind'], 'CANDIDATE_WORKSPACE', 'phase cwd kind');
  const sourceAuthorityKind = candidateFree
    ? exactLiteral(input['sourceAuthorityKind'], 'PROJECT_READ', 'phase source authority kind')
    : exactLiteral(input['sourceAuthorityKind'], 'CANDIDATE', 'phase source authority kind');
  const responseSchemaPolicy = candidateFree
    ? exactLiteral(input['responseSchemaPolicy'], 'PROPOSALS_V1', 'phase response schema policy')
    : exactLiteral(
        input['responseSchemaPolicy'],
        'COMPLETION_REQUEST_V1',
        'phase response schema policy',
      );
  const compactionPolicy = input['compactionPolicy'];
  if (
    compactionPolicy !== 'FAIL_ON_OBSERVATION' &&
    compactionPolicy !== 'MANUAL_BEFORE_OPERATION'
  ) {
    throw new TypeError('phase compaction policy is unsupported');
  }
  const allowedRoots = sortedUniqueStrings(input['allowedRoots'], 'phase allowed roots', {
    absolute: true,
    nonEmpty: true,
  });
  const forbiddenRoots = sortedUniqueStrings(input['forbiddenRoots'], 'phase forbidden roots', {
    absolute: true,
    nonEmpty: true,
  });
  if (
    allowedRoots.some((allowed) =>
      forbiddenRoots.some((forbidden) => pathsOverlap(allowed, forbidden)),
    )
  ) {
    throw new TypeError('phase allowed and forbidden roots overlap');
  }
  const instructionSources = decodeInstructionSources(input['instructionSources']);
  const instructionSourceManifestDigest = digest(
    input['instructionSourceManifestDigest'],
    'phase instruction-source manifest digest',
  );
  if (instructionSourceManifestDigest !== digestCanonical({ instructionSources })) {
    throw new TypeError('phase instruction-source manifest digest is inconsistent');
  }
  const workerActivityPolicyId = nonBlankString(
    input['workerActivityPolicyId'],
    'phase Worker activity-policy ID',
  );
  const workerActivityPolicyDigest = digest(
    input['workerActivityPolicyDigest'],
    'phase Worker activity-policy digest',
  );
  if (
    input['workerAdapter'] !== CODEX_M251_WORKER_ADAPTER_ID ||
    input['workerAdapterVersion'] !== CODEX_M251_WORKER_ADAPTER_VERSION ||
    workerActivityPolicyId !== CODEX_M251_WORKER_ACTIVITY_POLICY_ID ||
    workerActivityPolicyDigest !== CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST
  ) {
    throw new TypeError('Codex Worker v3 phase selected an unsupported Adapter or activity policy');
  }
  const disabledIntegrationsDigest = digest(
    input['disabledIntegrationsDigest'],
    'phase disabled integrations digest',
  );
  if (disabledIntegrationsDigest !== CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST) {
    throw new TypeError('Codex Worker v3 phase selected unsupported disabled integrations');
  }
  const withoutIsolation: CodexWorkerPhaseIsolationInputV1 = Object.freeze({
    phase,
    workerAdapter: CODEX_M251_WORKER_ADAPTER_ID,
    workerAdapterVersion: CODEX_M251_WORKER_ADAPTER_VERSION,
    cwdKind,
    sourceAuthorityKind,
    permissionProfileId: nonBlankString(
      input['permissionProfileId'],
      'phase permission profile ID',
    ),
    permissionProfileDigest: digest(
      input['permissionProfileDigest'],
      'phase permission profile digest',
    ),
    projectConfigurationPolicy: exactLiteral(
      input['projectConfigurationPolicy'],
      'DISABLED',
      'phase project configuration policy',
    ),
    configurationProfileDigest: digest(
      input['configurationProfileDigest'],
      'phase configuration profile digest',
    ),
    executionConfigDigest: digest(input['executionConfigDigest'], 'phase execution config digest'),
    disabledIntegrationsDigest,
    instructionSourceManifestId: nonBlankString(
      input['instructionSourceManifestId'],
      'phase instruction-source manifest ID',
    ),
    instructionSourceManifestDigest,
    instructionSources,
    capabilityGrantDigest: digest(input['capabilityGrantDigest'], 'phase capability grant digest'),
    responseContractDigest: digest(
      input['responseContractDigest'],
      'phase response contract digest',
    ),
    responseSchemaPolicy,
    workerActivityPolicyId,
    workerActivityPolicyDigest,
    commandNetworkPolicy: exactLiteral(
      input['commandNetworkPolicy'],
      'DENIED',
      'phase command network policy',
    ),
    approvalPolicy: exactLiteral(input['approvalPolicy'], 'NEVER', 'phase approval policy'),
    continuityPolicy: exactLiteral(
      input['continuityPolicy'],
      'SAME_SESSION_BOUNDED_OPERATION',
      'phase continuity policy',
    ),
    compactionPolicy,
    fallbackPolicy: exactLiteral(input['fallbackPolicy'], 'FAIL_CLOSED', 'phase fallback policy'),
    allowedRoots,
    forbiddenRoots,
  });
  const isolationProfileId = nonBlankString(
    input['isolationProfileId'],
    'phase isolation profile ID',
  );
  const isolationProfileDigest = digest(
    input['isolationProfileDigest'],
    'phase isolation profile digest',
  );
  if (
    isolationProfileId !== CODEX_M251_WORKER_ISOLATION_PROFILE_ID ||
    isolationProfileDigest !== codexM251WorkerIsolationProfileDigest(withoutIsolation)
  ) {
    throw new TypeError('Codex Worker v3 phase selected an unsupported isolation profile');
  }
  return Object.freeze({
    ...withoutIsolation,
    isolationProfileId,
    isolationProfileDigest,
  });
}

function decodeRequestBinding(value: unknown): CodexWorkerRequestBindingV3 {
  const input = object(value, 'Codex Worker v3 request binding');
  const phase = input['phase'];
  const commonKeys = [
    'attemptId',
    'contextManifestDigest',
    'contextManifestId',
    'executionProfileDigest',
    'executionProfileId',
    'goalId',
    'goalRevision',
    'packageDigest',
    'phase',
    'policyBundleDigest',
    'policyBundleId',
    'workerSessionId',
    'workflowId',
    'workflowVersion',
  ];
  if (phase !== 'DISCOVERY' && phase !== 'IMPLEMENT' && phase !== 'PLAN') {
    throw new TypeError('Codex Worker v3 request phase is unsupported');
  }
  exactKeys(
    input,
    phase === 'IMPLEMENT'
      ? [...commonKeys, 'candidateDigest', 'candidateGenerationId']
      : commonKeys,
    'Codex Worker v3 request binding',
  );
  const base = {
    attemptId: nonBlankString(input['attemptId'], 'request attempt ID'),
    contextManifestDigest: digest(
      input['contextManifestDigest'],
      'request Context Manifest digest',
    ),
    contextManifestId: nonBlankString(input['contextManifestId'], 'request Context Manifest ID'),
    executionProfileDigest: digest(
      input['executionProfileDigest'],
      'request Execution Profile digest',
    ),
    executionProfileId: nonBlankString(input['executionProfileId'], 'request Execution Profile ID'),
    goalId: nonBlankString(input['goalId'], 'request Goal ID'),
    goalRevision: positiveInteger(input['goalRevision'], 'request Goal revision'),
    packageDigest: digest(input['packageDigest'], 'request package digest'),
    policyBundleDigest: digest(input['policyBundleDigest'], 'request Policy digest'),
    policyBundleId: nonBlankString(input['policyBundleId'], 'request Policy ID'),
    workerSessionId: nonBlankString(input['workerSessionId'], 'request Worker Session ID'),
    workflowId: nonBlankString(input['workflowId'], 'request Workflow ID'),
    workflowVersion: positiveInteger(input['workflowVersion'], 'request Workflow version'),
  };
  return phase === 'IMPLEMENT'
    ? Object.freeze({
        ...base,
        candidateDigest: digest(input['candidateDigest'], 'request Candidate digest'),
        candidateGenerationId: nonBlankString(
          input['candidateGenerationId'],
          'request Candidate Generation ID',
        ),
        phase,
      })
    : Object.freeze({ ...base, phase });
}

export function codexWorkerSourceAuthorityReceiptV1(
  sourceAuthority: CodexWorkerSourceAuthorityV1,
): CodexWorkerSourceAuthorityReceiptV1 {
  if (sourceAuthority.kind === 'PROJECT_READ') {
    return Object.freeze({
      kind: sourceAuthority.kind,
      projectReadAuthorityId: sourceAuthority.authorityRecord.id,
      projectReadAuthorityRecordDigest: sourceAuthority.authorityRecord.recordDigest,
      snapshotCwdIdentity: sourceAuthority.authorityRecord.snapshotLeafRealpath,
    });
  }
  return Object.freeze({
    kind: sourceAuthority.kind,
    candidateWorkspaceCwdIdentity: sourceAuthority.workspaceLease.root,
    candidateWorkspaceLeaseDigest: sourceAuthority.workspaceLease.leaseDigest,
    candidateWorkspaceLeaseId: sourceAuthority.workspaceLease.id,
  });
}

function decodeSourceAuthority(value: unknown): CodexWorkerSourceAuthorityV1 {
  const input = object(value, 'Codex Worker v3 source authority');
  if (input['kind'] === 'PROJECT_READ') {
    exactKeys(input, ['authorityRecord', 'kind'], 'Codex Worker v3 project-read source authority');
    const authorityRecord = decodeProjectSourceReadAuthorityRecord(input['authorityRecord']);
    if (
      authorityRecord.recordDigest !==
      digestCanonical(projectSourceReadAuthorityProjection(authorityRecord))
    ) {
      throw new TypeError('project-read authority record digest is inconsistent');
    }
    return Object.freeze({
      authorityRecord,
      kind: 'PROJECT_READ',
    });
  }
  if (input['kind'] === 'CANDIDATE') {
    exactKeys(input, ['kind', 'workspaceLease'], 'Codex Worker v3 Candidate source authority');
    return Object.freeze({
      kind: 'CANDIDATE',
      workspaceLease: decodeCodexCandidateWorkspaceLease(input['workspaceLease']),
    });
  }
  throw new TypeError('Codex Worker v3 source authority kind is unsupported');
}

function requestMatchesContext(
  binding: CodexWorkerRequestBindingV3,
  request: WorkerRequest,
): boolean {
  const context = request.contextPackage;
  return (
    request.workerSessionId === binding.workerSessionId &&
    request.attemptId === binding.attemptId &&
    request.contextManifestId === binding.contextManifestId &&
    request.contextManifestDigest === binding.contextManifestDigest &&
    request.packageDigest === binding.packageDigest &&
    request.executionProfileId === binding.executionProfileId &&
    request.executionProfileDigest === binding.executionProfileDigest &&
    context.goalId === binding.goalId &&
    context.goalRevision === binding.goalRevision &&
    context.workflowId === binding.workflowId &&
    context.workflowVersion === binding.workflowVersion &&
    context.phase === binding.phase &&
    context.policyBundleId === binding.policyBundleId &&
    context.policyBundleDigest === binding.policyBundleDigest
  );
}

function expectedCapabilityGrant(phase: CodexM251WorkerPhase): Readonly<Record<string, unknown>> {
  if (phase === 'IMPLEMENT') {
    return Object.freeze({
      phase,
      projectRead: true,
      candidateAccess: 'MUTABLE_WRITE',
      runOutputScope: 'BOUNDED_IMPLEMENTATION',
      controlSubmission: 'COMPLETION_REQUEST',
      acceptanceAccess: 'NONE',
      allowedActions: Object.freeze([
        'READ_PROJECT',
        'READ_CANDIDATE',
        'WRITE_CANDIDATE_SOURCE',
        'WRITE_RUN_OUTPUT',
        'SUBMIT_COMPLETION_REQUEST',
      ]),
    });
  }
  return Object.freeze({
    phase,
    projectRead: true,
    candidateAccess: 'NONE',
    runOutputScope: phase === 'DISCOVERY' ? 'BOUNDED_DISCOVERY' : 'PLAN_OBSERVATION',
    controlSubmission: 'PROPOSALS',
    acceptanceAccess: 'NONE',
    allowedActions: Object.freeze(['READ_PROJECT', 'WRITE_RUN_OUTPUT', 'SUBMIT_PROPOSALS']),
  });
}

function expectedResponseContract(phase: CodexM251WorkerPhase): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: 1,
    workerEventSchemaVersion: 1,
    allowedResultKinds: Object.freeze([phase === 'IMPLEMENT' ? 'COMPLETION_REQUEST' : 'PROPOSALS']),
    unknownFields: 'REJECT',
    maxEventBytes: 65_536,
  });
}

function assertDirectiveInternalBinding(directive: CodexWorkerDirectiveV3): void {
  const phase = directive.profile.phase;
  const request = directive.request;
  const source = directive.sourceAuthority;
  if (
    phase.phase !== request.phase ||
    phase.sourceAuthorityKind !== source.kind ||
    directive.phaseDispatchEntryDigest !== digestCanonical(phase)
  ) {
    throw new TypeError(
      'Codex Worker v3 phase, request, source, or phase-entry digest is inconsistent',
    );
  }
  const cwd =
    source.kind === 'PROJECT_READ'
      ? source.authorityRecord.snapshotLeafRealpath
      : source.workspaceLease.root;
  if (
    !phase.allowedRoots.some((root) => isSameOrWithin(cwd, root)) ||
    phase.forbiddenRoots.some((root) => pathsOverlap(root, cwd)) ||
    !phase.forbiddenRoots.includes(directive.profile.shared.controlledStateRootIdentity) ||
    phase.instructionSources.some((entry) => !isSameOrWithin(entry.path, cwd))
  ) {
    throw new TypeError('Codex Worker v3 source cwd is outside the selected phase roots');
  }
  if (source.kind === 'PROJECT_READ') {
    const authority = source.authorityRecord;
    if (
      request.phase === 'IMPLEMENT' ||
      authority.phase !== request.phase ||
      request.goalId !== authority.goalId ||
      request.goalRevision !== authority.goalRevision ||
      request.workflowId !== authority.workflowId ||
      request.workflowVersion !== authority.workflowVersion ||
      request.attemptId !== authority.attemptId ||
      request.executionProfileId !== authority.executionProfileId ||
      request.executionProfileDigest !== authority.executionProfileDigest ||
      request.policyBundleId !== authority.policyBundleId ||
      request.policyBundleDigest !== authority.policyBundleDigest ||
      directive.phaseDispatchEntryDigest !== authority.phaseDispatchEntryDigest ||
      phase.capabilityGrantDigest !== authority.capabilityGrantDigest ||
      phase.responseContractDigest !== authority.responseContractDigest ||
      phase.isolationProfileId !== authority.isolationProfileId ||
      phase.isolationProfileDigest !== authority.isolationProfileDigest ||
      !phase.allowedRoots.some((root) => isSameOrWithin(authority.workspaceRootIdentity, root)) ||
      phase.forbiddenRoots.some((root) => !authority.forbiddenRoots.includes(root))
    ) {
      throw new TypeError('Project-read source authority does not bind the v3 request');
    }
  } else {
    const lease = source.workspaceLease;
    if (
      request.phase !== 'IMPLEMENT' ||
      !phase.allowedRoots.some((root) => isSameOrWithin(lease.workspaceRootIdentity, root)) ||
      phase.forbiddenRoots.some((root) => !lease.forbiddenRoots.includes(root)) ||
      request.goalId !== lease.goalId ||
      request.goalRevision !== lease.goalRevision ||
      request.workflowId !== lease.workflowId ||
      request.workflowVersion !== lease.workflowVersion ||
      request.candidateGenerationId !== lease.candidateGenerationId ||
      request.candidateDigest !== lease.candidateDigest
    ) {
      throw new TypeError('Candidate source authority does not bind the v3 request');
    }
  }
}

export function codexWorkerDirectiveV3Projection(
  directive: Omit<CodexWorkerDirectiveV3, 'directiveDigest'>,
): unknown {
  return {
    externalExecutionIntentDigest: directive.externalExecutionIntentDigest,
    phaseDispatchEntryDigest: directive.phaseDispatchEntryDigest,
    processLaunchNonce: directive.processLaunchNonce,
    profile: directive.profile,
    request: directive.request,
    schemaVersion: directive.schemaVersion,
    sourceAuthority: codexWorkerSourceAuthorityReceiptV1(directive.sourceAuthority),
  };
}

export function decodeCodexWorkerDirectiveV3(value: unknown): CodexWorkerDirectiveV3 {
  const input = object(value, 'Codex Worker v3 directive');
  exactKeys(
    input,
    [
      'directiveDigest',
      'externalExecutionIntentDigest',
      'phaseDispatchEntryDigest',
      'processLaunchNonce',
      'profile',
      'request',
      'schemaVersion',
      'sourceAuthority',
    ],
    'Codex Worker v3 directive',
  );
  const profileInput = object(input['profile'], 'Codex Worker v3 profile');
  exactKeys(profileInput, ['phase', 'shared'], 'Codex Worker v3 profile');
  const directive: CodexWorkerDirectiveV3 = Object.freeze({
    directiveDigest: digest(input['directiveDigest'], 'directive digest'),
    externalExecutionIntentDigest: digest(
      input['externalExecutionIntentDigest'],
      'external execution intent digest',
    ),
    phaseDispatchEntryDigest: digest(
      input['phaseDispatchEntryDigest'],
      'phase dispatch entry digest',
    ),
    processLaunchNonce: digest(input['processLaunchNonce'], 'process launch nonce'),
    profile: Object.freeze({
      phase: decodePhase(profileInput['phase']),
      shared: decodeSharedProfile(profileInput['shared']),
    }),
    request: decodeRequestBinding(input['request']),
    schemaVersion: exactLiteral(input['schemaVersion'], 3, 'directive schema version'),
    sourceAuthority: decodeSourceAuthority(input['sourceAuthority']),
  });
  assertDirectiveInternalBinding(directive);
  if (directive.directiveDigest !== digestCanonical(codexWorkerDirectiveV3Projection(directive))) {
    throw new TypeError('Codex Worker v3 directive digest is inconsistent');
  }
  return directive;
}

export function createCodexWorkerDirectiveV3(
  value: Omit<CodexWorkerDirectiveV3, 'directiveDigest'>,
): CodexWorkerDirectiveV3 {
  return decodeCodexWorkerDirectiveV3({
    ...value,
    directiveDigest: digestCanonical(codexWorkerDirectiveV3Projection(value)),
  });
}

export function assertDirectiveV3BindsWorkerRequest(
  directive: CodexWorkerDirectiveV3,
  rawRequest: WorkerRequest,
): WorkerRequest {
  const request = decodeWorkerRequest(rawRequest);
  const context = request.contextPackage;
  const phase = directive.profile.phase;
  if (
    !requestMatchesContext(directive.request, request) ||
    canonicalizeJson(context.capabilityGrant) !==
      canonicalizeJson(expectedCapabilityGrant(phase.phase)) ||
    canonicalizeJson(context.responseContract) !==
      canonicalizeJson(expectedResponseContract(phase.phase)) ||
    phase.capabilityGrantDigest !==
      digestCanonical({ schemaVersion: 1, capabilityGrant: context.capabilityGrant }) ||
    phase.responseContractDigest !==
      digestCanonical({ schemaVersion: 1, responseContract: context.responseContract })
  ) {
    throw new TypeError('Codex Worker v3 directive does not bind the exact phase Worker Request');
  }
  const source = directive.sourceAuthority;
  if (source.kind === 'PROJECT_READ') {
    const authority = source.authorityRecord;
    if (
      context.schemaVersion !== 5 ||
      context.candidateGenerationId !== undefined ||
      context.candidateDigest !== undefined ||
      context.goal.scope.projectPath !== authority.normalizedProjectRoot ||
      context.projectReadAuthorityId !== authority.id ||
      context.projectReadAuthorityRecordDigest !== authority.recordDigest ||
      context.projectReadSourceTreeProjectionDigest !== authority.sourceTree.projectionDigest ||
      context.projectReadGitStateProjectionDigest !== authority.gitState.projectionDigest
    ) {
      throw new TypeError('Project-read source authority does not bind the Context Package');
    }
  } else {
    const lease = source.workspaceLease;
    if (
      context.candidateGenerationId !== lease.candidateGenerationId ||
      context.candidateDigest !== lease.candidateDigest ||
      JSON.stringify(context.goal.scope.allowedPaths) !== JSON.stringify(lease.allowedPaths)
    ) {
      throw new TypeError('Candidate source authority does not bind the Context Package');
    }
  }
  return request;
}

export function assertLaunchBindsDirectiveV3(
  directive: CodexWorkerDirectiveV3,
  launch: Readonly<{
    readonly summary: Readonly<{
      readonly codexHome: string;
      readonly codexVersion: string;
      readonly cwd: string;
      readonly delegatedExecutableDigest: string;
      readonly environmentNames: readonly string[];
      readonly launcherDigest: string;
      readonly nonSecretEnvironment: Readonly<Record<string, string>>;
      readonly protocolSnapshotDigest: string;
      readonly secretEnvironmentNames: readonly string[];
    }>;
  }>,
): void {
  const profile = directive.profile.shared;
  const source = directive.sourceAuthority;
  const cwd =
    source.kind === 'PROJECT_READ'
      ? source.authorityRecord.snapshotLeafRealpath
      : source.workspaceLease.root;
  const summary = launch.summary;
  const nonSecretEnvironmentNames = Object.keys(summary.nonSecretEnvironment).sort();
  const expectedNonSecretEnvironmentNames = summary.environmentNames.filter(
    (name) => !summary.secretEnvironmentNames.includes(name),
  );
  if (
    summary.cwd !== cwd ||
    summary.codexHome !== profile.controlledStateRootIdentity ||
    summary.codexVersion !== profile.codexVersion ||
    summary.delegatedExecutableDigest !== profile.delegatedExecutableDigest ||
    JSON.stringify(summary.environmentNames) !== JSON.stringify(profile.environmentNames) ||
    summary.launcherDigest !== profile.launcherDigest ||
    digestCanonical(summary.nonSecretEnvironment) !== profile.nonSecretEnvironmentDigest ||
    JSON.stringify(nonSecretEnvironmentNames) !==
      JSON.stringify(expectedNonSecretEnvironmentNames) ||
    summary.nonSecretEnvironment['CODEX_HOME'] !== summary.codexHome ||
    summary.protocolSnapshotDigest !== profile.protocolSnapshotDigest ||
    JSON.stringify(summary.secretEnvironmentNames) !==
      JSON.stringify(profile.secretEnvironmentNames)
  ) {
    throw new TypeError('Controlled App Server launch does not bind the v3 execution directive');
  }
}

export function codexFinalPayloadBindingV3(directive: CodexWorkerDirectiveV3): unknown {
  const sourceAuthority = codexWorkerSourceAuthorityReceiptV1(directive.sourceAuthority);
  const sourceBinding =
    sourceAuthority.kind === 'PROJECT_READ'
      ? Object.freeze({
          sourceAuthorityKind: sourceAuthority.kind,
          projectReadAuthorityId: sourceAuthority.projectReadAuthorityId,
          projectReadAuthorityRecordDigest: sourceAuthority.projectReadAuthorityRecordDigest,
          sourceCwdIdentity: sourceAuthority.snapshotCwdIdentity,
        })
      : Object.freeze({
          sourceAuthorityKind: sourceAuthority.kind,
          candidateWorkspaceLeaseId: sourceAuthority.candidateWorkspaceLeaseId,
          candidateWorkspaceLeaseDigest: sourceAuthority.candidateWorkspaceLeaseDigest,
          sourceCwdIdentity: sourceAuthority.candidateWorkspaceCwdIdentity,
        });
  return Object.freeze({
    ...directive.request,
    directiveDigest: directive.directiveDigest,
    externalExecutionIntentDigest: directive.externalExecutionIntentDigest,
    phaseDispatchEntryDigest: directive.phaseDispatchEntryDigest,
    ...sourceBinding,
    workerActivityPolicyDigest: directive.profile.phase.workerActivityPolicyDigest,
    workerActivityPolicyId: directive.profile.phase.workerActivityPolicyId,
  });
}

export function codexWorkerOutputSchemaV3(directive: CodexWorkerDirectiveV3): JsonValue {
  const binding = codexFinalPayloadBindingV3(directive) as Record<string, unknown>;
  const bindingProperties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(binding)) {
    bindingProperties[key] = Object.freeze({
      const: value,
      type: typeof value === 'number' ? 'integer' : 'string',
    });
  }
  const result =
    directive.request.phase === 'IMPLEMENT'
      ? {
          additionalProperties: false,
          properties: {
            claimedScope: { maxLength: 16_384, minLength: 1, type: 'string' },
            kind: { const: 'COMPLETION_REQUEST', type: 'string' },
            proposedEvidenceRefs: {
              items: { maxLength: 4_096, minLength: 1, type: 'string' },
              maxItems: 128,
              type: 'array',
            },
            summary: { maxLength: 16_384, minLength: 1, type: 'string' },
          },
          required: ['kind', 'claimedScope', 'summary', 'proposedEvidenceRefs'],
          type: 'object',
        }
      : {
          additionalProperties: false,
          properties: {
            kind: { const: 'PROPOSALS', type: 'string' },
            proposals: {
              items: {
                additionalProperties: false,
                properties: {
                  kind: { maxLength: 256, minLength: 1, type: 'string' },
                  sourceRefs: {
                    items: { maxLength: 4_096, minLength: 1, type: 'string' },
                    maxItems: 128,
                    type: 'array',
                  },
                  summary: { maxLength: 16_384, minLength: 1, type: 'string' },
                },
                required: ['kind', 'summary', 'sourceRefs'],
                type: 'object',
              },
              maxItems: 128,
              type: 'array',
            },
          },
          required: ['kind', 'proposals'],
          type: 'object',
        };
  return Object.freeze({
    additionalProperties: false,
    properties: {
      ...bindingProperties,
      result,
      schemaVersion: { const: 1, type: 'integer' },
    },
    required: ['schemaVersion', ...Object.keys(binding).sort(), 'result'],
    type: 'object',
  });
}

export function decodeCodexWorkerResultV3(
  text: string,
  directive: CodexWorkerDirectiveV3,
  maximumBytes: number,
): CodexWorkerResultV3 {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > maximumBytes) {
    throw new TypeError('final payload exceeds the Worker response limit');
  }
  const payload = object(
    parseBoundedJson(bytes, {
      maximumCollectionEntries: 512,
      maximumDepth: 10,
      maximumNodes: 2_048,
    }),
    'Codex Worker v3 final payload',
  );
  const binding = codexFinalPayloadBindingV3(directive) as Record<string, unknown>;
  exactKeys(
    payload,
    ['schemaVersion', ...Object.keys(binding), 'result'],
    'Codex Worker v3 final payload',
  );
  exactLiteral(payload['schemaVersion'], 1, 'Codex Worker v3 final payload schema');
  for (const [key, expected] of Object.entries(binding)) {
    if (canonicalizeJson(payload[key]) !== canonicalizeJson(expected)) {
      throw new TypeError('Codex Worker v3 final payload does not bind the current execution');
    }
  }
  const result = object(payload['result'], 'Codex Worker v3 result');
  if (directive.request.phase === 'IMPLEMENT') {
    exactKeys(
      result,
      ['claimedScope', 'kind', 'proposedEvidenceRefs', 'summary'],
      'Codex Worker v3 completion request',
    );
    exactLiteral(result['kind'], 'COMPLETION_REQUEST', 'Codex Worker v3 result kind');
    if (
      !Array.isArray(result['proposedEvidenceRefs']) ||
      result['proposedEvidenceRefs'].length > 128
    ) {
      throw new TypeError('Codex Worker v3 proposed Evidence refs are invalid');
    }
    return Object.freeze({
      claimedScope: nonBlankString(result['claimedScope'], 'Codex Worker v3 claimed scope'),
      kind: 'COMPLETION_REQUEST',
      proposedEvidenceRefs: Object.freeze(
        result['proposedEvidenceRefs'].map((entry) =>
          nonBlankString(entry, 'Codex Worker v3 proposed Evidence ref', 4_096),
        ),
      ),
      summary: nonBlankString(result['summary'], 'Codex Worker v3 completion summary'),
    });
  }
  exactKeys(result, ['kind', 'proposals'], 'Codex Worker v3 proposals result');
  exactLiteral(result['kind'], 'PROPOSALS', 'Codex Worker v3 result kind');
  if (!Array.isArray(result['proposals']) || result['proposals'].length > 128) {
    throw new TypeError('Codex Worker v3 proposals are invalid');
  }
  return Object.freeze({
    kind: 'PROPOSALS',
    proposals: Object.freeze(
      result['proposals'].map((value, index) => {
        const proposal = object(value, `Codex Worker v3 proposal ${String(index)}`);
        exactKeys(proposal, ['kind', 'sourceRefs', 'summary'], 'Codex Worker v3 proposal');
        if (!Array.isArray(proposal['sourceRefs']) || proposal['sourceRefs'].length > 128) {
          throw new TypeError('Codex Worker v3 proposal source refs are invalid');
        }
        return Object.freeze({
          kind: nonBlankString(proposal['kind'], 'Codex Worker v3 proposal kind', 256),
          sourceRefs: Object.freeze(
            proposal['sourceRefs'].map((entry) =>
              nonBlankString(entry, 'Codex Worker v3 proposal source ref', 4_096),
            ),
          ),
          summary: nonBlankString(proposal['summary'], 'Codex Worker v3 proposal summary'),
        });
      }),
    ),
  });
}

export function renderCodexWorkerPromptV3(
  directive: CodexWorkerDirectiveV3,
  request: WorkerRequest,
): string {
  const phase = directive.request.phase;
  const source = directive.sourceAuthority;
  const sourceBoundary =
    source.kind === 'PROJECT_READ'
      ? 'Inspect only the supplied immutable selected-source snapshot. Do not modify files or infer access to the source checkout.'
      : `Modify only the mutable Candidate workspace within these allowed paths: ${canonicalizeJson(source.workspaceLease.allowedPaths)}.`;
  const resultInstruction =
    phase === 'IMPLEMENT'
      ? 'Return only a completion request proposal after making the bounded Candidate changes.'
      : 'Return only bounded project observations and proposals. They are not Facts, Plan authority, or Workflow authority.';
  return [
    `Execute the current ${phase} objective under the exact CodeClosure phase capability.`,
    sourceBoundary,
    'Respect every Goal scope, non-goal, authority class, capability grant, and response contract.',
    resultInstruction,
    `Required final binding: ${canonicalizeJson(codexFinalPayloadBindingV3(directive))}`,
    `Current Context Package: ${canonicalizeJson(request.contextPackage)}`,
  ].join('\n\n');
}
