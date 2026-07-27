# ADR 0010: Centralize command admission and bind persisted outcomes

- Status: Accepted
- Date: 2026-07-27

## Context

ADR 0009 requires deterministic application-command replay, but a public
`CommandOutput` identifies only its command and, for success, its Goal. It does
not by itself prove which processed-command aggregate row produced it. A
shape-valid outcome could therefore be replayed from the wrong Goal or Workflow
unless the storage contract carries and validates that missing authority
binding.

Command handlers also performed expected-version checks at different points.
Some paths could look up an Attempt, evaluate a guard, or inspect closeout state
before noticing that the caller's Workflow expectation was stale. The answer to
one stale operation could then depend on newer child state, and evaluators could
run for a command that was never eligible for planning.

Finally, a broad exception boundary labeled guard/evaluator and runtime defects
as persistence failures. That classification obscures the owning component and
makes retry and diagnosis policy unsafe.

## Decision

### Central command admission

For a previously unseen, well-formed command against an existing target, the
Runtime MUST use this order:

1. derive the canonical command-input digest and check for an existing command;
2. resolve the authoritative top-level Goal/Workflow snapshot;
3. for a Goal command, compare the expected Goal revision;
4. compare the expected Workflow version;
5. only then look up child entities, evaluate guards or closeout eligibility,
   allocate identifiers, or perform domain planning;
6. commit state, audit events, and the command outcome atomically while the
   Store revalidates identity and Workflow version.

A deterministic stale rejection is stored against the observed Workflow
version under ADR 0009. If that version races before commit, the Runtime reloads
and reevaluates rather than persisting a rejection derived from an obsolete
snapshot.

### Stored command outcome identity

The public `CommandOutput` remains schema version 1. Persistence stores it
inside `StoredCommandOutcomeEnvelope` schema version 2 containing:

- the exact Goal or Workflow target;
- the authoritative owning `GoalId`;
- the nested public command output.

Before replay, the Runtime MUST validate the row's input digest, row target,
envelope target, nested `CommandId`, authoritative owning Goal, and, for a
successful output, its `goalId`. The SQLite adapter MUST enforce the same
intrinsic and target/Goal bindings at its write boundary.

Existing processed outcomes without these bindings cannot be given an owner
without inference. Migration 0005 therefore MUST fail closed when such rows
exist. It MUST NOT silently rewrite a legacy public output into an authority
envelope. Development environments may be deliberately reset or migrated only
after their history is inspected.

### Failure ownership

- Exceptions raised by the phase-guard or policy-evaluation port map to an
  evaluation failure.
- Exceptions raised while invoking a control-store operation map to a
  persistence failure.
- Runtime computation, invariant, digest, clock, identifier, or outcome-binding
  defects map to an internal failure unless a more specific contract error
  applies.

Evaluation, persistence, and internal failures are infrastructure failures, not
deterministic domain decisions, and MUST NOT create processed-command outcomes.
Adapter exception class names remain outside the Runtime protocol.

This ADR refines ADR 0009. It does not change the distinction between trusted
application commands and untrusted worker events.

## Consequences

- Every stale command receives the aggregate-freshness answer before newer
  child or guard state can influence it.
- Duplicate delivery can reuse an outcome only for the same command input,
  target, and owning Goal.
- A legacy development database containing unbound processed outcomes refuses
  migration until an operator deliberately resets or remediates it.
- Operational diagnostics and future retry policy can distinguish evaluator,
  store, and Runtime failures by their actual owner.
- The Runtime and SQLite adapter both validate identity bindings, providing an
  application authority check and a persistence backstop.

## Rejected alternatives

- **Infer the Goal from a legacy processed-command row during migration.**
  Rejected because an inferred historical authority binding cannot be proven
  from the stored public output in every case.
- **Check freshness inside each command planner.** Rejected because ordering
  would drift as new child lookups and evaluators are added.
- **Trust a valid `CommandOutput` shape on replay.** Rejected because shape
  validation does not establish aggregate ownership.
- **Map every execution exception to persistence failure.** Rejected because it
  assigns faults to the wrong component and encourages unsafe retries.

## Validation

M1 tests must prove:

- a stale Workflow expectation wins over missing Attempt and closeout/guard
  details, and its deterministic rejection replays;
- no phase guard runs for a stale command;
- a shape-valid stored outcome bound to another Goal fails closed;
- SQLite rejects a processed outcome whose target and owning Goal disagree;
- migration 0005 refuses ambiguous legacy processed outcomes;
- evaluator exceptions are classified separately and are not persisted;
- persistence and internal failures retain their distinct Runtime categories.
