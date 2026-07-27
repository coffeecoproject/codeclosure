# ADR 0009: Separate application-command idempotency from worker delivery

- Status: Accepted
- Date: 2026-07-27

## Context

Application commands and worker events arrive from different trust domains and
need different duplicate-handling rules.

An application command is a trusted, schema-validated request to the runtime.
Its `CommandId` identifies the caller's requested operation and must make a
retry deterministic. A worker event is untrusted input from an execution
adapter. Its delivery identity must not grant command authority or manufacture
a successful command outcome.

The early runtime skeleton also exposed an arbitrary callback after a
capability check. That shape cannot prove which worker request was dispatched,
bind it to a Context Manifest, or serialize dispatch against cancellation. A
generic callback therefore crosses the authority boundary even when its label
resembles an allowed capability.

## Decision

M1 uses two explicit identity domains and a narrow dispatch port.

### Application commands

- Every admitted mutating application command carries a `CommandId`.
- The runtime derives a canonical input digest before mutation.
- Reusing a `CommandId` with the same digest returns the stored prior outcome
  without repeating state changes, audit events, or external effects.
- Reusing a `CommandId` with a different digest is rejected as an idempotency
  conflict.
- A deterministic domain rejection for a well-formed command against an
  existing target is also a command outcome. It MUST be stored against the
  observed Workflow version and replayed on duplicate delivery.
- Malformed input, an unknown aggregate, or an infrastructure failure is not an
  admitted domain command and need not create a processed-command record.
- If the observed version changes before a rejection can be recorded, the
  runtime reloads and reevaluates the command rather than persisting a stale
  decision.

### Worker events

- Each delivered worker event carries a `WorkerEventId`, worker/session
  identity, Attempt identity, Context Manifest identity, and the relevant exact
  digests.
- Worker event schema and semantic bindings are validated before the runtime
  constructs any internal application command.
- Duplicate `WorkerEventId` delivery is deduplicated independently of
  `CommandId`.
- A late, stale, mismatched, or no-longer-active worker event writes no
  authoritative state, audit success, or processed application-command
  outcome.
- A worker cannot choose an application `CommandId` or use event identity as
  transition authority.

### Worker dispatch

- The runtime MUST NOT accept an arbitrary caller-provided callback as the
  implementation of an authorized effect.
- Slice 4 introduces a typed `WorkerPort`. It receives a runtime-created,
  digest-bound Worker Request and an `AbortSignal`, and emits typed Worker
  Events. It never receives repositories, transactions, or state-mutation
  methods.
- Runtime-owned dispatch must be fenced against cancellation: after a
  cancellation wins the Workflow version, no replacement or not-yet-started
  request may be dispatched for that version.
- M1 does not claim dispatch-race proof until the Context Manifest and
  WorkerPort contract exist. Capability derivation alone proves policy, not an
  external effect boundary.

This ADR refines ADR 0007: its rule that stale worker results create no command
outcome applies to worker-event admission, while ordinary application-command
rejections use the replay contract above.

## Consequences

- Duplicate user/CLI retries and duplicate worker deliveries cannot collide in
  one identity namespace.
- Rejected application commands remain stable even if aggregate state changes
  before the caller retries them.
- Removing the generic callback temporarily narrows the Slice 3 API. Typed
  dispatch is added only with the Slice 4 manifest and worker contracts needed
  to make it truthful.
- Persistence needs explicit processed-command targets and a separate worker
  event receipt model when worker integration is implemented.
- Tests must label policy-only capability checks separately from dispatch and
  cancellation-race proofs.

## Rejected alternatives

- **Use `CommandId` for both application commands and worker messages.**
  Rejected because it lets untrusted delivery participate in the trusted retry
  contract and makes stale-message handling ambiguous.
- **Execute a generic callback after checking a capability string.** Rejected
  because the callback can perform an unbound effect that the runtime cannot
  identify, cancel, or audit.
- **Do not persist rejected commands.** Rejected because a retry after state
  changes could return a different answer for the same caller operation.
- **Add a placeholder WorkerPort before Context Manifest binding exists.**
  Rejected because a partial interface would imply a safety proof that Slice 3
  cannot yet provide.

## Validation

M1 tests must prove:

- accepted and deterministically rejected application commands replay their
  stored outcome for the same `CommandId` and input digest;
- a conflicting digest under the same `CommandId` fails closed;
- worker event identifiers cannot be parsed or used as command identifiers;
- stale worker events create no state, audit success, or application-command
  outcome;
- Slice 4 dispatch is typed, manifest-bound, abortable, and serialized against
  cancellation before that stronger proof is claimed.
