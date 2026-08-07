import { Buffer } from 'node:buffer';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

import {
  AppServerClientError,
  AppServerClientErrorCode,
  startAppServerClient,
  toProtocolJsonValue,
  type AppServerClient,
  type AppServerCloseResult,
  type AppServerClientLimits,
  type AppServerProcessLaunch,
  type JsonValue,
} from '@codeclosure/codex-app-server-client';
import {
  IntakeAssistantFailureReasonCode,
  M25_INTAKE_MODEL,
  M25_INTAKE_MODEL_PROVIDER,
  M25_INTAKE_REASONING_EFFORT,
  M25_INTAKE_SERVICE_TIER,
  m25IntakeBudgetDefinition,
  type AnswerOnlyAssistantInput,
  type AnswerOnlyAssistantResponseV1,
  type IntakeAssistantObservation,
  type IntakeAssistantOperationResult,
  type IntakeAssistantPort,
  type IntakeAssistantFailureReasonCode as FailureReason,
  type IntentAnalysisAssistantInput,
  type IntentAnalysisAssistantResponseV1,
} from '@codeclosure/runtime';

import {
  M25_INTAKE_DEVELOPER_INSTRUCTIONS,
  adapterFailure,
  assertAnswerOnlyInput,
  assertIntentAnalysisInput,
  decodeAnswerOnlyResponse,
  decodeIntentAnalysisResponse,
  m25IntakeClosedConfig,
  m25IntakeConfigRead,
  m251IntakeClosedConfig,
  m251IntakeConfigRead,
  renderIntakePrompt,
  type SafeAdapterFailure,
} from './contracts.js';
import {
  assertClosedConfiguration,
  assertManagedRequirements,
  assertPermissionProfile,
  decodeEffectiveThread,
  decodeStartedTurn,
} from './protocol.js';
import {
  createIntakeProtocolObserverStrategy,
  type IntakeProtocolObserverStrategy,
  type ProtocolTerminal,
} from './protocol-strategy.js';
import type { SafeIntakeDiagnosticCategory } from './intake-observed-events.js';

export interface CodexIntakeAssistantAdapterInput {
  readonly launch: AppServerProcessLaunch;
  readonly launchNonce: string;
  readonly forbiddenRoots: readonly string[];
  readonly clientLimits?: Partial<AppServerClientLimits>;
  readonly onSafeDiagnostic?: (
    category: SafeIntakeDiagnosticCategory,
    location: IntakeDiagnosticLocation,
    token: IntakeDiagnosticToken,
  ) => void;
}

export type IntakeDiagnosticToken = string;

export type IntakeDiagnosticLocation =
  | 'CLIENT_START'
  | 'CONFIGURATION'
  | 'INPUT_VALIDATION'
  | 'ISOLATION'
  | 'LAUNCH_BINDING'
  | 'OBSERVATION'
  | 'RESPONSE'
  | 'SHUTDOWN'
  | 'THREAD_START'
  | 'TURN_START';

interface IntakeOperationFailure {
  readonly diagnostic: SafeIntakeDiagnosticCategory;
  readonly location: IntakeDiagnosticLocation;
  readonly reason: FailureReason;
  readonly token: IntakeDiagnosticToken;
}

type WaitResult =
  | Readonly<{ kind: 'TERMINAL'; terminal: ProtocolTerminal }>
  | Readonly<{ kind: 'FAILED'; reason: FailureReason }>
  | Readonly<{ kind: 'CLOSED'; close: AppServerCloseResult }>
  | Readonly<{ kind: 'ABORT' }>
  | Readonly<{ kind: 'TIMEOUT' }>;

interface OperationCounters {
  processLaunchCount: number;
  threadStartCount: number;
  turnStartCount: number;
  turnInterruptCount: number;
}

function exactRealDirectory(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new TypeError('Intake operation roots must be normalized absolute paths');
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError('Intake operation roots must identify real directories');
  }
  return realpathSync(path);
}

function pathsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  const inside = (value: string): boolean =>
    value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value));
  return inside(fromLeft) || inside(fromRight);
}

function declaredProjectPath(
  input: IntentAnalysisAssistantInput | AnswerOnlyAssistantInput,
): string | undefined {
  return input.package.kind === 'INTENT_ANALYSIS'
    ? input.package.declaredProjectRef?.normalizedPath
    : input.package.rawRequestRevision.declaredProjectRef?.normalizedPath;
}

