# M2 Slice 2 Codex Worker Adapter Review

- Review date: 2026-07-31
- Scope: M2 Slice 2 only
- Status: Complete
- Verdict: `PASS`; the Goal-bound Codex Worker Adapter satisfies the bounded
  Slice 2 exit contract and Slice 3 may begin

## Review question

This review asks whether CodeClosure has one fail-closed adapter that translates
an exact current `IMPLEMENT` `WorkerRequest` and Runtime-issued external
execution directive into one bounded Codex App Server Thread/Turn and at most
one existing closed-schema Worker event, without acquiring Workflow,
Candidate, Store, Evidence, Acceptance, or Intake authority.

It does not assess real Candidate creation, external-execution persistence,
real verification, repair orchestration, restart recovery, trusted CLI
composition, a live Goal-bound edit, M2 milestone exit, Goal Intake, or
authority to merge, release, deploy, or perform another external effect.

## Authority and source identity

The review applies the repository authority order, accepted ADR 0028 and ADR
0029, the
[Slice 2 contract](../plans/m2-codex-vertical-slice.md#slice-2--goal-bound-codex-worker-adapter),
and the Worker Adapter cases in the
[M2 acceptance plan](../plans/m2-acceptance-plan.md#worker-mapping-and-authority).
Slice 1 was already committed on `main` as
`980d7ebf7922c7a0cf336f48466889e6f13e6d86` before Slice 2 began.

The reviewed working tree has this source identity when this review file alone
is excluded to avoid self-reference:

```text
Base Git revision: 980d7ebf7922c7a0cf336f48466889e6f13e6d86
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 883
Source manifest digest: sha256:5af14f7556d2f2486b0b1c6af8e7a696b51b9258c67a7504a114145e84572f0e
Self-referential review exclusion: docs/reviews/m2-slice2-codex-worker-adapter.md
```

The closing quality gate and this review use the same non-review source
identity. A later commit hash may package this exact tree, but is not itself
part of the Slice 2 technical verdict.

## Adapter and dependency boundary

The new `@codeclosure/adapter-codex` production package depends only on the
version-bound `@codeclosure/codex-app-server-client` and the public
`@codeclosure/runtime` Worker contract. Its production source does not import
Domain, Store, testing, CLI, generated protocol subpaths, Runtime internals,
Candidate mutation, Acceptance, or Intake capabilities. The dependency audit
checks both the declared graph and exact production import surface.

The lower client remains free of CodeClosure authority dependencies. Slice 2
adds only protocol-neutral lower-client utilities: safe launch-summary binary
and snapshot identities, public bounded JSON parsing, and a validated JSON
container conversion for the generated protocol shape. Its original 40-case
suite plus the conversion regression remain green as 41 cases.

The adapter is intentionally bound to one immutable external-execution intent
and is single-use. Reuse cannot become an implicit redispatch, retry,
replacement Thread, or continuation. A later composition layer must provide a
fresh adapter only after the Runtime has durably authorized the corresponding
dispatch and external-execution intent.

## Exact execution input

Before process launch, the adapter revalidates the current Worker Request and
requires exact agreement on Goal revision, Workflow/version, phase, Attempt,
Worker Session, Context Manifest and package, Execution Profile, Policy, and
Candidate generation/digest. Only the selected `IMPLEMENT` capability grant and
`COMPLETION_REQUEST` response kind are backed in Slice 2; another phase fails
before spawn.

The already-resolved protocol-neutral Candidate workspace lease binds:

- Goal, Workflow, Candidate, generation sequence/version/parent, and current
  mutable access;
- source-tree and Git-metadata identities;
- owned workspace root and exact generation root;
- source and other forbidden roots;
- exact allowed paths and reserved-path policy digest;
- issue time, lifecycle, retention, state, version, and lease digest.

Construction and the pre-spawn check reject a missing, linked, non-directory,
escaped, forbidden, source-project, state-root, stale, or internally
inconsistent lease. Slice 2 consumes this lease contract but does not create,
persist, revoke, freeze, repair, or clean a Candidate; those responsibilities
remain Slice 3 and later Runtime work.

The execution directive additionally binds the verified binary and protocol
snapshot, environment-name allowlist, canonical non-secret environment
projection, controlled state root, managed requirements, full effective
configuration, permission profile, instruction source manifest and current
file bytes, model/provider/tier/effort, prompt profile and size, approval and
network policy, disabled integrations, exact fresh/resume directive,
compaction, retention, timeout, and fail-closed fallback. Any observed mismatch
blocks the Turn rather than becoming Context.

The non-secret environment projection binds the exact controlled `CODEX_HOME`,
`HOME`, `TMPDIR`, `PATH`, locale, terminal, and color-policy values while
retaining only secret environment names. The Adapter rechecks that the three
controlled host roots remain real, distinct, and outside the Candidate,
workspace, source, and other forbidden roots before process launch. Secret
values do not enter the projection, directive, observation, or review.

## Thread, Turn, and output boundary

One Worker invocation performs one initialization, three effective-input reads,
one exact fresh or explicitly authorized resume request, and one Worker Turn.
The Turn uses the Candidate root as cwd and sole writable sandbox root, disables
Candidate command network, uses `never` approval with user routing, sends the
current canonical Context Package, and supplies a closed JSON Schema. There is
no `turn/steer`, manual Compact, hidden retry, second Turn, fallback model, or
replacement Thread path.

Every observed Thread/Turn, Item, approval, compaction, and terminal reference
must bind the one selected backend session and operation. Plans, diffs, command
results, deltas, reasoning, and passing-looking output remain diagnostic. MCP,
dynamic tool, hook, app, plugin, skill, Web Search, subagent, settings-reroute,
or other unselected activity fails closed. Command and file approval requests
are decoded, bound, declined exactly once, and prevent a Worker result.

One shared closed Item policy is applied both to lifecycle notifications and
the terminal Item set. Each selected Item variant is decoded through exact
top-level and nested fields rather than admitted by its `type` string alone.
The current user-message variant must bind the exact submitted prompt; plugin
commands, skill or local-media inputs, memory citations, non-agent command
sources, terminal `inProgress` effects, malformed known variants, and unknown
variants fail closed. An Item outside that policy fails even when it appears
only in the terminal payload, so a future or malformed Item cannot silently
inherit authority from an otherwise valid final message.

`turn/completed` is insufficient. A successful Worker result additionally
requires exactly one final agent message, an explicit `itemsView: full`, a
successful terminal status with no error, bounded duplicate-key-safe JSON,
exact execution bindings, no unknown fields, and the permitted phase result codec. Free-form
“done,” model-authored `ACCEPT`, a plan-only response, wrong bindings, wrong
phase, multiple final messages, unsupported Items, malformed content, no
terminal, or a split Thread/Turn emits no Worker result.

After a clean App Server shutdown, the adapter emits at most one existing
`WorkerEvent`. It reuses the M1 request binding and response-size checks. A
controlled shutdown continues draining and validating stdout until the owned
child closes, so a queued duplicate terminal cannot be hidden by the shutdown
boundary. A
backend-failed terminal maps only to the existing generic backend Worker
failure; protocol, invalid-terminal, and no-terminal paths remain eventless so
the unchanged M1 coordinator applies its established port-failure rules.
Worker event identity is derived from the exact request, external intent, and
lease, independently of backend Thread/Turn identity. Thus exact event replay
is byte-identical while a changed payload under the same identity remains a
conflict for ADR 0025 admission.

## Bounded observations and cancellation

The public adapter observation contains only the external-intent and lease
identities, opaque bounded backend session/operation references, lifecycle
state, typed failure code, event identity when present, and aggregate counts.
It does not retain prompt text, final response text, plans, diffs, command
output, reasoning, private reasoning Items, opaque compaction content,
credentials, or environment values.

Host cancellation before a known Turn produces no event. Cancellation while a
known Turn is still in flight sends exactly one bounded `turn/interrupt`,
accepts no late result, and shuts down the owned child. Cancellation observed
after a terminal payload but before Worker-event admission suppresses that
event and records `HOST_CANCELLED` without trying to interrupt an already ended
Turn. Process exit, clean-shutdown failure, effective-input drift, declined
approval, compaction under the unselected policy, and unsupported backend
activity remain distinct adapter observation classes without creating a second
authoritative Runtime failure taxonomy.

## Deterministic evidence

The fake App Server suite has 40 zero-skip cases. It proves:

- exact happy-path and diagnostic-rich `IMPLEMENT` result projection;
- rejection of free-form done, fabricated Acceptance, plan-only, wrong-binding,
  wrong-phase, multiple-final, missing-full-view, known unsupported Item,
  lifecycle-visible unknown Item, terminal-only unknown Item, plugin-backed
  command, skill-bearing or prompt-mismatched user message, malformed known
  Item, terminal in-progress effect, and no-terminal responses;
- pre-Turn rejection of configuration, managed-requirements, permission-profile,
  instruction-source, non-secret environment, and exact or overlapping
  Candidate/source/controlled-root drift;
- exact Thread/Turn correlation, duplicate-terminal rejection, explicit resume,
  one-Turn/no-retry behavior, and request-bound event replay/conflict identity;
- fail-closed settings changes, compaction, approval, process exit, backend
  failure, adapter reuse, pre-terminal and post-terminal/pre-admission
  cancellation, stale lease, source/state-root/launch drift, and poisoned
  environment-name projection; and
- observation redaction of transcript, plan, command output, and reasoning.

The tests use only disposable temporary directories and a local fake process.
Slice 2 performs no live model request; the bounded Slice 1 live compatibility
proof remains its version/protocol entry evidence.

## Closing executable evidence

The final `pnpm gate:quality` passes with no failed, cancelled, skipped, or
todo case:

| Stage | Result |
| --- | --- |
| documentation tests and structural check | `75/75`, 58 documents |
| CLI/dependency boundary tests | `24/24`, seven workspace packages |
| runner and Slice 0 probe tests | `7/7` |
| Slice 1 lower-client tests | `41/41` |
| Slice 2 adapter tests | `40/40` |
| M1 package unit regression | `136/136` |
| digest tests | `36/36` |
| migration tests | `99/99` |
| authority tests | `244/244` |
| CLI integration | `58/58` |
| M1 adversarial demonstrations | `8/8` |
| Runtime Invariant coverage | `31/31` |

Formatting, strict typecheck, deterministic protocol-snapshot regeneration,
package and CLI dependency audits, documentation checks, and forced production
build also pass. The invariant audit inspected 38 test sources and 380
metadata-bearing executable tests; the new adapter cases contribute coverage
to I-004, I-019, I-021, and I-027.

## Documentation and architectural review

The root README, Architecture status, Domain status, Workflow status, Context
Compiler status, M2 milestone, implementation plan, acceptance-plan status,
review index, and ADR index were reviewed together. No accepted architectural
decision changed, so no new ADR is required. Slice 2 implements the separation
and Runtime-owned external-execution direction already fixed by ADR 0028 and
the lease-consumer boundary fixed by ADR 0029.

No new Runtime Invariant is required because the adapter adds no Domain,
Workflow, Store, Candidate, Evidence, Acceptance, or Goal authority. Its tests
add executable coverage to existing invariants I-004, I-019, I-021, and I-027.
M0/M1 history and the Goal Intake/M2.5 boundary remain unchanged.

## Verdict, limitations, and next action

Every bounded Slice 2 exit condition passes. Slice 2 is implemented and Slice
3 may begin.

This verdict does not prove a real or persisted Candidate workspace, Runtime
external-execution record, Execution Profile version 2 installation, Store
migration, real verifier, repair/accept orchestration, restart/resume
reconciliation, trusted CLI composition, live Goal-bound edit, M2 milestone
exit, or Goal Intake. The adapter's resume and lease inputs are strict consumers
of Runtime-issued projections; their authority production and persistence must
not be moved into this package in later slices.
