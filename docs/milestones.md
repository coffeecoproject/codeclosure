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

Status: Complete as a bounded Codex vertical-slice milestone on 2026-08-02.
Slices 0 through 7 implement authority/protocol closure,
the version-bound App Server client, Goal-bound Worker Adapter, controlled-copy
Candidate workspace, bounded real local-command verification, and the
deterministic in-process reject/repair/accept path. Slice 5 includes complete
local Check-family selection, current-Attempt Candidate leases, Profile-bound
local runner admission with no M1 fake-verification fallback, causal
Obligation/Evidence time, atomic active-verification drift failure, fresh
repair Evidence, deterministic Acceptance, closeout, and strict reopen proof.
Slice 6 adds Runtime-owned external execution and maintenance persistence,
bounded Thread/Compact and interruption policy, restart reconciliation, exact
repair Context version 3, and the persisted no-generation-3 stop after a failed
repair. Slice 7 adds protected acceptance-critical verification, trusted CLI
composition, deterministic anti-self-certification and bounded-repair proofs,
and both required live Codex paths. Slice 8 adds the canonical acceptance
harness and records an unconditional 93/93-row independent exit review. Slice
4's historical
independent-execution proof and Slices 5
through 6's orchestration are not reinterpreted as Slice 7's independent
verification-standard authority. The
detailed work sequence and status are in the
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
- one protected Check/Oracle path for acceptance-critical verification whose
  immutable Plan is created atomically by the protected Workflow's first
  successful Start, with exact asset identity, a static Check-time read lease,
  and no sole reliance on Worker-writable tests;
- acceptance rejection and repair generation loop;
- exact failure Evidence plus bounded structured `priorAttemptFeedback`
  deterministically projected only from the current repair record/decision,
  its Manifest and exact Evidence Set, selected failing Evidence/eligibility
  snapshots, exact parent/child Candidates, parent Candidate-freeze change-set
  digest, and Goal preservation constraints, then recompiled into a fresh
  repair Worker Session and Thread;
- one bounded live repair handoff whose failed parent is produced by a
  controlled fixture before Codex enters only the repair child;
- one bounded M2 repair continuation followed by a visible persisted stop if
  repair fails, with no unauthorized automatic continuation;
- fresh-thread and resumed-thread policies;
- Compact event handling with no loss of authoritative state.

### Explicit Non-Scope

- Goal Intake user flow, Raw Request revision, Intent Analysis, Intent
  Projection, Source Binding, Material Ambiguity, Intent Admission, automatic
  Goal Materialization, or Intake-authorized automatic Start;
- changes to the accepted direct M1 `CreateGoal` command;
- full Fact Graph traversal or execution-time Goal revision;
- arbitrary-project test completeness, Oracle sufficiency, false-green
  prevention, or a general independent-Reviewer policy;
- automatic multi-round repair, a permanent product-wide repair-count limit,
  or general cost/time/no-progress policy;
- rich TUI, multiple agents, cloud, or multi-user behavior; and
- merge, release, deployment, or other external-effect authority.

### Required Demonstrations

M2 requires two complementary proof layers. The deterministic layer uses a
controlled Worker or App Server fixture with the real Candidate and
Verification paths:

1. the controlled Worker edits an isolated Candidate and claims completion;
2. a required real check deterministically fails;
3. CodeClosure records the exact `REJECT_REPAIRABLE`, then a controlled explicit
   `BeginAcceptanceRepair` consumes it and atomically creates the repair
   generation plus immutable repair record;
4. the controlled repair edits only the new generation;
5. fresh verification passes; and
6. Acceptance and Runtime closeout bind the exact repaired Candidate and
   Evidence digests.

Separate deterministic adversarial branches MUST also prove:

1. the protected Workflow's first successful Start atomically fixes the
   acceptance-critical Plan, and the Check and protected Oracle are fixed
   before Worker mutation;
2. an incorrect implementation plus a weakened Worker-writable test cannot
   close the Goal, while the correct implementation passes the same protected
   Oracle;
3. a repair child uses a fresh Thread whose current Context contains the exact
   failing Evidence Set, selected Evidence/eligibility snapshots, and
   `priorAttemptFeedback` deterministically projected only from the fixed
   bounded-M2 failure-source set, without requiring the old Thread; and
4. when the bounded repair fails, no generation 3, Thread, Turn, dispatch,
   retry, or model fallback occurs without a new explicit continuation
   authorization bound to the exact current `REJECT_REPAIRABLE` decision,
   manifest, and failing Evidence, including after SQLite reopen or ordinary
   Resume.

The live layer's ordinary natural-branch proof uses the supported installed
Codex App Server:

1. Codex edits only an isolated Candidate and claims completion;
2. independent real verification determines the first post-edit result;
3. a first-pass `PASS` proceeds normally without a fabricated rejection;
4. a `FAIL` enters the same governed repair-generation path; and
5. the bounded run can close only through current passing Evidence and technical
   Acceptance.

If the authorized live repair also fails, the live case fails and stops
visibly. It MUST NOT retry until it obtains a convenient `PASS`.

A separate bounded live repair-handoff proof starts from a controlled
real-verification failure created before Codex is dispatched. Codex receives a
fresh repair child, Session, Thread, and recompiled failure Context, then
independent verification decides the result. This proves real Codex receipt of
repair Context without manufacturing a failure from a correct Codex first
edit, restoring old chat, or treating Codex output as Acceptance.

