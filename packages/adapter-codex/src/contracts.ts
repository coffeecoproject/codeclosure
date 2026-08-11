import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { JsonValue } from '@codeclosure/codex-app-server-client';
import {
  candidateWorkspaceAllowedPathProjection,
  candidateWorkspaceLeaseProjection as runtimeCandidateWorkspaceLeaseProjection,
  canonicalizeJson,
  decodeCandidateWorkspaceLease as decodeRuntimeCandidateWorkspaceLease,
  decodeWorkerRequest,
  type ExternalWorkerFailureCode,
  type WorkerRequest,
} from '@codeclosure/runtime';

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const portableRelativePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u;

export const CODEX_WORKER_ADAPTER_VERSION = 'm2-slice2-v1';
export const CODEX_WORKER_PROMPT_PROFILE = 'codeclosure-implement-v1';
export const CODEX_WORKER_CANDIDATE_TRUST_POLICY = 'EXACT_CANDIDATE_UNTRUSTED';
export const CODEX_WORKER_DISABLED_FEATURES = Object.freeze([
  'apps',
  'goals',
  'hooks',
  'memories',
  'multi_agent',
  'multi_agent_v2',
  'personality',
  'plugins',
  'remote_plugin',
  'skill_mcp_dependency_install',
  'skill_search',
  'tool_suggest',
]);

const developerInstructionTemplate = [
  'You are operating as a bounded CodeClosure IMPLEMENT worker.',
  'The supplied Context Package is the current execution input; it does not grant completion authority.',
  'Work only inside the supplied Candidate workspace and its allowed paths.',
  'Do not modify CodeClosure authority state, the source project, or any other workspace.',
  'Your final answer MUST be exactly one JSON object matching the supplied output schema.',
  'A completion request is only a proposal. Do not claim ACCEPT, verification, Goal completion, release, or deployment authority.',
].join('\n');

export const CODEX_WORKER_DEVELOPER_INSTRUCTIONS = developerInstructionTemplate;
export const CODEX_WORKER_PROMPT_TEMPLATE_DIGEST = digestCanonical({
  profile: CODEX_WORKER_PROMPT_PROFILE,
  template: developerInstructionTemplate,
});

export type CodexAdapterFailureCode = ExternalWorkerFailureCode;

export type CodexItemRejectionCode =
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

export type CodexWorkerActivityDiagnosticDetail =
  'EMPTY_COMMAND_ACTIONS' | 'UNKNOWN_COMMAND_ACTION' | 'COMMAND_ACTION_PATH_OUTSIDE_CWD';

export type CodexAdapterDiagnosticEvent =
  | Readonly<{
      schemaVersion: 1;
      kind: 'NOTIFICATION_LIMIT';
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'UNSUPPORTED_NOTIFICATION';
      method: string;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'MALFORMED_ITEM';
      location: 'COMPLETED' | 'STARTED' | 'TERMINAL';
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'ITEM_POLICY_UNAVAILABLE';
      location: 'COMPLETED' | 'STARTED' | 'TERMINAL';
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'UNSUPPORTED_ITEM';
      itemType: string;
      location: 'COMPLETED' | 'STARTED' | 'TERMINAL';
      reasonCode: CodexItemRejectionCode;
      activityDetail?: CodexWorkerActivityDiagnosticDetail;
    }>;

export interface CodexWorkerRequestBinding {
  readonly attemptId: string;
  readonly candidateDigest: string;
  readonly candidateGenerationId: string;
  readonly contextManifestDigest: string;
  readonly contextManifestId: string;
  readonly executionProfileDigest: string;
  readonly executionProfileId: string;
  readonly goalId: string;
  readonly goalRevision: number;
  readonly packageDigest: string;
  readonly phase: 'IMPLEMENT';
  readonly policyBundleDigest: string;
  readonly policyBundleId: string;
  readonly workerSessionId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
}

