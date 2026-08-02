# ADR 0034: Close pre-Goal command replay and SQLite activation

- Status: Accepted
- Date: 2026-08-02

## Context

ADR 0027 requires M2.5 Goal Intake to persist immutable Raw Request revisions,
terminal Intake results, idempotent command outcomes, exact replay, restart
reconciliation, and atomic Goal Materialization. Two existing M1 boundaries do
not directly represent that pre-Goal lifecycle.

First, ADRs 0009 through 0013 bind `processed_commands` to an existing Goal or
Workflow. Before Materialization, an Intake command has neither. Fabricating a
Goal target would grant formal authority before Admission, while waiting until
after an assistant call to record command ownership could invoke that external
operation twice under duplicate or concurrent delivery.

Second, ADR 0023 activates SQLite only after a read-only bootstrap snapshot and
filesystem isolation verification account for every retained Goal project
reference. M2.5 will add Raw Requests and Intake Runs that may retain a project
or scope path before a Goal exists. Ignoring those paths would let the authority
home be activated inside, or overlap with, a retained Intake project merely
because Materialization had not occurred.

These are authority and startup-publication decisions, not table-layout or CLI
implementation details. They must be fixed before M2.5 persistence code.

## Decision

### Use a separate immutable pre-Goal command contract

M2.5 MUST introduce an Intake-owned command contract separate from
`processed_commands`. The contract MUST use two immutable record kinds:

```text
IntakeCommandReservation
  -> one exact canonical command input owns one pre-Goal operation

IntakeCommandOutcome
  -> exactly one terminal APPLIED | REJECTED | FAILED result for that reservation
```

An `IntakeCommandReservation` binds at least:

- `CommandId`;
- closed operation kind, including whether an external operation is
  Intent-analysis or Answer-only;
- trusted principal;
- target Raw Request or Intake Run identity;
- canonical command-input digest;
- expected and observed Intake version when applicable;
- exact Intake/Answer-only Manifest ID and digest plus installed Admission
  Policy, adapter, and response-contract identities for an external operation;
- Runtime-authored reservation time; and
- the initial Intake operation identity.

For an eligible operation, the reservation commits atomically with the initial
Raw Request revision or clarification revision, the corresponding IntakeRun
state/version, the exact operation Manifest/bindings when external work is
required, and audit before an Intake assistant, Answer-only assistant, or future
project observer is invoked. Failure to commit that transaction authorizes no
external call.

For a deterministic admitted rejection, the Store commits the reservation,
`REJECTED` outcome, observed Intake version, and audit together without a new
Raw Request revision, Intake state transition, or external call. Invalid input,
a genuinely missing target, replay-integrity failure, and command conflict do
not become admitted rejections merely to manufacture a replay row.

### Bind clarification to one exact active question

Before the Intent Admission Engine issues `CLARIFY`, trusted Runtime
composition preallocates the Decision and Question IDs and constructs one
schema-validated `ClarificationQuestionSpec` from the exact current Projection,
Material Ambiguity, and installed question policy. `questionSpecDigest` covers
the Intake, Projection, ambiguity, prompt, affected fields, and answer schema;
it excludes the generated Decision and Question IDs, timestamps, resolution
state, and its own digest field. The Engine may issue `CLARIFY` only with a
`QuestionPlanBinding` that carries the preallocated Question ID and this exact
spec digest. The Decision's semantic digest includes `questionSpecDigest`,
while generated IDs remain envelope metadata under ADR 0006.

The persisted `ClarificationQuestion` repeats that exact specification and
binds the issuing Decision ID and digest. Its `questionDigest` is a distinct
exact relationship digest over the Question ID, issuing Decision ID/digest,
question specification, and `questionSpecDigest`; it excludes only declared
timestamps and its own digest field. The Decision does not bind
`questionDigest`, so the construction is acyclic:
question specification, then Decision, then Question record. The Store MUST
independently recompute both digests, validate every repeated field and exact
cross-reference, and atomically persist the Decision, Question, active-question
reference, state transition, audits, and command outcome. A partial or
substituted Decision/Question pair fails closed.

