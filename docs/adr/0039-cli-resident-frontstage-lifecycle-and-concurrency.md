# ADR 0039: Keep the M2.6 Frontstage resident in the CLI process

- Status: Accepted
- Date: 2026-08-06

## Context

The M2.5 CLI performs one explicit action and exits. M2.6 is intended to keep a
single conversational frontstage available while governed work is running so
the user can ask questions, inspect Goal status, or prepare another action.

This user experience can be confused with several larger architectural
changes: a detached daemon that survives CLI exit, a project-wide scheduler,
parallel Goal execution, multi-process leadership, or automatic background
continuation. None is required to prove one persistent local frontstage.

The existing Runtime already owns durable Workflow/external-execution state,
startup reconciliation, command concurrency, and cancellation semantics.
Adding a second lifecycle owner in the CLI would weaken those boundaries.

## Decision

### Scope lifetime to one foreground CLI process

The M2.6 frontstage remains available for the lifetime of one foreground CLI
process. Trusted startup composition resolves the local principal, exact
project, authority home, installed policies/profiles, Store activation, and
startup recovery before publishing the interaction loop.

The CLI process owns only loop and presentation lifecycle. Durable session,
operation, pending-action, Goal, Workflow, and external-execution state remains
in Runtime/Store authority.

M2.6 does not introduce a detached Runtime Host. Closing the CLI does not
promise that Goal execution continues and does not implicitly issue
`CancelGoal`.

### Allow bounded in-process concurrency without adding a scheduler

The initial process may have concurrently:

- one serialized Frontstage operation; and
- at most one session-owned execution-bearing task, which may traverse the
  existing M2.5 governed Intake path into one Goal execution.

An execution-bearing task is a governed Intake, `StartGoal`, or `ResumeGoal`
composition that may drive a Goal. A `MATERIALIZE_ONLY` Intake, read/query
operation, or cancellation action remains serialized Frontstage work and does
not occupy a second execution-bearing task.

The input loop remains responsive while the Goal task awaits Worker or
verification work. Runtime-owned progress and terminal results enter a bounded
notification queue and are rendered as projections.

This limit is local composition, not a project-wide invariant. M2.6 does not
reserve a global execution slot, prevent another process from issuing a legal
command, automatically select the next Goal, or create parallel Worker
scheduling. Existing Store freshness, command idempotency, dispatch claims, and
typed conflict outcomes decide races.

While that task is active, the same session continues ordinary answers and
read-only Goal/Intake queries and may separately confirm cancellation of the
active Goal. It may also submit an explicitly authorized `MATERIALIZE_ONLY`
Intake action because that path creates no Goal execution task. Another
`GOVERNED_EXECUTION`, `StartGoal`, or `ResumeGoal` is not authorized or retained
for delayed execution. The Frontstage may offer an exact `MATERIALIZE_ONLY`
Intake alternative requiring separate user confirmation, but cannot silently
rewrite the original action or automatically Start it after the local task
ends.

The exact busy dispositions are:

- another governed Intake request creates no governed Pending Action. The
  Frontstage may instead construct one
  `SUBMIT_MATERIALIZE_ONLY_INTAKE / SEPARATE_RESPONSE_REQUIRED` Pending Action
  over the same complete originating message bytes and must render that changed
  effect before confirmation;
- an explicit `MATERIALIZE_ONLY` request may construct that same separately
  gated action, but cannot receive direct authorization while the task is
  active;
- `StartGoal` or `ResumeGoal` returns `SESSION_EXECUTION_BUSY` without a
  Pending Action, Command ID, delayed reservation, or queue entry; and
- only cancellation of the exact Goal owned by the active session task may
  construct `CANCEL_GOAL / SEPARATE_RESPONSE_REQUIRED`. Cancellation of
  another Goal receives route clarification and no action authority.

The execution-bearing slot is released only when the launched governed Intake,
Start, or Resume composition promise settles and its last public command/drive
result has been projected. A notification, assistant statement, or apparent
backend completion cannot release it early.

### Start every foreground process with a new session

Trusted M2.6 startup always creates a new `InteractionSession` after strict
reconciliation; it never attaches the new process to an earlier `OPEN` or
`CLOSING` session. Previous message excerpts, Focus, and unresolved
non-authorized Pending Actions are not imported into the new session.

Reconciliation closes each structurally valid earlier non-terminal session for
the same trusted principal/project as `INTERRUPTED`, terminalizes its orphaned
Assistant operations without recall, and closes unresolved non-authorized
actions without invoking a capability. An authorized Action Reservation may
be reconciled only through its retained public Command ID and canonical input
under ADR 0036. Corrupt or ambiguous retained authority fails startup closed.

This rule deliberately avoids a resumable shared-session owner or control
lease. Simultaneous M2.6 frontstage processes are outside the bounded user
experience; if they race, Store uniqueness, freshness, and same-Command-ID
rules must still prevent duplicate authority, but M2.6 does not promise shared
conversation continuity. Direct one-shot CLI commands remain legal and use
their existing concurrency semantics.

### Preserve Runtime ownership during shutdown and restart

Graceful shutdown proceeds in this order:

1. stop accepting new user messages;
2. mark the Interaction Session `CLOSING` in an audited transaction;
3. interrupt and terminalize any active Frontstage Assistant operation under
   its own bounded failure contract;
4. ask the existing Runtime-owned Goal execution path to reach a bounded
   persisted interruption boundary without issuing `CancelGoal`;
5. flush only already-derived notifications; and
6. close the Store and process resources.

The exact graceful-shutdown deadline is `10_000` milliseconds from the
successful `OPEN -> CLOSING` session commit. The Workflow driver exposes one
narrow trusted lifecycle capability for this composition:
`interruptOwnedExecution`. It may signal only an active controller owned by
that same in-process driver instance and exact session task. It cannot allocate
a command, find or interrupt another Goal, mutate Workflow state, issue
`CancelGoal`, or claim that an Attempt is terminal. The existing Worker or
external-execution lifecycle records any observed interruption; the existing
Runtime drive and startup recovery remain the only owners of resulting
Workflow state.

If Assistant interruption and the session-owned execution promise settle at a
persisted Runtime boundary before the deadline, Runtime commits the Session as
`CLOSED`, flushes already-derived notifications, closes resources, and the CLI
returns exit `0`. If the deadline expires, the CLI returns exit `4`, leaves the
durable Session in `CLOSING`, performs no further authority write or implicit
cancellation, and exits without claiming graceful completion. The next startup
must reconcile that state before publishing a new Session. Failure to commit
the initial `CLOSING` transition or inability to trust retained authority is an
infrastructure exit `5`, not a successful or controlled interruption.

If the process exits before the bounded sequence completes, the next trusted
startup reconciles incomplete Interaction Operations and then invokes existing
Goal/Workflow/external-execution recovery before publishing the new session.
Recovery never reconstructs authority from display output or model transcript,
never redispatches a consumed claim, and never allocates a replacement command
because a notification is absent. An orphaned untrusted Frontstage Assistant
operation terminalizes without model recall. A retained authorized-action
reservation with an unknown result may re-enter only its named public
capability using the same preallocated Command ID and canonical input, so the
existing idempotent boundary resolves or completes one logical command without
duplicating authority.

An earlier session never becomes `OPEN` again. The new session may become
`OPEN` only after reconciliation proves every retained prerequisite legal.
Corrupt or ambiguous authority fails startup closed.

### Keep notification semantics derived and bounded

Notifications bind the exact Runtime command outcome or Goal status projection
that caused them. Queue overflow, rendering failure, or process exit may lose a
notification but cannot lose or change the underlying authoritative record.
The next status query reconstructs current visible state from Runtime authority.

## Consequences

- The user can converse and inspect state while one Goal launched in the same
  CLI process is running.
- M2.6 remains a local single-process milestone compatible with the current
  deployment model.
- CLI exit may interrupt active work and require normal startup recovery; it is
  not a detached-execution feature.
- Cross-process races remain possible and are handled by existing command and
  Store rules rather than a new scheduler.
- Proposed M2.7 separately defines a Runtime Host, control lease/epoch, and
  project-scoped single active Goal in
  [ADR 0040](0040-local-runtime-host-lifecycle-and-attachment.md),
  [ADR 0041](0041-project-control-lease-and-read-only-secondary-cli.md), and
  [ADR 0042](0042-project-scoped-single-active-goal-slot.md). Those proposals do
  not enlarge M2.6. Automatic multi-Goal scheduling remains later work.

## Rejected alternatives

- **Run the frontstage only as one-shot commands.** Rejected because it does not
  meet the continuously available CLI objective.
- **Add a daemon in M2.6.** Rejected because process supervision, attach/detach,
  leadership, upgrades, and crash ownership are a separate milestone.
- **Cancel the Goal whenever the CLI closes.** Rejected because process
  lifecycle is not user cancellation intent.
- **Promise that the Goal always continues after CLI exit.** Rejected without a
  detached owner that can actually make that guarantee.
- **Enforce one running Goal per project globally.** Rejected because the
  current Start boundary has no project-slot authority and such a rule would
  change all Start callers, migrations, and concurrency semantics.
- **Automatically run the next Goal.** Rejected because that is scheduling and
  requires explicit policy and execution authority.

## Validation

M2.6 tests must prove:

- the input loop remains usable while one launched Goal task is active;
- no second execution-bearing task is launched or retained for delayed execution
  by the same session, while an explicitly confirmed `MATERIALIZE_ONLY` Intake
  remains non-executing;
- another process is not falsely claimed to be excluded by the local limit;
- CLI close does not persist `CancelGoal` without an exact confirmed cancel
  action;
- graceful and abrupt shutdown both reopen through strict Interaction and
  existing Runtime recovery;
- an orphaned Frontstage Assistant operation never recalls the assistant
  automatically;
- unresolved authorized action recovery uses only its retained Command ID and
  produces no second command identity or duplicate authority effect;
- a consumed Worker dispatch is never replayed as work;
- notification loss does not alter Goal/Workflow authority and status recovers
  the same state; and
- the complete M1, M2, and M2.5 recovery and concurrency baseline remains
  green.
