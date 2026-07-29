# CodeClosure Architecture

## Status

This document defines the target architecture. The current M1 implementation
has reached the Acceptance/closeout slice: deterministic domain and Workflow
control, SQLite persistence and audit, minimal Context compilation, typed
`FakeWorker` dispatch and event admission, logical Candidate generations,
stable freeze observation, independent fake verification, immutable Evidence,
canonical Evidence Sets, deterministic Acceptance Decisions, transactional
closeout, immutable exact repair-generation authority, and verified local
startup composition exist. CLI command parsing/rendering and proof scenarios
remain M1 work. Real candidate isolation and real project verification remain
M2 work. Components marked for later slices or milestones are architectural
boundaries, not current implementation claims.

## Architectural Goal

CodeClosure places a deterministic host runtime between the user and a
probabilistic coding worker. The host owns intent, state, capabilities,
candidate identity, evidence, and acceptance. The worker owns only permitted
execution.

```text
                     User
                      |
                      v
              CodeClosure CLI / App
                      |
                      v
        +--------------------------------+
        | CodeClosure Control Runtime    |
        |                                |
        | Goal / Fact / Decision Store   |
        | Workflow Runtime               |
        | Context Compiler               |
        | Candidate Manager              |
        | Evidence Store                 |
        | Acceptance Engine              |
        | Human Decision Gateway         |
        +---------------+----------------+
                        |
                        v
                  Worker Port
                        |
             +----------+-----------+
             |                      |
             v                      v
        FakeWorker (M1)       Codex Adapter (M2)
                                     |
                                     v
                             Codex App Server
                                     |
                                     v
                                Codex Core
```

## Architectural Planes

### Interaction Plane

The CLI or future App presents goals, progress, blockers, decisions, and
evidence summaries. It sends typed Goal commands to the Runtime application
facade and renders Runtime-owned read views. It does not write or query the
control database directly, sequence internal Workflow commands, or infer
successful completion from a worker transcript.

### Control Plane

The control plane owns all authoritative CodeClosure state and policy. It
decides:

- which goal revision is active;
- which phase is current;
- which actions are permitted;
- which candidate generation is current;
- which evidence is eligible;
- whether acceptance can be evaluated;
- whether an accepted decision can be committed to closeout.

### Execution Plane

Workers and verification runners act on bounded inputs and return typed
outputs. They cannot access control-store mutation APIs.

### Project Plane

The source repository, candidate workspaces, Git metadata, build systems,
tests, runtime services, and generated artifacts constitute external project
reality. CodeClosure observes and reconciles this plane; it does not assume its
own records make external reality true.

## Trust Boundaries

### Boundary A — User to Control Runtime

Natural-language input is parsed into proposals. A Goal revision or Human
Decision becomes authoritative only after the runtime validates and persists a
typed record.

### Boundary B — Control Runtime to Worker

The worker receives:

- a compiled, digest-bound context package;
- the current phase objective;
- a capability grant;
- the active candidate path when writes are permitted;
- a response schema or typed worker contract.

The worker does not receive a direct control-store write channel.

### Boundary C — Worker to Control Runtime

All worker output is untrusted input. The adapter validates protocol shape and
the runtime validates semantic preconditions. A worker result may request a
transition, report an observation, or propose a fact; it cannot cause a state
transition by naming one.

### Boundary D — Candidate to Evidence

`SOURCE_FREEZE` establishes a candidate digest. Evidence runners bind output to
that digest. Any source mutation invalidates the evidence chain.

### Boundary E — Evidence to Acceptance

The Acceptance Engine reads immutable input manifests and emits a decision. It
cannot run implementation tools or change candidate source.

### Boundary F — Technical Closeout to Real-World Effect

Closeout establishes technical completion for the declared workflow scope. A
promotion, merge, release, deployment, paid action, or irreversible data change
requires a separate gateway and policy.

## Logical Components

### Runtime Application Coordinator

The implemented Slice 7 application facade creates Goals, invokes public
start/resume/cancel commands, owns startup-recovery and query capabilities, and
returns schema-versioned Goal status/audit views. It receives narrow Store and
external-inspection ports; adapters receive neither those ports nor the
Workflow kernel.

