# CodeClosure Evidence Model

## Status

This document defines the target evidence contract. The current M1
implementation provides logical Candidate-freeze Evidence, independent fake
verification observations, monotonic eligibility, and canonical Evidence Sets.
Slice 6 consumes those records through a separate deterministic Acceptance
Engine; Evidence still cannot approve itself. A real verifier remains M2 work.

## Purpose

Evidence records what was actually observed about an exact Candidate under
known conditions. It gives the Acceptance Engine reproducible inputs without
allowing a worker, test runner, or report to approve itself.

Evidence answers:

```text
What ran or was inspected?
Against which exact inputs?
What was observed?
Can the observation still be used now?
```

Evidence does not answer the final question "May the Goal close?" That belongs
to the Acceptance Engine.

## Evidence Record

```text
EvidenceRecord
  id
  schemaVersion
  kind
  producerType
  producerIdentity
  goalId
  goalRevision
  workflowId
  attemptId
  verificationObligationId?
  candidateGenerationId
  candidateDigest
  factSnapshotDigest?
  policyBundleId
  policyBundleDigest
  checkSpec
  environmentIdentity?
  startedAt
  endedAt
  observation
  payloadRefs[]
  observationDigest
  resultStatus
  recordedAt
  recordDigest
```

An `EvidenceRecord` is immutable after it passes boundary validation.
`resultStatus` records what the producer observed—for example pass, fail,
timeout, or runner error—and never means that the Goal is accepted.

`observationDigest` binds the normalized typed observation. `recordDigest` binds
the complete semantic Evidence identity, conditions, result, observation
digest, and payload references. Its projection is defined by
[ADR 0006](adr/0006-canonical-serialization-and-digest-profiles.md); `id` and
`recordedAt` remain record-envelope metadata.

Current M1 `TEST_RESULT` Evidence also repeats the exact
`verificationObligationId` in that semantic projection. It can satisfy only
that obligation; a matching Check Specification alone is not equivalent.
`CANDIDATE_FREEZE` Evidence MUST omit the field.

M1 materializes this model as two strict variants. `CANDIDATE_FREEZE` MUST use
the Candidate Manager producer, `OBSERVED`, no environment or Fact snapshot,
and exactly one change-set-digest payload. `TEST_RESULT` MUST use the
Verification Runner producer, one exact obligation, one derived logical
environment, no Fact snapshot, and exactly one observation-digest payload.
Fields reserved for later Evidence kinds are rejected rather than persisted as
empty authority claims.

Initial `EvidenceResultStatus` values are:

- `OBSERVED` — a typed non-assertion observation such as a change manifest;
- `PASS` — the check-level assertion passed;
- `FAIL` — the check-level assertion failed as designed;
- `RUNNER_ERROR` — the producer failed before a trustworthy assertion;
- `TIMEOUT` — the bounded check did not finish in time.

Current acceptance eligibility is stored separately:

```text
EvidenceEligibility
  evidenceId
  version
  state
  reasonCode?
  sourceRef?
  changedAt
```

`EvidenceEligibilityState` is `ELIGIBLE` or `INELIGIBLE`. An admitted record
begins `ELIGIBLE` and may transition only to `INELIGIBLE`. It is never made
eligible again; a correction or rerun creates a new Evidence record. Eligibility
means only that the observation is current and may be evaluated—a current
`FAIL`, `RUNNER_ERROR`, or `TIMEOUT` still blocks a rule that requires `PASS`.
The eligibility transition and its audit event are persisted atomically.

## Producer Types

- `VERIFICATION_RUNNER`
- `CANDIDATE_MANAGER`
- `GIT_INSPECTOR`
- `STATIC_ANALYZER`
- `RUNTIME_OBSERVER`
- `INDEPENDENT_REVIEWER`
- `EXTERNAL_AUTHORITY_ADAPTER`
- `WORKER_OBSERVATION`

`WORKER_OBSERVATION` has the lowest default proof strength. Policy must not
promote worker prose into executable verification evidence.

## Evidence Kinds

Initial kinds include:

- `CANDIDATE_FREEZE`
- `ACTUAL_CHANGE_SET`
- `SOURCE_INTEGRITY`
- `COMMAND_EXECUTION`
- `TEST_RESULT`
- `BUILD_RESULT`
- `STATIC_CHECK_RESULT`
- `RUNTIME_BEHAVIOR`
- `DATA_STATE_CHECK`
- `BUSINESS_SCENARIO_RESULT`
- `INDEPENDENT_REVIEW`
- `CLEANUP_RESULT`
- `EXTERNAL_FACT_PROOF`

M1 needs only enough kinds to prove identity, transition behavior, and a fake
acceptance path. Later milestones add project-specific runner adapters.

## Check Specification

An evidence-producing action binds an exact specification:

```text
CheckSpec
  id
  version
  kind
  producerType
  producerIdentity
  argvOrOperation
  cwdIdentity
  inputRefs[]
  environmentPolicy
  timeout
  outputLimits
  expectedObservationSchema
  cleanupPolicy?
```

Free-form shell text is not the canonical identity. Implementations store a
canonical representation and digest. Secret values are referenced indirectly
and excluded from evidence payloads.

The M1 Check Specification is also the producer authorization record. Its
`producerType` and `producerIdentity` are immutable, and a persisted Evidence
record MUST match both. A runner response cannot override them.

## Observation Versus Result

The producer records observations such as:

- process exit status;
- normalized stdout/stderr digests and bounded redacted previews;
- test counts and failure identities;
- build artifact digest;
- changed path set;
- runtime/service identity;
- cleanup success and owned-resource identity;
- review findings.

A check-level `PASS` may be derived from these observations according to the
check specification. It remains one evidence result, not Goal acceptance.

## Candidate Binding

Every source-dependent evidence record binds the frozen Candidate digest. The
Evidence Store verifies the current digest before accepting a record and the
Acceptance Engine verifies it again when evaluating.

If the Candidate changes:

- the frozen generation becomes invalidated;
- its source-dependent Evidence eligibility moves to `INELIGIBLE`;
- a new generation must produce new evidence;
- path/name reuse does not restore eligibility.

## Evidence Set

An `EvidenceSet` is a canonical ordered collection selected for one acceptance
evaluation:

```text
EvidenceSet
  schemaVersion
  goalId
  goalRevision
  candidateGenerationId
  candidateDigest
  obligationMappings[]
  evidenceRefs[]
  unresolvedEvidenceRequirements[]
  digest
```

Each canonical `evidenceRefs` entry contains:

```text
EvidenceSetEntry
  evidenceId
  evidenceRecordDigest
  eligibilityVersion
  eligibilityState
```

An `EvidenceSet` MUST map at least one required Verification Obligation. An
empty obligation collection is not proof that all required work is complete.
Transitioning to `FINAL_VERIFY` additionally requires every mapping to resolve
to current eligible Evidence, so the selected Evidence references are also
non-empty.

A newly built set therefore has a different digest when selected Evidence
content or eligibility changes. Reusing an Evidence ID without its exact record
digest and eligibility version is invalid. A newly selected acceptance set may
include only `ELIGIBLE` entries; a previously persisted set remains immutable
but fails currency checks if any bound eligibility version or state has changed.

Historical replay and current currency are distinct. The unique
`EVIDENCE_SET_RECORDED` audit sequence is the historical cut: reopen reconstructs
which Evidence records and eligibility versions existed at that sequence and
must rebuild the exact canonical set. A later valid invalidation does not make
that immutable historical set corrupt, but the set MUST NOT satisfy a new
acceptance evaluation against latest eligibility.

Each verification obligation maps to one or more eligible Evidence records.
The mapping uses the immutable `verificationObligationId` recorded by the
Evidence, not merely a shared check reference. File existence or a broad test
command cannot satisfy an obligation unless the policy establishes relevant
coverage.

## Storage

Evidence metadata lives in the control store. In current M1, the fake verifier
returns only a closed result status. The Runtime owns invocation timestamps,
derives producer and Check Specification bindings, environment identity,
result status, and payload reference from the validated request and typed
observation, and hashes the observation as the fake payload reference.
Runner-supplied authority fields and unknown fields are rejected.
No separate large blob is claimed. Before real or larger runner output is
supported, immutable payloads MUST live in a CodeClosure-owned
content-addressed store and be referenced by digest.