### Exit Criteria

- Codex protocol failure, turn completion, compact, and process exit cannot
  bypass M1 guards;
- control state is inaccessible from the worker-writable Candidate;
- frozen-source mutation is detected and invalidates evidence;
- acceptance-critical Check semantics and protected assets are fixed before
  Worker mutation, exactly bound to decisive Evidence, and cannot be replaced
  by Worker-writable tests;
- the bounded Workflow has exactly one protected Verification Plan, its full
  read lease is reproducible from retained authority, the protected path uses a
  new isolation-profile version, and supplementary Worker-test Evidence remains
  outside the decisive Evidence Set;
- restart and new Thread recovery preserve Goal/Workflow authority;
- a fresh repair Thread receives exact current failure authority and bounded
  non-authoritative feedback without old-chat dependency or silent history
  injection;
- failed bounded repair leaves a recoverable visible stop and no unauthorized
  next generation or execution;
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
  a deliberately failing first edit; and
- one bounded live repair handoff proves fresh-Thread failure-context
  continuity without old-conversation dependency.

M2 completion proves the real Codex execution branch under the M1 control
plane and one bounded anti-self-certification and repair path. It does not prove
arbitrary-project validation completeness, automatic multi-round repair, or
that CodeClosure can form a Goal from an incomplete natural-language request.

## M2.5 — Goal Intake and Materialization Vertical Slice

Status: Complete as a bounded Goal Intake and Materialization milestone on
2026-08-06. Slices 0 through 7 implement the closed Domain, SQLite authority,
packages and isolated Intake Assistant Adapter, source-bound Projection,
deterministic Admission, clarification, Answer/failure/recovery, atomic
Materialization, separate ordinary Start composition, explicit-action CLI,
strict cross-process reopen, and non-verdict assessment harness. The corrected
canonical assessment passed all nine stages and 71/71 mandatory rows with zero
skip. The
[M2.5 completion review](reviews/m2.5-completion-review.md) independently issued
an unconditional `PASS` for that exact bounded claim.

The independent M2 exit review passed on 2026-08-02 and was the satisfied
prerequisite for M2.5 implementation. It remains historical prerequisite
evidence and is not reissued by the M2.5 completion claim.

The accepted authority remains
[ADR 0027](adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md),
[ADR 0034](adr/0034-close-pre-goal-command-replay-and-sqlite-activation.md),
and
[ADR 0035](adr/0035-bound-intake-by-non-authoritative-effects.md). The detailed
[implementation plan](plans/m2.5-goal-intake-materialization.md) and
[acceptance plan](plans/m2.5-acceptance-plan.md) are historical implementation
and exit contracts. Later interaction work may call the public M2.5 facade but
cannot reinterpret its Raw Request, Source Binding, Admission,
Materialization, or Start authority.

### Objective

Turn one natural-language Raw Request into a source-bound admitted formal Goal
without requiring confirmation of a model-authored Draft and without giving the
assistant Goal, Workflow, Start, Acceptance, or Admission authority.

### Scope

- immutable Raw Request revisions and versioned IntakeRun;
- immutable Intent Analysis Proposals and Intent Projection revisions;
- exact Source Bindings with Runtime-owned provenance classification;
- explicit Material Ambiguity records, bounded immutable Clarification
  Questions, and immutable Question-to-Raw-Request Answer Bindings;
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
  ambiguity, Clarification Question/Answer-Binding provenance, Admission,
  Answer-only result, terminal failure/next action, Materialization, and Start
  status; and
- stale, concurrent, replay, partial-write, forged-authority, restart, and
  adapter-boundary adversarial tests.

### Explicit Non-Scope

- full Fact Graph or broad project/business discovery;
- large-scale or write-capable project exploration;
- automatic or execution-time Goal revision;
- rich TUI or complete Human Decision UX;
- multiple simultaneous Clarification Questions, batch answers, or a generic
  questionnaire engine;
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
5. the user answer atomically produces Question-bound Raw Request revision 2,
   one unique immutable Clarification Answer Binding, a cleared active Question
   reference, and a new Projection, while a stale attempt to materialize
   revision 1 is rejected;
6. the exact revision-2 input produces deterministic
   `MATERIALIZE / AUTHORIZE_START`;
7. Goal Materialization atomically creates Goal revision 1, its unique
   `DISCOVERY / READY` Workflow, the Materialization Record, exactly one Goal
   Start Authorization, audits, and command outcome;
8. the application invokes the separately persisted ordinary `StartGoal`, and
   fault injection between the two operations leaves a visible `READY` Goal
   rather than partial or duplicate execution; and
9. strict reopen returns the identical Question-to-Raw-Request-to-Answer-
   Binding-to-Projection-to-Admission-to-Goal chain and its separate Start
   disposition.

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
  Decision, Answer-only, Failure, and Goal-reference shapes, plus missing,
  duplicate, cross-Intake, or digest-mismatched Clarification Answer Bindings
  and an answered active Question or active-reference/status mismatch;
- redacted displays, omission markers, synthetic replacement text, and
  unavailable source content cannot satisfy a material `USER_STATED` binding;
- a material field supported only by model inference cannot pass Admission;
- changing Raw Request, Projection, Source Binding, ambiguity, project/scope,
  or Admission Policy invalidates the earlier chain for Materialization;
