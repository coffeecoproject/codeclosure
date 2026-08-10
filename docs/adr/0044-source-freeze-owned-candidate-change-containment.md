# ADR 0044: Enforce Candidate allowed paths from a stable source-freeze change set

- Status: Accepted
- Date: 2026-08-09
- Extends: [ADR 0043](0043-candidate-free-codex-project-read-authority.md)

## Context

ADR 0043 requires effective isolation and black-box containment rather than
trusting the Codex App Server command-action projection. The Slice 3 Adapter
foundation correctly fails closed today, but the remaining composition must
resolve two facts before ordinary Candidate commands can be admitted safely:

- App Server describes `commandActions` as a best-effort parse. Build, test,
  and other bounded implementation commands can therefore use its official
  `unknown` action variant even though `commandExecution` itself is a known
  Item class.
- the M2 `workspaceWrite` sandbox confines writes to the exact Candidate root,
  but the controlled copy contains more paths than the Goal's `allowedPaths`.
  The current schema-version-1 freeze observation binds whole-tree digests but
  does not enumerate the base-to-frozen changed path set.

Permanently treating every `unknown` command action as a forbidden effect would
turn a conservative Adapter foundation into a product limitation and prevent
ordinary build or test commands. Admitting it based only on the Candidate cwd
would instead leave Goal scope unenforced. Neither interpretation is an
acceptable completion of M2.5.1.

## Decision

### Keep command notification classification phase-local and non-authoritative

`DISCOVERY` and `PLAN` continue to admit only exact snapshot-cwd command
actions classified as `read`, `listFiles`, or `search` under read-only,
no-network, no-approval isolation. Their `unknown` command action fails closed.

For `IMPLEMENT`, an official `unknown` command action is not by itself an
unknown Item or proof of a forbidden effect. The M2.5.1 Adapter policy MAY admit
that known `commandExecution` class only after trusted composition binds all of
the following together:

- the exact current mutable Candidate lease and Candidate cwd;
- Candidate-root `workspaceWrite`, no network, no approval, no integration,
  and the exact versioned phase policy;
- post-Worker stable source-freeze change containment defined below; and
- Candidate invalidation and denial of every dependent authority when that
  containment cannot be proven.

Until that complete composition is installed, the Adapter MUST continue to
reject the action. A `fileChange` notification outside Goal `allowedPaths` MAY
still reject the Worker result early, but notifications never prove that no
other Candidate byte changed.

An Adapter rejection before Worker-result admission discards that result. A
version-2 freeze containment failure is later: the already-admitted Worker
Event and completed `IMPLEMENT` Attempt remain immutable historical facts, while
the Candidate is invalidated and no freeze Evidence or downstream authority is
admitted. Implementations MUST NOT roll back, delete, or relabel the earlier
Worker Event to simulate post-hoc discard.

The accepted Slice 0 contract named activity policy version 1 before that
policy had an implemented or installed canonical digest. Its first canonical
projection MUST bind the per-phase best-effort `unknown` action disposition,
the exact `REQUIRED_BEFORE_IMPLEMENT_UNKNOWN_COMMAND_ACTION` activation, the
version-2 request/observation/Evidence schemas, and the
`candidate-change-set-v2` prerequisite. This completes the uninstalled
version-1 identity rather than creating a synthetic compatibility version.
After installation, the same policy ID/version/digest tuple MUST NOT be reused
for different behavior.

### Let Candidate Manager own the black-box change observation

Candidate Manager remains source-observation owner. After the implementation
Worker has terminated and its mutable lease has been released or revoked,
`SOURCE_FREEZE` MUST use the trusted Candidate workspace port to compare the
persisted base manifest with two equal, stable current-tree manifests. The
workspace port reports facts; it does not decide Workflow, Evidence, or
Acceptance state.

The base-to-frozen change set is a canonical, path-sorted sequence. Every entry
binds:

- one portable repository-relative path;
- exactly one kind: `ADDED`, `MODIFIED`, or `DELETED`;
- the prior regular-file identity when the kind is not `ADDED`; and
- the resulting regular-file identity when the kind is not `DELETED`.

Each regular-file identity contains only mode, byte length, and content digest.
It contains no source bytes, command output, user request text, or model text.
The bounded M2.5.1 profile admits at most 8,192 entries, sufficient for every
file in one maximum-size base manifest to be deleted and the same maximum
number to be added. Any duplicate path, inconsistent before/after member,
oversized sequence, non-portable path, or change-set digest mismatch is
malformed output and fails closed.