function assertIsolation(
  adapterInput: CodexIntakeAssistantAdapterInput,
  operationInput: IntentAnalysisAssistantInput | AnswerOnlyAssistantInput,
): void {
  const operationCwd = exactRealDirectory(adapterInput.launch.summary.cwd);
  const stateRoot = exactRealDirectory(adapterInput.launch.summary.codexHome);
  const projectPath = declaredProjectPath(operationInput);
  const forbiddenRoots = Object.freeze(
    [...adapterInput.forbiddenRoots, ...(projectPath === undefined ? [] : [projectPath])].map(
      exactRealDirectory,
    ),
  );
  if (
    pathsOverlap(operationCwd, stateRoot) ||
    forbiddenRoots.length === 0 ||
    forbiddenRoots.some((root) => pathsOverlap(operationCwd, root) || pathsOverlap(stateRoot, root))
  ) {
    throw new TypeError('Intake operation roots do not satisfy the isolation contract');
  }
}

function assertAssistantProfileLaunchBinding(
  adapterInput: CodexIntakeAssistantAdapterInput,
  operationInput: IntentAnalysisAssistantInput | AnswerOnlyAssistantInput,
): void {
  const profile = operationInput.package.assistantProfile;
  if (
    adapterInput.launch.summary.codexVersion !== `codex-cli ${profile.codexVersion}` ||
    adapterInput.launch.summary.protocolSnapshotDigest !== profile.protocolSnapshotDigest
  ) {
    throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE);
  }
}

function decoderIdentity(value: JsonValue): JsonValue {
  return value;
}

function hostCancelled(signal: AbortSignal): boolean {
  return signal.aborted;
}

function mapFailure(error: unknown, signal: AbortSignal): FailureReason {
  if (error instanceof Error && 'adapterReason' in error) {
    return (error as SafeAdapterFailure).adapterReason;
  }
  if (signal.aborted) {
    return IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE;
  }
  if (error instanceof AppServerClientError) {
    switch (error.code) {
      case AppServerClientErrorCode.REQUEST_TIMEOUT:
        return IntakeAssistantFailureReasonCode.ASSISTANT_TIMEOUT;
      case AppServerClientErrorCode.INITIALIZATION_FAILED:
      case AppServerClientErrorCode.PROCESS_EXITED:
      case AppServerClientErrorCode.SHUTDOWN:
      case AppServerClientErrorCode.SHUTDOWN_TIMEOUT:
      case AppServerClientErrorCode.SPAWN_FAILED:
      case AppServerClientErrorCode.STREAM_FAILED:
      case AppServerClientErrorCode.VERSION_MISMATCH:
        return IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE;
      case AppServerClientErrorCode.HOST_CANCELLED:
        return IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE;
      default:
        return IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR;
    }
  }
  return IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR;
}

function safeDiagnosticForFailure(
  error: unknown,
  signal: AbortSignal,
): SafeIntakeDiagnosticCategory {
  if (signal.aborted) {
    return 'PROCESS_INTERRUPTED';
  }
  if (error instanceof AppServerClientError) {
    switch (error.code) {
      case AppServerClientErrorCode.PROTOCOL_CORRELATION:
        return 'LOWER_CLIENT_CORRELATION';
      case AppServerClientErrorCode.PROTOCOL_LIMIT:
        return 'LOWER_CLIENT_LIMIT';
      case AppServerClientErrorCode.REQUEST_TIMEOUT:
        return 'PROCESS_TIMEOUT';
      case AppServerClientErrorCode.HOST_CANCELLED:
        return 'PROCESS_INTERRUPTED';
      case AppServerClientErrorCode.HOST_HANDLER_FAILED:
      case AppServerClientErrorCode.MALFORMED_RESPONSE:
      case AppServerClientErrorCode.PROTOCOL_MALFORMED:
      case AppServerClientErrorCode.REQUEST_REJECTED:
      case AppServerClientErrorCode.SERVER_REQUEST_FAILED:
      case AppServerClientErrorCode.UNSUPPORTED_METHOD:
      case AppServerClientErrorCode.UNSUPPORTED_SERVER_REQUEST:
        return 'LOWER_CLIENT_UNSUPPORTED_OR_MALFORMED';
      default:
        return 'PROCESS_UNAVAILABLE';
    }
  }
  if (
    error instanceof Error &&
    'adapterReason' in error &&
    (error as SafeAdapterFailure).adapterReason ===
      IntakeAssistantFailureReasonCode.RESPONSE_REJECTED
  ) {
    return 'RESPONSE_REJECTED';
  }
  return 'PROCESS_UNAVAILABLE';
}

