import { Buffer } from 'node:buffer';

import {
  isJsonObject,
  type AppServerNotification,
  type JsonObject,
  type JsonValue,
} from '@codeclosure/codex-app-server-client';
import {
  M25_INTAKE_MODEL,
  M25_INTAKE_MODEL_PROVIDER,
  M25_INTAKE_REASONING_EFFORT,
  M25_INTAKE_SERVICE_TIER,
  type IntakeAssistantFailureReasonCode,
} from '@codeclosure/runtime';

import {
  digestCanonical,
  m25IntakeConfigRead,
  m25IntakeManagedRequirements,
  m25IntakePermissionProfile,
} from './contracts.js';

export interface EffectiveIntakeThread {
  readonly threadId: string;
  readonly cwd: string;
}

export interface StartedIntakeTurn {
  readonly turnId: string;
}

export interface TerminalIntakeTurn {
  readonly threadId: string;
  readonly turnId: string;
  readonly status: string;
  readonly error: JsonValue | undefined;
  readonly itemsView: string | undefined;
  readonly items: readonly JsonValue[];
}

interface CompletedAgentMessage {
  readonly digest: string;
  readonly phase: JsonValue | undefined;
}

function object(value: JsonValue | undefined, field: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function array(value: JsonValue | undefined, field: string): readonly JsonValue[] {
  if (!isJsonArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }
  return value;
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function boundedString(value: JsonValue | undefined, field: string, maximumBytes = 16_384): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    throw new TypeError(`${field} must be a bounded string`);
  }
  return value;
}

function exactKeys(value: JsonObject, expected: readonly string[], field: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new TypeError(`${field} has unknown or missing fields`);
  }
}

function validateAgentMessage(value: JsonObject): void {
  exactKeys(value, ['id', 'memoryCitation', 'phase', 'text', 'type'], 'agent message');
  if (
    value['type'] !== 'agentMessage' ||
    (value['phase'] !== null &&
      value['phase'] !== 'commentary' &&
      value['phase'] !== 'final_answer') ||
    value['memoryCitation'] !== null
  ) {
    throw new TypeError('agent message selects an unsupported field value');
  }
  boundedString(value['id'], 'agent message id', 1_024);
  boundedString(value['text'], 'agent message text', 1_048_576);
}

function notificationRef(
  notification: AppServerNotification,
  name: 'threadId' | 'turnId',
): string | undefined {
  const value = notification.params[name];
  return typeof value === 'string' ? value : undefined;
}

export function assertManagedRequirements(value: JsonValue): void {
  if (digestCanonical(value) !== digestCanonical(m25IntakeManagedRequirements)) {
    throw new TypeError('managed requirements do not match the closed Intake profile');
  }
}

export function assertClosedConfiguration(
  value: JsonValue,
  expected: JsonValue = m25IntakeConfigRead,
): void {
  if (digestCanonical(value) !== digestCanonical(expected)) {
    throw new TypeError('effective configuration does not match the closed Intake profile');
  }
}

export function assertPermissionProfile(value: JsonValue): void {
  const result = object(value, 'permission profile list');
  exactKeys(result, ['data', 'nextCursor'], 'permission profile list');
  const data = array(result['data'], 'permission profile data');
  if (
    data.length !== 1 ||
    result['nextCursor'] !== null ||
    digestCanonical(data[0]) !== digestCanonical(m25IntakePermissionProfile)
  ) {
    throw new TypeError('permission profile does not match the closed Intake profile');
  }
}

