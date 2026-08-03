import { Buffer } from 'node:buffer';
import { createInterface } from 'node:readline';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';

const scenario = process.argv[2] ?? 'intent-success';
const threadId = 'thread-intake-fixture';
const turnId = 'turn-intake-fixture';
const disabledFeatures = [
  'apps',
  'artifact',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'chronicle',
  'code_mode',
  'code_mode_buffered_exec',
  'code_mode_host',
  'code_mode_only',
  'computer_use',
  'current_time_reminder',
  'default_mode_request_user_input',
  'deferred_executor',
  'deferred_tool_world_state',
  'enable_mcp_apps',
  'exec_permission_approvals',
  'executor_capability_discovery',
  'external_agent_memory_import',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'memories',
  'multi_agent',
  'multi_agent_v2',
  'network_proxy',
  'non_prefixed_mcp_tool_names',
  'personality',
  'plugin_sharing',
  'plugins',
  'remote_compaction_v2',
  'remote_plugin',
  'request_permissions_tool',
  'respect_system_proxy',
  'rollout_budget',
  'search_tool',
  'shell_snapshot',
  'shell_tool',
  'shell_zsh_fork',
  'skill_mcp_dependency_install',
  'skill_search',
  'standalone_web_search',
  'token_budget',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'unified_exec',
  'unified_exec_zsh_fork',
  'web_search_cached',
  'web_search_request',
  'workspace_dependencies',
];

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function turn(status, items, error = null, selectedTurnId = turnId) {
  return {
    completedAt: status === 'inProgress' ? null : 2,
    durationMs: status === 'inProgress' ? null : 1,
    error,
    id: selectedTurnId,
    items,
    itemsView: status === 'inProgress' ? 'full' : 'summary',
    startedAt: 1,
    status,
  };
}

function closedConfig() {
  const config = {
    approval_policy: 'never',
    default_permissions: 'codeclosure-m2-5-intake-no-authority-effects',
    features: Object.fromEntries(disabledFeatures.map((feature) => [feature, false])),
    include_apps_instructions: false,
    include_collaboration_mode_instructions: false,
    mcp_servers: {},
    model: 'gpt-5.6-sol',
    model_provider: 'openai',
    model_reasoning_effort: 'low',
    orchestrator: { mcp: { enabled: false }, skills: { enabled: false } },
    skills: { bundled: { enabled: false }, include_instructions: false },
    web_search: 'disabled',
  };
  if (scenario === 'shell-tool-enabled') {
    config.features.shell_tool = true;
  }
  return config;
}

function finalText(message) {
  const answerOnly = message.params.outputSchema?.properties?.answerContent !== undefined;
  if (scenario === 'malformed-response') {
    return '{not-json';
  }
  if (scenario === 'duplicate-key-response') {
    return answerOnly
      ? '{"answerContent":"one","answerContent":"two"}'
      : '{"proposedCriteria":[],"proposedCriteria":[],"proposedNonGoals":[],"proposedAssumptions":[],"proposedQuestions":[],"candidateSourceSpanSuggestions":[]}';
  }
  if (scenario === 'unknown-response-field') {
    return answerOnly
      ? '{"answerContent":"bounded","goalId":"goal_forged"}'
      : '{"proposedCriteria":[],"proposedNonGoals":[],"proposedAssumptions":[],"proposedQuestions":[],"candidateSourceSpanSuggestions":[],"accept":true}';
  }
  if (scenario === 'oversized-answer') {
    return JSON.stringify({ answerContent: 'x'.repeat(16_385) });
  }
  if (scenario === 'oversized-wire') {
    return JSON.stringify({ answerContent: 'x'.repeat(131_073) });
  }
  return answerOnly
    ? JSON.stringify({ answerContent: 'This is a bounded non-authoritative answer.' })
    : JSON.stringify({
        proposedObjective: 'Prepare the bounded requested change.',
        proposedCriteria: ['The bounded request is represented.'],
        proposedNonGoals: [],
        proposedAssumptions: [],
        proposedQuestions: [],
        candidateSourceSpanSuggestions: [],
      });
}

