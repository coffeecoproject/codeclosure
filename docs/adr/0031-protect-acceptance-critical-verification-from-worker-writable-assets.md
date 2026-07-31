# ADR 0031: Protect acceptance-critical verification from Worker-writable assets

- Status: Accepted
- Date: 2026-07-31

## Context

ADR 0030 makes real local verification independent of Worker claims: a
separate process executes an exact Check against a frozen Candidate with
read-only access, and Runtime constructs Evidence from the returned
observation. That execution boundary does not by itself make the verification
standard independent.

A Worker may legitimately change application code and tests in the same
Candidate. If a required success Criterion can be satisfied only by a test or
Oracle that the Worker may replace or weaken, an incorrect implementation and
a weakened test can produce a genuine process exit of zero. The execution is
real, but its meaning is insufficient. Worker-authored tests remain useful;
they cannot be the sole authority by which the same Worker proves a required
technical result.

M2 needs one bounded anti-self-certification path. It does not need to prove
that arbitrary project test suites are complete or that every semantic defect
will be detected.

## Decision

### Define acceptance-critical verification explicitly

An **acceptance-critical Criterion** is a required technical success Criterion
that the immutable Policy Bundle says MUST be satisfied before it may return
`ACCEPT`.

An **acceptance-critical Verification Obligation** is the Policy-derived
obligation whose eligible Evidence is required to satisfy such a Criterion.

**Decisive Evidence** is eligible Evidence selected for an
acceptance-critical Verification Obligation such that its absence, failure, or
invalidity prevents `ACCEPT`. The role is assigned by the immutable Policy and
obligation mapping, not by the Worker, runner, Evidence producer, command name,
or path.

A **verification asset** is content or configuration that affects the Check's
meaning, including a test, Oracle, acceptance script, fixture, fixed input,
expected output, or configuration consumed by that Check. An Oracle is the
rule or reference used to decide whether the observed result is correct.

For every acceptance-critical Criterion in the bounded M2 profile, trusted
composition MUST create and Runtime MUST validate and persist an immutable
`AcceptanceCriticalVerificationPlan` before the first Worker Turn that may
mutate Candidate generation 1. The plan binds at least:

- its schema version, ID, digest, creation time, and trusted authority source;
- Goal ID/revision, Workflow ID and `workflowVersionAtLock`, immutable Policy
  Bundle ID/digest, and Execution Profile ID/digest;
- the exact acceptance-critical Criterion IDs and Policy rule identities;
- the semantic Check template, including runner, executable, ordered argv
  template, cwd, environment, exit semantics, isolation, and limits;
- every protected verification asset's logical identity, source, content
  digest, byte length, execution location, and protection mode, plus the
  canonical `protectedAssetManifestDigest` and read-only asset-lease policy;
- the rule by which a frozen-generation Check and Verification Obligation are
  derived from the plan.

The Store MUST preserve the plan and its audit creation atomically. The plan is
immutable for the Workflow. A repair generation inherits the same plan; it
does not receive authority to revise its protected semantics.

The authoritative source is trusted composition acting under the installed
immutable Policy. The Worker, Worker Adapter, Verification Runner, model
output, and Candidate filesystem are not sources of this plan authority.

### Bind the pre-Worker plan to generation-specific verification

The exact frozen Candidate ID/digest, read-only workspace lease, concrete
Verification Obligation, and concrete Check Specification are necessarily
known after Candidate freeze. Runtime MUST derive them from the immutable plan
and bind the plan ID/digest plus protected-asset manifest and read-only lease
digests into the generation-specific Check and Evidence authority.

This is an additive schema change. Existing schema-version-1 fake records and
schema-version-2 `LOCAL_COMMAND` records retain their exact meanings and
digests. M2 adds a schema-version-1
`AcceptanceCriticalVerificationPlan`, a schema-version-3 `LOCAL_COMMAND` Check
Specification, and a schema-version-3 `LOCAL_COMMAND_TEST_RESULT` Evidence
variant. The version-3 Check extends the complete version-2 semantic projection
with:

- `acceptanceCriticalVerificationPlanId`;
- `acceptanceCriticalVerificationPlanDigest`;
- `protectedAssetManifestDigest`; and
- `protectedAssetReadLeaseDigest`.

The version-3 Evidence record repeats those four bindings, names the exact
version-3 Check and Verification Obligation, and otherwise retains ADR 0030's
version-2 local-command semantics. Runtime and Store MUST cross-check the
repeated values against the immutable plan and each other. Existing version-2
records remain valid historical or non-critical Evidence but cannot be the sole
decisive Evidence for an acceptance-critical M2 obligation.

