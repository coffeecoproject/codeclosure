# CodeClosure

**Reliable runtime for AI coding.**

CodeClosure is a local-first control runtime that sits above coding agents such
as Codex. The agent can inspect code, propose a plan, edit an isolated
candidate, and run tools. It cannot decide that the engineering goal is
complete.

> LLMs propose. CodeClosure decides what may become complete.

## Status

The M0 architecture baseline is complete and tracked. M1 implementation is in
progress with `FakeWorker` only. The
[M1 implementation plan](docs/plans/m1-deterministic-skeleton.md) is the
detailed record of which implementation slices have been verified; the
[milestone document](docs/milestones.md) defines the complete M1 scope and exit
criteria.

This README intentionally does not duplicate the rolling slice, feature, or
test inventory. A slice marked implemented in the M1 plan is evidence for that
bounded slice only. It is not an M1-completion or product-completion claim. M1
does not integrate Codex, edit a real project, or perform real project
verification.

## Development

The M1 workspace requires Node.js `>=22.22.0 <23` and pnpm `11.1.3` through
Corepack.

```sh
corepack pnpm install
corepack pnpm gate:quality
```

Current repository commands are:

- `pnpm format` / `pnpm format:check` — write or verify code/config formatting;
- `pnpm docs:check` — verify repository GitHub Flavored Markdown structure,
  portable Markdown sources, exact portable local links, heading anchors, and
  the structural README status-source contract;
- `pnpm lint` — run ESLint with type-aware TypeScript rules;
- `pnpm typecheck` — build project references and type-check test sources;
- `pnpm test` — run workspace tests with Node's test runner;
- `pnpm build` — force a clean production compilation pass;
- `pnpm gate:quality` — run the current checks in required order.

The exact implemented proof coverage is recorded with each slice in the M1
implementation plan. A green quality command proves only the checks present at
that source revision; it does not by itself establish M1 completion.

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
