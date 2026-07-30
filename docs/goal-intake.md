# CodeClosure Goal Intake

## Status

This document defines the accepted target contract for pre-Goal Intake under
[ADR 0026](adr/0026-pre-goal-intake-and-goal-materialization-authority.md).
Goal Intake is not implemented. M2 must preserve the App Server client seam but
does not implement this user flow; the first planned implementation is the
M2.5 vertical slice in [the milestone document](milestones.md).

Nothing in this document changes the implemented M1 `CreateGoal` command, the
existing Workflow phase machine, technical Acceptance, or post-closeout
Promotion authority.

## Purpose

Goal Intake lets a user begin with a natural-language request that may be
incomplete, ambiguous, or missing executable success criteria. CodeClosure may
use an assistant to propose a structured interpretation and clarification
questions, but it creates a formal Goal only after the user confirms one exact
Draft revision.

The contract separates four truths:

```text
Raw Request
= what the user actually submitted

Goal Draft
= CodeClosure's proposed interpretation

Goal Confirmation
= the user's exact confirmation of one Draft revision

Formal Goal
= the Goal Manager's durable execution authority
```

## What Goal Intake Is Not

Goal Intake is not:

- the `DISCOVERY` Workflow phase;
- a coding Worker Attempt;
- a Codex Thread or conversation-history feature;
- an LLM judge of the user's true intent;
- a way to create criteria silently from model inference;
- a technical Acceptance decision;
- Candidate, Evidence, or project-change authority;
- merge, release, deployment, or another real-world Promotion; or
- an alternative Workflow mutation surface.

## Position in the Product

The target product path is:

```text
User natural-language request
  -> Raw Request
  -> Goal Draft Proposal and material questions
  -> validated Goal Draft revision
  -> exact user Confirmation
  -> Goal Materialization
  -> Formal Goal revision 1 + DISCOVERY / READY Workflow
  -> governed execution
```

Direct explicit `CreateGoal` remains available under its accepted M1 contract.
It enters the same Goal Manager and atomic Goal/Workflow creation boundary but
does not fabricate Intake history.

## Authority Boundary

The pre-Goal trust boundary is:

```text
Natural-language input
  -> immutable Raw Request

Codex or another assistant output
  -> untrusted Goal Draft Proposal

Intake Coordinator validation
  -> immutable Goal Draft revision

Exact user action
  -> immutable Goal Confirmation

Goal Manager validation + Runtime transaction
  -> Formal Goal and Workflow authority
```

No earlier arrow authorizes a later record by itself. Every boundary validates
schema, identity, revision, digest, provenance, size, and current-state
preconditions before persistence.

## Actors and Ownership

### User

The user owns the real request, priorities, business meaning, and confirmation
that one displayed Draft accurately represents the intended Goal. The user is
not required to know CodeClosure's internal artifact model or write a complete
Criterion before Intake begins.

User confirmation does not prove technical correctness and does not authorize
an external effect.

### Goal Intake Coordinator

The planned Coordinator owns IntakeRun sequencing and the validated creation
of Intake records. It:

- persists Raw Requests outside model and project authority;
- constructs Intake Packages;
- invokes an Intake Assistant through a narrow port;
- validates untrusted assistant output;
- allocates Draft identities and revisions;
- computes canonical Draft digests;
- persists questions, Drafts, status changes, and audit atomically; and
- exposes typed read views and next actions.

It cannot create or revise a formal Goal, mutate Workflow state, issue
technical Acceptance, write a Candidate, or authorize Promotion.

### Goal Intake Assistant Adapter

The planned adapter translates an Intake-specific request to an assistant such
as Codex App Server and translates protocol output back into a closed proposal
schema. It receives no Goal-bound WorkerPort request, Store mutation port,
Candidate capability, Acceptance capability, or user-confirmation authority.

The adapter does not assign authoritative record IDs, revisions, timestamps,
digests, provenance classifications, or lifecycle states.

### Confirmation Gateway

The planned Gateway captures an explicit confirmation or rejection action from
an identified principal and binds it to the exact currently displayed Draft.
It validates action shape and scope, while Runtime-owned identity, clock, and
digest providers author the stored record.

The Gateway cannot infer confirmation from continued conversation, a generic
approval, inactivity, model prose, or a Codex lifecycle event.

### Goal Manager

The Goal Manager validates the exact confirmed objective, required success
criteria, scope, and non-goals and owns the resulting formal Goal identity and
revision. It rejects an incomplete, stale, contradictory, or policy-invalid
formal projection.

It does not independently mutate Workflow state.

### Workflow Runtime and trusted Store

The Workflow Runtime constructs the initial `DISCOVERY / READY` Workflow under
the existing one-writer rule. The trusted Store commits Goal, Workflow,
Materialization, audit, and command outcome in one transaction. A partial
formal result is never visible through a successful public API.

