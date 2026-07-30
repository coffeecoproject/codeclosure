# ADR 0027: Source-bound Intent Admission and automatic Goal materialization

- Status: Accepted
- Date: 2026-07-30
- Supersedes: [ADR 0026](0026-pre-goal-intake-and-goal-materialization-authority.md)

## Context

[ADR 0026](0026-pre-goal-intake-and-goal-materialization-authority.md)
placed Goal Intake before formal Goal and Workflow creation and required an
identified user to confirm one exact Goal Draft revision and digest before
materialization. That decision correctly prevented an assistant proposal from
becoming authoritative intent, but it made a second confirmation action
mandatory even when the user had already submitted an explicit command through
a governed execution surface.

CodeClosure needs to distinguish three questions instead of treating them as
one confirmation step:

1. what the user actually stated and requested the product to do;
2. whether a structured interpretation is sufficiently supported to create a
   formal Goal; and
3. whether the resulting ready Workflow may begin execution.

The first question belongs to immutable user input. An assistant may help
analyze that input, but its output remains untrusted. The second question must
be answered by deterministic CodeClosure policy over exact source-bound input.
The third question remains governed by the existing `StartGoal` boundary. In
particular, [ADR 0020](0020-runtime-application-recovery-and-query-boundary.md),
[ADR 0021](0021-m1-execution-profile-and-cli-composition.md), and
[ADR 0022](0022-immutable-workflow-policy-binding.md) separate Goal/Workflow
creation from first Start, Execution Profile binding, Policy binding, Attempt
creation, and Worker dispatch.

Replacing exact Draft Confirmation therefore requires a new admission
authority. It does not permit a model to decide intent, merge Goal creation
with external execution, weaken the direct `CreateGoal` contract, or turn a
question into an execution command.

## Decision

### Position and terminology

Goal Intake remains a pre-Goal product flow. It is not a Workflow phase,
Attempt, `DISCOVERY`, technical Acceptance, Candidate operation, or
post-closeout Promotion.

The planned Intake boundary uses these terms:

- `RawRequest` identifies the Intake request and its immutable user-authored
  revisions;
- `IntentAnalysisProposal` is one untrusted assistant interpretation;
- `IntentProjectionRevision` is one immutable, CodeClosure-owned structured
  interpretation with exact source bindings;
- `MaterialAmbiguity` identifies unresolved meaning that could materially
  change formal intent or execution authorization;
- `IntentAdmissionDecision` is the deterministic CodeClosure decision to
  `MATERIALIZE`, `CLARIFY`, or produce `NO_EXECUTION`;
- `AnswerOnlyResponse` is a bounded non-authoritative assistant answer or typed
  delivery failure associated with `NO_EXECUTION / ANSWER_ONLY`;
- `IntakeFailureRecord` is a typed terminal processing failure for one Intake
  Run and is distinct from intentional non-execution;
- `GoalMaterializationRecord` binds an admitted projection to the resulting
  formal Goal and initial Workflow; and
- `GoalStartAuthorization`, when present, binds an explicit execution request
  to exactly one ordinary `StartGoal` command after Materialization commits.

`Goal Draft`, `Goal Confirmation`, `Confirmation Gateway`,
`READY_FOR_CONFIRMATION`, and `CONFIRMED` are superseded terms for the active
target design. Historical records may retain them. Converting admitted intent
into a formal Goal remains **Goal Materialization**; `Promotion` retains its
post-closeout real-world meaning.

### Raw Request and user action authority

Each admitted user submission creates an immutable `RawRequestRevision` bound
to its `RawRequest`, `IntakeRun`, identified principal, exact admitted-content
digest, declared project or scope when supplied, and interaction action. A
separate named canonical Raw Request revision digest binds those semantic
fields and the revision chain for downstream Proposal, Projection, Admission,
Materialization, and Start records; a text-only digest cannot substitute that
whole-revision identity.

