# CodeClosure Goal Intake

## Status

This document defines the accepted target contract for pre-Goal Intake under
[ADR 0027](adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md).
[ADR 0034](adr/0034-close-pre-goal-command-replay-and-sqlite-activation.md)
additionally closes pre-Goal command replay and retained Intake project-path
participation in verified SQLite activation.
[ADR 0035](adr/0035-bound-intake-by-non-authoritative-effects.md) defines the
Intake assistant's isolated read-only, no-authority-effect boundary without
claiming an empty model-visible App Server tool set.
M2 completed with its reusable App Server client seam preserved. M2.5 Slices 1
and 2 implement typed Intake records, strict
owning codecs, canonical projections and golden vectors, fixed Admission Policy
definitions, the capability-free Admission Engine contract, the
anti-self-admission Runtime invariant, and transactional SQLite Intake
authority through exact reopen. Slice 3 implements deterministic Intake and
Answer-only packages with durable Manifests plus one fresh isolated read-only
Adapter operation. The Adapter grants no CodeClosure authority capability,
discards an operation after observed tool use, and does not claim pre-selection
tool denial. Slice 4 implements Runtime-owned non-Answer submission,
clarification and abandonment coordination, exact source-bound Projection and
Question construction, deterministic Admission evaluation, atomic `CLARIFY`
and non-Answer `NO_EXECUTION`, and typed in-process status views. Slice 5
implements bounded Answer-only success/failure and exact replay, terminal
analysis failure, operation-kind-aware startup reconciliation, the exact local
retention classifier, non-retention of rejected payloads, and redacted
status/audit projections. The persistence layer includes the later compound
Goal/Workflow/Materialization/Start-Authorization write. Slice 6 implements the
trusted Runtime Materializer, atomic Goal/Workflow creation, optional Start
Authorization, post-commit submission of only its preallocated ordinary
`StartGoal`, all five Start dispositions, and composite in-process status. A
failed Start leaves the committed Goal visibly `READY`, while exact replay and
automatic/manual competition retain one first-Start winner. Slice 7 implements
the explicit-action Intake CLI, shared bounded status/audit views,
deterministic real-adapter fixtures, strict cross-process reopen path, and the
canonical fail-closed assessment runner. CLI handlers receive only the narrow
Intake command/read facade and cannot issue Admission, Goal, Workflow, Start,
Evidence, or Acceptance authority. The
[M2.5 implementation plan](plans/m2.5-goal-intake-materialization.md) and
[independent acceptance plan](plans/m2.5-acceptance-plan.md) translate this
contract into the completed bounded milestone. All implementation slices are
present. The first `accept:m2.5` attempt returned
`NOT_READY_FOR_INDEPENDENT_REVIEW` because its M2 stage applied the historical
Goal-Intake-absence row to current M2.5 source. The corrected assessment then
passed all nine stages and 71/71 mandatory rows with zero skip, and the
[M2.5 completion review](reviews/m2.5-completion-review.md) issued an
unconditional bounded `PASS` on 2026-08-06.

A later pinned-version real Answer-only test exposed a compatibility defect not
covered by that historical assessment. The current Observer rejects valid
disabled remote-control and rate-limit projections and an empty progressive
agent-message start, and the closed profile requests two deprecated Web Search
feature keys. The current ordinary Intake composition also selects the M1
FakeWorker Profile for governed Start. The
[M2.5.1 plan](plans/m2.5.1-real-intake-codex-composition-closure.md),
[acceptance plan](plans/m2.5.1-acceptance-plan.md), and
[diagnostic](reviews/m2.5-live-intake-compatibility-diagnostic.md) define the
versioned correction, Adapter-local typed protocol projection, and mandatory
real composition proof. The normalized events remain inside the Adapter and do
not change the accepted Intake authority contract or retroactively enlarge
M2.5 evidence. The existing M2 protected demonstration is not the target
composition because it uses external Codex only for `IMPLEMENT` and delegates
candidate-free `DISCOVERY`/`PLAN` to `FakeWorker`. The proposed formal Profile
uses real candidate-free Codex over exact Runtime-owned read-only selected-
source snapshots for those two phases, real Candidate-bound Codex for
`IMPLEMENT`, and no production fake fallback while retaining Candidate creation
at the governed `PLAN -> IMPLEMENT` boundary. The source checkout remains
unreadable to candidate-free Codex.
Accepted [ADR 0043](adr/0043-candidate-free-codex-project-read-authority.md)
now binds the narrow project-source Context authority before that phase
mapping is implemented.
Proposed M2.6 Frontstage handoff may begin only after that closure passes. It
uses exactly one current user message through the existing public Intake
facade; it does not concatenate chat, synthesize `USER_STATED` provenance, or
change this contract.
Proposed M2.7 adds no Intake action or delayed automatic Start. If another Goal
owns the project slot, Materialization may remain committed while the existing
ordinary Start returns a typed occupied result and leaves the new Goal `READY`.

Nothing in this document changes the implemented M1 `CreateGoal` command, the
existing Workflow phase machine, technical Acceptance, or post-closeout
Promotion authority.

## Purpose

Goal Intake lets a user begin with a natural-language request without requiring
the user to author CodeClosure's complete Goal schema or confirm a
model-authored Draft. CodeClosure may use an assistant to analyze the request,
but only its own source-binding and deterministic Admission policy can decide
whether current information is sufficient to create a formal Goal.

The contract separates these meanings:

```text
Raw Request Revision
= exact user-authored content admitted under retention policy plus the trusted interaction action

Intent Analysis Proposal
= an assistant's untrusted interpretation

Intent Projection Revision
= CodeClosure's source-bound structured interpretation, not yet a formal Goal

Intent Admission Decision
= CodeClosure's deterministic decision to materialize, clarify, or not execute

Answer-only Response
= a bounded assistant answer or typed delivery failure, never formal authority

Intake Failure Record
= a typed terminal processing failure for one Intake Run, never non-execution policy

Formal Goal
= the Goal Manager's durable execution intent authority
```

Non-authoritative does not mean valueless. Assistant proposals and conversation
state may improve analysis continuity, but they cannot replace the exact
CodeClosure records required for materialization, recovery, or audit.

## What Goal Intake Is Not

Goal Intake is not:

- the `DISCOVERY` Workflow phase;
- a coding Worker Attempt;
- a Codex Thread or conversation-history feature;
- an LLM judge of the user's true intent;
- permission for a model to invent business outcomes or acceptance meaning;
- a technical Acceptance decision;
- Candidate, Evidence, or project-change authority;
- merge, release, deployment, or another real-world Promotion; or
- an alternative Workflow or `StartGoal` mutation surface.

## Position in the Product

The target path is:

```text
User natural-language request
  -> Raw Request Revision
  -> trusted deterministic preflight
       |-- early NO_EXECUTION
       |     `-- ANSWER_ONLY also returns a bounded non-authoritative answer result
       `-- analysis required
             -> Intent Analysis Proposal
             -> validated Intent Projection Revision + Source Bindings
             -> Intent Admission Decision
                  |-- CLARIFY -> bounded Question -> bound Raw Request Revision
                  |              -> immutable Clarification Answer Binding
                  |-- NO_EXECUTION
                  |     `-- ANSWER_ONLY also returns a bounded non-authoritative answer result
                  `-- MATERIALIZE
                        -> Formal Goal revision 1 + DISCOVERY / READY Workflow
                        -> optional separately authorized ordinary StartGoal
```

Direct explicit `CreateGoal` remains available under its accepted M1 contract.
It enters the same Goal Manager and atomic Goal/Workflow creation primitive but
does not fabricate Intake history.

## Authority Boundary

The pre-Goal trust boundary is:

```text
Identified user action
  -> immutable Raw Request Revision

Codex or another assistant output
  -> untrusted Intent Analysis Proposal

Answer-only assistant output
  -> bounded non-authoritative AnswerOnlyResponse

Intake Coordinator validation
  -> immutable Intent Projection Revision + Runtime-owned Source Bindings

Intent Admission Engine
  -> deterministic MATERIALIZE / CLARIFY / NO_EXECUTION decision

Goal Manager validation + Runtime transaction
  -> Formal Goal and DISCOVERY / READY Workflow authority

Separate authorized StartGoal transaction
  -> Policy/Profile binding, first Attempt, Context, and dispatch authority
```

No earlier arrow authorizes a later record by itself. Every boundary validates
schema, identity, revision, digest, provenance, size, and current-state
preconditions before persistence.

## Actors and Ownership

### User

The user owns the real request, priorities, business meaning, declared project
or scope, and trusted interaction action. The user is not required to know
CodeClosure artifact types or write a complete Criterion before Intake begins.

Submitting an explicit command through a governed execution surface can
authorize CodeClosure to form and start a Goal when Admission policy finds the
meaning sufficiently exact. It does not authorize an external or irreversible
effect, and it does not convert an assistant interpretation into user-stated
content.

### Goal Intake Coordinator

The Coordinator implemented through Slice 6 owns `IntakeRun` sequencing and
validated creation of Intake records. The CLI slice completes the remaining
operational surface. It:

- persists Raw Request revisions outside model and project authority;
- constructs Intake Packages;
- invokes an Intake Assistant through a narrow port;
- validates untrusted assistant output;
- allocates Proposal, Projection, Question, clarification Answer Binding, and
  Decision identities;
- constructs Runtime-owned Source Bindings and ambiguity classifications;
- computes canonical digests;
- constructs immutable clarification Answer Bindings from exact admitted
  commands and Raw Request revisions;
- classifies and persists bounded Answer-only results and Intake failures;
- submits current admitted input to the trusted Runtime Materializer and, only
  after commit, submits the exact preallocated ordinary `StartGoal` command;
