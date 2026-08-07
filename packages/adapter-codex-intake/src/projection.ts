import { Buffer } from 'node:buffer';

import {
  isJsonObject,
  type AppServerNotification,
  type JsonObject,
  type JsonValue,
  type ServerNotification,
} from '@codeclosure/codex-app-server-client';

import { digestCanonical } from './contracts.js';
import type {
  IntakeMessagePhase,
  IntakeObservedEvent,
  ProjectedIntakeMessage,
  ProjectedTerminalItem,
  TerminalIntakeTurn,
} from './intake-observed-events.js';

type NotificationMethod = ServerNotification['method'];
type ValueKind =
  | 'ANY'
  | 'ARRAY'
  | 'BOOLEAN'
  | 'NULLABLE_ARRAY'
  | 'NULLABLE_BOOLEAN'
  | 'NULLABLE_NUMBER'
  | 'NULLABLE_OBJECT'
  | 'NULLABLE_STRING'
  | 'NUMBER'
  | 'OBJECT'
  | 'STRING'
  | 'STRING_OR_ARRAY';

interface ObjectShape {
  readonly optional?: Readonly<Record<string, ValueKind>>;
  readonly required: Readonly<Record<string, ValueKind>>;
}

const shape = (
  required: Readonly<Record<string, ValueKind>>,
  optional?: Readonly<Record<string, ValueKind>>,
): ObjectShape =>
  Object.freeze({
    required: Object.freeze(required),
    ...(optional === undefined ? {} : { optional: Object.freeze(optional) }),
  });

