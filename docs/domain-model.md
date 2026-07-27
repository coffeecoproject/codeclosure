# CodeClosure Domain Model

## Status

This document defines the canonical M0 semantic contract. It does not describe
an implemented runtime. M1 implements only the subset named in
[`milestones.md`](milestones.md) and the
[`M1 implementation plan`](plans/m1-deterministic-skeleton.md).

## Design Rules

- Domain identity is independent of worker-session identity.
- Every mutable aggregate has an explicit revision or version.
- External observations and model proposals are not silently promoted into
  authoritative records.
- State transitions occur through commands handled by the Workflow Runtime.
- Observation and decision content that supports acceptance is immutable.
- Eligibility and lifecycle state is stored separately and changes only through
  explicit, audited transitions; corrections create new records or revisions
  and invalidate dependent decisions.

The structures below define semantic contracts, not a frozen SQL schema.

## Typed Identifiers

At minimum, M1 uses distinct opaque identifiers for:

- `GoalId`
- `WorkflowId`
- `AttemptId`
- `CandidateId`
- `CandidateGenerationId`
- `FactId`
- `DecisionId`
- `EvidenceId`
- `AcceptanceDecisionId`
- `PolicyBundleId`
- `AuditEventId`
- `WorkerSessionId`

Implementations must not interchange these as untyped strings inside the
domain.

## Goal

The Goal is the externalized unit of intent.

```text
Goal
  id
  revision
  objective
  successCriteria[]
  scope
  nonGoals[]
  status
  createdAt
  updatedAt
```

`GoalStatus`:

- `ACTIVE`
- `WAITING_FOR_INPUT`
- `BLOCKED`
- `CANCELLED`
- `CLOSED`

Changing objective, success criteria, or scope creates a new Goal revision and
invalidates dependent plans, contexts, candidates, evidence, and acceptance as
required by policy.

## Success Criterion

```text
SuccessCriterion
  id
  goalId
  description
  required
  scenarioRefs[]
  verificationObligationRefs[]
```

A criterion is not considered satisfied because the worker repeats its text.
Acceptance rules map it to current evidence.

## Workflow Instance

```text
WorkflowInstance
  id
  goalId
  goalRevision
  phase
  runStatus
  version
  activeAttemptId?
  activeCandidateGenerationId?
  suspendedReason?
  createdAt
  updatedAt
```

`WorkflowPhase`:

- `DISCOVERY`
- `PLAN`
- `IMPLEMENT`
- `SOURCE_FREEZE`
- `EVIDENCE_BUILD`
- `FINAL_VERIFY`
- `CLOSEOUT`

`RunStatus` is orthogonal to phase:

- `READY`
- `RUNNING`
- `WAITING_FOR_INPUT`
- `BLOCKED`
- `FAILED`
- `CANCELLED`
- `CLOSED`

Separating phase from run status avoids inventing phases such as
`DISCOVERY_BLOCKED` and keeps resumption explicit.

## Attempt

An Attempt records one bounded effort to advance the workflow.
It is a child entity owned by the Workflow aggregate in M1, not an independently
versioned aggregate. `WorkflowInstance.version` serializes phase, run-status,
active-Attempt, and Attempt-lifecycle mutations.

```text
Attempt
  id
  workflowId
  phase
  sequence
  contextManifestId?
  capabilityGrant
  workerSessionRef?
  status
  failureClass?
  terminationReason?
  startedAt
  endedAt?
```

Worker sessions are references on attempts. Losing or compacting a worker
session does not lose the Attempt or Workflow.

`AttemptStatus`:

- `RUNNING` — the bounded operation has been durably started and is executing
  or awaiting a result;
- `RESULT_RECORDED` — the runtime has admitted and routed the operation result;
  this does **not** mean that the Candidate, Goal, or Workflow succeeded;
- `FAILED` — the bounded operation failed, with the specific failure category
  recorded separately;
- `INTERRUPTED` — the runtime ended the operation because of cancellation,
  reconciliation, or another controlled interruption.

