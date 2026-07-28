# ADR 0018: Close deterministic Acceptance and closeout authority

- Status: Accepted
- Date: 2026-07-28

## Context

Slice 5 records a current frozen Candidate, immutable Evidence, monotonic
eligibility, and a canonical historical Evidence Set. The initial SQLite schema
also reserved tables named `acceptance_input_manifests` and
`acceptance_decisions`. Those table names do not establish Slice 6 authority:

- no domain codec owns either retained record;
- no Runtime service compiles one current manifest or issues a decision;
- no Store transaction records evaluation or consumes a decision for closeout;
- no durable closeout record binds the closed Workflow to the exact decision,
  Candidate, Evidence Set, and Policy;
- the reserved `decision_digest` uniqueness constraint contradicts ADR 0006,
  which permits distinct replay records with the same semantic decision digest;
  and
- the `FINAL_VERIFY -> IMPLEMENT` repair edge still has no transaction that
  rejects the frozen generation and creates a new mutable child generation.

Opening only the existing tables would allow a shape-valid row or generic phase
guard to appear authoritative. Slice 6 needs one closed construction and
consumption path, including current-state revalidation and restart proof.

M1 also has no durable Fact Graph, Human Decision Gateway, or independent
Scenario repository. Nevertheless, the canonical Acceptance Input Manifest
contains Fact, Decision, Scenario, and Pending Issue set digests. Placeholder
strings or caller-authored digests would invent authority that M1 does not own.

## Decision

### Separate manifest compilation, decision issuance, and state mutation

M1 uses three distinct authorities:

1. The Workflow Runtime compiles one `AcceptanceInputManifest` from decoded
   current authority and coordinates application commands.
2. The deterministic Acceptance Engine is the only component that constructs
   an `AcceptanceDecision` and its rule results. It receives immutable input,
   cannot edit source, and has no Workflow mutation method.
3. The Store revalidates the exact manifest, decision, current records, and
   transaction preconditions. It may reject a forged or stale decision but may
   not construct a replacement result or upgrade an outcome to `ACCEPT`.

Store validation is a persistence backstop, not a second acceptance issuer. A
direct caller cannot persist arbitrary all-pass rule text because the Store
requires the exact closed M1 rule set, canonical aggregation, checker identity,
and current source records.

The generic `PhaseGuardEvaluator` remains prohibited from returning
`CURRENT_ACCEPTANCE` or `REJECT_REPAIRABLE_RECORDED`. The Runtime constructs
those guards only after reloading an immutable Acceptance Decision and its exact
bindings.

### Compile one closed M1 authority view

Before evaluation, the Runtime resolves one M1 Acceptance authority view
containing:

- the exact Goal revision and its Workflow in `FINAL_VERIFY`;
- the active `FROZEN` Candidate generation and frozen digest;
- its canonical retained Evidence Set and the exact Evidence, eligibility,
  obligation, and Check Specification records selected by that set;
- the installed Policy Bundle and Acceptance checker identity;
- the closed M1 Fact, Decision, Scenario, and Pending Issue set projections;
  and
- the latest persisted state needed to prove current eligibility.

The Runtime reobserves the frozen logical Candidate before compiling the
manifest. A mismatch uses the Slice 5 Candidate-integrity transaction to
invalidate the generation and dependent Evidence; it does not create an
Acceptance Decision over a source identity already known to be false.

The Store reconstructs the same authority inside the evaluation transaction
and requires exact manifest equality. It rechecks latest Evidence eligibility,
not only the historical eligibility versions captured by the Evidence Set.
Historical replay and current Acceptance currency remain separate under ADR
0017. The manifest time MUST NOT precede its Workflow, Candidate, obligation,
Evidence, eligibility, Pending Issue, or installed Policy authority; this is
revalidated independently by the compiler, Store, SQLite, and restart path.

### Give M1 snapshot fields real, limited meanings

M1 does not invent Fact or Human Decision authority.

- `factSnapshotDigest` is the canonical digest of a versioned empty M1 Fact
  snapshot. Evaluation fails closed if retained Fact rows exist for the Goal,
  because M1 has no owning resolver that can select or interpret them.
- `decisionSetDigest` is the canonical digest of a versioned empty M1 Human
  Decision set. Evaluation fails closed if retained Human Decision rows exist
  for the Goal.
- `scenarioSetDigest` is derived from the exact ordered scenario references in
  the current generation's required Verification Obligations. M1 scenario
  references remain criterion-derived; no independent Scenario authority is
  claimed.
- `pendingIssueSetDigest` covers a strict, ordered M1 Pending Issue set for the
  Goal. M1 exposes no public issue-mutation command in Slice 6, but retained
  rows must decode through the closed schema and an open blocking issue must
  prevent `ACCEPT`.

The M1 Pending Issue schema uses explicit values:

- classification: `TECHNICAL_FINDING`, `SCOPE_CONFLICT`,
  `EXTERNAL_DEPENDENCY`, or `DECISION_REQUIRED`;
