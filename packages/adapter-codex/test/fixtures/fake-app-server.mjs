import { createInterface } from 'node:readline';
import process from 'node:process';

const scenario = process.argv[2] ?? 'happy';
let initialized = false;
let pendingApproval;
let turnId = 'turn-fixture';

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function turn(status, items, error = null, id = turnId) {
  return {
    completedAt: status === 'inProgress' ? null : 2,
    durationMs: status === 'inProgress' ? null : 1_000,
    error,
    id,
    items,
    itemsView: 'full',
    startedAt: 1,
    status,
  };
}

function bindingFromSchema(schema) {
  const result = {};
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (key !== 'result' && key !== 'schemaVersion') {
      result[key] = property.const;
    }
  }
  return result;
}

function validPayload(message) {
  return {
    schemaVersion: 1,
    ...bindingFromSchema(message.params.outputSchema),
    result: {
      claimedScope: 'src',
      kind: 'COMPLETION_REQUEST',
      proposedEvidenceRefs: ['worker-observation:edited-src'],
      summary:
        scenario === 'alternate-valid'
          ? 'Implemented the same bounded change with an alternate report.'
          : 'Implemented the bounded Candidate change.',
    },
  };
}

function terminalItems(message) {
  const valid = validPayload(message);
  if (scenario === 'free-form-done') {
    return [
      {
        id: 'agent-final',
        memoryCitation: null,
        phase: 'final_answer',
        text: 'done',
        type: 'agentMessage',
      },
    ];
  }
  if (scenario === 'fabricated-accept') {
    return [
      {
        id: 'agent-final',
        memoryCitation: null,
        phase: 'final_answer',
        text: '{"ACCEPT":true}',
        type: 'agentMessage',
      },
    ];
  }
  if (scenario === 'plan-only') {
    return [{ id: 'plan-1', text: 'Everything is complete.', type: 'plan' }];
  }
  if (scenario === 'wrong-binding') {
    valid.attemptId = 'attempt_wrong';
  }
  if (scenario === 'wrong-phase') {
    valid.phase = 'PLAN';
  }
  const finalItem = {
    id: 'agent-final',
    memoryCitation: null,
    phase: 'final_answer',
    text: JSON.stringify(valid),
    type: 'agentMessage',
  };
  if (scenario === 'multiple-final') {
    return [finalItem, { ...finalItem, id: 'agent-final-2' }];
  }
  if (scenario === 'unsupported-item') {
    return [
      {
        appContext: null,
        arguments: {},
        durationMs: 1,
        error: null,
        id: 'mcp-1',
        pluginId: null,
        result: null,
        server: 'fixture',
        status: 'completed',
        tool: 'forbidden',
        type: 'mcpToolCall',
      },
      finalItem,
    ];
  }
  if (scenario === 'unknown-item' || scenario === 'terminal-only-unknown-item') {
    return [{ id: 'unknown-1', type: 'futureExternalEffect' }, finalItem];
  }
  if (scenario === 'plugin-command') {
    return [
      {
        aggregatedOutput: null,
        command: 'plugin-command',
        commandActions: [],
        cwd: message.params.cwd,
        durationMs: 1,
        exitCode: 0,
        id: 'plugin-command-1',
        pluginId: 'fixture-plugin',
        processId: null,
        scriptPath: 'scripts/fixture.js',
        source: 'agent',
        status: 'completed',
        type: 'commandExecution',
      },
      finalItem,
    ];
  }
  if (scenario === 'skill-user-message') {
    return [
      {
        clientId: null,
        content: [{ name: 'fixture-skill', path: '/fixture/SKILL.md', type: 'skill' }],
        id: 'user-skill-1',
        type: 'userMessage',
      },
      finalItem,
    ];
  }
  if (scenario === 'mismatched-user-message') {
    return [
      {
        clientId: null,
        content: [{ text: 'unbound input', text_elements: [], type: 'text' }],
        id: 'user-unbound-1',
        type: 'userMessage',
      },
      finalItem,
    ];
  }
  if (scenario === 'malformed-agent-message') {
    return [{ phase: 'final_answer', text: JSON.stringify(valid), type: 'agentMessage' }];
  }
  if (scenario === 'terminal-only-in-progress-item') {
    return [
      {
        aggregatedOutput: null,
        command: 'fixture-check',
        commandActions: [],
        cwd: message.params.cwd,
        durationMs: null,
        exitCode: null,
        id: 'command-in-progress-1',
        pluginId: null,
        processId: null,
        scriptPath: null,
        source: 'agent',
        status: 'inProgress',
        type: 'commandExecution',
      },
      finalItem,
    ];
  }
  if (scenario === 'diagnostics') {
    return [
      {
        clientId: null,
        content: message.params.input,
        id: 'user-bound-1',
        type: 'userMessage',
      },
      { id: 'plan-1', text: 'Bounded plan.', type: 'plan' },
      {
        aggregatedOutput: 'passing-looking output has no authority',
        command: 'fixture-check',
        commandActions: [],
        cwd: message.params.cwd,
        durationMs: 1,
        exitCode: 0,
        id: 'command-1',
        pluginId: null,
        processId: null,
        scriptPath: null,
        source: 'agent',
        status: 'completed',
        type: 'commandExecution',
      },
      { changes: [], id: 'change-1', status: 'completed', type: 'fileChange' },
      { content: [], id: 'reasoning-1', summary: [], type: 'reasoning' },
      finalItem,
    ];
  }
  return [finalItem];
}

