# CodeClosure Context Compiler

## Status

This document defines the target Context Compiler contract. The audited M1
implementation provides the deterministic subset described under
[M1 Boundary](#m1-boundary): canonical Context Packages and Manifests, a
fail-closed source subset, exact digest binding, atomic Attempt binding,
`FakeWorker` dispatch, and Candidate-authority binding for `IMPLEMENT`.
Retrieval, relevance packing, and a full Fact Graph remain planned for later
milestones. ADR 0028 now fixes the planned M2 Thread/configuration boundary, but
no trusted live Goal-bound Codex Context dispatch is implemented. Its bounded 0.146.0 Slice 0 live
capability proof passes, and the Slice 1 lower client is implemented without a
Worker Context mapping. Slice 2 now implements the bounded adapter projection:
one current `IMPLEMENT` Context Package is rendered into the exact App Server
Turn prompt and closed output schema, while configured size, lease, profile,
policy, and response bindings are revalidated. Slice 5 composes the smaller M1
Context shape through the deterministic reject/repair/accept path, but it does
not yet compile exact rejection Evidence or structured `priorAttemptFeedback`
for a fresh repair Thread. Slice 6 owns that M2 extension using the closed
bounded-M2 failure-source set defined below. The existing Compiler and Manifest
authority are otherwise unchanged, and trusted live composition remains later
M2 work. This is the Goal-bound Worker Context Compiler;
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
- the exact current `REJECT_REPAIRABLE` decision, its Acceptance Input
  Manifest, failing Evidence, and parent/repair Candidate relationship when
  entering a repair generation; and
- constraints that a repair MUST preserve.

### Authoritative or observed project inputs

- project/base identity;
- relevant source files or bounded excerpts;
- repository rules and accepted project configuration;
- actual change manifest when a retained project record provides it; bounded M2
  otherwise has only Candidate-freeze `changeSetDigest`;
- current test/build declarations;
- current runtime observations when applicable.

### Non-authoritative working inputs

- bounded transcript excerpts;
- provenance-labelled worker-authored summaries only when a policy selects an
  explicit durable source record;
- proposed facts;
- hypotheses and search hints;
- bounded `priorAttemptFeedback` deterministically projected from the closed
  bounded-M2 failure-source set defined below; and
- optional bounded worker-authored rationale, hypothesis, or search-state
  summaries only when an explicit durable source record exists.

Non-authoritative inputs must be labelled and cannot override authoritative
inputs. Raw private reasoning and opaque compaction state are worker-session
internals, not Context Compiler inputs.

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
  repairContext?
    acceptanceRepairDigest
    acceptanceDecisionId
    acceptanceDecisionDigest
    inputManifestDigest
    rejectedCandidateGenerationId
    rejectedCandidateVersion
    rejectedCandidateDigest
    repairCandidateGenerationId
    repairCandidateSequence
    repairCandidateBaseDigest
    failedEvidence[]
      evidenceId
      evidenceRecordDigest
      evidenceEligibilityVersion
      resultStatus
      verificationObligationId
      checkSpecificationId
      checkSpecificationDigest
    constraintsToPreserve[]
  priorAttemptFeedback?
    schemaVersion
    items[]
      kind
      content
      sourceRefs[]
      sourceDigests[]
    feedbackDigest
  executionProfileId
  executionProfileDigest
  policyBundleId
  policyBundleDigest
  responseContract
```

The worker-visible rendering may be Markdown, structured JSON, or a combination.
The canonical identity is the `ContextManifest`, not presentation formatting.

`repairContext` is authoritative Runtime state. Its fields MUST bind the exact
current repair authority and failing Evidence retained for the parent
generation. `priorAttemptFeedback` is a bounded, fixed-schema working
projection. The required M2 projection MUST be deterministically derived from
this fixed source set and no other source class:

- the exact current `AcceptanceRepairRecord` and `REJECT_REPAIRABLE` decision;
- that decision's `AcceptanceInputManifest`;
- the failing Evidence records selected by that exact manifest;
- the exact rejected parent and repair-child Candidate relationship;
- the parent Candidate-freeze Evidence's `changeSetDigest`; and
- the current Goal preservation constraints.

The projection may describe an observed failure cause only to the extent one
of those decoded records establishes it. The `changeSetDigest` alone does not
authorize a Worker-authored changed-file list. Every item MUST cite its source
records and digests. It remains non-authoritative and cannot override Goal,
Policy, Evidence, Runtime Decisions, or preservation constraints.

The bounded M2 profile emits no optional feedback source classes. Decoded
changed-file lists, attempted approaches, eliminated directions, hypotheses,
unrelated project observations, and free-form Worker summaries are omitted even
when retained elsewhere. A later versioned profile and durable source contract
may select such inputs; M3 owns their general fact model and relevance
selection. M2 does not derive any of them from old chat.

The bound Context policy sets maximum feedback items, maximum canonical bytes
per item, and maximum total canonical bytes. Required authoritative failure
records are never truncated into feedback. Optional feedback overflow follows
one deterministic omission rule recorded in the Manifest, or fails compilation
when policy marks the item required.

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

The M2 repair extension MUST introduce closed authority classes for Runtime
Decision and Evidence inputs rather than labelling them as model-authored
working context. The feedback projection retains a distinct
`NON_AUTHORITATIVE_WORKING` class even when Runtime renders it from
authoritative sources. The Manifest MUST bind both the authoritative source
entries and the separate feedback digest so a free-form paragraph cannot be
substituted without detection.

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

For repair compilation, Runtime additionally rejects a missing or non-current
repair record, a decision other than the exact current `REJECT_REPAIRABLE`,
Evidence from another Goal or Candidate generation, a parent/child Candidate
mismatch, an ineligible or changed Evidence record, and feedback whose source
set or digest no longer matches. The Worker is not dispatched when any required
repair input cannot be proved.

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

Non-authoritative does not mean operationally disposable. Retaining a bounded,
policy-selected Thread can preserve hypotheses, eliminated paths, and other
working continuity that would be expensive or error-prone to reconstruct on
every Turn. M2 therefore plans these rules:

- one `WorkerRequest` maps to one bounded Turn on one exact Thread, and the
  App Server-managed tool loop for that Turn remains on that Thread;
- the adapter MUST NOT start a replacement Thread or worker Turn merely because
  a tool call, approval request, or compaction lifecycle event occurred;
- an additional worker Turn or `thread/resume` requires an exact Runtime
  directive and the Workflow-bound Execution Profile policy;
- a fresh Worker Session uses a fresh Thread by default; M2 also defaults a new
  repair generation and a replacement Attempt after restart to a fresh Thread,
  with exact failure Evidence and `priorAttemptFeedback` recompiled into the
  new Context;
- continuation across a phase boundary is allowed only when the bound policy
  names that boundary and the current Goal, phase, Context, project, and
  protocol identities still match; and
- the M2 local Verification Runner does not use a Codex Thread. A future
  model-based reviewer must use its own explicitly isolated context policy.

Thread retention improves worker continuity; it never becomes a prerequisite
for safe recovery. If the selected Thread is unavailable or untrusted, Runtime
must follow its exact fail-closed or fresh-Thread fallback policy and compile
current Context again.

### Repair Context continuity — planned Slice 6

File continuity and task-information continuity are different. A repair child
Candidate starts from the exact frozen parent bytes. A fresh repair Worker
learns why those bytes failed only through a newly compiled `repairContext` and
bounded `priorAttemptFeedback`.

For each repair dispatch, the compiler MUST:

1. load the exact current repair record and `REJECT_REPAIRABLE` decision;
2. bind its Acceptance Input Manifest, failing Evidence records, exact parent
   generation, and exact repair child generation;
3. render preservation constraints and a bounded feedback projection with
   explicit source references and digests;
4. revalidate every identity immediately before dispatch; and
5. persist the new package and Manifest with the fresh Attempt, Worker Session,
   and dispatch claim.

The same authoritative repair projection MUST be derivable when the old Codex
Thread and its history no longer exist. A fresh Attempt, Session, Thread, and
package have new identities, so the entire package digest need not equal an
earlier package digest; the bound failure-source records and their rendered
authoritative projection MUST be equivalent.

A stale decision, missing Evidence, wrong Candidate, mismatched repair child,
or feedback without exact source bindings stops before Worker dispatch. Runtime
MUST NOT ask the Worker to infer the previous failure from inherited files.

### History retention and Context injection — planned Slice 6

Retaining an old Thread or transcript for bounded diagnostics is a separate
policy from injecting content into a new Context Package. M2 defaults are:

- a bounded Turn within one Attempt retains its exact Thread for the App
  Server-managed tool loop;
- a repair generation creates a new Worker Session and fresh Codex Thread;
- the full old chat, hidden reasoning, KV cache, repeated tool transcript, and
  duplicate file content are not injected into the repair package;
- retained history does not change the authoritative repair projection merely
  because it is available;
- a policy-selected worker summary may enter only as bounded,
  provenance-labelled, non-authoritative feedback from an explicit durable
  source record; the bounded M2 profile does not require such a record; and
- expired or unbound historical content is omitted rather than allowed to
  override current authority.

M2 does not implement semantic history search, automatic conversation
summarization, or dynamic relevance selection. Those remain M3 candidates.

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

The selected M2 profile uses controlled config/state roots, untrusted project
config, a custom permission profile, and exact `config/read`,
`permissionProfile/list`, and `instructionSources` comparisons. Source-bound
`AGENTS.md` files may be present; Candidate-local config, hooks, plugins, MCP,
apps, skills, subagents, dynamic tools, and Web Search are disabled for the
bounded profile. Stable `turn/steer` is also prohibited: a user or adapter may
not insert input into an active Worker Turn outside a newly admitted Runtime
directive and Context compilation.

## Codex Compact Interaction

The [Codex App Server protocol](https://learn.chatgpt.com/docs/app-server.md)
supports automatic history compaction and exposes manual compaction through
`thread/compact/start`. At the App Server boundary, CodeClosure observes the
`contextCompaction` Item lifecycle; it does not require a human-readable
compaction payload. Lower
[Responses API compaction state](https://developers.openai.com/api/docs/guides/compaction)
may be opaque machine state and must be passed through by its owning client
rather than interpreted or edited. CodeClosure leaves that mechanism inside
Codex and treats it as worker-session maintenance.

An authorized manual compaction may emit App Server `turn/*` progress on the
same Thread. That maintenance lifecycle is not a new Worker dispatch, Attempt,
or completion request and MUST NOT be admitted as one.

Rules:

- automatic/manual compaction mode and any manual trigger are selected by the
  Workflow-bound Execution Profile rather than adapter discretion;
- `contextCompaction` start/completion events are retained only as bounded
  worker-session observations;
- compaction does not change Goal, Workflow, Candidate, Fact, or Acceptance
  state;
- private reasoning and opaque compaction state MUST NOT be copied into a
  Context Package or Manifest, Store, audit, Evidence, CLI view, or acceptance
  report;
- App Server-owned Thread state may remain in the controlled state root only
  under its explicit retention and privacy policy;
- after compaction, the next phase-critical turn receives a newly compiled
  package when policy requires it;
- an intentionally exported worker-authored summary may be included only as
  labelled, bounded, non-authoritative working context; and
- losing the Codex Thread must not prevent safe resumption.

For the selected 0.146.0 decision baseline, the bounded live probe supports
manual compaction, its `contextCompaction` Item lifecycle, post-compaction
continuation, and exact Thread resume after App Server process restart.
Availability of the automatic-compaction configuration surface still does not
prove that an automatic trigger worked. Automatic triggering remains `UNKNOWN`
and unselected by the bounded M2 Execution Profile.

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
Raw Request revision + optional current Intent Projection + clarification state
  + optional bounded project observations
  + Intake policy and assistant response contract
  -> Intake Package + Intake Manifest
  -> Intent Analysis Proposal
```

An Intake Manifest binds only IntakeRun, Raw Request revision/digest, optional
current Intent Projection revision/digest, question, project/scope, Intake
policy, adapter, provenance, omission, and budget identity. It cannot be used as
a Goal-bound Context Manifest, Worker dispatch claim, Evidence input, or
Acceptance input. Source Binding, Material Ambiguity, and Intent Admission are
performed by their owning Runtime components after assistant output validates;
the assistant and Intake compiler cannot author those decisions. A
`PRE_ANALYSIS_NO_EXECUTION` decision does not compile an intent-analysis Intake
Package or call the assistant to decide Admission. Its `ANSWER_ONLY` subtype
may use a separate `AnswerOnlyPackage` and bounded answer response contract,
bound to the exact Raw Request, Decision, Intake policy, adapter, provenance,
omissions, and budgets. That package grants no project tools and its result
cannot enter Goal-bound Context, Evidence, or Acceptance as authority.

Canonical projection, rendering, digest, byte-budget, redaction, and protocol
utilities MAY be shared below both compilers. Their domain records, codecs,
freshness rules, and authority labels remain separate. See
[ADR 0027](adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md)
and [Goal Intake](goal-intake.md).

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

Code relevance retrieval, full Fact Graph traversal, and token-aware packing
belong to later milestones. The M2 repair Context and Thread policy described
above remain planned until Slice 6 lands their schema, persistence, Runtime,
Store, and restart proof.

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
- no authority field depends solely on a transcript excerpt;
- one Worker Request and its App Server-managed tool loop remain on the exact
  policy-selected Thread/Turn, while every additional start or resume requires
  Runtime authority;
- `contextCompaction` lifecycle cannot mutate authority or cause private
  reasoning or opaque compaction state to enter durable CodeClosure records;
- a fresh repair or recovery Thread receives current compiled Context and exact
  prior failure authority without trusting the lost Thread; and
- deleting the old Thread does not change the authoritative repair projection,
  while retaining it does not silently inject the complete old conversation;
- wrong-Goal, wrong-generation, stale, missing, or digest-mismatched failure
  Evidence and feedback fail before repair dispatch;
- non-authoritative `priorAttemptFeedback` cannot override Goal, Evidence,
  Runtime Decision, Policy, or repair-preservation constraints; and
- changing Thread continuity, compaction, retention, or fallback policy changes
  the bound Execution Profile identity or fails closed.