function completeTurn(message) {
  const item = {
    id: 'agent-intake-final',
    memoryCitation: null,
    phase: 'final_answer',
    text: finalText(message),
    type: 'agentMessage',
  };
  if (scenario === 'invalid-utf8-stream') {
    const envelope = JSON.stringify({
      method: 'item/completed',
      params: { completedAtMs: 2, item: { ...item, text: 'INVALID_BYTE' }, threadId, turnId },
    });
    const bytes = Buffer.from(`${envelope}\n`);
    const offset = bytes.indexOf(Buffer.from('INVALID_BYTE'));
    bytes[offset] = 0xff;
    process.stdout.write(bytes);
    return;
  }
  if (scenario === 'tool-item') {
    send({
      method: 'item/completed',
      params: {
        completedAtMs: 2,
        item: { id: 'command-1', type: 'commandExecution' },
        threadId,
        turnId,
      },
    });
  }
  send({
    method: 'item/completed',
    params: { completedAtMs: 2, item, threadId, turnId },
  });
  send({
    method: 'turn/completed',
    params: {
      threadId: scenario === 'thread-mismatch' ? 'thread-replacement' : threadId,
      turn: turn('completed', [item]),
    },
  });
}

function handleRequest(message) {
  if (message.method === 'configRequirements/read') {
    send({
      id: message.id,
      result: { requirements: { managed: true, profile: 'codeclosure-m2-5-intake' } },
    });
    return;
  }
  if (message.method === 'config/read') {
    send({ id: message.id, result: { config: closedConfig(), layers: [] } });
    return;
  }
  if (message.method === 'permissionProfile/list') {
    send({
      id: message.id,
      result: {
        data: [
          {
            allowed: true,
            id: 'codeclosure-m2-5-intake-no-authority-effects',
            name: 'CodeClosure M2.5 Intake (isolated read-only)',
          },
        ],
        nextCursor: null,
      },
    });
    return;
  }
  if (message.method === 'thread/start') {
    if (
      message.params.ephemeral !== true ||
      message.params.sandbox !== 'read-only' ||
      message.params.model !== 'gpt-5.6-sol' ||
      message.params.modelProvider !== 'openai' ||
      message.params.approvalPolicy !== 'never'
    ) {
      send({ id: message.id, error: { code: -32602, message: 'closed Thread policy mismatch' } });
      return;
    }
    send({
      id: message.id,
      result: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        cwd: message.params.cwd,
        instructionSources: [],
        model: 'gpt-5.6-sol',
        modelProvider: 'openai',
        reasoningEffort: 'low',
        sandbox: { type: 'readOnly', networkAccess: false },
        serviceTier: 'default',
        thread: { id: threadId },
      },
    });
    send({ method: 'thread/started', params: { thread: { id: threadId } } });
    return;
  }
  if (message.method === 'thread/resume' || message.method === 'thread/compact/start') {
    process.exit(41);
  }
  if (message.method === 'turn/start') {
    if (
      message.params.threadId !== threadId ||
      message.params.sandboxPolicy?.type !== 'readOnly' ||
      message.params.sandboxPolicy?.networkAccess !== false ||
      message.params.outputSchema === undefined
    ) {
      send({ id: message.id, error: { code: -32602, message: 'closed Turn policy mismatch' } });
      return;
    }
    if (scenario === 'request-timeout') {
      return;
    }
    send({ id: message.id, result: { turn: turn('inProgress', []) } });
    send({
      method: 'turn/started',
      params: { threadId, turn: turn('inProgress', []) },
    });
    if (scenario === 'process-failure') {
      process.exit(42);
    }
    if (scenario === 'compact') {
      send({ method: 'thread/compacted', params: { threadId } });
      return;
    }
    if (scenario === 'thread-loss') {
      send({ method: 'thread/closed', params: { threadId } });
      return;
    }
    if (scenario === 'server-request') {
      send({
        id: 'server-request-1',
        method: 'item/tool/requestUserInput',
        params: { itemId: 'tool-1', questions: [], threadId, turnId },
      });
      return;
    }
    if (scenario === 'model-rerouted') {
      send({
        method: 'model/rerouted',
        params: { fromModel: 'gpt-5.6-sol', reason: 'fixture', toModel: 'fallback' },
      });
      return;
    }
    if (scenario === 'running-turn') {
      return;
    }
    completeTurn(message);
    return;
  }
  if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} });
    return;
  }
  send({ id: message.id, error: { code: -32601, message: 'unsupported fixture request' } });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const keepAlive = setInterval(() => undefined, 1_000);
lines.on('close', () => clearInterval(keepAlive));
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({
      id: message.id,
      result: {
        codexHome: process.env.CODEX_HOME,
        platformFamily: 'fixture',
        platformOs: process.platform,
        userAgent: 'codeclosure-intake-fixture',
      },
    });
    return;
  }
  if (message.method === 'initialized') {
    return;
  }
  if (message.method !== undefined) {
    handleRequest(message);
  }
});
