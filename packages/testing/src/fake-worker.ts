import { createHash } from 'node:crypto';

import { WorkflowPhase, WorkerResultKind, sha256Digest, workerEventId } from '@codeclosure/domain';
import {
  WorkerFailureReasonCode,
  assertWorkerEventBindsRequest,
  decodeWorkerEvent,
  decodeWorkerRequest,
  type WorkerPort,
  type WorkerRequest,
  type WorkerResult,
} from '@codeclosure/runtime';

export const FakeWorkerFixture = {
  VALID_RESULT: 'valid-result',
  MALFORMED_EVENT: 'malformed-event',
  FABRICATED_ACCEPT: 'fabricated-accept',
  DUPLICATE_RESULT: 'duplicate-result',
  STALE_CONTEXT: 'stale-context',
  CONTROL_MUTATION: 'control-mutation',
  FAILURE: 'failure',
  ABRUPT_TERMINATION: 'abrupt-termination',
  SENSITIVE_ABRUPT_TERMINATION: 'sensitive-abrupt-termination',
  DELAYED_RESULT: 'delayed-result',
  INITIAL_DISPATCH_DELAY: 'initial-dispatch-delay',
} as const;
export type FakeWorkerFixture = (typeof FakeWorkerFixture)[keyof typeof FakeWorkerFixture];

export interface FakeWorkerOptions {
  readonly fixture: FakeWorkerFixture;
  readonly observedAt?: string;
}

export interface FakeWorkerEventDeliveryObservation {
  readonly ordinal: number;
  readonly eventId?: ReturnType<typeof workerEventId>;
}

export interface FakeWorkerRequestObservation {
  readonly attemptId: WorkerRequest['attemptId'];
  readonly workflowId: WorkerRequest['contextPackage']['workflowId'];
  readonly workflowVersion: WorkerRequest['contextPackage']['workflowVersion'];
  readonly phase: WorkerRequest['contextPackage']['phase'];
  readonly workerSessionId: WorkerRequest['workerSessionId'];
  readonly contextManifestId: WorkerRequest['contextManifestId'];
  readonly contextManifestDigest: WorkerRequest['contextManifestDigest'];
  readonly packageDigest: WorkerRequest['packageDigest'];
  readonly executionProfileId: WorkerRequest['contextPackage']['executionProfileId'];
  readonly executionProfileDigest: WorkerRequest['contextPackage']['executionProfileDigest'];
  readonly deliveries: readonly FakeWorkerEventDeliveryObservation[];
}

export interface FakeWorkerObservationSnapshot {
  readonly schemaVersion: 1;
  readonly fixture: FakeWorkerFixture;
  readonly requestCount: number;
  readonly eventDeliveryCount: number;
  readonly requests: readonly FakeWorkerRequestObservation[];
}

interface MutableFakeWorkerRequestObservation {
  readonly attemptId: WorkerRequest['attemptId'];
  readonly workflowId: WorkerRequest['contextPackage']['workflowId'];
  readonly workflowVersion: WorkerRequest['contextPackage']['workflowVersion'];
  readonly phase: WorkerRequest['contextPackage']['phase'];
  readonly workerSessionId: WorkerRequest['workerSessionId'];
  readonly contextManifestId: WorkerRequest['contextManifestId'];
  readonly contextManifestDigest: WorkerRequest['contextManifestDigest'];
  readonly packageDigest: WorkerRequest['packageDigest'];
  readonly executionProfileId: WorkerRequest['contextPackage']['executionProfileId'];
  readonly executionProfileDigest: WorkerRequest['contextPackage']['executionProfileDigest'];
  readonly deliveries: FakeWorkerEventDeliveryObservation[];
}

