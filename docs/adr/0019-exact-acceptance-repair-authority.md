# ADR 0019: Retain exact Acceptance repair authority

- Status: Accepted
- Date: 2026-07-28

## Context

ADR 0018 made `BeginAcceptanceRepair` an atomic Runtime and Store operation,
but retained only its resulting Workflow and Candidate state plus audit events.
Startup could prove that a `REJECTED` generation had one plausible base-bound
child and that some repairable Acceptance Decision existed. It could not prove
which exact decision and manifest the command consumed, which fresh Checks and
Verification Obligations it granted to the child, or that all of those records
belonged to one compound repair command.

That is weaker than accepted closeout authority. It also makes a successful
commit-time check disappear into an audit payload digest that cannot be decoded
back into the exact repair relationship after restart.

## Decision

Every successful Acceptance repair MUST create one immutable
`AcceptanceRepairRecord`. The rejected Candidate generation is its record
identity and the repair child generation MUST be unique. The record binds:

- the Goal revision and resulting Workflow version;
- the exact `REJECT_REPAIRABLE` Acceptance Decision ID and digest;
- the exact Acceptance Input Manifest digest;
- the rejected Candidate generation, terminal version, and frozen digest;
- the new child generation, sequence, and base digest;
- the fresh freeze and verification Check IDs and versions;
- the ordered fresh Verification Obligation IDs;
- the source Evidence Set and Policy Bundle identities; and
- the single causal repair timestamp.

The Runtime constructs the record only after resolving current Acceptance and
Candidate authority. The record has a canonical `repairDigest`. The Store MUST
independently reconstruct the expected record from current decoded authority,
reject any mismatch, and use `repairDigest` as the common payload digest for
every audit event in the compound repair. The Workflow transition, old
generation rejection, child creation, Check creation, Obligation creation,
repair record, audit set, and processed-command outcome MUST commit in one
SQLite transaction.

SQLite MUST provide relationship checks and immutable-row guards. Startup MUST
decode every repair record, recompute its digest, and prove its exact manifest,
decision, Candidate lineage, Check, Obligation, audit, and processed-command
closure. A `REJECTED` Candidate without exactly one matching repair record, or a
repair record without its complete authority, prevents the Store from opening.

Migration is fail closed. A database that already contains a `REJECTED`
Candidate has no recoverable exact repair binding under the old schema, so the
migration MUST refuse it rather than infer authority from timestamps or nearby
rows.

This is a narrow causality record, not general event sourcing. It does not add
a second Workflow or Acceptance owner, expose a new public command, integrate
Codex, or extend M1 beyond deterministic FakeWorker control.

## Consequences

- Restart validation proves the same exact repair authority that commit-time
  validation consumed.
- A plausible child generation or unrelated repairable decision can no longer
  stand in for the real repair command.
- Fresh implementation capability is traceable to the exact rejection that
  authorized it.
- Existing pre-record repair histories require explicit rebuild or migration
  handling; they are not silently blessed.
- ADR 0018's structural child-only restart rule is superseded by this exact
  repair-record rule. Its other Acceptance and closeout decisions remain in
  force.

## Rejected alternatives

- **Keep only state plus opaque audit digests.** Rejected because the exact
  consumed decision and granted child authority cannot be reconstructed.
- **Infer repair authority during startup.** Rejected because several valid
  repairable decisions or similar child rows can make inference ambiguous.
- **Introduce a generic command journal or full event sourcing.** Rejected as
  unnecessary for M1; the missing authority is one bounded repair relationship.
- **Patch startup with more existence queries.** Rejected because existence is
  not identity and would preserve the underlying modeling gap.

## Validation

Tests MUST prove exact repair round-trip and restart, caller-binding mismatch
rejection, poisoned repair-record and audit rejection, transaction rollback
after the repair-record write, and fail-closed migration of pre-record rejected
history.
