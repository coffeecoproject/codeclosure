# CodeClosure Product Contract

## Product Definition

CodeClosure is a deterministic control runtime for AI-assisted software
engineering. It turns a user goal into governed execution and permits a result
to close only after versioned acceptance rules validate the exact candidate and
its evidence.

CodeClosure is the user-facing product. Coding agents are replaceable workers
behind adapters.

## Product Promise

CodeClosure does not promise that a model never makes a mistake. It promises
that a worker's unverified claim cannot directly become a successful completion
result.

The short form is:

```text
LLM capability + CodeClosure control = governed engineering execution
```

The externally visible rule is:

```text
No current acceptance decision, no successful closeout.
```

## Meaning of Deterministic

For a fixed set of versioned inputs, CodeClosure must produce the same control
decision:

- the same goal revision;
- the same fact and decision revisions;
- the same workflow phase;
- the same candidate digest;
- the same evidence records;
- the same policy bundle and checker versions.

The same control decision means the same semantic outcome, ordered rule trace,
and decision digest. Storage record IDs and observation timestamps may differ
between evaluations and are not part of semantic decision equality. Canonical
digest rules are fixed by
[ADR 0006](docs/adr/0006-canonical-serialization-and-digest-profiles.md).

Deterministic does **not** mean:

- absolute proof of business correctness;
- proof that no unknown defect exists;
- deterministic LLM output;
- automatic authority over release, production, payments, legal decisions, or
  irreversible data changes.

Unknown, missing, stale, contradictory, or unverifiable required input fails
closed for the dependent claim.

## Primary User

The initial user is one developer working locally in a software repository who
wants Codex-level implementation capability without delegating completion
authority to the model.

The user should be able to state a request in natural language, understand
whether CodeClosure will execute, clarify, or answer without execution, see
whether an Answer-only response was returned or failed, inspect the source-bound
formal intent when needed, and then see:

- the active goal;
- its explicit required success criteria;
- the current phase;
- covered and uncovered business paths;
- the candidate generation under evaluation;
- verification progress;
- concrete blockers or decisions needed;
- the evidence behind a closeout.

The user does not need to operate internal artifact types or select technical
workflow stages manually.

## Responsibility Model

### User owns

- the real goal and priority;
- the exact Raw Request content and trusted interaction action used to ask for
  governed execution, answer-only handling, or materialization without Start;
- business facts that cannot be derived from project evidence;
- preferences between materially different valid product outcomes;
- consent to a concrete external or irreversible real-world effect;
- authoritative external facts that the runtime cannot obtain.

### CodeClosure owns

- authoritative goal and workflow state;
- Raw Request revisions, Intent Projection revisions, Source Bindings,
  Material Ambiguity, deterministic Intent Admission, Goal Materialization,
  and optional automatic-Start causality for the planned Intake path;
- bounded Answer-only response validation/disposition and terminal Intake
  failure/restart classification, without treating assistant answer text as
  formal truth;
- technical routing and phase transitions;
- allowed-action enforcement;
- fact provenance and unresolved-fact tracking;
- context compilation;
- candidate identity, generations, and freeze state;
- evidence identity and invalidation;
- acceptance evaluation;
- immutable Workflow Policy and Execution Profile bindings, crash recovery,
  and audit history;
- the final technical closeout decision.

### Worker owns

- code and project inspection requested by the runtime;
- plan and implementation proposals;
- edits inside the active mutable candidate when permitted;
- bounded command execution when permitted;
- observations, candidate results, and repair proposals.

Worker output is untrusted input until CodeClosure validates and records it. A
Worker may report a closed failure reason; CodeClosure alone maps that reason to
retry and recovery classification.

The planned Goal Intake Assistant is a separate adapter role rather than a
Goal-bound Worker. It may return an Intent Analysis Proposal or clarification
proposal, or bounded Answer-only content, but owns no Projection identity,
Source Binding, Admission Decision, formal Goal, Workflow, Start, Acceptance, or
closeout authority. Answer-only content is a non-authoritative response, not a
Fact, Criterion, Evidence record, or execution instruction. See
[ADR 0027](docs/adr/0027-source-bound-intent-admission-and-automatic-goal-materialization.md).

### Verification runner owns

- executing an exact, versioned check specification;
- returning bounded observations and a check-level result under that
  specification;
- returning an observation rather than an acceptance decision.

CodeClosure records authoritative producer, timing, environment, payload, and
Evidence identity from the validated request and Check Specification. The
runner does not author those bindings.

### Human Decision Gateway owns

- capturing a required business decision, unavailable fact, or exact consent;
- binding that decision to its scope and revision;
- never converting a generic "approve" action into a bypass of technical gates.

