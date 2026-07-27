# ADR 0011: Make command outcomes store-authored and semantically bound

- Status: Accepted
- Date: 2026-07-27

## Context

ADR 0010 binds a persisted command outcome to its `CommandId`, aggregate
target, and owning `GoalId`. That identity binding prevents cross-aggregate
replay, but its schema version 2 envelope still lets a caller provide the full
public output to every persistence method.

Consequently, a state-changing transaction could be paired with a failed
output, and a deterministic rejection could be paired with a successful
output. Both records could satisfy the version 2 identity checks even though
the outcome contradicted the transaction. The same envelope also omitted the
owning `WorkflowId` and the exact Workflow snapshot against which the result
was produced.

The polymorphic `processed_commands` target cannot use one ordinary foreign
key. Migration 0005 emulated the relationship in a trigger, but its Goal branch
compared IDs without proving that the Goal existed. Runtime replay mirrored
that assumption by treating a Goal target ID as its own authority proof.

Finally, a `PhaseGuardEvaluator` is a port. Its TypeScript return annotation is
not runtime validation. A malformed return could escape the evaluator error
boundary and be misclassified as an internal planning failure.

## Decision

### Store-authored outcomes

The control Store MUST author every persisted command outcome inside the same
transaction that records its effect.

- State-changing commit ports receive the command event and audit identity;
  they MUST NOT receive a caller-authored public output or storage envelope.
- The rejection port receives a typed `DeterministicCommandError`; it MUST NOT
  receive a caller-authored success/failure envelope or an evaluator,
  persistence, internal, replay-integrity, or command-conflict error.
- After applying an event, the Store constructs the successful public output
  from the resulting authoritative Workflow snapshot.
- When recording a deterministic rejection, the Store constructs the failed
  public output from the supplied error and the authoritative Workflow snapshot
  whose version was revalidated in that transaction.
- The Runtime returns the Store-authored output after validating it. It MUST NOT
  return a separately constructed optimistic output as if that were the
  persisted authority.

### Outcome envelope version 3

`StoredCommandOutcomeEnvelope` schema version 3 is a discriminated union:

- `APPLIED` MUST contain a successful public output;
- `REJECTED` MUST contain a failed public output whose code belongs to the
  deterministic admitted-command rejection set;
- both variants bind the exact command target, owning `GoalId`, owning
  `WorkflowId`, and the Workflow version, phase, and run status observed after
  application or during rejection;
- an `APPLIED` public output MUST exactly match that Workflow snapshot;
- the Goal and Workflow MUST both exist, the Workflow MUST own the Goal, and a
  Workflow target MUST identify that same Workflow.

SQLite enforces these relationships at insertion time. Processed-command rows
are immutable after insertion. Runtime replay resolves the authoritative Goal
and Workflow for both target variants before returning an outcome.

Version 2 records do not contain enough information to prove whether their
output agreed with the historical transaction. Migration 0006 therefore MUST
fail closed when any pre-version-3 processed command exists. It MUST NOT infer
a disposition or historical Workflow snapshot. Development databases may be
reset only after deliberate operator inspection.

### Guard evaluator boundary

`PhaseGuardEvaluator` output is untrusted boundary data at runtime. The Runtime
MUST decode the complete result array through a strict schema inside the same
error boundary as evaluator invocation. A thrown evaluator error or malformed
return is an `EVALUATION_FAILURE`, creates no processed-command outcome, and
MUST NOT be relabeled as command planning or persistence failure.

This ADR refines ADR 0010. ADR 0010's admission ordering and identity-binding
requirements remain in force; schema version 3 strengthens the persisted
outcome contract.

## Consequences

- Public persistence APIs cannot represent the previously possible
  apply/failure and reject/success combinations.
- Infrastructure failures cannot be inserted into deterministic command replay
  history through the rejection port.
- Replay authority identifies both aggregates and the historical Workflow
  snapshot without trusting target-string equality.
- SQLite remains a defense-in-depth authority boundary even if a future Runtime
  adapter is defective.
- Existing development databases with processed version 2 outcomes require a
  deliberate reset or separately reviewed remediation before migration.
- Store test doubles must author outcomes from their applied state so they
  exercise the same contract as SQLite.
- Guard adapters may use TypeScript internally, but their returned value still
  crosses a runtime schema boundary.

## Rejected alternatives

- **Add polarity checks while retaining caller-authored envelopes.** Rejected
  because callers could still forge Workflow version, phase, or run status and
  the Store would remain dependent on upstream construction discipline.
- **Infer version 3 fields from version 2 rows.** Rejected because current state
  cannot prove the historical state or whether the old output matched the
  committed transaction.
- **Trust Goal target equality without loading authority.** Rejected because a
  string can name a nonexistent record.
- **Rely on the `PhaseGuardEvaluator` TypeScript signature.** Rejected because
  adapter responses and JavaScript runtime values are not protected by erased
  compile-time types.

## Validation

M1 tests MUST prove:

- committed mutations persist only `APPLIED` success outcomes derived from the
  resulting Workflow;
- recorded deterministic rejections persist only `REJECTED` failed outcomes
  bound to the observed Workflow;
- evaluator, persistence, internal, replay-integrity, and command-conflict
  errors cannot be stored as deterministic rejections;
- SQLite rejects disposition/output mismatch, Workflow snapshot mismatch,
  cross-Goal binding, and missing Goal or Workflow authority;
- Runtime replay rejects a missing, mismatched, or malformed Goal/Workflow
  binding;
- migration 0006 refuses version 2 processed outcomes without partial schema
  application;
- evaluator exceptions and malformed evaluator returns are both classified as
  `EVALUATION_FAILURE` and are not persisted;
- transaction rollback still covers state, audit, and the Store-authored
  outcome together.