The authoritative content is the exact complete user-authored UTF-8 content
admitted under the retention policy. It MUST NOT contain a Runtime-authored
redaction token or normalized paraphrase. If prohibited content cannot be
retained as exact safe source text, the trusted surface rejects that revision
and requests a safely restated submission. Redacted display and audit
projections are separate derived views and cannot provide `USER_STATED`
authority.

The interaction action is captured by the trusted CLI/App boundary and is not
inferred or authored by the assistant. At minimum it distinguishes:

- `GOVERNED_EXECUTION` — the user asks CodeClosure to perform governed work;
- `ANSWER_ONLY` — the user asks for an answer without governed project work;
  and
- `MATERIALIZE_ONLY` — the user asks to create a ready Goal without starting
  it.

An explicit command submitted through `GOVERNED_EXECUTION` MAY authorize both
Goal Materialization and a later `StartGoal` request when all admission and
start-policy requirements pass. A plain conversation continuation, assistant
classification, inactivity, ambiguous question, or generic approval detached
from the exact request cannot create that authorization.

This authorization covers only CodeClosure-governed technical execution. It
does not authorize merge, release, deployment, purchase, production mutation,
external communication, or another effect protected by a separate gateway.

`ANSWER_ONLY` authorizes only a bounded assistant response under a distinct
response contract. The answer cannot inspect the project through ungoverned
tools, mutate authority, or become a formal Fact, Criterion, Evidence record,
Goal, or execution instruction.

### Proposal, Projection, and source ownership

Codex or another Intake Assistant may return an
`IntentAnalysisProposal`, clarification proposal, classification, or bounded
observation. Through a separate Answer-only operation it may also return bounded
answer content. Every such value is untrusted input.

The Goal Intake Coordinator validates the closed response schema, byte and
collection budgets, adapter identity, current Intake bindings, and provenance.
It, not the model:

- allocates proposal, projection, question, and revision identities;
- normalizes the allowed `IntentProjectionRevision` fields;
- constructs source bindings and provenance classes;
- identifies unresolved material ambiguities;
- validates and classifies bounded Answer-only results and Intake failures;
- computes versioned canonical digests; and
- persists immutable records and audited `IntakeRun` transitions.

These control records live in the CodeClosure-owned authority location outside
the project and worker-writable Candidate. Conversation history, assistant
Thread state, and compacted model context may support continuity but cannot be
their only copy.

The initial provenance classes are:

- `USER_STATED` — exact user-authored content;
- `POLICY_DERIVED` — deterministic output of one named, versioned policy over
  exact inputs;
- `PROJECT_OBSERVED` — bounded read-only project observation;
- `MODEL_PROPOSED` — assistant interpretation or inference; and
- `UNRESOLVED` — required meaning that has not been established.

A model cannot choose its own authority class. A `SourceBinding` proves the
exact source revision, digest, and field or content span used by a projection;
it does not prove that the interpretation is semantically correct.

Text spans use zero-based, end-exclusive UTF-8 byte offsets over the exact
retained admitted user-content bytes. Structured sources use a
schema-versioned field path. A derived field also binds the exact derivation
rule ID/version/digest and its ordered input bindings. A model-cited quotation
without those independently validated coordinates is not a Source Binding.

For Raw Request text, the Source Binding's source digest binds the whole Raw
Request revision digest, while the Runtime independently validates the admitted
content-byte digest before resolving the span. Neither digest substitutes for
the other.

A `USER_STATED` Source Binding may address only retained user-authored bytes.
It cannot address a redacted display, omission marker, synthetic replacement,
or unavailable content. If removing prohibited content would change a material
field or its coordinates, that field remains unresolved until a new safely
restated Raw Request revision supplies valid source text. A digest without the
source bytes does not preserve eligibility for a new Admission or
Materialization decision.

