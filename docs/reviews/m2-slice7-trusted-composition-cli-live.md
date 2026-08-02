# M2 Slice 7 Trusted Composition, CLI, and Live Review

- Review date: 2026-08-02
- Scope: M2 Slice 7 only
- Status: Complete
- Verdict: `PASS`; the bounded protected-verification, trusted-composition,
  public CLI, and two live Codex paths satisfy the Slice 7 exit contract, so
  Slice 8 may begin

## Review question

This review asks whether trusted composition can fix one acceptance-critical
Verification Plan and protected Oracle before Worker mutation, carry that
authority through Context, dispatch, generation-specific Check, read lease,
Evidence, deterministic Acceptance, closeout, and strict reopen, and expose the
bounded path through the public CLI without giving Codex or presentation code a
second authority channel.

It also asks whether the ordinary live path follows its real first
post-edit verification result, whether the separate live repair handoff gives
Codex a fresh child and exact failure Context without old-chat authority, and
whether unavailable or failed external execution remains a typed visible
outcome rather than a skipped success or hidden retry.

It does not run the Slice 8 acceptance harness, issue the independent M2
milestone verdict, begin M2.5 Goal Intake, assess arbitrary-project Oracle
completeness, authorize automatic multi-round repair, or authorize merge,
release, deployment, or another external effect.

## Authority and source identity

