import { Buffer } from 'node:buffer';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, type Hash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

import {
  assertAppServerProcessLaunch,
  isValidDefaultPermissionProfileId,
  type AppServerLaunchSummary,
  type AppServerProcessLaunch,
} from './controlled-launch.js';
import {
  AppServerClientError,
  AppServerClientErrorCode,
  clientError,
  type AppServerClientErrorCode as ErrorCode,
} from './errors.js';
import { appServerClientLimits, type AppServerClientLimits } from './limits.js';
import {
  generatedClientMethods,
  generatedServerNotificationMethods,
  generatedServerRequestMethods,
  selectedStableClientMethods,
  type SelectedStableClientMethod,
} from './protocol-surface.js';
import type { ClientRequest } from './protocol/ClientRequest.js';
import type { InitializeParams } from './protocol/InitializeParams.js';
import type { InitializeResponse } from './protocol/InitializeResponse.js';
import type { ServerNotification } from './protocol/ServerNotification.js';
import type { ServerRequest } from './protocol/ServerRequest.js';
import { isJsonObject, parseBoundedJson, type JsonObject, type JsonValue } from './strict-json.js';
import {
  captureAppServerProcessIdentity,
  type AppServerProcessIdentity,
} from './process-ownership.js';

type GeneratedClientMethod = ClientRequest['method'];
type GeneratedNotificationMethod = ServerNotification['method'];
type GeneratedServerRequestMethod = ServerRequest['method'];
export type StableClientMethod = Exclude<SelectedStableClientMethod, 'initialize'> &
  GeneratedClientMethod;
export type StableClientRequest<M extends StableClientMethod> = Extract<
  ClientRequest,
  { readonly method: M }
>;
export type StableClientRequestParams<M extends StableClientMethod> =
  StableClientRequest<M>['params'];

export interface AppServerNotification {
  readonly method: GeneratedNotificationMethod;
  readonly params: JsonObject;
  readonly sequence: number;
}

export type CompactionSource = 'APP_SERVER_MANAGED' | 'REQUESTED_MANUAL';
export type CompactionStage = 'COMPLETED' | 'STARTED';

export interface AppServerCompactionEvent {
  readonly itemId: string;
  readonly source: CompactionSource;
  readonly stage: CompactionStage;
  readonly threadId: string;
  readonly turnId: string;
}

export interface CompletedManualCompaction {
  readonly itemId: string;
  readonly threadId: string;
  readonly turnId: string;
}

export interface AppServerStderrSummary {
  readonly capturedBytes: number;
  readonly digest: string;
  readonly truncated: boolean;
}

export interface AppServerCloseResult {
  readonly code: number | null;
  readonly failureCode?: ErrorCode;
  readonly requestedShutdown: boolean;
  readonly signal: NodeJS.Signals | null;
}

export type BufferedSandboxKind = 'READ_ONLY' | 'WORKSPACE_WRITE';

export interface BufferedSandboxCommandInput {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly sandboxKind: BufferedSandboxKind;
  readonly timeoutMilliseconds: number;
}

export interface BufferedSandboxCommandRequest {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly outputBytesCap: 1_024;
  readonly sandboxPolicy:
    | Readonly<{ networkAccess: false; type: 'readOnly' }>
    | Readonly<{
        excludeSlashTmp: true;
        excludeTmpdirEnvVar: true;
        networkAccess: false;
        type: 'workspaceWrite';
        writableRoots: readonly string[];
      }>;
  readonly timeoutMs: number;
}

export interface BufferedSandboxCommandResponse {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface BufferedSandboxCommandResult {
  readonly request: BufferedSandboxCommandRequest;
  readonly response: BufferedSandboxCommandResponse;
}

export interface ProfileBoundSandboxCommandInput {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly permissionProfileId: string;
  readonly timeoutMilliseconds: number;
}

export interface ProfileBoundSandboxCommandRequest {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly outputBytesCap: 1_024;
  readonly timeoutMs: number;
}

export interface ProfileBoundSandboxCommandResult {
  readonly request: ProfileBoundSandboxCommandRequest;
  readonly response: BufferedSandboxCommandResponse;
}

export type ProtocolDecoder<T> = (value: JsonValue) => T;

export interface RegisteredServerRequestHandler {
  readonly invoke: (params: JsonObject) => JsonValue | Promise<JsonValue>;
  readonly method: GeneratedServerRequestMethod;
}

export interface ServerRequestHandlerInput<M extends GeneratedServerRequestMethod, TParams> {
  readonly decodeParams: ProtocolDecoder<TParams>;
  readonly handle: (params: TParams) => JsonValue | Promise<JsonValue>;
  readonly method: M;
}

export function serverRequestHandler<
  M extends GeneratedServerRequestMethod,
  TParams extends Extract<ServerRequest, { readonly method: M }>['params'],
>(input: ServerRequestHandlerInput<M, TParams>): RegisteredServerRequestHandler {
  if (!generatedServerRequestMethods.includes(input.method)) {
    throw clientError(
      AppServerClientErrorCode.UNSUPPORTED_SERVER_REQUEST,
      'Server-request handler method is absent from the pinned protocol',
    );
  }
  return Object.freeze({
    invoke: async (params: JsonObject) => input.handle(input.decodeParams(params)),
    method: input.method,
  });
}

export interface StartAppServerClientInput {
  readonly initialize: InitializeParams;
  readonly launch: AppServerProcessLaunch;
  readonly launchNonce: string;
  readonly limits?: Partial<AppServerClientLimits>;
  readonly onCompactionEvent?: (event: AppServerCompactionEvent) => void;
  readonly onNotification?: (notification: AppServerNotification) => void;
  readonly onProcessStarted?: (identity: AppServerProcessIdentity) => void;
  readonly serverRequestHandlers?: readonly RegisteredServerRequestHandler[];
}

interface PendingRequest {
  readonly decoder: ProtocolDecoder<unknown>;
  readonly id: number;
  readonly method: string;
  readonly reject: (error: AppServerClientError) => void;
  readonly resolve: (value: unknown) => void;
  readonly timer: NodeJS.Timeout;
}

interface ManualCompactionTracker {
  completedItem?: CompletedManualCompaction;
  itemId?: string;
  readonly promise: Promise<CompletedManualCompaction>;
  readonly reject: (error: AppServerClientError) => void;
  readonly resolve: (result: CompletedManualCompaction) => void;
  readonly threadId: string;
  readonly timer: NodeJS.Timeout;
  turnCompleted?: boolean;
  turnId?: string;
}

interface ObservedCompaction {
  readonly itemId: string;
  readonly source: CompactionSource;
  readonly threadId: string;
  readonly turnId: string;
}

const notificationMethodSet = new Set<string>(generatedServerNotificationMethods);
const serverRequestMethodSet = new Set<string>(generatedServerRequestMethods);
const generatedClientMethodSet = new Set<string>(generatedClientMethods);
const stableClientMethodSet = new Set<string>(
  selectedStableClientMethods.filter((method) => method !== 'initialize'),
);

function safeString(value: JsonValue | undefined, maximumBytes = 4_096): string | undefined {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= maximumBytes
    ? value
    : undefined;
}

function requestIdKey(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'string' && value.length > 0 && value.length <= 256) {
    return `string:${value}`;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return `number:${value}`;
  }
  return undefined;
}

