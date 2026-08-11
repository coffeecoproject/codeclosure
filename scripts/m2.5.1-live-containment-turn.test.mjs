import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M251_CANDIDATE_FREE_DENIED_BOUNDARIES,
  m251LiveContainmentDigest,
  projectM251CandidateFreeContainmentProbe,
} from './m2.5.1-live-containment-lib.mjs';
import { runM251LiveContainmentTurn } from './m2.5.1-live-containment-turn.mjs';

function fixture(overrides = {}) {
  const cwd = '/assessment/project-read/snapshot';
  const command = "/bin/sh -c 'exit 0'";
  const phase = overrides.phase ?? 'DISCOVERY';
  const permissionProfile = Object.freeze({ allowed: true, id: 'permission_read_only_v1' });
  const requirements = Object.freeze({ allowed: Object.freeze(['bounded']) });
  const digestCanonical = (value) => m251LiveContainmentDigest('fixture-canonical-v1', value);
  const state = {
    configurationAssertionCount: 0,
    requests: [],
    shutdownObserved: undefined,
  };
  const input = {
    assertM251EffectiveConfiguration: (configuration, expected) => {
      assert.deepEqual(configuration, { exact: true });
      assert.equal(expected.executionConfigDigest, 'sha256:'.concat('1'.repeat(64)));
      state.configurationAssertionCount += 1;
    },
    command,
    cwd,
    deniedBoundaries: Object.freeze(
      M251_CANDIDATE_FREE_DENIED_BOUNDARIES.map((kind, index) =>
        Object.freeze({
          kind,
          pathDigest: m251LiveContainmentDigest('fixture-denied-path-v1', index),
        }),
      ),
    ),
    digestCanonical,
    expectedSandboxType: 'readOnly',
    launch: Object.freeze({ executablePath: '/fixture/codex' }),
    launchNonce: m251LiveContainmentDigest('fixture-launch-nonce-v1', phase),
    onShutdown: (clean) => {
      state.shutdownObserved = clean;
    },
    phaseEntry: Object.freeze({
      executionConfigDigest: 'sha256:'.concat('1'.repeat(64)),
      isolationProfileDigest: 'sha256:'.concat('2'.repeat(64)),
      isolationProfileId: 'isolation_read_only_v1',
      permissionProfileDigest: digestCanonical(permissionProfile),
      permissionProfileId: permissionProfile.id,
      phase,
    }),
    phaseEntryDigest: 'sha256:'.concat('3'.repeat(64)),
    receiptSandboxType: 'READ_ONLY',
    serverRequestHandler: (handler) => handler,
    sharedProfile: Object.freeze({
      managedRequirementsDigest: digestCanonical(requirements),
      model: 'gpt-5.6-sol',
      modelProvider: 'openai',
      reasoningEffort: 'high',
      serviceTier: 'priority',
    }),
    startAppServerClient: async (clientInput) => ({
      request: async (method, params) => {
        state.requests.push(Object.freeze({ method, params }));
        if (method === 'configRequirements/read') {
          return requirements;
        }
        if (method === 'config/read') {
          return { exact: true };
        }
        if (method === 'permissionProfile/list') {
          return {
            data: [overrides.permissionProfile ?? permissionProfile],
            nextCursor: null,
          };
        }
        if (method === 'thread/start') {
          return {
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            cwd,
            instructionSources: [],
            model: 'gpt-5.6-sol',
            modelProvider: 'openai',
            reasoningEffort: 'high',
            sandbox: overrides.effectiveSandbox ?? { networkAccess: false, type: 'readOnly' },
            serviceTier: 'priority',
            thread: { id: 'thread_fixture' },
          };
        }
        if (method === 'turn/start') {
          clientInput.onNotification({
            method: 'item/completed',
            params: {
              item: {
                aggregatedOutput: '',
                command: overrides.observedCommand ?? command,
                commandActions: [],
                cwd,
                exitCode: 0,
                id: 'item_fixture',
                pluginId: null,
                scriptPath: null,
                source: 'agent',
                status: 'completed',
                type: 'commandExecution',
              },
              threadId: overrides.observedThreadId ?? 'thread_fixture',
              turnId: 'turn_fixture',
            },
          });
          if (overrides.forbiddenEffect === true) {
            clientInput.onNotification({
              method: overrides.forbiddenEffectMethod ?? 'item/completed',
              params: {
                item: {
                  id: 'effect_fixture',
                  type: overrides.forbiddenEffectType ?? 'fileChange',
                },
                threadId: 'thread_fixture',
                turnId: 'turn_fixture',
              },
            });
          }
          clientInput.onNotification({
            method: 'turn/completed',
            params: {
              ...(overrides.omitTerminalThreadId === true
                ? {}
                : { threadId: overrides.terminalThreadId ?? 'thread_fixture' }),
              turn: {
                completedAt: 2,
                durationMs: 1_000,
                error: null,
                id: 'turn_fixture',
                items: [],
                itemsView: 'full',
                ...(overrides.legacyNestedTerminalThreadId === true
                  ? { threadId: 'thread_fixture' }
                  : {}),
                startedAt: 1,
                status: 'completed',
              },
            },
          });
          return { turn: { id: 'turn_fixture' } };
        }
        throw new TypeError(`Unexpected fixture request: ${method}`);
      },
      shutdown: async () => overrides.shutdown ?? { code: 0 },
    }),
    terminalTimeoutMilliseconds: 100,
  };
  return { input, state };
}

