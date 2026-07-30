# CodeClosure Context Compiler

## Status

This document defines the target Context Compiler contract. The audited M1
implementation provides the deterministic subset described under
[M1 Boundary](#m1-boundary): canonical Context Packages and Manifests, a
fail-closed source subset, exact digest binding, atomic Attempt binding,
`FakeWorker` dispatch, and Candidate-authority binding for `IMPLEMENT`.
Retrieval, relevance packing, a full Fact Graph, and Codex Thread policy remain
planned for later milestones. This is the Goal-bound Worker Context Compiler;
the accepted pre-Goal Intake target uses a separate Intake Package and Manifest
that are not implemented.

## Purpose

The Context Compiler constructs the smallest authoritative, phase-relevant
input a worker needs for one attempt. It replaces the assumption that the model
should reconstruct project state from an ever-growing chat transcript.

```text
authoritative state + current project evidence + phase policy
  -> selection
  -> validation
  -> rendering
  -> Context Package + Context Manifest
  -> worker turn
```

The package is disposable. The manifest is durable.

## What the Compiler Is Not

The compiler is not:

- a generic conversation summarizer;
- a model-memory database;
- a source of new facts;
- an acceptance engine;
- a way to convert inference into authority;
- a guarantee that the worker will follow the context.

Runtime capabilities and acceptance still enforce the boundary even if the
worker misunderstands an accurate context package.

## Input Classes

### Authoritative control inputs

- Goal ID and revision;
- success criteria, scope, and non-goals;
- Workflow phase, version, and current Attempt;
- phase capability grant;
- current Candidate generation and state;
- confirmed facts and decisions selected for the phase;
- current blockers and unresolved issues;
- required scenarios and verification obligations;
- relevant policy identifiers and non-negotiable invariants;
- prior acceptance failure details when entering a repair generation.

### Authoritative or observed project inputs

- project/base identity;
- relevant source files or bounded excerpts;
- repository rules and accepted project configuration;
- actual change manifest;
- current test/build declarations;
- current runtime observations when applicable.

### Non-authoritative working inputs

- bounded transcript excerpts;
- worker-authored summaries;
- proposed facts;
- hypotheses and search hints;
- prior worker reasoning.

Non-authoritative inputs must be labelled and cannot override authoritative
inputs.

## Context Package Shape

A logical package contains:

```text
ContextPackage
  identity
    goalId
    goalRevision
    workflowId
    workflowVersion
    phase
    attemptId
    candidateGenerationId?
  phaseObjective
  capabilityGrant
  goal
    objective
    successCriteria
    scope
    nonGoals
  selectedFacts[]
  selectedDecisions[]
  businessScenarios[]
  relevantProjectRules[]
  relevantCode[]
  verificationObligations[]
  blockers[]
  priorAttemptFeedback?
  executionProfileId
  executionProfileDigest
  policyBundleId
  policyBundleDigest
  responseContract
```

The worker-visible rendering may be Markdown, structured JSON, or a combination.
The canonical identity is the `ContextManifest`, not presentation formatting.

The M1 `responseContract` is compiler-owned and binds the allowed result kinds,
closed Worker Event schema behavior, and `maxEventBytes`. Admission measures
the strictly decoded event's canonical UTF-8 JSON bytes against that limit; a
Worker cannot enlarge its own output budget.

## Context Manifest

```text
ContextManifest
  id
  schemaVersion
  compilerVersion
  createdAt
  goalId
  goalRevision
  workflowId
  workflowVersion
  phase
  attemptId
  candidateGenerationId?
  candidateDigest?
  executionProfileId
  executionProfileDigest
  policyBundleId
  policyBundleDigest
  capabilityGrantDigest
  responseContractDigest
  entries[]
  omissionDecisions[]
  packageDigest
  manifestDigest
```

Each entry records:

```text
ContextManifestEntry
  kind
  sourceRef
  sourceRevision
  sourceDigest?
  authorityClass
  renderedDigest
```

`omissionDecisions` record intentionally excluded but potentially relevant
sources, the selection rule, and why exclusion is safe. This makes "minimal
context" auditable rather than arbitrary.

`packageDigest` binds the exact canonical dispatch payload received by the
worker. `manifestDigest` binds the schema-versioned semantic manifest, including
entries, omission decisions, and `packageDigest`; it excludes only
record-envelope fields defined by
[ADR 0006](adr/0006-canonical-serialization-and-digest-profiles.md).
Worker results bind both the manifest identity and digest.

The Runtime first applies the proposed Attempt start in memory, compiles against
that resulting Workflow version, creates or resolves the Workflow's immutable
installed Policy binding, and resolves the separate immutable installed
Execution Profile binding. The Runtime
supplies both exact IDs and digests to the compiler, so the compiler cannot
choose or downgrade execution or Policy authority. Before persistence the Runtime
independently cross-checks the exact Goal content, phase objective, capability
grant, response contract, Candidate, Execution Profile, and Policy bindings,
authority labels, and the complete Manifest entry projection. The Store then
commits the Attempt, Workflow, first-start Policy and profile bindings when
applicable, audit events, processed command, and Manifest in one transaction. A
digest-valid package that disagrees with source authority is invalid; a digest
proves identity, not correctness or authorization.

That binding remains mandatory after execution. Every retained Worker-phase
Attempt MUST still carry its Context Manifest identity and Worker Session. Its
Manifest response-contract digest is recomputed from the phase-owned M1
contract, and a terminal result reason MUST name a kind that contract permits:
`PROPOSALS` for `DISCOVERY`/`PLAN`, or `COMPLETION_REQUEST` for `IMPLEMENT`.
Driver decoding, Runtime replay, and Store reads share this validation; a
missing binding or phase-incompatible result fails closed before it can advance
the Workflow.

After commit, an immutable dispatch claim revalidates the active Workflow
version, bound Execution Profile, and all request digests before `WorkerPort`
is invoked. Cancellation and dispatch serialize on that version. Worker events
are deduplicated by an independent `WorkerEventId`; a current event is admitted
transactionally, while a stale or mismatched event can create only an ignored
delivery receipt. Same ID plus the same canonical payload remains a duplicate,
but only a duplicate bound to the exact current dispatch can satisfy terminal
stream accounting. See
[ADR 0014](adr/0014-context-bound-worker-dispatch-and-event-admission.md) and
[ADR 0021](adr/0021-m1-execution-profile-and-cli-composition.md) plus
[ADR 0022](adr/0022-immutable-workflow-policy-binding.md) and
[ADR 0025](adr/0025-separate-worker-event-idempotency-from-current-dispatch-termination.md).

M1 has no durable resolver that can prove the status, scope, revision, and
provenance of a selected Fact, Human Decision, or project source. The Runtime
therefore rejects all externally selected entries and omission decisions, even
when a factory returns a self-consistent package and Manifest. This deliberate
restriction is specified by
[ADR 0015](adr/0015-close-m1-worker-authority-causality.md).

## Compilation Pipeline

### 1. Bind identity

Load the exact Goal, Workflow, phase, bound execution profile, policy bundle,
and current Candidate revision in one consistent read snapshot. Abort on
missing or mismatched identity.

### 2. Derive phase query

The phase policy specifies required and optional context classes. Examples:

- `DISCOVERY` emphasizes project topology, known facts, and search boundaries;
- `PLAN` emphasizes criteria, scenarios, impact surfaces, and constraints;
- `IMPLEMENT` emphasizes accepted plan, exact boundary, candidate path, and
  verification obligations;
- `EVIDENCE_BUILD` emphasizes frozen digest and exact check specifications;
- `FINAL_VERIFY` does not need a coding-worker prompt at all.

### 3. Resolve relationships

Select facts, scenarios, code surfaces, and obligations reachable through
task-relevant relationships. Full Fact Graph traversal is planned for M3; M1
may use explicit references while preserving the same manifest contract.

### 4. Validate authority and freshness

Reject or label:

- invalidated facts;
- stale Goal or policy revisions;
- evidence for another Candidate;
- conflicting confirmed facts;
- unsupported model inference;
- project excerpts whose source digest changed during compilation.

### 5. Apply budgets

Every input class has a hard byte/token budget and deterministic truncation or
selection rule. The compiler must not rely on "the model will probably handle
it" for unbounded context.

Priority is semantic, not chronological:

1. identity and invariants;
2. phase objective and capabilities;
3. Goal criteria and scope;
4. blockers and decisions;
5. relevant facts/scenarios/obligations;
6. relevant project material;
7. optional working context.

Required content that cannot fit is a compilation error or a signal to split
the task; it is not silently omitted.

### 6. Render and hash

Render with stable ordering and the canonical serialization profile required by
[ADR 0006](adr/0006-canonical-serialization-and-digest-profiles.md). Record entry
digests, the exact dispatch `packageDigest`, and the semantic `manifestDigest`.

### 7. Dispatch with response contract

The worker receives a typed response contract appropriate to the phase. Parsing
failure returns an adapter/worker error, not a workflow transition.

## Fresh Context Strategy

CodeClosure may use a new Codex Thread for a phase, repair generation, or
independent verification when clean context improves reliability. It can also
resume a Thread when continuity is useful.

The choice is a runtime policy because all critical state is recompiled. A
fresh Thread does not mean lost state, and a resumed Thread does not make its
history authoritative.

### M2 App Server input closure — planned

An App Server may add effective instructions or tools from Codex configuration,
project guidance, user state, or managed requirements. Those inputs are not
implicitly part of the current Goal-bound Context Package and cannot bypass its
Manifest merely because Codex loaded them.

Before an M2 Turn starts, every effective instruction source and tool surface
must be disabled or bound by exact identity and digest through the selected
Execution Profile and Context policy. The Runtime must compare App
Server-reported instruction sources and effective non-secret settings with that
binding. An unknown source, an unbound tool, a widened permission, or a changed
configuration digest blocks dispatch. Managed host policy may constrain the
grant before the Execution Profile is bound or make that profile unavailable.
After binding, a changed or mismatched managed-requirements identity blocks
dispatch; it cannot silently narrow, widen, or replace Worker authority.

## Codex Compact Interaction

Codex currently supports manual and automatic compaction by replacing model
history with a compacted history containing selected retained content,
summaries, and re-injected initial context. CodeClosure treats this as worker
session maintenance.

Rules:

- compact events are logged as worker-session observations;
- compaction does not change Goal, Workflow, Candidate, Fact, or Acceptance
  state;
- after compaction, the next phase-critical turn receives a newly compiled
  package when policy requires it;
- a compacted summary may be included only as non-authoritative working context;
- losing the Codex Thread must not prevent safe resumption.

## Context Invalidation

A Context Manifest is no longer current when any required bound input changes,
including:

- Goal revision;
- Workflow phase/version;
- policy bundle;
- Candidate generation or digest;
- selected confirmed Fact revision;
- scoped Human Decision;
- relevant project source digest;
- blocker or verification-obligation set.

An in-flight worker may finish, but its result is evaluated against the current
Attempt and manifest. Stale results cannot advance the workflow.

## Intake Context Boundary — planned M2.5

The existing Context contract requires a formal `GoalId`, `GoalRevision`,
`WorkflowId`, Workflow phase/version, `AttemptId`, Policy binding, Execution
Profile binding, response contract, and capability grant. Pre-Goal Intake has
none of those authorities and MUST NOT fabricate them to call the Worker
Context Compiler.

The planned Intake path instead uses:

```text
Raw Request + current Goal Draft + clarification state
  + optional bounded project observations
  + Intake policy and assistant response contract
  -> Intake Package + Intake Manifest
  -> Goal Draft Proposal
```

An Intake Manifest binds only IntakeRun, Raw Request, Draft revision/digest,
question, project/scope, policy, adapter, provenance, omission, and budget
identity. It cannot be used as a Goal-bound Context Manifest, Worker dispatch
claim, Evidence input, or Acceptance input.

Canonical projection, rendering, digest, byte-budget, redaction, and protocol
utilities MAY be shared below both compilers. Their domain records, codecs,
freshness rules, and authority labels remain separate. See
[ADR 0026](adr/0026-pre-goal-intake-and-goal-materialization-authority.md) and
[Goal Intake](goal-intake.md).

## M1 Boundary

The current M1 implementation includes a minimal deterministic compiler
sufficient for `FakeWorker`:

- Goal identity and criteria;
- Workflow, phase, Attempt, and capability-grant identity;
- response contract;
- a 65,536-byte maximum canonical Worker Event;
- Context Manifest, package digest, and manifest digest;
- exact active `MUTABLE` Candidate generation and `baseDigest` for `IMPLEMENT`;
- invalidation on Goal or phase revision.

The M1 package still has an empty `selectedEntries` collection and its Manifest
has no omission decisions. Its ordinary entries are limited to compiler-owned
Goal and success-criterion bindings. For `IMPLEMENT` only, the Runtime now
resolves the Workflow's active Candidate through the Candidate Store, requires
the exact generation to be `MUTABLE`, and gives the compiler its immutable
`baseDigest`; the Runtime and Store independently rederive that dedicated
Candidate Manifest entry. `DISCOVERY` and `PLAN` remain Candidate-free. The
Context factory is not a source authority. Durable relationship lookup and
relevance selection over the Fact/Decision stores remain M3 work; a later
accepted ADR must introduce the owning resolver before those entries can enter
Worker Context. See
[ADR 0016](adr/0016-candidate-and-evidence-authority-boundary.md) and
[ADR 0017](adr/0017-derive-boundary-authority-and-replay-evidence-by-audit-sequence.md).

Code relevance retrieval, full Fact Graph traversal, token-aware packing, and
Codex Thread policy belong to later milestones.

## Required Tests

- identical versioned inputs produce the same manifest digest;
- changed Goal/phase/policy identity changes or invalidates the manifest;
- `PROPOSED` facts cannot appear as confirmed facts;
- lower-authority working context cannot override a Goal field;
- required oversized content fails explicitly;
- stale worker results referencing an old manifest cannot advance state;
- Candidate Context names only the exact active `MUTABLE` generation and
  `baseDigest`, and is absent from non-`IMPLEMENT` M1 packages;
- a factory-labelled Fact or Human Decision without durable source authority
  cannot enter the M1 package;
- no authority field depends solely on a transcript excerpt.
