# ADR 0026: Pre-Goal Intake and Goal materialization authority

- Status: Accepted
- Date: 2026-07-30

## Context

CodeClosure already defines a Goal as the durable unit of user intent, and
[ADR 0008](0008-goal-command-and-lifecycle-boundary.md) assigns Goal identity,
objective, scope, success criteria, and revision to the Goal Manager. The M1
CLI deliberately requires a complete objective, project, and at least one
explicit required criterion. It does not yet provide the product path in which
a user states an incomplete natural-language request, inspects the system's
proposed interpretation, resolves material questions, and confirms the exact
Goal before execution.

Treating that interaction as the existing `DISCOVERY` phase would require a
Goal, Workflow, Attempt, and Goal-bound Context Manifest before the user has
confirmed what the Goal is. Treating Codex output as the Goal would instead
delegate intent authority to a probabilistic backend. Reusing `WorkerPort`
would also manufacture Goal-bound execution identities for an activity that
precedes formal Goal creation.

The term `Promotion` is already reserved for applying an accepted Candidate to
another real state, such as merge, release, or deployment. Draft-to-Goal
conversion therefore needs a distinct name and authority record.

## Decision

### Position and terminology

Goal Intake is a pre-Goal product flow. It precedes formal Goal and Workflow
creation and is not a Workflow phase, an Attempt, `DISCOVERY`, technical
Acceptance, or external-effect Promotion.

Converting one exactly confirmed Goal Draft into a formal Goal is called **Goal
Materialization**. `Promotion` retains its existing post-closeout meaning.

### Intake authority records

The planned Intake boundary uses separate typed identities and immutable or
versioned records:

- `RawRequest` records what the user actually submitted;
- `IntakeRun` records the pre-Goal interaction lifecycle;
- `GoalDraft` records one immutable proposed interpretation revision;
- `ClarificationQuestion` records one material unresolved question and its
  binding;
- `GoalConfirmation` records the user's confirmation of one exact Draft
  revision and digest; and
- `GoalMaterializationRecord` binds the consumed Confirmation and Draft to the
  resulting formal Goal and Workflow.

These are CodeClosure control records outside worker-writable project and
Candidate locations. Conversation history and Codex Thread state may support
the interaction but are never their only copy.

`GoalDraftRevision` and `GoalDraftDigest` are distinct from formal
`GoalRevision` and Goal-bound digests. An Intake record MUST NOT manufacture a
`GoalId`, `WorkflowId`, `AttemptId`, or Goal-bound Context identity before
Materialization commits.

### Proposal and Draft ownership

A user authors a Raw Request. Codex or another Intake assistant may return a
`GoalDraftProposal`, clarification proposal, classification, or observation.
Every assistant response is untrusted input.

The Goal Intake Coordinator validates the closed response schema, size,
provenance, and current Intake bindings. It, not the model, allocates record
identity and revision, normalizes the allowed Draft projection, computes its
versioned canonical digest, and persists an immutable Goal Draft revision with
audit. Invalid, stale, mismatched, unknown, or oversized assistant output fails
closed and cannot create a Draft revision.

Changing objective, criteria, scope, non-goals, assumptions, or other
confirmation-bearing content creates a new Goal Draft revision. A Draft is a
system proposal and is not authoritative user intent merely because it was
persisted.

### Exact user Confirmation

The Confirmation Gateway records only an explicit typed action from an
identified user or trusted caller. A Goal Confirmation MUST bind at least:

- Raw Request, Intake Run, Goal Draft, and exact Draft revision identities;
- the versioned canonical Draft digest;
- the relevant project or declared scope identity;
- confirming principal and confirmation action;
- Confirmation schema and policy versions; and
- Runtime-authored confirmation time and record digest.

The Gateway validates the request but does not issue technical `ACCEPT`, mutate
Workflow state, or decide that a Draft is correct on the user's behalf. A
generic approval, model statement, conversation summary, click detached from
the displayed revision, or Codex Thread event cannot substitute for the exact
Confirmation record.

Any confirmation-bearing Draft change makes an earlier Confirmation stale. A
stale, missing, malformed, mismatched, withdrawn, or superseded Confirmation
cannot authorize Materialization.

### Goal Manager and atomic Materialization

The Goal Manager remains the sole authority over formal Goal identity, intent,
success criteria, scope, and revision. The Workflow Runtime remains the sole
writer of authoritative Workflow state.

A planned `MaterializeGoal` Runtime application command will:

1. resolve the current Intake Run, exact Goal Draft revision, and exact
   Confirmation from one consistent authority snapshot;
2. validate their digests, provenance, freshness, project binding, required
   criteria, and policy;
3. ask the Goal Manager to validate the formal Goal revision-1 intent;
4. ask the Workflow Runtime to construct the unique initial
   `DISCOVERY / READY` Workflow authority; and
5. atomically persist the Goal, Workflow, Goal Materialization Record, audits,
   and idempotent command outcome through the trusted Store transaction.

This compound operation does not grant the Goal Manager an independent
Workflow write path. It preserves ADR 0008's one-Workflow-writer rule and the
same Goal/Workflow lifecycle projection as direct Goal creation.

