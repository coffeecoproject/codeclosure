# ADR 0043: Bind candidate-free Codex phases to exact owned read-only source snapshots

- Status: Accepted
- Date: 2026-08-06

## Context

[ADR 0015](0015-close-m1-worker-authority-causality.md) deliberately closes
project-source Context until a later accepted ADR introduces a durable owner.
[ADR 0016](0016-candidate-and-evidence-authority-boundary.md) reopens Candidate
Context only for `IMPLEMENT`; `DISCOVERY` and `PLAN` remain Candidate-free.
[ADR 0028](0028-runtime-owned-external-execution-and-codex-profile.md) permits
an external Execution Profile to select `DISCOVERY`, `PLAN`, and `IMPLEMENT`
and makes Candidate lease fields conditional on the phase having a Candidate,
but it does not itself grant project-read authority or define how that read is
bound to Context and recovery.

The current implementation reflects that gap. The trusted Codex invocation
accepts only `IMPLEMENT` with a current mutable Candidate lease. The protected
M2 demonstration delegates candidate-free `DISCOVERY` and `PLAN` to
`FakeWorker`, while its external Codex Profile selects only `IMPLEMENT`.
Copying that mixed composition into M2.5.1 would retain a test double in the
formal chain. Pointing Codex at the user source checkout without a new contract
would instead make ambient path access a substitute for phase capability,
Context identity, isolation, and source-currency authority.

M2.5.1 requires real Codex for each Worker-backed phase while preserving the
existing Workflow graph: `DISCOVERY` and `PLAN` are read-only and
Candidate-free, and Candidate/Generation authority begins only at the governed
`PLAN -> IMPLEMENT` transition.

## Decision

### Add one Runtime-owned candidate-free project-read authority

For a real external Worker Attempt in `DISCOVERY` or `PLAN`, the Runtime MUST
create one immutable, protocol-neutral `ProjectSourceReadAuthorityRecord`. Its
exact schema is versioned and canonically digested and MUST bind at least:

- record ID, Goal ID/revision, Workflow ID/version, phase, and Attempt ID;
- the exact normalized and resolved project root plus repository control-root
  identity;
- one bounded source-tree projection and one Git/source-state projection with
  exact canonical digests;
- one Runtime-allocated project-read workspace-root identity, exact snapshot
  leaf realpath, snapshot-tree digest, and external ownership-marker digest;
- the installed Workflow Policy and Execution Profile identities;
- the phase capability and response-contract digests;
- snapshot access mode `READ_ONLY`, model access to the source checkout `NONE`,
  model-usable network denial, forbidden roots, and the selected project-read
  isolation profile; and
- issue time, lifecycle `SINGLE_WORKER_ATTEMPT`, retention/cleanup policy, and
  its own canonical digest.

ADR 0016's Candidate Manager remains the Runtime-side source-observation owner.
For this candidate-free operation it uses a separate narrow
`ProjectReadWorkspacePort` whose local adapter may observe, materialize,
revalidate, and clean only the exact read snapshot. The port has no Store,
Workflow mutation, Goal mutation, Candidate-allocation, Worker-result,
Evidence, or Acceptance capability. Its output is untrusted boundary data and
is decoded at the boundary. Runtime rechecks the physical and semantic
observation against the admitted request. The Store independently recomputes
the canonical record and digest relationships plus phase and identity
constraints; it does not treat a path or digest as independent filesystem
proof.

The already-bound Goal scope selects the project. The Worker, Codex Adapter,
model output, project configuration, and dispatch caller cannot override that
root or choose the projection, snapshot leaf, access mode, forbidden roots, or
digest. The record and its audit MUST commit atomically with the phase's Context
Manifest, Attempt start, Workflow/Goal projections, and command outcome before
dispatch authority can be consumed. It is a bounded read capability for one
Attempt, not a Candidate, Candidate lease, Fact snapshot, Evidence record, or
Acceptance input.

The bounded M2.5.1 record uses the same supported source-entry selection and
path-safety rules as ADR 0029, under separately named project-read source-tree
and Git/source-state projections. Persistence MUST retain the complete decoded
projection or exact content-addressed projection payloads needed for Runtime
and Store to reconstruct the record and its digest during immediate read and
strict reopen. A composition-authored digest without reconstructible content is
not authority.

### Materialize an exact read-only snapshot rather than exposing the checkout

