import {
  AttemptFailureClass,
  WorkerResultKind,
  sha256Digest,
  workerEventId,
} from '@codeclosure/domain';
import {
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
  DELAYED_RESULT: 'delayed-result',
} as const;
export type FakeWorkerFixture = (typeof FakeWorkerFixture)[keyof typeof FakeWorkerFixture];

export interface FakeWorkerOptions {
  readonly fixture: FakeWorkerFixture;
  readonly observedAt?: string;
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

export class FakeWorker implements WorkerPort {
  readonly #fixture: FakeWorkerFixture;
  readonly #observedAt: string;
  readonly #started: Promise<void>;
  #markStarted: (() => void) | undefined;
  #releaseDelayed: (() => void) | undefined;
  #delay: Promise<void> | undefined;

  public constructor(options: FakeWorkerOptions) {
    this.#fixture = options.fixture;
    this.#observedAt = options.observedAt ?? '2026-07-27T00:00:00.000Z';
    this.#started = new Promise<void>((resolve) => {
      this.#markStarted = resolve;
    });
    if (this.#fixture === FakeWorkerFixture.DELAYED_RESULT) {
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

  public async *run(rawRequest: WorkerRequest, signal: AbortSignal): AsyncIterable<unknown> {
    this.#markStarted?.();
    this.#markStarted = undefined;
    const request = decodeWorkerRequest(rawRequest);
    assertNotAborted(signal);
    if (this.#fixture === FakeWorkerFixture.ABRUPT_TERMINATION) {
      throw new Error('FakeWorker terminated abruptly');
    }
    if (this.#delay !== undefined) {
      await Promise.race([
        this.#delay,
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
      ]);
    }
    assertNotAborted(signal);

    const event = this.eventFor(request);
    yield event;
    if (this.#fixture === FakeWorkerFixture.DUPLICATE_RESULT) {
      yield event;
    }
  }

  private eventFor(request: WorkerRequest): unknown {
    const common = {
      schemaVersion: 1,
      id: workerEventId(`worker-event_${this.#fixture}-001`),
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
          failureClass: AttemptFailureClass.TRANSIENT_BACKEND,
          reason: 'deterministic fake backend failure',
        });
      case FakeWorkerFixture.VALID_RESULT:
      case FakeWorkerFixture.DUPLICATE_RESULT:
      case FakeWorkerFixture.DELAYED_RESULT: {
        const event = decodeWorkerEvent({
          ...common,
          type: 'WORKER_RESULT',
          result: this.validResult(request),
        });
        assertWorkerEventBindsRequest(event, request);
        return event;
      }
      case FakeWorkerFixture.ABRUPT_TERMINATION:
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
}
