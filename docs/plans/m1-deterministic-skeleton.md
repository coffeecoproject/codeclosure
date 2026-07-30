# M1 Deterministic Skeleton Implementation Plan

- Status: In implementation; Slices 0–7 are implemented and the Slice 8 M1
  completion audit remains
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

The implemented Slice 7 trusted composition module resolves and verifies the
application-data home, activates SQLite through one guarded
inspection/migration lifecycle, installs the exact built-in M1 Policy and eight
named Execution Profiles, constructs production clock/identity providers, runs
startup reconciliation, and only then publishes the narrow application facade.
See
[ADR 0020](../adr/0020-runtime-application-recovery-and-query-boundary.md) and
[ADR 0021](../adr/0021-m1-execution-profile-and-cli-composition.md), plus
[ADR 0023](../adr/0023-verified-sqlite-authority-activation.md).

The CLI package began with only the public Runtime surface. Slice 7 now permits
SQLite, Runtime-composition, and testing-package imports only in separately
named privileged composition modules, each with its own exact named-import
allowlist. Those modules construct the application and hand CLI handlers the
narrow Goal capability and read views; handler and proof modules MUST NOT
receive or import the raw store.

The implemented source boundary gate partitions
`apps/cli/src/composition/` into ordinary support/proof code and an exact list
of privileged owners. Only `apps/cli/src/index.ts` may invoke the closed
composition root; ordinary CLI handlers may import only an explicit allowlist
of facade and view contracts from the Runtime package root. Privileged
composition MUST use static named package exports, MUST NOT reach through
repository-internal or `node_modules` paths, and MUST NOT re-export imported
Store, Runtime composition, or testing capabilities. Every relative import
MUST remain inside `apps/cli/src`; external imports use a closed set of approved
package names. Each privileged module has an exact direct-export manifest, and
each sensitive internal module has exact importer and imported-name rules.
Dynamic `import`, `require`, Node module loader acquisition, and aliases of
those loaders fail the source gate. The testing-package allowlist exists only
on the M1 runtime-profile owner and contains only the Fake adapters and closed
profile registry; deterministic test identities and other harness capabilities
are rejected. The restart proof may observe a durable dispatch claim only
through its named read-only observer; the gate prevents direct or forwarded
access to the SQLite authority module. Compile-backed reverse tests cover the
otherwise valid `node_modules` bypass. This source check is a gate for
statically evident engineering miswiring, not a sandbox for hostile JavaScript;
it prevents accidental capability routing but does not replace Runtime and
Store authority validation.

## 4. M1 command surface

The CLI is intentionally small:

```text
codeclosure goal create --objective <text> --project <path> \
  --criterion <text> [--criterion <text> ...] [--json]
codeclosure goal start <goal-id> [--fixture <name>] [--json]
codeclosure goal status <goal-id> [--json]
codeclosure goal resume <goal-id> [--json]
codeclosure goal cancel <goal-id> [--json]
codeclosure audit show <goal-id> [--json]
codeclosure demo run <scenario> [--json]
```

The Goal lifecycle/status, audit, and proof-demo commands above are currently
implemented. They enter through the real executable, parse untrusted operands
through a closed `parseArgs` plus Zod boundary, receive only narrow Runtime or
proof capabilities, and close the verified SQLite composition after each
ordinary Goal invocation. `StartGoal` and `ResumeGoal` return the Runtime
command outcome separately from the informational driver stop summary. Every
demo owns an isolated temporary application home and succeeds only after its
expected final status, audit, and strict SQLite reopen state have been asserted.

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

At least one non-blank `--criterion` is required and every M1 CLI criterion is
required. The objective is never copied into an implicit criterion. M1 records
an empty allowed-path set because it performs no real source writes; that is no
authorization to edit the whole project. A relative `--project` operand is
resolved once against the invoking process's working directory, and Runtime
persists only the normalized absolute path.