The model MUST NOT receive the user source checkout as cwd or as a readable
root. Trusted workspace composition allocates one new owned leaf below the
configured project-read workspace root and materializes only ADR 0029's bounded
selected source entries into it. `.git`, Git-ignored paths, unsupported or
special entries, and every path absent from the admitted projection are absent
and unreadable. Regular/executable mode and file bytes match the admitted
source-tree projection exactly.

Source-tree and Git/source-state projections are captured before and after
materialization. Any difference, copy ambiguity, snapshot-manifest mismatch,
path alias, ownership mismatch, or inability to make the leaf read-only creates
no project-read authority and no dispatch. The ownership marker is retained
outside every model-readable root. The snapshot is not a Candidate: it has no
Candidate or Generation identity, cannot become mutable, cannot be frozen into
Evidence, and cannot be selected by Acceptance.

The candidate-free external execution uses the exact snapshot leaf as cwd and
binds its root and record digest in the `ExternalExecutionRecord`. Immediately
before process dispatch, trusted composition rechecks the leaf realpath,
workspace containment, external ownership marker, complete snapshot digest,
read-only enforcement, forbidden-root separation, and exact record binding.
Source, repository control data, authority, credentials, Candidate workspaces,
sibling project-read snapshots, protected assets, and unrelated temporary roots
remain unreadable to model tools and project commands.

Before reconciliation, Runtime MUST issue one monotonically sequenced,
protocol-neutral `ProjectReadWorkspaceAuthoritySnapshot` from strict Store
authority. It lists every persisted project-read record/snapshot and active
external-execution consumer and binds the Store audit sequence and canonical
digest. The workspace port may compare exact externally owned leaves and
markers with that snapshot and return only decoded `OWNED_CURRENT`,
`OWNED_ORPHANED`, `OWNED_RETAINED`, or `UNSAFE` observations. It cannot declare
or persist cleanup authority.

An owned orphan is possible only when trusted materialization allocated the
record identity and exact leaf/marker but the atomic Context/Attempt/project-
read commit did not occur. Absence of that preallocated identity from the exact
authority snapshot is required but is not sufficient: root containment,
realpath, marker, owner, leaf identity, and absence of an active consumer must
all match. Directory age, naming convention, or a broad root scan cannot
authorize deletion.

Cleanup may remove only an exact owned terminal snapshot or an exact owned
orphan. Runtime MUST first persist and audit one immutable consume-once
`ProjectReadSnapshotCleanupGrant`. For a terminal snapshot the grant binds the
project-read record/snapshot plus terminal Attempt and external-execution
identities. For an orphan it binds the preallocated absent record identity,
exact `OWNED_ORPHANED` observation, and the authority snapshot proving absence.
Both forms bind the authority snapshot ID/digest/sequence, ownership marker,
exact leaf/root, cleanup policy, issue time, eligibility kind, and grant digest.
The workspace port receives only that grant; it cannot select a path. A closed
cleanup observation records `DELETED`, `ALREADY_ABSENT`, `RETAINED_UNSAFE`, or
`FAILED` disposition without becoming redispatch or completion authority. A
call for the exact same grant after its Outcome commits returns that retained
Outcome; reuse of the grant identity with different grant content fails closed.

The grant is consume-once authority, not a one-call filesystem assumption. Its
identity is also the cleanup operation identity. Absence of a retained outcome
means that exact grant remains `UNRESOLVED`; Runtime MUST NOT issue a replacement
grant. The workspace port MUST make exact-grant invocation idempotent across
sequential retries and simultaneous invocations from separate processes or
Store connections. It MUST keep the exact grant-bound leaf as the only cleanup
target and use a deterministic grant-derived internal operation identity plus
an atomic filesystem claim or an equivalently strong local mechanism so
competing callers join the same logical operation. No caller may return a
terminal observation while that operation can still mutate the filesystem.
Callers cannot select another leaf, delete a replacement, or turn caller
identity, process age, or directory age into cleanup authority. This
concurrency safety is an Adapter effect property, not a second Runtime grant,
Host lease, heartbeat, or time-based takeover protocol.

Any additional coordination state or artifact used by that mechanism is
Adapter-local and non-authoritative. It MUST be deterministically bound to the
exact grant ID/digest and ownership marker, remain outside the Worker-readable
snapshot leaf, stay within the exact grant-bound Runtime-owned project-read
workspace root, and remain separated from source, Candidate, authority,
credential, protected-asset, and sibling-snapshot roots. It cannot be discovered
or trusted by naming or age. While the grant remains unresolved, crash recovery
may inspect or continue that state only as internal state of the same exact
grant. If the post-effect target state cannot be stably classified as absent or
present-and-retained, or coordination finalization cannot be proven, the
workspace port MUST NOT return a terminal observation: the grant remains
`UNRESOLVED`, no replacement grant may issue, and only the same grant may
reconcile. Before a terminal observation returns no coordination state may
remain active.

