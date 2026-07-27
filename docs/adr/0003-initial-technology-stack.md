# ADR 0003: Initial technology stack

- Status: Accepted
- Date: 2026-07-27

## Context

M1 needs a small, testable runtime skeleton: domain objects, a durable state
store, a workflow reducer, capability checks, an acceptance engine, and a fake
worker. The likely Codex integration is a JSON-RPC-style stdio protocol, and the
intended product surface includes a terminal application.

The first milestone should optimize for explicit types, fast deterministic
tests, and low integration friction rather than premature performance work.

## Decision

Use this baseline for M1:

- Node.js 22 or newer;
- strict TypeScript using ESM;
- a pnpm workspace;
- SQLite as the embedded authoritative store;
- an append-only audit table plus normalized current-state tables;
- built-in or lightweight test tooling capable of deterministic clock and ID
  injection.

The initial workspace is expected to separate domain/runtime, persistence,
worker ports, CLI, and test fixtures. Dependency direction follows
[ARCHITECTURE.md](../../ARCHITECTURE.md): domain code does not import the Codex
adapter, terminal UI, or provider SDKs.

Exact choices for the SQLite driver, migration library, schema validator, CLI
framework, and TUI framework are intentionally deferred until M1 implementation
planning. They must not weaken transactionality or introduce an alternate source
of authoritative state.

## Consequences

- The Codex adapter can be implemented in the same language as the host runtime.
- A local single-process vertical slice can establish invariants before adding
  distributed coordination.
- CPU-intensive or privileged verifiers may later run as separate processes
  behind typed ports.
- SQLite is not a commitment to a permanently single-user architecture; storage
  interfaces and transaction semantics must remain explicit.

## Rejected alternatives

- **Rust for M1.** Viable, but rejected for the first skeleton because it would
  slow iteration on the application and App Server integration boundary without
  improving the core proof.
- **A hosted database from day one.** Rejected because it adds deployment and
  coordination concerns before local invariants are validated.
- **An AI SDK as the domain abstraction.** Rejected because provider-level text
  generation does not model CodeClosure's workflow, evidence, or acceptance
  authority.

## Validation

The M1 implementation plan must name package boundaries, migration strategy,
transaction tests, and supported Node/pnpm versions before production code is
accepted.
