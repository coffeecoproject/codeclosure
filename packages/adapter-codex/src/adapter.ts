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
  assertDirectiveBindsWorkerRequest,
  assertLaunchBindsDirective,
  codexWorkerOutputSchema,
  decodeCodexWorkerDirective,
  digestCanonical,
  renderCodexWorkerPrompt,
  type CodexAdapterFailureCode,
  type CodexAdapterObservation,
  type CodexWorkerDirective,
} from './contracts.js';
import {
  decodeEffectiveThread,
  decodeFinalCompletionRequest,
  codexThreadItemDisposition,
  decodeStartedTurn,
  digestProtocolValue,
  projectTerminalTurn,
  selectFinalAgentMessage,
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
  'remoteControl/',
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
  WaitResultTerminal | Readonly<{ kind: 'ABORT' | 'CLOSED' | 'POLICY_FAILURE' | 'TIMEOUT' }>;

export interface CodexWorkerAdapterInput {
  readonly clientLimits?: Partial<AppServerClientLimits>;
  readonly directive: unknown;
  readonly launch: AppServerProcessLaunch;
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
  const isolatedHostRoots = [
    Object.freeze({
      allowExactForbiddenIdentity: true,
      root: directive.profile.controlledStateRootIdentity,
    }),
    Object.freeze({ allowExactForbiddenIdentity: false, root: processHome }),
    Object.freeze({ allowExactForbiddenIdentity: false, root: temporaryDirectory }),
  ];
  for (let index = 0; index < isolatedHostRoots.length; index += 1) {
    const isolatedRoot = isolatedHostRoots[index];
    const root = isolatedRoot?.root;
    if (
      isolatedRoot === undefined ||
      root === undefined ||
      pathsOverlap(root, lease.root) ||
      pathsOverlap(root, lease.workspaceRootIdentity) ||
      pathsOverlap(root, lease.sourceProjectRoot) ||
      lease.forbiddenRoots.some(
        (forbidden) =>
          !(isolatedRoot.allowExactForbiddenIdentity && forbidden === root) &&
          pathsOverlap(root, forbidden),
      ) ||
      isolatedHostRoots.slice(index + 1).some((otherRoot) => pathsOverlap(root, otherRoot.root))
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
    effective.sandbox.writableRoots.length !== 1 ||
    effective.sandbox.writableRoots[0] !== directive.workspaceLease.root ||
    JSON.stringify(effective.instructionSources) !== JSON.stringify(expectedInstructions)
  ) {
    throw adapterFailure('EFFECTIVE_INPUT_MISMATCH');
  }
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
  if (
    config['model'] !== profile.model ||
    config['model_provider'] !== profile.modelProvider ||
    config['model_reasoning_effort'] !== profile.reasoningEffort ||
    config['approval_policy'] !== profile.approvalPolicy ||
    config['default_permissions'] !== profile.permissionProfileId ||
    config['web_search'] !== 'disabled'
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
  readonly #directive: CodexWorkerDirective;
  #failureCode?: CodexAdapterFailureCode;
  readonly #failurePromise: Promise<void>;
  #failureResolve!: () => void;
  #itemPolicy?: CodexThreadItemPolicy;
  #notificationCount = 0;
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

  public constructor(directive: CodexWorkerDirective) {
    this.#directive = directive;
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

  public fail(code: CodexAdapterFailureCode): void {
    if (this.#failureCode === undefined) {
      this.#failureCode = code;
      this.#state = code === 'HOST_CANCELLED' ? 'INTERRUPTED' : 'FAILED';
      this.#failureResolve();
    }
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
    this.#backendOperationRef = turnId;
    this.#validateRefs();
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
    this.#compactionCount += 1;
    this.#observedThreadRefs.add(event.threadId);
    this.#observedTurnRefs.add(event.turnId);
    this.#validateRefs();
    this.fail('COMPACTION_POLICY_VIOLATION');
  }

  public recordNotification(notification: AppServerNotification): void {
    this.#notificationCount += 1;
    if (this.#notificationCount > 10_000) {
      this.fail('UNSUPPORTED_BACKEND_ACTIVITY');
      return;
    }
    if (
      forbiddenNotificationMethods.has(notification.method) ||
      forbiddenNotificationPrefixes.some((prefix) => notification.method.startsWith(prefix))
    ) {
      this.fail('UNSUPPORTED_BACKEND_ACTIVITY');
    }
    const params = notification.params;
    const threadId = params['threadId'];
    const turnId = params['turnId'];
    if (typeof threadId === 'string') {
      this.#observedThreadRefs.add(threadId);
    }
    if (typeof turnId === 'string') {
      this.#observedTurnRefs.add(turnId);
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
        this.#observedTurnRefs.add(turn['id']);
      } else {
        this.fail('TURN_BINDING_MISMATCH');
      }
    }
    if (notification.method === 'item/started' || notification.method === 'item/completed') {
      const item = params['item'];
      if (!isJsonObject(item)) {
        this.fail('UNSUPPORTED_BACKEND_ACTIVITY');
      } else {
        this.#recordItem(item, notification.method === 'item/started' ? 'STARTED' : 'COMPLETED');
      }
    }
    const terminal = projectTerminalTurn(notification);
    if (terminal !== undefined) {
      for (const item of terminal.items) {
        if (!isJsonObject(item)) {
          this.fail('UNSUPPORTED_BACKEND_ACTIVITY');
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

  #recordItemDisposition(disposition: ReturnType<typeof codexThreadItemDisposition>): void {
    if (disposition === 'COMPACTION_POLICY_VIOLATION') {
      this.fail('COMPACTION_POLICY_VIOLATION');
    } else if (disposition === 'UNSUPPORTED_BACKEND_ACTIVITY') {
      this.fail('UNSUPPORTED_BACKEND_ACTIVITY');
    }
  }

  #recordItem(item: JsonObject, location: CodexThreadItemLocation): void {
    if (this.#itemPolicy === undefined) {
      this.fail('UNSUPPORTED_BACKEND_ACTIVITY');
      return;
    }
    this.#recordItemDisposition(codexThreadItemDisposition(item, location, this.#itemPolicy));
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
  readonly #observedAt: () => string;
  #observer: InvocationObserver;
  #used = false;

  public constructor(input: CodexWorkerAdapterInput) {
    this.#directive = decodeCodexWorkerDirective(input.directive);
    assertLaunchBindsDirective(this.#directive, input.launch);
    this.#launch = input.launch;
    this.#observedAt = input.observedAt;
    this.#clientLimits = input.clientLimits;
    this.#observer = new InvocationObserver(this.#directive);
  }

  public observation(): CodexAdapterObservation {
    return this.#observer.snapshot();
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
    this.#observer.markProcessLaunch();
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
        ...(this.#clientLimits === undefined ? {} : { limits: this.#clientLimits }),
        onCompactionEvent: (event) => observer.recordCompaction(event),
        onNotification: (notification) => observer.recordNotification(notification),
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
        config: {},
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
      this.#observer.bindThread(effective.threadId);
      this.#observer.throwIfFailed();

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
          sandboxPolicy: {
            excludeSlashTmp: true,
            excludeTmpdirEnvVar: true,
            networkAccess: false,
            type: 'workspaceWrite',
            writableRoots: [this.#directive.workspaceLease.root],
          },
          serviceTier: this.#directive.profile.serviceTier,
          threadId: effective.threadId,
        },
        decodeStartedTurn,
        requestOptions,
      );
      this.#observer.bindTurn(started.turnId);
      this.#observer.throwIfFailed();

      const wait = await waitForTerminal(
        client,
        this.#observer,
        signal,
        this.#directive.profile.terminalTimeoutMilliseconds,
      );
      if (wait.kind === 'ABORT') {
        this.#observer.markTurnInterrupt();
        try {
          await client.interruptTurn({ threadId: effective.threadId, turnId: started.turnId });
        } catch {
          // Cancellation remains host-owned even if the backend cannot acknowledge interruption.
        }
        throw adapterFailure('HOST_CANCELLED');
      }
      if (wait.kind === 'POLICY_FAILURE') {
        const failureCode = this.#observer.failureCode;
        throw adapterFailure(failureCode ?? 'UNSUPPORTED_BACKEND_ACTIVITY');
      }
      if (wait.kind === 'CLOSED') {
        throw adapterFailure('CLIENT_FAILURE');
      }
      if (wait.kind !== 'TERMINAL') {
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
          const finalText = selectFinalAgentMessage(wait.terminal, itemPolicy);
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
      yield terminalEvent;
    }
  }
}

export function createCodexWorkerAdapter(input: CodexWorkerAdapterInput): CodexWorkerAdapter {
  return new CodexWorkerAdapter(input);
}
