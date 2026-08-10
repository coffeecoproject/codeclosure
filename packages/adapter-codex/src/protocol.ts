import { Buffer } from 'node:buffer';

import {
  isJsonObject,
  parseBoundedJson,
  type AppServerNotification,
  type JsonObject,
  type JsonValue,
} from '@codeclosure/codex-app-server-client';

import {
  codexFinalPayloadBinding,
  digestCanonical,
  type CodexItemRejectionCode,
  type CodexWorkerDirective,
} from './contracts.js';
import {
  evaluateCodexWorkerActivityV1,
  type CodexWorkerActivityPolicyV1,
} from './m251-activity-policy.js';

export interface EffectiveThread {
  readonly approvalPolicy: string;
  readonly approvalsReviewer: string;
  readonly cwd: string;
  readonly instructionSources: readonly string[];
  readonly model: string;
  readonly modelProvider: string;
  readonly reasoningEffort: string | null;
  readonly sandbox: Readonly<{
    readonly excludeSlashTmp: boolean;
    readonly excludeTmpdirEnvVar: boolean;
    readonly networkAccess: boolean;
    readonly type: string;
    readonly writableRoots: readonly string[];
  }>;
  readonly serviceTier: string | null;
  readonly threadId: string;
}

export interface StartedTurn {
  readonly turnId: string;
}

export interface TerminalTurn {
  readonly error: JsonValue | undefined;
  readonly items: readonly JsonValue[];
  readonly itemsView: string | undefined;
  readonly status: string;
  readonly threadId: string;
  readonly turnId: string;
}

export type CodexThreadItemDisposition =
  'ALLOWED' | 'COMPACTION_POLICY_VIOLATION' | 'UNSUPPORTED_BACKEND_ACTIVITY';

export type CodexThreadItemEvaluation =
  | Readonly<{
      disposition: 'ALLOWED' | 'COMPACTION_POLICY_VIOLATION';
      rejectionCode?: never;
    }>
  | Readonly<{
      disposition: 'UNSUPPORTED_BACKEND_ACTIVITY';
      rejectionCode: CodexItemRejectionCode;
    }>;

export type CodexThreadItemLocation = 'COMPLETED' | 'STARTED' | 'TERMINAL';

export interface CodexThreadItemPolicy {
  readonly expectedUserMessageDigest: string;
  readonly workerActivityPolicy?: CodexWorkerActivityPolicyV1;
}

export interface CompletedAgentMessageObservation {
  readonly digest: string;
  readonly phase: JsonValue | undefined;
}

export interface FinalCompletionRequest {
  readonly claimedScope: string;
  readonly kind: 'COMPLETION_REQUEST';
  readonly proposedEvidenceRefs: readonly string[];
  readonly summary: string;
}

function object(value: JsonValue | undefined, field: string): JsonObject {
  if (value === undefined || !isJsonObject(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function boundedString(value: JsonValue | undefined, field: string, maximumBytes = 16_384): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    throw new TypeError(`${field} must be a bounded non-blank string`);
  }
  return value;
}

function boundedText(
  value: JsonValue | undefined,
  field: string,
  maximumBytes = 1_048_576,
): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new TypeError(`${field} must be a bounded string`);
  }
  return value;
}