## Raw Request

`RawRequest` is the immutable record of one admitted user submission.

```text
RawRequest
  id
  intakeRunId
  principalRef
  submittedContent
  contentDigest
  declaredProjectRef?
  declaredConstraints[]
  schemaVersion
  retentionProfile
  submittedAt
```

The stored content follows an explicit privacy and retention profile. The
canonical digest binds the schema-owned persisted representation, not an
unbounded client envelope. Secrets and unsupported fields are rejected or
redacted according to policy before authoritative persistence.

Appending a later user message creates another immutable user-input record or
a new Raw Request revision relationship; it does not rewrite what the user
previously said.

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
  activeGoalDraftRevision?
  activeQuestionRefs[]
  createdAt
  updatedAt
```

Planned `IntakeRunStatus` values are:

- `DRAFTING`;
- `NEEDS_CLARIFICATION`;
- `READY_FOR_CONFIRMATION`;
- `CONFIRMED`;
- `MATERIALIZED`;
- `ABANDONED`; and
- `FAILED`.

These values must not be added to `WorkflowPhase` or `RunStatus`.

## Goal Draft

`GoalDraft` is an immutable proposed interpretation, not formal user intent.

```text
GoalDraft
  id
  intakeRunId
  revision
  parentRevision?
  objective
  requiredCriteria[]
  optionalCriteria[]
  scope
  nonGoals[]
  assumptions[]
  unresolvedQuestionRefs[]
  sourceRefs[]
  schemaVersion
  canonicalProfileVersion
  draftDigest
  createdAt
```

The Intake Coordinator derives every identity, revision, timestamp, canonical
projection, and digest after validating the proposal. Model-authored IDs,
digests, timestamps, classifications, or unknown fields are never copied into
authority.

Changing any confirmation-bearing content creates a new revision. Revisions
are immutable and form one explicit parent chain. A later Draft revision does
not erase the Raw Request or earlier proposal history.

A Draft can reach `READY_FOR_CONFIRMATION` only when:

- it contains a non-blank objective;
- it contains at least one explicit required success criterion;
- project and scope identity are sufficiently bounded for policy;
- every material unresolved question is answered or remains visibly blocking;
- assumptions and non-goals are visible rather than hidden in prose; and
- its canonical digest can be reproduced from the persisted projection.

Readiness means only that the Draft may be shown for confirmation.

## Clarification Question

`ClarificationQuestion` represents one material ambiguity whose possible
answers may change objective, required criteria, scope, non-goals, risk, or
project identity.

```text
ClarificationQuestion
  id
  intakeRunId
  basedOnDraftRevision?
  prompt
  reasonCode
  affectedFields[]
  answerSchema
  status
  createdAt
  answeredByRecordRef?
```

Questions are bounded and prioritized. The system SHOULD avoid asking for
facts it can safely derive later during formal `DISCOVERY`, and MUST NOT force
the user to choose implementation details that do not change Goal intent.

An answer is user input with its own provenance. It may authorize a new Draft
proposal; it does not mutate an earlier Draft in place.

## User Confirmation

`GoalConfirmation` is immutable confirmation of one exact Draft.

```text
GoalConfirmation
  id
  rawRequestId
  intakeRunId
  goalDraftId
  goalDraftRevision
  goalDraftDigest
  projectOrScopeRef
  principalRef
  action
  schemaVersion
  confirmationPolicyVersion
  confirmedAt
  confirmationDigest
```

The supported confirmation action for Materialization is explicit and typed.
Reject, edit, request clarification, and abandon are different actions and do
not authorize Goal creation.

The Confirmation Gateway and Runtime MUST verify that the user-visible Draft
identity and digest match the stored current Draft. Confirmation cannot be
accepted from assistant output, a transcript summary, a stale browser view, a
different principal, a different project, or an unbound generic approval.

Creating a newer confirmation-bearing Draft revision makes the earlier
Confirmation ineligible for new Materialization. Historical Confirmation
remains readable for audit.

## Goal Materialization

Goal Materialization consumes current pre-Goal authority and creates formal
execution authority.

The planned application request binds:

```text
MaterializeGoalRequest
  commandId
  expectedIntakeRunVersion
  rawRequestId
  goalDraftId
  goalDraftRevision
  goalDraftDigest
  goalConfirmationId
  goalConfirmationDigest
  expectedProjectOrScopeRef
