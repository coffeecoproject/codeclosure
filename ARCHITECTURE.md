# CodeClosure Architecture

## Status

This document defines the target architecture. The deterministic M1 skeleton
is implemented and has passed its bounded completion audit: domain and Workflow
control, SQLite persistence and audit, minimal Context compilation, typed
`FakeWorker` dispatch and event admission, logical Candidate generations,
stable freeze observation, independent fake verification, immutable Evidence,
canonical Evidence Sets, deterministic Acceptance Decisions, transactional
closeout, immutable exact repair-generation authority, and verified local
startup composition exist. The real CLI now implements Goal
lifecycle/status and audit commands with closed input validation, versioned
JSON/human rendering, fixed exit classification, and cross-process SQLite
reads. All eight named proof scenarios run in isolated temporary authority
homes and assert exact terminal, audit, and reopen state. The
[M1 completion review](docs/reviews/m1-completion-review.md) records the exact
source identity, environment, quality stages, migration/schema inspection,
dependency graph, and invariant coverage. Bounded controlled-copy Candidate
isolation, bounded Darwin local-command verification, in-process
reject/repair/accept orchestration, Runtime-owned external-execution
persistence, restart reconciliation, fresh repair Context, protected
acceptance-critical verification, trusted CLI composition, and both bounded
live Goal-bound paths are implemented, and the Slice 8 acceptance harness plus
independent exit review completed the bounded M2 milestone on 2026-08-02.
Goal Intake remains planned M2.5 behavior. Components marked for later
milestones are architectural boundaries, not current implementation claims.

The [M2 implementation plan](docs/plans/m2-codex-vertical-slice.md) and
[independent acceptance plan](docs/plans/m2-acceptance-plan.md) govern the
current milestone. Slice 0 decision closure is implemented: repeated schema,
configuration, workspace-containment, and bounded live App Server probes pass,
and ADR 0028 through ADR 0030 are accepted. ADR 0031 through ADR 0033
separately govern the protected-verification work planned for Slice 7; they do
not enlarge Slice 0's historical completion claim. Slice 1 is implemented: the
version-bound lower client, pinned protocol snapshot, deterministic fake server,
offline adversarial suite, and bounded live compatibility preflight pass. The
[Slice 1 review](docs/reviews/m2-slice1-app-server-client.md) records
the exact evidence and limitations. Slice 2 is implemented: the separate
Goal-bound Codex Worker Adapter consumes only the lower client and public
Worker contracts, validates an immutable external-execution directive and
already-resolved Candidate lease, maps the current `IMPLEMENT` Context into one
bounded Thread/Turn, rejects effective-input or lifecycle drift, and emits at
most one existing closed-schema Worker event. Its bounded observations retain
only identities, counts, and typed disposition, not transcript or private
reasoning content. The
[Slice 2 review](docs/reviews/m2-slice2-codex-worker-adapter.md) records the
offline evidence and limitations. Slice 3 is implemented: the separate local
workspace adapter creates bounded controlled copies from exact Git source
projections, issues Runtime-contract workspace leases, freezes every retained
regular file while rejecting unrepresented empty directories, creates repairs
only from exact frozen parents, and performs fail-closed restart classification
against monotonically admitted exact Runtime authority snapshots. Cleanup
requires a current adapter-issued one-time grant rather than a caller-selected
path. Its ownership markers remain outside worker-writable Candidate roots, and
it imports only public Runtime contracts. The
[Slice 3 review](docs/reviews/m2-slice3-candidate-workspace.md) records the
focused evidence and limitations. Slice 4 is implemented: a separate local
Verification adapter executes one exact no-shell command against a current
read-only Candidate lease under the selected Darwin Seatbelt profile, with
explicit environment, timeout, termination, output, retention, filesystem,
credential, and network bounds. Runtime validates the untrusted result and
derives version-2 local-command Evidence; SQLite atomically commits retained
content-addressed stdout/stderr payloads with Evidence, eligibility, Workflow
effects, audit, and command outcome. The
[Slice 4 review](docs/reviews/m2-slice4-real-verification.md) records the
focused evidence and limitations. Slice 5 is implemented: trusted Runtime
composition grants mutable Candidate leases only to `IMPLEMENT`, records a
fresh read-only local Check family after each freeze, admits real failing or
passing Evidence, preserves exact repair authority, creates a distinct child
generation, and closes only through current deterministic Acceptance. Active
verification drift atomically fails its Attempt and Workflow while invalidating
the Candidate and dependent Evidence. Mutable Worker leases require the exact
current `RUNNING` Attempt, local runner configuration is closed and bound to
the installed Execution Profile, the M2 driver refuses a missing local
verification capability before Start, Resume, or repair can mutate authority,
and the selected local Runtime cannot fall back to the M1 fake-verification
entry point. Verification Evidence cannot predate its
authorizing Obligation even under clock rollback. The
[Slice 5 review](docs/reviews/m2-slice5-reject-repair-accept.md) records its
focused evidence and limitations. Slice 6 is implemented: a protocol-neutral
Execution Profile extension selects supported backend capabilities and exact
Thread, continuity, Compact, interruption, fallback, and retention policies;
Runtime atomically authorizes a Worker dispatch and external execution before
adapter creation, admits each bounded process/session/operation/terminal
lifecycle observation when it occurs, and retains a Runtime-issued launch
nonce plus exact process identity for restart reconciliation. Recovery may
terminate only the matching owned process group; missing or ambiguous identity
keeps the Workflow blocked. A repair child
uses Context Package/Manifest version 3 compiled only from exact current failure
authority and source-labelled non-authoritative feedback. Retaining or deleting
the old Thread does not change that projection. A failed bounded repair survives
reopen and cannot be continued by ordinary Resume, a stale decision, duplicate
command, or late Worker event. The
[Slice 6 review](docs/reviews/m2-slice6-thread-compact-restart.md) records its
focused evidence and limitations. Slice 7 is implemented: trusted composition
creates one immutable protected Verification Plan in the first Start
transaction, derives the generation-specific protected Check and read lease,
executes the exact protected Oracle outside Worker-writable assets, and admits
only the matching version-3 Evidence family into deterministic Acceptance. The
production CLI exposes bounded protected, adapter-failure, ordinary live, and
repair-handoff demonstrations without exposing raw authority capabilities. The
[Slice 7 review](docs/reviews/m2-slice7-trusted-composition-cli-live.md) records
the deterministic and live evidence plus remaining limitations. The subsequent
[M2 completion review](docs/reviews/m2-completion-review.md) issued the
independent bounded M2 `PASS` verdict; Slice 4's historical proof remains
limited to independent read-only execution and is not reinterpreted as the
later protected-standard proof.