- severity: `BLOCKING` or `NON_BLOCKING`;
- status: `OPEN` or `RESOLVED`;
- repairability: `REPAIRABLE`, `BLOCKED`, or `NEEDS_DECISION`;

An open blocking issue maps according to its repairability. Non-blocking or
resolved issues remain in the manifest identity but do not block Acceptance.
Because Slice 6 has no Human Decision Gateway, a retained
`NEEDS_DECISION` issue may produce that Acceptance outcome but cannot be
resolved through a generic approval command.

### Use one exact ordered M1 rule set

The active M1 Policy Bundle must contain the exact ordered Acceptance rules and
the exact built-in Acceptance checker identity. The rules cover:

1. Workflow phase and version binding;
2. Goal revision binding;
3. current frozen Candidate identity;
4. Candidate digest currency;
5. non-empty required obligations and exact criterion mapping;
6. current eligible passing Evidence for every required obligation;
7. blocking Pending Issues; and
8. manifest, Policy, and checker identity.

The Worker completion rule is structural rather than a synthetic passing rule:
Worker output is absent from the manifest and cannot satisfy any rule. The
existing Worker boundary and adversarial tests prove that negative authority.

M1 maps trustworthy fake Evidence observations as follows:

- every required obligation must map at least one current eligible observation;
- one or more observations may map to an obligation, and only an all-`PASS`
  collection passes the Evidence rule;
- a required `FAIL` observation is `FAIL_REPAIRABLE`;
- a required `RUNNER_ERROR` or `TIMEOUT` observation is `ENGINE_ERROR`;
- missing, stale, ineligible, mismatched, or malformed required authority fails
  closed and cannot produce `ACCEPT`.

Rule evaluation catches checker defects and returns a closed `ENGINE_ERROR`
Rule Result. The Runtime never manufactures an `ENGINE_ERROR` decision after an
uncontained Acceptance Engine exception; an untrusted or malformed engine
return is an evaluation infrastructure failure and records no decision.

Rule Results are emitted exactly once in Policy order. The strictest outcome
aggregation in `acceptance-engine.md` is canonical and Store-revalidated.

### Record evaluation without changing Workflow state

`EvaluateAcceptance` is an admitted Goal-scoped application command carrying a
`CommandId`, expected Goal revision, and expected Workflow version. The
evaluation transaction:

- revalidates the current authority view and exact manifest;
- inserts or reuses the content-addressed immutable manifest;
- inserts one new immutable Acceptance Decision;
- appends manifest and decision audit records as applicable; and
- records the Store-authored processed-command outcome.

It does not change Workflow phase, run status, Candidate state, or Goal status.
Multiple command identities may evaluate the same semantic input. They may
produce distinct decision IDs and timestamps with the same `decisionDigest`.
The Store rejects contradictory semantic decisions for the same manifest,
Policy, checker, and engine version.

M1 retains the existing public `CommandOutput` schema for command admission and
replay. Acceptance details are read from the immutable decision record and are
rendered by the Slice 7 status/CLI view; a report or enriched view does not
become another completion authority.

### Consume decisions through dedicated Runtime commands

Generic phase requests cannot close or repair a Goal.

`CloseAcceptedGoal` is a Goal-scoped application command that names the exact
Acceptance Decision ID and digest, manifest digest, Candidate digest, expected
Goal revision, and expected Workflow version. Before commit, the Runtime
reobserves the frozen Candidate. The compound Store transaction then reloads
and revalidates all bindings and atomically:

- applies the Runtime-authored `CURRENT_ACCEPTANCE` Workflow guard;
- changes the Candidate from `FROZEN` to `ACCEPTED`;
- changes the Workflow from `FINAL_VERIFY`/`READY` to
  `CLOSEOUT`/`CLOSED`;
- synchronizes the Goal status projection to `CLOSED`;
- inserts one immutable closeout binding containing the exact decision,
  manifest, Candidate, Evidence Set, and Policy identities;
- appends Candidate, Workflow, and closeout audit events; and
- records the Store-authored command outcome.

Any mismatch rolls back the whole transaction. A technical closeout does not
authorize commit, push, merge, release, deployment, or another real-world
effect. The closeout time MUST be at or after decision issuance and MUST equal
the atomic Workflow, Goal, and Candidate terminal-transition time.

`BeginAcceptanceRepair` consumes a current `REJECT_REPAIRABLE` decision. The
Runtime first reobserves the rejected frozen generation, then allocates the
child generation and asks the deterministic Candidate Source to prepare it
from that generation's frozen digest. Drift uses the existing atomic integrity
failure path and creates no child. Otherwise, the compound transaction
atomically:

- changes the old generation from `FROZEN` to `REJECTED`;
- creates a new `MUTABLE` child generation whose `baseDigest` equals the old
  frozen digest;
