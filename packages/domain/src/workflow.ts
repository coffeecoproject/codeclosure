import {
  nextWorkflowVersion,
  workflowVersion,
  type CandidateGenerationId,
  type CommandId,
  type IsoTimestamp,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import {
  RunStatus,
  WorkflowPhase,
  type WorkflowInstance,
  type WorkflowPhase as WorkflowPhaseType,
} from './model.js';

export const WorkflowGuard = {
  GOAL_REVISION_CURRENT: 'GOAL_REVISION_CURRENT',
  PROJECT_IDENTITY_RECORDED: 'PROJECT_IDENTITY_RECORDED',
  DISCOVERY_COMPLETE: 'DISCOVERY_COMPLETE',
  REQUIRED_UNKNOWNS_RESOLVED: 'REQUIRED_UNKNOWNS_RESOLVED',
  SCENARIOS_RESOLVED: 'SCENARIOS_RESOLVED',
  PLAN_CURRENT: 'PLAN_CURRENT',
  CHANGE_BOUNDARY_EXPLICIT: 'CHANGE_BOUNDARY_EXPLICIT',
  OBLIGATIONS_MAPPED: 'OBLIGATIONS_MAPPED',
  PLAN_POLICY_PASSED: 'PLAN_POLICY_PASSED',
  NO_PLANNING_BLOCKER: 'NO_PLANNING_BLOCKER',
  CANDIDATE_GENERATION_PREPARED: 'CANDIDATE_GENERATION_PREPARED',
  MUTABLE_CANDIDATE_CURRENT: 'MUTABLE_CANDIDATE_CURRENT',
  WORKER_QUIESCENT: 'WORKER_QUIESCENT',
  CHANGE_SET_ENUMERATED: 'CHANGE_SET_ENUMERATED',
  PROHIBITED_EFFECTS_ABSENT: 'PROHIBITED_EFFECTS_ABSENT',
  FREEZE_REQUESTED: 'FREEZE_REQUESTED',
  NO_WRITE_CAPABLE_WORKER: 'NO_WRITE_CAPABLE_WORKER',
  FREEZE_IDENTITY_STABLE: 'FREEZE_IDENTITY_STABLE',
  CHANGE_IDENTITY_RECORDED: 'CHANGE_IDENTITY_RECORDED',
  FROZEN_DIGEST_PERSISTED: 'FROZEN_DIGEST_PERSISTED',
  INTEGRITY_POLICY_PASSED: 'INTEGRITY_POLICY_PASSED',
  REQUIRED_EVIDENCE_ACCOUNTED: 'REQUIRED_EVIDENCE_ACCOUNTED',
  EVIDENCE_BINDINGS_CURRENT: 'EVIDENCE_BINDINGS_CURRENT',
  CLEANUP_PROVEN: 'CLEANUP_PROVEN',
  SOURCE_DIGEST_CURRENT: 'SOURCE_DIGEST_CURRENT',
  CURRENT_ACCEPTANCE: 'CURRENT_ACCEPTANCE',
  REJECT_REPAIRABLE_RECORDED: 'REJECT_REPAIRABLE_RECORDED',
} as const;
export type WorkflowGuard = (typeof WorkflowGuard)[keyof typeof WorkflowGuard];

export const GuardOutcome = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNKNOWN: 'UNKNOWN',
} as const;
export type GuardOutcome = (typeof GuardOutcome)[keyof typeof GuardOutcome];

export interface GuardResult {
  readonly guard: WorkflowGuard;
  readonly outcome: GuardOutcome;
  readonly reasonCode: string;
  readonly supportingRefs: readonly string[];
}

