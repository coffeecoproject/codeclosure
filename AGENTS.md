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

M2.5 — Goal Intake and Materialization — is the current milestone boundary.
Slices 1 through 6 implement the bounded Domain, SQLite, Intake package and
Adapter, Projection and Admission, Answer/failure/recovery, Materialization,
and separate ordinary Start foundations. Slice 7 is the next implementation
boundary; the Intake CLI, canonical M2.5 acceptance harness, and independent
milestone verdict have not begun. Goal Intake MUST remain separate from the
Goal-bound WorkerPort and MUST NOT reinterpret the completed M2 execution path
as intent, Goal, Start, or Admission authority. Do not expand M2.5 into a rich
TUI, multiple agents, cloud or multi-user execution, full Fact Graph traversal,
or release and deployment authority.

The completed M2 implementation and exit evidence remain in
`docs/plans/m2-codex-vertical-slice.md`,
`docs/plans/m2-acceptance-plan.md`, and
`docs/reviews/m2-completion-review.md`. The independent M2 exit review was a
prerequisite for M2.5 implementation and passed on 2026-08-02. That review is
historical evidence for the prerequisite, not the current implementation-status
record. Current implementation follows
`docs/plans/m2.5-goal-intake-materialization.md`, and its exit claim follows
`docs/plans/m2.5-acceptance-plan.md`.

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
- Treat `docs/plans/m2-codex-vertical-slice.md` as the current detailed
  per-slice implementation-status record and `docs/milestones.md` as the
  milestone boundary. The completed M1 plan and review remain historical
  evidence. The root README MUST contain exactly one level-two `Status` section,
  that section MUST contain prose paragraphs only, and its only links MUST point
  to the current M2 plan and milestone records. The README MUST NOT contain a
  numbered rolling-slice status anywhere.
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