export interface CandidateWorkspaceLease {
  readonly accessMode: 'MUTABLE';
  readonly allowedPathPolicyDigest: string;
  readonly allowedPaths: readonly string[];
  readonly candidateId: string;
  readonly candidateDigest: string;
  readonly candidateGenerationId: string;
  readonly candidateGenerationVersion: number;
  readonly forbiddenRoots: readonly string[];
  readonly generationSequence: number;
  readonly goalId: string;
  readonly goalRevision: number;
  readonly id: string;
  readonly issuedAt: string;
  readonly leaseDigest: string;
  readonly lifecyclePolicy: 'REVOKE_ON_FREEZE';
  readonly parentGenerationId: string | null;
  readonly reservedPathPolicy: 'M2_CONTROLLED_COPY_V1';
  readonly retentionPolicy: 'RUNTIME_OWNED';
  readonly root: string;
  readonly schemaVersion: 1;
  readonly sourceGitMetadataDigest: string;
  readonly sourceProjectRoot: string;
  readonly sourceTreeDigest: string;
  readonly state: 'ACTIVE';
  readonly version: number;
  readonly workspaceRootIdentity: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
}

export interface CodexInstructionSourceBinding {
  readonly digest: string;
  readonly path: string;
}

export type CodexThreadDirective =
  | Readonly<{ kind: 'FRESH' }>
  | Readonly<{
      backendSessionRef: string;
      kind: 'RESUME';
      resumeBindingDigest: string;
    }>;

export interface CodexExecutionProfileDirective {
  readonly approvalPolicy: 'never';
  readonly approvalsReviewer: 'user';
  readonly candidateTrustPolicy: typeof CODEX_WORKER_CANDIDATE_TRUST_POLICY;
  readonly codexVersion: string;
  readonly compactionPolicy: 'FAIL_ON_OBSERVATION' | 'MANUAL_BEFORE_OPERATION';
  readonly configReadDigest: string;
  readonly controlledStateRootIdentity: string;
  readonly delegatedExecutableDigest: string;
  readonly disabledIntegrations: readonly string[];
  readonly environmentNames: readonly string[];
  readonly fallbackPolicy: 'FAIL_CLOSED';
  readonly instructionSourceManifestDigest: string;
  readonly instructionSources: readonly CodexInstructionSourceBinding[];
  readonly launcherDigest: string;
  readonly managedRequirementsDigest: string;
  readonly maximumPromptBytes: number;
  readonly model: string;
  readonly modelProvider: string;
  readonly networkAccess: false;
  readonly nonSecretEnvironmentDigest: string;
  readonly permissionProfileDigest: string;
  readonly permissionProfileId: string;
  readonly promptProfile: typeof CODEX_WORKER_PROMPT_PROFILE;
  readonly promptTemplateDigest: string;
  readonly protocolSnapshotDigest: string;
  readonly reasoningEffort: string;
  readonly retentionPolicy: 'CONTROLLED';
  readonly serviceTier: string;
  readonly secretEnvironmentNames: readonly string[];
  readonly terminalTimeoutMilliseconds: number;
  readonly thread: CodexThreadDirective;
}

export interface CodexWorkerDirective {
  readonly directiveDigest: string;
  readonly externalExecutionIntentDigest: string;
  readonly processLaunchNonce: string;
  readonly profile: CodexExecutionProfileDirective;
  readonly request: CodexWorkerRequestBinding;
  readonly schemaVersion: 2;
  readonly workspaceLease: CandidateWorkspaceLease;
}

