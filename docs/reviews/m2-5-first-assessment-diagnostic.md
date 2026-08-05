# M2.5 first executable-assessment diagnostic

- Date: 2026-08-05
- Scope: first canonical executable-assessment attempt only
- Result: `FAIL / NOT_READY_FOR_INDEPENDENT_REVIEW`
- Authority: diagnostic record; not the independent M2.5 completion review

## Outcome

The first `corepack pnpm accept:m2.5` execution did not establish readiness for
independent review. It issued no M2.5 milestone verdict and authorized no
status mutation, technical Acceptance, merge, release, deployment, or other
external effect.

Opening and closing M2.5 source identity matched:

- base Git revision:
  `555e950e2801a997802f1094b1da8c82d844c701`;
- branch: `m2.5-goal-intake`;
- working tree: `clean`;
- manifest schema: `codeclosure-source-manifest-v1`;
- manifest paths: `986`;
- manifest digest:
  `sha256:8239ed4e7311b742cd47c53444a5ac36500c653a0f88304829edb92ca8202b78`;
- review exclusion: `docs/reviews/m2.5-completion-review.md`.

Preflight, quality, M1 regression, M2.5 static authority, deterministic
Adapter, SQLite/reopen, CLI/cross-process, and source closure passed. The sole
failed stage was `m2-regression`.

## Cause

The M2.5 runner invoked the historical `accept:m2` milestone procedure against
current M2.5 source. That procedure correctly retained historical row
`M2-H06`, whose exact-M2 claim is that no Goal Intake implementation exists.
Current M2.5 source intentionally contains the separate Intake Store and
Assistant port, so the historical scope review failed with:

```text
M2.5 operational Intake work exceeds the recorded Slice 1 boundary:
IntakeControlStore, IntakeAssistantPort
```

This was an acceptance-orchestration conflict, not evidence that Intake had
entered the Goal-bound Worker, Candidate, Evidence, or Acceptance authority
path. Deleting the token check, weakening `M2-H06`, or treating the failure as
a waiver would have changed the meaning of historical M2 evidence and was not
permitted.

## Corrective contract

The remediation preserves `accept:m2` as the 93-row historical milestone
procedure and adds a separate non-verdict current-source `regress:m2` profile.
That profile excludes only historical-only row `M2-H06`; it retains the other
92 rows, complete quality and M1 regression, deterministic protected repair,
failed-repair stop, adapter failure, all three mandatory live stages, zero-skip
rules, and exact opening/closing source identity. Its current scope proof
requires implemented Intake to remain separate from Goal-bound WorkerPort,
Candidate, Evidence, Acceptance, and external-effect authority.

The enclosing M2.5 runner must validate the child result as untrusted
structured evidence, require the same M2.5 source identity and review
exclusion, and reject a missing live proof, malformed result, exit-code
mismatch, or source mismatch. This correction changes no Runtime authority
owner and requires no ADR.

## Evidence identity

The temporary first-run evidence directory is not a durable repository
artifact. This record therefore binds its relevant immutable digests:

- evidence manifest SHA-256:
  `64d425c3a2aad4218a03c8062379b47c283d7478f8aee891f43e4c9539fa34dd`;
- M2 regression artifact SHA-256:
  `8365a9d9484d85f348d0e2fa22ed455159b89c885fe3712098946278efd8dfb8`.

The corrected canonical assessment has not yet run. A later passing executable
assessment remains only input to the independent
`docs/reviews/m2.5-completion-review.md`; this diagnostic cannot issue or
substitute that verdict.
