# CodeClosure

**Reliable runtime for AI coding.**

CodeClosure is a local-first control runtime that sits above coding agents such
as Codex. The agent can inspect code, propose a plan, edit an isolated
candidate, and run tools. It cannot decide that the engineering goal is
complete.

> LLMs propose. CodeClosure decides what may become complete.

## Status

The M0 architecture baseline and bounded M1 deterministic skeleton are
complete. M2 is the current implementation milestone. Its pre-implementation
decision closure has passed against the selected local Codex version. The
version-bound lower App Server client is implemented and has passed its bounded
offline and live compatibility review. The Goal-bound Codex Worker Adapter is
implemented and has passed its bounded offline contract review. The controlled-copy
Candidate workspace adapter is also implemented and has passed its bounded
containment, freeze, repair, drift, restart, and cleanup review. The bounded
Darwin local-command verification path, strict versioned contracts,
Runtime-derived Evidence, and atomic SQLite payload persistence are now
implemented and have passed their focused isolation and authority review.
Reject/repair/accept orchestration, recovery, trusted production composition,
and the live Goal-bound path remain later M2 work. The
[M2 implementation plan](docs/plans/m2-codex-vertical-slice.md) is the detailed
status source; the [milestone document](docs/milestones.md) defines the bounded
scope and exit criteria.

This README intentionally does not duplicate the rolling slice, feature, or
test inventory. M1 remains the regression baseline. M2 completion will require
an independent exit review and will not prove Goal Intake, product completion,
or authority to merge, release, deploy, or perform another external effect.

## Development

The workspace requires Node.js `>=22.22.0 <23` and pnpm `11.1.3` through
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
- `pnpm lint` — run ESLint, CLI authority-boundary checks, and the locked
  manifest/source package-dependency audit;
- `pnpm typecheck` — build project references and type-check test sources;
- `pnpm test:unit` — run unit/property tests and the no-skip runner contract;
- `pnpm test:digests` — run canonical digest golden-vector and replay tests;
- `pnpm test:migrations` — run the exact SQLite migration, schema-fingerprint,
  integrity, and reopen suite;
- `pnpm test:authority` — run authority-codec, Store-contract, adversarial, and
  write/read/reopen closure tests;
- `pnpm test:cli` — run CLI integration and cross-process restart tests;
- `pnpm test:demos` — run all named adversarial proof scenarios independently;
- `pnpm test:invariants` — generate and enforce the invariant-to-test report;
- `pnpm test` — run all staged test and proof commands above;
- `pnpm build` — force a clean production compilation pass;
- `pnpm gate:quality` — run formatting, documentation, lint/audits, typecheck,
  the seven test/proof stages, and the production build in the required order.

The exact implemented proof coverage is recorded in the M1 implementation plan
and completion review. The test runner fails when any invoked test is failed,
cancelled, skipped, or marked todo. A green quality command proves only the
checks present at its recorded source identity.

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

The public entry is `codeclosure`. Codex is the planned M2 execution backend,
not the product entry and not the completion authority.

## Canonical Documents

- [Product contract](PRODUCT.md)
- [Architecture](ARCHITECTURE.md)
- [Runtime invariants](RUNTIME_INVARIANTS.md)
- [Domain model](docs/domain-model.md)
- [Workflow state machine](docs/workflow.md)
- [Context compiler](docs/context-compiler.md)
- [Acceptance engine](docs/acceptance-engine.md)
- [Evidence model](docs/evidence-model.md)
- [Goal Intake](docs/goal-intake.md)
- [Milestones](docs/milestones.md)
- [M1 deterministic-skeleton plan](docs/plans/m1-deterministic-skeleton.md)
- [M1 completion review](docs/reviews/m1-completion-review.md)
- [M2 Codex vertical-slice plan](docs/plans/m2-codex-vertical-slice.md)
- [M2 milestone acceptance plan](docs/plans/m2-acceptance-plan.md)
- [M0 architecture review](docs/reviews/m0-architecture-review.md)
- [Accepted ADR index](docs/adr/README.md)

Repository instructions and document precedence are defined in
[AGENTS.md](AGENTS.md).

## Current Milestone Boundary

M1 proved the deterministic local control plane with `FakeWorker` and remains
the required regression baseline. M2 is limited to a real Codex execution,
Candidate, verification, repair, and recovery vertical slice under those same
authority rules. Goal Intake remains a separate M2.5 milestone that can begin
only after M2 passes its exit review.

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
