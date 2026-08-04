# M2.5 Slice 6 Materialization and Start Review

- Review date: 2026-08-04
- Scope: M2.5 Slice 6 only
- Status: Implementation complete; final-identity complete gate established
- Verdict: `PASS` for the bounded M2.5 Slice 6 implementation; Slice 7 has not
  begun

## Review question

This review asks whether Slice 6 implements atomic Goal/Workflow
Materialization, the immutable Materialization Record, optional Start
Authorization, post-commit ordinary `StartGoal` composition, the five closed
Start dispositions, and composite status without beginning the Intake CLI,
the `accept:m2.5` runner, or the independent milestone verdict.

It does not claim that Goal Intake is operational, that M2.5 is complete, or
that a materialized or started Goal has technical Acceptance.

## Source identity

The reviewed working-tree source identity excludes only this review file to
avoid self-reference:

```text
Base Git revision: 4138a3b5c8e808594962381fce410ddeba38d9c3
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 975
Source manifest digest: sha256:ccf6b881da85a9973854b1a0038d43310df5ccd4abf5b08289bba70598555ecc
Self-referential review exclusion: docs/reviews/m2-5-slice6-materialization-start.md
```

The implementation branch is `m2.5-goal-intake`. Final verification used Node
`v22.22.3`, inside the repository's supported range, and pnpm `11.1.3`.

## Implemented boundary

`M25IntakeMaterializer` is a trusted Runtime primitive with Intake Store,
clock, digest, and identity capabilities but no `StartGoal`, Worker, Candidate,
Evidence, or Acceptance capability. It consumes one current Engine-issued
`MATERIALIZE` Decision and its exact Proposal, Projection, ambiguity, and
`ANALYZING` Intake authority. It constructs Goal revision 1 through the
Goal Domain's named exact-text constructor and the initial
`DISCOVERY / READY` Workflow through the existing Workflow constructor. The
exact-text path runs the same Goal invariant validation while preserving the
Admission-bound objective and structured project path. Direct `CreateGoal`
retains its existing boundary normalization.

One Store transaction independently decodes and revalidates the complete
chain, then commits the Goal, Workflow, synchronized Intake lifecycle,
Materialization Record, optional Start Authorization, Goal/Workflow/Intake
audits, and Store-authored command outcome. Local-v1 Materialization requires
one resolved objective, only required Criteria, no optional Criteria or
assumptions, an empty ambiguity set, and the exact admitted project scope.
Materialization creates no Attempt, Context, Policy/Profile Workflow binding,
dispatch, Candidate, Evidence, or Acceptance authority.

Direct `CreateGoal` and Intake Materialization use one named
`GOAL_AND_WORKFLOW_CREATED` payload projection for their Goal and Workflow
creation audits. The surrounding Intake authority remains additional and does
not change that shared lifecycle projection. A direct-creation regression also
proves that compatibility does not synthesize Raw Request, Intake, Proposal,
Projection, Admission, Materialization, or Start-Authorization rows.

`MATERIALIZE_ONLY / LEAVE_READY` creates no Start Authorization. A coordinator
configured for governed execution may still process this action without
implicitly starting it; later explicit manual `StartGoal` and cancellation
remain ordinary Workflow commands. `GOVERNED_EXECUTION / AUTHORIZE_START`
creates exactly one authorization binding the admitted principal and source,
Decision, Materialization, Goal/Workflow, preallocated command, and exact
installed Policy/Profile preflight identities.

Only after Materialization returns a committed outcome does the Coordinator
submit the authorization's exact preallocated request through the existing
asynchronous `StartGoal` application capability. That path remains the owner of
freshness, first Policy/Profile bindings, Context, Attempt, dispatch,
processed-command idempotency, and driver recovery. The persisted Intake
outcome remains an immutable record of successful Materialization with
`READY_PENDING_START`; the composite command result separately reports the
observed Start disposition and never rewrites that outcome.

