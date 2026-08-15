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
green on one source identity. Bounded M2.5 Goal Intake and Materialization also
completed on 2026-08-06: its corrected canonical assessment passed all nine
stages and 71 mandatory rows with zero skip, and its independent review issued
an unconditional bounded verdict. M2.5 remains a regression baseline rather
than product completion or external-effect authority.

M2.5.1 Real Intake-to-Codex Composition Closure completed its bounded review on
2026-08-13. Its explicitly authorized canonical assessment passed all 13 stages
and 68 mandatory rows on exact source `dfe4798`, including real Answer-only and
Intent Intake, ordinary Start, real candidate-free `DISCOVERY`/`PLAN`, real
Candidate-bound `IMPLEMENT`, protected verification, Evidence, Acceptance,
closeout, strict reopen, containment, cleanup, and the complete M1/M2/M2.5
regression set. The independent review issued an unconditional bounded `PASS`.
Historical M2/M2.5 identities retain their original meaning, Fake components
remain explicit test infrastructure, and this result is not product completion
or external-effect authority.

M2.6 Unified Frontstage Interaction and Control is the current formalization.
Its M2.5.1 prerequisite is satisfied, ADR 0036 through ADR 0039 are accepted,
and its exact decision and proof contract passed bounded closure review on
2026-08-14. The first implementation boundary—Interaction Domain, strict
codecs, lifecycle and relationship invariants, canonical digest projections,
and deterministic Runtime policy—also passed bounded review on 2026-08-14.
The bounded SQLite Interaction authority passed independent review on
2026-08-16. Assistant Adapter, routing composition, Goal query/control, and
Frontstage CLI work have not started.
The candidate scope is one foreground CLI frontstage, natural-language user
input, an exact immutable pending-action/authorization/dispatch chain for the
closed new-Intake and Goal-control action set, deterministic direct-or-separate
confirmation, scoped Goal discovery/control, and one session-owned
execution-bearing task. Exact M2.5 Question clarification retains its existing
authority. Detached execution remains outside M2.6.

M2.7 Local Runtime Host and Single-Goal Project Control is a separate formal
candidate with no implementation started. It proposes CLI detach/reconnect, one
writable controller plus read-only observers, and one started non-terminal Goal
per exact project. It explicitly excludes queues, automatic handoff, automatic
next-Goal Start, parallel Goal workers, multi-user operation, and
release/deployment authority.

The [M2.6 implementation plan](docs/plans/m2.6-unified-frontstage-interaction.md)
is the current detailed status source; the [milestone
document](docs/milestones.md) defines completed and proposed bounded scopes and
exit criteria.

This README intentionally does not duplicate the rolling slice, feature, or
test inventory. M1 and M2 remain regression baselines.

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
  any model-service request;
- `pnpm regress:m2` — run the non-verdict current-source M2 regression profile;
  it preserves the applicable deterministic/live baseline without reissuing
  the historical M2 Goal-Intake-absence verdict;
- `pnpm accept:m2.5` — run the non-verdict M2.5 executable assessment and emit
  evidence that is only an input to the later independent milestone review;
- `pnpm regress:m2.5` — run the non-verdict current-source M2.5 regression
  profile without reissuing its historical milestone verdict;
- `pnpm accept:m2.5.1` — run the non-verdict M2.5.1 executable assessment; real
  model-service stages require the command's explicit bounded authorization.
- `pnpm check:m2.5.1:slice0` — validate the frozen M2.5.1 identities, protocol
  dispositions, proof ownership, unchanged-schema causality, and protected
  demonstration checker without claiming production implementation.
- `pnpm check:m2.6:slice0` — validate the accepted M2.6 decision set, exact
  local identities, closed grammar/enums/budgets, and one planned owner for
  every mandatory acceptance row without claiming feature implementation.
- `pnpm probe:m2.5.1:intake:live` — after explicit environment authorization,
  run the pinned lower-client prerequisite and the three isolated real Intake
  compatibility paths, emitting only validated metadata receipts.

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
- [Frontstage Interaction](docs/frontstage-interaction.md)
- [Local Runtime Host](docs/runtime-host.md)
- [Milestones](docs/milestones.md)
- [M1 deterministic-skeleton plan](docs/plans/m1-deterministic-skeleton.md)
- [M1 completion review](docs/reviews/m1-completion-review.md)
- [M2 Codex vertical-slice plan](docs/plans/m2-codex-vertical-slice.md)
- [M2 milestone acceptance plan](docs/plans/m2-acceptance-plan.md)
- [M2 completion review](docs/reviews/m2-completion-review.md)
- [M2.5 completion review](docs/reviews/m2.5-completion-review.md)
- [M2.6 Unified Frontstage Interaction plan](docs/plans/m2.6-unified-frontstage-interaction.md)
- [M2.6 milestone acceptance plan](docs/plans/m2.6-acceptance-plan.md)
- [M2.7 Local Runtime Host plan](docs/plans/m2.7-local-runtime-host-single-goal-control.md)
- [M2.7 milestone acceptance plan](docs/plans/m2.7-acceptance-plan.md)
- [M0 architecture review](docs/reviews/m0-architecture-review.md)
- [Accepted ADR index](docs/adr/README.md)

Repository instructions and document precedence are defined in
[AGENTS.md](AGENTS.md).

## Current Milestone Boundary

M1 proved the deterministic local control plane with `FakeWorker`; M2 proved a
bounded real-Codex Candidate, verification, repair, and recovery vertical slice
under the same authority rules. Both remain required regression baselines.
M2.5 Goal Intake is also complete as a bounded milestone. Its historical
[implementation plan](docs/plans/m2.5-goal-intake-materialization.md) and
[acceptance plan](docs/plans/m2.5-acceptance-plan.md), together with its
[completion review](docs/reviews/m2.5-completion-review.md), remain the bounded
implementation and verdict records.

M2.6 is the current formalization. Its [Frontstage Interaction
contract](docs/frontstage-interaction.md), [implementation
plan](docs/plans/m2.6-unified-frontstage-interaction.md), and [acceptance
plan](docs/plans/m2.6-acceptance-plan.md) bind the accepted planned boundary;
its executable decision/proof contract passed bounded review, which is not a
feature-implementation or acceptance claim. Deferred capabilities remain
assigned directly to M2.7, M3, M4, or M5.

M2.7 is the separate post-M2.6 candidate. Its [Local Runtime Host
contract](docs/runtime-host.md), [implementation
plan](docs/plans/m2.7-local-runtime-host-single-goal-control.md), and
[acceptance plan](docs/plans/m2.7-acceptance-plan.md) define detached local
execution ownership, one project controller plus observers, and one active Goal
slot without queueing or automatic handoff. M2.6 must complete before M2.7
implementation may begin.

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