export function decodeEffectiveThread(
  value: JsonValue,
  expectedCwd: string,
): EffectiveIntakeThread {
  const result = object(value, 'Thread response');
  const thread = object(result['thread'], 'Thread response.thread');
  const sandbox = object(result['sandbox'], 'Thread response.sandbox');
  if (
    boundedString(result['model'], 'Thread model') !== M25_INTAKE_MODEL ||
    boundedString(result['modelProvider'], 'Thread model provider') !== M25_INTAKE_MODEL_PROVIDER ||
    result['serviceTier'] !== M25_INTAKE_SERVICE_TIER ||
    boundedString(result['cwd'], 'Thread cwd') !== expectedCwd ||
    result['approvalPolicy'] !== 'never' ||
    result['approvalsReviewer'] !== 'user' ||
    result['reasoningEffort'] !== M25_INTAKE_REASONING_EFFORT ||
    sandbox['type'] !== 'readOnly' ||
    sandbox['networkAccess'] !== false ||
    array(result['instructionSources'], 'Thread instruction sources').length !== 0
  ) {
    throw new TypeError('effective Thread does not match the closed Intake profile');
  }
  return Object.freeze({
    threadId: boundedString(thread['id'], 'Thread id', 1_024),
    cwd: expectedCwd,
  });
}

export function decodeStartedTurn(value: JsonValue): StartedIntakeTurn {
  const result = object(value, 'Turn response');
  const turn = object(result['turn'], 'Turn response.turn');
  return Object.freeze({ turnId: boundedString(turn['id'], 'Turn id', 1_024) });
}

function projectTerminal(notification: AppServerNotification): TerminalIntakeTurn {
  const turn = object(notification.params['turn'], 'terminal Turn');
  return Object.freeze({
    threadId: boundedString(notification.params['threadId'], 'terminal Thread id', 1_024),
    turnId: boundedString(turn['id'], 'terminal Turn id', 1_024),
    status: boundedString(turn['status'], 'terminal Turn status'),
    error: turn['error'],
    itemsView:
      turn['itemsView'] === undefined
        ? undefined
        : boundedString(turn['itemsView'], 'terminal Turn items view'),
    items: Object.freeze([...array(turn['items'], 'terminal Turn items')]),
  });
}

const benignNotificationMethods = new Set<string>([
  'item/agentMessage/delta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'rawResponse/completed',
  'rawResponseItem/completed',
  'thread/status/changed',
  'thread/tokenUsage/updated',
]);

export class IntakeProtocolObserver {
  #backendSessionRef?: string;
  #backendOperationRef?: string;
  #compactionCount = 0;
  readonly #completedAgentMessages: CompletedAgentMessage[] = [];
  #failureReason?: IntakeAssistantFailureReasonCode;
  readonly #failurePromise: Promise<IntakeAssistantFailureReasonCode>;
  #failureResolve!: (reason: IntakeAssistantFailureReasonCode) => void;
  #notificationCount = 0;
  readonly #observedThreadRefs = new Set<string>();
  readonly #observedTurnRefs = new Set<string>();
  readonly #terminalPromise: Promise<TerminalIntakeTurn>;
  #terminalResolve!: (terminal: TerminalIntakeTurn) => void;
  #terminalSeen = false;

