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
  renderIntakePrompt,
  type SafeAdapterFailure,
} from './contracts.js';
import {
  IntakeProtocolObserver,
  assertClosedConfiguration,
  assertManagedRequirements,
  assertPermissionProfile,
  decodeEffectiveThread,
  decodeStartedTurn,
  type TerminalIntakeTurn,
} from './protocol.js';

export interface CodexIntakeAssistantAdapterInput {
  readonly launch: AppServerProcessLaunch;
  readonly launchNonce: string;
  readonly forbiddenRoots: readonly string[];
  readonly clientLimits?: Partial<AppServerClientLimits>;
}

type WaitResult =
  | Readonly<{ kind: 'TERMINAL'; terminal: TerminalIntakeTurn }>
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

function mapClosedClient(close: AppServerCloseResult): FailureReason {
  return close.failureCode === AppServerClientErrorCode.PROCESS_EXITED ||
    close.failureCode === AppServerClientErrorCode.SPAWN_FAILED ||
    close.failureCode === AppServerClientErrorCode.STREAM_FAILED
    ? IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE
    : IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR;
}

async function waitForTerminal(
  client: AppServerClient,
  observer: IntakeProtocolObserver,
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
  observer: IntakeProtocolObserver,
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
    compactionCount: observer.compactionCount,
    ...(observer.backendSessionRef === undefined
      ? {}
      : { backendSessionRef: observer.backendSessionRef }),
    ...(observer.backendOperationRef === undefined
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
    const observer = new IntakeProtocolObserver();
    const counters: OperationCounters = {
      processLaunchCount: 0,
      threadStartCount: 0,
      turnStartCount: 0,
      turnInterruptCount: 0,
    };
    let client: AppServerClient | undefined;
    let response: Response | undefined;
    let failureReason: FailureReason | undefined;
    try {
      if (this.#used) {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR);
      }
      this.#used = true;
      if (operation === 'INTENT_ANALYSIS') {
        assertIntentAnalysisInput(input as IntentAnalysisAssistantInput);
      } else {
        assertAnswerOnlyInput(input as AnswerOnlyAssistantInput);
      }
      assertIsolation(this.#input, input);
      if (hostCancelled(signal)) {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE);
      }
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
        onCompactionEvent: () => observer.recordCompaction(),
        onNotification: (notification) => observer.record(notification),
        onProcessStarted: () => {
          counters.processLaunchCount += 1;
        },
      });
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
      );
      assertPermissionProfile(
        await client.request(
          'permissionProfile/list',
          { cwd: this.#input.launch.summary.cwd },
          decoderIdentity,
          requestOptions,
        ),
      );
      counters.threadStartCount += 1;
      const effective = await client.request(
        'thread/start',
        {
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          config: m25IntakeClosedConfig,
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
      observer.bindThread(effective.threadId);
      if (observer.failureReason !== undefined) {
        throw adapterFailure(observer.failureReason);
      }
      assertClosedConfiguration(
        await client.request(
          'config/read',
          { cwd: this.#input.launch.summary.cwd, includeLayers: true },
          decoderIdentity,
          requestOptions,
        ),
      );
      const prompt = renderIntakePrompt(input);
      if (Buffer.byteLength(prompt, 'utf8') > 1_048_576) {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR);
      }
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
      observer.bindTurn(started.turnId);
      const wait = await waitForTerminal(client, observer, signal);
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
        throw adapterFailure(mapClosedClient(wait.close));
      }
      if (wait.kind === 'FAILED') {
        throw adapterFailure(wait.reason);
      }
      if (hostCancelled(signal)) {
        throw adapterFailure(IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE);
      }
      const finalText = observer.selectFinalText(wait.terminal);
      try {
        response = decodeResponse(finalText);
      } catch {
        throw adapterFailure(IntakeAssistantFailureReasonCode.RESPONSE_REJECTED);
      }
    } catch (error) {
      failureReason = mapFailure(error, signal);
      response = undefined;
    } finally {
      if (client !== undefined) {
        try {
          const close = await client.shutdown();
          if (
            failureReason === undefined &&
            (close.code !== 0 || close.failureCode !== undefined)
          ) {
            failureReason = IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE;
            response = undefined;
          }
        } catch {
          failureReason = IntakeAssistantFailureReasonCode.ASSISTANT_UNAVAILABLE;
          response = undefined;
        }
      }
    }
    if (failureReason !== undefined || response === undefined) {
      const closedReason =
        failureReason ?? IntakeAssistantFailureReasonCode.ASSISTANT_PROTOCOL_ERROR;
      return Object.freeze({
        kind: 'FAILED',
        failureReasonCode: closedReason,
        observation: observation(operation, counters, observer, closedReason),
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
