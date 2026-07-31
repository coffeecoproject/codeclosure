# M2 Milestone Acceptance Plan

- Status: Prepared; Slices 0 through 3 are implemented, Slice 4 has not started,
  and milestone acceptance has not started
- Plan date: 2026-07-30
- Milestone: M2
- Implementation record: [M2 Codex vertical slice plan](m2-codex-vertical-slice.md)

## 1. Purpose

This plan determines whether one exact CodeClosure source tree satisfies the
bounded M2 Codex vertical-slice milestone. It converts the M2 exit criteria into
a repeatable procedure with explicit entry conditions, mandatory cases,
evidence, source identity, and unconditional verdict rules.

This is a milestone assessment plan. It MUST NOT issue or replace a technical
`ACCEPT` decision, mutate a Workflow, authorize Intent Admission or automatic
Goal Materialization/Start, authorize Candidate Promotion, or authorize any
external effect. Only the Acceptance Engine may issue technical decisions and
only the Workflow Runtime may mutate Workflow state.

## 2. Governing authority

The acceptance round applies the repository authority order. Its primary
normative inputs are:

1. [`RUNTIME_INVARIANTS.md`](../../RUNTIME_INVARIANTS.md);
2. the [accepted ADR index](../adr/README.md) and every accepted record relevant
   to Worker, Context, Candidate, Evidence, Acceptance, recovery, Codex, and
   Goal Intake separation;
3. [`PRODUCT.md`](../../PRODUCT.md) and
   [`ARCHITECTURE.md`](../../ARCHITECTURE.md);
4. the current domain documents for
   [Workflow](../workflow.md), [Domain Model](../domain-model.md),
   [Context](../context-compiler.md), [Acceptance](../acceptance-engine.md), and
   [Evidence](../evidence-model.md);