- persists records, status changes, and audit atomically; and
- exposes typed read views and next actions, including the exact current
  question ID, specification/record digests, and answer schema for verifying
  current clarification authority plus historical Question/Answer-Binding
  provenance; `intake clarify` still accepts no caller-restated question data
  beyond the ID.

It cannot issue an Admission Decision on its own, create or revise a formal
Goal, mutate Workflow state, issue technical Acceptance, write a Candidate, or
authorize Promotion.

### Goal Intake Assistant Adapter

The Slice 3 adapter translates an Intake-specific request to an assistant such
as Codex App Server. It exposes two distinct closed operations: Intent analysis
returns an `IntentAnalysisProposal`, while Answer-only handling returns bounded
answer content. It receives no Goal-bound WorkerPort request, Store mutation
port, Candidate capability, Acceptance capability, Goal Manager, Workflow
command, or user-action authority.

The adapter does not assign authoritative IDs, revisions, timestamps, digests,
Source Bindings, provenance classes, ambiguity status, or Admission outcomes.
Answer content remains untrusted and cannot become a Fact, Criterion, Evidence
record, or execution instruction merely because it is displayed or retained.

### Intent Admission Engine

The Slice 4 Engine evaluates one exact immutable admission input under one
versioned policy. It owns the semantic `MATERIALIZE`, `CLARIFY`, or
`NO_EXECUTION` decision and ordered reason trace.

It has no assistant-call, Goal-write, Workflow-write, Worker, Candidate,
Acceptance, or external-effect capability. A Store may reject malformed or
stale output but cannot upgrade another outcome to `MATERIALIZE`.

### Goal Manager

The Goal Manager validates the admitted objective, required success criteria,
scope, and non-goals and owns the resulting formal Goal identity and revision.
It rejects an incomplete, stale, contradictory, or policy-invalid formal
projection.

It does not independently mutate Workflow state.

### Workflow Runtime and trusted Store

The Workflow Runtime constructs the initial `DISCOVERY / READY` Workflow under
the existing one-writer rule. The trusted Store commits Admission, Goal,
Workflow, Materialization, audit, and command outcome in one transaction. A
partial formal result is never visible through a successful public API.

After that transaction commits, an optional automatic-start coordinator may
submit one exact ordinary `StartGoal`. Materialization itself never creates an
Attempt or dispatches a Worker.

## Raw Request and Revisions

`RawRequest` identifies one pre-Goal interaction root. Each admitted user
submission creates an immutable revision:

```text
RawRequestRevision
  rawRequestId
  intakeRunId
  revision
  parentRevision?
  answeredQuestionBinding?
  principalRef
  interactionAction
  admittedUserContent
  admittedContentDigest
  declaredProjectRef?
  declaredConstraints[]
  schemaVersion
  retentionProfile
  submittedAt
  rawRequestDigest

AnsweredQuestionBinding
  clarificationQuestionId
  questionSpecDigest
  questionDigest
  intentAdmissionDecisionId
  intentAdmissionDecisionDigest
```

The trusted interaction surface, not the assistant, authors
`interactionAction`:

- `GOVERNED_EXECUTION` asks CodeClosure to perform governed work;
- `ANSWER_ONLY` asks for an answer without governed project work; and
- `MATERIALIZE_ONLY` asks for a ready Goal without starting it.

An interface MAY choose a documented default, but the admitted action must be
visible, typed, and bound to the exact user submission. Conversation
continuation, inactivity, model classification, or a detached generic approval
cannot substitute for it.

`admittedUserContent` is the exact complete user-authored content accepted into
that authoritative revision. `admittedContentDigest` binds those exact UTF-8
bytes, not an unbounded client envelope, normalized paraphrase, display value,
or Runtime-inserted redaction token.

`rawRequestDigest` is the named, schema-versioned canonical digest of the
revision's semantic fields, including principal, trusted action,
`admittedContentDigest`, declared project/constraints, retention profile, and
revision-chain binding. For a clarification revision it also includes the
complete `AnsweredQuestionBinding`; every other revision rejects that embedded
value. The embedded Question and Decision IDs are governed relationship
identities in this projection, not revision-envelope metadata. Any separately
generated revision-record identity, Runtime-authored `submittedAt`, and the
digest field itself remain envelope metadata as declared by the owning
projection. Downstream Proposal, Projection, Admission, Materialization, and
Start records bind this revision digest; they do not substitute the text-only
digest for whole-revision identity.

The trusted surface applies an explicit privacy and retention profile before
creating the revision. If prohibited content cannot be retained as exact safe
source text, the surface rejects that revision and requests a safely restated
submission; it does not silently replace content and preserve
`USER_STATED` authority. Unsupported client-envelope fields are rejected.
Redacted display and audit projections are derived separately and never become
Raw Request source content.

A clarification answer or correction creates a new immutable revision with one
complete `AnsweredQuestionBinding`. It does not rewrite what the user previously
said or mutate the Question that it answers.

The bounded M2.5 clarification command identifies one exact
`ClarificationQuestionId`. The caller does not restate question content or
digests; Runtime resolves and binds the retained `questionSpecDigest` and exact
`questionDigest`. It validates that the question belongs to the Intake Run, is
its single current unanswered question, still binds the current `CLARIFY`
Decision and authority, and accepts the supplied answer shape before binding
the new revision. The same transaction creates the immutable
`ClarificationAnswerBinding` described below and clears the active Question
reference. Question order or display position is never answer authority.

When a current Clarification Question permits the user to establish or correct
the filesystem project identity, the trusted surface captures that value as a
separate structured project-path input. It is normalized and included in the
pre-activation isolation lease before Runtime receives the command. After
activation, Runtime validates the exact Intake version, current question ID,
both question digests, and issuing Decision binding before binding the path to
the new Raw Request revision. Free-form answer text, assistant output, and a
project path supplied to an unrelated question cannot be interpreted as
replacement project authority. If the current question does not permit a
project correction, the user must start a new Intake Run.

## Intake Run

`IntakeRun` owns the pre-Goal interaction lifecycle and optimistic version. It
does not own a Workflow phase.

```text
IntakeRun
  id
  version
  status
  principalRef
  projectRef?
  activeRawRequestRevision
  activeIntentProjectionRevision?
  activeQuestionRef?
  terminalDecisionRef?
  terminalFailureRef?
  answerOnlyResponseRef?
  materializedGoalRef?
  createdAt
  updatedAt
```

For M2.5, `activeQuestionRef` is absent or carries exactly one Question ID,
`questionSpecDigest`, `questionDigest`, and issuing Decision ID/digest. A bare
Question ID is not sufficient current-question authority. Immutable Question
and Answer Binding rows retain history; the IntakeRun current-state field does
not double as a history collection. A future batch protocol requires a new
schema and policy rather than relaxing this singular field.

`NEEDS_CLARIFICATION` requires exactly one `activeQuestionRef` whose Question
has no Answer Binding. `ANALYZING` and every terminal status require the field
to be absent. The clarification-answer transaction moves directly from the
first shape to `ANALYZING` with no active reference; Store and strict reopen
reject every other status/reference/binding combination.

The implemented Slice 1 `IntakeRunStatus` Domain values are:

- `ANALYZING`;
- `NEEDS_CLARIFICATION`;
- `MATERIALIZED`;
- `NO_EXECUTION`; and
- `FAILED`.

Abandonment is a `NO_EXECUTION` outcome with reason `ABANDONED`. These values
must not be added to `WorkflowPhase` or `RunStatus`.

For the bounded local M2.5 surface, abandonment is an explicit
`intake abandon <intake-run-id> --expected-version <number>` action. It is
available only for the exact current `NEEDS_CLARIFICATION` version with one
unanswered active Question and no external operation in flight. Runtime binds
the current Projection, Question, and issuing Decision plus the exact
`ABANDON_CLARIFICATION` command reservation carrying one complete
`AbandonClarificationReservationBinding`, clears only the active reference, and
atomically records `PROJECTED_NO_EXECUTION / ABANDONED`, terminal state,
`APPLIED` command outcome, and audits. It creates no Raw Request revision and
does not infer abandonment from silence, answer text, timeout, or assistant
output. A schema-valid stale or ineligible command records only an ADR 0034
base reservation plus deterministic `REJECTED` outcome and audit; that
reservation forbids the binding, a Decision, and lifecycle mutation. Missing
target, invalid input, replay-integrity failure, and command conflict retain
ADR 0034's no-new-row behavior.

`MATERIALIZED`, `NO_EXECUTION`, and `FAILED` are terminal for one Intake Run.
`NO_EXECUTION` means policy intentionally created no governed Goal. `FAILED`
means Intake processing could not safely finish and carries one exact terminal
`IntakeFailureRecord`. An Answer-only delivery failure is not an Intake
processing failure: it commits `NO_EXECUTION / ANSWER_ONLY` with
`ANSWER_FAILED`, so the user can distinguish "no Goal was intended" from "the
requested answer could not be delivered."

The owning codec and Store enforce terminal-reference shape as one closed
union:

- `MATERIALIZED` has one `MATERIALIZE` terminal Decision and one materialized
  Goal reference, with no failure or Answer-only response;
- `NO_EXECUTION / ANSWER_ONLY` has one `NO_EXECUTION` terminal Decision and
  exactly one Answer-only response, with no failure or Goal;
- every other `NO_EXECUTION` has one `NO_EXECUTION` terminal Decision and no
  Answer-only response, failure, or Goal; and
- `FAILED` has one terminal Failure Record and no terminal Decision,
  Answer-only response, or Goal.

Non-terminal statuses cannot carry any terminal reference. A partial or mixed
shape fails schema, transaction, and strict-reopen validation.