- direct `CreateGoal` remains unchanged and creates no synthetic Intake
  records;
- exact command replay produces one clarification or Materialization effect,
  while conflicting reuse and concurrent losers fail closed;
- injected failure at every clarification, Admission, and Materialization
  compound-write boundary leaves no partial Intake, Goal, or Workflow
  authority;
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
- the proposal-self-materialization invariant and its executable tests remain
  green; and
- every M1 and M2 regression gate remains green.

M2.5 completion proves bounded source-bound Goal Intake, Materialization, and
separately authorized Start. It does not prove a persistent conversational
frontstage, automatic interaction routing, Goal discovery, scheduling, or
detached execution.

## M2.5.1 — Real Intake-to-Codex Composition Closure

Status: Complete as a bounded compatibility and composition closure. The final
canonical assessment passed all 13 stages and 68 mandatory rows on exact clean
source `dfe4798`, and the independent completion review issued an unconditional
bounded `PASS` on 2026-08-13. Slice 0 revised its frozen contract to the exact
reviewed Codex CLI `0.146.1`
binary and protocol snapshot while preserving retained M2/M2.5 `0.146.0`
authority without cross-version substitution. The Slice 0 closure review
passed. Slice 1 implements the retained v2 Intake Profile and Adapter,
configuration v1, offline protocol Projection/Observer closure, safe
diagnostics, and strict retained-v1 reopen/replay/recovery compatibility. Its
slice review passed and permitted Slice 2. Slice 2 adds Profile/Adapter v3,
configuration/protocol projection v2, the strict Intent response, exact-source
instruction, and Runtime projection policies; it passes the lower-client
prerequisite and isolated real Answer-only, clear Intent, and ambiguous Intent
paths with metadata-only receipts. Slice 3 subsequently implemented its
project-read contracts, local adapter, Context v5 compiler, atomic SQLite
project-read binding, Store-owned authority-snapshot/consume-once Cleanup
persistence, trusted Runtime Cleanup coordinator, process-safe same-Grant
exact-leaf effect handling, and the additive nested external-execution v3
phase-dispatch contract with canonical projection and strict SQLite
install/reopen plus additive v2 Intent/Record authority with strict SQLite
authorization, persistence, and reopen. The v2 source union binds one exact
project-read snapshot or Candidate lease without widening historical v1. The
Adapter-boundary foundation now adds strict directive v3 and observation v2,
phase-specific result schemas, derived versioned isolation-contract binding,
stable Profile root envelopes with exact ProjectRead/Candidate cross-binding,
complete decoded/digest-validated ProjectRead authority input with receipt-only
ID/digest/cwd reduction, an exact `0.146.1` disabled-integration and effective-
feature projection, and one versioned
Adapter-local activity policy that discards unclassified or out-of-bound
activity without changing historical directive v2/observation v1. Fixture
execution selects candidate-free `readOnly` and Candidate-bound
`workspaceWrite`, emits only the phase-appropriate proposal/completion result,
and discards forbidden file-change results; at that Slice 3 boundary, effective
black-box live containment had not yet been proven. Accepted
[ADR 0044](adr/0044-source-freeze-owned-candidate-change-containment.md)
assigns that proof to an additive Candidate Manager-owned stable source-freeze
change set. Its canonical contract, local manifest-difference derivation, C11
Profile freeze-v2 sub-contract and freeze-only Check family, Runtime-owned
current-Goal path disposition, Store-owned canonical recomputation, SQLite
structural and relational backstops, atomic freeze-Evidence v2, strict reopen,
and closed failure path are now implemented without a Fake
Verification obligation. The reserved formal Profile identity fails
install/read/reopen on any C11 sub-contract mismatch and cannot fall back to
the historical Check family. The Adapter-local policy admits the pinned best-
effort `unknown` command action only for `IMPLEMENT`; the later freeze-v2
record, not that activity observation, must prove containment, and failure
invalidates the Candidate without Evidence. At the Slice 3 boundary, this was
offline implementation foundation without an `M251-C11` acceptance verdict.
The Candidate-creation
source-currency boundary now requires a preparation-v2 result bound to the
exact completed PLAN ProjectRead authority; mismatch creates no Candidate and
atomically retains `PLAN_SOURCE_NOT_CURRENT` as `PLAN / FAILED`, including
processed-command replay, strict reopen, and `BLOCKED / INSPECT_BLOCKER`
projection. B3 implements deterministic Driver Profile v3 dispatch,
Intent/Record v2 authorization, and Runtime-owned candidate-free pre/post-Turn
source and snapshot currency with no FakeWorker fallback, and its bounded
review passed. B4 composes the trusted production graph and deterministic
Intake-to-closeout chain, including terminal ProjectRead cleanup and no
production Fake fallback. B5 restored every implemented Slice 3 deterministic
proof to its frozen owner, completed documentation closure, and issued a
bounded Slice 3 `PASS` on 2026-08-11. The protocol fixture is not Live evidence.
Slice 4 passed its bounded review on 2026-08-12. It implements B1's prepared,
content-free Intake execution-root descriptor and trusted pre-publication
separation/cleanup boundary, B2's
focused non-authoritative metadata-only composition Receipt and strict
expected-identity/privacy contract, B3's explicitly authorized real linked-
path command with composition-local metadata observation and narrow retained-
authority inspection, and B4's separately authorized metadata-only effective-
containment probe. The probe binds the exact formal Profile, validated App
Server isolation for the distinct `DISCOVERY` and `PLAN` phase entries, exact
command observation, content-free denied-boundary opens, independent opening/
closing filesystem identities, and cleanup without becoming product authority
or replacing the formal linked chain or Candidate Manager-owned freeze-v2
record. B3 and B4 are implemented and deterministically tested. An explicitly
authorized initial B5 diagnostic later ran, but the corrected direct pinned App
Server `command/exec` probe failed closed because candidate-free `readOnly`
could read a content-free Authority Home sentinel. Earlier Intake and linked-
composition diagnostics are not final evidence after source changes. Effective
production read containment and mandatory passing real user-path proof were
unestablished at that point. A subsequent bounded, no-model capability matrix proved that
retained Codex `0.146.1` enforces the required boundary through exact
configured phase permission profiles; the pre-correction production mapping
used generic Thread/Turn/command sandbox overrides and one shared writable
profile. The additive contained Profile v2 correction now implements distinct
ProjectRead/Candidate profiles, one narrow launch selector, inherited lower-
Client/Adapter mapping, retained-v1 coexistence, and strict SQLite/reopen
support. It is deterministically tested and passed the complete explicitly
authorized real containment matrix on exact source `7621c8b`; all three phase
probes, denied-boundary checks, source and credential closure, cleanup, and
privacy checks passed. The failed ADR 0043 production-containment requirement
is therefore closed. After a focused Live composition assessment-consumer
identity correction, an initial B5 real Intake, causally linked composition,
and effective-containment diagnostic triad passed on exact clean source
`1b43dfc`. Two later prepared-source linked paths on `aa2f29e` correctly failed
closed at protected verification. Executable Slice 0 contract v7 then
compatibly aligned the demonstration criterion with the unchanged protected
Check's exact public `duplicate_ignored` result, and the complete restarted v7
diagnostic triad passed on exact clean source `a3a5e9b`. The final prepared-
source gate and ordered unchanged-source Live triad then passed on exact source
`01fd537`, and the bounded Slice 4 review issued `PASS`. The
[Slice 4 effective read-containment closure plan](plans/m2.5.1-slice4-effective-read-containment-closure.md)
records that bounded result but supplies no execution authority. Passing linked
real user-path and effective-containment proof is established as bounded Slice
4 evidence. Slice 5's explicitly authorized final canonical run passed all 13
stages and 68 mandatory rows on exact clean source `dfe4798`, including real
Intake, the linked Intake-to-Codex/containment path, and complete M1/M2/M2.5
regression. The
[M2.5.1 completion review](reviews/m2.5.1-completion-review.md) independently
issued an unconditional bounded `PASS` on 2026-08-13. M2.5.1 is complete; this
does not reissue the historical M2/M2.5 verdicts or implement M2.6.
The
[implementation plan](plans/m2.5.1-real-intake-codex-composition-closure.md),
[acceptance plan](plans/m2.5.1-acceptance-plan.md),
[Slice 0 contract](plans/m2.5.1-slice0-contract.md), and
[live Intake diagnostic](reviews/m2.5-live-intake-compatibility-diagnostic.md),
plus the
[first canonical-assessment diagnostic](reviews/m2.5.1-first-canonical-assessment-diagnostic.md)
define the bounded work and its historical first-run failure; the completion
review is the final milestone verdict.

