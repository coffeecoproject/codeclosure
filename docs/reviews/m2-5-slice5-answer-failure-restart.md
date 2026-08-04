# M2.5 Slice 5 Answer-only, Failure, and Restart Review

- Review date: 2026-08-04
- Scope: M2.5 Slice 5 only
- Status: Complete
- Verdict: `PASS` for M2.5 Slice 5 only; Slice 6 has not begun

## Review question

This review asks whether Slice 5 implements bounded Answer-only delivery,
terminal Intake failure, exact replay, operation-kind-aware startup
reconciliation, the fixed local retention grammar, non-retention of rejected
payloads, and redacted in-process status/audit views without beginning Goal
Materialization, ordinary Start, CLI, or the M2.5 milestone verdict.

It does not claim that Goal Intake is operational or that M2.5 is complete.

## Source identity

The reviewed working-tree source identity excludes only this review file to
avoid self-reference:

```text
Base Git revision: 56990d2f1ffacdef599d004d1191bf647c21583f
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 973
Source manifest digest: sha256:ba5db9ff494247ea86f2b17476c9349aa5d466488d275e4e9d7f2d80e81b4c1d
Self-referential review exclusion: docs/reviews/m2-5-slice5-answer-failure-restart.md
```

The implementation branch is `m2.5-goal-intake`. Final verification uses Node
`v22.22.3`, inside the repository's supported range, and pnpm `11.1.3`.

## Implemented boundary

`M25IntakeCoordinator` now reserves an exact Answer-only Manifest and immutable
operation binding before calling the separate assistant port. It commits one
prepared `PRE_ANALYSIS_NO_EXECUTION / ANSWER_ONLY` Decision, one bounded
`AnswerReturned` or typed `AnswerFailed`, terminal `NO_EXECUTION`, audits, and
the Store-authored `APPLIED` outcome atomically. The command result returns
validated answer content only as a non-authoritative delivery value. Exact
active delivery does not start a second operation, and exact terminal replay
returns retained content without another assistant call.

Intent-analysis timeout, unavailability, protocol failure, response rejection,
and interrupted restart close through the existing typed Failure Record,
terminal `FAILED`, audit, and Store-authored `FAILED` outcome. Closed Domain and
Store checks permit a `FAILED` outcome only for a reserved external Intent or
clarification analysis and require Intent-analysis failures to retain the exact
adapter and response-contract binding. Answer-only reservations require one
`APPLIED / NO_EXECUTION` Answer result and cannot be submitted or reopened as
Intake `FAILED`. Store, audit, clock, codec, and command-conflict errors are not
converted into a recorded failure.

The Answer terminal Decision and Response references close as exact
Run/Outcome/record tuples, including Response ID, digest, and kind. Store commit
rejects a substituted tuple before mutation. Strict reopen independently
requires one unique consuming Outcome and the same Intake, Raw Request,
Decision, reservation, and terminal Run throughout the Answer chain. The
Failure chain similarly requires one unique consuming Outcome and the same
Intake Run and Command. Strict reopen rejects cross-Intake Decision, Response,
or Failure reuse, substituted Run or Outcome kinds, mixed Answer reference
presence, and Answer Response SQL identity, Decision, digest, kind, or time
columns that disagree with the immutable record JSON. A follow-up adversarial
review exposed the earlier cross-Intake consumer gap; the closed ownership
checks and direct SQL poisoning regressions in this reviewed source correct it.

Startup reconciliation first consumes the Store's strictly validated list of
outcome-less `ANALYZING` operations. Intent and clarification analysis close as
`FAILED / INTERRUPTED_ANALYSIS`. Answer-only recovery deterministically
reconstructs the prepared Decision and exact Package/Manifest digest, then
commits `NO_EXECUTION / ANSWER_FAILED / INTERRUPTED_ANSWER_DELIVERY`. Recovery
makes no assistant call. A missing, duplicate, mixed, or irreproducible active
operation blocks publication through an exception rather than being rewritten.

