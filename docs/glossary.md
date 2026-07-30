# CodeClosure Glossary

## Acceptance Decision

A versioned decision issued only by the Acceptance Engine over an exact input
manifest. It is one of `ACCEPT`, `REJECT_REPAIRABLE`, `REJECT_BLOCKED`,
`NEEDS_DECISION`, or `ENGINE_ERROR`.

## Acceptance Engine

The read-only policy evaluator that consumes authoritative state and evidence.
It cannot edit source or mutate workflow state.

## Answer-only Response

A bounded, immutable M2.5 interaction result for an `ANSWER_ONLY` Admission
Decision. It records either validated assistant-authored answer content or a
safe delivery-failure code. It is useful output but cannot become Source
Binding, Fact, Criterion, Human Decision, Evidence, Acceptance, Goal, Workflow,
or execution authority.

## Automatic Goal Materialization

The planned Intake behavior in which a deterministic `MATERIALIZE` decision
causes the Runtime to create one formal Goal and `DISCOVERY / READY` Workflow
without a separate Draft-confirmation action. It does not itself start an
Attempt or dispatch a Worker.

## Candidate

An isolated proposed project state evaluated for one Goal revision. Candidates
are versioned by generation and are mutable only during `IMPLEMENT`.

## Candidate Digest

A canonical content identity for the candidate source and required metadata at
freeze time. Evidence and acceptance bind to this digest.

## Candidate Workspace Lease

A planned M2 Runtime-issued, digest-bound authority that resolves one exact
Candidate generation below a CodeClosure-owned workspace root. It grants only
the declared mutable or read-only access mode and cannot be replaced with the
user source checkout, authority home, another generation, or a filesystem
alias.

## Closeout

The successful technical terminal phase for one accepted Goal revision and
Candidate. Closeout is not merge, release, deployment, or production consent.

## Clarification Question

A versioned, scoped pre-Goal question whose answer may materially change a Goal
Projection's objective, criteria, scope, non-goals, project identity, risk, or
execution authorization. It is not a Workflow blocker because no formal
Workflow exists yet.

## Completion Request

A worker proposal that the current phase or implementation may be ready to
advance. It has no authority by itself.

## Context Manifest

The provenance and digest record for one compiled worker context package. It
identifies every authoritative input included or intentionally omitted.

## Evidence

A typed observation produced by a known runner or authority and bound to exact
inputs. Prose produced by the worker is not evidence unless a policy explicitly
treats it as a non-authoritative observation.

## Demo Scenario

An M1 proof recipe that selects an immutable Execution Profile and may
coordinate a controlled change in Fake external reality at a persisted Runtime
boundary. A Demo Scenario does not sequence internal phase commands, mutate the
Store, issue Acceptance, or become completion authority.

## Execution Profile

An immutable, versioned, digested description of the Worker, Candidate Source,
Verification Runner, and Runtime driver composition bound to a Workflow at
first start. M1 fixture names are aliases for installed profiles, not Goal
semantics.

## External Backend Capability Record

A planned M2 Runtime-owned classification of exact binary/schema behavior as
`SUPPORTED`, `UNSUPPORTED`, or `UNKNOWN`, with its proof source. An Execution
Profile may select only supported capabilities; protocol method presence alone
does not prove operational behavior.

## External Execution Record

A planned M2 protocol-neutral Runtime record that binds durable dispatch intent
to observed external process, backend session, operation, and terminal state.
Codex Thread and Turn IDs may appear only as opaque backend references and do
not become Workflow, Worker-result, or completion authority.

## Fact

A versioned, provenance-bearing statement about the goal, business domain,
project, code, data, environment, or external system. Facts have explicit
status and cannot be silently promoted from model inference.

## Fact Graph

The set of facts and typed relationships used to model business paths and
engineering impact. Full graph traversal is planned after the M1 control
skeleton.

## Goal

The externalized unit of user intent. It contains an objective, success
criteria, scope, revisions, and lifecycle status independent of any Codex
thread. A Codex thread-scoped goal or plan is disposable worker execution state
and is not this authoritative product object.

## Goal Intake

The planned pre-Goal product flow that records Raw Request revisions, validates
assistant analysis, forms a source-bound Intent Projection, resolves material
ambiguities, and obtains a deterministic Intent Admission Decision. It is not
the `DISCOVERY` Workflow phase.

## Goal Materialization

The atomic Runtime application operation that consumes one current exact
`MATERIALIZE` decision and creates the formal Goal, initial `DISCOVERY / READY`
Workflow, GoalMaterializationRecord, audits, and command outcome. It is
distinct from first Start and post-closeout Promotion.

## Goal Start Authorization

An immutable Intake record created exactly once for an admitted
`GOVERNED_EXECUTION / AUTHORIZE_START` Materialization and never for
`MATERIALIZE_ONLY`. It binds the source-bound request and materialized Goal to
one preallocated ordinary `StartGoal` command. It is not an Attempt or dispatch
claim and cannot bypass Start freshness, Policy, Execution Profile, Context, or
recovery guards.