Cleanup request handling is fixed before any workspace-port effect:

| Request state | Required handling |
| --- | --- |
| replacement grant requested while the original grant is unresolved or resolved | reject issuance; do not call the port and do not create another Cleanup Outcome |
| missing, caller-authored, or reconstructed grant/target, including naming- or age-based inference | reject admission; do not call the port and do not create an Outcome |
| exact resolved grant replay | return the retained Outcome; do not call the port |
| reused grant identity with different canonical content | return an identity conflict; do not call the port and do not create another Outcome |
| exact unresolved grant | this is the only state that may invoke or reconcile the one logical port operation |

The closed dispositions state only the current proven observation:

- `DELETED` means this logical operation safely completed deletion of the exact
  grant-bound leaf and observes it absent;
- `ALREADY_ABSENT` means an exact unresolved-grant invocation, including
  same-grant reconciliation, stably observes the exact target path absent
  without claiming who or what removed it;
- `RETAINED_UNSAFE` means a present replacement, alias, ambiguous target, or
  partial residual is now stably observed and the terminal invocation leaves it
  untouched from that observation onward, without claiming whether an earlier
  invocation caused its state; and
- `FAILED` means the Adapter proves the failure occurred before this logical
  operation produced any target effect and a terminal reobservation exactly
  matches the pre-effect target observation.

If that terminal reobservation instead finds the target absent, the result is
`ALREADY_ABSENT`; if it finds a stable present unsafe or partial target, the
result is `RETAINED_UNSAFE`; and if it cannot classify the target stably, the
grant remains `UNRESOLVED`. The Adapter cannot preserve an earlier observation
as though it were current.

`DELETED` and `ALREADY_ABSENT` require every additional persistent coordination
artifact to be removed. `RETAINED_UNSAFE` and `FAILED` may retain coordination
artifacts only visibly and inertly for inspection; they grant no later effect.
After the Outcome resolves, retained inert artifacts may be inspected but never
continued. A resolved Outcome therefore leaves no active cleanup coordination
capability.

If the exact owned leaf was removed but the process stopped before outcome
persistence, reinvoking the same grant returns `ALREADY_ABSENT` without
selecting or deleting another path. A stably observed present replacement,
alias, marker mismatch, partial residual, or other target-ownership ambiguity
returns `RETAINED_UNSAFE` rather than treating current state as deletion
authority or attributing its cause. A conflicting or unclassifiable internal
operation/coordination state returns no terminal observation and leaves the
same grant unresolved even when the target alone appears stable. One grant can
cause at most one logical deletion; every simultaneous or later exact-grant
invocation can only participate in that same operation, observe the exact leaf
absent, retain a present unsafe target, or leave the grant unresolved when
neither target nor coordination state can be safely classified.

Runtime strictly decodes the observation and atomically persists one immutable
`ProjectReadSnapshotCleanupOutcome`, its audit event, and the grant's resolved
consumption. That one-to-one outcome binds the grant ID/digest and closed
disposition. After it commits, replay returns the retained outcome without
calling the workspace port. Concurrent outcome commits for one exact grant
serialize at the Store boundary: one valid observation authors the retained
Outcome, and every loser discards its local observation and returns that exact
retained Outcome. A reused grant identity with different grant content remains
an identity conflict. A crash before the port call or after its external effect
but before outcome commit may reconcile only by invoking the same exact
unresolved grant; a crash after outcome commit performs no filesystem call.
Neither an unresolved grant nor `ALREADY_ABSENT` claims why a path is absent or
changes Attempt, Workflow, Evidence, Acceptance, or closeout authority.
`RETAINED_UNSAFE` and `FAILED` are resolved outcomes; neither authorizes an
automatic cleanup retry or replacement grant.

Missing or ambiguous ownership, aliasing, digest drift, an active execution, or
a stable present residual closes as `RETAINED_UNSAFE` and remains visible for
inspection. A cleanup failure proven before any target effect closes as
`FAILED` only after an exact matching terminal reobservation. Neither
disposition claims whether an earlier invocation caused the observed target
state. If the current target or coordination state cannot be stably classified,
the result remains unknown under the same unresolved grant until same-grant
reconciliation can close it. No branch can change the Attempt, Workflow,
Evidence, Acceptance, or closeout disposition.

### Reopen Context only for the exact bounded project-source entry

