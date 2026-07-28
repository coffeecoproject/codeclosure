# Architecture Decision Records

Architecture Decision Records (ADRs) capture decisions that constrain the
CodeClosure runtime. An accepted ADR is normative unless a later ADR explicitly
supersedes it.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-standalone-product-repository.md) | Build CodeClosure as a standalone product and repository | Accepted |
| [0002](0002-host-runtime-and-codex-adapter.md) | Keep deterministic control in the host runtime and use Codex through an adapter | Accepted |
| [0003](0003-initial-technology-stack.md) | Use a TypeScript, Node.js, pnpm, and SQLite baseline for M1 | Accepted |
| [0004](0004-authoritative-state-and-audit-log.md) | Store authoritative state and its audit trail transactionally | Accepted |
| [0005](0005-isolated-candidate-generations.md) | Execute workers in isolated candidate generations | Accepted |
| [0006](0006-canonical-serialization-and-digest-profiles.md) | Use versioned canonical projections for authority-bearing digests | Accepted |
| [0007](0007-workflow-owned-attempt-lifecycle.md) | Own the M1 Attempt lifecycle inside the versioned Workflow aggregate | Accepted |
| [0008](0008-goal-command-and-lifecycle-boundary.md) | Expose Goal commands while deriving Goal lifecycle from the authoritative Workflow | Accepted |
| [0009](0009-command-idempotency-and-worker-boundary.md) | Separate application-command idempotency from untrusted worker delivery and dispatch | Accepted |
| [0010](0010-command-admission-and-outcome-binding.md) | Centralize command freshness and bind persisted outcomes to their authority target | Accepted |
| [0011](0011-store-authored-command-outcome-semantics.md) | Author command outcomes in the Store and bind them to their transaction semantics | Accepted |
| [0012](0012-causal-control-timestamps.md) | Preserve causal ordering across Runtime, domain, Store, audit, and SQLite timestamps | Accepted |
| [0013](0013-authority-boundary-validation-closure.md) | Close authority validation across Runtime, Store, replay, and persistence | Accepted |
| [0014](0014-context-bound-worker-dispatch-and-event-admission.md) | Bind Worker dispatch and event admission to durable Context authority | Accepted |
| [0015](0015-close-m1-worker-authority-causality.md) | Close M1 Context, Policy, dispatch, identity, and stream causality gaps | Accepted |
| [0016](0016-candidate-and-evidence-authority-boundary.md) | Coordinate Candidate and Evidence authority through source-bound Workflow transactions | Accepted |
| [0017](0017-derive-boundary-authority-and-replay-evidence-by-audit-sequence.md) | Derive external-boundary authority and replay Evidence Sets at their audit sequence | Accepted |
| [0018](0018-deterministic-acceptance-and-closeout-authority.md) | Close deterministic Acceptance, replay, closeout, and repair authority | Accepted |

## ADR lifecycle

- `Proposed`: under discussion and not yet binding.
- `Accepted`: binding for implementation and review.
- `Superseded`: replaced by a named later ADR.
- `Rejected`: considered but not selected.

Editing an accepted ADR to conceal a changed decision is prohibited. Record a
new ADR and mark the earlier record as superseded instead.