function abortError(): Error {
  const error = new Error('FakeWorker dispatch was aborted');
  error.name = 'AbortError';
  return error;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function eventIdFor(request: WorkerRequest, fixture: FakeWorkerFixture, ordinal: number) {
  const requestIdentity = [
    request.workerSessionId,
    request.attemptId,
    request.contextManifestId,
    request.contextManifestDigest,
    request.packageDigest,
    fixture,
    String(ordinal),
  ].join('\u0000');
  const requestHash = createHash('sha256')
    .update(requestIdentity, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return workerEventId(
    `worker-event_${fixture}-${requestHash}-${String(ordinal).padStart(3, '0')}`,
  );
}

export class FakeWorker implements WorkerPort {
  readonly #fixture: FakeWorkerFixture;
  readonly #observedAt: string;
  readonly #started: Promise<void>;
  readonly #observations: MutableFakeWorkerRequestObservation[] = [];
  #markStarted: (() => void) | undefined;
  #releaseDelayed: (() => void) | undefined;
  #delay: Promise<void> | undefined;

  public constructor(options: FakeWorkerOptions) {
    this.#fixture = options.fixture;
    this.#observedAt = options.observedAt ?? '2026-07-27T00:00:00.000Z';
    this.#started = new Promise<void>((resolve) => {
      this.#markStarted = resolve;
    });
    if (
      this.#fixture === FakeWorkerFixture.DELAYED_RESULT ||
      this.#fixture === FakeWorkerFixture.INITIAL_DISPATCH_DELAY
    ) {
      this.#delay = new Promise<void>((resolve) => {
        this.#releaseDelayed = resolve;
      });
    }
  }

  public release(): void {
    this.#releaseDelayed?.();
    this.#releaseDelayed = undefined;
  }

  public waitUntilStarted(): Promise<void> {
    return this.#started;
  }

  /**
   * Returns a run-owned, non-authoritative copy of requests and event
   * deliveries emitted by this FakeWorker instance. The snapshot can explain
   * fixture behavior; it cannot mutate Workflow state or issue Acceptance.
   */
  public readObservation(): FakeWorkerObservationSnapshot {
    const requests = this.#observations.map((observation) =>
      Object.freeze({
        attemptId: observation.attemptId,
        workflowId: observation.workflowId,
        workflowVersion: observation.workflowVersion,
        phase: observation.phase,
        workerSessionId: observation.workerSessionId,
        contextManifestId: observation.contextManifestId,
        contextManifestDigest: observation.contextManifestDigest,
        packageDigest: observation.packageDigest,
        executionProfileId: observation.executionProfileId,
        executionProfileDigest: observation.executionProfileDigest,
        deliveries: Object.freeze([...observation.deliveries]),
      }),
    );
    return Object.freeze({
      schemaVersion: 1,
      fixture: this.#fixture,
      requestCount: requests.length,
      eventDeliveryCount: requests.reduce((count, request) => count + request.deliveries.length, 0),
      requests: Object.freeze(requests),
    });
  }

  public async *run(rawRequest: WorkerRequest, signal: AbortSignal): AsyncIterable<unknown> {
    this.#markStarted?.();
    this.#markStarted = undefined;
    const request = decodeWorkerRequest(rawRequest);
    const observation = Object.freeze({
      attemptId: request.attemptId,
      workflowId: request.contextPackage.workflowId,
      workflowVersion: request.contextPackage.workflowVersion,
      phase: request.contextPackage.phase,
      workerSessionId: request.workerSessionId,
      contextManifestId: request.contextManifestId,
      contextManifestDigest: request.contextManifestDigest,
      packageDigest: request.packageDigest,
      executionProfileId: request.contextPackage.executionProfileId,
      executionProfileDigest: request.contextPackage.executionProfileDigest,
      deliveries: [] as FakeWorkerEventDeliveryObservation[],
    });
    this.#observations.push(observation);
    assertNotAborted(signal);
    if (this.#fixture === FakeWorkerFixture.ABRUPT_TERMINATION) {
      throw new Error('FakeWorker terminated abruptly');
    }
    if (this.#fixture === FakeWorkerFixture.SENSITIVE_ABRUPT_TERMINATION) {
      throw new Error('token=demo-sensitive-value');
    }
    if (this.shouldDelay(request)) {
      await this.waitForRelease(signal);
    }
    assertNotAborted(signal);

    const event = this.eventFor(request);
    const eventId = this.observedEventId(event);
    observation.deliveries.push(
      Object.freeze({ ordinal: 1, ...(eventId === undefined ? {} : { eventId }) }),
    );
    yield event;
    if (this.#fixture === FakeWorkerFixture.DUPLICATE_RESULT) {
      observation.deliveries.push(
        Object.freeze({ ordinal: 2, ...(eventId === undefined ? {} : { eventId }) }),
      );
      yield event;
    }
  }

  private observedEventId(event: unknown): ReturnType<typeof workerEventId> | undefined {
    if (event === null || typeof event !== 'object' || !('id' in event)) {
      return undefined;
    }
    const rawIdentifier: unknown = event.id;
    if (typeof rawIdentifier !== 'string') {
      return undefined;
    }
    try {
      return workerEventId(rawIdentifier);
    } catch {
      return undefined;
    }
  }

  private eventFor(request: WorkerRequest): unknown {
    const common = {
      schemaVersion: 1,
      id: eventIdFor(request, this.#fixture, 1),
      workerSessionId: request.workerSessionId,
      attemptId: request.attemptId,
      contextManifestId: request.contextManifestId,
      contextManifestDigest: request.contextManifestDigest,
      packageDigest: request.packageDigest,
      observedAt: this.#observedAt,
    };
    switch (this.#fixture) {
      case FakeWorkerFixture.MALFORMED_EVENT:
        return Object.freeze({ schemaVersion: 1, type: 'WORKER_RESULT' });
      case FakeWorkerFixture.FABRICATED_ACCEPT:
        return Object.freeze({
          ...common,
          type: 'WORKER_RESULT',
          result: this.validResult(request),
          accept: true,
        });
      case FakeWorkerFixture.STALE_CONTEXT:
        return Object.freeze({
          ...common,
          type: 'WORKER_RESULT',
          contextManifestDigest: sha256Digest(`sha256:${'f'.repeat(64)}`),
          result: this.validResult(request),
        });
      case FakeWorkerFixture.CONTROL_MUTATION:
        return Object.freeze({
          ...common,
          type: 'WORKER_RESULT',
          result: this.validResult(request),
          workflowState: { phase: 'CLOSEOUT', runStatus: 'CLOSED' },
        });
      case FakeWorkerFixture.FAILURE:
        return Object.freeze({
          ...common,
          type: 'WORKER_FAILURE',
          reasonCode: WorkerFailureReasonCode.BACKEND_FAILURE,
        });
      case FakeWorkerFixture.VALID_RESULT:
      case FakeWorkerFixture.DUPLICATE_RESULT:
      case FakeWorkerFixture.DELAYED_RESULT:
      case FakeWorkerFixture.INITIAL_DISPATCH_DELAY: {
        const event = decodeWorkerEvent({
          ...common,
          type: 'WORKER_RESULT',
          result: this.validResult(request),
        });
        assertWorkerEventBindsRequest(event, request);
        return event;
      }
      case FakeWorkerFixture.ABRUPT_TERMINATION:
      case FakeWorkerFixture.SENSITIVE_ABRUPT_TERMINATION:
        throw new Error('Abrupt fixture should terminate before event construction');
    }
  }

  private validResult(request: WorkerRequest): WorkerResult {
    return request.contextPackage.responseContract.allowedResultKinds.includes(
      WorkerResultKind.COMPLETION_REQUEST,
    )
      ? Object.freeze({
          kind: WorkerResultKind.COMPLETION_REQUEST,
          claimedScope: request.contextPackage.goal.objective,
          summary: 'FakeWorker requests evaluation of the bounded implementation result.',
          proposedEvidenceRefs: Object.freeze([]),
        })
      : Object.freeze({
          kind: WorkerResultKind.PROPOSALS,
          proposals: Object.freeze([
            Object.freeze({
              kind: 'PROJECT_OBSERVATION',
              summary: 'Deterministic discovery proposal from FakeWorker.',
              sourceRefs: Object.freeze([request.contextPackage.goal.scope.projectPath]),
            }),
          ]),
        });
  }

  /**
   * The restart fixture blocks only the first M1 Discovery dispatch. The
   * profile is bound to m1-deterministic-driver-v1, whose first Context-bound
   * Attempt commits Workflow version 2. A recovered replacement Attempt has a
   * later, authority-bound version and therefore uses the same immutable
   * profile without repeating the injected interruption.
   */
  private shouldDelay(request: WorkerRequest): boolean {
    return (
      this.#delay !== undefined &&
      (this.#fixture === FakeWorkerFixture.DELAYED_RESULT ||
        (this.#fixture === FakeWorkerFixture.INITIAL_DISPATCH_DELAY &&
          request.contextPackage.phase === WorkflowPhase.DISCOVERY &&
          request.contextPackage.workflowVersion === 2))
    );
  }

  private async waitForRelease(signal: AbortSignal): Promise<void> {
    const delay = this.#delay;
    if (delay === undefined) {
      throw new TypeError('FakeWorker delay was not initialized');
    }
    let rejectAbort: ((error: Error) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = (): void => rejectAbort?.(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    const keepAlive = setInterval(() => undefined, 1_000);
    try {
      assertNotAborted(signal);
      await Promise.race([delay, aborted]);
    } finally {
      clearInterval(keepAlive);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
