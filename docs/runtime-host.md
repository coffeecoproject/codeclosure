# CodeClosure Local Runtime Host

## Status

This document defines the proposed M2.7 contract. M2.7 implementation has not
started, and proposed ADRs 0040 through 0042 are not binding until accepted.
The proposed M2.6 foreground CLI remains the prior milestone boundary; this
document does not enlarge M2.6 or rewrite completed M2.5 authority.

## Purpose

M2.7 is intended to move durable local execution ownership out of the visible
CLI process and into one deterministic local Runtime Host. A user may close and
later reopen the CLI without that act becoming `CancelGoal`. While the Host is
alive, it continues to own the existing Goal-bound execution and recovery
path. Reopened CLIs attach to the same authoritative state instead of opening a
second control runtime.

The bounded user path is:

```text
start CodeClosure CLI for one principal/project
  -> attach to or start the sole local Runtime Host for the authority home
  -> obtain the current project control lease or enter observer mode
  -> use the M2.6 natural-language frontstage through Host public facades
  -> start at most one Goal for that exact project
  -> close the CLI without cancelling the Goal
  -> Host continues the owned Goal while alive
  -> reopen CLI and reconnect to current Runtime-owned state
```

The Host is deterministic control infrastructure, not a second conversational
agent. Codex remains either a bounded Frontstage Assistant, Intake Assistant,
or Goal-bound Worker behind its existing ports.

## Governing authority

This proposal is subordinate to:

1. [`RUNTIME_INVARIANTS.md`](../RUNTIME_INVARIANTS.md);
2. accepted ADRs for Store/audit, command replay, public Runtime composition,
   verified SQLite activation, external-execution recovery, Goal Intake,
   Materialization, and Start;
3. [`PRODUCT.md`](../PRODUCT.md) and [`ARCHITECTURE.md`](../ARCHITECTURE.md);
4. [Frontstage Interaction](frontstage-interaction.md), [Goal
   Intake](goal-intake.md), [Domain Model](domain-model.md), and
   [Workflow](workflow.md); and