- creates a fresh generation-scoped Check Specification and required
  Verification Obligation set;
- transitions the Workflow from `FINAL_VERIFY` to `IMPLEMENT` and selects the
  new generation;
- appends the complete audit set; and
- records the command outcome.

The repair child creation time and old-generation rejection time are the same
atomic event and MUST be at or after the consumed decision was issued.

The old generation is never thawed. A blocked, decision-needed, or engine-error
decision cannot be consumed as repairable or accepted.

### Replace reserved Acceptance persistence rather than bless it

The Slice 6 migration treats the initial Acceptance and Pending Issue tables as
unimplemented placeholders. It MUST fail without partial application if they
contain retained rows, because no earlier Runtime path could have authored
those rows under the completed contract. For the same reason, it MUST reject a
pre-Slice-6 database that already claims a `REJECTED` or `ACCEPTED` Candidate,
a `CLOSEOUT`/`CLOSED` Workflow, or a `CLOSED` Goal. After that preflight, the
migration rebuilds the placeholder tables with exact schema-version,
identifier, digest, JSON, timestamp, relationship, and immutability constraints
and adds the immutable closeout binding.

In particular, `decision_digest` is not unique. Decision ID is record identity;
the semantic digest may repeat across replay records. The migration and Store
must preserve this distinction.

Acceptance manifests reference an existing Evidence Set and exact Policy.
SQLite relationship guards, Store write validation, and startup validation
independently reject cross-Goal, cross-Workflow, cross-generation,
cross-Policy, stale, malformed, or unaudited records. Every successful write is
immediately reread through the same codecs used on restart. Startup also
requires every `ACCEPTED` generation to have its exact immutable closeout and
every `REJECTED` generation to have exactly one base-bound next-sequence repair
child; a terminal label alone is not retained authority.

## Consequences

- A persisted string or generic all-pass guard cannot become `ACCEPT`.
- Acceptance replay can create a new immutable record while preserving one
  semantic decision digest.
- Current closeout cannot consume a historically valid but now-stale Evidence
  Set.
- A closed Goal permanently identifies the exact technical decision and inputs
  that authorized it.
- Repair preserves the failed frozen generation and creates new source and
  Evidence authority rather than rewriting history.
- M1 remains deterministic and uses FakeWorker, a logical Candidate Source,
  and fake verification. It does not add Codex, an LLM judge, a real checkout,
  or real verification execution.
- Slice 7 may expose views and recovery commands over these records but cannot
  create another Acceptance or Workflow authority.

## Rejected alternatives

- **Write directly to the reserved Acceptance tables.** Rejected because table
  existence does not prove domain, Runtime, audit, replay, or restart authority.
- **Let the Store recompute and issue a replacement decision.** Rejected because
  that would create a second technical acceptance issuer.
- **Let a generic phase guard claim current Acceptance.** Rejected because a
  label cannot prove an immutable decision or current bindings.
- **Use caller-provided placeholder digests for M1-empty sets.** Rejected
  because the caller would author missing Fact, Decision, Scenario, or Issue
  authority.
- **Keep `decision_digest` unique.** Rejected because it makes ADR 0006 semantic
  replay impossible.
- **Close the Workflow and accept the Candidate in separate commands.**
  Rejected because a committed interval could expose contradictory completion
  truths.
- **Thaw a rejected Candidate.** Rejected because old Evidence would retain a
  mutable referent.
- **Treat a human confirmation as an Acceptance override.** Rejected because a
  typed human decision cannot replace missing technical evidence.

## Validation

M1 tests MUST prove:

- exact manifest and decision digest vectors, stable canonical ordering, and
  replay with distinct IDs/timestamps but one semantic decision digest;
- only the Acceptance Engine can construct an admitted decision and malformed
  or incomplete rule sets fail closed;
- Worker completion, fabricated `accept`, generic guards, generic approval, and
  direct Store callers cannot create technical acceptance;
- stale Goal, Workflow, Candidate, Evidence eligibility, Evidence Set, Policy,
  checker, Pending Issue, manifest, decision, or source identity prevents
  closeout;
- an observed fake verification `FAIL` creates a repairable decision and only
  that current decision can create a new child generation;
- `RUNNER_ERROR` and `TIMEOUT` never become repairable success;
- closeout atomically writes Candidate acceptance, Workflow/Goal closure,
  closeout binding, audits, and command outcome;
- repair atomically writes old-generation rejection, new-generation authority,
  Workflow selection, fresh obligations, audits, and command outcome;
- evaluation writes no Workflow or Goal lifecycle mutation;
- duplicate application commands replay without duplicate decision, closeout,
  or repair effects;
- injected failure after every new authority write rolls back the complete
  transaction;
- migration refuses pre-authority placeholder rows or terminal lifecycle claims
  without partial schema application; and
- valid Acceptance, closeout, and repair history reopens through the same
  strict decoders while orphaned terminal states and other poisoned retained
  rows fail closed.
