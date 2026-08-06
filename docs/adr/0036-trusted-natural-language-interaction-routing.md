# ADR 0036: Route natural language through trusted pending actions

- Status: Proposed
- Date: 2026-08-06

## Context

M2.5 accepts an explicit trusted interaction action before Goal Intake. It
correctly prevents an assistant from turning its own classification into
`GOVERNED_EXECUTION`, `MATERIALIZE_ONLY`, or `ANSWER_ONLY` authority. Its
explicit-action CLI is nevertheless not the intended steady-state user
experience: the user should be able to remain in one frontstage and reply in
natural language without choosing a command family or copying a Goal ID.

Natural-language routing cannot be implemented by treating a model's route
label, a nearby confirmation word, or conversation history as a trusted
command. State-changing operations need exact target, freshness, idempotency,
and replay bindings even when the UI is conversational.

Requiring a second user reply for every such operation is also unnecessary.
ADR 0027 already permits an explicit governed-execution command to authorize
later Materialization and ordinary Start when deterministic Admission and
start-policy requirements pass. M2.6 therefore needs to distinguish an exact
user message that directly authorizes a bounded action from an ambiguous,
destructive, conflicting, or separately gated request that needs another
confirmation. A model cannot own that distinction.

M2.5 also defines one complete user-authored Raw Request revision and exact
Question-bound clarification revisions. Concatenating arbitrary chat messages,
adding Runtime separators, or summarizing history would no longer be the exact
user-authored source required for `USER_STATED` provenance.

## Decision

### Separate proposal, route decision, and authorization

The proposed M2.6 frontstage first separates four routing and authorization
meanings:

1. `RouteProposal` is untrusted assistant output;
2. `RouteDecision` is a deterministic Interaction Routing Policy result over
   an exact session/message/focus view;
3. `PendingAction` is a Runtime-authored immutable exact proposal eligible for
   one unique public-action reservation; and
4. `PendingActionAuthorization` is a deterministic binding either to the
   originating message or to a later exact confirmation message.

An assistant may recommend a route or target. It cannot issue any of these
trusted records, select the M2.5 interaction action, or invoke the bound
capability.

Safe read-only routes and bounded ordinary answers may proceed without a
pending action. An exact answer to the sole active Intake
question may use the existing M2.5 clarification command because the persisted
Focus Binding identifies the question and the user message supplies the exact
answer bytes. Ambiguity, stale focus, or more than one possible target fails
closed and asks a natural-language clarification.

### Bind the closed governed-action set to pending actions

The initial Pending Action kinds are:

- submit a new `GOVERNED_EXECUTION` Intake request;
- submit a new `MATERIALIZE_ONLY` Intake request;
- `StartGoal`;
- `ResumeGoal`; and
- `CancelGoal`.

The Runtime constructs the exact public command input, preallocated public
Command ID, target identity, expected version, originating message
identity/content digest, current focus, principal, project, routing-policy and
confirmation-policy identities, expiry, and canonical input digest before
authorization. It persists the immutable Pending Action and audit atomically.
The record is never updated with authorization, consumption, or result state.

Interaction bookkeeping and an exact answer to the sole active M2.5 Intake
Question are not Pending Action kinds. The clarification already binds its
Question, version, exact answer bytes, command reservation, and Answer Binding
through accepted M2.5 authority. Adding a second pending-action gate would
reinterpret that completed contract.

### Decide direct authorization deterministically

The installed Interaction Confirmation Policy returns exactly one requirement:

- `DIRECT_USER_MESSAGE_SUFFICIENT`; or
- `SEPARATE_RESPONSE_REQUIRED`.

It may return `DIRECT_USER_MESSAGE_SUFFICIENT` only when all of the following
hold:

1. a trusted closed direct-action parser identifies explicit command language
   in the exact originating user message;
2. the principal, project, action kind, and any Goal target resolve uniquely
   from trusted current state;
