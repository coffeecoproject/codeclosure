# CodeClosure Runtime Invariants

These invariants are the product constitution. Implementations, adapters,
documents, tests, and user interfaces must preserve them. An accepted ADR may
clarify an invariant but must not weaken it without an explicit product-level
decision and adversarial review.

## Authority

### I-001 — One workflow writer

Only the Workflow Runtime may mutate authoritative workflow state.

Workers, adapters, check runners, UIs, reports, and model messages submit typed
requests or observations. They do not write phases or terminal statuses.

### I-002 — One technical acceptance issuer

Only the Acceptance Engine may issue a technical `ACCEPT` decision. It evaluates
versioned policy against versioned inputs and has no source-edit capability.

### I-003 — Closeout requires both authorities

The Workflow Runtime may enter `CLOSEOUT` only when it consumes a current
`ACCEPT` decision for the exact goal revision, candidate digest, fact snapshot,
evidence set, and policy bundle.

### I-004 — Worker completion is a request

A worker's `completed`, `done`, success exit, final answer, marker, or turn
status is a `CompletionRequest` at most. It is never an acceptance decision or
workflow transition.

### I-005 — Derived views do not authorize

Dashboards, summaries, plans, reports, context packages, review prose, and audit
traces may explain source records. They cannot override or replace their source
authorities.

## State and Persistence

### I-006 — Authoritative state is outside the conversation

Goals, facts, decisions, workflow state, candidate identities, evidence,
acceptance decisions, and blockers are persisted by CodeClosure. Chat history,
Codex threads, model memory, and compacted summaries are non-authoritative.

### I-007 — Authoritative state is outside the worker-writable candidate

The control database, policy bundle, and acceptance records must not be stored
where the worker can modify them. Project-local configuration may be readable
from the candidate, but successful control state lives in a CodeClosure-owned
location.

### I-008 — Transitions are validated and atomic

Every phase or terminal-status mutation must:

1. identify the expected current version;
2. validate the transition and its preconditions;
3. persist the new state and audit event atomically;
4. reject concurrent or stale writes.

### I-009 — Recovery uses authoritative records

After interruption or restart, CodeClosure reconstructs the active goal from
its store and reconciles external reality. It must not infer the current phase
from the last assistant message.

### I-010 — Cancellation is not success

`CLOSED` is the successful terminal meaning. `CANCELLED`, `BLOCKED`, and
`FAILED` are distinct non-success terminal or suspended meanings and must never
be presented as successful closeout.

## Candidate Integrity

### I-011 — Workers edit candidates, not control state

Implementation workers receive write access only to the current mutable
candidate generation and explicitly permitted run-owned locations.

### I-012 — Freeze creates immutable identity

`SOURCE_FREEZE` records an exact candidate digest and changes the candidate to
read-only from the workflow perspective. Any later source mutation invalidates
that generation and all evidence bound to it.

### I-013 — Repair creates a new generation

An acceptance failure that can be repaired returns the workflow to
`IMPLEMENT`, invalidates or rejects the frozen candidate, and creates a new
mutable candidate generation. A frozen generation is never thawed in place.

### I-014 — Actual change must match allowed change

The runtime compares the candidate's actual change set with the current goal,
plan, boundary, and relevant facts. Missing planned work and unexpected work
both block dependent acceptance claims.

## Evidence

### I-015 — Evidence is observed, typed, and bound

Evidence records bind to the current project identity, goal revision,
candidate digest, check specification, runner identity, relevant environment,
and observed outputs. Narrative claims alone are not evidence.

The Check Specification and Runtime, not an external producer response, MUST
author the persisted producer, environment, payload, and Evidence identity.

### I-016 — Evidence cannot approve itself

A check runner may report observations and a check-level result. It cannot
promote its own output into goal acceptance.

### I-017 — Stale or mismatched evidence fails closed

Evidence becomes ineligible when a required bound input changes. Missing,
copied, stale, malformed, contradictory, or unverifiable required evidence
cannot satisfy acceptance.

An immutable historical Evidence Set MUST replay against the eligibility state
at its recording audit sequence. Historical readability does not make it
current: a new acceptance evaluation MUST still use latest eligibility.

### I-018 — Evidence content and secrets are separated

Evidence stores redacted observations and content digests. Raw secrets,
credentials, tokens, cookies, or full sensitive connection strings must not be
persisted as evidence. External adapter exception text and unrecognized output
fields MUST NOT enter authoritative state or audit payloads. M1 persists only
schema-owned observations and closed failure reason codes at those boundaries.
Worker and checker responses MUST be rejected when they exceed their
Runtime-owned byte budgets.

## Context and Facts

### I-019 — Context is compiled, not replayed by default

Each worker turn receives the smallest phase-relevant context package derived
from authoritative state and project evidence. Entire conversation replay is
not the default context strategy.

### I-020 — Every compiled fact has provenance

A context item that can affect execution or acceptance identifies its source,
revision, status, and confidence class. Unsupported inference remains a
proposal and cannot silently become a confirmed fact.

### I-021 — Compact cannot destroy authority

Codex compaction may replace model history with a summary. It must not be the
only copy of any goal, fact, decision, obligation, blocker, or acceptance input.

### I-022 — Business scope is scenario-based

When a change affects a family of business paths, completion is evaluated over
the applicable scenario set, not only over files the worker happened to edit.

## Permissions and Effects

### I-023 — Phase determines capabilities

Permissions are derived from workflow phase and policy. A prompt that says
"do not edit" is not the enforcement boundary.

### I-024 — Verification is read-only with respect to frozen source

Evidence building and final verification may create run-owned outputs outside
the frozen source tree. They may not mutate the frozen candidate source.

### I-025 — Technical closeout is not real-world authorization

A successful closeout does not authorize merge, release, deployment,
production mutation, paid resources, external communication, or irreversible
data effects.

### I-026 — Human input is typed and scoped

Human input resolves a business fact, product preference, unavailable external
fact, or exact real-world consent. A generic approval cannot bypass missing
technical evidence or acceptance rules.

## Failure Behavior

### I-027 — Unknown required state fails closed

Parser errors, checker crashes, timeouts, missing policies, unresolved identity,
unsupported protocol events, and ambiguous required state must produce a
blocking or retryable result, never implicit success.

A Goal MUST contain at least one required success criterion. Without one, the
Goal has no technical completion boundary and is invalid rather than
vacuously satisfied.

### I-028 — Retry is bounded and classified

Automatic retries have a reason, budget, and backoff policy. Exhausting a retry
budget is not completion and is surfaced as a concrete blocker.

An external Worker may report only a closed failure reason. The Runtime owns
the exhaustive reason-to-failure-class mapping, and persistence MUST reject a
known reason paired with another class.

### I-029 — Reconciliation precedes continuation

Before resuming work after a process, thread, or external-state interruption,
the runtime compares persisted intent with current repository and candidate
reality.

### I-030 — Claims match proof strength

CodeClosure reports only what current evidence establishes. A simulated,
partial, local, or candidate-only result must not be described as production
proof or universal correctness.
