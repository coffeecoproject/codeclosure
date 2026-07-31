import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  CandidateGenerationState,
  attemptId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  decodeCandidateGeneration,
  decodeVerificationObligation,
  goalId,
  goalRevision,
  evidenceId,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  successCriterionId,
  verificationObligationId,
  workflowId,
  workflowVersion,
} from '@codeclosure/domain';
import {
  CandidateWorkspaceAccessMode,
  CanonicalJsonSha256DigestProvider,
  candidateWorkspaceAllowedPathProjection,
  candidateWorkspaceLeaseProjection,
  createLocalCommandCheckSpecification,
  decodeCandidateWorkspaceLease,
  decodeLocalCommandVerificationResult,
  digestCandidateWorkspaceValue,
  executeLocalCommandVerification,
  localCommandEnvironmentDigest,
  type CandidateWorkspaceLease,
  type LocalCommandEnvironmentVariable,
  type LocalCommandVerificationRequest,
} from '@codeclosure/runtime';
import {
  DARWIN_SEATBELT_PROFILE_ID,
  LOCAL_COMMAND_RUNNER_IDENTITY,
  LOCAL_COMMAND_RUNNER_VERSION,
  createDarwinSeatbeltIsolation,
  createLocalCommandVerificationRunner,
  darwinSeatbeltProfileDigest,
} from '@codeclosure/verification-local';

const digests = new CanonicalJsonSha256DigestProvider();
const timestamp = isoTimestamp('2026-07-31T00:00:00.000Z');
const emptyEnvironment = Object.freeze([]) satisfies readonly LocalCommandEnvironmentVariable[];