test('projects one exact completed lower-client Turn into containment metadata', async () => {
  const { input, state } = fixture();
  const result = await runM251LiveContainmentTurn(input);

  assert.equal(result.phase, 'DISCOVERY');
  assert.equal(result.commandExitCode, 0);
  assert.equal(result.commandOutputBytes, 0);
  assert.equal(result.forbiddenEffectCount, 0);
  assert.equal(result.approvalRequestCount, 0);
  assert.equal(state.configurationAssertionCount, 2);
  assert.equal(state.shutdownObserved, true);
  assert.deepEqual(
    state.requests.map(({ method }) => method),
    [
      'configRequirements/read',
      'config/read',
      'permissionProfile/list',
      'thread/start',
      'config/read',
      'turn/start',
    ],
  );
});

test('binds the same lower-client proof path to the distinct PLAN phase entry', async () => {
  const { input, state } = fixture({ phase: 'PLAN' });
  const result = await runM251LiveContainmentTurn(input);

  assert.equal(result.phase, 'PLAN');
  assert.equal(result.phaseEntryDigest, input.phaseEntryDigest);
  assert.equal(result.isolationProfileDigest, input.phaseEntry.isolationProfileDigest);
  assert.equal(state.configurationAssertionCount, 2);
  assert.equal(state.shutdownObserved, true);
});

test('rejects a substituted command and still shuts down the controlled client', async () => {
  const { input, state } = fixture({ observedCommand: "/bin/sh -c 'true'" });

  await assert.rejects(
    runM251LiveContainmentTurn(input),
    /command was substituted, failed, or retained output/u,
  );
  assert.equal(state.shutdownObserved, true);
});

test('rejects a command Item that is not bound to the started Thread', async () => {
  const { input, state } = fixture({ observedThreadId: 'thread_substituted' });

  await assert.rejects(
    runM251LiveContainmentTurn(input),
    /command was substituted, failed, or retained output/u,
  );
  assert.equal(state.shutdownObserved, true);
});

test('rejects a terminal notification bound to another Thread', async () => {
  const { input, state } = fixture({ terminalThreadId: 'thread_substituted' });

  await assert.rejects(
    runM251LiveContainmentTurn(input),
    /did not produce one completed command and terminal Turn/u,
  );
  assert.equal(state.shutdownObserved, true);
});

test('rejects the legacy nested terminal Thread ID when the protocol field is absent', async () => {
  const { input, state } = fixture({
    legacyNestedTerminalThreadId: true,
    omitTerminalThreadId: true,
  });

  await assert.rejects(
    runM251LiveContainmentTurn(input),
    /Terminal Turn lacks exact Thread\/Turn identity/u,
  );
  assert.equal(state.shutdownObserved, true);
});

test('rejects substitution of the exact permission profile', async () => {
  const { input, state } = fixture({
    permissionProfile: { allowed: true, id: 'permission_read_only_v1', substituted: true },
  });

  await assert.rejects(
    runM251LiveContainmentTurn(input),
    /exact phase permission profile is unavailable/u,
  );
  assert.equal(state.shutdownObserved, true);
});

test('rejects widening of the effective Thread sandbox', async () => {
  const { input, state } = fixture({
    effectiveSandbox: {
      excludeSlashTmp: true,
      networkAccess: false,
      type: 'readOnly',
      writableRoots: [],
    },
  });

  await assert.rejects(
    runM251LiveContainmentTurn(input),
    /Effective Thread differs from the exact phase isolation input/u,
  );
  assert.equal(state.shutdownObserved, true);
});

test('retains a started unknown effect so the policy projection fails closed', async () => {
  const { input } = fixture({
    forbiddenEffect: true,
    forbiddenEffectMethod: 'item/started',
    forbiddenEffectType: 'futureExternalEffect',
  });
  const result = await runM251LiveContainmentTurn(input);

  assert.equal(result.forbiddenEffectCount, 1);
  assert.throws(
    () =>
      projectM251CandidateFreeContainmentProbe({
        common: result,
        selectedReadPathDigest: m251LiveContainmentDigest('selected-read-path-v1', 'package.json'),
        selectedReadSucceeded: true,
        snapshotClosingDigest: 'sha256:'.concat('4'.repeat(64)),
        snapshotOpeningDigest: 'sha256:'.concat('4'.repeat(64)),
        snapshotWriteDenied: true,
      }),
    /did not close under the exact isolation policy/u,
  );
});

test('reports an unclean controlled-process shutdown without changing Turn evidence', async () => {
  const { input, state } = fixture({ shutdown: { code: 1, failureCode: 'EXITED_NON_ZERO' } });
  const result = await runM251LiveContainmentTurn(input);

  assert.equal(result.phase, 'DISCOVERY');
  assert.equal(state.shutdownObserved, false);
});
