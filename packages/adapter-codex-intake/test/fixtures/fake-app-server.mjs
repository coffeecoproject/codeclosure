import { Buffer } from 'node:buffer';
import { createInterface } from 'node:readline';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';

const scenario = process.argv[2] ?? 'intent-success';
const isM251Scenario = scenario.startsWith('v2-');
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
const v2AdditionalDisabledFeatures = [
  'apply_patch_streaming_events',
  'concurrent_reasoning_summaries',
  'enable_request_compression',
  'fast_mode',
  'guardian_approval',
  'guardianv2',
  'in_app_updates',
  'local_thread_store_compression',
  'mcp_2026_07_28',
  'mentions_v2',
  'prevent_idle_sleep',
  'realtime_conversation',
  'runtime_metrics',
  'secret_auth_storage',
  'terminal_visualization_instructions',
  'use_agent_identity',
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

function encodeIntentResponse(response) {
  if (!isM251Scenario) {
    return JSON.stringify(response);
  }
  return JSON.stringify({
    proposedObjective: response.proposedObjective ?? null,
    proposedCriteria: response.proposedCriteria,
    proposedScope: response.proposedScope ?? null,
    proposedNonGoals: response.proposedNonGoals,
    proposedAssumptions: response.proposedAssumptions,
    proposedQuestions: response.proposedQuestions,
    candidateSourceSpanSuggestions: [],
    proposedClassification: response.proposedClassification ?? null,
  });
}

function closedConfig() {
  const selectedDisabledFeatures = isM251Scenario
    ? [
        ...disabledFeatures.filter(
          (feature) =>
            feature !== 'search_tool' &&
            feature !== 'web_search_cached' &&
            feature !== 'web_search_request',
        ),
        ...v2AdditionalDisabledFeatures,
        'remote_control',
      ].sort()
    : disabledFeatures;
  const config = {
    approval_policy: 'never',
    default_permissions: 'codeclosure-m2-5-intake-no-authority-effects',
    features: Object.fromEntries(selectedDisabledFeatures.map((feature) => [feature, false])),
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
  if (isM251Scenario) {
    Object.assign(config, {
      agents: { enabled: false },
      allow_login_shell: false,
      analytics: { enabled: false },
      apps: {
        _default: {
          destructive_enabled: false,
          enabled: false,
          open_world_enabled: false,
        },
      },
      approvals_reviewer: 'user',
      check_for_update_on_startup: false,
      cli_auth_credentials_store: 'file',
      compact_prompt: null,
      developer_instructions: null,
      feedback: { enabled: false },
      history: { persistence: 'none' },
      instructions: null,
      shell_environment_policy: { experimental_use_profile: false, inherit: 'none' },
      tools: null,
    });
  }
  if (scenario === 'shell-tool-enabled') {
    config.features.shell_tool = true;
  }
  if (scenario === 'v2-config-mismatch') {
    config.features.apps = true;
  }
  if (scenario === 'v2-config-extra-feature') {
    config.features.future_feature = false;
  }
  if (scenario === 'v2-config-instruction-override') {
    config.developer_instructions = 'sensitive-instruction-content';
  }
  if (scenario === 'v2-config-agents-enabled') {
    config.agents.enabled = true;
  }
  return config;
}

function fullThread() {
  return {
    canAcceptDirectInput: true,
    id: threadId,
    sessionId: 'session-intake-fixture',
    forkedFromId: null,
    parentThreadId: null,
    preview: '',
    ephemeral: true,
    extra: null,
    isPinned: false,
    modelProvider: 'openai',
    createdAt: 1,
    updatedAt: 1,
    recencyAt: null,
    status: { type: 'idle' },
    path: null,
    cwd: process.cwd(),
    cliVersion: '0.146.1',
    source: 'appServer',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    historyMode: scenario === 'v2-thread-history-paginated' ? 'paginated' : 'legacy',
    name: null,
    turns: [],
  };
}

function rateLimits() {
  return {
    limitId: 'fixture-limit-must-not-be-retained',
    limitName: 'fixture-account-value-must-not-be-retained',
    primary: null,
    secondary: null,
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    planType: null,
    rateLimitReachedType: null,
  };
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
  if (
    !answerOnly &&
    (scenario === 'cli-exact-source' ||
      scenario === 'cli-unsupported-assumption' ||
      scenario === 'v2-cli-exact-source' ||
      scenario === 'v2-cli-unsupported-assumption')
  ) {
    return encodeIntentResponse({
      proposedObjective: 'Ship slice 7',
      proposedCriteria: ['Ship slice 7'],
      proposedNonGoals: [],
      proposedAssumptions:
        scenario === 'cli-unsupported-assumption' || scenario === 'v2-cli-unsupported-assumption'
          ? ['Confirm bounded risk']
          : [],
      proposedQuestions: [],
      candidateSourceSpanSuggestions: [
        {
          projectionFieldRef: 'OBJECTIVE',
          rawRequestRevision: 1,
          startByte: 0,
          endByte: 12,
        },
        {
          projectionFieldRef: 'REQUIRED_CRITERION',
          itemIndex: 0,
          rawRequestRevision: 1,
          startByte: 0,
          endByte: 12,
        },
      ],
    });
  }
  return answerOnly
    ? JSON.stringify({ answerContent: 'This is a bounded non-authoritative answer.' })
    : encodeIntentResponse({
        proposedObjective: 'Prepare the bounded requested change.',
        proposedCriteria: ['The bounded request is represented.'],
        proposedNonGoals: [],
        proposedAssumptions: [],
        proposedQuestions: [],
        candidateSourceSpanSuggestions: [],
      });
}

function forbiddenCommandItem() {
  return {
    type: 'commandExecution',
    id: 'command-intake-fixture',
    pluginId: null,
    scriptPath: null,
    command: 'forbidden',
    cwd: process.cwd(),
    processId: null,
    source: 'unifiedExecStartup',
    status: 'completed',
    commandActions: [],
    aggregatedOutput: null,
    exitCode: 0,
    durationMs: 1,
  };
}

function forbiddenRawFunctionCall() {
  return {
    type: 'function_call',
    name: 'sensitive-function-must-not-be-retained',
    arguments: 'sensitive-arguments-must-not-be-retained',
    call_id: 'call-intake-fixture',
  };
}

function sendRawResponseItem(item) {
  send({
    method: 'rawResponseItem/completed',
    params: { item, threadId, turnId },
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

function completeM251Turn(message) {
  const finalItem = {
    id: 'agent-intake-final',
    memoryCitation: null,
    phase: 'final_answer',
    text: finalText(message),
    type: 'agentMessage',
  };
  const userItem = {
    type: 'userMessage',
    id: 'user-intake-fixture',
    clientId: null,
    content: [],
  };
  const reasoningItem = {
    type: 'reasoning',
    id: 'reasoning-intake-fixture',
    summary: [],
    content: [],
  };
  send({
    method: 'item/started',
    params: { item: userItem, threadId, turnId, startedAtMs: 1 },
  });
  send({
    method: 'item/completed',
    params: { item: userItem, threadId, turnId, completedAtMs: 2 },
  });
  send({
    method: 'item/started',
    params: { item: reasoningItem, threadId, turnId, startedAtMs: 3 },
  });
  send({
    method: 'item/reasoning/summaryPartAdded',
    params: { threadId, turnId, itemId: reasoningItem.id, summaryIndex: 0 },
  });
  send({
    method: 'item/completed',
    params: { item: reasoningItem, threadId, turnId, completedAtMs: 4 },
  });
  send({
    method: 'item/started',
    params: { item: { ...finalItem, text: '' }, threadId, turnId, startedAtMs: 5 },
  });
  send({
    method: 'item/agentMessage/delta',
    params: { threadId, turnId, itemId: finalItem.id, delta: finalItem.text },
  });
  send({ method: 'account/rateLimits/updated', params: { rateLimits: rateLimits() } });
  if (scenario === 'v2-empty-completed') {
    finalItem.text = '';
  }
  send({
    method: 'item/completed',
    params: { item: finalItem, threadId, turnId, completedAtMs: 6 },
  });
  if (scenario === 'v2-multiple-messages') {
    send({
      method: 'item/completed',
      params: {
        item: { ...finalItem, id: 'agent-intake-extra' },
        threadId,
        turnId,
        completedAtMs: 7,
      },
    });
  }
  const terminalItem =
    scenario === 'v2-terminal-mismatch'
      ? { ...finalItem, text: '{"answerContent":"other"}' }
      : finalItem;
  send({
    method: 'turn/completed',
    params: { threadId, turn: turn('completed', [terminalItem]) },
  });
  if (scenario === 'v2-post-terminal-forbidden') {
    send({
      method: 'item/completed',
      params: {
        item: forbiddenCommandItem(),
        threadId,
        turnId,
        completedAtMs: 8,
      },
    });
  }
  if (scenario === 'v2-post-terminal-raw-function-call') {
    sendRawResponseItem(forbiddenRawFunctionCall());
  }
  if (scenario === 'v2-post-terminal-raw-compaction') {
    sendRawResponseItem({ type: 'compaction_trigger' });
  }
  if (scenario === 'v2-post-terminal-protocol-violation') {
    send({
      method: 'model/rerouted',
      params: {
        threadId,
        turnId,
        fromModel: 'gpt-5.6-sol',
        reason: 'highRiskCyberActivity',
        toModel: 'fallback',
      },
    });
  }
  if (scenario === 'v2-post-terminal-unsupported-notification') {
    send({ method: 'future/unknown', params: {} });
  }
}

function handleRequest(message) {
  if (message.method === 'configRequirements/read') {
    send({
      id: message.id,
      result: isM251Scenario
        ? { requirements: scenario === 'v2-managed-requirements-mismatch' ? {} : null }
        : { requirements: { managed: true, profile: 'codeclosure-m2-5-intake' } },
    });
    return;
  }
  if (message.method === 'config/read') {
    send({
      id: message.id,
      result: {
        config: closedConfig(),
        layers: [],
        ...(isM251Scenario ? { origins: {} } : {}),
      },
    });
    return;
  }
  if (message.method === 'permissionProfile/list') {
    send({
      id: message.id,
      result: {
        data: isM251Scenario
          ? [
              { allowed: true, description: 'Built-in read-only', id: ':read-only' },
              {
                allowed: scenario !== 'v2-permission-profile-mismatch',
                description: 'CodeClosure M2.5 Intake isolated read-only',
                id: 'codeclosure-m2-5-intake-no-authority-effects',
              },
            ]
          : [
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
        serviceTier:
          scenario === 'v2-thread-service-tier-drift'
            ? 'priority'
            : isM251Scenario
              ? null
              : 'default',
        thread: { id: threadId },
      },
    });
    send({
      method: 'thread/started',
      params: { thread: isM251Scenario ? fullThread() : { id: threadId } },
    });
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
    if (scenario === 'v2-unsupported-notification') {
      send({ method: 'future/unknown', params: {} });
      return;
    }
    if (scenario === 'v2-malformed-envelope') {
      send({ method: 'warning', params: [] });
      return;
    }
    if (scenario === 'v2-forbidden-command') {
      send({
        method: 'item/completed',
        params: {
          item: forbiddenCommandItem(),
          threadId,
          turnId,
          completedAtMs: 2,
        },
      });
      return;
    }
    if (scenario === 'v2-raw-function-call') {
      sendRawResponseItem(forbiddenRawFunctionCall());
      return;
    }
    if (scenario === 'v2-raw-compaction') {
      sendRawResponseItem({ type: 'compaction_trigger' });
      return;
    }
    if (scenario === 'v2-context-compaction-item') {
      send({
        method: 'item/completed',
        params: {
          item: { type: 'contextCompaction', id: 'compact-intake-fixture' },
          threadId,
          turnId,
          completedAtMs: 2,
        },
      });
      return;
    }
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
    if (isM251Scenario) {
      completeM251Turn(message);
    } else {
      completeTurn(message);
    }
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
    if (isM251Scenario) {
      if (scenario === 'v2-remote-malformed') {
        send({
          method: 'remoteControl/status/changed',
          params: { status: 'disabled', serverName: '', installationId: '' },
        });
      } else {
        send({
          method: 'remoteControl/status/changed',
          params: {
            status: scenario === 'v2-remote-connected' ? 'connected' : 'disabled',
            serverName: '',
            installationId: '',
            environmentId: null,
          },
        });
      }
    }
    return;
  }
  if (message.method === 'initialized') {
    return;
  }
  if (message.method !== undefined) {
    handleRequest(message);
  }
});
