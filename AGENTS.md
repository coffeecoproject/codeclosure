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

## Change Scope and Engineering Quality

- Optimize for the smallest coherent solution, not the smallest possible diff.
  A coherent solution resolves the root cause, preserves the relevant
  architectural boundaries, updates directly affected contracts and consumers,
  and includes evidence that the requested outcome works.
- “Minimal and focused” means avoiding unrelated work. It MUST NOT be used to
  justify a partial fix, a surface-level workaround, duplicated policy,
  bypassed abstractions, inconsistent state ownership, or known follow-up work
  required to make the solution correct.
- Before changing non-trivial behavior, identify the owning layer, root cause,
  affected invariants or contracts, direct consumers, and the evidence needed
  to prove completion.
- If the current architecture is insufficient for a durable solution, make the
  smallest structural improvement required by the requested outcome. Do not
  preserve a deficient structure merely to reduce the number of changed files.
- Prefer existing abstractions when they correctly represent the
  responsibility. Introduce or refactor an abstraction only when the current
  change would otherwise create duplicated logic, conflicting sources of
  truth, leaky boundaries, or a known maintenance burden.
- Do not add speculative abstractions, generalized frameworks, unrelated
  cleanup, or flexibility for hypothetical future requirements. Improvements
  that are useful but not required for the current outcome should be reported
  separately.
- Match validation scope to change scope. A narrow test can prove a narrow
  behavior, but it cannot by itself prove a cross-layer or system-wide change.
- Before finishing, verify that the root cause is addressed, directly affected
  paths remain consistent, relevant tests or checks pass, and no temporary
  workaround or unresolved structural debt has been introduced.
- If the correct solution requires a materially broader product or architecture
  decision beyond the user's requested outcome, explain the boundary and ask
  for direction. Necessary structural work already implied by the requested
  outcome does not require separate permission.

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

