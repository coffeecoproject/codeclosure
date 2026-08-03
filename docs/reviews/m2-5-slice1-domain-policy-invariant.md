# M2.5 Slice 1 Domain, Policy, and Invariant Review

- Review date: 2026-08-03
- Scope: M2.5 Slice 1 only
- Status: Complete
- Verdict: `PASS`; Slice 2 may add SQLite Intake authority against these closed
  contracts

## Review question

This review asks whether Slice 1 encodes the already accepted Intake authority
shapes and fixed Admission Policy without leaking assistant output into Goal,
Workflow, Start, Evidence, Acceptance, or Admission authority. It also checks
that the implementation stops at the planned Domain and Runtime-contract
boundary.

It does not claim that Goal Intake works. There is no Intake migration, Store
port, transaction, Coordinator, package compiler, assistant adapter, CLI
command, Goal Materialization handler, automatic Start path, or M2.5 milestone
verdict in this slice.

## Source identity

The final reviewed working-tree source identity excludes only this review file
to avoid self-reference:

```text
Base Git revision: 682cd5527d1f87f8eb26a455d1e48b33fd2190ba
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 946
Source manifest digest: sha256:56e51700e5333d8538165d50fa5e1089f6a6a510d7f08a13a4fd4b3201832230
Self-referential review exclusion: docs/reviews/m2-5-slice1-domain-policy-invariant.md
```

The implementation branch is `m2.5-goal-intake`. This correction tree begins at
the committed Slice 1 revision `682cd5527d1f87f8eb26a455d1e48b33fd2190ba`;
the original pre-slice revision remains recorded in Git history. The available
shell reports Node `v23.11.0`, outside the repository's supported Node 22 range,
and pnpm `11.1.3`. All recorded checks passed in that environment with the
engine warning visible; the Node-version limitation is not hidden as
supported-environment evidence.

## Implemented authority surface

Slice 1 adds:

- typed Intake identities and positive revisions/versions;
- closed, immutable Domain records and strict owning codecs for Raw Request,
  Intake Run, Proposal, Projection, Source Binding, Material Ambiguity,
  clarification, Admission, Answer-only, Failure, Manifest, command closure,
  Materialization, and Start Authorization;
- named ADR 0006 projections and fixed golden vectors for every planned Intake
  digest, including both abandonment bindings and the command
  input/reservation/result/outcome family;
- the acyclic `QuestionSpec -> Decision -> Question -> RawRequest revision ->
  AnswerBinding` identity chain with substitution tests;
- distinct applied-bound and rejected-base-only abandonment reservation shapes;
- exact local, denial-test, and unsupported-test Admission Policy definitions;
- one closed `PRE_ANALYSIS | PROJECTED` Admission input union plus an
  all-or-nothing governed-execution Workflow Policy/Execution Profile preflight
  value in the capability-free Admission Engine contract; and
- Runtime Invariant I-032 plus executable adversarial coverage proving Proposal
  and Answer-only payloads cannot carry formal authority fields.

The built-in Policy digests are:

| Policy | Canonical digest |
| --- | --- |
| `admission-policy_codeclosure-m2-5-local` / `codeclosure-m2-5-local-admission-v1` | `sha256:c14351b89ff1e58db2520a97cd97a42f4b7338f3d2aa3b4e0a77694e522bc020` |
| `admission-policy_codeclosure-m2-5-test-deny` / `codeclosure-m2-5-test-deny-v1` | `sha256:0ec0fe2bd8d6a745721c066ab41e3793bee504af7f12c5f094fe8c063a4697df` |
| `admission-policy_codeclosure-m2-5-test-unsupported` / `codeclosure-m2-5-test-unsupported-v1` | `sha256:838b0492163a00f64cb7a9a61930548c4edcbdc61a202c3b3d73de9534506580` |

The local registry retains the six fixed rules in the accepted order and has
exactly empty `POLICY_DENIED` and `UNSUPPORTED` collections. Each test Policy
inserts only its one fixed pre-analysis rule immediately after the Answer-only
rule. No request-text classifier or model label was added.

## Follow-up correction review

A post-commit adversarial review identified five Slice 1 contract gaps. This
working tree closes exactly those gaps:

- a known Policy ID/version now validates only the exact reviewed rule,
  material-field, priority, and derivation semantics;
- a `CLARIFY` command canonically binds the exact Question, Question Spec, and
  issuing Decision identities and digests plus the Answer Schema;
- each Outcome binds the exact Reservation digest, and version-sensitive
  clarification and abandonment Reservations require the observed Intake
  version;
- applied results use closed unions that prevent contradictory Answer-return
  and Start-authorization combinations; and
- Decision codecs use closed action/reason/disposition combinations instead of
  independently valid but semantically contradictory fields.

The correction does not add persistence, coordination, assistant, CLI,
materialization, Start execution, or any other Slice 2-or-later behavior. It
implements the already accepted ADR 0034 reservation-binding requirement and
does not introduce a new durable architectural decision.

## Boundary review

The Domain and Runtime dependency directions remain unchanged. Codex protocol
types do not enter the new records or contracts. The Admission Engine interface
receives no Store, assistant, Worker, Candidate, Evidence, Acceptance, Goal,
Workflow-write, clock, ID-generator, or external-effect capability. Its
implementation is intentionally deferred.

The root README was reviewed and left unchanged: its prose correctly says the
M2.5 product loop remains unimplemented, and its structural contract forbids a
rolling Slice inventory. The `ARCHITECTURE.md` and relevant Domain, Workflow,
Context, Evidence, Acceptance, milestone, and plan status sections now
distinguish implemented Slice 1 contracts from unimplemented behavior. The ADR
index was reviewed; this slice encodes ADR 0006, ADR 0027, and ADR 0034 without
changing a durable architectural decision, so no new ADR is required.

## Verification

The final Slice 1 tree passed:

- `corepack pnpm gate:quality`, including format, documentation, package
  boundary, typecheck, lint, digest, unit, authority, CLI integration, M1 demo,
  and invariant stages;
- focused Intake Domain tests: `8/8`, with zero failures, cancellations, skips,
  or todos;
- Node test suites reported by the complete gate: `99/99`, `301/301`, and
  `62/62`, each with zero failures, cancellations, skips, or todos;
- M1 adversarial demonstrations: `8/8`;
- Runtime invariant coverage: `32/32` across 44 test sources and 453 executable
  metadata-bearing tests;
- documentation validation: 75 assertions across 72 Markdown sources;
- historical M2 scope-guard tests: `8/8`, covering the absent, complete,
  partial, and operational Intake surfaces; and
- `git diff --check` with no errors.

The shell emitted the already recorded Node 23 engine warning throughout these
checks. No supported-Node-22 claim is inferred from this evidence.

## Remaining boundary

Slice 2 may implement only SQLite Intake authority, migrations, compound
transaction backstops, corruption/reopen validation, and policy installation
against these contracts. It may not issue Admission, implement the Coordinator,
call Codex, publish CLI behavior, materialize a Goal, authorize Start, or claim
the independent M2.5 verdict.