`CreateGoal` atomically creates the Goal and its Workflow in
`DISCOVERY`/`READY`; it does not dispatch a worker. `StartGoal` begins the first
DISCOVERY Attempt and moves run status through the normal guarded command path.
The application coordinator invokes the Goal Manager and Workflow Runtime's
separate creation rules and does not become another mutation owner.
`StartGoal`, `ResumeGoal`, and `CancelGoal` are public Goal commands: they carry
`GoalId`, expected Goal revision, and expected Workflow version. `ResumeGoal`
is implemented through the narrow recovery capability; it is not a lower-level
Attempt command. Internal Attempt and transition commands are not public CLI
alternatives. This keeps persisted phase
initialization distinct from execution start. Goal and owned Workflow
resolution uses one consistent store snapshot; the write transaction then
revalidates the Workflow version. See
[ADR 0008](../adr/0008-goal-command-and-lifecycle-boundary.md).

`StartGoal` also resolves the installed M1 Policy and named Execution Profile
and binds both identities separately and immutably in the first Context-bound
Attempt transaction. Omitted `--fixture`
selects the versioned `happy-path` profile. `ResumeGoal` loads that exact
binding and offers no profile override. Startup reconciliation leaves recovered
work blocked; a safe resume commits a fresh exact recovery record before the
Runtime driver creates replacement work.

The Runtime package root returns a Goal application capability containing only
those public Goal mutations. The internal control kernel is omitted from the
package-root export surface. Internal phase requests do not accept
caller-authored `GuardResult` values; ordinary guard evaluators are injected
only into the internal kernel. Closeout is available only through the Slice 6
Acceptance path; generic internal phase requests cannot invoke it.

The Runtime mutating response uses a versioned command output:

```text
CommandOutput
  schemaVersion
  commandId
  ok
  goalId?
  workflowVersion?
  phase?
  runStatus?
  error?
```

That public `CommandOutput` is stored inside a separate
`StoredCommandOutcomeEnvelope` v3 authored by the Store in the command
transaction. Its `APPLIED` and `REJECTED` variants bind the exact target,
owning Goal and Workflow, and observed Workflow snapshot. The storage envelope
is an authority record, not an additional user-facing completion surface. See
[ADR 0010](../adr/0010-command-admission-and-outcome-binding.md) and
[ADR 0011](../adr/0011-store-authored-command-outcome-semantics.md).

The CLI JSON renderer wraps that Runtime result, Runtime read result, or exact
demo proof in a separate schema-versioned tagged envelope. The implemented
tags are `COMMAND_RESULT`, `DRIVEN_COMMAND_RESULT`, `GOAL_STATUS`,
`GOAL_AUDIT`, `DEMO_RESULT`, and `CLI_ERROR`. Human output is a view over the
same envelope and never manufactures Acceptance or closeout fields.

Slice 7 status and blocker views read the immutable Acceptance Decision
separately. They MUST NOT enrich the stored command outcome into another
completion authority.

JSON mode writes one versioned document to stdout and diagnostics to stderr.
Exit `0` means the CLI operation or expected adversarial-demo assertion
succeeded, `2` is usage/unadmitted validation, `3` is deterministic command
rejection or conflict, `4` is governed waiting/blocking/failure before requested
progress, and `5` is infrastructure or internal failure. Status/audit reads of
a blocked Goal and an applied cancellation return `0` while still rendering
their non-success lifecycle explicitly. See
[ADR 0021](../adr/0021-m1-execution-profile-and-cli-composition.md).

The implemented command surface has subprocess coverage for all five reserved
exit classifications. In particular, an applied start that reaches a current
repairable Acceptance decision returns `4`, while its exact decision remains
in Runtime status authority rather than in the exit code.

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
- `BeginAcceptanceRepair`;
- `InterruptAttempt`;
- `ReconcileRecovery` (trusted internal lifecycle command);
- `ResumeGoal`;
- `CancelGoal`.

Every admitted mutating application command carries a `CommandId`; aggregate
commands also carry an `expectedVersion`. Duplicate `CommandId` delivery with
the same canonical input returns the previously recorded outcome, including a
deterministic rejection, without replaying side effects. Reusing it for a
different input fails closed.