The source-bound Intent Admission and automatic Goal Materialization target is
accepted in
[ADR 0027](docs/adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md)
but is not implemented. M2 must preserve a reusable Codex App Server client
boundary; the Intake Coordinator, Intent Projection/Admission authority, and
Intake Assistant Adapter remain planned for M2.5. The same Intake boundary owns
bounded non-authoritative Answer-only results and terminal Intake-failure
classification. Materialization creates a `READY` Workflow; optional automatic
execution still crosses the separate ordinary `StartGoal` boundary.

## Architectural Goal

CodeClosure places a deterministic host runtime between the user and a
probabilistic coding worker. The host owns intent, state, capabilities,
candidate identity, evidence, and acceptance. The worker owns only permitted
execution.

```text
                         User
                          |
                          v
                  CodeClosure CLI / App
                    /              \
                   v                v
       natural-language request   explicit CreateGoal
                   |                |
                   v                |
        Goal Intake Coordinator     |
            (M2.5 planned)           |
          |-- Intake Assistant       |
          |-- Intake Store           |
          `-- Intent Admission Engine
                   |                |
                   | admitted source-bound Projection
                   +--------+-------+
                            |
                            v
        +--------------------------------+
        | CodeClosure Control Runtime    |
        |                                |
        | Runtime App / Goal Manager     |
        | Goal / Fact / Decision Store   |
        | Workflow Runtime               |
        | Context Compiler               |
        | Candidate Manager              |
        | Evidence Store                 |
        | Acceptance Engine              |
        | Human Decision Gateway         |
        +---------------+----------------+
                        |
                        v
                  Worker Port
                        |
             +----------+-----------+
             |                      |
             v                      v
        FakeWorker (M1)    Codex Worker Adapter (M2)
                                     |
                                     v
                          Codex App Server Client
                                     |
                                     v
                             Codex App Server