The worker-writable Candidate must not contain the only copy of evidence used
for acceptance. Project-local exports may be generated for human inspection,
but exported Markdown is a view, not the authoritative record.

## Freshness and Invalidation

Evidence eligibility depends on all required bindings remaining current:

- Goal revision;
- Candidate digest;
- check specification/version;
- fact snapshot when the observation depends on facts;
- policy bundle when policy affects execution;
- runtime/environment identity when required;
- time window for time-sensitive external facts;
- cleanup state.

Invalidation is an explicit, monotonic `EvidenceEligibility` transition. The
current eligibility row and audit event are written in one transaction. The
runtime never mutates the Evidence observation or deletes history to make a
stale record appear current.

## Runtime Trust

For checks requiring execution, command output alone may be insufficient.
Policies may require:

- exact source revision and Candidate digest;
- service/process/container/build identity;
- isolated session/data resources;
- bounded environment inheritance;
- run-owned resource markers;
- cleanup-before and cleanup-after observations.

The required strength is risk- and obligation-dependent. A weaker run cannot
silently satisfy a stronger obligation.

## Independent Review Evidence

An independent review is an adversarial observation over an exact Candidate
and evidence set. It records findings and coverage. A reviewer does not edit
the Candidate in the same review attempt and does not issue the final
Acceptance Decision.

Fresh-context review can reduce shared-context bias, but freshness alone does
not make the review authoritative.

## Secret and Privacy Rules

- never persist raw credentials, tokens, passwords, cookies, or private keys;
- redact bounded output before durable storage;
- map external invocation failures and malformed output to closed Runtime-owned
  reason codes; never persist raw adapter exception text;
- store only the minimum environment identity needed for reproducibility;
- make sensitive external payload retention policy explicit;
- reject an evidence producer that cannot meet required redaction and identity
  guarantees.

## Failure Semantics

- check failed as designed -> valid failing evidence;
- runner explicitly reports `RUNNER_ERROR` -> an eligible error observation,
  not a passing or failing assertion;
- runner invocation throws -> no Evidence is admitted and the Attempt records a
  closed invocation-failure reason code;
- timeout -> an eligible `TIMEOUT` observation, normally blocking or retryable;
- output malformed, oversized, or inconsistent with the request -> submission
  rejected under a closed admission-failure reason code; no Evidence record is
  admitted;
- source changed before admission -> submission rejected as
  `CANDIDATE_MISMATCH`; source change after admission makes existing bound
  Evidence `INELIGIBLE`;
- cleanup unproven -> evidence cannot satisfy isolation-dependent obligations;
- required payload missing -> fail closed.

## M1 Boundary

The current Candidate/Evidence implementation includes:

- immutable Evidence records;
- separate monotonic Evidence eligibility;
- a deterministic fake check producer;
- exact Goal revision, Candidate generation/digest, Policy, Check
  Specification, Attempt, producer, environment, and Verification Obligation
  binding;
- Runtime-owned fake-verifier invocation timestamps and payload-reference
  digesting;
- canonical Evidence Set construction and current-binding checks;
- audit-sequence reconstruction of retained historical Evidence Sets;
- explicit atomic invalidation after Candidate drift;
- migration and reopen validation of retained authority.

The Evidence boundary does not interpret its own records as Goal acceptance.
The current Slice 6 Acceptance Engine separately maps pass, fail, runner-error,
and timeout observations into a technical decision over an exact manifest.

M1 does not need real project test runners, containers, browsers, devices, or
external authority adapters.

## Required Tests

- evidence for one Candidate cannot satisfy another Candidate;
- worker prose cannot be stored as a privileged evidence kind;
- changed check version invalidates dependent eligibility;
- failing evidence remains a valid observation but blocks the relevant rule;
- runner error cannot be interpreted as pass;
- evidence set ordering is canonical;
- changed Evidence eligibility makes a prior Evidence Set non-current without
  rewriting its historical recording;
- payload digest mismatch fails closed;
- Evidence record digest mismatch fails closed;
- Evidence creation, initial eligibility, and audit metadata persist atomically;
- invalidation changes eligibility and appends its audit event atomically without
  mutating the Evidence observation.
