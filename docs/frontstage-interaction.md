# CodeClosure Frontstage Interaction

## Status

This document defines the accepted planned M2.6 contract. ADR 0036 through ADR
0039 are accepted and the executable Slice 0 decision/proof contract passed its
bounded closure review on 2026-08-14. Slice 1's Interaction Domain, strict
codecs, lifecycle and relationship invariants, canonical digest projections,
and deterministic Runtime policy passed bounded review on 2026-08-14. Slice 2
SQLite work now implements policy installation plus atomic Session
create/lifecycle and user-message admission with typed replay/conflict and
strict reopen for that subset. It also implements serialized Operation
reservation, failure/interruption closure, and unresolved-reservation
detection, plus exact Focus/Session CAS with one Focus write owner, typed
replay/conflict/busy, atomic audit, SQLite backstops, and strict reopen.
The pre-B1 retained Context Manifest and discriminated Intake Handoff Domain
contracts passed bounded P0 review on 2026-08-15. Successful Operation results
and the remaining Slice 2 transactions, Assistant Adapter, routing composition,
Goal query/control, and CLI work remain later. The M2.5.1 milestone prerequisite
has passed, and the completed M2.5 Goal Intake boundary remains unchanged.

## Purpose

M2.6 is intended to let a local user stay inside one continuously available
CLI frontstage and use natural language for ordinary discussion, Goal Intake,
Goal discovery, status, and control. The frontstage may help interpret a
message, but CodeClosure still owns every trusted route, exact action binding,
state transition, and persisted result.

The intended user contract is:

```text
start CodeClosure for one principal and project
  -> frontstage remains available while that CLI process is alive
  -> user writes natural language only
  -> safe conversation and read views return directly
  -> an exact Intake clarification continues directly when unambiguous
  -> every supported new-Intake or Goal-control action becomes one exact
     PendingAction
  -> deterministic policy either binds the originating message as direct
     authorization or asks for a separate natural-language confirmation
  -> CodeClosure invokes one existing public Runtime action
  -> progress and terminal results return through the same frontstage
```

Natural-language-only input does not mean model-owned authorization. It means
the CLI does not require the user to select a routing menu, copy an internal
identifier, or switch to a slash-command surface for the supported path.

## Governing authority

This planned contract is subordinate to:

1. [`RUNTIME_INVARIANTS.md`](../RUNTIME_INVARIANTS.md);
2. accepted ADRs, especially the public Runtime boundary in
   [ADR 0020](adr/0020-runtime-application-recovery-and-query-boundary.md),
   trusted CLI composition in
   [ADR 0021](adr/0021-m1-execution-profile-and-cli-composition.md), Goal Intake
   in
   [ADR 0027](adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md),
   pre-Goal replay in
   [ADR 0034](adr/0034-close-pre-goal-command-replay-and-sqlite-activation.md),
   and the Intake assistant effect boundary in
   [ADR 0035](adr/0035-bound-intake-by-non-authoritative-effects.md);
3. [`PRODUCT.md`](../PRODUCT.md) and [`ARCHITECTURE.md`](../ARCHITECTURE.md);
4. [Goal Intake](goal-intake.md), [Domain Model](domain-model.md), and
   [Workflow](workflow.md); and
