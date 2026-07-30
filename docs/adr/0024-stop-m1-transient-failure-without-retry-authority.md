# ADR 0024: Stop M1 after transient Worker failure without retry authority

- Status: Accepted
- Date: 2026-07-30

## Context

ADR 0007 makes an Attempt a child of the versioned Workflow aggregate, and
runtime invariant I-028 requires every automatic retry to have an explicit
reason, budget, and backoff policy. M1 has a deterministic `FakeWorker`, but it
does not yet have a retry-policy authority that owns those decisions.

Classifying a Worker failure as transient describes the failure. It does not
authorize creating another Attempt. Returning the Workflow to `READY` after a
transient failure would therefore expose an executable state that has no
bounded retry decision behind it. A caller, restart path, or future coordinator
could accidentally turn that classification into an unbounded retry loop.

## Decision

For M1, an admitted Worker failure classified as `TRANSIENT_BACKEND` MUST:

- finish the current Attempt as `FAILED` with the exact closed failure reason;
- move the Workflow to `BLOCKED` in the same transaction; and
- prohibit every later Attempt for that Workflow.

The user MAY still cancel the blocked Workflow. Cancellation does not create a
replacement Attempt and does not convert the failure into success.

The Runtime, Store mutation boundary, SQLite backstops, migration preflight,
and Store startup validation MUST reject retained or proposed authority in
which a later Attempt follows an M1 transient failure. The Store transaction
remains the owner of the complete cross-row transition; SQLite triggers are
defence in depth and are not an alternate Workflow writer.

A later milestone MAY introduce retry. Before doing so, a new accepted ADR
MUST define the retry owner, eligible failure classes, maximum budget, backoff,
recovery behaviour, user-visible status, and persistence migration. Merely
changing `BLOCKED` back to `READY` is not sufficient.

## Consequences

- M1 fails closed instead of manufacturing retry authority from a label.
- A transient backend failure is visible to the user as a concrete blocker.
- Restart cannot reinterpret a previously blocked failure as executable work.
- M1 does not prove automatic retry behaviour; that work remains outside the
  milestone.

This ADR refines ADR 0007 and runtime invariant I-028. It does not change
Acceptance ownership, Worker trust, cancellation semantics, or M4 retry scope.

## Rejected alternatives

- **Return the Workflow to `READY` and let the driver decide.** Rejected
  because `READY` is executable authority and M1 has no persisted retry budget
  or backoff owner.
- **Create one implicit retry for transient failures.** Rejected because even
  a single retry is a policy decision that must be versioned and audited.
- **Enforce the rule only in the Runtime reducer.** Rejected because bypassed
  Store writes and poisoned retained databases must also fail closed.

## Validation

M1 tests MUST prove:

- an admitted transient Worker failure atomically records the failed Attempt
  and a `BLOCKED` Workflow;
- no public Store mutation can persist a later Attempt after that failure;
- strengthening migration and reopen reject retained later-Attempt history;
- cancellation from the blocker remains possible without creating work; and
- restart and the Workflow driver do not resume the blocked Workflow.