function decodeInitializeResponse(value: JsonValue, expectedCodexHome: string): InitializeResponse {
  if (!isJsonObject(value)) {
    throw new TypeError('initialize result must be an object');
  }
  const userAgent = safeString(value['userAgent']);
  const codexHome = safeString(value['codexHome']);
  const platformFamily = safeString(value['platformFamily']);
  const platformOs = safeString(value['platformOs']);
  if (
    userAgent === undefined ||
    codexHome !== expectedCodexHome ||
    platformFamily === undefined ||
    platformOs === undefined
  ) {
    throw new TypeError('initialize result does not match the controlled launch');
  }
  return Object.freeze({ codexHome, platformFamily, platformOs, userAgent });
}

export function decodeEmptyObject(value: JsonValue): Readonly<Record<string, never>> {
  if (!isJsonObject(value) || Object.keys(value).length !== 0) {
    throw new TypeError('protocol result must be an empty object');
  }
  return Object.freeze({});
}

function validateInitializeParams(params: InitializeParams): void {
  if (
    params.capabilities === null ||
    params.capabilities.experimentalApi ||
    params.capabilities.requestAttestation ||
    params.capabilities.mcpServerOpenaiFormElicitation === true
  ) {
    throw clientError(
      AppServerClientErrorCode.INITIALIZATION_FAILED,
      'The pinned stable client requires explicit non-experimental capabilities',
    );
  }
  const info = params.clientInfo;
  for (const value of [info.name, info.version, ...(info.title === null ? [] : [info.title])]) {
    if (value.length === 0 || Buffer.byteLength(value, 'utf8') > 256) {
      throw clientError(
        AppServerClientErrorCode.INITIALIZATION_FAILED,
        'Client metadata is outside the initialization contract',
      );
    }
  }
  const optOut = params.capabilities.optOutNotificationMethods ?? [];
  if (new Set(optOut).size !== optOut.length) {
    throw clientError(
      AppServerClientErrorCode.INITIALIZATION_FAILED,
      'Notification opt-out methods must be unique',
    );
  }
  for (const method of optOut) {
    if (!notificationMethodSet.has(method)) {
      throw clientError(
        AppServerClientErrorCode.INITIALIZATION_FAILED,
        'Notification opt-out method is absent from the pinned protocol',
      );
    }
  }
}

function invalidBufferedSandboxCommandInput(): never {
  throw clientError(
    AppServerClientErrorCode.PROTOCOL_LIMIT,
    'Buffered sandbox command input is outside the selected boundary',
  );
}

function boundedCommandInput(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<{
  command: readonly string[];
  cwd: string;
  timeoutMilliseconds: number;
}> {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    JSON.stringify(Object.keys(input).toSorted()) !== JSON.stringify(expectedKeys)
  ) {
    return invalidBufferedSandboxCommandInput();
  }
  const rawCommand: unknown = Reflect.get(input, 'command');
  const cwd: unknown = Reflect.get(input, 'cwd');
  const timeoutMilliseconds: unknown = Reflect.get(input, 'timeoutMilliseconds');
  if (
    !Array.isArray(rawCommand) ||
    rawCommand.length === 0 ||
    rawCommand.length > 64 ||
    typeof cwd !== 'string' ||
    !isAbsolute(cwd) ||
    resolve(cwd) !== cwd ||
    cwd.normalize('NFC') !== cwd ||
    typeof timeoutMilliseconds !== 'number' ||
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > 600_000
  ) {
    return invalidBufferedSandboxCommandInput();
  }
  const command = rawCommand.map((value: unknown) => {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      Buffer.byteLength(value, 'utf8') > 16_384
    ) {
      return invalidBufferedSandboxCommandInput();
    }
    return value;
  });
  return Object.freeze({
    command: Object.freeze(command),
    cwd,
    timeoutMilliseconds,
  });
}

function bufferedSandboxCommandRequest(input: unknown): BufferedSandboxCommandRequest {
  const bounded = boundedCommandInput(
    input,
    Object.freeze(['command', 'cwd', 'sandboxKind', 'timeoutMilliseconds']),
  );
  const sandboxKind: unknown = Reflect.get(input as object, 'sandboxKind');
  if (sandboxKind !== 'READ_ONLY' && sandboxKind !== 'WORKSPACE_WRITE') {
    return invalidBufferedSandboxCommandInput();
  }
  const sandboxPolicy =
    sandboxKind === 'READ_ONLY'
      ? Object.freeze({ networkAccess: false, type: 'readOnly' })
      : Object.freeze({
          excludeSlashTmp: true,
          excludeTmpdirEnvVar: true,
          networkAccess: false,
          type: 'workspaceWrite',
          writableRoots: Object.freeze([bounded.cwd]),
        });
  return Object.freeze({
    command: bounded.command,
    cwd: bounded.cwd,
    outputBytesCap: 1_024,
    sandboxPolicy,
    timeoutMs: bounded.timeoutMilliseconds,
  });
}

