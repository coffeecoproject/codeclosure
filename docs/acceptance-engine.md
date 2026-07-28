# CodeClosure Acceptance Engine

## Status

This document defines the target Acceptance Engine contract. No engine is
implemented at M0. M1 implements only the deterministic rule set under
[M1 Rule Set](#m1-rule-set) with fake candidate and evidence inputs.

## Purpose

The Acceptance Engine owns the final technical verdict over an immutable input
set. It moves completion authority away from the coding worker while keeping
the final state mutation in the Workflow Runtime.

```text
AcceptanceInputManifest + versioned Policy Bundle
  -> rule evaluation
  -> AcceptanceDecision + trace
  -> Workflow Runtime closeout guard
```

The engine is deterministic for the same canonical inputs and checker
versions. It does not call an LLM to decide `ACCEPT`.

## Authority Boundary

The Acceptance Engine:

- may read authoritative Goal, Fact, Decision, Workflow, Candidate, Evidence,
  and Issue records;
- may recompute identities and execute pure/checker logic;
- may record one immutable Acceptance Decision;
- may not edit source;
- may not invoke an implementation worker;
- may not mutate Workflow phase or Goal status;
- may not authorize release or another real-world effect.

The Workflow Runtime is the only component that consumes a current `ACCEPT`
and transactionally transitions to `CLOSEOUT`.

## Acceptance Input Manifest

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
```

The engine first verifies the manifest is current. It must not evaluate a
partially resolved or internally inconsistent manifest.

`manifestDigest` is computed over the semantic fields from `schemaVersion`
through `policyBundleDigest`. It excludes `createdAt` and `manifestDigest`
itself. The exact serialization and digest representation are defined by
[ADR 0006](adr/0006-canonical-serialization-and-digest-profiles.md).

## Policy Bundle

A Policy Bundle contains versioned, ordered rules and checker identities:

```text
PolicyBundle
  id
  version
  schemaVersion
  transitionRules[]
  capabilityRules[]
  contextRules[]
  checkSpecifications[]
  applicabilityRules[]
  acceptanceRules[]
  checkerVersions[]
  digest
```

The Acceptance Engine evaluates the acceptance-relevant projection, but the
digest binds the complete active control-policy bundle so the closeout record
cannot silently combine policy revisions. Changing the bundle or checker
implementation changes the digest. An old decision remains auditable but cannot
authorize a current closeout unless an explicit compatibility policy proves
equivalence.

## Rule Contract

Each rule receives a read-only evaluation context and returns:

```text
RuleResult
  ruleId
  ruleVersion
  applicability
  outcome
  reasonCode
  message
  inputRefs[]
  evidenceRefs[]
  checkerDigest
```

`RuleOutcome`:

- `PASS`
- `FAIL_REPAIRABLE`
- `FAIL_BLOCKED`
- `NEEDS_DECISION`
- `NOT_APPLICABLE_WITH_REASON`
- `ENGINE_ERROR`

A rule cannot return an untyped success string.

## Required Rule Families

### Identity and freshness

- Goal and Workflow revisions match;
- phase is `FINAL_VERIFY`;
- Candidate is the current frozen generation;
- Candidate digest recomputes correctly;
- policy and checker identities match;
- all selected evidence is current and internally valid.

### Goal and scope

- every required success criterion has an obligation mapping;
- non-goals and forbidden paths were respected;
- actual change set matches the planned and allowed boundary;
- unexpected changes are absent or explicitly resolved through a new Goal/plan
  revision.

### Business path coverage

- every applicable scenario is mapped through implementation and verification;
- positive, negative, lifecycle, recovery, and historical behavior required by
  policy are covered;
- exclusions have evidence-backed reasons;
- fixture/mock-only proof is not used for a runtime scenario when policy
  requires real behavior.

### Verification and runtime trust

- every verification obligation has eligible evidence of sufficient strength;
- required commands/tests/builds/checks have passing observations;
- runtime/source/environment identities agree;
- run-owned resource cleanup is proven when applicable.

### Review and issues

- required independent review is current;
- no unresolved blocking finding remains;
- repairable findings are not hidden by a broad success summary;
- pending issue classifications agree with policy.

### Human and external decisions

- every required typed decision exists, is scoped correctly, and remains
  current;
- generic approval text cannot satisfy a technical or real-world requirement;
- technical acceptance remains separate from promotion consent.

## Decision Outcomes

`AcceptanceOutcome`:

### `ACCEPT`

Every applicable required rule passes and the manifest remains current at
decision commit time.

### `REJECT_REPAIRABLE`

At least one rule fails in a way that can be corrected inside the current Goal
scope by creating a new Candidate generation.

### `REJECT_BLOCKED`

A required rule fails but cannot safely enter automatic repair, for example an
unsupported environment, missing authority, retry exhaustion, or scope/risk
conflict.

### `NEEDS_DECISION`

One allowed typed human or external input is required. It does not mean the
rest of the rules passed permanently; affected inputs are rebuilt after the
decision.

### `ENGINE_ERROR`

The engine or a required checker could not produce a trustworthy result.
`ENGINE_ERROR` fails closed and is never coerced to `ACCEPT`.

## Aggregation

The strictest applicable result controls:

1. `ENGINE_ERROR`
2. `REJECT_BLOCKED`
3. `NEEDS_DECISION`
4. `REJECT_REPAIRABLE`
5. `ACCEPT`

Aggregation records the dominant reason plus every contributing Rule Result.
Ordering affects presentation only; it must not hide additional failures.

## Decision Record

```text
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

Decisions are immutable. Reevaluation creates a new record.

`decisionDigest` covers the semantic decision projection: `schemaVersion`,
`inputManifestDigest`, `policyBundleDigest`, `outcome`, `dominantReasonCode`, the
ordered `ruleResults`, and `engineVersion`. It excludes `id`, `issuedAt`, and
`decisionDigest` itself. Therefore a replay may create a new record identity and
timestamp while still producing the same semantic decision digest.

## Closeout Race Protection

Between evaluation and workflow transition, relevant state may change. The
closeout command therefore supplies:

- expected Workflow version;
- Acceptance Decision ID and digest;
- expected Acceptance Input Manifest digest;
- expected Candidate digest.

The Workflow Runtime revalidates current bindings in the same transaction that
enters `CLOSEOUT`. Any mismatch rejects the transition.

## Replay and Explainability

A decision must be replayable using retained canonical inputs and checker
versions, subject to explicit external-evidence retention limits. Replay output
should distinguish:

- exact match;
- unavailable historical runner/checker;
- changed external fact;
- non-deterministic implementation defect.

The user-facing explanation shows:

- overall outcome;
- dominant blocker;
- criteria/scenarios completed and missing;
- evidence links;
- next safe action.

Explanation is a view over the decision, not a second decision.

## M1 Rule Set

M1 uses a small policy bundle that proves authority mechanics rather than
project correctness:

- workflow phase must be `FINAL_VERIFY`;
- Goal revision must match;
- current Candidate must be frozen;
- Candidate digest must match;
- at least one required fake obligation must exist;
- every required fake obligation must have eligible passing fake evidence;
- no required Pending Issue may remain;
- manifest and policy digests must match;
- worker Completion Request cannot satisfy any rule directly.

This is enough to prove fail-closed closeout without pretending M1 validates
real software.

## Required Adversarial Tests

- worker returns `completed` with no evidence -> reject;
- worker fabricates an `accept` field -> ignored/rejected as invalid shape;
- Candidate changes after evidence -> reject;
- Evidence belongs to prior generation -> reject;
- policy changes after decision -> closeout transition rejected;
- checker throws -> `ENGINE_ERROR`;
- one missing required rule -> no `ACCEPT`;
- stale Workflow version races with closeout -> transaction rejected;
- generic human approval attempts to bypass a failed technical rule -> reject;
- identical manifest and policy replay to the same semantic decision projection
  and `decisionDigest`; record identity and timestamp may differ.