The implemented Slice 7 driver reloads authoritative state before each
internal operation and stops at a terminal, waiting, blocked, failed,
decision, or typed infrastructure boundary. Each internal phase operation is
its own audited transaction so process restart can re-enter from the last
committed boundary. Public `StartGoal` and `ResumeGoal` await that drive and
return the exact stored public-command result separately from an informational
drive summary. The summary and the existing dominant-blocker explanation are
derived views, not Acceptance or closeout authority. A retained active Attempt
is never adopted or redispatched; startup reconciliation and a fresh
`ResumeGoal` must authorize replacement work. See
[ADR 0020](docs/adr/0020-runtime-application-recovery-and-query-boundary.md).

### Goal Manager

Owns Goal creation, revision, activation, cancellation, and successful closure
identity. Goal intent and revision are authoritative here. In M1 the lifecycle
status exposed on Goal is a denormalized projection of its unique Workflow run
status, synchronized inside the Workflow transaction rather than changed by a
second lifecycle writer. It never stores the only copy of Goal state in a
worker prompt.

### Fact and Decision Store

Stores provenance-bearing facts, business scenarios, relationships, unresolved
questions, and typed human decisions. M1 implements the minimum record model;
full Fact Graph discovery and traversal is a later milestone.

### Workflow Runtime

The sole authoritative workflow-state writer. It:

- resolves the owning Goal/Workflow and validates expected freshness before
  child lookup, guard evaluation, identifier allocation, or domain planning;
- enforces the transition matrix;
- derives phase capabilities;
- owns Attempt lifecycle as part of the versioned Workflow aggregate in M1;
- persists state plus audit event atomically;
- suspends for typed blockers and decisions;
- reconciles after interruption.

In the current Worker path it also commits a Context-bound Attempt atomically,
claims dispatch against the exact active Workflow version, owns cancellation
and `AbortSignal` ordering, reloads that claim before every event admission,
and converts a validated Worker event into a runtime-authored internal command.
Every durable receipt retains dispatch causality. The Worker cannot choose that
command, its failure classification, or mutate state through its delivery
identity. Strict event shape and a compiler-owned canonical byte budget bound
Worker output before semantic admission.

In the current Candidate/Evidence path, the Runtime coordinates the owning
Candidate Source, Verification Runner, and Store without giving any of them a
Workflow mutation method. Candidate creation, freeze, drift failure, Evidence
admission, eligibility invalidation, and Evidence Set finalization use
authority-specific compound transactions. Generic phase guards cannot
self-attest Candidate, Evidence, or Acceptance facts. Candidate Source output
cannot author project/workspace identity; Check Specifications bind the M1
producer, and specialized Runtime builders derive Evidence producer,
environment, payload, and result fields.

In the current Acceptance path, closeout and repair are dedicated compound
transactions rather than generic phase requests. Closeout retains the exact
accepted authority. Repair retains a canonical immutable record that binds the
consumed repairable decision and manifest, rejected generation, fresh child,
Checks, and Verification Obligations. SQLite and startup validation reconstruct
that relationship; nearby rows or an opaque audit label cannot substitute for
it. See
[ADR 0019](docs/adr/0019-exact-acceptance-repair-authority.md).

The current M1 package root exposes the narrow create/start/resume/cancel and
query application capabilities for public adapters. Public mutations operate
only by Goal identity. Startup recovery remains a separate trusted lifecycle
capability and is not a handler command. The internal Workflow control kernel
and its Attempt/phase commands remain unavailable as package-root adapter
capabilities. The implemented trusted composition root constructs the verified
Store, driver, installed Policy and Execution Profiles, and recovery inspector;
the driver alone constructs its hidden kernel. Composition completes startup
recovery before returning a facade, while CLI handlers, worker adapters, and
other callers receive neither the control Store mutation port, the internal
kernel object, nor the recovery coordinator. See
[ADR 0020](docs/adr/0020-runtime-application-recovery-and-query-boundary.md)
and [ADR 0021](docs/adr/0021-m1-execution-profile-and-cli-composition.md).