export const WorkflowRejectionCode = {
  WORKFLOW_ID_MISMATCH: 'WORKFLOW_ID_MISMATCH',
  STALE_VERSION: 'STALE_VERSION',
  TERMINAL_WORKFLOW: 'TERMINAL_WORKFLOW',
  RUN_STATUS_NOT_READY: 'RUN_STATUS_NOT_READY',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  DUPLICATE_GUARD: 'DUPLICATE_GUARD',
  UNEXPECTED_GUARD: 'UNEXPECTED_GUARD',
  MISSING_GUARD: 'MISSING_GUARD',
  FAILED_GUARD: 'FAILED_GUARD',
  GUARD_MISSING_SUPPORT: 'GUARD_MISSING_SUPPORT',
  MISSING_ACTIVE_CANDIDATE: 'MISSING_ACTIVE_CANDIDATE',
  MISSING_NEXT_CANDIDATE: 'MISSING_NEXT_CANDIDATE',
  CANDIDATE_GENERATION_REUSE: 'CANDIDATE_GENERATION_REUSE',
  UNEXPECTED_NEXT_CANDIDATE: 'UNEXPECTED_NEXT_CANDIDATE',
  EMPTY_REASON: 'EMPTY_REASON',
} as const;
export type WorkflowRejectionCode =
  (typeof WorkflowRejectionCode)[keyof typeof WorkflowRejectionCode];

export interface WorkflowRejection {
  readonly code: WorkflowRejectionCode;
  readonly message: string;
  readonly failedGuard?: WorkflowGuard;
}

interface WorkflowCommandBase {
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly expectedVersion: WorkflowVersion;
  readonly occurredAt: IsoTimestamp;
  readonly reason: string;
}

export interface RequestPhaseTransition extends WorkflowCommandBase {
  readonly type: 'REQUEST_PHASE_TRANSITION';
  readonly requestedPhase: WorkflowPhaseType;
  readonly guardResults: readonly GuardResult[];
  readonly nextCandidateGenerationId?: CandidateGenerationId;
}

export interface CancelWorkflow extends WorkflowCommandBase {
  readonly type: 'CANCEL_WORKFLOW';
}

export type WorkflowCommand = RequestPhaseTransition | CancelWorkflow;

export interface WorkflowPhaseTransitioned {
  readonly type: 'WORKFLOW_PHASE_TRANSITIONED';
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly fromPhase: WorkflowPhaseType;
  readonly toPhase: WorkflowPhaseType;
  readonly fromVersion: WorkflowVersion;
  readonly toVersion: WorkflowVersion;
  readonly guardResults: readonly GuardResult[];
  readonly nextCandidateGenerationId?: CandidateGenerationId;
  readonly reason: string;
  readonly occurredAt: IsoTimestamp;
}

export interface WorkflowCancelled {
  readonly type: 'WORKFLOW_CANCELLED';
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly phase: WorkflowPhaseType;
  readonly fromVersion: WorkflowVersion;
  readonly toVersion: WorkflowVersion;
  readonly reason: string;
  readonly occurredAt: IsoTimestamp;
}

export type WorkflowEvent = WorkflowPhaseTransitioned | WorkflowCancelled;

export type WorkflowDecision =
  | { readonly accepted: true; readonly events: readonly [WorkflowEvent] }
  | { readonly accepted: false; readonly rejection: WorkflowRejection };

const discoveryToPlan = Object.freeze([
  WorkflowGuard.GOAL_REVISION_CURRENT,
  WorkflowGuard.PROJECT_IDENTITY_RECORDED,
  WorkflowGuard.DISCOVERY_COMPLETE,
  WorkflowGuard.REQUIRED_UNKNOWNS_RESOLVED,
  WorkflowGuard.SCENARIOS_RESOLVED,
]);

const planToImplement = Object.freeze([
  WorkflowGuard.PLAN_CURRENT,
  WorkflowGuard.CHANGE_BOUNDARY_EXPLICIT,
  WorkflowGuard.OBLIGATIONS_MAPPED,
  WorkflowGuard.PLAN_POLICY_PASSED,
  WorkflowGuard.NO_PLANNING_BLOCKER,
  WorkflowGuard.CANDIDATE_GENERATION_PREPARED,
]);

const implementToFreeze = Object.freeze([
  WorkflowGuard.MUTABLE_CANDIDATE_CURRENT,
  WorkflowGuard.WORKER_QUIESCENT,
  WorkflowGuard.CHANGE_SET_ENUMERATED,
  WorkflowGuard.PROHIBITED_EFFECTS_ABSENT,
  WorkflowGuard.FREEZE_REQUESTED,
]);

