# ADR 0015: Close M1 Worker authority and causality gaps

- Status: Accepted
- Date: 2026-07-27

## Context

ADR 0014 established the Context-bound Worker path, but several construction
boundaries still admitted claims that they could not independently prove:

- an injected Context factory could label an entry as a confirmed Fact or
  Human Decision even though M1 has no durable source resolver for either;
- a Policy installer could supply its own digest and persistence did not bind a
  newly installed Policy to an audit event;
- Worker event admission did not reload the durable dispatch claim;
- deterministic FakeWorker event IDs were fixture-global rather than bound to
  the dispatched request; and
- an event stream could end without a result while leaving its Attempt
  indistinguishable from active work.

These are authority-construction and causality problems. Adding isolated
conditionals at the observed failure sites would leave equivalent bypasses at
the Runtime, Store, migration, or test-adapter layers.

## Decision

### Close M1 Context sources until an owner exists

The target Context model continues to support confirmed Facts, Human
Decisions, project observations, working context, and explicit omission
decisions. M1 does not yet implement the durable source-resolution authority
needed to select those records.

Until a later accepted ADR introduces that authority, an M1 Worker Context:

- MUST have an empty `selectedEntries` collection;
- MUST have no omission decisions; and
- MUST contain only compiler-owned Goal and success-criterion Manifest
  entries.

The Context factory is a computation dependency, not a source of authority.
The Runtime MUST reject a self-consistent factory result that introduces an
external source entry. SQLite MUST reject new Manifests outside this M1 subset,
the strengthening migration MUST refuse retained rows that cannot satisfy it,
and Store startup MUST revalidate retained Manifests. The existence of M1
`facts` or `human_decisions` tables does not authorize their use before an
owning resolver validates status, scope, revision, and provenance.

Candidate Context is closed by the same rule. Slice 4 has no Candidate Manager
port that can prove the active generation, lifecycle state, or exact digest.
The factory MUST NOT manufacture that authority from the Workflow's Candidate
identifier. Candidate Package fields and Manifest entries remain prohibited
until Slice 5 introduces the owning Candidate resolver and a later accepted ADR
reopens the boundary.

### Make Policy installation Runtime-owned and independently verified

The trusted composition boundary supplies a `PolicyBundleDefinition` without a
digest or installation time. The Runtime:

1. validates the complete definition;
2. computes its ADR 0006 canonical projection digest;
3. assigns the installation time and audit identity; and
4. submits the complete installation unit to the Store.

The Store MUST NOT trust the submitted digest. It independently recomputes the
fixed canonical SHA-256 identity, requires both the bundle and audit payload to
match it, and commits the installation audit plus immutable Policy row in one
transaction. A returned `INSTALLED` record MUST retain the Runtime-owned time;
an exact existing definition MAY return `EXISTING` with its original time.

Persistence reads and Store startup MUST recompute retained Policy identities.
SQLite insert guards require a matching installation audit already present in
the same transaction. Migration 0010 fails closed for an unaudited retained
Policy because historical audit authority cannot be invented safely.

### Require dispatch causality for every Worker receipt

Before evaluating a Worker event, the Runtime MUST reload the immutable claim
for the request Attempt and prove that its Workflow version, Worker Session,
Context Manifest identity and digest, and package digest exactly bind the
request.

A Runtime-authored stream failure is also causally downstream of dispatch. The
Runtime MUST prove the same exact claim before recording `PROTOCOL_ERROR` or
`ABRUPT_TERMINATION`; a missing or mismatched claim is a control-plane recovery
condition, not evidence that the Worker failed.

The claim's `claimedAt` is the causal timestamp floor for every later control
operation on that Worker-bound Attempt. Worker receipts, Runtime-authored
failure, user cancellation, and restart reconciliation MUST NOT be recorded
before it. Runtime clamps a valid clock rollback to that floor; the Store,
SQLite, migration, and startup validation reject a bypassed or retained
terminal Attempt whose end time predates its claim.

Every persisted Worker receipt MUST have a prior claim for the same Attempt,
Workflow, and Context Manifest, and its receipt time MUST NOT predate the
claim. An `ADMITTED` receipt additionally MUST match the claim's exact Workflow
version, Worker Session, Manifest digest, and package digest. An `IGNORED`
receipt may retain mismatched Worker-supplied fields because the mismatch is
the reason for ignoring it; it still cannot exist without the underlying
dispatch causality.

The Store and SQLite enforce these relationships independently. Migration 0010
refuses retained receipts whose dispatch cause is missing, and Store startup
rechecks retained receipt causality after migrations are already applied.