function mapClosedClient(close: AppServerCloseResult): FailureReason {
  if (close.code !== 0 && close.failureCode === undefined) {
    return IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE;
  }
  return close.failureCode === AppServerClientErrorCode.PROCESS_EXITED ||
    close.failureCode === AppServerClientErrorCode.SPAWN_FAILED ||
    close.failureCode === AppServerClientErrorCode.STREAM_FAILED
    ? IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE
    : IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR;
}

function safeDiagnosticTokenForFailure(error: unknown): IntakeDiagnosticToken {
  if (error instanceof AppServerClientError) {
    return error.code;
  }
  if (error instanceof Error && 'adapterReason' in error) {
    return (error as SafeAdapterFailure).adapterReason;
  }
  return 'UNCLASSIFIED';
}

function safeDiagnosticForClosedClient(close: AppServerCloseResult): SafeIntakeDiagnosticCategory {
  switch (close.failureCode) {
    case AppServerClientErrorCode.PROTOCOL_CORRELATION:
      return 'LOWER_CLIENT_CORRELATION';
    case AppServerClientErrorCode.PROTOCOL_LIMIT:
      return 'LOWER_CLIENT_LIMIT';
    case AppServerClientErrorCode.HOST_HANDLER_FAILED:
    case AppServerClientErrorCode.MALFORMED_RESPONSE:
    case AppServerClientErrorCode.PROTOCOL_MALFORMED:
    case AppServerClientErrorCode.REQUEST_REJECTED:
    case AppServerClientErrorCode.SERVER_REQUEST_FAILED:
    case AppServerClientErrorCode.UNSUPPORTED_METHOD:
    case AppServerClientErrorCode.UNSUPPORTED_SERVER_REQUEST:
      return 'LOWER_CLIENT_UNSUPPORTED_OR_MALFORMED';
    default:
      return 'PROCESS_UNAVAILABLE';
  }
}