M1 creates an Attempt as `RUNNING` in authoritative storage before worker
dispatch. It does not use a separate `PENDING` state. Recovery reconciles a
persisted `RUNNING` Attempt with external reality before dispatching more work.
Goal cancellation records the Workflow as `CANCELLED` and any active Attempt as
`INTERRUPTED`.

Commands that begin, finish, fail, or interrupt an Attempt MUST carry the
expected Workflow version. A successful command updates the Attempt, Workflow
version/current state, audit events, and idempotent command outcome in one
transaction. Only the active `RUNNING` Attempt may change lifecycle state, and
it may enter a terminal Attempt status only once.

`RESULT_RECORDED` is deliberately not named `SUCCEEDED`: a worker operation
ending normally or returning a Completion Request grants no acceptance or
closeout authority.

See [ADR 0007](adr/0007-workflow-owned-attempt-lifecycle.md) for the aggregate
boundary and concurrency rationale.

## Transition Request and Transition Record

```text
TransitionRequest
  workflowId
  expectedVersion
  requestedPhase
  reason
  supportingRefs[]
  actorType

TransitionRecord
  fromPhase
  toPhase
  fromVersion
  toVersion
  guardResults[]
  auditEventId
  occurredAt
```

A request may be rejected. Only a persisted `TransitionRecord` changes state.

## Worker Result

```text
WorkerResult
  attemptId
  workerSessionRef
  resultType
  proposedFacts[]
  observations[]
  completionRequest?
  protocolMetadata
```

`WorkerResult` is never written directly into authoritative aggregate tables.
The runtime validates and routes each contained proposal.

## Completion Request

```text
CompletionRequest
  attemptId
  claimedScope
  summary
  proposedEvidenceRefs[]
  workerGenerated
```

It means only: "the worker requests that CodeClosure evaluate advancement."

## Fact

```text
Fact
  id
  revision
  kind
  subject
  predicate
  value
  status
  provenance[]
  validFrom
  invalidatedAt?
```

`FactStatus`:

- `CONFIRMED`
- `OBSERVED`
- `PROPOSED`
- `DISPUTED`
- `INVALIDATED`
- `UNKNOWN`

Only statuses permitted by the consuming policy may affect execution or
acceptance. Model inference normally enters as `PROPOSED`.

Suggested `FactKind` values include:

- `BUSINESS_FACT`
- `BUSINESS_RULE`
- `PROJECT_FACT`
- `CODE_FACT`
- `DATA_FACT`
- `ENVIRONMENT_FACT`
- `EXTERNAL_FACT`
- `POLICY_FACT`

## Fact Provenance

```text
FactProvenance
  sourceType
  sourceRef
  sourceRevision
  observedBy
  observedAt
  contentDigest?
```

Source types may include user decision, project file, Git object, runtime
observation, versioned policy, external authority, or worker proposal.

## Business Scenario

Business scenarios prevent file-oriented completion.

```text
BusinessScenario
  id
  goalId
  name
  actors[]
  trigger
  preconditions[]
  path[]
  expectedOutcome
  negativeOrRecoveryOutcome?
  applicability
  evidenceStrength
```

For a financial-category change, scenarios may include manual entry, automated
settlement, salary settlement, part-time settlement, reimbursement review,
transaction generation, voucher generation, and historical snapshot behavior.

## Fact Graph Relationship

```text
FactRelationship
  id
  fromRef
  type
  toRef
  provenance
  status
```

Initial relationship types:

- `AFFECTS`
- `TRIGGERS`
- `PRODUCES`
- `CONSUMES`
- `DERIVES`
- `PERSISTS_TO`
- `SNAPSHOTS`
- `DEPENDS_ON`
- `VERIFIED_BY`
- `IMPLEMENTS`

M1 may persist facts without implementing graph traversal. The types exist now
so later graph behavior does not require redefining authority.

## Human Decision

```text
HumanDecision
  id
  decisionType
  prompt
  optionsOrExpectedFact
  answer
  scope
  goalRevision
  expiresOrInvalidatesWhen
  recordedAt
```

`HumanDecisionType`:

- `BUSINESS_FACT`
- `PRODUCT_PREFERENCE`
- `EXTERNAL_FACT`
- `REAL_WORLD_CONSENT`
- `CANCEL_OR_PAUSE`

