# ADR 0022: Bind one immutable Policy identity to each started Workflow

- Status: Accepted
- Date: 2026-07-29

## Context

Policy Bundles are installed immutably and Context, Evidence, Acceptance, and
closeout records carry a Policy ID and digest. However, installation identity
and per-record references do not by themselves answer a Workflow-level
question: which exact Policy owns every control decision for this Workflow?

Before this decision, a restarted Runtime could be composed with Policy B
after Policy A had governed the first Attempt. Each newly produced record could
be internally valid under B while the Workflow silently changed transition,
capability, evidence, or acceptance semantics. The immutable Execution Profile
binding cannot close that gap because executable adapter identity and control
Policy identity are separate authorities.

## Decision

The first successful `StartGoal` MUST atomically create one immutable
`WorkflowPolicyBinding` alongside the first Attempt, resulting Workflow state,
Context Manifest, Execution Profile binding, audits, and processed command.
The binding records:

```text
schemaVersion
goalId
workflowId
policyBundleId
policyBundleVersion
policyBundleDigest
startCommandId
boundAt
bindingDigest
```

Policy installation and Workflow Policy binding remain separate. Installation
proves that canonical Policy content is trusted and available; the Workflow
binding selects that exact installed identity for the lifetime of one
Workflow.

Every later Runtime operation that can advance or evaluate the Workflow MUST
resolve the persisted binding and compare both Policy ID and digest with the
trusted Runtime composition before planning a mutation. Context, Worker
dispatch, Worker event admission, Evidence, Acceptance input, closeout, repair,
status, driver, and recovery authority MUST agree with the binding. A missing
installed Policy, missing binding, digest mismatch, or incompatible Runtime
composition fails closed before recovery or continuation can mutate state.
Cancellation remains available through its narrow Policy-independent public
capability.

`StartGoal` command identity includes the selected Policy ID and digest.
Replaying that command under another Policy therefore conflicts instead of
reinterpreting the old command. `ResumeGoal` performs Policy compatibility
preflight before it invokes recovery, so a mismatched process cannot first
change a blocked Workflow and only then discover the mismatch.

The binding is immutable and has one matching audit event. SQLite guards and
Store reopen validation backstop all explicit Policy-bearing records. A future
Policy upgrade for an existing Workflow requires a separate explicit product
decision and authority model; M1 performs no automatic or inferred upgrade.

The development migration may retain never-started Workflows, which acquire a
real binding on their first future Start. It MUST atomically refuse any legacy
execution history whose original Workflow Policy cannot be proven. It does not
infer a Policy from a Context row, the currently installed default, an
Execution Profile, or later Evidence.

Driver process summaries are not authority. After an operation limit or a
concurrent command rejection, the driver reloads persisted authority and gives
terminal or decision state precedence over its local stop condition. This
prevents an informational summary from reporting a pre-commit snapshot after
another valid operation has already advanced or closed the Workflow.

## Consequences

- Restart, resume, and local Policy installation cannot silently change the
  semantics of an existing Workflow.
- Execution Profile and Policy remain independently inspectable identities.
- First Start gains one more atomic authority record and audit event.
- Legacy started development databases without the binding are intentionally
  refused rather than guessed or rewritten.
- Status can show the exact Policy ID, version, and digest selected by the
  Workflow.

## Rejected alternatives

- **Treat the current installed Policy as the Workflow Policy.** Rejected
  because process configuration is mutable and is not historical authority.
- **Put Policy identity inside the Execution Profile binding.** Rejected
  because adapter compatibility and control semantics have different owners
  and future versioning boundaries.
- **Infer the binding from retained Context or Acceptance records.** Rejected
  because partial or contradictory history cannot prove the Policy that owned
  every earlier transition.
- **Automatically upgrade a Workflow when a new Policy is installed.**
  Rejected because this silently changes completion and capability rules.

## Validation

Tests MUST prove atomic binding rollback at every binding write boundary,
canonical digest and audit closure after reopen, refusal of ambiguous legacy
started authority, safe upgrade of unstarted authority, Context/Evidence/
Acceptance agreement, Start replay conflict under another Policy, Resume
preflight before recovery, dispatch and Worker-result refusal under a
substituted Policy, exact driver summaries at every operation boundary, and
fresh final state after a concurrent command winner.
