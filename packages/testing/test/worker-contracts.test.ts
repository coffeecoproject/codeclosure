import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import {
  AttemptFailureClass,
  WorkerResultKind,
  attemptId,
  contextManifestId,
  decodeContextPackage,
  deriveCapabilityGrant,
  executionProfileId,
  goalId,
  goalRevision,
  policyBundleId,
  sha256Digest,
  successCriterionId,
  workerSessionId,
  workflowId,
  workflowVersion,
  WorkflowPhase,
} from '@codeclosure/domain';
import {
  WorkerFailureReasonCode,
  WorkerPortFailureReasonCode,
  assertWorkerEventWithinResponseContract,
  assertWorkerEventBindsRequest,
  attemptFailureClassForWorkerPortReasonCode,
  attemptFailureClassForWorkerReasonCode,
  createWorkerRequest,
  decodeWorkerEvent,
  type WorkerRequest,
} from '@codeclosure/runtime';

import { FakeWorker, FakeWorkerFixture } from '../src/fake-worker.ts';

const packageDigest = sha256Digest(`sha256:${'a'.repeat(64)}`);
const manifestDigest = sha256Digest(`sha256:${'b'.repeat(64)}`);

function request(version = 2): WorkerRequest {
  const contextPackage = decodeContextPackage({
    schemaVersion: 2,
    goalId: goalId('goal_worker-fixture'),
    goalRevision: goalRevision(1),
    workflowId: workflowId('workflow_worker-fixture'),
    workflowVersion: workflowVersion(version),
    phase: WorkflowPhase.DISCOVERY,
    attemptId: attemptId('attempt_worker-fixture'),
    phaseObjective: 'Inspect the bounded fixture.',
    capabilityGrant: deriveCapabilityGrant(WorkflowPhase.DISCOVERY),
    goal: {
      objective: 'Exercise the typed Worker boundary',
      successCriteria: [
        {
          id: successCriterionId('criterion_worker-fixture'),
          description: 'Untrusted Worker output fails closed',
          required: true,
        },
      ],
      scope: { projectPath: '/fixture/project', allowedPaths: ['src'] },
      nonGoals: ['No closeout authority'],
    },
    selectedEntries: [],
    executionProfileId: executionProfileId('profile_worker-fixture'),
    executionProfileDigest: sha256Digest(`sha256:${'d'.repeat(64)}`),
    policyBundleId: policyBundleId('policy_m1'),
    policyBundleDigest: sha256Digest(`sha256:${'c'.repeat(64)}`),
    responseContract: {
      schemaVersion: 1,
      workerEventSchemaVersion: 1,
      allowedResultKinds: [WorkerResultKind.PROPOSALS],
      unknownFields: 'REJECT',
      maxEventBytes: 65_536,
    },
  });
  return createWorkerRequest(
    workerSessionId('worker_fixture-0001'),
    contextManifestId('context_worker-fixture'),
    manifestDigest,
    packageDigest,
    contextPackage,
  );
}

async function collect(worker: FakeWorker, workerRequest = request()): Promise<readonly unknown[]> {
  const controller = new AbortController();
  const events: unknown[] = [];
  for await (const event of worker.run(workerRequest, controller.signal)) {
    events.push(event);
  }
  return events;
}

void test('[I-004][I-019] FakeWorker emits a typed result bound to the exact request', async () => {
  const workerRequest = request();
  const events = await collect(
    new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
    workerRequest,
  );
  assert.equal(events.length, 1);
  const event = decodeWorkerEvent(events[0]);
  assertWorkerEventBindsRequest(event, workerRequest);
  assert.equal(event.type, 'WORKER_RESULT');
  assert.equal(event.result.kind, WorkerResultKind.PROPOSALS);
  assert.equal(Object.isFrozen(event), true);
});

void test('[I-001][I-002][I-004] fabricated acceptance and control mutation fail schema admission', async () => {
  for (const fixture of [
    FakeWorkerFixture.FABRICATED_ACCEPT,
    FakeWorkerFixture.CONTROL_MUTATION,
    FakeWorkerFixture.MALFORMED_EVENT,
  ]) {
    const [rawEvent] = await collect(new FakeWorker({ fixture }));
    assert.throws(() => decodeWorkerEvent(rawEvent));
  }
});

void test('[I-009][I-019] stale context is shape-valid but fails semantic request binding', async () => {
  const workerRequest = request();
  const [rawEvent] = await collect(
    new FakeWorker({ fixture: FakeWorkerFixture.STALE_CONTEXT }),
    workerRequest,
  );
  const event = decodeWorkerEvent(rawEvent);
  assert.throws(() => assertWorkerEventBindsRequest(event, workerRequest), /does not bind/);
});

