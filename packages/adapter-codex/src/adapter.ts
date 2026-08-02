import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

import {
  AppServerClientError,
  AppServerClientErrorCode,
  isJsonObject,
  serverRequestHandler,
  startAppServerClient,
  toProtocolJsonValue,
  type AppServerClient,
  type AppServerClientLimits,
  type AppServerCompactionEvent,
  type AppServerNotification,
  type AppServerProcessIdentity,
  type AppServerProcessLaunch,
  type JsonObject,
  type JsonValue,
} from '@codeclosure/codex-app-server-client';
import {
  assertWorkerEventBindsRequest,
  assertWorkerEventWithinResponseContract,
  decodeWorkerEvent,
  type WorkerEvent,
  type WorkerPort,
  type WorkerRequest,
} from '@codeclosure/runtime';

import {
  CODEX_WORKER_DEVELOPER_INSTRUCTIONS,
  CODEX_WORKER_DISABLED_FEATURES,
  assertDirectiveBindsWorkerRequest,
  assertLaunchBindsDirective,
  codexWorkerOutputSchema,
  decodeCodexWorkerDirective,
  digestCanonical,
  renderCodexWorkerPrompt,
  type CodexAdapterDiagnosticEvent,
  type CodexAdapterFailureCode,
  type CodexAdapterObservation,
  type CodexWorkerDirective,
} from './contracts.js';
import {
  decodeEffectiveThread,
  decodeFinalCompletionRequest,
  evaluateCodexThreadItem,
  decodeStartedTurn,
  digestProtocolValue,
  projectTerminalTurn,
  selectFinalAgentMessage,
  type CompletedAgentMessageObservation,
  type CodexThreadItemLocation,
  type CodexThreadItemPolicy,
  type EffectiveThread,
  type TerminalTurn,
} from './protocol.js';

const forbiddenNotificationPrefixes = Object.freeze([
  'account/login/',
  'app/',
  'externalAgentConfig/',
  'fuzzyFileSearch/',
  'hook/',
  'mcpServer/',
  'skills/',
  'thread/environment/',
  'thread/realtime/',
]);
const forbiddenNotificationMethods = new Set([
  'configWarning',
  'error',
  'fs/changed',
  'guardianWarning',
  'item/autoApprovalReview/completed',
  'item/autoApprovalReview/started',
  'item/mcpToolCall/progress',
  'model/rerouted',
  'thread/settings/updated',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
]);

function isDisabledRemoteControlStatus(notification: AppServerNotification): boolean {
  const params = notification.params;
  return (
    notification.method === 'remoteControl/status/changed' &&
    params['status'] === 'disabled' &&
    params['environmentId'] === null &&
    typeof params['serverName'] === 'string' &&
    typeof params['installationId'] === 'string'
  );
}
interface AdapterFailure extends Error {
  readonly adapterCode: CodexAdapterFailureCode;
}

interface ApprovalProjection {
  readonly itemId: string;
  readonly threadId: string;
  readonly turnId: string;
}

interface WaitResultTerminal {
  readonly kind: 'TERMINAL';
  readonly terminal: TerminalTurn;
}

type WaitResult =
  | WaitResultTerminal
  | Readonly<{ kind: 'ABORT' }>
  | Readonly<{ kind: 'CLOSED' }>
  | Readonly<{ kind: 'POLICY_FAILURE' }>
  | Readonly<{ kind: 'TIMEOUT' }>;

export interface CodexWorkerAdapterInput {
  readonly clientLimits?: Partial<AppServerClientLimits>;
  readonly directive: unknown;
  readonly launch: AppServerProcessLaunch;
  readonly onDiagnosticEvent?: (event: CodexAdapterDiagnosticEvent) => void;
  readonly onLifecycleEvent: (event: unknown) => void;
  readonly observedAt: () => string;
}

function adapterFailure(code: CodexAdapterFailureCode): AdapterFailure {
  const error = new Error(code) as AdapterFailure;
  Object.defineProperty(error, 'adapterCode', { enumerable: true, value: code });
  return error;
}

function boundedString(value: JsonValue | undefined, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, 'utf8') > 4_096
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function diagnosticToken(value: JsonValue | undefined): string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9/_-]{0,127}$/u.test(value)
    ? value
    : 'UNKNOWN';
}

function boundedStartedAt(value: JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('approval startedAtMs is invalid');
  }
  return value;
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function decodeCommandApproval(value: JsonValue): {
  readonly environmentId: string | null;
  readonly itemId: string;
  readonly startedAtMs: number;
  readonly threadId: string;
  readonly turnId: string;
} {
  if (!isJsonObject(value)) {
    throw new TypeError('command approval params must be an object');
  }
  const environmentId = value['environmentId'];
  if (environmentId !== null && typeof environmentId !== 'string') {
    throw new TypeError('command approval environment is invalid');
  }
  return Object.freeze({
    environmentId,
    itemId: boundedString(value['itemId'], 'approval item id'),
    startedAtMs: boundedStartedAt(value['startedAtMs']),
    threadId: boundedString(value['threadId'], 'approval Thread id'),
    turnId: boundedString(value['turnId'], 'approval Turn id'),
  });
}

function decodeFileApproval(value: JsonValue): {
  readonly itemId: string;
  readonly startedAtMs: number;
  readonly threadId: string;
  readonly turnId: string;
} {
  if (!isJsonObject(value)) {
    throw new TypeError('file approval params must be an object');
  }
  return Object.freeze({
    itemId: boundedString(value['itemId'], 'approval item id'),
    startedAtMs: boundedStartedAt(value['startedAtMs']),
    threadId: boundedString(value['threadId'], 'approval Thread id'),
    turnId: boundedString(value['turnId'], 'approval Turn id'),
  });
}

function isSameOrWithin(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function exactCurrentDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return !stat.isSymbolicLink() && stat.isDirectory() && realpathSync(path) === path;
  } catch {
    return false;
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrWithin(left, right) || isSameOrWithin(right, left);
}