The Question definition remains immutable and carries no later answer or
resolution field. `IntakeRun` carries one optional exact `activeQuestionRef`,
not an active-question collection that also claims to store history. Historical
Questions remain queryable from immutable Question rows and their answer
bindings.

Every `intake clarify` command MUST carry one `ClarificationQuestionId`; the
caller does not restate the question specification or either digest. Runtime
resolves the retained `questionSpecDigest` and `questionDigest` and binds the
exact ID plus both digests into canonical command input and reservation, in
addition to the Intake ID, expected version, principal, answer, and optional
normalized project path. Runtime validates that the question belongs to the
Intake Run, is the single current unanswered question, still binds the current
`CLARIFY` Decision and authority, and permits the supplied answer shape before
creating a Raw Request revision or invoking an assistant.

An accepted clarification answer MUST create a new Raw Request revision whose
canonical semantic projection embeds one complete `AnsweredQuestionBinding`:
Question ID, question-spec/record digests, and issuing Decision ID/digest. That
revision does not bind a later answer-record identity or digest. After computing
the Raw Request digest, Runtime constructs one immutable
`ClarificationAnswerBinding` that additionally binds the exact Raw Request
ID/revision/digest, Command ID, and canonical command-input digest. Its
schema-versioned `answerBindingDigest` excludes only its generated record ID,
Runtime-authored answer time, and itself.

The Store MUST atomically persist the command reservation, new Raw Request
revision, unique Answer Binding, cleared `activeQuestionRef`, IntakeRun
version/status, exact operation Manifest/bindings, and audit before a subsequent
assistant call. It independently recomputes the Raw Request and Answer Binding
digests and requires every repeated Question, Decision, Intake, revision-parent,
and command field to match. There is at most one Answer Binding per Question.
The construction is acyclic: Question, then Raw Request revision, then Answer
Binding. Existence of that binding, rather than mutation of the Question,
establishes that the Question was answered.

`answeredAt` uses the Runtime causal-time contract and MUST NOT predate the
Question, command reservation, or admitted Raw Request revision that the Answer
Binding consumes. One effective transaction time may satisfy all applicable
floors; caller or assistant time is not accepted.

The bounded M2.5 policy emits exactly one active Clarification Question per
`CLARIFY` transaction. Answered historical Questions and their Answer Bindings
remain immutable, but M2.5 does not accept positional answers, simultaneous
active questions, or a batch-answer protocol. A later extension may add batch
answering only with explicit question ID, spec-digest, and record-digest
bindings plus stale-question rules; it may reuse the acyclic per-question chain
but cannot weaken M2.5 cardinality.

An existing stale, already answered, foreign, digest-mismatched, or non-current
question is a deterministic admitted rejection only after the command has
otherwise passed schema, target, and replay-integrity admission. That rejection
commits the reservation, `REJECTED` outcome, observed Intake version, and audit
without a Raw Request revision, lifecycle mutation, or external call. An
omitted question ID or genuinely missing question remains invalid input or a
missing target under the preceding rule and creates no replay row.

An `IntakeCommandOutcome` binds the reservation, exact input digest, observed
authority version, terminal disposition, safe typed public result, causal time,
and all authority created by its owning compound transaction. The Store authors
the outcome from the committed transaction; a caller cannot provide a trusted
outcome envelope.

The closed dispositions mean:

- `APPLIED` — the admitted Intake operation committed its exact result. This
  includes `CLARIFY`, intentional `NO_EXECUTION`, successful Materialization,
  and `NO_EXECUTION / ANSWER_FAILED` because the requested non-execution policy
  was applied even though answer delivery failed;
- `REJECTED` — one deterministic, schema-valid admitted command rejection was
  evaluated against an exact observed Intake version and stored; and
