# CodeClosure Repository Guidance

## Mission

CodeClosure is a reliable control runtime for AI coding. It is not a coding
agent and must not delegate technical completion authority to Codex or another
worker.

Before making a non-trivial change, read:

1. `RUNTIME_INVARIANTS.md`
2. accepted records in `docs/adr/`
3. `PRODUCT.md`
4. `ARCHITECTURE.md`
5. the relevant domain document under `docs/`
6. `docs/milestones.md`

## Authority Order

When repository documents disagree, use this order:

1. current explicit user instruction;
2. `RUNTIME_INVARIANTS.md`;
3. accepted ADRs;
4. `PRODUCT.md` and `ARCHITECTURE.md`;
5. domain documents (`workflow`, `domain-model`, `context-compiler`,
   `acceptance-engine`, `evidence-model`);
6. milestone and review documents;
7. reference-project notes and historical discussion;
8. model memory or inference.

Do not silently resolve a conflict by choosing the easier implementation.
Record a new ADR when a durable architectural decision changes.

## Current Milestone Boundary

The M0 architecture baseline, bounded M1 deterministic skeleton, and bounded
M2 Codex Vertical Slice are complete. M1's `FakeWorker` control plane and M2's
version-bound real-Codex path, authority boundaries, and acceptance evidence
are the regression baseline and MUST remain valid.

M2 preserves the M1 domain, Workflow, persistence, Candidate, Evidence, and
Acceptance authority boundaries while selecting a direct Codex App Server
adapter for bounded execution. Codex protocol types MUST NOT leak into the
Domain or Workflow Runtime, and Codex Thread, Turn, process, or model output
MUST NOT become Goal, Workflow, Acceptance, or closeout authority. A correct
first-pass Codex edit MUST NOT be forced through an artificial failure merely
to exercise repair.

M2.5 — Goal Intake and Materialization — is complete as a bounded milestone.
Slices 1 through 7 implement the Domain, SQLite, Intake package and Adapter,
Projection and Admission, Answer/failure/recovery, Materialization, separate
ordinary Start composition, explicit-action CLI, and non-verdict assessment
harness. The corrected canonical assessment passed all 71 mandatory rows with
zero skip, and the independent completion review issued an unconditional
`PASS` on 2026-08-06. Goal Intake MUST remain separate from the Goal-bound WorkerPort
and MUST NOT reinterpret the completed M2 execution path as intent,
Goal, Start, or Admission authority.

M2.5.1 — Real Intake-to-Codex Composition Closure — is the current pre-M2.6
boundary. Slice 0 has frozen its contract, exact proof-owner map, bounded
demonstration baseline, and accepted ADR 0043. Its exact new-operation
toolchain baseline is now the reviewed Codex CLI `0.146.1` binary and protocol
snapshot; retained M2/M2.5 `0.146.0` authority keeps its historical meaning
and cannot be substituted into the selected installation. The Slice 0 closure
review passed. Slice 1 subsequently implemented and reviewed its versioned v2
Intake compatibility correction, Adapter-local typed protocol Projection,
normalized-event Observer, safe diagnostics, and retained-v1 compatibility.
Slice 2 now adds a v3 Profile/Adapter identity, preserves Slice 1 v2 records
without silent recall, and passes the explicitly authorized real Answer-only,
clear Intent, and ambiguous Intent compatibility paths with metadata-only
receipts, versioned strict structured-output and exact-source instruction
contracts, and Runtime-owned exact retained-value matching. Slice 3 may begin,
but real phase composition and milestone assessment have not started. A real pinned-version
integration test found that
the M2.5 Intake Observer rejects valid disabled remote-control and rate-limit
projections plus an empty progressive `agentMessage` start, while the closed
configuration itself requests two deprecated Web Search feature keys. The same
investigation confirmed that ordinary M2.5 production composition currently
selects the M1 FakeWorker Profile rather than the real M2 Codex Execution
Profile. M2.5.1 MUST version the corrected Intake profile/Adapter, preserve
historical version-1 authority, introduce an Adapter-local typed protocol
projection as the sole successfully decoded notification consumer above the
lower Client, keep lower-client decode failures, forbidden effects, and unknown
activity fail-closed, and prove mandatory real Answer-only,
Intent-analysis, clarification, Materialization, ordinary Start,
isolated-Candidate Codex Worker, protected verification, Evidence, Acceptance,
and regression paths. The normalized event union MUST NOT become Domain,
Runtime, Store, Audit, Evidence, or Acceptance authority. The formal M2.5.1
Profile MUST use real candidate-free Codex execution over exact Runtime-owned
read-only selected-source snapshots for `DISCOVERY` and `PLAN`, real Candidate-
bound Codex execution for `IMPLEMENT`, and the existing non-Worker owners
afterward. The source checkout itself remains unreadable to candidate-free
Codex. Its additive execution chain MUST version the Intent/Record and Codex
directive/Adapter observation without widening retained identities; Profile v3
MUST have one owner for every shared or phase field, use the existing canonical
phase-set order, select `ALL_SELECTED_ATTEMPTS`, and bind an Adapter-local
phase activity policy that permits only snapshot-read commands for
`DISCOVERY`/`PLAN` and Candidate-bound command/file-change activity for
`IMPLEMENT`. Snapshot cleanup MUST use one exact grant identity for idempotent
unknown-result reconciliation and atomically persist its Outcome, audit, and
consumption before later replay suppresses filesystem work. The current M2
protected demo is not that chain: it selects external
Codex only for `IMPLEMENT` and delegates the candidate-free phases to
`FakeWorker`. Fake Worker/Candidate/Verification components MUST remain
explicit test infrastructure, MUST NOT be a production fallback, and Candidate
authority MUST still begin only at the governed `PLAN -> IMPLEMENT` transition.
A Plan/source mismatch MUST create no Candidate, MUST retain exact
`PLAN_SOURCE_NOT_CURRENT` through Workflow integrity authority, MUST project the
Goal to non-resumable `BLOCKED / INSPECT_BLOCKER`, and MUST NOT trigger
automatic replan, phase rewind, or `goal resume` continuation. Accepted ADR
0043 binds the candidate-free project-read snapshot, Context, isolation,
source-currency, configuration/instruction, cleanup, and execution-record
boundary before that composition is implemented. M2.5.1 MUST NOT
rewrite the historical M2.5 review or add Frontstage, scheduling, Host,
arbitrary-project verification, promotion, release, or deployment scope.