### Context Compiler

Builds a phase-specific worker input from authoritative state and current
project evidence. It records a `ContextManifest` so the runtime knows exactly
which revisions and facts were presented.

The compiler is not a conversation summarizer. It may include a bounded
transcript excerpt as non-authoritative working context, but it never depends
on that excerpt for goal identity or acceptance.

The M1 compiler emits a disposable canonical Context Package and a durable
Manifest. The first Start binds one exact installed Policy to the Workflow;
later Runtime configuration must match that immutable identity before
compilation, and the compiler cannot substitute it. Slice 7 separately binds
the Workflow's immutable installed Execution Profile. The Runtime then
cross-checks package and Manifest against the exact Goal, resulting
Workflow/Attempt, phase policy, Candidate, Execution Profile, Policy bindings,
authority labels, and entry projection before the Store commits them with
Attempt start. Dispatch consumes an immutable version-fenced claim bound to the
same profile; Worker event receipts use an identity domain separate from
application commands. See
[ADR 0014](docs/adr/0014-context-bound-worker-dispatch-and-event-admission.md)
and [ADR 0021](docs/adr/0021-m1-execution-profile-and-cli-composition.md) plus
[ADR 0022](docs/adr/0022-immutable-workflow-policy-binding.md).

M1 does not yet have a durable resolver for selected Fact, Human Decision, or
project-source authority. Those selected entries and all omission decisions
therefore remain closed under
[ADR 0015](docs/adr/0015-close-m1-worker-authority-causality.md). Slice 5 opens
only one additional source class: an `IMPLEMENT` package binds the exact active
`MUTABLE` Candidate generation and its `baseDigest`, resolved through Candidate
authority and independently rechecked by Runtime and Store. `DISCOVERY` and
`PLAN` remain Candidate-free, and source freeze or verification uses its own
port instead of a coding-Worker prompt. See
[ADR 0016](docs/adr/0016-candidate-and-evidence-authority-boundary.md).

### Candidate Manager

Creates isolated candidate generations, records their base identity, manages
write/read-only lifecycle, computes freeze digests, detects mutation, and
invalidates dependent evidence.

The worker never edits the authoritative control store and should not edit the
user's source checkout directly in the governed path.

The current M1 adapter is logical and deterministic: it proves generation,
freeze, and invalidation authority but does not create a filesystem-isolated
workspace or edit a real project. Concrete isolation remains M2 work.

### Evidence Store

Stores immutable, typed observations and their content-addressed payloads. It
tracks provenance, candidate binding, policy/check identity, redaction, and
invalidation.

The current M1 runner reports only a closed result status. Request-aware
Runtime admission derives the producer and check binding from the validated
request, constructs the normalized fake observation, and uses its
Runtime-computed digest as the fake payload reference. Unknown fields and raw
adapter exceptions are rejected without becoming authority. A
CodeClosure-owned content-addressed blob store is required before larger real
runner payloads are admitted.

### Acceptance Engine

Evaluates a versioned Policy Bundle against one `AcceptanceInputManifest`. It
returns a deterministic decision and rule-by-rule trace. It has read-only
access to candidate and evidence data and no worker or source-edit capability.

### Human Decision Gateway

Captures only the allowed human-input classes and binds each response to exact
scope. It does not offer a generic "ignore failed gate" control.

### Worker Adapter

Converts CodeClosure worker requests into backend protocol actions and maps
backend events into typed observations. The core domain never imports
backend-specific Thread, Turn, Item, approval, or sandbox types.

M2 initially targets Codex App Server v2 over stdio. The adapter records the
Codex version and uses schemas generated for that installed version.

### Verification Runner

Executes exact check specifications with bounded argv, cwd, environment,
timeout, output limits, and cleanup rules. It is separated from the coding
worker so verification policy is not merely another prompt instruction.

## Authority and Storage Topology