Material Goal fields MAY use `POLICY_DERIVED` normalization only when the named
rule preserves user meaning, such as structural normalization or a testable
restatement of an explicitly stated outcome. Policy MUST NOT silently choose
between materially different business outcomes, widen project scope, invent a
required external effect, or treat the objective as an unrelated implicit
Criterion. A material field supported only by `MODEL_PROPOSED` or
`UNRESOLVED` input requires `CLARIFY`.

### Deterministic Intent Admission

The `IntentAdmissionEngine` is a CodeClosure control component. It receives an
immutable input view and has no assistant-call, Goal-write, Workflow-write,
Worker, Candidate, Acceptance, or external-effect capability.

The Engine evaluates one immutable installed `IntentAdmissionPolicy`. Trusted
composition supplies a definition without a caller-authored digest; the Runtime
computes its canonical identity and the Store independently validates immutable
installation and audit. Admission Policy is separate from the Workflow Policy
that first `StartGoal` later binds. Neither the current process default nor an
assistant-selected label may replace either identity.

Its input binds at least:

- Intake Run identity and expected version;
- principal and trusted interaction action;
- exact Raw Request revision and digest;
- exact Intent Analysis Proposal identity and digest when analysis was
  performed;
- exact Intent Projection revision and digest when a Projection exists;
- declared project/scope identity when present, with Materialization requiring
  one exact resolved identity;
- every material field's Source Bindings;
- the complete Material Ambiguity set;
- Intake assistant and response-contract identities when analysis was
  performed;
- Admission Policy ID, version, and canonical digest.

For the same canonical input and policy, the engine MUST produce the same
semantic decision, ordered reason trace, and decision digest. It cannot call a
model during evaluation.

`IntentAdmissionDecision.decisionDigest` covers the exact semantic input
bindings, policy identity, decision kind, outcome, reason code, ordered reason
trace, and execution disposition. It excludes record ID, Runtime-authored
`decidedAt`, and the digest field itself. A time-sensitive Admission rule must
receive an explicit, source-bound observed-time input; it cannot read ambient
wall time and still claim deterministic replay.

The closed outcomes are:

- `MATERIALIZE` — every required formal Goal field and requested execution
  disposition is sufficiently source-bound and policy-valid;
- `CLARIFY` — one or more material ambiguities require bounded user input; or
- `NO_EXECUTION` — no governed Goal should be created for this request.

The decision also carries one closed execution disposition:

- `NONE` for `CLARIFY` and `NO_EXECUTION`;
- `LEAVE_READY` for admitted `MATERIALIZE_ONLY`; or
- `AUTHORIZE_START` for admitted `GOVERNED_EXECUTION` after exact start-policy,
  Policy, and Execution Profile preflight.

No other outcome/disposition pairing is valid.

The persisted decision contract MUST be a closed discriminated union:

- `PRE_ANALYSIS_NO_EXECUTION` carries no Proposal or Projection binding and may
  omit project/scope;
- `PROJECTED_NO_EXECUTION` and `CLARIFY` carry one complete Proposal/Projection
  identity, revision, digest, Source Binding, and Material Ambiguity binding,
  while project/scope may remain absent when that absence is part of the
  non-execution or clarification result; and
- `MATERIALIZE` carries that complete binding plus a required project/scope.

Proposal and Projection identity/digest fields are an all-or-nothing embedded
value. A partial tuple, Projection fields on `PRE_ANALYSIS_NO_EXECUTION`, a
missing project/scope on `MATERIALIZE`, or another invalid
kind/outcome/action/disposition combination MUST fail schema and Store
validation. `CLARIFY` requires a current unresolved Material Ambiguity;
`MATERIALIZE` requires all material ambiguities to be resolved and pairs
`LEAVE_READY` only with `MATERIALIZE_ONLY` and `AUTHORIZE_START` only with
`GOVERNED_EXECUTION`.

