# ADR 0033: Align protected verification with Start and Check lifecycle

- Status: Accepted
- Date: 2026-08-01

## Context

[ADR 0032](0032-close-bounded-m2-protected-verification-composition.md)
correctly selects one protected Verification Plan, a reconstructible protected-
asset lease, a new isolation-profile version, and a decisive one-family
Evidence Set for bounded M2. Its Plan timing and lease field list do not fully
align with already accepted lifecycle authority.

First, ADR 0022 requires the first successful `StartGoal` to atomically create
the Workflow Policy binding alongside the first Attempt, resulting Workflow,
Context Manifest, Execution Profile binding, audits, and processed command. A
separate protected-plan transaction after Start would introduce a crash-visible
started Workflow whose first Context authority does not yet identify the plan.

Second, Slice 5 configures a generation's local Check and Verification
Obligations while `EVIDENCE_BUILD` is idle and has no active Attempt. Only after
that authority exists does the driver begin the Attempt that runs verification.
ADR 0032 nevertheless places current Workflow version, Attempt, and Obligation
identity inside `ProtectedAssetReadLease`, while the Check must already retain
that lease digest. The digest therefore cannot be constructed at the existing
Check-configuration boundary without reversing Slice 5's accepted ordering.

No ADR 0032 schema has been implemented or persisted. A later accepted record
can correct its planned schema-version-1 projection without reinterpreting
historical data.

## Decision

### Create the protected Plan in the first Start transaction

For a Workflow using the bounded M2 acceptance-critical profile, trusted
composition supplies the installed immutable Policy/Profile inputs from which
Runtime derives the protected-plan proposal. The first successful `StartGoal`
transaction MUST atomically validate and persist:

- the `WorkflowPolicyBinding` and `ExecutionProfileBinding`;
- exactly one `AcceptanceCriticalVerificationPlan` and its creation audit;
- the first Context Manifest and Attempt;
- the resulting Workflow and Goal projections;
- the existing command/audit authority required by ADRs 0014, 0015, 0021, and
  0022; and
- the processed Start command outcome.

The plan's `workflowVersionAtLock` is the resulting Workflow version committed
by that transaction. The protected profile's first Context Manifest MUST repeat
the plan ID/digest. Any dispatch claim created before calling the Worker MUST
bind a Context Manifest containing that exact plan identity.

The transaction either commits the complete protected Start authority or
commits none of it. A Workflow under another installed profile continues to use
its existing Start contract and has no protected plan. A bounded protected
Workflow with no plan is invalid only once Start is attempted or persisted; a
pre-Start Workflow is not corrupt merely because no plan exists yet.

This decision supersedes ADR 0032's separate after-binding/before-dispatch Plan
creation wording and scopes its zero-plan validation to protected Start,
dispatch, Check derivation, Acceptance, and reopen authority.

### Make the protected-asset lease a Check-configuration value

`ProtectedAssetReadLease` is derived while configuring the generation-specific
protected Check in idle `EVIDENCE_BUILD`, before an `EVIDENCE_BUILD` Attempt
exists. Its schema-version-1 canonical projection binds only authority available
at that boundary:

- Goal ID/revision and Workflow ID;
- Candidate generation ID and frozen Candidate digest;
- protected Verification Plan ID/digest;
- protected-asset manifest digest;
- concrete Check Specification ID/version;
- isolation-profile ID/digest;
- access mode `READ_ONLY` and lifecycle policy
  `SINGLE_VERIFICATION_INVOCATION`;
- the ordered protected-asset entries fixed by ADR 0032; and
- `leaseDigest`, computed over every preceding semantic field using the
  repository's canonical digest profile.

The canonical lease MUST NOT contain Workflow version, Attempt ID, or
Verification Obligation ID. Those are invocation and causal-result bindings,
not static protected-file access authority. This field list supersedes ADR
0032's schema-version-1 lease projection.

Runtime allocates the Check ID/version before constructing the complete lease,
then persists the Check with the resulting lease digest and creates its
Verification Obligations through the existing configuration transaction. The
full decoded lease is retained in or deterministically reconstructed for the
active local-verification session and is carried by the later schema-version-3
local verification request.

The later request independently binds the current Workflow version, Attempt,
Verification Obligation, Candidate, Check, Policy, runner, environment, and
complete lease. The version-3 Evidence independently repeats its Attempt and
Obligation identities plus the Check and lease digest. Runtime and Store MUST
cross-check those bindings at request admission, Evidence persistence,
Evidence Set construction, Acceptance, and strict reopen.

Removing invocation fields from the static lease does not authorize replay. A
lease is usable only through the current active verification session, for its
exact frozen Candidate and Check, under one admitted Runtime request. After that
invocation completes or fails, Runtime MUST consume/release the session. A
second Attempt, command replay with another digest, stale Obligation, or late
request requires fresh Runtime authority and cannot reuse the consumed session.

Runtime and Store recompute the historical lease digest from the persisted
Plan, Candidate, Check, Profile, and asset projection. Attempt and Obligation
causality are reconstructed from their separate persisted request, Evidence,
audit, and Workflow authority; they are not inferred from the lease.

## Consequences

- Protected-plan creation extends the existing first-Start atomic boundary
  rather than adding a partially started Workflow state.
- Check configuration can compute the protected lease before an Attempt exists,
  preserving Slice 5's Check-before-Attempt ordering.
- Static asset access and invocation causality remain separately typed and are
  cross-checked where they meet in the verification request and Evidence.
- ADR 0032's Plan cardinality, protected-asset fields, isolation profile version
  2, supplementary-Evidence boundary, and no-separate-lease-table decision
  remain in force.

## Rejected alternatives

- **Create the Plan in a second transaction after Start.** Rejected because a
  crash could retain a started protected Workflow without the Plan identity
  required by its first Context and dispatch boundary.
- **Start the verification Attempt before configuring its Check.** Rejected
  because it reverses the implemented Slice 5 authority ordering and weakens
  the rule that an Attempt cannot begin without selected Check/Obligation
  authority.
- **Keep Attempt inside the lease and write the digest only to Evidence.**
  Rejected because ADR 0031 requires the version-3 Check itself to bind the
  protected lease digest.
- **Persist a second dynamic lease aggregate.** Rejected because the static
  asset projection is reconstructible and the existing Runtime request,
  session, Attempt, and Evidence authority already own invocation causality.

## Validation

Slice 7 implementation and Slice 8 acceptance MUST prove:

- protected first Start commits or rolls back Plan, bindings, first Context,
  Attempt, Workflow, audit, and processed outcome together;
- a protected Start, Context, dispatch claim, Check, Acceptance input, or strict
  reopen with a missing, duplicate, or mismatched plan fails closed, while an
  unstarted Workflow or non-protected profile is not falsely rejected;
- Check and lease construction occur before the `EVIDENCE_BUILD` Attempt and
  the lease projection contains no Workflow version, Attempt, or Obligation;
- the later request and Evidence still reject wrong Workflow version, Attempt,
  Obligation, Candidate, Check, Plan, Profile, or lease identity;
- a consumed, stale, replayed, or late lease/session cannot invoke the Runner or
  create Evidence; and
- strict reopen independently recomputes static lease identity and separately
  proves Attempt/Obligation causality.