export interface CodexAdapterObservation {
  readonly approvalRequestCount: number;
  readonly backendOperationRef?: string;
  readonly backendSessionRef?: string;
  readonly candidateWorkspaceLeaseDigest: string;
  readonly candidateWorkspaceLeaseId: string;
  readonly compactionCount: number;
  readonly externalExecutionIntentDigest: string;
  readonly failureCode?: CodexAdapterFailureCode;
  readonly notificationCount: number;
  readonly processLaunchCount: number;
  readonly requestAttemptId: string;
  readonly requestWorkerSessionId: string;
  readonly resultEventId?: string;
  readonly schemaVersion: 1;
  readonly state: 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
  readonly threadRequestCount: number;
  readonly turnInterruptCount: number;
  readonly turnRequestCount: number;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${field} has unknown or missing fields`);
  }
}

function nonBlankString(value: unknown, field: string, maximumBytes = 4_096): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    throw new TypeError(`${field} must be a bounded non-blank string`);
  }
  return value;
}

function digest(value: unknown, field: string): string {
  const result = nonBlankString(value, field, 71);
  if (!digestPattern.test(result)) {
    throw new TypeError(`${field} must be a SHA-256 digest`);
  }
  return result;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return Number(value);
}

function exactLiteral<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  field: string,
): T {
  if (value !== expected) {
    throw new TypeError(`${field} must be ${JSON.stringify(expected)}`);
  }
  return expected;
}

function sortedUniqueStrings(
  value: unknown,
  field: string,
  validator: (entry: unknown, entryField: string) => string = nonBlankString,
): readonly string[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new TypeError(`${field} must be a bounded array`);
  }
  const result = value.map((entry, index) => validator(entry, `${field}[${String(index)}]`));
  for (let index = 1; index < result.length; index += 1) {
    if ((result[index - 1] ?? '') >= (result[index] ?? '')) {
      throw new TypeError(`${field} must be uniquely sorted`);
    }
  }
  return Object.freeze(result);
}

function absoluteRealDirectory(value: unknown, field: string): string {
  const path = nonBlankString(value, field, 16_384);
  if (!isAbsolute(path)) {
    throw new TypeError(`${field} must be absolute`);
  }
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new TypeError(`${field} is unavailable`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`${field} must be a real directory`);
  }
  return realpathSync(path);
}

function portableRelativePath(value: unknown, field: string): string {
  const path = nonBlankString(value, field, 4_096);
  if (
    !portableRelativePathPattern.test(path) ||
    path.includes('\u0000') ||
    resolve('/', path) === '/'
  ) {
    throw new TypeError(`${field} must be a portable relative path`);
  }
  return path;
}

function isSameOrWithin(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export function digestCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex')}`;
}

function decodeRequestBinding(value: unknown): CodexWorkerRequestBinding {
  const input = object(value, 'directive.request');
  exactKeys(
    input,
    [
      'attemptId',
      'candidateDigest',
      'candidateGenerationId',
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
    ],
    'directive.request',
  );
  return Object.freeze({
    attemptId: nonBlankString(input['attemptId'], 'request.attemptId'),
    candidateDigest: digest(input['candidateDigest'], 'request.candidateDigest'),
    candidateGenerationId: nonBlankString(
      input['candidateGenerationId'],
      'request.candidateGenerationId',
    ),
    contextManifestDigest: digest(input['contextManifestDigest'], 'request.contextManifestDigest'),
    contextManifestId: nonBlankString(input['contextManifestId'], 'request.contextManifestId'),
    executionProfileDigest: digest(
      input['executionProfileDigest'],
      'request.executionProfileDigest',
    ),
    executionProfileId: nonBlankString(input['executionProfileId'], 'request.executionProfileId'),
    goalId: nonBlankString(input['goalId'], 'request.goalId'),
    goalRevision: positiveInteger(input['goalRevision'], 'request.goalRevision'),
    packageDigest: digest(input['packageDigest'], 'request.packageDigest'),
    phase: exactLiteral(input['phase'], 'IMPLEMENT', 'request.phase'),
    policyBundleDigest: digest(input['policyBundleDigest'], 'request.policyBundleDigest'),
    policyBundleId: nonBlankString(input['policyBundleId'], 'request.policyBundleId'),
    workerSessionId: nonBlankString(input['workerSessionId'], 'request.workerSessionId'),
    workflowId: nonBlankString(input['workflowId'], 'request.workflowId'),
    workflowVersion: positiveInteger(input['workflowVersion'], 'request.workflowVersion'),
  });
}