const freezeToEvidence = Object.freeze([
  WorkflowGuard.NO_WRITE_CAPABLE_WORKER,
  WorkflowGuard.FREEZE_IDENTITY_STABLE,
  WorkflowGuard.CHANGE_IDENTITY_RECORDED,
  WorkflowGuard.FROZEN_DIGEST_PERSISTED,
  WorkflowGuard.INTEGRITY_POLICY_PASSED,
]);

const evidenceToFinal = Object.freeze([
  WorkflowGuard.REQUIRED_EVIDENCE_ACCOUNTED,
  WorkflowGuard.EVIDENCE_BINDINGS_CURRENT,
  WorkflowGuard.CLEANUP_PROVEN,
  WorkflowGuard.SOURCE_DIGEST_CURRENT,
]);

const finalToCloseout = Object.freeze([WorkflowGuard.CURRENT_ACCEPTANCE]);
const finalToImplement = Object.freeze([
  WorkflowGuard.REJECT_REPAIRABLE_RECORDED,
  WorkflowGuard.CANDIDATE_GENERATION_PREPARED,
]);

export function requiredGuardsForTransition(
  from: WorkflowPhaseType,
  to: WorkflowPhaseType,
): readonly WorkflowGuard[] | undefined {
  if (from === WorkflowPhase.DISCOVERY && to === WorkflowPhase.PLAN) {
    return discoveryToPlan;
  }
  if (from === WorkflowPhase.PLAN && to === WorkflowPhase.IMPLEMENT) {
    return planToImplement;
  }
  if (from === WorkflowPhase.IMPLEMENT && to === WorkflowPhase.SOURCE_FREEZE) {
    return implementToFreeze;
  }
  if (from === WorkflowPhase.SOURCE_FREEZE && to === WorkflowPhase.EVIDENCE_BUILD) {
    return freezeToEvidence;
  }
  if (from === WorkflowPhase.EVIDENCE_BUILD && to === WorkflowPhase.FINAL_VERIFY) {
    return evidenceToFinal;
  }
  if (from === WorkflowPhase.FINAL_VERIFY && to === WorkflowPhase.CLOSEOUT) {
    return finalToCloseout;
  }
  if (from === WorkflowPhase.FINAL_VERIFY && to === WorkflowPhase.IMPLEMENT) {
    return finalToImplement;
  }
  return undefined;
}

function reject(
  code: WorkflowRejectionCode,
  message: string,
  failedGuard?: WorkflowGuard,
): WorkflowDecision {
  return failedGuard === undefined
    ? { accepted: false, rejection: { code, message } }
    : { accepted: false, rejection: { code, message, failedGuard } };
}

function validateCommandIdentity(
  workflow: WorkflowInstance,
  command: WorkflowCommand,
): WorkflowDecision | undefined {
  if (command.workflowId !== workflow.id) {
    return reject(WorkflowRejectionCode.WORKFLOW_ID_MISMATCH, 'Command targets another Workflow');
  }
  if (command.expectedVersion !== workflow.version) {
    return reject(WorkflowRejectionCode.STALE_VERSION, 'Command expectedVersion is stale');
  }
  if (workflow.runStatus === RunStatus.CANCELLED || workflow.runStatus === RunStatus.CLOSED) {
    return reject(WorkflowRejectionCode.TERMINAL_WORKFLOW, 'Terminal Workflow cannot mutate');
  }
  if (command.reason.trim().length === 0) {
    return reject(WorkflowRejectionCode.EMPTY_REASON, 'Workflow command reason must not be empty');
  }
  return undefined;
}

