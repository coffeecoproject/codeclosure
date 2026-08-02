import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import test, { type TestContext } from 'node:test';

import {
  AppServerClientError,
  AppServerClientErrorCode,
  captureAppServerProcessIdentity,
  decodeEmptyObject,
  isJsonObject,
  serverRequestHandler,
  startAppServerClient,
  reconcileAppServerProcess,
  toProtocolJsonValue,
  type AppServerClient,
  type AppServerClientLimits,
  type AppServerNotification,
  type JsonObject,
  type JsonValue,
} from '@codeclosure/codex-app-server-client';
import {
  createFixtureAppServerLaunch,
  createSpawnFailureAppServerLaunch,
} from '@codeclosure/codex-app-server-client/testing';
import { parseBoundedJson } from '../src/strict-json.ts';

const fixtureScript = resolve(import.meta.dirname, 'fixtures', 'fake-app-server.mjs');
const fixtureLaunchNonce = `sha256:${'1'.repeat(64)}`;

interface FixtureHarness {
  readonly client: AppServerClient;
  readonly root: string;
}

function jsonObject(value: JsonValue): JsonObject {
  if (!isJsonObject(value)) {
    throw new TypeError('fixture result must be an object');
  }
  return value;
}

function boundedString(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) {
    throw new TypeError('fixture string is invalid');
  }
  return value;
}

function decodeThread(value: JsonValue): string {
  const thread = jsonObject(jsonObject(value)['thread'] ?? null)['id'];
  return boundedString(thread);
}

function decodeTurn(value: JsonValue): string {
  const turn = jsonObject(jsonObject(value)['turn'] ?? null)['id'];
  return boundedString(turn);
}

function fixtureDirectories(t: TestContext): {
  readonly codexHome: string;
  readonly cwd: string;
  readonly processHome: string;
  readonly root: string;
  readonly temporaryDirectory: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-app-server-client-test-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const codexHome = join(root, 'codex-home');
  const cwd = join(root, 'candidate');
  const processHome = join(root, 'process-home');
  const temporaryDirectory = join(root, 'process-tmp');
  for (const path of [codexHome, cwd, processHome, temporaryDirectory]) {
    mkdirSync(path);
  }
  return { codexHome, cwd, processHome, root, temporaryDirectory };
}

async function startFixture(
  t: TestContext,
  scenario: string,
  options: Readonly<{
    credentialEnvironment?: Readonly<Record<string, string>>;
    limits?: Partial<AppServerClientLimits>;
    onCompactionEvent?: Parameters<typeof startAppServerClient>[0]['onCompactionEvent'];
    onNotification?: (notification: AppServerNotification) => void;
    serverRequestHandlers?: Parameters<typeof startAppServerClient>[0]['serverRequestHandlers'];
  }> = {},
): Promise<FixtureHarness> {
  const directories = fixtureDirectories(t);
  const launch = createFixtureAppServerLaunch({
    ...directories,
    ...(options.credentialEnvironment === undefined
      ? {}
      : { credentialEnvironment: options.credentialEnvironment }),
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    scenario,
    scriptPath: fixtureScript,
  });
  const client = await startAppServerClient({
    initialize: {
      capabilities: {
        experimentalApi: false,
        mcpServerOpenaiFormElicitation: false,
        requestAttestation: false,
      },
      clientInfo: { name: 'codeclosure_test', title: 'CodeClosure test', version: '1' },
    },
    launch,
    launchNonce: fixtureLaunchNonce,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.onCompactionEvent === undefined
      ? {}
      : { onCompactionEvent: options.onCompactionEvent }),
    ...(options.onNotification === undefined ? {} : { onNotification: options.onNotification }),
    ...(options.serverRequestHandlers === undefined
      ? {}
      : { serverRequestHandlers: options.serverRequestHandlers }),
  });
  t.after(async () => {
    try {
      await client.shutdown();
    } catch {
      // Individual failure-path assertions own the expected client error.
    }
  });
  return { client, root: directories.root };
}

function isClientError(code: string): (error: unknown) => boolean {
  return (error) => error instanceof AppServerClientError && error.code === code;
}