function hostCancelled(signal: AbortSignal): boolean {
  return signal.aborted;
}

function repeatWorkspaceChecks(
  directive: CodexWorkerDirective,
  launch: AppServerProcessLaunch,
): void {
  const lease = directive.workspaceLease;
  if (
    !exactCurrentDirectory(lease.root) ||
    !exactCurrentDirectory(lease.workspaceRootIdentity) ||
    lease.root === lease.workspaceRootIdentity ||
    !isSameOrWithin(lease.root, lease.workspaceRootIdentity)
  ) {
    throw adapterFailure('INVALID_WORKSPACE_LEASE');
  }
  for (const forbidden of lease.forbiddenRoots) {
    if (
      isSameOrWithin(lease.root, forbidden) ||
      isSameOrWithin(forbidden, lease.root) ||
      isSameOrWithin(lease.workspaceRootIdentity, forbidden) ||
      isSameOrWithin(forbidden, lease.workspaceRootIdentity)
    ) {
      throw adapterFailure('INVALID_WORKSPACE_LEASE');
    }
  }
  const environment = launch.summary.nonSecretEnvironment;
  const processHome = environment['HOME'];
  const temporaryDirectory = environment['TMPDIR'];
  if (
    processHome === undefined ||
    temporaryDirectory === undefined ||
    !exactCurrentDirectory(directive.profile.controlledStateRootIdentity) ||
    !exactCurrentDirectory(processHome) ||
    !exactCurrentDirectory(temporaryDirectory)
  ) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
  const isolatedHostRoots = Object.freeze([
    directive.profile.controlledStateRootIdentity,
    processHome,
    temporaryDirectory,
  ]);
  for (let index = 0; index < isolatedHostRoots.length; index += 1) {
    const root = isolatedHostRoots[index];
    if (
      root === undefined ||
      !lease.forbiddenRoots.includes(root) ||
      pathsOverlap(root, lease.root) ||
      pathsOverlap(root, lease.workspaceRootIdentity) ||
      pathsOverlap(root, lease.sourceProjectRoot) ||
      lease.forbiddenRoots.some(
        (forbidden) => forbidden !== root && pathsOverlap(root, forbidden),
      ) ||
      isolatedHostRoots.slice(index + 1).some((otherRoot) => pathsOverlap(root, otherRoot))
    ) {
      throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
    }
  }
}

function digestFile(path: string): string {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(path) !== path) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function assertInstructionSourcesCurrent(directive: CodexWorkerDirective): void {
  for (const source of directive.profile.instructionSources) {
    if (digestFile(source.path) !== source.digest) {
      throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
    }
  }
}

function assertEffectiveThread(effective: EffectiveThread, directive: CodexWorkerDirective): void {
  const profile = directive.profile;
  const expectedInstructions = profile.instructionSources.map((source) => source.path);
  if (
    effective.model !== profile.model ||
    effective.modelProvider !== profile.modelProvider ||
    effective.serviceTier !== profile.serviceTier ||
    effective.cwd !== directive.workspaceLease.root ||
    effective.approvalPolicy !== profile.approvalPolicy ||
    effective.approvalsReviewer !== profile.approvalsReviewer ||
    effective.reasoningEffort !== profile.reasoningEffort ||
    effective.sandbox.type !== 'workspaceWrite' ||
    effective.sandbox.networkAccess ||
    effective.sandbox.excludeSlashTmp ||
    effective.sandbox.excludeTmpdirEnvVar ||
    effective.sandbox.writableRoots.length !== 0 ||
    JSON.stringify(effective.instructionSources) !== JSON.stringify(expectedInstructions)
  ) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
}

function candidateTurnSandboxPolicy(candidateRoot: string): {
  excludeSlashTmp: boolean;
  excludeTmpdirEnvVar: boolean;
  networkAccess: boolean;
  type: 'workspaceWrite';
  writableRoots: string[];
} {
  return {
    excludeSlashTmp: true,
    excludeTmpdirEnvVar: true,
    networkAccess: false,
    type: 'workspaceWrite',
    writableRoots: [candidateRoot],
  };
}

function candidateThreadConfiguration(directive: CodexWorkerDirective) {
  return Object.freeze({
    projects: Object.freeze({
      [directive.workspaceLease.root]: Object.freeze({ trust_level: 'untrusted' }),
    }),
  });
}

function assertEffectiveConfiguration(value: JsonValue, directive: CodexWorkerDirective): void {
  if (digestProtocolValue(value) !== directive.profile.configReadDigest || !isJsonObject(value)) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
  const config = value['config'];
  if (!isJsonObject(config)) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
  const profile = directive.profile;
  const features = config['features'];
  const orchestrator = config['orchestrator'];
  const orchestratorMcp = isJsonObject(orchestrator) ? orchestrator['mcp'] : undefined;
  const orchestratorSkills = isJsonObject(orchestrator) ? orchestrator['skills'] : undefined;
  const skills = config['skills'];
  const bundledSkills = isJsonObject(skills) ? skills['bundled'] : undefined;
  const mcpServers = config['mcp_servers'];
  if (
    config['model'] !== profile.model ||
    config['model_provider'] !== profile.modelProvider ||
    config['model_reasoning_effort'] !== profile.reasoningEffort ||
    config['approval_policy'] !== profile.approvalPolicy ||
    config['default_permissions'] !== profile.permissionProfileId ||
    config['web_search'] !== 'disabled' ||
    config['include_apps_instructions'] !== false ||
    config['include_collaboration_mode_instructions'] !== false ||
    !isJsonObject(features) ||
    CODEX_WORKER_DISABLED_FEATURES.some((feature) => features[feature] !== false) ||
    !isJsonObject(orchestratorMcp) ||
    orchestratorMcp['enabled'] !== false ||
    !isJsonObject(orchestratorSkills) ||
    orchestratorSkills['enabled'] !== false ||
    !isJsonObject(skills) ||
    skills['include_instructions'] !== false ||
    !isJsonObject(bundledSkills) ||
    bundledSkills['enabled'] !== false ||
    !isJsonObject(mcpServers) ||
    Object.keys(mcpServers).length !== 0
  ) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
}