5. the [M2 milestone boundary](../milestones.md#m2--codex-vertical-slice); and
6. the [M2 implementation and status record](m2-codex-vertical-slice.md).

A passing test, successful Codex Turn, model claim, or easier implementation
cannot override a conflict with a higher-authority record. A durable conflict
discovered during acceptance forces `FAIL` or `BLOCKED` until the decision is
resolved through the repository's ADR process.

## 3. Acceptance question

The round answers one question:

> Does the identified source tree prove that one exact supported Codex App
> Server version can edit only an isolated Candidate under a controlled
> execution configuration and observable working-continuity policy, that
> CodeClosure—not Codex—owns Worker admission,
> verification, rejection, repair, Acceptance, and closeout across failure and
> restart, that a deterministic real-Candidate/real-verifier path proves
> reject/repair/accept, and that a separate bounded live Codex path follows its
> real first verification result without Goal Intake or an external effect?

The accepted unit is the complete identified source tree plus its exact
canonical generated protocol snapshot, controlled execution-input profile, and
recorded live environment. It is not an individual package, transcript,
Thread, Turn, Candidate directory, test log, previous M1 report, or successful
model response.

## 4. Scope

The mandatory acceptance scope is:

- the complete M1 control-plane regression baseline;
- the lower App Server client's dependency isolation and protocol behavior;
- exact Codex executable, version, raw generated TypeScript schema, canonical
  generated JSON schema, normalization profile, and compatibility identity;
- controlled App Server configuration, state root, instruction sources, tool
  exposure, and credential boundary;
- local stdio process initialization, request correlation, notifications,
  server requests, interruption, shutdown, and bounded stream handling;
- the Goal-bound Codex Worker Adapter and selected phase mappings;
- Runtime-owned backend execution binding and Worker event admission;
- cwd, sandbox, network, approval, and unsupported-request policy;
- real Candidate creation, containment, freeze, parent/repair generation,
  drift, restart, and safe cleanup behavior;
- one real read-only local Verification Runner path;
- exact Evidence and deterministic Acceptance bindings;
- Thread start/resume policy, Compact handling, backend/process failure,
  same-Thread tool-loop continuity, cancellation, and CodeClosure restart;
- public CLI/composition isolation and status/audit rendering; and
- one deterministic real-Candidate/real-verifier demonstration that proves
  failing verification, rejection, repair, passing verification, Acceptance,
  and closeout; and
- one separate bounded live Codex edit-and-verify demonstration whose first
  post-edit result is not prescribed: a correct first pass continues normally,
  while a real failure enters the governed repair branch.

The following remain outside M2 and MUST NOT be inferred from `PASS`:

- Goal Intake, Raw Request revisions, Intent Analysis, Intent Projection,
  Source Binding, Material Ambiguity, Intent Admission, automatic Goal
  Materialization, or Intake-authorized Start;
- changes to direct `CreateGoal`;
- full Fact Graph discovery or execution-time Goal revision;
- proof that arbitrary models, Codex versions, platforms, repositories, build
  systems, or network environments work;
- rich TUI, multiple agents, cloud, multi-user, scheduler, or production
  operations;
- cleanup of user-owned or ambiguous paths;
- merge, commit to a user branch, push, release, deployment, communication,
  purchase, or another external effect; and
- product completion or production-readiness claims.

## 5. Entry conditions

Before the round begins, the operator MUST establish all of the following:

1. The repository root is the current working directory.
2. Node and pnpm satisfy the exact root manifest, the lockfile is current, and
   dependencies are already installed.
3. The M2 implementation record marks Slices 0–7 implemented with focused
   evidence. Slice 8's acceptance harness is ready, but Slice 8 and the
   milestone have not been marked complete before the verdict they depend on.
4. The base revision, branch, clean or modified state, source-manifest schema,
   source path count, and digest are captured by
   `node scripts/source-identity.mjs`.
5. Any modified tree is fully covered by the source manifest; a dated review
   may be a declared self-referential exclusion only under the same narrow rule
   used by the acceptance runner.
6. The resolved Codex launcher and delegated platform executable, when
   separate, are outside the Candidate, resolve through known symlinks to
   regular files, and their version plus SHA-256 identities match the supported
   M2 protocol profile.
7. Freshly generated TypeScript schemas compare byte-for-byte with the
   checked-in snapshot, and freshly generated JSON schemas compare after
   duplicate-key rejection and exact RFC 8785 UTF-8 canonicalization under the
   accepted normalization profile.
8. Controlled Codex configuration and state roots are established. Effective
   instruction sources, tool policy, Thread/working-continuity policy,
   compaction policy, fresh-Thread boundaries, retention, and fallback behavior
   match the M2 Execution Profile, ambient configuration cannot widen
   authority, and the profile binds the exact identity of all compatible
   managed requirements.
9. Local Codex authentication and the selected model are available without
   printing, copying, or persisting credentials into the fixture or report.
10. The deterministic reject/repair fixture is unique and disposable, uses a
    real Candidate workspace and Verification Runner, and requires no live
    model or external network.
11. The live fixture is a unique disposable local Git repository containing no
   user work, secret, remote push target, hook, submodule with effects, or
   dependency installation requirement.
12. The authority home, Candidate workspace root, verifier temporary root,
    deterministic fixture source, live fixture source, and controlled Codex
    state root are separate exact paths created for this round.
13. Candidate commands have network disabled. The only allowed external
    network use is the bounded App Server model-service and authentication
    traffic required for the live proof.
14. No required command will merge, commit to a user branch, push, deploy,
    publish, communicate, purchase, or mutate a non-fixture external system.
15. The current tree passes the complete offline quality gate before the live
    case begins.
16. No known blocking defect or higher-authority conflict is being waived.

If a required binary, credential, model, service, network path, fixture
isolation property, or source identity cannot be established, the verdict is
`BLOCKED`, not `PASS` and not a skipped case.

## 6. Isolation and evidence rules

The round uses separate deterministic and live evidence layers.

The deterministic layer MUST:

- use a fake App Server process for malformed, duplicate, ordering, limit,
  timeout, approval, cancellation, and process-failure cases;
- use a separate controlled Worker/App Server fixture with real Candidate and
  Verification Runner boundaries to deterministically prove the complete
  reject/repair/accept branch without relying on model behavior;
- create only unique temporary source, Candidate, verifier, and authority
  directories;
- use public Runtime/CLI views for authority assertions unless a focused Store
  contract test is the named proof owner;
- close and reopen SQLite and relevant filesystem adapters before comparing
  retained authority;
- remove only exact paths created and retained by the case; and
- make no live model or external network call.

The live layer MUST:

- resolve the supported local Codex binary through the trusted composition
  path;
- invoke App Server over local stdio rather than shelling out to a top-level
  autonomous Codex task;
- use the exact M2 Execution Profile, canonical generated protocol snapshot,
  controlled configuration roots, and controlled Codex state root;
- compare effective model, provider, cwd, sandbox, approval, instruction-source,
  and tool exposure observations with the requested profile before admitting
  Worker events;
- constrain Worker cwd and write access to the current mutable Candidate;
- disable Candidate command network access and unsupported tools/effects;
- record requested model plus observed reroute, warning, error, Thread, Turn,
  bounded `contextCompaction`, and approval metadata without storing secrets,
  hidden reasoning, or opaque compaction state;
- validate all external JSON and model-authored payloads as untrusted input;
- assert persisted Goal, Workflow, Attempt, Candidate, Evidence, Acceptance,
  Closeout, backend binding, and audit identity independently of transcript
  wording; and
- perform no external effect beyond the bounded model-service and
  authentication traffic required for the live proof.

The live prompt and fixture MUST NOT manufacture a first verification failure.
If the first frozen Candidate passes the required real check, CodeClosure must
accept that result through the normal evidence path. If it fails, only then may
the Runtime authorize a distinct repair generation.

The dated acceptance report records exact source and environment identity,
commands, stage summaries, aggregate test counts, every matrix row, both
fixture identities, requested/observed backend and execution-configuration
metadata, findings, unavailable checks, and verdict. It may summarize Worker
output but MUST NOT treat a transcript as authority or include credentials,
raw hidden reasoning, or unbounded project content.

## 7. Mandatory acceptance matrix

Every row is required. One command may provide evidence for several rows, but
the report must preserve each row's individual outcome.

### Source, toolchain, and dependency boundary

| ID | Required proof | Primary evidence |
| --- | --- | --- |
| `M2-A01` | Opening and closing source identities match exactly | `source-identity.mjs` output |
| `M2-A02` | Node, pnpm, manifests, lockfile, and direct package versions satisfy the closed dependency policy | environment and dependency audit |
| `M2-A03` | GFM, links, README Status ownership, current milestone, planned/implemented labels, and non-claims are consistent | documentation checker and semantic review |
| `M2-A04` | Domain and Runtime import no Codex/OpenAI protocol DTO or package | dependency and source-import audit |
| `M2-A05` | The lower App Server client imports no Domain, Runtime, WorkerPort, Workflow, Candidate, Evidence, Acceptance, Store, CLI, or Intake contract | dependency audit plus reverse fixtures |
| `M2-A06` | The Worker, workspace, and verifier adapters cannot import Store or internal Runtime mutation capability | dependency and compile-backed negative fixtures |
| `M2-A07` | The resolved Codex executable path, version, and SHA-256 match the M2 supported profile at verification and immediately before process spawn; executable mutation or unavailability after launch construction fails closed as `VERSION_MISMATCH` | protocol identity command and executable mutation/unavailability fixtures |
| `M2-A08` | Repeated TypeScript generation is raw-byte-identical; repeated JSON generation rejects duplicate keys and is canonical-byte-identical under the exact RFC 8785 UTF-8 normalization profile; the checked-in manifest binds both identities | schema regeneration and canonicalization check |
| `M2-A09` | Formatting, lint, strict typecheck, all tests, and forced production build pass | complete quality gate |
| `M2-A10` | Every Node test summary has zero failed, cancelled, skipped, and todo tests | no-skip runner and stage summaries |

### App Server client

| ID | Required proof | Primary evidence |
| --- | --- | --- |
| `M2-B01` | One connection performs exactly one `initialize` then `initialized` handshake before other requests | fake-server protocol contract |
| `M2-B02` | Request IDs correlate to exactly one result or error; unknown, duplicate, and conflicting responses fail closed | correlation adversarial suite |
| `M2-B03` | Partial lines, malformed JSON, duplicate keys, prototype-bearing objects, oversized lines, oversized collections, and buffer exhaustion cannot synthesize inherited fields or become invalid typed protocol events | framing, own-field, and limit suite |
| `M2-B04` | Stderr is bounded diagnostic input and cannot be parsed as stdout protocol authority | process-stream test |
| `M2-B05` | Unexpected EOF, spawn error, signal, nonzero exit, and shutdown timeout terminate every pending request deterministically | process-lifecycle suite |
| `M2-B06` | Client cancellation sends only the requested interruption and does not infer successful completion | interruption suite |
| `M2-B07` | Unknown server requests and unsupported experimental methods fail closed | server-request suite |
| `M2-B08` | The client performs no hidden Turn retry, process retry, Thread resume, approval, or model fallback | call-trace and source boundary tests |
| `M2-B09` | Live local stdio initialization and one bounded Thread/Turn conform to the pinned generated schema | live compatibility preflight |
| `M2-B10` | Explicit argv, environment, controlled config/state roots, custom permission-profile digest, managed requirements, exact `config/read`, `permissionProfile/list`, and `instructionSources`, plus outer black-box isolation determine App Server inputs; poisoned ambient config, instructions, hooks, skills, MCP, plugins, apps, search, provider, and environment values cannot enter or widen the selected profile | configuration-isolation suite |
| `M2-B11` | The pinned schema and focused probes separately classify protocol-surface presence and observed operation for Thread resume, manual compaction, automatic-compaction configuration/trigger, `contextCompaction` lifecycle, post-compaction continuation, and controlled-state behavior without inspecting private reasoning; pending manual-compaction trackers and observed unfinished lifecycles are separately bounded, and completed lifecycles release their slots; every capability selected by the installed profile is `SUPPORTED`, while `UNSUPPORTED` or `UNKNOWN` capabilities remain unselected | version-bound capability record, deterministic fixtures, and bounded compatibility preflight |

### Worker mapping and authority

| ID | Required proof | Primary evidence |
| --- | --- | --- |
| `M2-C01` | Runtime-selected phase, Candidate workspace lease, cwd, sandbox, network, approval, model, provider, effort, response schema, configuration, instruction, tool, and state policy map exactly to the App Server execution | adapter projection tests |
| `M2-C02` | Every emitted Worker event binds the current Attempt, Worker Session, Context Manifest, package, Profile, Policy, Candidate lease when present, and backend execution observation | adapter and Runtime authority tests |
| `M2-C03` | `turn/completed` without one valid structured payload is a Worker failure, not completion | fake-server adversarial case |
| `M2-C04` | Free-form “done,” `ACCEPT`, passing-looking logs, plan Items, diff events, and command results cannot advance or close a Goal | lying-worker real-adapter fixtures |
| `M2-C05` | Malformed, unknown, oversized, multiple-terminal, invalid-only, wrong-phase, and stale payloads fail closed | response-contract suite |
| `M2-C06` | Duplicate and conflicting Worker events preserve exact ADR 0025 receipt and current-dispatch semantics | Worker replay suite |
| `M2-C07` | Process, backend, protocol, declined approval, cancellation, and host-control failures retain distinct typed classifications | failure-mapping suite |
| `M2-C08` | Backend Thread/Turn identity cannot mutate Workflow, issue Acceptance, or substitute for a Runtime Command or Worker Event ID | authority and compile-boundary tests |
| `M2-C09` | Every durable Worker receipt has its prior dispatch and backend-execution causality, and Store failure is not blamed on Codex | Store fault-injection suite |
| `M2-C10` | App Server-observed effective settings, managed-requirements identity, and `instructionSources` match the trusted request; an unknown, stale, changed, or widened input blocks admission rather than becoming Context | effective-input admission suite |
| `M2-C11` | One Worker Request, its bounded worker Turn, and every App Server-managed tool call use one exact Thread; an unexpected split, adapter-authored continuation, or `turn/steer` use fails closed, while an authorized manual-compaction maintenance Turn cannot become another Worker dispatch or result | fake-server call trace and adapter policy tests |

### Candidate workspace

| ID | Required proof | Primary evidence |
| --- | --- | --- |
| `M2-D01` | Worker cwd and writable roots derive from one current Runtime-issued Candidate workspace lease, resolve inside that mutable Candidate, and remain outside source checkout plus authority home | containment integration suite |
| `M2-D02` | Base repository, parent generation, allowed paths, project identity, and mutable-generation identity are exact and replayable | Candidate manifest tests |
| `M2-D03` | Symlink, alias, traversal, case, special-file, ignored-file, and metadata edge cases cannot escape policy | filesystem adversarial suite |
| `M2-D04` | Freeze creates an exact canonical tree digest and permanently removes Worker mutation authority from that generation | freeze integration suite |
| `M2-D05` | Any frozen-source mutation before, during, or after verification is detected and invalidates affected Evidence | drift fault-injection suite |
| `M2-D06` | Repair creates a new generation from the exact eligible parent and leaves the old frozen generation byte-identical | repair-generation suite |
| `M2-D07` | Partial create/freeze/repair failure leaves no falsely current Candidate authority | transaction/filesystem reconciliation tests |
| `M2-D08` | Restart compares an exact persisted-authority snapshot before classifying owned, retained, orphaned, and unsafe paths; cleanup requires a current one-time exact-orphan grant and never deletes an unresolved or user-owned target | cleanup/reopen suite |
| `M2-D09` | The source fixture's declared content projection remains byte-identical, while separately recorded Git metadata changes are either absent or explicitly attributable to the acceptance harness | source-manifest and Git-metadata comparison |
| `M2-D10` | The authority home and controlled Codex state root are inaccessible from the Worker-writable Candidate | black-box isolation proof |

### Verification, Evidence, and Acceptance

| ID | Required proof | Primary evidence |
| --- | --- | --- |
| `M2-E01` | One schema-version-2 `LOCAL_COMMAND` Check Specification binds executable realpath/content digest, ordered argv, contained cwd, environment, timeout/grace, output/retention limits, runner, frozen Candidate, read-only workspace lease, and isolation profile exactly | Verification Runner contract |
| `M2-E02` | The runner invokes no shell and executes under the selected versioned Darwin isolation profile without Candidate write capability, authority/credential read capability, Store or Worker access, or network; an unavailable or unenforceable profile blocks verification | runner boundary and black-box process tests |
| `M2-E03` | `LOCAL_COMMAND_OBSERVATION_V1` exit/signal, stdout/stderr, timeout, truncation, spawn failure, and environment observations are bounded and validated before Runtime-derived `LOCAL_COMMAND_TEST_RESULT` Evidence; retained payload bytes and their authoritative references commit or roll back together | runner adversarial and SQLite fault-injection suite |
| `M2-E04` | A failing required check creates current failing Evidence and prevents technical `ACCEPT` and closeout | Runtime integration case |
| `M2-E05` | A passing check can satisfy only the exact current obligation, Candidate, source, specification, runner, and environment binding | Evidence exact-binding suite |
| `M2-E06` | Worker-reported tests, App Server command Items, transcript text, and path existence cannot become formal Evidence | authority tests |
| `M2-E07` | Verification-time mutation, stale Evidence, wrong generation, wrong check, or wrong environment fails closed | Evidence adversarial suite |
| `M2-E08` | Deterministic Acceptance replay and exact repair authority retain M1 semantics across SQLite reopen | acceptance/reopen suite |
| `M2-E09` | Final Closeout binds the exact current Candidate and Evidence Set only after the Acceptance Engine issues current `ACCEPT` | black-box closeout proof |

### End-to-end deterministic and live demonstrations

| ID | Required proof | Primary evidence |
| --- | --- | --- |
| `M2-F01` | A controlled deterministic execution edits only generation 1, after which one required real check fails on its frozen digest without a live model or fabricated Evidence | deterministic fixture, workspace trace, and verification record |
| `M2-F02` | CodeClosure retains rejection/repair-required state, creates a distinct generation 2 from the exact eligible parent, and leaves frozen generation 1 unchanged | Runtime status, Candidate, and Acceptance records |
| `M2-F03` | The controlled repair execution changes only generation 2; fresh real verification passes, current Evidence is admitted, and Acceptance plus closeout follow in exact order | deterministic fixture, runner, Evidence, Acceptance, Closeout, and audit |
| `M2-F04` | A separate live Codex Turn edits only its current mutable Candidate and emits one valid completion request | bounded live run plus source comparison |
| `M2-F05` | The first live post-edit verification result is not prescribed: `PASS` follows the normal evidence path, while `FAIL` alone authorizes a distinct bounded repair generation; no synthetic failure or needless rejection occurs | live branch trace and policy assertions |
| `M2-F06` | The selected live branch reaches current passing Evidence, Acceptance, and Runtime closeout within bounded phase/Turn policy | runner, Evidence, Acceptance Decision, Closeout Record, and audit |
| `M2-F07` | The final public result names the exact live branch, Candidate, and Evidence digests and does not present Turn success as Goal authority | CLI JSON/human views |
| `M2-F08` | Neither demonstration performs Goal Intake, project promotion, Git push, release, deployment, or another external effect | command traces, fixture inspection, and audit review |

### Lifecycle, restart, and security

| ID | Required proof | Primary evidence |
| --- | --- | --- |
| `M2-G01` | `contextCompaction` lifecycle is admitted only as a bounded worker-session observation and does not add, remove, or revise CodeClosure authority | protocol and Runtime comparison test |
| `M2-G02` | Thread deletion, wrong Thread, wrong Turn, unavailable resume, and mismatched protocol profile fail closed | Thread policy suite |
| `M2-G03` | Approval requests beyond exact Candidate capability, session-wide grants, user input, MCP elicitation, connector, dynamic-tool, app, plugin, skill, search, and effect requests are disabled or declined/cancelled | server-request policy suite |
| `M2-G04` | Runtime cancellation interrupts current work without allowing a late event to close or corrupt the next dispatch | cancellation-order suite |
| `M2-G05` | App Server failure has no hidden retry authority and leaves a visible governed blocker/failure | backend failure black-box case |
| `M2-G06` | CodeClosure restart reconciles the old active Attempt before `ResumeGoal` creates fresh Attempt, Context, Session, dispatch, and default fresh Thread | cross-process restart proof |
| `M2-G07` | Restart never redispatches the old claim or duplicates Candidate mutation, Turn, Evidence, or audit effects | dispatch-count and strict-reopen proof |
| `M2-G08` | Strict reopen reconstructs identical Goal/Workflow/Candidate/Evidence/Acceptance/backend authority without transcript replay | SQLite and public-view comparison |
| `M2-G09` | Credentials, hidden reasoning, unbounded protocol content, and raw environment secrets do not enter Store, audit, CLI JSON, or acceptance report | redaction and retention audit |
| `M2-G10` | No worker-writable path can reach authority storage or another generation through configured roots or filesystem indirection | containment/security suite |
| `M2-G11` | Controlled Codex state, config, instructions, telemetry, history, and credentials cannot leak into Candidate commands, Candidate files, logs, audit, Evidence, or the report | state and secret-boundary audit |
| `M2-G12` | The bound Execution Profile decides every fresh/resume boundary, continuity mode, compaction mode, retention rule, and fallback; adapter discretion or effective-policy drift fails closed | policy projection, call-trace, and mismatch suite |
| `M2-G13` | An authorized post-compaction continuation can proceed on the selected Thread policy with current compiled Context, while Thread loss follows the exact fail-closed or fresh-Thread recovery path | deterministic compaction/continuation and Thread-loss fixtures |

### Regression, traceability, and milestone boundary

| ID | Required proof | Primary evidence |
| --- | --- | --- |
| `M2-H01` | All canonical runtime invariants have executable, non-skipped test metadata; any new invariant landed with its tests | invariant audit |
| `M2-H02` | The complete M1 deterministic suites and eight named demonstrations remain green | M1 regression stages |
| `M2-H03` | Direct `CreateGoal` behavior and authority remain unchanged | CLI and Runtime regression tests |
| `M2-H04` | FakeWorker remains a deterministic test adapter and cannot leak into the selected live M2 profile | dependency/composition tests |
| `M2-H05` | README, Architecture, domain status, ADR index, milestone boundary, plan, and review agree on exact implemented/non-implemented state | final documentation review |
| `M2-H06` | No source, package, command, schema, migration, view, or demo implements or claims Goal Intake | scope and dependency audit |
| `M2-H07` | No accepted result authorizes Candidate Promotion or another external effect | CLI surface, audit, and documentation review |

## 8. Required acceptance fixtures

### Deterministic reject/repair fixture

The deterministic fixture MUST be deliberately bounded and disposable. It
uses a controlled Worker/App Server behavior that produces an incomplete first
generation and a correct repair generation without a live model. The Runtime
must still use the real Candidate workspace, freeze, Verification Runner,
Evidence, Acceptance, audit, and closeout boundaries; the fixture MUST NOT
fabricate verification or authority records.

Its persisted chain MUST show:

```text
mutable Candidate generation 1
  -> controlled completion request
  -> frozen digest 1
  -> required real verification FAIL
  -> technical rejection / exact repair authority
  -> mutable Candidate generation 2 derived from generation 1
  -> controlled repair completion request
  -> frozen digest 2
  -> fresh required real verification PASS
  -> current Evidence Set
  -> Acceptance Engine ACCEPT
  -> Runtime CLOSEOUT
```

This is the stable proof that CodeClosure can govern rejection and repair. It
MUST make no model or external-network request.

### Live Codex fixture

The separate live fixture MUST be deliberately bounded and disposable. It
contains:

- a minimal Git repository with one small implementation defect;
- one exact required local check that fails before Codex edits the Candidate
  and passes after any correct edit;
- no dependency download, network call, credential, Git remote, effectful hook,
  submodule, generated secret, or user-owned file;
- an explicit allowed-path set containing only the intended source/test paths;
- a source-manifest digest and separate Git-metadata observation captured
  before and after the complete round; and
- separate Runtime authority, Candidate workspace, verifier temporary, and
  controlled Codex state roots.

The prompt may state the technical task and required check, but it MUST NOT tell
Codex to forge CodeClosure events, write the authority store, mark the Goal
accepted, bypass a failed check, intentionally produce a failing edit, edit
frozen source, or apply the Candidate to the fixture source.

The live branch is selected by the first real post-edit verification result:

```text
Codex edits mutable Candidate generation 1
  -> completion request
  -> freeze and real verification
      PASS -> current Evidence -> ACCEPT -> CLOSEOUT
      FAIL -> exact repair authority -> new generation
              -> bounded authorized repair Turn
              -> freeze and fresh verification
              -> PASS -> current Evidence -> ACCEPT -> CLOSEOUT
```

An alternate model edit that satisfies the exact bounded Goal is allowed. A
correct first-pass edit MUST NOT be rejected merely to demonstrate repair. If a
real failure occurs, the old frozen generation and its Evidence MUST NOT be
reused as current authority. The selected branch must reach a real passing
check within the bounded phase/Turn policy; otherwise the live case fails.

## 9. Canonical executable procedure

Slice 8 MUST add this repository command before M2 acceptance can begin:

```sh
corepack pnpm accept:m2
```

The command does not exist at plan time and MUST NOT be reported as currently
available. When implemented, it must execute in this order:

1. validate entry conditions without printing credentials;
2. capture opening source, Git, toolchain, platform, and Codex protocol
   identity;
3. regenerate TypeScript and JSON protocol schemas repeatedly, reject duplicate
   JSON keys, and compare the exact raw/canonical identities under the pinned
   normalization profile;
4. run the complete quality gate, including every M1 regression and M2 offline
   test;
5. run deterministic fake-App-Server protocol and adversarial acceptance cases;
6. run Candidate, verifier, Store fault-injection, recovery, and public CLI
   black-box cases;
7. run the deterministic real-Candidate/real-verifier
   reject/repair/accept fixture;
8. run the separate bounded live Codex edit-and-verify fixture and follow its
   natural first verification branch;
9. close and strictly reopen authority for both demonstrations, then compare
   public status and audit;
10. prove fixture content projections and non-owned paths are unchanged, and
    account separately for Git metadata;
11. capture closing source, environment, effective App Server input, and state
    identities; and
12. emit a machine-readable row-by-row result with aggregate zero-skip counts.

After the executable command, the operator MUST inspect complete output, run
`git diff --check`, inspect the actual diff and working-tree status, review the
live fixture's exact path ownership/effect trace, and write the dated M2 review.

If writing the review changes the identified source set, documentation and the
complete offline quality gate MUST rerun on the review-bearing tree. The live
case may be referenced from the immediately preceding identical product-source
run only when the acceptance runner's declared review exclusion and source
manifest prove that no product, fixture, schema, config, or test input changed.
Otherwise the complete round reruns.

## 10. Verdict rules

The only M2 verdicts are:

- `PASS`: every mandatory matrix row passes on one accepted source and protocol
  identity; every Node test summary has zero failed, cancelled, skipped, and
  todo tests; both the deterministic and live proofs pass; opening and closing
  identities match; no mandatory check is unavailable; and no blocking finding
  remains.
- `FAIL`: any mandatory assertion, test, schema comparison, dependency rule,
  protocol behavior, Candidate containment property, verification, Evidence,
  Acceptance, recovery, CLI, documentation, live outcome, non-effect claim, or
  identity comparison fails.
- `BLOCKED`: the exact source/environment/protocol identity cannot be
  established, or a required binary, auth session, model service, network path,
  fixture isolation property, dependency, or procedure is unavailable without
  changing scope or obtaining new authority.

There is no conditional pass, waiver, expected failure, flaky pass, optional
mandatory row, or replacement of the live run with a fake. A rerun after a fix
is a new acceptance round with a new dated execution record.

Findings use these classes:

- `BLOCKER`: contradicts an invariant, accepted ADR, M2 exit criterion,
  mandatory row, source/protocol identity, isolation property, or non-effect
  boundary. Any blocker forces `FAIL`.
- `NON_BLOCKING`: does not weaken M2 proof but should be addressed in a later
  milestone.
- `OBSERVATION`: factual context with no requested remediation.

No finding may waive a failed or unavailable row.

## 11. Report contract

The dated M2 completion review MUST contain:

1. date, scope, verdict, branch, base revision, working-tree state, source path
   count, and source digest;
2. OS/architecture, Node, pnpm, resolved Codex path, Codex version, executable
   digest, raw TypeScript-schema digest, canonical JSON-schema digest,
   normalization-profile identity, requested model/provider, controlled config
   and state identities, Thread/working-continuity/compaction/retention/fallback
   policies, capability classifications, managed-requirements identity,
   effective instruction sources/tools, and observed reroutes or warnings;
3. the exact canonical command and exit status;
4. every quality/offline stage with aggregate tests and zero-skip evidence;
5. every mandatory matrix row and its primary evidence reference;
6. the deterministic fixture source, Candidate, verifier, authority-home, and
   no-network identities;
7. its generation-1 and generation-2 parent/source digests, verification
   results, Evidence Set, Acceptance Decision, and Closeout bindings;
8. the live fixture source, Candidate, verifier, authority-home, controlled
   Codex state, selected first-verification branch, generation digests, and
   allowed external-network identities without secrets;
9. process failure, approval, bounded `contextCompaction`, post-compaction
   continuation, Thread loss, cancellation, restart, strict-reopen, and
   no-redispatch outcomes without private-state payloads;
10. source-checkout, Git-metadata, authority-isolation, cleanup-scope,
   credential-redaction,
   and no-external-effect proofs;
11. every finding, including an explicit zero count when none exist;
12. skipped or unavailable checks, both explicitly zero for `PASS`;
13. M2 non-claims, including Goal Intake, arbitrary-project support, product
    completion, and external effects; and
14. final `PASS`, `FAIL`, or `BLOCKED`, reiterating that the report is not a
    technical `ACCEPT` decision or Promotion authorization.

## 12. Gate to M2.5

M2.5 implementation MUST NOT begin from green unit tests, completed source,
successful live Codex output, or a provisional review. It may begin only after
this complete procedure records unconditional M2 `PASS` and the repository
status documents are updated consistently.

That `PASS` proves only that the reusable App Server client and Goal-bound
Worker execution branch satisfy M2. It does not prove the future Intake
Assistant Adapter, Intent Projection/Admission authority, Goal Materialization,
or Intake-authorized automatic Start path.