M2.5.1 does not revoke or rewrite the historical M2.5 `PASS`. That review
explicitly used no live M2.5 Intake observation and bound governed execution to
the M1 happy-path FakeWorker Profile. M2.5.1 establishes new current-source
evidence for behavior that the historical review did not claim.

### Objective

Correct the pinned real App Server compatibility defect in the M2.5 Intake
Adapter and prove one trusted product-composition path from real Intake through
source-bound Materialization and ordinary Start to real candidate-free Codex
`DISCOVERY`/`PLAN`, real Candidate-bound Codex `IMPLEMENT`, protected
verification, Evidence, Acceptance, and closeout.

### Scope

- versioned Intake Assistant Profile and Adapter compatibility correction;
- lower-client raw-frame failure closure plus an Adapter-local typed protocol
  projection as the sole successfully decoded notification consumer above that
  boundary, with a private exhaustive effect classifier and closed normalized
  Intake event union;
- stage-aware agent-message validation and removal of self-induced deprecated
  configuration notices;
- safe diagnostic categories without request/response, reasoning, account,
  credential, notification-payload, or raw-exception retention;
- version-1 Intake state read/replay/recovery compatibility without silent
  resume under the corrected version;
- mandatory explicitly authorized real Answer-only and Intent-analysis calls;
- trusted installation of the real M2 external-backend capability and
  Execution Profile before capability publication;
- exact Profile-owned dispatch of real candidate-free read-only Codex for
  `DISCOVERY`/`PLAN` and real Candidate-bound Codex for `IMPLEMENT`, with the
  candidate-free selected-source snapshot, Context, isolation, source-
  currency, configuration/instruction, and execution-record boundary accepted
  through accepted
  [ADR 0043](adr/0043-candidate-free-codex-project-read-authority.md) before
  implementation;