function assertManagedRequirements(value: JsonValue, directive: CodexWorkerDirective): void {
  if (digestProtocolValue(value) !== directive.profile.managedRequirementsDigest) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
}

function assertPermissionProfile(value: JsonValue, directive: CodexWorkerDirective): void {
  if (!isJsonObject(value) || !isJsonArray(value['data'])) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
  if (value['nextCursor'] !== undefined && value['nextCursor'] !== null) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
  const selected = value['data'].filter(
    (entry): entry is JsonObject =>
      isJsonObject(entry) && entry['id'] === directive.profile.permissionProfileId,
  );
  if (
    selected.length !== 1 ||
    selected[0]?.['allowed'] !== true ||
    digestProtocolValue(selected[0]) !== directive.profile.permissionProfileDigest
  ) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
}

class InvocationObserver {
  #approvalRequestCount = 0;
  #backendOperationRef?: string;
  #backendSessionRef?: string;
  #compactionCount = 0;
  readonly #completedAgentMessages: CompletedAgentMessageObservation[] = [];
  readonly #directive: CodexWorkerDirective;
  #diagnosticEmitted = false;
  #failureCode?: CodexAdapterFailureCode;
  readonly #failurePromise: Promise<void>;
  #failureResolve!: () => void;
  #itemPolicy?: CodexThreadItemPolicy;
  readonly #maintenanceCompactionItems = new Map<
    string,
    Readonly<{ threadId: string; turnId: string }>
  >();
  readonly #authorizedMaintenanceCompactionItems = new Map<
    string,
    Readonly<{ threadId: string; turnId: string }>
  >();
  #maintenanceTerminalSeen = false;
  #maintenanceTurnRef?: string;
  #manualCompactionPending = false;
  #notificationCount = 0;
  readonly #onDiagnosticEvent: ((event: CodexAdapterDiagnosticEvent) => void) | undefined;
  readonly #observedThreadRefs = new Set<string>();
  readonly #observedTurnRefs = new Set<string>();
  #processLaunchCount = 0;
  #resultEventId?: string;
  #state: CodexAdapterObservation['state'] = 'READY';
  readonly #terminalPromise: Promise<TerminalTurn>;
  #terminalResolve!: (terminal: TerminalTurn) => void;
  #terminalSeen = false;
  #threadRequestCount = 0;
  #turnInterruptCount = 0;
  #turnRequestCount = 0;

