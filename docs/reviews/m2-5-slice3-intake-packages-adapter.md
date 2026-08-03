# M2.5 Slice 3 Intake Packages and Assistant Adapter Review

- Review date: 2026-08-03
- Scope: M2.5 Slice 3 only
- Status: Complete
- Verdict: `PASS` for M2.5 Slice 3 only; Slice 4 has not begun

## Review question

This review asks whether Slice 3 adds deterministic Runtime-owned Intake and
Answer-only packages, durable Manifest construction, and one isolated
read-only, no-authority-effect Codex Intake Assistant Adapter without adding
Coordinator, Admission, Materialization, Start, Goal, Workflow, Candidate,
Evidence, Acceptance, CLI, or persistence authority.

It does not claim that Goal Intake is operational or that M2.5 is complete. It
does not evaluate source binding, construct a Projection, issue an Admission
Decision, persist an assistant response, materialize a Goal, invoke ordinary
`StartGoal`, or add public Intake behavior.

## Source identity

The reviewed working-tree source identity excludes only this review file to
avoid self-reference:

```text
Base Git revision: a44b1201bfdcea6e9fb39f8ac65e42d04ab10bd1
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 964
Source manifest digest: sha256:62aad1b36a302bfaca15a6eece33e9c28d964605cd3b6ac338d3c01f729e19b8
Self-referential review exclusion: docs/reviews/m2-5-slice3-intake-packages-adapter.md
```

The implementation branch is `m2.5-goal-intake`. Final verification uses Node
`v22.22.3`, inside the repository's supported range, and pnpm `11.1.3`.

## Implemented package boundary

Runtime defines fixed M2.5 assistant, adapter, response-contract, model, and
budget bindings. The deterministic compiler accepts exact typed Intake
authority, validates owning codecs and digests, enforces the fixed raw-request,
clarification, Manifest, and package budgets, and emits immutable
`IntakePackage` or `AnswerOnlyPackage` values plus a durable, digest-bound
`IntakeManifest`.

Intent-analysis packages include only the selected Raw Request chain, optional
current Projection, clarification state, declared project reference, Admission
Policy, fixed assistant/profile contracts, and budgets. Answer-only packages
include one exact Raw Request and its prepared
`PRE_ANALYSIS_NO_EXECUTION / ANSWER_ONLY` Decision binding. Neither package
contains a Goal, Workflow, Attempt, Candidate, Evidence, Acceptance, Workflow
Policy, or Execution Profile binding. The compiler does not allocate Proposal,
Source Binding, Projection, ambiguity, Admission, Goal, Workflow, or response
record identities.

## Adapter boundary

`packages/adapter-codex-intake` depends only on the public Runtime contracts and
the lower App Server client. Production adapter source imports only
`node:buffer`, `node:crypto`, `node:fs`, `node:path`, and `node:timers` from
Node. Static dependency checks reject a Worker-adapter dependency in either
direction and reject Store, Domain, Worker, Candidate, Goal, Workflow,
Evidence, Acceptance, CLI, or other forbidden capability imports.

Each adapter instance is single-use and performs at most one controlled process
launch, fresh ephemeral Thread, and Turn. It selects the fixed model/profile,
read-only sandbox with network disabled, no approvals, no ambient instruction
sources, no MCP/apps/plugins/hooks/skills/subagents, no Compact, no Thread
resume, no `turn/steer`, no fallback, and no hidden retry. Operation cwd and
state roots must resolve as real directories, remain separate, and stay outside
every supplied forbidden root and declared project root, including filesystem
aliases. The exact effective configuration must disable the known shell, exec,
browser, computer, image-generation, extension,
collaboration, and external-integration capability sources before Thread
creation. Its canonical `selectedAuthorityCapabilities: []` describes
CodeClosure grants, not the App Server's model-visible tool inventory.

The adapter validates the closed package/profile/Manifest bindings before
launch, checks managed requirements and the permission profile before Thread
creation, rechecks the exact effective configuration after Thread creation, and
rejects Thread/Turn identity drift. It accepts one terminal completed agent
message and strictly decodes only the operation-specific wire values. Duplicate
keys, unknown fields, invalid UTF-8, non-integer spans, invalid item indexes,
and wire, canonical, collection, or retained-content budget overflow reject the
complete response.

Unexpected Compact, Thread loss or replacement, model rerouting, observed tool
items, server requests, malformed streams, missing or invalid terminal output,
timeout, cancellation, process exit, spawn failure, and shutdown failure return
only a closed typed observation. No raw exception, unrestricted transcript,
private reasoning, or assistant-authored authority enters the result. An
observed tool Item interrupts the known Turn and discards its response. This is
defense in depth; it is not proof that a tool was unavailable before selection
or effect.