- atomic persistence and strict reopen of each candidate-free project-read
  record with its exact externally owned read-only snapshot and Context/Attempt
  authority, plus `ExternalExecutionIntentV2`/`ExternalExecutionRecordV2`,
  `CodexWorkerDirectiveV3`, `CodexAdapterObservationV2`, pre/post-Turn source/
  snapshot checks, monotonic workspace-authority reconciliation, consume-once
  terminal/orphan cleanup with same-grant idempotent crash reconciliation and
  atomic Cleanup Outcome persistence, and exact Plan-source-to-Candidate-source
  equality;
- additive external-execution v3 phase dispatch with no duplicate global/
  phase authority, canonical string-sorted phase identity,
  `ALL_SELECTED_ATTEMPTS`, and exact phase cwd, source/Candidate presence,
  permission/isolation, project-configuration, instruction-source, response,
  Adapter-local phase activity-policy identity, network, continuity, compaction,
  and fallback policy without reinterpreting existing M1/M2 Profiles;
- exact binding of that Profile in M2.5 governed-execution preflight,
  `GoalStartAuthorization`, ordinary `StartGoal`, and Workflow Driver
  resolution;
- real Codex Worker mutation of only one controlled-copy Candidate under a
  predeclared bounded demonstration profile;
- exact Candidate freeze, protected verification, Evidence, Acceptance, and
  closeout with the source project unchanged; and
- deterministic, live, failure, replay, restart, strict-reopen, privacy,
  cleanup, and complete M1/M2/M2.5 regression evidence.

### Explicit Non-Scope

- M2.6 Frontstage routing, Pending Actions, Goal discovery, focus,
  confirmation, or persistent interaction;
- M2.7 Runtime Host, attachment, control lease, project execution slot, queue,
  or automatic handoff;
- user-, model-, project-, or CLI-selected Execution Profiles;
- rebinding an existing Goal or started Workflow to another Profile;
- early Candidate/Generation creation, source-checkout reads or writes from
  `DISCOVERY`/`PLAN`, projection-excluded reads, or a production FakeWorker
  fallback;
- project-assisted Intake, broad discovery, or arbitrary-project verification
  synthesis;
- automatic Intake retry, candidate-free Worker retry, same-Goal replan/phase
  rewind, Worker repair expansion, or Goal revision;
- Worker-authored Acceptance authority; and
- Candidate promotion, source-project mutation, merge, release, deployment, or
  another external effect.

### Required Demonstration

The mandatory assessment must show, on one exact source identity:

1. the original real event sequence succeeds through the corrected versioned
   Adapter while the historical failed Intake record remains unchanged;
2. real Answer-only returns a bounded non-authoritative answer and creates no
   Goal or Start authority;
3. a clear request completes real Intent analysis while Runtime alone authors
   Source Bindings and deterministic Admission input;
4. a materially ambiguous request remains ineligible despite model proposals
   and creates one exact Clarification Question with no Goal;
5. an exact clarification answer produces a new source-bound request revision
   and qualified input materializes one Goal;
6. its `GoalStartAuthorization` binds the exact installed real M2 Codex
   Execution Profile rather than the M1 FakeWorker Profile;
7. the separate ordinary Start resolves that same Profile and dispatches real
   candidate-free read-only Codex for `DISCOVERY` and `PLAN` over exact owned
   selected-source snapshots without exposing the checkout or creating a
   Candidate;
8. `PLAN -> IMPLEMENT` creates the isolated Candidate and real Candidate-bound
   Codex changes only that Candidate;
9. predeclared protected verification, Evidence, Acceptance, and closeout bind
   that exact Candidate and policy; and
10. source project content and Git identity remain unchanged through success,
    failure, cleanup, and strict reopen.

### Exit Criteria

- disabled remote-control and bounded rate-limit notifications project into
  content-minimized benign events without becoming Intake authority or false
  protocol failure;
- deprecated configuration keys are absent and arbitrary deprecation/warning
  activity is not blanket-whitelisted;
- started agent-message text may be empty while completed/terminal content and
  unique summary binding remain strict;
- the lower Client alone admits raw JSON-RPC frames; successfully decoded Codex
  notifications and compaction callbacks cannot bypass the Adapter-local
  protocol projection, and normalized events cannot leak into Domain or Runtime
  authority;
- every forbidden Item/effect maps to a forbidden-effect event, while every
  known-method malformed, unmapped, warning, reroute, compaction, terminal
  mismatch, and invalid response remains a projected protocol violation, and
  every unsupported method or malformed envelope closes in the lower Client;
  all such paths fail closed;
- new operations use new exact profile/Adapter identities while retained
  version-1 authority and Slice 1 v2 authority reopen and reconcile without
  reinterpretation or silent recall;
- model output cannot select Route, Admission, Goal, Policy, Execution Profile,
  Start, Candidate, Verification, Evidence, Acceptance, or closeout authority;
- Materialization and Start remain separate transactions, and only ordinary
  Start creates first Profile/Context/Attempt/dispatch authority;
- the formal Profile and every live Worker-phase receipt exclude FakeWorker;
  real `DISCOVERY`/`PLAN` have exact read-only snapshot identity, no checkout
  access, and no Candidate binding, while real `IMPLEMENT` has the exact mutable
  Candidate binding;
- every selected phase binds the additive v2 Intent/Record and v3 Codex
  directive/v2 Adapter observation chain; retained v1 Record/Intent, v2
  directive, and v1 Adapter observation meanings remain unchanged, and any
  reused lifecycle/Worker schema is proven sufficient rather than widened;
