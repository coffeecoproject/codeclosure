# ADR 0014: Bind Worker dispatch and event admission to durable Context authority

- Status: Accepted
- Date: 2026-07-27

## Context

Slice 4 introduces the first external execution effect in M1. A capability
grant alone cannot prove which payload was sent, whether cancellation won
before dispatch, or whether a later Worker event belongs to the still-current
Attempt. Persisting an Attempt first and its Context Manifest later would also
leave a recoverable-looking Attempt whose actual input cannot be identified.

Worker events arrive from an untrusted identity domain. A duplicate, stale, or
mismatched event must not acquire application-command authority merely because
it has a valid shape or repeats a successful-looking result.

## Decision

### Context-bound Attempt start

For a Worker-backed Attempt, the Runtime allocates the Attempt, Context
Manifest, and Worker Session identities before mutation. It applies the
proposed Attempt start in memory, compiles the Context Package against that
resulting Workflow version, and validates the complete compilation before the
Store is called.

The Runtime configuration, not the Context factory, selects the active Policy
Bundle identity. The Runtime loads that immutable installed bundle, supplies
its exact ID and digest to compilation, and rejects any factory output that
substitutes another Policy. A Worker Session is invalid without a bound Context
Manifest, and both bindings become immutable when the Attempt is inserted.

Validation binds:

- the exact Goal content and revision;
- Workflow, phase, version, and active Attempt;
- Candidate identity when present;
- phase-derived capability and response contracts;
- Policy Bundle identity and digest across package and manifest;
- every manifest entry to the exact rendered package entry;
- `packageDigest` and the semantic `manifestDigest` under ADR 0006.

The Store commits the Goal lifecycle projection, Workflow, Attempt, audit
events, processed Start command, and Context Manifest in one transaction. The
Context Package is disposable process memory; the Context Manifest is durable
authority. A successful Store return includes an immediate readable round trip,
and restart must decode the same Manifest.

### Durable dispatch claim

Before calling `WorkerPort`, the Runtime obtains an immutable dispatch claim
inside a `BEGIN IMMEDIATE` transaction. The Store revalidates that the exact
Workflow version is `RUNNING`, the exact Attempt is active, and the Worker
Session, Context Manifest digest, and package digest all match.

The dispatch claim and cancellation therefore serialize on the Workflow
version:

- if cancellation commits first, the claim is ineligible and `WorkerPort` is
  not called;
- if the claim commits first, the Runtime registers an `AbortController` before
  consuming Worker events; a later successful cancellation commit then aborts
  that dispatch.

A persisted claim is proof that dispatch authority was consumed, not an
instruction to dispatch again after restart. Recovery reconciles a retained
running Attempt rather than silently repeating an external effect.

### Worker event admission

`WorkerPort` receives only a runtime-created `WorkerRequest` and an
`AbortSignal`, and returns an asynchronous stream of untrusted values. It never
receives a Store, repository, transaction, or state-mutation callback.

Each decodable event has an independent `WorkerEventId`. The Runtime validates
its closed schema, response contract, Worker Session, Attempt, Context
Manifest, exact digests, and current Workflow version before constructing a
runtime-owned internal `CommandId`.

- A current result or failure commits the Attempt/Workflow change, audit
  events, internal processed-command outcome, and an `ADMITTED` Worker receipt
  in one transaction.
- A stale or mismatched event may create only an `IGNORED` delivery receipt. It
  creates no Workflow mutation, success audit, or processed application-command
  outcome.
- A duplicate `WorkerEventId` with the same payload reuses its original receipt
  without repeating effects. Reuse with another payload fails closed.
- A malformed value that cannot establish a safe event identity is rejected
  without a receipt.

Worker results remain proposals or completion requests. Neither a result,
normal stream completion, nor Worker-authored acceptance text can issue an
Acceptance Decision or close a Goal.

## Consequences

- An Attempt cannot claim a durable Worker input without its Manifest in the
  same transaction.
- Cancellation and not-yet-started dispatch have one database-serialized
  winner.
- Delivery deduplication cannot collide with application-command idempotency.
- A digest-valid but authority-inconsistent Context compilation fails before
  Attempt persistence.
- SQLite needs immutable dispatch-claim and Worker-receipt tables plus
  relationship and migration backstops.
- Process recovery must treat a retained claim conservatively and must not
  infer that the old Worker is still controlled.

This ADR refines ADR 0004, ADR 0007, ADR 0009, and ADR 0013. It does not grant
the Worker transition or acceptance authority.

## Rejected alternatives

- **Dispatch immediately after a capability check.** Rejected because
  cancellation can win while an unrecorded external effect still starts.
- **Persist the Manifest after dispatch.** Rejected because a crash can leave
  an Attempt without provable input identity.
- **Use `WorkerEventId` as `CommandId`.** Rejected because untrusted delivery
  identity would become mutation authority.
- **Drop stale events without any independent receipt.** Rejected because
  repeated delivery and forensic diagnosis would remain ambiguous.
- **Redispatch every retained claim after restart.** Rejected because a claim
  proves authority was consumed but cannot prove whether the external Worker
  already started.

## Validation

M1 tests MUST prove:

- Context-bound Attempt start is atomic and survives reopen;
- self-consistent Context content that disagrees with source authority is
  rejected before persistence;
- cancellation-first prevents dispatch and claim-first cancellation aborts the
  running Worker;
- malformed, fabricated-control, stale, and duplicate Worker fixtures cannot
  advance authority;
- admitted event state, audit, command outcome, and receipt commit atomically;
- injected failures after Manifest, dispatch-claim, Policy, and Worker-receipt
  writes leave no partial authority;
- SQLite rejects forged relationships and immutable-record rewrites;
- an unselected Policy and a Worker Session without Context cannot acquire
  dispatch authority;
- the strengthening migration refuses poisoned retained Context or Policy
  authority without partial schema application.