function validateGuardResults(
  required: readonly WorkflowGuard[],
  actual: readonly GuardResult[],
):
  | { readonly valid: true; readonly guardResults: readonly GuardResult[] }
  | { readonly valid: false; readonly rejection: WorkflowRejection } {
  const requiredSet = new Set<WorkflowGuard>(required);
  const byGuard = new Map<WorkflowGuard, GuardResult>();

  for (const result of actual) {
    if (byGuard.has(result.guard)) {
      return {
        valid: false,
        rejection: {
          code: WorkflowRejectionCode.DUPLICATE_GUARD,
          message: `Guard ${result.guard} was supplied more than once`,
          failedGuard: result.guard,
        },
      };
    }
    if (!requiredSet.has(result.guard)) {
      return {
        valid: false,
        rejection: {
          code: WorkflowRejectionCode.UNEXPECTED_GUARD,
          message: `Guard ${result.guard} is not part of this transition`,
          failedGuard: result.guard,
        },
      };
    }
    byGuard.set(result.guard, result);
  }

  const ordered: GuardResult[] = [];
  for (const guard of required) {
    const result = byGuard.get(guard);
    if (result === undefined) {
      return {
        valid: false,
        rejection: {
          code: WorkflowRejectionCode.MISSING_GUARD,
          message: `Required guard ${guard} is missing`,
          failedGuard: guard,
        },
      };
    }
    if (result.outcome !== GuardOutcome.PASS) {
      return {
        valid: false,
        rejection: {
          code: WorkflowRejectionCode.FAILED_GUARD,
          message: `Required guard ${guard} did not pass`,
          failedGuard: guard,
        },
      };
    }
    if (result.supportingRefs.length === 0) {
      return {
        valid: false,
        rejection: {
          code: WorkflowRejectionCode.GUARD_MISSING_SUPPORT,
          message: `Passing guard ${guard} has no supporting reference`,
          failedGuard: guard,
        },
      };
    }
    ordered.push(result);
  }

  return { valid: true, guardResults: Object.freeze(ordered) };
}

function requiresActiveCandidate(phase: WorkflowPhaseType): boolean {
  return (
    phase === WorkflowPhase.IMPLEMENT ||
    phase === WorkflowPhase.SOURCE_FREEZE ||
    phase === WorkflowPhase.EVIDENCE_BUILD ||
    phase === WorkflowPhase.FINAL_VERIFY
  );
}

export function decideWorkflow(
  workflow: WorkflowInstance,
  command: WorkflowCommand,
): WorkflowDecision {
  const identityRejection = validateCommandIdentity(workflow, command);
  if (identityRejection !== undefined) {
    return identityRejection;
  }

  const toVersion = nextWorkflowVersion(workflow.version);
  if (command.type === 'CANCEL_WORKFLOW') {
    return {
      accepted: true,
      events: [
        Object.freeze({
          type: 'WORKFLOW_CANCELLED',
          commandId: command.commandId,
          workflowId: workflow.id,
          phase: workflow.phase,
          fromVersion: workflow.version,
          toVersion,
          reason: command.reason.trim(),
          occurredAt: command.occurredAt,
        }),
      ],
    };
  }

  if (workflow.runStatus !== RunStatus.READY) {
    return reject(
      WorkflowRejectionCode.RUN_STATUS_NOT_READY,
      'Phase transition requires runStatus READY',
    );
  }

  const requiredGuards = requiredGuardsForTransition(workflow.phase, command.requestedPhase);
  if (requiredGuards === undefined) {
    return reject(
      WorkflowRejectionCode.ILLEGAL_TRANSITION,
      `Transition ${workflow.phase} -> ${command.requestedPhase} is illegal`,
    );
  }

  if (
    requiresActiveCandidate(workflow.phase) &&
    workflow.activeCandidateGenerationId === undefined
  ) {
    return reject(
      WorkflowRejectionCode.MISSING_ACTIVE_CANDIDATE,
      `Phase ${workflow.phase} requires an active Candidate generation`,
    );
  }

  const entersImplement = command.requestedPhase === WorkflowPhase.IMPLEMENT;
  if (entersImplement && command.nextCandidateGenerationId === undefined) {
    return reject(
      WorkflowRejectionCode.MISSING_NEXT_CANDIDATE,
      'Entering IMPLEMENT requires a prepared Candidate generation',
    );
  }
  if (
    entersImplement &&
    workflow.activeCandidateGenerationId !== undefined &&
    command.nextCandidateGenerationId === workflow.activeCandidateGenerationId
  ) {
    return reject(
      WorkflowRejectionCode.CANDIDATE_GENERATION_REUSE,
      'Repair must use a new Candidate generation',
    );
  }
  if (!entersImplement && command.nextCandidateGenerationId !== undefined) {
    return reject(
      WorkflowRejectionCode.UNEXPECTED_NEXT_CANDIDATE,
      'Only a transition into IMPLEMENT may select a new Candidate generation',
    );
  }

  const guardValidation = validateGuardResults(requiredGuards, command.guardResults);
  if (!guardValidation.valid) {
    return { accepted: false, rejection: guardValidation.rejection };
  }

  const eventBase = {
    type: 'WORKFLOW_PHASE_TRANSITIONED' as const,
    commandId: command.commandId,
    workflowId: workflow.id,
    fromPhase: workflow.phase,
    toPhase: command.requestedPhase,
    fromVersion: workflow.version,
    toVersion,
    guardResults: guardValidation.guardResults,
    reason: command.reason.trim(),
    occurredAt: command.occurredAt,
  };
  const event: WorkflowPhaseTransitioned =
    command.nextCandidateGenerationId === undefined
      ? Object.freeze(eventBase)
      : Object.freeze({
          ...eventBase,
          nextCandidateGenerationId: command.nextCandidateGenerationId,
        });

  return { accepted: true, events: [event] };
}

