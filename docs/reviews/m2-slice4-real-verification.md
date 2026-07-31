# M2 Slice 4 Real Verification Review

- Review date: 2026-07-31
- Scope: M2 Slice 4 only
- Status: Complete
- Verdict: `PASS`; the bounded local-command verifier and Evidence persistence
  seam satisfy the Slice 4 exit contract and Slice 5 may begin

## Review question

This review asks whether CodeClosure has one real local command-check path that
can execute an exact bounded command against a frozen Candidate, deny mutation
and control-state access, return only an untrusted process observation, derive
passing or failing Evidence in Runtime, and atomically persist retained payload
bytes with the corresponding authority.

It does not assess Worker-to-verifier orchestration, deterministic rejection and
repair, technical Acceptance or closeout, external-execution persistence,
restart recovery, trusted CLI composition, a live Codex edit, cross-platform or
arbitrary-project verification, M2 milestone exit, Goal Intake, or authority to
merge, release, deploy, or perform another external effect.

## Authority and source identity

The review applies the repository authority order, ADR 0005, ADR 0006, ADR
0016, ADR 0030, the
[Slice 4 contract](../plans/m2-codex-vertical-slice.md#slice-4--real-verification-runner),
and Verification cases E01 through E07 in the
[M2 acceptance plan](../plans/m2-acceptance-plan.md#verification-evidence-and-acceptance)
only where those cases concern the Slice 4 runner, Evidence, and Store seam.
Slice 3 was committed on `main` as
`c13226d8b51feef39bcf17f31c53d122404b0f1e` before Slice 4 began.

The reviewed working-tree source identity, excluding this review file to avoid
self-reference, is recorded after the closing quality run:

```text
Base Git revision: c13226d8b51feef39bcf17f31c53d122404b0f1e
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 906
Source manifest digest: sha256:81cb77a07c8e2a868eef3afa79326fdd379a6c85248059a216c4312ce2d2cf9e
Self-referential review exclusion: docs/reviews/m2-slice4-real-verification.md
```

The closing quality gate and this review use the same non-review source
identity. A later commit may package this tree, but its hash is not part of the
Slice 4 technical verdict.

## Contract and authority boundary

Domain adds closed schema-version-2 `LOCAL_COMMAND` Check Specification,
`LOCAL_COMMAND_OBSERVATION_V1`, `LOCAL_COMMAND_ENVIRONMENT_V1`, and
`LOCAL_COMMAND_TEST_RESULT` variants. Strict codecs reject unknown fields,
mixed fake/real variants, invalid termination combinations, unbounded signals,
or inconsistent Check, environment, Candidate, lease, obligation, runner, and
isolation bindings. The canonical version-1 projections remain unchanged, so
the complete M1 digest regression stays authoritative.

The public Runtime contract repeats every current authority binding and accepts
only a frozen Candidate with a current read-only workspace lease. Environment
inheritance is `NONE`; names, values, aggregate bytes, ordering, and digest are
bounded and exact. The verifier receives neither Workflow mutation, Store,
Candidate writer, Evidence constructor, Acceptance, Worker, nor Intake
capability. Package and source-import audits enforce this dependency boundary.

The adapter returns only bounded process observations. Runtime records time
around the call, observes the frozen Candidate immediately before and after,
strictly decodes the result, derives status from termination and accepted exit
codes, hashes retained stdout/stderr bytes, and constructs Evidence and payload
references. Adapter exceptions, malformed output, failed source observation,
or Candidate drift produce a closed failure and no new Evidence. Command output
or exit status cannot issue `ACCEPT` or transition the Workflow.

## Local isolation and command execution

`@codeclosure/verification-local` implements the selected Darwin Seatbelt
profile behind the protocol-neutral `VerificationIsolationPort`. Construction
fails on another platform, a missing exact `sandbox-exec`, or a profile that
cannot be launched. The black-box suite separately proves the supported profile
permits the exact tool and Candidate reads while denying Candidate writes,
authority and configured credential reads, and network access.

Each run revalidates the exact executable realpath and content digest, contained
cwd, runner and isolation identity, and current read-only lease before launch
and after process termination. It invokes `/usr/bin/env -i` inside Seatbelt to
install only the explicit environment, then launches the exact executable with
ordered argv and `shell: false`. The sandbox launcher itself receives an empty
environment. No process-fork allowance, Candidate write allowance, or network
allowance is present in the profile.

Timeout follows bounded `SIGTERM` then `SIGKILL`. Stdout, stderr, total retained
output, and payload retention are independently bounded; overflow terminates
the process and remains an observed non-pass result. Temporary output exists
only under an exact run-owned leaf outside Candidate and authority roots, and
that leaf is cleaned in the adapter's `finally` boundary.

## Payload and Store atomicity

Migration 0020 adds an immutable content-addressed `evidence_payloads` table
keyed by Runtime-computed SHA-256 digest and byte length. It extends the closed
Check, obligation, environment, and Evidence discriminators while preserving
the exact M1 version-1 trigger clauses and digest meaning. Unknown versions and
cross-variant combinations still fail closed.

The Store validates and copies every payload, rejects digest/length/content
contradictions, and inserts payloads before Evidence within the existing
compound transaction. Evidence, initial eligibility, Attempt and Workflow
effects, audit, and processed-command outcome either commit together or all
roll back. Reopen rehashes retained payload rows, proves every local-command
reference resolves exactly, and rejects missing, corrupt, colliding, or
malformed authority.

The Slice 4 Store seam can record an exact local Check and obligation and can
commit current passing or failing Evidence. It does not choose the complete M2
policy bundle, build a repair generation, construct an Acceptance manifest,
issue a decision, or close a Goal; those are Slice 5 responsibilities.

## Focused executable evidence

The focused suites pass with zero failed, cancelled, skipped, or todo cases:

- the 11-case local verifier suite covers unsupported/unavailable isolation,
  exact argv and environment, Candidate/authority/credential/network denial,
  executable and cwd mismatch, stale leases before and during execution,
  timeout, output bounds, signal/spawn mapping, malformed/crashing adapters,
  Runtime PASS/FAIL derivation, pre/post drift, and run-root cleanup;
- the 99-case migration suite validates migration 0020, exact schema
  fingerprinting, M1 row/digest preservation, closed variants, triggers, and
  reopen behavior;
- the 83-case Candidate/Evidence authority suite includes local passing and
  failing payload round trips, transaction fault injection after payload write,
  and corrupt-payload reopen rejection;
- the 18-case workspace suite keeps the read-only lease and frozen-source
  producer boundary green; and
- the 36-case digest suite preserves every canonical M1 golden vector.

## Closing executable evidence

The final `pnpm gate:quality` passes with no failed, cancelled, skipped, or todo
case:

| Stage | Result |
| --- | --- |
| documentation tests and structural check | `75/75`, 60 documents |
| CLI/dependency boundary tests | `26/26`, nine workspace packages |
| runner and Slice 0 probe tests | `7/7` |
| Slice 1 lower-client tests | `41/41` |
| Slice 2 adapter tests | `40/40` |
| Slice 3 workspace tests | `18/18` |
| Slice 4 local-verifier tests | `11/11` |
| M1 package unit regression | `136/136` |
| digest tests | `36/36` |
| migration tests | `99/99` |
| authority tests | `249/249` |
| CLI integration | `58/58` |
| M1 adversarial demonstrations | `8/8` |
| Runtime Invariant coverage | `4/4`; `31/31` invariants |

Formatting, strict typecheck, deterministic protocol-snapshot regeneration,
package and CLI dependency audits, documentation checks, and forced production
build also pass. The invariant audit inspected 40 test sources and 399
metadata-bearing executable tests.

## Documentation and architectural review

The root README, Architecture status and Verification/Evidence sections,
Domain, Evidence, and Workflow status sections, M2 milestone, implementation
plan, acceptance-plan status, review index, and ADR index were reviewed
together. No accepted architectural decision changed, so ADR 0030 is
implemented without adding or superseding an ADR. M0/M1 history and the M2.5
Goal Intake boundary remain unchanged.

No new Runtime Invariant is required in Slice 4. Existing invariants already
reserve authoritative state mutation for Runtime/Store transactions, treat
adapter output as untrusted, preserve exact Candidate and Evidence identity,
and reserve technical `ACCEPT` for the Acceptance Engine. Slice 4 adds
executable cases under those rules rather than a new authority class.

## Verdict, limitations, and next action

Every bounded Slice 4 exit condition passes. Slice 4 is implemented and Slice
5 may begin.

This verdict does not prove a full real Goal-bound run. The production CLI does
not yet compose Codex editing, Candidate freeze, local verification, rejection,
repair, fresh verification, Acceptance, and closeout. The selected isolation is
Darwin-only, bounded fixtures contain no secrets, and general redaction,
arbitrary-project retention, containers, browsers, devices, and networked
verification are not claimed. Slice 5 must compose the existing authorities
without allowing a passing process, Worker claim, transcript, payload, or
adapter to become completion authority.