The five public Start dispositions are closed as `NOT_AUTHORIZED`,
`READY_PENDING_START`, `START_COMMAND_APPLIED`, `START_COMMAND_REJECTED`, and
`START_INFRASTRUCTURE_FAILURE`. Status derives them from the immutable Start
Authorization, the exact processed Start command, and current Workflow
authority. An applied processed outcome counts as the first Start only when it
is the exact initial `DISCOVERY / RUNNING` transition from the authorized
Workflow version; a different Goal command occupying the preallocated command
identity is reported as `START_COMMAND_REJECTED`. An applied preallocated Start
must also match the actual first-Start Workflow Policy and Execution Profile
bindings by Goal, Workflow, command, ID, and digest. The status path has no
retry capability. The immediate automatic-Start response also reconciles the
composition result with this retained authority: a retained applied or
rejected outcome is authoritative, while an unretained reported application
is an infrastructure failure rather than a completion claim.

## Persistence and recovery closure

The Slice 2 strict-reopen closure originally treated the initial
`DISCOVERY / READY` snapshot as a permanent Materialization invariant. The
focused Slice 6 test therefore exposed that a legal ordinary Start was rolled
back at transaction close. The corrected invariant still requires
Materialization to bind Workflow version 1 and its exact creation time, but
allows the owning Workflow to advance monotonically under existing Runtime
commands. Workflow codecs, reducers, command freshness, first-Start bindings,
processed outcomes, audit ownership, and strict cross-record closure remain the
guards for later state. The closure also requires both Goal and Workflow
creation instants to equal `materializedAt`; a retained Goal-time substitution
fails strict reopen. Every retained Workflow reuses one exact historical
Goal/Workflow creation closure: the paired `GOAL_CREATED` / `WORKFLOW_CREATED`
audit semantics and their canonical shared creation payload digest must still
match after later transitions. A version-1 Workflow additionally proves the
complete current `DISCOVERY / READY` shape. A later Workflow reconstructs that
deterministic initial projection for the historical audit check without being
forced back to the initial snapshot; its current state remains governed by the
existing processed-command and current-audit closure.

An injected failure before Start leaves one committed `READY` Goal, no Attempt,
and no processed Start command. Exact Intake replay makes no assistant or
Materialization effect and may resubmit only the retained preallocated Start.
If a different manual Start wins first, the preallocated command receives an
ordinary deterministic rejection; there is still only one first Attempt. If
the preallocated Start already committed, replay returns its processed outcome
without creating another Attempt. A non-Start Goal command cannot be
misclassified merely because it used the preallocated command ID. A database
containing the started Materialization chain passes strict reopen. If the
preallocated Start is submitted through a different installed Policy/Profile
composition, the Store rejects and rolls back that first-Start transaction;
the committed Materialization remains `READY`, after which the authorized
composition can still apply the exact preallocated command.

The existing SQLite Materialization suite continues to cover compound-write
fault injection, exact replay, competing Materialization, identity conflict,
no-Attempt creation, and strict reopen. The focused correction path cancels the
original materialized Goal and creates a distinct new Intake/Materialization
without rewriting the original authority. Existing application and Workflow
regressions preserve direct `CreateGoal`, manual Start, cancellation, command
conflict, and driver behavior.

## Boundary and documentation review

The root README, Architecture status and component boundaries, Goal Intake,
Domain Model status and authority matrix, Workflow, Context Compiler, Evidence
Model, ADR index, milestone boundary, implementation plan, and acceptance plan
were reviewed. Context and Evidence receive no new authority; automatic Start
reuses the existing first-Context/Attempt and later Evidence/Acceptance paths.
The ADR index remains correct: Slice 6 implements accepted ADRs 0027 and 0034
and introduces no durable architectural decision requiring another ADR.

The documents mark Slices 1 through 6 implemented while retaining the precise
non-claim: the Intake CLI, M2.5 acceptance harness, and independent exit verdict
are not implemented or executed. Historical M1/M2 plans and reviews remain
unchanged evidence rather than being reinterpreted as M2.5 proof.

## Verification

