# ADR 0016: Make Candidate and Evidence authority Workflow-coordinated and source-bound

- Status: Accepted
- Date: 2026-07-27

## Context

Slice 4 deliberately prohibited Candidate bindings in Worker Context because no
component could prove that a Workflow's Candidate identifier named a persisted,
current generation or that a supplied digest described its source. The initial
M1 schema also reserved Candidate and Evidence tables before their owning
Runtime services existed.

The remaining skeleton is not sufficient to open that boundary safely:

- a generic phase-guard evaluator can return Candidate- and Evidence-labelled
  PASS results without owning either record;
- a phase request can name a next generation that no Runtime authority created;
- Candidate state has a pure reducer but no Store round trip, creation
  transaction, source-observation port, or startup validation;
- Evidence rows have no owning codec, canonical digest recomputation, producer
  boundary, atomic initial eligibility, or audited invalidation service; and
- when Worker dependencies are configured, the early Runtime attempts to treat
  every phase Attempt as a coding-Worker Attempt, although source freeze and
  verification have different effect owners.

Adding conditionals at those call sites would leave Candidate and Evidence
authority self-attested. Slice 5 instead needs one closed construction path from
source observation through persistence, Context, Evidence, and later
Acceptance inputs.

## Decision

### Persist the Candidate root and generation ownership

M1 persists one immutable Candidate root for a Goal and its versioned Candidate
generations. A generation belongs to that Candidate and to the Goal's unique M1
Workflow. Persistence proves all three relationships; `candidate_id` is not an
unresolved grouping string.

Each immutable Verification Obligation also binds the Candidate generation it
was created to verify. A repair generation receives a fresh obligation set;
retained obligations and Evidence from an older generation remain replayable
history but are never selected as current authority for the new generation.

The Candidate Manager owns Candidate preparation, source observation, lifecycle
planning, and integrity decisions. It does not receive a Workflow mutation
method. The Workflow Runtime remains the transaction coordinator and sole
Workflow writer.

On the first `PLAN -> IMPLEMENT` transition, the Runtime allocates Candidate
and generation identities only after normal command freshness and non-Candidate
guards pass. It asks a narrow Candidate Source port for a strictly validated M1
logical preparation, then atomically persists:

- the Candidate root;
- generation 1 in `MUTABLE` state;
- the Workflow phase transition and active-generation binding;
- Candidate and Workflow audit events; and
- the Store-authored processed-command outcome.

The phase requester does not choose the generation identity. A repair
transition later creates a child generation and never reuses or thaws the
previous generation.

M1 Candidate Source behavior is deterministic and logical. It does not create
or edit a real source checkout. `baseDigest` is the exact logical source input
for an IMPLEMENT generation; `workspaceIdentity` and `baseProjectIdentity` are
fixture identities. M2 replaces this port with real isolation and cleanup
without changing the authority owner.

### Reserve Candidate and Evidence guards for their owners

The generic `PhaseGuardEvaluator` may provide only guards whose owning Slice 5
authority is not Candidate Manager, Evidence Store, or Acceptance Engine.

- Candidate preparation/current-state/freeze/integrity guards are constructed
  by the Runtime from decoded Candidate authority and Candidate Manager
  observations.
- Evidence accounting, binding, cleanup, and source-currency guards are
  constructed from decoded Evidence, eligibility, obligation, and Candidate
  authority.
- `CURRENT_ACCEPTANCE` remains reserved for Slice 6.

A generic evaluator return containing a reserved guard is an evaluation-boundary
failure. A label or supporting reference cannot substitute for the owning
record.

### Reopen only source-backed IMPLEMENT Candidate Context

Candidate Context is reopened only for a coding-Worker Attempt in `IMPLEMENT`.
The Runtime resolves the Workflow's active generation through the Candidate
Store, proves Candidate/Goal/Workflow ownership, requires the generation to be
`MUTABLE`, and supplies its immutable `baseDigest` to the Context compiler.

The compiler-owned Candidate entry binds that generation and digest. The
Runtime independently checks the package and Manifest against the resolved
Candidate. The Store independently resolves the same persisted Candidate
authority before inserting or reopening the Manifest and rederives its package
and Manifest identities.

DISCOVERY and PLAN remain Candidate-free. Fact, Human Decision, project-source,
and omission-decision Context remain closed under ADR 0015. Source freeze and
verification do not dispatch the coding Worker and therefore do not use Worker
Context as a substitute for their own ports.

### Make freeze an Attempt-bound stable observation

Entering `SOURCE_FREEZE` requires the IMPLEMENT Attempt to be terminal and the
active generation to be `MUTABLE`. The same Workflow transition transaction
changes that generation to `FREEZING`.

