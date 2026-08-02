# CodeClosure

**Reliable runtime for AI coding.**

CodeClosure is a local-first control runtime that sits above coding agents such
as Codex. The agent can inspect code, propose a plan, edit an isolated
candidate, and run tools. It cannot decide that the engineering goal is
complete.

> LLMs propose. CodeClosure decides what may become complete.

## Status

The M0 architecture baseline, bounded M1 deterministic skeleton, and bounded
M2 Codex vertical slice are complete. M2 passed its independent exit review on
2026-08-02 with its M1 regression, deterministic protected repair, failed-repair
stop, adapter-failure, live repair-handoff, and natural first-pass branches all
green on one source identity. M2.5 Goal Intake remains unimplemented, while
its initial interface decision closure is complete. The
[M2 implementation plan](docs/plans/m2-codex-vertical-slice.md) is the detailed
status source; the [milestone document](docs/milestones.md) defines the bounded
scope and exit criteria.

This README intentionally does not duplicate the rolling slice, feature, or
test inventory. M1 and M2 remain regression baselines. M2 completion does not
prove Goal Intake, product completion, or authority to merge, release, deploy,
or perform another external effect.

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
- `pnpm accept:m2` — run the canonical M2 milestone procedure; it completes the
  offline proof first and requires explicit bounded live authorization before
  any model-service request.

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

The public entry is `codeclosure`. Codex is the implemented bounded M2 execution
backend, not the product entry and not the completion authority.

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
- [M2 completion review](docs/reviews/m2-completion-review.md)
- [M0 architecture review](docs/reviews/m0-architecture-review.md)
- [Accepted ADR index](docs/adr/README.md)

Repository instructions and document precedence are defined in
[AGENTS.md](AGENTS.md).

## Current Milestone Boundary

M1 proved the deterministic local control plane with `FakeWorker`; M2 proved a
bounded real-Codex Candidate, verification, repair, and recovery vertical slice
under the same authority rules. Both remain required regression baselines.
M2.5 Goal Intake is the current implementation milestone. Its detailed
[implementation plan](docs/plans/m2.5-goal-intake-materialization.md) and
[acceptance plan](docs/plans/m2.5-acceptance-plan.md) govern the work. The
initial implementation decisions and dependency expectations are closed;
product implementation has not started.

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