export class DomainInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DomainInvariantError';
  }
}

export function applyWorkflowEvent(
  workflow: WorkflowInstance,
  event: WorkflowEvent,
): WorkflowInstance {
  if (event.workflowId !== workflow.id || event.fromVersion !== workflow.version) {
    throw new DomainInvariantError(
      'Workflow event identity or version does not match current state',
    );
  }
  if (event.toVersion !== nextWorkflowVersion(workflow.version)) {
    throw new DomainInvariantError('Workflow event must advance the version exactly once');
  }
  if (event.reason.trim().length === 0) {
    throw new DomainInvariantError('Workflow event reason must not be empty');
  }

  if (event.type === 'WORKFLOW_CANCELLED') {
    if (event.phase !== workflow.phase) {
      throw new DomainInvariantError('Cancellation event phase does not match current state');
    }
    return Object.freeze({
      ...workflow,
      runStatus: RunStatus.CANCELLED,
      version: event.toVersion,
      updatedAt: event.occurredAt,
    });
  }

  if (event.fromPhase !== workflow.phase) {
    throw new DomainInvariantError('Transition event fromPhase does not match current state');
  }

  const requiredGuards = requiredGuardsForTransition(event.fromPhase, event.toPhase);
  if (requiredGuards === undefined) {
    throw new DomainInvariantError('Transition event contains an illegal phase edge');
  }
  const guardValidation = validateGuardResults(requiredGuards, event.guardResults);
  if (!guardValidation.valid) {
    throw new DomainInvariantError(
      `Transition event guard is invalid: ${guardValidation.rejection.code}`,
    );
  }
  if (
    requiresActiveCandidate(workflow.phase) &&
    workflow.activeCandidateGenerationId === undefined
  ) {
    throw new DomainInvariantError('Transition event requires an active Candidate generation');
  }

  const entersImplement = event.toPhase === WorkflowPhase.IMPLEMENT;
  if (entersImplement && event.nextCandidateGenerationId === undefined) {
    throw new DomainInvariantError(
      'Transition event entering IMPLEMENT lacks a Candidate generation',
    );
  }
  if (entersImplement && event.nextCandidateGenerationId === workflow.activeCandidateGenerationId) {
    throw new DomainInvariantError('Transition event reuses the active Candidate generation');
  }
  if (!entersImplement && event.nextCandidateGenerationId !== undefined) {
    throw new DomainInvariantError('Transition event selects a Candidate outside IMPLEMENT');
  }

  const nextBase = {
    ...workflow,
    phase: event.toPhase,
    runStatus: event.toPhase === WorkflowPhase.CLOSEOUT ? RunStatus.CLOSED : RunStatus.READY,
    version: event.toVersion,
    updatedAt: event.occurredAt,
  };
  return event.nextCandidateGenerationId === undefined
    ? Object.freeze(nextBase)
    : Object.freeze({
        ...nextBase,
        activeCandidateGenerationId: event.nextCandidateGenerationId,
      });
}

export function createWorkflow(
  input: Omit<
    WorkflowInstance,
    | 'phase'
    | 'runStatus'
    | 'version'
    | 'updatedAt'
    | 'activeAttemptId'
    | 'activeCandidateGenerationId'
  >,
): WorkflowInstance {
  return Object.freeze({
    ...input,
    phase: WorkflowPhase.DISCOVERY,
    runStatus: RunStatus.READY,
    version: workflowVersion(1),
    updatedAt: input.createdAt,
  });
}
