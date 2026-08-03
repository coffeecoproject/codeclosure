# M2.5 Slice 2 SQLite Intake Authority Review

- Review date: 2026-08-03
- Scope: M2.5 Slice 2 only
- Status: Complete
- Verdict: `PASS`; Slice 3 may add packages, manifests, and the bounded Intake
  Assistant Adapter against this persistence boundary

## Review question

This review asks whether Slice 2 persistently closes the already accepted
Intake authority shapes without issuing Admission, granting an assistant formal
authority, bypassing the existing Goal/Workflow owners, or invoking ordinary
Start. It covers migration, Store ports, compound transactions, command replay,
strict reopen, and verified SQLite activation.

It does not claim that Goal Intake is operational. There is no Intake package
compiler, assistant adapter, Coordinator, Admission evaluator, public Intake
command, orphan-operation reconciliation, or ordinary `StartGoal` invocation in
this slice. The optional Start Authorization is retained authority for a later
separate command; it is not an Attempt or dispatch.

## Source identity

The final reviewed working-tree source identity excludes only this review file
to avoid self-reference:

```text
Base Git revision: b0829fb8d68110c4a7fccea99605ae138e6e6c41
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 950
Source manifest digest: sha256:9e3a1bfde704c51f89f625e5832f3b4c213fbde1e6dde3820a23523128333233
Self-referential review exclusion: docs/reviews/m2-5-slice2-sqlite-intake-authority.md
```

The implementation branch is `m2.5-goal-intake`. The shell reports Node
`v23.11.0`, outside the repository's supported Node 22 range, and pnpm
`11.1.3`. The final checks therefore retain the visible engine warning and do
not establish supported-Node evidence.

## Implemented authority surface

Slice 2 adds migration `0026_intake_authority.sql` after the exact M1/M2
baseline. It persistently represents installed Admission Policy, Raw Request
and revision, versioned Intake Run, durable Manifest, Proposal, Source Binding,
Projection, Material Ambiguity, Question specification and record, Answer
Binding, Answer-only Response, Failure, command reservation/outcome,
Materialization, optional Start Authorization, and Intake-to-audit
relationships. Authority tables are strict and immutable, with relational and
shape backstops for terminal, clarification, abandonment, Materialization, and
Start-Authorization closure.

The public Runtime Store port separates reservation from completion. SQLite
authors result and outcome digests inside the completion transaction; callers
cannot supply a stored outcome or promote a Proposal into Admission. The Store
implements exact replay, active-operation detection, typed version/command
losers, policy installation, deterministic read ordering, and one complete
read view reconstructed from retained authority.

Compound transactions cover:

- initial and clarification reservations;
- Proposal/Projection/Ambiguity plus `CLARIFY` or projected non-execution;
- exact Question-bound Answer Binding and active-reference clearing;
- applied fully bound and rejected base-only abandonment;
- immediate non-execution, Answer-only completion, and terminal failure; and
- Admission plus formal Goal revision 1, unique `DISCOVERY / READY` Workflow,
  Materialization, optional Start Authorization, audits, and command outcome.

The Materialization transaction creates no Attempt, Context, dispatch claim, or
worker call. Existing direct `CreateGoal` command closure remains unchanged;
strict Workflow reopen accepts the new version-1 creation source only when the
exact Intake outcome, Materialization, Goal/Workflow audits, identities,
versions, timestamps, and payload digest agree.

## Reopen and activation review

Store open strictly decodes every retained Intake record, recomputes canonical
digests, and validates the complete cross-record chain. It rejects missing,
cross-Intake, or substituted Answer Bindings; active answered Questions;
missing, unbound, or reservation-less abandonment outcomes; false Manifest,
Policy, Proposal, Projection, ambiguity, Decision, Materialization, Goal,
Workflow, Start-Authorization, and terminal references; and codec-invalid
retained JSON.

Verified SQLite activation rejects partial Intake schema before migration or
verifier activation. Complete retained Raw Request revision, Intake Run,
Admission Decision, and Materialization project references participate as
denial-only isolation inputs alongside Goal paths. The post-migration set must
match the inspected set exactly; none of these references becomes Goal
authority.

The final migration fingerprint is 60 tables, 25 indexes, 209 triggers, no
views, and
`sha256:5408eb294737e281f2a600e5fe78e03624e686eb434ec018734184c5b413b08a`.
Migration `0001` through `0025` meaning and direct `CreateGoal` compatibility
remain regression-tested.

## Boundary review

Codex protocol types do not enter Domain, Runtime Store contracts, or SQLite.
No new package dependency was added. Only the deterministic Admission Engine
may issue a semantic Admission result; Slice 2 merely validates and persists
the closed Decision supplied across that future owner boundary. Only the
existing Goal and Workflow constructors form the formal initial records, and
the Store atomically persists their exact snapshots. Only the Acceptance Engine
can issue technical `ACCEPT`.

The root README, Architecture status, Goal Intake, Domain Model, Workflow,
Context Compiler, Acceptance Engine, Evidence Model, ADR index, milestone, and
implementation/acceptance plans were reviewed. ADR 0027 and ADR 0034 already
govern the implemented decisions, so no new ADR is required.

## Verification

`corepack pnpm gate:quality` exited zero against the final non-review source
identity. It recorded 75/75 documentation-structure tests over 73 Markdown
sources, 28/28 boundary/dependency tests over 823 JavaScript/TypeScript
sources, 296/296 staged unit tests, 44/44 digest tests, 99/99 migration tests,
379/379 authority tests, 62/62 CLI integration tests, 8/8 adversarial demos,
4/4 invariant-checker tests with 32/32 invariant coverage, and the final clean
production build. Every invoked Node test stage reported zero failed,
cancelled, skipped, and todo tests.

Focused migration, authority, failure-injection, corruption, activation,
replay, and reopen tests are included in those stages. The source manifest
above was generated after the non-review tree reached its final content and
excludes only this review file.

## Remaining boundary

Slice 3 may add only the Runtime Intake/Answer package compiler, durable package
selection around the existing Manifest, and the capability-denied Intake
Assistant Adapter over the public lower App Server client. It may not add the
Coordinator or Admission evaluator, publish CLI behavior, invoke
Materialization or ordinary Start, or claim an M2.5 milestone verdict.
