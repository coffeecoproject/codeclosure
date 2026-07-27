import { WorkflowPhase, type WorkflowPhase as WorkflowPhaseType } from './model.js';

export const CandidateAccess = {
  NONE: 'NONE',
  MUTABLE_WRITE: 'MUTABLE_WRITE',
  FREEZE_READ: 'FREEZE_READ',
  FROZEN_READ: 'FROZEN_READ',
  ACCEPTED_READ: 'ACCEPTED_READ',
} as const;
export type CandidateAccess = (typeof CandidateAccess)[keyof typeof CandidateAccess];

export const RunOutputScope = {
  BOUNDED_DISCOVERY: 'BOUNDED_DISCOVERY',
  PLAN_OBSERVATION: 'PLAN_OBSERVATION',
  BOUNDED_IMPLEMENTATION: 'BOUNDED_IMPLEMENTATION',
  FREEZE_METADATA: 'FREEZE_METADATA',
  RUN_OWNED_VERIFICATION: 'RUN_OWNED_VERIFICATION',
  DECISION_TRACE: 'DECISION_TRACE',
  CLOSEOUT_EXPORT: 'CLOSEOUT_EXPORT',
} as const;
export type RunOutputScope = (typeof RunOutputScope)[keyof typeof RunOutputScope];

export const ControlSubmission = {
  PROPOSALS: 'PROPOSALS',
  COMPLETION_REQUEST: 'COMPLETION_REQUEST',
  RUNTIME_ONLY: 'RUNTIME_ONLY',
  EVIDENCE_SUBMISSION: 'EVIDENCE_SUBMISSION',
  DECISION_SUBMISSION: 'DECISION_SUBMISSION',
  CONSUME_EXISTING: 'CONSUME_EXISTING',
} as const;
export type ControlSubmission = (typeof ControlSubmission)[keyof typeof ControlSubmission];

export const AcceptanceAccess = {
  NONE: 'NONE',
  EVALUATE_READ_ONLY: 'EVALUATE_READ_ONLY',
  CONSUME_EXISTING: 'CONSUME_EXISTING',
} as const;
export type AcceptanceAccess = (typeof AcceptanceAccess)[keyof typeof AcceptanceAccess];

export const PhaseAction = {
  READ_PROJECT: 'READ_PROJECT',
  READ_CANDIDATE: 'READ_CANDIDATE',
  WRITE_CANDIDATE_SOURCE: 'WRITE_CANDIDATE_SOURCE',
  WRITE_RUN_OUTPUT: 'WRITE_RUN_OUTPUT',
  SUBMIT_PROPOSALS: 'SUBMIT_PROPOSALS',
  SUBMIT_COMPLETION_REQUEST: 'SUBMIT_COMPLETION_REQUEST',
  SUBMIT_EVIDENCE: 'SUBMIT_EVIDENCE',
  SUBMIT_DECISION: 'SUBMIT_DECISION',
  EVALUATE_ACCEPTANCE: 'EVALUATE_ACCEPTANCE',
  CONSUME_ACCEPTANCE: 'CONSUME_ACCEPTANCE',
} as const;
export type PhaseAction = (typeof PhaseAction)[keyof typeof PhaseAction];

export interface CapabilityGrant {
  readonly phase: WorkflowPhaseType;
  readonly projectRead: true;
  readonly candidateAccess: CandidateAccess;
  readonly runOutputScope: RunOutputScope;
  readonly controlSubmission: ControlSubmission;
  readonly acceptanceAccess: AcceptanceAccess;
  readonly allowedActions: readonly PhaseAction[];
}

export type UnvalidatedCapabilityGrant = Omit<CapabilityGrant, 'projectRead'> & {
  readonly projectRead: unknown;
};

function grant(
  phase: WorkflowPhaseType,
  candidateAccess: CandidateAccess,
  runOutputScope: RunOutputScope,
  controlSubmission: ControlSubmission,
  acceptanceAccess: AcceptanceAccess,
  allowedActions: readonly PhaseAction[],
): CapabilityGrant {
  return Object.freeze({
    phase,
    projectRead: true,
    candidateAccess,
    runOutputScope,
    controlSubmission,
    acceptanceAccess,
    allowedActions: Object.freeze([...allowedActions]),
  });
}

