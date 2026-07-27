# M0 architecture review

- Review date: 2026-07-27
- Scope: product constitution and deterministic runtime architecture
- Result: **READY FOR M1 IMPLEMENTATION AFTER THE M0 BASELINE COMMIT**
- Repository gate: the reviewed canonical documents and accepted ADRs must be
  tracked together before M1 work begins.
- Important qualification: no working runtime exists yet; this is not a product
  completion or release decision.

## 1. Review question

Does the documented architecture make the following promise implementable and
testable?

> A probabilistic worker may be wrong, but its unverified output cannot directly
> become a successful CodeClosure completion.

The answer is **yes at the architecture level**, subject to implementing and
testing the invariants in M1. The design does not make model execution
deterministic. It makes authority, transitions, binding, and acceptance rules
deterministic for a given persisted state and set of verifier observations.

## 2. Traceability to the product direction

| Required direction | Architectural response | Primary document |
| --- | --- | --- |
| Goal exists outside prompts and threads | Durable Goal aggregate with explicit success criteria | [Domain model](../domain-model.md) |
| Context is compiled, not replayed chat | Versioned `ContextPackage` with inclusion manifest | [Context compiler](../context-compiler.md) |
| Business scope is not remembered by the model | Fact Graph and explicit business scenarios with coverage state | [Domain model](../domain-model.md) |
| Long tasks follow governed phases | Guarded workflow reducer and capability policy | [Workflow](../workflow.md) |
| Completion authority is externalized | Acceptance Engine issues decisions; Workflow Runtime commits state | [Acceptance engine](../acceptance-engine.md) |
| Codex is an executor | Worker port and App Server adapter boundary | [ADR 0002](../adr/0002-host-runtime-and-codex-adapter.md) |
| Compaction cannot erase critical state | Authoritative data lives outside worker threads | [Runtime invariants](../../RUNTIME_INVARIANTS.md) |
| Evidence is bound to what was checked | Candidate-, digest-, verifier-, and environment-bound records | [Evidence model](../evidence-model.md) |
| User interacts with CodeClosure | Standalone repository and product entry point | [ADR 0001](../adr/0001-standalone-product-repository.md) |
| Compatibility is not a constraint | IntentOS is reference material, not a runtime dependency | [Product constitution](../../PRODUCT.md) |

## 3. Findings resolved during review

### F-001 — Completion writer was conceptually conflated (P0)

**Risk:** Saying “the Acceptance Engine owns completion” could allow it to mutate
workflow state directly, creating two transition writers.

**Resolution:** The Acceptance Engine is the sole issuer of `ACCEPT`; the
Workflow Runtime is the sole committer of state transitions. `CLOSEOUT` requires
a current, persisted `ACCEPT` decision and is still committed by the runtime.

### F-002 — Worker and control data could share a trust boundary (P0)

**Risk:** A worker with repository write access could forge Goal state, evidence,
or acceptance records if they lived inside its workspace.

**Resolution:** Authoritative storage, policy, audit, and acceptance data are
outside worker-writable paths. Worker output enters through typed requests and is
validated before persistence.

### F-003 — Repair after freeze could invalidate evidence invisibly (P0)

**Risk:** Editing a frozen candidate in place could leave evidence looking valid
for source that was never checked.

**Resolution:** Freeze is irreversible for a generation. Any source repair creates
a new candidate generation and invalidates prior candidate-bound acceptance.

### F-004 — Worker lifecycle could be mistaken for Goal lifecycle (P1)

**Risk:** Codex `turn/completed`, a zero process exit, or worker text saying
“done” could be mapped to successful completion.

**Resolution:** These are worker observations only. They may trigger collection
or a completion request, but cannot produce `ACCEPT` or `CLOSEOUT`.

### F-005 — Technical acceptance could authorize external effects (P1)

**Risk:** Passing checks might automatically publish, deploy, merge, or overwrite
a user's repository.

**Resolution:** Technical `ACCEPT` and external-effect authorization are distinct.
Promotion and release actions require their own policy and, where configured, a
human decision.

### F-006 — “Deterministic” could be overclaimed (P1)

**Risk:** The product might imply deterministic truth despite flaky tests,
incomplete policy, or environmental nondeterminism.

**Resolution:** Determinism is scoped to state authority and repeatable decision
evaluation over immutable inputs. `REJECT_REPAIRABLE`, `REJECT_BLOCKED`,
`NEEDS_DECISION`, and `ENGINE_ERROR` are explicit; absence of evidence never
becomes PASS.

### F-007 — Minimal context could silently omit required facts (P1)

**Risk:** Optimizing for small prompts could reintroduce business-path omission.

**Resolution:** Every compiled package has a manifest recording included and
excluded sources, reasons, versions, and digests. Required fact dependencies are
validated before dispatch.

### F-008 — Worker-produced PASS could self-approve work (P1)

**Risk:** A worker could report a successful test or fabricate evidence text.

**Resolution:** Worker output is an untrusted observation. Acceptance rules name
trusted verifier classes and provenance requirements; only eligible evidence can
satisfy an obligation.

### F-009 — Recovery could depend on transcript reconstruction (P1)

**Risk:** A crash or compaction could require a model to infer the previous
phase, invalidating deterministic recovery.

**Resolution:** State, versions, attempts, leases, candidates, evidence, and
pending decisions are persisted. Startup reconciles those records with external
resources before new dispatch.