Untrusted worker delivery instead carries a `WorkerEventId`. The adapter
validates and deduplicates it before constructing an internal command; a worker
cannot supply a `CommandId`, and stale worker delivery creates no application
command outcome. See
[ADR 0009](../adr/0009-command-idempotency-and-worker-boundary.md).

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
ExecutionProfileRepository
WorkerPort
RecoveryCatalog
RecoveryInspector
GoalStatusReader
GoalAuditReader
```

Slice 4 introduces `WorkerPort` together with the Context Manifest and Worker
Request/Event schemas. The port receives a runtime-created, digest-bound
request and an `AbortSignal`, emits typed worker events, and cannot receive a
store transaction or repository implementation. Slice 3 MUST NOT expose a
generic authorized-effect callback while that typed contract is absent.

## 6. Persistence contract

The first schema contains normalized tables for:

- `goals` and `goal_criteria`;
- `workflows`;
- `attempts`;
- immutable installed `execution_profiles` and one
  `workflow_execution_profile_binding` per started Workflow;
- immutable `recovery_reconciliations`;
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
derive canonical input digest
if command exists: validate digest plus stored target/Goal/Workflow/output bindings
resolve the top-level Goal/Workflow snapshot
verify expected Goal revision and Workflow version
only then resolve child state, evaluate guards, allocate IDs, and plan
BEGIN IMMEDIATE
  revalidate command identity and Workflow version
  evaluate pure domain command
  if accepted: update current state with version predicate
               append audit event(s)
               Store authors APPLIED outcome from resulting Workflow
  if rejected: Store authors REJECTED outcome from observed Workflow and
               deterministic command error
  record the semantically bound command outcome envelope
COMMIT
```

A deterministic rejection is recorded only if the aggregate remains at the
version against which it was evaluated. A concurrent change causes reload and
reevaluation. Malformed input, unknown aggregate identity, and infrastructure
failure are not admitted command outcomes.

The same centralized freshness gate runs before Attempt lookup, phase/closeout
evaluation, and other command-specific planning. Processed outcomes bind their
row target, `CommandId`, owning Goal and Workflow, disposition, Workflow
snapshot, and nested output. Migration 0005 rejects legacy outcome rows that
lack identity binding. Migration 0006 rejects existing version 2 outcomes that
lack enough information to prove transaction semantics; M1 does not invent a
historical owner, disposition, or snapshot during upgrade.

Runtime-owned control timestamps use the causal policy in
[ADR 0012](../adr/0012-causal-control-timestamps.md). A valid clock rollback is
clamped to the current aggregate floor; malformed clock output is an internal
failure. Reducers and the Store reject bypassed older events, and migration
0007 adds SQLite backstops for nondecreasing current state, Attempt start/end
causal floors, terminal Workflow immutability, control audit time, and
processed-command completion time.

Authority-bearing records follow the validation closure in
[ADR 0013](../adr/0013-authority-boundary-validation-closure.md). Runtime port
returns, Store mutation inputs, resulting state, and persistence reads pass the
owning codecs. Normal command admission and replay share one Goal/Workflow
authority resolver. Migration 0008 preflights retained control records and adds
SQLite scalar and relationship backstops. A Store `APPLIED` result is tested as
an immediate-read and close/reopen guarantee, not only as a returned tag.

Migration 0010 closes the remaining Worker-path authority relationships. It
refuses unaudited retained Policies, unresolved external or Candidate M1
Context sources, Worker receipts without a prior dispatch claim, and terminal
Attempts whose end time predates dispatch. New Policy installation computes
identity in the Runtime, independently recomputes it in the Store, and commits
the Policy plus audit as one unit. After migrations, Store startup revalidates
retained Policy content and audit linkage, rederives M1 Context identity from
its authoritative sources, and checks claim, terminal-Attempt, and receipt
causality so offline database changes cannot become trusted merely by reopening
the Store. See
[ADR 0015](../adr/0015-close-m1-worker-authority-causality.md).

The store port returns version and command-identity conflicts as discriminated
results. Runtime code MUST NOT inspect adapter exception names to recover those
protocol outcomes. Only calls through the store port map to persistence
failures; guard/policy evaluators are schema-validated inside their evaluation
boundary, and malformed returns remain evaluation failures. Runtime internal
computation has a separate failure category. None of these infrastructure
failures is recorded as a deterministic command outcome.

Any failure rolls back the whole unit. The database enables foreign keys and a
bounded busy timeout. Migration application is itself transactional where
SQLite permits it, and every migration has a forward test from an empty store
plus a reopen test.

