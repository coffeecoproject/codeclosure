import { createInterface } from 'node:readline';
import process from 'node:process';

const scenario = process.argv[2] ?? 'happy';
let initialized = false;
let pendingApproval;
let turnId = 'turn-fixture';
let configReadCount = 0;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function turn(status, items, error = null, id = turnId, itemsView = 'full') {
  return {
    completedAt: status === 'inProgress' ? null : 2,
    durationMs: status === 'inProgress' ? null : 1_000,
    error,
    id,
    items,
    itemsView,
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
  const selectedCommandSource = {
    'unified-exec-interaction': 'unifiedExecInteraction',
    'unified-exec-startup': 'unifiedExecStartup',
    'user-shell-command': 'userShell',
  }[scenario];
  if (selectedCommandSource !== undefined) {
    return [
      {
        aggregatedOutput: null,
        command: 'fixture-command',
        commandActions: [],
        cwd: message.params.cwd,
        durationMs: null,
        exitCode: null,
        id: `${scenario}-1`,
        pluginId: null,
        processId: null,
        scriptPath: null,
        source: selectedCommandSource,
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
    const startedItem =
      item.type === 'commandExecution' && item.status !== 'inProgress'
        ? {
            ...item,
            aggregatedOutput: null,
            durationMs: null,
            exitCode: null,
            status: 'inProgress',
          }
        : item;
    send({
      method: 'item/started',
      params: { item: startedItem, startedAtMs: 1, threadId, turnId },
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
  if (
    scenario !== 'terminal-only-unknown-item' &&
    scenario !== 'terminal-only-in-progress-item' &&
    scenario !== 'terminal-summary-without-completed'
  ) {
    sendItemLifecycles(threadId, items);
  }
  const terminalThreadId = scenario === 'wrong-thread' ? 'thread-split' : threadId;
  const terminalTurnId = scenario === 'wrong-turn' ? 'turn-split' : turnId;
  const terminalOnly =
    scenario === 'terminal-only-unknown-item' || scenario === 'terminal-only-in-progress-item';
  const summaryItem = [...items].reverse().find((item) => item.type === 'agentMessage');
  const terminalViewItems = terminalOnly || summaryItem === undefined ? items : [summaryItem];
  const itemsView =
    terminalOnly || scenario === 'terminal-full-view'
      ? 'full'
      : summaryItem === undefined
        ? 'notLoaded'
        : 'summary';
  if (scenario === 'terminal-summary-mismatch' && summaryItem !== undefined) {
    const payload = JSON.parse(summaryItem.text);
    payload.result.summary = 'Terminal summary did not match item/completed.';
    terminalViewItems[0] = { ...summaryItem, text: JSON.stringify(payload) };
  }
  const notification = {
    method: 'turn/completed',
    params: {
      threadId: terminalThreadId,
      turn: turn('completed', terminalViewItems, null, terminalTurnId, itemsView),
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
  const writableRoots = scenario === 'thread-sandbox-drift' ? [message.params.cwd] : [];
  return {
    approvalPolicy: message.params.approvalPolicy,
    approvalsReviewer: message.params.approvalsReviewer,
    cwd: message.params.cwd,
    instructionSources,
    model: message.params.model,
    modelProvider: message.params.modelProvider,
    reasoningEffort: 'low',
    sandbox: {
      excludeSlashTmp: false,
      excludeTmpdirEnvVar: false,
      networkAccess: false,
      type: 'workspaceWrite',
      writableRoots,
    },
    serviceTier: scenario === 'thread-service-tier-drift' ? 'priority' : message.params.serviceTier,
    thread: { id },
  };
}

function hasExactCandidateTurnPolicy(message) {
  const policy = message.params.sandboxPolicy;
  return (
    message.params.serviceTier === 'default' &&
    policy?.type === 'workspaceWrite' &&
    policy.networkAccess === false &&
    policy.excludeSlashTmp === true &&
    policy.excludeTmpdirEnvVar === true &&
    Array.isArray(policy.writableRoots) &&
    policy.writableRoots.length === 1 &&
    policy.writableRoots[0] === message.params.cwd
  );
}

function hasExactCandidateTrustOverride(message) {
  const config = message.params.config;
  const projects = config?.projects;
  const cwd = message.params.cwd;
  const trust = projects?.[cwd];
  return (
    config !== null &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    JSON.stringify(Object.keys(config).sort()) === JSON.stringify(['projects']) &&
    projects !== null &&
    typeof projects === 'object' &&
    !Array.isArray(projects) &&
    JSON.stringify(Object.keys(projects).sort()) === JSON.stringify([cwd]) &&
    trust !== null &&
    typeof trust === 'object' &&
    !Array.isArray(trust) &&
    JSON.stringify(Object.keys(trust).sort()) === JSON.stringify(['trust_level']) &&
    trust.trust_level === 'untrusted'
  );
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
    configReadCount += 1;
    const disabledFeatures = {
      apps: false,
      goals: false,
      hooks: false,
      memories: false,
      multi_agent: false,
      multi_agent_v2: false,
      personality: false,
      plugins: scenario === 'profile-bound-plugin-enabled',
      remote_plugin: false,
      skill_mcp_dependency_install: false,
      skill_search: false,
      tool_suggest: false,
    };
    send({
      id: message.id,
      result: {
        config: {
          approval_policy: 'never',
          default_permissions: 'codeclosure-m2',
          features: disabledFeatures,
          include_apps_instructions: false,
          include_collaboration_mode_instructions: false,
          mcp_servers:
            scenario === 'profile-bound-mcp-configured' ? { fixture: { enabled: true } } : {},
          model:
            scenario === 'config-drift' ||
            (scenario === 'thread-config-writeback' && configReadCount > 1)
              ? 'gpt-drift'
              : 'gpt-fixture',
          model_provider: 'openai',
          model_reasoning_effort: 'low',
          orchestrator: {
            mcp: { enabled: false },
            skills: { enabled: false },
          },
          skills: {
            bundled: { enabled: false },
            include_instructions: false,
          },
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
    if (!hasExactCandidateTrustOverride(message)) {
      send({
        id: message.id,
        error: { code: -32602, message: 'candidate trust override mismatch' },
      });
      return;
    }
    const result = threadResponse(message);
    send({ id: message.id, result });
    send({ method: 'thread/started', params: { thread: { id: result.thread.id } } });
    return;
  }
  if (message.method === 'thread/compact/start') {
    const item = { id: 'manual-compaction-1', type: 'contextCompaction' };
    const maintenanceTurnId = 'turn-maintenance-1';
    send({ id: message.id, result: {} });
    send({
      method: 'turn/started',
      params: {
        threadId: message.params.threadId,
        turn: turn('inProgress', [], null, maintenanceTurnId),
      },
    });
    if (scenario === 'manual-compaction-extra-turn') {
      send({
        method: 'turn/started',
        params: {
          threadId: message.params.threadId,
          turn: turn('inProgress', [], null, 'turn-maintenance-unexpected'),
        },
      });
    }
    send({
      method: 'item/started',
      params: {
        item,
        startedAtMs: 1,
        threadId: message.params.threadId,
        turnId: maintenanceTurnId,
      },
    });
    send({
      method: 'item/completed',
      params: {
        completedAtMs: 2,
        item,
        threadId: message.params.threadId,
        turnId: maintenanceTurnId,
      },
    });
    send({
      method: 'turn/completed',
      params: {
        threadId: message.params.threadId,
        turn: turn('completed', [item], null, maintenanceTurnId),
      },
    });
    return;
  }
  if (message.method === 'turn/start') {
    if (!hasExactCandidateTurnPolicy(message)) {
      send({
        id: message.id,
        error: { code: -32602, message: 'fixture requires the exact Candidate Turn policy' },
      });
      return;
    }
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
    if (
      scenario === 'remote-control-disabled' ||
      scenario === 'remote-control-connected' ||
      scenario === 'remote-control-disabled-environment'
    ) {
      send({
        method: 'remoteControl/status/changed',
        params: {
          environmentId:
            scenario === 'remote-control-disabled' ? null : 'fixture-remote-environment',
          installationId: 'fixture-installation',
          serverName: 'fixture-server',
          status: scenario === 'remote-control-connected' ? 'connected' : 'disabled',
        },
      });
    }
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
