# ADR 0028: Make external execution Runtime-owned and Codex configuration profile-bound

- Status: Accepted
- Date: 2026-07-30

## Context

M1 persists a Worker dispatch before invoking `WorkerPort` and admits only an
exact Context-bound terminal Worker event. That closes Worker result authority,
but it does not yet describe the process, backend session, backend operation,
maintenance, or crash windows introduced by Codex App Server.

Codex configuration, state, instruction sources, tools, credentials, Thread,
Turn, and Compact behavior also span more than one protocol request. Treating
them as ambient machine behavior would let an adapter silently widen a bound
Execution Profile or make a disappeared Thread necessary for recovery.

The selected `codex-cli 0.146.0` stable schema exposes the required stdio,
Thread, Turn, interruption, resume, manual-compaction, effective-setting, and
server-request surfaces. It also exposes `turn/steer`; that method would insert
new input into an active Turn and conflicts with CodeClosure's one-request,
one-bounded-Turn rule.

## Decision

### Keep the protocol below CodeClosure semantics

M2 uses this dependency direction:

```text
codex-app-server-client
  -> generated protocol + process/stream primitives only

adapter-codex
  -> codex-app-server-client
  -> public Worker contracts only
```

The lower client MUST NOT import Domain, Runtime, Store, Worker, Candidate,
Evidence, Acceptance, CLI, or Intake contracts. Generated Codex DTOs MUST NOT
enter Domain or Runtime. The adapter MUST NOT receive a Store, transaction,
Workflow mutation callback, or Acceptance capability.

The exact supported backend declaration binds the launcher and delegated
executable paths and SHA-256 digests, CLI version, stable generated schema
snapshot, and canonicalization profile. A different binary or canonical schema
is unsupported until deliberately reviewed.

### Persist an external execution intent before the effect

M2 introduces a protocol-neutral, Runtime-owned `ExternalExecutionRecord`.
Its canonical identity binds:

- `ExternalExecutionId`, record version, and lifecycle state;
- Goal revision, Workflow/version, phase/version, Attempt, Worker Session, and
  durable dispatch-claim digest;
- Context Manifest and package digests;
- Execution Profile and Policy identities;
- backend kind and exact binary/protocol/schema/configuration identities;
- controlled backend-state root and effective-instruction manifest identities;
- Candidate workspace lease and cwd identities when the phase has a Candidate;
- requested continuity, maintenance, interruption, retention, and fallback
  policies;
- opaque bounded backend session and operation references after Runtime
  admission; and
- Runtime-authored timestamps and causal audit sequence.

The Domain names the backend values `backendSessionRef` and
`backendOperationRef`; it does not name Codex Thread or Turn protocol types.
The adapter maps Thread and Turn identifiers into those opaque observations.

The record lifecycle is:

```text
AUTHORIZED
  -> PROCESS_OBSERVED
  -> SESSION_OBSERVED
  -> OPERATION_RUNNING
  -> COMPLETED | INTERRUPTED | FAILED | ABANDONED
```

Working-context compaction is a separate, durable
`ExternalMaintenanceIntent` and observation sequence linked to the current
external execution/session. Its kind is
`WORKING_CONTEXT_COMPACTION`. It is not another Worker dispatch, Attempt,
result, Context compilation, or completion event.

The Runtime and Store MUST atomically persist `AUTHORIZED`, the ordinary M1
dispatch claim, and their audit effects before invoking the adapter. The
adapter receives an immutable directive bearing that intent digest. Every
process/session/operation/maintenance observation is untrusted, closed-schema,
digest-bound input. Runtime admission and its audit effect are one Store
transaction.

An external `COMPLETED` state means only that the selected backend operation
ended. A Worker result still requires the existing Worker event admission path,
and Goal completion still requires Evidence, Acceptance, and closeout.

### Close crash, duplicate, and late-event behavior

The recovery rules are deliberately conservative:

| Window | Required disposition |
| --- | --- |
| Store fails before `AUTHORIZED` commits | Do not spawn the external process |
| Crash after intent but before a process observation | Mark the record `ABANDONED` during M1 reconciliation; do not redispatch the old claim |
| Process starts but its observation cannot commit | Interrupt/terminate the exact owned process when possible; retain no backend authority |
| Crash with a session or operation in progress | Reconcile and fail the old Attempt; do not attach or resume it as the old dispatch |
| Terminal backend observation commits before a Worker event | Do not synthesize a Worker result from transcript or backend state; reconcile the old Attempt |
| Store fails while admitting an observation or Worker event | Do not blame Codex and do not infer success; terminate or abandon the external execution |
| Exact duplicate observation | Return the original admission outcome without another state or audit effect |
| Same observation identity with another payload | Fail as an external-observation identity conflict |
| Observation after cancellation, replacement, or terminal state | Record only the bounded ignored disposition; it cannot terminate a new dispatch |

The client launches an owned process group with a Runtime-issued launch nonce.
Stdin closure is the normal shutdown signal. On restart, CodeClosure may
terminate an apparent orphan only when PID, process start identity, executable
identity, launch nonce, and owned state root all match the persisted record.
An ambiguous process is an operator-visible blocker, not a deletion or attach
target.

### Bind configuration without binding credentials