  public constructor() {
    this.#failurePromise = new Promise((resolve) => {
      this.#failureResolve = resolve;
    });
    this.#terminalPromise = new Promise((resolve) => {
      this.#terminalResolve = resolve;
    });
  }

  public get failurePromise(): Promise<IntakeAssistantFailureReasonCode> {
    return this.#failurePromise;
  }

  public get terminalPromise(): Promise<TerminalIntakeTurn> {
    return this.#terminalPromise;
  }

  public get failureReason(): IntakeAssistantFailureReasonCode | undefined {
    return this.#failureReason;
  }

  public get backendSessionRef(): string | undefined {
    return this.#backendSessionRef;
  }

  public get backendOperationRef(): string | undefined {
    return this.#backendOperationRef;
  }

  public get compactionCount(): number {
    return this.#compactionCount;
  }

  public bindThread(threadId: string): void {
    this.#backendSessionRef = threadId;
    this.#validateRefs();
  }

  public bindTurn(turnId: string): void {
    this.#backendOperationRef = turnId;
    this.#validateRefs();
  }

  public fail(reason: IntakeAssistantFailureReasonCode): void {
    if (this.#failureReason === undefined) {
      this.#failureReason = reason;
      this.#failureResolve(reason);
    }
  }

  public recordCompaction(): void {
    this.#compactionCount += 1;
    this.fail('ASSISTANT_PROTOCOL_ERROR');
  }

  public record(notification: AppServerNotification): void {
    if (this.#failureReason !== undefined) {
      return;
    }
    this.#notificationCount += 1;
    if (this.#notificationCount > 10_000) {
      this.fail('ASSISTANT_PROTOCOL_ERROR');
      return;
    }
    try {
      const directThreadRef = notificationRef(notification, 'threadId');
      const directTurnRef = notificationRef(notification, 'turnId');
      if (directThreadRef !== undefined) {
        this.#observedThreadRefs.add(directThreadRef);
      }
      if (directTurnRef !== undefined) {
        this.#observedTurnRefs.add(directTurnRef);
      }
      if (notification.method === 'thread/started') {
        const thread = object(notification.params['thread'], 'started Thread');
        this.#observedThreadRefs.add(boundedString(thread['id'], 'started Thread id', 1_024));
      } else if (notification.method === 'turn/started') {
        const turn = object(notification.params['turn'], 'started Turn');
        this.#observedTurnRefs.add(boundedString(turn['id'], 'started Turn id', 1_024));
      } else if (notification.method === 'thread/compacted') {
        this.recordCompaction();
      } else if (
        notification.method === 'item/started' ||
        notification.method === 'item/completed'
      ) {
        const item = object(notification.params['item'], 'Thread Item');
        const itemType = item['type'];
        if (itemType !== 'agentMessage' && itemType !== 'reasoning' && itemType !== 'userMessage') {
          this.fail('ASSISTANT_PROTOCOL_ERROR');
        } else if (item['type'] === 'agentMessage') {
          validateAgentMessage(item);
          if (notification.method === 'item/completed') {
            if (this.#completedAgentMessages.length >= 16) {
              this.fail('ASSISTANT_PROTOCOL_ERROR');
            } else {
              this.#completedAgentMessages.push(
                Object.freeze({ digest: digestCanonical(item), phase: item['phase'] }),
              );
            }
          }
        }
      } else if (notification.method === 'turn/completed') {
        if (this.#terminalSeen) {
          this.fail('ASSISTANT_PROTOCOL_ERROR');
        } else {
          this.#terminalSeen = true;
          this.#terminalResolve(projectTerminal(notification));
        }
      } else if (!benignNotificationMethods.has(notification.method)) {
        this.fail('ASSISTANT_PROTOCOL_ERROR');
      }
      this.#validateRefs();
    } catch {
      this.fail('ASSISTANT_PROTOCOL_ERROR');
    }
  }

  public selectFinalText(terminal: TerminalIntakeTurn): string {
    if (
      terminal.threadId !== this.#backendSessionRef ||
      terminal.turnId !== this.#backendOperationRef ||
      terminal.status !== 'completed' ||
      terminal.error !== null ||
      terminal.itemsView !== 'summary' ||
      terminal.items.length !== 1
    ) {
      throw new TypeError('terminal Turn does not bind the current successful operation');
    }
    const item = object(terminal.items[0], 'terminal summary Item');
    validateAgentMessage(item);
    if (item['phase'] !== 'final_answer' && item['phase'] !== null) {
      throw new TypeError('terminal summary is not a final agent message');
    }
    const matching = this.#completedAgentMessages.filter(
      (message) => message.digest === digestCanonical(item) && message.phase === item['phase'],
    );
    if (matching.length !== 1 || this.#completedAgentMessages.length !== 1) {
      throw new TypeError('terminal summary does not bind one completed agent message');
    }
    return boundedString(item['text'], 'terminal agent message', 1_048_576);
  }

  #validateRefs(): void {
    if (
      this.#backendSessionRef !== undefined &&
      [...this.#observedThreadRefs].some((reference) => reference !== this.#backendSessionRef)
    ) {
      this.fail('ASSISTANT_PROTOCOL_ERROR');
    }
    if (
      this.#backendOperationRef !== undefined &&
      [...this.#observedTurnRefs].some((reference) => reference !== this.#backendOperationRef)
    ) {
      this.fail('ASSISTANT_PROTOCOL_ERROR');
    }
  }
}
