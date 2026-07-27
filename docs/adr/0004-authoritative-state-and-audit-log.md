# ADR 0004: Authoritative state and audit log

- Status: Accepted
- Date: 2026-07-27

## Context

CodeClosure must recover after process failure without asking a model to
reconstruct reality from a transcript. It also needs to explain why a transition
was allowed, which candidate and evidence were evaluated, and whether a stale
actor attempted a conflicting write.

Pure mutable tables lose history. Full event sourcing would make every read model
and migration depend on replay semantics before the domain has stabilized.

## Decision

Persist normalized current state and an append-only audit log in the same SQLite
transaction.

- Every authoritative aggregate has a monotonically increasing version.
- Commands include the expected aggregate version.
- A successful command atomically writes the new current state and one or more
  immutable audit events.
- Conflicting or stale commands fail without partial writes.
- Audit events include actor, command or transition type, timestamp from an
  injected clock, correlation and causation IDs, relevant object IDs, and a
  digest or safe projection of the input.
- Large artifacts and evidence payloads live in content-addressed storage; the
  database stores identity, digest, provenance, and lifecycle metadata.
- Worker transcripts may be retained for diagnosis but are not replayed as
  authoritative commands.
- Recovery reconciles persisted attempts, leases, processes, workspaces, and
  pending transitions before dispatching new work.

This is not full event sourcing. Current-state tables are authoritative for
normal reads; the audit log is authoritative for accountability and transition
history.

## Consequences

- State and history cannot diverge under a correctly implemented transaction.
- Replay of acceptance decisions can use immutable manifests and evidence rather
  than mutable working directories.
- Schema migrations must preserve both current state and audit interpretability.
- Sensitive values require redaction before entering either the audit log or
  content-addressed artifacts.

## Rejected alternatives

- **Store state in Markdown or the Git working tree.** Rejected because workers
  can modify those locations and multi-record transitions are not atomic.
- **Use chat history as the recovery log.** Rejected because history may be
  compacted, incomplete, or semantically ambiguous.
- **Adopt full event sourcing immediately.** Rejected as unnecessary complexity
  for M1; the design preserves an audit path without making replay the only read
  mechanism.

## Validation

M1 tests must cover atomic state-plus-audit writes, optimistic concurrency,
crash recovery at every workflow boundary, duplicate command idempotency, and
rejection of state mutation attempted through worker output.
