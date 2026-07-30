# CodeClosure Milestones

Progress is measured by proven runtime capabilities, not by document count,
module count, or worker output volume.

## M0 — Product Constitution and Architecture Baseline

### Objective

Turn the discussion into durable repository authority before implementation.

### Deliverables

- product contract;
- architecture and trust boundaries;
- runtime invariants;
- domain model;
- workflow state machine and capability matrix;
- context, evidence, and acceptance contracts;
- accepted ADRs for repository, worker boundary, stack, state/audit, Candidate
  isolation, and canonical digests;
- reference-project boundary analysis;
- M0 cross-document review.

### Exit Criteria

- one technical acceptance issuer and one workflow-state writer are defined;
- Workflow mutation and Acceptance issuance are separate and unambiguous;
- worker, conversation, and Codex Thread state are explicitly non-authoritative;
- candidate freeze and repair generations are defined;
- technical closeout is separated from promotion/production authority;
- M1 scope and adversarial tests are concrete;
- documents contain no claim that the runtime already exists;
- all repository-local canonical links resolve;
- canonical M0 documents and accepted ADRs are tracked in a version-control
  baseline.

M0 completion means the architecture baseline is ready for implementation. It
does not mean CodeClosure is a working product.

## M1 — Deterministic Skeleton with FakeWorker

Status: Complete as a bounded deterministic-control milestone on 2026-07-30.
The [M1 completion review](reviews/m1-completion-review.md) records the exact
source identity, environment, quality-gate output, and exit-criterion evidence.

### Objective

Prove the authority boundary without any LLM or Codex dependency.

### Scope

- Node.js 22+, strict TypeScript, pnpm workspace;
- CLI commands for create/start, status, advance through a controlled demo,
  resume, and cancel;
- typed domain identifiers and aggregates;
- deterministic transition policy;
- SQLite current-state store and append-only audit events;
- optimistic concurrency and transactional writes;
- minimal Context Manifest;
- `Worker` port and `FakeWorker` adapter;
- Candidate-generation state model with deterministic fake digest;
- immutable fake Evidence records with separate monotonic eligibility;
- minimal Acceptance Engine policy;
- immutable installed M1 Policy and Execution Profile identities with separate
  first-start Workflow bindings;
- startup recovery/reconciliation for interrupted Attempts;
- machine-readable and human-readable status output.

### Explicit Non-Scope

- Codex or another real agent;
- real source editing or worktree management;
- real test/build runners;
- full Fact Graph discovery/traversal;
- rich TUI;
- multi-agent scheduling;
- cloud or multi-user behavior;
- release or deployment.

### Walking-Skeleton Demonstration

```text
codeclosure goal create --objective "demo objective" --project <fixture-path> \
  --criterion "the controlled M1 objective has exact passing fake evidence"
  -> Goal and Workflow persist in DISCOVERY / READY
codeclosure goal start <goal-id> --fixture happy-path
  -> first DISCOVERY Attempt starts
  -> FakeWorker submits proposals
  -> legal phases advance through runtime commands
  -> FakeWorker claims completed
  -> closeout is rejected without acceptance inputs
  -> fake candidate freezes
  -> fake evidence is recorded
  -> Acceptance Engine issues ACCEPT
  -> Workflow Runtime enters CLOSEOUT transactionally
```

The demo must also show a failing-evidence path that cannot close.

### Exit Criteria

- all M1 state-machine and acceptance adversarial tests pass;
- process restart preserves authoritative state;
- restart never redispatches consumed authority and resume uses the same bound
  execution profile with a fresh Attempt;
- state mutation and audit append are atomic;
- stale version writes are rejected;
- worker cannot write an Acceptance Decision or terminal state;
- a missing/mismatched input fails closed;
- acceptance replay is deterministic;
- documentation and implementation vocabulary agree;
- no Codex dependency is present in the domain/runtime packages.

M1 completion proves the local `FakeWorker` control plane and its fail-closed
authority boundaries. It is not product completion, real-project verification,
promotion consent, or a release claim.

## M2 — Codex Vertical Slice

Status: Planned; implementation has not started. The detailed work sequence and
status are in the
[M2 implementation plan](plans/m2-codex-vertical-slice.md), and the independent
exit procedure is in the [M2 acceptance plan](plans/m2-acceptance-plan.md).

### Objective

Replace `FakeWorker` for selected phases with Codex App Server while preserving
the M1 authority boundary.

### Scope

- direct Codex App Server v2 adapter over stdio;
- lower-level App Server client separated from Goal-bound WorkerPort semantics
  so later adapters can reuse protocol transport without inheriting Worker
  authority;
