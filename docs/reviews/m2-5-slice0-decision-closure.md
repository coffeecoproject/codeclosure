# M2.5 Slice 0 Decision-Closure Review

- Review date: 2026-08-03
- Scope: M2.5 Slice 0 only
- Status: Complete
- Verdict: `PASS`; the bounded cross-slice interfaces and ownership choices are
  closed, so Slice 1 may implement the exact typed Policy definition assigned
  to it

## Review question

This review asks whether M2.5 can begin authority implementation without a
later slice having to invent or reinterpret package ownership, assistant
capability, response shape, budgets, persistence meaning, replay, automatic
Start, or public action semantics. Slice 1 still owns the exact typed Admission
rule registry and digest within the fixed material-field matrix and aggregation
order; that is implementation of its declared scope, not permission to change
the outer authority contract.

It does not claim that Goal Intake works. It adds no Intake domain type,
Runtime handler, Store method, SQLite migration, CLI command, App Server call,
Goal, Workflow, Start, Evidence, Acceptance, or external effect. Passing Slice
0 permits Slice 1 only.

## Authority and source identity

The review applies the repository authority order, all current Runtime
Invariants, ADR 0027, ADR 0034, the accepted M1/M2 authority ADRs, and the
[Slice 0 contract](../plans/m2.5-goal-intake-materialization.md#slice-0--final-interface-and-decision-closure).
The ADR index was reviewed; the choices below stay within accepted contracts,
so no new ADR is required.

The final reviewed working-tree source identity excludes only this review file
to avoid self-reference:

```text
Base Git revision: a324dd82de699886cd4de05f8cf6b60e480457a6
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 939
Source manifest digest: sha256:96e1df0c8061dd3bfdeae899b17ac0c8ac69a8dc459c2996aafd4bb5fff4dc33
Self-referential review exclusion: docs/reviews/m2-5-slice0-decision-closure.md
```

The implementation branch is `m2.5-goal-intake`. This bounded correction is
based at the clean Slice 0 decision-closure commit
`a324dd82de699886cd4de05f8cf6b60e480457a6`. Node `v22.22.3` and pnpm `11.1.3`
satisfy the manifest.

The canonical `corepack pnpm accept:m1` procedure ran on the final modified
source and passed its complete quality gate, all eight adversarial demos, and
independent black-box acceptance `8/8`. Its opening and closing source identity
matched at 939 paths and
`sha256:06c481db49c3550ca88c85f8960204a37427c35f0f64297962beea5c85548b7c`
with only the M1 completion review excluded.

The canonical `corepack pnpm accept:m2` procedure then ran on the same final
modified source with explicit bounded live authorization. It passed all
`93/93` rows with zero failures or blocks. Its opening and closing source
identity matched at 939 paths and
`sha256:7c2e5ce4cff0f013b2fbabbc29fbedacca0f4e1f669fc15cb5c598e15822b5ec`
with only the M2 completion review excluded. The procedure included the
complete 893-test quality aggregate, M1 black-box `8/8`, deterministic
protected repair, failed-repair stop, adapter failure, scope review, live
compatibility preflight, live repair handoff, and live natural branch.

On the final modified tree, `corepack pnpm gate:quality` passed its complete
893-test aggregate with zero failures, cancellations, skips, or todos; format,
documentation, protocol snapshot, dependency, type, migration, authority, CLI,
demo, invariant, and build checks all passed. One earlier restricted-sandbox
invocation failed closed because Darwin process-start identity was unavailable;
the identical command passed with ordinary system process visibility.

## Exact pre-Intake implementation baseline

The current public Runtime application facade is exactly:

| Method | Current meaning |
| --- | --- |
| `createGoal` | direct structured Goal plus `DISCOVERY / READY` Workflow creation |
| `startGoal` | ordinary first Start and bounded Runtime drive |
| `resumeGoal` | recovery-aware ordinary continuation |
| `cancelGoal` | ordinary Goal cancellation |
| `getGoalStatus` | Goal-owned Runtime status view |
| `getGoalAudit` | Goal-owned Runtime audit view |

There is no Intake method. Slice 1 must add domain and policy contracts without
changing this direct `CreateGoal` behavior; later application work must extend
the narrow facade rather than expose the Runtime coordinator or Store.

The current application Store is the exact intersection of
`GoalCreationControlStore`, `GoalQueryStore`, and `RecoveryControlStore`.
Worker, external execution, Candidate/Evidence, Acceptance, Policy, Profile,
and protected-verification capabilities remain in their existing narrow Store
ports. No port contains Raw Request, Intake, Proposal, Projection, Admission,
Materialization, or Start-Authorization methods.

SQLite currently ends at
`0025_local_verification_recovery_barrier.sql`. Migrations `0001` through
`0025` remain the complete ordered baseline, with verified activation occurring
before command publication. Slice 2 must add Intake tables and ADR 0034's
retained-root activation extension additively; it may not reuse
Goal/Workflow-bound `processed_commands` for pre-Goal reservations.

The lower `@codeclosure/codex-app-server-client` has no CodeClosure semantic
dependency. Its selected stable client surface is exactly `config/read`,
`configRequirements/read`, `initialize`, `model/list`,
`permissionProfile/list`, `thread/compact/start`, `thread/resume`,
`thread/start`, `turn/interrupt`, and `turn/start`. M2.5 selects only a fresh
Thread and one Turn per operation. Schema presence for resume, Compact, tools,
or server requests does not grant Intake permission to use them.

The current CLI surface is exactly `goal create`, `goal start`, `goal status`,
`goal resume`, `goal cancel`, `audit show`, and `demo run`. There is no Intake
parser branch, presentation envelope, composition capability, or hidden
materialize command. Slice 7 owns the planned explicit Intake commands.

The locked workspace has nine packages. Its production graph is:

| Package | Production dependencies |
| --- | --- |
| `@codeclosure/codex-app-server-client` | none |
| `@codeclosure/adapter-codex` | lower App Server client, Runtime |
| `@codeclosure/domain` | Zod |
| `@codeclosure/runtime` | Domain, Zod |
| `@codeclosure/workspace-local` | Runtime |
| `@codeclosure/verification-local` | Runtime |
| `@codeclosure/store-sqlite` | Domain, Runtime, SQLite, Zod |
| `@codeclosure/testing` | Domain, Runtime |
| `@codeclosure/cli` | current adapters and composition packages |

The trusted local composition installs `policy_codeclosure-m1` version
`codeclosure-m1-policy-v1`, digest
`sha256:a6a7a4e0c9930a3a79f72b5069775430d902284d31ea650e48a213a9648adcb9`,
and the closed M1 profile registry. Its default `happy-path` recipe is
`profile_m1-happy-path` version `codeclosure-m1-fake-profile-v1`, digest
`sha256:e06f2ce15169e0beac7da4998d090718a0c506d30690d2e703cdc946c77577a4`.
M2 additionally has a bounded proof-only protected Policy/Profile and a
version-bound real-Codex composition; neither is an ambient Intake selection.

The supported App Server baseline remains `codex-cli 0.146.0`, snapshot digest
`sha256:0b0bdf534386d796c41596693c451aabaec2526bbac5a7965ab558edc3de8e21`,
launcher digest
`sha256:134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477`,
and delegated executable digest
`sha256:ae1d3ffe6d48aec6a4dc3f50e7eb8e0d11962485a6a9406c5a7012139383da02`.
Protocol types remain below the lower client and never enter Domain or Runtime
authority.

## Fixed M2.5 local profile

The implementation plan now normatively fixes the built-in Admission Policy,
assistant profile and adapter, two response contracts, budget profile, local
principal, retention profile, and governed-execution Workflow Policy/Profile
selection under
[Slice 0 fixed local proof baseline](../plans/m2.5-goal-intake-materialization.md#514-slice-0-fixed-local-proof-baseline).

The important boundary choices are:

- the CLI must capture one explicit trusted action and cannot accept a
  principal override;
- each assistant operation gets one fresh process, Thread, and Turn with no
  tool or fallback capability;
- Intent analysis and Answer-only have different exact closed wire schemas,
  including omission/null, collection-index, byte-span, duplicate, and unknown-
  field behavior;
- required exact input that exceeds a fixed budget fails preparation instead
  of being silently truncated;
- the local retention profile has one exact UTF-8/control-character and
  credential-marker classifier, rejects before retaining prohibited bytes, and
  keeps admitted exact source while dependent authority is usable;
- the built-in Policy has a fixed material-field/source matrix, complete
  `POLICY_DERIVED` rule set, decision ordering, and explicit trusted
  abandonment action; and
- governed automatic Start uses the existing exact M1 Policy/Profile only for
  the deterministic M2.5 proof and still crosses ordinary `StartGoal`.

The selected M1 profile is not a claim that FakeWorker is the final production
backend. It avoids introducing a second Workflow Policy/Profile decision into
Goal Intake while the real M2 Codex path remains separately covered by its
mandatory regression gate.

## Closed response rejection semantics

The rejection-versus-inert-content rule is exact:

1. any unknown key or model-authored authority field outside the closed
   response contract rejects the entire payload;
2. no partial Proposal or Answer content is retained from that payload;
3. authority words inside a permitted bounded string remain untrusted inert
   content rather than being stripped, parsed, or promoted; and
4. source-binding and Admission still reject any material meaning supported
   only by that model content.

This avoids both unsafe permissiveness and a brittle vocabulary filter. A
model may literally write that something is approved; it still cannot supply
trusted action, identity, provenance, ambiguity resolution, Admission, Goal,
Start, Evidence, or Acceptance authority.

## Ownership and prohibited capabilities

Every planned authority type has one owner and a closed prohibited-capability
set:

| Planned type or family | Sole semantic owner | Prohibited capability |
| --- | --- | --- |
| Raw Request root/revision | Intake Coordinator over trusted CLI input | assistant action/principal authorship; Goal or Workflow mutation |
| IntakeRun | Intake Coordinator | Workflow phase/status mutation; implicit retry |
| Intake command reservation/Manifest/outcome | Runtime transaction plan plus Store backstop | fabricated Goal target; external call before reservation; caller-authored outcome |
| Intent Analysis Proposal | Intake Coordinator; content originates as an assistant observation | Source Binding, Admission, Goal, Start, Store, or Workflow authority |
| Intent Projection revision | Intake Coordinator | formal Goal identity; self-admission |
| Source Binding and Material Ambiguity | Intake Coordinator and deterministic source/materiality policy | model-authored authority class or resolution |
| Clarification Question specification/record | Admission Engine plan plus Coordinator transaction | standalone answer or Workflow authority |
| Clarification Answer Binding | Coordinator's clarification transaction | positional/batch answer; Question mutation; model authorship |
| Intent Admission Policy | trusted Runtime installation | assistant, CLI, project, or latest-record selection |
| Intent Admission Decision | deterministic Admission Engine | Store writes, model calls, Goal/Workflow writes, Start, Acceptance, or external effects |
| Answer-only Response | Coordinator over bounded adapter observation | Source Binding, Goal, Workflow, Evidence, Acceptance, or execution instruction |
| Intake Failure Record | Coordinator's typed terminal transaction | denial semantics; same-run retry or assistant recall |
| Goal Materialization Record | Goal Manager/Workflow Runtime compound transaction | Attempt, Context, dispatch, Evidence, Acceptance, or Start application |
| Goal Start Authorization | Materialization transaction | direct dispatch; replacement command; first-Start bypass |
| Intake status/audit/composite result | Runtime read facade | Admission, retry, Materialization, Start, or completion authority |
| Intake/Answer-only Package and Manifest | Runtime Intake compiler | fabricated Goal-bound Context, Candidate, Evidence, or Acceptance identity |
| Intake assistant adapter/profile | `packages/adapter-codex-intake` under trusted composition | WorkerPort, Store, Goal Manager, Workflow, Start, Candidate/source write, Evidence, Acceptance, or external effects |

Domain codecs validate closed shapes. Runtime components issue decisions and
transaction plans. SQLite independently revalidates relationships and commits
authority plus audit, but does not become another semantic issuer.

## Transaction closure

The transaction map in the implementation plan is confirmed without
reinterpretation:

- analysis and Answer-only reservations commit before their external call;
- clarification atomically binds the exact current Question, creates the new
  Raw Request revision and unique Answer Binding, clears the active reference,
  and reserves the next operation;
- deterministic rejection records no revision or external call;
- immediate no-external `NO_EXECUTION` uses one terminal transaction;
- analysis, `CLARIFY`, Answer-only, failure, and Materialization each have one
  closed final compound commit;
- Materialization creates only Goal revision 1 and `DISCOVERY / READY`
  Workflow authority plus its immutable causality records; and
- automatic Start is a later ordinary `StartGoal` command with its own journal,
  Policy/Profile binding, Context, Attempt, dispatch, replay, and recovery.

ADR 0034's reservation/outcome contract and verified activation extension are
adopted as written. No placeholder Goal, mutable reservation status, inferred
retry, retained-root replacement, or caller-supplied activation authority is
introduced.

## Dependency preflight

The dependency gate now contains a pre-package expectation for exactly
`packages/adapter-codex-intake` / `@codeclosure/adapter-codex-intake`. Its only
future production dependencies are the public lower App Server client and the
public Runtime package. The focused reverse fixture rejects the Worker adapter,
Domain, Store, CLI, testing, workspace, verification, Runtime subpaths, and
lower-client testing subpath. Its only allowed Node built-ins are
`node:buffer`, `node:crypto`, `node:path`, and `node:timers`; filesystem,
child-process, network, module-loader, and worker-thread imports fail the
preflight.

The package does not exist in Slice 0, so the current nine-package lockfile and
graph remain unchanged. Slice 3 must promote this exact expectation into the
active package policy when it creates the package; the existing workspace
discovery gate will otherwise reject the new directory.

## Documentation and scope review

The root README, Architecture status, Goal Intake, Domain Model, Workflow,
Context Compiler, Acceptance Engine, Evidence Model, ADR index, milestone
boundary, implementation plan, and review index were checked for the same
meaning: M2 remains complete, M2.5 Slice 0 is complete, and Goal Intake product
behavior remains unimplemented.

Slice 0 adds no Runtime Invariant because it introduces no executable Intake
authority. Slice 1 must add the proposal-self-materialization invariant and
its executable metadata in the same change as the owning Domain/Policy
contracts.

## Verdict and next boundary

`PASS`. No unresolved cross-slice decision remains that can change authority
ownership, persistence/replay meaning, assistant capability/response shape,
automatic Start, or public action semantics. Slice 1 may define and digest only
the exact typed Admission rule registry already bounded by the fixed field
matrix and aggregation order.

The next permitted work is M2.5 Slice 1: typed Domain identifiers and closed
records, codecs, canonical projections and golden vectors, deterministic
Admission Policy/Engine contracts, and the executable invariant. Slice 1 must
not add SQLite persistence, the Intake App Server adapter, CLI commands,
Materialization/Start composition, or a milestone verdict.