M2.6 — Unified Frontstage Interaction and Control — is the next proposed
feature milestone after M2.5.1 passes. Its formal domain, ADR,
implementation-plan, acceptance-plan, and temporary deferred-boundary
documents exist for review; implementation has not started, and proposed ADRs
are not binding. The bounded
candidate keeps one foreground CLI frontstage available while the process is
alive, accepts natural-language user input, routes the closed new-Intake and
Goal-control action set through exact immutable Runtime-owned Pending Action,
Authorization, Reservation, and Outcome records, and uses deterministic policy
to bind either the originating explicit low-risk command or a separate
natural-language confirmation. Exact M2.5 Question clarification keeps its
existing authority and receives no competing Pending Action. M2.6 calls only
public M2.5/Goal facades, exposes an authority-home-bound exact-project Goal
summary query, and allows at most one execution-bearing task launched by that CLI
session. Unresolved authorized action recovery may use only its retained public
Command ID; Assistant work is never recalled automatically. It MUST NOT become
a rich TUI, detached daemon, project-wide
scheduler, multiple-agent system, cloud or multi-user runtime, full Fact Graph,
or release/deployment authority.

M2.7 — Local Runtime Host and Single-Goal Project Control — is a separate
post-M2.6 proposal. It would add one Host per authority home, CLI attach/detach,
one control lease plus read-only secondary clients per principal/project, and
one shared project execution slot acquired by ordinary `StartGoal`. Other Goals
remain ordinary `READY` Goals; no queue, priority, automatic handoff, or
automatic Start is permitted. M2.7 implementation MUST NOT begin before M2.6
passes its own independent completion review, and proposed ADRs 0040 through
0042 are not binding.

The completed M2 implementation and exit evidence remain in
`docs/plans/m2-codex-vertical-slice.md`,
`docs/plans/m2-acceptance-plan.md`, and
`docs/reviews/m2-completion-review.md`. The independent M2 exit review was a
prerequisite for M2.5 implementation and passed on 2026-08-02. That review is
historical evidence for the prerequisite. The completed M2.5 implementation,
assessment, and verdict remain in
`docs/plans/m2.5-goal-intake-materialization.md`,
`docs/plans/m2.5-acceptance-plan.md`, and
`docs/reviews/m2.5-completion-review.md`. The current proposed compatibility and
composition closure follows
`docs/reviews/m2.5-live-intake-compatibility-diagnostic.md`,
`docs/plans/m2.5.1-real-intake-codex-composition-closure.md`, and
`docs/plans/m2.5.1-acceptance-plan.md`. Proposed M2.6 work follows
`docs/frontstage-interaction.md`,
`docs/plans/m2.6-unified-frontstage-interaction.md`, and
`docs/plans/m2.6-acceptance-plan.md` only after M2.5.1 passes and its ADRs are
accepted. Proposed M2.7 work is separately described by `docs/runtime-host.md`,
`docs/plans/m2.7-local-runtime-host-single-goal-control.md`, and
`docs/plans/m2.7-acceptance-plan.md`.