void test('bounded JSON objects have no inherited fields and preserve __proto__ as data', () => {
  const value = parseBoundedJson(Buffer.from('{"__proto__":{"forged":true},"ordinary":"value"}'), {
    maximumCollectionEntries: 8,
    maximumDepth: 4,
    maximumNodes: 8,
  });
  assert.ok(isJsonObject(value));
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal(Reflect.get(value, 'constructor'), undefined);
  const prototypeData = value['__proto__'];
  assert.ok(isJsonObject(prototypeData));
  assert.equal(prototypeData['forged'], true);
});

void test('protocol JSON conversion preserves __proto__ as outbound data without prototype mutation', () => {
  const value = parseBoundedJson(Buffer.from('{"__proto__":{"forged":true},"ordinary":"value"}'), {
    maximumCollectionEntries: 8,
    maximumDepth: 4,
    maximumNodes: 8,
  });
  const converted = toProtocolJsonValue(value);
  if (typeof converted !== 'object' || converted === null || Array.isArray(converted)) {
    assert.fail('converted protocol fixture must be an object');
  }
  assert.equal(Object.getPrototypeOf(converted), Object.prototype);
  assert.equal(Object.hasOwn(converted, '__proto__'), true);
  assert.equal(JSON.stringify(converted), '{"__proto__":{"forged":true},"ordinary":"value"}');
});

void test('initialization, Thread/Turn, manual compaction, and later continuation share one bounded client', async (t) => {
  const compactionEvents: string[] = [];
  const notifications: string[] = [];
  const { client } = await startFixture(t, 'happy', {
    onCompactionEvent: (event) => compactionEvents.push(`${event.stage}:${event.source}`),
    onNotification: (notification) => notifications.push(notification.method),
  });
  assert.equal(client.initialization.platformFamily, 'fixture');
  const threadId = await client.request('thread/start', {}, decodeThread);
  const firstTurn = await client.request('turn/start', { input: [], threadId }, decodeTurn);
  assert.equal(firstTurn, 'turn-1');
  const compaction = await client.compactThread({ threadId });
  assert.deepEqual(compaction, {
    itemId: 'compaction-item-1',
    threadId,
    turnId: 'compaction-turn-1',
  });
  const secondTurn = await client.request('turn/start', { input: [], threadId }, decodeTurn);
  assert.equal(secondTurn, 'turn-2');
  assert.deepEqual(compactionEvents, ['STARTED:REQUESTED_MANUAL', 'COMPLETED:REQUESTED_MANUAL']);
  assert.ok(notifications.includes('item/started'));
  assert.ok(notifications.includes('item/completed'));
  const close = await client.shutdown();
  assert.equal(close.code, 0, JSON.stringify(close));
  assert.equal(close.requestedShutdown, true);
});

void test('a notification emitted immediately after initialized is post-handshake traffic', async (t) => {
  const notifications: string[] = [];
  const { client } = await startFixture(t, 'immediate-post-initialization-notification', {
    onNotification: (notification) => notifications.push(notification.method),
  });

  assert.equal(await client.request('thread/start', {}, decodeThread), 'thread-fixture');
  assert.equal(notifications[0], 'warning');
});

void test('a notification batched after the initialize response is post-response traffic', async (t) => {
  const notifications: string[] = [];
  const { client } = await startFixture(t, 'batched-post-initialization-notification', {
    onNotification: (notification) => notifications.push(notification.method),
  });

  assert.equal(client.initialization.platformFamily, 'fixture');
  assert.deepEqual(notifications, ['warning']);
});

void test('controlled launch ignores poisoned ambient environment and redacts secret values', async (t) => {
  const previousHome = process.env['HOME'];
  const previousPoison = process.env['CODECLOSURE_POISON_VALUE'];
  process.env['HOME'] = '/poisoned/ambient/home';
  process.env['CODECLOSURE_POISON_VALUE'] = 'must-not-enter-child';
  t.after(() => {
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    if (previousPoison === undefined) {
      delete process.env['CODECLOSURE_POISON_VALUE'];
    } else {
      process.env['CODECLOSURE_POISON_VALUE'] = previousPoison;
    }
  });
  const secret = 'fixture-secret-must-not-be-reported';
  const { client, root } = await startFixture(t, 'happy', {
    credentialEnvironment: { OPENAI_API_KEY: secret },
  });
  const observation = JSON.parse(client.initialization.userAgent) as {
    appServerArguments: string[];
    environmentNames: string[];
    home: string;
    poisonPresent: boolean;
    secretPresent: boolean;
  };
  assert.deepEqual(observation.appServerArguments, ['app-server', '--stdio', '--strict-config']);
  assert.equal(observation.home, realpathSync(join(root, 'process-home')));
  assert.equal(observation.poisonPresent, false);
  assert.equal(observation.secretPresent, true);
  assert.ok(!observation.environmentNames.includes('CODECLOSURE_POISON_VALUE'));
  assert.deepEqual(client.launchSummary.secretEnvironmentNames, ['OPENAI_API_KEY']);
  assert.deepEqual(client.launchSummary.nonSecretEnvironment, {
    CODEX_HOME: realpathSync(join(root, 'codex-home')),
    HOME: realpathSync(join(root, 'process-home')),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    TERM: 'dumb',
    TMPDIR: realpathSync(join(root, 'process-tmp')),
  });
  assert.ok(!JSON.stringify(client.launchSummary).includes(secret));
});