void test('[I-009] duplicate Worker delivery retains one independent WorkerEventId', async () => {
  const workerRequest = request();
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.DUPLICATE_RESULT });
  assert.deepEqual(worker.readObservation(), {
    schemaVersion: 1,
    fixture: FakeWorkerFixture.DUPLICATE_RESULT,
    requestCount: 0,
    eventDeliveryCount: 0,
    requests: [],
  });

  const events = await collect(worker, workerRequest);
  assert.equal(events.length, 2);
  const eventId = decodeWorkerEvent(events[0]).id;
  assert.equal(eventId, decodeWorkerEvent(events[1]).id);

  const observation = worker.readObservation();
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.requests), true);
  assert.equal(Object.isFrozen(observation.requests[0]), true);
  assert.equal(Object.isFrozen(observation.requests[0]?.deliveries), true);
  assert.deepEqual(observation, {
    schemaVersion: 1,
    fixture: FakeWorkerFixture.DUPLICATE_RESULT,
    requestCount: 1,
    eventDeliveryCount: 2,
    requests: [
      {
        attemptId: workerRequest.attemptId,
        workflowId: workerRequest.contextPackage.workflowId,
        workflowVersion: workerRequest.contextPackage.workflowVersion,
        phase: workerRequest.contextPackage.phase,
        workerSessionId: workerRequest.workerSessionId,
        contextManifestId: workerRequest.contextManifestId,
        contextManifestDigest: workerRequest.contextManifestDigest,
        packageDigest: workerRequest.packageDigest,
        executionProfileId: workerRequest.contextPackage.executionProfileId,
        executionProfileDigest: workerRequest.contextPackage.executionProfileDigest,
        deliveries: [
          { ordinal: 1, eventId },
          { ordinal: 2, eventId },
        ],
      },
    ],
  });
});

void test('[I-027] Worker failure is typed while abrupt termination remains a port failure', async () => {
  const workerRequest = request();
  const [rawFailure] = await collect(
    new FakeWorker({ fixture: FakeWorkerFixture.FAILURE }),
    workerRequest,
  );
  const failure = decodeWorkerEvent(rawFailure);
  if (failure.type !== 'WORKER_FAILURE') {
    assert.fail('Failure fixture must emit a Worker failure event');
  }
  assert.equal(failure.reasonCode, WorkerFailureReasonCode.BACKEND_FAILURE);
  assert.equal(
    attemptFailureClassForWorkerReasonCode(failure.reasonCode),
    AttemptFailureClass.TRANSIENT_BACKEND,
  );
  assert.equal(
    attemptFailureClassForWorkerPortReasonCode(WorkerPortFailureReasonCode.INVOCATION_FAILED),
    AttemptFailureClass.ABRUPT_TERMINATION,
  );
  assert.equal(
    attemptFailureClassForWorkerPortReasonCode(WorkerPortFailureReasonCode.NO_TERMINAL_EVENT),
    AttemptFailureClass.PROTOCOL_ERROR,
  );
  assert.throws(
    () =>
      decodeWorkerEvent({
        ...failure,
        failureClass: AttemptFailureClass.PERMANENT_BACKEND,
      }),
    /unrecognized key/i,
  );
  assertWorkerEventBindsRequest(failure, workerRequest);

  await assert.rejects(
    collect(new FakeWorker({ fixture: FakeWorkerFixture.ABRUPT_TERMINATION }), workerRequest),
    /terminated abruptly/,
  );
});

void test('[I-004][I-012] Worker Event bytes are bounded by the compiler-owned response contract', async () => {
  const workerRequest = request();
  const [rawEvent] = await collect(
    new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
    workerRequest,
  );
  const event = decodeWorkerEvent(rawEvent);
  const boundedContextPackage = decodeContextPackage({
    ...workerRequest.contextPackage,
    responseContract: {
      ...workerRequest.contextPackage.responseContract,
      maxEventBytes: 32,
    },
  });
  const boundedRequest = createWorkerRequest(
    workerRequest.workerSessionId,
    workerRequest.contextManifestId,
    workerRequest.contextManifestDigest,
    workerRequest.packageDigest,
    boundedContextPackage,
  );
  assert.throws(
    () => assertWorkerEventWithinResponseContract(event, boundedRequest),
    /exceeds the bound response contract/,
  );
});

void test('[I-010] delayed FakeWorker respects AbortSignal interruption', async () => {
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.DELAYED_RESULT });
  const controller = new AbortController();
  const consumption = (async () => {
    for await (const event of worker.run(request(), controller.signal)) {
      void event;
      assert.fail('aborted worker must not emit an event');
    }
  })();
  controller.abort();
  await assert.rejects(consumption, (error: unknown) => {
    return error instanceof Error && error.name === 'AbortError';
  });
});

void test('[I-008][I-010] restart FakeWorker delays only the initial bound dispatch', async () => {
  const initialWorker = new FakeWorker({ fixture: FakeWorkerFixture.INITIAL_DISPATCH_DELAY });
  const initialConsumption = collect(initialWorker, request(2));
  let initialCompleted = false;
  void initialConsumption.then(() => {
    initialCompleted = true;
  });
  await initialWorker.waitUntilStarted();
  await waitForImmediate();
  assert.equal(initialCompleted, false);
  initialWorker.release();
  assert.equal((await initialConsumption).length, 1);

  const recoveredWorker = new FakeWorker({ fixture: FakeWorkerFixture.INITIAL_DISPATCH_DELAY });
  const recoveredEvents = await collect(recoveredWorker, request(5));
  assert.equal(recoveredEvents.length, 1);
  assert.equal(decodeWorkerEvent(recoveredEvents[0]).type, 'WORKER_RESULT');
});
