import {
  aggregateVersion,
  candidateGenerationId,
  candidateId,
  isoTimestamp,
  nextAggregateVersion,
  sha256Digest,
  type AggregateVersion,
  type CandidateGenerationId,
  type CandidateId,
  type CommandId,
  type GoalId,
  type IsoTimestamp,
  type Sha256Digest,
} from './identifiers.js';
import { CandidateGenerationState } from './model.js';
import { DomainInvariantError } from './workflow.js';

export interface Candidate {
  readonly id: CandidateId;
  readonly goalId: GoalId;
  readonly baseProjectIdentity: string;
}

interface CandidateGenerationBase {
  readonly id: CandidateGenerationId;
  readonly candidateId: CandidateId;
  readonly sequence: number;
  readonly parentGenerationId?: CandidateGenerationId;
  readonly workspaceIdentity: string;
  readonly baseDigest: Sha256Digest;
  readonly version: AggregateVersion;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface MutableCandidateGeneration extends CandidateGenerationBase {
  readonly state: typeof CandidateGenerationState.MUTABLE;
  readonly frozenDigest?: never;
  readonly invalidationReason?: never;
  readonly frozenAt?: never;
}

export interface FreezingCandidateGeneration extends CandidateGenerationBase {
  readonly state: typeof CandidateGenerationState.FREEZING;
  readonly frozenDigest?: never;
  readonly invalidationReason?: never;
  readonly frozenAt?: never;
}

interface FrozenCandidateGenerationBase extends CandidateGenerationBase {
  readonly frozenDigest: Sha256Digest;
  readonly invalidationReason?: never;
  readonly frozenAt: IsoTimestamp;
}

export interface FrozenCandidateGeneration extends FrozenCandidateGenerationBase {
  readonly state: typeof CandidateGenerationState.FROZEN;
}

export interface RejectedCandidateGeneration extends FrozenCandidateGenerationBase {
  readonly state: typeof CandidateGenerationState.REJECTED;
}

export interface AcceptedCandidateGeneration extends FrozenCandidateGenerationBase {
  readonly state: typeof CandidateGenerationState.ACCEPTED;
}

interface InvalidatedCandidateGenerationBase extends CandidateGenerationBase {
  readonly state: typeof CandidateGenerationState.INVALIDATED;
  readonly invalidationReason: string;
}

export type InvalidatedCandidateGeneration = InvalidatedCandidateGenerationBase &
  (
    | { readonly frozenDigest?: never; readonly frozenAt?: never }
    | { readonly frozenDigest: Sha256Digest; readonly frozenAt: IsoTimestamp }
  );

export type CandidateGeneration =
  | MutableCandidateGeneration
  | FreezingCandidateGeneration
  | FrozenCandidateGeneration
  | InvalidatedCandidateGeneration
  | RejectedCandidateGeneration
  | AcceptedCandidateGeneration;

export interface UnvalidatedCandidateGeneration extends CandidateGenerationBase {
  readonly state: CandidateGenerationState;
  readonly frozenDigest?: Sha256Digest;
  readonly invalidationReason?: string;
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
  INVALID_TIMESTAMP_ORDER: 'INVALID_TIMESTAMP_ORDER',
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

export function assertCandidateInvariant(
  candidate: UnvalidatedCandidateGeneration,
): asserts candidate is CandidateGeneration {
  for (const key of [
    'parentGenerationId',
    'frozenDigest',
    'invalidationReason',
    'frozenAt',
  ] as const) {
    if (Object.hasOwn(candidate, key) && candidate[key] === undefined) {
      throw new DomainInvariantError(`Candidate optional field ${key} must be omitted`);
    }
  }
  candidateGenerationId(candidate.id);
  candidateId(candidate.candidateId);
  if (candidate.parentGenerationId !== undefined) {
    candidateGenerationId(candidate.parentGenerationId);
    if (candidate.parentGenerationId === candidate.id) {
      throw new DomainInvariantError('Candidate generation cannot be its own parent');
    }
  }
  aggregateVersion(candidate.version);
  sha256Digest(candidate.baseDigest);
  isoTimestamp(candidate.createdAt);
  isoTimestamp(candidate.updatedAt);
  if (candidate.frozenDigest !== undefined) {
    sha256Digest(candidate.frozenDigest);
  }
  if (candidate.frozenAt !== undefined) {
    isoTimestamp(candidate.frozenAt);
  }
  if (!Object.values(CandidateGenerationState).some((state) => state === candidate.state)) {
    throw new DomainInvariantError('Candidate state is unknown');
  }
  if (candidate.workspaceIdentity.trim().length === 0) {
    throw new DomainInvariantError('Candidate workspace identity must not be empty');
  }
  if (!Number.isSafeInteger(candidate.sequence) || candidate.sequence < 1) {
    throw new DomainInvariantError('Candidate sequence must be a positive safe integer');
  }
  if (!Number.isSafeInteger(candidate.version) || candidate.version < 1) {
    throw new DomainInvariantError('Candidate version must be a positive safe integer');
  }
  if (candidate.updatedAt < candidate.createdAt) {
    throw new DomainInvariantError('Candidate updatedAt cannot precede createdAt');
  }
  if (
    candidate.frozenAt !== undefined &&
    (candidate.frozenAt < candidate.createdAt || candidate.frozenAt > candidate.updatedAt)
  ) {
    throw new DomainInvariantError('Candidate frozenAt must remain inside its lifecycle interval');
  }

  const hasFrozenDigest = candidate.frozenDigest !== undefined;
  const hasFrozenAt = candidate.frozenAt !== undefined;
  if (hasFrozenDigest !== hasFrozenAt) {
    throw new DomainInvariantError('Candidate frozen identity must contain both digest and time');
  }

  switch (candidate.state) {
    case CandidateGenerationState.MUTABLE:
    case CandidateGenerationState.FREEZING:
      if (hasFrozenDigest || Object.hasOwn(candidate, 'invalidationReason')) {
        throw new DomainInvariantError('Unfrozen Candidate contains terminal identity fields');
      }
      return;
    case CandidateGenerationState.FROZEN:
    case CandidateGenerationState.REJECTED:
    case CandidateGenerationState.ACCEPTED:
      if (!hasFrozenDigest || Object.hasOwn(candidate, 'invalidationReason')) {
        throw new DomainInvariantError('Frozen Candidate identity fields are incomplete');
      }
      return;
    case CandidateGenerationState.INVALIDATED:
      if (
        candidate.invalidationReason === undefined ||
        candidate.invalidationReason.trim().length === 0
      ) {
        throw new DomainInvariantError('Invalidated Candidate requires a reason');
      }
      return;
  }
}

export function decideCandidate(
  candidate: CandidateGeneration,
  command: CandidateCommand,
): CandidateDecision {
  assertCandidateInvariant(candidate);
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
  if (command.occurredAt < candidate.updatedAt) {
    return reject(
      CandidateRejectionCode.INVALID_TIMESTAMP_ORDER,
      'Candidate command time cannot precede current Candidate state',
    );
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
  assertCandidateInvariant(candidate);
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
  if (event.occurredAt < candidate.updatedAt) {
    throw new DomainInvariantError('Candidate event time cannot precede current state');
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
  const result = Object.freeze(next);
  assertCandidateInvariant(result);
  return result;
}