The focused Coordinator suite passed 29/29 tests. Its Slice 6 cases prove
materialize-only creation and replay, ambient governed composition without
implicit Start, explicit manual Start and cancellation, governed automatic
Start and processed-command replay, strict reopen after Start, injected
between-transaction infrastructure failure, a genuinely overlapping
automatic/manual Start interleaving with one first Policy/Profile binding,
Context, and Attempt, and rollback of a substituted Policy/Profile first Start.
It also proves that a Cancel command using the exposed preallocated Start ID is
not reported as an applied Start and cannot create an Attempt, and that a
composition cannot report an applied Start while the retained Workflow remains
`READY`. The overlapping regression has a bounded per-test timeout and cleanup;
no repository-wide timeout policy was changed. The focused
Store/Coordinator/direct-application set passed 149/149 tests, including exact
Admission-bound Goal text and structured scope preservation through strict
reopen, exact creation-audit projection, direct-creation non-synthesis, and
retained Goal-time substitution coverage. The Intake Store suite passed 116/116,
including commit-time creation-digest substitution plus strict-reopen initial
Goal-time, creation-event, and paired-digest poisoning before and after Start.
The Goal-time poison retains the Intake-specific canonical payload closure so
that the shared creation closure must reject it. The migration/control Store
suite includes direct CreateGoal write-time canonical-digest rejection,
strict-reopen paired-digest poisoning before and after Start, and preservation
of codec-valid Goal text without constructor normalization. The complete SQLite
authority suite covers the same retained historical closure.

The public direct-creation regression still proves its existing objective
normalization, while the Materialization regression proves that this behavior
is not reused after exact source-bound Admission. These focused Slice 6 tests
stop at first Context/Attempt authority and do not
claim the automatic/manual race's Worker dispatch claim. The deterministic
end-to-end dispatch-claim demonstration remains part of the Slice 7 acceptance
harness and the independent M2.5 assessment boundary.

The complete repository quality gate was invoked from the reviewed working
tree with the supported Node toolchain:

```sh
PATH=/Users/liushan/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin \
  /Users/liushan/.nvm/versions/node/v22.22.3/bin/corepack pnpm gate:quality
```

The directly affected control Store suite passed `101/101`; the migration and
control Store stage passed `102/102`; and a supported-Node rerun of the complete
SQLite authority stage passed `447/447`. The focused
Store/Coordinator/direct-application set passed `149/149`. The invariant
checker tests passed `4/4` with `32/32` coverage over `505` executable
metadata-bearing tests. Targeted lint, production and test TypeScript,
formatting, and documentation (`75/75` executable checks and `78` portable GFM
sources) passed.

One initial complete `gate:quality` invocation exposed that the M2 semantic
lock still required current `AGENTS.md` guidance to repeat the historical
statement that M2.5 had not started. The correction does not weaken the M2
scope gate: the historical M2 validator now checks the stable current-milestone
identity and satisfied independent M2 prerequisite without owning the rolling
Slice number. A separate current-document assertion checks the Slice 6/7
boundary, while the semantic regression reads the historical not-started claim
from the immutable M2 completion review. The isolated M2 semantic suite passed
`8/8`.

The complete `gate:quality` procedure was then rerun on the final reviewed
source identity with the supported Node toolchain and exited zero. The unit
package stages passed `44/44`, `57/57`, `26/26`, `19/19`, `13/13`, and
`160/160`; digest tests passed `46/46`; migration and authority stages passed
`102/102` and `447/447`; CLI integration passed `62/62`; all eight M1
adversarial demos passed; and invariant validation retained `32/32` coverage.
The first sandboxed diagnostic attempt could not read Darwin process-start
identity and is not counted as the accepted run. No live Intake assistant call
or M2.5 acceptance procedure was executed.

## Remaining boundary

Slice 6 is implemented, but Goal Intake is not yet an end-to-end operational
surface. Slice 7 owns Intake CLI composition, deterministic end-to-end
fixtures, the canonical `accept:m2.5` runner and its fail-closed self-tests, and
preparation for independent assessment. The independent assessment remains a
separate step and is the only process that may issue the bounded M2.5 verdict.
