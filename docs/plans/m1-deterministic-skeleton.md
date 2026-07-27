# M1 Deterministic Skeleton Implementation Plan

- Status: Ready for implementation after the M0 baseline commit
- Plan date: 2026-07-27
- Milestone: M1
- Worker backend: `FakeWorker` only
- Product-code Codex dependency: prohibited in M1

M1 implementation begins only after the canonical M0 documents and accepted
ADRs are tracked in a version-control baseline. This plan being present in an
untracked working tree is not that baseline.

## 1. Outcome

M1 delivers a local executable that proves CodeClosure—not its worker—owns
workflow and technical completion.

The milestone is successful when one controlled demo can reach `CLOSEOUT` only
through a current Acceptance Decision, while adversarial demos involving a
lying worker, missing evidence, stale versions, candidate drift, restart, and
duplicate delivery all fail closed or recover safely.

M1 does not edit a real project. Candidate and verification behavior are
deterministic domain fixtures so the authority mechanics can be tested without
model or filesystem ambiguity.

## 2. Fixed engineering baseline

The first implementation uses:

- Node.js `>=22.22.0 <23`;
- pnpm `11.1.3`, pinned through the root `packageManager` field;
- strict TypeScript with ESM and project references;
- `node:test` for the primary test harness;
- `fast-check` for reducer/property tests where state combinations matter;
- `better-sqlite3` behind a repository-owned store adapter;
- `zod` at CLI, persistence-decoding, and worker-event trust boundaries;
- ESLint with TypeScript rules plus Prettier for static/style checks;
- ordered SQL migration files and a `schema_migrations` table;
- Node `util.parseArgs` for the M1 CLI;
- SHA-256 over exact RFC 8785 canonical JSON and the versioned projections in
  [ADR 0006](../adr/0006-canonical-serialization-and-digest-profiles.md);
- injected clocks, ID generators, and fake digest sources in tests.

All third-party versions are exact in `pnpm-lock.yaml`. If a dependency proves
incompatible during the scaffold spike, changing it requires updating this plan
or an ADR before relying on the replacement.

[`node:sqlite`](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html)
is not selected for the Node 22 baseline because that API remains in active
development. The selected
[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) release supports
current Node versions, including Node 22, but the SQLite port keeps the driver
choice replaceable.

## 3. Workspace boundary

```text
apps/
  cli/                    user and machine-readable command surface
packages/
  domain/                 pure types, aggregates, policies, reducers
  runtime/                application commands and orchestration
  store-sqlite/           SQLite port implementation and migrations
  testing/                FakeWorker, deterministic fixtures, harnesses
docs/                     product authority and plans
```

Minimal context, evidence, and acceptance modules live in `domain` or `runtime`
during M1. They become separate packages only when a later implementation has a
real boundary, not merely to mirror the architecture diagram.

Dependency direction:

```text
apps/cli -> packages/runtime -> packages/domain
    |                 |
    |                 v
    |           packages/store-sqlite
    |
    `-> packages/testing (M1 fixture composition only)

packages/testing -> public domain/runtime test ports
```

`domain` has no imports from SQLite, CLI, FakeWorker, Codex, process globals,
the filesystem, or wall-clock APIs.

The CLI composition root may construct `FakeWorker` from `packages/testing` for
M1 `demo run` and `--fixture` commands. Neither `domain` nor `runtime` imports
`packages/testing`; M2 replaces this composition edge with a real adapter.

## 4. M1 command surface

The CLI is intentionally small:

```text
codeclosure goal create --objective <text> --project <path> [--json]
codeclosure goal start <goal-id> [--fixture <name>] [--json]
codeclosure goal status <goal-id> [--json]
codeclosure goal resume <goal-id> [--json]
codeclosure goal cancel <goal-id> [--json]
codeclosure audit show <goal-id> [--json]
codeclosure demo run <scenario> [--json]
```

`demo run` is an M1 proof surface backed only by named deterministic fixtures:

- `happy-path`;
- `lying-worker`;
- `missing-evidence`;
- `failing-evidence`;
- `stale-closeout`;
- `restart-resume`;
- `duplicate-result`;
- `candidate-drift`.

There is no public “set phase” or “mark complete” command. CLI handlers submit
application commands and render persisted results; they never write tables.

`CreateGoal` atomically creates the Goal and its Workflow in
`DISCOVERY`/`READY`; it does not dispatch a worker. `StartGoal` begins the first
DISCOVERY Attempt and moves run status through the normal guarded command path.
This keeps persisted phase initialization distinct from execution start.

Machine output uses a versioned envelope:

```text
CommandOutput
  schemaVersion
  commandId
  ok
  goalId?
  workflowVersion?
  phase?
  runStatus?
  acceptanceOutcome?
  dominantBlocker?
  error?
