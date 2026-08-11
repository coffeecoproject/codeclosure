import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M251_CANDIDATE_FREE_DENIED_BOUNDARIES,
  m251LiveContainmentDigest,
  projectM251CandidateFreeContainmentProbe,
} from './m2.5.1-live-containment-lib.mjs';
import {
  m251LiveContainmentFailureReasonCode,
  runM251LiveContainmentProbe,
} from './m2.5.1-live-containment-probe.mjs';

function fixture(overrides = {}) {
  const cwd = '/assessment/project-read/snapshot';
  const command = Object.freeze(['/bin/sh', '-c', 'exit 0']);
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
      executeBufferedSandboxCommand: async (commandInput) => {
        state.requests.push(
          Object.freeze({ method: 'executeBufferedSandboxCommand', params: commandInput }),
        );
        if (overrides.commandRequestError !== undefined) {
          throw overrides.commandRequestError;
        }
        if (overrides.forbiddenEffect === true) {
          clientInput.onNotification({
            method: overrides.forbiddenEffectMethod ?? 'item/started',
            params: {},
          });
        }
        return {
          request: overrides.returnedCommandRequest ?? {
            command: commandInput.command,
            cwd: commandInput.cwd,
            outputBytesCap: 1_024,
            sandboxPolicy:
              commandInput.sandboxKind === 'READ_ONLY'
                ? { networkAccess: false, type: 'readOnly' }
                : {
                    excludeSlashTmp: true,
                    excludeTmpdirEnvVar: true,
                    networkAccess: false,
                    type: 'workspaceWrite',
                    writableRoots: [commandInput.cwd],
                  },
            timeoutMs: commandInput.timeoutMilliseconds,
          },
          response: {
            exitCode: overrides.commandExitCode ?? 0,
            stderr: overrides.commandStderr ?? '',
            stdout: overrides.commandStdout ?? '',
          },
        };
      },
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
        throw new TypeError(`Unexpected fixture request: ${method}`);
      },
      shutdown: async () => overrides.shutdown ?? { code: 0 },
    }),
    terminalTimeoutMilliseconds: 100,
  };
  return { input, state };
}

test('projects one exact direct sandbox command into containment metadata', async () => {
  const { input, state } = fixture();
  const result = await runM251LiveContainmentProbe(input);

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
      'executeBufferedSandboxCommand',
    ],
  );
  assert.deepEqual(state.requests.at(-1)?.params, {
    command: input.command,
    cwd: input.cwd,
    sandboxKind: 'READ_ONLY',
    timeoutMilliseconds: input.terminalTimeoutMilliseconds,
  });
});

test('binds the same lower-client proof path to the distinct PLAN phase entry', async () => {
  const { input, state } = fixture({ phase: 'PLAN' });
  const result = await runM251LiveContainmentProbe(input);

  assert.equal(result.phase, 'PLAN');
  assert.equal(result.phaseEntryDigest, input.phaseEntryDigest);
  assert.equal(result.isolationProfileDigest, input.phaseEntry.isolationProfileDigest);
  assert.equal(state.configurationAssertionCount, 2);
  assert.equal(state.shutdownObserved, true);
});

test('classifies a successful denied-boundary open without retaining its path', async () => {
  const { input, state } = fixture({ commandExitCode: 50 });

  await assert.rejects(runM251LiveContainmentProbe(input), (error) => {
    assert.equal(
      m251LiveContainmentFailureReasonCode(error),
      `DENIED_BOUNDARY_READ_SUCCEEDED_${M251_CANDIDATE_FREE_DENIED_BOUNDARIES[0]}`,
    );
    assert.equal('path' in error, false);
    return true;
  });
  assert.equal(state.shutdownObserved, true);
});

test('classifies a rejected command request without retaining the server message', async () => {
  const requestError = Object.assign(new Error('non-sensitive fixture server message'), {
    code: 'REQUEST_REJECTED',
    detail: { method: 'command/exec', protocolCode: -32_602 },
  });
  const { input, state } = fixture({ commandRequestError: requestError });

  await assert.rejects(runM251LiveContainmentProbe(input), (error) => {
    assert.equal(
      m251LiveContainmentFailureReasonCode(error),
      'COMMAND_REQUEST_REQUEST_REJECTED_PROTOCOL_NEG_32602',
    );
    assert.equal(error.message.includes('fixture server message'), false);
    return true;
  });
  assert.equal(state.shutdownObserved, true);
});

test('rejects a substituted lower-client command request', async () => {
  const { input, state } = fixture({
    returnedCommandRequest: {
      command: ['/bin/sh', '-c', 'exit 0'],
      cwd: '/assessment/project-read/snapshot',
      outputBytesCap: 1_024,
      sandboxPolicy: { type: 'dangerFullAccess' },
      timeoutMs: 100,
    },
  });

  await assert.rejects(runM251LiveContainmentProbe(input), (error) => {
    assert.equal(m251LiveContainmentFailureReasonCode(error), 'COMMAND_REQUEST_MISMATCH');
    return true;
  });
  assert.equal(state.shutdownObserved, true);
});

test('rejects substitution of the exact permission profile', async () => {
  const { input, state } = fixture({
    permissionProfile: { allowed: true, id: 'permission_read_only_v1', substituted: true },
  });

  await assert.rejects(
    runM251LiveContainmentProbe(input),
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
    runM251LiveContainmentProbe(input),
    /Effective Thread differs from the exact phase isolation input/u,
  );
  assert.equal(state.shutdownObserved, true);
});

test('retains an unexpected direct-command item so the policy projection fails closed', async () => {
  const { input } = fixture({
    forbiddenEffect: true,
  });
  const result = await runM251LiveContainmentProbe(input);

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

test('rejects retained direct-command output without exposing it', async () => {
  const { input, state } = fixture({ commandStdout: 'non-sensitive fixture output' });

  await assert.rejects(runM251LiveContainmentProbe(input), (error) => {
    assert.equal(m251LiveContainmentFailureReasonCode(error), 'COMMAND_OUTPUT_RETAINED');
    assert.equal(error.message.includes('fixture output'), false);
    return true;
  });
  assert.equal(state.shutdownObserved, true);
});

test('reports an unclean controlled-process shutdown without changing probe evidence', async () => {
  const { input, state } = fixture({ shutdown: { code: 1, failureCode: 'EXITED_NON_ZERO' } });
  const result = await runM251LiveContainmentProbe(input);

  assert.equal(result.phase, 'DISCOVERY');
  assert.equal(state.shutdownObserved, false);
});
