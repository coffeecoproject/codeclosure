# M2.5 Slice 7 CLI and Acceptance Harness Review

- Review date: 2026-08-05
- Scope: M2.5 Slice 7 implementation only
- Status: Implementation complete; independent milestone assessment not executed
- Verdict: `PASS` for the bounded Slice 7 implementation only

## Review question

This review asks whether Slice 7 exposes the already-bounded Intake flow through
narrow public CLI command/read facades, proves the deterministic lower App
Server and strict cross-process SQLite path, and implements the canonical
fail-closed `accept:m2.5` evidence runner without granting the CLI, fixture,
runner, or review any Admission, Goal, Workflow, Start, Evidence, Acceptance, or
milestone-verdict authority.

It does not execute the M2.5 assessment, issue the independent M2.5 verdict,
prove product completion, or authorize merge, release, deployment, or another
external effect.

## Source identity

The reviewed working-tree source identity excludes only this Slice 7 review to
avoid self-reference:

```text
Base Git revision: d349014899fc1e623254ca61935b00ef3b218ecc
Git branch: m2.5-goal-intake
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 985
Source manifest digest: sha256:c073e867a3ced8e325c8bbf3bdd37cd51de5eb0b106ef33401b5e48d3c52c478
Self-referential review exclusion: docs/reviews/m2-5-slice7-cli-acceptance-harness.md
```

Final verification uses Node `v22.22.3`, inside the repository's supported
range, and pnpm `11.1.3`.

## Implemented boundary

The CLI implements `intake submit`, `intake clarify`, `intake abandon`,
`intake status`, and `intake audit`. Submit requires one explicit
`answer-only`, `materialize-only`, or `governed-execution` action; there is no
implicit default. Clarification and abandonment require the exact retained
Intake identity and current version, while clarification additionally requires
the exact current Question ID. Human and single-document JSON rendering consume
shared Runtime results and views. Exit classes distinguish usage, content or
command rejection, governed incomplete state, and infrastructure failure
without inventing Goal completion.

Intake request, constraint, and clarification-answer operands reject
whitespace-only input without trimming accepted bytes. Typed Intake and
Question identities likewise reject rather than normalize surrounding bytes,
so the CLI cannot silently change user-authored source later retained and
digested by Runtime.

Trusted composition captures the Store, Admission Engine, Goal Manager,
Workflow application, assistant adapter, policy/profile installers, and startup
recovery. Handlers receive only `submit`, `clarify`, `abandon`, `getStatus`, and
`getAudit`. Project roots cross verified activation before the Store opens.
Only the admitted governed-execution branch can carry the immutable Start
Authorization into the existing ordinary `StartGoal` boundary; Answer-only,
clarification, abandonment, reads, and materialize-only cannot start a Goal.

The deterministic CLI fixture starts the existing fake App Server through the
real lower process/protocol client and the real Intake Assistant Adapter. It is
not a fake Runtime Intake port. Each assistant operation remains fresh,
isolated, read-only, closed-schema, and non-authoritative. One causal
cross-process demonstration submits a governed request through the Adapter,
retains its unsupported assumption as `CLARIFY`, reads the exact Question
specification and record digests, answers through the CLI with the retained
ID/version and a new Raw Request revision plus immutable Answer Binding, then
uses a second fresh Adapter operation to Materialize and invoke only the
ordinary preallocated `StartGoal`. After every child process exits, a direct
SQLite observer opens the authority database, proves the Workflow is closed by
the existing M1 happy path, closes it, and performs strict reopen. Separate
scenarios retain Answer-only, materialize-only, exact-version abandonment, and
the Start-failure proof that preserves a visible `READY` Goal with no partial
Attempt. That Start proof closes and strictly reopens SQLite, replays the exact
Intake command without another assistant call, and permits only the originally
preallocated ordinary `StartGoal` command to perform the still-missing first
Start; replay of that command cannot create another Attempt.

Trusted Intake composition is also reopened over retained analysis and
Answer-only orphans. Strict activation and operation-kind-aware reconciliation
finish before the application facade is returned, publish only the two audited
terminal results, and make no recovery-time assistant call.

The root `accept:m2.5` command names the nine mandatory stages in canonical
order, rejects omission/reordering, zero tests, skip/todo/cancel counts, source
drift, unsafe or digest-mismatched artifacts, missing matrix rows, missing proof
configuration identities, altered non-claims, and any manifest claim that its
result is the milestone verdict. It records branch/source, toolchain and
runtime identity, exact stage commands and start/end/exit/duration, fixed
Admission/assistant/Workflow/Profile/adapter/schema identities, all 71 matrix
rows, and the single later-review exclusion. Its `PASS` means only
`READY_FOR_INDEPENDENT_REVIEW`; `milestoneStatusMutationAuthorized` is always
false. The runner does not rewrite source or invoke itself during this Slice
review.