```

Human output is a view over the same response.

## 5. Domain commands and ports

### Commands

M1 application commands include:

- `CreateGoal`;
- `StartGoal`;
- `BeginAttempt`;
- `SubmitWorkerResult`;
- `RequestPhaseAdvance`;
- `FreezeCandidate`;
- `RecordEvidence`;
- `EvaluateAcceptance`;
- `CloseAcceptedGoal`;
- `InterruptAttempt`;
- `ResumeGoal`;
- `CancelGoal`.

Every mutating command carries a `CommandId`; aggregate commands also carry an
`expectedVersion`. Duplicate `CommandId` delivery returns the previously
recorded outcome without replaying side effects.

M1 treats Attempt as a child of the Workflow aggregate. Attempt lifecycle
commands therefore carry `expectedWorkflowVersion` and advance the Workflow
version; they do not introduce an independent Attempt version. See
[ADR 0007](../adr/0007-workflow-owned-attempt-lifecycle.md).

### Ports

```text
Clock
IdGenerator
Canonicalizer
DigestProvider
UnitOfWork
GoalRepository
WorkflowRepository
CandidateRepository
EvidenceRepository
AcceptanceRepository
AuditRepository
WorkerPort
RecoveryInspector
```

`WorkerPort` emits typed worker events and accepts an `AbortSignal`. It cannot
receive a store transaction or repository implementation.

## 6. Persistence contract

The first schema contains normalized tables for:

- `goals` and `goal_criteria`;
- `workflows`;
- `attempts`;
- `candidate_generations`;
- `context_manifests`;
- `facts` and `human_decisions` at M1 minimum fidelity;
- immutable `policy_bundles` with checker identities and canonical content;
- `verification_obligations`;
- immutable `evidence_records` and monotonic `evidence_eligibility`;
- `pending_issues`;
- `acceptance_input_manifests`;
- `acceptance_decisions` and rule results;
- `processed_commands` for idempotency;
- `audit_events`;
- `schema_migrations`.

Mutating application services execute this shape:

```text
BEGIN IMMEDIATE
  verify command is new
  read aggregate at expected version
  evaluate pure domain command
  update current state with version predicate
  append audit event(s)
  record command outcome
