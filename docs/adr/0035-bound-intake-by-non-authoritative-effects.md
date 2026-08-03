# ADR 0035: Bound M2.5 Intake by non-authoritative effects

- Status: Accepted
- Date: 2026-08-03

## Context

M2.5 uses the pinned Codex App Server `0.146.0` for one pre-Goal Intent-analysis
or Answer-only operation. The accepted Intake boundary grants the assistant no
Store, Goal, Workflow, Candidate, Admission, Start, Acceptance, or external-
effect authority and does not require project exploration.

The pinned App Server can disable shell, exec, Web Search, MCP, apps, plugins,
skills, subagents, and other configurable capability sources. Its
`turn/start` contract cannot, however, supply or prove an empty model-visible
tool inventory. Codex may independently register built-in tools such as
`apply_patch` or `view_image`. Their selection can be observed only after the
Turn has begun, so rejecting the resulting Item cannot prove that no tool was
selected or that no read-only observation preceded notification.

Requiring an unprovable empty tool inventory blocks the otherwise bounded
adapter without protecting a CodeClosure authority boundary. Allowing ambient
or unrestricted tools would instead grant capabilities unrelated to Goal
Intake and would weaken the product boundary.

## Decision

### Define the Intake capability claim at the CodeClosure authority boundary

The M2.5 Intake assistant profile selects no **CodeClosure authority
capabilities**. Its canonical profile field is
`selectedAuthorityCapabilities: []`; this means that CodeClosure supplies no
Store mutation, Goal or Workflow operation, Candidate write, WorkerPort,
Admission, Start, Acceptance, or external-effect port. It does not claim that
the App Server presented an empty model-visible tool inventory.

The profile records
`effectPolicy: ISOLATED_READ_ONLY_FAIL_ON_TOOL_OBSERVATION`. The Intake Package
and Manifest remain the only intended operation input. Assistant output remains
untrusted proposal or Answer-only content and cannot authorize or directly
persist any control record.

### Contain the operation independently of model behavior

Each operation MUST retain the following envelope:

- one controlled process, one fresh ephemeral Thread, and one bounded Turn;
- a CodeClosure-owned operation cwd and state root that are absolute, distinct,
  and outside every project, Candidate, authority, credential, or other
  forbidden root supplied by trusted composition;
- a read-only sandbox, network disabled, approval policy `never`, and no
  ambient instruction sources;
- explicit disabling of configurable shell, exec, Web Search, MCP, apps,
  plugins, hooks, skills, subagent, browser, computer-use, image-generation,
  collaboration, and external-integration sources;
- no project or Candidate content placed in the operation cwd and no Store,
  Worker, Goal, Workflow, Candidate, Evidence, Acceptance, or CLI dependency in
  the adapter; and
- strict package/Manifest closure, output schema, byte budget, identity, and
  lifecycle validation before any result is returned.

Trusted composition MUST supply all relevant forbidden roots. A missing,
overlapping, relative, or otherwise unprovable root relationship fails before
the Thread begins. This filesystem envelope prevents authoritative mutation;
it is not proof that an upstream built-in tool was absent.

### Treat observed tool use as a failed Intake operation

The developer instruction continues to tell the assistant not to invoke tools.
That instruction guides behavior but is not the enforcement boundary.

If the adapter observes any command, file-change, image, MCP, dynamic-tool, or
other non-message/non-reasoning Item, it MUST:

1. classify the operation as `ASSISTANT_PROTOCOL_ERROR`;
2. interrupt the known active Turn when possible;
3. discard every assistant response from that operation; and
4. shut down the owned process without creating Intake authority.

This is defense in depth after observation. M2.5 explicitly does not claim
pre-selection tool denial. Tool output, tool-authored files, transcript state,
and a successful backend Turn cannot become Source Binding, Projection,
Admission, Goal, Workflow, Evidence, Acceptance, or completion authority.

### Keep project-assisted Intake out of M2.5

This decision does not enable project exploration. A request that actually
requires repository inspection follows the existing governed read-only Goal
path or another deterministic non-execution disposition. A future Intake
project-observation port requires its own exact read capability, budgets,
provenance, audit, and policy; ambient App Server tools cannot substitute for
that port.

## Consequences

- Slice 3 can be evaluated against enforceable isolation and authority claims
  without claiming an App Server feature the pinned protocol does not expose.
- A built-in tool may be visible or selected upstream, but an observed attempt
  fails the complete operation and contributes no authoritative result.
- The Intake boundary remains narrower than the Worker boundary: no source
  write, command execution, network, project observation, or control mutation
  capability is granted by CodeClosure.
- The model-visible tool inventory remains an upstream implementation detail
  and a recorded limitation of the bounded profile.
- Any later decision to permit a useful Intake tool or project observation
  requires a new versioned profile and architectural review.

This ADR refines the M2.5 assistant-profile and tool-absence details in ADR
0027 and the M2.5 plans. It does not change ADR 0027's Admission,
Materialization, or Start owners, ADR 0028's lower-client separation, ADR
0034's pre-Goal command authority, or any M1/M2 Worker capability.

## Rejected alternatives

- **Permit Codex tools without restriction.** Rejected because Goal Intake does
  not need repository mutation, command, network, or external-integration
  capability and unrestricted tools would widen both effect and privacy risk.
- **Continue requiring proof of an empty model-visible tool set.** Rejected for
  the pinned App Server because the public Turn contract cannot express or
  attest that condition.
- **Treat post-observation rejection as proof that no tool ran.** Rejected
  because notification ordering does not establish pre-effect denial.
- **Switch directly to another provider transport or fork Codex.** Rejected for
  M2.5 because the bounded authority/effect contract can be enforced without
  changing the accepted App Server architecture.
- **Accept tool-produced observations as Intake provenance.** Rejected because
  ambient tool output has no dedicated project identity, read policy, budget,
  Source Binding, or audit authority.

## Validation

M2.5 tests MUST prove:

- the canonical assistant profile names no CodeClosure authority capability and
  does not claim an empty model-visible tool inventory;
- effective configuration keeps every configurable capability source disabled,
  the Thread/Turn read-only, network disabled, approval-free, ephemeral, and
  free of ambient instruction sources;
- operation cwd/state roots are separated from declared project and every
  trusted forbidden root before Thread creation;
- an observed tool Item interrupts the known Turn, fails the operation, and
  returns no assistant response or authority value;
- package, Manifest, response, lifecycle, timeout, interruption, process, and
  retry failures remain closed and bounded; and
- dependency checks continue proving that the adapter has no Store, Worker,
  Candidate, Goal, Workflow, Evidence, Acceptance, CLI, or other authority
  capability.