`READY_TO_MATERIALIZE` may be rendered as a derived next action from a current
admission plan. It is not persisted as a reusable lifecycle authorization.

## Pre-Goal Command Reservation and Replay

Pre-Goal Intake commands use the separate immutable contract accepted in
[ADR 0034](adr/0034-close-pre-goal-command-replay-and-sqlite-activation.md).
They MUST NOT target a placeholder Goal or weaken the existing Goal/Workflow
`processed_commands` contract.

Before invoking an Intent-analysis assistant, Answer-only assistant, or future
project observer, Runtime atomically persists one exact
`IntakeCommandReservation`, the initial Raw Request/IntakeRun authority, exact
operation Manifest/bindings, and audit. The reservation binds `CommandId`,
closed operation kind, trusted principal, target, canonical input digest,
expected/observed Intake version, Manifest/policy/adapter/response-contract
identity when external work is required, causal time, and one canonical
`reservationDigest`. Failure to commit that boundary authorizes no external
call.

`ABANDON_CLARIFICATION` is a closed compound-only reservation variant:

```text
IntakeCommandReservation
  operationKind = ABANDON_CLARIFICATION
  abandonClarificationBinding?

AbandonClarificationReservationBinding
  clarificationQuestionId
  questionSpecDigest
  questionDigest
  issuingClarifyDecisionId
  issuingClarifyDecisionDigest
```

- an `APPLIED` abandonment reservation requires exactly one complete
  `abandonClarificationBinding`; its atomic Decision repeats those fields in
  `AbandonmentBinding` and adds the same reservation's `commandId` and
  `canonicalCommandInputDigest`;
- a deterministic `REJECTED` abandonment reservation contains only the base
  reservation fields and forbids `abandonClarificationBinding`, any abandonment
  Decision, and Intake lifecycle mutation; and
- `FAILED` and a retained abandonment reservation without its same-transaction
  outcome are invalid shapes. An infrastructure failure before commit leaves
  no reservation or outcome.

For clarification, the reservation and canonical command input additionally
bind the exact current `ClarificationQuestionId`, `questionSpecDigest`,
`questionDigest`, issuing `CLARIFY` Decision ID/digest, and answer schema
resolved from Store. A stale, foreign, already answered, Decision-mismatched,
spec-substituted, or record-substituted question creates no Raw Request revision
and invokes no assistant.

An accepted clarification reservation atomically creates the new Raw Request
revision with its embedded `AnsweredQuestionBinding`, one unique immutable
`ClarificationAnswerBinding`, the cleared active Question reference, updated
IntakeRun version/status, exact operation Manifest/bindings, and audit before
the next analysis call. Partial answer authority is never externally visible.

A deterministic admitted rejection instead commits the reservation,
`REJECTED` outcome, exact observed Intake version, and audit together. It
creates no Raw Request revision, Intake lifecycle transition, or external call.
Invalid input, missing target, replay-integrity failure, and command conflict do
not become stored rejections.

The final compound transaction adds one separate immutable Store-authored
`IntakeCommandOutcome`. It carries the exact `reservationDigest`; the owning
decoder rejects an Outcome paired with a substituted principal, target,
operation, Manifest/binding, or other Reservation field:

- `APPLIED` for a committed `CLARIFY`, intentional `NO_EXECUTION`, successful
  Materialization, or `NO_EXECUTION / ANSWER_FAILED` result;
- `REJECTED` for a deterministic admitted command rejection against one exact
  Intake version; or
- `FAILED` only when one terminal Intake Failure Record, `FAILED` status, audit,
  and result commit together.

An uncommitted Store, audit, codec, clock, replay-integrity, command-conflict,
or adapter failure cannot become a stored final outcome. The active state of a
reservation with no outcome is derived; the reservation itself is not mutated
through status strings.

Exact active duplicate delivery starts no second external operation and exposes
only a typed non-authoritative `IN_PROGRESS` view or the same in-process
completion. Exact final replay returns the stored Intake outcome without
another assistant call or new Raw Request revision, Clarification Answer
Binding, Intake, Admission, Goal, Workflow, Materialization, Start
Authorization, or Intake audit effect. Reusing a `CommandId` with another input
digest fails closed. Startup reconciles only a structurally valid orphaned
operation according to its immutable operation kind before publishing handlers;
corrupt or mixed authority blocks strict reopen.

The separately preallocated ordinary `StartGoal` command still uses the
existing Goal/Workflow command journal. An Intake outcome cannot replace its
processed outcome or become completion authority. After replay of a
materialized `AUTHORIZE_START` result, the application coordinator may
separately resubmit only that exact Start command. Ordinary first-Start guards
then perform a still-missing Start, return its processed result, or reject it;
they cannot recreate first-Start authority or redispatch a retained Attempt.

A trusted deterministic preflight that already knows a no-external-operation
terminal result commits the current Intake authority, any admitted new Raw
Request revision, reservation, `NO_EXECUTION` Decision, terminal status,
`APPLIED` outcome, and audits in one transaction. It creates no intermediate
`ANALYZING` operation and cannot be recovered as interrupted assistant work.

An orphaned Answer-only reservation is not an orphaned Intent-analysis result.
At startup, its immutable operation kind authorizes only deterministic
recalculation of the exact prepared Admission input and one atomic
`NO_EXECUTION / ANSWER_FAILED / INTERRUPTED_ANSWER_DELIVERY` response, audit,
and `APPLIED` outcome. Recovery does not recall the assistant. An unprovable
Decision binding or operation/state mismatch blocks reopen instead of becoming
either `ANSWER_FAILED` or Intake `FAILED`.

## Intent Analysis Proposal

`IntentAnalysisProposal` is a strictly bounded, immutable record of assistant
output after transport and schema validation. It is still untrusted.

The bounded M2.5 local assistant wire contract is exactly:

```text
IntentAnalysisAssistantResponseV1
  proposedObjective?: non-blank string
  proposedCriteria: non-blank string[]
  proposedScope?: non-blank string
  proposedNonGoals: non-blank string[]
  proposedAssumptions: non-blank string[]
  proposedQuestions: non-blank string[]
  candidateSourceSpanSuggestions: CandidateSourceSpanSuggestionV1[]
  proposedClassification?: non-blank string

CandidateSourceSpanSuggestionV1
  projectionFieldRef = OBJECTIVE | REQUIRED_CRITERION | SCOPE | NON_GOAL | ASSUMPTION
  itemIndex?: non-negative integer
  rawRequestRevision: positive integer
  startByte: non-negative integer
  endByte: positive integer greater than startByte
```

Every array key is present even when empty. Optional scalar keys are omitted,
never `null`. `itemIndex` is required for a collection field and forbidden for
`OBJECTIVE` and `SCOPE`. It addresses the corresponding response-array item,
not a later Projection revision. Array order is semantic; duplicate
byte-identical items, duplicate or unknown JSON keys, unknown enum values,
non-integer coordinates, invalid UTF-8, blank strings, and budget overflow
reject the entire response. No string is trimmed, normalized, or rewritten.
`proposedCriteria` contains candidate required Criteria only; the local profile
has no model-authored optional-Criterion field.

After validation, the Coordinator adds the trusted envelope below. The
assistant never supplies those envelope fields.

```text
IntentAnalysisProposal
  id
  intakeRunId
  rawRequestRevision
  rawRequestDigest
  assistantAdapterId
  assistantAdapterVersion
  responseContractDigest
  proposedObjective?
  proposedCriteria[]
  proposedScope?
  proposedNonGoals[]
  proposedAssumptions[]
  proposedQuestions[]
  candidateSourceSpanSuggestions[]
  proposedClassification?
  proposalDigest
  observedAt
```

For analyzed Intake, Admission compares the Proposal's adapter ID/version and
response-contract digest with the exact retained operation identity. The Store
independently repeats that comparison against the command reservation's
Manifest-bound external-operation identity during commit and strict reopen. A
digest-valid Proposal cannot substitute one of those identities merely by
rehashing its dependent Projection and Decision chain.

Each `candidateSourceSpanSuggestion` remains an untrusted lookup suggestion,
not a `SourceBinding`; the Coordinator independently resolves the exact
Manifest-selected retained revision/content digests and validates the field,
item, and byte coordinates before constructing any binding.

The assistant may propose interpretations and candidate source spans. It cannot
author the trusted interaction action, Projection identity, Source Binding
authority class, ambiguity status, Admission outcome, Goal identity, or Start
authorization.

Malformed, oversized, stale, cross-run, unknown-field, or mismatched proposal
output fails closed and cannot create a Projection revision. When the current
analysis operation cannot safely continue, M2.5 records a terminal typed Intake
failure rather than silently calling the assistant again.

## Source Binding and Information Classification

Every material Projection field retains one or more exact `SourceBinding`
values:

```text
SourceBinding
  projectionFieldRef
  authorityClass
  sourceRecordRef
  sourceRevision
  sourceDigest
  sourceSpan?
  sourceFieldPath?
  derivationPolicyRef?
  observationRef?
  bindingDigest
```

The closed authority classes are:

- `USER_STATED` — exact user-authored content;
- `POLICY_DERIVED` — deterministic output of a named policy over exact inputs;
- `PROJECT_OBSERVED` — bounded read-only project observation;
- `MODEL_PROPOSED` — assistant interpretation or inference; and
- `UNRESOLVED` — required information not yet established.

Classification is Runtime-owned. A model cannot label its inference as
user-stated, policy-derived, or resolved.

The bounded local Admission profile accepts an `UNRESOLVED` Source Binding only
when it binds an exact Proposal structured-field path and an unresolved
same-field `MaterialAmbiguity` names that binding digest. This shape can produce
`CLARIFY`; it cannot satisfy Materialization. The local Projection compiler does
not synthesize that optional classification when ordinary `MODEL_PROPOSED`
bindings plus the Material Ambiguity set already express the unresolved
meaning.