This decision reopens ADR 0015's project-source Context boundary only for a
real `DISCOVERY` or `PLAN` Worker Attempt under the selected M2.5.1 Profile.
The Context Package and durable Context Manifest MUST bind the exact project-
read authority ID/digest and its source/Git projection digests. Runtime and
Store independently cross-check those bindings with the Goal, Workflow,
Attempt, phase, Policy, Profile, capability, and response contract before the
Attempt and Context commit.

The Worker receives phase-specific Goal/criterion Context plus the separately
enforced read capability. Project file bytes do not become confirmed Facts
merely because the Worker can read them. Worker output remains the existing
untrusted `PROPOSALS` result for `DISCOVERY` and `PLAN`; it cannot write Context
authority, advance the Workflow, create a Candidate, or issue Acceptance.

This reopening does not authorize selected Fact, Human Decision, omission-
decision, arbitrary external-source, or pre-Goal Intake project-observation
Context. Those boundaries remain closed under their existing owners.

### Bind source currency before dispatch, after the Turn, and at Candidate creation

Trusted composition MUST reobserve the exact project root and source/Git
projections and revalidate the snapshot immediately before external process
dispatch. A mismatch terminalizes the current Attempt as
`INTEGRITY_VIOLATION` and prevents the Turn. Source projection mismatch maps
only to `PROJECT_SOURCE_DRIFT`; snapshot content or identity mismatch maps only
to `PROJECT_READ_SNAPSHOT_DRIFT`; missing, aliased, or unverifiable authority
maps only to `PROJECT_READ_AUTHORITY_INVALID`.

After the candidate-free Turn ends and before a Worker result may be admitted,
the Runtime MUST reobserve the same source projections and recompute the exact
snapshot digest. Source or snapshot drift, path replacement, aliasing, missing
authority, or unverifiable state discards the result and terminalizes the
Attempt as `INTEGRITY_VIOLATION` under the same single applicable closed reason
above. A successful Turn or plausible proposal cannot override that mismatch,
and M2.5.1 grants no automatic replacement Attempt.

The later `PLAN -> IMPLEMENT` Candidate-creation transaction MUST compare its
Candidate Source projection with the current admitted PLAN project-read
authority. If the source or Git projection changed, no Candidate or Generation
becomes current. The transition records one deterministic
`PLAN_SOURCE_NOT_CURRENT` outcome and, through the existing
`FAIL_WORKFLOW_INTEGRITY` authority, atomically moves the `PLAN / READY`
Workflow to `PLAN / FAILED`; its completed Plan Attempt remains immutable. The
existing Workflow event persists the exact enum-backed code
`PLAN_SOURCE_NOT_CURRENT` as its `reason`; the resulting Workflow persists the
same exact value as `suspendedReason`. Store write/reopen validation MUST reject
any mismatch among that event, Workflow projection, audit, and processed-
command result. The processed command remains `APPLIED` and binds the resulting
version, phase, and `FAILED` status; the Driver and public status projection use
the retained `suspendedReason` as their exact `detailCode`.

The Goal therefore projects to `BLOCKED` with
`nextSafeAction = INSPECT_BLOCKER`; it does not project a resumable recovery
catalog. The Driver
stops that drive operation and exposes the closed failure. It MUST NOT loop,
create another PLAN Attempt, rewind to DISCOVERY, reinterpret the stale Plan,
or expose `goal resume` as a continuation path. The user must create a new Goal
against the changed source. Restoring the previous bytes does not revive the
failed Workflow. Fresh replanning inside the same Goal requires later explicit
retry/rewind authority and is not introduced here. The transition MUST NOT
silently copy a source state different from the one the admitted Plan observed.

### Use phase-specific real Codex isolation and Profile semantics

The M2.5.1 formal Execution Profile MUST bind this complete phase mapping:

| Phase | External Worker mode | Required source authority |
| --- | --- | --- |
| `DISCOVERY` | real Codex, read-only | exact candidate-free project-read authority |
| `PLAN` | real Codex, read-only | exact candidate-free project-read authority |
| `IMPLEMENT` | real Codex, mutable Candidate | exact current Candidate workspace lease |

The existing top-level Execution Profile version 2 remains the owner of
external execution. M2.5.1 adds an additive
`ExternalExecutionProfileDefinitionV3`. Its canonical projection MUST NOT
inherit duplicate global authority for values moved into `phaseDispatch`.
The v3 shared portion owns only values that are identical for every selected
phase, including backend/capability, binary/protocol, controlled-state,
environment, managed-requirements, model/provider/service-tier/reasoning,
retention, and interruption policies. Each canonical `phaseDispatch` entry is
the sole v3 owner of that phase's:

- phase and real-adapter identity;
- cwd kind and required project-read record or Candidate-lease presence;
- permission/isolation profile ID and digest;
- project-configuration activation policy plus exact configuration, execution-
  configuration, and disabled-integration digests;
- exact automatic instruction-source manifest ID/digest and entries;
- capability-grant and response-contract/schema digests;
- Adapter-local Worker activity-policy ID and digest;
- command-network, approval, continuity, compaction, and fallback policies; and
- allowed and forbidden filesystem roots.

A v3 decoder MUST reject a duplicate global field for any phase-owned value
rather than select one copy by precedence. Historical nested v1/v2 fields keep
their original global meaning; they are not interpreted as v3 phase entries.

`DISCOVERY` and `PLAN` require snapshot cwd, forbid Candidate fields, and admit
only the existing `PROPOSALS` response contract. `IMPLEMENT` requires the exact
mutable Candidate cwd/lease and admits only the existing
`COMPLETION_REQUEST` contract. V3 fixes `workerDispatchPolicy` to
`ALL_SELECTED_ATTEMPTS`; `ACCEPTANCE_REPAIR_ONLY` is invalid for this formal
composition. The declared `workerPhases` and `phaseDispatch` entries are
unique, exhaustive, and use the existing canonical string-sorted order:
`DISCOVERY`, `IMPLEMENT`, `PLAN`. Array order is canonicalization only;
Workflow Runtime remains the sole execution-order owner and still drives
`DISCOVERY -> PLAN -> IMPLEMENT`. The two phase sets and their order MUST match
exactly.

### Bind phase-specific Worker activity admission

M2.5.1 adds one versioned Adapter-local `CodexWorkerActivityPolicyV1`. The
Domain and Runtime retain only its opaque ID/digest through the selected v3
phase entry, v3 directive, and v2 Adapter observation; Codex notification,
Item, command-action, approval, and sandbox DTOs remain inside the Adapter. The
Intake normalized event union and Intake effect classifier MUST NOT be reused
as Worker authority or as this policy.

Every activity class has one exact phase disposition:

| Adapter-local activity class | `DISCOVERY` / `PLAN` | `IMPLEMENT` |
| --- | --- | --- |
| exact submitted user input, bounded reasoning/plan/message lifecycle, and exact terminal summary | admit as non-authoritative observation | admit as non-authoritative observation |
| bounded `commandExecution` under the exact effective cwd/isolation | admit only under snapshot-read, no-network, no-approval isolation | admit only under the mutable Candidate lease and allowed roots |
| `fileChange` | reject and discard the Worker result | admit only when every path is inside the exact mutable Candidate lease and Goal allowed paths |
| separately authorized maintenance compaction | admit only under its existing maintenance intent; never as a Worker result | same |
| approval, network, integration, dynamic-tool, image, source-checkout/Candidate escape, unknown Item/effect, or phase-policy mismatch | reject and discard the Worker result | reject and discard the Worker result |

This Adapter-local policy is a strict refinement of, never an alternative to,
the canonical Domain `CapabilityGrant`. Trusted composition MUST accept only
this exact compatibility mapping:

| Phase | Required canonical Domain grant | Maximum Adapter activity admitted by v1 |
| --- | --- | --- |
| `DISCOVERY` | exact canonical phase grant: `projectRead = true`, `candidateAccess = NONE`, `runOutputScope = BOUNDED_DISCOVERY`, `controlSubmission = PROPOSALS`, `acceptanceAccess = NONE`, and exactly `READ_PROJECT`, `WRITE_RUN_OUTPUT`, `SUBMIT_PROPOSALS` | bound non-effect lifecycle plus snapshot-cwd read commands |
| `PLAN` | exact canonical phase grant: `projectRead = true`, `candidateAccess = NONE`, `runOutputScope = PLAN_OBSERVATION`, `controlSubmission = PROPOSALS`, `acceptanceAccess = NONE`, and exactly `READ_PROJECT`, `WRITE_RUN_OUTPUT`, `SUBMIT_PROPOSALS` | bound non-effect lifecycle plus snapshot-cwd read commands |
| `IMPLEMENT` | exact canonical phase grant: `projectRead = true`, `candidateAccess = MUTABLE_WRITE`, `runOutputScope = BOUNDED_IMPLEMENTATION`, `controlSubmission = COMPLETION_REQUEST`, `acceptanceAccess = NONE`, and exactly `READ_PROJECT`, `READ_CANDIDATE`, `WRITE_CANDIDATE_SOURCE`, `WRITE_RUN_OUTPUT`, `SUBMIT_COMPLETION_REQUEST` | bound non-effect lifecycle plus Candidate-lease/allowed-path commands and file changes |