void test('credential environment names outside the selected allowlist fail before spawn', async (t) => {
  await assert.rejects(
    () =>
      startFixture(t, 'happy', {
        credentialEnvironment: { NODE_OPTIONS: '--require=/poisoned/module.cjs' },
      }),
    isClientError(AppServerClientErrorCode.INVALID_LAUNCH),
  );
});

void test('partial JSONL lines are reassembled before protocol decoding', async (t) => {
  const { client } = await startFixture(t, 'partial-lines');
  assert.equal(client.initialization.platformFamily, 'fixture');
});

for (const [scenario, code] of [
  ['pre-initialization-notification', AppServerClientErrorCode.INITIALIZATION_FAILED],
  ['prototype-injection', AppServerClientErrorCode.MALFORMED_RESPONSE],
  ['malformed-json', AppServerClientErrorCode.PROTOCOL_MALFORMED],
  ['duplicate-key', AppServerClientErrorCode.PROTOCOL_MALFORMED],
  ['empty-line', AppServerClientErrorCode.PROTOCOL_MALFORMED],
  ['oversized-line', AppServerClientErrorCode.PROTOCOL_LIMIT],
  ['oversized-collection', AppServerClientErrorCode.PROTOCOL_LIMIT],
  ['unexpected-eof', AppServerClientErrorCode.PROCESS_EXITED],
  ['nonzero-exit', AppServerClientErrorCode.PROCESS_EXITED],
  ['signal-exit', AppServerClientErrorCode.PROCESS_EXITED],
  ['request-timeout', AppServerClientErrorCode.REQUEST_TIMEOUT],
] as const) {
  void test(`initialization fails closed for ${scenario}`, async (t) => {
    const limits = {
      initializationTimeoutMilliseconds: 500,
      maximumBufferedStdoutBytes: 1_024,
      maximumCollectionEntries: 8,
      maximumProtocolLineBytes: 1_024,
      shutdownGraceMilliseconds: 100,
      shutdownKillMilliseconds: 100,
    };
    await assert.rejects(() => startFixture(t, scenario, { limits }), isClientError(code));
  });
}

void test('stderr is hashed and truncated without becoming protocol input', async (t) => {
  const { client } = await startFixture(t, 'stderr', { limits: { maximumStderrBytes: 128 } });
  const summary = client.stderrSummary();
  assert.equal(summary.capturedBytes, 128);
  assert.equal(summary.truncated, true);
  assert.match(summary.digest, /^sha256:[0-9a-f]{64}$/u);
});

void test('spawn failure is distinct from a protocol or backend response', async (t) => {
  const directories = fixtureDirectories(t);
  const launch = createSpawnFailureAppServerLaunch(
    {
      ...directories,
      executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    },
    join(directories.root, 'missing-app-server-executable'),
  );
  await assert.rejects(
    () =>
      startAppServerClient({
        initialize: {
          capabilities: {
            experimentalApi: false,
            mcpServerOpenaiFormElicitation: false,
            requestAttestation: false,
          },
          clientInfo: { name: 'codeclosure_test', title: null, version: '1' },
        },
        launch,
        launchNonce: fixtureLaunchNonce,
        limits: { shutdownGraceMilliseconds: 50, shutdownKillMilliseconds: 50 },
      }),
    isClientError(AppServerClientErrorCode.SPAWN_FAILED),
  );
});