```

## Architectural Planes

### Interaction Plane

The CLI or future App presents goals, progress, blockers, decisions, and
evidence summaries. It sends typed Goal commands to the Runtime application
facade and renders Runtime-owned read views. It does not write or query the
control database directly, sequence internal Workflow commands, or infer
successful completion from a worker transcript.

The planned Intake surface separately presents Raw Request revisions, trusted
interaction action, assistant Proposal, source-bound Intent Projection,
material questions, Admission reasons, Answer-only delivery disposition,
terminal Intake failure/next action, and Materialization/Start dispositions. It
does not render a proposal, Projection, or assistant answer as a formal Goal or
reuse a Goal status view before Materialization.

### Control Plane

The control plane owns all authoritative CodeClosure state and policy. It
decides:

- which goal revision is active;
- which phase is current;
- which actions are permitted;
- which candidate generation is current;
- which evidence is eligible;
- whether acceptance can be evaluated;
- whether an accepted decision can be committed to closeout.

### Execution Plane

Workers and verification runners act on bounded inputs and return typed
outputs. They cannot access control-store mutation APIs.

### Project Plane

The source repository, candidate workspaces, Git metadata, build systems,
tests, runtime services, and generated artifacts constitute external project
reality. CodeClosure observes and reconciles this plane; it does not assume its
own records make external reality true.

## Trust Boundaries

### Boundary A — User to Control Runtime

Natural-language input and its trusted interaction action first become an
immutable Raw Request revision. Assistant output is an untrusted Intent
Analysis Proposal. The Intake Coordinator may validate it and persist a
source-bound Intent Projection revision, but only the deterministic Intent
Admission Engine may issue `MATERIALIZE`. Goal Manager validation and the
Runtime's atomic Materialization transaction then create a formal Goal and
`DISCOVERY / READY` Workflow. Materialization never creates an Attempt or
dispatches a Worker; optional automatic execution uses a separately bound
ordinary `StartGoal`. A Goal revision or Human Decision becomes authoritative
only after the owning Runtime boundary validates and persists its typed record.

For `ANSWER_ONLY`, the assistant may author bounded answer content through a
separate response contract, but the Intake Coordinator owns validation,
disposition, identity, and persistence. An `AnswerOnlyResponse` is useful
interaction output, not a Source Binding, Fact, Criterion, Human Decision,
Evidence, Acceptance Decision, Goal, Workflow, or execution authorization.
An Intake processing failure becomes a reason-coded terminal `FAILED` record
for that IntakeRun; M2.5 does not silently recall the model or resume the same
failed operation.

### Boundary B — Control Runtime to Worker

The worker receives:

- a compiled, digest-bound context package;
- the current phase objective;
- a capability grant;
- the active candidate path when writes are permitted;
- a response schema or typed worker contract.

The worker does not receive a direct control-store write channel.

### Boundary C — Worker to Control Runtime

All worker output is untrusted input. The adapter validates protocol shape and
the runtime validates semantic preconditions. A worker result may request a
transition, report an observation, or propose a fact; it cannot cause a state
transition by naming one.

### Boundary D — Candidate to Evidence

`SOURCE_FREEZE` establishes a candidate digest. Evidence runners bind output to
that digest. Any source mutation invalidates the evidence chain.

### Boundary E — Evidence to Acceptance

The Acceptance Engine reads immutable input manifests and emits a decision. It
cannot run implementation tools or change candidate source.

### Boundary F — Technical Closeout to Real-World Effect

Closeout establishes technical completion for the declared workflow scope. A
promotion, merge, release, deployment, paid action, or irreversible data change
requires a separate gateway and policy.

## Logical Components

### Goal Intake Coordinator — planned M2.5

Owns the pre-Goal IntakeRun lifecycle and validated Raw Request revisions,
Intent Analysis Proposals, Intent Projection revisions, Source Bindings,
Material Ambiguities, Clarification Questions, Answer-only result disposition,
and terminal Intake failure classification. It compiles operation-specific
Intake packages, invokes an Intake Assistant through a narrow port, validates
all assistant output as untrusted input, and derives immutable Projection,
AnswerOnlyResponse, and IntakeFailureRecord identity and digest authority.

It cannot issue an Admission Decision by itself, create a formal Goal, mutate a
Workflow, invoke `StartGoal`, dispatch a Goal-bound Worker, issue technical
Acceptance, or authorize an external effect. Goal Materialization crosses into
the Runtime application boundary, where the Goal Manager validates formal
intent and the Workflow Runtime remains the only Workflow writer. See
[Goal Intake](docs/goal-intake.md).

### Intent Admission Engine — planned M2.5

Evaluates either one immutable pre-analysis Raw Request view or one complete
Projection/Source-Binding view under an exact Admission Policy and issues
`MATERIALIZE`, `CLARIFY`, or `NO_EXECUTION` with an ordered reason trace. It is
deterministic for fixed canonical inputs and cannot call an assistant while
deciding.

It owns neither the Projection nor the resulting Goal. It cannot mutate Intake
or Workflow state, create an Attempt, select a replacement execution profile,
issue technical Acceptance, or perform an external effect. The trusted Store
may reject malformed or stale decisions but cannot replace another outcome
with `MATERIALIZE`.

### Runtime Application Coordinator

The implemented M1 Slice 7 application facade creates Goals, invokes public
start/resume/cancel commands, owns startup-recovery and query capabilities, and
returns schema-versioned Goal status/audit views. It receives narrow Store and
external-inspection ports; adapters receive neither those ports nor the
Workflow kernel.

The implemented M1 Slice 7 driver reloads authoritative state before each
internal operation and stops at a terminal, waiting, blocked, failed,
decision, or typed infrastructure boundary. Each internal phase operation is
its own audited transaction so process restart can re-enter from the last
committed boundary. Public `StartGoal` and `ResumeGoal` await that drive and
return the exact stored public-command result separately from an informational
drive summary. The summary and the existing dominant-blocker explanation are
derived views, not Acceptance or closeout authority. A retained active Attempt
is never adopted or redispatched; startup reconciliation and a fresh
`ResumeGoal` must authorize replacement work. See
[ADR 0020](docs/adr/0020-runtime-application-recovery-and-query-boundary.md).

### Goal Manager

Owns Goal creation, revision, activation, cancellation, and successful closure
identity. Goal intent and revision are authoritative here. In M1 the lifecycle
status exposed on Goal is a denormalized projection of its unique Workflow run
status, synchronized inside the Workflow transaction rather than changed by a
second lifecycle writer. It never stores the only copy of Goal state in a
worker prompt.

### Fact and Decision Store

Stores provenance-bearing facts, business scenarios, relationships, unresolved
questions, and typed human decisions. M1 implements the minimum record model;
full Fact Graph discovery and traversal is a later milestone.

### Workflow Runtime

The sole authoritative workflow-state writer. It:

- resolves the owning Goal/Workflow and validates expected freshness before
  child lookup, guard evaluation, identifier allocation, or domain planning;
- enforces the transition matrix;
- derives phase capabilities;
- owns Attempt lifecycle as part of the versioned Workflow aggregate in M1;
- persists state plus audit event atomically;
- suspends for typed blockers and decisions;
- reconciles after interruption.

In the current Worker path it also commits a Context-bound Attempt atomically,
claims dispatch against the exact active Workflow version, owns cancellation
and `AbortSignal` ordering, reloads that claim before every event admission,
and converts a validated Worker event into a runtime-authored internal command.
Every durable receipt retains dispatch causality. The Worker cannot choose that
command, its failure classification, or mutate state through its delivery
identity. Strict event shape and a compiler-owned canonical byte budget bound
Worker output before semantic admission.

In the current Candidate/Evidence path, the Runtime coordinates the owning
Candidate Source, Verification Runner, and Store without giving any of them a
Workflow mutation method. Candidate creation, freeze, drift failure, Evidence
admission, eligibility invalidation, and Evidence Set finalization use
authority-specific compound transactions. Generic phase guards cannot
self-attest Candidate, Evidence, or Acceptance facts. Candidate Source output
cannot author project/workspace identity; Check Specifications bind the M1
producer, and specialized Runtime builders derive Evidence producer,
environment, payload, and result fields.

In the current Acceptance path, closeout and repair are dedicated compound
transactions rather than generic phase requests. Closeout retains the exact
accepted authority. Repair retains a canonical immutable record that binds the
consumed repairable decision and manifest, rejected generation, fresh child,
Checks, and Verification Obligations. SQLite and startup validation reconstruct
that relationship; nearby rows or an opaque audit label cannot substitute for
it. See
[ADR 0019](docs/adr/0019-exact-acceptance-repair-authority.md).

The current M1 package root exposes the narrow create/start/resume/cancel and
query application capabilities for public adapters. Public mutations operate
only by Goal identity. Startup recovery remains a separate trusted lifecycle
capability and is not a handler command. The internal Workflow control kernel
and its Attempt/phase commands remain unavailable as package-root adapter
capabilities. The implemented trusted composition root constructs the verified
Store, driver, installed Policy and Execution Profiles, and recovery inspector;
the driver alone constructs its hidden kernel. Composition completes startup
recovery before returning a facade, while CLI handlers, worker adapters, and
other callers receive neither the control Store mutation port, the internal
kernel object, nor the recovery coordinator. See
[ADR 0020](docs/adr/0020-runtime-application-recovery-and-query-boundary.md)
and [ADR 0021](docs/adr/0021-m1-execution-profile-and-cli-composition.md).

The currently implemented CLI adapters cover Goal creation, start, status,
resume, cancellation, Goal-owned audit, and all eight named M1 proof demos.
They parse and validate operands before opening authority, route normalized
project identity through trusted composition, invoke only narrow application
or proof capabilities, and render Runtime-owned authority without deriving
lifecycle or completion authority. Demo adapters create their own isolated
authority home and return success only after scenario-specific final state,
audit, and SQLite reopen assertions pass. The restart proof interrupts one real
CLI start process only after its dispatch claim is durable, then uses separate
public status and resume processes. The public status process, not an internal
proof read, must perform startup recovery. A subsequent proof-only facade
exposes only captured `status`, `audit`, and `close`; it fails closed if its own
composition reports any recovery scan or reconciliation. The separately named
dispatch observer is read-only and exposes only the current claimed Attempt
identity, phase, and Workflow version; neither proof capability can authorize
recovery or replacement work. The duplicate-result proof observes every
Worker-backed Attempt separately: two deliveries carry the same
`WorkerEventId`, while Runtime audit retains one dispatch claim and one paired
Attempt/Workflow finish effect for that Attempt. CLI source enforcement assigns
privileged package imports to exact named composition owners rather than to the
whole composition directory, confines relative imports to CLI source, closes
privileged export and sensitive-consumer manifests, rejects dynamic module
loading, and prevents statically evident direct or forwarded raw SQLite
authority from reaching the restart proof. This is an engineering-miswiring
gate, not a hostile-JavaScript sandbox; Runtime and Store validation remain the
authority boundary. Proof-owned child processes have fixed deadlines, hard
retained-output limits, forced cleanup, and resolve completion from the child
`close` event after process termination and all stdio closure, not from `exit`
alone.

### Context Compiler

Builds a phase-specific worker input from authoritative state and current
project evidence. It records a `ContextManifest` so the runtime knows exactly
which revisions and facts were presented.

The compiler is not a conversation summarizer. It may include a bounded
transcript excerpt as non-authoritative working context, but it never depends
on that excerpt for goal identity or acceptance.

The M1 compiler emits a disposable canonical Context Package and a durable
Manifest. The first Start binds one exact installed Policy to the Workflow;
later Runtime configuration must match that immutable identity before
compilation, and the compiler cannot substitute it. Slice 7 separately binds
the Workflow's immutable installed Execution Profile. The Runtime then
cross-checks package and Manifest against the exact Goal, resulting
Workflow/Attempt, phase policy, Candidate, Execution Profile, Policy bindings,
authority labels, and entry projection before the Store commits them with
Attempt start. Dispatch consumes an immutable version-fenced claim bound to the
same profile; Worker event receipts use an identity domain separate from
application commands. See
[ADR 0014](docs/adr/0014-context-bound-worker-dispatch-and-event-admission.md)
and [ADR 0021](docs/adr/0021-m1-execution-profile-and-cli-composition.md) plus
[ADR 0022](docs/adr/0022-immutable-workflow-policy-binding.md).

M1 does not yet have a durable resolver for selected Fact, Human Decision, or
project-source authority. Those selected entries and all omission decisions
therefore remain closed under
[ADR 0015](docs/adr/0015-close-m1-worker-authority-causality.md). M1 Slice 5 opens
only one additional source class: an `IMPLEMENT` package binds the exact active
`MUTABLE` Candidate generation and its `baseDigest`, resolved through Candidate
authority and independently rechecked by Runtime and Store. `DISCOVERY` and
`PLAN` remain Candidate-free, and source freeze or verification uses its own
port instead of a coding-Worker prompt. See
[ADR 0016](docs/adr/0016-candidate-and-evidence-authority-boundary.md).

Slice 6 extends this smaller package for a fresh repair Worker Session and
Thread. Runtime compiles the exact current `AcceptanceRepairRecord`,
`REJECT_REPAIRABLE` decision, Acceptance Input Manifest, its exact Evidence
Set, selected failing Evidence and eligibility snapshots, parent/child
Candidate identities, and bounded source-labelled
`priorAttemptFeedback` deterministically projected from those records plus the
retained Candidate-freeze change-set digest and Goal preservation constraints.
That list is the closed bounded-M2 source set: decoded changed-file lists,
attempted approaches, eliminated directions, unrelated project observations,
and model summaries are not selected and cannot be inferred from old chat.
Full old chat, hidden reasoning, KV cache, and raw tool history remain outside
the package by default. History retention and Context injection are separate
policies: deleting the old Thread cannot erase failure authority, while
retaining it cannot silently make the transcript authoritative. Missing,
stale, or mismatched repair inputs block dispatch.

Slice 7 adds the exact protected Verification Plan ID/digest to both the
Context Package and Manifest under the bounded protected Profile. Runtime
derives that pair from first-Start authority and requires every protected
dispatch claim to revalidate it; M1 and non-protected Context schemas retain
their existing meaning.

### Candidate Manager

Creates isolated candidate generations, records their base identity, manages
write/read-only lifecycle, computes freeze digests, detects mutation, and
invalidates dependent evidence.

The worker never edits the authoritative control store and should not edit the
user's source checkout directly in the governed path.

The M1 adapter remains logical and deterministic. The M2 Slice 3
`@codeclosure/workspace-local` adapter now implements ADR 0029's bounded
controlled copy, exact source-tree and Git-metadata projections,
protocol-neutral mutable/read-only lease contract, immutable freeze, exact
parent-based repair, exact-authority restart classification, and one-time
owned-leaf cleanup grants. It does not mutate Domain, Workflow, Store, Evidence,
or Acceptance authority. Slice 5 composes it through trusted in-process Runtime
capabilities for the deterministic proof path; production CLI and live Codex
composition remain later M2 work.

### Evidence Store

Stores immutable, typed observations and their content-addressed payloads. It
tracks provenance, candidate binding, policy/check identity, redaction, and
invalidation.

The current M1 runner reports only a closed result status. Request-aware
Runtime admission derives the producer and check binding from the validated
request, constructs the normalized fake observation, and uses its
Runtime-computed digest as the fake payload reference. Unknown fields and raw
adapter exceptions are rejected without becoming authority. M2 Slice 4 adds
the closed version-2 local-command Evidence variant and a bounded immutable
SQLite payload table. Runtime hashes the retained stdout/stderr bytes and the
Store commits payload, Evidence, initial eligibility, Workflow effects, audit,
and command outcome atomically. Missing, corrupt, malformed, or colliding
payload authority fails closed. Larger or arbitrary-project payload storage
remains a later explicit decision.

Slice 5 selects one complete Check family for each Evidence Set. The retained
M1 fake family remains the regression/bootstrap authority, while a current
local-command family becomes the exact verification authority when installed.
Mixed or partial families fail in Runtime, Store, SQLite triggers, and reopen
validation.

Slice 7 implements ADR 0031's additive authority before a local-command family
may be decisive for an acceptance-critical Criterion. Trusted composition
fixes an immutable pre-Worker Verification Plan and protected-asset manifest;
each frozen generation's Check and Evidence bind back to that exact plan.
Worker-authored tests may produce labelled supplementary Evidence but cannot
alone satisfy the protected obligation. ADR 0032 fixes exactly one such plan
for the bounded Workflow, defines a deterministic protected-asset read lease
and version-2 isolation profile, and keeps supplementary records outside the
decisive one-family Evidence Set. This remains a Slice 7 claim and does not
reinterpret Slice 5's historical proof.

### Acceptance Engine

Evaluates a versioned Policy Bundle against one `AcceptanceInputManifest`. It
returns a deterministic decision and rule-by-rule trace. It has read-only
access to candidate and evidence data and no worker or source-edit capability.

### Human Decision Gateway

Captures only the allowed human-input classes and binds each response to exact
scope. It does not offer a generic "ignore failed gate" control.

### Worker Adapter

Converts CodeClosure worker requests into backend protocol actions and maps
backend events into typed observations. The core domain never imports
backend-specific Thread, Turn, Item, approval, or sandbox types.

M2 initially targets Codex App Server v2 over stdio. The Codex Worker Adapter
records the Codex version and uses schemas generated for that installed
version. Its lower-level App Server client MUST remain separable from
WorkerPort semantics so a later Intake Assistant Adapter can reuse protocol
transport and lifecycle without receiving Goal-bound authority.

### Verification Runner

Executes exact check specifications with bounded argv, cwd, environment,
timeout, output limits, and cleanup rules. It is separated from the coding
worker so verification policy is not merely another prompt instruction.

The M2 Slice 4 implementation provides one Darwin-only local-command adapter.
It validates the exact executable realpath and digest, uses no shell, inherits
no ambient environment, executes against a current read-only Candidate lease,
denies Candidate writes, authority and credential reads, and network access,
and writes only below a Runtime-owned temporary run root. Runtime observes the
frozen Candidate before and after execution and admits only a closed bounded
result. The adapter cannot create Evidence, issue `ACCEPT`, or transition a
Workflow. Slice 5 Runtime composition owns those control steps and keeps the
adapter observation non-authoritative until validation and atomic persistence.

Independent execution is not independent verification-standard authority.
Under [ADR 0031](docs/adr/0031-protect-acceptance-critical-verification-from-worker-writable-assets.md),
the bounded M2 acceptance-critical Check and Oracle must be fixed before Worker
mutation and stored outside Worker authority or bound to exact pre-Worker
content. Asset removal, replacement, weakening, aliasing, or digest drift
prevents decisive passing Evidence. This boundary permits Worker test changes
as supplementary work and does not claim general test-suite completeness.
[ADR 0032](docs/adr/0032-close-bounded-m2-protected-verification-composition.md)
closes the bounded composition with one Workflow-scoped plan, a deterministic
exact-read lease, Darwin isolation profile version 2, and a decisive Evidence
Set that excludes supplementary families.
[ADR 0033](docs/adr/0033-align-protected-verification-with-start-and-check-lifecycle.md)
aligns that plan with the first `StartGoal` atomic transaction and makes the
lease a static Check-configuration value; the later request and Evidence bind
Attempt and Obligation causality separately.

## Authority and Storage Topology

```text
Platform application data (CodeClosure-owned)
  state.sqlite          authoritative current state
  audit/                append-only exported audit segments
  evidence/             immutable evidence payloads
  policies/             installed/versioned policy bundles
  profiles/             installed/versioned execution profiles
  workspaces/           managed candidate generations