### F-010 — Semantic replay could be confused with record equality (P1)

**Risk:** Including generated IDs, timestamps, or a digest field itself in an
authority-bearing digest would make equivalent replay unstable or
self-referential.

**Resolution:** [ADR 0006](../adr/0006-canonical-serialization-and-digest-profiles.md)
defines exact RFC 8785 serialization, named schema-versioned projections, and
the separation between semantic digests and record-envelope metadata.

### F-011 — Evidence immutability and invalidation were conflated (P1)

**Risk:** Mutating status fields on an allegedly immutable Evidence record could
silently rewrite what an acceptance decision consumed.

**Resolution:** Evidence observations are immutable. Current eligibility is a
separate, monotonic `ELIGIBLE -> INELIGIBLE` lifecycle record whose mutation and
audit event are atomic.

## 4. Authority consistency check

The documents use one authority model:

| Action | Sole authority | Inputs from workers |
| --- | --- | --- |
| Commit a workflow transition | Workflow Runtime | May request; cannot commit |
| Issue `ACCEPT`, `REJECT_REPAIRABLE`, `REJECT_BLOCKED`, `NEEDS_DECISION`, or `ENGINE_ERROR` | Acceptance Engine | May submit a completion request and observations |
| Record an explicit product/user choice | Human Decision Gateway | May identify that a decision is needed |
| Compile execution context | Context Compiler | May propose discoveries for validation |
| Register trusted evidence | Evidence subsystem under runtime policy | May produce raw artifacts or observations |

No document intentionally grants Codex, another worker, a prompt, or a transcript
direct mutation authority over these actions.

## 5. Reference-project validation

| Reference | Confirmed useful pattern | Boundary retained by CodeClosure |
| --- | --- | --- |
| OpenAI Codex | App Server thread/turn/item execution surface, approvals, interruption, compaction | A completed turn is not accepted Goal completion |
| OpenAI Symphony | Orchestrator-owned scheduling state, reconciliation, isolated workspaces | Tracker/workflow completion is not a complete evidence authority model |
| ml-intern-codex | Standalone terminal wrapper around Codex App Server | Thread state is not CodeClosure Goal state |
| CodexPotter | Fresh-context loops, filesystem handoff, completion audit | LLM/skill protocol markers are not trusted transitions |
| ai-sdk-provider-codex-app-server | TypeScript App Server integration feasibility | It is a reference adapter, not the domain or security boundary |
| IntentOS predecessor | Business-universe coverage, evidence binding, runtime identity, closure discipline | Prompt/file governance does not retain completion authority |

Detailed source notes and links are in [references.md](../references.md).

## 6. M0 exit-condition review

| Condition | Result | Evidence |
| --- | --- | --- |
| Product promise and non-goals are explicit | Pass | `PRODUCT.md` |
| Trust and authority boundaries are explicit | Pass | `ARCHITECTURE.md`, `RUNTIME_INVARIANTS.md` |
| Core domain records have stable meanings | Pass for M1 planning | `docs/domain-model.md` |
| Workflow phases and guards are defined | Pass | `docs/workflow.md` |
| Evidence and acceptance are separated | Pass | `docs/evidence-model.md`, `docs/acceptance-engine.md` |
| Initial build sequence is bounded | Pass | `docs/milestones.md` |
| Major foundational decisions are recorded | Pass | `docs/adr/0001` through `0006` |
| Canonical relative links resolve | Pass | Repository-local link audit over all Markdown files |
| Canonical baseline is version controlled | Gate before M1 | Baseline commit containing this reviewed document set |
| Runtime guarantees are proven in code | Not applicable to M0 | Required in M1 |

## 7. Implementation choices intentionally deferred

The [M1 implementation plan](../plans/m1-deterministic-skeleton.md) now fixes
the first package boundaries, storage driver, migration approach, command
surface, test harness, and build slices. [ADR 0006](../adr/0006-canonical-serialization-and-digest-profiles.md)
fixes the M1 canonical serialization and semantic digest profiles. The following
later choices remain deliberately unresolved and do not block M1:

- content-addressed artifact-store implementation;
- production evidence retention limits;
- real workspace isolation mechanism, deferred to M2 unless M1 needs a minimal
  filesystem prototype;
- exact Codex version-support window, introduced in M2.

Each choice must preserve the accepted ADRs and invariants. A library selection
must not silently become a second state machine or acceptance authority.

## 8. M1 gate

After the M0 baseline commit records the reviewed canonical set, M1
implementation may begin under the concrete package, slice, and proof matrix in
[the M1 plan](../plans/m1-deterministic-skeleton.md). M1 is complete only when
the FakeWorker adversarial suite proves that:

1. worker claims and process success cannot close a Goal;
2. illegal phase actions are rejected before dispatch;
3. freeze and candidate-generation rules invalidate stale evidence;
4. acceptance is reproducible from an immutable manifest;
5. stale, missing, untrusted, or conflicting evidence fails closed;
6. state and audit writes are atomic and recoverable;
7. interruption and duplicate delivery cannot create double transitions.

## Verdict

The M0 document content and M1 plan are internally sufficient to begin the
deterministic skeleton after this reviewed set is recorded in the M0 baseline
commit. Until then, repository authority has not been durably established. The
architecture preserves the original direction while correcting the central
ambiguity: CodeClosure does not make Codex reliable by instruction; it prevents
Codex from owning the authority that turns an unverified claim into a completed
result.