export function decodeCodexCandidateWorkspaceLease(value: unknown): CandidateWorkspaceLease {
  const decoded = decodeRuntimeCandidateWorkspaceLease(value);
  if (decoded.accessMode !== 'MUTABLE' || decoded.lifecyclePolicy !== 'REVOKE_ON_FREEZE') {
    throw new TypeError('Codex IMPLEMENT requires one mutable revoke-on-freeze lease');
  }
  const root = absoluteRealDirectory(decoded.root, 'workspaceLease.root');
  const sourceProjectRoot = absoluteRealDirectory(
    decoded.sourceProjectRoot,
    'workspaceLease.sourceProjectRoot',
  );
  const workspaceRootIdentity = absoluteRealDirectory(
    decoded.workspaceRootIdentity,
    'workspaceLease.workspaceRootIdentity',
  );
  const forbiddenRoots = sortedUniqueStrings(
    decoded.forbiddenRoots,
    'workspaceLease.forbiddenRoots',
    absoluteRealDirectory,
  );
  if (
    root !== decoded.root ||
    sourceProjectRoot !== decoded.sourceProjectRoot ||
    workspaceRootIdentity !== decoded.workspaceRootIdentity ||
    JSON.stringify(forbiddenRoots) !== JSON.stringify(decoded.forbiddenRoots)
  ) {
    throw new TypeError('workspaceLease paths must already use exact real identities');
  }
  if (!forbiddenRoots.includes(sourceProjectRoot)) {
    throw new TypeError('workspaceLease forbidden roots must contain the source project');
  }
  for (const forbidden of forbiddenRoots) {
    if (
      isSameOrWithin(root, forbidden) ||
      isSameOrWithin(forbidden, root) ||
      isSameOrWithin(workspaceRootIdentity, forbidden) ||
      isSameOrWithin(forbidden, workspaceRootIdentity)
    ) {
      throw new TypeError('workspaceLease root overlaps a forbidden root');
    }
  }
  if (root === workspaceRootIdentity || !isSameOrWithin(root, workspaceRootIdentity)) {
    throw new TypeError('workspaceLease root must be below its owned workspace root');
  }
  const allowedPaths = sortedUniqueStrings(
    decoded.allowedPaths,
    'workspaceLease.allowedPaths',
    portableRelativePath,
  );
  if (
    allowedPaths.length === 0 ||
    allowedPaths.some((path) =>
      path.split('/').some((segment) => segment === '.git' || segment === '.codeclosure'),
    )
  ) {
    throw new TypeError('workspaceLease allowed paths are empty or reserved');
  }
  const lease = Object.freeze({
    ...decoded,
    accessMode: 'MUTABLE' as const,
    allowedPaths,
    forbiddenRoots,
    lifecyclePolicy: 'REVOKE_ON_FREEZE' as const,
    root,
    sourceProjectRoot,
    workspaceRootIdentity,
  });
  if (
    lease.allowedPathPolicyDigest !==
    digestCanonical(candidateWorkspaceAllowedPathProjection(lease.allowedPaths))
  ) {
    throw new TypeError('Candidate allowed-path policy digest is inconsistent');
  }
  if (lease.leaseDigest !== digestCanonical(candidateWorkspaceLeaseProjection(lease))) {
    throw new TypeError('Candidate workspace lease digest is inconsistent');
  }
  return lease;
}

function decodeInstructionSources(value: unknown): readonly CodexInstructionSourceBinding[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError('profile.instructionSources must be a bounded array');
  }
  const result = value.map((entry, index) => {
    const input = object(entry, `profile.instructionSources[${String(index)}]`);
    exactKeys(input, ['digest', 'path'], 'instruction source');
    const path = nonBlankString(input['path'], 'instruction source path', 16_384);
    if (!isAbsolute(path)) {
      throw new TypeError('instruction source path must be absolute');
    }
    return Object.freeze({
      digest: digest(input['digest'], 'instruction source digest'),
      path,
    });
  });
  for (let index = 1; index < result.length; index += 1) {
    if ((result[index - 1]?.path ?? '') >= (result[index]?.path ?? '')) {
      throw new TypeError('instruction sources must be uniquely sorted by path');
    }
  }
  return Object.freeze(result);
}

