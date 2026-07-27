import {
  nextAggregateVersion,
  type AggregateVersion,
  type CandidateGenerationId,
  type CandidateId,
  type CommandId,
  type IsoTimestamp,
  type Sha256Digest,
} from './identifiers.js';
import { CandidateGenerationState } from './model.js';
import { DomainInvariantError } from './workflow.js';

export interface CandidateGeneration {
  readonly id: CandidateGenerationId;
  readonly candidateId: CandidateId;
  readonly sequence: number;
  readonly parentGenerationId?: CandidateGenerationId;
  readonly workspaceIdentity: string;
  readonly state: CandidateGenerationState;
  readonly baseDigest: Sha256Digest;
  readonly frozenDigest?: Sha256Digest;
  readonly invalidationReason?: string;
  readonly version: AggregateVersion;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly frozenAt?: IsoTimestamp;
}

interface CandidateCommandBase {
  readonly commandId: CommandId;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly expectedVersion: AggregateVersion;
  readonly occurredAt: IsoTimestamp;
}

export type CandidateCommand =
  | (CandidateCommandBase & { readonly type: 'BEGIN_CANDIDATE_FREEZE' })
  | (CandidateCommandBase & {
      readonly type: 'COMPLETE_CANDIDATE_FREEZE';
      readonly frozenDigest: Sha256Digest;
    })
  | (CandidateCommandBase & { readonly type: 'INVALIDATE_CANDIDATE'; readonly reason: string })
  | (CandidateCommandBase & { readonly type: 'REJECT_CANDIDATE'; readonly reason: string })
  | (CandidateCommandBase & { readonly type: 'ACCEPT_CANDIDATE' });

export const CandidateRejectionCode = {
  CANDIDATE_ID_MISMATCH: 'CANDIDATE_ID_MISMATCH',
  STALE_VERSION: 'STALE_VERSION',
  TERMINAL_CANDIDATE: 'TERMINAL_CANDIDATE',
  ILLEGAL_CANDIDATE_TRANSITION: 'ILLEGAL_CANDIDATE_TRANSITION',
  EMPTY_REASON: 'EMPTY_REASON',
} as const;
export type CandidateRejectionCode =
  (typeof CandidateRejectionCode)[keyof typeof CandidateRejectionCode];

export interface CandidateRejection {
  readonly code: CandidateRejectionCode;
  readonly message: string;
}

export interface CandidateStateChanged {
  readonly type: 'CANDIDATE_STATE_CHANGED';
  readonly commandId: CommandId;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly fromState: CandidateGenerationState;
  readonly toState: CandidateGenerationState;
  readonly fromVersion: AggregateVersion;
  readonly toVersion: AggregateVersion;
  readonly occurredAt: IsoTimestamp;
  readonly frozenDigest?: Sha256Digest;
  readonly reason?: string;
}

export type CandidateDecision =
  | { readonly accepted: true; readonly events: readonly [CandidateStateChanged] }
  | { readonly accepted: false; readonly rejection: CandidateRejection };

function reject(code: CandidateRejectionCode, message: string): CandidateDecision {
  return { accepted: false, rejection: { code, message } };
}

function isTerminal(state: CandidateGenerationState): boolean {
  return (
    state === CandidateGenerationState.INVALIDATED ||
    state === CandidateGenerationState.REJECTED ||
    state === CandidateGenerationState.ACCEPTED
  );
}

