import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

import {
  createControlledAppServerLaunch,
  isJsonObject,
  startAppServerClient,
  verifyBundledCodexInstallation,
} from '@codeclosure/codex-app-server-client';

function fail(message) {
  throw new TypeError(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredArgument(name) {
  const value = argument(name);
  if (value === undefined || value.length === 0) {
    fail(`Missing required argument ${name}`);
  }
  return value;
}

function object(value, label) {
  if (!isJsonObject(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 4_096) {
    fail(`${label} must be a bounded string`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  return value;
}

function diagnosticDigest(value, profile) {
  return `sha256:${createHash('sha256')
    .update(`${profile}\0${JSON.stringify(value)}`, 'utf8')
    .digest('hex')}`;
}

function writeControlledConfig({ codexHome, model, stateRoot, workspace }) {
  const config = `model = ${JSON.stringify(model)}
model_provider = "openai"
model_reasoning_effort = "low"
approval_policy = "never"
approvals_reviewer = "user"
default_permissions = "codeclosure-m2"
web_search = "disabled"
check_for_update_on_startup = false
allow_login_shell = false
cli_auth_credentials_store = "file"
sqlite_home = ${JSON.stringify(stateRoot)}
include_apps_instructions = false
include_collaboration_mode_instructions = false

[analytics]
enabled = false

[feedback]
enabled = false

[history]
persistence = "none"

[agents]
enabled = false

[apps._default]
enabled = false
destructive_enabled = false
open_world_enabled = false

[features]
apps = false
goals = false
hooks = false
memories = false
multi_agent = false
multi_agent_v2 = false
personality = false
plugins = false
remote_plugin = false
skill_mcp_dependency_install = false
skill_search = false
tool_suggest = false

[orchestrator.mcp]
enabled = false

[orchestrator.skills]
enabled = false

[skills]
include_instructions = false

[skills.bundled]
enabled = false

[shell_environment_policy]
inherit = "none"
experimental_use_profile = false

[permissions.codeclosure-m2]
description = "CodeClosure M2 controlled Candidate workspace"

[permissions.codeclosure-m2.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"

[permissions.codeclosure-m2.filesystem.":workspace_roots"]
"." = "write"
".codex" = "read"
".git" = "read"
".agents" = "read"
"AGENTS.md" = "read"

[permissions.codeclosure-m2.network]
enabled = false

[projects.${JSON.stringify(workspace)}]
trust_level = "untrusted"
`;
  writeFileSync(join(codexHome, 'config.toml'), config, { mode: 0o600 });
}

function threadStartResult(value, expected) {
  const result = object(value, 'thread/start result');
  const threadId = string(object(result['thread'], 'thread/start thread')['id'], 'Thread id');
  if (
    result['model'] !== expected.model ||
    result['modelProvider'] !== 'openai' ||
    result['approvalPolicy'] !== 'never' ||
    result['approvalsReviewer'] !== 'user' ||
    result['reasoningEffort'] !== 'low' ||
    realpathSync(string(result['cwd'], 'effective cwd')) !== realpathSync(expected.workspace)
  ) {
    fail('thread/start effective settings differ from the controlled request');
  }
  const sources = array(result['instructionSources'], 'instructionSources')
    .map((path) => realpathSync(string(path, 'instruction source')))
    .sort();
  if (JSON.stringify(sources) !== JSON.stringify([realpathSync(expected.instructionPath)])) {
    fail('thread/start instruction sources differ from the exact source manifest');
  }
  const sandbox = object(result['sandbox'], 'effective sandbox');
  if (sandbox['type'] !== 'workspaceWrite' || sandbox['networkAccess'] !== false) {
    fail('thread/start sandbox projection is not workspaceWrite without command network');
  }
  for (const root of array(sandbox['writableRoots'], 'sandbox writable roots')) {
    if (realpathSync(string(root, 'sandbox writable root')) !== realpathSync(expected.workspace)) {
      fail('thread/start contains an unbound writable root');
    }
  }
  return threadId;
}

function turnStartResult(value) {
  return string(
    object(object(value, 'turn/start result')['turn'], 'turn/start turn')['id'],
    'Turn id',
  );
}

function effectiveConfig(value, expected) {
  const config = object(object(value, 'config/read result')['config'], 'effective config');
  if (
    config['model'] !== expected.model ||
    config['model_provider'] !== 'openai' ||
    config['model_reasoning_effort'] !== 'low' ||
    config['web_search'] !== 'disabled' ||
    config['default_permissions'] !== 'codeclosure-m2' ||
    config['developer_instructions'] === 'POISON_SENTINEL'
  ) {
    fail('Poisoned project configuration widened the controlled effective config');
  }
  return Object.freeze({
    approvalPolicy: config['approval_policy'],
    model: config['model'],
    modelProvider: config['model_provider'],
    permissionProfile: config['default_permissions'],
    reasoningEffort: config['model_reasoning_effort'],
    webSearch: config['web_search'],
  });
}

function permissionProfile(value) {
  const data = array(object(value, 'permissionProfile/list result')['data'], 'permission profiles');
  const selected = data.find(
    (entry) => object(entry, 'permission profile')['id'] === 'codeclosure-m2',
  );
  if (
    selected === undefined ||
    object(selected, 'selected permission profile')['allowed'] !== true
  ) {
    fail('The controlled permission profile is unavailable');
  }
}

function terminalKey(threadId, turnId) {
  return `${String(threadId.length)}:${threadId}${turnId}`;
}

function projectTerminalTurn(notification) {
  if (notification.method !== 'turn/completed') {
    return undefined;
  }
  const threadId = string(notification.params['threadId'], 'terminal Thread id');
  const turn = object(notification.params['turn'], 'terminal Turn');
  const turnId = string(turn['id'], 'terminal Turn id');
  const status = string(turn['status'], 'terminal Turn status');
  return Object.freeze({ status, threadId, turnId });
}

function recordTerminalTurn(state, notification) {
  const terminal = projectTerminalTurn(notification);
  if (terminal === undefined) {
    return;
  }
  const key = terminalKey(terminal.threadId, terminal.turnId);
  if (state.seen.has(key)) {
    fail('Live fixture emitted a duplicate terminal Turn');
  }
  if (state.seen.size >= 8) {
    fail('Live fixture exceeded its bounded terminal-Turn lifecycle count');
  }
  state.seen.add(key);
  const waiter = state.waiters.get(key);
  if (waiter !== undefined) {
    state.waiters.delete(key);
    waiter(terminal);
    return;
  }
  if (state.values.size >= 8) {
    fail('Live fixture exceeded its bounded terminal-Turn cache');
  }
  state.values.set(key, terminal);
}

function terminalTurnPromise(state, threadId, turnId, timeoutMilliseconds) {
  const key = terminalKey(threadId, turnId);
  const existing = state.values.get(key);
  if (existing !== undefined) {
    state.values.delete(key);
    return Promise.resolve(existing);
  }
  return new Promise((resolveTerminal, rejectTerminal) => {
    const timer = setTimeout(() => {
      state.waiters.delete(key);
      rejectTerminal(new TypeError('Live fixture Turn did not complete within its bound'));
    }, timeoutMilliseconds);
    state.waiters.set(key, (terminal) => {
      clearTimeout(timer);
      resolveTerminal(terminal);
    });
  });
}

const authSource = resolve(requiredArgument('--auth-source'));
if (!lstatSync(authSource).isFile()) {
  fail('Auth source must be a regular file');
}
const model = argument('--model') ?? 'gpt-5.6-sol';
const root = mkdtempSync(join(tmpdir(), 'codeclosure-m2-slice1-live-'));
let client;
let failure;
let result;
try {
  const installation = verifyBundledCodexInstallation();
  const codexHome = join(root, 'codex-home');
  const stateRoot = join(root, 'codex-state');
  const workspace = join(root, 'candidate');
  const processHome = join(root, 'process-home');
  const processTemporary = join(root, 'process-tmp');
  for (const path of [codexHome, stateRoot, workspace, processHome, processTemporary]) {
    mkdirSync(path, { mode: 0o700 });
  }
  copyFileSync(authSource, join(codexHome, 'auth.json'));
  chmodSync(join(codexHome, 'auth.json'), 0o600);
  const instructionPath = join(workspace, 'AGENTS.md');
  writeFileSync(
    instructionPath,
    '# M2 Slice 1 live preflight\n\nDo not use tools. Return only the requested JSON.\n',
  );
  mkdirSync(join(workspace, '.codex'));
  writeFileSync(
    join(workspace, '.codex', 'config.toml'),
    'model = "poison-model"\nweb_search = "live"\ndeveloper_instructions = "POISON_SENTINEL"\n',
  );
  writeControlledConfig({
    codexHome,
    model,
    stateRoot,
    workspace: realpathSync(workspace),
  });
  const terminalState = { seen: new Set(), values: new Map(), waiters: new Map() };
  const launch = createControlledAppServerLaunch({
    codexHome,
    cwd: workspace,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    installation,
    processHome,
    temporaryDirectory: processTemporary,
  });
  client = await startAppServerClient({
    initialize: {
      capabilities: {
        experimentalApi: false,
        mcpServerOpenaiFormElicitation: false,
        requestAttestation: false,
      },
      clientInfo: { name: 'codeclosure_m2', title: 'CodeClosure M2', version: '0.0.0' },
    },
    launch,
    launchNonce: diagnosticDigest(
      { profile: 'm2-slice1-live-client', workspace: realpathSync(workspace) },
      'm2-slice1-live-launch-nonce-v1',
    ),
    onNotification: (notification) => recordTerminalTurn(terminalState, notification),
  });
  const requirements = await client.request('configRequirements/read', undefined, (value) =>
    object(value, 'configRequirements/read result'),
  );
  const config = await client.request(
    'config/read',
    { cwd: workspace, includeLayers: true },
    (value) => effectiveConfig(value, { model }),
  );
  const profiles = await client.request(
    'permissionProfile/list',
    { cwd: workspace },
    (value) => value,
  );
  permissionProfile(profiles);
  const threadId = await client.request(
    'thread/start',
    {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      config: {},
      cwd: workspace,
      developerInstructions:
        'This is a bounded CodeClosure protocol preflight. Do not use tools. Return the required JSON.',
      ephemeral: false,
      model,
      modelProvider: 'openai',
    },
    (value) => threadStartResult(value, { instructionPath, model, workspace }),
  );
  const turnId = await client.request(
    'turn/start',
    {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      effort: 'low',
      input: [
        {
          text: 'Return exactly the required JSON object. Do not call any tool.',
          text_elements: [],
          type: 'text',
        },
      ],
      outputSchema: {
        additionalProperties: false,
        properties: { probe: { const: 'slice1-live', type: 'string' } },
        required: ['probe'],
        type: 'object',
      },
      threadId,
    },
    turnStartResult,
    { timeoutMilliseconds: 90_000 },
  );
  const terminal = await terminalTurnPromise(terminalState, threadId, turnId, 180_000);
  if (terminal.status !== 'completed') {
    fail('Live fixture Turn did not complete successfully');
  }
  const stderr = client.stderrSummary();
  const close = await client.shutdown();
  if (close.code !== 0) {
    fail('Live App Server did not close cleanly');
  }
  result = Object.freeze({
    schemaVersion: 1,
    probe: 'codeclosure-m2-slice1-live-client',
    binary: Object.freeze({
      delegatedExecutablePath: installation.delegatedExecutablePath,
      launcherPath: installation.launcherPath,
      snapshotDigest: installation.profile.snapshotDigest,
      version: installation.profile.version,
    }),
    controlledInputs: Object.freeze({
      configDigest: diagnosticDigest(config, 'm2-slice1-effective-config-v1'),
      instructionSourcesExact: true,
      permissionProfile: 'codeclosure-m2',
      poisonedProjectConfigExcluded: true,
      requirementsDigest: diagnosticDigest(requirements, 'm2-slice1-requirements-v1'),
    }),
    lifecycle: Object.freeze({
      initialized: true,
      serverRequestCount: 0,
      threadStarted: true,
      turnStatus: terminal.status,
    }),
    diagnostics: Object.freeze({
      stderrCapturedBytes: stderr.capturedBytes,
      stderrDigest: stderr.digest,
      stderrPersisted: false,
      stderrTruncated: stderr.truncated,
    }),
    controlledStateRemovedAfterProbe: true,
  });
} catch (error) {
  failure = error;
} finally {
  if (client !== undefined) {
    try {
      await client.shutdown();
    } catch (error) {
      failure ??= error;
    }
  }
  try {
    rmSync(root, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  } catch (error) {
    failure ??= error;
  }
}
if (failure !== undefined) {
  throw failure;
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
