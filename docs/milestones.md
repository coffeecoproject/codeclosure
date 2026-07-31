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

Status: In progress. Slice 0 authority/protocol decision closure, Slice 1
version-bound App Server client, and Slice 2 Goal-bound Worker Adapter are
implemented. They do not yet constitute a trusted live Goal-bound production
path; real Candidate creation begins in Slice 3. The detailed work
sequence and status are in the [M2 implementation
plan](plans/m2-codex-vertical-slice.md), and the independent exit procedure is
in the [M2 acceptance plan](plans/m2-acceptance-plan.md).

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

- Goal Intake user flow, Raw Request revision, Intent Analysis, Intent
  Projection, Source Binding, Material Ambiguity, Intent Admission, automatic
  Goal Materialization, or Intake-authorized automatic Start;
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
[ADR 0027](adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md).
M2.5 implementation MUST NOT begin until M2 has passed its exit review.

### Objective

Turn one natural-language Raw Request into a source-bound admitted formal Goal
without requiring confirmation of a model-authored Draft and without giving the
assistant Goal, Workflow, Start, Acceptance, or Admission authority.

### Scope

- immutable Raw Request revisions and versioned IntakeRun;
- immutable Intent Analysis Proposals and Intent Projection revisions;
- exact Source Bindings with Runtime-owned provenance classification;
- explicit Material Ambiguity records and bounded clarification;
- Goal Intake Assistant Adapter over the reusable App Server client;
- deterministic Intent Admission Engine and versioned Admission Policy;
- `MATERIALIZE`, `CLARIFY`, and reason-coded `NO_EXECUTION` decisions;
- bounded non-authoritative Answer-only results with explicit returned/failed
  disposition;
- reason-coded terminal Intake failure records, restart reconciliation, and
  new-Intake retry semantics;
- atomic Goal Materialization through the Goal Manager and Workflow Runtime;
- one formal Goal revision 1 and one `DISCOVERY / READY` Workflow;
- optional immutable Goal Start Authorization followed only by a separate
  ordinary `StartGoal` transaction;
- immutable Goal Materialization Record, audits, command idempotency, separate
  Materialization/Start dispositions, and strict reopen validation;
- basic CLI/read views for request, Proposal, Projection, Source Bindings,
  ambiguity, Admission, Answer-only result, terminal failure/next action,
  Materialization, and Start status; and
- stale, concurrent, replay, partial-write, forged-authority, restart, and
  adapter-boundary adversarial tests.

### Explicit Non-Scope

- full Fact Graph or broad project/business discovery;
- large-scale or write-capable project exploration;
- automatic or execution-time Goal revision;
- rich TUI or complete Human Decision UX;
- multiple Intake agents or model-voting pipelines;
- automatic retry or resumption of the same failed Intake analysis operation;
- long-term business knowledge base; and
- technical Acceptance or post-closeout Promotion changes.

### Required Demonstration

For one bounded local governed-execution request:

1. the user submits an incomplete Raw Request revision through the explicit
   governed-execution action;
2. the Intake Assistant returns an Intent Analysis Proposal containing one
   unsupported material assumption;
3. CodeClosure validates the Proposal, forms Intent Projection revision 1 with
   exact Source Bindings, and records the Material Ambiguity;
4. Intent Admission returns `CLARIFY`, persists one bounded question, and
   creates no Goal or Workflow;
5. the user answer produces Raw Request revision 2 and a new Projection, while
   a stale attempt to materialize revision 1 is rejected;
6. the exact revision-2 input produces deterministic
   `MATERIALIZE / AUTHORIZE_START`;
7. Goal Materialization atomically creates Goal revision 1, its unique
   `DISCOVERY / READY` Workflow, the Materialization Record, exactly one Goal
   Start Authorization, audits, and command outcome;
8. the application invokes the separately persisted ordinary `StartGoal`, and
   fault injection between the two operations leaves a visible `READY` Goal
   rather than partial or duplicate execution; and
9. strict reopen returns the identical Raw Request-to-Projection-to-Admission-
   to-Goal chain and its separate Start disposition.

Supplementary cases must show:

1. an answer-only request reaching reason-coded `NO_EXECUTION`, returning one
   bounded stored answer, and replaying it without another assistant call;