## Core User Loop

The target natural-language front door forms a formal Goal before governed
execution:

```text
state a request in natural language
  -> CodeClosure performs trusted preflight
  -> when analysis is needed, validate an assistant Intent Analysis Proposal
  -> form a source-bound Intent Projection
  -> resolve only material ambiguities
  -> deterministic Intent Admission
       |-- CLARIFY
       |-- NO_EXECUTION
       |     `-- ANSWER_ONLY returns ANSWER_RETURNED or ANSWER_FAILED
       `-- MATERIALIZE the formal Goal and READY Workflow atomically
             -> optionally invoke separately authorized StartGoal
```

This planned Goal Intake path does not require the user to write a complete
Criterion at the first message or confirm a model-authored Draft. CodeClosure
may derive only meaning-preserving structure under named policy; a materially
different business outcome or unsupported model inference requires
clarification. The accepted direct `CreateGoal` path remains available for
callers that already provide an explicit objective, project, and required
criteria. Goal Materialization creates only a `READY` Workflow; even when the
user experiences one automatic operation, first Start remains a separate
audited command. The complete target contract is in
[Goal Intake](docs/goal-intake.md).

M2.5 treats an Intake processing `FAILED` result as terminal for that Intake
Run and does not silently retry the assistant. A user retry starts a new Intake
Run. This is distinct from `ANSWER_FAILED`, where non-execution was intentional
but the requested non-authoritative answer could not be delivered; retrying the
answer likewise requires a new explicit Answer-only request.

Once a formal Goal exists, the governed engineering loop remains:

```text
inspect and compile relevant facts
  -> plan the bounded change
  -> build an isolated candidate
  -> freeze the candidate
  -> build evidence
  -> evaluate acceptance
  -> repair or close out
```

The loop may return from final verification to implementation, but a frozen
candidate is never silently mutated. Repair creates a new candidate generation.

## Completion Semantics

A Goal MUST define at least one required success criterion. Optional criteria
MAY record useful non-blocking expectations, but they cannot be the Goal's only
criteria and do not create completion authority by themselves.

A CodeClosure goal is successfully closed only when:

1. the Workflow Runtime is in `FINAL_VERIFY` for the current goal revision;
2. the candidate is frozen and its digest is current;
3. every required acceptance rule has a current result;
4. no blocking fact, issue, decision, or evidence conflict remains;
5. the Acceptance Engine issues `ACCEPT` for the exact input set;
6. the Workflow Runtime transactionally records that decision and enters
   `CLOSEOUT`;
7. the closeout record identifies the exact accepted candidate and evidence.

Codex `turn/completed`, process exit code zero, a green test, or an assistant
message saying "done" does not satisfy these semantics.

## Product Boundaries

Technical closeout is separate from applying, merging, releasing, or operating
the result in the real world. A later promotion path may consume a successful
closeout, but it requires its own authority and policy.

CodeClosure must not imply that technical readiness authorizes:

- commit or push;
- pull-request merge;
- deployment or app-store submission;
- production mutation;
- migration of irreversible real data;
- paid-resource creation;
- customer communication;
- legal, compliance, tax, finance, privacy, or security acceptance.

## Initial Success Measures

M1 and M2 should make these claims measurable:

- a worker cannot create an `ACCEPT` decision;
- an illegal state transition is rejected before persistence;
- missing or mismatched acceptance input cannot close a goal;
- a process restart does not lose the authoritative phase or goal revision;
- replacing or compacting a Codex thread does not lose authoritative state;
- acceptance can be replayed from recorded inputs with the same result;
- the user can identify the dominant blocker without reading the full agent
  transcript.

M2.5 should additionally make these Goal-formation claims measurable:

- model output cannot create or revise a formal Goal;
- a material field supported only by model inference cannot pass Intent
  Admission;
- stale or mismatched Raw Request, Projection, Source Binding, project, or
  Admission input cannot materialize a Goal;
- a successful Materialization creates one exact Goal and Workflow atomically;
- automatic Start remains a separate exact `StartGoal` effect and failure
  leaves the materialized Goal visibly `READY`; and
- the user can distinguish what they stated, what the assistant proposed, what
  CodeClosure projected, what remains unresolved, and why Admission chose its
  outcome.

## Explicit Non-Goals for the Initial Product

- general-purpose AI operating system;
- multi-tenant control plane;
- distributed workflow engine;
- universal business-knowledge inference;
- provider-independent agent support before the Codex path is stable;
- rich TUI before the control loop is proven;
- automatic production release;
- backward compatibility with IntentOS paths, schemas, commands, or generated
  artifacts.