const notificationShapes = Object.freeze({
  'account/login/completed': shape({
    loginId: 'NULLABLE_STRING',
    success: 'BOOLEAN',
    error: 'NULLABLE_STRING',
  }),
  'account/rateLimits/updated': shape({ rateLimits: 'OBJECT' }),
  'account/updated': shape({ authMode: 'NULLABLE_STRING', planType: 'NULLABLE_STRING' }),
  'app/list/updated': shape({ data: 'ARRAY' }),
  'command/exec/outputDelta': shape({
    processId: 'STRING',
    stream: 'STRING',
    deltaBase64: 'STRING',
    capReached: 'BOOLEAN',
  }),
  configWarning: shape(
    { summary: 'STRING', details: 'NULLABLE_STRING' },
    { path: 'STRING', range: 'OBJECT' },
  ),
  deprecationNotice: shape({ summary: 'STRING', details: 'NULLABLE_STRING' }),
  error: shape({ error: 'OBJECT', willRetry: 'BOOLEAN', threadId: 'STRING', turnId: 'STRING' }),
  'externalAgentConfig/import/completed': shape({ importId: 'STRING', itemTypeResults: 'ARRAY' }),
  'externalAgentConfig/import/progress': shape({ importId: 'STRING', itemTypeResults: 'ARRAY' }),
  'fs/changed': shape({ watchId: 'STRING', changedPaths: 'ARRAY' }),
  'fuzzyFileSearch/sessionCompleted': shape({ sessionId: 'STRING' }),
  'fuzzyFileSearch/sessionUpdated': shape({ sessionId: 'STRING', query: 'STRING', files: 'ARRAY' }),
  guardianWarning: shape({ threadId: 'STRING', message: 'STRING' }),
  'hook/completed': shape({ threadId: 'STRING', turnId: 'NULLABLE_STRING', run: 'OBJECT' }),
  'hook/started': shape({ threadId: 'STRING', turnId: 'NULLABLE_STRING', run: 'OBJECT' }),
  'item/agentMessage/delta': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    delta: 'STRING',
  }),
  'item/autoApprovalReview/completed': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    startedAtMs: 'NUMBER',
    completedAtMs: 'NUMBER',
    reviewId: 'STRING',
    targetItemId: 'NULLABLE_STRING',
    decisionSource: 'STRING',
    review: 'OBJECT',
    action: 'OBJECT',
  }),
  'item/autoApprovalReview/started': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    startedAtMs: 'NUMBER',
    reviewId: 'STRING',
    targetItemId: 'NULLABLE_STRING',
    review: 'OBJECT',
    action: 'OBJECT',
  }),
  'item/commandExecution/outputDelta': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    delta: 'STRING',
  }),
  'item/commandExecution/terminalInteraction': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    processId: 'STRING',
    stdin: 'STRING',
  }),
  'item/completed': shape({
    item: 'OBJECT',
    threadId: 'STRING',
    turnId: 'STRING',
    completedAtMs: 'NUMBER',
  }),
  'item/fileChange/outputDelta': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    delta: 'STRING',
  }),
  'item/fileChange/patchUpdated': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    changes: 'ARRAY',
  }),
  'item/mcpToolCall/progress': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    message: 'STRING',
  }),
  'item/plan/delta': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    delta: 'STRING',
  }),
  'item/reasoning/summaryPartAdded': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    summaryIndex: 'NUMBER',
  }),
  'item/reasoning/summaryTextDelta': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    delta: 'STRING',
    summaryIndex: 'NUMBER',
  }),
  'item/reasoning/textDelta': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    itemId: 'STRING',
    delta: 'STRING',
    contentIndex: 'NUMBER',
  }),
  'item/started': shape({
    item: 'OBJECT',
    threadId: 'STRING',
    turnId: 'STRING',
    startedAtMs: 'NUMBER',
  }),
  'mcpServer/oauthLogin/completed': shape(
    { name: 'STRING', threadId: 'NULLABLE_STRING', success: 'BOOLEAN' },
    { error: 'STRING' },
  ),
  'mcpServer/startupStatus/updated': shape({
    threadId: 'NULLABLE_STRING',
    name: 'STRING',
    status: 'STRING',
    error: 'NULLABLE_STRING',
    failureReason: 'NULLABLE_STRING',
  }),
  'model/rerouted': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    fromModel: 'STRING',
    toModel: 'STRING',
    reason: 'STRING',
  }),
  'model/safetyBuffering/updated': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    model: 'STRING',
    useCases: 'ARRAY',
    reasons: 'ARRAY',
    showBufferingUi: 'BOOLEAN',
    fasterModel: 'NULLABLE_STRING',
  }),
  'model/verification': shape({ threadId: 'STRING', turnId: 'STRING', verifications: 'ARRAY' }),
  'process/exited': shape({
    processHandle: 'STRING',
    exitCode: 'NUMBER',
    stdout: 'STRING',
    stdoutCapReached: 'BOOLEAN',
    stderr: 'STRING',
    stderrCapReached: 'BOOLEAN',
  }),
  'process/outputDelta': shape({
    processHandle: 'STRING',
    stream: 'STRING',
    deltaBase64: 'STRING',
    capReached: 'BOOLEAN',
  }),
  'rawResponse/completed': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    responseId: 'STRING',
    usage: 'NULLABLE_OBJECT',
  }),
  'rawResponseItem/completed': shape({ threadId: 'STRING', turnId: 'STRING', item: 'OBJECT' }),
  'remoteControl/status/changed': shape({
    status: 'STRING',
    serverName: 'STRING',
    installationId: 'STRING',
    environmentId: 'NULLABLE_STRING',
  }),
  'serverRequest/resolved': shape({ threadId: 'STRING', requestId: 'STRING' }),
  'skills/changed': shape({}),
  'thread/archived': shape({ threadId: 'STRING' }),
  'thread/closed': shape({ threadId: 'STRING' }),
  'thread/compacted': shape({ threadId: 'STRING', turnId: 'STRING' }),
  'thread/deleted': shape({ threadId: 'STRING' }),
  'thread/environment/connected': shape({ threadId: 'STRING', environmentId: 'STRING' }),
  'thread/environment/disconnected': shape({ threadId: 'STRING', environmentId: 'STRING' }),
  'thread/goal/cleared': shape({ threadId: 'STRING' }),
  'thread/goal/updated': shape({ threadId: 'STRING', turnId: 'NULLABLE_STRING', goal: 'OBJECT' }),
  'thread/name/updated': shape({ threadId: 'STRING' }, { threadName: 'STRING' }),
  'thread/realtime/closed': shape({ threadId: 'STRING', reason: 'NULLABLE_STRING' }),
  'thread/realtime/error': shape({ threadId: 'STRING', message: 'STRING' }),
  'thread/realtime/itemAdded': shape({ threadId: 'STRING', item: 'ANY' }),
  'thread/realtime/outputAudio/delta': shape({ threadId: 'STRING', audio: 'OBJECT' }),
  'thread/realtime/sdp': shape({ threadId: 'STRING', sdp: 'STRING' }),
  'thread/realtime/started': shape({
    threadId: 'STRING',
    realtimeSessionId: 'NULLABLE_STRING',
    version: 'STRING',
  }),
  'thread/realtime/transcript/delta': shape({
    threadId: 'STRING',
    role: 'STRING',
    delta: 'STRING',
  }),
  'thread/realtime/transcript/done': shape({ threadId: 'STRING', role: 'STRING', text: 'STRING' }),
  'thread/settings/updated': shape({ threadId: 'STRING', threadSettings: 'OBJECT' }),
  'thread/started': shape({ thread: 'OBJECT' }),
  'thread/status/changed': shape({ threadId: 'STRING', status: 'OBJECT' }),
  'thread/tokenUsage/updated': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    tokenUsage: 'OBJECT',
  }),
  'thread/unarchived': shape({ threadId: 'STRING' }),
  'turn/completed': shape({ threadId: 'STRING', turn: 'OBJECT' }),
  'turn/diff/updated': shape({ threadId: 'STRING', turnId: 'STRING', diff: 'STRING' }),
  'turn/moderationMetadata': shape({ threadId: 'STRING', turnId: 'STRING', metadata: 'ANY' }),
  'turn/plan/updated': shape({
    threadId: 'STRING',
    turnId: 'STRING',
    explanation: 'NULLABLE_STRING',
    plan: 'ARRAY',
  }),
  'turn/started': shape({ threadId: 'STRING', turn: 'OBJECT' }),
  warning: shape({ threadId: 'NULLABLE_STRING', message: 'STRING' }),
  'windows/worldWritableWarning': shape({
    samplePaths: 'ARRAY',
    extraCount: 'NUMBER',
    failedScan: 'BOOLEAN',
  }),
  'windowsSandbox/setupCompleted': shape({
    mode: 'STRING',
    success: 'BOOLEAN',
    error: 'NULLABLE_STRING',
  }),
} satisfies Readonly<Record<NotificationMethod, ObjectShape>>);

