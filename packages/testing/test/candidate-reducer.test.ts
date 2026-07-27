import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
  CandidateGenerationState,
  CandidateRejectionCode,
  aggregateVersion,
  applyCandidateEvent,
  candidateGenerationId,
  candidateId,
  commandId,
  decideCandidate,
  isoTimestamp,
  sha256Digest,
  type CandidateCommand,
  type CandidateDecision,
  type CandidateGeneration,
  type CandidateGenerationState as CandidateGenerationStateType,
  type CandidateStateChanged,
} from '@codeclosure/domain';

const occurredAt = isoTimestamp('2026-07-27T00:00:00.000Z');
const baseDigest = sha256Digest(`sha256:${'a'.repeat(64)}`);
const frozenDigest = sha256Digest(`sha256:${'b'.repeat(64)}`);

function candidateAt(
  state: CandidateGenerationStateType = CandidateGenerationState.MUTABLE,
): CandidateGeneration {
  return {
    id: candidateGenerationId('generation_reducer'),
    candidateId: candidateId('candidate_reducer'),
    sequence: 1,
    workspaceIdentity: 'fixture://candidate/reducer',
    state,
    baseDigest,
    version: aggregateVersion(1),
    createdAt: occurredAt,
    updatedAt: occurredAt,
    ...(state === CandidateGenerationState.FROZEN ? { frozenDigest, frozenAt: occurredAt } : {}),
  };
}

function command(candidate: CandidateGeneration, type: CandidateCommand['type']): CandidateCommand {
  const base = {
    commandId: commandId(`command_${type.toLowerCase().replaceAll('_', '-')}`),
    candidateGenerationId: candidate.id,
    expectedVersion: candidate.version,
    occurredAt,
  };
  switch (type) {
    case 'BEGIN_CANDIDATE_FREEZE':
      return { ...base, type };
    case 'COMPLETE_CANDIDATE_FREEZE':
      return { ...base, type, frozenDigest };
    case 'INVALIDATE_CANDIDATE':
      return { ...base, type, reason: 'integrity no longer current' };
    case 'REJECT_CANDIDATE':
      return { ...base, type, reason: 'acceptance rejected candidate' };
    case 'ACCEPT_CANDIDATE':
      return { ...base, type };
  }
}

function acceptedEvent(decision: CandidateDecision): CandidateStateChanged {
  if (!decision.accepted) {
    assert.fail(`Expected accepted decision, received ${decision.rejection.code}`);
  }
  return decision.events[0];
}

void test('[I-012] Candidate freeze follows MUTABLE -> FREEZING -> FROZEN exactly', () => {
  let candidate = candidateAt();
  candidate = applyCandidateEvent(
    candidate,
    acceptedEvent(decideCandidate(candidate, command(candidate, 'BEGIN_CANDIDATE_FREEZE'))),
  );
  assert.equal(candidate.state, CandidateGenerationState.FREEZING);
  assert.equal(candidate.frozenDigest, undefined);

  candidate = applyCandidateEvent(
    candidate,
    acceptedEvent(decideCandidate(candidate, command(candidate, 'COMPLETE_CANDIDATE_FREEZE'))),
  );
  assert.equal(candidate.state, CandidateGenerationState.FROZEN);
  assert.equal(candidate.frozenDigest, frozenDigest);

  candidate = applyCandidateEvent(
    candidate,
    acceptedEvent(decideCandidate(candidate, command(candidate, 'ACCEPT_CANDIDATE'))),
  );
  assert.equal(candidate.state, CandidateGenerationState.ACCEPTED);
});

void test('[I-012] no Candidate command can return a non-MUTABLE generation to MUTABLE', () => {
  const stateArbitrary = fc.constantFrom<CandidateGenerationStateType>(
    CandidateGenerationState.FREEZING,
    CandidateGenerationState.FROZEN,
    CandidateGenerationState.INVALIDATED,
    CandidateGenerationState.REJECTED,
    CandidateGenerationState.ACCEPTED,
  );
  const commandArbitrary = fc.constantFrom<CandidateCommand['type']>(
    'BEGIN_CANDIDATE_FREEZE',
    'COMPLETE_CANDIDATE_FREEZE',
    'INVALIDATE_CANDIDATE',
    'REJECT_CANDIDATE',
    'ACCEPT_CANDIDATE',
  );

  fc.assert(
    fc.property(stateArbitrary, commandArbitrary, (state, commandType) => {
      const candidate = candidateAt(state);
      const decision = decideCandidate(candidate, command(candidate, commandType));
      if (decision.accepted) {
        assert.notEqual(decision.events[0].toState, CandidateGenerationState.MUTABLE);
      }
    }),
  );
});

void test('[I-003] Candidate acceptance and rejection require a frozen generation', () => {
  for (const type of ['ACCEPT_CANDIDATE', 'REJECT_CANDIDATE'] as const) {
    const candidate = candidateAt(CandidateGenerationState.MUTABLE);
    const decision = decideCandidate(candidate, command(candidate, type));

    assert.equal(decision.accepted, false);
    assert.equal(decision.rejection.code, CandidateRejectionCode.ILLEGAL_CANDIDATE_TRANSITION);
  }
});

void test('[I-008][I-012] stale and terminal Candidate commands fail closed', () => {
  const candidate = candidateAt();
  const stale = decideCandidate(candidate, {
    ...command(candidate, 'BEGIN_CANDIDATE_FREEZE'),
    expectedVersion: aggregateVersion(2),
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.rejection.code, CandidateRejectionCode.STALE_VERSION);

  const terminal = candidateAt(CandidateGenerationState.INVALIDATED);
  const afterTerminal = decideCandidate(terminal, command(terminal, 'ACCEPT_CANDIDATE'));
  assert.equal(afterTerminal.accepted, false);
  assert.equal(afterTerminal.rejection.code, CandidateRejectionCode.TERMINAL_CANDIDATE);
});

void test('[I-008] Candidate event application rejects replay against a new version', () => {
  const candidate = candidateAt();
  const event = acceptedEvent(
    decideCandidate(candidate, command(candidate, 'BEGIN_CANDIDATE_FREEZE')),
  );
  const freezing = applyCandidateEvent(candidate, event);

  assert.throws(() => applyCandidateEvent(freezing, event), /does not match current state/);
  assert.throws(
    () =>
      applyCandidateEvent(candidate, {
        ...event,
        toState: CandidateGenerationState.MUTABLE,
      }),
    /illegal state transition/,
  );
  assert.throws(
    () => applyCandidateEvent(candidate, { ...event, toVersion: aggregateVersion(3) }),
    /version exactly once/,
  );
});
