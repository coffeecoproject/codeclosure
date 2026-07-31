# M2 Slice 5 Reject, Repair, and Accept Review

- Review date: 2026-07-31
- Scope: M2 Slice 5 only
- Status: Complete
- Verdict: `PASS`; the bounded in-process reject/repair/accept orchestration
  satisfies the Slice 5 exit contract and Slice 6 may begin

## Review question

This review asks whether CodeClosure can compose the already implemented M1
control plane, controlled-copy Candidate workspace, and real local verifier
into one deterministic path that preserves a failed generation, creates an
exact repair child, verifies it afresh, and closes only through current
deterministic Acceptance.

It also asks whether Candidate drift observed while an `EVIDENCE_BUILD` Attempt
is active can leave any split Attempt, Workflow, Candidate, Evidence, audit, or
processed-command state.

It does not assess Thread or Compact continuity, restart reconstruction of an
external verification session, persisted external-execution observations,
trusted production CLI composition, a live Codex edit, M2 milestone exit, Goal
Intake, or authority to merge, release, deploy, or perform another external
effect.

## Authority and source identity

The review applies the repository authority order, Runtime Invariants I-001
through I-010, ADR 0005, ADR 0009, ADR 0016 through ADR 0022, ADR 0028 through
ADR 0030, the
[Slice 5 contract](../plans/m2-codex-vertical-slice.md#slice-5--reject-repair-and-accept-orchestration),
and the applicable D, E, and F rows in the
[M2 acceptance plan](../plans/m2-acceptance-plan.md#7-mandatory-acceptance-matrix).
Slice 4 was committed on `main` as
`79e89ab6dd79b2b81d64fc1da7aee5c012d60a2d` before Slice 5 began.

The final reviewed working-tree source identity excludes only this review file
to avoid self-reference:

```text
Base Git revision: 79e89ab6dd79b2b81d64fc1da7aee5c012d60a2d
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 912
Source manifest digest: sha256:04b5db89656280a8b8b35f6db2f191296f076f52d1473301939aba0d158e12d5
Self-referential review exclusion: docs/reviews/m2-slice5-reject-repair-accept.md
```

## Trusted orchestration boundary

The public M1 `createWorkflowDriver` capability remains start, resume, and
cancel only. Slice 5 adds a composition-only M2 driver surface whose repair
operation must consume the exact current `REJECT_REPAIRABLE` Acceptance
Decision, manifest, Candidate digest, Goal revision, and Workflow version
before the existing Runtime may create a child generation.

The Candidate-leased Worker wrapper reads current Goal, Workflow, Candidate,
and generation authority through a narrow query port. Only `IMPLEMENT` receives
a mutable Candidate lease, and only when the Workflow is `RUNNING` with the
request's exact active Attempt. The implementation-worker factory receives the
validated Worker Request and that lease, not Store or Workflow mutation
capabilities. `DISCOVERY` and `PLAN` keep their existing Worker behavior. Lease
release covers current-lease assertion, factory, and stream failures at the
worker-call boundary, while source freeze remains a separate Runtime
operation.

The Runtime Execution Profile decoder treats nested local-verification
configuration as one closed record. Before `StartGoal` can write authority, the
driver reloads the installed Profile and binds the configured local runner
identity and version to its exact verification-runner identity and version.
The composition-only M2 driver requires this capability both initially and
whenever it resolves a bound Profile. Start, Resume, and repair preflight that
capability before their authority mutation, and Resume reuses the same binding
after Recovery commits. Unknown nested fields, missing capability methods, a
missing capability, and another runner fail before command persistence. Once
selected, Runtime requires the current local Check,
Obligations, and read-only lease session before an `EVIDENCE_BUILD` Attempt and
rejects the M1 fake-verification entry point.

After each generation freezes, the Runtime records one generation-bound local
Check and one local Verification Obligation per required Criterion. The M1 fake
Check family remains immutable bootstrap and regression authority; it is not
silently rewritten. Evidence Set selection uses exactly one complete Check
family. Runtime, Store, migration 0021, strict reopen validation, and direct SQL
adversarial tests reject mixed or partial families. Runtime Attempt and local
execution clocks are also floored by the selected Obligation creation time;
Store admission, strict reopen, and migration 0022 independently reject
verification Evidence that predates its exact Obligation. Negative tests cover
all three boundaries, including an atomic 0021-to-0022 upgrade refusal.

## Reject, repair, and closeout path

The deterministic fixture uses a disposable real Git source, the controlled-copy
workspace adapter, mutable and read-only leases, the Darwin Seatbelt verifier,
and `/usr/bin/grep` with an exact executable digest. Generation 1 writes an
incorrect marker, freezes, produces real failing local-command Evidence, and
reaches `REJECT_REPAIRABLE`. A Worker completion claim and process result do not
close the Goal.

The trusted repair command preserves the first Acceptance Decision and exact
repair record, rejects generation 1, and creates generation 2 from its exact
frozen digest. Generation 1 remains byte-identical. Generation 2 alone is
edited, receives a fresh local Check identity after its own freeze, produces
real passing Evidence, and reaches deterministic `ACCEPT` and Runtime closeout.
The source checkout remains unchanged, M1 fake Verification is never invoked on
this path, and a stale first-generation repair request cannot mutate the closed
Goal. SQLite reopen reconstructs the same final Goal, Workflow, Candidate,
Evidence, Acceptance, repair, and Closeout authority.

The immutable repair record continues to bind the M1-generated child
freeze/verification bootstrap family created in the repair transaction. The
later local Check family is separate post-freeze verification authority. Strict
reopen validates both complete families instead of weakening or rewriting the
historical repair record.

## Active verification drift atomicity

When pre-run or post-run source observation differs from the frozen Candidate
digest, the Runtime does not admit a local-command Evidence record. It derives
one exact Candidate invalidation and one `INTEGRITY_VIOLATION` Attempt failure
whose closed reason is `CANDIDATE_SOURCE_DRIFT`.

The Store commits Candidate invalidation, invalidation of every eligible
Evidence record for that generation, Attempt failure, Workflow failure, audit
events, and the processed-command outcome in one immediate transaction. It
rechecks current Workflow version, Attempt, Candidate version and digest,
source-observation digest, audit cardinality, and payload digest. A forged
Attempt reason is rejected before persistence.

Fault injection after command check, Candidate transition, Evidence eligibility
write, Attempt write, Workflow write, audit append, command recording, and
before commit proves full rollback at every boundary. The success case and
strict SQLite reopen prove the complete failure state survives without a split
authority. A separate during-command mutation case proves the runner executes
once, post-run drift is detected, and no result Evidence is admitted.

## Focused executable evidence

The focused suites pass with zero failed, cancelled, skipped, or todo cases:

- strict TypeScript typecheck and forced build pass;
- migration fingerprint and ledger audit passes `1/1` with migrations 0021 and
  0022;
- Candidate/Evidence adversarial coverage passes `100/100`, including the
  no-fallback Runtime boundary, forged reason, backing-clock rollback, direct
  Store causal rejection, causal-invalid strict reopen, atomic migration 0022
  refusal, pre-run and during-run drift, all compound transaction probes, and
  mixed and partial Check families;
- Candidate-leased Worker authority coverage passes `4/4`, including idle or
  non-`IMPLEMENT` exclusion and release after lease-assertion or factory
  failure;
- closed Runtime Profile admission passes `5/5` negative cases, including
  missing initial and resolved local-verification capability at repair and
  Resume boundaries, without Recovery invocation, a processed command, or
  Workflow mutation;
- the real Candidate/verifier reject/repair/accept fixture passes `1/1`; and
- the complete Store authority regression, now including that fixture, passes
  `272/272`.

The Seatbelt cases ran outside the host tool sandbox because the sandbox cannot
nested-launch the selected isolation profile. The tested process remained
inside CodeClosure's own Darwin Seatbelt policy and disposable fixture roots.

## Closing executable evidence

The final `pnpm gate:quality` result and aggregate stage counts are recorded
after documentation closure:

```text
format: PASS
docs: 75/75 tests; 61 portable GFM sources
M2 protocol snapshot: PASS; Codex 0.146.0; pinned snapshot unchanged
lint and boundaries: 26/26 tests; 9 packages; 801 sources
typecheck: PASS
unit: 7/7 + 41/41 + 40/40 + 18/18 + 11/11 + 140/140
authority digests: 36/36
migrations: 99/99
Store/Runtime authority: 272/272
CLI integration: 58/58
M1 adversarial demos: 8/8
invariant checker: 4/4; coverage 31/31; 42 sources; 418 executable tests
forced build: PASS
```

## Documentation and architectural review

The root README, Architecture status and runtime boundaries, Workflow, Domain,
Evidence, Acceptance, M2 milestone, implementation plan, acceptance-plan
status, review index, ADR index, and Runtime Invariants were reviewed together.
No accepted architectural decision changed: Slice 5 implements ADR 0016, ADR
0018 through ADR 0020, and ADR 0028 through ADR 0030 through existing authority
owners. No new ADR or Runtime Invariant is needed.

The documentation does not claim Slice 6 recovery, Slice 7 public/live
composition, Slice 8 milestone audit, M2 completion, or M2.5 Goal Intake. M0 and
M1 historical records remain unchanged.

## Verdict, limitations, and next action

Every bounded Slice 5 exit condition passes. Slice 5 is implemented and Slice
6 may begin.

The active local-verification lease and Check session are intentionally
in-memory in this slice. A process restart after local authority is recorded
therefore requires the explicit reconciliation and reconstruction work owned by
Slice 6; Slice 5 does not pretend that re-instantiating the driver can resume
the old external operation. The deterministic path uses a trusted controlled
Worker rather than a live model, and the selected real verifier isolation is
Darwin-only. Public CLI composition, live Codex execution, Thread/Turn/Compact
continuity, external-execution persistence, and the independent M2 exit review
remain required before M2 can be complete.
