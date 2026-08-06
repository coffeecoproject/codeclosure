# ADR 0042: Allow one started Goal per project without adding a scheduler

- Status: Proposed
- Date: 2026-08-06

## Context

M2.6 limits one CLI session to one launched Goal task, but this is local
composition rather than shared authority. Another CLI, a direct command, or a
concurrent process can still call `StartGoal` for another Goal in the same
project. If the first product phase intends one Goal to own project execution
until it closes or is cancelled, the invariant must exist in the shared
Runtime/Store Start boundary.

This requirement does not imply a queue. Multiple Goals may exist in `READY`,
and the user may choose one later. Automatically selecting or starting the next
Goal would require distinct ordering, authorization, revalidation, and recovery
policy.

## Decision

### Add one durable project execution slot

M2.7 will persist at most one `ProjectExecutionSlot` for each exact project.
The slot binds:

- project identity;
- owning Goal and Goal revision;
- owning Workflow and current Workflow version;
- acquiring `StartGoal` command and Store-authored applied outcome;
- slot schema/version and acquired causal time; and
- current occupied/released disposition plus exact release authority.

The slot is CodeClosure control authority outside project and Candidate roots.
It is not a filesystem lock, CLI flag, model decision, queue entry, Worker
lease, or scheduler token.

### Acquire in the first successful Start transaction

The ordinary first `StartGoal` Store transaction will atomically:

1. validate the Goal/Workflow/project and command freshness;
2. prove the project slot is free;
3. bind the existing immutable Workflow Policy and Execution Profile;
4. create the first Context/Attempt/dispatch authority required by the selected
   path;
5. create the exact project execution slot; and
6. author the applied command outcome and audits.

No intermediate state may expose a started Workflow without its slot or an
occupied slot without the exact started Workflow authority.

When another Goal owns the slot, `StartGoal` returns a closed typed
`PROJECT_EXECUTION_SLOT_OCCUPIED` rejection bound to the observed slot owner and
current target Workflow. It creates no Attempt, Context, dispatch, external
execution, or slot mutation. Exact replay returns the same rejection without
trying to acquire again. A later user attempt uses a new ordinary command.

### Retain across the complete non-terminal Goal lifetime

After first Start, the owning Goal retains the slot while its Workflow is
`READY`, `RUNNING`, `WAITING_FOR_INPUT`, `BLOCKED`, or `FAILED`. Those statuses
include phase boundaries, user waits, recoverable failures, restart
reconciliation, and explicit Resume preparation. `ResumeGoal` requires the
same exact slot owner and cannot reacquire or substitute a slot.

The Workflow/Goal transaction that reaches `CLOSED` or `CANCELLED` releases the
slot atomically. No CLI detach, Host/client crash, timeout, notification loss,
model result, Worker terminal event, or blocked state releases it. If the owner
cannot progress, the user may inspect or cancel it through existing public
authority before another Goal can start.

### Keep all other Goals ordinary and unscheduled

A non-owning Goal remains in its existing authoritative state, normally
`DISCOVERY / READY`. M2.7 adds no `QUEUED`, `WAITING_FOR_SLOT`, or mutable Goal
status. A public query may derive the read-only eligibility explanation
`PROJECT_EXECUTION_SLOT_OCCUPIED`.

When the owner closes or is cancelled, no other Goal changes state. The Runtime
does not rank, select, notify as “next”, or call `StartGoal`. The user must issue
a fresh explicit or deterministically directly authorized Start for one exact
current Goal.

### Apply the same guard to every creation path

Direct `CreateGoal` and M2.5 Materialization remain unchanged and do not acquire
a slot. Any later ordinary Start uses the shared guard.

For an M2.5 `GOVERNED_EXECUTION` request, Materialization may commit before its
preallocated ordinary Start encounters an occupied slot. The Start rejection
cannot roll back or relabel the Goal; the Goal remains visible and `READY`.
The Frontstage cannot silently turn the original action into
`MATERIALIZE_ONLY`, claim delayed automatic-start authority, or bypass the
shared guard.

## Consequences

- Exactly one started non-terminal Goal owns project execution across clients
  and processes.
- Ready Goals can accumulate, but none is a queue member and none starts
  automatically.
- A blocked or failed but recoverable owner continues to block other Goals until
  close or cancellation; this is intentionally conservative for the first
  product phase.
- Projects with different exact identities may execute independently.
- The shared Start transaction, command-result schema, Store ports, migrations,
  reopen validation, queries, and all Start callers require extension.

## Rejected alternatives

- **Enforce the limit only in one CLI session.** Rejected because another
  process can bypass it.
- **Use Workflow `WAITING_FOR_INPUT` for non-owning Goals.** Rejected because no
  user input or Workflow transition occurred and it would invent state.
- **Release the slot whenever no Attempt is running.** Rejected because phase
  boundaries and blocked/recoverable stops would permit another Goal to modify
  the same project before the owner terminates.
- **Automatically start the oldest ready Goal.** Rejected because that is a
  scheduler with new authorization and revalidation requirements.
- **Preflight only in the Frontstage.** Rejected because a race can occur after
  the read and direct Start callers remain unguarded.
- **Roll back Materialization when automatic Start loses the slot.** Rejected
  because M2.5 explicitly separates committed Goal creation from Start failure.

## Validation

M2.7 tests must prove:

- two concurrent first Starts for different Goals in one project produce one
  slot owner, one applied Start, and one typed occupied rejection;
- injected failure at every compound-write boundary leaves neither partial
  first-Start nor partial slot authority;
- an occupied loser creates no Attempt, Context, dispatch, process, or Worker
  call and exact replay performs no new acquisition;
- the owner retains the slot across every non-terminal run status, restart,
  recovery, and Resume;
- only exact `CLOSED` or `CANCELLED` authority releases the slot atomically;
- a ready non-owner retains its existing state before and after release and is
  never started automatically;
- different projects may each acquire one slot;
- migration/strict reopen reject duplicate, orphaned, mismatched, terminal-
  owner, and missing-required-slot authority without choosing a winner;
- direct CreateGoal and M2.5 Materialization remain unchanged while all Start
  paths share the guard; and
- complete M1, M2, M2.5, and M2.6 regressions remain green.