2. Answer-only delivery failure remaining `NO_EXECUTION / ANSWER_FAILED`
   without creating formal authority or an Intake processing failure;
3. governed read-only project inspection not being misclassified as
   answer-only; and
4. an interrupted orphaned `ANALYZING` run being reconciled on restart to one
   audited terminal `FAILED / INTERRUPTED_ANALYSIS`, with retry requiring a new
   Intake Run.

### Exit Criteria

- model output, transcript text, Codex lifecycle, or a generic approval cannot
  author trusted interaction action, Source Binding, Admission, Start
  Authorization, or a formal Goal;
- Admission persistence rejects partial Proposal/Projection bindings,
  Projection fields on pre-analysis decisions, missing Materialization
  project/scope, and invalid kind/outcome/action/disposition combinations;
- Intake persistence and strict reopen reject partial or mixed terminal
  Decision, Answer-only, Failure, and Goal-reference shapes;
- redacted displays, omission markers, synthetic replacement text, and
  unavailable source content cannot satisfy a material `USER_STATED` binding;
- a material field supported only by model inference cannot pass Admission;
- changing Raw Request, Projection, Source Binding, ambiguity, project/scope,
  or Admission Policy invalidates the earlier chain for Materialization;
- direct `CreateGoal` remains unchanged and creates no synthetic Intake
  records;
- exact command replay produces one materialization effect, while conflicting
  reuse and concurrent losers fail closed;
- injected failure at every Admission/Materialization compound-write boundary
  leaves no partial Goal or Workflow authority;
- Goal Materialization never creates an Attempt or dispatch; automatic Start
  passes the ordinary first-Start Policy/Profile/Context boundary;
- a crash or failure between Materialization and Start leaves the Goal `READY`,
  and replay cannot duplicate first-Start bindings or redispatch a retained
  Attempt/claim;
- a preallocated automatic Start racing a different explicit manual Start
  produces exactly one first-Start Policy/Profile binding, Context, Attempt,
  and dispatch claim, with a typed loser outcome;
- substituting the Start Authorization's command, Goal/Workflow version,
  Policy, Execution Profile, or digest binding fails closed;
- `MATERIALIZE_ONLY` and `NO_EXECUTION` cannot obtain automatic Start authority;
- an Answer-only result is bounded, exactly bound, non-authoritative, and
  replayed from storage without another assistant call;
- Answer-only delivery failure remains distinguishable from terminal Intake
  processing failure and cannot create Goal, Workflow, Evidence, Acceptance, or
  execution authority;
- a recorded Intake processing failure is terminal for that Intake Run, exact
  replay performs no model recall, and retry requires a new Intake Run;
- restart reconciliation closes a valid non-resumable orphaned `ANALYZING` run
  as audited `FAILED / INTERRUPTED_ANALYSIS` before another assistant call,
  while corrupt authority still fails strict reopen;
- Intake authority survives restart without conversation reconstruction;
- the Intake Adapter has no WorkerPort, Candidate-write, Store-mutation,
  Admission, Start, Acceptance, or external-effect capability;
- Intake observations cannot satisfy formal Goal Evidence without fresh
  Goal-bound verification;
- correction after Materialization uses explicit cancellation/new Intake rather
  than silently revising the Goal;
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
- Raw Request/Intent Projection relationships to Fact and Business Scenario
  sources;
- business-scenario discovery and applicability;
- code/business relationship mapping;
- Context Compiler relevance selection and hard budgets;
- Context Manifest omission decisions;
- decision and unresolved-fact gateway;
- Goal Revision Proposal plus a distinct source-bound
  `GoalRevisionAdmissionDecision`;
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
- Intent Projection revision rate, clarification burden, Admission outcome,
  post-Materialization correction/cancellation rate, and execution-time Goal-
  revision frequency;
- requirement-misunderstanding rework and missed-scenario tracking; and
- Intake quality comparison across supported model versions.

### Exit Criteria

- interrupted real runs recover without narrative state reconstruction;
- automatic repair cannot exceed scope or budget silently;
- dogfood tasks produce usable closeout evidence;
- false completion attempts remain rejected;
- operator can see Goal, phase, scenario coverage, blocker, and next action
  without reading raw transcripts.
- operators can see which Intake content was user-stated, policy-derived,
  project-observed, model-proposed, or unresolved, and why Admission selected
  its outcome;
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