The Domain capability digest and response-contract digest remain phase-owned
v3 inputs. Values not represented by `CapabilityGrant`, including effective
cwd, readable/writable roots, network, approval, integration, instruction,
continuity, and compaction policy, remain separately fixed by the same
`phaseDispatch` entry and effective isolation checks. The activity policy may
reject a Domain-permitted Worker observation when those narrower bindings are
not satisfied, but it MUST NOT admit an action, result kind, root, or effect
that the canonical grant and phase entry do not permit.

Trusted composition deterministically selects the one supported v1 policy
identity for the exact Adapter version and phase entry and rejects any missing,
unknown, or incompatible combination during Profile installation and strict
reopen. Domain and Runtime retain only protocol-neutral
`workerActivityPolicyId`/digest bindings; the concrete Codex notification,
Item, and effect mapping remains inside the Adapter. This check introduces no
new capability issuer or compatibility record.

The policy treats the protocol's bounded command-action projection as
diagnostic structure, not as access authority or the sole proof that a shell
command is read-only. Effective isolation and black-box containment MUST enforce
the phase boundary. A schema-valid command Item cannot widen cwd, readable or
writable roots, network, approval, or integration capability. An unknown Item
or effect class, effective-isolation mismatch, or activity outside the exact
phase roots fails closed.

`CodexWorkerDirectiveV3` binds the exact activity-policy ID/digest selected by
the phase entry. `CodexAdapterObservationV2` repeats that binding and a closed
admission disposition; it cannot choose the policy or turn observed activity
into Workflow, Candidate, Evidence, Acceptance, or closeout authority. Profile
install/reopen and Adapter invocation MUST reject missing, substituted, stale,
or phase-incompatible activity-policy bindings.

Project-local configuration, hooks, plugins, MCP, apps, skills, and other
integration activation remain disabled even when similarly named bytes are
present in the read snapshot. Automatic instruction discovery is forbidden.
Each phase binds an explicit instruction-source manifest, which may be empty;
every non-empty entry must be inside the admitted snapshot projection with its
exact current digest. Missing, extra, reordered, stale, or automatically loaded
instruction sources fail before result admission.

The new nested v3 canonical projection is frozen in Slice 0 before
implementation. Existing top-level Execution Profile versions 1 and 2 and
external-execution definitions v1/v2 retain strict decode/reopen, identity, and
meaning without rehash or reinterpretation.

Candidate-free Codex receives only the exact read-only snapshot root and no
writable project or Candidate root. The
implementation Candidate continues to be a Runtime-managed controlled copy and
is writable only under the existing `IMPLEMENT` lease. Source, authority,
credential, sibling-workspace, and protected-asset roots remain forbidden in
every phase; candidate-free source content is available only through the exact
snapshot entries granted above.

Network access from model tools and project commands remains disabled. The
separately preauthorized App Server model-service and authentication transport
required to run the bounded live Worker is host infrastructure, is bound by the
installed Profile, and is not a project command/network capability granted to
the model.

`FakeWorker`, `FakeCandidateSource`, and `FakeVerificationRunner` remain valid
only in explicit deterministic test, fixture, failure-injection, and offline
regression composition. A missing or failed real phase adapter MUST fail
closed; no resolver may substitute a fake result, skip the phase, fabricate a
transition, or create a Candidate early.

### Preserve Runtime-owned external execution and recovery

Each selected real phase uses ADR 0028's Runtime-owned external-execution
intent and lifecycle before the adapter effect. M2.5.1 freezes this additive
version chain:

- `ExternalExecutionIntentV2` adds one phase-discriminated source-authority
  union plus the exact selected v3 phase-entry digest;
- `ExternalExecutionRecordV2` extends that v2 Intent with the unchanged
  Runtime-owned lifecycle fields;
- `CodexWorkerDirectiveV3` binds the v2 Intent, selected v3 phase entry,
  phase-specific request, and exactly one source-authority projection; and
- `CodexAdapterObservationV2` repeats the Intent/directive binding and the
  exact phase/source-authority receipt without becoming Runtime authority.

For `DISCOVERY`/`PLAN`, each v2/v3 source union requires the exact project-read
record ID/digest and snapshot cwd identity while forbidding every Candidate
workspace field. For `IMPLEMENT`, it requires the existing Candidate workspace
lease/cwd fields while forbidding project-read snapshot fields. The Adapter
observation cannot select the union member; Runtime derives it from the phase
and rejects a receipt that does not repeat the authorized member exactly.