function profileBoundSandboxCommandRequest(input: unknown): ProfileBoundSandboxCommandRequest {
  const bounded = boundedCommandInput(
    input,
    Object.freeze(['command', 'cwd', 'permissionProfileId', 'timeoutMilliseconds']),
  );
  const permissionProfileId: unknown = Reflect.get(input as object, 'permissionProfileId');
  if (!isValidDefaultPermissionProfileId(permissionProfileId)) {
    return invalidBufferedSandboxCommandInput();
  }
  return Object.freeze({
    command: bounded.command,
    cwd: bounded.cwd,
    outputBytesCap: 1_024,
    timeoutMs: bounded.timeoutMilliseconds,
  });
}

function decodeBufferedSandboxCommandResponse(value: JsonValue): BufferedSandboxCommandResponse {
  const exitCode = isJsonObject(value) ? value['exitCode'] : undefined;
  const stderr = isJsonObject(value) ? value['stderr'] : undefined;
  const stdout = isJsonObject(value) ? value['stdout'] : undefined;
  if (
    !isJsonObject(value) ||
    JSON.stringify(Object.keys(value).toSorted()) !==
      JSON.stringify(['exitCode', 'stderr', 'stdout']) ||
    typeof exitCode !== 'number' ||
    !Number.isSafeInteger(exitCode) ||
    typeof stderr !== 'string' ||
    Buffer.byteLength(stderr, 'utf8') > 1_024 ||
    typeof stdout !== 'string' ||
    Buffer.byteLength(stdout, 'utf8') > 1_024
  ) {
    throw new TypeError('command/exec result is outside the buffered sandbox boundary');
  }
  return Object.freeze({
    exitCode,
    stderr,
    stdout,
  });
}

function errorFromUnknown(
  error: unknown,
  fallbackCode: ErrorCode,
  fallbackMessage: string,
): AppServerClientError {
  return error instanceof AppServerClientError ? error : clientError(fallbackCode, fallbackMessage);
}

function timeoutResult(milliseconds: number): Promise<'TIMEOUT'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMEOUT'), milliseconds);
    timer.unref();
  });
}

function jsonLine(value: unknown, limits: AppServerClientLimits): Buffer {
  let source: string;
  try {
    const encoded = JSON.stringify(value, (_key, entry: unknown) => {
      if (
        typeof entry === 'bigint' ||
        typeof entry === 'function' ||
        typeof entry === 'symbol' ||
        entry === undefined
      ) {
        throw new TypeError('Outbound protocol value is not JSON');
      }
      return entry;
    });
    source = encoded;
  } catch {
    throw clientError(
      AppServerClientErrorCode.PROTOCOL_MALFORMED,
      'Outbound protocol message is not serializable JSON',
    );
  }
  const bytes = Buffer.from(`${source}\n`, 'utf8');
  if (bytes.length - 1 > limits.maximumOutgoingLineBytes) {
    throw clientError(
      AppServerClientErrorCode.PROTOCOL_LIMIT,
      'Outbound protocol message exceeds the line limit',
    );
  }
  try {
    parseBoundedJson(bytes.subarray(0, -1), {
      maximumCollectionEntries: limits.maximumCollectionEntries,
      maximumDepth: limits.maximumJsonDepth,
      maximumNodes: limits.maximumJsonNodes,
    });
  } catch {
    throw clientError(
      AppServerClientErrorCode.PROTOCOL_LIMIT,
      'Outbound protocol message exceeds the JSON structure limits',
    );
  }
  return bytes;
}