- the versioned Adapter-local Worker activity policy admits only snapshot-cwd
  read commands for `DISCOVERY`/`PLAN` and exact Candidate-lease/allowed-path
  command/file-change activity for `IMPLEMENT`; unknown, forbidden, cross-
  phase, approval, network, or containment-mismatched activity fails closed;
- `.git`, ignored/special/projection-excluded files, project configuration,
  ambient instruction sources, authority, credentials, Candidate roots,
  sibling snapshots, and protected assets cannot widen candidate-free access;
- candidate-free source or snapshot drift rejects the Worker proposal without
  a replacement Attempt, and a later Candidate is created only from the exact
  source projection admitted for the current Plan;
- a Plan-source mismatch records `PLAN_SOURCE_NOT_CURRENT`, creates no partial
  Candidate, preserves the completed Plan Attempt, atomically moves the
  Workflow from `PLAN / READY` to `PLAN / FAILED`, retains the exact code in
  the integrity event and `suspendedReason`, projects the Goal to
  `BLOCKED / INSPECT_BLOCKER` with no recovery catalog, and performs no
  automatic replan, phase rewind, `goal resume` continuation, or fake fallback;
- cleanup before-call, after-delete/before-outcome, and after-outcome crash
  windows preserve one exact grant identity: only the same unresolved grant
  may reconcile, Outcome/audit/grant consumption commit atomically, and a
  retained Outcome prevents another filesystem call;
- mandatory live evidence cannot be replaced by a lower-client probe or fixture;
- the real Worker writes only the isolated Candidate and cannot define the
  acceptance-critical check;
- only the Acceptance Engine may issue technical `ACCEPT` for the exact frozen
  Candidate and evidence;
- the original source project and historical M2.5 review remain unchanged;
- the complete M1, M2, and M2.5 current-source regressions pass with zero skip;
  and
- the canonical non-verdict runner and independent review pass every mandatory
  deterministic and live row on one exact source identity.

M2.5.1 completion proves only this bounded compatibility and composition
closure. It satisfies the milestone prerequisite for M2.6 implementation and
assessment; it is not a Frontstage feature or product-completion claim.

## M2.6 — Unified Frontstage Interaction and Control

Status: Slice 0 decision/proof closure passed on 2026-08-14. ADR 0036 through
ADR 0039 are accepted and the executable [Slice 0
contract](plans/m2.6-slice0-contract.md) freezes the implementation inputs;
Slice 1 Interaction Domain, strict-codec, lifecycle/relationship invariant,
canonical-digest, and deterministic Runtime-policy implementation passed
bounded review on 2026-08-14. Slice 2 implementation is in progress through
its policy, Session lifecycle, and user-message SQLite authority with atomic
audit, typed replay/conflict, and strict reopen for that implemented subset;
this does not complete Slice 2 or claim `M26-D03` through `M26-D07`. The M2.5.1
entry condition has been satisfied. The
[M2.6 implementation plan](plans/m2.6-unified-frontstage-interaction.md), [acceptance
plan](plans/m2.6-acceptance-plan.md), and [Frontstage Interaction
contract](frontstage-interaction.md) define the planned boundary. Deferred
Runtime Host, scheduling, and later capabilities remain assigned directly to
M2.7, M3, M4, or M5.

### Objective

Provide one continuously available local CLI frontstage where the user uses
natural language for bounded conversation, existing M2.5 Goal Intake, scoped
Goal discovery/status/control, and one in-process Goal execution while
CodeClosure retains exact routing, immutable pending-action authorization and
dispatch, deterministic direct-or-separate confirmation, Workflow, and
Acceptance authority.

### Scope

- durable Interaction Session, Message, Operation, Focus, Route Proposal,
  Route Decision, Pending Action/Resolution, Action Reservation/Outcome, exact
  M2.5 message handoff, and bounded Frontstage Answer records;
- deterministic Interaction Routing Policy and a closed natural-language
  direct-action/confirmation policy plus separate-confirmation parser;
- exact immutable pending-action, authorization, reservation, and outcome
  binding before every closed new-Intake/start/resume/cancel action;
- one current-message handoff to existing M2.5 submit/clarify facades without
  chat summary or composite `USER_STATED` synthesis;
- separate Frontstage Assistant port, Context Package/Manifest, one closed
  proposal-response union, and at most one fresh isolated App Server operation
  per unresolved message;
- fixed-local-principal authority-home binding plus exact-project-scoped,
  stable, paginated public Goal-summary query;
- exact Focus Binding plus natural-language Goal list, status, audit, start,
  resume, and cancel interaction;
- foreground CLI loop that remains available while one session-owned governed
  action traverses M2.5 into Goal execution;
- bounded result notifications, graceful shutdown, and strict startup
  reconciliation; and
- deterministic, cross-process, failure-injection, regression, and explicitly
  authorized bounded live assessment.

### Explicit Non-Scope

- detached Runtime Host or guaranteed Goal execution after CLI exit;
- project-wide execution slots, automatic multi-Goal scheduling, or parallel
  workers;
