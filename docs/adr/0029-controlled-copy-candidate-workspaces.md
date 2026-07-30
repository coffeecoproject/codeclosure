# ADR 0029: Use controlled-copy Candidate workspaces for bounded M2 execution

- Status: Accepted
- Date: 2026-07-30

## Context

ADR 0005 requires an isolated Candidate generation but leaves the concrete M2
mechanism open. The M1 Candidate Source is logical and returns no filesystem
locator. A Codex adapter therefore cannot safely use the Goal's project path as
cwd or resolve a generation identifier on its own.

The Slice 0 comparison considered a detached Git worktree and a Runtime-managed
copy. A worktree places a `.git` indirection in the Candidate and creates
administrative entries under the user's source `.git/worktrees` directory.
That shares Git metadata across the source and Candidate and makes cleanup a
mutation of the source repository's control data.

## Decision

### Select a Runtime-managed controlled copy

Bounded M2 requires a local Git checkout with one existing `HEAD` commit. The
trusted workspace adapter creates each generation below one CodeClosure-owned
workspace root. It copies selected source bytes into a new leaf directory and
does not copy or synthesize `.git` metadata inside that Candidate.

The M2 source projection is the sorted, NUL-delimited result of tracked and
untracked, non-ignored Git paths. It includes current working-tree bytes, so
staged, unstaged, and non-ignored untracked content is not silently replaced by
`HEAD`. It excludes Git-ignored files and every `.git` path. M2 rejects rather
than guesses when the source contains:

- a symlink, submodule/gitlink, nested Git control path, socket, device, FIFO,
  or another non-regular entry in the selected projection;
- a non-UTF-8 or non-portable repository-relative path;
- a traversal, absolute path, case-fold collision, or Unicode-normalization
  collision; or
- configured count, per-file, or total-byte limits that the bounded profile
  cannot represent.

Only regular and executable file modes are preserved. File content is copied
byte-for-byte. Timestamps, ownership, extended attributes, and directory entry
order are not Candidate identity.

The source snapshot binds two separate projections:

1. a `candidate-source-tree-v1` manifest of portable path, regular/executable
   mode, byte size, and SHA-256 content digest; and
2. `candidate-source-git-v1` metadata containing source realpath identity,
   repository common-directory identity, exact `HEAD`, staged index manifest
   digest, porcelain-v2 status digest, and selected-path-set digest.

The Git projection is evidence about the source checkout; it is not copied into
the Candidate tree digest. Source tree and Git projections are captured before
and after copy. A difference blocks dispatch and leaves the partial generation
non-current.

### Issue an exact workspace lease

The Runtime persists Candidate/generation authority, then asks trusted workspace
composition for a `CandidateWorkspaceLease`. Its protocol-neutral canonical
shape binds:

- lease schema/version, ID, digest, state, and Runtime-authored issue time;
- Goal revision, Workflow/version, Candidate, generation, sequence, and parent;
- source tree and Git metadata digests;
- CodeClosure-owned workspace-root identity and exact generation-root realpath;
- allowed-path policy digest and reserved-path policy;
- access mode `MUTABLE` or `READ_ONLY`; and
- lifecycle/retention policy and Candidate generation version.

The Worker adapter receives the already resolved lease. It cannot ask the Store
for a path or substitute the source checkout, authority home, another
generation, a symlink alias, or a parent directory. Immediately before spawn,
trusted composition repeats `lstat`, `realpath`, exact registered-root equality,
containment, ownership-marker, and forbidden-root checks.

`MUTABLE` is valid only for the current IMPLEMENT generation. Freeze revokes
that lease permanently. Verification receives a distinct read-only lease for
the exact frozen generation; it never reuses Worker mutation authority.

### Freeze every retained Candidate byte

`candidate-tree-manifest-v1` walks the Candidate without following links and
records every retained regular file as portable path, regular/executable mode,
size, and SHA-256 digest. New regular files are included. A symlink, special
file, reserved control path, path collision, or configured size/count overflow
invalidates freeze.

The bounded M2 profile includes all retained files rather than inferring Git
ignore behavior after `.git` has been removed. Its fixtures therefore avoid
large dependency/output trees. Supporting arbitrary project dependency caches,
ignored build outputs, submodules, or symlinks requires a later explicit
manifest policy; M2 makes no such claim.

Repair generation `n + 1` is a fresh controlled copy of the exact eligible,
frozen generation `n`, not a second read from the user's source checkout. It
binds the parent's frozen digest as its base and leaves generation `n`
byte-identical.

### Make cleanup ownership explicit

Workspace paths are never caller-selected. Creation uses a Runtime-allocated
leaf below the owned root and an ownership marker stored outside the
worker-writable Candidate. Restart classifies each path as current, retained,
orphaned, or unsafe.

Cleanup may remove only an exact leaf whose realpath, generation identity,
ownership marker, lifecycle state, retention policy, and absence of active
leases all match persisted authority. An ambiguous, aliased, parent, source,
authority, or user-owned path is retained and reported. Cleanup failure cannot
change Candidate or Workflow state to success.

## Consequences

- Candidate writes cannot mutate source Git metadata.
- Dirty source bytes are represented exactly rather than silently reset to
  `HEAD`.
- M2 intentionally supports a narrower file/project class than a general Git
  worktree implementation.
- Copy cost is accepted for the bounded vertical slice; later optimized
  snapshot mechanisms must preserve this lease and manifest contract.
- Slice 3 owns the real adapter, manifests, reconciliation, and cleanup tests.

## Rejected alternatives

- **Detached Git worktree.** Rejected for M2 because it shares and mutates the
  source repository's Git administrative state and exposes a `.git` pointer
  outside the Candidate root.
- **Edit the user's checkout and use Git reset for cleanup.** Rejected because
  it risks user data and makes rollback a substitute for isolation.
- **Let the Codex adapter resolve a generation path.** Rejected because it would
  give a Worker-side component Candidate selection authority.
- **Copy `HEAD` only.** Rejected because it silently omits current staged,
  unstaged, and non-ignored untracked user bytes.
- **Follow source or generated symlinks.** Rejected because containment and
  digest identity would depend on mutable targets outside the tree.

## Validation

M2 tests MUST prove:

- source, authority, sibling-generation, traversal, case/Unicode alias, and
  symlink targets cannot resolve as the leased cwd;
- the source projection handles dirty and untracked bytes exactly and rejects
  ignored/special/submodule policy ambiguity;
- copy does not change source bytes or Git metadata;
- freeze detects before/during/after mutation and revokes write authority;
- repair copies only the exact frozen parent into a new generation;
- no partial operation becomes current; and
- restart and cleanup never delete an unresolved or non-owned path.