### Bind deterministic fixture delivery identity to the request

`FakeWorker` event identity MUST be deterministic from the dispatched request,
fixture, and event ordinal. Two independent Attempts using the same fixture
therefore receive different `WorkerEventId` values, while duplicate delivery
inside one request reuses the same ID. Fixture-global IDs are prohibited
because they create false cross-Goal deduplication conflicts.

### Give stream termination an explicit outcome

For the M1 single-terminal-event protocol:

- an admitted Worker result or admitted Worker failure is a terminal event;
- replay of a previously admitted terminal event is also terminal for stream
  accounting;
- a non-async stream, an empty stream, or a stream ending after only untrusted
  or ignored deliveries records `PROTOCOL_ERROR` when the Attempt is still
  running;
- an iterator or Worker process that throws without cancellation records
  `ABRUPT_TERMINATION`; and
- successful cancellation remains a controlled interruption and MUST NOT be
  relabelled as Worker failure.

Non-admission results distinguish untrusted delivery from a control-plane
failure. A persistence, decoding, identifier, or other control-plane failure
MUST NOT be rewritten as `PROTOCOL_ERROR` merely because no event committed;
the still-running Attempt remains available for explicit recovery.

Normal stream completion and `RESULT_RECORDED` still confer no Acceptance or
Goal-completion authority.

## Consequences

- M1 deliberately supports less Context input until durable source ownership
  exists, avoiding false confidence from authority labels alone.
- IMPLEMENT Candidate Context remains unavailable until Slice 5 supplies its
  real authority owner; Slice 4 does not create a temporary substitute.
- Policy identity, installation time, audit, and stored content now form one
  verified installation boundary.
- Every Worker receipt has a durable causal predecessor; an admitted result
  cannot appear as if dispatch never happened.
- FakeWorker remains deterministic without causing unrelated Goals to collide.
- Empty and invalid-only Worker streams become visible terminal failures, while
  control-plane failures retain their own recovery semantics.
- Existing development databases containing unaudited Policies, unresolved or
  Candidate M1 Context sources, orphan Worker receipts, or terminal Attempts
  predating dispatch will refuse migration. They must be recreated or repaired
  from independently provable authority rather than silently blessed.

This ADR refines ADR 0004, ADR 0006, ADR 0009, ADR 0013, and ADR 0014. It does
not authorize Fact/Decision retrieval, Codex integration, Candidate mutation,
Acceptance, or closeout.

## Rejected alternatives

- **Trust authority labels produced by the Context factory.** Rejected because
  a label cannot prove a durable source record, status, scope, or revision.
- **Let the factory bind the Workflow's Candidate identifier to a supplied
  digest.** Rejected because self-consistency cannot prove Candidate state or
  content identity before the Candidate Manager owns that lookup.
- **Accept a caller-computed Policy digest.** Rejected because the same caller
  would define both content and the proof of its identity.
- **Check dispatch only in the coordinator.** Rejected because direct Runtime
  or Store use would retain the original bypass.
- **Use one deterministic event ID per fixture.** Rejected because identity
  would collide across unrelated dispatches.
- **Leave an empty stream `RUNNING`.** Rejected because external execution has
  ended and restart cannot distinguish silence from ongoing work.
- **Classify every non-admission as a Worker protocol error.** Rejected because
  Store or Runtime failures would be misdiagnosed and could destroy the proper
  recovery path.

## Validation

M1 tests MUST prove:

- a forged Human Decision or other unresolved Context source is rejected
  before Attempt persistence, and Candidate Context remains closed;
- Policy installation computes and rechecks the exact digest, writes one audit
  atomically, and rolls both records back at either injected failure point;
- Runtime admission without a claim fails and persisted receipts cannot outlive
  their dispatch causality, and Runtime-authored stream failure cannot bypass
  the same claim;
- two independent FakeWorker requests do not share an event ID, while duplicate
  delivery in one request remains idempotent;
- empty and invalid-only streams record `PROTOCOL_ERROR`, abrupt termination
  remains distinct, and cancellation remains interruption;
- clock rollback cannot place Worker failure, cancellation, or restart
  reconciliation before the durable dispatch claim;
- a control-store failure during event admission is not relabelled as Worker
  protocol failure;
- migration 0010 rejects each class of poisoned retained authority without a
  partial migration record or trigger installation; and
- reopen rejects post-migration corruption of Context source, Policy audit, or
  Worker receipt causality, and recomputes the retained Context Manifest
  identity from its authoritative M1 sources.