const itemShapes = Object.freeze({
  agentMessage: shape({
    type: 'STRING',
    id: 'STRING',
    text: 'STRING',
    phase: 'ANY',
    memoryCitation: 'ANY',
  }),
  collabAgentToolCall: shape({
    type: 'STRING',
    id: 'STRING',
    tool: 'STRING',
    status: 'STRING',
    senderThreadId: 'STRING',
    receiverThreadIds: 'ARRAY',
    prompt: 'NULLABLE_STRING',
    model: 'NULLABLE_STRING',
    reasoningEffort: 'NULLABLE_STRING',
    agentsStates: 'OBJECT',
  }),
  commandExecution: shape({
    type: 'STRING',
    id: 'STRING',
    pluginId: 'NULLABLE_STRING',
    scriptPath: 'NULLABLE_STRING',
    command: 'STRING',
    cwd: 'STRING',
    processId: 'NULLABLE_STRING',
    source: 'STRING',
    status: 'STRING',
    commandActions: 'ARRAY',
    aggregatedOutput: 'NULLABLE_STRING',
    exitCode: 'NULLABLE_NUMBER',
    durationMs: 'NULLABLE_NUMBER',
  }),
  contextCompaction: shape({ type: 'STRING', id: 'STRING' }),
  dynamicToolCall: shape({
    type: 'STRING',
    id: 'STRING',
    namespace: 'NULLABLE_STRING',
    tool: 'STRING',
    arguments: 'ANY',
    status: 'STRING',
    contentItems: 'NULLABLE_ARRAY',
    success: 'NULLABLE_BOOLEAN',
    durationMs: 'NULLABLE_NUMBER',
  }),
  enteredReviewMode: shape({ type: 'STRING', id: 'STRING', review: 'STRING' }),
  exitedReviewMode: shape({ type: 'STRING', id: 'STRING', review: 'STRING' }),
  fileChange: shape({ type: 'STRING', id: 'STRING', changes: 'ARRAY', status: 'STRING' }),
  hookPrompt: shape({ type: 'STRING', id: 'STRING', fragments: 'ARRAY' }),
  imageGeneration: shape(
    {
      type: 'STRING',
      id: 'STRING',
      status: 'STRING',
      revisedPrompt: 'NULLABLE_STRING',
      result: 'STRING',
    },
    { savedPath: 'STRING' },
  ),
  imageView: shape({ type: 'STRING', id: 'STRING', path: 'STRING' }),
  mcpToolCall: shape(
    {
      type: 'STRING',
      id: 'STRING',
      server: 'STRING',
      tool: 'STRING',
      status: 'STRING',
      arguments: 'ANY',
      appContext: 'NULLABLE_OBJECT',
      pluginId: 'NULLABLE_STRING',
      result: 'NULLABLE_OBJECT',
      error: 'NULLABLE_OBJECT',
      durationMs: 'NULLABLE_NUMBER',
    },
    { mcpAppResourceUri: 'STRING' },
  ),
  plan: shape({ type: 'STRING', id: 'STRING', text: 'STRING' }),
  reasoning: shape({ type: 'STRING', id: 'STRING', summary: 'ARRAY', content: 'ARRAY' }),
  sleep: shape({ type: 'STRING', id: 'STRING', durationMs: 'NUMBER' }),
  subAgentActivity: shape({
    type: 'STRING',
    id: 'STRING',
    kind: 'STRING',
    agentThreadId: 'STRING',
    agentPath: 'STRING',
  }),
  userMessage: shape({
    type: 'STRING',
    id: 'STRING',
    clientId: 'NULLABLE_STRING',
    content: 'ARRAY',
  }),
  webSearch: shape({
    type: 'STRING',
    id: 'STRING',
    query: 'STRING',
    action: 'NULLABLE_OBJECT',
    results: 'NULLABLE_ARRAY',
  }),
});

type ThreadItemType = keyof typeof itemShapes;