function decodeThreadDirective(value: unknown): CodexThreadDirective {
  const input = object(value, 'profile.thread');
  const kind = input['kind'];
  if (kind === 'FRESH') {
    exactKeys(input, ['kind'], 'profile.thread');
    return Object.freeze({ kind });
  }
  if (kind === 'RESUME') {
    exactKeys(input, ['backendSessionRef', 'kind', 'resumeBindingDigest'], 'profile.thread');
    return Object.freeze({
      backendSessionRef: nonBlankString(
        input['backendSessionRef'],
        'profile.thread.backendSessionRef',
      ),
      kind,
      resumeBindingDigest: digest(
        input['resumeBindingDigest'],
        'profile.thread.resumeBindingDigest',
      ),
    });
  }
  throw new TypeError('profile.thread kind is unsupported');
}

function decodeProfile(value: unknown): CodexExecutionProfileDirective {
  const input = object(value, 'directive.profile');
  exactKeys(
    input,
    [
      'approvalPolicy',
      'approvalsReviewer',
      'candidateTrustPolicy',
      'codexVersion',
      'compactionPolicy',
      'configReadDigest',
      'controlledStateRootIdentity',
      'delegatedExecutableDigest',
      'disabledIntegrations',
      'environmentNames',
      'fallbackPolicy',
      'instructionSourceManifestDigest',
      'instructionSources',
      'launcherDigest',
      'managedRequirementsDigest',
      'maximumPromptBytes',
      'model',
      'modelProvider',
      'networkAccess',
      'nonSecretEnvironmentDigest',
      'permissionProfileDigest',
      'permissionProfileId',
      'promptProfile',
      'promptTemplateDigest',
      'protocolSnapshotDigest',
      'reasoningEffort',
      'retentionPolicy',
      'secretEnvironmentNames',
      'serviceTier',
      'terminalTimeoutMilliseconds',
      'thread',
    ],
    'directive.profile',
  );
  const instructionSources = decodeInstructionSources(input['instructionSources']);
  const instructionSourceManifestDigest = digest(
    input['instructionSourceManifestDigest'],
    'profile.instructionSourceManifestDigest',
  );
  if (instructionSourceManifestDigest !== digestCanonical({ instructionSources })) {
    throw new TypeError('profile instruction-source manifest digest is inconsistent');
  }
  const disabledIntegrations = sortedUniqueStrings(
    input['disabledIntegrations'],
    'profile.disabledIntegrations',
  );
  const requiredDisabled = [
    'APPS',
    'DYNAMIC_TOOLS',
    'HOOKS',
    'MCP',
    'PLUGINS',
    'SKILLS',
    'SUBAGENTS',
    'WEB_SEARCH',
  ];
  if (JSON.stringify(disabledIntegrations) !== JSON.stringify(requiredDisabled)) {
    throw new TypeError('profile disabled integrations do not match the bounded M2 set');
  }
  const compactionPolicy = input['compactionPolicy'];
  if (
    compactionPolicy !== 'FAIL_ON_OBSERVATION' &&
    compactionPolicy !== 'MANUAL_BEFORE_OPERATION'
  ) {
    throw new TypeError('profile.compactionPolicy is unsupported');
  }
  return Object.freeze({
    approvalPolicy: exactLiteral(input['approvalPolicy'], 'never', 'profile.approvalPolicy'),
    approvalsReviewer: exactLiteral(
      input['approvalsReviewer'],
      'user',
      'profile.approvalsReviewer',
    ),
    candidateTrustPolicy: exactLiteral(
      input['candidateTrustPolicy'],
      CODEX_WORKER_CANDIDATE_TRUST_POLICY,
      'profile.candidateTrustPolicy',
    ),
    codexVersion: nonBlankString(input['codexVersion'], 'profile.codexVersion'),
    compactionPolicy,
    configReadDigest: digest(input['configReadDigest'], 'profile.configReadDigest'),
    controlledStateRootIdentity: absoluteRealDirectory(
      input['controlledStateRootIdentity'],
      'profile.controlledStateRootIdentity',
    ),
    delegatedExecutableDigest: digest(
      input['delegatedExecutableDigest'],
      'profile.delegatedExecutableDigest',
    ),
    disabledIntegrations,
    environmentNames: sortedUniqueStrings(input['environmentNames'], 'profile.environmentNames'),
    fallbackPolicy: exactLiteral(input['fallbackPolicy'], 'FAIL_CLOSED', 'profile.fallbackPolicy'),
    instructionSourceManifestDigest,
    instructionSources,
    launcherDigest: digest(input['launcherDigest'], 'profile.launcherDigest'),
    managedRequirementsDigest: digest(
      input['managedRequirementsDigest'],
      'profile.managedRequirementsDigest',
    ),
    maximumPromptBytes: positiveInteger(input['maximumPromptBytes'], 'profile.maximumPromptBytes'),
    model: nonBlankString(input['model'], 'profile.model'),
    modelProvider: nonBlankString(input['modelProvider'], 'profile.modelProvider'),
    networkAccess: exactLiteral(input['networkAccess'], false, 'profile.networkAccess'),
    nonSecretEnvironmentDigest: digest(
      input['nonSecretEnvironmentDigest'],
      'profile.nonSecretEnvironmentDigest',
    ),
    permissionProfileDigest: digest(
      input['permissionProfileDigest'],
      'profile.permissionProfileDigest',
    ),
    permissionProfileId: nonBlankString(
      input['permissionProfileId'],
      'profile.permissionProfileId',
    ),
    promptProfile: exactLiteral(
      input['promptProfile'],
      CODEX_WORKER_PROMPT_PROFILE,
      'profile.promptProfile',
    ),
    promptTemplateDigest: digest(input['promptTemplateDigest'], 'profile.promptTemplateDigest'),
    protocolSnapshotDigest: digest(
      input['protocolSnapshotDigest'],
      'profile.protocolSnapshotDigest',
    ),
    reasoningEffort: nonBlankString(input['reasoningEffort'], 'profile.reasoningEffort'),
    retentionPolicy: exactLiteral(
      input['retentionPolicy'],
      'CONTROLLED',
      'profile.retentionPolicy',
    ),
    secretEnvironmentNames: sortedUniqueStrings(
      input['secretEnvironmentNames'],
      'profile.secretEnvironmentNames',
    ),
    serviceTier: nonBlankString(input['serviceTier'], 'profile.serviceTier'),
    terminalTimeoutMilliseconds: positiveInteger(
      input['terminalTimeoutMilliseconds'],
      'profile.terminalTimeoutMilliseconds',
    ),
    thread: decodeThreadDirective(input['thread']),
  });
}

