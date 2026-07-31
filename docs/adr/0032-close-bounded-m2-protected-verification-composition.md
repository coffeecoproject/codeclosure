# ADR 0032: Close bounded M2 protected-verification composition

- Status: Accepted
- Date: 2026-07-31
- Amendment: [ADR 0033](0033-align-protected-verification-with-start-and-check-lifecycle.md)
  supersedes this record's protected-Plan timing and schema-version-1 lease
  field list. Its other decisions remain in force.

## Context

[ADR 0031](0031-protect-acceptance-critical-verification-from-worker-writable-assets.md)
establishes that Worker-writable tests cannot be the sole decisive Evidence for
an acceptance-critical Criterion. It intentionally leaves several composition
details to the implementing slice.

Those details must be closed before Slice 7 can add authority-bearing schemas:

- ADR 0031's per-Criterion wording can be read as either one plan per Criterion
  or one plan covering the bounded Workflow;
- the protected-asset lease has a digest binding but no canonical value shape;
- ADR 0030's version-1 Darwin isolation profile does not authorize a new
  protected-asset input class; and
- Slice 5 permits one complete Check family in an Evidence Set, while ADR 0031
  also permits separately executed supplementary Worker-authored tests.

These are execution-model decisions, not reasons to reinterpret completed
Slice 4 or Slice 5 evidence.

## Decision

### Use exactly one protected Verification Plan for the bounded M2 Workflow

A Workflow started under the bounded M2 acceptance-critical profile MUST bind
exactly one immutable `AcceptanceCriticalVerificationPlan`. Trusted composition
creates it after the Workflow has acquired its immutable Policy and Execution
Profile bindings and before the first Worker dispatch that can mutate Candidate
generation 1.

The plan's ordered Criterion and Policy-rule sets MUST equal the complete
acceptance-critical set selected by that bounded profile. The single semantic
Check template may cover multiple Criteria only when the immutable Policy maps
all of them to that same protected Check family. A profile that requires two
different protected semantic Check templates is unsupported by M2 and MUST fail
before Worker dispatch rather than create a second plan or weaken either Check.

The Store MUST enforce at most one plan for the Workflow and atomically retain
its creation audit. Repair generations reuse the same plan. A Goal revision,
Policy/Profile replacement, or changed acceptance-critical mapping requires a
new Workflow authority path outside bounded M2; it cannot revise the plan in
place.

To make the lease projection reconstructible, each protected-asset entry in
this plan MUST retain its logical ID, registered protected-root identity, exact
normalized realpath, execution path, regular file mode, byte length, content
digest, and protection mode. A path string or manifest digest without those
decoded fields is insufficient.

This paragraph controls the M2 cardinality where ADR 0031's phrase "for every
acceptance-critical Criterion" is ambiguous. M3 may add a plan-reference set
when complete multi-Check Criterion coverage requires it.

### Define a deterministic protected-asset read lease value

`ProtectedAssetReadLease` is a protocol-neutral, immutable Runtime request
value. It is not a second Workflow owner, filesystem authority discovered by a
runner, or independently mutable Domain aggregate.

Its schema-version-1 canonical projection MUST bind:

- Goal ID/revision and Workflow ID/version;
- current Attempt, Candidate generation ID, and frozen Candidate digest;
- protected Verification Plan ID/digest;
- protected-asset manifest digest;
- concrete Verification Obligation ID and Check Specification ID/version;
- isolation-profile ID/digest;
- access mode `READ_ONLY` and lifecycle policy
  `SINGLE_VERIFICATION_INVOCATION`;
- an ordered non-empty asset list containing each logical asset ID, registered
  protected-root identity, exact normalized realpath, execution path, regular
  file mode, byte length, and SHA-256 content digest; and
- `leaseDigest`, computed over every preceding semantic field with the
  repository's canonical digest profile.

The asset order is canonical by logical asset ID and then execution path.
Duplicate logical IDs, paths, or aliases fail closed; distinct logical assets
MAY have identical content digests. The lease digest is its identity; M2 does
not add a separately mutable lease row or lifecycle table.

Trusted Runtime composition derives the complete lease from the immutable plan
and current concrete verification authority. Immediately before execution it
MUST repeat `lstat`, `realpath`, exact registered-root equality, containment,
regular-file, mode, length, and content-digest checks without following a
symbolic link. It MUST repeat the identity and digest checks after execution
before admitting eligible passing Evidence.

