# M1 acceptance run — 2026-07-30

## 1. Verdict

- Plan: [M1 milestone acceptance plan](../plans/m1-acceptance-plan.md)
- Scope: bounded deterministic M1 control skeleton with `FakeWorker` only
- Canonical command: `corepack pnpm accept:m1`
- Command exit status: `0`
- Verdict: **PASS — EVERY MANDATORY M1 ACCEPTANCE CASE PASSED**

This is a milestone verdict for the identified M1 source and environment. It is
not an Acceptance Engine technical `ACCEPT` decision, product completion,
release approval, real-project verification, promotion consent, or authority
for an external effect.

## 2. Executed source identity

The canonical command captured the following identity immediately before and
after its quality gate and independent black-box suite. The two captures were
identical.

| Field | Executed value |
| --- | --- |
| Branch | `main` |
| Base Git revision | `e7502f2d1abf1bafa5e171376b5d590b3ecfa36b` |
| Working-tree state | Modified |
| Manifest schema | `codeclosure-source-manifest-v1` |
| Manifest paths | 219 |
| Opening digest | `sha256:53e1cc891ad5334ab55236cd520c578e582a672abaa6807544da0c560a30dd8b` |
| Closing digest | `sha256:53e1cc891ad5334ab55236cd520c578e582a672abaa6807544da0c560a30dd8b` |
| Manifest exclusion | `docs/reviews/m1-completion-review.md` only |

This table identifies the executable source before this dated report was
added. The report is itself an included source path, so the exact final
report-bearing tree identity is recorded in the self-reference-excluded
[M1 completion review](m1-completion-review.md) and was subjected to the final
confirmation described below. No implementation source changed between the
canonical run and that confirmation.

## 3. Environment

| Component | Accepted value |
| --- | --- |
| Host | `Darwin 25.1.0 arm64` |
| Node.js | `v22.22.3` |
| pnpm through Corepack | `11.1.3` |
| `better-sqlite3` | `13.0.1` |
| Embedded SQLite | `3.53.3` |
| Time zone | `Asia/Shanghai` (`+0800`) |

The dependency audit also verified Node `>=22.22.0 <23`, pnpm `11.1.3`, exact
third-party versions, and matching direct lockfile importers.

## 4. Canonical command results

All twelve quality stages passed. Every stage run through the Node test wrapper
reported zero failed, cancelled, skipped, and todo tests.

| Stage | Evidence | Result |
| ---: | --- | --- |
| 1 | Formatting check | Pass |
| 2 | Documentation checker tests and repository check | Pass; 75/75 tests and 46 GFM sources in the executed pre-report tree |
| 3 | ESLint, CLI boundary, and dependency audit | Pass; 22/22 audit tests, 5 workspace packages, and 135 JavaScript/TypeScript sources |
| 4 | Strict production and test-source typecheck | Pass |
| 5 | Test-runner contract and unit/property tests | Pass; 3/3 and 136/136 |
| 6 | Canonical digest, golden, and replay tests | Pass; 36/36 |
| 7 | Migration and strict reopen tests | Pass; 99/99 |
| 8 | Runtime, Store, authority, adversarial, and reopen tests | Pass; 244/244 |
| 9 | Public CLI and cross-process integration tests | Pass; 58/58 |
| 10 | Named M1 adversarial demos | Pass; 8/8 |
| 11 | Invariant audit tests and generated coverage | Pass; 4/4 and 31/31 invariants |
| 12 | Forced production build | Pass |

The test-bearing stages reported 877 executed test registrations in aggregate.
Some deliberately rerun the same authority proof under a distinct gate such as
digest/replay, so this is an execution count rather than a unique-test count.

## 5. Independent public-CLI black-box results

The acceptance script used only the built CLI, fresh child processes, JSON
output, and public status/audit reads. Its temporary SQLite authority home was
a sibling of an untouched project fixture and was removed after the run.

| Case | Result | Observed boundary |
| --- | --- | --- |
| `M1-F01a` | Pass | Missing criterion exited 2 with `CLI_USAGE` before the authority home existed |
| `M1-F02` | Pass | Create plus a fresh status process retained `DISCOVERY / READY`, with no Policy/Profile binding or closeout |
| `M1-F03` | Pass | Happy start exited 0 at `CLOSEOUT / CLOSED` with accepted Candidate, Acceptance, Policy/Profile, and closeout references |
| `M1-F06` | Pass | Audit events were ordered, digest-bearing, Runtime-authored, and status was identical after another strict reopen |
| `M1-F04` | Pass | Failing Evidence exited 4 at `ACCEPTANCE_REPAIR_REQUIRED`; status retained `REJECT_REPAIRABLE`, and resume was rejected without invented repair authority |
| `M1-F05` | Pass | Cancel persisted `CANCELLED` with no Acceptance or technical closeout |
| `M1-F01b` | Pass | `merge`, `release`, `deploy`, and `promotion` each exited 2 as unknown usage and opened no authority home |
| `M1-F07` | Pass | SQLite authority existed outside the project while the project fixture remained empty |

Independent black-box total: **8/8 passed**.

## 6. Named adversarial demonstrations

| Scenario | Proof code | Result |
| --- | --- | --- |
| `happy-path` | `HAPPY_PATH_EXACT_CLOSEOUT` | Pass |
| `lying-worker` | `LYING_WORKER_REJECTED` | Pass |
| `missing-evidence` | `MISSING_EVIDENCE_FAILED_CLOSED` | Pass |
| `failing-evidence` | `FAILING_EVIDENCE_REPAIR_REQUIRED` | Pass |
| `stale-closeout` | `STALE_CLOSEOUT_INVALIDATED` | Pass |
| `restart-resume` | `RESTART_RESUME_FRESH_ATTEMPT` | Pass |
| `duplicate-result` | `DUPLICATE_RESULT_DEDUPLICATED` | Pass |
| `candidate-drift` | `CANDIDATE_DRIFT_INVALIDATED` | Pass |