function sendItemLifecycles(threadId, items) {
  for (const item of items) {
    send({
      method: 'item/started',
      params: { item, startedAtMs: 1, threadId, turnId },
    });
    send({
      method: 'item/completed',
      params: { completedAtMs: 2, item, threadId, turnId },
    });
  }
}

function sendTerminal(message) {
  const threadId = message.params.threadId;
  if (scenario === 'no-terminal' || scenario === 'interrupt') {
    return;
  }
  if (scenario === 'process-exit') {
    process.exit(9);
  }
  if (scenario === 'settings-drift') {
    send({ method: 'thread/settings/updated', params: { threadId } });
  }
  if (scenario === 'compaction') {
    const item = { id: 'compaction-1', type: 'contextCompaction' };
    send({
      method: 'item/started',
      params: { item, startedAtMs: 1, threadId, turnId },
    });
    send({
      method: 'item/completed',
      params: { completedAtMs: 2, item, threadId, turnId },
    });
  }
  if (scenario === 'approval') {
    pendingApproval = { message, threadId };
    send({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'outside-policy',
        environmentId: null,
        itemId: 'command-approval',
        startedAtMs: 1,
        threadId,
        turnId,
      },
    });
    return;
  }
  if (scenario === 'backend-failed') {
    send({
      method: 'turn/completed',
      params: {
        threadId,
        turn: turn('failed', [], {
          additionalDetails: null,
          codexErrorInfo: null,
          message: 'fixture failure',
        }),
      },
    });
    return;
  }
  const items = terminalItems(message);
  if (scenario !== 'terminal-only-unknown-item' && scenario !== 'terminal-only-in-progress-item') {
    sendItemLifecycles(threadId, items);
  }
  const terminalThreadId = scenario === 'wrong-thread' ? 'thread-split' : threadId;
  const terminalTurnId = scenario === 'wrong-turn' ? 'turn-split' : turnId;
  const notification = {
    method: 'turn/completed',
    params: {
      threadId: terminalThreadId,
      turn: turn('completed', items, null, terminalTurnId),
    },
  };
  if (scenario === 'missing-items-view') {
    delete notification.params.turn.itemsView;
  }
  send(notification);
  if (scenario === 'duplicate-terminal') {
    send(notification);
  }
}

function threadResponse(message) {
  const instructionSources =
    scenario === 'instruction-extra' ? [`${process.cwd()}/UNBOUND_INSTRUCTIONS.md`] : [];
  const id = message.method === 'thread/resume' ? message.params.threadId : 'thread-fixture';
  return {
    approvalPolicy: message.params.approvalPolicy,
    approvalsReviewer: message.params.approvalsReviewer,
    cwd: message.params.cwd,
    instructionSources,
    model: message.params.model,
    modelProvider: message.params.modelProvider,
    reasoningEffort: 'low',
    sandbox: {
      excludeSlashTmp: true,
      excludeTmpdirEnvVar: true,
      networkAccess: false,
      type: 'workspaceWrite',
      writableRoots: [message.params.cwd],
    },
    serviceTier: message.params.serviceTier ?? null,
    thread: { id },
  };
}

function handleRequest(message) {
  if (message.method === 'configRequirements/read') {
    send({
      id: message.id,
      result:
        scenario === 'requirements-drift'
          ? { requirements: { managed: false, profile: 'drift' } }
          : { requirements: { managed: true, profile: 'fixture' } },
    });
    return;
  }
  if (message.method === 'config/read') {
    send({
      id: message.id,
      result: {
        config: {
          approval_policy: 'never',
          default_permissions: 'codeclosure-m2',
          model: scenario === 'config-drift' ? 'gpt-drift' : 'gpt-fixture',
          model_provider: 'openai',
          model_reasoning_effort: 'low',
          web_search: 'disabled',
        },
        layers: [],
      },
    });
    return;
  }
  if (message.method === 'permissionProfile/list') {
    send({
      id: message.id,
      result: {
        data: [
          {
            allowed: scenario !== 'profile-drift',
            id: 'codeclosure-m2',
            name: 'CodeClosure M2',
          },
        ],
        nextCursor: null,
      },
    });
    return;
  }
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    const result = threadResponse(message);
    send({ id: message.id, result });
    send({ method: 'thread/started', params: { thread: { id: result.thread.id } } });
    return;
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: turn('inProgress', []) } });
    send({
      method: 'turn/started',
      params: { threadId: message.params.threadId, turn: turn('inProgress', []) },
    });
    sendTerminal(message);
    return;
  }
  if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} });
    send({
      method: 'turn/completed',
      params: { threadId: message.params.threadId, turn: turn('interrupted', []) },
    });
    return;
  }
  send({ error: { code: -32_601, message: 'unsupported fixture request' }, id: message.id });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (initialized) {
      send({ error: { code: -32_600, message: 'already initialized' }, id: message.id });
      return;
    }
    initialized = true;
    send({
      id: message.id,
      result: {
        codexHome: process.env.CODEX_HOME,
        platformFamily: 'fixture',
        platformOs: process.platform,
        userAgent: 'adapter-fixture',
      },
    });
    return;
  }
  if (message.method === 'initialized') {
    return;
  }
  if (message.method !== undefined) {
    handleRequest(message);
    return;
  }
  if (message.id === 'approval-1' && pendingApproval !== undefined) {
    if (message.result?.decision !== 'decline') {
      process.exit(21);
    }
    const { message: turnMessage, threadId } = pendingApproval;
    const items = terminalItems(turnMessage);
    sendItemLifecycles(threadId, items);
    send({
      method: 'turn/completed',
      params: { threadId, turn: turn('completed', items) },
    });
    pendingApproval = undefined;
  }
});