export function decodeCodexWorkerDirective(value: unknown): CodexWorkerDirective {
  const input = object(value, 'Codex Worker directive');
  exactKeys(
    input,
    [
      'directiveDigest',
      'externalExecutionIntentDigest',
      'processLaunchNonce',
      'profile',
      'request',
      'schemaVersion',
      'workspaceLease',
    ],
    'Codex Worker directive',
  );
  const directive = Object.freeze({
    directiveDigest: digest(input['directiveDigest'], 'directiveDigest'),
    externalExecutionIntentDigest: digest(
      input['externalExecutionIntentDigest'],
      'externalExecutionIntentDigest',
    ),
    processLaunchNonce: digest(input['processLaunchNonce'], 'processLaunchNonce'),
    profile: decodeProfile(input['profile']),
    request: decodeRequestBinding(input['request']),
    schemaVersion: exactLiteral(input['schemaVersion'], 2, 'directive.schemaVersion'),
    workspaceLease: decodeCodexCandidateWorkspaceLease(input['workspaceLease']),
  });
  assertDirectiveInternalBinding(directive);
  if (directive.profile.promptTemplateDigest !== CODEX_WORKER_PROMPT_TEMPLATE_DIGEST) {
    throw new TypeError('directive prompt template is unsupported');
  }
  if (directive.directiveDigest !== digestCanonical(codexWorkerDirectiveProjection(directive))) {
    throw new TypeError('Codex Worker directive digest is inconsistent');
  }
  return directive;
}

