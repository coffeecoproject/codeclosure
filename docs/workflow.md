# CodeClosure Workflow State Machine

## Status

This document defines the target workflow contract. The current M1
implementation includes the deterministic state model, transactional Workflow
and Attempt Runtime, the Context-bound `FakeWorker` proof path, logical
Candidate preparation and irreversible freeze, independent fake verification,
Evidence persistence/invalidation, canonical Evidence Set transition into
`FINAL_VERIFY`, deterministic Acceptance evaluation, accepted closeout, and
repair-generation coordination. The Slice 7 Runtime application facade,
execution-profile binding, recovery, read views, and deterministic application
driver are also implemented. Verified local production composition is now
implemented; CLI command handling and proof scenarios, real project editing,
and Codex integration are not yet implemented.

## Purpose

The workflow turns a long-running engineering goal into explicit, recoverable
phases with enforceable capabilities. It is an internal control model, not a
menu the user must operate.

## State Dimensions

CodeClosure separates:

- **phase** — what kind of work is allowed;
- **run status** — whether the phase is ready, running, waiting, blocked,
  failed, cancelled, or closed;
- **attempt** — one bounded execution within a phase;
- **candidate generation** — one mutable/frozen implementation proposal.

This prevents an operational failure or user wait from being confused with a
new engineering phase.

## Public and Internal Command Boundary

The public product boundary operates by `GoalId`. `StartGoal`, `ResumeGoal`,
and `CancelGoal` resolve the Goal's M1 Workflow and carry both the expected Goal
revision and expected Workflow version. Users and CLI adapters do not start,
interrupt, or mutate Attempts directly.

The implemented Slice 7 application facade exposes `CreateGoal` as a Runtime
operation. It requires explicit success criteria and atomically creates one
Goal plus its unique `DISCOVERY`/`READY` Workflow; it does not dispatch work.
The first Context-bound `StartGoal` transaction binds one installed Execution
Profile. Resume cannot select another profile.

`BeginAttempt`, worker-result admission, interruption, recovery reconciliation,
and phase transitions are internal runtime commands. Their
`expectedWorkflowVersion` serializes operational changes under ADR 0007. A
Codex thread-scoped goal, plan, or turn is worker execution state, not this
CodeClosure Goal and not a command authority.

For a Worker-backed Attempt, start commits the Context Manifest with the
Attempt and Workflow rather than attaching Context afterward. Dispatch requires
an immutable Store claim for the exact active Workflow version, Worker Session,
Manifest digest, and package digest. A cancellation that commits first prevents
the claim; after a claim, cancellation commits the Workflow interruption before
the Runtime aborts the active Worker signal.

Worker delivery uses `WorkerEventId`, not caller- or Worker-selected
`CommandId`. Before considering any event, the Runtime reloads and exactly
binds the request to its durable dispatch claim. Only a current, schema-valid,
request-bound event lets the Runtime create an internal command. That command
commits the Attempt result or failure, Workflow state, audits, processed
outcome, and admitted receipt atomically. Stale or mismatched delivery creates
no state change, success audit, or processed command; an independent ignored
receipt may record that delivery for deduplication, but it still requires the
same claimed Attempt, Workflow, and Context Manifest as its causal predecessor.
See [ADR 0014](adr/0014-context-bound-worker-dispatch-and-event-admission.md)
and [ADR 0015](adr/0015-close-m1-worker-authority-causality.md).

An M1 Worker stream must establish a terminal delivery outcome. An admitted
result or admitted Worker failure is terminal. If the stream is empty or ends
after only malformed, rejected, or ignored Worker deliveries, the Runtime
records `PROTOCOL_ERROR` with a closed stream reason code while the Attempt is
still current. An uncancelled iterator/process throw records
`ABRUPT_TERMINATION` with a closed invocation-failure reason code; its raw
exception text is not persisted. Successful cancellation is an `INTERRUPTED`
Attempt. A control-plane failure during admission is classified separately and
must not be rewritten as a Worker protocol error merely because no receipt
committed. Runtime-authored stream failure also reloads and exactly binds the
durable dispatch claim before it can terminate the Attempt; missing dispatch
authority leaves the Attempt available for explicit recovery. Once a claim
exists, its `claimedAt` is the timestamp floor for Worker result,
Runtime-authored failure, cancellation, and restart reconciliation.