M2.5.1 — Real Intake-to-Codex Composition Closure — is complete as the bounded
pre-M2.6 prerequisite. Slice 0 froze its contract, exact proof-owner map, bounded
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
contracts, and Runtime-owned exact retained-value matching. Slice 3 passed its
bounded review on 2026-08-11. It implements the project-read/Cleanup authority,
nested
external-execution Profile v3, additive Intent/Record v2 authority with strict
SQLite authorization/persistence/reopen, and the Adapter-boundary
`CodexWorkerDirectiveV3`, `CodexAdapterObservationV2`, and versioned phase
activity-policy foundation. Candidate-free and Candidate source members bind
strictly, the new policy rejects unclassified or out-of-bound activity and
discards its result, and the historical directive v2/observation v1 path keeps
its existing meaning. The Adapter foundation also derives one exact supported
isolation digest from the phase contract, binds the exact `0.146.1` disabled-
integration and effective-feature projections, treats Profile roots as stable
envelopes, strictly decodes and digest-validates the complete retained
ProjectRead authority record, cross-binds exact ProjectRead/Candidate roots,
and uses the phase/source forbidden-root union. Fixture execution proves both
candidate-free `readOnly` proposal handling and Candidate-bound
`workspaceWrite` completion handling, including result discard for forbidden
file changes. ADR 0044's additive Candidate freeze-v2 path is now implemented
through the local Candidate Manager derivation, C11 Profile freeze-v2 sub-
contract and freeze-only Check family, Runtime-owned current-Goal path
disposition, Store/SQLite backstops with Store-owned canonical recomputation
and SQLite structural/relational guards, atomic Evidence admission, closed
failure handling, and strict reopen. Historical freeze-v1 keeps its M1/M2
meaning; the reserved M2.5.1 Profile ID with any other schema, version,
Candidate Source, Verification Runner, or external-execution schema fails
install/read/reopen rather than selecting that historical path. The formal
candidate preparation creates no Fake Verification obligation. The Adapter-
local policy may admit the pinned best-effort `unknown` command action only for
`IMPLEMENT`; that observation is not containment proof, and the later freeze-
v2 result must succeed before Evidence can exist. At the Slice 3 boundary, this
foundation had offline coverage but no `M251-C11` acceptance verdict. Fixture
isolation selection was not effective live containment proof. B3
implements deterministic Driver Profile v3 dispatch for all selected Worker
phases, Runtime-owned candidate-free pre/post-Turn source and snapshot currency,
Intent/Record v2 authorization, and exact integrity-failure closure without a
FakeWorker fallback. The Candidate-creation source-currency guard binds exact
PLAN ProjectRead authority through preparation v2 and the Store commit;
mismatch atomically retains `PLAN_SOURCE_NOT_CURRENT` without creating a
Candidate. B4 composes the trusted production graph and deterministic
Intake-to-closeout chain through an explicit protocol fixture, ordinary Start,
protected verification, Evidence, Acceptance, closeout, restart/replay, and
terminal ProjectRead cleanup without a production Fake fallback. B5 restores
every implemented Slice 3 deterministic proof to its frozen owner and closes
the Slice 3 documentation/review boundary. This bounded Slice 3 result is not
real Codex dispatch or effective live containment evidence. Slice 4 began with
B1's prepared, content-free Intake execution-root descriptor
and trusted pre-publication separation/cleanup boundary, B2's focused,
non-authoritative metadata-only composition Receipt and strict identity/privacy
contract, B3's explicitly authorized real linked-path command plus composition-
local metadata observation/inspection boundary, and B4's separately authorized
metadata-only effective-containment probe. The B4 probe binds exact formal
Profile inputs, separately validates the distinct `DISCOVERY` and `PLAN`
phase-entry isolation, binds exact command observation, content-free denied-
boundary opens, independent filesystem identities, and cleanup; it is
assessment evidence only and cannot replace B3's formal chain or Candidate
Manager-owned freeze-v2 authority. B3 and B4 were then implemented and
deterministically tested. An explicitly authorized initial B5 diagnostic later
ran, but the corrected direct pinned App Server `command/exec` probe failed
closed because candidate-free `readOnly` could read a content-free Authority
Home sentinel. The earlier Intake and linked-composition diagnostics are not
final evidence after source changes. A subsequent bounded, no-model capability
investigation proved that retained Codex `0.146.1` enforces the required
read/write matrix when exact configured ProjectRead and Candidate permission
profiles are inherited instead of being replaced by generic request-level
sandboxes. The additive contained Profile v2, separate ProjectRead/Candidate
permission profiles, narrow controlled-launch selector, profile-bound lower-
Client command, and inherited Adapter Thread/Turn mapping are now implemented
and deterministically tested while retained Profile/Adapter v1 keeps its
historical meaning. On exact source `7621c8b4e8731232a9d68aa6a744296da1571cd4`,
that corrected production identity passed the explicitly authorized complete
Live containment matrix for `DISCOVERY`, `PLAN`, and `IMPLEMENT`, with source,
credential, protected-asset, process, temporary-root, and privacy closure. The
failed ADR 0043 production-containment requirement is therefore closed and B5
may restart from the beginning; the Receipt remains assessment evidence and
supplies no execution, Candidate, Evidence, Acceptance, or closeout authority.
After a focused Live composition assessment-consumer identity correction, an
initial B5 real Intake, causally linked composition, and effective-containment
diagnostic triad passed on exact clean source `1b43dfc`. Two later prepared-
source linked paths on `aa2f29e` correctly failed closed at protected
verification. Executable Slice 0 contract v7 then compatibly added the exact
public `duplicate_ignored` result already required by the unchanged protected
Check; v6 keeps its historical review meaning. The complete restarted v7
diagnostic triad passed on exact clean source `a3a5e9b`. The final prepared-
source quality gate and ordered unchanged-source Live triad then passed on exact
source `01fd537`, and the bounded Slice 4 review issued `PASS`. Slice 5 then
implemented the non-verdict 13-stage/68-row canonical assessment and its
fail-closed evidence contract. The explicitly authorized canonical run on exact
clean source `dfe4798` passed all 13 stages and 68 mandatory rows with zero
skip, waiver, expected failure, source drift, or unexplained warning. The
independent M2.5.1 completion review issued an unconditional bounded `PASS` on
2026-08-13. M2.5.1 is complete; M2.6 is the next feature milestone. ADR 0036
through ADR 0039 are accepted and its executable Slice 0 decision/proof
contract passed bounded review on 2026-08-14. Slice 1's Interaction Domain,
strict codecs, lifecycle and relationship invariants, canonical digest
projections, and deterministic Runtime policy passed bounded review on
2026-08-14. Slice 2 implementation is in progress: its bounded SQLite work now
includes the append-only Interaction schema, exact policy installation, atomic
Session create/lifecycle and user-message admission, typed replay/conflict,
ordered audit membership, and strict reopen for that implemented subset. It
does not complete Slice 2 or claim its frozen acceptance rows.
A real pinned-version
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
A best-effort Codex `unknown` command action is not permanent proof of an
allowed or forbidden IMPLEMENT effect and MUST NOT be admitted merely because
its cwd is the Candidate. Under the now-installed ADR 0044 foundation it MAY be
admitted only by the exact `IMPLEMENT` activity policy and remains contingent
on additive schema-version-2 stable source-freeze changed-path proof, owned by
Candidate Manager and independently checked by Runtime/Store against exact
Goal allowed paths. Historical freeze schema version 1 keeps its M1/M2 meaning.
A Plan/source mismatch MUST create no Candidate, MUST retain exact
`PLAN_SOURCE_NOT_CURRENT` through Workflow integrity authority, MUST project the
Goal to non-resumable `BLOCKED / INSPECT_BLOCKER`, and MUST NOT trigger
automatic replan, phase rewind, or `goal resume` continuation. Accepted ADR
0043 binds the candidate-free project-read snapshot, Context, isolation,
source-currency, configuration/instruction, cleanup, and execution-record
boundary for the implemented deterministic Slice 3 composition; it does not by
itself establish real Codex or effective live-containment proof. M2.5.1 MUST NOT
rewrite the historical M2.5 review or add Frontstage, scheduling, Host,
arbitrary-project verification, promotion, release, or deployment scope.