## Goal Revision Proposal

A non-authoritative proposal raised after formal execution begins when newly
discovered ambiguity may require changing Goal intent. A later source-bound
Goal Revision Admission Decision and the Goal Manager, not a Worker proposal,
may create the later Goal revision.

## Human Decision

A typed, scoped record of a business fact, product preference, unavailable
external fact, or exact real-world consent. It is an acceptance input, not a
technical-gate bypass.

## Intake Failure Record

An immutable, reason-coded record that closes one Intake Run as `FAILED` when
Intent analysis, optional project observation, or Admission preparation cannot
safely finish. It carries no Goal or Workflow authority and requires a new
Intake Run for retry.

## Intake Run

A versioned pre-Goal lifecycle that owns analysis, clarification,
non-execution, Materialization, or failure status. Its statuses are not
Workflow phases or run statuses. `FAILED` is terminal for one Intake Run; M2.5
requires a new Intake Run rather than silently retrying the failed operation.

## Intent Admission

The deterministic CodeClosure decision over one exact Raw Request revision,
trusted interaction action, and Admission Policy. Projection-backed variants
also bind one complete Intent Analysis Proposal, Intent Projection, Source
Binding set, Material Ambiguity set, and optional or required project/scope as
their outcome permits. A pre-analysis `NO_EXECUTION` variant carries none of
those Projection fields. Its outcomes are `MATERIALIZE`, `CLARIFY`, or
`NO_EXECUTION`. It is not technical Acceptance.

## Intent Admission Policy

The immutable, versioned, digested pre-Goal policy that defines required Goal
fields, allowed provenance classes, materiality, non-execution reasons, and
automatic-Start eligibility. It is separate from the Workflow Policy bound by
first `StartGoal`.

## Intent Analysis Proposal

One bounded, untrusted assistant interpretation of current Intake input. It may
suggest structure or questions but cannot author Source Binding, Admission,
Goal, Workflow, Start, or Acceptance authority.

## Intent Projection

One immutable, CodeClosure-owned structured interpretation of current Raw
Request input. Each material field carries exact Source Bindings. A Projection
is an Admission input, not a formal Goal or proof of user intent by itself.

## Material Ambiguity

An unresolved pre-Goal choice that could materially change objective, required
criteria, scope, non-goals, project identity, risk, or execution authorization.
An unresolved Material Ambiguity requires `CLARIFY` rather than automatic Goal
creation.

## Policy Bundle

The versioned collection of transition rules, acceptance rules, checker
specifications, and permission rules active for an evaluation.

## Workflow Policy Binding

The immutable first-start record selecting the exact installed Policy ID,
version, and digest that governs one Workflow for its lifetime. Installing or
configuring another Policy does not replace this binding.

## Promotion

Any action that applies, merges, releases, deploys, or otherwise moves an
accepted candidate into another real state. Promotion is outside initial
technical closeout and needs separate authority.

## Project-assisted Intake

Optional policy-authorized Goal Intake that uses bounded, read-only project
exploration to propose Intent Projection changes or questions. Its observations
are not formal Goal Facts or Acceptance Evidence without fresh Goal-bound
validation.

## Raw Request

The provenance-bearing Intake root whose immutable revisions record exactly
the complete user-authored content admitted under the retention policy and
which trusted interaction action the identified user used before assistant
interpretation. A redacted display value is not Raw Request source content. A
revision may contain incomplete or ambiguous intent and is not itself a formal
Goal.

## Reconciliation

Comparison of persisted authoritative intent with current external reality
after interruption, retry, resume, or detected drift.

## Recovery Reconciliation Record

The immutable, digest-bound result of one Runtime recovery inspection. It binds
the inspected Workflow, Attempt/dispatch and Candidate authority, safe phase or
blocker, observation references, and resulting Workflow version. It is not
permission to reuse an old Attempt.

## Runtime Application Coordinator

The product-facing Runtime service that owns Goal commands, startup recovery,
deterministic M1 driving, and read-only Goal views. Trusted composition invokes
startup recovery before publishing its narrow application facade. It does not
replace the Workflow Runtime or Acceptance Engine as an authority owner.

## Source Binding

The exact link from an Intent Projection field to a source revision, digest,
optional content span, and Runtime-owned provenance class. It proves source
identity, not that an interpretation is semantically correct. A `USER_STATED`
span may address only retained user-authored source bytes, never a redacted
display or synthetic omission marker.

## Verification Runner

A bounded executor for exact check specifications. It produces observations
and run evidence, not goal acceptance.

## Worker

A replaceable execution backend, initially `FakeWorker` and later Codex through
App Server. Workers propose and execute permitted actions but hold no workflow
or acceptance authority.

## Workflow Runtime

The sole writer of authoritative workflow state. It validates transition
preconditions, applies phase permissions, persists transitions, and records
audit events.