A source-freeze Attempt is persisted before the Candidate Source port is
observed. The port returns two bounded digest observations plus the exact
change-set identity. Its return is untrusted boundary data and is strictly
decoded. An invocation failure, malformed output, or generation-binding
mismatch becomes a closed Runtime-owned reason code; adapter exception text
and unknown fields are not persisted.

- Equal source observations produce one `FROZEN` generation with that exact
  digest and one immutable `CANDIDATE_FREEZE` Evidence record.
- Different observations are Candidate drift. The generation becomes
  `INVALIDATED`, the freeze Attempt fails with an integrity classification, and
  no freeze Evidence is admitted.

The successful Candidate event, freeze Evidence, initial eligibility, Attempt
result, Workflow state, audits, and processed-command outcome commit in one
transaction. The drift path commits Candidate invalidation, Attempt failure,
Workflow failure, dependent Evidence invalidations, audits, and its command
outcome in one transaction.

### Separate verification production from coding work

`EVIDENCE_BUILD` uses a narrow Verification port and a deterministic
`FakeVerificationRunner` in M1. It does not dispatch `FakeWorker`.

The Runtime creates the verification Attempt before calling the runner. A
Verification Request binds Goal revision, Workflow/Attempt, active frozen
generation and digest, installed Policy, canonical Check Specification,
obligation, producer identity, and bounded environment identity. An admitted
`TEST_RESULT` Evidence record repeats the exact Verification Obligation ID in
its immutable semantic identity; a matching Check Specification alone cannot
make one result satisfy a different obligation. Runner output is untrusted and
in M1 may report only one closed result status. It cannot choose a command
identity, producer identity, Evidence identity, obligation or Check
Specification identity, observation detail, digest, eligibility, acceptance
outcome, or authoritative time. Request-aware Runtime admission derives the
canonical producer, check binding, and typed observation from the already
validated request. The Runtime records the invocation start and end around the
Verification port call; runner output cannot advance the Workflow clock or
author Evidence timestamps.

Before admission, the Runtime and Store revalidate the active Attempt, frozen
Candidate, exact digest, Policy, Check Specification, and obligation. A valid
submission atomically records:

- the immutable Evidence record;
- initial `ELIGIBLE` version 1;
- the terminal Attempt result and resulting Workflow state;
- Evidence, Attempt, and Workflow audit events; and
- the Store-authored processed-command outcome.

`PASS`, `FAIL`, `RUNNER_ERROR`, and `TIMEOUT` are observations. None grants
Acceptance authority. Malformed, oversized, late, or exception-producing
output admits no Evidence and terminates with a closed Runtime-owned reason
code. Raw runner diagnostics are not authoritative persistence data.

### Use canonical Evidence identity and monotonic eligibility

Slice 5 implements the ADR 0006 Evidence projections. Runtime and Store each
recompute `observationDigest` and `recordDigest`; caller-authored digest fields
are never trusted. The M1 fake verifier returns only a closed result status,
not observation fields or payload digest claims. The Runtime constructs and
hashes the canonical persisted observation and uses that digest as the fake
Evidence payload reference; later real adapters require a CodeClosure-owned
content-addressed payload store. Payload references use exact content digests
and canonical ordering. The record projection includes the Verification
Obligation ID for `TEST_RESULT` Evidence.
`CANDIDATE_FREEZE` Evidence MUST NOT carry one.

This completes the initial M1 Evidence v1 projection before any Slice 5
Evidence authority is retained. Migration refuses all older placeholder
Evidence rows rather than interpreting them under the completed projection, so
no historical v1 record is silently rehashed or reinterpreted contrary to ADR
0006.

Evidence records are immutable. Eligibility is separate append-only history:
version 1 is `ELIGIBLE`, and the only later state is one audited
`INELIGIBLE` version. It never returns to eligible. Candidate drift invalidates
all still-eligible source-dependent Evidence for that generation in the same
Candidate-integrity transaction.

An Evidence Set is an immutable, canonical record containing exact Evidence
record digests and eligibility versions/states. Slice 5 persists the complete
set, not only its digest, so Slice 6 can construct and replay an Acceptance
Input Manifest without inferring historical selection. Canonical selection maps
Evidence only to its recorded Verification Obligation; sharing a Check
Specification does not merge obligation authority.
The exact one-obligation-per-required-criterion rule is independent of database
or identifier ordering; collection position does not establish the mapping.
One Evidence record cannot be reused under multiple obligation mappings. Both
the Runtime transition and Store commit rebuild the canonical set from current
obligations and Evidence authority and require exact equality, not only a valid
digest or current eligibility version.

Clarification recorded 2026-07-28: every Goal MUST contain at least one
required criterion, so every M1 Candidate generation has a non-empty required
obligation set. An empty Evidence Set cannot satisfy evidence accounting by
vacuous truth. This clarifies the existing fail-closed mapping decision; it does
not add a second completion authority.