M1 state lives under the platform application-data home fixed by
[ADR 0021](../adr/0021-m1-execution-profile-and-cli-composition.md), never
under the target project or a FakeWorker candidate path. An absolute
`CODECLOSURE_HOME` is an optional override; the CLI does not depend on it.
Tests and demos use a fresh explicit temporary home or an in-memory adapter only
where persistence and restart behavior are not claimed. Isolation checks use
resolved filesystem identity and ancestry, not textual path prefixes; ambiguous
or symlink-mediated overlap fails closed.

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

The pure reducer receives already evaluated guard results because it validates
transition policy, not producer authority. The application layer is
responsible for obtaining those results from the owning evaluator and MUST NOT
copy them from a public request.

## 8. FakeWorker contract

`FakeWorker` is deterministic from a fixture plus the incoming Worker Request.
Its event IDs are derived from that request, fixture, and event ordinal rather
than from the fixture alone.
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

Each current M1 Worker Attempt receives a canonical Context Manifest containing
schema/compiler versions, Goal/Workflow/Attempt identity, phase, capabilities,
bound Execution Profile, policy and response-contract identity, package
digest, and manifest digest.
Selected entries and omissions remain empty and ordinary Manifest entries are
still limited to compiler-owned Goal and criterion entries. Slice 5 adds one
dedicated binding for an `IMPLEMENT` Worker: the exact active `MUTABLE`
Candidate generation and `baseDigest`, resolved through Candidate authority and
rechecked by Runtime and Store. Non-`IMPLEMENT` M1 packages remain
Candidate-free.

### Evidence

The fake verification producer records an immutable observation bound to Goal
revision, Candidate digest, check-spec version, policy digest, and observation
digest. The runner returns only a closed result status; request-aware Runtime
admission owns the producer/check binding and canonical observation. A full
Evidence record digest binds those identities and the immutable result. Pass,
fail, runner error, and timeout are immutable observed results. Malformed,
mismatched, oversized, late, or exception-producing submissions admit no
Evidence and persist only closed failure reasons. Current eligibility is a
separate monotonic record that may move from `ELIGIBLE` to `INELIGIBLE` without
mutating the observation; EvidenceSet entries bind both the record digest and
eligibility version/state.

### Acceptance

