# ADR 0038: Expose scoped Goal summaries and exact focus through the Runtime

- Status: Accepted
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

The initial query contract is exact:

- `OPEN` and `ALL` are the only filters; `OPEN` is the default and includes
  Goal status `ACTIVE`, `WAITING_FOR_INPUT`, and `BLOCKED`, while `ALL` also
  includes `CANCELLED` and `CLOSED`;
- the default page size is `20`, the maximum page size is `50`, and any other
  requested size is rejected rather than clamped;
- records order by `lastAuthoritativeChangeAt` descending and then `GoalId`
  ascending; `lastAuthoritativeChangeAt` is exactly the later of the decoded
  Goal and Workflow `updatedAt` values, not a message, notification, model, or
  filesystem time;
- `objectiveLabel` is the longest exact UTF-8 prefix of the Goal objective no
  greater than `256` bytes and ending at a Unicode-scalar boundary, accompanied
  by `objectiveLabelTruncated`; it is a non-authoritative display projection
  and is neither normalized nor accepted back as Goal identity; and
- every page reports `hasMore` and an optional opaque next cursor. It never
  describes a partial page as the complete catalog.

The first page binds the latest Goal-owned audit sequence across all Goals for
the exact project as its catalog watermark. A next cursor binds the query-view
policy identity/digest, trusted authority-home/principal binding, exact project
path digest, filter, page size, watermark, and final ordering tuple from the
previous page under one Runtime-authored cursor digest. The Runtime recomputes
the current project watermark before serving another page. Any change, cursor
substitution, scope mismatch, unknown field, or digest mismatch returns a
typed `STALE_CURSOR` or invalid-input result and no rows; the caller restarts
from the first page. This gives stable unchanged-authority pagination without
persisting a second catalog snapshot or read-side authority.

The Store owns only the narrow project-filtered authority projection and Goal-
owned watermark read. Runtime strictly decodes it and reuses the existing
`GoalStatusView` explanation policy for blocker, next-action, Acceptance, and
closeout meaning. Neither the Store query nor the Frontstage independently
reimplements those semantics.

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

M2.6 updates Goal focus only from an exact Runtime result: an Intake
Materialization result, a successful public Goal command, a read resolved from
an already exact Goal focus, a scoped query with exactly one possible Goal, or
a separately confirmed Pending Action naming the rendered exact Goal. An
assistant-selected Goal reference alone and a truncated `objectiveLabel`
cannot update focus. When several Goals remain possible, the Frontstage asks
clarification or constructs a separately gated exact action; it does not add a
fuzzy or ordinal target resolver to the trusted path.

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
- exact `OPEN`/`ALL` membership, `20`/`50` page limits, ordering tie-break,
  objective-prefix truncation, cursor scope/digest binding, and stale-watermark
  rejection;
- the public view contains no Store mutation capability or backend protocol
  type;
- zero/multiple/stale target resolution cannot update focus or invoke a
  command;
- assistant-selected IDs and truncated labels cannot become focus, while each
  allowed exact Runtime result can create only its bound focus;
- focus and audit update atomically and survive strict reopen;
- a stale Goal version forces a new query/pending action rather than reusing an
  old confirmation;
- status and notices cannot issue Acceptance or closeout; and
- every existing Goal command, recovery, M1, M2, and M2.5 regression remains
  green.
