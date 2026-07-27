# ADR 0008: Goal command and lifecycle boundary

- Status: Accepted
- Date: 2026-07-27

## Context

CodeClosure exposes a Goal as the user's durable unit of intent, while the
Workflow Runtime owns the operational state machine that advances work. M1
stores both `Goal.status` and `WorkflowInstance.runStatus`. If both fields can
be changed independently, cancellation, blocking, and closeout can produce two
conflicting lifecycle truths.

The public command boundary also needs a stable product identity. Requiring a
user or CLI adapter to discover and operate an internal Workflow identifier
would leak orchestration structure and permit adapters to bypass Goal-level
validation.

Codex may expose a thread-scoped goal or execution plan. That backend state is
not the CodeClosure Goal and cannot authorize a CodeClosure transition.

## Decision

In M1, one Goal has exactly one Workflow Instance. Their responsibilities are
separate but their lifecycle persistence is coordinated.

- The Goal Manager owns Goal identity, objective, scope, success criteria, and
  revision.
- The Workflow Runtime is the sole writer of Workflow phase, run status,
  active Attempt, and terminal control state.
- `Goal.status` is a denormalized projection of the Workflow run status. It is
  updated in the same database transaction as the authoritative Workflow
  transition and MUST NOT be independently writable.
- The M1 projection is:

  | Workflow run status | Goal status |
  | --- | --- |
  | `READY`, `RUNNING` | `ACTIVE` |
  | `WAITING_FOR_INPUT` | `WAITING_FOR_INPUT` |
  | `BLOCKED`, `FAILED` | `BLOCKED` |
  | `CANCELLED` | `CANCELLED` |
  | `CLOSED` | `CLOSED` |

- Operational projection updates do not increment `Goal.revision`. That
  revision changes only when authoritative intent changes.
- Public `StartGoal` and `CancelGoal` commands identify a `GoalId`, the
  expected Goal revision, and the expected Workflow version. The application
  service resolves the owned Workflow and performs the guarded transaction.
- Goal command resolution MUST read the Goal and its Workflow from one
  consistent persistence snapshot. The subsequent write transaction
  revalidates the Workflow version before committing.
- `BeginAttempt`, result admission, interruption, recovery reconciliation, and
  phase-transition commands are internal control commands. CLI and worker
  adapters MUST NOT call them as an alternative public mutation surface.
- `StartGoal` starts only the first `DISCOVERY` Attempt. Subsequent Attempts are
  created by internal runtime policy, retry, resume, or recovery paths.
- Goal cancellation atomically changes the Workflow to `CANCELLED`, interrupts
  any active `RUNNING` Attempt, appends audit evidence, records the command
  outcome, and synchronizes the Goal projection.
- No Codex thread, turn, plan, or goal state may mutate or substitute for a
  CodeClosure Goal or Workflow record.

The Goal status remains useful for queries and user-facing views, but it does
not create a second transition authority.

## Consequences

- Users and public adapters operate the product concept they created rather
  than an internal Workflow identifier.
- Goal and Workflow lifecycle views cannot diverge after a committed command.
- Optimistic concurrency still uses the Workflow version for operational
  serialization and the Goal revision for intent freshness.
- Database constraints and transaction tests must reject a mismatched direct
  Goal-status update.
- A future milestone that permits multiple Workflows for one Goal must define a
  new projection policy and record it in a later ADR before removing the M1
  uniqueness constraint.

## Rejected alternatives

- **Give Goal and Workflow independent lifecycle writers.** Rejected because
  cancellation and closeout would require a distributed agreement between two
  authorities in one local runtime.
- **Remove Goal status entirely.** Rejected because Goal is the public query
  unit and needs a stable user-facing lifecycle view.
- **Expose Workflow commands directly to the CLI.** Rejected because it leaks
  an internal aggregate and bypasses Goal revision checks.
- **Map a Codex goal onto the CodeClosure Goal.** Rejected because backend
  session state is disposable and worker-controlled rather than authoritative.

## Validation

M1 tests must prove:

- `StartGoal` and `CancelGoal` operate by `GoalId` and reject stale Goal or
  Workflow expectations;
- cancellation commits Workflow, Attempt, Goal projection, audit, and command
  outcome atomically;
- direct mismatched Goal-status updates are rejected by persistence;
- reopening SQLite preserves a consistent Goal/Workflow lifecycle view;
- no public adapter can mutate an internal Workflow state directly.
