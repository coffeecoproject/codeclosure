# ADR 0038: Expose scoped Goal summaries and exact focus through the Runtime

- Status: Proposed
- Date: 2026-08-06

## Context

The existing public application facade supports Goal creation, start, resume,
cancel, point status, and point audit by exact Goal identity. M2.6 must answer
natural-language questions such as “有哪些目标”, “现在做到哪里”, and “继续这个
目标” without requiring the user to know an internal ID.

The Frontstage cannot safely solve discovery by scanning the Store, remembering
only Goals created in its session, asking a model to invent a target, or
reusing status rendering as mutation authority. Goals may have been created by
direct `CreateGoal`, M2.5 Materialization, another process, or an earlier
session. Their current state belongs to Runtime/Store authority.

## Decision

### Add one narrow public Goal-summary query

M2.6 will add a read-only `listGoalSummaries` capability to the public Runtime
application facade. Trusted composition binds the fixed local principal to one
verified authority home; a caller cannot supply another principal. Within that
authority home the query filters by one exact normalized project path. The
query supports fixed filtering, stable ordering, and bounded pagination. It
returns schema-versioned `GoalSummaryView` records, not Store rows, domain
mutation objects, or control capabilities.

The completed local Goal model carries project scope but no per-Goal principal.
M2.6 does not add one. Principal isolation is provided by trusted local
composition and authority-home separation; multi-principal Goal ownership and
cross-principal search remain later work.

Each summary may expose only bounded Runtime-owned projections needed for
discovery and explanation:

- Goal identity and bounded objective label;
- Goal and Workflow versions;
- Goal lifecycle, Workflow phase, and run status;
- current Attempt and Candidate summary when present;
- dominant blocker and next safe action;
- current Acceptance/closeout summary when present; and
- last authoritative change time.

The query includes every visible Goal in scope regardless of creation path. It
must not derive membership from session messages or assistant history. Default
startup rendering may show a bounded active subset; a request for all Goals
uses pagination and cannot silently truncate while claiming completeness.

### Persist one exact Focus Binding as convenience state

An `InteractionSession` may bind no target, one Intake Run with its exact
active Question/version, or one Goal with the exact observed Goal/Workflow
version. Focus is Runtime-authored from a successful query, Intake result, or
explicitly disambiguated user selection.

A model may propose a target reference but cannot write focus. The Runtime
must resolve the proposal against current scoped query results. Zero or
multiple matches produce clarification. A successful focus update commits the
new binding, session version, and audit atomically.

Focus does not reserve the Goal, establish ownership, or prove freshness. Each
later status or state-changing operation reloads current authority through the
public application facade. A stale focus can be refreshed for a read; a
state-changing pending action must be rebuilt against the new exact version.

### Keep status, control, and result meanings separate

Goal list/status/audit are read-only projections. They may inform a
`PendingAction`, but they cannot invoke it or certify completion.

Start, resume, and cancel continue through their existing public Runtime
commands after ADR 0036's exact direct or separately confirmed authorization.
M2.6 adds no internal Workflow command, safe-phase selector, direct Store
mutation, Acceptance path, or completion heuristic. Existing command admission,
idempotency, Store-authored outcomes, version conflicts, recovery, and
Goal/Workflow synchronization remain unchanged.

A background result notice is a projection of the latest Runtime-owned command
outcome and current Goal status. It cannot replace either record and cannot
turn a successful worker/model turn into technical completion.

## Consequences

- The user can discover and refer to Goals naturally without copying IDs in the
  supported single-principal local flow.
- Directly created and Intake-materialized Goals appear in one catalog.
- The Frontstage receives no raw Store query or mutation capability.
- Focus improves conversational continuity but never weakens freshness checks.
- Global search, cross-project search, advanced filtering, and rich dashboards
  remain outside M2.6.

## Rejected alternatives

- **List only Goals created by the current session.** Rejected because session
  memory is incomplete and not Goal authority.
- **Give the CLI or assistant a Store handle.** Rejected because it bypasses
  the public Runtime query boundary and exposes authority representation.
- **Let the model choose the nearest Goal.** Rejected because ambiguity and
  stale state could target the wrong mutation.
- **Treat focus as a lock or execution owner.** Rejected because M2.6 does not
  introduce scheduling or cross-process ownership.
- **Infer completion from a result notification.** Rejected because only the
  Acceptance Engine and Workflow closeout path own technical completion.

## Validation

M2.6 tests must prove:

- authority-home/principal binding and exact project filtering cannot leak
  another authority home or project's Goals;
- direct and Intake-created Goals appear under the same scoped query;
- ordering and pagination are stable, bounded, and explicit about continuation;
- the public view contains no Store mutation capability or backend protocol
  type;
- zero/multiple/stale target resolution cannot update focus or invoke a
  command;
- focus and audit update atomically and survive strict reopen;
- a stale Goal version forces a new query/pending action rather than reusing an
  old confirmation;
- status and notices cannot issue Acceptance or closeout; and
- every existing Goal command, recovery, M1, M2, and M2.5 regression remains
  green.