For a new command, the Runtime first resolves the top-level Goal/Workflow
snapshot and applies one freshness gate. Goal commands check the expected Goal
revision and then the expected Workflow version; Workflow commands check the
expected Workflow version. Only a fresh request may look up a child Attempt,
evaluate phase guards or closeout eligibility, allocate identifiers, or run
domain planning. Consequently, a stale request has one stable answer and cannot
leak a later child-state or guard-specific result.

The persisted command outcome is not the public response by itself. The Store
authors a schema-versioned, disposition-tagged envelope inside the same
transaction as the command effect. It binds the response to its exact command
target, owning `GoalId`, owning `WorkflowId`, and observed Workflow snapshot.
`APPLIED` must contain a success matching the resulting Workflow; `REJECTED`
must contain a deterministic admitted-command failure bound to the revalidated
observed Workflow. Infrastructure failures are never stored for replay. Replay
reloads real Goal/Workflow authority and validates every binding before
returning the nested public output. A valid-looking response produced for
another or nonexistent aggregate fails closed. See
[ADR 0010](adr/0010-command-admission-and-outcome-binding.md) and
[ADR 0011](adr/0011-store-authored-command-outcome-semantics.md).

## Runtime Application Driver

The implemented Slice 7 Runtime application driver selects the next
deterministic internal operation after a successful public start or resume;
the CLI cannot sequence those operations. It reloads the current
authoritative view before every phase transition, Attempt, Candidate, Evidence,
Acceptance, explicitly authorized repair, or closeout action. Each action
commits as its own
command and recovery boundary.

The first Start also records the Workflow's exact immutable Policy ID and
digest. Every later driver operation and Resume preflight compares trusted
composition with that binding before recovery, Worker dispatch, Worker event
admission, or planning can write. Installing another Policy does not upgrade an
existing Workflow. See
[ADR 0022](adr/0022-immutable-workflow-policy-binding.md).

Re-entry after a public command replay may continue from a current safe
boundary, but it never repeats an existing Attempt or redispatches a retained
claim. The driver stops at terminal, waiting, blocked, failed, decision, or
infrastructure-failure boundaries. Its process summary is informational; only
the persisted Workflow and Acceptance/closeout records authorize lifecycle
meaning. After an operation limit or concurrent command rejection, the driver
reloads persisted authority so a newly committed terminal or decision boundary
wins over its local stop reason. See
[ADR 0020](adr/0020-runtime-application-recovery-and-query-boundary.md).

Public `StartGoal` and `ResumeGoal` are asynchronous because the caller waits
until this safe stop boundary. Their result keeps the exact persisted public
command outcome under `command` and the non-authoritative process observation
under optional `drive`. `CreateGoal`, `CancelGoal`, and read queries remain
synchronous. A current `REJECT_REPAIRABLE` stops as
`ACCEPTANCE_REPAIR_REQUIRED`; the M1 driver does not invent user authorization
or an unbounded retry policy.

Normal Goal commands, normal Workflow commands, and replay use one authority
resolver. It validates the complete Goal and Workflow snapshots, their owner
and revision relationship, the Goal lifecycle projection, and the exact target.
Store or adapter type annotations are not proof of those facts. See
[ADR 0013](adr/0013-authority-boundary-validation-closure.md).

An internal phase-transition request names the desired phase but does not carry
caller-authored guard outcomes. The Runtime obtains ordinary guard results from
the owning internal evaluators, strictly validates their complete runtime
shape, and records valid results on the transition event. A thrown evaluator or
malformed evaluator return is an evaluation failure and creates no command
outcome. `CURRENT_ACCEPTANCE` is reserved for the dedicated closeout path,
which reloads an Acceptance Engine decision and its exact bindings. The Slice 6
`CloseAcceptedGoal` command alone constructs that guard and atomically accepts
the Candidate, closes the Workflow/Goal, and records the closeout binding.
`BeginAcceptanceRepair` similarly owns `REJECT_REPAIRABLE_RECORDED` and creates
a fresh child generation. The same transaction retains one immutable repair
record binding the exact decision/manifest, rejected generation, child,
generation-scoped Checks, Verification Obligations, audit group, and command
outcome. Generic phase requests remain unable to construct or consume either
proof. See
[ADR 0019](adr/0019-exact-acceptance-repair-authority.md).

