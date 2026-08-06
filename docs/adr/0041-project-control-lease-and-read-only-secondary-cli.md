# ADR 0041: Give one CLI the project control lease and make later CLIs observers

- Status: Proposed
- Date: 2026-08-06

## Context

An attachable Runtime Host permits more than one CLI to connect to the same
principal/project. Without an exact control owner, two Frontstages could mutate
Focus, create or confirm different Pending Actions, submit Intake commands, or
issue conflicting Goal commands while presenting one conversational flow.

Store idempotency and Workflow freshness reject some races, but they do not
define which visible client owns the current interaction. Conversely, making a
second CLI completely unable to inspect state would weaken recovery and
operator visibility.

## Decision

### Persist one project control lease

For one exact local principal/project pair, the Runtime Host will publish at
most one `CONTROL` client lease. The lease binds:

- lease and client instance identity;
- principal/project and Interaction Session;
- Runtime Host identity and Host Epoch;
- monotonically increasing `ControlEpoch`;
- acquired/renewed/expiry/released causal time;
- installed lease-policy identity; and
- the exact mutable capability set.

The Host is the only lease issuer. Acquiring, renewing, expiring, or releasing
a lease persists the new lease state and audit atomically. Every M2.7
Interaction mutation and resulting public Intake/Goal command binds the current
lease and Control Epoch in addition to its existing command/freshness identity.

An old Host Epoch, stale Control Epoch, wrong client, wrong principal/project,
expired/released lease, or capability mismatch fails before Route Decision,
Focus mutation, Pending Action authorization, command reservation, or external
work.

### Make additional clients bounded observers

When a current `CONTROL` lease already exists, another CLI for that exact
principal/project receives `OBSERVER` mode. Its initial capabilities are only:

- list scoped Goal summaries;
- read exact Goal status;
- read exact Goal audit; and
- read retained Runtime-owned result/progress projections.

It cannot create or resume an Interaction Session, persist user conversation,
invoke the Frontstage Assistant, mutate Focus, create/authorize/consume a
Pending Action, submit or clarify Intake, or start/resume/cancel a Goal. Its
read request parser is closed to the supported query forms and publishes no
mutation facade.

Observer mode does not become writable because a model suggests an action or
because the controller disconnects. A client must complete a fresh lease
acquisition and receive a higher Control Epoch after the former lease is
legally released or expired.

### Close detach and takeover

Normal controller detach explicitly releases its lease; it does not affect the
Host, Goal execution, or project execution slot. Abrupt client loss leaves the
lease current until a bounded Host-owned renewal/expiry policy closes it. The
Host uses causal-time validation and monotonic Control Epochs; a stale client
cannot race a later holder after reacquisition.

M2.7 does not implement manual transfer, forced takeover while the current
lease remains valid, or two writable clients. Host restart invalidates
client-held transport sessions and reconciles lease state under the new Host
Epoch before any mutation capability is republished.

### Keep control lease separate from execution authority

The control lease answers “which CLI may request a mutation now”. It does not:

- reserve the project execution slot;
- own or cancel the running Goal;
- grant Worker/Candidate/Store capability;
- make a Route Proposal trusted;
- authorize a specific Pending Action by itself; or
- issue technical Acceptance.

A Goal may continue after the controller detaches because the Runtime Host and
existing execution authority own it, not because the lease survives.

## Consequences

- One principal/project has one coherent writable conversational frontstage.
- A second CLI remains useful for bounded observation without creating another
  controller.
- A crashed client may temporarily delay reacquisition until its lease expires.
- Lease/epoch validation becomes an additional required input to M2.7 control
  operations but does not change Goal/Workflow ownership.
- Multi-user collaboration and manual control transfer remain later work.

## Rejected alternatives

- **Allow every attached CLI to mutate and rely only on optimistic conflicts.**
  Rejected because it does not define conversational control or prevent two
  valid but conflicting pending actions.
- **Make the second CLI fully inactive.** Rejected because bounded read-only
  status/audit observation is safe and useful.
- **Let the observer converse but block only final commands.** Rejected for the
  bounded milestone because conversation itself can mutate session/focus and
  create indirect control ambiguity.
- **Promote an observer immediately when the socket closes.** Rejected because
  disconnect is not proof that the former client cannot still submit work.
- **Use the project execution slot as the control lease.** Rejected because UI
  control and Goal execution have different owners and lifetimes.

## Validation

M2.7 tests must prove:

- concurrent lease acquisition produces one controller and observer results for
  all losers;
- observer clients can perform only the four closed read families;
- observer attempts to converse, mutate Focus, authorize, submit Intake, or
  issue Goal commands fail before capability invocation;
- normal detach releases only the control lease;
- abrupt detach retains the old epoch until deterministic expiry;
- a later holder receives a higher epoch and all old-client mutations fail;
- Host restart invalidates transport sessions and cannot accept a lease from an
  earlier Host Epoch;
- lease writes and audits are atomic and survive strict reopen; and
- lease state cannot issue Goal execution, Acceptance, or closeout authority.