/**
 * Trusted composition factory. The Runtime-owned external intent digest is an
 * opaque binding supplied by the caller; the separate directive digest binds
 * the complete adapter projection without pretending to recreate that intent.
 */
export function createCodexWorkerDirective(value: unknown): CodexWorkerDirective {
  const input = object(value, 'Codex Worker directive input');
  exactKeys(
    input,
    [
      'externalExecutionIntentDigest',
      'processLaunchNonce',
      'profile',
      'request',
      'schemaVersion',
      'workspaceLease',
    ],
    'Codex Worker directive input',
  );
  const withoutDigest: Omit<CodexWorkerDirective, 'directiveDigest'> = Object.freeze({
    externalExecutionIntentDigest: digest(
      input['externalExecutionIntentDigest'],
      'externalExecutionIntentDigest',
    ),
    processLaunchNonce: digest(input['processLaunchNonce'], 'processLaunchNonce'),
    profile: decodeProfile(input['profile']),
    request: decodeRequestBinding(input['request']),
    schemaVersion: exactLiteral(input['schemaVersion'], 2, 'directive.schemaVersion'),
    workspaceLease: decodeCodexCandidateWorkspaceLease(input['workspaceLease']),
  });
  return decodeCodexWorkerDirective({
    ...withoutDigest,
    directiveDigest: digestCanonical(codexWorkerDirectiveProjection(withoutDigest)),
  });
}

export function candidateWorkspaceLeaseProjection(
  lease: Omit<CandidateWorkspaceLease, 'leaseDigest'>,
): unknown {
  return runtimeCandidateWorkspaceLeaseProjection(lease);
}

export function codexWorkerDirectiveProjection(
  directive: Omit<CodexWorkerDirective, 'directiveDigest'>,
): unknown {
  return {
    externalExecutionIntentDigest: directive.externalExecutionIntentDigest,
    processLaunchNonce: directive.processLaunchNonce,
    profile: directive.profile,
    request: directive.request,
    schemaVersion: directive.schemaVersion,
    workspaceLeaseDigest: directive.workspaceLease.leaseDigest,
  };
}

function assertDirectiveInternalBinding(directive: CodexWorkerDirective): void {
  const request = directive.request;
  const lease = directive.workspaceLease;
  if (
    request.goalId !== lease.goalId ||
    request.goalRevision !== lease.goalRevision ||
    request.workflowId !== lease.workflowId ||
    request.workflowVersion !== lease.workflowVersion ||
    request.candidateGenerationId !== lease.candidateGenerationId ||
    request.candidateDigest !== lease.candidateDigest
  ) {
    throw new TypeError('Candidate workspace lease does not bind the directive request');
  }
  if (!lease.forbiddenRoots.includes(directive.profile.controlledStateRootIdentity)) {
    throw new TypeError('Candidate lease must forbid the controlled Codex state root');
  }
}

