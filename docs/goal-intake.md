# CodeClosure Goal Intake

## Status

This document defines the accepted target contract for pre-Goal Intake under
[ADR 0027](adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md).
Goal Intake is not implemented. M2 must preserve the reusable App Server client
seam but does not implement this user flow; the first planned implementation is
the M2.5 vertical slice in [the milestone document](milestones.md).

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
                  |-- CLARIFY -> bounded question -> new Raw Request Revision
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

The planned Coordinator owns `IntakeRun` sequencing and validated creation of
Intake records. It:

- persists Raw Request revisions outside model and project authority;
- constructs Intake Packages;
- invokes an Intake Assistant through a narrow port;
- validates untrusted assistant output;
- allocates Proposal, Projection, question, and decision identities;
- constructs Runtime-owned Source Bindings and ambiguity classifications;
- computes canonical digests;
- classifies and persists bounded Answer-only results and Intake failures;
- persists records, status changes, and audit atomically; and
- exposes typed read views and next actions.

It cannot issue an Admission Decision on its own, create or revise a formal
Goal, mutate Workflow state, issue technical Acceptance, write a Candidate, or
authorize Promotion.

### Goal Intake Assistant Adapter

The planned adapter translates an Intake-specific request to an assistant such
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

The planned Engine evaluates one exact immutable admission input under one
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
revision-chain binding. Generated record IDs, Runtime-authored `submittedAt`,
and the digest field itself remain envelope metadata as declared by the owning
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

A clarification answer or correction creates a new immutable revision. It
does not rewrite what the user previously said.

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
  activeQuestionRefs[]
  terminalDecisionRef?
  terminalFailureRef?
  answerOnlyResponseRef?
  materializedGoalRef?
  createdAt
  updatedAt
```

Planned `IntakeRunStatus` values are:

- `ANALYZING`;
- `NEEDS_CLARIFICATION`;
- `MATERIALIZED`;
- `NO_EXECUTION`; and
- `FAILED`.

Abandonment is a `NO_EXECUTION` outcome with reason `ABANDONED`. These values
must not be added to `WorkflowPhase` or `RunStatus`.

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

## Intent Analysis Proposal

`IntentAnalysisProposal` is a strictly bounded, immutable record of assistant
output after transport and schema validation. It is still untrusted.

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
  proposedClassification?
  proposalDigest
  observedAt
```

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
  objective
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

One or more unresolved material ambiguities require `CLARIFY`. The same
transaction persists bounded `ClarificationQuestion` records:

```text
ClarificationQuestion
  id
  intakeRunId
  basedOnProjectionRevision?
  ambiguityRef
  prompt
  affectedFields[]
  answerSchema
  createdAt
  answeredByRawRequestRevision?
```

Questions are prioritized and bounded. The system SHOULD avoid asking for
facts that formal `DISCOVERY` can safely establish later, and MUST NOT force
the user to choose implementation details that do not change Goal intent or
authorization.

An answer is a new user-input revision with its own provenance. It may lead to
a new Proposal and Projection; it does not mutate earlier records in place.

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
  projectOrScopeRef?
  outcome = NO_EXECUTION
  reasonCode
  executionDisposition = NONE

ClarifyIntentDecision
  common
  kind = CLARIFY
  projectionBinding
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
`CLARIFY` requires at least one current unresolved Material Ambiguity.
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
pre-analysis `ANSWER_ONLY`, policy denial, unsupported request, or abandonment
may use `PRE_ANALYSIS_NO_EXECUTION` without calling an assistant for Admission
or creating empty Proposal/Projection records when the trusted action and policy
inputs are already dispositive. A separate Answer-only call may still produce
the requested non-authoritative response; it is not Intent analysis and cannot
change the Admission outcome.

For fixed canonical input and policy, the Admission Engine must produce the
same outcome, ordered reason trace, and decision digest. It cannot call the
assistant while deciding.

`decisionDigest` covers the exact semantic input bindings, Admission Policy,
decision kind, outcome, reason code, ordered reason trace, and execution
disposition. It excludes record ID, Runtime-authored `decidedAt`, and itself. A
time-sensitive rule must use an explicit source-bound observed-time input rather
than ambient wall time.

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

- `CLARIFY` persists the Decision, questions, `NEEDS_CLARIFICATION` status,
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
`RESPONSE_REJECTED`. Raw adapter exceptions and unknown response fields do not
enter the record or audit.

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
`ASSISTANT_PROTOCOL_ERROR`, `INTERRUPTED_ANALYSIS`,
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

After acquiring exclusive Runtime ownership on startup, M2.5 reconciles a valid
persisted `ANALYZING` Run that has no committed Proposal/Decision and no
supported resumable Intake operation to `FAILED / INTERRUPTED_ANALYSIS` in one
versioned audited transaction before any new assistant call. Missing,
contradictory, or corrupt authority still fails strict reopen rather than being
rewritten as an ordinary failure.

## Goal Materialization

Goal Materialization consumes current pre-Goal authority and creates formal
Goal/Workflow authority.

The planned application request binds:

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

An exact replay returns the stored result without another effect. A stale
version, changed source, unresolved material ambiguity, mismatched project,
concurrent winner, reused identity with different input, or persistence failure
produces no partial formal authority.

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