Each demonstration compared its final status with a strictly reopened status.
The restart case interrupted a real CLI child process, reconciled before
continuation, retained one claim for the abandoned dispatch, and resumed with a
fresh Attempt.

## 7. Persistence and traceability evidence

The migration audit verified the exact consecutive `0001` through `0019`
migration set, source checksums in the applied ledger, SQLite integrity `ok`,
zero foreign-key violations, 29 strict tables, 18 indexes, 124 triggers, zero
views, and schema fingerprint
`sha256:df43d9bbd3a636791c91a82f587c21ea3a87b5fd50c971fc544e393a0f46f693`.
Closing, reopening, and reapplying the migration runner produced an identical
ledger and schema inspection without replaying migrations.

The invariant audit parsed 31 definitions and executable `node:test` title
metadata from 34 test source files. It found 360 metadata-bearing executable
registrations and coverage of 31/31 invariants. Skipped, todo, focused,
comment-only, or arbitrary string references did not count as proof.

## 8. Mandatory matrix disposition

| ID | Result | Evidence disposition |
| --- | --- | --- |
| `M1-A01` | Pass | Opening and closing 219-path manifests matched exactly |
| `M1-A02` | Pass | Environment, exact versions, manifests, and lockfile importers matched |
| `M1-A03` | Pass | Documentation tests/check and final status review passed |
| `M1-A04` | Pass | Closed dependency graph contained no Codex/OpenAI edge |
| `M1-B01` | Pass | Format, lint, strict typecheck, and forced build passed |
| `M1-B02` | Pass | Runner contract passed; fail/cancel/skip/todo were all zero |
| `M1-C01` | Pass | State-machine, property, and fail-closed authority tests passed |
| `M1-C02` | Pass | Worker mutation/forgery tests and Runtime-only public audit passed |
| `M1-C03` | Pass | Transaction and injected rollback tests passed |
| `M1-C04` | Pass | Stale revision/version and concurrency tests passed |
| `M1-D01` | Pass | Acceptance ownership and lying-worker proofs passed |
| `M1-D02` | Pass | Exact digest and identity binding proofs passed |
| `M1-D03` | Pass | Golden and semantic replay proofs passed |
| `M1-D04` | Pass | Missing, malformed, failing, stale, and drift cases failed closed |
| `M1-E01` | Pass | Ordered migration set and locked schema fingerprint passed |
| `M1-E02` | Pass | Ledger, state, audit, and status survived strict reopen |
| `M1-E03` | Pass | Startup reconciliation and fresh-Attempt resume passed |
| `M1-F01` | Pass | Required-input and effect-operation usage rejections passed |
| `M1-F02` | Pass | Initial lifecycle/status boundary passed |
| `M1-F03` | Pass | Exact closeout boundary passed |
| `M1-F04` | Pass | Governed repair stop and resume refusal passed |
| `M1-F05` | Pass | Cancellation boundary passed |
| `M1-F06` | Pass | Audit and fresh-process reopen passed |
| `M1-F07` | Pass | Authority/project isolation passed |
| `M1-G01` | Pass | `happy-path` proof passed |
| `M1-G02` | Pass | `lying-worker` proof passed |
| `M1-G03` | Pass | `missing-evidence` proof passed |
| `M1-G04` | Pass | `failing-evidence` proof passed |
| `M1-G05` | Pass | `stale-closeout` proof passed |
| `M1-G06` | Pass | `restart-resume` proof passed |
| `M1-G07` | Pass | `duplicate-result` proof passed |
| `M1-G08` | Pass | `candidate-drift` proof passed |
| `M1-H01` | Pass | Executable invariant coverage was 31/31 |
| `M1-H02` | Pass | M2 remains not started; no release or product-completion claim was introduced |

Mandatory matrix total: **34/34 passed**.

## 9. Findings and unavailable checks

| Classification | Count | Disposition |
| --- | ---: | --- |
| `BLOCKER` | 0 | None |
| `NON_BLOCKING` | 0 | None |
| `OBSERVATION` | 1 | The accepted tree is modified and uncommitted; the exact manifest, not the base revision alone, identifies it |
| Skipped checks | 0 | None |
| Unavailable checks | 0 | None |

The acceptance work added a repeatable plan, a public-CLI black-box harness,
and this evidence record. It did not change the Runtime, Acceptance Engine,
Store schema, Worker contract, or CLI command surface.

## 10. Final report-bearing-tree confirmation

After adding this report and its indexes, the full quality gate and independent
black-box suite were rerun. Documentation discovery increased to 47 GFM
sources; all other executable counts and all outcomes remained green. The
final source identity was refreshed in the
[M1 completion review](m1-completion-review.md), and `git diff --check` passed.

## 11. Non-claims and final decision

This round does not prove Codex integration, real Candidate worktrees, real
external-project tests, Human Decision Gateway behavior, promotion, release,
deployment, cloud/multi-user behavior, or product readiness. Those remain
outside the M1 milestone.

All 34 mandatory rows passed with zero blockers, skipped checks, or unavailable
checks. The identified M1 working tree therefore receives a **PASS** milestone
verdict and may remain closed while M2 planning begins separately. The verdict
does not create technical `ACCEPT` authority or authorize any external effect.