The concrete Check may add only generation-specific identity and Runtime-owned
execution data permitted by the plan. It cannot weaken the Check template,
replace a protected asset, remove a required Criterion, change the Policy rule,
or substitute another Goal, Candidate, or Evidence family.

### Keep protected assets outside Worker authority

A protected verification asset MUST either:

1. reside outside every Worker-writable Candidate and be made available only
   to the read-only Verification Runner through an exact Runtime-issued asset
   lease bound to the plan and isolation profile; or
2. be bound to its exact pre-Worker content digest and revalidated before
   execution so any Worker modification, deletion, replacement, aliasing, or
   indirection fails closed.

The bounded M2 demonstration SHOULD use the first form. Authority storage,
protected assets, and their identity manifest MUST remain unreachable through
Candidate write capabilities. The Verification Runner's isolation profile MAY
read only the exact leased protected assets and MUST deny writes to them. The
lease cannot grant access to broader authority storage, credentials, another
Candidate, or an unresolved path.

Missing assets, digest drift, changed Check semantics, wrong plan/Goal/Policy/
Criterion/Candidate binding, or an unverifiable protection mode MUST prevent
eligible passing decisive Evidence. Runtime MUST NOT fall back to a
Worker-writable test, Worker command transcript, path-existence check, or
previous generation's Evidence.

### Allow Worker-authored tests only as supplementary Evidence

A Worker MAY add or modify Candidate tests. Runtime MAY independently execute
them and construct provenance-labelled supplementary Evidence under a
non-critical obligation. Such Evidence can aid diagnosis, regression coverage,
or later planning, but it MUST NOT by itself satisfy an acceptance-critical
Verification Obligation.

The Worker cannot label its own test decisive, change the obligation mapping,
or promote supplementary Evidence through output text or structured Worker
results. Only the immutable Policy and Acceptance Engine determine whether the
required protected Evidence Set is complete.

### Bound the M2 claim

M2 proves only that one pre-fixed protected Check/Oracle cannot be weakened by
the executing Worker and that the resulting decisive Evidence is bound through
Acceptance. It does not claim that the selected Oracle is a complete
specification, that arbitrary project tests prevent false positives, or that an
independent model reviewer is unnecessary.

M3 may add complete Criterion, Scenario, Obligation, Check, Evidence, source,
and coverage traceability. M4 may evaluate false-green and escaped-defect data,
additional verification paths, reviewer policy, and automated multi-round
repair policy.

## Consequences

- Independent execution and independent verification-standard authority are
  separate, auditable properties.
- A real exit of zero from a Worker-writable test is not automatically
  acceptance-critical Evidence.
- Each repair generation reuses the same protected semantics while receiving a
  fresh generation-specific Check and Evidence binding.
- The acceptance report can name the exact pre-Worker plan, protected assets,
  Check, Candidate, and Evidence used for the decision.
- Slice 4 remains the proof of read-only independent execution, and Slice 5
  remains the proof of reject/repair/accept orchestration. Their historical
  reviews are not reinterpreted as proofs of independent verification-standard
  design.

## Rejected alternatives

- **Forbid Workers from editing any test.** Rejected because test changes can
  be valid implementation work and useful supplementary Evidence.
- **Trust a separately executed Candidate test because the runner is
  independent.** Rejected because process isolation does not protect the
  test's semantics from the Worker that wrote it.
- **Choose the decisive Check after seeing Worker output.** Rejected because it
  permits outcome-driven weakening and makes replay authority ambiguous.
- **Treat a test path as asset identity.** Rejected because content can change
  while the path remains the same.
- **Claim arbitrary-project correctness from one protected fixture.** Rejected
  because M2 proves an authority boundary, not general test adequacy.

## Validation

M2 tests and acceptance MUST prove:

- the acceptance-critical plan and protected-asset identities exist before the
  first Worker dispatch and are immutable across repair generations;
- every decisive Check and Evidence record binds the exact plan, Criterion,
  Policy, Candidate, obligation, protected-asset manifest, and read-only asset
  lease;
- deleting, replacing, weakening, aliasing, or changing a protected asset after
  plan creation fails closed before eligible passing decisive Evidence;
- an incorrect implementation that also weakens a Worker-writable test cannot
  reach `ACCEPT` or closeout;
- passing only Worker-authored tests cannot satisfy an acceptance-critical
  Criterion;
- a correct implementation can pass the same pre-fixed protected Check and
  close normally;
- strict reopen preserves and revalidates all plan, asset, Check, Evidence, and
  Acceptance bindings; and
- the M2 report records the exact pre-Worker plan, protected assets, concrete
  Check, and Evidence identities without claiming general validation
  completeness.