Source Binding proves where content or a deterministic derivation came from.
It does not prove semantic correctness. Admission policy may use
`POLICY_DERIVED` content only for meaning-preserving normalization, such as a
structured or testable restatement of an outcome the user actually stated. It
must not silently choose a materially different business result, widen scope,
invent an external effect, or manufacture an unrelated Criterion.

For text, `sourceSpan` uses zero-based, end-exclusive UTF-8 byte offsets over
the exact retained `admittedUserContent` bytes. Structured sources use a
schema-versioned field path. A `POLICY_DERIVED` binding also records the exact
derivation rule ID/version/digest and ordered input bindings. A model-cited
quotation without independently validated coordinates is not a Source Binding.

For Raw Request text, `sourceDigest` binds the whole `rawRequestDigest`; the
Runtime independently validates `admittedContentDigest` before resolving the
byte span. The whole-revision and text-byte digests are both required and
cannot substitute for one another.

A `USER_STATED` binding may address only retained user-authored bytes. It MUST
NOT address a redacted display value, omission marker, synthetic replacement,
or content that the retention policy no longer permits CodeClosure to validate.
If removing prohibited content would affect a material field or its byte
coordinates, Intake requires a new safely restated Raw Request revision; the
affected field cannot pass Admission as `USER_STATED`.

## Intent Projection

`IntentProjectionRevision` is CodeClosure's immutable structured
interpretation. It is not yet formal user intent or a Goal.

```text
IntentProjectionRevision
  id
  intakeRunId
  revision
  parentRevision?
  rawRequestRevision
  intentAnalysisProposalRef
  objective?
  requiredCriteria[]
  optionalCriteria[]
  scope
  nonGoals[]
  assumptions[]
  requestedExecutionDisposition
  sourceBindings[]
  materialAmbiguityRefs[]
  schemaVersion
  canonicalProfileVersion
  projectionDigest
  createdAt
```

The Intake Coordinator derives every identity, revision, timestamp, canonical
projection, and digest after validating the proposal and current sources.
Model-authored IDs, digests, timestamps, classifications, or unknown fields are
never copied into authority.

Projection schema version 1 remains decodable with canonical profile
`codeclosure-m2-5-projection-v1` and a required `objective`. The implemented
local compiler emits schema version 2 with
`codeclosure-m2-5-projection-v2`, which may omit an unresolved objective. That
omission is valid only when the Projection has no objective Source Binding and
one exact unresolved `OBJECTIVE_UNRESOLVED` ambiguity binds the owning Proposal
digest. It never creates placeholder objective text, and Materialization still
requires a non-blank `USER_STATED` objective. Migration 0029 retains every
schema-version-1 Projection record and digest unchanged.

Changing objective, criteria, scope, non-goals, assumptions, requested
execution disposition, or a material source binding creates a new immutable
Projection revision. Revisions form one explicit parent chain and do not erase
earlier user or proposal history.

A Projection can be eligible for `MATERIALIZE` only when:

- it contains a non-blank objective;
- it contains at least one explicit required success criterion;
- project and scope identity are sufficiently bounded for policy;
- its requested execution disposition agrees with trusted user action;
- every required material field has an allowed source class;
- no material ambiguity remains unresolved; and
- its canonical digest can be reproduced from persisted input.

A material field supported only by `MODEL_PROPOSED` or `UNRESOLVED` input is
not admissible.

## Material Ambiguity and Clarification

`MaterialAmbiguity` identifies one unresolved choice that could change the
objective, required criteria, scope, non-goals, project identity, risk, or
execution authorization.

```text
MaterialAmbiguity
  id
  intakeRunId
  basedOnProjectionRevision?
  reasonCode
  affectedFields[]
  sourceRefs[]
  materialityPolicyRef
  status
  createdAt
  resolvedByRawRequestRevision?
```

One or more unresolved material ambiguities require `CLARIFY`. Under M2.5,
trusted Runtime composition first constructs one bounded canonical question
specification and preallocates the Decision and Question IDs:

```text
ClarificationQuestionSpec
  schemaVersion
  intakeRunId
  basedOnProjectionRevision?
  ambiguityRef
  prompt
  affectedFields[]
  answerSchema
  questionSpecDigest

QuestionPlanBinding
  questionId
  questionSpecDigest

ClarificationQuestion
  id
  schemaVersion
  intakeRunId
  intentAdmissionDecisionId
  intentAdmissionDecisionDigest
  basedOnProjectionRevision?
  ambiguityRef
  prompt
  affectedFields[]
  answerSchema
  questionSpecDigest
  createdAt
  questionDigest
```

`ClarificationQuestionSpec` is an embedded canonical value, not an independent
authority record. `questionSpecDigest` covers its exact Intake, Projection,
ambiguity, prompt, affected fields, and answer schema, and excludes the
preallocated Decision/Question IDs, timestamps, and its own digest output. The
Admission Engine may return `CLARIFY` only with a
`QuestionPlanBinding` for that preallocated Question ID and exact spec digest.
The Decision semantic digest includes the spec digest but excludes the generated
Question ID under ADR 0006.

After the Engine issues the Decision, the Coordinator constructs the immutable
Question record by repeating the exact specification and binding the issuing
Decision ID/digest. `questionDigest` is an exact relationship digest that
includes the Question ID, Decision ID/digest, repeated specification, and
`questionSpecDigest`; it excludes only `createdAt` and itself. The Decision does
not include `questionDigest`, so digest construction remains acyclic. Store
independently recomputes both digests and atomically validates the repeated
fields, Decision-to-Question references, current ambiguity/Projection, exactly
one active question, lifecycle transition, audit, and command outcome. No
Decision-only or Question-only write is valid.

An accepted answer creates a separate immutable relationship record:

```text
ClarificationAnswerBinding
  id
  schemaVersion
  intakeRunId
  clarificationQuestionId
  questionSpecDigest
  questionDigest
  intentAdmissionDecisionId
  intentAdmissionDecisionDigest
  rawRequestId
  rawRequestRevision
  rawRequestDigest
  commandId
  canonicalCommandInputDigest
  answeredAt
  answerBindingDigest
```

The new Raw Request revision embeds the same Question/Decision tuple before its
`rawRequestDigest` is computed. `answerBindingDigest` then covers the schema
version, exact Intake, Question/Decision tuple, Raw Request ID/revision/digest,
Command ID, and canonical command-input digest; it excludes the generated
Answer Binding ID, `answeredAt`, and itself. The Store independently recomputes
the Raw Request and Answer Binding digests, validates every repeated field and
parent/current-run relationship, permits at most one Answer Binding per
Question, and atomically clears `activeQuestionRef`. The dependency order is
Question, then Raw Request revision, then Answer Binding, so no digest cycle is
introduced.

Questions are prioritized and bounded. The system SHOULD avoid asking for
facts that formal `DISCOVERY` can safely establish later, and MUST NOT force
the user to choose implementation details that do not change Goal intent or
authorization.

The M2.5 Admission Policy emits exactly one active question when it returns
`CLARIFY`. Older answered Questions and their Answer Bindings remain immutable
history. A clarification command binds that active question's ID, spec digest,
record digest, issuing Decision, and answer schema; it cannot answer by array
position or carry answers for several questions.

An answer is a new user-input revision with its own provenance plus one exact
immutable Answer Binding. It may lead to a new Proposal and Projection; it does
not mutate earlier records in place.

## Intent Admission Decision

`IntentAdmissionDecision` is immutable and deterministic for one exact input.
It is a closed discriminated union rather than one record with independently
optional Proposal and Projection fields:

```text
IntentAdmissionDecision =
  PreAnalysisNoExecutionDecision
  | ProjectedNoExecutionDecision
  | ClarifyIntentDecision
  | MaterializeIntentDecision

IntentAdmissionDecisionCommon
  id
  schemaVersion
  intakeRunId
  intakeRunVersion
  principalRef
  interactionAction
  rawRequestRevision
  rawRequestDigest
  admissionPolicyId
  admissionPolicyVersion
  admissionPolicyDigest
  orderedReasonTrace[]
  decidedAt
  decisionDigest

ProjectionAdmissionBinding
  intentAnalysisProposalId
  intentAnalysisProposalDigest
  intentProjectionId
  intentProjectionRevision
  intentProjectionDigest
  sourceBindingDigests[]
  materialAmbiguityRefs[]

AbandonmentBinding
  clarificationQuestionId
  questionSpecDigest
  questionDigest
  issuingClarifyDecisionId
  issuingClarifyDecisionDigest
  commandId
  canonicalCommandInputDigest

PreAnalysisNoExecutionDecision
  common
  kind = PRE_ANALYSIS_NO_EXECUTION
  projectOrScopeRef?
  outcome = NO_EXECUTION
  reasonCode
  executionDisposition = NONE

ProjectedNoExecutionDecision
  common
  kind = PROJECTED_NO_EXECUTION
  projectionBinding
  abandonmentBinding?
  projectOrScopeRef?
  outcome = NO_EXECUTION
  reasonCode
  executionDisposition = NONE

ClarifyIntentDecision
  common
  kind = CLARIFY
  projectionBinding
  questionPlanBinding
  projectOrScopeRef?
  outcome = CLARIFY
  reasonCode
  executionDisposition = NONE

MaterializeIntentDecision
  common
  kind = MATERIALIZE
  projectionBinding
  projectOrScopeRef
  outcome = MATERIALIZE
  reasonCode
  executionDisposition = LEAVE_READY | AUTHORIZE_START
```