```text
Platform application data (CodeClosure-owned)
  state.sqlite          authoritative current state
  audit/                append-only exported audit segments
  evidence/             immutable evidence payloads
  policies/             installed/versioned policy bundles
  profiles/             installed/versioned execution profiles
  workspaces/           managed candidate generations

Target source repository
  project code          observed base source
  .codeclosure/         optional versioned project declaration only

Candidate workspace
  project code          worker-writable only during IMPLEMENT
  run-owned outputs     bounded and phase-specific
```

The Slice 7 application MUST resolve a platform data home: macOS uses
`$HOME/Library/Application Support/CodeClosure`, Linux uses
`${XDG_DATA_HOME:-$HOME/.local/share}/codeclosure`, and Windows uses
`%LOCALAPPDATA%\CodeClosure`. An absolute `CODECLOSURE_HOME` is an optional
operator/test override, not a required environment variable. The resolved home
must not be the target repository, be nested beneath it, or be inside a
worker-writable candidate. Tests and proof demos inject isolated temporary
homes. See
[ADR 0021](docs/adr/0021-m1-execution-profile-and-cli-composition.md).

## State Persistence Model

M1 uses two complementary representations:

1. normalized current-state tables for direct, validated reads;
2. append-only audit events written in the same transaction as state changes.

This is not full event sourcing. Current state remains the operational source
of truth; the event log provides traceability, replay checks, and recovery
diagnostics. Every aggregate carries a monotonically increasing version for
optimistic concurrency control.

Versions provide strict mutation order. Control timestamps preserve causal
order but are not a concurrency mechanism: the Runtime validates its injected
clock and clamps a valid rollback to the current aggregate timestamp, while
domain event application, the Store, and SQLite reject a bypassed older event.
Equal timestamps are valid because versions and audit sequence numbers remain
strict. See [ADR 0012](docs/adr/0012-causal-control-timestamps.md).

Expected version and command-identity conflicts are explicit store-port result
variants. Adapter-specific exception class names are not part of the Runtime
contract. External Worker, Candidate Source, and Verification Runner failures
cross the M1 authority boundary only as closed Runtime-owned reason codes; raw
exception text is not persisted. On a version conflict, the Runtime reloads and
reevaluates an admitted command before deciding whether to persist a rejection.

Every processed-command row stores a schema-versioned outcome envelope authored
by the Store inside the command transaction. Envelope version 3 distinguishes
`APPLIED` from `REJECTED` and binds the `CommandId`, exact aggregate target,
owning `GoalId`, owning `WorkflowId`, observed Workflow version/phase/run
status, and public command output. An applied output is derived from and must
exactly match the resulting Workflow; a rejected output is derived from a typed
deterministic-command error and the observed Workflow. Infrastructure and
replay-integrity errors cannot enter this rejection history. Commit ports do
not accept caller-authored outcome envelopes.

Replay validates the canonical input digest and all authority bindings before
returning the output. Both Goal- and Workflow-targeted replay reload the real
owning records; target-string equality is not existence proof. Migration 0005
fails closed for outcomes without identity binding. Migration 0006 likewise
fails closed for existing version 2 outcomes because their historical
transaction semantics cannot be reconstructed safely.

Authority-bearing JSON identities use the named, schema-versioned canonical
projections in
[ADR 0006](docs/adr/0006-canonical-serialization-and-digest-profiles.md).
Generated record IDs and timestamps are not silently mixed into semantic replay
identity.

Authority validation is closed across Runtime and persistence. TypeScript
brands and port annotations are not runtime proof. Each authority-bearing
record passes one owning codec when it enters a control boundary, before a
Store writes it, and when persistence materializes it again. A Store may return
`APPLIED` only for records that remain decodable immediately and after reopen.
Normal command admission and replay share one Goal/Workflow authority resolver;
they do not maintain different relationship rules. SQLite mirrors critical
codec rules as defense in depth, and strengthening migrations fail closed for
retained rows that cannot prove the new contract. See
[ADR 0013](docs/adr/0013-authority-boundary-validation-closure.md).

