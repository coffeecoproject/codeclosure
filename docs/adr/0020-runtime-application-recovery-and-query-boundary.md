# ADR 0020: Own orchestration, recovery, and queries in the Runtime application boundary

- Status: Accepted
- Date: 2026-07-28

## Context

Slices 0–6 prove the individual M1 authority mechanisms, but Slice 7 is the
first product integration boundary. The CLI must create Goals, start and resume
execution, reconcile process restarts, render status and audit history, and run
the controlled proof demos.

The pre-Slice-7 Runtime package root intentionally exposes only the narrow
`StartGoal` and `CancelGoal` mutations. Its internal kernel can begin Attempts,
advance phases, freeze Candidates, record Evidence, evaluate Acceptance, and
close or repair a Goal, but that kernel is not a public adapter capability.
SQLite also has useful creation and point-read primitives, but handing those
primitives to CLI handlers would let the interaction layer assemble control
semantics and would create another practical Workflow writer.

Recovery has a second integration gap. A prepared Worker Request is disposable
process memory, while a durable dispatch claim proves only that dispatch
authority was consumed. After restart, the old request cannot be redispatched.
The existing single-Attempt reconciliation primitive correctly blocks
replacement work, but M1 still needs a Runtime-owned scan, an exact persisted
reconciliation result, and a public `ResumeGoal` path.

Status has the same authority risk in read form. If a CLI handler independently
joins raw rows, chooses a blocker, or labels a Goal complete, the presentation
layer can silently acquire semantics that differ from Acceptance and closeout.

## Decision

### Public application facade

The Runtime package root MUST expose one narrow CodeClosure application facade
for public adapters. Its M1 product capabilities are:

- `CreateGoal`;
- `StartGoal`;
- `ResumeGoal`;
- `CancelGoal`;
- a Goal status query; and
- a Goal-owned audit query.

The exact TypeScript interface may separate mutation, query, and lifecycle
capabilities, but CLI handlers MUST receive only those narrow capabilities.
They MUST NOT receive or import the raw control Store, the internal Workflow
kernel, a repository transaction, or generic phase/Attempt mutation methods.

A named trusted composition module constructs the Store, Runtime, policy,
execution adapters, clocks, and identity providers. Before it publishes a
handler capability, it invokes the Runtime startup-recovery capability. Startup
recovery is a trusted lifecycle operation, not a public CLI alternative to
`ResumeGoal`.

`CreateGoal` belongs to the application boundary rather than the SQLite
adapter. The application coordinator validates the request, allocates
identities and time, and invokes the Goal Manager and Workflow Runtime's domain
creation rules for their respective initial Goal and `DISCOVERY`/`READY`
Workflow state. It then derives canonical command and audit input and asks a
narrow Store port to commit the compound result atomically. The coordinator
does not become another Goal or Workflow mutation owner, and the Store
revalidates and persists the authority without inventing Goal intent.

### Runtime-owned workflow driver

One Runtime workflow driver owns the deterministic M1 control loop after an
accepted `StartGoal` or `ResumeGoal`. It reloads authoritative state before
each decision and selects at most one next safe internal operation from the
current phase, run status, Candidate, Evidence, Acceptance, and policy records.
CLI and demo handlers do not sequence internal phase commands.

Each internal operation has its own Runtime-authored `CommandId`, freshness
check, transaction, audit records, and outcome. A public start or resume is not
one large database transaction. A process crash between steps leaves the last
committed boundary authoritative, and a later process re-enters the driver from
that boundary rather than reconstructing an in-memory plan.

The driver stops when it reaches `CLOSED`, `CANCELLED`, `WAITING_FOR_INPUT`,
`BLOCKED`, or `FAILED`, when a required user decision is absent, or when a
typed infrastructure failure prevents safe continuation. A process-level run
summary is a view over those records. It is not stored Acceptance or a second
completion decision.

Worker dispatch is one reusable Runtime-owned operation for both the first and
later Worker-backed Attempts. A replayed public command may cause the driver to
inspect current authority and continue from an already committed safe
boundary, but it MUST NOT redispatch an existing Attempt or consume a retained
dispatch claim as permission to repeat an external effect.

### Exact startup reconciliation and resume

The Store MUST provide a narrow, consistent recovery catalog that identifies:

- retained active `RUNNING` Attempts;
- non-terminal Workflow and Goal identity;
- the last committed audit sequence;
- the exact dispatch claim when one exists;
- current Candidate generation and digest authority when present; and
- the closed failure or suspension classification relevant to recovery.

The catalog is a read capability, not a mutation port. A separate
`RecoveryInspector` observes M1 project/Candidate reality through a closed,
strictly decoded contract. It cannot write Workflow state or declare success.

Every completed recovery inspection MUST produce an immutable, canonically
digested `RecoveryReconciliationRecord` that binds at least:

- Goal ID and revision;
- Workflow ID, phase, inspected version, and resulting version;
- the affected Attempt and dispatch claim when present;
- the last observed audit sequence;
- current Candidate generation, base identity, and digest when present;
- a closed disposition of safe same-phase resume, safe earlier-phase resume,
  or blocked;
- the exact safe resume phase when one exists;
- a closed reason code and observation references; and
- the Runtime-owned inspection time.

Startup reconciliation of a retained `RUNNING` Attempt atomically interrupts
that Attempt, advances the Workflow version, leaves the Workflow `BLOCKED`,
persists the reconciliation record and audits, and synchronizes the Goal
projection. Even a safe inspection does not dispatch replacement work during
bootstrap. This preserves an explicit operator-visible resume boundary.

`ResumeGoal` operates by `GoalId` and current Goal/Workflow expectations. A
replayed `CommandId` resolves its stored outcome before any new external
inspection. A newly admitted command performs a fresh recovery inspection for
the current recoverable blocker and atomically persists one new reconciliation
record with the resulting Workflow event, audits, Goal projection, and command
outcome:

- a safe disposition moves the Workflow to `READY` at the recorded same or
  earlier safe phase;
- an unsafe or unknown disposition keeps it `BLOCKED` with a concrete reason;
- `FAILED`, `CANCELLED`, `CLOSED`, non-recoverable blockers, and stale input
  fail closed.

Replacement work begins only in a later internal Attempt-start transaction
after the safe resume transaction commits. It always receives a fresh Attempt,
Context, Worker Session, and dispatch claim. The previous Attempt remains
terminal and the previous claim remains immutable history.

Recovery records and their audit/Workflow relationships MUST be strictly
decoded, digest-recomputed, and revalidated on reopen. Migration MUST NOT infer
a safe recovery decision for retained history. A retained Workflow without a
new-format safe record may remain blocked and acquire authority only through a
fresh Runtime inspection.

### Read-only status and audit views

The Runtime owns schema-versioned Goal status and Goal audit views. The Store
supplies consistent, narrow read projections; the Runtime strictly decodes
them and derives presentation fields through one closed policy.

The M1 status view includes the Goal revision, Workflow phase/version/run
status, active Attempt and Candidate references, latest current Acceptance
summary when present, dominant blocker, next safe action, and exact closeout
reference when present. `technicalCloseout` may be true only when current
Workflow, Goal, Candidate, Acceptance Decision, and immutable closeout authority
have the exact accepted binding. An `ACCEPT` row, command success, worker
completion, or path existence alone cannot set it.

The Goal audit query returns only events whose owning relationship to that Goal
is established by decoded Store authority, ordered by the global audit
sequence. The SQLite adapter may use joins or a dedicated read projection, but
CLI handlers do not issue SQL or assemble aggregate ownership themselves.

Dominant-blocker and next-action selection are view semantics. They explain
current authority and never mutate it, issue Acceptance, resume work, or grant
capabilities.

## Consequences

- Slice 7 integration has one control owner rather than a CLI-authored workflow
  script.
- A crash between internal operations is safe because every operation is a
  committed re-entry boundary.
- Restart never repeats a consumed dispatch authority.
- Resume has durable, exact external-reality evidence and cannot be inferred
  from a free-form suspension string.
- Human and JSON status share one Runtime-owned semantic view while remaining
  non-authoritative.
- The Store gains narrow creation, recovery, and query ports, but handlers
  still cannot mutate it directly.
- This ADR extends ADR 0007, ADR 0008, ADR 0014, and ADR 0015 without changing
  their Workflow, Goal, dispatch, or Worker authority owners.

## Rejected alternatives

- **Sequence internal commands in CLI handlers.** Rejected because the
  interaction layer would become a second Workflow decision owner.
- **Expose the internal kernel as the application facade.** Rejected because a
  caller could bypass Goal-level freshness, recovery, and acceptance routing.
- **Redispatch a retained Worker Request or dispatch claim.** Rejected because
  the claim proves authority was consumed, not whether the external effect ran.
- **Resume from `suspendedReason` text alone.** Rejected because free-form text
  cannot prove inspected external identity or a safe phase.
- **Let status query raw tables and infer completion.** Rejected because a view
  could diverge from the only Acceptance and closeout authorities.
- **Wrap the entire M1 run in one transaction.** Rejected because Worker and
  verification effects cross process boundaries and require durable recovery
  points rather than a long-lived database lock.

## Validation

M1 tests MUST prove that handlers have no Store/kernel capability, creation is
atomic, the driver can re-enter after every persisted boundary, retained
dispatch claims are never redispatched, startup reconciliation precedes
replacement work, recovery records fail closed under mismatch and reopen,
unsafe resume remains blocked, safe resume creates only a fresh Attempt, and
status/audit views cannot report technical closeout without exact closeout
authority.