`ProjectionAdmissionBinding` is an embedded all-or-nothing value, not a
separate authority record. A Store codec MUST reject a partial identity/digest
tuple, Projection fields on `PRE_ANALYSIS_NO_EXECUTION`, a missing project/scope
on `MATERIALIZE`, or any unknown kind/outcome/action/disposition combination.
For local M2.5, `PROJECTED_NO_EXECUTION / ABANDONED` requires exactly one
complete `AbandonmentBinding`; every other Decision kind or reason forbids it.
The Store validates its Question/spec/record digests, prior `CLARIFY` Decision,
Command ID/input digest, current active reference, principal, and Intake version
against the same atomic reservation/outcome transaction.
`CLARIFY` requires at least one current unresolved Material Ambiguity and one
complete `QuestionPlanBinding`; every other Decision variant rejects that
binding. The Store validates the plan binding against the exact Question record
in the same compound transaction.

`MATERIALIZE` requires every material ambiguity in the bound set to be resolved
and permits `LEAVE_READY` only for `MATERIALIZE_ONLY` and `AUTHORIZE_START` only
for `GOVERNED_EXECUTION`. `ANSWER_ONLY` cannot materialize.

Outcomes are:

- `MATERIALIZE` — formal Goal input is sufficiently source-bound and valid;
- `CLARIFY` — bounded user input is required; or
- `NO_EXECUTION` — no governed Goal should be created.

`IntentExecutionDisposition` is a closed companion value:

- `NONE` for `CLARIFY` and `NO_EXECUTION`;
- `LEAVE_READY` for admitted `MATERIALIZE_ONLY`; and
- `AUTHORIZE_START` for admitted `GOVERNED_EXECUTION` after exact start-policy,
  Policy, and Execution Profile preflight.

Every other outcome/disposition pairing is invalid.

Initial `NO_EXECUTION` reasons include:

- `ANSWER_ONLY`;
- `POLICY_DENIED`;
- `UNSUPPORTED`; and
- `ABANDONED`.

An assistant answer returned with `NO_EXECUTION` remains a non-authoritative
response. Conversely, a request requiring repository inspection or tools may
need a governed read-only Goal rather than `ANSWER_ONLY`.

`MATERIALIZE`, `CLARIFY`, and content-dependent `NO_EXECUTION` decisions require
the complete exact Proposal and Projection binding. A deterministic
pre-analysis `ANSWER_ONLY`, policy denial, or unsupported request may use
`PRE_ANALYSIS_NO_EXECUTION` without calling an assistant for Admission or
creating empty Proposal/Projection records when trusted action and policy inputs
are already dispositive. ADR 0027 permits a future policy version to define a
different trusted pre-analysis abandonment source, but local M2.5 does not:
its sole explicit abandonment consumes current `CLARIFY` authority and MUST use
`PROJECTED_NO_EXECUTION` with the exact `AbandonmentBinding`. A separate
Answer-only call may still produce the requested non-authoritative response; it
is not Intent analysis and cannot change the Admission outcome.

For fixed canonical input and policy, the Admission Engine must produce the
same outcome, ordered reason trace, and decision digest. It cannot call the
assistant while deciding.

`decisionDigest` covers the exact semantic input bindings, Admission Policy,
decision kind, outcome, reason code, ordered reason trace, and execution
disposition, including the complete `AbandonmentBinding` when present. It
excludes record ID, Runtime-authored `decidedAt`, and itself. A time-sensitive
rule must use an explicit source-bound observed-time input rather than ambient
wall time.

## Admission Policy

`IntentAdmissionPolicy` is immutable, versioned, canonically digested, and
installed by trusted composition. It owns at least:

- required formal Goal fields;
- allowed provenance classes for each material field;
- meaning-preserving derivation rules;
- Material Ambiguity classification;
- interaction-action and `NO_EXECUTION` rules;
- automatic-Start eligibility; and
- closed reason ordering and decision aggregation.

The built-in local-v1 registry is closed and ordered:

1. `answer-only_action_codeclosure-m2-5-v1` maps exact trusted `ANSWER_ONLY` to
   `PRE_ANALYSIS_NO_EXECUTION / ANSWER_ONLY`;
2. `abandon-active-question_codeclosure-m2-5-v1` accepts only the exact
   `ABANDON_CLARIFICATION` binding described above and maps it to
   `PROJECTED_NO_EXECUTION / ABANDONED`;
3. `material-field-eligibility_codeclosure-m2-5-v1` applies the fixed local
   field/source matrix;
4. `first-material-ambiguity_codeclosure-m2-5-v1` selects exactly one Question
   by project identity, objective, required Criterion, scope, assumption, then
   non-goal, with source-byte order breaking ties;
5. `materialize-only-disposition_codeclosure-m2-5-v1` maps a complete exact
   `MATERIALIZE_ONLY` input to `MATERIALIZE / LEAVE_READY`; and
6. `governed-execution-disposition_codeclosure-m2-5-v1` maps a complete exact
   `GOVERNED_EXECUTION` input to `MATERIALIZE / AUTHORIZE_START` only after the
   fixed Workflow Policy/Profile preflight succeeds.

The built-in local-v1 `POLICY_DENIED` and `UNSUPPORTED` rule collections are
both exactly empty. No free-form request classifier, model label, or Slice 1
implementation choice may populate them under this Policy version. Those
accepted Decision reasons remain part of the general closed Domain contract and
are exercised by exact non-default deterministic test Policies; adding either
reason to the installed local profile requires a new Policy version and plan
review.

Trusted composition supplies a policy definition without a caller-authored
digest. The Runtime computes its canonical identity and the Store independently
validates immutable installation plus audit. The Admission Decision binds that
exact ID, version, and digest.

Admission Policy is separate from the Workflow Policy selected by first
`StartGoal`. The former decides whether pre-Goal intent may materialize; the
latter governs phase, capability, Evidence, Acceptance, and recovery for the
created Workflow. Process defaults, assistant output, or project content cannot
substitute either identity.

## Admission Transactions

Assistant calls and optional project observations occur outside a control-store
transaction. Admission then reloads one exact current snapshot and commits one
closed result:

- `CLARIFY` persists the Decision, one exact Question, `NEEDS_CLARIFICATION` status,
  audits, and command outcome atomically;
- `NO_EXECUTION` persists the Decision, terminal `NO_EXECUTION` status, optional
  Answer-only response result, audits, and command outcome atomically; or
- `MATERIALIZE` persists the Decision with the formal authority described
  below.

Changing any bound Raw Request, Projection, Source Binding, project/scope,
ambiguity, assistant identity, or Admission Policy makes an earlier unconsumed
decision ineligible. There is no separate durable
`READY_TO_MATERIALIZE`/consume-later window.

## Answer-only Response

`ANSWER_ONLY` means that no governed Goal should be created, not that the user
receives no answer. The application coordinator may call the Intake Assistant
outside the control-store transaction through a separate bounded Answer-only
contract. It then persists exactly one closed non-authoritative result with the
`NO_EXECUTION / ANSWER_ONLY` Decision:

```text
AnswerOnlyAssistantResponseV1
  answerContent: non-blank string
```

This is the complete assistant wire object. `answerContent` is required and
`null`, blank content, duplicate or unknown keys, invalid UTF-8, and budget
overflow reject the whole response. The canonical response is bounded at
131,072 bytes and the retained content at 16,384 UTF-8 bytes, so JSON escaping
cannot silently reduce the declared content boundary.

```text
AnswerOnlyResponse = AnswerReturned | AnswerFailed

AnswerOnlyResponseCommon
  id
  schemaVersion
  intakeRunId
  rawRequestRevision
  rawRequestDigest
  intentAdmissionDecisionId
  intentAdmissionDecisionDigest
  assistantAdapterId
  assistantAdapterVersion
  responseContractDigest
  observedAt
  responseDigest

AnswerReturned
  common
  kind = ANSWER_RETURNED
  answerContent
  answerContentDigest

AnswerFailed
  common
  kind = ANSWER_FAILED
  failureReasonCode
```

The initial closed Answer-only failure reasons are
`ASSISTANT_UNAVAILABLE`, `ASSISTANT_TIMEOUT`, `ASSISTANT_PROTOCOL_ERROR`, and
`RESPONSE_REJECTED`; startup recovery additionally uses
`INTERRUPTED_ANSWER_DELIVERY` only for an exact structurally valid orphaned
Answer-only reservation. Raw adapter exceptions and unknown response fields do
not enter the record or audit.

The trusted Coordinator authors record identity, bindings, disposition, safe
failure classification, and digests after validating the bounded response. The
assistant authors only `answerContent`. That content is neither Source Binding,
Fact, Criterion, Human Decision, Evidence, Acceptance, Goal, nor execution
authority. An answer requiring project inspection or tools must instead use a
policy-governed read-only Goal.

The public result includes a closed `answerDisposition`:

- `NOT_REQUESTED` for every non-`ANSWER_ONLY` outcome;
- `ANSWER_RETURNED` when validated bounded content is retained; or
- `ANSWER_FAILED` when Answer-only delivery failed.

An exact committed command replay returns the stored response/result without a
new assistant call. A crash before the compound commit may lose an untrusted
external response, but only one response record may commit. An Answer-only
assistant failure still commits intentional `NO_EXECUTION`; it does not change
the Intake Run to `FAILED`. Because that Run is terminal, another answer attempt
requires a new explicit Answer-only Intake Run rather than an implicit recall.

## Intake Failure and Recovery

`FAILED` means that Intake processing could not safely reach Admission. It is
not a denial, abandonment, Answer-only delivery failure, Goal status, or
technical completion result.

