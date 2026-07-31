# M2 Slice 3 Candidate Workspace Review

- Review date: 2026-07-31
- Scope: M2 Slice 3 only
- Status: Complete
- Verdict: `PASS`; the bounded controlled-copy Candidate workspace satisfies
  the Slice 3 exit contract and Slice 4 may begin

## Review question

This review asks whether CodeClosure has one local workspace adapter that can
create an exact isolated Candidate from the selected bounded Git source,
produce and revalidate the Runtime's protocol-neutral workspace lease, revoke
mutable authority during freeze, create repair generations only from exact
frozen parents, and reconcile or clean only exact Runtime-owned leaves without
mutating the source checkout or acquiring Workflow, Store, Evidence,
Acceptance, Worker, or Intake authority.

It does not assess Runtime/Store composition of that adapter, durable external
execution, a real Verification Runner, Evidence creation, reject/repair/accept
orchestration, process restart, trusted CLI composition, a live Codex edit, M2
milestone exit, Goal Intake, or authority to merge, release, deploy, or perform
another external effect.

## Authority and source identity

The review applies the repository authority order, ADR 0005, ADR 0006, ADR
0016, ADR 0029, the
[Slice 3 contract](../plans/m2-codex-vertical-slice.md#slice-3--real-isolated-candidate-workspace),
and Candidate cases D01 through D09 in the
[M2 acceptance plan](../plans/m2-acceptance-plan.md#candidate-workspace). Slice
2 was committed on `main` as
`9a20def648feb010f8ad837b0264bc6bbc3b1f6b` before Slice 3 began.

The reviewed working tree has this source identity when this review file alone
is excluded to avoid self-reference:

```text
Base Git revision: 9a20def648feb010f8ad837b0264bc6bbc3b1f6b
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 895
Source manifest digest: sha256:79dd81c58c499ff5d55a4b789b94cd7ac9e5f34cd550b9e3b1f2c250901ec071
Self-referential review exclusion: docs/reviews/m2-slice3-candidate-workspace.md
```

The closing quality gate and this review use the same non-review source
identity. A later commit hash may package this exact tree, but is not itself
part of the Slice 3 technical verdict.

## Package and authority boundary

The new `@codeclosure/workspace-local` production package depends only on the
public `@codeclosure/runtime` Candidate Source and workspace-lease contracts.
It imports no Domain, Store, testing, CLI, Codex client/adapter, generated
protocol, Verification, Evidence, Acceptance, or Intake capability. Reverse
dependency fixtures enforce that boundary and reject Runtime subpath imports.

The adapter implements filesystem mechanics, not control-plane mutation. The
existing Workflow Runtime still owns Candidate lifecycle transitions, only the
Store may persist authoritative state, and only the Acceptance Engine may issue
technical `ACCEPT`. Ownership records beneath the trusted workspace metadata
root describe adapter-owned filesystem leaves; they are not substitutes for
persisted Candidate, Workflow, Evidence, or Acceptance records.

The shared Runtime lease codec and canonical projection are now the single
protocol-neutral contract used by both the producer and Codex Adapter
consumer. Runtime also owns the canonical reconciliation-authority snapshot
and one-time cleanup-grant contracts. A snapshot binds the exact persisted
Candidate generation, lifecycle, source, Goal, Workflow/version, retention,
audit sequence, time, and digest without giving the filesystem adapter Store
access. The Codex Adapter repeats real-directory, alias, containment, and
forbidden-root checks immediately before spawn while accepting only a mutable
revoke-on-freeze lease. Codex protocol types do not enter Runtime or the
workspace package.

## Exact controlled-copy source

Candidate creation accepts only an exact real Git checkout root with one
existing `HEAD`. Its selected tree is the sorted set of tracked plus
non-ignored untracked paths that currently exist. The source manifest records
portable path, regular/executable mode, byte size, and SHA-256 content digest.
The separate Git projection records source realpath, common-directory identity,
exact `HEAD`, staged-index manifest digest, porcelain-v2 status digest, and
selected-path-set digest.

Current staged, unstaged, and untracked bytes are copied byte-for-byte. Ignored
files and `.git` are omitted. The adapter rejects symbolic links, gitlinks,
unmerged index stages, nested Git control, linked worktrees with external
control data, sockets/devices/FIFOs or another special entry, non-UTF-8 or
non-portable paths, traversal, case/normalization collisions, aliases, and
configured file/path/count/byte overflow.

The adapter resolves and rejects source/workspace/authority overlap before it
creates or claims a new workspace root. It then captures both source
projections before and after the copy. A change in either projection removes
the new Candidate and its external marker instead of returning preparation
authority. File writes are exclusive, fixed-size bounded,
content-rechecked, fsynced, assembled below an owned staging leaf, and
atomically renamed before the external ownership record is committed. A
partial failure cannot appear as a current generation.

## Lease, freeze, and drift boundary

Each lease binds exact Goal revision, Workflow/version, Candidate,
generation/version/sequence/parent, Candidate digest, source-tree and Git
metadata digests, source root, workspace root, generation root, allowed-path
policy, forbidden roots, issue time, access mode, lifecycle, retention, state,
version, and canonical digest.

Issuance reopens the external ownership record, repeats realpath and containment
checks, requires the source and every trusted authority root in the sorted
forbidden set, rejects allowed-path links or aliases, and permits at most one
mutable lease. `assertLeaseCurrent` repeats those checks before use. A mutable
lease is valid only while the recorded generation is mutable; freeze clears all
active mutation leases before scanning and never reissues mutable authority for
that generation.

Freeze scans every retained regular file without following links. Because the
accepted bounded manifest derives directories from retained file paths, an
otherwise unrepresented empty directory is rejected rather than silently
sharing a digest with another filesystem tree. Freeze removes write bits from
every retained file and directory, permits the test-only concurrency boundary,
reseals permissions, scans again, and proves the resulting tree is read-only.
Only identical canonical tree digests and closed write permissions produce a
frozen ownership record. A changed, linked, special, missing, writable,
unrepresented, or oversized tree becomes unsafe. Read-only lease issuance,
repair, reconciliation, and later integrity observation repeat the read-only
and exact-tree checks; post-freeze drift cannot retain or reacquire a current
read-only identity.

## Repair, restart, and cleanup

Repair requires one exact external parent record with no active lease, frozen
phase, matching Goal/Workflow/Candidate/source binding, and the requested frozen
digest. It copies from that frozen Candidate rather than rereading the user's
checkout. The parent is scanned before and after child creation. Concurrent
parent drift removes the partial child, while successful repair produces a
distinct mutable leaf whose base is the parent's frozen digest and leaves the
parent byte-identical.

Ownership markers are outside every worker-writable Candidate. Reopen does not
silently delete anything: it compares each marker and filesystem lifecycle with
the Runtime's exact authority snapshot before classifying a valid leaf as
current, retained, or orphaned. A `FREEZING` or `INVALIDATED` authority, state,
source, parent, Goal, Workflow, or digest mismatch, malformed record, missing
counterpart, unowned leaf, symlink, frozen drift, partial staging path, or
unresolved active lease is unsafe.

Only an orphan entry receives an adapter-issued one-time cleanup grant bound to
that authority-snapshot digest and sequence, generation root, ownership digest,
workspace identity, and issue time. A later reconciliation invalidates every
older grant only when it admits a higher authority sequence. Cleanup reopens
the exact marker and repeats safe reconciliation; callers no longer select a
raw deletion path or provide an omission-only retention list. Source,
authority, current, retained, aliased, ambiguous, and user-owned paths remain
untouched. Ownership-record construction and writing pass through the strict
codec, and the explicit active-lease bound is enforced before persistence.

Within one live adapter instance, authority admission is monotonic before any
current snapshot or cleanup grant is changed. A lower audit sequence is stale;
the same sequence with another digest is conflicting; and the same sequence and
digest is an idempotent replay. The adapter neither allocates nor persists that
sequence as control authority. Later trusted Runtime/Store composition remains
responsible for rebuilding the current persisted snapshot on process restart
and reconciling before commands are published.

## Deterministic evidence

The 18-case local workspace suite uses disposable bounded Git repositories and
zero skips. It proves:

- D01, D02, and D09 through exact dirty/untracked copying, ignored and `.git`
  exclusion, mode preservation, lease containment, Candidate-only mutation,
  pre-creation source/workspace overlap rejection, and byte-identical source
  plus Git projections;
- D03 through traversal, reserved path, case and Unicode normalization alias,
  source and Candidate symlink, FIFO, gitlink, missing forbidden root,
  workspace alias, and unowned-root rejection;
- D04 and D05 through lease revocation, double-scan freeze, rejection of
  unrepresented empty directories, write-bit resealing and later restoration
  detection, read-only rehash, concurrent freeze mutation, pre-lease frozen
  drift, and post-freeze integrity mismatch;
- D06 through exact frozen-parent repair, distinct child identity, child-only
  edits, and byte-identical parent retention;
- D07 through injected partial-copy, source-change, freeze-change,
  repair-parent-change, lifecycle/source-authority mismatch, and active-lease
  overflow failures with no falsely current child or undecodable record; and
- D08 through same-owner reopen, exact authority-snapshot comparison,
  monotonic admission, rollback/equivocation rejection without Grant mutation,
  current/orphan/unsafe classification, active lease retention, stale cleanup
  grant rejection, exact one-time orphan cleanup, and preservation of source,
  authority, and user-owned siblings.

The test metadata contributes executable coverage to I-007, I-011, I-012,
I-013, I-027, and I-029. D10 remains intentionally unclaimed here because its
real Worker black-box authority-home isolation proof belongs to trusted
composition in later M2 slices.

## Closing executable evidence

The final `pnpm gate:quality` passes with no failed, cancelled, skipped, or todo
case:

| Stage | Result |
| --- | --- |
| documentation tests and structural check | `75/75`, 59 documents |
| CLI/dependency boundary tests | `25/25`, eight workspace packages |
| runner and Slice 0 probe tests | `7/7` |
| Slice 1 lower-client tests | `41/41` |
| Slice 2 adapter tests | `40/40` |
| Slice 3 workspace tests | `18/18` |
| M1 package unit regression | `136/136` |
| digest tests | `36/36` |
| migration tests | `99/99` |
| authority tests | `244/244` |
| CLI integration | `58/58` |
| M1 adversarial demonstrations | `8/8` |
| Runtime Invariant coverage | `4/4`; `31/31` invariants |

Formatting, strict typecheck, deterministic protocol-snapshot regeneration,
package and CLI dependency audits, documentation checks, and forced production
build also pass. The invariant audit inspected 39 test sources and 397
metadata-bearing executable tests.

## Documentation and architectural review

The root README, Architecture status and Candidate sections, Domain and
Workflow status sections, M2 milestone, implementation plan, acceptance-plan
status, review index, and ADR index were reviewed together. No accepted
architectural decision changed, so no new ADR is required. Slice 3 implements
ADR 0029 and preserves ADR 0005, ADR 0006, and ADR 0016.

No new Runtime Invariant is required because the implementation makes existing
I-007, I-011, I-012, I-013, I-027, and I-029 executable for the local
filesystem boundary without adding a new authority class. M0/M1 history, the
M2 milestone boundary, and the Goal Intake/M2.5 boundary remain unchanged.

## Verdict, limitations, and next action

Every bounded Slice 3 exit condition passes. Slice 3 is implemented and Slice
4 may begin.

This verdict does not prove that the current production CLI composes the real
workspace adapter, that leases or external executions are persisted in SQLite,
that a verifier is isolated/read-only, that Evidence is valid, that a failed
Candidate is rejected and repaired end to end, that a Codex process cannot
reach authority state under the final black-box sandbox, or that restart can
resume external execution. It also does not prove M2 exit or Goal Intake. Slice
4 must consume only the public frozen-Candidate/read-only-lease boundary and
must not move verification, Evidence, or Acceptance authority into this
workspace package.
