# M2 Slice 6 Thread, Compact, Interruption, and Restart Review

- Review date: 2026-08-01
- Scope: M2 Slice 6 only
- Status: Complete
- Verdict: `PASS`; the bounded external-execution, repair-Context, interruption,
  and restart path satisfies the Slice 6 exit contract and Slice 7 may begin

## Review question

This review asks whether CodeClosure can authorize and retain one external
Worker execution without making a Codex Thread, Turn, process, or model result
authoritative; apply the installed Thread and Compact policy without hidden
retry; interrupt governed cancellation; reconcile an active dispatch after
restart; and compile a fresh repair Context from exact retained failure
authority rather than old conversation state.

It also asks whether a failed bounded repair remains stopped after strict
reopen and whether ordinary Resume, duplicate commands, stale Acceptance
authority, or late Worker events can create generation 3 or another external
dispatch.

It does not assess ADR 0031 through ADR 0033 protected verification, trusted
production CLI composition, a live Goal-bound Codex edit, the Slice 8
acceptance harness, M2 milestone exit, Goal Intake, or authority to merge,
release, deploy, or perform another external effect.

## Authority and source identity

The review applies the repository authority order, Runtime Invariants I-001
through I-010 and I-027 through I-029, ADR 0014 through ADR 0022, ADR 0028
through ADR 0030, the
[Slice 6 contract](../plans/m2-codex-vertical-slice.md#slice-6--thread-compact-interruption-and-restart),
and rows `M2-F10`, `M2-F11`, and `M2-G01` through `M2-G17` applicable to this
slice in the
[M2 acceptance plan](../plans/m2-acceptance-plan.md#7-mandatory-acceptance-matrix).

The final reviewed working-tree source identity excludes only this review file
to avoid self-reference:

```text
Base Git revision: 7216160f49833bc3bd7bb824a685bd7593015b73
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 922
Source manifest digest: sha256:e3a54680959ed8baaca0c764cdd3fdd8ae04f7551834118a6aabc8afaf78986e
Self-referential review exclusion: docs/reviews/m2-slice6-thread-compact-restart.md
```

## Runtime-owned external execution

Execution Profile schema version 2 is an additive union; M1 version-1 profiles
retain their existing digest meaning. The extension binds one immutable
capability record and the selected backend, binary/protocol/configuration,
managed requirements, instruction sources, controlled state root, model,
permission, disabled integrations, continuity, Compact, fallback,
interruption, and retention policies. Installation succeeds only when every
selected capability is `SUPPORTED` for the exact capability identity.

For an external Worker phase, Runtime first prepares only the bounded
Candidate lease capability. One SQLite transaction then commits the existing
Worker dispatch claim and a protocol-neutral `ExternalExecutionRecord` in
`AUTHORIZED` state before adapter creation. Manual Compact requires a separate
Runtime-authored maintenance authorization before invocation. Process,
session, operation, maintenance, and terminal observations are closed-schema
untrusted inputs admitted when each boundary occurs through versioned Store
transactions with immutable audit records. Runtime signs the intent with a
unique launch nonce; the process observation binds it to the exact PID,
process-group, start, executable, and controlled-state-root identity. A final
adapter summary only cross-checks the retained lifecycle and cannot
retroactively create process/session/operation authority. Unknown failure
detail, mismatched result-event identity,
incorrect terminal/result combinations, late observations, profile drift, and
partial transaction writes fail closed.

The Codex adapter supports a Runtime-issued exact resume directive, although
the selected bounded M2 driver policy uses a fresh Thread for every new Worker
Session, repair generation, and post-restart Attempt. A manual Compact runs on
the selected Thread before the one Worker Turn. Its maintenance Turn and
`contextCompaction` Item are bound by exact item, Thread, and maintenance-Turn
identity. Exactly one maintenance Turn is accepted; another Turn while Compact
is pending fails closed instead of being silently classified as maintenance.
The maintenance Turn cannot become the Worker Turn or hide another Worker item.
The adapter retains only bounded identities, counts, and typed disposition; it
does not persist private reasoning, opaque compacted model state, full chat, or
raw tool history.

## Cancellation, failure, and restart

Governed cancellation first commits Workflow/Attempt cancellation authority,
then aborts the exact active operation. A late terminal Worker result is not
admitted. Process, client, protocol, backend, configuration, approval, Compact,
and host-cancellation outcomes use a closed normalized failure set. One
observed failure creates no process retry, replacement Thread, redispatch, or
model fallback.

Startup recovery includes retained external execution and maintenance
authority in its causal time floor. An active external dispatch and authorized
maintenance operation are reconciled against their retained process identity
before the existing Attempt and Workflow recovery commit. The lower client may
terminate only the exact matching owned process group, with bounded TERM/KILL
escalation; PID reuse, start-identity mismatch, unavailable inspection, or
termination failure remains a visible blocker and creates no redispatch.
After safe absence or termination, the old external execution is atomically
abandoned with the existing Attempt and Workflow reconciliation. Ordinary
`ResumeGoal` can proceed only after that
commit and creates a fresh Attempt, Worker Session, external intent, and Thread;
the old claim, observation history, and Candidate generation are not replayed
or mutated. A deliberately rolled-back wall clock still produces causal
reconciliation time, and strict SQLite reopen reconstructs the same authority.

## Fresh repair Context and bounded stop

Repair dispatch uses Context Package and Manifest version 3. Runtime and Store
independently reconstruct the same closed projection from the exact current
`AcceptanceRepairRecord`, `REJECT_REPAIRABLE` decision, Acceptance Input
Manifest, Evidence Set, eligible failing Evidence and eligibility versions,
rejected parent, repair child, eligible parent Candidate-freeze change-set
digest, and Goal allowed-path/non-goal constraints. The derived
`priorAttemptFeedback` is bounded, source-labelled, digest-bound, and explicitly
non-authoritative.

The compiler accepts no transcript, hidden reasoning, KV cache, raw tool
history, free-form Worker summary, decoded changed-file list, attempted
approach, eliminated direction, or unrelated project observation. Paired
recompilation proves the same failure projection is available without the old
Thread, while retaining that Thread does not inject it. Missing, stale,
wrong-Goal, wrong-Candidate, wrong-decision, incomplete Evidence, ineligible
Evidence, mismatched freeze, or false feedback digest blocks before repair
dispatch.

In the failed-repair branch, generation 2 receives a fresh Session, Thread,
Context, Check, and Evidence. Generation 1 Evidence remains immutable and
cannot satisfy generation 2. A second `REJECT_REPAIRABLE` persists the visible
stop. Strict reopen, same-command replay, ordinary Resume, a new command using
the old decision, and a late generation-1 Worker event all leave the Candidate
sequence at 2 and create no process, dispatch, or generation 3. This proves the
bounded M2 automatic-continuation limit; it does not impose a product-wide cap
on future explicitly authorized repairs.

## Focused executable evidence

The focused suites pass with zero failed, cancelled, skipped, or todo cases:

- strict workspace TypeScript typecheck passes;
- the lower App Server client suite passes `42/42`, including owned process-group
  capture, exact-identity reconciliation, mismatch refusal, and bounded
  termination;
- the Codex Worker Adapter suite passes `42/42`, including exact resume,
  authorized manual Compact maintenance, cancellation, process failure, and
  lifecycle drift plus additional-maintenance-Turn rejection;
- the Workflow Driver suite passes `72/72`, including transaction fault
  injection, external lifecycle reopen, exact repair Context, failed-repair
  stop, cancellation, failure normalization, real-time lifecycle persistence,
  exact and ambiguous restart reconciliation, stale authority, and late-event
  cases;
- migration and Store control coverage passes `99/99`, with 23 ordered
  migrations, 36 strict tables, 20 indexes, 149 triggers, zero foreign-key
  violations, and exact schema fingerprint;
- the deterministic M2 real-Candidate/verifier orchestration suite passes
  `6/6`; and
- all focused builds and tests report zero skipped or unavailable cases.

The Darwin Seatbelt orchestration case ran outside the host tool sandbox
because that sandbox cannot nested-launch the selected isolation profile. The
tested process remained inside CodeClosure's own Seatbelt policy and disposable
fixture roots.

## Closing executable evidence

The final quality-gate result and aggregate stage counts are recorded after
documentation closure:

```text
format: PASS
docs: 75/75 tests; 65 portable GFM sources
M2 protocol snapshot: PASS; Codex 0.146.0; pinned snapshot unchanged
lint and boundaries: 26/26 tests; 9 packages; 806 sources
typecheck: PASS
unit: 7/7 + 42/42 + 42/42 + 18/18 + 11/11 + 140/140
authority digests: 36/36
migrations: 99/99
Store/Runtime authority: 294/294
CLI integration: 58/58
M1 adversarial demos: 8/8
invariant checker: 4/4; coverage 31/31; 42 sources; 432 executable tests
forced build: PASS
```

## Documentation and architectural review

The root README, Architecture status and Runtime boundary, Workflow, Domain,
Context Compiler, M2 milestone, implementation plan, acceptance-plan status,
review index, ADR index, and Runtime Invariants were reviewed together. No
accepted architectural decision changed: Slice 6 implements ADR 0028 using the
existing M1 Workflow, Candidate, Evidence, Acceptance, and recovery owners. No
new ADR or Runtime Invariant is needed.

The documentation does not claim Slice 7 protected verification or trusted/live
composition, Slice 8 milestone audit, M2 completion, M2.5 Goal Intake, or a
model-quality uplift. M0 and M1 historical records remain unchanged.

## Verdict, limitations, and next action

Every bounded Slice 6 exit condition has focused executable evidence. Slice 6
is implemented and Slice 7 may begin.

The selected production-facing CLI does not yet compose the external Worker
path, and no live model edit is claimed. ADR 0031 through ADR 0033 protected
Verification Plan and asset authority remain Slice 7 work. Slice 8 must still
run the canonical M2 acceptance procedure and independent verdict before M2 can
be marked complete or M2.5 may begin.
