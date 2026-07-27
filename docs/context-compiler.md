# CodeClosure Context Compiler

## Status

This document defines the target Context Compiler contract. The current M1
Slice 4 implementation provides the deterministic subset described under
[M1 Boundary](#m1-boundary): canonical Context Packages and Manifests,
source-authority cross-validation, exact digest binding, atomic Attempt binding,
and `FakeWorker` dispatch. Retrieval, relevance packing, a full Fact Graph, and
Codex Thread policy remain planned for later milestones.

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
  responseContract
```

The worker-visible rendering may be Markdown, structured JSON, or a combination.
The canonical identity is the `ContextManifest`, not presentation formatting.

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

For the current M1 path, the Runtime first applies the proposed Attempt start in
memory and compiles against that resulting Workflow version. Runtime
configuration selects the active Policy ID; the Runtime loads that installed
bundle and supplies its exact ID and digest to the compiler, so the compiler
cannot choose or downgrade Policy authority. Before persistence the Runtime
independently cross-checks the exact Goal content, phase objective, capability
grant, response contract, Candidate and Policy bindings, authority labels, and
the complete Manifest entry projection. The Store then commits the Attempt,
Workflow, audit events, processed Start command, and Manifest in one
transaction. A digest-valid package that disagrees with source authority is
invalid; a digest proves identity, not correctness or authorization.

After commit, an immutable dispatch claim revalidates the active Workflow
version and all request digests before `WorkerPort` is invoked. Cancellation
and dispatch serialize on that version. Worker events are deduplicated by an
independent `WorkerEventId`; a current event is admitted transactionally, while
a stale or mismatched event can create only an ignored delivery receipt. See
[ADR 0014](adr/0014-context-bound-worker-dispatch-and-event-admission.md).

## Compilation Pipeline

### 1. Bind identity

Load the exact Goal, Workflow, phase, policy bundle, and current Candidate
revision in one consistent read snapshot. Abort on missing or mismatched
identity.

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

## M1 Boundary

The current M1 implementation includes a minimal deterministic compiler
sufficient for `FakeWorker`:

- Goal identity and criteria;
- Workflow, phase, Attempt, and capability-grant identity;
- explicit fact/decision references;
- current Candidate reference when applicable;
- response contract;
- Context Manifest, package digest, and manifest digest;
- invalidation on Goal or phase revision.

Explicit selected entries are supplied by a trusted M1 composition boundary
and remain labelled by source reference, revision, optional source digest, and
authority class. Durable relationship lookup and relevance selection over the
Fact/Decision stores remain M3 work; worker-authored content cannot enter as a
confirmed source merely by changing its prose.

Code relevance retrieval, full Fact Graph traversal, token-aware packing, and
Codex Thread policy belong to later milestones.

## Required Tests

- identical versioned inputs produce the same manifest digest;
- changed Goal/phase/policy identity changes or invalidates the manifest;
- `PROPOSED` facts cannot appear as confirmed facts;
- lower-authority working context cannot override a Goal field;
- required oversized content fails explicitly;
- stale worker results referencing an old manifest cannot advance state;
- no authority field depends solely on a transcript excerpt.