```

The compound transaction creates exactly:

- one formal Goal at revision 1;
- its one initial `DISCOVERY / READY` Workflow;
- the synchronized initial Goal lifecycle projection;
- one immutable Goal Materialization Record;
- required Goal, Workflow, Intake, and Materialization audit events; and
- one idempotent processed command outcome.

The Materialization Record binds the complete consumed identities and digests
to the resulting Goal and Workflow. It is not technical Acceptance and cannot
authorize closeout or external Promotion.

An exact replay returns the stored result without another effect. A stale
version, changed Draft, mismatched Confirmation, concurrent winner, reused ID
with different input, or persistence failure produces no partial formal
authority.

## Draft Lifecycle

The pre-Goal lifecycle is separate from the main Workflow:

```text
Raw Request
  -> DRAFTING
  -> NEEDS_CLARIFICATION
  -> DRAFTING
  -> READY_FOR_CONFIRMATION
  -> CONFIRMED
  -> MATERIALIZED
  -> Create formal Goal and DISCOVERY / READY Workflow
```

The lifecycle may instead enter `ABANDONED` by explicit user action or `FAILED`
after a closed non-success condition. A failure may be recoverable only through
a new versioned command with current authority; retry is not implicit success.

`MATERIALIZED` is terminal for one Intake Run. Editing intent after
Materialization is a formal Goal revision concern, not reopening the original
Draft.

## Information Classification

Intake information must retain a closed provenance class. The initial target
classes are:

- `USER_STATED` — content the user actually submitted;
- `PROJECT_OBSERVED` — bounded read-only project observation;
- `POLICY_DERIVED` — deterministic output of a named CodeClosure policy;
- `MODEL_PROPOSED` — assistant interpretation or inference; and
- `UNRESOLVED` — required information not yet established.

Classification is Runtime-owned. A model cannot label its own inference as
user-stated or confirmed. The Draft must expose material model proposals and
assumptions before confirmation.

User Confirmation confirms the exact Draft projection as the intended formal
Goal input. It does not retroactively transform each supporting model or
project observation into a confirmed Fact or Acceptance Evidence.

## Intake Context and Codex Calls

Goal-bound Context currently requires Goal, Workflow, phase, Attempt, Policy,
and execution-profile identities. Intake has none of those before
Materialization and therefore uses a distinct contract.

The planned `IntakePackage` contains only policy-authorized inputs such as:

- Raw Request excerpts and their exact digests;
- the current Draft revision and digest, when one exists;
- answered and unresolved Clarification Questions;
- declared project/scope identity;
- optional bounded project observations;
- required response schema and size budget; and
- Intake policy and adapter identities.

The durable `IntakeManifest` records every included or intentionally omitted
input, its revision, provenance, digest, and budget decision. It does not carry
fabricated Goal, Workflow, phase, Attempt, Worker Session, Candidate, or
Acceptance identities.

Low-level canonical rendering, byte-budget, digest, and protocol utilities may
be shared with the Goal-bound Context system. `IntakePackage` and
`ContextPackage` remain different authority contracts and codecs.

Codex conversation history is disposable convenience context. Compaction,
Thread replacement, or process restart cannot remove the authoritative Raw
Request, Draft, question, Confirmation, or Materialization records.

## Optional Read-only Project Exploration

Project-assisted Intake is optional planned behavior, not a prerequisite for
the basic M2.5 vertical slice. When enabled, it runs through a dedicated
read-only exploration port with:

- an explicitly authorized and resolved project root;
- no Candidate or source-write capability;
- no control-store path access;
- a closed operation set and hard byte, file, time, and command budgets;
- an exact project/source observation identity;
- provenance and omission records; and
- interruption and failure behavior that remains non-success.

The assistant may propose that observed project structure changes the Draft or
raises a question. The Intake Coordinator decides whether to create a new
Draft revision after validation.

## Interaction with DISCOVERY

`DISCOVERY` starts only after Materialization has created a formal Goal and
Workflow. Its responsibility remains to inspect project facts, applicable
business scenarios, code surfaces, risks, and the smallest safe planning
depth under that exact Goal revision.

Intake asks, "What does the user intend CodeClosure to govern?"
`DISCOVERY` asks, "What is true in the project and business scope for this
already formal Goal?"

Information collected during Intake may guide later discovery selection, but
it is not silently promoted into a confirmed Goal Fact. Formal discovery must
revalidate any fact required for planning, capability, or Acceptance.

## Goal Revision

Execution may later reveal ambiguity that changes objective, required criteria,
scope, or non-goals. That is not an IntakeRun reopening and cannot be performed
by a Worker.

The planned later-milestone path is:

```text
DISCOVERY / PLAN / IMPLEMENT
  -> WAITING_FOR_INPUT
  -> Goal Revision Proposal
  -> exact user confirmation
  -> Goal Manager creates a new Goal revision
  -> dependent Plan, Context, Candidate, Evidence, and Acceptance authority
     becomes stale or invalid according to policy
  -> Workflow resumes only from reconciled current authority
