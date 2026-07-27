# CodeClosure

**Reliable runtime for AI coding.**

CodeClosure is a local-first control runtime that sits above coding agents such
as Codex. The agent can inspect code, propose a plan, edit an isolated
candidate, and run tools. It cannot decide that the engineering goal is
complete.

> LLMs propose. CodeClosure decides what may become complete.

## Status

The M0 architecture baseline is complete and tracked. **M1 implementation is in
progress through Slice 4.** The repository currently contains the strict
TypeScript workspace, pure Workflow and Candidate reducers, and the
transactional SQLite control-store foundation with migration, restart,
optimistic-concurrency, idempotency, and atomic state-plus-audit tests. Runtime
handlers expose narrow Goal-based start/cancel commands, own Attempt lifecycle
changes, persist deterministic command rejections for replay, and keep the Goal
lifecycle projection transactionally synchronized with its Workflow. Command
admission checks Goal/Workflow freshness before child lookup, guard evaluation,
or domain planning. Persisted command outcomes bind the exact target, owning
Goal and Workflow, disposition, and observed Workflow snapshot; replay
revalidates those bindings. Internal phase guards are runtime-derived,
evaluator, persistence, and internal failures remain distinct, `CLOSEOUT`
remains unavailable until Slice 6 supplies a current Acceptance Decision, and
store conflicts are typed.

The Slice 4 path now compiles a deterministic minimal Context package, verifies
its authoritative Goal and source bindings, binds a Runtime-selected installed
Policy, and atomically persists its Manifest with the Attempt. A typed
`WorkerPort` is reached only after a durable dispatch claim wins its transaction
against cancellation. Independently identified Worker events are
schema-checked, digest-bound, replay-safe, and stored with their resulting
Attempt mutation in one transaction. Adversarial `FakeWorker` fixtures exercise
malformed, stale, duplicate, fabricated, and abrupt-failure behavior.
Runtime-owned timestamps preserve causal order across clock rollback, while
reducers, the Store, and SQLite reject older bypassed events, relationship
forgery, immutable-record rewrites, and repeated terminal Workflow mutations.

This is not yet an end-to-end working runtime. Candidate/evidence generation,
Acceptance, CLI proof scenarios, startup recovery orchestration and inspection,
and the final M1 audit remain incomplete. Implemented slices must not be read as
an M1 or product-completion claim.

## Development

The M1 workspace requires Node.js `>=22.22.0 <23` and pnpm `11.1.3` through
Corepack.

```sh
corepack pnpm install
corepack pnpm gate:quality
```

Current repository commands are:

- `pnpm format` / `pnpm format:check` — write or verify code/config formatting;
- `pnpm lint` — run ESLint with type-aware TypeScript rules;
- `pnpm typecheck` — build project references and type-check test sources;
- `pnpm test` — run workspace tests with Node's test runner;
- `pnpm build` — force a clean production compilation pass;
- `pnpm gate:quality` — run the current checks in required order.

The current test step includes reducer, migration upgrade and poison-preflight,
Runtime-plus-SQLite integration, Goal projection, reopen, stale-write,
rejection replay, persistence decoding, stale-command admission precedence,
replay target binding, evaluator-failure classification, API-capability
boundaries, forged-closeout rejection, Context source cross-validation,
canonical digest vectors, dispatch/cancellation ordering, adversarial Worker
events, causal clock rollback, terminal event bypass, and injected transaction
rollback checks. Later M1 slices add Candidate/evidence and Acceptance proof,
CLI integration, recovery orchestration, and an invariant-coverage check before
any M1 completion claim.

## Why CodeClosure Exists

Prompt instructions can improve agent behavior, but they cannot make a
probabilistic worker the authority over its own completion. CodeClosure moves
critical state and decisions out of the conversation:

- goals and success criteria;
- project and business facts;
- workflow phase and permitted actions;
- candidate identity and freeze state;
- evidence and verification results;
- acceptance decisions and unresolved blockers.

Conversation history remains useful working memory. It is not authoritative
state and may be compacted, replaced, or discarded.

## Runtime Shape

```text
User
  |
  v
CodeClosure CLI
  |
  v
CodeClosure Control Runtime
  |-- Goal and Fact Store
  |-- Workflow Runtime
  |-- Context Compiler
  |-- Candidate Manager
  |-- Evidence Store
  |-- Acceptance Engine
  `-- Human Decision Gateway
  |
  v
Worker Adapter
  |
  v
Codex App Server (M2)
```

The public entry will be `codeclosure`. Codex is an execution backend, not the
product entry and not the completion authority.

## Canonical Documents

- [Product contract](PRODUCT.md)
- [Architecture](ARCHITECTURE.md)
- [Runtime invariants](RUNTIME_INVARIANTS.md)
- [Domain model](docs/domain-model.md)
- [Workflow state machine](docs/workflow.md)
- [Context compiler](docs/context-compiler.md)
- [Acceptance engine](docs/acceptance-engine.md)
- [Evidence model](docs/evidence-model.md)
- [Milestones](docs/milestones.md)
- [M1 deterministic-skeleton plan](docs/plans/m1-deterministic-skeleton.md)
- [M0 architecture review](docs/reviews/m0-architecture-review.md)
- [Accepted ADR index](docs/adr/README.md)

Repository instructions and document precedence are defined in
[AGENTS.md](AGENTS.md).

## Near-Term Scope

M1 is deliberately narrow:

- one local user;
- one target repository;
- one goal at a time;
- deterministic state transitions;
- SQLite-backed authoritative state;
- append-only audit events;
- a `FakeWorker` only;
- restart and resume;
- tests proving a worker cannot close a goal.

Codex App Server integration, full Fact Graph traversal, rich TUI, multi-agent
coordination, cloud execution, and automated release are later milestones.

## Non-Goals

CodeClosure is not:

- another coding agent;
- a prompt pack or an `AGENTS.md` distribution system;
- a guarantee that AI-generated code has no defects;
- a replacement for Git, CI, deployment platforms, or real-world authority;
- a Codex fork in the initial architecture;
- a compatibility layer for the former IntentOS implementation.

## Working Principle

Completion is a versioned, reproducible runtime decision over a frozen
candidate and bound evidence. A model message, successful turn, test log,
review statement, or generated report is only an input. None is completion by
itself.