## Engineering Rules

- Keep the domain and workflow runtime independent of Codex protocol types.
- Model external systems through narrow ports and adapters.
- Only the Workflow Runtime mutates workflow state.
- Only the Acceptance Engine issues technical `ACCEPT` decisions.
- Store authority outside worker-writable candidate directories.
- Treat worker output and model-authored JSON as untrusted input that requires
  schema validation.
- Make illegal states difficult to represent and impossible to persist through
  public APIs.
- Persist state and its audit event in one transaction.
- Use explicit enums and typed identifiers instead of free-form status strings.
- Keep policy/checker versions in every acceptance decision.
- Use exact candidate and evidence digests; do not accept path existence as
  identity.
- Prefer small, testable components with one authority owner.
- Do not copy source code from reference projects. References inform design;
  their code and licenses remain external.

## Initial Toolchain

The accepted initial direction is Node.js 22+, strict TypeScript, ESM, pnpm
workspaces, and SQLite. See `docs/adr/0003-initial-technology-stack.md`.

Once M1 scaffolding exists:

- use repository scripts through `pnpm`;
- run focused tests while iterating;
- keep the complete M1 quality gate green as the regression baseline;
- run the complete current-milestone acceptance procedure before claiming that
  milestone is ready;
- keep TypeScript strict and avoid unsafe casts at authority boundaries;
- validate persistence migrations and restart behavior, not only in-memory
  behavior.

## Documentation Rules

- Use normative `MUST`, `MUST NOT`, `SHOULD`, and `MAY` deliberately.
- State what a component owns and what it cannot authorize.
- Separate current behavior, planned behavior, and reference inspiration.
- Do not describe an unimplemented milestone in the present tense.
- Do not create a second completion authority in a new report, UI, or adapter.
- Documentation MUST use GitHub Flavored Markdown structure and MUST NOT use raw HTML. A
  fragment targeting a Markdown file MUST resolve to that file's GitHub-style
  generated heading anchor. Local paths MUST use exact repository casing and
  MUST resolve inside the repository even when symbolic links are present.
  A checked Markdown source MUST be a regular file with a portable
  repository-relative Git path; a Markdown-named symbolic link MUST fail rather
  than be followed or silently skipped. `pnpm docs:check` is the executable
  check for these rules.
- Treat `docs/milestones.md` as the milestone boundary and
  `docs/plans/m2.5.1-real-intake-codex-composition-closure.md` as the current
  proposed implementation sequence. The completed M1, M2, and M2.5 plans and
  reviews remain historical evidence; M2.6 remains the next feature proposal
  after M2.5.1. Until the separately reviewed README status-source
  contract is migrated, the root README MUST contain exactly one level-two
  `Status` section, that section MUST contain prose paragraphs only, and its
  only links MUST point to the M2 plan and milestone records enforced by
  `pnpm docs:check`. The README MUST NOT contain a numbered rolling-slice status
  anywhere.
- The root README MUST NOT duplicate a rolling feature or test inventory.
  Because semantic equivalence is not mechanically decidable from prose, the
  slice-close documentation review owns this check; `pnpm docs:check` enforces
  only the structural status contract above.
- When a slice is marked implemented, the same change MUST review the root
  README, the `ARCHITECTURE.md` status section, relevant domain-document status
  sections, the ADR index, and the milestone boundary for consistency.
- Update links, historical M0/M1 review records, and the current milestone
  acceptance matrix when canonical documents move.

## Completion Claims

Until CodeClosure can govern its own development, repository completion claims
must still be evidence-based:

- identify the requested scope;
- inspect the actual diff;
- run the relevant checks;
- report skipped or unavailable checks;
- distinguish document completion, milestone completion, and product
  completion.

Creating documents or a skeleton does not complete the CodeClosure product.

## Compatibility

This is a standalone product repository. Do not preserve IntentOS command,
schema, directory, manifest, or generated-project compatibility unless a new
user decision explicitly introduces such a requirement.