Slice 5 phase guards are not supplied by that generic evaluator. The Runtime
constructs Candidate and Evidence guards only from decoded Candidate,
Verification Obligation, Check Specification, Evidence, eligibility, and
source-observation authority; the Store reconstructs the persisted portion of
those proofs before committing. Runtime and Store both rebuild the canonical
Evidence Set from current authority before transition or persistence. Retained
sets are later replayed against the Evidence eligibility that existed at their
unique recording audit sequence; latest eligibility remains a separate
currency gate.
`SOURCE_FREEZE` and `EVIDENCE_BUILD` Attempts use dedicated Candidate Source
and Verification Runner ports and never dispatch the coding `FakeWorker`.
Their malformed output and invocation failures are normalized to closed reason
codes before any authority is persisted. A frozen-source mismatch fails the
Workflow and invalidates all still-eligible Evidence for that generation
atomically. See
[ADR 0016](adr/0016-candidate-and-evidence-authority-boundary.md) and
[ADR 0017](adr/0017-derive-boundary-authority-and-replay-evidence-by-audit-sequence.md).

## Main Phase Graph

```text
DISCOVERY
   |
   v
PLAN
   |
   v
IMPLEMENT <-------------------------------+
   |                                      |
   v                                      |
SOURCE_FREEZE                             |
   |                                      |
   v                                      |
EVIDENCE_BUILD                            |
   |                                      |
   v                                      |
FINAL_VERIFY -- REJECT_REPAIRABLE --------+
   |
   | ACCEPT
   v
CLOSEOUT
```

`REJECT_BLOCKED`, `NEEDS_DECISION`, `ENGINE_ERROR`, cancellation, and retry
exhaustion change run status or create a blocker. They do not invent a success
path.

## Phase Contracts

### DISCOVERY

Purpose:

- bind project and base source identity;
- identify the goal's current facts and unknowns;
- discover relevant business scenarios and code surfaces;
- determine the smallest safe planning depth.

Allowed:

- read project and authoritative external facts;
- run bounded read-only discovery;
- propose facts and scenarios;
- request a typed missing business/external fact.

Forbidden:

- source edits;
- candidate acceptance;
- treating inferred coverage as confirmed;
- closing the goal.

Exit guard:

- Goal revision is current;
- project/base identity is recorded;
- required discovery is complete or explicitly scoped;
- every required unknown is resolved or represented as a blocker;
- applicable business scenarios are recorded or a policy-backed reason says
  they are not required.

### PLAN

Purpose:

- translate the Goal and scenario set into a bounded implementation and
  verification plan.

Allowed:

- read source and facts;
- create plan proposals in the control store;
- define expected change surfaces and verification obligations;
- run read-only plan review.

Forbidden:

- source edits;
- accepting a plan because the worker says it is good;
- expanding Goal scope without a Goal revision;
- closing the goal.

Exit guard:

- current plan binds the Goal revision and facts;
- expected change set and non-goals are explicit;
- scenarios map to implementation surfaces and verification obligations;
- plan-policy checks pass;
- no required planning blocker remains.

### IMPLEMENT

Purpose:

- create or repair one isolated candidate generation.

Allowed:

- write only inside the active mutable candidate and run-owned locations;
- execute bounded implementation commands;
- inspect and test during development;
- submit proposed facts, observations, and a Completion Request.

Forbidden:

- control-store mutation by the worker;
- editing a frozen generation;
- writing the governed source checkout directly;
- changing Goal scope through code;
- issuing acceptance.

Exit guard:

- a current mutable candidate exists;
- worker activity has ended or been interrupted safely;
- actual change set can be enumerated;
- prohibited paths/effects are absent;
- a Completion Request or runtime policy requests freeze evaluation.

### SOURCE_FREEZE

Purpose:

- establish immutable candidate identity before evidence is built.

Allowed:

- stop implementation workers;
- reconcile the workspace;
- enumerate source and change identity;
- compute and persist the frozen digest;
- change candidate state from `MUTABLE` through `FREEZING` to `FROZEN`.

Forbidden:

- source edits;
- worker-controlled digest computation as the sole source;
- evidence reuse from another digest;
- acceptance.

Exit guard:

- no write-capable worker remains active;
- candidate identity is stable across the freeze observation window;
- base and actual change set are recorded;
- frozen digest is persisted;
- integrity policy passes.

If source changes during or after freeze, the generation becomes
`INVALIDATED`; the workflow does not proceed with its evidence.

### EVIDENCE_BUILD

Purpose:

- satisfy verification obligations for the exact frozen candidate.

Allowed:

- read frozen source;
- execute exact verification specifications;
- create run-owned temporary resources and evidence outputs;
- record evidence and cleanup observations;
- perform independent read-only review.

Forbidden:

- modifying frozen source;
- repairing code inside a verification run;
- treating a worker-authored PASS string as observed proof;
- issuing acceptance.

Exit guard:

- at least one required obligation exists;
- every required obligation has current eligible evidence or an explicit
  blocking result;
- evidence binds the frozen candidate and relevant fact/policy versions;
- run-owned resources have required cleanup evidence;
- source digest still matches freeze.

### FINAL_VERIFY

Purpose:

- evaluate all current acceptance rules over one immutable input manifest.

Allowed:

- read authoritative state, frozen source, and evidence;
- recompute identities;
- evaluate deterministic acceptance rules;
- record one immutable Acceptance Decision.

Forbidden:

- source edits;
- worker invocation that can mutate the candidate;
- changing evidence to make a rule pass;
- generic human override;
- entering closeout without current `ACCEPT`.

Outcomes:

- `ACCEPT` — eligible for transactional transition to `CLOSEOUT`;
- `REJECT_REPAIRABLE` — reject the generation and return to `IMPLEMENT` with a
  new generation;
- `REJECT_BLOCKED` — remain at the current phase with a technical blocker;
- `NEEDS_DECISION` — suspend for a typed decision, then rebuild affected
  inputs and reevaluate;
- `ENGINE_ERROR` — fail closed and retry or block according to error policy.

### CLOSEOUT

Purpose:

- record the single successful technical completion truth for the Goal
  revision and accepted candidate.

Allowed:

- transactionally bind the Acceptance Decision;
- mark the candidate generation `ACCEPTED`;
- mark the Goal `CLOSED` and run status `CLOSED`;
- emit a closeout summary and evidence index.

Forbidden:

- changing accepted source;
- treating closeout as merge, push, release, deployment, or production
  authority;
- hiding known limitations or excluded scope.

## Transition Matrix

| From | To | Required authorization | Invalidates |
| --- | --- | --- | --- |
| `DISCOVERY` | `PLAN` | discovery guard | stale discovery attempts |
| `PLAN` | `IMPLEMENT` | plan guard | prior candidate generations when plan identity changed |
| `IMPLEMENT` | `SOURCE_FREEZE` | candidate + boundary guard | incomplete implementation attempt |
| `SOURCE_FREEZE` | `EVIDENCE_BUILD` | stable freeze digest | evidence for older digests |
| `EVIDENCE_BUILD` | `FINAL_VERIFY` | evidence-readiness guard | incomplete runner attempts |
| `FINAL_VERIFY` | `CLOSEOUT` | current `ACCEPT` only | no accepted inputs |
| `FINAL_VERIFY` | `IMPLEMENT` | `REJECT_REPAIRABLE` + new generation | rejected generation evidence for future acceptance |

Direct jumps, including `IMPLEMENT -> CLOSEOUT`, are illegal.

## Capability Matrix

| Phase | Project read | Candidate source write | Run-output write | Control-state command | Acceptance evaluation |
| --- | --- | --- | --- | --- | --- |
| `DISCOVERY` | yes | no | bounded discovery only | proposals | no |
| `PLAN` | yes | no | plan observations | proposals | no |
| `IMPLEMENT` | yes | current mutable generation only | bounded | completion request | no |
| `SOURCE_FREEZE` | yes | no | freeze metadata | runtime-owned | no |
| `EVIDENCE_BUILD` | read-only frozen | no | run-owned only | evidence submission | no |
| `FINAL_VERIFY` | read-only frozen | no | decision trace only | decision submission | yes, read-only |
| `CLOSEOUT` | read-only accepted | no | closeout export | runtime-owned | consume existing only |

The runtime enforces this matrix through API exposure, workspace separation,
backend sandbox settings, and post-action integrity checks.

## Suspension and Decisions

Any non-terminal phase may use run status `WAITING_FOR_INPUT` when one of the
allowed human-input classes is genuinely required. The suspension record must
identify:

- exact question or effect;
- why project evidence cannot resolve it;
- scope and invalidation conditions;
- safe resume phase.

After a decision arrives, the runtime does not blindly continue. It revises the
relevant facts/Goal when needed, invalidates dependent inputs, and reevaluates
the phase guard.

## Cancellation

The user may cancel a Goal. Cancellation:

- stops new worker dispatch;
- interrupts bounded active work when safe;
- preserves audit and candidate records according to retention policy;
- records `CANCELLED` rather than `CLOSED`;
- never issues an `ACCEPT` decision.

In M1, cancellation uses the expected Workflow version and transactionally
marks any active `RUNNING` Attempt `INTERRUPTED` while changing the Workflow to
`CANCELLED`. The same transaction synchronizes the public Goal lifecycle
projection to `CANCELLED`, appends audit evidence, and records the application
command outcome. A racing worker result cannot update either record after that
version advances. A terminal Workflow cannot accept another event even if a
caller bypasses command decision logic and supplies a fresh version number.

Runtime-owned event time is causal rather than raw wall-clock order. A valid
clock rollback is clamped to the current Workflow timestamp; reducers and
persistence reject an event that predates current state. Equal timestamps are
allowed because the Workflow version and audit sequence still establish exact
order. See [ADR 0012](adr/0012-causal-control-timestamps.md).

## Retry and Repair

Retries repeat an operation against the same valid inputs after a transient
failure. Repairs create a new candidate generation after a semantic or
implementation rejection. They are not interchangeable.

A retry creates a new child Attempt under the same Workflow aggregate. It does
not reopen or mutate the terminal Attempt it replaces.

Each automatic retry records:

- failure class;
- attempt number;
- maximum budget;
- backoff;
- whether external reality must be reconciled first.

In the current classification, `PROTOCOL_ERROR` is non-retryable and moves the
Workflow to `FAILED`. `ABRUPT_TERMINATION` requires reconciliation and moves it
to `BLOCKED`. A persistence or Runtime admission failure retains its own
control-plane category so recovery can inspect the still-running Attempt.
Worker payloads report only closed reasons. The Runtime maps each known reason
to exactly one class, and Store/SQLite reject a conflicting direct write.

## Crash Recovery

For a non-terminal workflow, startup recovery must:

1. load a consistent recovery catalog with current state and last committed
   audit sequence;
2. identify Attempts left `RUNNING` and recoverable closed failures;
3. treat any retained dispatch claim as consumed history rather than
   redispatch permission;
4. inspect current Candidate generation/digest and repository/base identity
   through the closed `RecoveryInspector` port;
5. choose the same phase, a safe earlier phase, or `BLOCKED` through explicit
   Runtime recovery policy;
6. atomically interrupt a retained active Attempt, advance the Workflow, leave
   it `BLOCKED`, and persist an exact immutable
   `RecoveryReconciliationRecord` plus audits; and
7. dispatch no replacement work during startup.

`ResumeGoal` then performs a fresh inspection against the current bound
Execution Profile. Its transaction records a new exact reconciliation and
either moves the Workflow to a permitted `READY` safe phase or retains a
concrete `BLOCKED` reason. A new Attempt may begin only after that transaction
commits. The old Attempt, Context, Worker Session, and dispatch claim are never
reused.

Current M1 recovery policy permits only an exact same-phase resume. The domain
models `SAFE_EARLIER_PHASE` so a later accepted policy can add a conservative
rewind without changing record shape, but the M1 Runtime never issues it and
the M1 Store rejects it. Startup reconciliation itself never makes a Workflow
`READY`, even when inspection finds an exact match.

The last model response is never the recovery algorithm.

Attempt lifecycle ownership and its single-version concurrency rule are defined
by [ADR 0007](adr/0007-workflow-owned-attempt-lifecycle.md). The public Goal
boundary and lifecycle projection are defined by
[ADR 0008](adr/0008-goal-command-and-lifecycle-boundary.md). Exact Runtime
application, recovery-record, and resume ownership are defined by
[ADR 0020](adr/0020-runtime-application-recovery-and-query-boundary.md); profile
binding is defined by
[ADR 0021](adr/0021-m1-execution-profile-and-cli-composition.md).

## M1 Required State-Machine Proof

M1 must include tests that prove:

- every documented legal transition succeeds when its guards are satisfied;
- representative direct jumps are rejected;
- a stale `expectedVersion` cannot mutate state;
- a worker Completion Request cannot enter `CLOSEOUT`;
- `FINAL_VERIFY -> CLOSEOUT` fails without current `ACCEPT`;
- a mismatched Acceptance Input Manifest fails;
- restart preserves phase and aggregate version;
- state and audit event commit or roll back together;
- cancellation cannot be rendered as success.