export function deriveCapabilityGrant(phase: WorkflowPhaseType): CapabilityGrant {
  switch (phase) {
    case WorkflowPhase.DISCOVERY:
      return grant(
        phase,
        CandidateAccess.NONE,
        RunOutputScope.BOUNDED_DISCOVERY,
        ControlSubmission.PROPOSALS,
        AcceptanceAccess.NONE,
        [PhaseAction.READ_PROJECT, PhaseAction.WRITE_RUN_OUTPUT, PhaseAction.SUBMIT_PROPOSALS],
      );
    case WorkflowPhase.PLAN:
      return grant(
        phase,
        CandidateAccess.NONE,
        RunOutputScope.PLAN_OBSERVATION,
        ControlSubmission.PROPOSALS,
        AcceptanceAccess.NONE,
        [PhaseAction.READ_PROJECT, PhaseAction.WRITE_RUN_OUTPUT, PhaseAction.SUBMIT_PROPOSALS],
      );
    case WorkflowPhase.IMPLEMENT:
      return grant(
        phase,
        CandidateAccess.MUTABLE_WRITE,
        RunOutputScope.BOUNDED_IMPLEMENTATION,
        ControlSubmission.COMPLETION_REQUEST,
        AcceptanceAccess.NONE,
        [
          PhaseAction.READ_PROJECT,
          PhaseAction.READ_CANDIDATE,
          PhaseAction.WRITE_CANDIDATE_SOURCE,
          PhaseAction.WRITE_RUN_OUTPUT,
          PhaseAction.SUBMIT_COMPLETION_REQUEST,
        ],
      );
    case WorkflowPhase.SOURCE_FREEZE:
      return grant(
        phase,
        CandidateAccess.FREEZE_READ,
        RunOutputScope.FREEZE_METADATA,
        ControlSubmission.RUNTIME_ONLY,
        AcceptanceAccess.NONE,
        [PhaseAction.READ_PROJECT, PhaseAction.READ_CANDIDATE, PhaseAction.WRITE_RUN_OUTPUT],
      );
    case WorkflowPhase.EVIDENCE_BUILD:
      return grant(
        phase,
        CandidateAccess.FROZEN_READ,
        RunOutputScope.RUN_OWNED_VERIFICATION,
        ControlSubmission.EVIDENCE_SUBMISSION,
        AcceptanceAccess.NONE,
        [
          PhaseAction.READ_PROJECT,
          PhaseAction.READ_CANDIDATE,
          PhaseAction.WRITE_RUN_OUTPUT,
          PhaseAction.SUBMIT_EVIDENCE,
        ],
      );
    case WorkflowPhase.FINAL_VERIFY:
      return grant(
        phase,
        CandidateAccess.FROZEN_READ,
        RunOutputScope.DECISION_TRACE,
        ControlSubmission.DECISION_SUBMISSION,
        AcceptanceAccess.EVALUATE_READ_ONLY,
        [
          PhaseAction.READ_PROJECT,
          PhaseAction.READ_CANDIDATE,
          PhaseAction.WRITE_RUN_OUTPUT,
          PhaseAction.SUBMIT_DECISION,
          PhaseAction.EVALUATE_ACCEPTANCE,
        ],
      );
    case WorkflowPhase.CLOSEOUT:
      return grant(
        phase,
        CandidateAccess.ACCEPTED_READ,
        RunOutputScope.CLOSEOUT_EXPORT,
        ControlSubmission.CONSUME_EXISTING,
        AcceptanceAccess.CONSUME_EXISTING,
        [
          PhaseAction.READ_PROJECT,
          PhaseAction.READ_CANDIDATE,
          PhaseAction.WRITE_RUN_OUTPUT,
          PhaseAction.CONSUME_ACCEPTANCE,
        ],
      );
  }
}

export function capabilityAllows(grantToCheck: CapabilityGrant, action: PhaseAction): boolean {
  return grantToCheck.allowedActions.includes(action);
}

function sameActions(left: readonly PhaseAction[], right: readonly PhaseAction[]): boolean {
  return left.length === right.length && left.every((action, index) => action === right[index]);
}

export function isCanonicalCapabilityGrant(grantToCheck: UnvalidatedCapabilityGrant): boolean {
  if (
    grantToCheck.projectRead !== true ||
    !Object.values(WorkflowPhase).some((phase) => phase === grantToCheck.phase) ||
    !Array.isArray(grantToCheck.allowedActions)
  ) {
    return false;
  }
  const expected = deriveCapabilityGrant(grantToCheck.phase);
  return (
    grantToCheck.candidateAccess === expected.candidateAccess &&
    grantToCheck.runOutputScope === expected.runOutputScope &&
    grantToCheck.controlSubmission === expected.controlSubmission &&
    grantToCheck.acceptanceAccess === expected.acceptanceAccess &&
    sameActions(grantToCheck.allowedActions, expected.allowedActions)
  );
}