function bytesDigest(path: string): ReturnType<typeof sha256Digest> {
  return sha256Digest(`sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
}

interface Fixture {
  readonly candidateRoot: string;
  readonly authorityRoot: string;
  readonly credentialRoot: string;
  readonly runRoot: string;
  readonly lease: CandidateWorkspaceLease;
  readonly generation: ReturnType<typeof decodeCandidateGeneration>;
}

function fixture(t: TestContext): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-verification-local-')));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const workspaceRoot = join(root, 'workspace');
  const candidateRoot = join(workspaceRoot, 'candidate');
  const sourceRoot = join(root, 'source');
  const authorityRoot = join(root, 'authority');
  const credentialRoot = join(root, 'credentials');
  const runRoot = join(root, 'runs');
  for (const path of [
    workspaceRoot,
    candidateRoot,
    sourceRoot,
    authorityRoot,
    credentialRoot,
    runRoot,
  ]) {
    mkdirSync(path, { mode: 0o700 });
  }
  writeFileSync(join(candidateRoot, 'fixture.txt'), 'needle\n', { mode: 0o400 });
  writeFileSync(join(authorityRoot, 'control.sqlite'), 'authority-secret\n', { mode: 0o600 });
  writeFileSync(join(credentialRoot, 'token'), 'credential-secret\n', { mode: 0o600 });
  const candidateDigest = bytesDigest(join(candidateRoot, 'fixture.txt'));
  const generation = decodeCandidateGeneration({
    id: candidateGenerationId('generation_verification-local'),
    candidateId: candidateId('candidate_verification-local'),
    sequence: 1,
    workspaceIdentity: workspaceRoot,
    state: CandidateGenerationState.FROZEN,
    baseDigest: candidateDigest,
    frozenDigest: candidateDigest,
    version: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    frozenAt: timestamp,
  });
  const allowedPaths = Object.freeze(['fixture.txt']);
  const withoutDigest = Object.freeze({
    accessMode: CandidateWorkspaceAccessMode.READ_ONLY,
    allowedPathPolicyDigest: digestCandidateWorkspaceValue(
      candidateWorkspaceAllowedPathProjection(allowedPaths),
    ),
    allowedPaths,
    candidateId: generation.candidateId,
    candidateDigest,
    candidateGenerationId: generation.id,
    candidateGenerationVersion: generation.version,
    forbiddenRoots: Object.freeze([authorityRoot, credentialRoot, sourceRoot].sort()),
    generationSequence: generation.sequence,
    goalId: goalId('goal_verification-local'),
    goalRevision: goalRevision(1),
    id: 'lease_verification-local',
    issuedAt: timestamp,
    lifecyclePolicy: 'RELEASE_EXPLICITLY' as const,
    parentGenerationId: null,
    reservedPathPolicy: 'M2_CONTROLLED_COPY_V1' as const,
    retentionPolicy: 'RUNTIME_OWNED' as const,
    root: candidateRoot,
    schemaVersion: 1 as const,
    sourceGitMetadataDigest: sha256Digest(
      `sha256:${createHash('sha256').update('git-v1').digest('hex')}`,
    ),
    sourceProjectRoot: sourceRoot,
    sourceTreeDigest: candidateDigest,
    state: 'ACTIVE' as const,
    version: 1,
    workspaceRootIdentity: workspaceRoot,
    workflowId: workflowId('workflow_verification-local'),
    workflowVersion: workflowVersion(12),
  });
  const lease = decodeCandidateWorkspaceLease({
    ...withoutDigest,
    leaseDigest: digestCandidateWorkspaceValue(candidateWorkspaceLeaseProjection(withoutDigest)),
  });
  return { candidateRoot, authorityRoot, credentialRoot, runRoot, lease, generation };
}

function requestFor(
  fixtureValue: Fixture,
  executablePath: string,
  argv: readonly string[],
  limits: Partial<{
    timeoutMilliseconds: number;
    stdoutLimitBytes: number;
    stderrLimitBytes: number;
    totalOutputLimitBytes: number;
    payloadRetentionLimitBytes: number;
  }> = {},
  environmentVariables: readonly LocalCommandEnvironmentVariable[] = emptyEnvironment,
): LocalCommandVerificationRequest {
  const executable = realpathSync(executablePath);
  const checkSpec = createLocalCommandCheckSpecification(
    {
      id: checkSpecificationId(
        `check_${createHash('sha256')
          .update(`${executable}:${argv.join(':')}`)
          .digest('hex')
          .slice(0, 20)}`,
      ),
      version: 'm2.local-command.1',
      producerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
      operation: 'local-command.execute',
      runnerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
      runnerVersion: LOCAL_COMMAND_RUNNER_VERSION,
      executablePath: executable,
      executableDigest: bytesDigest(executable),
      declaredToolVersion: 'fixture-system-tool',
      argv,
      workspaceLease: fixtureValue.lease,
      cwd: '.',
      environmentVariables,
      isolationProfileId: DARWIN_SEATBELT_PROFILE_ID,
      isolationProfileDigest: darwinSeatbeltProfileDigest(),
      timeoutMilliseconds: limits.timeoutMilliseconds ?? 2_000,
      terminationGraceMilliseconds: 100,
      stdoutLimitBytes: limits.stdoutLimitBytes ?? 4_096,
      stderrLimitBytes: limits.stderrLimitBytes ?? 4_096,
      totalOutputLimitBytes: limits.totalOutputLimitBytes ?? 8_192,
      payloadRetentionLimitBytes: limits.payloadRetentionLimitBytes ?? 8_192,
      acceptedExitCodes: [0],
    },
    digests,
  );
  const obligation = decodeVerificationObligation({
    id: verificationObligationId(`obligation_${checkSpec.id.slice(6)}`),
    goalId: fixtureValue.lease.goalId,
    goalRevision: fixtureValue.lease.goalRevision,
    candidateGenerationId: fixtureValue.generation.id,
    sourceCriterionRefs: [successCriterionId('criterion_verification-local')],
    scenarioRefs: ['criterion:criterion_verification-local'],
    checkSpecRef: `${checkSpec.id}@${checkSpec.version}`,
    requiredEvidenceKind: 'LOCAL_COMMAND_TEST_RESULT',
    strength: 'M2_LOCAL_COMMAND',
    createdAt: timestamp,
  });
  assert.equal(
    checkSpec.environmentDigest,
    localCommandEnvironmentDigest(environmentVariables, digests),
  );
  return Object.freeze({
    schemaVersion: 2,
    goalId: fixtureValue.lease.goalId,
    goalRevision: fixtureValue.lease.goalRevision,
    workflowId: fixtureValue.lease.workflowId,
    workflowVersion: fixtureValue.lease.workflowVersion,
    attemptId: attemptId('attempt_verification-local'),
    generation: fixtureValue.generation,
    workspaceLease: fixtureValue.lease,
    policyBundleId: policyBundleId('policy_verification-local'),
    policyBundleDigest: sha256Digest(
      `sha256:${createHash('sha256').update('policy-v1').digest('hex')}`,
    ),
    obligation,
    checkSpec,
    runnerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
    runnerVersion: LOCAL_COMMAND_RUNNER_VERSION,
    isolationProfileId: DARWIN_SEATBELT_PROFILE_ID,
    isolationProfileDigest: darwinSeatbeltProfileDigest(),
    environmentVariables,
  });
}

function runnerFor(fixtureValue: Fixture) {
  return createLocalCommandVerificationRunner({
    workspaceLeases: Object.freeze({
      assertLeaseCurrent: (lease: CandidateWorkspaceLease) => lease,
    }),
    isolation: createDarwinSeatbeltIsolation({
      runRootBase: fixtureValue.runRoot,
      credentialRoots: [fixtureValue.credentialRoot],
    }),
  });
}

void test('[M2-E02] unsupported or unenforceable isolation fails before verification', (t) => {
  const value = fixture(t);
  assert.throws(
    () =>
      createDarwinSeatbeltIsolation({
        runRootBase: value.runRoot,
        platform: 'linux',
      }),
    /requires Darwin/,
  );
  assert.throws(
    () =>
      createDarwinSeatbeltIsolation({
        runRootBase: value.runRoot,
        sandboxExecutablePath: '/usr/bin/false',
      }),
    /cannot be enforced/,
  );
});

void test('[M2-E01][M2-E02] exact argv executes without a shell and reads the frozen Candidate', async (t) => {
  const value = fixture(t);
  const request = requestFor(value, '/usr/bin/grep', ['needle', 'fixture.txt']);
  const result = decodeLocalCommandVerificationResult(
    request,
    await runnerFor(value).run(request),
    digests,
  );
  assert.equal(result.terminationKind, 'EXITED');
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.from(result.stdoutBytes).toString('utf8'), 'needle\n');

  const injection = requestFor(value, '/usr/bin/printf', ['%s', '$(touch injected)']);
  const injectionResult = decodeLocalCommandVerificationResult(
    injection,
    await runnerFor(value).run(injection),
    digests,
  );
  assert.equal(Buffer.from(injectionResult.stdoutBytes).toString('utf8'), '$(touch injected)');
  assert.equal(readFileSync(join(value.candidateRoot, 'fixture.txt'), 'utf8'), 'needle\n');

  const emptyEnvironmentRequest = requestFor(value, '/usr/bin/env', []);
  const emptyEnvironmentResult = decodeLocalCommandVerificationResult(
    emptyEnvironmentRequest,
    await runnerFor(value).run(emptyEnvironmentRequest),
    digests,
  );
  assert.equal(Buffer.from(emptyEnvironmentResult.stdoutBytes).toString('utf8'), '');

  const explicitEnvironmentRequest = requestFor(value, '/usr/bin/env', [], {}, [
    { name: 'CODECLOSURE_FIXTURE', value: 'exact-value' },
  ]);
  const explicitEnvironmentResult = decodeLocalCommandVerificationResult(
    explicitEnvironmentRequest,
    await runnerFor(value).run(explicitEnvironmentRequest),
    digests,
  );
  assert.equal(
    Buffer.from(explicitEnvironmentResult.stdoutBytes).toString('utf8'),
    'CODECLOSURE_FIXTURE=exact-value\n',
  );
  assert.deepEqual(readdirSync(value.runRoot), []);
});

void test('[M2-E02] Seatbelt denies Candidate writes plus authority and credential reads', async (t) => {
  const value = fixture(t);
  const writeRequest = requestFor(value, '/usr/bin/touch', ['forbidden-write']);
  const writeResult = decodeLocalCommandVerificationResult(
    writeRequest,
    await runnerFor(value).run(writeRequest),
    digests,
  );
  assert.equal(writeResult.terminationKind, 'EXITED');
  assert.notEqual(writeResult.exitCode, 0);
  assert.throws(() => readFileSync(join(value.candidateRoot, 'forbidden-write')));

  const readRequest = requestFor(value, '/bin/cat', [join(value.authorityRoot, 'control.sqlite')]);
  const readResult = decodeLocalCommandVerificationResult(
    readRequest,
    await runnerFor(value).run(readRequest),
    digests,
  );
  assert.equal(readResult.terminationKind, 'EXITED');
  assert.notEqual(readResult.exitCode, 0);
  assert.equal(
    Buffer.from(readResult.stdoutBytes).includes(Buffer.from('authority-secret')),
    false,
  );

  const credentialRequest = requestFor(value, '/bin/cat', [join(value.credentialRoot, 'token')]);
  const credentialResult = decodeLocalCommandVerificationResult(
    credentialRequest,
    await runnerFor(value).run(credentialRequest),
    digests,
  );
  assert.equal(credentialResult.terminationKind, 'EXITED');
  assert.notEqual(credentialResult.exitCode, 0);
  assert.equal(
    Buffer.from(credentialResult.stdoutBytes).includes(Buffer.from('credential-secret')),
    false,
  );
});

void test('[M2-E01][M2-E07] malformed cwd and stale executable identity fail before process launch', async (t) => {
  const value = fixture(t);
  const runner = runnerFor(value);
  const request = requestFor(value, '/usr/bin/printf', ['ok']);
  await assert.rejects(
    runner.run({
      ...request,
      checkSpec: { ...request.checkSpec, cwd: '../authority' },
    }),
    /strict decoding/,
  );
  await assert.rejects(
    runner.run({
      ...request,
      checkSpec: {
        ...request.checkSpec,
        executableDigest: sha256Digest(`sha256:${'f'.repeat(64)}`),
      },
    }),
    /Executable identity differs/,
  );
});

void test('[M2-E01][M2-E07] a stale read-only workspace lease blocks verification', async (t) => {
  const value = fixture(t);
  const request = requestFor(value, '/usr/bin/printf', ['ok']);
  const runner = createLocalCommandVerificationRunner({
    workspaceLeases: Object.freeze({
      assertLeaseCurrent: () => {
        throw new Error('lease released');
      },
    }),
    isolation: createDarwinSeatbeltIsolation({
      runRootBase: value.runRoot,
      credentialRoots: [value.credentialRoot],
    }),
  });
  await assert.rejects(runner.run(request), /workspace lease is no longer current/);

  let leaseChecks = 0;
  const revokedDuringRun = createLocalCommandVerificationRunner({
    workspaceLeases: Object.freeze({
      assertLeaseCurrent: (lease: CandidateWorkspaceLease) => {
        leaseChecks += 1;
        if (leaseChecks > 1) {
          throw new Error('lease revoked during verification');
        }
        return lease;
      },
    }),
    isolation: createDarwinSeatbeltIsolation({
      runRootBase: value.runRoot,
      credentialRoots: [value.credentialRoot],
    }),
  });
  await assert.rejects(revokedDuringRun.run(request), /workspace lease is no longer current/);
  assert.equal(leaseChecks, 2);
});

void test('[M2-E02] Seatbelt denies network access even when a local listener is reachable', async (t) => {
  const value = fixture(t);
  let connected = false;
  const server = createServer((socket) => {
    connected = true;
    socket.destroy();
  });
  t.after(() => server.close());
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  if (address === null || typeof address === 'string') {
    assert.fail('Network fixture did not receive a TCP port');
  }
  const request = requestFor(value, '/usr/bin/nc', [
    '-z',
    '-w',
    '1',
    '127.0.0.1',
    String(address.port),
  ]);
  const result = decodeLocalCommandVerificationResult(
    request,
    await runnerFor(value).run(request),
    digests,
  );
  assert.equal(result.terminationKind, 'EXITED');
  assert.notEqual(result.exitCode, 0);
  assert.equal(connected, false);
});

void test('[M2-E03] timeout and oversized output remain bounded closed observations', async (t) => {
  const value = fixture(t);
  const timeoutRequest = requestFor(value, '/bin/sleep', ['2'], { timeoutMilliseconds: 50 });
  const timeoutResult = decodeLocalCommandVerificationResult(
    timeoutRequest,
    await runnerFor(value).run(timeoutRequest),
    digests,
  );
  assert.equal(timeoutResult.terminationKind, 'TIMED_OUT');
  assert.equal(timeoutResult.diagnosticCode, 'PROCESS_TIMED_OUT');

  const outputRequest = requestFor(value, '/usr/bin/yes', ['x'], {
    stdoutLimitBytes: 64,
    stderrLimitBytes: 64,
    totalOutputLimitBytes: 64,
    payloadRetentionLimitBytes: 64,
  });
  const outputResult = decodeLocalCommandVerificationResult(
    outputRequest,
    await runnerFor(value).run(outputRequest),
    digests,
  );
  assert.equal(outputResult.stdoutBytes.byteLength <= 64, true);
  assert.equal(outputResult.stdoutTruncated, true);
  assert.equal(outputResult.diagnosticCode, 'OUTPUT_LIMIT_EXCEEDED');
});

void test('[M2-E03][M2-E05] Runtime derives passing and failing Evidence plus exact payloads', async (t) => {
  const value = fixture(t);
  let clockTick = 0;
  const clock = Object.freeze({
    now: () => isoTimestamp(`2026-07-31T00:00:00.${String(++clockTick).padStart(3, '0')}Z`),
  });
  const candidateSource = Object.freeze({
    observeFrozen: () => ({
      schemaVersion: 1,
      generationId: value.generation.id,
      observedDigest: bytesDigest(join(value.candidateRoot, 'fixture.txt')),
    }),
  });
  const passRequest = requestFor(value, '/usr/bin/grep', ['needle', 'fixture.txt']);
  const passed = await executeLocalCommandVerification(
    passRequest,
    evidenceId('evidence_verification-local-pass'),
    { candidateSource, runner: runnerFor(value), clock, digests },
  );
  if (passed.status !== 'EVIDENCE_READY') {
    assert.fail(JSON.stringify(passed));
  }
  assert.equal(passed.evidence.resultStatus, 'PASS');
  assert.equal(passed.evidence.kind, 'LOCAL_COMMAND_TEST_RESULT');
  assert.equal(passed.payloads[0].digest, passed.evidence.payloadRefs[0].digest);
  assert.equal(Buffer.from(passed.payloads[0].bytes).toString('utf8'), 'needle\n');

  const failRequest = requestFor(value, '/usr/bin/grep', ['missing', 'fixture.txt']);
  const failedCheck = await executeLocalCommandVerification(
    failRequest,
    evidenceId('evidence_verification-local-fail'),
    { candidateSource, runner: runnerFor(value), clock, digests },
  );
  if (failedCheck.status !== 'EVIDENCE_READY') {
    assert.fail(JSON.stringify(failedCheck));
  }
  assert.equal(failedCheck.evidence.resultStatus, 'FAIL');
});

void test('[M2-E03] Runtime maps signal, spawn, timeout, and truncation observations to closed Evidence statuses', async (t) => {
  const value = fixture(t);
  const request = requestFor(value, '/usr/bin/printf', ['ok']);
  const candidateSource = Object.freeze({
    observeFrozen: () => ({
      schemaVersion: 1,
      generationId: value.generation.id,
      observedDigest: value.generation.frozenDigest,
    }),
  });
  let tick = 0;
  const clock = Object.freeze({
    now: () => isoTimestamp(`2026-07-31T00:00:03.${String(++tick).padStart(3, '0')}Z`),
  });
  const fixtures = [
    {
      label: 'signal',
      expected: 'RUNNER_ERROR',
      result: {
        schemaVersion: 1,
        kind: 'LOCAL_COMMAND_OBSERVATION_V1',
        terminationKind: 'SIGNALED',
        signal: 'SIGTERM',
        stdoutBytes: new Uint8Array(),
        stdoutObservedByteCount: 0,
        stdoutTruncated: false,
        stderrBytes: new Uint8Array(),
        stderrObservedByteCount: 0,
        stderrTruncated: false,
        diagnosticCode: 'PROCESS_SIGNALED',
      },
    },
    {
      label: 'spawn',
      expected: 'RUNNER_ERROR',
      result: {
        schemaVersion: 1,
        kind: 'LOCAL_COMMAND_OBSERVATION_V1',
        terminationKind: 'SPAWN_FAILED',
        stdoutBytes: new Uint8Array(),
        stdoutObservedByteCount: 0,
        stdoutTruncated: false,
        stderrBytes: new Uint8Array(),
        stderrObservedByteCount: 0,
        stderrTruncated: false,
        diagnosticCode: 'PROCESS_SPAWN_FAILED',
      },
    },
    {
      label: 'timeout',
      expected: 'TIMEOUT',
      result: {
        schemaVersion: 1,
        kind: 'LOCAL_COMMAND_OBSERVATION_V1',
        terminationKind: 'TIMED_OUT',
        stdoutBytes: new Uint8Array(),
        stdoutObservedByteCount: 0,
        stdoutTruncated: false,
        stderrBytes: new Uint8Array(),
        stderrObservedByteCount: 0,
        stderrTruncated: false,
        diagnosticCode: 'PROCESS_TIMED_OUT',
      },
    },
    {
      label: 'truncated',
      expected: 'RUNNER_ERROR',
      result: {
        schemaVersion: 1,
        kind: 'LOCAL_COMMAND_OBSERVATION_V1',
        terminationKind: 'EXITED',
        exitCode: 0,
        stdoutBytes: new Uint8Array(Buffer.from('x')),
        stdoutObservedByteCount: 2,
        stdoutTruncated: true,
        stderrBytes: new Uint8Array(),
        stderrObservedByteCount: 0,
        stderrTruncated: false,
        diagnosticCode: 'OUTPUT_LIMIT_EXCEEDED',
      },
    },
  ] as const;
  for (const fixtureValue of fixtures) {
    const execution = await executeLocalCommandVerification(
      request,
      evidenceId(`evidence_verification-local-${fixtureValue.label}`),
      {
        candidateSource,
        runner: Object.freeze({ run: () => Promise.resolve(fixtureValue.result) }),
        clock,
        digests,
      },
    );
    if (execution.status !== 'EVIDENCE_READY') {
      assert.fail(JSON.stringify(execution));
    }
    assert.equal(execution.evidence.resultStatus, fixtureValue.expected);
  }
});

void test('[M2-D05][M2-E07] post-run Candidate drift suppresses otherwise passing Evidence', async (t) => {
  const value = fixture(t);
  const request = requestFor(value, '/usr/bin/printf', ['ok']);
  let tick = 0;
  const execution = await executeLocalCommandVerification(
    request,
    evidenceId('evidence_verification-local-drift'),
    {
      candidateSource: Object.freeze({
        observeFrozen: () => ({
          schemaVersion: 1,
          generationId: value.generation.id,
          observedDigest: bytesDigest(join(value.candidateRoot, 'fixture.txt')),
        }),
      }),
      runner: Object.freeze({
        run: () => {
          chmodSync(join(value.candidateRoot, 'fixture.txt'), 0o600);
          writeFileSync(join(value.candidateRoot, 'fixture.txt'), 'mutated\n');
          return Promise.resolve({
            schemaVersion: 1,
            kind: 'LOCAL_COMMAND_OBSERVATION_V1',
            terminationKind: 'EXITED',
            exitCode: 0,
            stdoutBytes: new Uint8Array(Buffer.from('ok')),
            stdoutObservedByteCount: 2,
            stdoutTruncated: false,
            stderrBytes: new Uint8Array(),
            stderrObservedByteCount: 0,
            stderrTruncated: false,
            diagnosticCode: 'NONE',
          });
        },
      }),
      clock: Object.freeze({
        now: () => isoTimestamp(`2026-07-31T00:00:01.${String(++tick).padStart(3, '0')}Z`),
      }),
      digests,
    },
  );
  assert.deepEqual(execution, {
    status: 'FAILED',
    failureCode: 'CANDIDATE_SOURCE_DRIFT',
    expectedCandidateDigest: value.generation.frozenDigest,
    observedCandidateDigest: bytesDigest(join(value.candidateRoot, 'fixture.txt')),
  });
});

void test('[M2-E03] malformed output and adapter exceptions cannot become Evidence', async (t) => {
  const value = fixture(t);
  const request = requestFor(value, '/usr/bin/printf', ['ok']);
  const candidateSource = Object.freeze({
    observeFrozen: () => ({
      schemaVersion: 1,
      generationId: value.generation.id,
      observedDigest: value.generation.frozenDigest,
    }),
  });
  let tick = 0;
  const clock = Object.freeze({
    now: () => isoTimestamp(`2026-07-31T00:00:02.${String(++tick).padStart(3, '0')}Z`),
  });
  const malformed = await executeLocalCommandVerification(
    request,
    evidenceId('evidence_verification-local-malformed'),
    {
      candidateSource,
      runner: Object.freeze({ run: () => Promise.resolve({ status: 'PASS' }) }),
      clock,
      digests,
    },
  );
  if (malformed.status !== 'FAILED') {
    assert.fail(JSON.stringify(malformed));
  }
  assert.equal(malformed.failureCode, 'RUNNER_OUTPUT_MALFORMED');
  const invalidExitCode = await executeLocalCommandVerification(
    request,
    evidenceId('evidence_verification-local-invalid-exit-code'),
    {
      candidateSource,
      runner: Object.freeze({
        run: () =>
          Promise.resolve({
            schemaVersion: 1,
            kind: 'LOCAL_COMMAND_OBSERVATION_V1',
            terminationKind: 'EXITED',
            exitCode: 256,
            stdoutBytes: new Uint8Array(),
            stdoutObservedByteCount: 0,
            stdoutTruncated: false,
            stderrBytes: new Uint8Array(),
            stderrObservedByteCount: 0,
            stderrTruncated: false,
            diagnosticCode: 'NONE',
          }),
      }),
      clock,
      digests,
    },
  );
  if (invalidExitCode.status !== 'FAILED') {
    assert.fail(JSON.stringify(invalidExitCode));
  }
  assert.equal(invalidExitCode.failureCode, 'RUNNER_OUTPUT_MALFORMED');
  const crashed = await executeLocalCommandVerification(
    request,
    evidenceId('evidence_verification-local-crashed'),
    {
      candidateSource,
      runner: Object.freeze({
        run: () => Promise.reject(new Error('adapter crash')),
      }),
      clock,
      digests,
    },
  );
  if (crashed.status !== 'FAILED') {
    assert.fail(JSON.stringify(crashed));
  }
  assert.equal(crashed.failureCode, 'RUNNER_INVOCATION_FAILED');
});