`NO_EXECUTION` carries one closed reason such as `ANSWER_ONLY`,
`POLICY_DENIED`, `UNSUPPORTED`, or `ABANDONED`. It means that no Goal or
Workflow was created. It does not make an assistant answer authoritative truth.
A request that requires governed project inspection or tools may still need a
formal read-only Goal even when it makes no source edit.

`MATERIALIZE`, `CLARIFY`, and content-dependent `NO_EXECUTION` decisions require
the exact complete Proposal and Projection binding. A deterministic
pre-analysis `ANSWER_ONLY`, policy denial, unsupported request, or abandonment
MAY issue `PRE_ANALYSIS_NO_EXECUTION` without calling an assistant for Admission
or manufacturing empty Proposal/Projection records when trusted action and
policy inputs are already dispositive. A separate Answer-only call may still
produce the requested non-authoritative response and cannot alter that Decision.

`READY_TO_MATERIALIZE` MAY appear as a derived read-view next action. It is not
a durable lifecycle state or reusable authorization. A `MATERIALIZE` decision
and the authority it creates commit together so changed input cannot be
materialized from a stale intermediate state.

### Admission transactions

An admission operation first performs assistant calls and optional project
observation outside the control-store transaction. It then reloads one exact
authority snapshot and commits one of three closed results:

- `CLARIFY` atomically persists the decision, bounded Clarification Questions,
  `NEEDS_CLARIFICATION` Intake status, audits, and command outcome;
- `NO_EXECUTION` atomically persists the decision, terminal non-execution
  outcome, optional Answer-only response result, audits, and command outcome; or
- `MATERIALIZE` performs the atomic Goal Materialization transaction below.

A clarification answer is a new immutable user-input revision. It never
rewrites an earlier Raw Request revision, proposal, Projection, question, or
decision. A later analysis uses the new exact chain.

### Answer-only result

For `NO_EXECUTION / ANSWER_ONLY`, the application coordinator MAY invoke the
Intake Assistant outside the control-store transaction through a distinct
bounded response contract. The compound commit stores exactly one
`AnswerOnlyResponse` variant:

- `ANSWER_RETURNED` contains validated, bounded, retention-policy-compliant
  assistant-authored content; or
- `ANSWER_FAILED` contains only a safe closed failure reason such as assistant
  unavailability, timeout, protocol error, or rejected response.

The record binds the exact Raw Request, Admission Decision, assistant adapter,
and response contract. Runtime owns its identity, disposition, safe failure
classification, and digests. The answer is non-authoritative and cannot provide
Source Binding, Fact, Criterion, Human Decision, Evidence, Acceptance, Goal, or
execution authority. A request requiring project inspection or tools must use a
governed read-only Goal.

Public results expose `NOT_REQUESTED`, `ANSWER_RETURNED`, or `ANSWER_FAILED`
separately from Materialization and Start dispositions. Exact committed command
replay returns the stored Answer-only result without another assistant call. A
delivery failure still commits intentional `NO_EXECUTION`; it does not turn the
Intake Run into `FAILED`. Another answer attempt requires a new explicit
Answer-only Intake Run rather than an implicit recall.

Terminal Intake reference shapes form a closed union. `MATERIALIZED` binds one
`MATERIALIZE` Decision and Goal; `NO_EXECUTION / ANSWER_ONLY` binds one
`NO_EXECUTION` Decision and exactly one Answer-only result; other
`NO_EXECUTION` reasons bind no Answer-only result; and `FAILED` binds one
Failure Record with no terminal Decision, answer, or Goal. Non-terminal states
carry no terminal references. Schema, Store, and strict reopen reject partial or
mixed shapes.

### Terminal Intake failure and restart

`FAILED` is terminal for one Intake Run and means that Intent analysis, optional
project observation, or Admission preparation could not safely finish. It is
not denial, abandonment, Answer-only delivery failure, Goal status, or
technical completion.