One Goal Confirmation can materialize at most one formal Goal. Exact replay of
the same admitted command returns the original Goal and Workflow authority
without duplicating records or audit effects. Reusing a Command ID,
Confirmation, or Materialization identity with different canonical input is a
conflict and fails closed.

A failure before commit may retain valid pre-Goal Intake history and a typed
failure observation, but it MUST leave no partial Goal, Workflow,
Materialization Record, success audit, or successful command outcome.

### Existing CreateGoal compatibility

The accepted M1 `CreateGoal` contract remains unchanged. It continues to
accept an explicit formal objective, project, and required criteria without
inventing missing meaning. Goal Intake is an additional natural-language front
door, not a reinterpretation of the M1 command.

Direct `CreateGoal` and future `MaterializeGoal` must converge on the same Goal
Manager validation and atomic Goal/Workflow creation primitive. Materialization
adds exact Draft and Confirmation guards; direct creation MUST NOT synthesize a
Raw Request, Draft, or Confirmation merely to imitate the Intake path.

### Codex client and adapter separation

The Codex App Server protocol client is a lower-level process, transport,
schema, and lifecycle capability. It MUST NOT be inseparably defined as the
Goal-bound `WorkerPort` implementation.

The planned layering is:

```text
Codex App Server Client
├── Codex Worker Adapter
│   └── Goal-bound execution through WorkerPort
└── Goal Intake Assistant Adapter
    └── pre-Goal proposals through an Intake-specific port
```

The adapters may reuse protocol initialization, generated schemas, stream
parsing, interruption, and process supervision. They do not reuse each other's
domain contracts, authority labels, capability grants, or persistence access.
Neither adapter receives a control-store mutation capability.

M2 must preserve this seam while implementing only the Worker path. Goal
Intake user-flow implementation is not an M2 exit criterion.

### Optional project exploration

Goal Intake may later request policy-authorized, bounded, read-only project
exploration through a dedicated port. Such exploration requires an exact
project identity, path boundary, capability policy, budget, provenance, and
audit. It MUST NOT receive Candidate write capability or control-store access.

An Intake observation is not a Goal Fact or Acceptance Evidence. If a later
formal Goal needs that information, it must be revalidated under the Goal's
current revision and the relevant Context, Candidate, Check Specification, and
Evidence contracts.

## Consequences

- Users may begin with incomplete natural language without allowing a model to
  create authoritative intent.
- Goal Intake can evolve independently of the Workflow phase machine and
  Goal-bound Context Compiler.
- Confirmation is exact, replayable, and invalidated by Draft changes rather
  than inferred from conversation.
- M2 must separate the App Server client from Worker semantics even though it
  does not implement Intake.
- M2.5 must add distinct Intake persistence, ports, CLI, migrations, and
  adversarial tests before claiming the user flow exists.
- The canonical runtime invariant that proposals cannot materialize themselves
  remains planned until its implementation and executable tests land together;
  this ADR does not add an unproved invariant to `RUNTIME_INVARIANTS.md`.
- Goal Materialization is neither technical Acceptance nor real-world
  Promotion.

## Rejected alternatives

- **Use `DISCOVERY` for Goal formation.** Rejected because `DISCOVERY` already
  requires a formal Goal, Workflow, phase, Attempt, and Goal-bound Context.
- **Let Codex create Goal Draft records directly.** Rejected because model
  output would author revision, identity, or digest authority.
- **Treat user confirmation as technical Acceptance.** Rejected because user
  intent confirmation cannot replace Candidate Evidence or Acceptance policy.
- **Let the Goal Manager write initial Workflow state independently.** Rejected
  because it creates a second Workflow writer and conflicts with ADR 0008.
- **Reuse WorkerPort for Intake.** Rejected because WorkerPort is Goal-,
  Workflow-, phase-, Attempt-, Context-, Policy-, and capability-bound.
- **Call Draft conversion Promotion.** Rejected because Promotion already means
  a separately authorized post-closeout real-world effect.
- **Make Intake mandatory by changing M1 CreateGoal.** Rejected because it
  retroactively changes the accepted M1 command and invents Intake records for
  explicit formal input.
- **Store Confirmation only in a Codex Thread or transcript.** Rejected because
  backend execution context is disposable and model-visible.

## Validation

The M2 design and dependency checks MUST prove that the App Server client can
be consumed without importing WorkerPort semantics. M2 does not need an Intake
adapter to exit.

Before M2.5 can exit, executable tests MUST prove at least:

- malformed, oversized, stale, cross-run, and model-forged proposals cannot
  persist a Draft;
- a Draft change invalidates the earlier Confirmation;
- a copied, generic, model-authored, wrong-principal, wrong-project, or
  wrong-digest Confirmation cannot materialize a Goal;
- concurrent and replayed Materialization creates exactly one Goal, one
  Workflow, one Materialization Record, and the correct audit effects;
- fault injection at every compound-write boundary leaves no partial formal
  authority;
- Codex Thread loss does not lose Raw Request, Draft, Confirmation, or
  Materialization authority;
- Intake adapters cannot write the control store or call WorkerPort as a
  substitute for the Intake port;
- Intake observations cannot be admitted as Goal-bound Evidence without fresh
  formal verification; and
- the existing direct `CreateGoal` contract and all M1 regression proofs remain
  unchanged.
