# ADR 0002: Host runtime and Codex adapter

- Status: Accepted
- Date: 2026-07-27

## Context

Codex is capable of inspecting repositories, editing files, running commands,
and reporting results. Its thread and turn lifecycle, however, is an execution
lifecycle. A successful `turn/completed` event does not prove that a business
goal is complete, that all required scenarios were covered, or that cited
evidence belongs to the current source candidate.

The new runtime must remain able to reject a worker's completion claim and must
survive thread compaction or replacement without losing authoritative state.

## Decision

Deterministic control resides in the CodeClosure host runtime. Codex is reached
through a versioned adapter over the Codex App Server protocol.

The boundary is:

```text
CodeClosure workflow runtime
        |
        | WorkerPort commands and events
        v
Codex adapter
        |
        | Codex App Server v2 protocol
        v
Codex worker thread / turn
```

- The Workflow Runtime is the only component that commits workflow state
  transitions.
- The Acceptance Engine is the only component that can issue an `ACCEPT`
  decision.
- A worker may return artifacts, observations, proposed facts, and a completion
  request. None of these mutate authoritative acceptance state directly.
- Codex thread history is disposable execution context, not the source of truth.
- The adapter must translate Codex lifecycle events into worker-domain events;
  it must not map `turn/completed` to Goal completion.
- Protocol schemas are pinned and compatibility-tested per supported Codex
  version.

## Consequences

- M1 can prove orchestration and acceptance properties with a deterministic fake
  worker before model behavior is introduced.
- M2 can add Codex without changing domain authority rules.
- The adapter must handle initialization, server-initiated requests, approvals,
  interruption, process failure, streaming backpressure, and schema drift.
- Some useful Codex internals may remain inaccessible. A fork is considered only
  after a documented control gap cannot be addressed through the App Server
  boundary.

## Rejected alternatives

- **Treat Codex as the top-level application.** Rejected because completion and
  durable control state would remain coupled to a probabilistic worker session.
- **Interpret worker text as authoritative state transitions.** Rejected because
  text markers are forgeable, ambiguous, and not transactionally bound to state.
- **Fork Codex immediately.** Rejected because it creates a large maintenance
  surface before an external adapter has been proven insufficient.

## Validation

M1 adversarial tests must demonstrate that fake worker messages such as “done,”
successful process exit, or fabricated PASS output cannot close a Goal. M2 must
demonstrate the same property through the real Codex adapter.
