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

## Authority Boundary Validation

TypeScript types and brands express domain intent but do not validate runtime
values. Every authority-bearing record has one owning codec that materializes
branded scalars, rejects closed-record shape drift, checks state-specific
fields, and invokes the semantic invariant. Runtime ports, Store writes, and
persistence reads use that same record contract. Adapter row schemas translate
storage columns; they do not define a second domain model.

A Store result of `APPLIED` guarantees that resulting state, audit records, and
the processed-command outcome decode immediately and after reopen. Normal
command admission and replay use the same Goal/Workflow relationship rules.
See [ADR 0013](adr/0013-authority-boundary-validation-closure.md).

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
- `CommandId`
- `WorkerEventId`
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

In M1, `Goal.status` is a user-facing projection of the Goal's unique Workflow
run status. Goal intent and revision remain owned by the Goal Manager; only the
Workflow Runtime changes operational lifecycle state, and persistence
synchronizes the Goal projection in that same transaction. Direct independent
status changes are invalid. `READY` and `RUNNING` map to `ACTIVE`,
`WAITING_FOR_INPUT` maps directly, `BLOCKED` and `FAILED` map to `BLOCKED`, and
the two terminal statuses map directly. Projection changes do not increment
the Goal revision. See [ADR 0008](adr/0008-goal-command-and-lifecycle-boundary.md).

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

One domain invariant validator owns the complete Workflow snapshot rule. It is
used for current and resulting state and by persistence decoding. `CANCELLED`
and `CLOSED` Workflows are immutable at event application as well as command
decision. `updatedAt` never precedes `createdAt`, and a Workflow event never
precedes the current `updatedAt`. Runtime clock rollback and lower-boundary
event handling follow [ADR 0012](adr/0012-causal-control-timestamps.md).

## Attempt

An Attempt records one bounded effort to advance the workflow.
It is a child entity owned by the Workflow aggregate in M1, not an independently
versioned aggregate. `WorkflowInstance.version` serializes phase, run-status,
active-Attempt, and Attempt-lifecycle mutations.

```text
AttemptBase
  id
  workflowId
  phase
  sequence
  contextManifestId?
  capabilityGrant
  workerSessionRef?
  status
  startedAt

RunningAttempt extends AttemptBase
  status = RUNNING

ResultRecordedAttempt extends AttemptBase
  status = RESULT_RECORDED
  terminationReason
  endedAt

FailedAttempt extends AttemptBase
  status = FAILED
  failureClass
  terminationReason
  endedAt

InterruptedAttempt extends AttemptBase
  status = INTERRUPTED
  terminationReason
  endedAt
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
it may enter a terminal Attempt status only once. Its mutation timestamp cannot
precede the owning Workflow state, and a terminal timestamp cannot precede the
Attempt start.

The Attempt shape is a discriminated state union. A `RUNNING` Attempt cannot
carry terminal fields, every terminal Attempt has `terminationReason` and
`endedAt`, and only a `FAILED` Attempt has `failureClass`. Public constructors,
reducers, and persistence decoders MUST preserve those state-specific shapes.
One domain invariant validator owns the complete snapshot rule and is called
for both current and resulting Attempt state. Persistence decoding delegates to
that validator; SQLite mirrors the same lifecycle matrix so an invalid row
cannot be written and discovered only on a later read.

`RESULT_RECORDED` is deliberately not named `SUCCEEDED`: a worker operation
ending normally or returning a Completion Request grants no acceptance or
closeout authority.

See [ADR 0007](adr/0007-workflow-owned-attempt-lifecycle.md) for the aggregate
boundary and concurrency rationale.

## Command and Worker Event Identity

`CommandId` identifies a schema-validated application operation submitted to
the control runtime. Its canonical input digest and outcome, including a
deterministic domain rejection, are persisted for replay.

Persistence authors the public command output inside the command transaction
and wraps it in a schema-versioned outcome envelope. Envelope version 3 is a
discriminated `APPLIED`/`REJECTED` union containing the exact aggregate target,
owning `GoalId`, owning `WorkflowId`, and observed Workflow snapshot. An
applied output must equal the resulting Workflow state; a rejected output must
be failed, use a deterministic admitted-command rejection code, and bind the
version against which it was decided. Infrastructure errors are not replayable
domain outcomes. A
processed-command row and a shape-valid output are insufficient unless all
command, target, entity-existence, relationship, disposition, and snapshot
bindings agree. Legacy outcomes without enough proof fail closed rather than
acquiring inferred semantics.

`WorkerEventId` identifies delivery of untrusted output from a worker adapter.
It is validated and deduplicated separately and cannot be converted into, or
chosen as, an application `CommandId`. A stale or mismatched worker event
creates no authoritative transition or application-command outcome. See
[ADR 0009](adr/0009-command-idempotency-and-worker-boundary.md).
Admission ordering and stored-outcome binding are specified by
[ADR 0010](adr/0010-command-admission-and-outcome-binding.md) and
[ADR 0011](adr/0011-store-authored-command-outcome-semantics.md).

Every Worker receipt has a prior immutable dispatch claim for the same Attempt,
Workflow, and Context Manifest. An admitted receipt matches the claim's exact
version, Worker Session, and digests. An ignored receipt may preserve the
mismatched Worker fields that explain its rejection, but it still cannot exist
without dispatch causality. Deterministic FakeWorker IDs include request
identity plus fixture and ordinal; unrelated Attempts never share an ID merely
because they use the same fixture. See
[ADR 0015](adr/0015-close-m1-worker-authority-causality.md).

## Transition Request and Transition Record

```text
TransitionRequest
  workflowId
  expectedVersion
  requestedPhase
  reason
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
Supporting references and guard outcomes are produced by Runtime-owned
evaluators and appear on the record; they are not assertions supplied by the
transition requester.

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