3. the pending action binds the exact originating message, target/version,
   public capability, and canonical command input;
4. the action kind is one of `SUBMIT_GOVERNED_INTAKE`,
   `SUBMIT_MATERIALIZE_ONLY_INTAKE`, `START_GOAL`, or `RESUME_GOAL`;
5. no cancellation, replacement, destructive or difficult-to-recover effect,
   active session-owned execution-bearing task, or separate external-effect
   gateway is involved;
   and
6. no assistant proposal, confidence, summary, inference, or model-selected
   field is used as authorization evidence.

For a governed Intake request, direct authorization covers only submission of
the exact `GOVERNED_EXECUTION` action. It does not prove complete intent or
bypass M2.5 analysis, Projection, material-ambiguity handling, deterministic
Admission, atomic Materialization, or separate ordinary Start. Those later
owners may clarify, reject, materialize-only, fail, or decline Start
independently.

`CANCEL_GOAL`, replacement, destructive behavior, ambiguous target, policy
conflict, or an unrecognized imperative always returns
`SEPARATE_RESPONSE_REQUIRED` or asks route clarification. The confirmation
policy is deterministic for fixed canonical inputs and cannot call a model.

While the current CLI session owns one active execution-bearing task, another
`SUBMIT_GOVERNED_INTAKE`, `START_GOAL`, or `RESUME_GOAL` cannot be authorized
or retained for delayed execution. Read-only interaction and separately
confirmed cancellation remain available. An exact `MATERIALIZE_ONLY`
alternative may be proposed, but it requires explicit user authorization and
cannot be a silent rewrite of the original governed-execution action. This is
local composition state, not a project-wide Goal slot.

An execution-bearing task is only a governed Intake, `START_GOAL`, or
`RESUME_GOAL` composition that may drive a Goal. A `MATERIALIZE_ONLY` Intake,
read/query operation, or cancellation action remains serialized Frontstage
work and does not occupy a second execution-bearing task.

### Keep proposal, authorization, dispatch, and outcome immutable

A closed trusted confirmation parser returns only `CONFIRM`, `DECLINE`, or
`UNCLEAR` and may bind a response only when exactly one current Pending Action
exists. A generic approval, assistant interpretation, stale response, edited
command input, multiple candidates, or digest mismatch cannot authorize the
action.

One immutable `PendingActionResolution` closes the Pending Action. Authorized
variants form `PendingActionAuthorization` and record exactly one disposition:

- `DIRECT_USER_AUTHORIZED`, bound to the originating message; or
- `SEPARATE_RESPONSE_CONFIRMED`, bound to the originating message and the
  later confirmation message.

Decline, unclear, expiry, stale authority, or conflict is an immutable
non-authorization resolution and invokes no capability. Direct authorization
commits with the Pending Action; separate authorization commits later against
the unchanged exact Action digest.

One immutable `InteractionActionReservation` uniquely consumes an authorized
Pending Action before public invocation. It binds the Action and Authorization,
named existing public Runtime capability, preallocated Command ID, canonical
command input, and reservation time. One immutable
`InteractionActionOutcome` later binds that Reservation to the existing
Store-authored Intake or Goal command outcome. Existing command admission,
replay, Goal/Workflow version, Materialization, and Start boundaries remain
authoritative. A unique Reservation relationship, not a mutable consumed flag,
provides single-use semantics.

An unresolved authorized Reservation may re-enter the named public capability
after restart only with the same retained Command ID and canonical input.
Existing idempotent replay may return or complete that one logical command,
including ADR 0027's allowed resubmission of the same preallocated Start. It
cannot allocate another Action, Authorization, Command ID, Start authority, or
dispatch effect. Orphaned untrusted Frontstage Assistant work remains a
separate failure case and is never recalled automatically.

### Preserve exact M2.5 user provenance with a one-message handoff

An `InteractionMessageHandoff` binds exactly one current user-authored message
to one M2.5 submit or clarification command. The message's exact retained UTF-8
bytes become `admittedUserContent` without model paraphrase, normalization,
message concatenation, or Runtime-authored delimiter text.