- `FAILED` — one terminal `IntakeFailureRecord`, `FAILED` Intake status, audit,
  and safe failure result committed together.

When trusted deterministic preflight is immediately dispositive and requires
no external operation, the Runtime MUST use one compound transaction. That
transaction commits the exact current Intake authority, any new Raw Request
revision admitted by the command, the reservation, closed `NO_EXECUTION`
Decision, terminal status, `APPLIED` outcome, and audits together. It MUST NOT
first persist an `ANALYZING` operation that no assistant will consume, split the
reservation from its already-known outcome, or turn a crash between those
writes into `INTERRUPTED_ANALYSIS`.

`FAILED` is not a relabelled Store, audit, codec, clock, identifier,
replay-integrity, command-conflict, or unrecorded adapter exception. If those
failures prevent the compound transaction, no final outcome may claim that a
terminal Intake failure was persisted.

The reservation is never updated into an outcome. Active state is derived from
one valid reservation with no final outcome and a matching non-terminal
IntakeRun. A final outcome is a separate immutable record with a unique
reservation relationship.

### Close duplicate, conflict, concurrency, and orphan behavior

For the same `CommandId` and canonical input digest:

- replay of a retained final outcome returns its stored Intake result without
  another assistant call or new Intake, Admission, Goal, Workflow,
  Materialization, Start Authorization, or Intake audit effect;
- one active in-process owner may expose a typed non-authoritative
  `IN_PROGRESS` view or share its completion promise with an exact duplicate,
  but the duplicate cannot start another external operation; and
- after restart, the Runtime does not resume the old assistant operation from
  conversation or process state.

Reusing the `CommandId` with another canonical input digest is a command
identity conflict. It creates no replacement reservation, outcome, Raw Request
revision, assistant call, Goal, or Start authority.

Concurrent reservation attempts serialize at the Store boundary. Exactly one
winner may commit the reservation and initial Intake authority. A loser reloads
the winner and follows exact duplicate or conflict semantics; it does not infer
success from unique-constraint text.

After verified activation and before publishing Intake handlers, startup
reconciliation dispatches on the immutable reservation operation kind:

- a structurally valid orphaned non-Answer-only analysis reservation and
  matching `ANALYZING` Run closes as one audited
  `FAILED / INTERRUPTED_ANALYSIS` result with one `FAILED` Intake command
  outcome; and
- a structurally valid orphaned Answer-only reservation re-runs only the
  deterministic Admission calculation over its exact retained input, then
  atomically commits `NO_EXECUTION / ANSWER_FAILED /
  INTERRUPTED_ANSWER_DELIVERY`, the bounded Answer-only failure response,
  audits, and one `APPLIED` Intake command outcome.

The Answer-only branch does not recall the assistant or reinterpret delivery
interruption as Intake processing failure. Missing policy or source bindings,
an irreproducible prepared Decision, contradictory operation/state shape,
mixed-terminal authority, or other corruption blocks strict reopen.
Reconciliation makes no external call and cannot synthesize a resumable Thread.

### Keep existing Goal and Workflow command authority unchanged

`processed_commands` remains the only existing Goal/Workflow command journal.
Its target, owning Goal, Store-authored outcome, immutability, freshness,
replay, causal-time, and failure rules remain governed by ADRs 0009 through
0013.

Materialization atomically creates its Intake final outcome together with the
Admission Decision, Goal, Workflow, Materialization Record, optional Goal Start
Authorization, and audits. The separately preallocated ordinary `StartGoal`
continues to use `processed_commands`; the Intake ledger cannot record or
replace its outcome.

After replay returns a materialized `AUTHORIZE_START` Intake outcome, the
application coordinator MAY separately resubmit only the exact preallocated
ordinary `StartGoal` under ADR 0027. That submission is not another Intake
effect. The existing Goal/Workflow command boundary decides whether it performs
the still-missing first Start, returns the already-processed result, or rejects
the command. It cannot recreate first-Start authority or redispatch a retained
Attempt after Start already committed.

