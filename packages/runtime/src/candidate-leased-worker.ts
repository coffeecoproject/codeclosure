import {
  CandidateGenerationState,
  RunStatus,
  WorkflowPhase,
  decodeCandidate,
  decodeCandidateGeneration,
  decodeGoalSnapshot,
  decodeWorkflowSnapshot,
  type CandidateGeneration,
} from '@codeclosure/domain';

import {
  CandidateWorkspaceAccessMode,
  decodeCandidateWorkspaceLease,
  type CandidateWorkspaceLease,
  type CandidateWorkspaceLeaseAuthorityPort,
  type CandidateWorkspaceLeasePort,
} from './candidate-workspace-contracts.js';
import { decodeWorkerRequest, type WorkerRequest } from './worker-contracts.js';
import type { CandidateAuthorityView, Clock, GoalWorkflowView, WorkerPort } from './ports.js';

export interface CandidateLeasedWorkerAuthorityReader {
  getGoalWithWorkflow(
    goalId: WorkerRequest['contextPackage']['goalId'],
  ): GoalWorkflowView | undefined;
  getCandidateAuthorityForWorkflow(
    workflowId: WorkerRequest['contextPackage']['workflowId'],
  ): CandidateAuthorityView | undefined;
}

export interface CandidateLeasedWorkerFactory {
  create(input: {
    readonly request: WorkerRequest;
    readonly lease: CandidateWorkspaceLease;
  }): WorkerPort;
}

export interface CandidateLeasedWorkerDependencies {
  readonly authority: CandidateLeasedWorkerAuthorityReader;
  readonly workspace: CandidateWorkspaceLeasePort & CandidateWorkspaceLeaseAuthorityPort;
  readonly clock: Clock;
  readonly forbiddenRoots: readonly string[];
  /** Worker used for DISCOVERY and PLAN, which do not yet have Candidate authority. */
  readonly nonCandidateWorker: WorkerPort;
  readonly implementationWorker: CandidateLeasedWorkerFactory;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
  );
}

function assertMutableCandidateBinding(
  request: WorkerRequest,
  generation: CandidateGeneration,
): void {
  if (
    request.contextPackage.phase !== WorkflowPhase.IMPLEMENT ||
    generation.state !== CandidateGenerationState.MUTABLE ||
    request.contextPackage.candidateGenerationId !== generation.id ||
    request.contextPackage.candidateDigest !== generation.baseDigest
  ) {
    throw new TypeError('IMPLEMENT Worker Request does not bind the current mutable Candidate');
  }
}

class CandidateLeasedWorker implements WorkerPort {
  readonly #dependencies: CandidateLeasedWorkerDependencies;

  public constructor(dependencies: CandidateLeasedWorkerDependencies) {
    this.#dependencies = Object.freeze({
      ...dependencies,
      forbiddenRoots: Object.freeze([...dependencies.forbiddenRoots]),
    });
  }

  public async *run(rawRequest: WorkerRequest, signal: AbortSignal): AsyncIterable<unknown> {
    const request = decodeWorkerRequest(rawRequest);
    if (request.contextPackage.phase !== WorkflowPhase.IMPLEMENT) {
      const stream = this.#dependencies.nonCandidateWorker.run(request, signal);
      if (!isAsyncIterable(stream)) {
        throw new TypeError('Non-Candidate Worker did not return an async event stream');
      }
      yield* stream;
      return;
    }

    const owner = this.#dependencies.authority.getGoalWithWorkflow(request.contextPackage.goalId);
    const rawAuthority = this.#dependencies.authority.getCandidateAuthorityForWorkflow(
      request.contextPackage.workflowId,
    );
    if (owner === undefined || rawAuthority === undefined) {
      throw new TypeError('IMPLEMENT Worker has no current Candidate authority');
    }
    const goal = decodeGoalSnapshot(owner.goal);
    const workflow = decodeWorkflowSnapshot(owner.workflow);
    const candidate = decodeCandidate(rawAuthority.candidate);
    const generation = decodeCandidateGeneration(rawAuthority.generation);
    if (
      goal.id !== request.contextPackage.goalId ||
      goal.revision !== request.contextPackage.goalRevision ||
      workflow.id !== request.contextPackage.workflowId ||
      workflow.version !== request.contextPackage.workflowVersion ||
      workflow.phase !== WorkflowPhase.IMPLEMENT ||
      workflow.runStatus !== RunStatus.RUNNING ||
      workflow.activeAttemptId !== request.attemptId ||
      workflow.activeCandidateGenerationId !== generation.id ||
      rawAuthority.workflowId !== workflow.id ||
      candidate.goalId !== goal.id ||
      generation.candidateId !== candidate.id ||
      goal.scope.allowedPaths.length === 0
    ) {
      throw new TypeError('IMPLEMENT Worker Candidate authority is stale or incomplete');
    }
    assertMutableCandidateBinding(request, generation);
    const lease = decodeCandidateWorkspaceLease(
      this.#dependencies.workspace.issueLease({
        schemaVersion: 1,
        id: `worker:${request.attemptId}`,
        version: 1,
        issuedAt: this.#dependencies.clock.now(),
        accessMode: CandidateWorkspaceAccessMode.MUTABLE,
        goalId: goal.id,
        goalRevision: goal.revision,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        generation,
        allowedPaths: goal.scope.allowedPaths,
        forbiddenRoots: this.#dependencies.forbiddenRoots,
      }),
    );
    let operationFailed = false;
    let operationFailure: unknown;
    try {
      this.#dependencies.workspace.assertLeaseCurrent(lease);
      const worker = this.#dependencies.implementationWorker.create({ request, lease });
      const stream = worker.run(request, signal);
      if (!isAsyncIterable(stream)) {
        throw new TypeError('Candidate Worker did not return an async event stream');
      }
      yield* stream;
    } catch (error) {
      operationFailed = true;
      operationFailure = error;
    } finally {
      try {
        this.#dependencies.workspace.releaseLease(lease);
      } catch (error) {
        if (!operationFailed) {
          operationFailed = true;
          operationFailure = error;
        }
      }
    }
    if (operationFailed) {
      throw operationFailure;
    }
  }
}

export function createCandidateLeasedWorker(
  dependencies: CandidateLeasedWorkerDependencies,
): WorkerPort {
  return new CandidateLeasedWorker(dependencies);
}