export function decideCandidate(
  candidate: CandidateGeneration,
  command: CandidateCommand,
): CandidateDecision {
  if (candidate.id !== command.candidateGenerationId) {
    return reject(
      CandidateRejectionCode.CANDIDATE_ID_MISMATCH,
      'Command targets another Candidate',
    );
  }
  if (candidate.version !== command.expectedVersion) {
    return reject(CandidateRejectionCode.STALE_VERSION, 'Command expectedVersion is stale');
  }
  if (isTerminal(candidate.state)) {
    return reject(CandidateRejectionCode.TERMINAL_CANDIDATE, 'Terminal Candidate cannot mutate');
  }

  let toState: CandidateGenerationState;
  let frozenDigest: Sha256Digest | undefined;
  let reason: string | undefined;

  switch (command.type) {
    case 'BEGIN_CANDIDATE_FREEZE': {
      if (candidate.state !== CandidateGenerationState.MUTABLE) {
        return reject(
          CandidateRejectionCode.ILLEGAL_CANDIDATE_TRANSITION,
          'Only a MUTABLE Candidate may begin freeze',
        );
      }
      toState = CandidateGenerationState.FREEZING;
      break;
    }
    case 'COMPLETE_CANDIDATE_FREEZE': {
      if (candidate.state !== CandidateGenerationState.FREEZING) {
        return reject(
          CandidateRejectionCode.ILLEGAL_CANDIDATE_TRANSITION,
          'Only a FREEZING Candidate may become FROZEN',
        );
      }
      toState = CandidateGenerationState.FROZEN;
      frozenDigest = command.frozenDigest;
      break;
    }
    case 'INVALIDATE_CANDIDATE': {
      reason = command.reason.trim();
      if (reason.length === 0) {
        return reject(CandidateRejectionCode.EMPTY_REASON, 'Invalidation reason must not be empty');
      }
      toState = CandidateGenerationState.INVALIDATED;
      break;
    }
    case 'REJECT_CANDIDATE': {
      if (candidate.state !== CandidateGenerationState.FROZEN) {
        return reject(
          CandidateRejectionCode.ILLEGAL_CANDIDATE_TRANSITION,
          'Only a FROZEN Candidate may be rejected',
        );
      }
      reason = command.reason.trim();
      if (reason.length === 0) {
        return reject(CandidateRejectionCode.EMPTY_REASON, 'Rejection reason must not be empty');
      }
      toState = CandidateGenerationState.REJECTED;
      break;
    }
    case 'ACCEPT_CANDIDATE': {
      if (candidate.state !== CandidateGenerationState.FROZEN) {
        return reject(
          CandidateRejectionCode.ILLEGAL_CANDIDATE_TRANSITION,
          'Only a FROZEN Candidate may be accepted',
        );
      }
      toState = CandidateGenerationState.ACCEPTED;
      break;
    }
  }

  const eventBase = {
    type: 'CANDIDATE_STATE_CHANGED' as const,
    commandId: command.commandId,
    candidateGenerationId: candidate.id,
    fromState: candidate.state,
    toState,
    fromVersion: candidate.version,
    toVersion: nextAggregateVersion(candidate.version),
    occurredAt: command.occurredAt,
  };
  const event: CandidateStateChanged = Object.freeze({
    ...eventBase,
    ...(frozenDigest === undefined ? {} : { frozenDigest }),
    ...(reason === undefined ? {} : { reason }),
  });

  return { accepted: true, events: [event] };
}

export function applyCandidateEvent(
  candidate: CandidateGeneration,
  event: CandidateStateChanged,
): CandidateGeneration {
  if (
    event.candidateGenerationId !== candidate.id ||
    event.fromVersion !== candidate.version ||
    event.fromState !== candidate.state
  ) {
    throw new DomainInvariantError('Candidate event does not match current state');
  }
  if (event.toVersion !== nextAggregateVersion(candidate.version)) {
    throw new DomainInvariantError('Candidate event must advance the version exactly once');
  }

  const hasReason = event.reason !== undefined && event.reason.trim().length > 0;
  const hasFrozenDigest = event.frozenDigest !== undefined;
  const isLegalTransition =
    (event.fromState === CandidateGenerationState.MUTABLE &&
      event.toState === CandidateGenerationState.FREEZING &&
      !hasReason &&
      !hasFrozenDigest) ||
    (event.fromState === CandidateGenerationState.FREEZING &&
      event.toState === CandidateGenerationState.FROZEN &&
      !hasReason &&
      hasFrozenDigest) ||
    (!isTerminal(event.fromState) &&
      event.toState === CandidateGenerationState.INVALIDATED &&
      hasReason &&
      !hasFrozenDigest) ||
    (event.fromState === CandidateGenerationState.FROZEN &&
      event.toState === CandidateGenerationState.REJECTED &&
      hasReason &&
      !hasFrozenDigest) ||
    (event.fromState === CandidateGenerationState.FROZEN &&
      event.toState === CandidateGenerationState.ACCEPTED &&
      !hasReason &&
      !hasFrozenDigest);

  if (!isLegalTransition) {
    throw new DomainInvariantError(
      'Candidate event contains an illegal state transition or payload',
    );
  }

  const next = {
    ...candidate,
    state: event.toState,
    version: event.toVersion,
    updatedAt: event.occurredAt,
    ...(event.frozenDigest === undefined
      ? {}
      : { frozenDigest: event.frozenDigest, frozenAt: event.occurredAt }),
    ...(event.toState === CandidateGenerationState.INVALIDATED
      ? { invalidationReason: event.reason }
      : {}),
  };
  return Object.freeze(next);
}