The M1 engine evaluates the exact rules listed in
[acceptance-engine.md](../acceptance-engine.md#m1-rule-set). It emits an
immutable decision and trace. The closeout command rechecks the manifest,
decision, Candidate, policy, and Workflow version inside its transaction.
The minimal M1 Policy Bundle is installed and persisted by the runtime before it
is referenced; it is never loaded from a FakeWorker-writable path. Composition
supplies an undigested definition, while Runtime and Store independently bind
its canonical identity and persist its installation audit atomically.

Built-in M1 Execution Profiles follow the same immutable installation rule.
The Workflow binding selects adapters and driver version without persisting
functions or secrets. Context, dispatch, specialized fake operations, recovery,
and resume must resolve the same profile digest. An exact existing definition
is reused with its original installation authority; an identity/content
conflict fails closed.

Policy installation is not Workflow selection. First Start creates a separate
immutable Workflow Policy binding, and every later transition, Context,
Evidence, Acceptance, repair, recovery, closeout, and driver operation resolves
that exact ID and digest. Resume checks compatibility before recovery writes;
M1 never silently upgrades a started Workflow to another installed Policy.

The profile migration upgrades only legacy databases whose Workflows have never
started. Any retained Attempt or later execution authority without a profile
binding makes migration fail atomically; it is neither assigned a guessed
profile nor deleted. Because M1 is not released, operators preserve such a
development database separately and use a new application home rather than
introducing a second legacy execution model.

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

Exit: disallowed application commands are rejected before state mutation;
accepted and deterministically rejected command outcomes replay consistently.
The public package surface contains only Goal mutations, missing child-entity
rejections replay consistently, and store conflicts are handled through the
typed port. Stale expectations are rejected before child/guard-specific work,
stored outcomes cannot replay across Goal/Workflow identities, and evaluator,
persistence, and internal failures remain distinguishable. Capability tests
prove policy derivation only. They do not claim an external dispatch boundary
before Slice 4 or a closeout path before Slice 6.

### Slice 4 — Context and FakeWorker

Implementation status (2026-07-28): implemented and verified at the Runtime,
domain, `FakeWorker`, and SQLite boundaries. This closes Slice 4 only; it is not
an M1 completion claim.

- minimal compiler and Context Manifest;
- Worker Request/Event contract;
- adversarial FakeWorker fixtures;
- independently identified worker-event admission, stale-result filtering, and
  interruption;
- typed, manifest-bound dispatch serialized against cancellation.

Exit: worker text, result shape tricks, stale context, and duplicates cannot
advance authority. Empty or invalid-only streams terminate as
`PROTOCOL_ERROR`, abrupt termination remains distinct, and control-plane event
admission failure is not relabelled as Worker failure. Runtime-authored stream
failures require the same exact durable dispatch claim as event admission. Its
claim time is the causal floor for every later result, failure, cancellation,
or restart reconciliation. Worker events are byte-bounded by their compiled
response contract, and closed Worker reason codes map to Runtime-owned failure
classes that Store and SQLite recheck.

The proof includes fail-closed M1 Context source authority, Runtime-owned
selection and installation identity for Policy, atomic Attempt-plus-Manifest
start, durable dispatch claims serialized against cancellation, causal Worker
receipts, restart reads, SQLite relationship backstops, and injected rollback
failures after each new authority write. See
[ADR 0014](../adr/0014-context-bound-worker-dispatch-and-event-admission.md)
and [ADR 0015](../adr/0015-close-m1-worker-authority-causality.md), as refined
by
[ADR 0017](../adr/0017-derive-boundary-authority-and-replay-evidence-by-audit-sequence.md).

### Slice 5 — Candidate and evidence

Implementation status (2026-07-28): implemented and verified at the Runtime,
domain, deterministic Candidate Source/Verification Runner, Context, SQLite,
migration, and reopen boundaries. This closes Slice 5 only; it is not an M1 or
product completion claim. See
[ADR 0016](../adr/0016-candidate-and-evidence-authority-boundary.md) and
[ADR 0017](../adr/0017-derive-boundary-authority-and-replay-evidence-by-audit-sequence.md).

- generation reducer and fake digest;
- irreversible freeze;
- immutable bound Evidence observations and monotonic eligibility invalidation;
- generation-scoped fake verification obligations;
- canonical Evidence Set persistence for Slice 6 input.
- audit-sequence replay of immutable historical Evidence Sets, separate from
  current eligibility.

Exit: record-digest drift, eligibility changes, and cross-generation Evidence
are rejected. Source drift atomically invalidates Candidate/Evidence authority;
Worker output cannot become privileged Evidence; exact obligation, Policy,
check, audit, and Context bindings are revalidated on write and reopen. A Goal
without a required criterion and an empty required-obligation/Evidence Set
cannot advance by vacuous truth. SQLite treats missing JSON or nullable
authority fields as invalid and preserves earlier Context-entry constraints
when Slice 5 extends them. Runtime and Store independently require the exact
canonical Evidence mapping, including no reuse of one Evidence record across
obligations. Forged verifier bindings and sensitive adapter diagnostics fail
closed without entering authoritative persistence. Candidate and Evidence
producer identities are Runtime/Check-derived rather than accepted from source
ports, and later invalidation preserves historical Evidence Set readability
while making that set non-current.

### Slice 6 — Acceptance and closeout

Implementation status (2026-07-28): implemented and verified at the domain,
deterministic Acceptance Engine, Workflow Runtime, SQLite transaction,
migration, replay, and reopen boundaries. This closes Slice 6 only; it is not
an M1 or product completion claim. See
[ADR 0018](../adr/0018-deterministic-acceptance-and-closeout-authority.md).
Exact repair restart authority is refined by
[ADR 0019](../adr/0019-exact-acceptance-repair-authority.md).

- canonical Acceptance Input Manifest;
- immutable minimal Policy Bundle and checker identities;
- pure ordered-rule evaluation;
- immutable Acceptance Decision;
- transactional closeout race guard;
- atomic repair into a fresh child Candidate generation;
- immutable repair binding for the exact rejection, child, fresh Checks,
  Obligations, audit command, and processed outcome;
- strict Pending Issue input and empty M1 Fact/Human Decision snapshots.

Exit: only a current `ACCEPT` can produce `CLOSED`/`CLOSEOUT`. Evaluation does
not mutate lifecycle state; fail/error/timeout and stale-input paths fail
closed; repair consumes only a current `REJECT_REPAIRABLE`; evaluation,
closeout, and repair roll back at every authority-write fault point; semantic
replay, pre-authority terminal-state migration refusal, source drift, exact
closeout/repair-record restart closure, and retained-history reopen are covered
by deterministic tests. Migration refuses pre-record rejected history rather
than inferring its consumed decision or granted child authority.

### Slice 7 — CLI, recovery, and proof demos

Implementation status (2026-07-29): implemented; the formal Slice 8 M1 audit
remains. ADR 0020 through ADR 0023 are accepted. The immutable Execution
Profile installation/binding, public application
create/resume/cancel and read boundary, exact startup/resume recovery closure,
SQLite migrations, reopen validation, and adversarial recovery tests are
implemented. Public `StartGoal` and `ResumeGoal` now delegate to the
Runtime-owned deterministic driver, which reloads authority at every committed
boundary, closes the passing path, stops on repairable rejection, and never
redispatches retained claims. Workflow Policy binding, pre-recovery
compatibility checks, and fresh stop summaries are implemented and covered by
reverse boundary/concurrency gates. Verified production local composition now
installs the exact Policy and eight Fake Execution Profiles, runs startup
recovery before returning the facade, closes SQLite on composition failure,
and exposes no Store, kernel, or recovery coordinator. The real CLI now
implements closed argument parsing and Zod admission for the Goal
lifecycle/status and audit commands, one schema-versioned JSON document or an
ANSI-free human rendering, central exit mapping, and real cross-process SQLite
create/read/start/cancel/audit proofs. Start and resume derive optimistic
versions from one Runtime status view and still rely on Runtime to revalidate
the command transaction. Status renders exact Policy, profile, Candidate,
Acceptance, blocker, and closeout fields only when the Runtime view supplies
them. Audit renders only Runtime-owned immutable events. The
eight public `demo run` scenarios now execute through run-owned temporary
application homes. They assert exact expected terminal authority, immutable
Goal audit, and strict reopen equality before returning proof success. The
`stale-closeout` scenario reaches a persisted `ACCEPT`, arms controlled
frozen-source drift, and proves that closeout fails with an invalidated
Candidate. The `restart-resume` scenario leaves an exact dispatch in flight,
terminates that real CLI process after the durable claim is observed, proves
startup reconciliation in a new public status process, resumes in another new
public CLI process with a fresh Attempt, and reaches closeout without
redispatching the retained claim. The public status process must complete
startup recovery before an internal proof read opens. That proof-read facade
publishes only captured `status`, `audit`, and `close`, and fails closed if its
own composition reports any recovery scan or reconciliation. A separate named
read-only observer detects only the durable claimed-Attempt identity, phase,
and Workflow version; it cannot release the Worker, mutate Workflow state, or
sequence recovery. Every proof-owned public CLI child has a fixed deadline, a
hard combined-output retention limit, and forced cleanup on failure. Completion
is resolved from the child `close` event after process termination and all
stdio closure, not from `exit` alone, so a partial JSON document cannot be
treated as completed output. The `duplicate-result` scenario observes each
Worker-backed Attempt, verifies two delivery ordinals with the same
`WorkerEventId`, and correlates one dispatch claim with one authoritative paired
Attempt/Workflow finish effect per Attempt. Both corrected scenarios use new
immutable v2 profile identities while preserving the complete retained v1
installation record, including its original installation time. The other
adversarial scenarios prove that worker claims, missing/failing evidence, and
Candidate drift cannot manufacture closeout.

M1 transient-failure handling also preserves `TRANSIENT_BACKEND` as a
`RETRYABLE` classification without treating it as retry authority. Because M1
has no persisted reason-scoped budget or backoff, the first such Worker failure
records a `FAILED` Attempt, leaves the Workflow `BLOCKED`, stops the Driver,
and makes status expose `WORKER_BACKEND_FAILURE` and direct the operator to
`INSPECT_BLOCKER`; it does not create a second Attempt. SQLite migration
`0018_m1_retry_boundary_closure.sql` atomically refuses any unprovable later
Attempt in any phase and refuses a latest `TRANSIENT_BACKEND` failure unless
the Workflow remains in the failed phase with run status `BLOCKED` or
`CANCELLED`, without rewriting that database. The Domain Event codec shares the
reducer's exact failure-state mapping. Migration
`0019_m1_attempt_authority_closure.sql` atomically refuses bidirectional
Workflow/Attempt `RUNNING` mismatches, phase-incompatible Worker results,
open-ended Worker failures, broken terminal Attempt audit/outcome history, and
current Workflow/audit/outcome disagreement before its success record or
triggers can commit. The Store uses only Attempt-first completion inside one
transaction; SQLite requires the subsequent Workflow release to match the exact
Domain terminal-status matrix and rejects Workflow-first release. Store startup
and pre/post-write validation close retained active and historical authority,
while status reads close the current Workflow projection. Migration isolation,
wrong-status, history-rewrite, trigger-removal/reopen, and long-lived-Store tests
prove the independent defenses, and concurrent readers do not observe the
Store's intermediate write. Retry-specific triggers continue to reject invalid
continuation, later-Attempt creation, and reverse-history rewrites.

Driver authority decoding enforces the current snapshot subset exposed by its
narrow port: explicit latest authority, exact active/latest agreement, required
Worker Session and Manifest identity, phase-owned response-contract digest,
phase-allowed terminal result, exact visible Manifest/Attempt bindings, and
`BLOCKED` or `CANCELLED` when the latest Attempt is a transient failure. The
same Worker-phase validator protects Runtime replay and Store retained reads.
Proxy-poison, direct-SQL, migration, and trigger-removal/reopen tests cover the
independent boundaries. Runtime also requires Store-returned
applied receipts to match exactly. Replayed delivery is accepted only after one
consistent receipt/claim/Manifest snapshot independently closes its historical
authority; `ADMITTED` replay additionally proves the terminal Attempt and
processed-command outcome. Runtime computes the current Context Package digest
once and validates the current request claim before replay lookup. Same ID and
same canonical payload is always `DUPLICATE`; a distinct payload is the only ID
conflict. `IGNORED` and cross-dispatch `ADMITTED` duplicates are non-terminal;
only an exact current-dispatch `ADMITTED` duplicate is terminal. Incomplete or
self-contradictory historical authority remains a control-plane failure. See
[ADR 0024](../adr/0024-stop-m1-transient-failure-without-retry-authority.md)
and [ADR 0025](../adr/0025-separate-worker-event-idempotency-from-current-dispatch-termination.md).
Persisted automatic-retry budgets and backoff remain M4 work.

- Runtime application facade for create/start/resume/cancel and read queries;
- Runtime-owned deterministic workflow driver with one persisted operation per
  re-entry boundary;
- built-in Policy and installed Execution Profile composition, separate
  immutable first-start bindings, production clock/identity providers,
  platform data-home resolution, and verified SQLite authority activation;
- command surface, strict JSON/human rendering, and fixed exit classifications;
- narrow recovery catalog and `RecoveryInspector`;
- exact immutable recovery reconciliation, startup interruption without
  redispatch, and fresh-Attempt `ResumeGoal`;
- status, dominant-blocker, next-action, technical-closeout, and Goal-owned
  audit views;
- all named isolated demo scenarios.

Exit: a new process safely resumes an interrupted fixture and all demos have
asserted exit codes and exact final authority. CLI handlers have no Store or
kernel capability; every profile/recovery/view record survives strict reopen;
an old dispatch is never repeated; and `technicalCloseout` is impossible
without current immutable closeout authority. See
[ADR 0020](../adr/0020-runtime-application-recovery-and-query-boundary.md) and
[ADR 0021](../adr/0021-m1-execution-profile-and-cli-composition.md), with the
activation ordering in
[ADR 0023](../adr/0023-verified-sqlite-authority-activation.md).

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
| I-023–I-026 | capability-policy tests in Slice 3; typed dispatch/frozen verification, promotion non-command, and decision-type tests in later owning slices |
| I-027–I-030 | unknown/error fail-closed, retry classification/no-automatic-retry boundary, recovery reconcile, and proof-label tests |
| I-031 | immutable Workflow Policy binding, substitution refusal, migration, and resume-preflight tests |

Test names carry invariant metadata such as `[I-003]`. Slice 8 checks that every
invariant has at least one executable test. Where M1 uses a logical fake instead
of a real filesystem or runtime, the test proves the control contract and labels
the stronger operational proof as deferred to M2.

## 12. Quality gate

Detailed per-slice implementation status is recorded in this plan. Before a
slice is marked implemented, its change set MUST review the root README,
`ARCHITECTURE.md` status section, relevant domain-document status sections, ADR
index, and milestone boundary. The README MUST point to this plan rather than
maintain a second rolling slice, feature, or test inventory. The mechanical
check enforces one prose-only `Status` section, its canonical authority links,
and the absence of numbered-slice status elsewhere in the README. The review
remains responsible for detecting semantically duplicated feature or test
inventories that a syntax check cannot prove.

The mechanical check MUST parse the same GitHub Flavored Markdown block and
inline structures that repository readers see and MUST fail closed on Status
inline nodes outside its prose-and-canonical-link grammar, including footnote
references. It MUST discover every repository Markdown file in the working tree,
including repository-owned dot directories and case variants of the `.md`
extension. The complete discovery exclusion set MUST be the exact,
case-sensitive directory-segment names `.git`, `node_modules`, `coverage`, and
`dist`, applied at any depth; prefix, suffix, case-fold, or category inference
MUST NOT broaden that set. Every discovered Markdown source MUST be a regular
file whose complete repository-relative Git path uses portable segments. A
Markdown-named symbolic link MUST fail as an unsupported source rather than be
followed or silently omitted; symbolic links used only while resolving a link
destination remain governed by the containment rules below.

Repository-local link identity MUST use forward-slash Git paths before it is
mapped to the host filesystem. Only a literal `/` may separate URL path
segments; encoded or repeated separators and encoded dot segments MUST fail
closed. A trailing separator MUST resolve to a directory. Backslashes are not
portable path separators. A portable repository path segment MUST contain none
of U+0000 through U+001F or `<`, `>`, `:`, `"`, `\`, `|`, `?`, and `*`; MUST
NOT end in a period or space; and MUST NOT use the case-insensitive
pre-extension device names `AUX`, `CON`, `CONIN$`, `CONOUT$`, `NUL`, `PRN`,
`COM1` through `COM9`, `COM¹` through `COM³`, `LPT1` through `LPT9`, or `LPT¹`
through `LPT³`. These rules apply to every source and local-link destination
segment, including the final destination, before dot-segment normalization can
remove it or the path is mapped to the filesystem. Before general URI-scheme
classification, a leading one-letter ASCII designator followed by `:` MUST
fail as an ambiguous Windows drive path. Protocol-relative destinations and
destinations with a multi-character ASCII URI scheme are external. Unicode
normalization or case-fold path collisions, platform-configured path-length
limits, external reachability, and scheme-specific validity are outside this
mechanical check. A symbolic link on a checked path MUST have a relative,
forward-slash target, apply the same validate-before-normalize ordering,
preserve exact path casing at every hop, remain inside the repository, and
terminate without a cycle or an unbounded traversal.

README Status link visibility and numbered-slice detection MUST operate on one
reader-visible text projection. That projection MUST ignore Unicode
control characters and default-ignorable code points so non-visible content
cannot satisfy a visible-link requirement or split text that the reader still
perceives as `Slice N`.

The root quality command must run, in order:

1. formatting check;
2. GitHub Flavored Markdown structure, exact portable repository-local link,
   GitHub-style Markdown heading-anchor, and structural README status-source
   check;
3. lint;
4. TypeScript typecheck;
5. unit and property tests;
6. canonical digest golden-vector and replay tests;
7. SQLite migration/reopen tests;
8. authority-codec, Store-contract, and write/read/reopen closure tests;
9. CLI integration and restart tests;
10. adversarial demo tests;
11. invariant-coverage check;
12. production build.

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