Direct `CreateGoal` remains unchanged and does not create an Intake reservation
or outcome.

### Extend verified SQLite activation to every retained Intake project reference

ADR 0023's verified activation snapshot MUST be extended for databases
containing M2.5 schema. Before migration, policy installation, recovery
mutation, or facade publication, the read-only bootstrap decoder MUST strictly
enumerate:

- every retained Goal project-path reference already required by ADR 0023;
- every retained Raw Request, Intake Run, or other Intake authority path that
  can identify a declared project or materialization scope.

Trusted composition separately supplies every explicit project root from the
current invocation. The retained snapshot and explicit invocation roots are
distinct inputs to one isolation lease; an explicit root is not expected to
already exist in the retained database snapshot.

The isolation verifier treats all of those paths as denial inputs. They cannot
establish Intake status, Source Binding, Admission, Goal intent, project
existence, recovery safety, or completion.

The verified activation transaction compares the complete decoded
post-migration retained Goal and Intake project-reference set with the retained
pre-migration snapshot. It separately revalidates every explicit invocation
root through the same isolation lease. A migration may add schema
representation but may not silently drop, rewrite, normalize differently, or
substitute a retained project identity.
Unknown bootstrap schema, unprovable Intake path ownership, unsafe overlap, or
snapshot drift rolls back activation without publishing a Store or handler.

For `intake submit`, trusted composition resolves and includes the explicit
project path in the initial isolation lease before Store activation. The later
Runtime request must match that path. Intake-ID status and audit queries use
only retained bootstrap paths and accept no caller-restated project path.

`intake clarify` MAY carry one optional structured project path when its exact
`ClarificationQuestionId` identifies the current project-identity question.
Trusted composition resolves that explicit root and includes it alongside every
retained root before Store activation. The explicit root is a denial input at
bootstrap, not replacement authority: retained paths remain in the isolation
set. After activation, Runtime MUST validate the exact Intake ID, expected
version, Question ID, both question digests, issuing Decision, principal,
canonical command input, and normalized path before atomically binding the
user-authored project correction to a new
Raw Request revision. The canonical command-input digest includes the
normalized path when present. A question that does not permit a
project-identity answer, a free-form answer, assistant output, or a status/audit
request cannot introduce or replace a project path.

After isolation verification, migration, strict retained-authority validation,
policy/profile installation, and Intake orphan reconciliation complete, trusted
composition may publish the narrow application facade. CLI handlers receive no
raw bootstrap snapshot, SQLite handle, Store, or Workflow kernel.

## Consequences

- Duplicate or concurrent Intake delivery cannot invoke the assistant twice
  merely because no Goal exists yet.
- A terminal Intake processing failure is replayable without weakening the
  rule that uncommitted infrastructure failures are not stored outcomes.
- The Intake command contract does not fabricate Goal/Workflow ownership or
  reinterpret Worker delivery identities.
- Retained pre-Goal project paths participate in the same fail-closed data-home
  isolation lifecycle as retained Goal paths.
- Startup migration, validation, reconciliation, and capability publication
  retain one explicit order.
- M2.5 adds no project explorer, Goal revision, technical Acceptance, Worker
  retry, Promotion, or external-effect authority.

This ADR extends ADRs 0009 through 0013, ADR 0020, ADR 0023, and ADR 0027. It
refines ADR 0027's generic orphan-`ANALYZING` rule only for a reservation whose
immutable operation kind proves interrupted Answer-only delivery. It does not
supersede their Goal, Workflow, Store-authored outcome, activation, Admission,
Materialization, or Start authority owners.

## Rejected alternatives

- **Target pre-Goal commands at a placeholder Goal.** Rejected because it
  creates formal identity before deterministic Admission and corrupts existing
  command ownership.
