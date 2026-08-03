# M2.5 Slice 4 Coordinator, Projection, Clarification, and Admission Review

- Review date: 2026-08-04
- Scope: M2.5 Slice 4 only
- Status: Complete
- Verdict: `PASS` for M2.5 Slice 4 only; Slice 5 has not begun

## Review question

This review asks whether Slice 4 implements the bounded non-Answer Intake
Coordinator, source-bound Projection construction, clarification and
abandonment commands, deterministic Admission evaluation, atomic `CLARIFY` and
non-Answer `NO_EXECUTION`, and typed in-process status views without beginning
Answer-only/failure recovery, Goal Materialization, ordinary Start, CLI, or the
M2.5 milestone verdict.

It does not claim that Goal Intake is operational or that M2.5 is complete. A
complete `MATERIALIZE` Admission result remains a non-durable in-process
boundary for Slice 6 and cannot create Goal or Workflow authority in this
slice.

## Source identity

The final reviewed working-tree source identity excludes only this review file
to avoid self-reference:

```text
Base Git revision: f857144aa4b069209eb8b4708ccae7da1fc7ed25
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 970
Source manifest digest: sha256:cdb49b6a52ee89b996004fc51ce750324d9885cf3c8943b0761d3fcac91921b7
Self-referential review exclusion: docs/reviews/m2-5-slice4-coordinator-projection-admission.md
```

The implementation branch is `m2.5-goal-intake`. Final verification used Node
`v22.22.3`, inside the repository's supported range, and pnpm `11.1.3`.

## Implemented boundary

`M25IntakeCoordinator` implements Runtime-owned `submit`, `clarify`, `abandon`,
and typed status behavior for Slice 4. It validates and canonically binds each
command, reserves external analysis before the assistant call, prevents an
exact command from launching twice, and uses Store-authored outcomes for final
replay. Public clarification accepts only the Question ID plus the answer and
optional structured project reference. Runtime resolves the immutable
Question specification, record digest, issuing Decision, and answer schema
from retained authority before constructing the internal command binding.

An accepted clarification atomically appends one Question-bound Raw Request
revision and one immutable Answer Binding, clears the active Question
reference, records the new analysis reservation and Manifest, and only then
invokes a fresh assistant operation. A structured project correction is
admitted only for the exact active project-identity Question. An unrelated
project correction records one deterministic `REJECTED` clarification outcome
without a new revision or external call. Eligible abandonment atomically binds
the exact Projection, Question, issuing Decision, and Command in a
`PROJECTED_NO_EXECUTION / ABANDONED` Decision; it clears the active reference
without creating a Raw Request revision or invoking the assistant. Ineligible
abandonment retains only the base reservation and `REJECTED` outcome.

The deterministic Projection compiler independently revalidates the closed
assistant response and fixed byte/count budgets. Candidate source spans use
zero-based, end-exclusive UTF-8 scalar boundaries and become `USER_STATED`
only when they equal exact bytes in a selected Raw Request revision. Other
assistant values remain `MODEL_PROPOSED`; the only `POLICY_DERIVED` bindings
are the exact declared-project and trusted-action derivations. The compiler
binds model-proposed values to the exact schema paths such as
`/proposedObjective` and `/proposedCriteria/0`, then constructs versioned
Projection revisions, Material Ambiguities, and one bounded Question
specification in the fixed material-field order. Historical Projection schema
version 1 remains decodable under canonical profile
`codeclosure-m2-5-projection-v1` with a required objective. The compiler emits
schema version 2 under `codeclosure-m2-5-projection-v2`: a missing proposed
objective is omitted, not replaced by placeholder text, and is closed only by
one exact Proposal-bound `OBJECTIVE_UNRESOLVED` ambiguity with no objective
Source Binding. A fixed schema-v2 golden digest pins that projection contract.

The capability-free Admission Engine revalidates the current Intake snapshot,
Raw Request chain, Proposal, Projection, Source Bindings, ambiguity set,
project, installed Policy, Proposal adapter/response-contract identity,
optional governed-execution preflight, and active Projection/Question binding.
It deterministically issues pre-analysis
non-execution, `CLARIFY`, abandonment, or `MATERIALIZE` with a stable ordered
reason trace. It validates model-proposed field paths against the exact
Proposal schema, applies the installed material-field rule's allowed source
classes to every binding, and requires the projected execution disposition to
agree with the trusted interaction action. Model-proposed-only objective or
Criterion text cannot satisfy material-field eligibility. An exact
Proposal-bound `UNRESOLVED` classification is accepted only when a same-field
unresolved Material Ambiguity owns its digest, so it can produce `CLARIFY` but
cannot satisfy Materialization. A wholly absent objective likewise produces
only the exact Proposal-digest-bound objective clarification; compiler,
Admission, Store commit, and strict reopen reject a substituted closure. The
evaluator has no
assistant, Store, Goal, Workflow, Worker, Candidate, Evidence, Acceptance, or
external-effect capability.