When the failure can be persisted, the Coordinator atomically writes one
immutable `IntakeFailureRecord`, terminal status, audit, and command outcome.
The record binds the command, Intake Run/version, exact Raw Request, failed
operation, optional assistant/contract identity, safe reason code, and
`NEW_INTAKE_RUN_REQUIRED` retry disposition. Raw adapter or exception text is
excluded. A Store/audit failure that prevents this commit cannot be reported as
a successfully recorded `FAILED` result.

M2.5 performs no automatic Intake retry. Exact replay returns the stored failure
without another assistant call; the user creates a new Intake Run to try again.
After acquiring exclusive Runtime ownership, startup converts a valid orphaned
`ANALYZING` Run with no committed Proposal/Decision and no supported resumable
operation to `FAILED / INTERRUPTED_ANALYSIS` in one versioned audited
transaction before any assistant call. Missing, contradictory, or corrupt
authority still fails strict reopen rather than being rewritten as an ordinary
failure.

### Canonical identity and causal time

Every Intake authority-bearing digest uses one named, schema-versioned ADR 0006
projection. Proposal, Projection, Source Binding, Admission Decision,
Materialization Record, and Goal Start Authorization digests exclude their own
digest field. Runtime-generated record IDs and observation/envelope timestamps
are excluded from semantic equality unless the owning projection explicitly
declares a time-dependent rule input.

Answer-only Response and Intake Failure Record digests follow the same named,
schema-versioned projection discipline even though neither grants Goal,
Workflow, Evidence, Acceptance, or execution authority. Their semantic digests
exclude generated record IDs, Runtime-authored observation timestamps, and
their own digest fields.

The Goal Start Authorization digest binds principal, exact Raw Request,
Admission Decision, Materialization, Goal/Workflow, preallocated Start command,
Policy, and Execution Profile identities. It excludes authorization record ID,
Runtime-authored `authorizedAt`, and its own digest. Runtime timestamps still
obey causal floors and are preserved for audit; excluding envelope time does
not permit a record to predate its source authority.

### Goal Manager and atomic Materialization

The Goal Manager remains the sole authority over formal Goal identity,
objective, success criteria, scope, non-goals, and revision. The Workflow
Runtime remains the sole writer of authoritative Workflow state.

For `MATERIALIZE`, the Runtime computes the deterministic decision from one
decoded consistent snapshot. The Store transaction independently revalidates
the exact snapshot and decision before writing formal authority. The
application command:

1. reloads the exact current Intake Run, Raw Request revision, Proposal,
   Projection, Source Bindings, ambiguities, and Admission Policy;
2. recomputes and validates the exact `MATERIALIZE` decision;
3. asks the Goal Manager to validate formal Goal revision 1, including at
   least one required success criterion;
4. asks the Workflow Runtime to construct the unique initial
   `DISCOVERY / READY` Workflow;
5. when execution was explicitly requested, constructs one exact
   `GoalStartAuthorization` and preallocates its ordinary `StartGoal`
   `CommandId`; and
6. atomically persists the Admission Decision, Goal, Workflow,
   Goal Materialization Record, exactly one Goal Start Authorization for
   `AUTHORIZE_START` and none otherwise, audits, and the idempotent
   Materialization command outcome.

One admitted Intent Projection can materialize at most one formal Goal. Exact
command replay returns the original authority without duplicate records or
audit effects. Reusing a command, decision, Projection, Materialization, or
Start Authorization identity with different canonical input is a conflict and
fails closed.

A failure before commit may retain earlier Intake history and a typed failure
observation, but it leaves no partial Goal, Workflow, Materialization Record,
Start Authorization, success audit, or successful command outcome.

### Automatic Start remains a separate authority boundary

Goal Materialization creates a `DISCOVERY / READY` Workflow and MUST NOT create
an Attempt or dispatch a Worker in that transaction.

When the exact admitted request uses `GOVERNED_EXECUTION`, the application
coordinator MAY invoke the preallocated ordinary `StartGoal` command after the
Materialization transaction commits. That command retains every existing
freshness, Policy binding, Execution Profile binding, Context, Attempt,
dispatch-claim, cancellation, idempotency, and recovery rule.

