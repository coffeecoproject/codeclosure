# CodeClosure Milestones

Progress is measured by proven runtime capabilities, not by document count,
module count, or worker output volume.

## M0 — Product Constitution and Architecture Baseline

### Objective

Turn the discussion into durable repository authority before implementation.

### Deliverables

- product contract;
- architecture and trust boundaries;
- runtime invariants;
- domain model;
- workflow state machine and capability matrix;
- context, evidence, and acceptance contracts;
- accepted ADRs for repository, worker boundary, stack, state/audit, Candidate
  isolation, and canonical digests;
- reference-project boundary analysis;
- M0 cross-document review.

### Exit Criteria

- one technical acceptance issuer and one workflow-state writer are defined;
- Workflow mutation and Acceptance issuance are separate and unambiguous;
- worker, conversation, and Codex Thread state are explicitly non-authoritative;
- candidate freeze and repair generations are defined;
- technical closeout is separated from promotion/production authority;
- M1 scope and adversarial tests are concrete;
- documents contain no claim that the runtime already exists;
- all repository-local canonical links resolve;
- canonical M0 documents and accepted ADRs are tracked in a version-control
  baseline.

M0 completion means the architecture baseline is ready for implementation. It
does not mean CodeClosure is a working product.

## M1 — Deterministic Skeleton with FakeWorker

Status: Complete as a bounded deterministic-control milestone on 2026-07-30.
The [M1 completion review](reviews/m1-completion-review.md) records the exact
source identity, environment, quality-gate output, and exit-criterion evidence.

### Objective

Prove the authority boundary without any LLM or Codex dependency.

### Scope

- Node.js 22+, strict TypeScript, pnpm workspace;
- CLI commands for create/start, status, advance through a controlled demo,
  resume, and cancel;
- typed domain identifiers and aggregates;
- deterministic transition policy;
- SQLite current-state store and append-only audit events;
- optimistic concurrency and transactional writes;
- minimal Context Manifest;
- `Worker` port and `FakeWorker` adapter;
- Candidate-generation state model with deterministic fake digest;
- immutable fake Evidence records with separate monotonic eligibility;
- minimal Acceptance Engine policy;
- immutable installed M1 Policy and Execution Profile identities with separate
  first-start Workflow bindings;
- startup recovery/reconciliation for interrupted Attempts;
- machine-readable and human-readable status output.

### Explicit Non-Scope

- Codex or another real agent;
- real source editing or worktree management;
- real test/build runners;
- full Fact Graph discovery/traversal;
- rich TUI;
- multi-agent scheduling;
- cloud or multi-user behavior;
- release or deployment.

### Walking-Skeleton Demonstration

```text
codeclosure goal create --objective "demo objective" --project <fixture-path> \
  --criterion "the controlled M1 objective has exact passing fake evidence"
  -> Goal and Workflow persist in DISCOVERY / READY
codeclosure goal start <goal-id> --fixture happy-path
  -> first DISCOVERY Attempt starts
  -> FakeWorker submits proposals
  -> legal phases advance through runtime commands
  -> FakeWorker claims completed
  -> closeout is rejected without acceptance inputs
  -> fake candidate freezes
  -> fake evidence is recorded
  -> Acceptance Engine issues ACCEPT
  -> Workflow Runtime enters CLOSEOUT transactionally
```

The demo must also show a failing-evidence path that cannot close.

### Exit Criteria

- all M1 state-machine and acceptance adversarial tests pass;
- process restart preserves authoritative state;
- restart never redispatches consumed authority and resume uses the same bound
  execution profile with a fresh Attempt;
- state mutation and audit append are atomic;
- stale version writes are rejected;
- worker cannot write an Acceptance Decision or terminal state;
- a missing/mismatched input fails closed;
- acceptance replay is deterministic;
- documentation and implementation vocabulary agree;
- no Codex dependency is present in the domain/runtime packages.