## Persistence closure

Migration `0028_rejected_clarification_reservation.sql` preserves the immutable
reservation table while adding the one closed clarification-rejection shape:
an exact clarification binding without an external Manifest. Such a reservation
is legal only with an atomic `REJECTED` outcome and no Answer Binding. Strict
reopen recomputes that relationship and rejects mixed or false authority. The
clarification version contract now distinguishes the expected pre-answer
`NEEDS_CLARIFICATION` version from the observed post-reservation `ANALYZING`
version.

Migration `0029_intent_projection_schema_v2.sql` rebuilds the Projection table
with closed schema-version-1 and schema-version-2 rows, copies historical rows
without changing their JSON or semantic digests, and restores its immutable
triggers. The migration runner temporarily suspends connection-level foreign
key enforcement only around its transaction-owned schema migration, executes
`foreign_key_check` before commit, and restores enforcement before Store
publication. A populated schema-version-1 clarification fixture upgrades
through 0029 and reopens with an identical Projection record and digest.

The existing Store compound transactions remain the only persistence writers.
Analyzed commit and strict reopen independently bind the Proposal's adapter,
response-contract, and Admission Policy identities to the originating command
reservation and its exact Manifest external-operation binding; internally
rehash-consistent identity substitution therefore fails closed.
The Coordinator project-correction path is exercised through verified SQLite
activation: an allowed explicit path reaches the Store isolation lease, while
an unadmitted path fails before a Raw Request revision, Answer Binding, or
second assistant call can be created.
Slice 4 adds no second Admission issuer, Goal creator, Workflow writer,
technical Acceptance issuer, or worker-writable authority location.

## Boundary and documentation review

The root README, Architecture status and component boundaries, Goal Intake,
Domain Model status and authority matrix, ADR index, milestone boundary, and
implementation/acceptance plans were reviewed. README, Architecture, Goal
Intake, Domain Model, milestone, and implementation-plan status required
bounded Slice 4 updates. The ADR index remains correct: implementation follows
accepted ADRs 0027, 0034, and 0035 and introduces no durable architectural
decision requiring a new ADR. Workflow, Context, Acceptance, Evidence, and the
M2.5 acceptance plan remain correct without semantic change.

## Verification

`corepack pnpm gate:quality` exited zero against the source identity above under
Node `v22.22.3` and pnpm `11.1.3`. It recorded 75/75 documentation-structure
tests over 76 Markdown sources, the exact Codex `0.146.0` protocol snapshot,
28/28 boundary/dependency tests over 835 JavaScript/TypeScript sources, 330/330
staged unit tests, 45/45 digest tests, 99/99 migration tests, 416/416 authority
tests, 62/62 CLI integration tests, 8/8 adversarial demos, 4/4
invariant-checker tests with 32/32 invariant coverage, and the final forced
production build. Every invoked Node test stage reported zero failed,
cancelled, skipped, and todo tests.

The Authority total includes seventeen focused Coordinator tests, counting the
seven named substitution subtests. They cover a real SQLite clarification chain
and immutable Answer Binding, exact replay and command conflict, a rejected
unrelated project correction that survives reopen, verified-activation
allowance and denial for project correction, model-only material-field denial,
an absent objective's exact Proposal-bound clarification, fixed schema-v2
digest, Store-commit denial, and corrupted-state strict-reopen denial,
exact Proposal-bound `UNRESOLVED -> CLARIFY`, wrong-Question denial,
digest-valid execution-disposition, Proposal-path, source-class, adapter ID,
adapter version, and response-contract substitution, supported immediate
non-execution, eligible and ineligible abandonment, non-durable materialization
handoff, and stale candidate source-span rejection. The Intake Store suite also
rejects the three digest-valid Proposal-envelope substitutions at commit and
one independently rehashed Manifest/reservation/outcome substitution at strict
reopen. It also carries one populated schema-version-1 Projection through
migration 0029 without changing its record or digest, while retaining the
compound rollback, concurrency, corruption, and other substitution coverage.

The complete gate requires Darwin child-process identity inspection for the
existing App Server client regression suite. The final gate ran with that
inspection available and exited zero. This does not add a live assistant call
or enlarge the Slice 4 verdict.

## Remaining boundary

Slice 4 is implemented, but Goal Intake is not operational. Slice 5 still owns
Answer-only delivery, terminal Intake failure classification, startup orphan
reconciliation, and the exact retention classifier. Slice 6 owns atomic Goal
Materialization and optional Start Authorization; Slice 7 owns trusted CLI
composition, including pre-activation isolation of explicit project roots, and
the acceptance harness. No durable `READY_TO_MATERIALIZE`, Goal, Workflow,
Start, Candidate, Evidence, Acceptance, release, deployment, or external-effect
authority is added by this slice.