Trusted Runtime composition and start policy, never model output or project
content, select the exact installed Policy and Execution Profile recorded in
the Goal Start Authorization. If those identities cannot be resolved and
validated before Materialization, a governed-execution request fails without
silently downgrading to ready-only behavior; the user may separately submit
`MATERIALIZE_ONLY`.

The automatic path MUST validate the exact `GoalStartAuthorization`. Replaying
the surrounding Intake operation may resubmit only its same preallocated
`StartGoal` Command ID. Existing command replay prevents a duplicate first-Start
binding and cannot redispatch a retained Attempt or dispatch claim. Any later
driver continuation still follows ADR 0020 from current persisted authority. A
crash or failure between Materialization and Start leaves a visible,
recoverable `READY` Goal; it never rolls back the formal Goal.

If the preallocated automatic Start races a different explicit manual
`StartGoal`, ordinary freshness and first-Start guards select at most one
winner. The loser records or returns its typed ordinary command outcome and
cannot create another Policy/Execution Profile binding, Context, Attempt, or
dispatch claim. The automatic path also fails closed if the authorization's
Start Command, Goal/Workflow version, Policy, Execution Profile, or digest
binding is substituted or no longer matches trusted Runtime composition.

The public result reports Materialization and Start as separate dispositions.
It MUST NOT describe a created-but-not-started Goal as absent, or a failed
Start as failed Materialization.

The composite read/result view distinguishes at least `NOT_AUTHORIZED`,
`READY_PENDING_START`, `START_COMMAND_APPLIED`, `START_COMMAND_REJECTED`, and
`START_INFRASTRUCTURE_FAILURE`. These labels explain the ordinary Start command;
none means technical closeout or permits the view to mutate authority.

Automatic replay may resubmit only the preallocated Start command. A later
explicit user `StartGoal` remains the accepted public surface and must pass
current freshness and first-Start guards; it is new user authority, not an
automatic retry inferred from the Intake record.

`MATERIALIZE_ONLY` creates the same formal `READY` authority without a Goal
Start Authorization. `ANSWER_ONLY`, `CLARIFY`, and `NO_EXECUTION` create
neither Goal nor Start authority.

### Existing CreateGoal compatibility

The implemented direct `CreateGoal` contract remains unchanged. It continues
to require an explicit formal objective, project, and at least one required
criterion, creates one Goal plus one `DISCOVERY / READY` Workflow atomically,
and does not dispatch work.

Direct `CreateGoal` and Intake Materialization converge on the same Goal Manager
validation and Goal/Workflow creation primitive. Direct creation MUST NOT
synthesize Raw Request, Proposal, Projection, Admission Decision,
Materialization, or Start Authorization records merely to imitate Intake.

### Correction and later Goal revision

Before Materialization, a correction creates a new Raw Request revision and a
new Projection/Admission chain. After Materialization, the original Intake Run
does not reopen and the formal Goal is never silently edited.

The basic M2.5 path uses existing Goal cancellation plus a new Intake Run when
the user corrects already materialized intent. If Start already committed,
cancellation remains non-success and follows normal interruption rules. M2.5
does not claim automatic in-place Goal revision.

M3 may reuse Intent analysis, Source Binding, Material Ambiguity, and Admission
Policy concepts for a distinct `GoalRevisionAdmissionDecision`. That future
decision must bind the existing Goal revision and define Plan, Context,
Candidate, Evidence, and Acceptance invalidation. It is not another
GoalMaterializationRecord and requires its own accepted authority contract.

### Codex client and adapter separation

The lower-level Codex App Server client remains separable from both
Goal-bound Worker and Intake semantics:

```text
Codex App Server Client
├── Codex Worker Adapter
│   └── Goal-bound execution through WorkerPort
└── Goal Intake Assistant Adapter
    ├── pre-Goal IntentAnalysisProposal through an Intake-specific port
    └── bounded AnswerOnlyResponse through a separate response contract
```

The Intake Adapter receives no control-store mutation, WorkerPort, Candidate,
Acceptance, Goal Manager, Workflow, Start, or external-effect capability. It
does not allocate authority IDs, revisions, timestamps, digests, Source
Bindings, ambiguity classifications, or Admission outcomes.

M2 implements only the Worker branch and MUST preserve this lower-client seam.
Goal Intake remains explicit M2 non-scope and M2.5 implementation MUST NOT
begin before the independent M2 exit review passes.

### Optional project exploration and Evidence

Optional Intake project exploration remains a dedicated, policy-authorized,
bounded, read-only port. It binds an exact project/path identity, closed
capabilities, hard budgets, provenance, omission decisions, and audit. It
receives no Candidate/source-write or control-store capability. Its
observations may support an Intent Projection or Clarification Question, but
they are not formal Goal Facts, Verification Obligations, Evidence, or
Acceptance input.

If a materialized Goal depends on such a claim, CodeClosure must revalidate it
under the formal Goal revision and the current project, Context, Candidate,
Check Specification, producer, and Evidence contracts.

## Consequences

- A user can issue one clear command without confirming a model-authored Draft.
- The user's exact instruction remains authoritative input while assistant
  interpretation remains an untrusted proposal.
- Source Binding and deterministic Admission replace generic confirmation as
  the guard for Goal creation.
- Goal creation and first execution remain separate, auditable, recoverable
  authority boundaries even when the UI presents one seamless operation.
- Questions, denials, unsupported requests, governed read-only work, and
  source-editing work receive explicit, distinguishable treatment.
- Answer-only requests return a bounded non-authoritative answer disposition;
  assistant delivery failure remains distinguishable from Intake processing
  failure.
- M2.5 Intake processing failure is terminal and recoverable without silent
  model recall; retry starts a new Intake Run.
- M2 keeps its accepted scope; M2.5 gains Intake persistence, Admission,
  Answer-only results, terminal failure handling, Materialization, optional
  automatic Start orchestration, and adversarial tests.
- The planned invariant that proposals cannot admit or materialize themselves
  remains deferred until M2.5 implementation and executable tests land
  together.

## Rejected alternatives

- **Keep exact Draft Confirmation for every request.** Rejected because an
  identified command through a governed execution surface can already express
  authorization, while material ambiguity is better handled explicitly.
- **Let Codex decide that information is sufficient.** Rejected because the
  assistant would become the author of Goal-creation authority.
- **Treat every natural-language message as an execution command.** Rejected
  because questions, generic conversation, and ambiguous requests do not prove
  governed execution authorization.
- **Use Source Binding as proof that interpretation is correct.** Rejected
  because provenance proves origin, not semantic equivalence.
- **Persist `READY_TO_MATERIALIZE` and consume it later.** Rejected because a
  stale intermediate authorization creates a check/use race.
- **Create and Start the Workflow in one transaction.** Rejected because first
  Start binds Policy, Execution Profile, Context, Attempt, and external dispatch
  authority and must remain independently recoverable.
- **Retry Start with a newly generated command after a crash.** Rejected because
  it could duplicate an already consumed execution authority.
- **Treat every read-only request as `NO_EXECUTION`.** Rejected because governed
  project inspection and tool use may still require Goal, capability, budget,
  recovery, and audit authority.
- **Treat an Answer-only response as trusted intent or factual authority.**
  Rejected because assistant-authored answer content is useful interaction
  output but does not prove its own truth, provenance, or permission to execute.
- **Automatically retry a failed Intake operation in the same Intake Run.**
  Rejected because hidden model recall makes replay, cost, and causal history
  ambiguous; M2.5 closes the run and requires an explicit new Intake Run.