The planned `IntakePackage` contains only policy-authorized inputs such as:

- exact Raw Request revisions and digests;
- the current Intent Projection revision and digest, when one exists;
- answered and unresolved Clarification Questions;
- declared project/scope identity;
- optional bounded project observations;
- required response schema and byte/collection budgets; and
- Intake policy and adapter identities.

The durable `IntakeManifest` records every included or intentionally omitted
input, its revision, provenance, digest, and budget decision. It does not carry
fabricated Goal, Workflow, phase, Attempt, Worker Session, Candidate, Policy
binding, Execution Profile binding, or Acceptance identities.

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
transaction. Raw Request revisions, Proposals, Projection revisions, Admission
Decisions, Materialization Records, and Goal Start Authorizations are immutable.
Startup validation and strict reopen reject broken revision chains, missing
digests, cross-run references, multiple Materializations, conflicting Start
authorizations, or retained formal authority without its exact source records.

Audit payloads store safe projections and digests, not unrestricted request,
assistant, project, or exception text. Status and audit views explain source
authority but cannot create or change it.

Every authority-bearing digest uses one named, schema-versioned ADR 0006
projection and excludes its own digest field. Proposal, Projection, Admission,
Materialization, and Start-Authorization semantic digests exclude generated
record IDs and Runtime-authored envelope timestamps unless a time-dependent
policy explicitly includes a source-bound observed-time input. Runtime times
still obey causal floors and remain auditable.

## Privacy and Retention

Natural-language requests may contain credentials, personal information,
customer data, source excerpts, or confidential business context. Intake must
define separate retention policy for:

- exact admitted Raw Request source content;
- redacted display content;
- assistant request and response payloads;
- optional project observations;
- Projection, Source Binding, ambiguity, and question records;
- Admission and Materialization records; and
- diagnostic transcripts and worker-session state.

Secrets and unrecognized fields MUST NOT enter authoritative records or audit.
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
automatic Goal revision, rich TUI, multiple Intake agents, or a long-term
business knowledge base.

### M3 and M4

M3 may add project-assisted Intake, Fact/Scenario provenance, relevance
selection, unresolved-fact integration, and a distinct execution-time Goal
Revision Admission contract. M4 may add complete Human Decision UX,
privacy/retention controls, operator burden and quality metrics, and
model-version comparison.

## Planned Invariant

The owning M2.5 implementation is expected to add a canonical invariant with
executable tests equivalent to:

```text
Intent proposals cannot admit or materialize themselves.
```

That future invariant must prove that model output cannot create or revise a
formal Goal, only a deterministic Admission Decision over exact source-bound
input can authorize Materialization, and automatic Start still passes the
ordinary `StartGoal` boundary. It is not added to `RUNTIME_INVARIANTS.md` until
the owning implementation and executable test metadata land in the same
change.

## Required User and Adversarial Tests

Before M2.5 can claim completion, tests must cover at least:

1. a clear source-bound execution command materializes exactly one Goal and
   binds exactly one Goal Start Authorization plus its automatic ordinary Start
   command identity;
2. a material ambiguity produces bounded clarification and no Goal;
3. Answer-only returns either bounded `ANSWER_RETURNED` content or a typed
   `ANSWER_FAILED` result while creating no Goal, and exact committed replay
   does not call the assistant again;
4. denied, unsupported, and abandoned requests remain distinct non-execution
   results with `answerDisposition = NOT_REQUESTED`;
5. a governed read-only repository investigation is not incorrectly treated as
   answer-only;
6. assistant output claiming Admission, Goal identity, user action, or formal
   authority;
7. malformed, unknown-field, oversized, and cross-Intake Proposal or Answer-only
   payloads;
8. Proposal, Projection, revision, digest, parent-chain, Source Binding, and
   project/scope mismatch, including partial bindings, Projection fields on a
   pre-analysis Decision, and missing project/scope on `MATERIALIZE`;
9. a material Projection field supported only by model inference, redacted
   display text, an omission marker, or unavailable source content;
10. Answer-only content offered as Source Binding, Fact, Criterion, Human
    Decision, Evidence, Acceptance, Goal, Workflow, or execution authority;
11. new user input after an earlier Projection or Admission computation;
12. concurrent Materialization attempts and exact command replay;
13. injected failure at every Admission/Goal/Workflow/Materialization/Start-
    Authorization/audit/outcome write boundary;
14. a crash before Start, a failure during Start, and replay after Start commit;
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
20. restart converting a valid orphaned `ANALYZING` Run to exactly one
    `FAILED / INTERRUPTED_ANALYSIS` result before another assistant call;
21. restart with partial, contradictory, mixed-terminal, or corrupted Intake
    authority;
22. Codex process exit, Compact, Thread loss, and interrupted proposal stream;
23. Intake adapter or project explorer attempting Store, Goal, Workflow,
    Candidate, Evidence, source-write, WorkerPort, or StartGoal access;
24. Intake observation or Answer-only content offered as Goal-bound Evidence;
25. direct `CreateGoal` regression without synthesized Intake records; and
26. successful strict reopen reproducing the exact Raw Request-to-Projection-
    Admission-to-Goal authority chain and separate Start disposition.