Target source repository
  project code          observed base source
  .codeclosure/         optional versioned project declaration only

Candidate workspace
  project code          worker-writable only during IMPLEMENT
  run-owned outputs     bounded and phase-specific
```

For bounded M2, ADR 0030 stores immutable stdout/stderr payload bytes in a
content-addressed SQLite table so payload references and Evidence authority are
transactional. The `evidence/` directory remains a later large-payload target,
not an M2 implementation claim.

The Slice 7 application MUST resolve a platform data home: macOS uses
`$HOME/Library/Application Support/CodeClosure`, Linux uses
`${XDG_DATA_HOME:-$HOME/.local/share}/codeclosure`, and Windows uses
`%LOCALAPPDATA%\CodeClosure`. An absolute `CODECLOSURE_HOME` is an optional
operator/test override, not a required environment variable. The resolved home
must not be the target repository, be nested beneath it, or be inside a
worker-writable candidate. Tests and proof demos inject isolated temporary
homes. See
[ADR 0021](docs/adr/0021-m1-execution-profile-and-cli-composition.md).

## State Persistence Model

M1 uses two complementary representations:

1. normalized current-state tables for direct, validated reads;
2. append-only audit events written in the same transaction as state changes.

This is not full event sourcing. Current state remains the operational source
of truth; the event log provides traceability, replay checks, and recovery
diagnostics. Every aggregate carries a monotonically increasing version for
optimistic concurrency control.

Versions provide strict mutation order. Control timestamps preserve causal
order but are not a concurrency mechanism: the Runtime validates its injected
clock and clamps a valid rollback to the current aggregate timestamp, while
domain event application, the Store, and SQLite reject a bypassed older event.
Equal timestamps are valid because versions and audit sequence numbers remain
strict. See [ADR 0012](docs/adr/0012-causal-control-timestamps.md).

Expected version and command-identity conflicts are explicit store-port result
variants. Adapter-specific exception class names are not part of the Runtime
contract. External Worker, Candidate Source, and Verification Runner failures
cross the M1 authority boundary only as closed Runtime-owned reason codes; raw
exception text is not persisted. On a version conflict, the Runtime reloads and
reevaluates an admitted command before deciding whether to persist a rejection.

Every processed-command row stores a schema-versioned outcome envelope authored
by the Store inside the command transaction. Envelope version 3 distinguishes
`APPLIED` from `REJECTED` and binds the `CommandId`, exact aggregate target,
owning `GoalId`, owning `WorkflowId`, observed Workflow version/phase/run
status, and public command output. An applied output is derived from and must
exactly match the resulting Workflow; a rejected output is derived from a typed
deterministic-command error and the observed Workflow. Infrastructure and
replay-integrity errors cannot enter this rejection history. Commit ports do
not accept caller-authored outcome envelopes.

Replay validates the canonical input digest and all authority bindings before
returning the output. Both Goal- and Workflow-targeted replay reload the real
owning records; target-string equality is not existence proof. Migration 0005
fails closed for outcomes without identity binding. Migration 0006 likewise
fails closed for existing version 2 outcomes because their historical
transaction semantics cannot be reconstructed safely.

Authority-bearing JSON identities use the named, schema-versioned canonical
projections in
[ADR 0006](docs/adr/0006-canonical-serialization-and-digest-profiles.md).
Generated record IDs and timestamps are not silently mixed into semantic replay
identity.

Authority validation is closed across Runtime and persistence. TypeScript
brands and port annotations are not runtime proof. Each authority-bearing
record passes one owning codec when it enters a control boundary, before a
Store writes it, and when persistence materializes it again. A Store may return
`APPLIED` only for records that remain decodable immediately and after reopen.
Normal command admission and replay share one Goal/Workflow authority resolver;
they do not maintain different relationship rules. SQLite mirrors critical
codec rules as defense in depth, and strengthening migrations fail closed for
retained rows that cannot prove the new contract. See
[ADR 0013](docs/adr/0013-authority-boundary-validation-closure.md).

SQLite authority guards express validity as a positive predicate and treat SQL
`NULL`/unknown as invalid. A later migration that replaces or extends a guard
must preserve the complete earlier contract rather than validating only its new
fields.

Policy installation follows the same closure. The Runtime accepts a definition
without caller-authored identity, computes its canonical digest, and assigns
installation time and audit identity. The Store independently recomputes the
digest. The Policy row and installation audit commit or roll back together;
startup rechecks retained Policy content, and migration 0010 refuses unaudited
Policy authority. After migrations, every Store startup also rederives retained
M1 Context identity from its authoritative sources and validates dispatch
claims, terminal Attempt time, and every Worker receipt's causal link to its
claim. SQLite triggers protect normal writes; startup checks detect authority
data changed while the Store was offline.

Installation does not select a Policy for a Workflow. The first successful
Start atomically records a separate immutable Workflow Policy binding. Runtime,
Store, recovery, driver, Context, Evidence, Acceptance, repair, and closeout
must resolve that exact ID and digest; an incompatible process fails before
continuation. See
[ADR 0022](docs/adr/0022-immutable-workflow-policy-binding.md).

Retained Evidence Sets use their unique recording audit sequence as a temporal
cut. Startup reconstructs which Evidence and eligibility version existed at
that cut and rebuilds the canonical set. Later invalidation preserves that
historical record but makes it unusable as current acceptance input. See
[ADR 0017](docs/adr/0017-derive-boundary-authority-and-replay-evidence-by-audit-sequence.md).

## Capability Enforcement

The Workflow Runtime derives a capability grant from phase and policy. The
grant is enforced at multiple layers:

1. do not expose disallowed runtime operations to the caller;
2. configure worker sandbox/cwd/permissions as narrowly as the backend permits;
3. isolate authoritative state from worker filesystem access;
4. recompute candidate identity and reject any prohibited mutation;
5. fail acceptance when enforcement or observation is incomplete.

Backend sandboxing is defense in depth, not the only completion boundary.

## Codex Integration Boundary

Codex App Server exposes Thread, Turn, and Item primitives plus per-thread and
per-turn cwd, approval, sandbox, and context controls. CodeClosure maps them as
execution details:

| Codex concept | CodeClosure interpretation |
| --- | --- |
| thread-scoped goal or plan | Disposable execution guidance; never a CodeClosure Goal or transition authority |
| Thread | Disposable worker session linked to a Goal/phase attempt |
| Turn | One bounded worker invocation |
| Item | Streamed observation or proposed side effect |
| `turn/completed` | Worker invocation ended; not Goal completion |
| `thread/compact/start` | Worker-history maintenance; not authority compaction |
| approval request | Backend effect request routed through current capability policy |
| sandbox/cwd | Defense-in-depth enforcement for the current phase |

Codex compaction replaces model history with a compacted representation and
re-injects selected initial context. Therefore no CodeClosure authority may
exist only inside Codex history.

The target adapter layering is:

```text
Codex App Server Client
├── Codex Worker Adapter
│   └── Goal-bound WorkerPort requests and events
└── Goal Intake Assistant Adapter (M2.5 planned)
    ├── IntakePackage -> IntentAnalysisProposal
    └── AnswerOnlyPackage -> bounded answer response