```text
IntakeFailureRecord
  id
  schemaVersion
  commandId
  intakeRunId
  intakeRunVersion
  rawRequestRevision
  rawRequestDigest
  failedOperation
  assistantAdapterId?
  assistantAdapterVersion?
  responseContractDigest?
  reasonCode
  retryDisposition = NEW_INTAKE_RUN_REQUIRED
  failedAt
  failureDigest
```

Initial `failedOperation` values are `INTENT_ANALYSIS`,
`PROJECT_OBSERVATION`, and `ADMISSION_PREPARATION`. Initial safe reason codes
are `ASSISTANT_UNAVAILABLE`, `ASSISTANT_TIMEOUT`,
`ASSISTANT_PROTOCOL_ERROR`, `RESPONSE_REJECTED`, `INTERRUPTED_ANALYSIS`,
`PROJECT_OBSERVATION_FAILED`, and `INTAKE_PREPARATION_FAILED`.

When a bounded operation failure can be persisted, the Coordinator atomically
writes one immutable Failure Record, terminal `FAILED` status, audit, and
command outcome. Raw exception text is excluded. A Store or audit failure that
prevents this transaction cannot be described as a successfully recorded
`FAILED` outcome.

M2.5 performs no automatic Intake retry. Exact replay of a committed failed
command returns the stored failure result without another assistant call. The
user starts a new Intake Run, optionally reusing safely admitted user content,
when they want to try again.

After acquiring exclusive Runtime ownership on startup, M2.5 uses the immutable
reservation operation kind to reconcile a valid persisted `ANALYZING` Run
before making any assistant call. Non-Answer-only analysis orphans become
`FAILED / INTERRUPTED_ANALYSIS` in one versioned audited transaction. An
Answer-only orphan instead deterministically revalidates its exact retained
Admission input and commits `NO_EXECUTION /
ANSWER_FAILED / INTERRUPTED_ANSWER_DELIVERY` with an `APPLIED` command outcome.
Missing or irreproducible Decision inputs, contradictory operation/state shape,
mixed-terminal authority, or corrupted state fail strict reopen rather than
being rewritten as an ordinary failure.

## Goal Materialization

Goal Materialization consumes current pre-Goal authority and creates formal
Goal/Workflow authority.

The implemented Runtime Materialization input consumes exact records that bind:

```text
MaterializeGoalRequest
  commandId
  expectedIntakeRunVersion
  rawRequestRevision
  rawRequestDigest
  intentAnalysisProposalId
  intentAnalysisProposalDigest
  intentProjectionId
  intentProjectionRevision
  intentProjectionDigest
  expectedProjectOrScopeRef
  admissionPolicyId
  admissionPolicyDigest
```

The Runtime computes the exact `MATERIALIZE` decision from one decoded
consistent snapshot. The Store compound transaction independently revalidates
that snapshot and decision before creating exactly:

- one immutable Intent Admission Decision;
- one formal Goal at revision 1;
- its one initial `DISCOVERY / READY` Workflow;
- the synchronized initial Goal lifecycle projection;
- one immutable Goal Materialization Record;
- exactly one Goal Start Authorization when the Decision disposition is
  `AUTHORIZE_START`, otherwise none;
- required Goal, Workflow, Intake, Admission, Materialization, and optional
  Start-Authorization audit events; and
- one idempotent Materialization command outcome.

The Materialization Record binds the complete consumed identities and digests
to the resulting Goal and Workflow. It is not technical Acceptance and cannot
authorize closeout or external Promotion.

An exact replay returns the stored Intake result without another
Materialization effect. For `AUTHORIZE_START`, the coordinator may then
separately resubmit only the preallocated ordinary Start command under the next
section. A stale version, changed source, unresolved material ambiguity,
mismatched project, concurrent winner, reused identity with different input, or
persistence failure produces no partial formal authority.

## Automatic Start

Automatic start is a user-experience composition over two authority
transactions, not part of Goal Materialization.

For an admitted `GOVERNED_EXECUTION / AUTHORIZE_START` request, the
Materialization transaction creates exactly one:

```text
GoalStartAuthorization
  id
  schemaVersion
  principalRef
  rawRequestRevision
  rawRequestDigest
  intentAdmissionDecisionId
  intentAdmissionDecisionDigest
  goalMaterializationId
  goalId
  goalRevision
  workflowId
  workflowVersion
  startCommandId
  policyBundleId
  policyBundleDigest
  executionProfileId
  executionProfileDigest
  authorizedAt
  authorizationDigest
```

Only the automatic Intake path needs this record. An admitted
`GOVERNED_EXECUTION / AUTHORIZE_START` Materialization creates exactly one;
`MATERIALIZE_ONLY / LEAVE_READY` creates none. Direct manual `StartGoal` retains
its existing contract.

Trusted Runtime composition and start policy, never assistant output or
project content, select the exact installed Policy and Execution Profile. If
those identities cannot be resolved and validated before Materialization, a
`GOVERNED_EXECUTION` request fails without silently becoming
`MATERIALIZE_ONLY`.

After Materialization commits, the application coordinator may submit the
preallocated ordinary `StartGoal` command. That command still owns:

- expected Goal and Workflow freshness;
- immutable Policy and Execution Profile binding;
- first Context and Attempt creation;
- dispatch claim and cancellation ordering;
- Worker invocation and event admission; and
- normal command idempotency and recovery.

The Start Authorization is not a dispatch claim and cannot bypass those
guards. Exact replay may resubmit only the same `startCommandId`; it may not
invent a replacement Start. If the process crashes before Start, or Start
fails, Materialization remains committed and the Goal remains visibly
`DISCOVERY / READY`. If Start already committed, replay reuses its stored
command outcome, cannot recreate first-Start bindings, and cannot redispatch a
retained Attempt or claim. Any later driver continuation still follows current
persisted authority under the existing Runtime contract.

A later explicit user `StartGoal` remains available under its accepted public
contract and must revalidate current authority. It is not an automatic retry
derived from Intake history.

The public Intake result reports `answerDisposition` independently from any
`materializationDisposition` and `startDisposition`. It must not present
`NO_EXECUTION / ANSWER_ONLY` as a delivered answer when the disposition is
`ANSWER_FAILED`, or conflate successful Materialization with successful Start.

The composite view distinguishes at least:

- `NOT_AUTHORIZED`;
- `READY_PENDING_START`;
- `START_COMMAND_APPLIED`;
- `START_COMMAND_REJECTED`; and
- `START_INFRASTRUCTURE_FAILURE`.

These are view/result labels over Materialization, Goal Start Authorization,
processed-command, and current Workflow authority. They are not Goal lifecycle,
Acceptance, or permission for the view to retry work.

`MATERIALIZE_ONLY` creates no Goal Start Authorization. `ANSWER_ONLY`,
`CLARIFY`, and `NO_EXECUTION` create no Goal, Workflow, or Start authority.

## Intake Lifecycle

The pre-Goal lifecycle is separate from the Workflow:

```text
Raw Request Revision
  -> trusted preflight
       |-- PRE_ANALYSIS_NO_EXECUTION
       |     |-- ANSWER_ONLY
       |     |     -> AnswerOnlyResponse
       |     |     -> terminal NO_EXECUTION
       |     `-- other reason -> terminal NO_EXECUTION
       `-- ANALYZING
             |-- processing failure -> terminal FAILED
             `-- Intent Analysis Proposal
                   -> Intent Projection Revision
                   -> Intent Admission Decision
                        |-- CLARIFY
                        |     -> NEEDS_CLARIFICATION
                        |     -> new Raw Request Revision
                        |     -> ANALYZING
                        |
                        |-- NO_EXECUTION
                        |     |-- ANSWER_ONLY -> AnswerOnlyResponse
                        |     `-- terminal NO_EXECUTION
                        |
                        `-- MATERIALIZE
                              -> atomic Goal + DISCOVERY / READY Workflow
                              -> terminal MATERIALIZED IntakeRun
                              -> optional separate StartGoal