The schema-version-3 local verification request carries the full decoded lease.
The version-3 Check and Evidence retain the exact `leaseDigest` required by ADR
0031. Runtime and Store recompute the expected digest from the persisted plan,
Candidate, Check, obligation, Profile, and Attempt authority, then cross-check
the Evidence binding at admission and strict reopen. Because every semantic
input is already retained and the lease has no independently changing state,
M2 needs no separate lease persistence.
If implementation cannot reconstruct the exact projection from those retained
inputs, it MUST stop and add explicit persistence through a later ADR rather
than trust a digest supplied by composition or the runner.

An adapter-private file descriptor, sandbox extension, capability handle, or
temporary mount is not part of the canonical lease and cannot alter its asset
set or authority bindings.

### Add a new protected-asset-capable isolation-profile version

The existing `codeclosure.darwin-seatbelt.local-command` isolation profile
version `1` and its digest retain their Slice 4 meaning. They MUST NOT be
reinterpreted as authorizing protected Verification Plan assets.

The protected path uses version `2` of that isolation profile with a distinct
canonical digest. Its closed semantic projection adds:

- `protectedAssetAccess: EXACT_READ_ONLY_LEASE`;
- protected-asset lease schema version `1`; and
- denial of protected-root reads except for the exact regular-file realpaths in
  the current decoded lease.

The version-2 verification-isolation request carries the same complete lease
that the version-3 local verification request binds. The sandbox MAY retain
only explicitly versioned platform-runtime and executable reads required by
black-box proof. It MUST deny writes to Candidate and protected assets, deny
authority and credential reads, deny network, and MUST NOT widen one leased
asset into read access for its parent protected root.

An unavailable, unenforceable, mismatched, or version-1 profile blocks the
acceptance-critical protected path. The Workflow's immutable Execution Profile,
concrete Check, request, lease, Evidence, and acceptance input all bind the same
version-2 isolation-profile identity and digest.

### Keep supplementary Evidence outside the decisive M2 Evidence Set

Slice 5's one-complete-Check-family rule remains unchanged. The bounded M2
acceptance-critical Evidence Set contains only the complete schema-version-3
protected local-command family selected for its obligations.

Runtime MAY independently execute a Worker-authored test and persist
provenance-labelled supplementary Evidence under a non-critical obligation,
but that record MUST NOT be selected into the acceptance-critical Evidence Set.
It remains separately queryable and auditable. Mixing supplementary and
protected families, or substituting the supplementary family, fails closed.

A later milestone that wants auxiliary Evidence inside one acceptance input
must define an additive Evidence Set and Policy rule rather than relax the M2
family invariant.

## Consequences

- Slice 7 has one unambiguous plan identity and one supported protected Check
  family for the bounded demonstration.
- Protected-asset access is exact, content-bound, request-visible, and
  reconstructible without adding a premature persistence aggregate.
- The existing Slice 4 isolation profile and Slice 5 Evidence Set semantics
  remain unchanged.
- Worker-authored tests remain useful diagnostic or regression records without
  becoming an alternate completion path.
- Multi-plan coverage, richer auxiliary Evidence composition, and general
  verification-asset traceability remain later work.

## Rejected alternatives

- **Create one plan per Criterion in M2.** Rejected because the current
  Acceptance Input Manifest has one plan binding and the bounded fixture needs
  one protected semantic family.
- **Store only a lease digest supplied by trusted composition.** Rejected
  because Store and reopen validation could not reconstruct what the Runner was
  allowed to read.
- **Persist a mutable protected-lease aggregate immediately.** Rejected because
  the bounded single-invocation lease is deterministically reconstructible from
  already retained authority.
- **Reuse isolation profile version 1 with extra read roots.** Rejected because
  it would change an accepted profile without changing its identity.
- **Mix supplementary Worker tests into the decisive Evidence Set.** Rejected
  because it conflicts with Slice 5's complete-family rule and obscures which
  evidence can satisfy the critical obligation.

## Validation

The rows below are subject to ADR 0033: Attempt and Obligation mismatches still
fail closed, but they are checked as separate request/Evidence causality rather
than fields of the static lease digest.

Slice 7 implementation and Slice 8 acceptance MUST prove:

- zero or two protected plans for one bounded M2 Workflow fail closed;
- a second semantic protected Check family is rejected by the bounded profile;
- the full lease round-trips to the same canonical digest and any field,
  ordering, alias, path, content, Candidate, Check, obligation, Plan, or Profile
  mismatch blocks execution or Evidence admission;
- strict reopen recomputes the lease digest from retained authority without a
  runner- or composition-authored assertion;
- isolation profile version 1 cannot execute the protected path, while version
  2 permits only the exact leased assets and denies protected-root widening and
  every prohibited write/read/network capability; and
- supplementary Evidence remains auditable but cannot enter or satisfy the
  acceptance-critical Evidence Set.