## Architectural resolution

The pinned Codex `0.146.0` feature registry exposes configuration switches for
the default shell tool and unified exec, and both are now explicitly disabled
by the adapter profile. The tagged core tool planner confirms that this removes
the shell branch. It separately registers `apply_patch` whenever the selected
model and environment support it, and registers `view_image` whenever a Turn
environment exists. Those registrations are outside the shell feature branch.
See the pinned upstream
[feature registry](https://github.com/openai/codex/blob/rust-v0.146.0/codex-rs/features/src/lib.rs#L800-L843)
and
[tool planner](https://github.com/openai/codex/blob/rust-v0.146.0/codex-rs/core/src/tools/spec_plan.rs#L3395-L3660).

The pinned local
[`TurnStartParams`](../../packages/codex-app-server-client/src/protocol/v2/TurnStartParams.ts)
has no `tools` or equivalent empty-capability field. The earlier Slice 3 review
therefore correctly withheld a tool-free claim: a tool Item notification is too
late to establish pre-effect denial.

The explicit product decision in
[ADR 0035](../adr/0035-bound-intake-by-non-authoritative-effects.md) resolves
that conflict without enabling unrestricted tools. M2.5 now claims that the
Adapter receives no CodeClosure authority/effect port and runs inside an
isolated read-only, network-denied envelope. It does not claim an empty
model-visible tool inventory. Configurable capability sources remain disabled;
an observed upstream built-in tool Item interrupts and fails the operation,
and its output cannot enter Intake authority. Project-assisted Intake remains
deferred to a separately governed read-only observation port.

## Boundary review

Codex protocol types remain outside Domain and Runtime public semantic records.
The new adapter does not import either the Goal-bound Worker adapter or any
Worker request type. Runtime remains the package owner; the assistant returns
only untrusted proposal or answer wire values. Only the future Coordinator may
allocate retained record identities and construct source-bound projections;
only the deterministic Admission Engine may issue Admission; existing owners
remain exclusive for Goal, Workflow, Start, Candidate, Evidence, and technical
Acceptance.

The root README, Architecture status, Goal Intake, Domain Model, Context
Compiler, Workflow, Acceptance Engine, Evidence Model, ADR index, milestone,
and implementation/acceptance plans were reviewed. The first five and the
current plan/milestone status required implementation-status updates. Workflow,
Acceptance, and Evidence remain correct without semantic change. ADR 0027, ADR
0028, ADR 0034, and the newly accepted ADR 0035 govern the implemented
boundaries; the ADR index records that new decision.

## Verification

`corepack pnpm gate:quality` exited zero against the source identity above under
Node `v22.22.3` and pnpm `11.1.3`. It recorded 75/75 documentation-structure
tests over 75 Markdown sources, the exact Codex `0.146.0` protocol snapshot,
28/28 boundary/dependency tests over 832 JavaScript/TypeScript sources, 329/329
staged unit tests, 44/44 digest tests, 99/99 migration tests, 393/393 authority
tests, 62/62 CLI integration tests, 8/8 adversarial demos, 4/4
invariant-checker tests with 32/32 invariant coverage, and the final clean
production build. Every invoked Node test stage reported zero failed,
cancelled, skipped, and todo tests.

The unit total includes the 26/26 fake App Server adapter suite and seven
deterministic package/compiler tests. Adapter cases cover successful distinct
analysis and Answer-only operations; fresh-process cardinality; single-use
retry denial; complete Manifest and package recompilation before launch;
digest-valid Manifest-entry and recomputed outer-digest substitution;
capability-configuration drift; real-directory alias and
cwd/state/project-root isolation; Compact; Thread loss/mismatch; server
requests; model rerouting; observed tool interruption;
malformed/invalid-UTF-8/duplicate-key/unknown/oversized responses; non-integer
and item-index rules; request timeout; running Turn Abort and interrupt;
process exit; and spawn failure. The root `test:unit` stage invokes this suite
directly. The final review-bearing Markdown tree was rechecked after this
review was completed.

The complete gate requires Darwin child-process identity inspection. Its
sandboxed attempt failed at that environmental boundary; the same exact gate
was rerun with process inspection available and exited zero. This does not
alter the review verdict. Slice 3 does not make a tool-free Turn claim under ADR
0035.

## Remaining boundary

Slice 3 is implemented. Slice 4 is the next planned boundary and has not begun.
This review adds no Coordinator, Admission evaluator, Projection construction,
Slice 5 restart/retention behavior, Slice 6 Materialization or Start
composition, Slice 7 CLI/acceptance behavior, or M2.5 milestone verdict. Any
future permission for Intake project observation or a useful tool requires a
new versioned profile and architectural review.