- **Call the assistant before reserving the command.** Rejected because exact
  replay and concurrent delivery could duplicate cost and untrusted effects.
- **Mutate one reservation row through several statuses.** Rejected because
  immutable reservation plus immutable outcome gives strict replay and recovery
  a closed causal chain.
- **Store every adapter or infrastructure exception as `FAILED`.** Rejected
  because only a successfully committed terminal Intake failure is replay
  authority.
- **Reuse `processed_commands` with nullable Goal ownership.** Rejected because
  it weakens the existing Store-enforced Goal/Workflow command contract.
- **Write `answeredByRawRequestRevision` into the Question later.** Rejected
  because it mutates an immutable authority record, leaves resolution outside
  the Question digest, and makes restart validation depend on update order.
- **Introduce a versioned Question aggregate or Clarification Round now.**
  Rejected because M2.5 needs one exact active Question and one exact answer,
  not simultaneous questions, batch answers, or a generic questionnaire state
  machine. A future extension requires a new schema and policy decision.
- **Inspect only materialized Goal project paths during activation.** Rejected
  because pre-Goal retained authority could overlap the data home unnoticed.
- **Ask the caller to restate the project on every Intake command.** Rejected
  because restated input cannot replace retained identity and would change the
  accepted ID-based query surface.
- **Extract a new project path from clarification prose after Store
  activation.** Rejected because model or free-form interpretation cannot
  retroactively participate in the pre-activation isolation lease. A permitted
  correction uses the explicit structured path as denial input before Runtime
  decides whether to bind it as user authority.

## Validation

M2.5 tests MUST prove:

- no assistant or observer call occurs before reservation, initial Intake state,
  and audit commit;
- exact active duplicates invoke at most one external operation, exact final
  duplicates return the stored outcome, and conflicting reuse creates no new
  effect;
- concurrent reservations produce exactly one winner without inferring domain
  semantics from SQLite errors;
- `APPLIED`, `REJECTED`, and `FAILED` outcomes are Store-authored, immutable,
  exactly bound, causally ordered, strictly decoded, and replayed only for their
  owning Intake command;
- Answer-only delivery failure commits `APPLIED / NO_EXECUTION /
  ANSWER_FAILED`, while a recorded Intent-processing failure commits one
  `FAILED` outcome and uncommitted infrastructure failure commits neither;
- a dispositive no-external-operation preflight commits its reservation,
  Decision, terminal state, `APPLIED` outcome, and audits atomically without an
  intermediate `ANALYZING` operation;
- every clarification command binds one exact current Question ID, both
  question digests, and issuing Decision; M2.5 persists exactly one active
  question per `CLARIFY`; an accepted answer atomically creates one bound Raw
  Request revision and one unique immutable Answer Binding while clearing the
  active reference; `NEEDS_CLARIFICATION` alone requires that singular
  unanswered reference, while `ANALYZING` and terminal statuses reject one;
  positional, stale, foreign, already answered,
  Decision/spec/record/answer-binding-substituted, or mismatched input is
  rejected without external work;
- startup closes one valid orphaned Intent-analysis operation as `FAILED` and
  one valid orphaned Answer-only operation as `APPLIED / NO_EXECUTION /
  ANSWER_FAILED / INTERRUPTED_ANSWER_DELIVERY`, without an assistant call, and
  blocks on corrupt or mixed authority;
- Intake outcomes cannot replace an ordinary `StartGoal` processed outcome;
  replay may separately resubmit only the exact preallocated Start command,
  which cannot recreate first-Start authority or redispatch a retained Attempt;
- verified activation includes explicit and retained Intake project paths,
  including an allowed structured clarification correction, rejects unsafe
  overlap or snapshot drift before publication, and preserves all existing
  Goal-path checks; and
- direct `CreateGoal`, M1 command replay, M2 Worker delivery, and complete M1/M2
  regression behavior remain unchanged.