5. the [M2.7 milestone proposal](milestones.md#m27--local-runtime-host-and-single-goal-project-control).

The durable candidate decisions are proposed in
[ADR 0040](adr/0040-local-runtime-host-lifecycle-and-attachment.md),
[ADR 0041](adr/0041-project-control-lease-and-read-only-secondary-cli.md), and
[ADR 0042](adr/0042-project-scoped-single-active-goal-slot.md).

## Authority separation

| Concern | Proposed owner | Explicit non-owner |
| --- | --- | --- |
| Host process/epoch | trusted Host bootstrap and Store | CLI rendering or Codex |
| Interaction state | M2.6 Coordinator running inside Host | client transcript |
| Project control lease | Runtime Host | Goal, Worker, or observer CLI |
| Project execution slot | shared Runtime/Store Start boundary | Host scheduler, CLI, or assistant |
| Goal/Workflow mutation | existing public Runtime and Workflow Runtime | Host transport or frontstage |
| External execution | existing Runtime-owned execution records | CLI process |
| Technical completion | existing Acceptance Engine | Host health, result notice, or client state |

The Host may compose existing authority owners. It cannot replace their
decisions with process-liveness or lease state.

## `RuntimeHostRecord` and `HostEpoch`

One authority home has at most one active Runtime Host. Its durable identity
binds:

- `RuntimeHostId` and monotonically increasing `HostEpoch`;
- exact authority-home identity and Store schema fingerprint;
- executable/version/configuration identity;
- Runtime-issued launch nonce and exact process identity;
- local control endpoint identity;
- lifecycle and causal timestamps; and
- last clean-shutdown or failure disposition when present.

The initial lifecycle is closed:

- `STARTING`;
- `ACTIVE`;
- `DRAINING`;
- `STOPPED`; and
- `FAILED`.

Trusted bootstrap combines an OS-owned exclusive Host lock/endpoint with the
durable epoch. A contender cannot become active merely because a PID is absent
or a timeout elapsed. It must prove the previous exact process identity is no
longer the active owner, activate the Store through the existing verified
bootstrap, reconcile retained authority, and atomically publish a higher epoch.
Missing or ambiguous identity fails closed.

CLI clients never author a Host record or epoch. The supported M2.7 CLI
connects through one versioned local control transport and receives only public
interaction/query/command facades. It does not open a second raw Store or
receive the Workflow kernel.

## Host lifecycle and CLI attachment

Trusted CLI startup performs exactly one of:

- attach to the compatible active Host at the verified local endpoint;
- start a new Host when no retained/current owner exists; or
- fail closed on incompatible, ambiguous, corrupt, or unprovable ownership.

Before accepting a client, the Host must complete Store activation, migration,
strict reopen, M2.6 Interaction reconciliation, and existing Runtime recovery.
An endpoint accepting bytes is not proof that the Host is compatible or ready.

Normal CLI detach releases only that client's control lease and transport. It
does not stop the Host, cancel a Goal, interrupt a Worker, release the project
execution slot, or issue another Runtime command.

Host shutdown is a separate explicit operator action. A graceful Host shutdown
stops new control operations, drains clients, brings Frontstage Assistant work
to a bounded terminal result, uses existing Runtime interruption/recovery
semantics for active Goal work, persists Host disposition, and releases the
endpoint/lock. Killing or crashing the Host requires a later trusted bootstrap
and exact reconciliation; it is never reinterpreted as `CancelGoal` or
technical failure of the implementation itself.

## `ProjectControlLease`

For one exact principal/project pair, at most one attached CLI holds mutable
frontstage control. The durable lease binds:

- lease and client instance identity;
- principal, project, Runtime Host, and Host Epoch;
- monotonically increasing `ControlEpoch`;
- acquired, renewed, expiry, and release causal time;
- `CONTROL` mode; and
- the exact capability set published to that client.

Every M2.7 frontstage mutation binds the current lease and Control Epoch. A
stale client, old Host Epoch, expired/released lease, or mismatched
principal/project fails before Route Decision, Focus mutation, Pending Action
authorization, Intake submission, or Goal command.

A second CLI for the same principal/project receives `OBSERVER` mode while the
control lease is current. The bounded observer surface may list Goals and read
status, audit, and Runtime-owned result projections. It receives no
confirmation, Focus mutation, Pending Action, Intake submission, Goal mutation,
or assistant capability. Observer mode is not a second Interaction Session and
cannot indirectly produce a state-changing route.

Normal controller detach releases its lease. Abrupt detach leaves it until the
Host's bounded renewal/expiry policy closes it. A later controller obtains a
higher Control Epoch; messages from the former client then fail closed. M2.7
does not implement manual lease transfer or two simultaneous writable windows.

The control lease protects the interaction owner. It is not a Goal execution
slot, Worker lease, Candidate lease, Store leadership grant, or completion
authority.

## `ProjectExecutionSlot`

One exact project may have many formal Goals, but at most one Goal may hold the
project execution slot. The slot binds:

- exact project, Goal, Goal revision, Workflow, and current Workflow version;
- acquiring `StartGoal` command and Store-authored outcome;
- slot version, acquired causal time, and current disposition; and
- release authority when the Goal becomes `CLOSED` or `CANCELLED`.

The first successful `StartGoal` for a project acquires the free slot in the
same Store transaction that binds the Workflow Policy/Profile, first Context,
Attempt, and dispatch authority. A competing `StartGoal` observes
`PROJECT_EXECUTION_SLOT_OCCUPIED`; it creates no Attempt, Context, dispatch,
external execution, or slot change.

The owning Goal retains the slot while its Workflow is `READY`, `RUNNING`,
`WAITING_FOR_INPUT`, `BLOCKED`, or `FAILED`. That includes boundaries between
Attempts and recoverable stops. `ResumeGoal` may continue only the exact slot
owner. Closing or cancelling the Goal releases the slot atomically with the
owning terminal transaction. A crash, CLI detach, Host restart, notification
failure, or transient timeout cannot release it.

A Goal that has never acquired the slot remains an ordinary
`DISCOVERY / READY` Goal. Its status is not changed to a new `WAITING` state.
The public view may derive `startEligibility: PROJECT_EXECUTION_SLOT_OCCUPIED`
and identify the occupying Goal through a bounded summary. When the slot later
becomes free, that Goal remains `READY`; no queue, priority, handoff, automatic
selection, or automatic `StartGoal` occurs.

Different exact projects may each hold one slot. M2.7 does not define a global
machine-wide worker limit.

## M2.5 composition

M2.7 does not add an Intake interaction action or revise M2.5 authorization.
For a confirmed or directly authorized `GOVERNED_EXECUTION` request:

1. M2.5 performs its normal analysis, Projection, deterministic Admission, and
   atomic Materialization;
2. only the existing preallocated ordinary `StartGoal` crosses the shared Start
   boundary;
3. if the project slot is free, that Start may acquire it normally;
4. if another Goal owns the slot, Start returns the new typed occupied result
   and the materialized Goal remains visibly `DISCOVERY / READY`; and
5. a later Start requires a new ordinary user-authorized command after current
   status is reloaded.

The Frontstage may warn that a current slot is occupied, but it cannot silently
rewrite `GOVERNED_EXECUTION` as `MATERIALIZE_ONLY`, claim the Goal is queued, or
retain hidden automatic-start authority. A user who wants only a ready Goal may
explicitly authorize `MATERIALIZE_ONLY` through M2.6.

Direct `CreateGoal` remains available and creates no synthetic Intake record.
Its resulting Goal competes for the same slot only when a later `StartGoal` is
submitted.

## Failure and recovery

The initial M2.7 failure families are:

- incompatible or ambiguous Host identity;
- Host lock/endpoint acquisition failure;
- Store activation, migration, or strict-reopen failure;
- stale Host or Control Epoch;
- control lease conflict, expiry, or capability violation;
- local transport framing/authentication/size/timeout failure;
- project execution-slot occupied, corrupt, missing, or mismatched authority;
- Host crash during a Frontstage operation;
- Host crash during existing Goal-bound external execution; and
- graceful-drain deadline failure.

Only the owning Runtime/Store maps these failures. A transport disconnect is
not user cancellation, a Host crash is not Goal completion, and a slot conflict
is not a Workflow failure. Restart reuses existing external-execution process
identity and recovery rules: matching owned work may be reconciled only by its
current Runtime authority; missing or ambiguous identity stays blocked.

Migration and strict reopen must reject retained data that would imply two slot
owners for one project, a slot owned by an unstarted/terminal wrong Goal, a
non-terminal previously started Goal without its required slot, or a control
lease from another Host Epoch being accepted as current. Migration cannot
silently select a winner from ambiguous historical state.

## Explicit non-scope

M2.7 does not include:

- a waiting Goal queue, priority, fairness, or automatic next-Goal selection;
- automatic `StartGoal` when a slot becomes free;
- more than one active Goal per project or parallel Goal workers;
- automatic Goal merging or injection of new messages into an active Worker;
- execution-time Goal revision;
- manual control-lease transfer or two writable CLIs;
- multi-user/team authorization, remote clients, remote workers, or cloud
  deployment;
- automatic repair/retry policy changes;
- rich desktop notifications or complete Human Decision UX;
- technical Acceptance changes; or
- promotion, merge, release, deployment, or another external effect.

Automatic multi-Goal scheduling remains M5 work. Fact-backed conflict analysis
and execution-time Goal Revision remain M3 work. Broader dogfooding, retry,
privacy, and operator UX remain M4 work.

## Compatibility rule

M1, M2, M2.5, and proposed M2.6 remain regression boundaries. M2.7 may add the
Host transport, control lease, and shared Start guard, but MUST NOT:

- make Host, endpoint, CLI, lease, or slot state a Goal, Workflow, Evidence,
  Acceptance, or closeout decision;
- make project-slot acquisition a scheduler-selected Goal order;
- reinterpret M2.5 Start Authorization as delayed automatic-start authority;
- adopt or redispatch a consumed Worker claim after Host restart;
- let an observer CLI mutate Interaction or Runtime authority; or
- describe a live Host or successful transport request as product completion.