The review applies the repository authority order, Runtime Invariants I-001
through I-010 and I-027 through I-029, ADR 0014 through ADR 0025, ADR 0028
through ADR 0033, the
[Slice 7 contract](../plans/m2-codex-vertical-slice.md#slice-7--trusted-composition-cli-and-live-demonstration),
and the Slice 7-applicable rows of the
[M2 acceptance matrix](../plans/m2-acceptance-plan.md#7-mandatory-acceptance-matrix).

The final reviewed working-tree source identity excludes only this review file
to avoid self-reference:

```text
Base Git revision: 0471ade143fddadec98fe910e7313c66910d3b4d
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 931
Source manifest digest: sha256:5a6ab4bf8f988715276c75b21e81e94677edb9b44bbab5024c1259736a2a2f41
Self-referential review exclusion: docs/reviews/m2-slice7-trusted-composition-cli-live.md
```

## Protected verification authority

The bounded protected profile extends the existing first successful
`StartGoal` transaction. Runtime derives and Store validates exactly one
immutable `AcceptanceCriticalVerificationPlan` together with the Workflow
Policy/Profile bindings, first Context Manifest, first Attempt, Workflow and
Goal projections, audits, and processed command outcome. A partial protected
Start rolls back. The plan fixes the exact Criteria, Policy rules, semantic
Check template, protected assets, manifest, and read-lease policy before a
Worker can mutate Candidate generation 1. Repair generations reuse that plan;
they cannot revise it.

Protected Context Package and Manifest variants repeat the plan ID and digest,
and every protected dispatch claim revalidates the same pair. The additive
schema-version-3 local Check and Evidence family retains the existing
version-2 command semantics and adds exact plan, protected-asset manifest, and
read-lease bindings. M1 and non-protected M2 schema identities retain their
prior meanings.

The `ProtectedAssetReadLease` is constructed with the generation-specific
Check before the `EVIDENCE_BUILD` Attempt exists, as required by ADR 0033. Its
static digest excludes later Workflow version, Attempt, and Obligation values;
the admitted verification request and resulting Evidence bind those causal
identities separately. Runtime and Store reconstruct the lease from retained
Plan, Candidate, Check, Profile, and asset authority. A verification session is
single-consumer: replay, a second concurrent invocation, stale authority, a
late request, and even Evidence-admission rollback cannot grant another Runner
invocation.

The protected Darwin isolation profile has its own version and digest. It may
read only the exact regular-file assets in the decoded lease and the frozen
Candidate inputs needed by the Check. Candidate writes, protected-asset writes,
protected-root widening, authority or credential reads, and network remain
denied. Missing, aliased, replaced, mode-changed, length-changed, or
digest-drifted protected assets fail closed before eligible passing decisive
Evidence.

## Anti-self-certification and deterministic orchestration

The deterministic protected fixture gives the controlled Worker a
Worker-writable test that it can weaken. The deliberately wrong generation
makes that test pass but still fails the pre-fixed protected Oracle. Runtime
records current failing Evidence and `REJECT_REPAIRABLE`; the explicit repair
command creates a distinct child generation under the same protected Plan. A
correct child passes that same Oracle, and only its exact current protected
Evidence can produce `ACCEPT` and closeout.

The paired failed-repair fixture leaves the second generation visibly stopped
after fresh protected failure. Reopen, ordinary Resume, duplicate commands,
stale decisions, and late events cannot create generation 3 or another
dispatch. Supplementary Worker-authored Evidence remains outside the decisive
one-family Evidence Set.

SQLite migrations add the protected authority records and the local
verification recovery barrier without rewriting M1 or version-2 local Evidence
identity. Strict decode, migration, foreign-key, trigger, audit, and reopen
checks independently reconstruct the Plan, static lease, invocation causality,
Evidence, Acceptance input, and final Workflow state.

## Trusted composition and CLI boundary

The M2 proof composition owns the exact disposable source fixture, Candidate
root, authority home, protected root, installed Policy/Profile, App Server
invocation, verifier, and Runtime driver. Ordinary CLI parsing and presentation
receive only closed command inputs and query/proof views. Dependency and CLI
boundary checks reject imports or capability flow that would give ordinary CLI
modules raw Store, App Server client, workspace, verifier, internal Runtime, or
protected-asset authority.

The public demo surface exposes deterministic protected repair, bounded failed
repair, governed adapter failure, ordinary live, and live repair-handoff
scenarios. JSON discriminators and human rendering distinguish proof success,
typed blocked conditions, governed external failure, and live verification
failure. They do not translate `turn/completed`, model prose, or a CLI success
message into Acceptance.

Each proof uses a disposable controlled copy and a separate SQLite authority
home. The source checkout is hashed before and after execution and remains
unchanged. The final audit view is read from the authoritative Store. The
SQLite home is then strictly reopened, which revalidates retained authority,
and its public status is compared with the pre-close status rather than
inferred from an in-memory result.

## Bounded live evidence

The ordinary live scenario completed on its natural first-result branch:

```text
proofCode: M2_LIVE_NATURAL_BRANCH_CLOSED
branch: LIVE_FIRST_PASS_ACCEPTED
Candidate generations: 1
external Codex executions: 1
independent Evidence: PASS
Acceptance: ACCEPT
Workflow: CLOSEOUT / CLOSED
source checkout: unchanged
strict SQLite reopen: PASS; public status unchanged
```

No failure was fabricated and no repair generation, replacement Thread, hidden
retry, or model fallback occurred.

The separately authorized repair-handoff scenario completed from a controlled
failed parent:

```text
proofCode: M2_LIVE_REPAIR_HANDOFF_CLOSED
branch: LIVE_REPAIR_HANDOFF_ACCEPTED
Candidate generations: 2
external Codex executions: 1
parent independent Evidence: FAIL
repair-child independent Evidence: PASS
Acceptance: ACCEPT
Workflow: CLOSEOUT / CLOSED
source checkout: unchanged
strict SQLite reopen: PASS; public status unchanged
```

The controlled fixture, not Codex, created and verified the failed parent.
Codex was first dispatched only to the inherited repair child through a fresh
Session and Thread. Its Context was recompiled from the exact current repair
record, decision, Evidence Set, selected failing Evidence and eligibility,
parent/child identities, freeze change-set digest, and Goal preservation
constraints. The old conversation was neither restored nor required.

Earlier explicitly authorized live attempts remained visible while converging
on these two passing proofs. They exposed three bounded harness defects: a
Candidate trust setting could drift during Thread creation, the terminal wait
was shorter than a legitimate bounded model Turn, and the fixture's prose did
not state the Oracle's literal expected bytes. The fixes respectively add an
exact request-local untrusted-Candidate override plus post-creation readback,
use a five-minute terminal bound with one best-effort interrupt on expiry, and
derive both Goal wording and Oracle content from one exact UTF-8 constant.
Each failed attempt stopped through its typed path; none silently retried until
it obtained a convenient result. The passing demonstrations were new,
separately authorized invocations.

## Focused executable evidence

The focused and integration suites pass with zero failed, cancelled, skipped,
or todo cases:

- exact protected Plan, Context, Check, lease, request, Evidence, Acceptance,
  transaction-fault, replay, and strict-reopen cases pass;
- protected Seatbelt exact-read, root-widening, write, authority, credential,
  and network cases pass;
- Codex client and adapter protocol/configuration/lifecycle suites pass,
  including post-Thread configuration writeback rejection and exact Turn
  timeout interruption;
- public CLI subprocess cases pass for protected repair, failed repair, adapter
  failure, blocked/live result contracts, rendering, audit, and reopen; and
- the complete M1 deterministic regression and all named M1 adversarial demos
  remain green.

## Closing executable evidence

The final quality-gate result and aggregate stage counts are recorded after
documentation closure:

```text
format: PASS
docs: 75/75 tests; 66 portable GFM sources
M2 protocol snapshot: PASS; Codex 0.146.0; pinned snapshot unchanged
lint and boundaries: 27/27 tests; 9 packages; 812 sources
typecheck: PASS
unit: 7/7 + 44/44 + 57/57 + 19/19 + 13/13 + 140/140
authority digests: 36/36
migrations: 99/99
Store/Runtime authority: 301/301
CLI integration: 62/62
M1 adversarial demos: 8/8
invariant checker: 4/4; coverage 31/31; 42 sources; 445 executable tests
forced build: PASS
```

The Darwin Seatbelt suites ran outside the host tool sandbox because that
sandbox cannot nested-launch the selected isolation profile. The verified
processes remained inside CodeClosure's own versioned Seatbelt policies and
disposable fixture roots. No live/model command is part of the ordinary quality
gate.

## Documentation and architectural review

The root README, Architecture status and Context/verification boundaries,
Workflow, Domain Model, Context Compiler, Evidence Model, Acceptance Engine,
M2 milestone, implementation plan, acceptance-plan status, review index, ADR
index, Runtime Invariants, Product contract, and M0/M1 historical records were
reviewed together.

No accepted architectural decision changed. Slice 7 implements ADR 0031
through ADR 0033 under the existing M1 authority owners and ADR 0028 through
ADR 0030 boundaries. The accepted ADR index remains current, and no new ADR or
Runtime Invariant is needed. Product, Runtime Invariants, Goal Intake, AGENTS,
and M0/M1 historical records remain unchanged.

The documentation does not claim Slice 8 acceptance, M2 milestone completion,
M2.5 implementation, arbitrary-project Oracle completeness, general model
quality, automatic multi-round repair, or external-effect authority.

## Verdict, limitations, and next action

Every bounded Slice 7 exit condition has executable evidence. Slice 7 is
implemented and Slice 8 may begin.

The proof remains deliberately narrow: one protected Oracle family, one
supported local Codex/App Server profile, one bounded ordinary live path, and
one bounded live repair handoff. It does not prove that arbitrary project tests
or Oracles are sufficient, and it does not make Codex output authoritative.
Slice 8 must still add and run the canonical `accept:m2` harness, identify one
stable source tree, execute every mandatory acceptance row with zero skips, and
issue the independent dated verdict before M2 may be marked complete or M2.5
may begin.
