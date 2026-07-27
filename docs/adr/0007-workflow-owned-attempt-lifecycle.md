# ADR 0007: Workflow-owned Attempt lifecycle

- Status: Accepted
- Date: 2026-07-27

## Context

An Attempt records one bounded operation within a Workflow phase. Starting,
finishing, interrupting, or retrying an Attempt changes whether that Workflow
is ready or running and which Attempt is active. Cancellation and recovery must
also reconcile both records without allowing a late worker result to overwrite
a newer control decision.

Giving Workflow and Attempt independent optimistic-concurrency versions would
create two mutation clocks for one M1 control decision. A result/cancellation
race could update one record while leaving the other stale unless every caller
implemented a multi-aggregate protocol. M1 permits only one active Attempt per
Workflow and has no parallel-agent scheduling requirement.

## Decision

In M1, Attempt is a child entity owned by the Workflow aggregate. It is not an
independently versioned aggregate.

- `WorkflowInstance.version` is the optimistic-concurrency version for phase,
  run-status, active-Attempt, and Attempt-lifecycle mutations.
- `BeginAttempt`, result admission, failure, interruption, retry creation,
  cancellation, and recovery commands MUST identify the expected Workflow
  version.
- A successful Attempt mutation MUST update the Attempt row, Workflow current
  state and version, append audit event(s), and record the command outcome in
  one transaction.
- At most one Attempt may be `RUNNING` and active for a Workflow in M1.
- An Attempt may leave `RUNNING` once, becoming `RESULT_RECORDED`, `FAILED`, or
  `INTERRUPTED`. A terminal Attempt is immutable.
- A late or duplicate worker result for a no-longer-active Attempt MUST NOT
  mutate the Workflow. Duplicate command delivery may replay only the stored
  outcome defined by the idempotency contract.
- Goal cancellation MUST interrupt an active `RUNNING` Attempt and set the
  Workflow to `CANCELLED` atomically.
- Recovery MUST persist interruption or another explicit reconciliation result
  and advance the Workflow version before dispatching replacement work.

The lack of an Attempt version does not violate the rule that mutable
aggregates are versioned: Attempt is inside the versioned Workflow aggregate
boundary.

## Consequences

- Result-versus-cancellation and result-versus-recovery races are serialized by
  one expected Workflow version.
- Every Attempt lifecycle change advances the Workflow version even when the
  phase does not change.
- Runtime commands and audit views can explain one ordered control history
  without reconciling two version streams.
- The SQLite store must support transactional Workflow-plus-Attempt mutations;
  adapters cannot update Attempt status directly.
- A future milestone that introduces parallel active Attempts or multi-agent
  scheduling must revisit this aggregate boundary through a new ADR and data
  migration. That capability is outside M1.

## Rejected alternatives

- **Give Attempt its own aggregate version in M1.** Rejected because the
  additional concurrency protocol provides no benefit while only one Attempt
  may be active, and it increases the risk of split Workflow/Attempt state.
- **Treat Attempt as append-only and infer its end from worker messages.**
  Rejected because recovery and retry need an authoritative terminal lifecycle
  state outside the conversation.
- **Allow adapters to finish Attempts directly.** Rejected because adapters do
  not own Workflow state and a worker result is not a transition authority.

## Validation

M1 tests must prove:

- beginning an Attempt atomically records `RUNNING`, selects it as active, and
  advances the Workflow version;
- a result/cancellation race permits exactly one mutation at a shared expected
  version;
- cancellation interrupts the active Attempt and never records `CLOSED`;
- a stale or non-active Attempt result writes no state, audit success, or new
  command outcome;
- restart finds persisted `RUNNING` Attempts and records reconciliation before
  any replacement dispatch;
- injected failures roll back Workflow, Attempt, audit, and idempotency records
  together.