5. the [M2.6 milestone boundary](milestones.md#m26--unified-frontstage-interaction-and-control).

The detailed durable decisions are accepted in
[ADR 0036](adr/0036-trusted-natural-language-interaction-routing.md),
[ADR 0037](adr/0037-frontstage-assistant-effect-and-context-boundary.md),
[ADR 0038](adr/0038-goal-summary-focus-and-control-boundary.md), and
[ADR 0039](adr/0039-cli-resident-frontstage-lifecycle-and-concurrency.md).

## Authority boundary

The Frontstage owns interaction continuity and presentation. It does not own
Goal meaning, Workflow state, Intake Admission, technical Acceptance, or
external effects.

| Concern | Proposed owner | Explicitly not authorized by |
| --- | --- | --- |
| Session and message identity | Frontstage Runtime | model transcript or UI rendering |
| Route proposal | Frontstage Assistant | itself |
| Trusted route decision | deterministic Interaction Routing Policy | assistant classification |
| Exact governed-action intent | Runtime-authored `PendingAction` plus deterministic authorization disposition | assistant classification, generic approval, or nearby text |
| Goal Intake | existing M2.5 public Intake facade | Frontstage Assistant |
| Goal list and status | public Runtime query facade | raw Store access or model memory |
| Goal mutation | existing public Goal command facade | UI, assistant, or query projection |
| Workflow mutation | existing Workflow Runtime | Frontstage or CLI loop |
| Technical completion | existing Acceptance Engine | answer, transcript, or notification |

The Frontstage Assistant receives no Store, Goal mutation, Workflow kernel,
WorkerPort, Candidate write, Evidence, Acceptance, shell, project-read,
network, or external-effect capability. Its output is strictly decoded
untrusted input.

## Proposed domain records

### `InteractionSession`

An `InteractionSession` binds one local principal, one exact project identity,
one interaction-policy identity, retention policy, lifecycle, current focus,
and monotonically increasing version. It is durable so restart does not require
reconstructing trusted interaction state from a transcript.

The initial lifecycle is closed:

- `OPEN` — accepts one new user message at a time;
- `CLOSING` — accepts no new message while bounded shutdown completes;
- `CLOSED` — immutable normal terminal session; and
- `INTERRUPTED` — immutable terminal session closed by startup reconciliation.

A CLI launch MUST reconcile retained non-terminal sessions and then create one
new `OPEN` session for the trusted principal/project. It MUST NOT attach to an
earlier session or import its messages or Focus. Authorized public work may
recover only through its retained same-Command-ID boundary under ADR 0039;
assistant work is never recalled.

### `InteractionMessage`

Each message is immutable and includes:

- message and session identity;
- principal and role, limited initially to `USER`, `FRONTSTAGE`, and `SYSTEM`;
- exact admitted UTF-8 content or a typed non-retained disposition;
- exact content digest and retention classification;
- creation causal time; and
- the operation or result that produced it when not user-authored.

Display redaction is a projection. A redacted or unavailable message cannot
become `USER_STATED` Intake authority.

### `InteractionOperation`

One operation binds one current user message, expected session version,
operation kind, context package and manifest, assistant profile when used,
route proposal when produced, route decision, outcome, and causal time.

The initial operation kinds are:

- `ROUTE`;
- `FRONTSTAGE_ANSWER`;
- `GOAL_LIST`;
- `GOAL_STATUS`;
- `INTAKE_HANDOFF`;
- `INTAKE_CLARIFICATION`;
- `ACTION_PROPOSAL`;
- `ACTION_CONFIRMATION`; and
- `RESULT_PROJECTION`.

External assistant work MUST be reserved before invocation. The owning result
transaction authors the operation outcome, audit, and resulting message or
pending action atomically. Exact replay MUST NOT invoke the assistant again.
Recovery of an already authorized public action may re-enter only its named
public capability with the same preallocated Command ID and canonical input;
the existing public command boundary must then return or complete its one
idempotent authority effect.

### `RouteProposal` and `RouteDecision`

A `RouteProposal` may identify a candidate route, candidate focus, bounded
answer text, and ambiguity. It cannot select a trusted interaction action or
invoke a capability.

The deterministic Interaction Routing Policy issues a `RouteDecision` over an
exact message, session/focus version, allowed routes, assistant-profile
identity when used, and policy identity. Its closed initial outcomes are:

- `ANSWER`;
- `LIST_GOALS`;
- `SHOW_GOAL`;
- `CONTINUE_EXACT_INTAKE_QUESTION`;
- `PROPOSE_INTAKE_ACTION`;
- `PROPOSE_GOAL_CONTROL`;
- `ASK_ROUTE_CLARIFICATION`; and
- `NO_ACTION`.

`PendingAction` applies only to the closed new-Intake and Goal-control action
kinds below. `ANSWER`, `LIST_GOALS`, `SHOW_GOAL`, interaction bookkeeping, and
an exact currently focused Intake question continuation proceed without one.
The clarification path already uses the accepted M2.5 Question, version,
Answer Binding, and pre-Goal command reservation/outcome authority; wrapping it
in another pending action would create a competing authorization layer. A route
that could submit a new Intake request or start, resume, or cancel a Goal MUST
become a `PendingAction` first. Whether that action needs another user turn is a
separate deterministic authorization decision.

### `FocusBinding`

Focus is an explicit, versioned convenience binding, not hidden model memory.
It may bind exactly one of:

- no current target;
- one Intake Run and its exact active question/version; or
- one Goal and its observed Goal/Workflow version.

Focus cannot prove that a stale target is current. Every later query or command
must resolve the target again through the public Runtime facade. Ambiguous
references such as “那个任务” produce clarification rather than selecting a
nearby Goal.

### `PendingAction`

A `PendingAction` is a Runtime-authored exact proposal for one state-changing
public action. It binds:

- session, principal, project, originating message, and current focus;
- one closed action kind;
- one exact structured action derivation;
- exact target identity and expected version when applicable;
- one preallocated public Command ID;
- exact canonical command input digest;
- the public Runtime capability that may be invoked;
- expiration;
- the interaction-routing and confirmation-policy identities;
- one confirmation requirement and reason trace.

The record is immutable. It is never updated with later authorization,
consumption, or command-result state.

The deterministic Interaction Confirmation Policy is the sole owner of the
structured action derivation. A `PendingAction` MUST retain either
`ROUTED_ACTION`, which preserves the exact `RouteDecision` action kind, or the
single closed `BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE`, which may derive
only a separately confirmed `SUBMIT_MATERIALIZE_ONLY_INTAKE` action from a
busy-session `SUBMIT_GOVERNED_INTAKE` decision. The Domain validates this
closed matrix. Reason-trace text is diagnostic metadata and MUST NOT be parsed
as a competing derivation authority.

The initial kinds are:

- `SUBMIT_GOVERNED_INTAKE`;
- `SUBMIT_MATERIALIZE_ONLY_INTAKE`;
- `START_GOAL`;
- `RESUME_GOAL`; and
- `CANCEL_GOAL`.

The closed confirmation requirements are:

- `DIRECT_USER_MESSAGE_SUFFICIENT` — the exact originating user message itself
  supplies authorization under deterministic policy; and
- `SEPARATE_RESPONSE_REQUIRED` — another exact user message must confirm or
  decline the pending action.

The policy may select `DIRECT_USER_MESSAGE_SUFFICIENT` only when a trusted
closed direct-action parser finds explicit command language in the exact user
message, the principal/project and any Goal target are uniquely resolved from
trusted state, the action kind is permitted for direct authorization, and no
destructive, replacement, cancellation, active session-owned
execution-bearing task, or separately gated effect is involved. Model
interpretation, confidence, summary, or a
`RouteProposal` field cannot satisfy any of those conditions.

The initial directly authorizable kinds are
`SUBMIT_GOVERNED_INTAKE`, `SUBMIT_MATERIALIZE_ONLY_INTAKE`, `START_GOAL`, and
`RESUME_GOAL`. A direct governed-Intake authorization permits only submission
of the exact M2.5 action. M2.5 Projection, deterministic Admission,
Materialization, and the separate ordinary Start remain mandatory and may
clarify, reject, materialize-only, or fail independently. `CANCEL_GOAL` and any
replacement or destructive operation require a separate response.

### Authorization, reservation, and outcome

One separate immutable `PendingActionResolution` closes a pending action. Its
authorized variants form `PendingActionAuthorization` and record exactly one
of:

- `DIRECT_USER_AUTHORIZED`, bound to the originating message; or
- `SEPARATE_RESPONSE_CONFIRMED`, bound to the originating and later
  confirmation messages.

Decline, expiry, stale authority, and conflict are terminal non-authorization
variants and invoke no public capability. For direct authorization, the
Pending Action and its Authorization commit in one transaction. A later
confirmation commits only against the sole exact current Pending Action and
its unchanged digest.

One immutable `InteractionActionReservation` uniquely consumes an authorized
Pending Action. It binds the Action and Authorization identities/digests, named
public capability, preallocated public Command ID, canonical command input
digest, and reservation time before the capability is invoked. One immutable
`InteractionActionOutcome` later binds that Reservation to the existing public
Intake or Goal command outcome and safe result projection. Single use is
derived from the unique Reservation relationship; no mutable consumed flag is
an authority source.

For `SEPARATE_RESPONSE_REQUIRED`, confirmation is not a generic approval. A
trusted closed confirmation parser binds the user's natural-language response
to the sole current pending action and its exact digest. `CONFIRM`, `DECLINE`,
and `UNCLEAR` are the only initial parser outcomes. No pending action, multiple
candidates, stale focus, expiry, or a digest mismatch fails closed without
invoking the public action.

Every authorized action crosses the same Reservation and public command/replay
boundary regardless of authorization disposition.

### `InteractionMessageHandoff`

The M2.5 Raw Request contract is not reinterpreted as a chat transcript. One
handoff binds exactly one current user-authored `InteractionMessage`, its exact
content bytes and digest, principal, project, trusted authorized action, and
resulting M2.5 command identity.

The exact message bytes become the M2.5 `admittedUserContent` without
paraphrase, summary, concatenation, or Runtime-authored separators. Earlier
messages may appear only as source-labelled non-authoritative Frontstage
context. If the request depends on several unbound messages, the Frontstage
must ask the user to restate one complete request or a later ADR must add an
explicit composite-provenance contract. M2.6 MUST NOT silently synthesize a
new `USER_STATED` Raw Request.

An exact focused clarification answer similarly hands one user message to the
existing M2.5 clarification command and preserves its Question-to-Raw-Request
Answer Binding. It does not create a parallel answer-chain model.

### `FrontstageAnswer`

A `FrontstageAnswer` is bounded interaction output with exact operation,
message, profile, response-contract, retention, and disposition bindings. It
is not a Fact, Source Binding, Goal, Criterion, Evidence, Human Decision,
Acceptance Decision, or authorization.

Its Domain chain MUST bind the exact originating Session and retained user
message, the completed `ROUTE` Operation that produced the accepted Answer
Proposal and Route Decision, the Session-owned retention profile, and the
completed `FRONTSTAGE_ANSWER` Operation that recorded the Answer. Those records
MUST preserve causal order from Session/message through routing and Answer
recording; neither operation nor retention identity may be inferred from
displayed transcript text.

Ordinary Frontstage answers are separate from M2.5 `AnswerOnlyResponse`
authority. They avoid manufacturing a synthetic M2.5 Intake Run merely to hold
casual conversation.

## Frontstage context and assistant boundary

Trusted handling runs before model assistance. The initial order is:

1. bind an exact confirmation or decline to the sole current Pending Action;
2. bind an exact answer to the sole focused M2.5 Intake Question;
3. parse a closed direct-action command;
4. parse a closed read-only Goal query; and
5. only when no trusted parser decides the route, reserve one Frontstage
   Assistant operation.

That operation returns one closed `FrontstageProposalResponse` union with an
`ANSWER_PROPOSAL`, `ROUTE_PROPOSAL`, `CLARIFICATION_PROPOSAL`, or
`NO_ACTION_PROPOSAL` variant. An answer variant may carry bounded answer text;
an action variant remains only a candidate route. There is at most one
Frontstage Assistant call for one user message. The deterministic Routing
Policy validates the proposal and either persists a non-authoritative
`FrontstageAnswer`, asks clarification, or constructs an exact Pending Action.

The Runtime compiles one fresh `FrontstageContextPackage` and durable
`FrontstageContextManifest` for each assistant operation. The closed M2.6
source set may include:

- the exact current user message;
- a bounded ordered excerpt of retained session messages, labelled
  non-authoritative;
- current Focus Binding;
- bounded Runtime-owned Goal summary projections;
- the exact active Intake question projection when focused; and
- routing, response, retention, and assistant-profile identities.

The context MUST exclude raw Store handles, Worker Context, Candidate paths,
project contents, hidden reasoning, credentials, ambient instructions, and
unbounded transcripts. Omission records and byte budgets are part of the
Manifest. A fresh isolated assistant operation is used for each call; M2.6
does not require persistent Codex Thread continuity or compaction.

Observed tool use fails the complete operation and returns no answer or route
authority. Project-specific inspection is not silently performed by the
Frontstage Assistant. The user may instead authorize governed Goal Intake, or
a later milestone may add an exact read-only project-observation port.

## Public Goal query and control surface

M2.6 plans a narrow `listGoalSummaries` application query. Trusted
composition binds the fixed local principal to one verified authority home;
the caller cannot select another principal. Within that authority home the
query filters by one exact normalized project path. It returns a versioned
filtered projection with stable ordering, pagination, and no raw Store record
or mutation capability. M2.6 does not add a principal field to existing Goal
authority; multi-principal Goal ownership remains later work.

The summary includes only enough Runtime-owned state to select and explain a
Goal, including:

- Goal identity and bounded objective label;
- Goal and Workflow versions;
- lifecycle, phase, and run status;
- current Attempt/Candidate summary when present;
- dominant blocker and next safe action;
- technical Acceptance/closeout summary when present; and
- last authoritative change time.

The query includes Goals created through direct `CreateGoal` as well as M2.5
Materialization. Session memory is never the Goal catalog. Startup may show a
bounded active summary; a natural-language request to list all Goals uses the
paginated query.

Status, audit, and command execution continue through existing public Runtime
facades. The Frontstage cannot issue internal Workflow commands, choose a safe
resume phase, infer completion, or bypass command freshness and replay rules.

## CLI lifetime and concurrency

The M2.6 process model remains one local CLI process for one principal. While
that process is alive:

- the input loop remains available except during one short serialized
  frontstage operation;
- at most one Frontstage Assistant operation is active;
- at most one execution-bearing task launched by this CLI session is active;
  it may begin with governed Intake or direct Start/Resume and then drive one
  Goal;
- Goal progress/result notices are queued and rendered without becoming
  authority.

This is not a project-wide scheduler. Another process, another session, or a
direct command remains governed by existing Runtime/Store concurrency and may
win or conflict normally. M2.6 does not add a global “one running Goal per
project” invariant.

The local limit is enforced before an action is authorized. While this
session owns an active execution-bearing task:

- ordinary answers and read-only Goal/Intake queries remain available;
- exact cancellation of the active Goal may proceed through its required
  separate confirmation;
- an explicitly requested `MATERIALIZE_ONLY` Intake may proceed only after its
  separate confirmation because it creates no Goal execution task; and
- another `GOVERNED_EXECUTION`, `START_GOAL`, or `RESUME_GOAL` is not retained
  as delayed authority and cannot launch a second task.

Here, an execution-bearing task means a governed Intake, `START_GOAL`, or
`RESUME_GOAL` composition that may drive a Goal. A `MATERIALIZE_ONLY` Intake,
read/query operation, or cancellation action is serialized Frontstage work,
not a second execution-bearing task.

For another governed-work request, the Frontstage may offer one exact
`MATERIALIZE_ONLY` Intake alternative requiring a separate user confirmation.
Only that confirmed alternative may submit the original exact request bytes.
The Frontstage cannot silently rewrite the original action or automatically
Start it when the local task later finishes.

Closing the CLI does not mean `CancelGoal`. Graceful shutdown stops new input,
closes or interrupts the current Frontstage operation, asks the existing
Runtime-owned execution path to reach a bounded persisted interruption point,
and closes the Store. If the process exits before that completes, the next
startup uses existing persisted lifecycle and recovery authority. M2.6 does
not promise detached Goal execution after CLI exit.

## Failure and recovery

The initial closed failure families are:

- message validation or retention rejection;
- stale session/focus/pending action;
- ambiguous route or target;
- assistant protocol/process/timeout/tool-observation failure;
- public Runtime query failure;
- public Intake/Goal command conflict or rejection;
- result-projection failure; and
- interrupted operation requiring startup reconciliation.

An assistant failure cannot be reclassified as a deterministic route or Goal
failure. A command rejection remains the existing Runtime-owned typed outcome.
Startup must reconcile incomplete Frontstage operations before publishing the
session. An orphaned Frontstage Assistant reservation terminalizes without
model recall, following the completed M2.5 external-operation pattern. An
authorized `InteractionActionReservation` with an unknown result instead
re-enters only the same public capability with its retained Command ID and
canonical input. That exact replay may resolve an existing result or complete
the one already-authorized effect under current M2.5/Goal replay rules; it may
not allocate a replacement command, authorization, Intake, Start, or dispatch
identity.

## Explicit non-scope

M2.6 does not include:

- a rich TUI, graphical client, or menu-driven workflow;
- a detached daemon or Runtime Host that continues after CLI exit;
- automatic multi-Goal scheduling or parallel Goal workers;
- a project-wide execution-slot invariant;
- multi-user, team, remote-runner, or cloud behavior;
- full Fact Graph traversal or broad project-assisted Intake;
- model-authored Goal revisions or execution-time Goal revision;
- long-lived assistant Thread reuse, Compact policy, or transcript authority;
- unrestricted tools, shell, project mutation, network, or external effects;
- automatic repair/retry policy changes;
- technical Acceptance changes; or
- merge, release, deployment, communication, purchase, or promotion authority.

Deferred capabilities belong directly to the named [M3, M4, and M5 milestone
scopes](milestones.md#m3--full-fact-graph-and-context-compiler), not to an
M2.6 side backlog.

The proposed [M2.7 Runtime Host contract](runtime-host.md) separately considers
detached local execution, reconnect, a control lease, read-only secondary CLI,
and one project-scoped active Goal. It does not enlarge M2.6 and is not binding
until its proposed ADRs are accepted.

## M2.5 compatibility rule

M2.5 is a completed bounded milestone and remains a regression baseline. M2.6
may call its public Intake facade and preserve exact user-message provenance,
but MUST NOT:

- reinterpret a Frontstage message, Route Proposal, answer, or focus as an
  admitted Raw Request, Source Binding, trusted action, or Goal;
- rewrite the accepted `RawRequestRevision` or Clarification Answer Binding
  semantics to resemble chat history;
- bypass deterministic Intent Admission or merge Materialization with Start;
- turn a Goal list/status projection into mutation authority; or
- modify historical M2.5 completion evidence to claim M2.6 behavior.

Repository status prose may record that M2.5 passed and may link this planned
frontstage integration. Such updates are historical closure and forward
composition notes, not a reverse semantic change to M2.5.
