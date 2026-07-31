# M2 Codex Vertical Slice Implementation Plan

- Status: In progress; Slices 0 through 2 are implemented and Slice 3 has not started
- Plan date: 2026-07-30
- Milestone: M2
- Real worker boundary: Codex App Server v2 over local stdio
- Regression baseline: completed M1 deterministic control plane
- Goal Intake: explicitly excluded until M2.5
- Milestone assessment: [M2 acceptance plan](m2-acceptance-plan.md)

This file is the detailed implementation-status source for M2. The
[milestone document](../milestones.md#m2--codex-vertical-slice) owns the bounded
milestone promise; this plan sequences work and records its evidence without
weakening that boundary.

## 1. Outcome

M2 will replace `FakeWorker` for an explicitly selected real execution path with a
Codex App Server Worker Adapter while retaining CodeClosure as the only control
and technical-completion authority.

The milestone must prove two complementary paths. A deterministic controlled
Worker or App Server fixture must exercise a real isolated Candidate and real
Verification Runner through fail, rejection, repair generation, fresh pass,
Acceptance, and closeout. A separate bounded live Codex path must prove actual
App Server editing and independent verification. The live path follows its real
first post-edit result: a correct first pass proceeds normally, while a failure
enters the governed repair path. M2 must not manufacture a live failure merely
to demonstrate rejection.

M2 does not prove Goal Intake, product completion, production readiness, or
permission to merge, release, deploy, communicate, purchase, or otherwise
change an external real-world state.

### User-visible behavior

From the user's point of view, M2 should behave plainly:

- Codex works in a disposable Candidate, so the user's project is not edited in
  place.
- Within one bounded Codex invocation, the App Server keeps the tool loop on one
  controlled Thread so useful working state is not discarded between actions.
- If that Thread is compacted or lost, CodeClosure retains its authoritative
  state and follows the exact recovery policy or stops visibly; the user is
  never asked to trust model memory as the recovery record.
- CodeClosure runs the required check itself; a Codex claim that the work is
  complete is never enough.
- If the first checked result passes, the run proceeds directly to Acceptance
  and closeout. The system does not create a fake failure or an unnecessary
  repair round.
- If the check fails, the failed generation is preserved, the reason remains
  visible, and repair happens only in a new Candidate generation.
- If effective configuration, instructions, tools, workspace identity, or
  backend state cannot be verified, the run stops visibly instead of silently
  inheriting ambient machine behavior.
- Passing M2 still does not create a natural-language Goal Intake flow; that
  remains the separate M2.5 milestone.

## 2. Current slice status

| Slice | Scope | Status | Evidence source |
| --- | --- | --- | --- |
| 0 | authority and protocol decision closure | Implemented | [Slice 0 decision-closure review](../reviews/m2-slice0-decision-closure.md), accepted ADRs, focused probes |
| 1 | version-bound App Server client | Implemented | [Slice 1 App Server client review](../reviews/m2-slice1-app-server-client.md), pinned snapshot, offline fixtures, and bounded live preflight |
| 2 | Goal-bound Codex Worker Adapter | Implemented | [Slice 2 review](../reviews/m2-slice2-codex-worker-adapter.md), adapter contract and phase-mapping tests |
| 3 | real isolated Candidate workspace | Not started | containment, freeze, drift, and recovery tests |
| 4 | real Verification Runner | Not started | runner, Evidence, mutation, and limit tests |
| 5 | reject, repair, and accept orchestration | Not started | Runtime integration and adversarial tests |
| 6 | Thread, Compact, interruption, and restart policy | Not started | recovery and protocol-lifecycle tests |
| 7 | trusted composition, CLI, and live demonstration | Not started | subprocess and bounded live proof |
| 8 | milestone audit and acceptance harness | Not started | M2 acceptance run and dated review |

A slice may be marked implemented only in the same change that records its
exact source identity, focused commands, zero-skip results, documentation
review, and remaining limitations. A passing unit test by itself is not slice
completion.

## 3. Governing authority

M2 inherits every accepted M1 authority rule. In particular:

- only the Workflow Runtime mutates Workflow state;
- only the Acceptance Engine issues technical `ACCEPT` decisions;
- Codex Thread, Turn, Item, plan, text, command result, file-change report,
  process exit, and `turn/completed` state are untrusted execution input;
- every Worker event remains bound to the current Attempt, Worker Session,
  Context Manifest, package digest, Execution Profile, Policy, and durable
  dispatch claim;
- control state and audit remain outside every worker-writable Candidate;
- a frozen Candidate is never repaired in place;
- verification is independent of Worker claims and read-only with respect to
  frozen source;
- state and audit effects remain atomic and replay-safe; and
- no adapter or CLI view becomes another Goal, Workflow, Acceptance, or
  external-effect authority.

The primary accepted decisions for this milestone are
[ADR 0002](../adr/0002-host-runtime-and-codex-adapter.md),
[ADR 0005](../adr/0005-isolated-candidate-generations.md),
[ADR 0009](../adr/0009-command-idempotency-and-worker-boundary.md),
[ADR 0014](../adr/0014-context-bound-worker-dispatch-and-event-admission.md),
[ADR 0015](../adr/0015-close-m1-worker-authority-causality.md),
[ADR 0016](../adr/0016-candidate-and-evidence-authority-boundary.md),
[ADR 0018](../adr/0018-deterministic-acceptance-and-closeout-authority.md),
[ADR 0020](../adr/0020-runtime-application-recovery-and-query-boundary.md),
[ADR 0022](../adr/0022-immutable-workflow-policy-binding.md),
[ADR 0024](../adr/0024-stop-m1-transient-failure-without-retry-authority.md),
[ADR 0025](../adr/0025-separate-worker-event-idempotency-from-current-dispatch-termination.md),
and
[ADR 0027](../adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md).
Slice 0 additionally accepts
[ADR 0028](../adr/0028-runtime-owned-external-execution-and-codex-profile.md),
[ADR 0029](../adr/0029-controlled-copy-candidate-workspaces.md), and
[ADR 0030](../adr/0030-real-local-verification-contract.md) for the M2-only
external execution, Candidate workspace, and real-verification boundaries.

If M2 needs to change a durable decision in those records, implementation must
stop and a superseding or additional ADR must be accepted first.

## 4. Entry conditions

M2 implementation MUST NOT begin until all of the following are true:

1. the bounded M1 completion review remains `PASS` as historical evidence;
2. the current tree passes the complete M1 regression quality gate;
3. this implementation plan and the independent M2 acceptance plan are
   committed and linked from the repository status sources;
4. the exact implementation source identity and working-tree state are
   captured;
5. the local Codex launcher and delegated platform executable identities,
   version, authentication readiness, and schema-generation commands are
   captured without recording credentials;
6. the selected live acceptance fixture is disposable and contains no user
   work or secrets; and
7. no unresolved higher-authority conflict is being waived.

The 2026-07-30 planning preflight observed `codex-cli 0.145.0` and local
`codex app-server generate-ts` plus `generate-json-schema` commands. That is an
environment observation, not the supported M2 version claim. Slice 1 must
recapture and bind the exact version used by the implementation and acceptance
run.

The Slice 0 execution preflight on the same date resolved `codex-cli 0.146.0`,
launcher digest
`sha256:134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477`,
and delegated executable digest
`sha256:ae1d3ffe6d48aec6a4dc3f50e7eb8e0d11962485a6a9406c5a7012139383da02`.
These are Slice 0 observations. Slice 1 still owns the checked-in supported
profile and must fail closed if its execution environment differs.

## 5. Fixed M2 scope

The bounded implementation includes:

- a lower-level local App Server process/protocol client;
- a separate Goal-bound Codex Worker Adapter implementing the existing
  `WorkerPort` contract;
- an exact installed-version and canonically comparable generated-schema
  binding;
- a controlled App Server configuration, state, instruction-source, and tool
  exposure profile;
- stable App Server initialization, request/response correlation,
  server-initiated request handling, and streamed lifecycle handling;
- explicitly selected Worker-backed phases, including the real `IMPLEMENT`
  path required by the demonstration;
- a concrete real Candidate isolation mechanism;
- exact base, mutable-generation, freeze, parent-generation, and drift
  identities;
- one local command Verification Runner path with closed specifications;
- independent Evidence creation and deterministic Acceptance replay;
- one deterministic repair generation after failed required verification;
- interruption, process failure, Compact, Thread start/resume, and restart
  behavior, including an observable working-continuity policy; and
- a basic local CLI/composition path and a repeatable acceptance harness.

The exact set of Codex-backed phases must be named in the installed M2
Execution Profile. M2 acceptance requires `IMPLEMENT`; no documentation or UI
may imply Codex backs a phase not named in that profile and tested.

## 6. Explicit non-scope

M2 MUST NOT add or claim:

- Raw Request revision, Intent Analysis, Intent Projection, Source Binding,
  Material Ambiguity, Intent Admission, automatic Goal Materialization,
  Intake-authorized Start, or another Goal Intake user flow;
- any change to the accepted direct `CreateGoal` command;
- full Fact Graph traversal, broad business discovery, or execution-time Goal
  revision;
- worker-authored Facts, Evidence, Acceptance, Workflow transitions, or
  recovery decisions;
- a CodeClosure-owned private-reasoning store, custom model-history compactor,
  or semantic parser/editor for opaque compaction state;
- a statistical claim that one Thread/compaction policy improves model quality,
  cost, or task success across arbitrary projects;
- automatic transient retry or undisclosed model/Thread replay;
- an interactive approval path that can exceed the current Runtime capability
  grant;
- rich TUI, multiple agents, cloud or multi-user orchestration;
- implicit Candidate cleanup that could delete an unresolved or non-owned
  path; or
- merge, commit to the user's branch, push, release, deployment, or another
  post-closeout Promotion effect.

## 7. Target dependency and package boundary

M2 will introduce concrete packages only where real boundaries now exist. The
planned dependency shape is:

```text
packages/codex-app-server-client
  -> Node process/stream primitives + generated protocol schema only

packages/adapter-codex
  -> codex-app-server-client
  -> public Runtime Worker contracts

packages/workspace-local
  -> public Runtime Candidate Source contracts

packages/verification-local
  -> public Runtime Verification Runner contracts

apps/cli trusted composition
  -> Runtime + SQLite Store
  -> Codex Worker Adapter
  -> local workspace and verification adapters
```

The lower-level client MUST NOT import `@codeclosure/domain`,
`@codeclosure/runtime`, `@codeclosure/store-sqlite`, WorkerPort, Workflow,
Candidate, Evidence, Acceptance, Intake, or CLI contracts. It owns process,
transport, initialization, generated protocol DTOs, request correlation,
server requests, notification delivery, interruption, and shutdown only.

The Codex Worker Adapter may import the public Worker contracts it implements
and the lower client. It MUST NOT import the SQLite Store, Runtime internal
kernel, Goal Manager, Acceptance Engine, Candidate writer, or future Intake
contracts. Workspace and verification adapters similarly receive only their
narrow ports and no Store mutation capability.

The dependency audit and reverse fixtures must encode this graph before a new
package is trusted by composition. A package name may change during Slice 0,
but the separation above may not.

## 8. Protocol source and version policy

The checked-in protocol source is generated from one exact installed Codex
binary, not copied from memory, a transcript, or hand-authored examples. The
current [official App Server documentation](https://learn.chatgpt.com/docs/app-server.md)
describes stdio as newline-delimited JSON, a required `initialize` then
`initialized` handshake, generated version-specific TypeScript/JSON schemas,
Thread/Turn/Item lifecycles, server-initiated approval requests, interruption,
and streamed notifications. The generated output for the selected binary is
the implementation's exact wire-shape source.

Slice 1 must add a deterministic generation/check command that:

1. resolves the exact `codex` executable without shell alias inference;
2. records its normalized launcher path, `codex --version`, launcher SHA-256,
   and delegated platform-executable path/digest when the launcher uses one;
3. generates TypeScript bindings and JSON Schema into unique temporary
   directories at least twice for the generator-stability check;
4. compares the TypeScript file set and raw file bytes exactly;
5. validates every JSON file, rejects duplicate object keys, and canonicalizes
   it as UTF-8 with the exact RFC 8785 JSON Canonicalization Scheme under the
   versioned `codex-schema-snapshot-v1` profile;
6. compares the JSON file set and canonical bytes exactly while preserving
   parsed scalar values and array order;
7. records a manifest of raw TypeScript digests, canonical JSON digests, the
   normalization-profile identity, and the aggregate snapshot digest; and
8. fails when the binary, generated semantic content, file set, required stable
   methods, or checked compatibility fixture differs.

`codex-schema-snapshot-v1` uses exact RFC 8785 canonical JSON bytes as required
by [ADR 0006](../adr/0006-canonical-serialization-and-digest-profiles.md). It
removes no field, changes no parsed scalar value, reorders no array, and does
not normalize TypeScript. Raw aggregate JSON bundle bytes are diagnostic rather
than identity because the 2026-07-30 review observed the same `codex-cli
0.145.0` emit semantically equal aggregate bundles with different
definition-member order. A raw-order difference with identical RFC 8785 bytes
is not protocol drift; any canonical content difference is.

M2 will use the stable protocol surface. Experimental API capability is disabled
unless a focused accepted ADR identifies a required method, risk, fallback,
and compatibility test. Unknown fields may be retained for diagnostics only;
unknown required shapes, methods, request types, or incompatible variants fail
closed.

The supported-version declaration binds one exact CLI version, normalization
profile, and canonical schema-snapshot digest. A different installed version is
`BLOCKED` until its generated diff is reviewed and the compatibility declaration
is deliberately updated.

## 9. App Server client contract

The lower client owns no CodeClosure semantics. Its minimum contract must
cover:

- spawn and supervise one local stdio App Server process with explicit argv,
  cwd, environment allowlist, and inherited credential handling that never
  enters logs;
- parse bounded JSON lines from stdout and keep stderr as diagnostics rather
  than protocol input;
- send one `initialize` request and `initialized` notification per connection
  before any other request;
- allocate client request IDs and correlate exactly one result or error;
- surface notifications and server-initiated requests through typed protocol
  events;
- bound line size, collection size, pending requests, buffered bytes, and
  shutdown time;
- reject malformed JSON, duplicate response IDs, mismatched response shapes,
  unexpected EOF, pre-initialization traffic, and unsupported server requests;
- distinguish requested interruption, protocol failure, backend failure,
  process exit, and host cancellation; and
- drain or reject every pending request deterministically during shutdown.

### Controlled configuration, instructions, tools, and state

Codex configuration and state are execution inputs. The
[official configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic.md#configuration-precedence)
allows command overrides, project configuration, profile files, user
configuration, system configuration, and built-in defaults. `CODEX_HOME` also
contains configuration, authentication, logs, sessions, skills, and other state.
M2 therefore cannot treat the operator's ambient Codex installation as the
Workflow's effective Execution Profile.

[ADR 0028](../adr/0028-runtime-owned-external-execution-and-codex-profile.md)
selects the versioned, protocol-neutral execution-config contract. Its
non-secret canonical projection binds at least:

- resolved Codex launcher and delegated executable identity;
- protocol and schema-snapshot profile;
- requested model, provider policy, reasoning effort, and response-schema
  profile;
- cwd, sandbox or permission profile, writable roots, command-network policy,
  approval policy, and approval reviewer;
- Thread start/resume and working-continuity policy, fresh-Thread boundaries,
  resume-failure behavior, controlled Codex state-root identity, and state
  retention policy;
- automatic/manual compaction policy, any explicitly configured threshold, and
  whether a compaction-prompt override is disabled or bound by exact identity;
- project-instruction and other instruction-source policy;
- Web Search, MCP, apps/connectors, plugins, hooks, skills, subagent, dynamic
  tool, telemetry, and history/retention policy; and
- effective managed-requirements identity, environment allowlist, and the
  redacted non-secret configuration digest.

Trusted composition uses isolated state/config roots, strict config, an exact
custom permission profile, and explicit supported overrides so ambient user or
project configuration cannot widen the binding. M2 defaults disable every tool,
integration, hook, telemetry exporter, or network surface not required for the
bounded model-service and authentication traffic of the live proof. Managed
requirements are resolved before profile binding and may constrain the profile
that can be installed. An incompatible requirement, or a requirements-identity
change after binding, blocks execution. If the selected stable App Server
surface cannot prove the required isolation, M2 stops for an ADR,
supported-version change, or outer-sandbox decision rather than inheriting a
default.

Credentials are injected separately from the canonical profile. They must be
available to the App Server only as required for authentication and excluded
from Candidate command environments, logs, audit, Evidence, and reports. Codex
session state required for an authorized resume must live in a controlled root
with explicit ownership and retention; other ambient history cannot be resumed.

`thread/start`, `thread/resume`, and `thread/fork` report effective
`instructionSources`. The adapter must compare those sources and their permitted
content identities with the Runtime binding before starting a Turn. Every
effective instruction or tool source is either disabled or exactly bound;
unknown, changed, or additional input fails closed. Adversarial fixtures must
poison user and project config, instructions, hooks, skills, MCP, plugins, apps,
Web Search, provider defaults, and environment secrets to prove that none can
silently enter or widen the M2 execution.

### Working continuity and compaction policy

Slice 0 must close this policy through observable App Server behavior rather
than a claim that private reasoning was retained. Its capability record must
classify, from the pinned generated schema and focused probes:

- Thread creation and exact-ID resume;
- one Turn's model/tool-call lifecycle on the same Thread;
- manual `thread/compact/start` support;
- automatic compaction configuration and observable `contextCompaction` Item
  lifecycle;
- continuation or resume after observed compaction; and
- controlled state-root persistence and deletion behavior.

Each capability is `SUPPORTED`, `UNSUPPORTED`, or `UNKNOWN` for the selected
Codex version and protocol profile. `UNKNOWN` cannot be treated as support. The
record MUST NOT claim that private reasoning content was inspected or prove
continuity by persisting that content. Every capability selected by the
installed M2 profile must be `SUPPORTED`; optional `UNSUPPORTED` or `UNKNOWN`
capabilities remain unselected and cannot be implied by status or reports.

The baseline M2 policy is:

- one `WorkerRequest` starts one bounded Turn on one exact Thread, including
  its App Server-managed tool loop;
- a tool call, approval request, or compaction event cannot authorize a new
  Thread or worker Turn;
- any later worker Turn or `thread/resume` requires an exact Runtime directive
  and persisted binding;
- a fresh Worker Session, new repair generation, and replacement Attempt after
  restart use a fresh Thread by default;
- a phase boundary may retain or replace a Thread only as the exact installed
  Execution Profile specifies;
- automatic compaction remains App Server-managed, and manual compaction may be
  requested only when Runtime policy explicitly authorizes the selected stable
  method;
- App Server `turn/*` progress produced by authorized manual compaction is
  classified as maintenance on the same Thread, never as another Worker
  dispatch, terminal Worker result, or completion request;
- CodeClosure records bounded Thread, Turn, and `contextCompaction` lifecycle
  metadata but not raw private reasoning or opaque compaction state; and
- unsupported or lost continuity degrades only through the profile's explicit
  fail-closed or fresh-Thread path with newly compiled current Context.

CodeClosure does not implement a second compaction algorithm, edit the Codex
compaction prompt at adapter discretion, or inject a reconstructed private
reasoning chain.

The client MUST NOT retry a Turn, restart a process, answer an approval, resume
a Thread, or infer success on its own. Those actions require an adapter request
that was already authorized by Runtime policy. Hidden retry would violate the
accepted M1 failure boundary.

A deterministic fake App Server process must exercise the complete client
contract offline. Live Codex proves compatibility but does not replace
malformed, ordering, limit, cancellation, and process-failure fixtures.

## 10. Codex Worker Adapter contract

The adapter translates one current `WorkerRequest` into one bounded App Server
Thread/Turn interaction and emits only closed-schema Worker events.

For each invocation it must:

1. validate the Runtime-created Worker Request before external work;
2. derive cwd, sandbox or permissions, network, approval, model/provider,
   effort, response schema, effective configuration, instruction policy, and
   tool exposure only from the installed Execution Profile and current
   capability grant;
3. bind the exact Attempt, Worker Session, Context Manifest, package,
   Candidate workspace lease when present, execution-config digest, and
   protocol profile to the external execution observation;
4. start or resume a Thread only under the Runtime-selected Thread policy;
5. verify the effective settings and instruction sources, then start one Turn
   with the current Context Package and phase response schema;
6. treat Item and delta streams as diagnostic observations, not authoritative
   state;
7. accept a final model payload only through bounded JSON parsing and the
   phase-specific closed response codec;
8. emit one Worker result or one closed Worker failure event; and
9. make normal stream end without one valid terminal event a failure.

`turn/completed` means only that the Turn ended. It cannot issue a Worker
completion request unless the exact final structured payload independently
decodes to the permitted phase result. Free-form “done,” a passing-looking
command transcript, an agent plan, a diff event, or a model-authored
`ACCEPT` string has no additional authority.

Worker event identity remains separate from App Server request, Thread, Turn,
and Item identity. The adapter derives or allocates it through the selected
versioned identity profile, and Runtime admission still enforces the M1 exact
payload-digest and dispatch-causality rules.

## 11. Backend execution binding and recovery

M2 needs a Runtime-owned record linking one CodeClosure Worker Session to
observed App Server execution identity without making that identity
authoritative. Slice 0 must finalize its name and persistence shape. At minimum
it binds:

- Goal revision, Workflow, phase/version, Attempt, and Worker Session;
- Context Manifest and package digests;
- Execution Profile, Policy, protocol profile, and Codex binary/schema
  identity;
- execution-config, effective-instruction-source, and controlled Codex
  state-root identities;
- requested Thread, working-continuity, compaction, retention, and fallback
  policies;
- observed Thread and Turn identifiers when available;
- bounded observed compaction lifecycle and outcome metadata, never its private
  reasoning or opaque state payload;
- Candidate generation and cwd identity when present;
- lifecycle disposition and Runtime-authored timestamps; and
- causal audit sequence.

Only the Runtime may persist or change this record. The client and adapter
return observations and receive no Store capability. Missing, conflicting, or
cross-Attempt backend identity prevents admission but cannot mutate Workflow by
itself.

The current M1 `WorkerPort` exposes only a request, an `AbortSignal`, and an
untrusted event stream. Before Slice 1, Slice 0 must define a protocol-neutral
external-execution lifecycle contract that preserves that boundary while
allowing Runtime to record intent and observed process, Thread, and Turn
identities. The decision must specify every crash window, Store transaction,
duplicate observation, late event, and restart disposition. An external action
cannot occur before the applicable durable intent, and an observed identifier
cannot be trusted or resumed before Runtime admission. The adapter receives no
Store or mutation callback.

The conservative M2 Thread rules are:

- a fresh Thread is the default for a fresh Worker Session;
- one bounded Turn and its App Server-managed tool loop remain on that exact
  Thread; the adapter cannot create replacement execution mid-loop;
- `thread/resume` requires an exact Runtime-issued directive and a persisted
  binding to the same Goal revision, project, phase policy, and protocol
  profile;
- resuming history never substitutes for recompiling and sending current
  Context authority;
- an active Attempt found after CodeClosure restart is reconciled through the
  existing M1 recovery path and is never silently redispatched;
- `ResumeGoal` creates a fresh Attempt and dispatch claim; the default recovery
  profile uses a fresh Thread;
- a repair generation also uses a fresh Thread by default and receives the
  exact failing Evidence plus `priorAttemptFeedback` through current compiled
  Context;
- an unavailable, deleted, malformed, or mismatched Thread fails closed or
  falls back to fresh only when the Runtime policy explicitly authorizes that
  choice; and
- Compact or history loss cannot remove or revise CodeClosure authority.

If persistence of backend identity or any resumed-thread rule changes an
accepted recovery decision, Slice 0 must add an ADR before implementation.

## 12. Approval and effect routing

Every App Server server-initiated approval or permission request is untrusted
external input. The adapter may answer it only through a narrow Runtime-created
approval capability derived from the current phase and Execution Profile.

M2 defaults are:

- writable filesystem access is limited to the current mutable Candidate root;
- the authority home, source repository, other Candidate generations, Git
  control metadata not owned by the Candidate, and system credential paths are
  outside writable roots;
- Candidate command network access is disabled;
- session-wide grants and `acceptForSession` are prohibited;
- shell or file-change requests beyond the exact grant are declined;
- user-input, MCP elicitation, dynamic-tool, connector, and external-effect
  requests are unsupported and declined or cancelled; and
- approval text, model justification, or backend defaults cannot widen the
  grant.

Approval decisions and their exact request bindings are diagnostic/audit input,
not Human Decisions or technical Acceptance. Unknown server request types fail
closed and terminate the bounded invocation.

## 13. Real Candidate workspace

[ADR 0029](../adr/0029-controlled-copy-candidate-workspaces.md) selects a
Runtime-managed controlled copy and rejects a detached Git worktree for bounded
M2. A mechanism is eligible only if it proves all of the following:

- the user's checkout is never the Worker cwd or writable root;
- the Runtime owns every created path and can prove containment after resolving
  symlinks and platform aliases;
- authority storage is neither inside nor reachable as a writable descendant
  of the Candidate;
- base identity, parent generation, repository identity, allowed paths, and
  mutable-generation identity are exact;
- user changes, Git refs, submodules, ignored files, symlinks, special files,
  file modes, and cleanup behavior have an explicit policy;
- a repair generation derives from the last eligible Candidate without
  modifying it;
- freeze creates a versioned canonical tree manifest and digest;
- no Worker is dispatched to a frozen generation;
- pre/post-verification rehash detects drift even if filesystem permissions are
  bypassed; and
- restart can distinguish owned, retained, orphaned, and unsafe-to-delete
  paths without guessing.

The current M1 `WorkerRequest` identifies a Candidate generation but does not
carry a trusted Candidate filesystem locator; its Goal project path names the
user source checkout and must never be reused as Worker cwd. Slice 0 must define
a Runtime-issued, protocol-neutral Candidate workspace lease or equivalent
narrow resolver contract. It binds the exact generation, resolved root identity,
allowed paths, access mode, and lifecycle, can resolve only through trusted
workspace composition, and gives the adapter neither Store access nor authority
to choose another path.

Before selecting worktree or copy, the source-manifest profile must state
whether source-checkout byte identity includes Git control metadata and which
Runtime-owned metadata changes, if any, are separately permitted and audited.
The black-box source-isolation assertion must use that exact projection rather
than an undefined meaning of “byte-identical.”

Filesystem read-only flags are defense in depth, not source identity. The exact
manifest digest is the authority. Cleanup is a separate Runtime-owned command
or reconciliation action and must never use an unresolved root, broad glob, or
user repository as a deletion target.

## 14. Real Verification Runner

M2 will implement one local process runner for exact `CheckSpecification` records.
Each specification binds at least:

- checker and specification version;
- argv as a closed array with no shell interpolation;
- working directory relative to the frozen Candidate root;
- environment allowlist and relevant environment digest;
- timeout, output-byte limit, and termination policy;
- expected exit semantics;
- Candidate generation and source digest; and
- runner implementation identity.

The runner receives read-only Candidate access and no Workflow, Goal, Store,
Acceptance, Worker, or Candidate-mutation capability. It captures exit status,
bounded stdout/stderr payload or digest, start/end time, timeout/termination,
and environment identity as observations. Runtime validates those observations
and creates Evidence through the existing Evidence boundary.

The Candidate tree is rehashed immediately before and after each verification.
Any mutation, missing path, containment failure, timeout, oversized output,
runner crash, malformed observation, or specification mismatch prevents
eligible passing Evidence. Passing command output remains insufficient without
the exact Evidence and Acceptance bindings.

The M1 public contracts currently admit only logical `M1_LOGICAL` environment
identity and fake verification observations.
[ADR 0030](../adr/0030-real-local-verification-contract.md) selects additive
version-2 `LOCAL_COMMAND`, `LOCAL_COMMAND_OBSERVATION_V1`,
`LOCAL_COMMAND_ENVIRONMENT_V1`, and `LOCAL_COMMAND_TEST_RESULT` contracts plus
an atomic bounded SQLite payload store. No M2 adapter may overload an M1 fake
discriminator with real process evidence.

## 15. Trusted composition and CLI boundary

M2 will extend the trusted composition root; ordinary CLI handlers still receive
only narrow application capabilities and read views. Composition must:

- verify the SQLite authority home before constructing worker-writable paths;
- install an immutable M2 Policy and Execution Profile with an exact digest;
- resolve the supported Codex binary, canonical generated protocol profile,
  controlled execution-config profile, and Codex state root;
- construct workspace, verifier, client, and Worker adapters without exposing
  them to handlers;
- perform startup reconciliation before publishing Goal commands;
- close the App Server client and filesystem adapters on every exit path; and
- keep M1 deterministic fixtures available only for tests and explicitly named
  proof profiles.

The direct M1 Goal commands remain unchanged. M2 may add an exact profile
selection or a bounded M2 demo command, but it may not add “mark complete,” raw
Workflow mutation, generic approval, Intake, promotion, or effectful project
application commands.

Human and JSON views must identify requested/observed Codex version and model
policy, execution-config identity, effective-instruction status, current phase,
Candidate generation, verification result, Acceptance result, blocker, and
recovery state without presenting a Turn completion as Goal completion.

## 16. Slice execution plan

### Slice 0 — Authority and protocol decision closure

Entry: the conditions in Section 4 pass.

Work:

- inventory the current public Worker, Candidate, Verification, recovery,
  composition, Store, and audit contracts;
- generate the selected installed App Server schemas repeatedly and prove the
  canonical snapshot profile distinguishes semantic drift from raw JSON member
  ordering;
- spike stdio initialization, one Thread/Turn, interruption, one server
  request, and controlled process exit without changing product authority;
- build the version-bound working-continuity capability record, including
  same-Thread tool-loop, resume, automatic/manual compaction, post-compaction
  continuation, and controlled-state behavior;
- choose and adversarially probe the Codex configuration/state isolation
  mechanism, effective-instruction policy, tool-disable policy, and credential
  separation;
- choose the Candidate workspace mechanism and Runtime-issued workspace
  lease/resolver contract through containment probes;
- finalize the protocol-neutral external-execution lifecycle state machine,
  backend binding, Thread/working-continuity/compaction policy, source manifest
  projection, Git metadata treatment, and cleanup ownership;
- finalize the real Verification/CheckSpecification/Evidence contract versions
  and migration impact; and
- accept any required ADR before product code depends on the decision.

Exit proof:

- no product source imports generated protocol types yet;
- the canonical schema snapshot, controlled Codex config/state profile,
  effective-instruction policy, and poisoning-test matrix are exact;
- the Candidate lease cannot resolve the user source path, authority home, or
  another generation as Worker cwd;
- the external-execution state machine names durable intent, observed process,
  Thread, Turn, compaction, terminal/failure, crash, duplicate, and restart
  rules without a Store capability in the adapter;
- the capability record distinguishes supported, unsupported, and unknown
  continuity behavior without inspecting or persisting private reasoning;
- real verification uses selected new contract discriminators rather than M1
  fake identities;
- source-checkout byte identity and Git metadata treatment are unambiguous;
- every remaining open decision has an owner, chosen rule, test obligation, and
  ADR need;
- the selected design preserves every M1 invariant and ADR 0027's client seam;
  and
- the plan and acceptance matrix are updated if the accepted decision changes
  their concrete proof.

Current execution record on 2026-07-30:

- the M1 entry gate passed from a clean `main` worktree at
  `1aa72ee239f7ec13ecc41b3317e463b8ad9f234b`;
- repeated `codex-cli 0.146.0` generation produced 622 raw-byte-identical
  TypeScript files and 275 canonical-byte-identical JSON Schema files; only the
  raw aggregate JSON definition-member order differed;
- local containment probes rejected source, authority, sibling-generation, and
  symlink-alias cwd targets and demonstrated the detached-worktree Git metadata
  side effect;
- ADR 0028, ADR 0029, and ADR 0030 close the local decisions without adding a
  product Codex package or migration; and
- the authorized bounded live probe supports controlled same-Thread tool use,
  exact configuration/instruction admission, credential-read denial, approval
  request decline, manual Compact and continuation, exact resume after App
  Server process restart, and Turn interruption;
- automatic-compaction triggering was not forced or observed and remains
  `UNKNOWN` and unselected; and
- At Slice 0 close, Slice 1 could begin, but no Slice 1 product package or
  checked-in supported profile existed yet.

### Slice 1 — Version-bound App Server client

Entry: Slice 0 decisions are accepted.

Work:

- add the lower client package and generated protocol snapshot;
- add binary/schema identity and canonical regeneration checks;
- implement the selected controlled config/state launch contract and poisoned
  ambient-config fixtures;
- implement bounded JSONL, request correlation, initialization, notifications,
  server requests, cancellation, and shutdown;
- implement the selected stable compaction method/Item lifecycle and
  deterministic post-compaction continuation fixtures;
- implement deterministic fake-server fixtures for malformed, reordered,
  duplicate, oversized, EOF, stderr, timeout, and process-exit cases; and
- encode the closed dependency graph and reverse tests.

Exit proof:

- stable initialization and one fixture Thread/Turn pass;
- the fixture proves compaction lifecycle and later continuation without
  exposing or storing private reasoning or opaque compaction state;
- repeated generation has one stable canonical snapshot identity;
- ambient user/project config, instruction, tool, provider, history, and secret
  fixtures cannot widen the process contract;
- every pending request reaches one deterministic terminal outcome;
- unsupported or malformed protocol input fails closed;
- protocol drift is detected before a live Worker dispatch; and
- the client package compiles and tests without any CodeClosure domain,
  Runtime, Worker, Candidate, or Intake import.

Current execution record on 2026-07-31:

- the lower client package has no production dependency and imports no
  CodeClosure Domain, Runtime, Store, Worker, Candidate, Acceptance, or Intake
  package;
- the checked profile binds `codex-cli 0.146.0`, 622 raw-byte-identity
  TypeScript files, 275 RFC-8785-identity JSON Schema files, and snapshot digest
  `sha256:0b0bdf534386d796c41596693c451aabaec2526bbac5a7965ab558edc3de8e21`;
- deterministic fixtures cover the handshake, Thread/Turn, manual Compact and
  continuation, configuration/environment isolation, framing, correlation,
  server requests, cancellation, shutdown, timeout, EOF, stderr, and process
  failure; adversarial cases additionally prove null-prototype JSON own-field
  semantics, stable rejection of executable mutation or unavailability before
  spawn, separate bounds for pending manual and observed unfinished compaction
  tracking, and lifecycle slot release, with 40 of 40 client tests passing;
- the complete repository quality gate passes, including all M1 regression
  suites; and
- after explicit authorization, the bounded live preflight verified the exact
  binary/snapshot, controlled configuration, permission profile, exact
  instruction sources, poisoned-project-config exclusion, initialization,
  Thread start, one no-tool completed Turn, bounded diagnostics, and temporary
  state cleanup without retaining response or private reasoning content; and
- the [Slice 1 review](../reviews/m2-slice1-app-server-client.md) records a
  `PASS`. Slice 1 is implemented and Slice 2 may begin, but has not started.

### Slice 2 — Goal-bound Codex Worker Adapter

Entry: the client contract is green against fixtures and the selected local
binary.

Work:

- implement phase-specific prompt/response projection over current Context;
- map exact Runtime grants and the Candidate workspace lease to cwd, sandbox or
  permissions, network, and approval settings;
- map the bound model/provider, effort, response, config, instruction-source,
  tool, state-root, working-continuity, compaction, retention, and fallback
  policy and reject effective drift;
- implement Thread/Turn selection, same-Thread tool-loop enforcement, and
  bounded backend execution observations;
- validate final structured payloads and emit one bounded Worker event;
- map interruption, declined requests, backend/protocol failure, invalid-only
  streams, and no-terminal streams; and
- retain M1 Worker receipt, replay, and dispatch-causality admission unchanged.

Exit proof:

- `turn/completed`, “done,” fabricated `ACCEPT`, plan text, diff, and command
  output cannot close or advance a Goal;
- wrong Attempt, Session, Manifest, package, phase, Candidate, or backend
  binding fails closed;
- a source-project path, stale workspace lease, unexpected instruction source,
  or ambient config/tool injection fails before a Turn can acquire authority;
- duplicate and conflicting Worker events retain ADR 0025 semantics;
- an unexpected Worker Thread/Turn split, unauthorized resume, or mismatched
  compaction policy fails closed without storing hidden reasoning; and
- the adapter cannot reach the Store, internal Runtime kernel, Candidate
  mutation, Acceptance, or Intake capability.

Current execution record on 2026-07-31:

- `@codeclosure/adapter-codex` depends only on the lower client and public
  Runtime Worker contracts; production import audits reject Domain, Store,
  testing, CLI, Runtime-internal, generated-protocol-subpath, and client-testing
  access;
- one immutable digest-bound directive covers the current Worker Request,
  already-resolved full Candidate workspace lease, verified backend/config,
  permission and instruction inputs, exact fresh/resume policy, one bounded
  Turn, compaction/retention/fallback policy, and closed response mapping;
- 40 deterministic fake-server cases cover the valid path, non-authoritative
  diagnostics and false-completion claims, effective-input drift, wrong
  bindings, missing terminal completeness, split/duplicate lifecycle,
  field-level known and unknown Item rejection, prompt-bound user-message
  projection, non-secret environment drift and exact/overlapping protected-root
  rejection, unsupported integrations, approval, compaction, cancellation both
  before and after terminal parsing, process/backend failure, exact
  replay/conflict, and observation redaction with zero skips;
- the 41-case lower-client suite and the complete M1 regression baseline remain
  green; and
- the [Slice 2 review](../reviews/m2-slice2-codex-worker-adapter.md) records a
  `PASS`. Slice 2 is implemented and Slice 3 may begin, but has not started.

### Slice 3 — Real isolated Candidate workspace

Entry: the selected mechanism and source manifest profile are recorded.

Work:

- create a mutable Candidate from an exact bounded Git fixture;
- resolve and enforce project, workspace, and allowed-path containment;
- issue the selected exact workspace lease and expose only its Candidate root as
  Worker cwd/write scope;
- freeze to an immutable generation manifest and digest;
- create repair generations from exact eligible parents;
- implement owned-path retention and restart reconciliation; and
- add symlink, alias, ignored-file, mode, special-file, concurrent-change,
  partial-create, and unsafe-cleanup adversarial tests.

Exit proof:

- the source checkout and authority home remain unchanged by Worker edits;
- every Candidate mutation changes or invalidates its exact identity;
- frozen generations never regain mutable authority;
- repair creates a new generation and leaves its parent byte-identical; and
- cleanup touches only exact Runtime-owned paths and fails closed on ambiguity.

### Slice 4 — Real Verification Runner

Entry: frozen Candidate identity is available through the public Runtime port.

Work:

- implement one exact local command-check path;
- land the selected real verification contract versions, codecs, Store schema,
  and migration guards;
- bind argv, cwd, environment, timeout, output limit, runner, Candidate, and
  source identity;
- capture bounded observations and create Evidence only through Runtime;
- rehash before and after checks; and
- add failing, passing, timeout, oversized, crash, malformed, path-escape, and
  source-mutation fixtures.

Exit proof:

- a real required check can create eligible passing or failing Evidence;
- verification cannot edit frozen source or write control state;
- source drift invalidates all affected Evidence; and
- command exit or output alone cannot issue Acceptance.

### Slice 5 — Reject, repair, and accept orchestration

Entry: the controlled Worker/App Server fixture, real Candidate, and real
Verification paths pass their focused contracts.

Work:

- compose the exact M2 Policy and Execution Profile;
- drive one deterministic controlled execution through a real Candidate,
  source freeze, and required verification;
- preserve a failed Acceptance Decision and exact repair authority;
- create and dispatch a new repair generation;
- rebuild Evidence from the repaired frozen source; and
- close only through current deterministic Acceptance and Runtime closeout.

Exit proof:

- the first Worker completion claim cannot close after required verification
  fails;
- the failed frozen generation remains immutable and auditable;
- repaired Evidence binds only the new generation and digest;
- stale first-generation Evidence and Acceptance cannot close the Goal; and
- the final Closeout Record binds the exact accepted Candidate, Evidence Set,
  Policy, checker, and Acceptance Decision.

### Slice 6 — Thread, Compact, interruption, and restart

Entry: one in-process end-to-end repair loop is green.

Work:

- implement the accepted fresh/resume Thread policy;
- enforce same-Thread continuity for each bounded Turn and every App
  Server-managed tool call inside it;
- handle `contextCompaction` Items and authorized post-compaction continuation
  without authority loss or private-state persistence;
- interrupt a current Turn on governed cancellation;
- map process/backend/protocol failure without hidden retry;
- persist and reopen backend execution observations;
- reconcile an interrupted active dispatch before resume; and
- prove a fresh Attempt and current Context can continue without redispatching
  the old claim or trusting old Thread state.

Exit proof:

- the exact Execution Profile decides every fresh/resume boundary and
  compaction mode;
- one bounded Turn never creates a replacement Thread during its tool loop;
- an observed compaction can continue under the selected policy while the same
  authority snapshot remains unchanged;
- Compact, Thread deletion, process exit, and restart cannot remove or create
  Goal/Workflow/Candidate/Evidence/Acceptance authority;
- old events cannot terminate the current dispatch;
- cancellation and worker terminal events preserve the accepted ordering rule;
- recovery creates no duplicate Candidate mutation or Turn dispatch; and
- strict reopen reconstructs the same Runtime authority without transcript
  replay.

### Slice 7 — Trusted composition, CLI, and live demonstration

Entry: offline protocol, adapter, workspace, verifier, orchestration, and
recovery suites are green.

Work:

- wire the M2 adapters only in trusted composition;
- expose a bounded profile/demo selection without changing direct Goal
  creation;
- add subprocess coverage for usage, status, governed rejection, repair,
  closeout, cancellation, audit, restart, and adapter failure;
- run the exact bounded live edit/verify fixture through the installed Codex App
  Server without prescribing its first post-edit result; and
- render backend lifecycle as execution detail, never completion authority.

Exit proof:

- ordinary CLI modules cannot import or receive raw Store, client, workspace,
  verifier, or internal Runtime capabilities;
- the project fixture and authority home are isolated and reopen correctly;
- one live Codex path proves actual isolated editing, completion-request
  admission, independent verification, and the correct first-pass or repair
  branch without a fabricated failure; and
- unavailable auth, network, model, binary, or protocol compatibility produces
  a typed blocked/failure result rather than a skipped success.

### Slice 8 — Milestone audit and acceptance harness

Entry: every prior slice is implemented with recorded focused evidence.

Work:

- add the canonical `accept:m2` runner required by the acceptance plan;
- combine the full quality gate, offline adversarial suites, deterministic real
  Candidate/verifier reject-repair proof, live Codex proof, public black-box
  checks, and opening/closing source identity;
- add new canonical invariants only together with executable test metadata;
- review README, Architecture, domain status sections, ADR index, milestone
  boundary, and this status table;
- write a dated M2 completion review against the exact accepted tree; and
- run the independent M2 verdict procedure with zero skipped or unavailable
  mandatory checks.

Exit proof:

- every row of the [M2 acceptance matrix](m2-acceptance-plan.md#7-mandatory-acceptance-matrix)
  passes on one source identity;
- all M1 regression gates remain green;
- the working tree and generated protocol snapshot are stable;
- no M2 completion statement claims Goal Intake or an external effect; and
- M2 is marked complete only after the dated review records an unconditional
  `PASS`.

M2.5 implementation MUST NOT start before this slice and the independent exit
review pass.

## 17. Test strategy

M2 will use three distinct layers:

1. deterministic unit, property, Store, and fake-App-Server tests for complete
   malformed and adversarial coverage;
2. deterministic process/filesystem integration using a controlled Worker or
   App Server fixture with the real Candidate, Verification, rejection, repair,
   restart, and CLI paths; and
3. one bounded live model demonstration for actual isolated editing and
   independent verification, following either the real first-pass or governed
   repair branch.

The live run does not replace deterministic negative or repair-path tests. Model
output may vary, so acceptance must not require a deliberately incorrect first
edit. It asserts CodeClosure's persisted authority chain, exact fixture outcome,
and correct branch for the observed verification result, not a specific prose
response. A mandatory live case that cannot run is `BLOCKED`, not skipped and
not passed through a fake.

Every Node test invocation must report zero failed, cancelled, skipped, and
todo tests. Fault injection must cover every new compound Store transaction and
every external-intent/observed-result persistence boundary introduced by M2.

M2 may record non-authoritative operational observations such as Turn, model
call, tool-call, compaction, output-token, repeated-search, repair-Attempt, and
restart outcomes when the selected App Server exposes them safely. These
observations do not gate M2 on a claimed model-quality uplift. Comparative
evaluation may later contrast only supported policies, such as retained Thread
plus App Server compaction against fresh Thread plus compiled Context; direct
rolling deletion of old history is not a production M2 policy or a required
test arm.

## 18. Documentation and review contract

Every slice close reviews:

- this implementation-status table and exact slice evidence;
- the root README Status contract;
- the Architecture current-status and Codex boundary sections;
- relevant Domain, Workflow, Context, Candidate, Evidence, Acceptance, and
  recovery status sections;
- the ADR index and any decision created by the slice;
- the milestone scope and non-scope; and
- invariant headings and executable-test metadata.

Planned behavior remains explicitly planned until its code, migrations,
adversarial tests, restart proof, and documentation land together. A protocol
spike, generated schema, adapter skeleton, successful Codex Turn, passing check,
or completion report cannot independently complete a slice or M2.

## 19. Stop conditions

Stop implementation and resolve the design before proceeding if:

- domain or Runtime authority would import generated Codex protocol types;
- the lower client would need Worker, Candidate, or Intake semantics;
- the adapter would need direct Store or Workflow mutation access;
- a free-form model response would have to be trusted as a structured result;
- an approval would exceed the current phase capability grant;
- the user's checkout or authority home would become Worker-writable;
- a repair would require thawing a frozen generation;
- verification would need to trust Worker command output or edit source;
- process recovery would require replaying an old dispatch without new Runtime
  authority;
- schema drift would be ignored to keep a live demo running;
- a failed mandatory case would be labelled flaky, optional, or skipped; or
- the work begins to implement Goal Intake or an external effect.

## 20. Handoff to M2.5

M2 hands M2.5 only a proven reusable App Server client and the completed M1/M2
regression baseline. It does not hand Goal-bound WorkerPort semantics to Goal
Intake.

After M2 passes, M2.5 may add an Intake-specific adapter, package, persistence,
Intent Projection, Source Binding, Admission, Goal Materialization, and
separately authorized automatic-Start path under
[ADR 0027](../adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md).
That work must remain unable to write Workflow state directly, issue technical
Acceptance, mutate Candidates, or reuse Worker authority as intent authority.