```

`MATERIALIZED`, `NO_EXECUTION`, and `FAILED` are terminal for one Intake Run.
Editing intent after Materialization is a formal correction or Goal-revision
concern, not reopening the original Projection. Retrying a failed Run creates a
new Intake Run in M2.5.

## Intake Context and Codex Calls

Goal-bound Context requires Goal, Workflow, phase, Attempt, Policy, and
Execution Profile identities. Intake has none before Materialization and uses a
distinct contract.

The implemented bounded `IntakePackage` contains only policy-authorized inputs
such as:

- exact Raw Request revisions and digests;
- the current Intent Projection revision and digest, when one exists;
- answered Clarification Questions with their exact Answer Bindings and the
  current unresolved Question, when present;
- declared project/scope identity;
- optional bounded project observations;
- required response schema and byte/collection budgets; and
- Intake policy and adapter identities.

The durable `IntakeManifest` records every included or intentionally omitted
input, its revision, provenance, digest, and budget decision. It does not carry
fabricated Goal, Workflow, phase, Attempt, Worker Session, Candidate, Workflow
Policy binding, Execution Profile binding, or Acceptance identities. It still
binds its exact Admission Policy as described below.

Each external Intake operation owns one immutable Manifest ID and canonical
digest. The Manifest commits with its command reservation and exact operation
bindings before the adapter is invoked. For Answer-only it additionally binds
the exact prepared Decision input, Admission Policy, adapter, response
contract, and budgets needed to classify an interrupted delivery without model
recall. A missing, partial, or irreproducible Manifest authorizes no external
call and cannot be repaired from conversation history.

Answer-only handling uses a separate bounded `AnswerOnlyPackage` and response
contract containing only the exact Raw Request binding, prepared
`NO_EXECUTION / ANSWER_ONLY` Decision and Admission Policy binding, adapter
identity, and output budgets. It is not an Intake analysis package and cannot
request project tools. A `PRE_ANALYSIS_NO_EXECUTION` decision does not require
an Intent-analysis assistant call; only the separate Answer-only operation may
call the assistant for an `ANSWER_ONLY` result.

Low-level canonical rendering, byte-budget, digest, redaction, and protocol
utilities may be shared with the Goal-bound Context system. `IntakePackage` and
`ContextPackage` remain different authority contracts and codecs.

Codex conversation history is disposable convenience context. Compaction,
Thread replacement, or process restart cannot remove the authoritative Raw
Request, Projection, Admission, Materialization, or Start-causality records.

## Optional Read-only Project Exploration

Project-assisted Intake is optional planned behavior, not a prerequisite for
the basic M2.5 vertical slice. When enabled, it runs through a dedicated
read-only exploration port with:

- an explicitly authorized and resolved project root;
- no Candidate or source-write capability;
- no control-store path access;
- a closed operation set and hard byte, file, time, and command budgets;
- exact project/source observation identity;
- provenance and omission records; and
- interruption and failure behavior that remains non-success.

The assistant may propose that an observation affects the Projection or raises
a question. The Intake Coordinator validates that proposal, while Admission
policy decides whether the resulting source class is sufficient.

Read-only does not automatically mean `NO_EXECUTION`. Repository inspection or
tool use that requires governed capability, budget, recovery, or audit may be
materialized as a formal read-only Goal.

## Interaction with DISCOVERY

`DISCOVERY` starts only after Materialization creates a formal Goal and Workflow
and an ordinary `StartGoal` succeeds. Its responsibility remains to inspect
project facts, applicable business scenarios, code surfaces, risks, and the
smallest safe planning depth under that exact Goal revision.

Intake asks, "Is there enough source-bound intent to create this Goal?"
`DISCOVERY` asks, "What is true in the project and business scope for this
already formal Goal?"

Information collected during Intake may guide later discovery selection, but
it is not silently promoted into a confirmed Goal Fact. Formal discovery must
revalidate any fact required for planning, capability, or Acceptance.

## Correction and Goal Revision

Before Materialization, a correction creates a new Raw Request revision,
Proposal, Projection, and Admission chain. Earlier records remain immutable
history and cannot be consumed as current authority.

After Materialization, the basic M2.5 correction path is:

```text
user identifies incorrect formal intent
  -> cancel the materialized Goal when execution must stop
  -> preserve the original Intake/Goal audit chain
  -> create a new Intake Run from the correction
  -> materialize a new Goal only after current Admission succeeds