async function waitForTerminal(
  client: AppServerClient,
  observer: IntakeProtocolObserverStrategy,
  signal: AbortSignal,
): Promise<WaitResult> {
  let timer: NodeJS.Timeout | undefined;
  let removeAbort = (): void => undefined;
  const timeout = new Promise<WaitResult>((resolveTimeout) => {
    timer = setTimeout(
      () => resolveTimeout(Object.freeze({ kind: 'TIMEOUT' })),
      m25IntakeBudgetDefinition.assistantTerminalDeadlineMilliseconds,
    );
    timer.unref();
  });
  const abort = new Promise<WaitResult>((resolveAbort) => {
    const onAbort = (): void => resolveAbort(Object.freeze({ kind: 'ABORT' }));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) {
      onAbort();
    }
  });
  try {
    return await Promise.race([
      observer.terminalPromise.then(
        (terminal) => Object.freeze({ kind: 'TERMINAL', terminal }) as WaitResult,
      ),
      observer.failurePromise.then(
        (reason) => Object.freeze({ kind: 'FAILED', reason }) as WaitResult,
      ),
      client.closed.then((close) => Object.freeze({ kind: 'CLOSED', close }) as WaitResult),
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

function observation(
  operation: 'INTENT_ANALYSIS' | 'ANSWER_ONLY',
  counters: OperationCounters,
  observer: IntakeProtocolObserverStrategy | undefined,
  failureReason?: FailureReason,
): IntakeAssistantObservation {
  return Object.freeze({
    schemaVersion: 1,
    operation,
    state: failureReason === undefined ? 'COMPLETED' : 'FAILED',
    processLaunchCount: counters.processLaunchCount,
    threadStartCount: counters.threadStartCount,
    turnStartCount: counters.turnStartCount,
    turnInterruptCount: counters.turnInterruptCount,
    compactionCount: observer?.compactionCount ?? 0,
    ...(observer?.backendSessionRef === undefined
      ? {}
      : { backendSessionRef: observer.backendSessionRef }),
    ...(observer?.backendOperationRef === undefined
      ? {}
      : { backendOperationRef: observer.backendOperationRef }),
    ...(failureReason === undefined ? {} : { failureReasonCode: failureReason }),
  });
}

export class CodexIntakeAssistantAdapter implements IntakeAssistantPort {
  readonly #input: CodexIntakeAssistantAdapterInput;
  #used = false;

  public constructor(input: CodexIntakeAssistantAdapterInput) {
    this.#input = input;
  }

  public analyze(
    input: IntentAnalysisAssistantInput,
    signal: AbortSignal,
  ): Promise<IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>> {
    return this.#run('INTENT_ANALYSIS', input, signal, (text) =>
      decodeIntentAnalysisResponse(text, input.package),
    );
  }

  public answer(
    input: AnswerOnlyAssistantInput,
    signal: AbortSignal,
  ): Promise<IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1>> {
    return this.#run('ANSWER_ONLY', input, signal, decodeAnswerOnlyResponse);
  }

  async #run<Response>(
    operation: 'INTENT_ANALYSIS' | 'ANSWER_ONLY',
    input: IntentAnalysisAssistantInput | AnswerOnlyAssistantInput,
    signal: AbortSignal,
    decodeResponse: (text: string) => Response,
  ): Promise<IntakeAssistantOperationResult<Response>> {
    const counters: OperationCounters = {
      processLaunchCount: 0,
      threadStartCount: 0,
      turnStartCount: 0,
      turnInterruptCount: 0,
    };
    let client: AppServerClient | undefined;
    let observer: IntakeProtocolObserverStrategy | undefined;
    let response: Response | undefined;
    let operationFailure: IntakeOperationFailure | undefined;
    let diagnosticLocation: IntakeDiagnosticLocation = 'INPUT_VALIDATION';
    const recordFailure = (
      reason: FailureReason,
      diagnostic: SafeIntakeDiagnosticCategory,
      location: IntakeDiagnosticLocation,
      token: IntakeDiagnosticToken,
    ): void => {
      operationFailure ??= Object.freeze({ diagnostic, location, reason, token });
      response = undefined;
    };
    try {
      if (this.#used) {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR);
      }
      this.#used = true;
      const protocolVersion =
        operation === 'INTENT_ANALYSIS'
          ? assertIntentAnalysisInput(input as IntentAnalysisAssistantInput)
          : assertAnswerOnlyInput(input as AnswerOnlyAssistantInput);
      const activeObserver = createIntakeProtocolObserverStrategy(protocolVersion);
      observer = activeObserver;
      const closedConfig =
        protocolVersion === 'M25_V1' ? m25IntakeClosedConfig : m251IntakeClosedConfig;
      const configRead = protocolVersion === 'M25_V1' ? m25IntakeConfigRead : m251IntakeConfigRead;
      diagnosticLocation = 'LAUNCH_BINDING';
      assertAssistantProfileLaunchBinding(this.#input, input);
      diagnosticLocation = 'ISOLATION';
      assertIsolation(this.#input, input);
      if (hostCancelled(signal)) {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE);
      }
      diagnosticLocation = 'CLIENT_START';
      client = await startAppServerClient({
        initialize: {
          capabilities: {
            experimentalApi: false,
            mcpServerOpenaiFormElicitation: false,
            requestAttestation: false,
          },
          clientInfo: {
            name: 'codeclosure_m2_5_intake',
            title: 'CodeClosure M2.5 Intake',
            version: '0.0.0',
          },
        },
        launch: this.#input.launch,
        launchNonce: this.#input.launchNonce,
        ...(this.#input.clientLimits === undefined ? {} : { limits: this.#input.clientLimits }),
        ...activeObserver.clientCallbacks,
        onProcessStarted: () => {
          counters.processLaunchCount += 1;
        },
      });
      diagnosticLocation = 'CONFIGURATION';
      const requestOptions = Object.freeze({ signal });
      assertManagedRequirements(
        await client.request('configRequirements/read', undefined, decoderIdentity, requestOptions),
      );
      assertClosedConfiguration(
        await client.request(
          'config/read',
          { cwd: this.#input.launch.summary.cwd, includeLayers: true },
          decoderIdentity,
          requestOptions,
        ),
        configRead,
      );
      assertPermissionProfile(
        await client.request(
          'permissionProfile/list',
          { cwd: this.#input.launch.summary.cwd },
          decoderIdentity,
          requestOptions,
        ),
      );
      diagnosticLocation = 'THREAD_START';
      counters.threadStartCount += 1;
      const effective = await client.request(
        'thread/start',
        {
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          config: closedConfig,
          cwd: this.#input.launch.summary.cwd,
          developerInstructions: M25_INTAKE_DEVELOPER_INSTRUCTIONS,
          ephemeral: true,
          model: M25_INTAKE_MODEL,
          modelProvider: M25_INTAKE_MODEL_PROVIDER,
          sandbox: 'read-only',
          serviceTier: M25_INTAKE_SERVICE_TIER,
        },
        (value) => decodeEffectiveThread(value, this.#input.launch.summary.cwd),
        requestOptions,
      );
      activeObserver.bindThread(effective.threadId);
      if (activeObserver.failureReason !== undefined) {
        throw adapterFailure(activeObserver.failureReason);
      }
      assertClosedConfiguration(
        await client.request(
          'config/read',
          { cwd: this.#input.launch.summary.cwd, includeLayers: true },
          decoderIdentity,
          requestOptions,
        ),
        configRead,
      );
      const prompt = renderIntakePrompt(input);
      if (Buffer.byteLength(prompt, 'utf8') > 1_048_576) {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR);
      }
      diagnosticLocation = 'TURN_START';
      counters.turnStartCount += 1;
      const started = await client.request(
        'turn/start',
        {
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          cwd: this.#input.launch.summary.cwd,
          effort: M25_INTAKE_REASONING_EFFORT,
          input: [{ text: prompt, text_elements: [], type: 'text' }],
          model: M25_INTAKE_MODEL,
          outputSchema: toProtocolJsonValue(input.package.responseContract.schema),
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
          serviceTier: M25_INTAKE_SERVICE_TIER,
          threadId: effective.threadId,
        },
        decodeStartedTurn,
        requestOptions,
      );
      activeObserver.bindTurn(started.turnId);
      diagnosticLocation = 'OBSERVATION';
      const wait = await waitForTerminal(client, activeObserver, signal);
      if (wait.kind === 'ABORT' || wait.kind === 'TIMEOUT' || wait.kind === 'FAILED') {
        counters.turnInterruptCount += 1;
        try {
          await client.interruptTurn({ threadId: effective.threadId, turnId: started.turnId });
        } catch {
          // The original bounded failure remains the only returned observation.
        }
      }
      if (wait.kind === 'ABORT') {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE);
      }
      if (wait.kind === 'TIMEOUT') {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_TIMEOUT);
      }
      if (wait.kind === 'CLOSED') {
        recordFailure(
          mapClosedClient(wait.close),
          safeDiagnosticForClosedClient(wait.close),
          diagnosticLocation,
          wait.close.failureCode ?? 'UNCLASSIFIED',
        );
        throw adapterFailure(mapClosedClient(wait.close));
      }
      if (wait.kind === 'FAILED') {
        throw adapterFailure(wait.reason);
      }
      if (hostCancelled(signal)) {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE);
      }
      const finalText = activeObserver.selectFinalText(wait.terminal);
      diagnosticLocation = 'RESPONSE';
      try {
        response = decodeResponse(finalText);
      } catch {
        throw adapterFailure(IntakeAssistantFailureReasonCode.RESPONSE_REJECTED);
      }
    } catch (error) {
      recordFailure(
        mapFailure(error, signal),
        observer?.failureDiagnostic ?? safeDiagnosticForFailure(error, signal),
        diagnosticLocation,
        observer?.failureToken ?? safeDiagnosticTokenForFailure(error),
      );
    } finally {
      if (client !== undefined) {
        let close: AppServerCloseResult | undefined;
        let shutdownError: unknown;
        try {
          close = await client.shutdown();
        } catch (error) {
          shutdownError = error;
        }
        if (observer?.failureReason !== undefined) {
          recordFailure(
            observer.failureReason,
            observer.failureDiagnostic ?? 'PROCESS_UNAVAILABLE',
            'OBSERVATION',
            observer.failureToken ?? 'UNCLASSIFIED',
          );
        }
        if (close !== undefined && (close.code !== 0 || close.failureCode !== undefined)) {
          recordFailure(
            mapClosedClient(close),
            safeDiagnosticForClosedClient(close),
            'SHUTDOWN',
            close.failureCode ?? 'ASSISTANT_UNAVAILABLE',
          );
        }
        if (shutdownError !== undefined) {
          recordFailure(
            mapFailure(shutdownError, signal),
            safeDiagnosticForFailure(shutdownError, signal),
            'SHUTDOWN',
            safeDiagnosticTokenForFailure(shutdownError),
          );
        }
      }
    }
    if (operationFailure !== undefined || response === undefined) {
      const closedFailure =
        operationFailure ??
        Object.freeze({
          diagnostic: 'PROCESS_UNAVAILABLE' as const,
          location: diagnosticLocation,
          reason: IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR,
          token: 'UNCLASSIFIED',
        });
      try {
        this.#input.onSafeDiagnostic?.(
          closedFailure.diagnostic,
          closedFailure.location,
          closedFailure.token,
        );
      } catch {
        // Diagnostic consumers cannot affect the closed operation result.
      }
      return Object.freeze({
        kind: 'FAILED',
        failureReasonCode: closedFailure.reason,
        observation: observation(operation, counters, observer, closedFailure.reason),
      });
    }
    return Object.freeze({
      kind: 'COMPLETED',
      response,
      observation: observation(operation, counters, observer),
    });
  }
}

export function createCodexIntakeAssistantAdapter(
  input: CodexIntakeAssistantAdapterInput,
): CodexIntakeAssistantAdapter {
  return new CodexIntakeAssistantAdapter(input);
}