```

The client owns protocol process, transport, initialization, generated schema,
stream, interruption, and compatibility mechanics. It owns no Goal, Workflow,
Worker, Projection, Source Binding, Admission, Start, Acceptance, or
persistence semantics. M2 implements and validates the Worker branch only;
Goal Intake is not an M2 exit condition.

For the planned M2 branch, Codex configuration and state are execution inputs,
not ambient host truth. Trusted composition must either disable or exactly bind
every effective config layer, instruction source, tool surface, state root, and
non-secret model/runtime option to the Workflow's installed Execution Profile.
Managed requirements are resolved before that profile is bound and may
constrain which profile can be installed. After Workflow start, a missing or
changed requirements identity blocks execution; it cannot silently narrow or
widen the bound profile. Credentials remain separately injected secrets and
must not enter profile digests, Candidate command environments, audit, or
Evidence.

ADR 0028 makes the Runtime-owned `ExternalExecutionRecord` the durable causal
bridge from one M1 dispatch to an observed process, backend session, backend
operation, and terminal disposition. A separate maintenance intent records
working-context compaction without creating another Worker dispatch or result.
The adapter returns only protocol-neutral observations and receives no Store.
`turn/steer` is prohibited because it would insert unadmitted input into an
active Turn.

M2 uses a controlled `CODEX_HOME`, strict config, an exact custom permission
profile, untrusted project config, source-bound instruction files, disabled
ambient integrations, and separately provisioned credentials. On the selected
0.146.0 schema, the stable Thread response reports the custom permission profile
as a legacy `workspaceWrite`/`network=false` projection. Effective binding
therefore combines `config/read`, `permissionProfile/list`, exact
`instructionSources`, and black-box containment rather than trusting that
legacy projection alone.

Application `CommandId` values and worker-delivery `WorkerEventId` values are
also separate authority domains. The Codex adapter may report a worker event;
it cannot choose or impersonate the runtime command that admits that event.
See [ADR 0009](docs/adr/0009-command-idempotency-and-worker-boundary.md).
The concrete M1 Context binding, durable dispatch claim, cancellation ordering,
and Worker receipt transaction are specified by
[ADR 0014](docs/adr/0014-context-bound-worker-dispatch-and-event-admission.md).
The M1 source closure, Policy installation authority, receipt causality, and
stream termination rules are specified by
[ADR 0015](docs/adr/0015-close-m1-worker-authority-causality.md).
Workflow-lifetime Policy selection is specified separately by
[ADR 0022](docs/adr/0022-immutable-workflow-policy-binding.md).

## Dependency Direction

The initial code should follow ports-and-adapters boundaries without creating
unnecessary packages:

```text
CLI
  -> Application Runtime
      -> Domain + Ports
      -> Store Port
      -> Worker Port
      -> Clock / ID / Digest Ports