void test('a verified executable that changes before spawn fails closed', async (t) => {
  const directories = fixtureDirectories(t);
  const executablePath = join(directories.root, 'mutable-codex-fixture');
  writeFileSync(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const launch = createFixtureAppServerLaunch({
    ...directories,
    executablePath,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    scenario: 'happy',
    scriptPath: fixtureScript,
  });
  writeFileSync(executablePath, '#!/bin/sh\nexit 7\n');
  await assert.rejects(
    () =>
      startAppServerClient({
        initialize: {
          capabilities: {
            experimentalApi: false,
            mcpServerOpenaiFormElicitation: false,
            requestAttestation: false,
          },
          clientInfo: { name: 'codeclosure_test', title: null, version: '1' },
        },
        launch,
        launchNonce: fixtureLaunchNonce,
      }),
    isClientError(AppServerClientErrorCode.VERSION_MISMATCH),
  );
});

void test('an unavailable verified executable retains the version-mismatch classification', async (t) => {
  const directories = fixtureDirectories(t);
  const executablePath = join(directories.root, 'removed-codex-fixture');
  writeFileSync(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const launch = createFixtureAppServerLaunch({
    ...directories,
    executablePath,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    scenario: 'happy',
    scriptPath: fixtureScript,
  });
  rmSync(executablePath);
  await assert.rejects(
    () =>
      startAppServerClient({
        initialize: {
          capabilities: {
            experimentalApi: false,
            mcpServerOpenaiFormElicitation: false,
            requestAttestation: false,
          },
          clientInfo: { name: 'codeclosure_test', title: null, version: '1' },
        },
        launch,
        launchNonce: fixtureLaunchNonce,
      }),
    isClientError(AppServerClientErrorCode.VERSION_MISMATCH),
  );
});

void test('process exit rejects every concurrent pending request with one terminal class', async (t) => {
  const { client } = await startFixture(t, 'pending-process-exit');
  const decoder = (value: JsonValue): JsonObject => jsonObject(value);
  const outcomes = await Promise.allSettled([
    client.request('model/list', {}, decoder),
    client.request('permissionProfile/list', {}, decoder),
  ]);
  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, 'rejected');
    assert.ok(isClientError(AppServerClientErrorCode.PROCESS_EXITED)(outcome.reason));
  }
});

void test('reordered responses remain correlated to their exact requests', async (t) => {
  const { client } = await startFixture(t, 'reordered-responses');
  const decodeObservedMethod = (value: JsonValue): string =>
    boundedString(jsonObject(value)['observedMethod']);
  const [models, profiles] = await Promise.all([
    client.request('model/list', {}, decodeObservedMethod),
    client.request('permissionProfile/list', {}, decodeObservedMethod),
  ]);
  assert.equal(models, 'model/list');
  assert.equal(profiles, 'permissionProfile/list');
});

for (const scenario of [
  'duplicate-response',
  'conflicting-response',
  'unknown-response',
] as const) {
  void test(`${scenario} terminates correlation instead of inventing completion`, async (t) => {
    const { client } = await startFixture(t, scenario);
    const request = client.request('thread/start', {}, decodeThread);
    if (scenario === 'duplicate-response') {
      await request;
    } else {
      await assert.rejects(request);
    }
    const close = await client.closed;
    const permittedFailureCodes: readonly string[] = [
      AppServerClientErrorCode.PROTOCOL_CORRELATION,
      AppServerClientErrorCode.PROTOCOL_MALFORMED,
    ];
    assert.ok(
      permittedFailureCodes.includes(close.failureCode ?? AppServerClientErrorCode.SHUTDOWN),
    );
  });
}

void test('an unknown server request receives a closed error and terminates the client', async (t) => {
  const { client } = await startFixture(t, 'unknown-server-request');
  await assert.rejects(
    client.request('thread/start', {}, decodeThread),
    isClientError(AppServerClientErrorCode.UNSUPPORTED_SERVER_REQUEST),
  );
});

void test('a registered server request is decoded and answered exactly once', async (t) => {
  let calls = 0;
  const handler = serverRequestHandler({
    decodeParams: (value) => {
      const params = jsonObject(value);
      return {
        command: boundedString(params['command']),
        environmentId: null,
        itemId: boundedString(params['itemId']),
        startedAtMs: Number(params['startedAtMs']),
        threadId: boundedString(params['threadId']),
        turnId: boundedString(params['turnId']),
      };
    },
    handle: () => {
      calls += 1;
      return Object.freeze({ decision: 'decline' });
    },
    method: 'item/commandExecution/requestApproval',
  });
  const { client } = await startFixture(t, 'known-server-request', {
    serverRequestHandlers: [handler],
  });
  assert.equal(await client.request('thread/start', {}, decodeThread), 'thread-fixture');
  assert.equal(calls, 1);
});