- rich TUI, web/graphical client, multi-user, remote, or cloud behavior;
- full Fact Graph, broad project discovery, or project-aware ordinary chat;
- arbitrary multi-message synthesis into M2.5 user authority;
- persistent assistant Thread reuse or Compact policy;
- automatic repair/retry or execution-time Goal revision;
- technical Acceptance changes; and
- promotion, merge, release, deployment, or another external effect.

### Required Demonstration

One deterministic end-to-end run must show:

1. a trusted principal/project opens one persistent foreground session;
2. an ordinary question returns a bounded non-authoritative answer;
3. a natural-language Goal-list request returns scoped Runtime summaries;
4. an ambiguous reference asks for clarification rather than choosing a Goal;
5. a clear low-risk governed-work request creates one exact Pending Action and
   deterministic direct-user authorization;
6. that action is consumed once and hands the exact originating message bytes
   to M2.5 without a redundant confirmation turn;
7. an exact focused clarification continues through the existing M2.5 Question
   binding and materializes one Goal;
8. execution crosses only the existing ordinary Start boundary and resolves
   the exact real M2 Codex Execution Profile proven by M2.5.1;
9. the same frontstage remains usable for status while the Goal runs; and
10. shutdown/reopen preserves session and Goal authority without implicit
    cancellation, assistant recall, duplicate command, or dispatch replay.

### Exit Criteria

- assistant output cannot author a trusted route, interaction action, pending
  action, Goal command, Workflow mutation, or completion decision;
- every member of the closed new-Intake/Goal-control action set binds one exact
  immutable pending action and allowed direct or separate-confirmation
  disposition; exact M2.5 clarification and interaction bookkeeping do not;
- deterministic direct authorization is restricted to exact low-risk action
  kinds and cannot use model interpretation as evidence;
- cancellation, replacement, destructive, conflicting, ambiguous, stale,
  expired, or replayed input fails closed to clarification or separate
  confirmation without floating authorization;
- Assistant replay invokes no second model operation; unresolved authorized
  action recovery uses only the retained public Command ID and creates no
  duplicate authority effect;
- one-message M2.5 handoff preserves exact user bytes and provenance without
  importing prior chat or model summaries as `USER_STATED`;
- the Frontstage Assistant has no project, Store, Worker, Candidate, Evidence,
  Acceptance, network, or external-effect capability;
- Goal discovery is scoped, stable, paginated, and includes direct plus
  Intake-created Goals without exposing raw Store authority;
- focus is an audited convenience binding and cannot bypass current Runtime
  freshness checks;
- the foreground frontstage remains responsive during one session-owned
  execution-bearing task, rejects another governed Intake/Start/Resume without
  delayed authority, and allows a `MATERIALIZE_ONLY` Intake fallback only after
  exact separate authorization;
- CLI exit creates no implicit `CancelGoal` and makes no detached-execution
  guarantee;
- startup reconciles incomplete interaction and existing Runtime work without
  model recall, replacement Command ID, duplicate authority, or
  consumed-dispatch replay;
- status and notifications remain projections and cannot issue Acceptance or
  closeout; and
- the complete M1, M2, M2.5, and M2.5.1 regression baselines remain green.

M2.6 completion would prove only the foreground process-lifetime interaction
boundary. Detached Host ownership, secondary-client control, and project-slot
authority remain the separate M2.7 proposal below.

## M2.7 — Local Runtime Host and Single-Goal Project Control

Status: Proposed. The [Local Runtime Host contract](runtime-host.md),
[implementation plan](plans/m2.7-local-runtime-host-single-goal-control.md),
and [acceptance plan](plans/m2.7-acceptance-plan.md) define a candidate
post-M2.6 milestone. Implementation has not started, M2.6 completion is an
entry condition, and proposed ADRs 0040 through 0042 are not binding.

### Objective

Run one compatible deterministic local Runtime Host that continues existing
governed Goal execution across CLI detach/reconnect, gives one CLI writable
control plus bounded read-only observers for each principal/project, and
atomically permits only one started non-terminal Goal per exact project without
adding a queue or automatic handoff.

### Scope

- one `RuntimeHostRecord`, monotonic Host Epoch, exact process/launch/endpoint
  identity, and single-owner bootstrap per authority home;
- Host-owned verified Store activation, M2.6 Interaction reconciliation, and
  existing Runtime/external-execution recovery before capability publication;
- bounded versioned local CLI control transport and compatible attach/start/
  reconnect behavior;
- one durable project control lease and monotonic Control Epoch for the writable
  CLI;
- bounded read-only secondary CLI access to Goal list/status/audit/result views;
- one durable project execution slot acquired atomically by first Start and
  retained across the owning Goal's complete non-terminal lifetime;
- typed `PROJECT_EXECUTION_SLOT_OCCUPIED` Start rejection with no Attempt,
  Context, dispatch, process, or Worker call;
- atomic slot release only when the owning Goal closes or is cancelled;
- CLI detach without implicit Goal cancellation and Host-owned execution while
  the Host remains alive;
- graceful Host shutdown and abrupt crash/restart reconciliation; and
- migration, strict reopen, cross-process concurrency, failure-injection,
  deterministic, and bounded live assessment.

### Explicit Non-Scope

- waiting Goal queue, priority, fairness, or automatic next-Goal selection;
- automatic Start when the project slot becomes free;
- two writable CLIs or manual control transfer;
- multiple active Goals per project, parallel workers, or global scheduler;
- multi-user/team, remote client/worker, or cloud hosting;
- project-aware ordinary conversation, Fact Graph, or Goal Revision;
- automatic repair/retry changes or rich operator/Human Decision UX;
- technical Acceptance changes; and
- promotion, merge, release, deployment, or another external effect.