- initialization plus Thread/Turn lifecycle;
- installed-version discovery and a canonically comparable generated protocol
  snapshot;
- controlled App Server configuration, state, instruction-source, and tool
  exposure identity;
- per-phase cwd, sandbox/permissions, and approval routing;
- stream Item observations without treating `turn/completed` as Goal complete;
- thread interruption and backend failure mapping;
- isolated real Candidate workspace/generation;
- hard freeze digest and mutation detection;
- one real verification runner path;
- acceptance rejection and repair generation loop;
- fresh-thread and resumed-thread policies;
- Compact event handling with no loss of authoritative state.

### Explicit Non-Scope

- Goal Intake user flow, Raw Request, Goal Draft, clarification, Confirmation,
  or Goal Materialization;
- changes to the accepted direct M1 `CreateGoal` command;
- full Fact Graph traversal or execution-time Goal revision;
- rich TUI, multiple agents, cloud, or multi-user behavior; and
- merge, release, deployment, or other external-effect authority.

### Required Demonstrations

M2 requires two complementary proofs. The deterministic proof uses a controlled
Worker or App Server fixture with the real Candidate and Verification paths:

1. the controlled Worker edits an isolated Candidate and claims completion;
2. a required real check deterministically fails;
3. CodeClosure rejects closeout and creates a repair generation;
4. the controlled repair edits only the new generation;
5. fresh verification passes; and
6. Acceptance and Runtime closeout bind the exact repaired Candidate and
   Evidence digests.

The separate live proof uses the supported installed Codex App Server:

1. Codex edits only an isolated Candidate and claims completion;
2. independent real verification determines the first post-edit result;
3. a first-pass `PASS` proceeds normally without a fabricated rejection;
4. a `FAIL` enters the same governed repair-generation path; and
5. the bounded run can close only through current passing Evidence and technical
   Acceptance.

### Exit Criteria

- Codex protocol failure, turn completion, compact, and process exit cannot
  bypass M1 guards;
- control state is inaccessible from the worker-writable Candidate;
- frozen-source mutation is detected and invalidates evidence;
- restart and new Thread recovery preserve Goal/Workflow authority;
- protocol schemas are version-bound and compared under one deterministic
  canonical snapshot profile rather than hand-copied into core;
- ambient Codex configuration, instruction sources, tools, and state cannot
  silently widen or replace the Workflow-bound execution profile;
- dependency and contract tests prove that the App Server client is reusable
  without importing WorkerPort, Workflow, Candidate, or Intake domain
  semantics;
- one deterministic real-Candidate/verifier fixture proves
  reject/repair/accept behavior; and
- one bounded live Codex path proves actual adapter execution without requiring
  a deliberately failing first edit.

M2 completion proves the real Codex execution branch under the M1 control
plane. It does not prove that CodeClosure can form a Goal from an incomplete
natural-language request.

## M2.5 — Goal Intake and Materialization Vertical Slice

Status: Not started. The scope below is planned behavior governed by
[ADR 0026](adr/0026-pre-goal-intake-and-goal-materialization-authority.md).
M2.5 implementation MUST NOT begin until M2 has passed its exit review.

### Objective

Turn one natural-language Raw Request into an exactly confirmed formal Goal
without giving the assistant Goal, Workflow, Acceptance, or confirmation
authority.

### Scope

- immutable Raw Request and versioned IntakeRun;
- immutable Goal Draft revisions and canonical Draft digests;
- Goal Intake Assistant Adapter over the reusable App Server client;
- bounded Clarification Questions and typed user answers;
- exact Goal Confirmation bound to Draft revision, digest, principal, and
  project or scope;
- atomic Goal Materialization through the Goal Manager and Workflow Runtime;
- one formal Goal revision 1 and one `DISCOVERY / READY` Workflow;
- immutable Goal Materialization Record, audit, command idempotency, and strict
  reopen validation;
- basic CLI/read views for request, Draft, question, confirmation, and
  Materialization status; and
- stale, concurrent, replay, partial-write, forged-authority, restart, and
  adapter-boundary adversarial tests.

### Explicit Non-Scope

- full Fact Graph or broad project/business discovery;
- large-scale or write-capable project exploration;
- automatic or execution-time Goal revision;
- rich TUI or complete Human Decision UX;
- multiple Intake agents or model-voting pipelines;
- long-term business knowledge base; and
- technical Acceptance or post-closeout Promotion changes.

### Required Demonstration

For one bounded local request:

1. the user submits an incomplete Raw Request;
2. the Intake Assistant returns a Goal Draft Proposal and one material
   clarification;
3. CodeClosure validates and persists Draft revision 1;
4. the user answer produces Draft revision 2;
5. a stale confirmation of revision 1 is rejected without a formal Goal;
6. the user confirms the exact revision-2 digest;
7. Goal Materialization atomically creates Goal revision 1, its unique
   `DISCOVERY / READY` Workflow, the Materialization Record, audits, and command
   outcome; and
8. strict reopen returns the identical Intake-to-Goal authority chain.

### Exit Criteria

- model output, transcript text, Codex lifecycle, or a generic approval cannot
  create a Draft Confirmation or formal Goal;
- changing a confirmation-bearing Draft field invalidates earlier
  Confirmation authority;
- direct `CreateGoal` remains unchanged and creates no synthetic Intake
  records;
- exact command replay produces one materialization effect, while conflicting
  reuse and concurrent losers fail closed;
- injected failure at every compound-write boundary leaves no partial Goal or
  Workflow authority;
- Intake authority survives restart without conversation reconstruction;
- the Intake Adapter has no WorkerPort, Candidate-write, Store-mutation,
  Acceptance, or external-effect capability;
- Intake observations cannot satisfy formal Goal Evidence without fresh
  Goal-bound verification;
- the planned proposal-self-materialization invariant and its executable tests
  enter `RUNTIME_INVARIANTS.md` together; and
- every M1 and M2 regression gate remains green.

## M3 — Full Fact Graph and Context Compiler

### Objective

Move business-path memory and phase context selection into durable, queryable
runtime state.

### Scope

- provenance-bearing Fact Graph;
- project-assisted Goal Intake with exact read-only project provenance;
- Raw Request/Draft relationships to Fact and Business Scenario sources;
- business-scenario discovery and applicability;
- code/business relationship mapping;
- Context Compiler relevance selection and hard budgets;
- Context Manifest omission decisions;
- decision and unresolved-fact gateway;
- Goal Revision Proposal and exact user confirmation;
- dependency invalidation after a formal Goal revision;
- Intake Context relevance selection, omission records, and hard budgets;
- scenario-to-obligation-to-evidence trace;
- clean-context phase and review sessions.

### Exit Criteria

- a new Codex Thread can continue a Goal from authoritative state without the
  old transcript;
- every required scenario remains traceable to implementation and evidence;
- unsupported inference cannot become confirmed fact;
- Context Manifest identity changes when relevant authority changes;
- omitted relevant scope is detected by adversarial fixtures.

## M4 — Recovery, Automated Repair, and Dogfooding

### Objective

Operate CodeClosure continuously on real CodeClosure development tasks.

### Scope

- bounded retry and repair budgets;
- robust crash/restart reconciliation;
- Human Decision Gateway UX;
- complete Goal Intake and clarification UX;
- Raw Request and sensitive Intake-content retention controls;
- richer status surface;
- candidate retention and cleanup policy;
- CodeClosure builds selected CodeClosure changes;
- escaped-defect and false-acceptance tracking;
- Goal Draft edit/confirmation rate, clarification burden, and execution-time
  Goal-revision frequency;
- requirement-misunderstanding rework and missed-scenario tracking; and
- Intake quality comparison across supported model versions.

### Exit Criteria

- interrupted real runs recover without narrative state reconstruction;
- automatic repair cannot exceed scope or budget silently;
- dogfood tasks produce usable closeout evidence;
- false completion attempts remain rejected;
- operator can see Goal, phase, scenario coverage, blocker, and next action
  without reading raw transcripts.
- operators can see which Intake content was user-stated, project-observed,
  model-proposed, unresolved, and exactly confirmed;
- Intake privacy and retention policy is inspectable and enforced; and
- Intake quality metrics do not become Goal, Acceptance, or model-selection
  authority by themselves.

## M5 — Hardening and Additional Workers

Potential scope after local Codex dogfooding is stable:

- additional coding-agent adapters;
- policy packs by project/risk type;
- stronger isolation and remote runners;
- multi-goal scheduling;
- team/multi-user authority;
- promotion/merge/release control as a separate governed subsystem;
- evaluate whether any proven limitation justifies a Codex fork.

None of these is an M0–M2 requirement.

## Current Open Implementation Decisions

These are intentionally deferred to focused milestone ADRs, plans, or spikes:

- logging/tracing implementation;
- transaction/repository API details;
- candidate workspace mechanism for M2;
- evidence payload retention limits.

Deferred decisions must preserve the existing invariants.