There is no generic `BYPASS_TECHNICAL_GATE` type.

## Candidate and Candidate Generation

```text
Candidate
  id
  goalId
  baseProjectIdentity
  generations[]

CandidateGeneration
  id
  candidateId
  sequence
  parentGenerationId?
  workspaceIdentity
  state
  baseDigest
  frozenDigest?
  invalidationReason?
  createdAt
  frozenAt?
```

`CandidateGenerationState`:

- `MUTABLE`
- `FREEZING`
- `FROZEN`
- `INVALIDATED`
- `REJECTED`
- `ACCEPTED`

Only one generation for a workflow may be current. A repair creates a new
generation.

## Verification Obligation

```text
VerificationObligation
  id
  sourceCriterionRefs[]
  scenarioRefs[]
  checkSpecRef
  requiredEvidenceKind
  strength
```

Obligations bridge success criteria and scenarios to executable checks without
allowing a test command to redefine the goal.

## Evidence Record

See [`evidence-model.md`](evidence-model.md). Domain identity includes:

```text
EvidenceRecord
  id
  schemaVersion
  kind
  goalId
  goalRevision
  candidateGenerationId
  candidateDigest
  checkSpecRef
  observationDigest
  resultStatus
  recordDigest

EvidenceEligibility
  evidenceId
  version
  state
  reasonCode?
  sourceRef?
  changedAt
```

`resultStatus` is the immutable observed check outcome. Eligibility is a
separate, monotonic lifecycle state: it begins `ELIGIBLE` after validation and
may move to `INELIGIBLE`, but never back to `ELIGIBLE`. Acceptance revalidates
the complete Evidence record digest and current eligibility.

## Acceptance Input Manifest and Decision

```text
AcceptanceInputManifest
  schemaVersion
  goalId
  goalRevision
  workflowId
  workflowVersion
  phase
  factSnapshotDigest
  decisionSetDigest
  scenarioSetDigest
  candidateGenerationId
  candidateDigest
  evidenceSetDigest
  pendingIssueSetDigest
  policyBundleId
  policyBundleDigest
  createdAt
  manifestDigest

AcceptanceDecision
  id
  schemaVersion
  inputManifestDigest
  policyBundleDigest
  outcome
  dominantReasonCode
  ruleResults[]
  engineVersion
  issuedAt
  decisionDigest
```

An `ACCEPT` decision is usable only while every manifest binding remains
current. The canonical field meanings and digest projections are defined in
[`acceptance-engine.md`](acceptance-engine.md) and
[ADR 0006](adr/0006-canonical-serialization-and-digest-profiles.md).

## Pending Issue

```text
PendingIssue
  id
  classification
  severity
  description
  sourceRefs[]
  repairability
  status
```

Issues are not hidden inside review prose. Required open issues block
acceptance according to policy.

## Audit Event

```text
AuditEvent
  id
  sequence
  aggregateType
  aggregateId
  eventType
  actorType
  commandId?
  beforeVersion?
  afterVersion?
  payloadDigest
  occurredAt
```

The audit event is written atomically with the current-state mutation it
describes.

## Authority Matrix

| Record | Proposal source | Validation owner | Mutation owner |
| --- | --- | --- | --- |
| Goal | user / CLI | Goal Manager | Goal Manager through runtime transaction |
| Fact | user, project, runner, worker | Fact policy | Fact Store service |
| Workflow state | runtime command | Transition policy | Workflow Runtime only |
| Candidate source | worker | Candidate integrity policy | Candidate Manager / permitted worker path |
| Evidence observation | runner / adapter | Evidence validator | Evidence Store, immutable after validation |
| Evidence eligibility | integrity observation / runtime command | Evidence policy | Evidence Store through an audited monotonic transition |
| Acceptance decision | Acceptance Engine | Acceptance policy | Acceptance Store, immutable |
| Closeout state | accepted decision | transition guard | Workflow Runtime only |
| Human decision | user | decision schema/scope policy | Human Decision Gateway |

No row grants a coding worker authority over workflow, acceptance, or closeout.