The current M1 Slice 4 wire contract is deliberately smaller than the target
shape above. It admits either `PROPOSALS` during `DISCOVERY`/`PLAN`, a
`COMPLETION_REQUEST` during `IMPLEMENT`, or a typed Worker failure. Every event
binds an independent `WorkerEventId`, Worker Session, Attempt, Context Manifest,
and exact Manifest/package digests. A valid result records only an Attempt
result and returns the Workflow to `READY`; it does not advance phase or issue
Acceptance. Empty or invalid-only stream completion is a `PROTOCOL_ERROR`;
uncancelled iterator termination is `ABRUPT_TERMINATION`. A typed
`WorkerEventNonAdmissionClass` keeps control-plane admission failure separate
from untrusted delivery so persistence failure is not misrecorded as Worker
failure. Runtime-authored stream failure has the same durable dispatch-causality
precondition as event admission. Every later terminal or interruption time is
at or after the claim's `claimedAt`. See
[ADR 0014](adr/0014-context-bound-worker-dispatch-and-event-admission.md) and
[ADR 0015](adr/0015-close-m1-worker-authority-causality.md).

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

## Policy Bundle

```text
PolicyBundleDefinition
  id
  schemaVersion
  version
  transitionRules[]
  capabilityRules[]
  contextRules[]
  checkSpecifications[]
  applicabilityRules[]
  acceptanceRules[]
  checkerVersions[]

PolicyBundle extends PolicyBundleDefinition
  digest
```

The composition boundary proposes a definition; it does not author its digest
or installation timestamp. The Runtime validates the definition, computes the
canonical digest, and assigns time and audit identity. The Store independently
recomputes the digest and persists the immutable Policy plus installation audit
in one transaction. A Policy row without its matching audit, or whose retained
content does not reproduce its digest, is invalid authority. See
[ADR 0015](adr/0015-close-m1-worker-authority-causality.md).

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
  version
  createdAt
  updatedAt
  frozenAt?
```

The generation snapshot is a discriminated state union. `MUTABLE` and
`FREEZING` do not carry frozen identity. `FROZEN`, `REJECTED`, and `ACCEPTED`
carry both `frozenDigest` and `frozenAt`. `INVALIDATED` always carries a
non-empty invalidation reason and retains a previously established frozen
identity only as a complete digest/time pair.

`CandidateGenerationState`:

- `MUTABLE`
- `FREEZING`
- `FROZEN`
- `INVALIDATED`
- `REJECTED`
- `ACCEPTED`

Only one generation for a workflow may be current. A repair creates a new
generation. Candidate commands and events cannot precede the generation's
current `updatedAt`; `updatedAt` cannot precede `createdAt`, and `frozenAt`,
when present, remains inside that lifecycle interval.

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
| Goal intent and revision | user / CLI | Goal Manager | Goal Manager through runtime transaction |
| Goal lifecycle projection | Workflow run status | Workflow Runtime | Persistence synchronization inside the Workflow transaction |
| Fact | user, project, runner, worker | Fact policy | Fact Store service |
| Workflow state | runtime command | Transition policy | Workflow Runtime only |
| Candidate source | worker | Candidate integrity policy | Candidate Manager / permitted worker path |
| Evidence observation | runner / adapter | Evidence validator | Evidence Store, immutable after validation |
| Evidence eligibility | integrity observation / runtime command | Evidence policy | Evidence Store through an audited monotonic transition |
| Acceptance decision | Acceptance Engine | Acceptance policy | Acceptance Store, immutable |
| Closeout state | accepted decision | transition guard | Workflow Runtime only |
| Human decision | user | decision schema/scope policy | Human Decision Gateway |

No row grants a coding worker authority over workflow, acceptance, or closeout.