### Keep application command authority Workflow-coordinated

Candidate creation, freeze, drift handling, Evidence recording, and dependent
eligibility invalidation occur only as effects of admitted internal Workflow or
Attempt commands. They use the existing application `CommandId` idempotency
domain, expected Workflow version, and Store-authored outcome semantics.

Candidate generation version is additionally revalidated for every lifecycle
change. It does not become a second Workflow clock, and no public Candidate or
Evidence mutation surface is introduced in M1.

### Fail closed on retained placeholder authority

The Slice 5 migration and Store startup validate Candidate, generation,
obligation, Evidence, eligibility, Evidence Set, and newly permitted Candidate
Context records through their owning codecs and relationship rules.

SQLite validity triggers use positive predicates and coerce SQL `NULL`/unknown
to invalid. The Slice 5 replacement for the Context source trigger preserves
the earlier entry kind and `authorityClass` rules while adding exact Candidate
binding. Extending a trigger cannot discard constraints owned by the prior
schema.

Retained rows that lack the new Candidate root, exact digests, audit linkage, or
source bindings cannot be safely inferred. Migration MUST fail without partial
application. Development data may be deliberately recreated only after
inspection.

## Consequences

- `PLAN -> IMPLEMENT` cannot leave a Workflow pointing at a nonexistent or
  caller-selected generation.
- Candidate Context gains a real source owner while all still-unowned Context
  classes remain closed.
- A coding Worker cannot act as its own verifier, freeze authority, or Evidence
  store.
- Candidate drift cannot coexist with still-eligible Evidence after a committed
  transaction.
- Freeze and verification failures have explicit Attempt/Workflow outcomes
  rather than successful-looking phase guards.
- SQLite, alternative Stores, Runtime services, and restart share one
  Candidate/Evidence contract.
- M1 still proves only deterministic logical source and fake verification. It
  makes no claim about real filesystem isolation or real project correctness.
- Acceptance issuance and closeout remain Slice 6 work.

## Rejected alternatives

- **Let the phase requester supply a prepared generation ID.** Rejected because
  an identifier does not prove creation, ownership, state, or source identity.
- **Trust Candidate/Evidence PASS guards from the generic evaluator.** Rejected
  because it creates a second, self-attested authority path.
- **Use FakeWorker to emit privileged verification Evidence.** Rejected because
  implementation and verification would share one producer and the Worker
  could approve its own claim.
- **Freeze by storing one caller-provided digest.** Rejected because it does not
  prove stability over the freeze observation window.
- **Invalidate Candidate and Evidence in separate commands.** Rejected because a
  committed interval could expose invalid source with eligible Evidence.
- **Store only an Evidence Set digest.** Rejected because historical selection
  and eligibility versions could not be replayed from the digest alone.
- **Silently populate Candidate roots or Evidence digests during migration.**
  Rejected because migration would invent authority absent from retained data.

## Validation

M1 tests MUST prove:

- Candidate root/generation creation, Workflow selection, audits, and command
  outcome are atomic and survive reopen;
- the caller cannot choose or reuse a generation and another Goal/Workflow
  cannot bind it;
- Candidate Context is admitted only for the exact active `MUTABLE` generation
  and `baseDigest`, while every ADR 0015 external source remains prohibited;
- `MUTABLE -> FREEZING -> FROZEN` is irreversible and each boundary is
  transactionally coordinated with Workflow/Attempt state;
- unstable freeze observations invalidate the generation and admit no freeze
  Evidence;
- a later frozen-source mismatch invalidates all dependent eligibility in the
  same transaction;
- Worker output cannot be decoded or stored as privileged Candidate Manager or
  Verification Runner Evidence;
- Evidence observation and record digest drift, payload mismatch,
  cross-generation or cross-obligation binding, stale Policy/check identity,
  duplicate Evidence reuse, forged producer/check fields, and malformed runner
  output fail closed;
- Candidate Source, Verification Runner, and Worker exceptions or injected
  sensitive fields persist only closed reason codes, never raw diagnostic text;
- Evidence creation, initial eligibility, audits, Attempt result, and Workflow
  result roll back together at every injected failure point;
- eligibility is monotonic and an older Evidence Set fails currency checks
  after invalidation;
- a Goal with no required criterion, a zero-obligation Evidence Set, and an
  audited row with missing JSON or nullable authority fields all fail closed;
- the extended Candidate Context trigger retains the earlier entry kind and
  authority-class restrictions;
- retained Candidate/Evidence/Context corruption is rejected on migration or
  reopen; and
- no Slice 5 path issues `ACCEPT`, enters `CLOSEOUT`, edits a real project, or
  imports Codex.