- **Automatically mutate a materialized Goal when the user corrects it.**
  Rejected because formal revision and dependent invalidation need a separate
  authority contract.
- **Reuse WorkerPort for Intake.** Rejected because pre-Goal analysis has no
  Goal, Workflow, Attempt, Context, Policy binding, Candidate, or Worker
  dispatch identity.

## Validation

M2 dependency checks MUST continue proving that the lower App Server client can
be consumed without importing WorkerPort, Workflow, Candidate, Acceptance,
Store, CLI, or Intake contracts. Updating terminology or the governing ADR does
not add an M2 Intake implementation requirement.

Before M2.5 can exit, executable tests MUST prove at least:

1. clear source-bound `GOVERNED_EXECUTION` input can produce one admitted Goal,
   exactly one Goal Start Authorization, and one automatic ordinary Start
   command identity without duplicate first-Start authority;
2. a material ambiguity produces `CLARIFY`, persists bounded questions, and
   creates no Goal or Workflow;
3. `ANSWER_ONLY` returns either bounded `ANSWER_RETURNED` content or a typed
   `ANSWER_FAILED` result, creates no formal authority, and exact committed
   replay does not call the assistant again;
4. policy denial, unsupported input, and abandonment remain distinguishable
   `NO_EXECUTION` reasons with `answerDisposition = NOT_REQUESTED`;
5. governed project inspection is not misclassified as non-execution merely
   because it is read-only;
6. malformed, oversized, stale, cross-run, unknown-field, partial-binding, and
   model-forged Proposal, Answer-only, identity, Source Binding, ambiguity, or
   Decision payloads fail closed, including missing project/scope on
   `MATERIALIZE`;
7. a material field supported only by model inference, redacted display text,
   an omission marker, or unavailable source content cannot pass Admission;
8. Answer-only content cannot become Source Binding, Fact, Criterion, Human
   Decision, Evidence, Acceptance, Goal, or execution authority;
9. new user input invalidates the prior Projection/Admission chain for future
   Materialization;
10. concurrent and replayed Materialization creates exactly one Goal, one
    `DISCOVERY / READY` Workflow, one Materialization Record, and the exact audit
    effects;
11. fault injection at every Admission/Goal/Workflow/Materialization/Start-
    Authorization/audit/outcome write boundary leaves no partial authority;
12. a crash or failure between Materialization and Start leaves the Goal
    `READY`, and exact replay cannot duplicate first-Start bindings or
    redispatch a retained Attempt/claim;
13. a preallocated automatic Start racing a different explicit manual Start
    produces exactly one first-Start Policy/Profile binding, Context, Attempt,
    and dispatch claim, with a typed loser outcome;
14. substituted Start Command, Goal/Workflow version, Policy, Execution
    Profile, or authorization digest bindings fail closed;
15. `MATERIALIZE_ONLY` never creates automatic Start authority;
16. post-Materialization correction cannot silently revise the Goal and the
    cancel/new-Intake path remains explicit;
17. assistant timeout, unavailability, protocol failure, or interrupted
    analysis produces one terminal typed `FAILED` result with no automatic
    recall or Goal;
18. startup converts a valid orphaned `ANALYZING` Run to exactly one
    `FAILED / INTERRUPTED_ANALYSIS` result before another assistant call, while
    corrupt authority fails strict reopen;
19. partial or mixed terminal Decision, Answer-only, Failure, and Goal reference
    shapes fail schema, Store, and strict-reopen validation;
20. Codex Thread loss does not lose Raw Request, Projection, Admission,
    Materialization, or Start causality;
21. Intake adapters and explorers cannot write the Store, Goal, Workflow,
    Candidate, Evidence, or source and cannot invoke WorkerPort or StartGoal;
22. Intake observations and Answer-only content cannot satisfy Goal-bound
    Evidence without fresh formal verification; and
23. direct `CreateGoal`, M1 authority proofs, and M2 Worker-path regressions
    remain unchanged.
