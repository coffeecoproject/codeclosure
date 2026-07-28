import { decodeWorkflowSnapshot, goalId, type GoalId, type WorkflowId } from '@codeclosure/domain';

import type { RuntimeCommandResult } from './contracts.js';
import type { WorkerControlStore, WorkerPort } from './ports.js';
import {
  WorkflowRuntimeKernel,
  type CancelGoalRequest,
  type StartGoalRequest,
  type WorkflowRuntimeKernelDependencies,
} from './workflow-runtime.js';
import {
  WorkerEventDisposition,
  WorkerEventNonAdmissionClass,
  WorkerPortFailureReasonCode,
  type WorkerDispatchResult,
  type WorkerEventAdmissionResult,
} from './worker-contracts.js';

export interface WorkerExecutionDependencies extends WorkflowRuntimeKernelDependencies {
  readonly store: WorkerControlStore;
  readonly worker: WorkerPort;
}

export interface WorkerExecutionResult {
  readonly command: RuntimeCommandResult;
  readonly dispatch?: WorkerDispatchResult;
  readonly admissions: readonly WorkerEventAdmissionResult[];
  readonly workerFailure?: RuntimeCommandResult;
}

export interface WorkerExecutionApplication {
  startGoal(input: StartGoalRequest): Promise<WorkerExecutionResult>;
  cancelGoal(input: CancelGoalRequest): RuntimeCommandResult;
}

interface ActiveDispatch {
  readonly goalId: GoalId;
  readonly workflowId: WorkflowId;
  readonly controller: AbortController;
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
  );
}

class WorkerExecutionCoordinator implements WorkerExecutionApplication {
  readonly #store: WorkerControlStore;
  readonly #worker: WorkerPort;
  readonly #kernel: WorkflowRuntimeKernel;
  readonly #activeByGoal = new Map<GoalId, ActiveDispatch>();

  public constructor(dependencies: WorkerExecutionDependencies) {
    this.#store = dependencies.store;
    this.#worker = dependencies.worker;
    this.#kernel = new WorkflowRuntimeKernel(dependencies);
  }

  public async startGoal(input: StartGoalRequest): Promise<WorkerExecutionResult> {
    const command = this.#kernel.startGoal(input);
    if (command.status !== 'APPLIED') {
      return Object.freeze({ command, admissions: Object.freeze([]) });
    }
    const goalIdentifier = goalId(command.output.goalId);
    const rawWorkflow = this.#store.getWorkflowForGoal(goalIdentifier);
    if (rawWorkflow === undefined) {
      return Object.freeze({
        command,
        admissions: Object.freeze([]),
        dispatch: Object.freeze({
          status: 'FAILED',
          reasonCode: 'WORKFLOW_NOT_FOUND_AFTER_START',
          message: 'Started Goal has no readable Workflow',
        }),
      });
    }
    const workflow = decodeWorkflowSnapshot(rawWorkflow);
    if (workflow.activeAttemptId === undefined) {
      return Object.freeze({
        command,
        admissions: Object.freeze([]),
        dispatch: Object.freeze({
          status: 'FAILED',
          reasonCode: 'ACTIVE_ATTEMPT_MISSING_AFTER_START',
          message: 'Started Goal has no active Attempt',
        }),
      });
    }
    const request = this.#kernel.takePreparedWorkerRequest(workflow.activeAttemptId);
    if (request === undefined) {
      return Object.freeze({
        command,
        admissions: Object.freeze([]),
        dispatch: Object.freeze({
          status: 'FAILED',
          reasonCode: 'WORKER_REQUEST_NOT_PREPARED',
          message: 'Attempt committed without an in-process Worker Request',
        }),
      });
    }
    const dispatch = this.#kernel.claimWorkerDispatch(request);
    if (dispatch.status !== 'CLAIMED') {
      return Object.freeze({ command, dispatch, admissions: Object.freeze([]) });
    }

    const controller = new AbortController();
    const active: ActiveDispatch = Object.freeze({
      goalId: goalIdentifier,
      workflowId: workflow.id,
      controller,
    });
    this.#activeByGoal.set(goalIdentifier, active);
    const admissions: WorkerEventAdmissionResult[] = [];
    let workerFailure: RuntimeCommandResult | undefined;
    try {
      const stream: unknown = this.#worker.run(request, controller.signal);
      if (!isAsyncIterable(stream)) {
        workerFailure = this.#kernel.recordWorkerPortFailure(
          request,
          WorkerPortFailureReasonCode.NON_ASYNC_STREAM,
        );
      } else {
        for await (const rawEvent of stream) {
          admissions.push(this.#kernel.admitWorkerEvent(rawEvent, request));
        }
      }
    } catch (error) {
      if (!isAbortError(error, controller.signal)) {
        workerFailure = this.#kernel.recordWorkerPortFailure(
          request,
          WorkerPortFailureReasonCode.INVOCATION_FAILED,
        );
      }
    } finally {
      if (this.#activeByGoal.get(goalIdentifier)?.controller === controller) {
        this.#activeByGoal.delete(goalIdentifier);
      }
    }
    if (
      workerFailure === undefined &&
      !controller.signal.aborted &&
      !admissions.some(
        (admission) =>
          admission.status === 'ADMITTED' ||
          (admission.status === 'DUPLICATE' &&
            admission.originalDisposition === WorkerEventDisposition.ADMITTED),
      ) &&
      !admissions.some(
        (admission) =>
          (admission.status === 'REJECTED' || admission.status === 'IGNORED') &&
          admission.nonAdmissionClass === WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
      )
    ) {
      workerFailure = this.#kernel.recordWorkerPortFailure(
        request,
        admissions.length === 0
          ? WorkerPortFailureReasonCode.NO_TERMINAL_EVENT
          : WorkerPortFailureReasonCode.NO_ADMITTED_TERMINAL_EVENT,
      );
    }
    return Object.freeze({
      command,
      dispatch,
      admissions: Object.freeze(admissions),
      ...(workerFailure === undefined ? {} : { workerFailure }),
    });
  }

  public cancelGoal(input: CancelGoalRequest): RuntimeCommandResult {
    const goalIdentifier = goalId(input.goalId);
    const result = this.#kernel.cancelGoal(input);
    if (result.status === 'APPLIED') {
      this.#activeByGoal.get(goalIdentifier)?.controller.abort('Goal cancellation committed');
    }
    return result;
  }
}

export function createWorkerExecutionApplication(
  dependencies: WorkerExecutionDependencies,
): WorkerExecutionApplication {
  return new WorkerExecutionCoordinator(dependencies);
}