### Required Demonstration

One deterministic end-to-end run must show:

1. CLI A starts or attaches the sole compatible Host and obtains control;
2. a clear M2.6 request materializes and starts Goal A, atomically acquiring the
   project slot;
3. CLI B attaches as observer, reads Goal A, and cannot mutate Interaction,
   Intake, or Goal authority;
4. CLI A detaches without `CancelGoal`, while Host-owned Goal A continues;
5. a later CLI obtains a higher Control Epoch and reads exact current state;
6. Goal B remains `DISCOVERY / READY`, and Start while A owns the slot receives
   the typed occupied result without execution;
7. Goal A closes or is cancelled and releases the slot atomically;
8. Goal B remains unchanged and does not start automatically; and
9. only a fresh user-authorized ordinary Start for Goal B acquires the free
   slot.

### Exit Criteria

- concurrent Host starters produce one exact Host owner and fail closed on
  stale/ambiguous process, endpoint, or epoch identity;
- no client capability is published before verified activation, strict reopen,
  and recovery complete;
- CLI detach is distinct from Host stop, Goal cancellation, slot release, and
  technical completion;
- one principal/project has one writable control lease, and stale/observer
  clients cannot mutate or indirectly create pending actions;
- concurrent Starts for two Goals in one project produce one exact slot owner
  and one typed occupied loser atomically;
- the slot is retained across READY, RUNNING, WAITING_FOR_INPUT, BLOCKED,
  FAILED, restart, and Resume, then released only by exact close/cancel;
- non-owning Goals retain existing state and are never queued, selected, or
  automatically started;
- M2.5 governed Materialization remains committed when its later ordinary Start
  loses the slot;
- Host crash/restart never adopts ambiguous work, redispatches consumed
  authority, releases a slot, or issues Cancel/Accept;
- local transport exposes no Store/kernel/backend protocol authority; and
- the complete M1, M2, M2.5, and M2.6 regression baselines remain green.

## M3 — Full Fact Graph and Context Compiler

### Objective

Move business-path memory and phase context selection into durable, queryable
runtime state.

### Scope

- provenance-bearing Fact Graph;
- project-assisted Goal Intake with exact read-only project provenance;
- explicit composite-source authority when multiple user messages may support
  one `USER_STATED` Intake field;
- Raw Request/Intent Projection relationships to Fact and Business Scenario
  sources;
- business-scenario discovery and applicability;
- code/business relationship mapping;
- Context Compiler relevance selection and hard budgets;
- Context Manifest omission decisions;
- durable admitted conversational facts plus authoritative relevance and
  omission selection, without treating transcripts as facts;
- decision and unresolved-fact gateway;
- Goal Revision Proposal plus a distinct source-bound
  `GoalRevisionAdmissionDecision`;
- dependency invalidation after a formal Goal revision;
- Intake Context relevance selection, omission records, and hard budgets;
- complete Criterion-to-Scenario-to-Obligation-to-Check-to-Evidence trace,
  including verification-asset source and coverage relationships;
- durable per-generation change, attempted-approach, failure-pattern,
  hypothesis, and no-progress facts needed for later multi-round decisions,
  without authorizing another repair;
- clean-context phase sessions and reviewer-context plumbing without making an
  independent Reviewer mandatory or acceptance-critical; and
- evaluation of persistent Assistant Thread reuse and Compact only after the
  authoritative context and omission contracts exist.

### Exit Criteria

- a new Codex Thread can continue a Goal from authoritative state without the
  old transcript;
- every required scenario remains traceable to implementation and evidence;
- verification asset origin and coverage remain traceable without promoting
  Worker summaries to authority;
- unsupported inference cannot become confirmed fact;
- Context Manifest identity changes when relevant authority changes;
- omitted relevant scope is detected by adversarial fixtures.

## M4 — Recovery, Automated Repair, and Dogfooding

### Objective

Operate CodeClosure continuously on real CodeClosure development tasks.

### Scope

- bounded retry and repair budgets;
- explicit authority for each automatic repair continuation, maximum rounds,
  cost/time limits, repeated-failure and no-progress detection, and
  continue/change-strategy/request-user/stop outcomes;
- robust crash/restart and dogfood reconciliation beyond the bounded M2.7 Host
  contract if that proposal is accepted;
- Human Decision Gateway UX;
- durable notification delivery, acknowledgement, offline handling, and richer
  desktop/operator interaction without making notifications authoritative;
- complete Goal Intake and clarification UX;
- Raw Request and sensitive Intake-content retention controls;
- long-term interaction search, export, erasure/tombstone, and provider-data
  controls that preserve authority history and privacy boundaries;
- richer status surface;
- candidate retention and cleanup policy;
- CodeClosure builds selected CodeClosure changes;
- escaped-defect and false-acceptance tracking;
- evaluation of whether independent Reviewers or additional verification paths
  are required for supported risk profiles;
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
- multi-goal queueing, priority, and automatic scheduling beyond M2.7's
  proposed no-auto-handoff project slot;
- parallel Goal workers and explicit multi-agent coordination with owned
  Candidate, Evidence, cost, handoff, and failure semantics;
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
