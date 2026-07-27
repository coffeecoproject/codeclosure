import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WorkerResultKind,
  attemptId,
  contextManifestId,
  decodeContextPackage,
  deriveCapabilityGrant,
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
  assertWorkerEventBindsRequest,
  createWorkerRequest,
  decodeWorkerEvent,
  type WorkerRequest,
} from '@codeclosure/runtime';

import { FakeWorker, FakeWorkerFixture } from '../src/fake-worker.ts';

const packageDigest = sha256Digest(`sha256:${'a'.repeat(64)}`);
const manifestDigest = sha256Digest(`sha256:${'b'.repeat(64)}`);

function request(): WorkerRequest {
  const contextPackage = decodeContextPackage({
    schemaVersion: 1,
    goalId: goalId('goal_worker-fixture'),
    goalRevision: goalRevision(1),
    workflowId: workflowId('workflow_worker-fixture'),
    workflowVersion: workflowVersion(2),
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
    policyBundleId: policyBundleId('policy_m1'),
    policyBundleDigest: sha256Digest(`sha256:${'c'.repeat(64)}`),
    responseContract: {
      schemaVersion: 1,
      workerEventSchemaVersion: 1,
      allowedResultKinds: [WorkerResultKind.PROPOSALS],
      unknownFields: 'REJECT',
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
  const events = await collect(new FakeWorker({ fixture: FakeWorkerFixture.DUPLICATE_RESULT }));
  assert.equal(events.length, 2);
  assert.equal(decodeWorkerEvent(events[0]).id, decodeWorkerEvent(events[1]).id);
});

void test('[I-027] Worker failure is typed while abrupt termination remains a port failure', async () => {
  const workerRequest = request();
  const [rawFailure] = await collect(
    new FakeWorker({ fixture: FakeWorkerFixture.FAILURE }),
    workerRequest,
  );
  const failure = decodeWorkerEvent(rawFailure);
  assert.equal(failure.type, 'WORKER_FAILURE');
  assertWorkerEventBindsRequest(failure, workerRequest);

  await assert.rejects(
    collect(new FakeWorker({ fixture: FakeWorkerFixture.ABRUPT_TERMINATION }), workerRequest),
    /terminated abruptly/,
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