Existing `ExternalExecutionIntent`/`ExternalExecutionRecord` version 1 rows
retain strict decode/reopen and their current phase-conditional Candidate
semantics without gaining project-read fields. `CodexWorkerDirective` version
2 and `CodexAdapterObservation` version 1 retain their current Candidate-bound
`IMPLEMENT` meaning without rehash or reinterpretation. The lifecycle-only
`ExternalExecutionObservation` version 1 may remain unchanged because it binds
the exact Intent digest and record version rather than carrying source
authority. `WorkerRequest` version 2, `WorkerEvent` version 1, and
`WorkerEventReceipt` version 1 may likewise remain
unchanged only if Slice 0 proves that their existing Context/Manifest and
response bindings are sufficient for both source-union members. Otherwise the
changed boundary receives a new additive version; no retained version is
silently widened.

The new project-read binding is explicit rather than overloaded into Candidate
fields. Every new schema identity, projection, decoder, compatibility rule, and
cross-version substitution failure is frozen before implementation.

Process interruption, duplicate observations, restart, and recovery retain the
existing consume-once dispatch and reconcile-before-replacement rules. A
retained project-read value, Context Manifest, or external-execution record is
history, not redispatch permission. Recovery cannot infer current project
currency from a transcript or reuse an old read capability for a new Attempt.

## Consequences

- M2.5.1 can prove a real Worker path for every Worker-backed phase without
  retaining FakeWorker in formal composition.
- `DISCOVERY` and `PLAN` gain an exact read-only project capability without
  acquiring Candidate or source-write authority.
- Ignored files, `.git`, projection-excluded paths, authority, and credentials
  are not exposed merely because the source checkout exists on the host.
- The Plan and later Candidate base cannot silently refer to different source
  states.
- Context, Profile, external execution, and recovery gain additional bounded
  bindings, so implementation may require additive codecs, persistence, and
  migrations.
- Pre-Goal Intake project exploration, full Fact Graph selection, arbitrary-
  project discovery policy, and automatic repair remain outside M2.5.1.

This decision extends ADRs 0014 through 0016, ADR 0028, and ADR 0029 only for
the bounded M2.5.1 candidate-free real-Codex path. It does not change Workflow,
Goal, Admission, Candidate, Evidence, Acceptance, or closeout ownership.

## Rejected alternatives

- **Keep FakeWorker for `DISCOVERY` and `PLAN` in the formal path.** Rejected
  because the resulting proof would remain a mixed test composition rather
  than the selected real product chain.
- **Point candidate-free Codex at the source checkout using only cwd.**
  Rejected because a path does not prove source identity, read-only
  enforcement, projection-limited visibility, Context binding, source currency,
  or recovery safety.
- **Grant read access to the whole checkout under a read-only sandbox.**
  Rejected because read-only still exposes `.git`, ignored secrets, unsupported
  entries, and files outside the admitted source projection.
- **Create the Candidate at first Start so every phase can use its lease.**
  Rejected because it moves Candidate authority before the accepted
  `PLAN -> IMPLEMENT` boundary and changes the Workflow model for convenience.
- **Add a cleanup Host lease or time-based invocation takeover state.**
  Rejected for M2.5.1 because the exact persisted Cleanup Grant is already the
  sole operation identity, while the workspace port must make that operation
  process-safe and idempotent. A second lease would require liveness and
  takeover authority outside this milestone and would not remove the
  filesystem-effect/outcome crash window.
- **Run candidate-free Codex without project access.** Rejected for the formal
  M2.5.1 claim because it cannot prove the project-reading DISCOVERY/PLAN path
  required by the Workflow contract.
- **Treat Worker proposals as Facts or plan authority.** Rejected because model
  output remains untrusted and cannot promote its own observations.
- **Reuse the Intake project-observation boundary.** Rejected because Goal-
  bound Worker phases and pre-Goal Intake have different identity, Context,
  capability, persistence, and admission owners.

## Validation

M2.5.1 tests and acceptance MUST prove:

- exact project-root, repository, source-tree, Git-state, Goal, Workflow,
  Attempt, Policy, Profile, phase, capability, and response-contract binding;
- before/after-copy source equality, exact selected-file snapshot
  materialization, external ownership, read-only enforcement, and absence of
  `.git`, ignored, special, projection-excluded, and sibling-snapshot content;