Passing test stages retain their raw TAP names in the stage artifact. Every
matrix row has one explicit stage-and-test binding; a passing aggregate stage
cannot make a row pass when its required named proof did not execute. The
runner also pins the semantic digest of all 71 matrix rows, gives every stage an
isolated state-root parent, and emits a closed per-row receipt containing the
exact plan text, row digest, expected/observed disposition, strict-reopen
applicability, required test names, raw stage artifact digest, and recomputable
`evidenceReceiptDigest`. That receipt links executed evidence and does not
claim to be a domain projection. `M25-D01` through `M25-D07` and `M25-D09` bind
the one real CLI-to-Adapter-to-SQLite governed chain; `M25-D08` remains bound to
the intentionally separate SQLite Start-failure/reopen/replay proof. `M25-S04`,
`M25-G20`, and `M25-R05` bind the trusted-composition strict-reopen proof, while
`M25-G14` and `M25-R10` bind the exact preallocated Start replay proof.
`M25-R03` requires both strict reopen/replay evidence and the same-CommandId
conflict proof that preserves the original reservation and final outcome.

Two additional closed JSON artifacts record the lower Adapter assumption
observation and canonical governed chain with exact root kinds, digest-only
input identity, expected-versus-observed dispositions, closed authority
projections, and strict-reopen result. Arbitrary fields and open authority
claims are rejected. Unavailable proof configuration or source identity is
represented by a typed unavailable record and produces `BLOCKED` with
`NOT_READY_FOR_INDEPENDENT_REVIEW`; it cannot become `FAIL` or retain a ready
claim merely because identity collection was unavailable.

## Documentation and ADR review

The repository guidance, root README, Architecture status, Goal Intake, Domain
Model, Workflow, Context Compiler, Evidence Model, ADR index, milestone
boundary, plans index, implementation plan, and acceptance-plan status were
reviewed in the same change. They state that all implementation slices are
present while the canonical assessment and independent M2.5 verdict remain
unexecuted. Historical M1/M2 records remain regression evidence and are not
reinterpreted as M2.5 proof.

No durable architectural decision changed. Slice 7 implements the accepted
ADRs 0027, 0034, and 0035 boundaries and therefore adds no ADR. CLI rendering,
runner aggregation, test fixtures, and review text create no second completion
authority.

## Verification

The runner contract self-tests passed `8/8`. The canonical cross-process CLI
chain and lower App Server/Adapter assumption fixture each passed `1/1`, and
their emitted scenario evidence passed production-schema validation `2/2`.
The focused SQLite Intake suites passed `152/152`, the complete Intake Adapter
suite passed `28/28` through the real lower App Server fixture, and the complete
CLI integration suite passed `70/70`.

The complete supported-toolchain quality gate and final source identity are
recorded below after final documentation closure:

```text
corepack pnpm gate:quality
Result: PASS (exit 0)
Documentation: 75/75 checker tests; 79 portable repository GFM sources
Unit groups: 23/23, 44/44, 57/57, 28/28, 19/19, 13/13, 160/160
Digest authority: 46/46
SQLite migrations and restart behavior: 102/102
Authority and adversarial behavior: 454/454
CLI integration: 70/70
M1 adversarial demos: 8/8
Invariant checker: 4/4; 32/32 invariants; 507 metadata-bearing tests
Formatting, protocol snapshot, lint/dependency audit, typecheck, and build: PASS

Final source identity excluding only this review:
Base Git revision: d349014899fc1e623254ca61935b00ef3b218ecc
Git branch: m2.5-goal-intake
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 985
Source manifest digest: sha256:c073e867a3ced8e325c8bbf3bdd37cd51de5eb0b106ef33401b5e48d3c52c478
Self-referential review exclusion: docs/reviews/m2-5-slice7-cli-acceptance-harness.md
```

No live Intake model request and no `accept:m2.5` procedure was executed.

## Remaining boundary

Slice 7 completes the planned implementation slices, not the M2.5 milestone.
The next step is to run the canonical `accept:m2.5` procedure on one exact
supported-toolchain source identity and then conduct the separate independent
review defined by the acceptance plan. Only that review may issue the bounded
M2.5 `PASS`, `FAIL`, or `BLOCKED` verdict.