SQLite authority guards express validity as a positive predicate and treat SQL
`NULL`/unknown as invalid. A later migration that replaces or extends a guard
must preserve the complete earlier contract rather than validating only its new
fields.

Policy installation follows the same closure. The Runtime accepts a definition
without caller-authored identity, computes its canonical digest, and assigns
installation time and audit identity. The Store independently recomputes the
digest. The Policy row and installation audit commit or roll back together;
startup rechecks retained Policy content, and migration 0010 refuses unaudited
Policy authority. After migrations, every Store startup also rederives retained
M1 Context identity from its authoritative sources and validates dispatch
claims, terminal Attempt time, and every Worker receipt's causal link to its
claim. SQLite triggers protect normal writes; startup checks detect authority
data changed while the Store was offline.

Installation does not select a Policy for a Workflow. The first successful
Start atomically records a separate immutable Workflow Policy binding. Runtime,
Store, recovery, driver, Context, Evidence, Acceptance, repair, and closeout
must resolve that exact ID and digest; an incompatible process fails before
continuation. See
[ADR 0022](docs/adr/0022-immutable-workflow-policy-binding.md).

Retained Evidence Sets use their unique recording audit sequence as a temporal
cut. Startup reconstructs which Evidence and eligibility version existed at
that cut and rebuilds the canonical set. Later invalidation preserves that
historical record but makes it unusable as current acceptance input. See
[ADR 0017](docs/adr/0017-derive-boundary-authority-and-replay-evidence-by-audit-sequence.md).

## Capability Enforcement

The Workflow Runtime derives a capability grant from phase and policy. The
grant is enforced at multiple layers:

1. do not expose disallowed runtime operations to the caller;
2. configure worker sandbox/cwd/permissions as narrowly as the backend permits;
3. isolate authoritative state from worker filesystem access;
4. recompute candidate identity and reject any prohibited mutation;
5. fail acceptance when enforcement or observation is incomplete.

Backend sandboxing is defense in depth, not the only completion boundary.

## Codex Integration Boundary

Codex App Server exposes Thread, Turn, and Item primitives plus per-thread and
per-turn cwd, approval, sandbox, and context controls. CodeClosure maps them as
execution details:

| Codex concept | CodeClosure interpretation |
| --- | --- |
| thread-scoped goal or plan | Disposable execution guidance; never a CodeClosure Goal or transition authority |
| Thread | Disposable worker session linked to a Goal/phase attempt |
| Turn | One bounded worker invocation |
| Item | Streamed observation or proposed side effect |
| `turn/completed` | Worker invocation ended; not Goal completion |
| `thread/compact/start` | Worker-history maintenance; not authority compaction |
| approval request | Backend effect request routed through current capability policy |
| sandbox/cwd | Defense-in-depth enforcement for the current phase |

Codex compaction replaces model history with a compacted representation and
re-injects selected initial context. Therefore no CodeClosure authority may
exist only inside Codex history.

Application `CommandId` values and worker-delivery `WorkerEventId` values are
also separate authority domains. The Codex adapter may report a worker event;
it cannot choose or impersonate the runtime command that admits that event.
See [ADR 0009](docs/adr/0009-command-idempotency-and-worker-boundary.md).
The concrete M1 Context binding, durable dispatch claim, cancellation ordering,
and Worker receipt transaction are specified by
[ADR 0014](docs/adr/0014-context-bound-worker-dispatch-and-event-admission.md).
The M1 source closure, Policy installation authority, receipt causality, and
stream termination rules are specified by
[ADR 0015](docs/adr/0015-close-m1-worker-authority-causality.md).
Workflow-lifetime Policy selection is specified separately by
[ADR 0022](docs/adr/0022-immutable-workflow-policy-binding.md).

## Dependency Direction

The initial code should follow ports-and-adapters boundaries without creating
unnecessary packages:

```text
CLI
  -> Application Runtime
      -> Domain + Ports
      -> Store Port
      -> Worker Port
      -> Clock / ID / Digest Ports

Adapters
  -> implement Domain/Application ports
```

Planned M1 workspace:

```text
apps/cli
packages/domain
packages/runtime
packages/store-sqlite
packages/testing
```

The following are possible later package splits, introduced only when their
internal M1 modules have enough independent responsibility to justify a public
package boundary:

```text
packages/context-compiler
packages/evidence
packages/acceptance
packages/workspace
packages/adapter-codex
```

M1 keeps its minimal Context Manifest, Evidence, and Acceptance behavior inside
`domain` and `runtime`. Slice 6 implements that control without introducing a
separate package or a worker-facing completion path.

Codex protocol DTOs must remain inside `adapter-codex`.

## Failure and Recovery Model

Failures are classified rather than collapsed into a generic retry:

- validation failure;
- illegal or stale transition;
- guard or policy evaluation failure;
- control-store persistence failure;
- worker protocol failure;
- worker process failure;
- candidate integrity failure;
- verification failure;
- evidence identity failure;
- acceptance policy rejection;
- missing business or external decision;
- retry exhaustion;
- runtime internal error.

Only failures raised while invoking the control-store port are persistence
failures. Evaluator exceptions and malformed evaluator returns are validated
inside one strict runtime boundary and remain evaluation failures. Runtime
computation/invariant failures retain their own error category, and none of
these infrastructure failures is recorded as a deterministic domain-command
outcome.

Worker stream termination is also explicit. An empty or invalid-delivery-only
M1 stream records non-retryable `PROTOCOL_ERROR`; an uncancelled iterator or
process throw records `ABRUPT_TERMINATION` and requires reconciliation.
Recording either failure first reloads and exactly binds the durable dispatch
claim. Its `claimedAt` is the causal floor for every later Worker result,
failure, cancellation, or restart reconciliation. A successful cancellation
remains interruption. Worker non-admission results distinguish untrusted
delivery from control-plane failure, so a Store or Runtime failure is never
relabelled as a Worker protocol defect simply because no event committed.

The implemented Slice 7 startup sequence:

1. lets trusted composition activate and migrate the control Store through the
   verified isolation bootstrap;
2. installs or exactly matches the built-in M1 Policy and eight named Execution
   Profiles;
3. invokes Runtime startup recovery before publishing the application facade;
4. uses a narrow recovery catalog to detect non-terminal Goals and incomplete
   Attempts;
5. treats every retained dispatch claim as consumed history, never redispatch
   permission;
6. inspects Candidate, base, and project identity through the closed
   `RecoveryInspector` port;
7. atomically interrupts unverifiable in-flight work, advances the Workflow,
   persists an exact `RecoveryReconciliationRecord`, audits the decision, and
   leaves startup-recovered work `BLOCKED`;
8. lets an explicit `ResumeGoal` persist a fresh safe-or-blocked reconciliation
   before any replacement Attempt; and
9. creates fresh Context, Worker Session, and dispatch authority only after a
   safe resume commit.

Recovery and the deterministic Workflow driver belong to the Runtime
application boundary. The CLI never chooses a safe phase, and an execution
profile bound at first start cannot be replaced during resume. Status and audit
views explain the resulting authority but cannot resume it. See
[ADR 0020](docs/adr/0020-runtime-application-recovery-and-query-boundary.md).

Trusted composition activates the Store through the verified isolation
bootstrap in
[ADR 0023](docs/adr/0023-verified-sqlite-authority-activation.md). That
bootstrap holds one unactivated SQLite handle across retained-project
inspection, filesystem isolation verification, migration, post-migration
authority validation, and exact binding comparison. Only after activation does
composition invoke startup recovery, and recovery completes before any handler
capability is published.

## Initial Deployment Model

The initial product is a single local process for one user. It may spawn
bounded child processes for workers and verification. Multi-user auth,
distributed scheduling, remote workers, and cloud state are out of scope until
the local authority model is proven.

## Forking Policy

CodeClosure begins outside Codex. A Codex fork is considered only if a proven
runtime requirement cannot be enforced or observed through the supported App
Server and host isolation boundaries. Convenience, UI reuse, or a desire to
change Codex compaction is not sufficient justification by itself.