- candidate-free pre-dispatch and post-Turn source/snapshot reobservation, with
  drift, path replacement, aliasing, or missing authority failing before
  result admission under one exact closed reason;
- `PLAN -> IMPLEMENT` refuses a Candidate Source projection that differs from
  the current admitted Plan source authority, creates no partial Candidate or
  replacement Attempt, records `PLAN_SOURCE_NOT_CURRENT`, atomically fails the
  Workflow through existing integrity authority, projects the Goal to
  `BLOCKED / INSPECT_BLOCKER`, and does not loop or expose a resume path;
- `DISCOVERY`/`PLAN` can read only the exact snapshot projection and cannot read
  the checkout, repository control data, ignored paths, Candidate, authority,
  credentials, sibling workspaces, protected assets, or use project/model tools
  for network destinations; only the bound host App Server model/auth transport
  is permitted;
- project-local configuration cannot activate, and exact empty/non-empty
  instruction-source manifests reject missing, extra, reordered, stale, or
  ambient instruction sources;
- `IMPLEMENT` still requires the exact current mutable Candidate lease and
  cannot write the source checkout;
- v3 Profile install/reopen rejects duplicate global/phase authority, any phase
  order other than canonical `DISCOVERY`, `IMPLEMENT`, `PLAN`, any mismatch
  between the declared set and entries, and any dispatch policy other than
  `ALL_SELECTED_ATTEMPTS`;
- every phase binds one exact Adapter-local Worker activity policy that is a
  strict refinement of its canonical Domain capability grant, response
  contract, and phase-entry isolation; `DISCOVERY`/`PLAN` admit only bounded
  snapshot-read command activity, while `IMPLEMENT` admits only Candidate-
  bound command/file-change activity, and every unknown, incompatible,
  forbidden, cross-phase, approval, network, or containment-mismatched
  observation fails closed without a Worker result or second capability owner;
- every real Worker phase has one Runtime-owned external-execution chain and a
  phase-correct candidate-free or Candidate-bound Intent, Record, directive,
  and Adapter receipt, while unchanged lifecycle/Worker schemas are proven
  sufficient rather than silently widened;
- retained Intent/Record v1, Codex directive v2, and Adapter observation v1
  identities preserve their exact prior meanings, and every old/new source-
  union or schema substitution fails strict decode, persistence, and reopen;
- candidate-free Worker output can supply only the existing untrusted
  `PROPOSALS` result and cannot create Facts, Workflow state, Candidate,
  Evidence, Acceptance, or closeout authority;
- fake components are reachable only from explicit test composition and cannot
  appear in the formal Profile, resolver, mandatory live run, or fallback;
- restart and strict reopen reconstruct the exact Context/project-read/
  external-execution v2 chain without transcript replay or redispatch;
- exact terminal cleanup removes only an unaliased externally owned snapshot
  leaf under one consume-once cleanup grant; exact pre-commit orphan recovery
  requires a monotonically sequenced authority snapshot, owned-orphan
  classification, and a separately persisted consume-once grant, while
  duplicate, unsafe, or failed cleanup changes no control disposition;
- cleanup request tests reject replacement, missing, caller-authored,
  naming-derived, and age-derived grants/targets before the port, replay an
  exact resolved grant without the port, reject grant-identity/content conflict
  without another Outcome, and permit only the exact unresolved grant to call
  or reconcile the port; disposition tests map first-invocation or reconciliation
  absence to `ALREADY_ABSENT`, require exact terminal reobservation for
  `FAILED`, remap a changed terminal observation, and leave conflicting or
  unclassifiable coordination state unresolved;
- cleanup crash tests cover before-call, partial-or-complete-delete/before-
  coordination-finalization, after-delete/before-outcome, and after-outcome
  windows: only the same unresolved grant may be reinvoked; a stable absent
  target closes as `ALREADY_ABSENT`, a stable present unsafe residual closes as
  `RETAINED_UNSAFE`, an unclassifiable target or unfinished coordination state
  returns no terminal observation, additional persistent coordination artifacts
  are gone before an absent disposition, outcome/audit/grant consumption commit
  atomically, and a retained outcome prevents another filesystem call;
- simultaneous same-grant calls from separate processes/Store connections
  converge on one deterministic process-safe cleanup operation, can cause at
  most one logical deletion, never touch a replacement or another leaf, and
  produce one Store-winning retained Outcome returned by every concurrent
  loser without a Host lease or time-based takeover; and
- all M1, M2, and M2.5 historical Profile, Context, Candidate, Worker, and
  recovery regressions remain green without reinterpretation.