export class AppServerClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #closePromise: Promise<AppServerCloseResult>;
  #closeResolve!: (result: AppServerCloseResult) => void;
  #closed = false;
  #failure?: AppServerClientError;
  readonly #handlers = new Map<string, RegisteredServerRequestHandler>();
  readonly #initializeParams: InitializeParams;
  #initialization?: InitializeResponse;
  #initializationHandshakeCompleted = false;
  #initializationStarted = false;
  readonly #launch: AppServerProcessLaunch;
  readonly #limits: AppServerClientLimits;
  readonly #manualCompactions = new Map<string, ManualCompactionTracker>();
  #nextRequestId = 1;
  #notificationSequence = 0;
  readonly #observedCompactions = new Map<string, ObservedCompaction>();
  readonly #onCompactionEvent: ((event: AppServerCompactionEvent) => void) | undefined;
  readonly #onNotification: ((notification: AppServerNotification) => void) | undefined;
  readonly #onProcessStarted: ((identity: AppServerProcessIdentity) => void) | undefined;
  readonly #pending = new Map<string, PendingRequest>();
  #ready = false;
  #requestedShutdown = false;
  readonly #seenServerRequestIds = new Set<string>();
  #spawnPromise: Promise<void>;
  #processIdentity: AppServerProcessIdentity | undefined;
  #stderrCapturedBytes = 0;
  readonly #stderrHash: Hash = createHash('sha256');
  #stderrTruncated = false;
  #stdoutBuffer = Buffer.alloc(0);
  #writeChain: Promise<void> = Promise.resolve();

  public constructor(input: StartAppServerClientInput) {
    validateInitializeParams(input.initialize);
    this.#initializeParams = input.initialize;
    this.#launch = input.launch;
    this.#limits = appServerClientLimits(input.limits);
    this.#onCompactionEvent = input.onCompactionEvent;
    this.#onNotification = input.onNotification;
    this.#onProcessStarted = input.onProcessStarted;
    for (const handler of input.serverRequestHandlers ?? []) {
      if (this.#handlers.has(handler.method)) {
        throw clientError(
          AppServerClientErrorCode.UNSUPPORTED_SERVER_REQUEST,
          'Server-request methods may be registered only once',
        );
      }
      this.#handlers.set(handler.method, handler);
    }

    assertAppServerProcessLaunch(input.launch);
    try {
      this.#child = spawn(input.launch.executablePath, [...input.launch.arguments], {
        cwd: input.launch.cwd,
        detached: process.platform !== 'win32',
        env: { ...input.launch.environment },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw clientError(AppServerClientErrorCode.SPAWN_FAILED, 'App Server process did not spawn');
    }

    this.#closePromise = new Promise((resolve) => {
      this.#closeResolve = resolve;
    });
    this.#spawnPromise = new Promise((resolve, reject) => {
      this.#child.once('spawn', () => {
        try {
          const processId = this.#child.pid;
          if (processId === undefined) {
            throw clientError(
              AppServerClientErrorCode.SPAWN_FAILED,
              'App Server process has no host process identity',
            );
          }
          this.#processIdentity = captureAppServerProcessIdentity({
            processId,
            launchNonce: input.launchNonce,
            executableIdentityDigest: input.launch.summary.delegatedExecutableDigest,
            controlledStateRootIdentity: input.launch.summary.codexHome,
          });
          this.#onProcessStarted?.(this.#processIdentity);
          resolve();
        } catch (error) {
          const failure =
            error instanceof AppServerClientError
              ? error
              : clientError(
                  AppServerClientErrorCode.SPAWN_FAILED,
                  'App Server process identity could not be admitted',
                );
          this.#fail(failure);
          reject(failure);
        }
      });
      this.#child.once('error', () => {
        const error = clientError(
          AppServerClientErrorCode.SPAWN_FAILED,
          'App Server process reported a spawn failure',
        );
        this.#fail(error);
        reject(error);
      });
    });
    this.#spawnPromise.catch(() => undefined);
    this.#child.stdout.on('data', (chunk: Buffer) => this.#receiveStdout(chunk));
    this.#child.stdout.once('end', () => this.#stdoutEnded());
    this.#child.stdout.once('error', () => {
      if (this.#requestedShutdown || this.#closed) {
        return;
      }
      this.#fail(clientError(AppServerClientErrorCode.STREAM_FAILED, 'App Server stdout failed'));
    });
    this.#child.stdin.once('error', () => {
      if (this.#requestedShutdown || this.#closed) {
        return;
      }
      this.#fail(clientError(AppServerClientErrorCode.STREAM_FAILED, 'App Server stdin failed'));
    });
    this.#child.stderr.on('data', (chunk: Buffer) => this.#receiveStderr(chunk));
    this.#child.once('close', (code, signal) => this.#processExited(code, signal));
  }

  public get launchSummary(): AppServerLaunchSummary {
    return this.#launch.summary;
  }

  public get processIdentity(): AppServerProcessIdentity {
    if (this.#processIdentity === undefined) {
      throw clientError(
        AppServerClientErrorCode.SPAWN_FAILED,
        'App Server process identity is not available',
      );
    }
    return this.#processIdentity;
  }

  public get closed(): Promise<AppServerCloseResult> {
    return this.#closePromise;
  }

  public get initialization(): InitializeResponse {
    if (this.#initialization === undefined) {
      throw clientError(
        AppServerClientErrorCode.INITIALIZATION_FAILED,
        'App Server initialization has not completed',
      );
    }
    return this.#initialization;
  }

  public async initialize(): Promise<void> {
    if (this.#initializationStarted) {
      throw clientError(
        AppServerClientErrorCode.INITIALIZATION_FAILED,
        'App Server connection may be initialized only once',
      );
    }
    this.#initializationStarted = true;
    await this.#spawnPromise;
    try {
      this.#initialization = await this.#requestInternal(
        'initialize',
        this.#initializeParams,
        (value) => decodeInitializeResponse(value, this.#launch.summary.codexHome),
        this.#limits.initializationTimeoutMilliseconds,
        true,
      );
      await this.#send({ method: 'initialized' });
      if (this.#failure !== undefined || this.#closed) {
        throw (
          this.#failure ??
          clientError(
            AppServerClientErrorCode.INITIALIZATION_FAILED,
            'App Server closed during initialization',
          )
        );
      }
      this.#ready = true;
    } catch (error) {
      const failure = errorFromUnknown(
        error,
        AppServerClientErrorCode.INITIALIZATION_FAILED,
        'App Server initialization failed',
      );
      this.#fail(failure);
      throw failure;
    }
  }

  public request<M extends StableClientMethod, TResult>(
    method: M,
    params: StableClientRequestParams<M>,
    decoder: ProtocolDecoder<TResult>,
    options: Readonly<{ signal?: AbortSignal; timeoutMilliseconds?: number }> = {},
  ): Promise<TResult> {
    return this.#requestAdmitted(method, params, decoder, options, true);
  }

  public executeBufferedSandboxCommand(
    input: BufferedSandboxCommandInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<BufferedSandboxCommandResult> {
    if (!generatedClientMethodSet.has('command/exec')) {
      return Promise.reject(
        clientError(
          AppServerClientErrorCode.VERSION_MISMATCH,
          'The pinned protocol does not contain buffered sandbox execution',
        ),
      );
    }
    let request: BufferedSandboxCommandRequest;
    try {
      request = bufferedSandboxCommandRequest(input);
    } catch (error) {
      return Promise.reject(
        errorFromUnknown(
          error,
          AppServerClientErrorCode.PROTOCOL_LIMIT,
          'Buffered sandbox command input is invalid',
        ),
      );
    }
    return this.#requestAdmitted(
      'command/exec',
      request,
      decodeBufferedSandboxCommandResponse,
      {
        ...options,
        timeoutMilliseconds: input.timeoutMilliseconds,
      },
      false,
    ).then((response) => Object.freeze({ request, response }));
  }

  public executeProfileBoundSandboxCommand(
    input: ProfileBoundSandboxCommandInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<ProfileBoundSandboxCommandResult> {
    if (!generatedClientMethodSet.has('command/exec')) {
      return Promise.reject(
        clientError(
          AppServerClientErrorCode.VERSION_MISMATCH,
          'The pinned protocol does not contain buffered sandbox execution',
        ),
      );
    }
    let request: ProfileBoundSandboxCommandRequest;
    try {
      request = profileBoundSandboxCommandRequest(input);
      if (this.#launch.summary.defaultPermissionProfileId !== input.permissionProfileId) {
        return Promise.reject(
          clientError(
            AppServerClientErrorCode.INVALID_LAUNCH,
            'Profile-bound command does not match the controlled launch profile',
          ),
        );
      }
    } catch (error) {
      return Promise.reject(
        errorFromUnknown(
          error,
          AppServerClientErrorCode.PROTOCOL_LIMIT,
          'Profile-bound sandbox command input is invalid',
        ),
      );
    }
    return this.#requestAdmitted(
      'command/exec',
      request,
      decodeBufferedSandboxCommandResponse,
      {
        ...options,
        timeoutMilliseconds: input.timeoutMilliseconds,
      },
      false,
    ).then((response) => Object.freeze({ request, response }));
  }

  public interruptTurn(
    params: StableClientRequestParams<'turn/interrupt'>,
    timeoutMilliseconds = this.#limits.requestTimeoutMilliseconds,
  ): Promise<Readonly<Record<string, never>>> {
    return this.request('turn/interrupt', params, decodeEmptyObject, { timeoutMilliseconds });
  }

  public async compactThread(
    params: StableClientRequestParams<'thread/compact/start'>,
  ): Promise<CompletedManualCompaction> {
    const threadId = params.threadId;
    if (threadId.length === 0 || Buffer.byteLength(threadId, 'utf8') > 256) {
      throw clientError(
        AppServerClientErrorCode.PROTOCOL_MALFORMED,
        'Manual compaction requires a bounded Thread identifier',
      );
    }
    if (this.#manualCompactions.has(threadId)) {
      throw clientError(
        AppServerClientErrorCode.PROTOCOL_CORRELATION,
        'Only one manual compaction may be pending for a Thread',
      );
    }
    if (this.#manualCompactions.size >= this.#limits.maximumPendingManualCompactions) {
      throw clientError(
        AppServerClientErrorCode.PROTOCOL_LIMIT,
        'The pending manual-compaction limit is exhausted',
      );
    }
    let resolveTracker!: (result: CompletedManualCompaction) => void;
    let rejectTracker!: (error: AppServerClientError) => void;
    const promise = new Promise<CompletedManualCompaction>((resolve, reject) => {
      resolveTracker = resolve;
      rejectTracker = reject;
    });
    promise.catch(() => undefined);
    const timer = setTimeout(() => {
      this.#fail(
        clientError(
          AppServerClientErrorCode.REQUEST_TIMEOUT,
          'Manual compaction lifecycle timed out',
          { method: 'thread/compact/start' },
        ),
      );
    }, this.#limits.manualCompactionTimeoutMilliseconds);
    timer.unref();
    const tracker: ManualCompactionTracker = {
      promise,
      reject: rejectTracker,
      resolve: resolveTracker,
      threadId,
      timer,
    };
    this.#manualCompactions.set(threadId, tracker);
    try {
      await this.request('thread/compact/start', params, decodeEmptyObject);
      return await promise;
    } catch (error) {
      if (this.#manualCompactions.get(threadId) === tracker) {
        this.#manualCompactions.delete(threadId);
        clearTimeout(timer);
      }
      throw error;
    }
  }

  public stderrSummary(): AppServerStderrSummary {
    return Object.freeze({
      capturedBytes: this.#stderrCapturedBytes,
      digest: `sha256:${this.#stderrHash.copy().digest('hex')}`,
      truncated: this.#stderrTruncated,
    });
  }

  public async shutdown(): Promise<AppServerCloseResult> {
    if (this.#closed) {
      return this.#closePromise;
    }
    this.#requestedShutdown = true;
    this.#ready = false;
    this.#rejectPending(
      clientError(AppServerClientErrorCode.SHUTDOWN, 'App Server client is shutting down'),
    );
    this.#rejectCompactions(
      clientError(AppServerClientErrorCode.SHUTDOWN, 'App Server client is shutting down'),
    );
    this.#child.stdin.end();
    const graceful = await Promise.race([
      this.#closePromise,
      timeoutResult(this.#limits.shutdownGraceMilliseconds),
    ]);
    if (graceful !== 'TIMEOUT') {
      return graceful;
    }
    this.#signalOwnedProcess('SIGTERM');
    const terminated = await Promise.race([
      this.#closePromise,
      timeoutResult(this.#limits.shutdownKillMilliseconds),
    ]);
    if (terminated !== 'TIMEOUT') {
      return terminated;
    }
    this.#signalOwnedProcess('SIGKILL');
    const killed = await Promise.race([
      this.#closePromise,
      timeoutResult(this.#limits.shutdownKillMilliseconds),
    ]);
    if (killed === 'TIMEOUT') {
      const error = clientError(
        AppServerClientErrorCode.SHUTDOWN_TIMEOUT,
        'App Server process did not exit within the shutdown limit',
      );
      this.#failure ??= error;
      throw error;
    }
    return killed;
  }

  #requestAdmitted<TResult>(
    method: string,
    params: unknown,
    decoder: ProtocolDecoder<TResult>,
    options: Readonly<{ signal?: AbortSignal; timeoutMilliseconds?: number }>,
    requireSelectedMethod: boolean,
  ): Promise<TResult> {
    if (!this.#ready || this.#requestedShutdown || this.#closed) {
      return Promise.reject(
        clientError(AppServerClientErrorCode.SHUTDOWN, 'App Server client is not ready'),
      );
    }
    if (requireSelectedMethod && !stableClientMethodSet.has(method)) {
      return Promise.reject(
        clientError(
          AppServerClientErrorCode.UNSUPPORTED_METHOD,
          'Client request method is outside the selected stable protocol',
          { method },
        ),
      );
    }
    if (options.signal?.aborted === true) {
      return Promise.reject(
        clientError(AppServerClientErrorCode.HOST_CANCELLED, 'Host cancellation preceded request'),
      );
    }
    const request = this.#requestInternal(
      method,
      params,
      decoder,
      options.timeoutMilliseconds ?? this.#limits.requestTimeoutMilliseconds,
      false,
    );
    if (options.signal === undefined) {
      return request;
    }
    const signal = options.signal;
    const abort = (): void => {
      this.#fail(
        clientError(
          AppServerClientErrorCode.HOST_CANCELLED,
          'Host cancelled an in-flight App Server request',
          { method },
        ),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    return request.finally(() => signal.removeEventListener('abort', abort));
  }

  #requestInternal<TResult>(
    method: string,
    params: unknown,
    decoder: ProtocolDecoder<TResult>,
    timeoutMilliseconds: number,
    initialization: boolean,
  ): Promise<TResult> {
    if ((!initialization && !this.#ready) || this.#closed || this.#failure !== undefined) {
      return Promise.reject(
        this.#failure ??
          clientError(AppServerClientErrorCode.SHUTDOWN, 'App Server client is not available'),
      );
    }
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
      return Promise.reject(
        clientError(
          AppServerClientErrorCode.PROTOCOL_LIMIT,
          'Request timeout must be a positive safe integer',
        ),
      );
    }
    if (this.#pending.size >= this.#limits.maximumPendingRequests) {
      return Promise.reject(
        clientError(
          AppServerClientErrorCode.PROTOCOL_LIMIT,
          'The pending App Server request limit is exhausted',
        ),
      );
    }
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    const key = `number:${id}`;
    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail(
          clientError(AppServerClientErrorCode.REQUEST_TIMEOUT, 'App Server request timed out', {
            method,
          }),
        );
      }, timeoutMilliseconds);
      timer.unref();
      this.#pending.set(key, {
        decoder,
        id,
        method,
        reject,
        resolve: (value: unknown) => resolve(value as TResult),
        timer,
      });
      const message = params === undefined ? { id, method } : { id, method, params };
      void this.#send(message).catch((error: unknown) => {
        this.#fail(
          errorFromUnknown(
            error,
            AppServerClientErrorCode.STREAM_FAILED,
            'App Server request could not be written',
          ),
        );
      });
    });
  }

  #send(message: unknown): Promise<void> {
    let bytes: Buffer;
    try {
      bytes = jsonLine(message, this.#limits);
    } catch (error) {
      return Promise.reject(
        errorFromUnknown(
          error,
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'Outbound App Server message is invalid',
        ),
      );
    }
    this.#writeChain = this.#writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (this.#closed || this.#child.stdin.destroyed || !this.#child.stdin.writable) {
            reject(clientError(AppServerClientErrorCode.STREAM_FAILED, 'App Server stdin closed'));
            return;
          }
          this.#child.stdin.write(bytes, (error) => {
            if (error === null || error === undefined) {
              resolve();
            } else {
              reject(
                clientError(AppServerClientErrorCode.STREAM_FAILED, 'App Server stdin failed'),
              );
            }
          });
        }),
    );
    return this.#writeChain;
  }

  #receiveStdout(chunk: Buffer): void {
    if (this.#failure !== undefined || this.#closed) {
      return;
    }
    if (this.#stdoutBuffer.length + chunk.length > this.#limits.maximumBufferedStdoutBytes) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_LIMIT,
          'App Server stdout exceeds the buffer limit',
        ),
      );
      return;
    }
    this.#stdoutBuffer = Buffer.concat([this.#stdoutBuffer, chunk]);
    for (;;) {
      const newline = this.#stdoutBuffer.indexOf(0x0a);
      if (newline === -1) {
        break;
      }
      const line = this.#stdoutBuffer.subarray(0, newline);
      this.#stdoutBuffer = this.#stdoutBuffer.subarray(newline + 1);
      if (line.length === 0) {
        this.#fail(
          clientError(
            AppServerClientErrorCode.PROTOCOL_MALFORMED,
            'App Server emitted an empty protocol line',
          ),
        );
        return;
      }
      if (line.length > this.#limits.maximumProtocolLineBytes) {
        this.#fail(
          clientError(
            AppServerClientErrorCode.PROTOCOL_LIMIT,
            'App Server protocol line exceeds the limit',
          ),
        );
        return;
      }
      let message: JsonValue;
      try {
        message = parseBoundedJson(line, {
          maximumCollectionEntries: this.#limits.maximumCollectionEntries,
          maximumDepth: this.#limits.maximumJsonDepth,
          maximumNodes: this.#limits.maximumJsonNodes,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : '';
        this.#fail(
          clientError(
            messageText.includes('limit')
              ? AppServerClientErrorCode.PROTOCOL_LIMIT
              : AppServerClientErrorCode.PROTOCOL_MALFORMED,
            'App Server emitted invalid bounded JSON',
          ),
        );
        return;
      }
      this.#receiveMessage(message);
      if (this.#hasFailed()) {
        return;
      }
    }
    if (this.#stdoutBuffer.length > this.#limits.maximumProtocolLineBytes) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_LIMIT,
          'App Server partial protocol line exceeds the limit',
        ),
      );
    }
  }

  #receiveMessage(message: JsonValue): void {
    if (!isJsonObject(message)) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'App Server emitted a non-object protocol message',
        ),
      );
      return;
    }
    if (Object.hasOwn(message, 'jsonrpc')) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'App Server emitted the omitted JSON-RPC header',
        ),
      );
      return;
    }
    if (!this.#initializationHandshakeCompleted && Object.hasOwn(message, 'method')) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.INITIALIZATION_FAILED,
          'App Server emitted traffic before the initialization handshake completed',
          { method: safeString(message['method'], 256) ?? null },
        ),
      );
      return;
    }
    const hasMethod = Object.hasOwn(message, 'method');
    const hasId = Object.hasOwn(message, 'id');
    if (hasMethod) {
      if (hasId) {
        void this.#receiveServerRequest(message).catch((error: unknown) => {
          this.#fail(
            errorFromUnknown(
              error,
              AppServerClientErrorCode.SERVER_REQUEST_FAILED,
              'App Server request handling failed',
            ),
          );
        });
      } else {
        this.#receiveNotification(message);
      }
      return;
    }
    if (hasId) {
      this.#receiveResponse(message);
      return;
    }
    this.#fail(
      clientError(
        AppServerClientErrorCode.PROTOCOL_MALFORMED,
        'App Server emitted an unclassified protocol message',
      ),
    );
  }

  #receiveResponse(message: JsonObject): void {
    const key = requestIdKey(message['id']);
    if (key === undefined) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_CORRELATION,
          'App Server response has an invalid request identifier',
        ),
      );
      return;
    }
    const pending = this.#pending.get(key);
    if (pending === undefined) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_CORRELATION,
          'App Server response does not match one pending request',
        ),
      );
      return;
    }
    const hasResult = Object.hasOwn(message, 'result');
    const hasError = Object.hasOwn(message, 'error');
    if (hasResult === hasError) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'App Server response must contain exactly one result or error',
          { method: pending.method },
        ),
      );
      return;
    }
    this.#pending.delete(key);
    clearTimeout(pending.timer);
    if (hasError) {
      const errorValue = message['error'];
      if (!isJsonObject(errorValue)) {
        pending.reject(
          clientError(
            AppServerClientErrorCode.PROTOCOL_MALFORMED,
            'App Server error response has an invalid shape',
            { method: pending.method },
          ),
        );
        this.#fail(
          clientError(
            AppServerClientErrorCode.PROTOCOL_MALFORMED,
            'App Server error response has an invalid shape',
          ),
        );
        return;
      }
      const code = errorValue['code'];
      const messageText = safeString(errorValue['message'], 4_096);
      if (typeof code !== 'number' || !Number.isSafeInteger(code) || messageText === undefined) {
        const error = clientError(
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'App Server error response has an invalid shape',
          { method: pending.method },
        );
        pending.reject(error);
        this.#fail(error);
        return;
      }
      pending.reject(
        clientError(
          AppServerClientErrorCode.REQUEST_REJECTED,
          'App Server rejected a protocol request',
          { method: pending.method, protocolCode: code },
        ),
      );
      return;
    }
    try {
      const decoded = pending.decoder(message['result'] ?? null);
      if (pending.method === 'initialize') {
        this.#initializationHandshakeCompleted = true;
      }
      pending.resolve(decoded);
    } catch {
      const error = clientError(
        AppServerClientErrorCode.MALFORMED_RESPONSE,
        'App Server result failed its selected response decoder',
        { method: pending.method },
      );
      pending.reject(error);
      this.#fail(error);
    }
  }

  async #receiveServerRequest(message: JsonObject): Promise<void> {
    const method = safeString(message['method'], 256);
    const key = requestIdKey(message['id']);
    const params = message['params'];
    if (method === undefined || key === undefined || !isJsonObject(params)) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'App Server request has an invalid envelope',
        ),
      );
      return;
    }
    if (
      this.#seenServerRequestIds.has(key) ||
      this.#seenServerRequestIds.size >= this.#limits.maximumServerRequests
    ) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_CORRELATION,
          'App Server request identifier is duplicate or exceeds the session limit',
        ),
      );
      return;
    }
    this.#seenServerRequestIds.add(key);
    if (!serverRequestMethodSet.has(method)) {
      await this.#rejectUnsupportedServerRequest(message['id'] ?? null);
      return;
    }
    const typedMethod = method as GeneratedServerRequestMethod;
    const handler = this.#handlers.get(typedMethod);
    if (handler === undefined) {
      await this.#rejectUnsupportedServerRequest(message['id'] ?? null);
      return;
    }
    try {
      const result = await handler.invoke(params);
      await this.#send({ id: message['id'], result });
    } catch {
      try {
        await this.#send({
          error: { code: -32_000, message: 'Client server-request handler failed' },
          id: message['id'],
        });
      } finally {
        this.#fail(
          clientError(
            AppServerClientErrorCode.SERVER_REQUEST_FAILED,
            'A registered server-request handler failed closed',
            { method: typedMethod },
          ),
        );
      }
    }
  }

  async #rejectUnsupportedServerRequest(id: JsonValue): Promise<void> {
    try {
      await this.#send({
        error: { code: -32_601, message: 'Unsupported by the selected client policy' },
        id,
      });
    } finally {
      this.#fail(
        clientError(
          AppServerClientErrorCode.UNSUPPORTED_SERVER_REQUEST,
          'App Server requested an unsupported client operation',
        ),
      );
    }
  }

  #receiveNotification(message: JsonObject): void {
    const method = safeString(message['method'], 256);
    const params = message['params'];
    if (method === undefined || !notificationMethodSet.has(method) || !isJsonObject(params)) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'App Server notification is unsupported or malformed',
        ),
      );
      return;
    }
    if (this.#notificationSequence === Number.MAX_SAFE_INTEGER) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_LIMIT,
          'App Server notification sequence is exhausted',
        ),
      );
      return;
    }
    const notification: AppServerNotification = Object.freeze({
      method: method as GeneratedNotificationMethod,
      params,
      sequence: ++this.#notificationSequence,
    });
    this.#observeCompaction(notification);
    if (this.#failure !== undefined) {
      return;
    }
    try {
      this.#onNotification?.(notification);
    } catch {
      this.#fail(
        clientError(
          AppServerClientErrorCode.HOST_HANDLER_FAILED,
          'The host notification handler failed',
          { method },
        ),
      );
    }
  }

  #observeCompaction(notification: AppServerNotification): void {
    if (notification.method === 'turn/completed') {
      const threadId = safeString(notification.params['threadId'], 256);
      const turn = notification.params['turn'];
      const turnId = isJsonObject(turn) ? safeString(turn['id'], 256) : undefined;
      if (threadId === undefined || turnId === undefined) {
        return;
      }
      const tracker = this.#manualCompactions.get(threadId);
      if (tracker?.turnId === turnId) {
        if (tracker.turnCompleted) {
          this.#fail(
            clientError(
              AppServerClientErrorCode.PROTOCOL_CORRELATION,
              'Manual compaction terminal Turn is duplicate',
            ),
          );
          return;
        }
        tracker.turnCompleted = true;
        this.#completeManualCompaction(tracker);
      }
      return;
    }
    if (notification.method !== 'item/started' && notification.method !== 'item/completed') {
      return;
    }
    const item = notification.params['item'];
    if (!isJsonObject(item) || item['type'] !== 'contextCompaction') {
      return;
    }
    const itemId = safeString(item['id'], 256);
    const threadId = safeString(notification.params['threadId'], 256);
    const turnId = safeString(notification.params['turnId'], 256);
    if (itemId === undefined || threadId === undefined || turnId === undefined) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'Context-compaction lifecycle identifiers are malformed',
        ),
      );
      return;
    }
    if (notification.method === 'item/started') {
      if (this.#observedCompactions.has(itemId)) {
        this.#fail(
          clientError(
            AppServerClientErrorCode.PROTOCOL_CORRELATION,
            'Context-compaction start is duplicate',
          ),
        );
        return;
      }
      if (this.#observedCompactions.size >= this.#limits.maximumObservedCompactions) {
        this.#fail(
          clientError(
            AppServerClientErrorCode.PROTOCOL_LIMIT,
            'Unfinished context-compaction lifecycles exceed the client limit',
          ),
        );
        return;
      }
      const tracker = this.#manualCompactions.get(threadId);
      const source: CompactionSource =
        tracker === undefined ? 'APP_SERVER_MANAGED' : 'REQUESTED_MANUAL';
      if (tracker !== undefined) {
        if (tracker.itemId !== undefined || tracker.turnId !== undefined) {
          this.#fail(
            clientError(
              AppServerClientErrorCode.PROTOCOL_CORRELATION,
              'Manual compaction received more than one lifecycle start',
            ),
          );
          return;
        }
        tracker.itemId = itemId;
        tracker.turnId = turnId;
      }
      this.#observedCompactions.set(itemId, Object.freeze({ itemId, source, threadId, turnId }));
      this.#emitCompaction({ itemId, source, stage: 'STARTED', threadId, turnId });
      return;
    }
    const observed = this.#observedCompactions.get(itemId);
    if (observed?.threadId !== threadId || observed.turnId !== turnId) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_CORRELATION,
          'Context-compaction completion has no matching lifecycle start',
        ),
      );
      return;
    }
    this.#observedCompactions.delete(itemId);
    this.#emitCompaction({ ...observed, stage: 'COMPLETED' });
    if (observed.source === 'REQUESTED_MANUAL') {
      const tracker = this.#manualCompactions.get(threadId);
      if (tracker?.itemId !== itemId || tracker.turnId !== turnId) {
        this.#fail(
          clientError(
            AppServerClientErrorCode.PROTOCOL_CORRELATION,
            'Manual compaction lifecycle does not match its pending request',
          ),
        );
        return;
      }
      tracker.completedItem = Object.freeze({ itemId, threadId, turnId });
      this.#completeManualCompaction(tracker);
    }
  }

  #completeManualCompaction(tracker: ManualCompactionTracker): void {
    if (tracker.completedItem === undefined || tracker.turnCompleted !== true) {
      return;
    }
    if (this.#manualCompactions.get(tracker.threadId) !== tracker) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_CORRELATION,
          'Manual compaction completion lost its pending request',
        ),
      );
      return;
    }
    this.#manualCompactions.delete(tracker.threadId);
    clearTimeout(tracker.timer);
    tracker.resolve(tracker.completedItem);
  }

  #emitCompaction(event: AppServerCompactionEvent): void {
    try {
      this.#onCompactionEvent?.(Object.freeze(event));
    } catch {
      this.#fail(
        clientError(
          AppServerClientErrorCode.HOST_HANDLER_FAILED,
          'The host compaction handler failed',
        ),
      );
    }
  }

  #receiveStderr(chunk: Buffer): void {
    if (this.#stderrCapturedBytes >= this.#limits.maximumStderrBytes) {
      this.#stderrTruncated = true;
      return;
    }
    const remaining = this.#limits.maximumStderrBytes - this.#stderrCapturedBytes;
    const selected = chunk.subarray(0, remaining);
    this.#stderrHash.update(selected);
    this.#stderrCapturedBytes += selected.length;
    if (selected.length !== chunk.length) {
      this.#stderrTruncated = true;
    }
  }

  #hasFailed(): boolean {
    return this.#failure !== undefined;
  }

  #stdoutEnded(): void {
    if (this.#closed) {
      return;
    }
    if (this.#stdoutBuffer.length !== 0) {
      this.#fail(
        clientError(
          AppServerClientErrorCode.PROTOCOL_MALFORMED,
          'App Server stdout ended with an incomplete protocol line',
        ),
      );
      return;
    }
    if (this.#requestedShutdown) {
      return;
    }
    this.#fail(
      clientError(
        AppServerClientErrorCode.PROCESS_EXITED,
        'App Server stdout reached unexpected EOF',
      ),
    );
  }

  #processExited(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#ready = false;
    if (!this.#requestedShutdown && this.#failure === undefined) {
      this.#failure = clientError(
        AppServerClientErrorCode.PROCESS_EXITED,
        'App Server process exited unexpectedly',
        { code, signal },
      );
      this.#rejectPending(this.#failure);
      this.#rejectCompactions(this.#failure);
    }
    this.#closeResolve(
      Object.freeze({
        code,
        ...(this.#failure === undefined ? {} : { failureCode: this.#failure.code }),
        requestedShutdown: this.#requestedShutdown,
        signal,
      }),
    );
  }

  #fail(error: AppServerClientError): void {
    if (this.#failure !== undefined || this.#closed) {
      return;
    }
    this.#failure = error;
    this.#ready = false;
    this.#rejectPending(error);
    this.#rejectCompactions(error);
    this.#signalOwnedProcess('SIGTERM');
  }

  #signalOwnedProcess(signal: NodeJS.Signals): void {
    const identity = this.#processIdentity;
    if (identity?.processGroupKind === 'POSIX_PROCESS_GROUP') {
      try {
        process.kill(-identity.processGroupId, signal);
        return;
      } catch {
        // Fall through to the exact child handle when the group already exited.
      }
    }
    this.#child.kill(signal);
  }

  #rejectPending(error: AppServerClientError): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #rejectCompactions(error: AppServerClientError): void {
    for (const tracker of this.#manualCompactions.values()) {
      clearTimeout(tracker.timer);
      tracker.reject(error);
    }
    this.#manualCompactions.clear();
    this.#observedCompactions.clear();
  }
}

export async function startAppServerClient(
  input: StartAppServerClientInput,
): Promise<AppServerClient> {
  const client = new AppServerClient(input);
  try {
    await client.initialize();
    return client;
  } catch (error) {
    try {
      await client.shutdown();
    } catch {
      // Preserve the initialization failure as the caller-visible cause.
    }
    throw error;
  }
}
