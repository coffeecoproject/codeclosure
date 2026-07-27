# ADR 0005: Isolated candidate generations

- Status: Accepted
- Date: 2026-07-27

## Context

Acceptance evidence is meaningful only when it is bound to the exact source and
inputs that were verified. If a worker can edit the governed source tree while
verification is running—or repair a frozen candidate in place—previous evidence
can appear current when it is not.

The authoritative state store must also be protected from worker file access.

## Decision

Workers execute in runtime-managed, isolated candidate generations.

- A Goal has one or more immutable candidate generation identities.
- An editable generation may receive implementation changes.
- Entering `SOURCE_FREEZE` seals that generation and computes its source identity.
- Frozen generations are read-only to implementation workers.
- A failed verification that requires source changes creates a new generation
  derived from the last eligible candidate; it never thaws the old generation.
- Evidence is bound to candidate generation, source digest, configuration digest,
  verifier identity, and relevant environment identity.
- The authoritative database, audit log, policy store, and acceptance records are
  outside worker-visible writable paths.
- Promotion or export from a candidate to a user repository is a separate,
  guarded operation and is not implied by technical `ACCEPT`.

M1 may model candidates with deterministic fake identities. M2 must select and
test a concrete isolation mechanism, such as managed Git worktrees or controlled
copies, including containment and cleanup behavior.

## Consequences

- Evidence from a previous candidate cannot validate a repaired candidate.
- Cleanup becomes a first-class runtime responsibility with explicit ownership.
- Disk usage and candidate retention need policy.
- User-authored changes in an external repository cannot be overwritten by an
  implicit acceptance transition.

## Rejected alternatives

- **Let the worker edit the user's checkout directly.** Rejected because source
  mutation, user changes, and evidence identity become inseparable.
- **Freeze and later unfreeze the same candidate.** Rejected because it destroys
  the stable referent to which evidence was bound.
- **Trust Git status alone.** Rejected because repository cleanliness does not
  prove configuration, generated inputs, runtime identity, or evidence freshness.

## Validation

M1 must prove generation and evidence invalidation semantics in memory and in the
database. M2 must prove filesystem containment, immutable freeze behavior,
cleanup recovery, and non-destructive promotion boundaries.
