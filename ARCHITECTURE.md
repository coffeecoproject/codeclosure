# CodeClosure Architecture

## Status

This document defines the M0 target architecture. M1 implements only the
deterministic domain, workflow, persistence, audit, CLI, and `FakeWorker`
vertical slice. Components marked for M2 or later are architectural boundaries,
not current implementation claims.

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
evidence summaries. It sends typed commands to the runtime. It does not write
the control database directly and does not infer successful completion from a
worker transcript.

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

### Goal Manager

Owns Goal creation, revision, activation, cancellation, and successful closure
identity. It never stores the only copy of Goal state in a worker prompt.

### Fact and Decision Store

Stores provenance-bearing facts, business scenarios, relationships, unresolved
questions, and typed human decisions. M1 implements the minimum record model;
full Fact Graph discovery and traversal is a later milestone.

### Workflow Runtime

The sole authoritative workflow-state writer. It:

- validates commands against the current state version;
- enforces the transition matrix;
- derives phase capabilities;
- persists state plus audit event atomically;
- suspends for typed blockers and decisions;
- reconciles after interruption.

### Context Compiler

Builds a phase-specific worker input from authoritative state and current
project evidence. It records a `ContextManifest` so the runtime knows exactly
which revisions and facts were presented.

The compiler is not a conversation summarizer. It may include a bounded
transcript excerpt as non-authoritative working context, but it never depends
on that excerpt for goal identity or acceptance.

### Candidate Manager

Creates isolated candidate generations, records their base identity, manages
write/read-only lifecycle, computes freeze digests, detects mutation, and
invalidates dependent evidence.

The worker never edits the authoritative control store and should not edit the
user's source checkout directly in the governed path.

### Evidence Store

Stores immutable, typed observations and their content-addressed payloads. It
tracks provenance, candidate binding, policy/check identity, redaction, and
invalidation.

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
  workspaces/           managed candidate generations

Target source repository
  project code          observed base source
  .codeclosure/         optional versioned project declaration only

Candidate workspace
  project code          worker-writable only during IMPLEMENT
  run-owned outputs     bounded and phase-specific
```

The exact platform path is resolved by the application; documentation uses
`CODECLOSURE_HOME` as a conceptual name. The runtime must not rely on a shell
environment variable being set, and it must never persist authority inside a
worker-writable candidate.

## State Persistence Model

M1 uses two complementary representations:

1. normalized current-state tables for direct, validated reads;
2. append-only audit events written in the same transaction as state changes.

This is not full event sourcing. Current state remains the operational source
of truth; the event log provides traceability, replay checks, and recovery
diagnostics. Every aggregate carries a monotonically increasing version for
optimistic concurrency control.

Authority-bearing JSON identities use the named, schema-versioned canonical
projections in
[ADR 0006](docs/adr/0006-canonical-serialization-and-digest-profiles.md).
Generated record IDs and timestamps are not silently mixed into semantic replay
identity.

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

M1 still implements its minimal Context Manifest, Evidence, and Acceptance
behavior inside `domain` and `runtime`; it does not defer those controls.

Codex protocol DTOs must remain inside `adapter-codex`.

## Failure and Recovery Model

Failures are classified rather than collapsed into a generic retry:

- validation failure;
- illegal or stale transition;
- worker protocol failure;
- worker process failure;
- candidate integrity failure;
- verification failure;
- evidence identity failure;
- acceptance policy rejection;
- missing business or external decision;
- retry exhaustion;
- runtime internal error.

On restart, the runtime:

1. opens and migrates the control store;
2. detects non-terminal goals and incomplete attempts;
3. reconciles candidate and repository identities;
4. invalidates unverifiable in-flight effects;
5. resumes from a safe phase or records a concrete blocker;
6. never treats the previous worker's absence as success.

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