const rawResponseItemShapes = Object.freeze({
  message: shape(
    { type: 'STRING', role: 'STRING', content: 'ARRAY' },
    { id: 'STRING', phase: 'STRING', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  agent_message: shape(
    { type: 'STRING', author: 'STRING', recipient: 'STRING', content: 'ARRAY' },
    { id: 'STRING', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  reasoning: shape(
    { type: 'STRING', summary: 'ARRAY', encrypted_content: 'NULLABLE_STRING' },
    { id: 'STRING', content: 'ARRAY', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  local_shell_call: shape(
    { type: 'STRING', call_id: 'NULLABLE_STRING', status: 'STRING', action: 'OBJECT' },
    { id: 'STRING', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  function_call: shape(
    { type: 'STRING', name: 'STRING', arguments: 'STRING', call_id: 'STRING' },
    {
      id: 'STRING',
      namespace: 'STRING',
      internal_chat_message_metadata_passthrough: 'OBJECT',
    },
  ),
  tool_search_call: shape(
    { type: 'STRING', call_id: 'NULLABLE_STRING', execution: 'STRING', arguments: 'ANY' },
    { id: 'STRING', status: 'STRING', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  function_call_output: shape(
    { type: 'STRING', call_id: 'STRING', output: 'STRING_OR_ARRAY' },
    { id: 'STRING', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  custom_tool_call: shape(
    { type: 'STRING', call_id: 'STRING', name: 'STRING', input: 'STRING' },
    {
      id: 'STRING',
      status: 'STRING',
      namespace: 'STRING',
      internal_chat_message_metadata_passthrough: 'OBJECT',
    },
  ),
  custom_tool_call_output: shape(
    { type: 'STRING', call_id: 'STRING', output: 'STRING_OR_ARRAY' },
    { id: 'STRING', name: 'STRING', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  tool_search_output: shape(
    {
      type: 'STRING',
      call_id: 'NULLABLE_STRING',
      status: 'STRING',
      execution: 'STRING',
      tools: 'ARRAY',
    },
    { id: 'STRING', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  web_search_call: shape(
    { type: 'STRING' },
    {
      id: 'STRING',
      status: 'STRING',
      action: 'OBJECT',
      internal_chat_message_metadata_passthrough: 'OBJECT',
    },
  ),
  image_generation_call: shape(
    { type: 'STRING', status: 'STRING', result: 'STRING' },
    {
      id: 'STRING',
      revised_prompt: 'STRING',
      internal_chat_message_metadata_passthrough: 'OBJECT',
    },
  ),
  compaction: shape(
    { type: 'STRING', encrypted_content: 'STRING' },
    { id: 'STRING', internal_chat_message_metadata_passthrough: 'OBJECT' },
  ),
  compaction_trigger: shape({ type: 'STRING' }),
  context_compaction: shape(
    { type: 'STRING' },
    {
      id: 'STRING',
      encrypted_content: 'STRING',
      internal_chat_message_metadata_passthrough: 'OBJECT',
    },
  ),
  other: shape({ type: 'STRING' }),
});

type RawResponseItemType = keyof typeof rawResponseItemShapes;

interface ProjectedRawResponseItem {
  readonly messageRole?: 'assistant' | 'unsupported';
  readonly type: RawResponseItemType;
}

interface ValidatedProtocolFact {
  readonly item?: Readonly<{ message?: ProjectedIntakeMessage; type: ThreadItemType }>;
  readonly method: NotificationMethod;
  readonly rawResponseItem?: ProjectedRawResponseItem;
  readonly remoteControlStatus?: 'connected' | 'connecting' | 'disabled' | 'errored';
  readonly sequence: number;
  readonly terminal?: TerminalIntakeTurn;
  readonly threadId?: string;
  readonly turnId?: string;
}

function exactKeys(value: JsonObject, objectShape: ObjectShape): void {
  const optional = objectShape.optional ?? {};
  const expected = [
    ...Object.keys(objectShape.required),
    ...Object.keys(optional).filter((key) => value[key] !== undefined),
  ].sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new TypeError('Protocol object has unknown or missing fields');
  }
}

function matchesKind(value: JsonValue | undefined, kind: ValueKind): boolean {
  switch (kind) {
    case 'ANY':
      return value !== undefined;
    case 'ARRAY':
      return Array.isArray(value);
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'NULLABLE_ARRAY':
      return value === null || Array.isArray(value);
    case 'NULLABLE_BOOLEAN':
      return value === null || typeof value === 'boolean';
    case 'NULLABLE_NUMBER':
      return value === null || (typeof value === 'number' && Number.isFinite(value));
    case 'NULLABLE_OBJECT':
      return value === null || isJsonObject(value);
    case 'NULLABLE_STRING':
      return (
        value === null ||
        (typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 1_048_576)
      );
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value);
    case 'OBJECT':
      return isJsonObject(value);
    case 'STRING':
      return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 1_048_576;
    case 'STRING_OR_ARRAY':
      return (
        (typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 1_048_576) ||
        Array.isArray(value)
      );
  }
}

function validateShape(value: JsonObject, objectShape: ObjectShape): void {
  exactKeys(value, objectShape);
  for (const [key, kind] of Object.entries(objectShape.required)) {
    if (!matchesKind(value[key], kind)) {
      throw new TypeError('Protocol object field has an invalid type');
    }
  }
  for (const [key, kind] of Object.entries(objectShape.optional ?? {})) {
    if (value[key] !== undefined && !matchesKind(value[key], kind)) {
      throw new TypeError('Protocol object optional field has an invalid type');
    }
  }
}

function isUnknownJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry: unknown) => isUnknownJsonValue(entry));
  }
  if (typeof value !== 'object') {
    return false;
  }
  return Object.values(value).every((entry: unknown) => isUnknownJsonValue(entry));
}

function isUnknownJsonObject(value: unknown): value is JsonObject {
  return !Array.isArray(value) && isUnknownJsonValue(value) && isJsonObject(value);
}

function boundedIdentifier(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 1_024) {
    throw new TypeError('Protocol identifier is invalid');
  }
  return value;
}

function boundedMessageText(value: JsonValue | undefined, allowEmpty: boolean): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    Buffer.byteLength(value, 'utf8') > 1_048_576
  ) {
    throw new TypeError('Agent message text is invalid for its lifecycle stage');
  }
  return value;
}

function validateMessagePhase(value: JsonValue | undefined): IntakeMessagePhase {
  if (value !== null && value !== 'commentary' && value !== 'final_answer') {
    throw new TypeError('Agent message phase is invalid');
  }
  return value;
}

function projectMessage(value: JsonObject, allowEmpty: boolean): ProjectedIntakeMessage {
  validateShape(value, itemShapes.agentMessage);
  if (value['type'] !== 'agentMessage' || value['memoryCitation'] !== null) {
    throw new TypeError('Agent message selects an unsupported value');
  }
  const id = boundedIdentifier(value['id']);
  const phase = validateMessagePhase(value['phase']);
  const text = boundedMessageText(value['text'], allowEmpty);
  return Object.freeze({ digest: digestCanonical(value), id, phase, text });
}

function itemType(value: JsonObject): ThreadItemType {
  const type = value['type'];
  if (typeof type !== 'string' || !(type in itemShapes)) {
    throw new TypeError('Thread Item type is outside the pinned union');
  }
  return type as ThreadItemType;
}

function rawResponseItemType(value: JsonObject): RawResponseItemType {
  const type = value['type'];
  if (typeof type !== 'string' || !(type in rawResponseItemShapes)) {
    throw new TypeError('Raw Response Item type is outside the pinned union');
  }
  const selected = type as RawResponseItemType;
  validateShape(value, rawResponseItemShapes[selected]);
  if (value['type'] !== selected) {
    throw new TypeError('Raw Response Item discriminator is invalid');
  }
  return selected;
}

function projectRawResponseItem(value: JsonObject): ProjectedRawResponseItem {
  const type = rawResponseItemType(value);
  if (type !== 'message') {
    return Object.freeze({ type });
  }
  const phase = value['phase'];
  if (phase !== undefined && phase !== 'commentary' && phase !== 'final_answer') {
    throw new TypeError('Raw Response message phase is invalid');
  }
  return Object.freeze({
    messageRole: value['role'] === 'assistant' ? 'assistant' : 'unsupported',
    type,
  });
}

function validateItem(
  value: JsonObject,
  stage: 'COMPLETED' | 'STARTED' | 'TERMINAL',
): Readonly<{ message?: ProjectedIntakeMessage; type: ThreadItemType }> {
  const type = itemType(value);
  validateShape(value, itemShapes[type]);
  if (value['type'] !== type) {
    throw new TypeError('Thread Item discriminator is invalid');
  }
  boundedIdentifier(value['id']);
  if (type === 'agentMessage') {
    return Object.freeze({ message: projectMessage(value, stage === 'STARTED'), type });
  }
  if (type === 'reasoning') {
    for (const collection of [value['summary'], value['content']]) {
      if (!Array.isArray(collection) || collection.some((entry) => typeof entry !== 'string')) {
        throw new TypeError('Reasoning Item content is malformed');
      }
    }
  }
  return Object.freeze({ type });
}

function validateTurn(value: JsonObject): void {
  validateShape(
    value,
    shape({
      id: 'STRING',
      items: 'ARRAY',
      itemsView: 'STRING',
      status: 'STRING',
      error: 'NULLABLE_OBJECT',
      startedAt: 'NULLABLE_NUMBER',
      completedAt: 'NULLABLE_NUMBER',
      durationMs: 'NULLABLE_NUMBER',
    }),
  );
  boundedIdentifier(value['id']);
  const itemsView = value['itemsView'];
  if (typeof itemsView !== 'string' || !['notLoaded', 'summary', 'full'].includes(itemsView)) {
    throw new TypeError('Turn items view is invalid');
  }
  const status = value['status'];
  if (
    typeof status !== 'string' ||
    !['completed', 'interrupted', 'failed', 'inProgress'].includes(status)
  ) {
    throw new TypeError('Turn status is invalid');
  }
}

function validateStartedThread(value: JsonObject): string {
  validateShape(
    value,
    shape({
      id: 'STRING',
      sessionId: 'STRING',
      forkedFromId: 'NULLABLE_STRING',
      parentThreadId: 'NULLABLE_STRING',
      preview: 'STRING',
      ephemeral: 'BOOLEAN',
      isPinned: 'BOOLEAN',
      modelProvider: 'STRING',
      createdAt: 'NUMBER',
      updatedAt: 'NUMBER',
      recencyAt: 'NULLABLE_NUMBER',
      status: 'OBJECT',
      path: 'NULLABLE_STRING',
      cwd: 'STRING',
      cliVersion: 'STRING',
      source: 'ANY',
      threadSource: 'ANY',
      agentNickname: 'NULLABLE_STRING',
      agentRole: 'NULLABLE_STRING',
      gitInfo: 'NULLABLE_OBJECT',
      name: 'NULLABLE_STRING',
      turns: 'ARRAY',
    }),
  );
  validateThreadStatusValue(value['status']);
  return boundedIdentifier(value['id']);
}

function projectTerminal(params: JsonObject): TerminalIntakeTurn {
  const turn = params['turn'];
  if (!isJsonObject(turn)) {
    throw new TypeError('Terminal Turn is malformed');
  }
  validateTurn(turn);
  const rawItems: unknown = turn['items'];
  if (!Array.isArray(rawItems) || rawItems.length > 128) {
    throw new TypeError('Terminal Turn items are malformed');
  }
  const items: ProjectedTerminalItem[] = rawItems.map((rawItem: unknown) => {
    if (!isUnknownJsonObject(rawItem)) {
      throw new TypeError('Terminal Turn Item is malformed');
    }
    const projected = validateItem(rawItem, 'TERMINAL');
    return projected.message === undefined
      ? Object.freeze({ kind: 'OTHER' as const, token: projected.type })
      : Object.freeze({ kind: 'MESSAGE' as const, message: projected.message });
  });
  const status = turn['status'];
  if (typeof status !== 'string') {
    throw new TypeError('Terminal Turn status is malformed');
  }
  return Object.freeze({
    errorPresent: turn['error'] !== null,
    items: Object.freeze(items),
    itemsView: typeof turn['itemsView'] === 'string' ? turn['itemsView'] : undefined,
    status,
    threadId: boundedIdentifier(params['threadId']),
    turnId: boundedIdentifier(turn['id']),
  });
}

function validateRateLimits(params: JsonObject): void {
  const rateLimits = params['rateLimits'];
  if (!isJsonObject(rateLimits)) {
    throw new TypeError('Rate-limit projection is malformed');
  }
  validateShape(
    rateLimits,
    shape({
      limitId: 'NULLABLE_STRING',
      limitName: 'NULLABLE_STRING',
      primary: 'NULLABLE_OBJECT',
      secondary: 'NULLABLE_OBJECT',
      credits: 'NULLABLE_OBJECT',
      individualLimit: 'NULLABLE_OBJECT',
      spendControlReached: 'NULLABLE_BOOLEAN',
      planType: 'NULLABLE_STRING',
      rateLimitReachedType: 'NULLABLE_STRING',
    }),
  );
  for (const field of ['primary', 'secondary'] as const) {
    const window = rateLimits[field];
    if (window !== null) {
      if (!isJsonObject(window)) {
        throw new TypeError('Rate-limit window is malformed');
      }
      validateShape(
        window,
        shape({
          usedPercent: 'NUMBER',
          windowDurationMins: 'NULLABLE_NUMBER',
          resetsAt: 'NULLABLE_NUMBER',
        }),
      );
    }
  }
  const credits = rateLimits['credits'];
  if (credits !== null) {
    if (!isJsonObject(credits)) {
      throw new TypeError('Rate-limit credit projection is malformed');
    }
    validateShape(
      credits,
      shape({ hasCredits: 'BOOLEAN', unlimited: 'BOOLEAN', balance: 'NULLABLE_STRING' }),
    );
  }
  const individualLimit = rateLimits['individualLimit'];
  if (individualLimit !== null) {
    if (!isJsonObject(individualLimit)) {
      throw new TypeError('Rate-limit spend-control projection is malformed');
    }
    validateShape(
      individualLimit,
      shape({
        limit: 'STRING',
        used: 'STRING',
        remainingPercent: 'NUMBER',
        resetsAt: 'NUMBER',
      }),
    );
  }
  const planType: unknown = rateLimits['planType'];
  if (
    planType !== null &&
    (typeof planType !== 'string' ||
      ![
        'free',
        'go',
        'plus',
        'pro',
        'prolite',
        'team',
        'self_serve_business_usage_based',
        'business',
        'ent26',
        'enterprise_cbp_usage_based',
        'enterprise',
        'edu',
        'unknown',
      ].includes(planType))
  ) {
    throw new TypeError('Rate-limit plan type is outside the pinned union');
  }
  const reachedType: unknown = rateLimits['rateLimitReachedType'];
  if (
    reachedType !== null &&
    (typeof reachedType !== 'string' ||
      ![
        'rate_limit_reached',
        'workspace_owner_credits_depleted',
        'workspace_member_credits_depleted',
        'workspace_owner_usage_limit_reached',
        'workspace_member_usage_limit_reached',
      ].includes(reachedType))
  ) {
    throw new TypeError('Rate-limit reached type is outside the pinned union');
  }
}

function validateThreadStatusValue(status: JsonValue | undefined): void {
  if (!isJsonObject(status) || typeof status['type'] !== 'string') {
    throw new TypeError('Thread status projection is malformed');
  }
  if (status['type'] === 'active') {
    validateShape(status, shape({ type: 'STRING', activeFlags: 'ARRAY' }));
    const flags = status['activeFlags'];
    if (
      !Array.isArray(flags) ||
      flags.some((flag) => flag !== 'waitingOnApproval' && flag !== 'waitingOnUserInput')
    ) {
      throw new TypeError('Thread active flags are malformed');
    }
    return;
  }
  if (!['notLoaded', 'idle', 'systemError'].includes(status['type'])) {
    throw new TypeError('Thread status is outside the pinned union');
  }
  validateShape(status, shape({ type: 'STRING' }));
}

function validateTokenUsageBreakdown(value: JsonValue | undefined): void {
  if (!isJsonObject(value)) {
    throw new TypeError('Token usage breakdown is malformed');
  }
  validateShape(
    value,
    shape({
      totalTokens: 'NUMBER',
      inputTokens: 'NUMBER',
      cachedInputTokens: 'NUMBER',
      cacheWriteInputTokens: 'NUMBER',
      outputTokens: 'NUMBER',
      reasoningOutputTokens: 'NUMBER',
    }),
  );
}

function validateThreadTokenUsage(params: JsonObject): void {
  const usage = params['tokenUsage'];
  if (!isJsonObject(usage)) {
    throw new TypeError('Thread token usage projection is malformed');
  }
  validateShape(
    usage,
    shape({ total: 'OBJECT', last: 'OBJECT', modelContextWindow: 'NULLABLE_NUMBER' }),
  );
  validateTokenUsageBreakdown(usage['total']);
  validateTokenUsageBreakdown(usage['last']);
}

function optionalReference(params: JsonObject, key: 'threadId' | 'turnId'): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 1_024
    ? value
    : undefined;
}

function projectValidatedFact(notification: AppServerNotification): ValidatedProtocolFact {
  if (!Number.isSafeInteger(notification.sequence) || notification.sequence < 1) {
    throw new TypeError('Notification sequence is invalid');
  }
  validateShape(notification.params, notificationShapes[notification.method]);
  const threadId = optionalReference(notification.params, 'threadId');
  const turnId = optionalReference(notification.params, 'turnId');
  const base = {
    method: notification.method,
    sequence: notification.sequence,
    ...(threadId === undefined ? {} : { threadId }),
    ...(turnId === undefined ? {} : { turnId }),
  };
  if (notification.method === 'thread/started') {
    const thread = notification.params['thread'];
    if (!isJsonObject(thread)) {
      throw new TypeError('Started Thread is malformed');
    }
    return Object.freeze({ ...base, threadId: validateStartedThread(thread) });
  }
  if (notification.method === 'turn/started') {
    const turn = notification.params['turn'];
    if (!isJsonObject(turn)) {
      throw new TypeError('Started Turn is malformed');
    }
    validateTurn(turn);
    return Object.freeze({
      ...base,
      threadId: boundedIdentifier(notification.params['threadId']),
      turnId: boundedIdentifier(turn['id']),
    });
  }
  if (notification.method === 'turn/completed') {
    const terminal = projectTerminal(notification.params);
    return Object.freeze({
      ...base,
      terminal,
      threadId: terminal.threadId,
      turnId: terminal.turnId,
    });
  }
  if (notification.method === 'item/started' || notification.method === 'item/completed') {
    const item = notification.params['item'];
    if (!isJsonObject(item)) {
      throw new TypeError('Thread Item is malformed');
    }
    return Object.freeze({
      ...base,
      item: validateItem(item, notification.method === 'item/started' ? 'STARTED' : 'COMPLETED'),
      threadId: boundedIdentifier(notification.params['threadId']),
      turnId: boundedIdentifier(notification.params['turnId']),
    });
  }
  if (notification.method === 'rawResponseItem/completed') {
    const item = notification.params['item'];
    if (!isJsonObject(item)) {
      throw new TypeError('Raw Response Item is malformed');
    }
    return Object.freeze({
      ...base,
      rawResponseItem: projectRawResponseItem(item),
      threadId: boundedIdentifier(notification.params['threadId']),
      turnId: boundedIdentifier(notification.params['turnId']),
    });
  }
  if (notification.method === 'rawResponse/completed') {
    const usage: unknown = notification.params['usage'];
    if (usage !== null) {
      if (!isUnknownJsonObject(usage)) {
        throw new TypeError('Raw response token usage is malformed');
      }
      validateTokenUsageBreakdown(usage);
    }
  }
  if (notification.method === 'account/rateLimits/updated') {
    validateRateLimits(notification.params);
  }
  if (notification.method === 'thread/status/changed') {
    validateThreadStatusValue(notification.params['status']);
  }
  if (notification.method === 'thread/tokenUsage/updated') {
    validateThreadTokenUsage(notification.params);
  }
  if (notification.method === 'remoteControl/status/changed') {
    const status: unknown = notification.params['status'];
    if (
      typeof status !== 'string' ||
      !['disabled', 'connecting', 'connected', 'errored'].includes(status)
    ) {
      throw new TypeError('Remote-control status is outside the pinned union');
    }
    return Object.freeze({
      ...base,
      remoteControlStatus: status as NonNullable<ValidatedProtocolFact['remoteControlStatus']>,
    });
  }
  return Object.freeze(base);
}

function correlatedEvent(
  fact: ValidatedProtocolFact,
  kind: 'REASONING_OBSERVED' | 'STREAM_PROGRESS' | 'USER_MESSAGE_OBSERVED',
): IntakeObservedEvent {
  if (fact.threadId === undefined || fact.turnId === undefined) {
    throw new TypeError('Correlated protocol fact is missing its references');
  }
  return Object.freeze({
    kind,
    sequence: fact.sequence,
    threadId: fact.threadId,
    turnId: fact.turnId,
  });
}

function failureEvent(
  fact: ValidatedProtocolFact,
  kind: 'FORBIDDEN_EFFECT_OBSERVED' | 'PROTOCOL_VIOLATION',
  token: string = fact.method,
): IntakeObservedEvent {
  return kind === 'FORBIDDEN_EFFECT_OBSERVED'
    ? Object.freeze({
        diagnostic: 'PROJECTED_FORBIDDEN_EFFECT' as const,
        kind,
        sequence: fact.sequence,
        ...(fact.threadId === undefined ? {} : { threadId: fact.threadId }),
        token,
        ...(fact.turnId === undefined ? {} : { turnId: fact.turnId }),
      })
    : Object.freeze({
        diagnostic: 'PROJECTED_UNMAPPED_LIFECYCLE' as const,
        kind,
        sequence: fact.sequence,
        token,
      });
}

function classifyItem(fact: ValidatedProtocolFact): IntakeObservedEvent {
  if (fact.item === undefined || fact.threadId === undefined || fact.turnId === undefined) {
    throw new TypeError('Item protocol fact is incomplete');
  }
  const common = { sequence: fact.sequence, threadId: fact.threadId, turnId: fact.turnId };
  switch (fact.item.type) {
    case 'agentMessage':
      if (fact.item.message === undefined) {
        throw new TypeError('Message Item projection is incomplete');
      }
      return Object.freeze({
        ...common,
        kind: fact.method === 'item/started' ? 'MESSAGE_STARTED' : 'MESSAGE_COMPLETED',
        message: fact.item.message,
      });
    case 'reasoning':
      return Object.freeze({ ...common, kind: 'REASONING_OBSERVED' });
    case 'userMessage':
      return Object.freeze({ ...common, kind: 'USER_MESSAGE_OBSERVED' });
    case 'collabAgentToolCall':
    case 'commandExecution':
    case 'dynamicToolCall':
    case 'fileChange':
    case 'imageGeneration':
    case 'imageView':
    case 'mcpToolCall':
    case 'sleep':
    case 'subAgentActivity':
    case 'webSearch':
      return Object.freeze({
        ...common,
        diagnostic: 'PROJECTED_FORBIDDEN_EFFECT',
        kind: 'FORBIDDEN_EFFECT_OBSERVED',
        token: fact.item.type,
      });
    case 'contextCompaction':
    case 'enteredReviewMode':
    case 'exitedReviewMode':
    case 'hookPrompt':
    case 'plan':
      return Object.freeze({
        diagnostic: 'PROJECTED_UNMAPPED_LIFECYCLE',
        kind: 'PROTOCOL_VIOLATION',
        sequence: fact.sequence,
        token: fact.item.type,
      });
  }
}

function classifyRawResponseItem(fact: ValidatedProtocolFact): IntakeObservedEvent {
  if (
    fact.rawResponseItem === undefined ||
    fact.threadId === undefined ||
    fact.turnId === undefined
  ) {
    throw new TypeError('Raw Response Item protocol fact is incomplete');
  }
  switch (fact.rawResponseItem.type) {
    case 'message':
      return fact.rawResponseItem.messageRole === 'assistant'
        ? correlatedEvent(fact, 'STREAM_PROGRESS')
        : failureEvent(fact, 'PROTOCOL_VIOLATION', fact.rawResponseItem.type);
    case 'reasoning':
      return correlatedEvent(fact, 'REASONING_OBSERVED');
    case 'agent_message':
    case 'custom_tool_call':
    case 'custom_tool_call_output':
    case 'function_call':
    case 'function_call_output':
    case 'image_generation_call':
    case 'local_shell_call':
    case 'tool_search_call':
    case 'tool_search_output':
    case 'web_search_call':
      return failureEvent(fact, 'FORBIDDEN_EFFECT_OBSERVED', fact.rawResponseItem.type);
    case 'compaction':
    case 'compaction_trigger':
    case 'context_compaction':
    case 'other':
      return failureEvent(fact, 'PROTOCOL_VIOLATION', fact.rawResponseItem.type);
  }
}

function classifyIntakeEffect(fact: ValidatedProtocolFact): IntakeObservedEvent {
  switch (fact.method) {
    case 'thread/started':
      if (fact.threadId === undefined) {
        throw new TypeError('Thread fact is incomplete');
      }
      return Object.freeze({
        kind: 'THREAD_STARTED',
        sequence: fact.sequence,
        threadId: fact.threadId,
      });
    case 'turn/started':
      if (fact.threadId === undefined || fact.turnId === undefined) {
        throw new TypeError('Turn fact is incomplete');
      }
      return Object.freeze({
        kind: 'TURN_STARTED',
        sequence: fact.sequence,
        threadId: fact.threadId,
        turnId: fact.turnId,
      });
    case 'turn/completed':
      if (fact.terminal === undefined) {
        throw new TypeError('Terminal fact is incomplete');
      }
      return Object.freeze({
        kind: 'TURN_COMPLETED',
        sequence: fact.sequence,
        terminal: fact.terminal,
      });
    case 'item/completed':
    case 'item/started':
      return classifyItem(fact);
    case 'rawResponseItem/completed':
      return classifyRawResponseItem(fact);
    case 'item/agentMessage/delta':
    case 'item/reasoning/summaryPartAdded':
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
    case 'rawResponse/completed':
      return correlatedEvent(fact, 'STREAM_PROGRESS');
    case 'account/rateLimits/updated':
      return Object.freeze({
        kind: 'BENIGN_PROCESS_PROJECTION',
        projection: 'RATE_LIMITS_UPDATED',
        sequence: fact.sequence,
      });
    case 'remoteControl/status/changed':
      return fact.remoteControlStatus === 'disabled'
        ? Object.freeze({
            kind: 'BENIGN_PROCESS_PROJECTION',
            projection: 'REMOTE_CONTROL_DISABLED',
            sequence: fact.sequence,
          })
        : failureEvent(fact, 'PROTOCOL_VIOLATION');
    case 'thread/status/changed':
      return Object.freeze({
        kind: 'BENIGN_PROCESS_PROJECTION',
        projection: 'THREAD_STATUS_UPDATED',
        sequence: fact.sequence,
        ...(fact.threadId === undefined ? {} : { threadId: fact.threadId }),
      });
    case 'thread/tokenUsage/updated':
      return Object.freeze({
        kind: 'BENIGN_PROCESS_PROJECTION',
        projection: 'THREAD_TOKEN_USAGE_UPDATED',
        sequence: fact.sequence,
        ...(fact.threadId === undefined ? {} : { threadId: fact.threadId }),
        ...(fact.turnId === undefined ? {} : { turnId: fact.turnId }),
      });
    case 'app/list/updated':
    case 'command/exec/outputDelta':
    case 'externalAgentConfig/import/completed':
    case 'externalAgentConfig/import/progress':
    case 'fs/changed':
    case 'fuzzyFileSearch/sessionCompleted':
    case 'fuzzyFileSearch/sessionUpdated':
    case 'hook/completed':
    case 'hook/started':
    case 'item/autoApprovalReview/completed':
    case 'item/autoApprovalReview/started':
    case 'item/commandExecution/outputDelta':
    case 'item/commandExecution/terminalInteraction':
    case 'item/fileChange/outputDelta':
    case 'item/fileChange/patchUpdated':
    case 'item/mcpToolCall/progress':
    case 'mcpServer/oauthLogin/completed':
    case 'mcpServer/startupStatus/updated':
    case 'process/exited':
    case 'process/outputDelta':
    case 'serverRequest/resolved':
    case 'skills/changed':
    case 'thread/environment/connected':
    case 'thread/environment/disconnected':
    case 'turn/diff/updated':
      return failureEvent(fact, 'FORBIDDEN_EFFECT_OBSERVED');
    case 'account/login/completed':
    case 'account/updated':
    case 'configWarning':
    case 'deprecationNotice':
    case 'error':
    case 'guardianWarning':
    case 'item/plan/delta':
    case 'model/rerouted':
    case 'model/safetyBuffering/updated':
    case 'model/verification':
    case 'thread/archived':
    case 'thread/closed':
    case 'thread/compacted':
    case 'thread/deleted':
    case 'thread/goal/cleared':
    case 'thread/goal/updated':
    case 'thread/name/updated':
    case 'thread/realtime/closed':
    case 'thread/realtime/error':
    case 'thread/realtime/itemAdded':
    case 'thread/realtime/outputAudio/delta':
    case 'thread/realtime/sdp':
    case 'thread/realtime/started':
    case 'thread/realtime/transcript/delta':
    case 'thread/realtime/transcript/done':
    case 'thread/settings/updated':
    case 'thread/unarchived':
    case 'turn/moderationMetadata':
    case 'turn/plan/updated':
    case 'warning':
    case 'windows/worldWritableWarning':
    case 'windowsSandbox/setupCompleted':
      return failureEvent(fact, 'PROTOCOL_VIOLATION');
  }
}

export class IntakeProtocolProjection {
  readonly #emit: (event: IntakeObservedEvent) => void;

  public constructor(emit: (event: IntakeObservedEvent) => void) {
    this.#emit = emit;
  }

  public readonly record = (notification: AppServerNotification): void => {
    this.#emit(this.project(notification));
  };

  public project(notification: AppServerNotification): IntakeObservedEvent {
    try {
      return classifyIntakeEffect(projectValidatedFact(notification));
    } catch {
      return Object.freeze({
        diagnostic: 'PROJECTED_MALFORMED_PARAMS',
        kind: 'PROTOCOL_VIOLATION',
        sequence:
          Number.isSafeInteger(notification.sequence) && notification.sequence > 0
            ? notification.sequence
            : 1,
        token: notification.method,
      });
    }
  }
}