M1 completion proves the local `FakeWorker` control plane and its fail-closed
authority boundaries. It is not product completion, real-project verification,
promotion consent, or a release claim.

## M2 — Codex Vertical Slice

Status: Not started. The scope below is planned behavior.

### Objective

Replace `FakeWorker` for selected phases with Codex App Server while preserving
the M1 authority boundary.

### Scope

- direct Codex App Server v2 adapter over stdio;
- initialization plus Thread/Turn lifecycle;
- installed-version discovery and generated TypeScript schema snapshot;
- per-phase cwd, sandbox/permissions, and approval routing;
- stream Item observations without treating `turn/completed` as Goal complete;
- thread interruption and backend failure mapping;
- isolated real Candidate workspace/generation;
- hard freeze digest and mutation detection;
- one real verification runner path;
- acceptance rejection and repair generation loop;
- fresh-thread and resumed-thread policies;
- Compact event handling with no loss of authoritative state.

### Required Demonstration

For one bounded repository fixture:

1. Codex edits a Candidate;
2. Codex claims completion;
3. a required test fails;
4. CodeClosure rejects closeout and creates a repair generation;
5. Codex repairs the new generation;
6. source is frozen and evidence rebuilt;
7. Acceptance passes and CodeClosure closes the Goal;
8. the accepted record identifies exact Candidate and evidence digests.

### Exit Criteria

- Codex protocol failure, turn completion, compact, and process exit cannot
  bypass M1 guards;
- control state is inaccessible from the worker-writable Candidate;
- frozen-source mutation is detected and invalidates evidence;
- restart and new Thread recovery preserve Goal/Workflow authority;
- protocol schemas are version-bound rather than hand-copied into core;
- one complete adversarial fixture proves reject/repair/accept behavior.

## M3 — Full Fact Graph and Context Compiler

### Objective

Move business-path memory and phase context selection into durable, queryable
runtime state.

### Scope

- provenance-bearing Fact Graph;
- business-scenario discovery and applicability;
- code/business relationship mapping;
- Context Compiler relevance selection and hard budgets;
- Context Manifest omission decisions;
- decision and unresolved-fact gateway;
- scenario-to-obligation-to-evidence trace;
- clean-context phase and review sessions.

### Exit Criteria

- a new Codex Thread can continue a Goal from authoritative state without the
  old transcript;
- every required scenario remains traceable to implementation and evidence;
- unsupported inference cannot become confirmed fact;
- Context Manifest identity changes when relevant authority changes;
- omitted relevant scope is detected by adversarial fixtures.

## M4 — Recovery, Automated Repair, and Dogfooding

### Objective

Operate CodeClosure continuously on real CodeClosure development tasks.

### Scope

- bounded retry and repair budgets;
- robust crash/restart reconciliation;
- Human Decision Gateway UX;
- richer status surface;
- candidate retention and cleanup policy;
- CodeClosure builds selected CodeClosure changes;
- escaped-defect and false-acceptance tracking.

### Exit Criteria

- interrupted real runs recover without narrative state reconstruction;
- automatic repair cannot exceed scope or budget silently;
- dogfood tasks produce usable closeout evidence;
- false completion attempts remain rejected;
- operator can see Goal, phase, scenario coverage, blocker, and next action
  without reading raw transcripts.

## M5 — Hardening and Additional Workers

Potential scope after local Codex dogfooding is stable:

- additional coding-agent adapters;
- policy packs by project/risk type;
- stronger isolation and remote runners;
- multi-goal scheduling;
- team/multi-user authority;
- promotion/merge/release control as a separate governed subsystem;
- evaluate whether any proven limitation justifies a Codex fork.

None of these is an M0–M2 requirement.

## Current Open Implementation Decisions

These are intentionally deferred to focused milestone ADRs, plans, or spikes:

- logging/tracing implementation;
- transaction/repository API details;
- candidate workspace mechanism for M2;
- evidence payload retention limits.

Deferred decisions must preserve the existing invariants.