Adapters
  -> implement Domain/Application ports
```

Planned M1 workspace:

```text
apps/cli
packages/domain
packages/runtime
packages/store-sqlite
packages/testing
```

ADR 0028 fixes the M2 adapter splits:

```text
packages/codex-app-server-client
packages/adapter-codex
packages/workspace-local
packages/verification-local
```

The App Server client, Codex Worker Adapter, local Candidate workspace, and
local Verification packages are implemented. Slice 5 adds bounded trusted
cross-package orchestration for the deterministic repair proof. Slice 6 adds
restart-aware external-execution composition and fresh repair Context through
the Runtime and Store. The public live path remains later M2 work.

M1 keeps its minimal Context Manifest, Evidence, and Acceptance behavior inside
`domain` and `runtime`. M1 Slice 6 implements that control without introducing a
separate package or a worker-facing completion path.

Codex protocol DTOs must remain inside the App Server client/adapter boundary.
Domain and Runtime packages import neither those DTOs nor Thread, Turn, Item,
approval, or sandbox protocol types. Worker and Intake adapters may share the
client but not each other's domain contracts or authority labels.

## Failure and Recovery Model

Failures are classified rather than collapsed into a generic retry:

- validation failure;
- illegal or stale transition;
- guard or policy evaluation failure;
- control-store persistence failure;
- worker protocol failure;
- worker process failure;
- candidate integrity failure;
- verification failure;
- evidence identity failure;
- acceptance policy rejection;
- missing business or external decision;
- retry exhaustion;
- runtime internal error.

Only failures raised while invoking the control-store port are persistence
failures. Evaluator exceptions and malformed evaluator returns are validated
inside one strict runtime boundary and remain evaluation failures. Runtime
computation/invariant failures retain their own error category, and none of
these infrastructure failures is recorded as a deterministic domain-command
outcome.

Worker stream termination is also explicit. An empty or invalid-delivery-only
M1 stream records non-retryable `PROTOCOL_ERROR`; an uncancelled iterator or
process throw records `ABRUPT_TERMINATION` and requires reconciliation.
Recording either failure first reloads and exactly binds the durable dispatch
claim. Its `claimedAt` is the causal floor for every later Worker result,
failure, cancellation, or restart reconciliation. A successful cancellation
remains interruption. Worker non-admission results distinguish untrusted
delivery from control-plane failure, so a Store or Runtime failure is never
relabelled as a Worker protocol defect simply because no event committed.

`TRANSIENT_BACKEND` retains the `RETRYABLE` classification, but classification
is not immediate retry or redispatch authority. M1 has no persisted
reason-scoped retry budget or backoff policy, so the first transient Worker
failure terminalizes its Attempt as `FAILED`, moves the Workflow to `BLOCKED`,
and stops the driver. The Runtime status view retains the Worker failure as the
dominant blocker and directs the operator to `INSPECT_BLOCKER`; it does not
present the blocked Workflow as ready to continue. One Domain-owned mapping
defines the resulting Workflow status for every failure class; both event
construction and the owning Attempt Event codec enforce that exact mapping.

SQLite migration `0018_m1_retry_boundary_closure.sql` refuses legacy authority
that either contains any later Attempt in any phase after a transient failure,
or retains a latest transient failure while the Workflow is not in the failed
phase with run status `BLOCKED` or `CANCELLED`. Migration failure is atomic and
does not invent a retry authorization, `BLOCKED` transition, or audit history
for retained data. Migration `0019_m1_attempt_authority_closure.sql` separately
refuses either direction of a committed Workflow/Attempt `RUNNING` mismatch,
any Worker-bound result kind incompatible with its phase, any open-ended
Worker-bound failure mapping, any terminal Attempt without its exact historical
paired audits and processed outcome, and any current Workflow that disagrees
with its current Runtime audit/outcome. The migration completes every preflight
before its success record or triggers can commit. The Store's only supported
completion order terminalizes the Attempt first and then releases the Workflow
inside the same transaction. SQLite requires that release to match the exact
Domain result/failure/interruption status matrix and rejects a Workflow-first
release while its active Attempt is still `RUNNING`. The Store rechecks active,
terminal-history, and current-command authority at startup and at both ends of
every mutation; status reads also close the current Workflow projection. A raw
SQLite writer is not a supported authority boundary, and reopen fails closed
after a committed half-state or authority rewrite. Concurrent readers cannot
observe the Store's Attempt-first intermediate row. The retry-specific triggers
additionally reject Workflow continuation, creation of any later Attempt, and
reverse edits that would turn earlier history into a transient failure.

The Driver does not receive complete Attempt history; it validates the current
snapshot subset before recovery or dispatch. Its
snapshot MUST explicitly carry the latest current-phase Attempt and Context
Manifest or `null`; an active Attempt MUST be that latest exact Attempt
snapshot, and omission, a contradictory `null`, or two differing copies of the
same Attempt identity is invalid. Every visible Worker-phase Attempt MUST carry
its Context Manifest identity and Worker Session and resolve the exact
Manifest. That Manifest MUST bind the Attempt phase, start time, capability
grant, phase-owned response-contract digest, legal M1 Candidate shape, and
applicable Workflow version. A `RESULT_RECORDED` reason MUST name a result kind
allowed by that phase; a `FAILED` reason MUST have the exact Runtime-owned
failure classification. Driver, Runtime replay, and Store retained-row reads
share this Worker-phase authority rule. When the visible latest Attempt is a
transient failure, the Workflow MUST be `BLOCKED` or `CANCELLED`. For an
`APPLIED` Worker event operation, the Runtime requires the Store receipt to
exactly match its proposed receipt and, for admission, reapplies the event and
requires the returned Workflow and Attempt to match too. Worker replay uses one
consistent Store snapshot containing the receipt, dispatch claim, and Context
Manifest; an `ADMITTED` snapshot also contains its immutable terminal Attempt
and processed-command outcome. The Runtime first computes and validates the
current Context Package digest once and validates the current request claim.
It then validates the historical replay closure independently. The same
`WorkerEventId` and canonical payload is always `DUPLICATE`; only the same ID
with another payload is a Worker Event ID conflict. An exact `IGNORED`
duplicate is never terminal. An exact `ADMITTED` duplicate sets
`terminalForCurrentDispatch` only when it binds the current dispatch; under
another valid Workflow or Attempt it remains a non-terminal duplicate. Missing,
malformed, self-contradictory, or payload-equal-but-field-contradictory replay
authority is a control-plane failure. A legitimate concurrent winner may have
a historical observed Workflow version, receipt time, or disposition different
from the losing proposal, but the retained authority MUST still bind its exact
dispatch claim. See
[ADR 0024](docs/adr/0024-stop-m1-transient-failure-without-retry-authority.md)
and
[ADR 0025](docs/adr/0025-separate-worker-event-idempotency-from-current-dispatch-termination.md).
Persisted budgets, backoff, and automatic retry policy remain M4 work.

M2 adds one narrower planned repair stop without introducing an automatic
retry policy. Its bounded demonstration authorizes one exact repair child. If
that child fails verification, Runtime must finish the current Attempt and
Worker Session, preserve visible repair-required authority, and create no
generation 3, Thread, Turn, dispatch, process replay, or model fallback without
a new explicit continuation authorization bound to the exact current
`REJECT_REPAIRABLE` decision, manifest, and failing Evidence. Reopen, ordinary
`ResumeGoal`, duplicate commands, and late Worker events cannot imply that
authorization. This proves absence of hidden
continuation; it does not impose a permanent product-wide maximum on future
explicitly authorized repairs. M3 may retain the facts needed to judge multiple
rounds, while M4 owns any automatic continuation budget and stop policy.

The implemented M1 Slice 7 startup sequence:

1. lets trusted composition activate and migrate the control Store through the
   verified isolation bootstrap;
2. installs or exactly matches the built-in M1 Policy and eight named Execution
   Profiles;
3. invokes Runtime startup recovery before publishing the application facade;
4. uses a narrow recovery catalog to detect non-terminal Goals and incomplete
   Attempts;
5. treats every retained dispatch claim as consumed history, never redispatch
   permission;
6. inspects Candidate, base, and project identity through the closed
   `RecoveryInspector` port;
7. atomically interrupts unverifiable in-flight work, advances the Workflow,
   persists an exact `RecoveryReconciliationRecord`, audits the decision, and
   leaves startup-recovered work `BLOCKED`;
8. lets an explicit `ResumeGoal` persist a fresh safe-or-blocked reconciliation
   before any replacement Attempt; and
9. creates fresh Context, Worker Session, and dispatch authority only after a
   safe resume commit.

Recovery and the deterministic Workflow driver belong to the Runtime
application boundary. The CLI never chooses a safe phase, and an execution
profile bound at first start cannot be replaced during resume. Status and audit
views explain the resulting authority but cannot resume it. See
[ADR 0020](docs/adr/0020-runtime-application-recovery-and-query-boundary.md).

Trusted composition activates the Store through the verified isolation
bootstrap in
[ADR 0023](docs/adr/0023-verified-sqlite-authority-activation.md). That
bootstrap holds one unactivated SQLite handle across retained-project
inspection, filesystem isolation verification, migration, post-migration
authority validation, and exact binding comparison. Only after activation does
composition invoke startup recovery, and recovery completes before any handler
capability is published.

## Initial Deployment Model

The initial product is a single local process for one user. It may spawn
bounded child processes for workers and verification. Multi-user auth,
distributed scheduling, remote workers, and cloud state are out of scope until
the local authority model is proven.

## Forking Policy

CodeClosure begins outside Codex. A Codex fork is considered only if a proven
runtime requirement cannot be enforced or observed through the supported App
Server and host isolation boundaries. Convenience, UI reuse, or a desire to
change Codex compaction is not sufficient justification by itself.