```

M2.5 does not need automatic execution-time Goal revision to exit. Project-
assisted Goal revision and dependency invalidation are planned with the later
Fact Graph and Human Decision work.

## Persistence and Audit

Intake authority is stored in the CodeClosure-owned control location outside
the project and Candidate. Tables and codecs must use explicit typed IDs,
versions, enums, schemas, canonical profiles, and foreign-key relationships.

Every Intake mutation writes current state and its audit event in one
transaction. Immutable Draft, Confirmation, and Materialization records cannot
be updated in place. Startup validation and strict reopen must reject broken
revision chains, missing digests, cross-run references, multiple
Materializations, or retained formal authority without its exact source
records.

Audit payloads store safe projections and digests, not unrestricted request,
assistant, project, or exception text. Status and audit views explain source
authority but cannot create or change it.

## Privacy and Retention

Natural-language requests may contain credentials, personal information,
customer data, source excerpts, or confidential business context. Intake must
define separate retention policy for:

- admitted Raw Request content;
- redacted display content;
- assistant request and response payloads;
- optional project observations;
- Draft and question records;
- Confirmation records; and
- diagnostic transcripts.

Secrets and unrecognized fields MUST NOT enter authoritative records or audit.
Content-addressed payload retention does not imply indefinite retention.
Deletion or redaction policy must preserve enough digest and audit identity to
explain authority without retaining prohibited raw content.

M2.5 requires a bounded local policy. Long-term business knowledge and richer
privacy UX remain later milestone work.

## Failure and Invalidation

The following fail closed for the dependent action:

- malformed, unknown, oversized, or stale assistant output;
- missing or mismatched Intake Manifest input;
- model-authored identity, digest, confirmation, or authority label;
- an unresolved material question at confirmation time;
- a Draft without a required success criterion;
- a Draft or scope change after Confirmation;
- principal, project, policy, revision, or digest mismatch;
- duplicate or concurrent Materialization with inconsistent input;
- App Server interruption, Compact, Thread replacement, or process exit;
- unauthorized project exploration;
- persistence, audit, or migration failure; and
- ambiguous retained state after restart.

Failure does not imply Materialization. Recovery reloads persisted Intake
authority and reconciles any external project observation before another
assistant call or formal creation attempt.

## Milestone Boundary

### M2

M2 implements the Goal-bound Codex Worker vertical slice. It must leave the
Codex App Server client separable from WorkerPort semantics. Goal Intake user
flow, persistence, and CLI are explicit M2 non-scope.

### M2.5

The basic vertical slice implements Raw Request, versioned Draft, assistant
proposal, bounded clarification, exact Confirmation, atomic Materialization,
basic CLI/read views, persistence/reopen, and adversarial authority tests.

Basic M2.5 does not require broad project exploration, full Fact Graph,
automatic Goal revision, rich TUI, multiple Intake agents, or a long-term
business knowledge base.

### M3 and M4

M3 may add project-assisted Intake, Fact/Scenario provenance, relevance
selection, unresolved-fact integration, and execution-time Goal Revision
Proposal. M4 may add complete Human Decision UX, privacy/retention controls,
operator burden and quality metrics, and model-version comparison.

## Planned Invariant

The owning M2.5 implementation is expected to add a canonical invariant with
executable tests equivalent to:

```text
Goal proposals cannot materialize themselves.
```

That future invariant must prove that model output cannot create or revise a
formal Goal, stale Confirmation cannot be reused, and only the exact Goal
Manager/Runtime transaction can materialize formal authority. It is not added
to `RUNTIME_INVARIANTS.md` until the owning implementation and executable test
metadata land in the same change.

## Required Adversarial Tests

Before M2.5 can claim completion, tests must cover at least:

1. assistant output claiming confirmation or a formal Goal;
2. malformed, unknown-field, oversized, and cross-Intake proposal payloads;
3. Draft ID, revision, digest, parent-chain, and source-reference mismatch;
4. Confirmation copied from another principal, project, Draft, revision, or
   digest;
5. Draft revision after Confirmation;
6. generic approval, conversation continuation, and model-authored approval;
7. concurrent Materialization attempts and exact command replay;
8. injected failure at every Goal/Workflow/Materialization/audit/outcome write
   boundary;
9. restart with partial, contradictory, or corrupted Intake authority;
10. Codex process exit, Compact, Thread loss, and interrupted proposal stream;
11. Intake adapter or project explorer attempting Store, Candidate, or source
    write access;
12. Intake observation offered as Goal-bound Evidence;
13. direct `CreateGoal` regression without synthesized Intake records; and
14. successful Materialization producing exactly one Goal revision 1, one
    `DISCOVERY / READY` Workflow, one Materialization Record, matching audit,
    and an identical strict-reopen view.