Earlier Frontstage messages remain source-labelled non-authoritative context.
When the desired request depends on several unbound messages, the frontstage
asks the user to restate one complete request. Supporting composite
user-provenance later requires a separate ADR and compatible Domain/Store
extension; it cannot be simulated by a prompt summary.

### Keep ordinary conversation outside M2.5 Intake

A bounded ordinary frontstage answer is persisted as `FrontstageAnswer`, not as
an M2.5 `AnswerOnlyResponse`. It may be useful interaction output, but it is
not a Fact, Source Binding, Goal, Evidence, Human Decision, Acceptance Decision,
or authorization.

This avoids creating a synthetic Intake Run for every conversational turn and
does not change the existing `ANSWER_ONLY` contract for callers that explicitly
use M2.5.

## Consequences

- The supported user path can remain natural-language-only without assigning
  command authority to the model.
- Every closed Pending Action kind retains one exact proposal, authorization,
  reservation, and outcome chain, while a clear low-risk command need not
  produce a redundant second user turn.
- Exact target and digest binding make a short reply such as “确认” safe only
  inside one unambiguous separate-confirmation context.
- Direct authorization is intentionally narrower than general natural-language
  understanding and fails closed to clarification or separate confirmation.
- M2.5 Raw Request and clarification provenance remain unchanged.
- Arbitrary multi-message synthesis is intentionally unavailable in M2.6.
- Exact assistant replay returns the retained route result without another
  model call. Authorized action recovery may re-enter only the same idempotent
  public Command ID and cannot duplicate authority.

## Rejected alternatives

- **Let the assistant directly choose and execute a route.** Rejected because
  probabilistic output cannot author trusted interaction action or Runtime
  mutation.
- **Require the user to select a menu or slash command.** Rejected because it
  does not deliver the unified natural-language frontstage objective.
- **Treat every explicit-sounding sentence as immediate authorization.**
  Rejected because an unrestricted language or model classifier is not an exact
  command parser and can bind the wrong target or effect. Only the installed
  deterministic closed policy may issue the direct disposition.
- **Require a second confirmation for every mutation.** Rejected because an
  exact explicit low-risk user command can already supply authorization under
  ADR 0027, while the same Pending Action still preserves binding and replay.
- **Concatenate chat history into one Raw Request.** Rejected because
  Runtime-authored separators and model-selected omissions cannot become exact
  user-authored `USER_STATED` content.
- **Use a generic “approved” flag.** Rejected because approval must bind one
  exact target, input digest, version, action, and expiry.

## Validation

M2.6 tests must prove:

- forged or assistant-authored Route Decisions and Pending Actions are
  rejected;
- every closed Pending Action kind has one exact immutable Action, Resolution,
  and, when authorized, Reservation/Outcome chain;
- direct authorization passes only for the closed allowed action kinds and
  exact trusted parser/policy inputs, with no model field used as evidence;
- cancellation, replacement, destructive, conflicting, ambiguous, and
  separately gated actions cannot receive direct authorization;
- an active session-owned execution-bearing task blocks another governed Intake,
  Start, or Resume without creating delayed authority or a global Goal slot;
- a direct governed request still crosses M2.5 Projection, Admission,
  Materialization, and ordinary Start without shortcut;
- ambiguous, expired, stale, replayed, cross-session, cross-principal, and
  digest-substituted confirmation fails closed;
- assistant-operation replay invokes no second model call, while authorized
  action recovery may use only the same public Command ID and produces no
  duplicate authority effect;
- read-only routes cannot obtain a mutation capability;
- the one-message M2.5 handoff preserves exact bytes and digest;
- no Frontstage summary or prior message is persisted as `USER_STATED` Intake
  content; and
- M2.5 Intake, Materialization, Start, M1/M2 Workflow, and Acceptance
  regression gates remain green.