COMMIT
```

Any failure rolls back the whole unit. The database enables foreign keys and a
bounded busy timeout. Migration application is itself transactional where
SQLite permits it, and every migration has a forward test from an empty store
plus a reopen test.

M1 state lives under a test- or application-owned data directory, never under a
FakeWorker candidate path. Tests use a fresh temporary directory or an explicit
in-memory adapter where persistence behavior is not under test.

## 7. Pure control model

The domain exposes a pure transition function conceptually equivalent to:

```text
decide(currentState, command, policy) -> events | rejection
```

It verifies:

- command and aggregate identity;
- expected version;
- legal phase edge;
- phase-specific guard results;
- candidate generation and freeze state;
- manifest and decision currency;
- terminal/run-status restrictions.

Persistence applies returned events only after all guards pass. No adapter may
construct a `TransitionRecord`, `AcceptanceDecision`, or `CLOSED` Goal through
a public bypass constructor.

## 8. FakeWorker contract

`FakeWorker` is deterministic from a fixture plus the incoming Worker Request.
It can emit:

- valid proposals and Completion Requests;
- malformed or unknown events;
- a fabricated `accept` field;
- delayed completion;
- duplicate results;
- error, cancellation, or abrupt termination;
- a result bound to an old Context Manifest;
- an attempted control-state mutation payload.

The adapter validates event shape. The runtime validates meaning. Tests must
prove both layers; schema validation alone is not the security boundary.

## 9. Minimal candidate, context, evidence, and acceptance path

### Candidate

M1 creates a logical generation with an injected deterministic source identity.
`SOURCE_FREEZE` changes `MUTABLE -> FREEZING -> FROZEN` and records a digest.
Repair creates a child generation; no command transitions `FROZEN -> MUTABLE`.

### Context

Each Attempt receives a canonical Context Manifest containing schema/compiler
versions, Goal/Workflow/Attempt identity, phase, capabilities, explicit
fact/decision references, Candidate identity where applicable, policy and
response-contract identity, package digest, and manifest digest.

### Evidence

The fake verification producer records an immutable observation bound to Goal
revision, Candidate digest, check-spec version, policy digest, and observation
digest. A full Evidence record digest binds those identities and the immutable
result. Pass, fail, runner error, and timeout are immutable observed results.
Malformed or mismatched submissions are rejected before admission. Current
eligibility is a separate monotonic record that may move from `ELIGIBLE` to
`INELIGIBLE` without mutating the observation; EvidenceSet entries bind both the
record digest and eligibility version/state.

### Acceptance

The M1 engine evaluates the exact rules listed in
[acceptance-engine.md](../acceptance-engine.md#m1-rule-set). It emits an
immutable decision and trace. The closeout command rechecks the manifest,
decision, Candidate, policy, and Workflow version inside its transaction.
The minimal M1 Policy Bundle is installed and persisted by the runtime before it
is referenced; it is never loaded from a FakeWorker-writable path.

## 10. Build slices

### Slice 0 — Repository scaffold

- root workspace, toolchain pins, TypeScript configurations;
- lint/typecheck/test/build scripts;
- package-boundary smoke test;
- CI-ready local quality command.

Exit: empty packages compile and a failing test fails the quality command.

### Slice 1 — Domain identities and workflow reducer

- branded IDs and revisions;
- Goal, Workflow, Attempt, Candidate states;
- legal transition table and pure guards;
- deterministic clock/ID fixtures.

Exit: exhaustive phase-edge tests and representative illegal-state tests pass.

### Slice 2 — Transactional SQLite store

- migrations and repositories;
- optimistic concurrency;
- atomic audit and idempotent command outcomes;
- reopen/recovery fixtures.

Exit: injected failures at each transaction step leave neither partial state nor
orphan audit success.

### Slice 3 — Runtime commands and capabilities

- application command handlers;
- capability derivation;
- Attempt lifecycle, cancellation, retry classification;
- typed error/result envelope.

Exit: disallowed actions are rejected before worker dispatch or persistence.

### Slice 4 — Context and FakeWorker

- minimal compiler and Context Manifest;
- Worker Request/Event contract;
- adversarial FakeWorker fixtures;
- stale-result filtering and interruption.

Exit: worker text, result shape tricks, stale context, and duplicates cannot
advance authority.

### Slice 5 — Candidate and evidence

- generation reducer and fake digest;
- irreversible freeze;
- immutable bound Evidence observations and monotonic eligibility invalidation;
- fake verification obligations.

Exit: record-digest drift, eligibility changes, and cross-generation Evidence
are rejected.

### Slice 6 — Acceptance and closeout

- canonical Acceptance Input Manifest;
- immutable minimal Policy Bundle and checker identities;
- pure ordered-rule evaluation;
- immutable Acceptance Decision;
- transactional closeout race guard.

Exit: only a current `ACCEPT` can produce `CLOSED`/`CLOSEOUT`.

### Slice 7 — CLI, recovery, and proof demos

- command surface and JSON envelope;
- startup reconciliation;
- status, blocker, and audit views;
- all named demo scenarios.

Exit: a new process safely resumes an interrupted fixture and all demos have
asserted exit codes and final state.

### Slice 8 — M1 audit

- full test/quality run;
- schema and migration inspection;
- actual package-dependency audit;
- invariant-to-test report generated from test metadata;
- M1 completion review with exact command evidence.

Exit: every M1 claim is backed by current test output; skipped checks remain
visible and block the corresponding claim.

## 11. Invariant proof matrix

| Invariant | M1 proof |
| --- | --- |
| I-001–I-005 | API-boundary and adversarial closeout tests; no public worker mutation path |
| I-006–I-010 | SQLite restart, atomic transition, cancellation, and status-rendering tests |
| I-011–I-014 | logical candidate capability, freeze, new-generation, and change-manifest tests |
| I-015–I-018 | evidence binding, privilege, invalidation, digest, and redaction-schema tests |
| I-019–I-021 | canonical minimal Context Manifest, stale result, and transcript-independence tests |
| I-022 | explicit scenario-reference contract test; graph traversal remains M3 |
| I-023–I-026 | capability matrix, frozen verification, promotion non-command, and decision-type tests |
| I-027–I-030 | unknown/error fail-closed, retry budget, recovery reconcile, and proof-label tests |

Test names carry invariant metadata such as `[I-003]`. Slice 8 checks that every
invariant has at least one executable test. Where M1 uses a logical fake instead
of a real filesystem or runtime, the test proves the control contract and labels
the stronger operational proof as deferred to M2.

## 12. Quality gate

The root quality command must run, in order:

1. formatting check;
2. lint;
3. TypeScript typecheck;
4. unit and property tests;
5. canonical digest golden-vector and replay tests;
6. SQLite migration/reopen tests;
7. CLI integration and restart tests;
8. adversarial demo tests;
9. invariant-coverage check;
10. production build.

The exact script names are established in Slice 0 and documented in the root
README. A green command is evidence for M1 only when its source revision and
environment identity are recorded in the M1 review.

## 13. Stop conditions

Pause implementation and update architecture before proceeding if:

- a selected library requires domain code to import adapter types;
- authoritative state would need to live under the worker path;
- two components can independently persist workflow state;
- a worker result must be trusted to obtain a passing demo;
- a frozen generation must be edited in place;
- transaction and audit atomicity cannot be demonstrated;
- a convenience command would bypass the normal closeout guard.

## 14. M1 handoff to M2

M1 hands M2 a stable `WorkerPort`, Context Manifest, candidate-generation
contract, Evidence API, Acceptance API, error taxonomy, audit vocabulary, and
adversarial suite. M2 replaces fake execution and identity mechanisms; it does
not reopen who owns workflow or acceptance.
