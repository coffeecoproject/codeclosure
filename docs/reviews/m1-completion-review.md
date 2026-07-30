# M1 completion review

- Review date: 2026-07-30
- Scope: deterministic M1 control skeleton with `FakeWorker` only
- Result: **PASS — THE BOUNDED M1 EXIT CRITERIA ARE SATISFIED IN THE REVIEWED WORKING TREE**
- Full gate: `corepack pnpm gate:quality`
- Important qualification: this is an M1 milestone-completion decision, not
  product completion, a release decision, real-project verification, or
  authorization for an external effect.

## 1. Review question

Does the implemented M1 skeleton prove that CodeClosure, rather than its
worker, owns deterministic workflow and technical-completion authority, and is
that claim backed by current, reproducible evidence?

The answer is **yes within the explicit M1 fake-execution boundary**. The
Runtime is the only Workflow writer, the Acceptance Engine is the only
technical-decision issuer, SQLite independently closes retained authority, and
the public CLI cannot turn worker output, a status rendering, a generic human
approval, or technical closeout into a real-world effect.

## 2. Audited source identity

The audit ran against a modified working tree because no Git commit was
requested or created. A base revision alone would therefore be insufficient.
`node scripts/source-identity.mjs` records the base Git revision plus a
deterministic SHA-256 manifest over every Git-listed tracked or untracked,
non-ignored source path and its file kind. This review file is the sole
exclusion, avoiding a self-referential digest.

| Field | Value |
| --- | --- |
| Branch | `main` |
| Base Git revision | `e7502f2d1abf1bafa5e171376b5d590b3ecfa36b` |
| Working-tree state | Modified |
| Manifest schema | `codeclosure-source-manifest-v1` |
| Manifest paths | 220 |
| Manifest digest | `sha256:0cb8efb26d82cb1e137a60f8318bcecd3989c8a323bc4340668959b8d947c5c6` |
| Self-reference exclusion | `docs/reviews/m1-completion-review.md` |

Any later change to an included path invalidates this source identity and the
green evidence must be rerun. A future commit-scoped claim must name its own
resulting revision or reproduce the same manifest and gate.

## 3. Environment identity

| Component | Audited value |
| --- | --- |
| Host | `Darwin 25.1.0 arm64` |
| Node.js | `v22.22.3` |
| pnpm through Corepack | `11.1.3` |
| `better-sqlite3` | `13.0.1` |
| Embedded SQLite | `3.53.3` |
| Time zone | `Asia/Shanghai` (`+0800`) |

The root manifest and dependency audit independently require Node
`>=22.22.0 <23`, pnpm `11.1.3`, exact third-party versions, and the matching
direct lockfile importers.

## 4. Required quality stages

The root gate executes the following stages in this exact order. Every invoked
Node test run reported zero failed, cancelled, skipped, and todo tests. The
wrapper treats any nonzero value in those categories as a gate failure.

| Stage | Command | Current result |
| ---: | --- | --- |
| 1 | `corepack pnpm format:check` | Pass |
| 2 | `corepack pnpm docs:check` | Pass; 47 Markdown sources and the README source contract checked |
| 3 | `corepack pnpm lint` | Pass; ESLint plus 22 CLI/dependency audit tests |
| 4 | `corepack pnpm typecheck` | Pass; project references and all test sources |
| 5 | `corepack pnpm test:unit` | Pass; 3 runner-contract tests and 136 unit/property tests |
| 6 | `corepack pnpm test:digests` | Pass; 36 canonical digest, golden, and replay tests |
| 7 | `corepack pnpm test:migrations` | Pass; 99 migration/reopen tests |
| 8 | `corepack pnpm test:authority` | Pass; 244 authority, Store, adversarial, and reopen tests |
| 9 | `corepack pnpm test:cli` | Pass; 58 CLI and cross-process restart tests |
| 10 | `corepack pnpm test:demos` | Pass; all 8 named proof scenarios |
| 11 | `corepack pnpm test:invariants` | Pass; 4 audit tests and 31/31 invariant coverage |
| 12 | `corepack pnpm build` | Pass; forced production compilation |

The digest stage intentionally reruns the authority tests that constitute the
named golden/replay proof rather than relying on their earlier unit-stage
execution. The eight demo processes are likewise rerun independently of CLI
integration so a missing adversarial recipe is visible at its own gate stage.

## 5. SQLite schema and migration inspection

The executable
[migration audit](../../packages/store-sqlite/test/migration-audit.test.ts)
inspects the migration sources, applies them to a fresh file-backed database,
checks the authoritative ledger against source SHA-256 digests, closes and
reopens the database, reapplies the migration runner, and compares the complete
inspection result.

| Check | Result |
| --- | --- |
| Ordered migration files | Exact consecutive set `0001` through `0019` |
| Migration source type | All 19 entries are regular files |
| Applied ledger | 19 exact names, versions, source checksums, and original application times |
| SQLite integrity | `PRAGMA integrity_check` returned `ok` |
| Foreign-key integrity | Zero violations |
| Strict tables | 29/29 |
| Other schema objects | 18 indexes, 124 triggers, 0 views |
| Schema fingerprint | `sha256:df43d9bbd3a636791c91a82f587c21ea3a87b5fd50c971fc544e393a0f46f693` |
| Reopen/reapplication | Identical ledger and schema inspection; no migration replay |

The broader migration and authority stages also exercise poisoned legacy rows,
partial-migration rollback, removed guards, post-migration corruption, and
strict startup revalidation. A path existing on disk is never used as identity
evidence.