Execution Profile schema version 2 adds an `externalExecution` definition while
retaining every M1 schema-version-1 profile unchanged. Its non-secret canonical
projection binds:

- binary, protocol, and generated-schema identities;
- model, provider, service tier, reasoning effort, and response-schema policy;
- controlled config/state roots and retention policy;
- custom permission-profile ID and canonical content digest;
- cwd and writable-root policy, command-network policy, approval policy, and
  reviewer;
- managed configuration-requirements digest;
- environment allowlist and explicit values that are safe to persist;
- instruction-source manifest and injected-instruction digests;
- Web Search, MCP, apps, plugins, hooks, skills, subagent, dynamic-tool,
  telemetry, update, and history policy; and
- fresh/resume, compaction, interruption, and fallback policy.

M2 uses a Runtime-owned `CODEX_HOME`, state root, and strict configuration.
Project configuration is untrusted. `AGENTS.md` files may be loaded only when
their exact paths and content digests are in the Candidate/source manifest and
the returned `instructionSources` list matches. Candidate-local config, hook,
plugin, MCP, app, and skill activation is prohibited in the bounded M2 profile.
Web Search, apps, MCP, hooks, plugins, skills, subagents, telemetry, update
checks, and history persistence are disabled unless a later accepted profile
explicitly binds and tests one.

Local commands use a custom least-privilege permission profile: only the exact
Candidate workspace is writable, minimal toolchain paths are readable,
credential and authority roots are unreadable, and command network is disabled.
For `codex-cli 0.146.0`, stable `thread/start` reports that profile through a
legacy `workspaceWrite`/`network=false` projection rather than returning its
name. M2 therefore MUST combine exact `config/read`,
`permissionProfile/list`, instruction-source comparison, and black-box
containment; no one response field proves the effective profile.

Authentication material is provisioned separately into the controlled host
root with owner-only permissions. It is excluded from canonical profiles,
environment projections, Candidate command environments, protocol logs,
audit, Evidence, and reports. The App Server host may read it; sandboxed Worker
commands may not.

### Make continuity explicit and optional by capability

An installed `ExternalBackendCapabilityRecord` classifies each exact
binary/schema capability as `SUPPORTED`, `UNSUPPORTED`, or `UNKNOWN`, with its
proof source. A profile may select only `SUPPORTED` capabilities.

The M2 baseline rules are:

- one Worker Request creates or resumes one exact backend session and starts
  one bounded worker operation;
- all App Server-managed tool calls for that operation remain on that session;
- `turn/steer` is never selected and any adapter use is a contract failure;
- a fresh Worker Session, repair generation, and post-restart Attempt use a
  fresh Thread by default;
- exact-ID resume is permitted only by a Runtime directive whose retained
  binding still matches Goal revision, project, phase, profile, and controlled
  state root;
- current authoritative Context is recompiled and supplied even when a Thread
  is resumed;
- manual compaction may be selected only when the exact version proves its
  maintenance lifecycle and post-compaction continuation;
- observed automatic-compaction configuration does not prove an automatic
  trigger; an unobserved trigger remains `UNKNOWN` and unselected; and
- no private reasoning or opaque compaction payload is inspected, copied,
  edited, or persisted by CodeClosure.

## Consequences

- External work gains durable causality without making a backend identifier
  authoritative.
- Crash recovery remains the M1 reconcile-then-fresh-Attempt path.
- Controlled reasoning continuity can improve Worker effectiveness, but it
  cannot become recovery or completion authority.
- The beta permission-profile surface is acceptable only behind an exact
  version/schema/config binding and black-box enforcement test; protocol drift
  blocks execution.
- Slice 1 owns the lower client and deterministic protocol fixtures. Slice 2
  owns Worker mapping. Slice 6 owns persisted restart/continuity integration.
- Goal Intake remains M2.5 and may later reuse only the lower client.

## Rejected alternatives

- **Let the adapter persist Thread/Turn state.** Rejected because it grants a
  Worker-side component Store and recovery authority.
- **Use transcript replay as recovery.** Rejected because transcript and model
  memory are not authoritative and may be stale or absent.
- **Resume any available Thread automatically.** Rejected because availability
  does not prove current Goal, Candidate, profile, or dispatch identity.
- **Use `turn/steer` for user follow-ups.** Rejected because it changes an
  active Turn outside Goal/Context admission and permits scope contamination.
- **Inherit the operator's normal Codex home.** Rejected because ambient config,
  instructions, tools, state, and history would silently enter execution.
- **Claim reasoning retention by storing reasoning Items.** Rejected because
  private reasoning is neither required proof nor CodeClosure authority.

## Validation

M2 tests MUST prove:

- no external spawn precedes durable intent and no adapter can import Store;
- every lifecycle observation has exact dispatch/profile/context causality;
- all named crash windows, duplicates, conflicts, and late events fail closed;
- stable protocol and configuration drift block execution before a live Turn;
- poisoned ambient config, instructions, tools, state, and secrets cannot widen
  the selected profile;
- the Candidate is writable while authority and credential roots are
  unreadable and command network is disabled;
- `turn/steer`, hidden retry, hidden resume, and model fallback are absent;
- manual compaction, post-compaction continuation, exact resume, and
  interruption are selected only after version-bound proof; and
- losing controlled Codex state still permits governed recovery from
  CodeClosure authority.