  public constructor(
    directive: CodexWorkerDirective,
    onDiagnosticEvent: ((event: CodexAdapterDiagnosticEvent) => void) | undefined,
  ) {
    this.#directive = directive;
    this.#onDiagnosticEvent = onDiagnosticEvent;
    this.#failurePromise = new Promise((resolve) => {
      this.#failureResolve = resolve;
    });
    this.#terminalPromise = new Promise((resolve) => {
      this.#terminalResolve = resolve;
    });
  }

  public get failurePromise(): Promise<void> {
    return this.#failurePromise;
  }

  public get terminalPromise(): Promise<TerminalTurn> {
    return this.#terminalPromise;
  }

  public get failureCode(): CodexAdapterFailureCode | undefined {
    return this.#failureCode;
  }

  public get backendOperationRef(): string | undefined {
    return this.#backendOperationRef;
  }

  public completedAgentMessages(): readonly CompletedAgentMessageObservation[] {
    return Object.freeze([...this.#completedAgentMessages]);
  }

  public fail(code: CodexAdapterFailureCode): void {
    if (this.#failureCode === undefined) {
      this.#failureCode = code;
      this.#state = code === 'HOST_CANCELLED' ? 'INTERRUPTED' : 'FAILED';
      this.#failureResolve();
    }
  }

  public diagnoseUnsupported(event: CodexAdapterDiagnosticEvent): void {
    if (!this.#diagnosticEmitted) {
      this.#diagnosticEmitted = true;
      try {
        this.#onDiagnosticEvent?.(event);
      } catch {
        // Diagnostics cannot change Worker control or failure authority.
      }
    }
    this.fail('UNSUPPORTED_BACKEND_ACTIVITY');
  }

  public cancel(): void {
    if (this.#failureCode === undefined || this.#failureCode === 'BACKEND_TURN_FAILED') {
      this.#failureCode = 'HOST_CANCELLED';
      this.#state = 'INTERRUPTED';
      this.#failureResolve();
    }
  }

  public bindItemPolicy(policy: CodexThreadItemPolicy): void {
    if (
      this.#itemPolicy !== undefined &&
      this.#itemPolicy.expectedUserMessageDigest !== policy.expectedUserMessageDigest
    ) {
      this.fail('EFFECTIVE_INPUT_MISMATCH');
      return;
    }
    this.#itemPolicy = policy;
  }

  public markRunning(): void {
    this.#state = 'RUNNING';
  }

  public throwIfFailed(): void {
    if (this.#failureCode !== undefined) {
      throw adapterFailure(this.#failureCode);
    }
  }

  public markProcessLaunch(): void {
    this.#processLaunchCount += 1;
  }

  public markThreadRequest(): void {
    this.#threadRequestCount += 1;
  }

  public markTurnRequest(): void {
    this.#turnRequestCount += 1;
  }

  public markTurnInterrupt(): void {
    this.#turnInterruptCount += 1;
  }

  public bindThread(threadId: string): void {
    this.#backendSessionRef = threadId;
    this.#validateRefs();
  }

  public bindTurn(turnId: string): void {
    if (this.#maintenanceTurnRef === turnId) {
      this.fail('TURN_BINDING_MISMATCH');
      return;
    }
    this.#backendOperationRef = turnId;
    this.#validateRefs();
  }

  public beginManualCompaction(): void {
    if (
      this.#directive.profile.compactionPolicy !== 'MANUAL_BEFORE_OPERATION' ||
      this.#manualCompactionPending ||
      this.#compactionCount !== 0
    ) {
      this.fail('COMPACTION_POLICY_VIOLATION');
      return;
    }
    this.#manualCompactionPending = true;
  }

  public finishManualCompaction(): void {
    if (
      !this.#manualCompactionPending ||
      this.#compactionCount !== 1 ||
      this.#maintenanceCompactionItems.size !== 0 ||
      this.#maintenanceTurnRef === undefined ||
      !this.#maintenanceTerminalSeen
    ) {
      this.fail('COMPACTION_POLICY_VIOLATION');
      return;
    }
    this.#manualCompactionPending = false;
  }

  public complete(eventId: string): void {
    this.#resultEventId = eventId;
    if (this.#failureCode === undefined) {
      this.#state = 'COMPLETED';
    }
  }

  public recordApproval(projection: ApprovalProjection): void {
    this.#approvalRequestCount += 1;
    this.#observedThreadRefs.add(projection.threadId);
    this.#observedTurnRefs.add(projection.turnId);
    this.#validateRefs();
    this.fail('DECLINED_APPROVAL_REQUEST');
  }

  public recordCompaction(event: AppServerCompactionEvent): void {
    this.#observedThreadRefs.add(event.threadId);
    if (this.#directive.profile.compactionPolicy !== 'MANUAL_BEFORE_OPERATION') {
      this.#compactionCount += 1;
      this.#validateRefs();
      this.fail('COMPACTION_POLICY_VIOLATION');
      return;
    }
    if (
      event.source !== 'REQUESTED_MANUAL' ||
      this.#backendSessionRef === undefined ||
      event.threadId !== this.#backendSessionRef
    ) {
      this.fail('COMPACTION_POLICY_VIOLATION');
      return;
    }
    if (event.stage === 'STARTED') {
      if (
        !this.#manualCompactionPending ||
        this.#maintenanceTurnRef !== event.turnId ||
        this.#compactionCount !== 0 ||
        this.#maintenanceCompactionItems.has(event.itemId)
      ) {
        this.fail('COMPACTION_POLICY_VIOLATION');
        return;
      }
      this.#maintenanceCompactionItems.set(
        event.itemId,
        Object.freeze({ threadId: event.threadId, turnId: event.turnId }),
      );
      this.#authorizedMaintenanceCompactionItems.set(
        event.itemId,
        Object.freeze({ threadId: event.threadId, turnId: event.turnId }),
      );
      return;
    }
    const started = this.#maintenanceCompactionItems.get(event.itemId);
    if (started?.threadId !== event.threadId || started.turnId !== event.turnId) {
      this.fail('COMPACTION_POLICY_VIOLATION');
      return;
    }
    this.#maintenanceCompactionItems.delete(event.itemId);
    this.#compactionCount += 1;
  }

  public recordNotification(notification: AppServerNotification): void {
    this.#notificationCount += 1;
    if (this.#notificationCount > 10_000) {
      this.diagnoseUnsupported(Object.freeze({ schemaVersion: 1, kind: 'NOTIFICATION_LIMIT' }));
      return;
    }
    if (
      forbiddenNotificationMethods.has(notification.method) ||
      forbiddenNotificationPrefixes.some((prefix) => notification.method.startsWith(prefix)) ||
      (notification.method.startsWith('remoteControl/') &&
        !isDisabledRemoteControlStatus(notification))
    ) {
      this.diagnoseUnsupported(
        Object.freeze({
          schemaVersion: 1,
          kind: 'UNSUPPORTED_NOTIFICATION',
          method: diagnosticToken(notification.method),
        }),
      );
    }
    const params = notification.params;
    const threadId = params['threadId'];
    const turnId = params['turnId'];
    if (typeof threadId === 'string') {
      this.#observedThreadRefs.add(threadId);
    }
    if (notification.method === 'thread/started') {
      const thread = params['thread'];
      if (isJsonObject(thread) && typeof thread['id'] === 'string') {
        this.#observedThreadRefs.add(thread['id']);
      } else {
        this.fail('THREAD_BINDING_MISMATCH');
      }
    }
    if (notification.method === 'turn/started') {
      const turn = params['turn'];
      if (isJsonObject(turn) && typeof turn['id'] === 'string') {
        if (this.#manualCompactionPending) {
          if (this.#maintenanceTurnRef !== undefined && this.#maintenanceTurnRef !== turn['id']) {
            this.fail('COMPACTION_POLICY_VIOLATION');
          } else {
            this.#maintenanceTurnRef = turn['id'];
          }
        }
        if (this.#maintenanceTurnRef !== turn['id']) {
          this.#observedTurnRefs.add(turn['id']);
        }
      } else {
        this.fail('TURN_BINDING_MISMATCH');
      }
    }
    const maintenanceTurn = typeof turnId === 'string' && turnId === this.#maintenanceTurnRef;
    if (typeof turnId === 'string' && !maintenanceTurn) {
      this.#observedTurnRefs.add(turnId);
    }
    if (notification.method === 'item/started' || notification.method === 'item/completed') {
      const item = params['item'];
      if (!isJsonObject(item)) {
        this.diagnoseUnsupported(
          Object.freeze({
            schemaVersion: 1,
            kind: 'MALFORMED_ITEM',
            location: notification.method === 'item/started' ? 'STARTED' : 'COMPLETED',
          }),
        );
      } else if (item['type'] === 'contextCompaction') {
        const binding =
          typeof item['id'] === 'string'
            ? this.#authorizedMaintenanceCompactionItems.get(item['id'])
            : undefined;
        if (
          binding === undefined ||
          binding.threadId !== threadId ||
          binding.turnId !== turnId ||
          !maintenanceTurn
        ) {
          this.fail('COMPACTION_POLICY_VIOLATION');
        }
      } else if (this.#manualCompactionPending) {
        this.fail('COMPACTION_POLICY_VIOLATION');
      } else {
        this.#recordItem(item, notification.method === 'item/started' ? 'STARTED' : 'COMPLETED');
      }
    }
    const terminal = projectTerminalTurn(notification);
    const maintenanceTerminal =
      terminal !== undefined && terminal.turnId === this.#maintenanceTurnRef;
    if (terminal !== undefined && maintenanceTerminal) {
      if (
        !this.#manualCompactionPending ||
        this.#maintenanceTerminalSeen ||
        terminal.status !== 'completed' ||
        terminal.error !== null ||
        terminal.items.length !== 1 ||
        terminal.items.some((item) => {
          if (!isJsonObject(item) || item['type'] !== 'contextCompaction') {
            return true;
          }
          const binding =
            typeof item['id'] === 'string'
              ? this.#authorizedMaintenanceCompactionItems.get(item['id'])
              : undefined;
          return binding?.threadId !== terminal.threadId || binding.turnId !== terminal.turnId;
        })
      ) {
        this.fail('COMPACTION_POLICY_VIOLATION');
      } else {
        this.#maintenanceTerminalSeen = true;
      }
    } else if (terminal !== undefined && this.#manualCompactionPending) {
      this.fail('COMPACTION_POLICY_VIOLATION');
    } else if (terminal !== undefined) {
      for (const item of terminal.items) {
        if (!isJsonObject(item)) {
          this.diagnoseUnsupported(
            Object.freeze({ schemaVersion: 1, kind: 'MALFORMED_ITEM', location: 'TERMINAL' }),
          );
        } else {
          this.#recordItem(item, 'TERMINAL');
        }
      }
      this.#observedThreadRefs.add(terminal.threadId);
      this.#observedTurnRefs.add(terminal.turnId);
      if (this.#terminalSeen) {
        this.fail('TURN_BINDING_MISMATCH');
      } else {
        this.#terminalSeen = true;
        this.#terminalResolve(terminal);
      }
    }
    this.#validateRefs();
  }

  public snapshot(): CodexAdapterObservation {
    return Object.freeze({
      approvalRequestCount: this.#approvalRequestCount,
      ...(this.#backendOperationRef === undefined
        ? {}
        : { backendOperationRef: this.#backendOperationRef }),
      ...(this.#backendSessionRef === undefined
        ? {}
        : { backendSessionRef: this.#backendSessionRef }),
      candidateWorkspaceLeaseDigest: this.#directive.workspaceLease.leaseDigest,
      candidateWorkspaceLeaseId: this.#directive.workspaceLease.id,
      compactionCount: this.#compactionCount,
      externalExecutionIntentDigest: this.#directive.externalExecutionIntentDigest,
      ...(this.#failureCode === undefined ? {} : { failureCode: this.#failureCode }),
      notificationCount: this.#notificationCount,
      processLaunchCount: this.#processLaunchCount,
      requestAttemptId: this.#directive.request.attemptId,
      requestWorkerSessionId: this.#directive.request.workerSessionId,
      ...(this.#resultEventId === undefined ? {} : { resultEventId: this.#resultEventId }),
      schemaVersion: 1,
      state: this.#state,
      threadRequestCount: this.#threadRequestCount,
      turnInterruptCount: this.#turnInterruptCount,
      turnRequestCount: this.#turnRequestCount,
    });
  }

  #validateRefs(): void {
    if (
      this.#backendSessionRef !== undefined &&
      [...this.#observedThreadRefs].some((reference) => reference !== this.#backendSessionRef)
    ) {
      this.fail('THREAD_BINDING_MISMATCH');
    }
    if (
      this.#backendOperationRef !== undefined &&
      [...this.#observedTurnRefs].some((reference) => reference !== this.#backendOperationRef)
    ) {
      this.fail('TURN_BINDING_MISMATCH');
    }
  }

  #recordItemEvaluation(
    evaluation: ReturnType<typeof evaluateCodexThreadItem>,
    item: JsonObject,
    location: CodexThreadItemLocation,
  ): void {
    if (evaluation.disposition === 'COMPACTION_POLICY_VIOLATION') {
      this.fail('COMPACTION_POLICY_VIOLATION');
    } else if (evaluation.disposition === 'UNSUPPORTED_BACKEND_ACTIVITY') {
      this.diagnoseUnsupported(
        Object.freeze({
          schemaVersion: 1,
          kind: 'UNSUPPORTED_ITEM',
          itemType: diagnosticToken(item['type']),
          location,
          reasonCode: evaluation.rejectionCode,
        }),
      );
    }
  }

  #recordItem(item: JsonObject, location: CodexThreadItemLocation): void {
    if (this.#itemPolicy === undefined) {
      this.diagnoseUnsupported(
        Object.freeze({ schemaVersion: 1, kind: 'ITEM_POLICY_UNAVAILABLE', location }),
      );
      return;
    }
    const evaluation = evaluateCodexThreadItem(item, location, this.#itemPolicy);
    this.#recordItemEvaluation(evaluation, item, location);
    if (
      evaluation.disposition === 'ALLOWED' &&
      location === 'COMPLETED' &&
      item['type'] === 'agentMessage'
    ) {
      if (this.#completedAgentMessages.length >= 256) {
        this.fail('INVALID_TERMINAL_PAYLOAD');
        return;
      }
      this.#completedAgentMessages.push(
        Object.freeze({ digest: digestCanonical(item), phase: item['phase'] }),
      );
    }
  }
}

function workerEventId(directive: CodexWorkerDirective): string {
  const digest = digestCanonical({
    adapterIdentityProfile: 'codex-worker-event-id-v1',
    externalExecutionIntentDigest: directive.externalExecutionIntentDigest,
    request: directive.request,
    workspaceLeaseDigest: directive.workspaceLease.leaseDigest,
  });
  return `worker-event_codex-${digest.slice('sha256:'.length, 'sha256:'.length + 64)}`;
}

function workerEvent(
  directive: CodexWorkerDirective,
  request: WorkerRequest,
  observedAt: string,
  result:
    | Readonly<{
        claimedScope: string;
        kind: 'COMPLETION_REQUEST';
        proposedEvidenceRefs: readonly string[];
        summary: string;
      }>
    | undefined,
): WorkerEvent {
  const event = decodeWorkerEvent({
    schemaVersion: 1,
    id: workerEventId(directive),
    workerSessionId: request.workerSessionId,
    attemptId: request.attemptId,
    contextManifestId: request.contextManifestId,
    contextManifestDigest: request.contextManifestDigest,
    packageDigest: request.packageDigest,
    observedAt,
    ...(result === undefined
      ? { type: 'WORKER_FAILURE', reasonCode: 'WORKER_BACKEND_FAILURE' }
      : { type: 'WORKER_RESULT', result }),
  });
  assertWorkerEventBindsRequest(event, request);
  assertWorkerEventWithinResponseContract(event, request);
  return event;
}

async function waitForTerminal(
  client: AppServerClient,
  observer: InvocationObserver,
  signal: AbortSignal,
  timeoutMilliseconds: number,
): Promise<WaitResult> {
  let timer: NodeJS.Timeout | undefined;
  let removeAbort = (): void => undefined;
  const timeout = new Promise<WaitResult>((resolveTimeout) => {
    timer = setTimeout(
      () => resolveTimeout(Object.freeze({ kind: 'TIMEOUT' })),
      timeoutMilliseconds,
    );
    timer.unref();
  });
  const abort = new Promise<WaitResult>((resolveAbort) => {
    const onAbort = (): void => resolveAbort(Object.freeze({ kind: 'ABORT' }));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
    if (hostCancelled(signal)) {
      onAbort();
    }
  });
  try {
    return await Promise.race([
      observer.terminalPromise.then(
        (terminal) => Object.freeze({ kind: 'TERMINAL', terminal }) as WaitResultTerminal,
      ),
      observer.failurePromise.then(() => Object.freeze({ kind: 'POLICY_FAILURE' }) as WaitResult),
      client.closed.then(() => Object.freeze({ kind: 'CLOSED' }) as WaitResult),
      abort,
      timeout,
    ]);
  } finally {
    removeAbort();
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function mapUnknownFailure(error: unknown, signal: AbortSignal): CodexAdapterFailureCode {
  if (
    signal.aborted ||
    (error instanceof AppServerClientError &&
      error.code === AppServerClientErrorCode.HOST_CANCELLED)
  ) {
    return 'HOST_CANCELLED';
  }
  return error instanceof Error && 'adapterCode' in error
    ? (Reflect.get(error, 'adapterCode') as CodexAdapterFailureCode)
    : 'CLIENT_FAILURE';
}

export class CodexWorkerAdapter implements WorkerPort {
  readonly #clientLimits: Partial<AppServerClientLimits> | undefined;
  readonly #directive: CodexWorkerDirective;
  readonly #launch: AppServerProcessLaunch;
  readonly #onLifecycleEvent: (event: unknown) => void;
  readonly #observedAt: () => string;
  #observer: InvocationObserver;
  #used = false;

  public constructor(input: CodexWorkerAdapterInput) {
    this.#directive = decodeCodexWorkerDirective(input.directive);
    assertLaunchBindsDirective(this.#directive, input.launch);
    if (typeof input.onLifecycleEvent !== 'function') {
      throw new TypeError('Codex Worker lifecycle handler is required');
    }
    this.#launch = input.launch;
    this.#onLifecycleEvent = input.onLifecycleEvent;
    this.#observedAt = input.observedAt;
    this.#clientLimits = input.clientLimits;
    this.#observer = new InvocationObserver(this.#directive, input.onDiagnosticEvent);
  }

  public observation(): CodexAdapterObservation {
    return this.#observer.snapshot();
  }

  public runtimeObservation(): unknown {
    const observation = this.#observer.snapshot();
    return Object.freeze({
      schemaVersion: 1,
      externalExecutionIntentDigest: observation.externalExecutionIntentDigest,
      requestAttemptId: observation.requestAttemptId,
      requestWorkerSessionId: observation.requestWorkerSessionId,
      state: observation.state,
      processLaunchCount: observation.processLaunchCount,
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
    });
  }

  public async *run(rawRequest: WorkerRequest, signal: AbortSignal): AsyncIterable<unknown> {
    if (this.#used) {
      this.#observer.fail('ADAPTER_REUSED');
      return;
    }
    this.#used = true;
    if (rawRequest.contextPackage.phase !== 'IMPLEMENT') {
      this.#observer.fail('UNSUPPORTED_PHASE');
      return;
    }
    let request: WorkerRequest;
    try {
      request = assertDirectiveBindsWorkerRequest(this.#directive, rawRequest);
      repeatWorkspaceChecks(this.#directive, this.#launch);
      assertInstructionSourcesCurrent(this.#directive);
    } catch (error) {
      this.#observer.fail(
        error instanceof Error && 'adapterCode' in error
          ? (Reflect.get(error, 'adapterCode') as CodexAdapterFailureCode)
          : 'INVALID_REQUEST_BINDING',
      );
      return;
    }
    if (hostCancelled(signal)) {
      this.#observer.cancel();
      return;
    }

    this.#observer.markRunning();
    let client: AppServerClient | undefined;
    let terminalEvent: WorkerEvent | undefined;
    try {
      const observer = this.#observer;
      const recordApproval = (projection: ApprovalProjection): JsonObject => {
        observer.recordApproval(projection);
        return Object.freeze({ decision: 'decline' });
      };
      client = await startAppServerClient({
        initialize: {
          capabilities: {
            experimentalApi: false,
            mcpServerOpenaiFormElicitation: false,
            requestAttestation: false,
          },
          clientInfo: {
            name: 'codeclosure_m2_worker',
            title: 'CodeClosure M2 Worker',
            version: '0.0.0',
          },
        },
        launch: this.#launch,
        launchNonce: this.#directive.processLaunchNonce,
        ...(this.#clientLimits === undefined ? {} : { limits: this.#clientLimits }),
        onCompactionEvent: (event) => observer.recordCompaction(event),
        onNotification: (notification) => observer.recordNotification(notification),
        onProcessStarted: (identity) => {
          observer.markProcessLaunch();
          this.emitProcessStarted(identity);
        },
        serverRequestHandlers: [
          serverRequestHandler({
            decodeParams: decodeCommandApproval,
            handle: recordApproval,
            method: 'item/commandExecution/requestApproval',
          }),
          serverRequestHandler({
            decodeParams: decodeFileApproval,
            handle: recordApproval,
            method: 'item/fileChange/requestApproval',
          }),
        ],
      });

      const requestOptions = Object.freeze({ signal });
      const requirements = await client.request(
        'configRequirements/read',
        undefined,
        (value) => value,
        requestOptions,
      );
      assertManagedRequirements(requirements, this.#directive);
      const config = await client.request(
        'config/read',
        { cwd: this.#directive.workspaceLease.root, includeLayers: true },
        (value) => value,
        requestOptions,
      );
      assertEffectiveConfiguration(config, this.#directive);
      const profiles = await client.request(
        'permissionProfile/list',
        { cwd: this.#directive.workspaceLease.root },
        (value) => value,
        requestOptions,
      );
      assertPermissionProfile(profiles, this.#directive);
      assertInstructionSourcesCurrent(this.#directive);

      this.#observer.markThreadRequest();
      const commonThreadParameters = {
        approvalPolicy: this.#directive.profile.approvalPolicy,
        approvalsReviewer: this.#directive.profile.approvalsReviewer,
        config: candidateThreadConfiguration(this.#directive),
        cwd: this.#directive.workspaceLease.root,
        developerInstructions: CODEX_WORKER_DEVELOPER_INSTRUCTIONS,
        model: this.#directive.profile.model,
        modelProvider: this.#directive.profile.modelProvider,
        sandbox: 'workspace-write' as const,
        serviceTier: this.#directive.profile.serviceTier,
      };
      const effective =
        this.#directive.profile.thread.kind === 'FRESH'
          ? await client.request(
              'thread/start',
              { ...commonThreadParameters, ephemeral: false },
              decodeEffectiveThread,
              requestOptions,
            )
          : await client.request(
              'thread/resume',
              {
                ...commonThreadParameters,
                threadId: this.#directive.profile.thread.backendSessionRef,
              },
              decodeEffectiveThread,
              requestOptions,
            );
      if (
        this.#directive.profile.thread.kind === 'RESUME' &&
        effective.threadId !== this.#directive.profile.thread.backendSessionRef
      ) {
        throw adapterFailure('THREAD_BINDING_MISMATCH');
      }
      assertEffectiveThread(effective, this.#directive);
      const postStartConfig = await client.request(
        'config/read',
        { cwd: this.#directive.workspaceLease.root, includeLayers: true },
        (value) => value,
        requestOptions,
      );
      assertEffectiveConfiguration(postStartConfig, this.#directive);
      assertInstructionSourcesCurrent(this.#directive);
      this.#observer.bindThread(effective.threadId);
      this.#observer.throwIfFailed();
      this.emitLifecycleEvent({
        kind: 'SESSION_STARTED',
        backendSessionRef: effective.threadId,
      });

      if (this.#directive.profile.compactionPolicy === 'MANUAL_BEFORE_OPERATION') {
        if (hostCancelled(signal)) {
          throw adapterFailure('HOST_CANCELLED');
        }
        this.#observer.beginManualCompaction();
        this.#observer.throwIfFailed();
        const compacted = await client.compactThread({ threadId: effective.threadId });
        if (compacted.threadId !== effective.threadId) {
          throw adapterFailure('THREAD_BINDING_MISMATCH');
        }
        this.#observer.finishManualCompaction();
        this.#observer.throwIfFailed();
        if (hostCancelled(signal)) {
          throw adapterFailure('HOST_CANCELLED');
        }
      }

      const prompt = renderCodexWorkerPrompt(this.#directive, request);
      if (Buffer.byteLength(prompt, 'utf8') > this.#directive.profile.maximumPromptBytes) {
        throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
      }
      const itemPolicy = Object.freeze({
        expectedUserMessageDigest: digestCanonical(prompt),
      });
      this.#observer.bindItemPolicy(itemPolicy);
      this.#observer.throwIfFailed();
      this.#observer.markTurnRequest();
      const started = await client.request(
        'turn/start',
        {
          approvalPolicy: this.#directive.profile.approvalPolicy,
          approvalsReviewer: this.#directive.profile.approvalsReviewer,
          cwd: this.#directive.workspaceLease.root,
          effort: this.#directive.profile.reasoningEffort,
          input: [{ text: prompt, text_elements: [], type: 'text' }],
          model: this.#directive.profile.model,
          outputSchema: toProtocolJsonValue(codexWorkerOutputSchema(this.#directive)),
          sandboxPolicy: candidateTurnSandboxPolicy(this.#directive.workspaceLease.root),
          serviceTier: this.#directive.profile.serviceTier,
          threadId: effective.threadId,
        },
        decodeStartedTurn,
        requestOptions,
      );
      this.#observer.bindTurn(started.turnId);
      this.#observer.throwIfFailed();
      this.emitLifecycleEvent({
        kind: 'OPERATION_STARTED',
        backendSessionRef: effective.threadId,
        backendOperationRef: started.turnId,
        compactionCount: this.#observer.snapshot().compactionCount,
      });

      const wait = await waitForTerminal(
        client,
        this.#observer,
        signal,
        this.#directive.profile.terminalTimeoutMilliseconds,
      );
      const activeClient = client;
      const interruptKnownTurn = async (): Promise<void> => {
        this.#observer.markTurnInterrupt();
        try {
          await activeClient.interruptTurn({
            threadId: effective.threadId,
            turnId: started.turnId,
          });
        } catch {
          // The original host stop remains authoritative if interruption cannot be acknowledged.
        }
      };
      if (wait.kind === 'ABORT') {
        await interruptKnownTurn();
        throw adapterFailure('HOST_CANCELLED');
      }
      if (wait.kind === 'POLICY_FAILURE') {
        const failureCode = this.#observer.failureCode;
        throw adapterFailure(failureCode ?? 'UNSUPPORTED_BACKEND_ACTIVITY');
      }
      if (wait.kind === 'CLOSED') {
        throw adapterFailure('CLIENT_FAILURE');
      }
      if (wait.kind === 'TIMEOUT') {
        await interruptKnownTurn();
        throw adapterFailure('NO_TERMINAL_PAYLOAD');
      }
      if (hostCancelled(signal)) {
        throw adapterFailure('HOST_CANCELLED');
      }
      if (
        wait.terminal.threadId !== effective.threadId ||
        wait.terminal.turnId !== started.turnId
      ) {
        throw adapterFailure('TURN_BINDING_MISMATCH');
      }
      if (wait.terminal.status !== 'completed') {
        this.#observer.fail('BACKEND_TURN_FAILED');
        terminalEvent = workerEvent(this.#directive, request, this.#observedAt(), undefined);
      } else {
        if (wait.terminal.error !== null) {
          throw adapterFailure('INVALID_TERMINAL_PAYLOAD');
        }
        let result;
        try {
          const finalText = selectFinalAgentMessage(
            wait.terminal,
            itemPolicy,
            this.#observer.completedAgentMessages(),
          );
          result = decodeFinalCompletionRequest(
            finalText,
            this.#directive,
            request.contextPackage.responseContract.maxEventBytes,
          );
        } catch {
          throw adapterFailure('INVALID_TERMINAL_PAYLOAD');
        }
        terminalEvent = workerEvent(this.#directive, request, this.#observedAt(), result);
      }
    } catch (error) {
      const failureCode = mapUnknownFailure(error, signal);
      if (failureCode === 'HOST_CANCELLED') {
        this.#observer.cancel();
      } else {
        this.#observer.fail(failureCode);
      }
    } finally {
      if (client !== undefined) {
        try {
          const close = await client.shutdown();
          if (close.code !== 0 || close.failureCode !== undefined) {
            terminalEvent = undefined;
            if (this.#observer.failureCode === undefined) {
              this.#observer.fail('CLEAN_SHUTDOWN_FAILED');
            }
          }
        } catch {
          terminalEvent = undefined;
          if (this.#observer.failureCode === undefined) {
            this.#observer.fail('CLEAN_SHUTDOWN_FAILED');
          }
        }
      }
    }

    if (hostCancelled(signal)) {
      terminalEvent = undefined;
      this.#observer.cancel();
    }

    if (
      terminalEvent !== undefined &&
      (this.#observer.failureCode === undefined ||
        this.#observer.failureCode === 'BACKEND_TURN_FAILED')
    ) {
      this.#observer.complete(terminalEvent.id);
    }
    let terminalObservation = this.#observer.snapshot();
    if (terminalObservation.state === 'READY' || terminalObservation.state === 'RUNNING') {
      this.#observer.fail('CLIENT_FAILURE');
      terminalEvent = undefined;
      terminalObservation = this.#observer.snapshot();
    }
    if (terminalEvent !== undefined && terminalObservation.resultEventId === terminalEvent.id) {
      yield terminalEvent;
    }
    this.emitLifecycleEvent({
      kind: 'TERMINAL',
      state: terminalObservation.state,
      processLaunchCount: terminalObservation.processLaunchCount,
      ...(terminalObservation.backendSessionRef === undefined
        ? {}
        : { backendSessionRef: terminalObservation.backendSessionRef }),
      ...(terminalObservation.backendOperationRef === undefined
        ? {}
        : { backendOperationRef: terminalObservation.backendOperationRef }),
      compactionCount: terminalObservation.compactionCount,
      turnInterruptCount: terminalObservation.turnInterruptCount,
      ...(terminalObservation.failureCode === undefined
        ? {}
        : { failureCode: terminalObservation.failureCode }),
      ...(terminalObservation.resultEventId === undefined
        ? {}
        : { resultEventId: terminalObservation.resultEventId }),
    });
  }

  private emitProcessStarted(identity: AppServerProcessIdentity): void {
    const semantic = Object.freeze({
      schemaVersion: identity.schemaVersion,
      launchNonce: identity.launchNonce,
      processId: identity.processId,
      processGroupId: identity.processGroupId,
      processGroupKind: identity.processGroupKind,
      processStartIdentity: identity.processStartIdentity,
      executableIdentityDigest: identity.executableIdentityDigest,
      controlledStateRootIdentity: identity.controlledStateRootIdentity,
    });
    this.emitLifecycleEvent({
      kind: 'PROCESS_STARTED',
      processIdentity: Object.freeze({
        ...semantic,
        identityDigest: digestCanonical(semantic),
      }),
    });
  }

  private emitLifecycleEvent(event: Readonly<Record<string, unknown>>): void {
    this.#onLifecycleEvent(
      Object.freeze({
        schemaVersion: 1,
        externalExecutionIntentDigest: this.#directive.externalExecutionIntentDigest,
        requestAttemptId: this.#directive.request.attemptId,
        requestWorkerSessionId: this.#directive.request.workerSessionId,
        ...event,
      }),
    );
  }
}

export function createCodexWorkerAdapter(input: CodexWorkerAdapterInput): CodexWorkerAdapter {
  return new CodexWorkerAdapter(input);
}
