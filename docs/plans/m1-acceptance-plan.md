# M1 milestone acceptance plan

## 1. Purpose

This plan determines whether one exact CodeClosure working tree satisfies the
bounded M1 deterministic-skeleton milestone. It turns the M1 exit criteria into
a repeatable acceptance procedure with explicit entry conditions, cases,
evidence, and verdict rules.

This is a milestone assessment plan. It MUST NOT issue or replace a technical
`ACCEPT` decision, mutate Workflow state, authorize promotion, or authorize any
external effect. Only the Acceptance Engine may issue technical decisions and
only the Workflow Runtime may mutate Workflow state.

## 2. Governing authority

The acceptance round MUST apply the repository authority order. Its primary
normative inputs are:

1. [`RUNTIME_INVARIANTS.md`](../../RUNTIME_INVARIANTS.md);
2. the [accepted ADR index](../adr/README.md) and its accepted records;
3. [`PRODUCT.md`](../../PRODUCT.md) and
   [`ARCHITECTURE.md`](../../ARCHITECTURE.md);
4. the current domain documents for
   [Workflow](../workflow.md), [Domain Model](../domain-model.md),
   [Context](../context-compiler.md), [Acceptance](../acceptance-engine.md), and
   [Evidence](../evidence-model.md);
5. the [M1 milestone boundary](../milestones.md#m1--deterministic-skeleton-with-fakeworker);
6. the [M1 implementation record](m1-deterministic-skeleton.md).

An easier implementation or a passing test MUST NOT override a conflict with a
higher-authority record. A durable architectural change discovered during
acceptance requires an ADR before the milestone can pass.

## 3. Acceptance question

The round answers one question:

> Does the identified source tree prove, using `FakeWorker` only, that
> CodeClosure owns deterministic Workflow and technical-completion authority,
> retains that authority across SQLite restart, fails closed under the named
> adversarial cases, and exposes only the bounded M1 CLI?

The accepted unit is the complete identified working tree, not an individual
package, test, document, generated build directory, worker claim, or previous
review.

## 4. Scope

The mandatory acceptance scope is:

- Node.js 22, strict TypeScript, ESM, and the pnpm workspace boundary;
- typed domain identifiers and legal Workflow transitions;
- Runtime-only Workflow mutation and Acceptance-Engine-only technical
  decisions;
- immutable Policy and Execution Profile installation and first-start binding;
- minimal Context Manifest, Candidate generations, immutable Evidence, and
  deterministic Acceptance replay;
- SQLite schema, migration ledger, transactions, optimistic concurrency,
  audit append, strict reopen, and startup reconciliation;
- public create, start, status, resume, cancel, audit, and demo CLI behavior;
- the eight named happy, negative, restart, replay, and drift demonstrations;
- source dependency boundaries and invariant-to-executable-test traceability;
  and
- documentation vocabulary and M1 status consistency.

The following remain outside M1 and MUST NOT be inferred from a passing
verdict:

- Codex, another real coding worker, or multiple agents;
- real source editing, worktree isolation, cleanup, or promotion;
- real test/build runners for a governed external project;
- full Fact Graph discovery or business-scenario traversal;
- Human Decision Gateway behavior;
- merge, commit, push, release, deployment, paid resources, communication, or
  other external effects;
- cloud, multi-user, scheduler, or rich-TUI behavior; and
- product completion or production readiness.

## 5. Entry conditions

Before the round begins, the operator MUST establish all of the following:

1. The repository root is the current working directory.
2. Node and pnpm satisfy the exact root manifest constraints and dependencies
   are already installed. The round requires no network access.
3. The base Git revision, branch, clean or modified state, source-manifest
   schema, path count, and digest are captured with
   `node scripts/source-identity.mjs`.
4. A modified working tree is allowed only when the manifest covers every
   tracked or untracked, non-ignored source path. The self-referential M1
   completion review is the sole declared exclusion.
5. No source path may change between the opening identity capture and the end
   of the executable run. Generated ignored build output is not source.
6. No unresolved higher-authority document conflict or known blocking defect
   is being waived.

If an entry condition cannot be established, the verdict is `BLOCKED`, not
`PASS`.

## 6. Isolation and evidence rules

The executable round MUST use only repository scripts and local temporary
directories. The independent black-box suite MUST:

- invoke the built CLI as separate Node processes;
- assign a fresh authority home outside the fixture project;
- use JSON output as an untrusted external contract and validate its shape;
- require empty standard error for governed, expected outcomes;
- close and reopen authority through fresh processes before comparing retained
  status;
- inspect authority only through public status and audit commands;
- prove usage failures open no authority home;
- remove only its own unique temporary directory when finished; and
- perform no network call or external effect.

The dated acceptance report MUST record the exact source and environment
identity, commands, aggregate counts, case outcomes, skipped or unavailable
checks, findings, and final verdict. A prose claim without current command
evidence is insufficient.

## 7. Mandatory acceptance matrix

Every row is required. The canonical command may cover several rows, but the
report MUST preserve each row's individual result.

| ID | Area | Required proof | Primary evidence |
| --- | --- | --- | --- |
| `M1-A01` | Source identity | Base revision and complete modified-tree manifest are captured before and after execution without drift | `source-identity.mjs` output |
| `M1-A02` | Toolchain | Node, pnpm, package versions, and direct lockfile importers match exact manifest constraints | dependency audit and environment capture |
| `M1-A03` | Documentation | GFM structure, portable local links, README Status contract, vocabulary, and milestone status are consistent | documentation checker and review |
| `M1-A04` | Package boundary | Actual source imports form only the closed M1 graph and domain/runtime contain no Codex or OpenAI dependency | manifest, lockfile, and source-import audit |
| `M1-B01` | Compilation | Formatting, lint, strict typecheck including tests, and forced production build pass | quality gate stages 1, 3, 4, and 12 |
| `M1-B02` | Test runner | Failed, cancelled, skipped, and todo tests cannot be hidden by the runner | runner contract tests and all stage summaries |
| `M1-C01` | Domain and Workflow | Legal transitions succeed and illegal, stale, unknown, or mismatched commands fail closed | unit/property and authority suites |
| `M1-C02` | Single writer | Worker and public adapters cannot write Workflow terminal state; every audit actor is Runtime | authority tests and black-box audit |
| `M1-C03` | Atomicity | State mutation and audit append commit together; injected partial failures roll back | SQLite authority fault-injection tests |
| `M1-C04` | Concurrency | Stale Goal revision and Workflow version writes are rejected | Runtime and Store concurrency tests |
| `M1-D01` | Acceptance authority | Only the Acceptance Engine issues technical decisions and worker completion cannot close a Goal | authority/adversarial tests |
| `M1-D02` | Exact binding | Candidate, Evidence, Context, Policy/Profile, and Acceptance digests and identities must match exactly | digest, replay, and authority suites |
| `M1-D03` | Replay | Canonical Acceptance replay is deterministic and rejects semantic or identity drift | digest golden/replay suite |
| `M1-D04` | Fail closed | Missing, malformed, failing, stale, or changed inputs cannot produce technical closeout | authority suite and named demos |
| `M1-E01` | Schema | Exactly 19 ordered migrations produce the locked strict schema, indexes, triggers, and fingerprint | migration audit |
| `M1-E02` | Restart | Migration ledger, authoritative state, audit, and status survive strict close/reopen | migration/reopen and CLI suites |
| `M1-E03` | Recovery | Interrupted dispatch is reconciled before continuation; resume creates a fresh Attempt without redispatching the old claim | restart integration and `restart-resume` demo |
| `M1-F01` | CLI usage | Missing required input and unknown/effectful operations exit as usage errors before authority opens | independent black-box suite |
| `M1-F02` | CLI lifecycle | Create and fresh-process status retain `DISCOVERY / READY` without inventing closeout | independent black-box suite |
| `M1-F03` | CLI closeout | Happy start reaches `CLOSEOUT / CLOSED` only with exact accepted Candidate and Acceptance references | independent black-box suite |
| `M1-F04` | CLI rejection | Failing Evidence exits as a governed stop, remains repair-required, and resume invents no repair authority | independent black-box suite |
| `M1-F05` | CLI cancellation | Cancel persists `CANCELLED` and never renders technical closeout | independent black-box suite |
| `M1-F06` | CLI audit/reopen | Public audit is Runtime-authored, ordered, digest-bearing, and fresh-process status is identical | independent black-box suite |
| `M1-F07` | Authority isolation | Ordinary authority is retained outside the untouched project fixture | independent black-box suite |
| `M1-G01` | Named demos | `happy-path` proves exact closeout | `test:demos` |
| `M1-G02` | Named demos | `lying-worker` rejects fabricated completion authority | `test:demos` |
| `M1-G03` | Named demos | `missing-evidence` fails before Acceptance | `test:demos` |
| `M1-G04` | Named demos | `failing-evidence` retains repairable rejection without closeout | `test:demos` |
| `M1-G05` | Named demos | `stale-closeout` invalidates superseded closeout authority | `test:demos` |
| `M1-G06` | Named demos | `restart-resume` reconciles and resumes through a fresh Attempt | `test:demos` |
| `M1-G07` | Named demos | `duplicate-result` produces one effect for one dispatch claim | `test:demos` |
| `M1-G08` | Named demos | `candidate-drift` invalidates changed frozen source | `test:demos` |
| `M1-H01` | Traceability | All 31 runtime invariants have executable, non-skipped test metadata | invariant audit |
| `M1-H02` | Milestone boundary | Completion records make no claim of M2 implementation, release authority, or product completion | final documentation review |

## 8. Execution procedure

From the repository root, run:

```sh
corepack pnpm accept:m1
```

The command MUST execute in this order:

1. capture the opening source identity;
2. run the complete twelve-stage `gate:quality` command;
3. run the independent public-CLI black-box acceptance suite; and
4. capture the closing source identity.

The twelve gate stages are formatting, documentation, lint/dependency audit,
strict typecheck, unit/property, digest/replay, migration/reopen,
authority/Store, CLI integration, eight demos, invariant traceability, and
forced production build.

After the executable command, the operator MUST inspect the complete output,
confirm the two source identities match, run `git diff --check`, inspect the
actual working-tree diff and status, and record the dated report. If writing
the report changes the identified source set, the final documentation and full
quality gate MUST be rerun against the report-bearing tree before the verdict
is claimed.

## 9. Verdict rules

The only round verdicts are:

- `PASS`: every mandatory matrix row passed on the same identified source;
  every Node test summary has zero failed, cancelled, skipped, and todo tests;
  both source identities match; there are no unresolved blocking findings; and
  every skipped or unavailable check count is zero.
- `FAIL`: any mandatory assertion, command, migration, test, build, link,
  dependency, authority boundary, or source-identity comparison fails.
- `BLOCKED`: the source or environment cannot be identified, a required tool
  or dependency is unavailable, or the procedure cannot finish without
  changing scope or obtaining new authority.

There is no conditional pass. A rerun after a fix is a new acceptance round and
MUST receive a new dated execution record.

Findings are classified as follows:

- `BLOCKER`: contradicts an invariant, accepted ADR, M1 exit criterion, source
  identity, or executable mandatory case. Any blocker forces `FAIL`.
- `NON_BLOCKING`: does not contradict M1 and does not weaken a required proof,
  but is worth recording for a later milestone.
- `OBSERVATION`: factual context with no requested remediation.

No finding may waive a failed mandatory row.

## 10. Report contract

The dated report MUST contain:

1. date, scope, verdict, branch, base revision, working-tree state, manifest
   path count and digest, and environment versions;
2. the exact canonical command and its exit status;
3. all twelve quality-stage results and zero-skip evidence;
4. every independent black-box case result;
5. the eight named demo results;
6. the migration/schema and invariant audit summaries;
7. all findings, including an explicit statement when there are none;
8. skipped or unavailable checks, including an explicit zero count;
9. the M1 non-claims; and
10. a final `PASS`, `FAIL`, or `BLOCKED` milestone verdict that reiterates that
    the report is not a technical `ACCEPT` decision or external-effect
    authorization.