void test('experimental or unselected methods are rejected without wire traffic', async (t) => {
  const { client } = await startFixture(t, 'happy');
  const request = client.request(
    // @ts-expect-error -- this negative fixture proves turn/steer is outside the selected API.
    'turn/steer',
    { input: [], threadId: 'thread-fixture' },
    jsonObject,
  );
  await assert.rejects(request, isClientError(AppServerClientErrorCode.UNSUPPORTED_METHOD));
  assert.equal(await client.request('thread/start', {}, decodeThread), 'thread-fixture');
});

void test('a connection cannot perform initialize twice', async (t) => {
  const { client } = await startFixture(t, 'happy');
  await assert.rejects(
    () => client.initialize(),
    isClientError(AppServerClientErrorCode.INITIALIZATION_FAILED),
  );
  await assert.rejects(
    client.request(
      // @ts-expect-error -- runtime validation must also exclude the handshake method.
      'initialize',
      {
        capabilities: {
          experimentalApi: false,
          mcpServerOpenaiFormElicitation: false,
          requestAttestation: false,
        },
        clientInfo: { name: 'bypass_attempt', title: null, version: '1' },
      },
      jsonObject,
    ),
    isClientError(AppServerClientErrorCode.UNSUPPORTED_METHOD),
  );
  assert.equal(await client.request('thread/start', {}, decodeThread), 'thread-fixture');
});

void test('host cancellation terminates the in-flight request without sending a hidden retry', async (t) => {
  const { client } = await startFixture(t, 'host-cancel');
  const controller = new AbortController();
  const request = client.request('thread/start', {}, decodeThread, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, isClientError(AppServerClientErrorCode.HOST_CANCELLED));
  const close = await client.closed;
  assert.equal(close.failureCode, AppServerClientErrorCode.HOST_CANCELLED);
});

void test('turn interruption sends only turn/interrupt and does not infer success', async (t) => {
  let trace: string[] = [];
  let resolveTrace!: () => void;
  const traceReady = new Promise<void>((resolve) => {
    resolveTrace = resolve;
  });
  const { client } = await startFixture(t, 'interrupt', {
    onNotification: (notification) => {
      if (notification.method === 'warning') {
        const message = notification.params['message'];
        if (typeof message === 'string') {
          trace = (JSON.parse(message) as { requests: string[] }).requests;
          resolveTrace();
        }
      }
    },
  });
  const threadId = await client.request('thread/start', {}, decodeThread);
  const turnId = await client.request('turn/start', { input: [], threadId }, decodeTurn);
  await client.interruptTurn({ threadId, turnId });
  let traceTimer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      traceReady,
      new Promise<never>((_, reject) => {
        traceTimer = setTimeout(() => reject(new Error('fixture trace timed out')), 1_000);
        traceTimer.unref();
      }),
    ]);
  } finally {
    clearTimeout(traceTimer);
  }
  assert.deepEqual(trace, ['thread/start', 'turn/start', 'turn/interrupt']);
});

void test('a caller response decoder failure terminates the protocol session', async (t) => {
  const { client } = await startFixture(t, 'happy');
  await assert.rejects(
    client.request('thread/start', {}, () => {
      throw new TypeError('fixture decoder rejection');
    }),
    isClientError(AppServerClientErrorCode.MALFORMED_RESPONSE),
  );
});

void test('unknown notification methods fail closed', async (t) => {
  const { client } = await startFixture(t, 'unknown-notification');
  await assert.rejects(
    client.request('thread/start', {}, decodeThread),
    isClientError(AppServerClientErrorCode.PROTOCOL_MALFORMED),
  );
});

void test('unfinished compaction lifecycles are bounded', async (t) => {
  const { client } = await startFixture(t, 'compaction-flood', {
    limits: { maximumObservedCompactions: 2 },
  });
  await Promise.allSettled([client.request('thread/start', {}, decodeThread)]);
  const close = await client.closed;
  assert.equal(close.failureCode, AppServerClientErrorCode.PROTOCOL_LIMIT);
});