### Add a versioned freeze contract without reinterpreting M1 or M2

M2.5.1 uses an additive schema-version-2 Candidate freeze request,
observation, and freeze-Evidence observation. The request binds the exact Goal
`allowedPaths` and their canonical policy digest in addition to the existing
Goal, Workflow, Attempt, Candidate, and Policy authority. The observation
binds the exact base digest, both stable current digests, the canonical changed
entries, allowed-path policy digest, and change-set digest.

Historical schema-version-1 freeze requests, observations, Evidence records,
M1 FakeCandidateSource behavior, and the completed M2 Profile retain their
original meaning. They are not decoded as version 2, upgraded on reopen, or
used as M2.5.1 path-containment proof.

Runtime MUST independently derive the expected allowed-path policy from the
current Goal and require every changed path to equal or descend from at least
one allowed path. Store admission and strict reopen MUST recompute the
version-2 observation and change-set digests and repeat the same relationship
checks. The Worker, Codex Adapter, workspace port, and caller cannot select the
allowed path set or its disposition.

An empty actual change set, a changed path outside the exact allowed set, a
base mismatch, unstable manifests, malformed output, or unavailable
schema-version-2 proof cannot produce successful freeze Evidence for the
M2.5.1 Profile. The Runtime transaction invalidates the Candidate, terminates
the freeze Attempt with a closed integrity or protocol reason, retains only
schema-owned bounded metadata, and admits no dependent Verification, Evidence
Set, Acceptance, or closeout authority. A successful transaction persists the
exact version-2 freeze Evidence with the frozen Candidate and existing audit
and Workflow effects atomically.

### Keep verification and acceptance authority unchanged

The changed-path set proves only Candidate scope and identity. It does not
prove behavioral correctness, replace the protected Check, authorize
Acceptance, or promote Worker-authored tests. Protected verification still
runs over the exact frozen Candidate, and only the Acceptance Engine may decide
whether its Evidence satisfies the Goal.

## Consequences

- ordinary Candidate build and test commands can be supported without treating
  a best-effort protocol parse as filesystem authority;
- Candidate-root sandbox containment and Goal allowed-path containment have
  distinct, explicit owners;
- the existing Candidate freeze transaction remains the point where actual
  retained changes become authoritative Evidence;
- M1 and M2 historical freeze records remain byte- and meaning-compatible; and
- Slice 3 must implement and wire version 2 before its real `IMPLEMENT` path
  may admit `unknown` command actions.

## Rejected alternatives

- **Always reject `unknown` during IMPLEMENT.** Rejected as the final policy
  because it converts an interim fail-closed state into a build/test
  compatibility limitation.
- **Admit `unknown` under Candidate-root `workspaceWrite` alone.** Rejected
  because the Candidate root is wider than Goal `allowedPaths`.
- **Trust `fileChange` notifications as the complete change set.** Rejected
  because protocol notifications are observations and may not enumerate every
  retained byte mutation.
- **Add a second Adapter-owned completion or acceptance record.** Rejected
  because Candidate Manager, Workflow Runtime, Evidence, and Acceptance
  already own the required boundaries.
- **Replace the controlled copy with a new per-path sandbox in M2.5.1.**
  Rejected as unnecessary milestone expansion; a later mechanism may optimize
  isolation only if it preserves the versioned lease and manifest semantics.

## Validation

Slice 3 and M2.5.1 acceptance MUST prove:

- canonical added, modified, and deleted entries and their digest round-trip;
- reordered, duplicated, malformed, oversized, stale-base, unstable, and
  digest-substituted observations fail closed;
- exact-file and directory allowed paths accept only equal or descendant
  changed paths, without string-prefix or symlink alias acceptance;
- a Candidate command reported with `unknown` is rejected before the complete
  version-2 composition exists, then admitted only for the exact IMPLEMENT
  lease/cwd and followed by successful version-2 freeze containment;
- an out-of-scope retained command mutation preserves the already-admitted
  Worker Event and `IMPLEMENT` Attempt history, invalidates the Candidate, and
  admits no freeze Evidence, protected verification, Acceptance, or closeout;
- an out-of-scope `fileChange` notification may fail earlier but cannot replace
  black-box manifest proof;
- strict reopen recomputes the exact successful version-2 change-set and
  allowed-path bindings; and
- all M1, M2, and M2.5 schema-version-1 Candidate and Evidence regressions
  retain their historical meaning.