The Answer-only prepared Decision ID is derived from the already retained
canonical command-input digest. This makes the package identity reproducible
across restart while leaving the Decision's semantic digest and Admission
ownership unchanged.

## Retention and read views

The Runtime retention classifier implements the exact accepted grammar: valid
Unicode scalar strings only; no NUL or prohibited C0/C1 controls; exact CRLF,
lone-CR, and lone-LF splitting; ASCII SPACE/TAB-only line trimming; the closed
case-sensitive private-key marker set; and the closed ASCII-case-insensitive
field-marker set with only ASCII SPACE/TAB before `:` or `=`. It applies before
Raw Request creation and to every decoded assistant-authored string before
Proposal or Answer retention.

A rejected user submission returns only command/profile identity, typed reason,
observed byte count, and a semantic rejection digest. It creates no Raw Request,
content digest, reservation, or assistant call. Rejected assistant content
commits only `RESPONSE_REJECTED` in the appropriate typed terminal record;
neither its bytes nor a content/payload digest are retained. The executable
proof closes the Store, scans the complete SQLite file for every rejected byte
sequence and computed content/payload digest, and separately proves no rejected
Proposal was retained. Store transaction closure and strict reopen
independently reapply the classifier to retained Raw Request, Proposal, and
returned-answer strings.

Status views expose exact terminal refs and safe reason codes without answer
content. Audit views expose bounded event identity/digests and historical
Question-to-Answer-Binding provenance without raw request, assistant, exception,
or transcript text. The direct Answer-only command result remains the sole
bounded delivery surface for validated answer content.

## Boundary and documentation review

The root README, Architecture status and component boundaries, Goal Intake,
Domain Model, Workflow, Context Compiler, Evidence Model, ADR index, milestone
boundary, and implementation/acceptance plans were reviewed. The ADR index
remains correct: Slice 5 implements accepted ADRs 0027, 0034, and 0035 and
introduces no durable architectural decision requiring another ADR. No Goal,
Workflow, Attempt, Candidate, Evidence, Acceptance, Materialization, Start, CLI,
release, deployment, or external-effect authority is added.

## Verification

The complete repository quality gate passed from the reviewed working tree:

```sh
PATH=/Users/liushan/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin \
  /Users/liushan/.nvm/versions/node/v22.22.3/bin/corepack pnpm gate:quality
```

The passing run reported formatting, documentation (`75/75` executable checks
and `77` portable GFM sources), the exact M2 protocol snapshot, lint and package
boundaries (`28/28`), strict TypeScript, unit tests (`334/334`), including three
exact retention-grammar tests, digest tests (`46/46`), migration tests
(`99/99`), SQLite authority tests (`435/435`), including digest-valid Raw
Request, Proposal, and Answer retention poisoning plus Answer reservation,
terminal-reference, cross-Intake Decision/Response/Failure ownership,
duplicated-column, transaction-rollback, and strict-reopen adversarial cases, CLI
integration tests (`62/62`), M1 adversarial demos (`8/8`), invariant checker
tests (`4/4`) with `32/32` invariant coverage, and the final build all passing.
The first iterative full gate exposed two lint findings in the new closure and
they were corrected. The subsequent restricted-sandbox run could not inspect
Darwin process start identity; the identical full gate was therefore rerun with
normal host process inspection and completed with exit code zero.

Every Node test stage in the final passing run reported zero failed, cancelled,
skipped, and todo tests. The gate ran without a live Intake assistant call and
did not execute the independent M2.5 milestone verdict.

## Remaining boundary

Slice 5 is implemented, but Goal Intake is not operational. Slice 6 owns atomic
Goal Materialization, optional Start Authorization, and separate ordinary
`StartGoal` composition. Slice 7 owns trusted CLI composition and the M2.5
acceptance harness. No implementation slice may issue the independent M2.5
verdict.