function stringOrNull(
  value: JsonValue | undefined,
  field: string,
  maximumBytes = 16_384,
): string | null {
  return value === null ? null : boundedString(value, field, maximumBytes);
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

function boundedArray(
  value: JsonValue | undefined,
  field: string,
  maximumEntries: number,
): readonly JsonValue[] {
  const entries = array(value, field);
  if (entries.length > maximumEntries) {
    throw new TypeError(`${field} exceeds the collection limit`);
  }
  return entries;
}

function safeIntegerOrNull(
  value: JsonValue | undefined,
  field: string,
  minimum: number,
): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${field} must be a safe integer or null`);
  }
  return value;
}

function validateStringArray(value: JsonValue | undefined, field: string): void {
  for (const entry of boundedArray(value, field, 256)) {
    boundedText(entry, `${field} entry`);
  }
}

function validateAgentMessage(item: JsonObject): void {
  exactKeys(item, ['id', 'memoryCitation', 'phase', 'text', 'type'], 'agentMessage Item');
  boundedString(item['id'], 'agentMessage Item id', 1_024);
  boundedText(item['text'], 'agentMessage Item text');
  if (
    item['phase'] !== null &&
    item['phase'] !== 'commentary' &&
    item['phase'] !== 'final_answer'
  ) {
    throw new TypeError('agentMessage Item phase is unsupported');
  }
  if (item['memoryCitation'] !== null) {
    throw new TypeError('agentMessage memory citation is not selected');
  }
}

function validatePlan(item: JsonObject): void {
  exactKeys(item, ['id', 'text', 'type'], 'plan Item');
  boundedString(item['id'], 'plan Item id', 1_024);
  boundedText(item['text'], 'plan Item text');
}

function validateReasoning(item: JsonObject): void {
  exactKeys(item, ['content', 'id', 'summary', 'type'], 'reasoning Item');
  boundedString(item['id'], 'reasoning Item id', 1_024);
  validateStringArray(item['summary'], 'reasoning Item summary');
  validateStringArray(item['content'], 'reasoning Item content');
}

function validateCommandAction(value: JsonValue, index: number): void {
  const action = object(value, `commandExecution Item action ${index}`);
  const type = action['type'];
  if (type === 'read') {
    exactKeys(action, ['command', 'name', 'path', 'type'], 'read command action');
    boundedString(action['command'], 'read command action command');
    boundedString(action['name'], 'read command action name');
    boundedString(action['path'], 'read command action path');
    return;
  }
  if (type === 'listFiles') {
    exactKeys(action, ['command', 'path', 'type'], 'listFiles command action');
    boundedString(action['command'], 'listFiles command action command');
    stringOrNull(action['path'], 'listFiles command action path');
    return;
  }
  if (type === 'search') {
    exactKeys(action, ['command', 'path', 'query', 'type'], 'search command action');
    boundedString(action['command'], 'search command action command');
    stringOrNull(action['path'], 'search command action path');
    stringOrNull(action['query'], 'search command action query');
    return;
  }
  if (type === 'unknown') {
    exactKeys(action, ['command', 'type'], 'unknown command action');
    boundedString(action['command'], 'unknown command action command');
    return;
  }
  throw new TypeError('commandExecution Item action type is unsupported');
}

function validateTerminalStatus(
  value: JsonValue | undefined,
  field: string,
  location: CodexThreadItemLocation,
): void {
  if (
    value !== 'inProgress' &&
    value !== 'completed' &&
    value !== 'failed' &&
    value !== 'declined'
  ) {
    throw new TypeError(`${field} is unsupported`);
  }
  if (location !== 'STARTED' && value === 'inProgress') {
    throw new TypeError(`${field} is not terminal`);
  }
}

class ItemValidationFailure extends TypeError {
  public readonly itemRejectionCode: CodexItemRejectionCode;

  public constructor(code: CodexItemRejectionCode) {
    super(code);
    this.name = 'ItemValidationFailure';
    this.itemRejectionCode = code;
  }
}

function itemValidationFailure(code: CodexItemRejectionCode): ItemValidationFailure {
  return new ItemValidationFailure(code);
}

function validateItemStep(code: CodexItemRejectionCode, operation: () => void): void {
  try {
    operation();
  } catch {
    throw itemValidationFailure(code);
  }
}

function validateCommandExecution(item: JsonObject, location: CodexThreadItemLocation): void {
  validateItemStep('COMMAND_FIELD_SET', () =>
    exactKeys(
      item,
      [
        'aggregatedOutput',
        'command',
        'commandActions',
        'cwd',
        'durationMs',
        'exitCode',
        'id',
        'pluginId',
        'processId',
        'scriptPath',
        'source',
        'status',
        'type',
      ],
      'commandExecution Item',
    ),
  );
  validateItemStep('COMMAND_ID', () => {
    boundedString(item['id'], 'commandExecution Item id', 1_024);
  });
  if (item['pluginId'] !== null || item['scriptPath'] !== null) {
    throw itemValidationFailure('COMMAND_PLUGIN_BINDING');
  }
  validateItemStep('COMMAND_TEXT', () => {
    boundedString(item['command'], 'commandExecution Item command', 1_048_576);
  });
  validateItemStep('COMMAND_CWD', () => {
    boundedString(item['cwd'], 'commandExecution Item cwd');
  });
  validateItemStep('COMMAND_PROCESS_ID', () => {
    stringOrNull(item['processId'], 'commandExecution Item process id', 1_024);
  });
  // App Server 0.146.0 emits unifiedExecStartup for the model-selected
  // exec_command tool. userShell is an out-of-band ThreadShellCommand path,
  // while unifiedExecInteraction has no selected production emitter in M2.
  if (item['source'] !== 'agent' && item['source'] !== 'unifiedExecStartup') {
    throw itemValidationFailure('COMMAND_SOURCE');
  }
  validateItemStep('COMMAND_STATUS', () => {
    validateTerminalStatus(item['status'], 'commandExecution Item status', location);
  });
  validateItemStep('COMMAND_ACTIONS', () => {
    boundedArray(item['commandActions'], 'commandExecution Item actions', 256).forEach(
      validateCommandAction,
    );
  });
  validateItemStep('COMMAND_OUTPUT', () => {
    if (item['aggregatedOutput'] !== null) {
      boundedText(item['aggregatedOutput'], 'commandExecution Item aggregated output');
    }
  });
  validateItemStep('COMMAND_EXIT_CODE', () => {
    safeIntegerOrNull(item['exitCode'], 'commandExecution Item exit code', -2_147_483_648);
  });
  validateItemStep('COMMAND_DURATION', () => {
    safeIntegerOrNull(item['durationMs'], 'commandExecution Item duration', 0);
  });
}

function validatePatchKind(value: JsonValue | undefined, index: number): void {
  const kind = object(value, `fileChange Item change ${index} kind`);
  if (kind['type'] === 'add' || kind['type'] === 'delete') {
    exactKeys(kind, ['type'], 'fileChange Item change kind');
    return;
  }
  if (kind['type'] === 'update') {
    exactKeys(kind, ['move_path', 'type'], 'fileChange Item update kind');
    stringOrNull(kind['move_path'], 'fileChange Item move path');
    return;
  }
  throw new TypeError('fileChange Item change kind is unsupported');
}

function validateFileChange(item: JsonObject, location: CodexThreadItemLocation): void {
  exactKeys(item, ['changes', 'id', 'status', 'type'], 'fileChange Item');
  boundedString(item['id'], 'fileChange Item id', 1_024);
  validateTerminalStatus(item['status'], 'fileChange Item status', location);
  boundedArray(item['changes'], 'fileChange Item changes', 4_096).forEach((value, index) => {
    const change = object(value, `fileChange Item change ${index}`);
    exactKeys(change, ['diff', 'kind', 'path'], 'fileChange Item change');
    boundedString(change['path'], 'fileChange Item change path');
    boundedText(change['diff'], 'fileChange Item change diff');
    validatePatchKind(change['kind'], index);
  });
}

function validateUserMessage(item: JsonObject, policy: CodexThreadItemPolicy): void {
  exactKeys(item, ['clientId', 'content', 'id', 'type'], 'userMessage Item');
  boundedString(item['id'], 'userMessage Item id', 1_024);
  if (item['clientId'] !== null) {
    throw new TypeError('client-authored userMessage Item is not selected');
  }
  const content = boundedArray(item['content'], 'userMessage Item content', 1);
  if (content.length !== 1) {
    throw new TypeError('userMessage Item must contain the exact submitted prompt');
  }
  const input = object(content[0], 'userMessage Item content');
  exactKeys(input, ['text', 'text_elements', 'type'], 'userMessage text input');
  if (input['type'] !== 'text') {
    throw new TypeError('non-text userMessage input is not selected');
  }
  const textElements = boundedArray(input['text_elements'], 'userMessage text elements', 0);
  if (textElements.length !== 0) {
    throw new TypeError('userMessage text elements are not selected');
  }
  const text = boundedText(input['text'], 'userMessage text');
  if (digestCanonical(text) !== policy.expectedUserMessageDigest) {
    throw new TypeError('userMessage Item does not bind the submitted prompt');
  }
}

function validateAllowedThreadItem(
  item: JsonObject,
  location: CodexThreadItemLocation,
  policy: CodexThreadItemPolicy,
): void {
  switch (item['type']) {
    case 'agentMessage':
      validateAgentMessage(item);
      return;
    case 'commandExecution':
      validateCommandExecution(item, location);
      return;
    case 'fileChange':
      validateFileChange(item, location);
      return;
    case 'plan':
      validatePlan(item);
      return;
    case 'reasoning':
      validateReasoning(item);
      return;
    case 'userMessage':
      validateUserMessage(item, policy);
      return;
    default:
      throw itemValidationFailure('UNSELECTED_ITEM_TYPE');
  }
}

export function evaluateCodexThreadItem(
  item: JsonObject,
  location: CodexThreadItemLocation,
  policy: CodexThreadItemPolicy,
): CodexThreadItemEvaluation {
  if (item['type'] === 'contextCompaction') {
    return Object.freeze({ disposition: 'COMPACTION_POLICY_VIOLATION' });
  }
  try {
    validateAllowedThreadItem(item, location, policy);
    if (policy.workerActivityPolicy !== undefined) {
      const activity = evaluateCodexWorkerActivityV1(item, policy.workerActivityPolicy);
      if (activity.disposition === 'REJECTED_DISCARDED') {
        return Object.freeze({
          disposition: 'UNSUPPORTED_BACKEND_ACTIVITY',
          rejectionCode: activity.rejectionCode,
        });
      }
    }
    return Object.freeze({ disposition: 'ALLOWED' });
  } catch (error) {
    const rejectionCode =
      error instanceof ItemValidationFailure ? error.itemRejectionCode : 'ITEM_SCHEMA';
    return Object.freeze({
      disposition: 'UNSUPPORTED_BACKEND_ACTIVITY',
      rejectionCode,
    });
  }
}

export function codexThreadItemDisposition(
  item: JsonObject,
  location: CodexThreadItemLocation,
  policy: CodexThreadItemPolicy,
): CodexThreadItemDisposition {
  return evaluateCodexThreadItem(item, location, policy).disposition;
}

export function decodeJsonObject(value: JsonValue): JsonObject {
  return object(value, 'protocol result');
}

export function decodeEffectiveThread(value: JsonValue): EffectiveThread {
  const result = object(value, 'Thread response');
  const thread = object(result['thread'], 'Thread response.thread');
  const sandbox = object(result['sandbox'], 'Thread response.sandbox');
  const readOnlySandbox = sandbox['type'] === 'readOnly';
  return Object.freeze({
    approvalPolicy: boundedString(result['approvalPolicy'], 'Thread approval policy'),
    approvalsReviewer: boundedString(result['approvalsReviewer'], 'Thread approvals reviewer'),
    cwd: boundedString(result['cwd'], 'Thread cwd'),
    instructionSources: Object.freeze(
      array(result['instructionSources'], 'Thread instruction sources').map((entry) =>
        boundedString(entry, 'Thread instruction source'),
      ),
    ),
    model: boundedString(result['model'], 'Thread model'),
    modelProvider: boundedString(result['modelProvider'], 'Thread model provider'),
    reasoningEffort:
      result['reasoningEffort'] === null
        ? null
        : boundedString(result['reasoningEffort'], 'Thread reasoning effort'),
    sandbox: Object.freeze({
      excludeSlashTmp:
        readOnlySandbox && sandbox['excludeSlashTmp'] === undefined
          ? false
          : typeof sandbox['excludeSlashTmp'] === 'boolean'
            ? sandbox['excludeSlashTmp']
            : (() => {
                throw new TypeError('Thread slash-tmp exclusion policy is invalid');
              })(),
      excludeTmpdirEnvVar:
        readOnlySandbox && sandbox['excludeTmpdirEnvVar'] === undefined
          ? false
          : typeof sandbox['excludeTmpdirEnvVar'] === 'boolean'
            ? sandbox['excludeTmpdirEnvVar']
            : (() => {
                throw new TypeError('Thread TMPDIR exclusion policy is invalid');
              })(),
      networkAccess:
        typeof sandbox['networkAccess'] === 'boolean'
          ? sandbox['networkAccess']
          : (() => {
              throw new TypeError('Thread sandbox network policy is invalid');
            })(),
      type: boundedString(sandbox['type'], 'Thread sandbox type'),
      writableRoots: Object.freeze(
        (readOnlySandbox && sandbox['writableRoots'] === undefined
          ? []
          : array(sandbox['writableRoots'], 'Thread writable roots')
        ).map((entry) => boundedString(entry, 'Thread writable root')),
      ),
    }),
    serviceTier: stringOrNull(result['serviceTier'], 'Thread service tier'),
    threadId: boundedString(thread['id'], 'Thread id', 1_024),
  });
}

export function decodeStartedTurn(value: JsonValue): StartedTurn {
  const result = object(value, 'Turn response');
  const turn = object(result['turn'], 'Turn response.turn');
  return Object.freeze({ turnId: boundedString(turn['id'], 'Turn id', 1_024) });
}

export function projectTerminalTurn(notification: AppServerNotification): TerminalTurn | undefined {
  if (notification.method !== 'turn/completed') {
    return undefined;
  }
  const turn = object(notification.params['turn'], 'terminal Turn');
  return Object.freeze({
    error: turn['error'],
    items: Object.freeze([...array(turn['items'], 'terminal Turn items')]),
    itemsView:
      turn['itemsView'] === undefined
        ? undefined
        : boundedString(turn['itemsView'], 'terminal Turn items view'),
    status: boundedString(turn['status'], 'terminal Turn status'),
    threadId: boundedString(notification.params['threadId'], 'terminal Thread id', 1_024),
    turnId: boundedString(turn['id'], 'terminal Turn id', 1_024),
  });
}

function exactKeys(value: JsonObject, keys: readonly string[], field: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new TypeError(`${field} has unknown or missing fields`);
  }
}

function exactBinding(value: JsonObject, directive: CodexWorkerDirective): void {
  const expected = codexFinalPayloadBinding(directive) as Record<string, unknown>;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      throw new TypeError('final payload does not bind the current execution');
    }
  }
}

export function decodeFinalCompletionRequest(
  text: string,
  directive: CodexWorkerDirective,
  maximumBytes: number,
): FinalCompletionRequest {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > maximumBytes) {
    throw new TypeError('final payload exceeds the Worker response limit');
  }
  const value = parseBoundedJson(bytes, {
    maximumCollectionEntries: 256,
    maximumDepth: 8,
    maximumNodes: 1_024,
  });
  const payload = object(value, 'final payload');
  const bindingKeys = Object.keys(codexFinalPayloadBinding(directive) as object);
  exactKeys(payload, ['schemaVersion', ...bindingKeys, 'result'], 'final payload');
  if (payload['schemaVersion'] !== 1) {
    throw new TypeError('final payload schema version is unsupported');
  }
  exactBinding(payload, directive);
  const result = object(payload['result'], 'final payload result');
  exactKeys(
    result,
    ['claimedScope', 'kind', 'proposedEvidenceRefs', 'summary'],
    'final payload result',
  );
  if (result['kind'] !== 'COMPLETION_REQUEST') {
    throw new TypeError('final payload result kind is unsupported');
  }
  const evidence = array(result['proposedEvidenceRefs'], 'proposed evidence refs');
  if (evidence.length > 128) {
    throw new TypeError('proposed evidence refs exceed the collection limit');
  }
  const proposedEvidenceRefs = evidence.map((entry) =>
    boundedString(entry, 'proposed evidence ref', 4_096),
  );
  const completion = Object.freeze({
    claimedScope: boundedString(result['claimedScope'], 'claimed scope'),
    kind: result['kind'],
    proposedEvidenceRefs: Object.freeze(proposedEvidenceRefs),
    summary: boundedString(result['summary'], 'completion summary'),
  });
  digestCanonical(completion);
  return completion;
}

export function selectFinalAgentMessage(
  terminal: TerminalTurn,
  policy: CodexThreadItemPolicy,
  completedAgentMessages: readonly CompletedAgentMessageObservation[],
): string {
  if (terminal.itemsView !== 'summary' || terminal.items.length !== 1) {
    throw new TypeError('terminal Turn does not contain one summary Item');
  }
  const item = object(terminal.items[0], 'terminal Turn summary Item');
  const disposition = codexThreadItemDisposition(item, 'TERMINAL', policy);
  if (disposition === 'UNSUPPORTED_BACKEND_ACTIVITY') {
    throw new TypeError('terminal Turn contains an unsupported integration Item');
  }
  if (disposition === 'COMPACTION_POLICY_VIOLATION') {
    throw new TypeError('terminal Turn contains an unauthorized compaction Item');
  }
  if (item['type'] !== 'agentMessage') {
    throw new TypeError('terminal Turn summary is not an agent message');
  }
  const terminalDigest = digestCanonical(item);
  const terminalPhase = item['phase'];
  const terminalText = boundedString(item['text'], 'agent message', 1_048_576);
  const finalMessages = completedAgentMessages.filter(
    (message) => message.phase === 'final_answer',
  );
  if (
    terminalPhase === 'final_answer' &&
    finalMessages.length === 1 &&
    finalMessages[0]?.digest === terminalDigest
  ) {
    return terminalText;
  }
  if (
    terminalPhase === null &&
    finalMessages.length === 0 &&
    completedAgentMessages.length === 1 &&
    completedAgentMessages[0]?.phase === null &&
    completedAgentMessages[0].digest === terminalDigest
  ) {
    return terminalText;
  }
  throw new TypeError('terminal Turn summary does not bind exactly one completed final message');
}

export function digestProtocolValue(value: JsonValue): string {
  return digestCanonical(value);
}