M2.6 — Unified Frontstage Interaction and Control — is the next feature
milestone. Its M2.5.1 prerequisite has passed. ADR 0036 through ADR 0039 are
accepted, its formal domain/implementation/acceptance documents and executable
Slice 0 decision/proof contract exist, and the bounded Slice 0 review passed on
2026-08-14. Slice 1's bounded Interaction Domain and deterministic-policy
review passed on 2026-08-14. Slice 2 implementation is in progress through its
policy, Session lifecycle, and user-message SQLite authority; later Slice 2
transactions and Slice 3 onward have not started.
The bounded
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
`docs/reviews/m2.5-completion-review.md`. The completed compatibility and
composition closure follows
`docs/reviews/m2.5-live-intake-compatibility-diagnostic.md`,
`docs/plans/m2.5.1-real-intake-codex-composition-closure.md`, and
`docs/plans/m2.5.1-acceptance-plan.md`. Planned M2.6 work follows
`docs/frontstage-interaction.md`,
`docs/plans/m2.6-unified-frontstage-interaction.md`, and
`docs/plans/m2.6-acceptance-plan.md`; accepted ADR 0036 through ADR 0039 bind
its implementation. Proposed M2.7 work is separately described by `docs/runtime-host.md`,
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
  `docs/plans/m2.6-unified-frontstage-interaction.md` as the current planned
  implementation sequence. The completed M1, M2, M2.5, and M2.5.1 plans and
  reviews remain historical evidence; M2.6 is the current formalization. The
  root README MUST contain exactly one level-two
  `Status` section, that section MUST contain prose paragraphs only, and its
  only links MUST point to the M2.6 plan and milestone records enforced by
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