```

Cancellation is not success and does not erase work that may already have
started. M2.5 does not silently mutate Goal revision 1 or claim automatic
execution-time Goal revision.

M3 may reuse analysis, Source Binding, Material Ambiguity, and Admission Policy
primitives for a distinct `GoalRevisionAdmissionDecision`. That future path
must bind the current formal Goal revision and define invalidation of dependent
Plan, Context, Candidate, Evidence, and Acceptance authority. It does not reuse
`GoalMaterializationRecord` as revision authority.

## Persistence and Audit

Intake authority is stored in the CodeClosure-owned control location outside
the project and Candidate. Tables and codecs must use explicit typed IDs,
versions, enums, schemas, canonical profiles, and foreign-key relationships.

Every Intake mutation writes current state and its audit event in one
transaction. Raw Request revisions, Questions, Clarification Answer Bindings,
Proposals, Projection revisions, Admission Decisions, Materialization Records,
and Goal Start Authorizations are immutable. Startup validation and strict
reopen reject broken revision chains, missing or duplicate Answer Bindings,
active Questions that already have an Answer Binding, cross-run references,
multiple Materializations, conflicting Start authorizations, or retained formal
authority without its exact source records.

Verified SQLite activation includes every explicit and retained Intake
project/scope path under ADR 0034 before migration, recovery, or handler
publication. An allowed structured project correction on `intake clarify` is
included alongside, and never instead of, all retained paths. The bootstrap
snapshot is a denial input for filesystem isolation, not Raw Request, Source
Binding, Admission, Goal, or recovery authority. Only later Runtime validation
of the exact version, project-identity Question ID, both question digests, and
issuing Decision can bind that explicit path to a new revision. The
post-migration decoded retained Intake/Goal project-reference set must match the
retained pre-migration snapshot, while the current explicit path is separately
revalidated through the same lease before Runtime may commit it. Subsequent
strict reads and reopen then include the new retained reference.

Audit payloads store safe projections and digests, not unrestricted request,
assistant, project, or exception text. Status and audit views explain source
authority but cannot create or change it.

Every authority-bearing digest uses one named, schema-versioned ADR 0006
projection and excludes its own digest field. Proposal, Projection, Admission,
Materialization, and Start-Authorization semantic digests exclude generated
record IDs and Runtime-authored envelope timestamps unless a time-dependent
policy explicitly includes a source-bound observed-time input. Runtime times
still obey causal floors and remain auditable. The Admission Decision therefore
binds `questionSpecDigest`, not the generated Question ID, in its semantic
projection. `ClarificationQuestion.questionDigest` is separately declared an
exact relationship projection and includes the Question ID plus issuing
Decision ID/digest; this distinguishes exact answer authority from equivalent
question semantics without a cyclic digest. A clarification Raw Request digest
includes its embedded `AnsweredQuestionBinding`; the later
`ClarificationAnswerBinding.answerBindingDigest` includes that exact revision
digest plus its Question, Decision, and command bindings. Neither projection
binds the later Answer Binding from the Raw Request side, so the complete
answer chain remains acyclic.

## Privacy and Retention

Natural-language requests may contain credentials, personal information,
customer data, source excerpts, or confidential business context. Intake must
define separate retention policy for:

- exact admitted Raw Request source content;
- redacted display content;
- assistant request and response payloads;
- optional project observations;
- Projection, Source Binding, ambiguity, Question, and clarification Answer
  Binding records;
- Admission and Materialization records; and
- diagnostic transcripts and worker-session state.

CodeClosure-owned credentials, content deterministically classified as
prohibited by the installed retention policy, and unrecognized client-envelope
fields MUST NOT enter authoritative records or audit. This is a fail-closed
handling rule for known protected inputs, not a claim that arbitrary natural
language can be semantically proven secret-free.
A redacted display is a derived view and cannot replace authority-bearing Raw
Request bytes. A digest alone does not preserve `USER_STATED` eligibility after
those bytes become unavailable. The bounded M2.5 retention profile therefore
MUST retain exact safe admitted source content for as long as dependent Intake
or Materialization authority is retained. A future erasure policy may preserve
historical digests and audits, but it must mark unavailable source content
explicitly and MUST NOT use it for a new Admission or Materialization decision.
Content-addressed storage alone does not imply indefinite retention.

M2.5 requires a bounded local policy. Long-term business knowledge and richer
privacy UX remain later milestone work.

The initial local profile makes “safe admitted source” deterministic rather
than heuristic. It accepts only well-formed UTF-8 with no NUL, no unpaired
surrogate, and no C0/C1 control character other than TAB, LF, and CR. It splits
decoded content on CRLF, lone CR, or lone LF without Unicode normalization.
Marker matching removes only leading and trailing ASCII SPACE/TAB from each
line.

The trimmed line matches a private-key marker only when it is byte-for-byte
equal to `"-----" + ("BEGIN " | "END ") + LABEL + "-----"`, using ASCII
case-sensitive bytes and one of these exact `LABEL` values:
`PRIVATE KEY`, `ENCRYPTED PRIVATE KEY`, `RSA PRIVATE KEY`, `DSA PRIVATE KEY`,
`EC PRIVATE KEY`, `OPENSSH PRIVATE KEY`, and `PGP PRIVATE KEY BLOCK`. The
complete field-marker set is ASCII case-insensitive `authorization`,
`proxy-authorization`, `cookie`, `set-cookie`, `password`, `passwd`, `secret`,
`client_secret`, `api_key`, `apikey`, `access_token`, `refresh_token`, or
`private_key` at the start of the trimmed line, followed by zero or more ASCII
SPACE/TAB and then `:` or `=`. No other whitespace, case folding, substring,
decoded-value, or semantic-secret rule is implied.

Before creating a Raw Request revision, any match rejects the submission and
retains only profile identity, typed reason, byte count, and command/audit
identity—never submitted content bytes or their content digest. The same
UTF-8/control/marker classifier runs over every decoded assistant-authored
string after wire-schema validation and before Proposal or Answer retention.
Rejected Intent-analysis content becomes terminal
`FAILED / RESPONSE_REJECTED`; rejected Answer-only content becomes
`NO_EXECUTION / ANSWER_FAILED / RESPONSE_REJECTED`; neither retains rejected
payload bytes or a payload digest. The ordinary typed Failure/AnswerFailed
record still has its own semantic record digest. This is a closed syntactic
local policy, not a claim that CodeClosure can infer every semantic secret. A
rejected user request must be safely restated; masking never preserves
`USER_STATED` authority.

## Failure and Invalidation

The following fail closed for the dependent action:

- malformed, unknown, oversized, stale, or cross-run assistant output;
- missing or mismatched Intake Manifest input;
- model-authored identity, digest, Source Binding, provenance class, ambiguity
  status, Admission outcome, or Start authorization;
- a partial Proposal/Projection binding, Projection fields on a pre-analysis
  decision, a missing Materialization project/scope, or another invalid Decision
  variant combination;
- a redacted display, omission marker, synthetic replacement, or unavailable
  source offered as `USER_STATED` content;
- Answer-only content offered as a Source Binding, Fact, Criterion, Human
  Decision, Evidence, Acceptance input, Goal, or execution instruction;
- a material field supported only by model inference;
- an unresolved material ambiguity at Admission time;
- a Projection without a required success criterion;
- user input, Projection, source, scope, or policy change before Materialization;
- principal, project, policy, revision, or digest mismatch;
- duplicate or concurrent Materialization with inconsistent input;
- App Server interruption, Compact, Thread replacement, or process exit;
- unauthorized project exploration;
- persistence, audit, or migration failure; and
- ambiguous retained state after restart.

Failure does not imply Materialization or Start. Recovery reloads persisted
Intake authority and reconciles any external project observation before
selecting a legal next action. In M2.5, a terminal failed Run cannot make
another assistant call; a user-requested retry starts a new Intake Run. A
failure after committed Materialization cannot erase the resulting Goal.

An analysis/observation/preparation failure that can be recorded transitions the
current Run to terminal `FAILED` with a typed Failure Record. Answer-only
delivery failure instead remains `NO_EXECUTION / ANSWER_ONLY` with
`ANSWER_FAILED`. M2.5 never silently recalls the assistant while reopening or
replaying either result.

## Milestone Boundary

### M2

M2 implements the Goal-bound Codex Worker vertical slice. It must leave the
Codex App Server client separable from WorkerPort semantics. Intent Analysis,
Intent Admission, automatic Goal Materialization, Intake persistence, and
Intake CLI are explicit M2 non-scope.

### M2.5

The basic vertical slice implements Raw Request revisions, IntakeRun, assistant
analysis proposals, Intent Projection revisions, Source Bindings, Material
Ambiguity, bounded clarification, deterministic Intent Admission, atomic Goal
Materialization, bounded non-authoritative Answer-only results, terminal Intake
failure/restart handling, optional separately committed automatic Start, basic
CLI/read views, persistence/reopen, and adversarial authority tests.

Basic M2.5 does not require broad project exploration, full Fact Graph,
automatic Goal revision, multiple simultaneous Questions, batch answers, a
Question lifecycle state machine, rich TUI, multiple Intake agents, or a
long-term business knowledge base.

### M2.5.1

The post-completion closure has accepted its Slice 0 contract and versions the
corrected Intake Assistant Profile and Adapter, preserves retained version-1
authority, and makes real Answer-only and Intent-analysis compatibility
mandatory evidence. Its bounded
supported composition requires an exact real Codex Execution Profile rather
than the M1 FakeWorker Profile before Materialization, records it in
`GoalStartAuthorization`, and resolves it through the separate ordinary Start
path. That Profile maps `DISCOVERY` and `PLAN` to real candidate-free Codex over
exact Runtime-owned read-only selected-source snapshots and `IMPLEMENT` to real
Candidate-bound Codex execution; the current mixed M2 demo does not satisfy
that claim. Unsupported project/configuration/instruction or project-read
workspace isolation fails preflight and cannot fall back to FakeWorker.

M2.5.1 does not let the user or model select the Profile, rebind an existing
Workflow, permit new Intake effects, synthesize protected checks, or merge
Materialization with Start. Candidate-free phases cannot read or write the
checkout or create a Candidate; Candidate authority still begins at
`PLAN -> IMPLEMENT`,
the implementation Worker writes only the isolated Candidate, and only the
Acceptance Engine may issue technical `ACCEPT`. Fake Worker, Candidate Source,
and Verification components remain explicit deterministic test infrastructure
only. Accepted
[ADR 0043](adr/0043-candidate-free-codex-project-read-authority.md) closes the
candidate-free project-read snapshot, Context, isolation, source-currency,
configuration/instruction, cleanup, and recovery authority before production
implementation.

### M2.6

The proposed M2.6 Frontstage may persist one exact current-message handoff and
invoke existing public submit or clarification facades. It does not reinterpret
session history as a Raw Request, let a model select the trusted interaction
action, change Admission, merge Materialization with Start, or add a second
Intake lifecycle. See [Frontstage Interaction](frontstage-interaction.md).

### M2.7

The proposed local Runtime Host keeps the same public Intake facade and
interaction actions. A project execution slot is checked only by the later
ordinary `StartGoal`. An occupied slot cannot roll back Materialization,
silently convert governed execution to materialize-only, or create hidden
delayed-start authority. See [Local Runtime Host](runtime-host.md).

### M3 and M4

M3 may add project-assisted Intake, Fact/Scenario provenance, relevance
selection, unresolved-fact integration, and a distinct execution-time Goal
Revision Admission contract. M4 may add complete Human Decision UX,
privacy/retention controls, operator burden and quality metrics, and
model-version comparison.

## Implemented Runtime Invariant

M2.5 Slice 1 added canonical Runtime invariant `I-032` with executable tests:

```text
Intent proposals cannot admit or materialize themselves.
```

That invariant proves that model output cannot create or revise a
formal Goal, only a deterministic Admission Decision over exact source-bound
input can authorize Materialization, and automatic Start still passes the
ordinary `StartGoal` boundary.

## Required User and Adversarial Tests

The completed M2.5 assessment covers at least:

1. a clear source-bound execution command materializes exactly one Goal and
   binds exactly one Goal Start Authorization plus its automatic ordinary Start
   command identity;
2. a material ambiguity produces exactly one active bounded question and no
   Goal; clarification binds its exact Question ID, specification/record
   digests, and issuing Decision; an accepted answer creates one bound Raw
   Request revision and unique immutable Answer Binding while clearing the
   active reference; positional, stale, foreign, already answered, or
   mismatched question input fails closed;
3. Answer-only returns either bounded `ANSWER_RETURNED` content or a typed
   `ANSWER_FAILED` result while creating no Goal, and exact committed replay
   does not call the assistant again;
4. exact non-default test Policies prove that `POLICY_DENIED` and `UNSUPPORTED`
   remain distinct non-execution results while the installed local-v1 registry
   contains neither rule; exact-version local abandonment is accepted only from
   `NEEDS_CLARIFICATION`, commits its `ABANDON_CLARIFICATION` reservation,
   complete Question/Decision/command `AbandonmentBinding`, terminal Decision,
   cleared active reference, `APPLIED` outcome, and audits atomically, and
   creates no revision or assistant call;
5. a governed read-only repository investigation is not incorrectly treated as
   answer-only;
6. assistant output claiming Admission, Goal identity, user action, or formal
   authority;
7. malformed, invalid UTF-8, duplicate-key, unknown-field, null-versus-omitted,
   missing-array, duplicate-array-item, invalid item-index/span, non-integer,
   oversized, and cross-Intake Proposal or Answer-only payloads;
8. Proposal, Projection, revision, digest, parent-chain, Source Binding, and
   project/scope mismatch, including partial bindings, Projection fields on a
   pre-analysis Decision, missing project/scope on `MATERIALIZE`, substituted
   Question-plan/Decision binding, prompt, affected fields, answer schema,
   question-spec/record digest, issuing Decision, embedded
   `AnsweredQuestionBinding`, or immutable Answer Binding, an unrelated
   clarification attempting a project correction, and a permitted structured
   correction failing to include both retained and explicit roots in
   pre-activation isolation;
9. a material Projection field supported only by model inference, redacted
   display text, an omission marker, or unavailable source content, plus exact
   private-key/field marker positive and near-miss cases proving rejected user
   and assistant payload bytes/content digests are not retained while the typed
   rejection record keeps only its own semantic digest;
10. Answer-only content offered as Source Binding, Fact, Criterion, Human
    Decision, Evidence, Acceptance, Goal, Workflow, or execution authority;
11. new user input after an earlier Projection or Admission computation;
12. concurrent clarification answers, concurrent Materialization attempts, and
    exact command replay producing at most one respective effect;
13. injected failure at every `CLARIFY` Decision/Question/active-reference,
    clarification Raw Request/Answer-Binding/active-reference, Goal/Workflow/
    Materialization/Start-Authorization/audit/outcome write boundary;
14. a crash before Start, a failure during Start, Intake replay followed by the
    separately resubmitted exact preallocated Start command, and replay after
    Start commit;
15. the preallocated automatic `StartGoal` racing a different explicit manual
    `StartGoal`, with exactly one first-Start Policy/Profile binding, Context,
    Attempt, dispatch claim, and typed loser outcome;
16. substitution of the Start Authorization's command, Goal/Workflow version,
    Policy, Execution Profile, or digest binding;
17. `MATERIALIZE_ONLY` input attempting to obtain automatic Start;
18. correction after Materialization attempting silent Goal mutation;
19. assistant timeout, unavailability, protocol failure, and interrupted
    analysis producing one terminal typed `FAILED` result with no automatic
    recall;
20. restart resolving a valid orphaned `ANALYZING` Run by reservation operation
    kind before another assistant call: Intent analysis becomes exactly one
    `FAILED / INTERRUPTED_ANALYSIS` result, while Answer-only becomes exactly
    one `APPLIED / NO_EXECUTION / ANSWER_FAILED /
    INTERRUPTED_ANSWER_DELIVERY` result;
21. restart with missing, duplicate, cross-Intake, or digest-mismatched
    clarification Answer Bindings, an answered active Question, or other
    partial, contradictory, mixed-terminal, or corrupted Intake authority;
22. Codex process exit, Compact, Thread loss, and interrupted proposal stream;
23. Intake adapter or project explorer attempting Store, Goal, Workflow,
    Candidate, Evidence, source-write, WorkerPort, or StartGoal access;
24. Intake observation or Answer-only content offered as Goal-bound Evidence;
25. direct `CreateGoal` regression without synthesized Intake records; and
26. successful strict reopen reproducing the exact Question-to-Raw-Request-to-
    Answer-Binding-to-Projection-to-Admission-to-Goal authority chain and
    separate Start disposition.