## 6. Actual package-dependency audit

The audit parses every workspace manifest, the direct pnpm lockfile importers,
and static imports/exports/import types/dynamic imports across 135 JavaScript
or TypeScript source files. It rejects undeclared imports, package-crossing
relative imports, unlocked or non-exact versions, unexpected workspace
packages, and dependency edges outside the closed M1 graph.

| Production package | Actual direct package imports |
| --- | --- |
| `@codeclosure/domain` | `zod` |
| `@codeclosure/runtime` | `@codeclosure/domain`, `zod` |
| `@codeclosure/store-sqlite` | `@codeclosure/domain`, `@codeclosure/runtime`, `better-sqlite3`, `zod` |
| `@codeclosure/testing` | `@codeclosure/domain`, `@codeclosure/runtime` |
| `@codeclosure/cli` | `@codeclosure/runtime`, `@codeclosure/store-sqlite`, `@codeclosure/testing`, `zod` |

There is no Codex, OpenAI SDK, former IntentOS, cloud-execution, or multi-agent
dependency in the M1 package graph. Privileged CLI composition edges remain
separately constrained by the exact owner/consumer boundary audit.

## 7. Invariant-to-test report

`corepack pnpm test:invariants` parses the 31 invariant definitions and
executable `node:test` title metadata with the TypeScript syntax tree. It does
not count `skip`, `todo`, focused tests, comments, or arbitrary string content
as proof. The generated report inspected 34 test source files and found 360
metadata-bearing executable test registrations, with at least one registration
for every invariant.

The four formerly uncovered metadata rows now have direct owning proofs:

| Invariant | Direct M1 proof |
| --- | --- |
| I-022 | Scenario references are derived one-for-one from required criteria and remain independent of identifier/storage order |
| I-025 | The exact CLI operation set contains no merge, release, deploy, promotion, or effect command |
| I-026 | A retained or generic Human approval prevents M1 Acceptance compilation rather than bypassing Evidence |
| I-029 | Runtime and a fresh CLI process reconcile interrupted authority before fresh continuation and never redispatch the old claim |

The report is a traceability check, not a second completion authority. The
underlying tests and Runtime/Store checks remain the proof.

## 8. Milestone exit-criterion review

| M1 exit criterion | Result | Evidence |
| --- | --- | --- |
| State-machine and Acceptance adversarial tests pass | Pass | Unit/property, digest/replay, authority, CLI, and all eight named demo stages |
| Restart preserves authoritative state | Pass | Exact migration/reopen suite, Store startup validation, and cross-process CLI reads |
| Restart never redispatches consumed authority; resume uses the same profile with a fresh Attempt | Pass | I-029 Runtime test, real interrupted CLI-process test, and `restart-resume` demo |
| State mutation and audit append are atomic | Pass | Fault injection at every authority-write boundary plus SQLite transaction tests |
| Stale version writes are rejected | Pass | Command freshness, concurrency, stale closeout, and replay tests |
| Worker cannot write Acceptance or terminal state | Pass | Closed Worker contracts, direct-Store forgery rejection, and `lying-worker` demo |
| Missing or mismatched required input fails closed | Pass | Context, Candidate, Evidence, Policy/Profile, Acceptance, recovery, and migration adversarial tests |
| Acceptance replay is deterministic | Pass | Canonical golden digests, semantic replay, strict checker/policy identity, and reopen validation |
| Documentation and implementation vocabulary agree | Pass | Repository-wide GFM/link/status checks and status review recorded below |
| Domain/runtime have no Codex dependency | Pass | Manifest, lockfile, and actual source-import graph audit |

## 9. Documentation consistency review

| Required record | Review result |
| --- | --- |
| Root README | Updated to one prose-only M1-complete Status section; no rolling feature/test inventory |
| `ARCHITECTURE.md` | Current M1 implementation and later target boundaries distinguished |
| Domain documents | Workflow, domain model, Context, Evidence, and Acceptance status sections reviewed and synchronized |
| ADR index | Reviewed; no architectural decision changed, so no new ADR was required |
| Milestone boundary | M1 marked complete only within its `FakeWorker` scope; M2 explicitly remains not started |
| Detailed plan | Slice 8 marked implemented with this review as its evidence record |
| Acceptance plan | Complete mandatory matrix, isolation, evidence, and verdict rules recorded |
| Dated acceptance run | 34/34 mandatory rows and the independent public-CLI suite passed |

## 10. Deferred proof and non-claims

M1 deliberately does not prove or authorize:

- Codex/App Server integration or any other real coding agent;
- real worktree/candidate isolation, source edits, cleanup, or promotion;
- real test/build runners or correctness of an external project;
- full Fact Graph or business-scenario traversal;
- a Human Decision Gateway or generic approval command;
- merge, commit, push, release, deployment, paid resources, external
  communication, or irreversible data effects;
- multi-agent, cloud, multi-user, retry-scheduler, or rich-TUI behavior; or
- product completion or production readiness.

These are later-milestone concerns. M1 proves the deterministic control plane
independently of model behavior, exactly as required by its milestone boundary.

## 11. Decision

The reviewed working tree satisfies Slice 8 and the complete bounded M1 exit
criteria. The independent
[M1 acceptance run](m1-acceptance-run-2026-07-30.md) also passed every mandatory
row against this boundary. M1 may close and the repository may enter M2
planning. Starting M2 implementation still requires an explicit next task and
must preserve every M1 authority boundary; this review grants no broader effect
or release authority.