export function assertDirectiveBindsWorkerRequest(
  directive: CodexWorkerDirective,
  rawRequest: WorkerRequest,
): WorkerRequest {
  const request = decodeWorkerRequest(rawRequest);
  const context = request.contextPackage;
  const binding = directive.request;
  if (
    request.workerSessionId !== binding.workerSessionId ||
    request.attemptId !== binding.attemptId ||
    request.contextManifestId !== binding.contextManifestId ||
    request.contextManifestDigest !== binding.contextManifestDigest ||
    request.packageDigest !== binding.packageDigest ||
    request.executionProfileId !== binding.executionProfileId ||
    request.executionProfileDigest !== binding.executionProfileDigest ||
    context.goalId !== binding.goalId ||
    context.goalRevision !== binding.goalRevision ||
    context.workflowId !== binding.workflowId ||
    context.workflowVersion !== binding.workflowVersion ||
    context.phase !== binding.phase ||
    context.policyBundleId !== binding.policyBundleId ||
    context.policyBundleDigest !== binding.policyBundleDigest ||
    context.candidateGenerationId !== binding.candidateGenerationId ||
    context.candidateDigest !== binding.candidateDigest
  ) {
    throw new TypeError('Codex directive does not bind the exact Worker Request');
  }
  if (
    context.capabilityGrant.candidateAccess !== 'MUTABLE_WRITE' ||
    context.capabilityGrant.controlSubmission !== 'COMPLETION_REQUEST' ||
    !context.responseContract.allowedResultKinds.includes('COMPLETION_REQUEST')
  ) {
    throw new TypeError('Worker Request does not authorize the IMPLEMENT mapping');
  }
  if (
    JSON.stringify(context.goal.scope.allowedPaths) !==
    JSON.stringify(directive.workspaceLease.allowedPaths)
  ) {
    throw new TypeError('Candidate lease allowed paths differ from current Goal scope');
  }
  return request;
}

export function assertLaunchBindsDirective(
  directive: CodexWorkerDirective,
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
  const profile = directive.profile;
  const summary = launch.summary;
  const nonSecretEnvironmentNames = Object.keys(summary.nonSecretEnvironment).sort();
  const expectedNonSecretEnvironmentNames = summary.environmentNames.filter(
    (name) => !summary.secretEnvironmentNames.includes(name),
  );
  if (
    summary.cwd !== directive.workspaceLease.root ||
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
    throw new TypeError('Controlled App Server launch does not bind the execution directive');
  }
}

export function codexFinalPayloadBinding(directive: CodexWorkerDirective): unknown {
  const request = directive.request;
  return Object.freeze({
    attemptId: request.attemptId,
    candidateDigest: request.candidateDigest,
    candidateGenerationId: request.candidateGenerationId,
    candidateWorkspaceLeaseDigest: directive.workspaceLease.leaseDigest,
    candidateWorkspaceLeaseId: directive.workspaceLease.id,
    contextManifestDigest: request.contextManifestDigest,
    contextManifestId: request.contextManifestId,
    executionProfileDigest: request.executionProfileDigest,
    executionProfileId: request.executionProfileId,
    externalExecutionIntentDigest: directive.externalExecutionIntentDigest,
    goalId: request.goalId,
    goalRevision: request.goalRevision,
    packageDigest: request.packageDigest,
    phase: request.phase,
    policyBundleDigest: request.policyBundleDigest,
    policyBundleId: request.policyBundleId,
    workerSessionId: request.workerSessionId,
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
  });
}

export function codexWorkerOutputSchema(directive: CodexWorkerDirective): JsonValue {
  const binding = codexFinalPayloadBinding(directive) as Record<string, unknown>;
  const bindingProperties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(binding)) {
    bindingProperties[key] = Object.freeze({
      const: value,
      type: typeof value === 'number' ? 'integer' : 'string',
    });
  }
  return Object.freeze({
    additionalProperties: false,
    properties: {
      ...bindingProperties,
      result: {
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
      },
      schemaVersion: { const: 1, type: 'integer' },
    },
    required: ['schemaVersion', ...Object.keys(binding).sort(), 'result'],
    type: 'object',
  });
}

export function renderCodexWorkerPrompt(
  directive: CodexWorkerDirective,
  request: WorkerRequest,
): string {
  return [
    'Execute the current IMPLEMENT objective inside the mutable Candidate workspace.',
    'Respect every Goal scope, non-goal, authority class, and capability grant.',
    'Return a completion request only after making the bounded implementation changes.',
    `Allowed paths: ${canonicalizeJson(directive.workspaceLease.allowedPaths)}`,
    `Required final binding: ${canonicalizeJson(codexFinalPayloadBinding(directive))}`,
    `Current Context Package: ${canonicalizeJson(request.contextPackage)}`,
  ].join('\n\n');
}
