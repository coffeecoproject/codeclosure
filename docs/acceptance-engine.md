# CodeClosure Acceptance Engine

## Status

This document defines the target Acceptance Engine contract. The audited M1
implementation provides the deterministic rule set under
[M1 Rule Set](#m1-rule-set), strict manifest and decision codecs, immutable
SQLite persistence, current-input replay validation, transactional closeout,
and immutable exact repair-generation authority. ADR 0030's bounded real
local-command verifier and version-2 Evidence are implemented, and Slice 5 now
selects one complete local Check family as the current deterministic Acceptance
input. The same M1 rule set maps real `PASS`, `FAIL`, runner-error, and timeout
status without granting the runner completion authority. ADR 0031 fixes a
planned additive acceptance-critical Verification Plan and protected-asset
rule, while ADR 0032 closes the bounded single-plan, lease, Profile, and
Evidence-family composition. ADR 0033 aligns the plan with first-Start
atomicity and separates the static Check lease from later Attempt/Obligation
causality. Slice 7 implements that protected Acceptance input and checker
without changing the M1 rule set. Slice 8 adds no technical-completion authority
and completed the bounded M2 exit review on 2026-08-02. Intent Admission and
Goal Materialization remain separate from the technical Acceptance Engine,
which is unchanged and gains no pre-Goal or model-authored completion authority.
M2.5 implements its separate deterministic Admission evaluator, atomic
Materialization, ordinary Start composition, and strict persistence without
changing technical Acceptance; its corrected assessment and independent review
passed on 2026-08-06. M2.5.1 Slice 0 adds no Acceptance rule or completion
authority. Slice 3's trusted deterministic composition carries its explicit
protocol-fixture Candidate through the existing protected checker, Evidence,
Acceptance Engine, and closeout authority without adding another verdict
issuer. That bounded Slice 3 `PASS` is not a real-Codex or M2.5.1 milestone
acceptance verdict. Slice 4's contained Profile correction changes no
Acceptance rule or issuer; its containment Receipt remains assessment evidence
even though the standalone complete Live containment matrix passed on source
`7621c8b`; the restarted initial B5 linked composition and containment
diagnostics passed on clean source `1b43dfc`, and the later final prepared-source
gate plus ordered unchanged-source Live triad passed on source `01fd537`; the
bounded Slice 4 review issued `PASS`. None creates another Acceptance issuer.
Slice 5's non-verdict canonical runner and offline fail-closed tests are
implemented; the runner and its future independent review remain outside
technical Acceptance. Its first aggregate run passed both Live stages and
every stage through current-source M2 regression before the former uniform
command timeout interrupted the nested M2.5 regression. The corrected
assessment budget remains outside technical Acceptance; a clean-source rerun
and independent review are still required.
Proposed M2.6 Frontstage routes,
answers, Goal summaries, focus, pending actions, and notifications remain
outside technical Acceptance and cannot issue `ACCEPT` or closeout.
Proposed M2.7 Host, control-lease, and project-slot state likewise cannot become
Evidence, Acceptance input, `ACCEPT`, or closeout authority.

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
- issues one immutable Acceptance Decision whose persistence is coordinated by
  the Workflow Runtime and Store transaction;
- may not edit source;
- may not invoke an implementation worker;
- may not mutate Workflow phase or Goal status;
- may not authorize release or another real-world effect.

It also does not judge the user's true intent, classify an assistant proposal
as user-stated, issue an Intent Admission Decision, authorize automatic Start,
or approve Goal Materialization. A pre-analysis `NO_EXECUTION` decision binds
the exact Raw Request, trusted action, and Admission Policy without a Proposal
or Projection. Projection-backed Admission and Goal Materialization additionally
depend on structural validation, exact Proposal/Projection revisions and
digests, Source Bindings, material-ambiguity state, Goal Manager validation, and
the Runtime's atomic creation transaction. None of these is technical `ACCEPT`.
Likewise, a bounded `AnswerOnlyResponse` is interaction output, not proof that
its content is true and not Acceptance input. An `ANSWER_FAILED` disposition or
terminal Intake `FAILED` record is also unrelated to technical Acceptance.
See
[ADR 0027](adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md).

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

For a started Workflow, `policyBundleId` and `policyBundleDigest` MUST equal
its immutable `WorkflowPolicyBinding`. The currently configured or most
recently installed Policy is not a substitute. See
[ADR 0022](adr/0022-immutable-workflow-policy-binding.md).

For the M2 acceptance-critical extension, an additive version of this
manifest MUST also bind the immutable
`AcceptanceCriticalVerificationPlan` ID/digest. The referenced Evidence Set
MUST contain the exact generation-specific Check and protected-asset manifest
binding required by that plan. Existing M1 manifests and Slice 4/5 inputs keep
their exact schema and digest semantics.

The bounded M2 manifest binds exactly one Workflow-scoped plan. Its Evidence
Set contains only the complete protected schema-version-3 local-command family;
supplementary Worker-test Evidence is not selected into that Set. A second plan,
mixed family, or supplementary substitution fails before rule evaluation.

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

For the M2 acceptance-critical rule, the immutable Policy MUST mark
which required Criteria and Verification Obligations are acceptance-critical.
Each such obligation MUST resolve to eligible passing Evidence bound to the
exact pre-Worker Verification Plan, protected-asset manifest, concrete Check,
Candidate, and Policy. Missing or changed protected assets, wrong plan or
Criterion identity, and a mapping containing only Worker-authored
supplementary tests fail the rule. The Worker, runner, and Evidence record
cannot change an obligation's criticality or proof-strength requirement.

For the implemented M2 `LOCAL_COMMAND_TEST_RESULT`, eligibility additionally
requires the exact version-2 Check, executable/argv, Candidate and read-only
workspace lease, runner, isolation/environment, observation, and retained
payload bindings defined by ADR 0030. A zero exit code, Worker command Item, or
stdout claim without those current bindings cannot satisfy a rule.

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

Every successful repair also retains one immutable causality record:

```text
AcceptanceRepairRecord
  schemaVersion
  goalId / goalRevision
  workflowId / workflowVersion
  acceptanceDecisionId / acceptanceDecisionDigest
  inputManifestDigest
  rejectedCandidateGenerationId / version / digest
  repairCandidateGenerationId / sequence / baseDigest
  freezeCheckId / version
  verificationCheckId / version
  verificationObligationIds[]
  evidenceSetDigest
  policyBundleId / policyBundleDigest
  repairedAt
  repairDigest
```

`repairDigest` covers the canonical record fields except itself. It is the
common payload identity for every audit event in that compound repair. The
record does not issue an Acceptance Decision or mutate state; it preserves the
exact causality that authorized fresh implementation capability.

## Closeout Race Protection

Between evaluation and workflow transition, relevant state may change. The
closeout command therefore supplies:

- expected Workflow version;
- Acceptance Decision ID and digest;
- expected Acceptance Input Manifest digest;
- expected Candidate digest.

The Workflow Runtime reobserves frozen source before closeout or repair and
recomputes the current manifest and decision. The Store independently
revalidates persisted bindings in the transaction that enters `CLOSEOUT` or
creates a repair generation. Any mismatch rejects the requested transition;
observed source drift uses the atomic Candidate/Evidence invalidation path.
Manifest creation cannot predate any retained input or the installed Policy;
closeout and repair cannot predate the decision they consume. Closeout uses one
timestamp for Workflow, Goal, Candidate, and immutable closeout authority, and
repair uses one timestamp for rejection and child creation.

On restart, `ACCEPTED` is valid only with the exact immutable closeout binding.
`REJECTED` is valid only with one exact immutable repair record that resolves
the consumed decision and manifest, base-bound next-sequence child, fresh
Checks and Obligations, common audit command/digest, and processed-command
outcome. Migration 0014 refuses older rejected history because those exact
bindings cannot be inferred; migration never upgrades a terminal label or a
plausible child into proof. See
[ADR 0019](adr/0019-exact-acceptance-repair-authority.md).

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

Explanation is a view over the decision, not a second decision. The implemented
Slice 7 Goal status view compiles that explanation inside the Runtime; CLI
handlers do not join or reinterpret Acceptance rows. A technical-closeout label
additionally requires the current immutable closeout binding. See
[ADR 0020](adr/0020-runtime-application-recovery-and-query-boundary.md).

## M1 Rule Set

M1 uses a small policy bundle that proves authority mechanics rather than
project correctness:

- Workflow phase and version must bind the `FINAL_VERIFY` input;
- Goal revision must match the Workflow and manifest;
- the current Candidate must be frozen;
- Candidate and Evidence Set digests must match;
- at least one required fake obligation must exist and every required criterion
  must map exactly once;
- every required fake obligation must have one or more current eligible fake
  Evidence records; all must be `PASS`, while any `FAIL` remains repairable and
  any runner error or timeout remains an engine error;
- no open blocking Pending Issue may remain;
- manifest, Policy Bundle, and checker identities must match;
- worker Completion Request cannot satisfy any rule directly.

This is enough to prove fail-closed closeout without pretending M1 validates
real software.

Slice 7 adds the separate M2 acceptance-critical rule without changing the
M1 rule set or reinterpreting Slice 4/5 decisions. It proves only one bounded
protected Check/Oracle path, not arbitrary-project validation completeness.

## Required Adversarial Tests

- worker returns `completed` with no evidence -> reject;
- worker fabricates an `accept` field -> ignored/rejected as invalid shape;
- Candidate changes after evidence -> reject;
- Evidence belongs to prior generation -> reject;
- policy changes after decision -> closeout transition rejected;
- checker throws -> `ENGINE_ERROR`;
- one missing required rule -> no `ACCEPT`;
- only Worker-authored supplementary tests pass while the protected
  acceptance-critical Check fails or is missing -> no `ACCEPT`;
- protected Verification Plan, asset manifest, Criterion, obligation, Check,
  Candidate, or Policy identity differs -> reject;
- incorrect implementation plus weakened Candidate-local test -> protected
  Oracle still blocks Acceptance;
- stale Workflow version races with closeout -> transaction rejected;
- generic human approval attempts to bypass a failed technical rule -> reject;
- identical manifest and policy replay to the same semantic decision projection
  and `decisionDigest`; record identity and timestamp may differ.
