# ADR 0012: Preserve causal order for control timestamps

- Status: Accepted
- Date: 2026-07-27

## Context

ADR 0004 requires injected timestamps and monotonically increasing aggregate
versions, while ADR 0006 fixes the timestamp representation. Neither record
defines what happens when a valid host clock moves backward or when a
shape-valid event carries a time earlier than the current aggregate snapshot.

The early M1 reducers copied `Clock.now()` into events and current state. A
clock rollback could therefore advance a Workflow version while moving its
`updatedAt` backward. The same gap existed for Candidate transitions and for
an Attempt start or finish relative to its owning Workflow. Such state is hard
to explain, can misorder audit and command records, and makes later freshness
or recovery rules unsafe if they use time.

Timestamp ordering does not replace optimistic concurrency. Version remains
the mutation clock and authority boundary; timestamps describe when that
ordered mutation was recorded.

## Decision

Every mutable control aggregate has a causal timestamp floor.

- A Workflow command or event MUST NOT occur before the current
  `WorkflowInstance.updatedAt`.
- An Attempt mutation MUST NOT occur before the owning Workflow's `updatedAt`.
  A terminal Attempt time also MUST NOT precede its `startedAt`.
- A Candidate command or event MUST NOT occur before the current Candidate
  generation's `updatedAt`.
- Aggregate `updatedAt` MUST NOT precede `createdAt`. Candidate `frozenAt`, when
  present, MUST remain within the generation's creation/update interval.

For Runtime-owned command timestamps, the Runtime MUST:

1. obtain the value from the injected `Clock`;
2. validate it as the canonical ADR 0006 timestamp representation;
3. choose the later of that value and every applicable causal floor;
4. use that one effective timestamp for the event, resulting current state,
   audit records, and applied command record.

A valid clock value earlier than the causal floor is clamped to the floor. The
Runtime MUST NOT invent a one-millisecond increment merely to make timestamps
unique. Versions and audit sequence numbers provide strict ordering when two
mutations share a timestamp.

A malformed clock value is a Runtime internal failure under ADR 0010. It is not
clamped and MUST NOT create a processed-command outcome. A direct or bypassed
command/event whose supplied timestamp is earlier than current state is
rejected by the owning domain boundary. The Store revalidates the resulting
state, and SQLite mirrors the monotonic rules as defense in depth.

A deterministic rejection is not a state mutation, but its
`processed_commands.completed_at` MUST NOT precede the Workflow snapshot
against which the rejection was recorded. The Runtime applies the same causal
floor before invoking the Store.

Terminal Workflow immutability remains required by I-008 and the existing
state-machine contract. Event application and SQLite MUST enforce that rule
even when a caller bypasses command decision logic. This is an implementation
backstop, not a new terminal-state meaning.

This ADR refines ADR 0004's timestamp behavior and ADR 0006's representation
rules. It does not change their versioning, transaction, or digest decisions.

## Consequences

- Host clock correction cannot make authoritative control history move
  backward.
- Equal timestamps are valid; aggregate versions and audit sequences retain
  exact mutation order.
- Reducers remain safe when tested or invoked independently of the Runtime.
- Store and SQLite boundaries reject older forged events instead of trusting
  an upstream caller.
- Historical audit and processed-command rows keep their original timestamps;
  they are not compared with a later current snapshot during migration.
- Future time-window policies must use an explicitly named observed time and
  must not infer concurrency from timestamp equality.

## Rejected alternatives

- **Copy the host clock directly.** Rejected because a valid wall clock can
  move backward while control state must remain causally ordered.
- **Fail every command when the host clock moves backward.** Rejected because a
  valid clock correction need not stop deterministic local control; clamping
  preserves ordering without claiming a later physical observation.
- **Always add one millisecond.** Rejected because it invents physical time and
  is unnecessary when versions already provide strict ordering.
- **Enforce ordering only in SQLite.** Rejected because pure reducers and other
  future Store adapters must preserve the same domain rule.

## Validation

M1 tests MUST prove:

- Runtime clock rollback produces a nondecreasing Workflow timestamp;
- malformed Runtime clock output fails as an internal error without a stored
  command outcome;
- direct Workflow, Attempt, and Candidate events earlier than current state
  are rejected;
- a fresh-version event cannot mutate a terminal Workflow;
- SQLite rejects backward current-state timestamps, an Attempt end older than
  its owning Workflow state, a repeated terminal Workflow mutation, and a
  processed command older than its observed Workflow;
- migration 0007 refuses already-regressed current aggregate timestamps
  without partially applying its schema.