void test('completed compaction lifecycles release their bounded slot', async (t) => {
  const { client } = await startFixture(t, 'happy', {
    limits: { maximumObservedCompactions: 1 },
  });
  const threadId = await client.request('thread/start', {}, decodeThread);
  await client.compactThread({ threadId });
  await client.compactThread({ threadId });
  assert.equal((await client.shutdown()).failureCode, undefined);
});

void test('manual compactions are bounded before lifecycle observation begins', async (t) => {
  const acknowledgementResolvers: (() => void)[] = [];
  const nextAcknowledgement = (): Promise<void> =>
    new Promise((resolveAcknowledgement) => {
      acknowledgementResolvers.push(resolveAcknowledgement);
    });
  const { client } = await startFixture(t, 'compaction-response-only', {
    limits: {
      manualCompactionTimeoutMilliseconds: 5_000,
      maximumPendingManualCompactions: 2,
    },
    onNotification: (notification) => {
      if (
        notification.method === 'warning' &&
        typeof notification.params['message'] === 'string' &&
        notification.params['message'].startsWith('compaction-response-only:')
      ) {
        acknowledgementResolvers.shift()?.();
      }
    },
  });

  const firstAcknowledgement = nextAcknowledgement();
  const first = client.compactThread({ threadId: 'thread-manual-1' });
  first.catch(() => undefined);
  await firstAcknowledgement;

  const secondAcknowledgement = nextAcknowledgement();
  const second = client.compactThread({ threadId: 'thread-manual-2' });
  second.catch(() => undefined);
  await secondAcknowledgement;

  await assert.rejects(
    client.compactThread({ threadId: 'thread-manual-3' }),
    isClientError(AppServerClientErrorCode.PROTOCOL_LIMIT),
  );
  await client.shutdown();
  for (const outcome of await Promise.allSettled([first, second])) {
    assert.equal(outcome.status, 'rejected');
    assert.ok(isClientError(AppServerClientErrorCode.SHUTDOWN)(outcome.reason));
  }
});

void test('bounded shutdown escalates only against the owned child process', async (t) => {
  const { client } = await startFixture(t, 'shutdown-hang', {
    limits: { shutdownGraceMilliseconds: 50, shutdownKillMilliseconds: 50 },
  });
  const close = await client.shutdown();
  assert.equal(close.requestedShutdown, true);
  assert.equal(close.signal, 'SIGKILL');
});

void test('restart reconciliation terminates only the exact persisted process group', (t) => {
  if (process.platform === 'win32') {
    t.skip('The bounded M2 process-group profile is POSIX-only');
    return;
  }
  const helper = spawnSync(
    process.execPath,
    [
      '-e',
      [
        "const { spawn } = require('node:child_process');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });",
        'child.unref();',
        'process.stdout.write(String(child.pid));',
      ].join(' '),
    ],
    { encoding: 'utf8', timeout: 5_000 },
  );
  assert.equal(helper.status, 0, helper.stderr);
  const processId = Number.parseInt(helper.stdout.trim(), 10);
  assert.equal(Number.isSafeInteger(processId) && processId > 0, true);
  const identity = captureAppServerProcessIdentity({
    processId,
    launchNonce: fixtureLaunchNonce,
    executableIdentityDigest: `sha256:${'2'.repeat(64)}`,
    controlledStateRootIdentity: '/fixture/restart-controlled-state',
  });
  t.after(() => {
    try {
      process.kill(-processId, 'SIGKILL');
    } catch {
      // Exact reconciliation normally removes the group before cleanup.
    }
  });

  assert.deepEqual(
    reconcileAppServerProcess({ ...identity, processStartIdentity: 'forged-start-identity' }),
    { schemaVersion: 1, disposition: 'IDENTITY_MISMATCH' },
  );
  assert.doesNotThrow(() => process.kill(processId, 0));
  assert.deepEqual(
    reconcileAppServerProcess(identity, {
      gracefulMilliseconds: 1_500,
      killMilliseconds: 1_500,
    }),
    { schemaVersion: 1, disposition: 'TERMINATED' },
  );
});

void test('empty-object response decoder rejects widened results', () => {
  assert.deepEqual(decodeEmptyObject(Object.freeze({})), {});
  assert.throws(() => decodeEmptyObject(Object.freeze({ widened: true })));
});
