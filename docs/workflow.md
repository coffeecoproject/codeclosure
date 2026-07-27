# CodeClosure Workflow State Machine

## Status

This document defines the target workflow contract. No Workflow Runtime is
implemented at M0. M1 implements the deterministic state model, guards, and
FakeWorker proof path without real source editing or Codex integration.

## Purpose

The workflow turns a long-running engineering goal into explicit, recoverable
phases with enforceable capabilities. It is an internal control model, not a
menu the user must operate.

## State Dimensions

CodeClosure separates:

- **phase** — what kind of work is allowed;
- **run status** — whether the phase is ready, running, waiting, blocked,
  failed, cancelled, or closed;
- **attempt** — one bounded execution within a phase;
- **candidate generation** — one mutable/frozen implementation proposal.

This prevents an operational failure or user wait from being confused with a
new engineering phase.

## Main Phase Graph

```text
DISCOVERY
   |
   v
PLAN
   |
   v
IMPLEMENT <-------------------------------+
   |                                      |
   v                                      |
SOURCE_FREEZE                             |
   |                                      |
   v                                      |
EVIDENCE_BUILD                            |
   |                                      |
   v                                      |
FINAL_VERIFY -- REJECT_REPAIRABLE --------+
   |
   | ACCEPT
   v
CLOSEOUT
```

`REJECT_BLOCKED`, `NEEDS_DECISION`, `ENGINE_ERROR`, cancellation, and retry
exhaustion change run status or create a blocker. They do not invent a success
path.

## Phase Contracts

### DISCOVERY

Purpose:

- bind project and base source identity;
- identify the goal's current facts and unknowns;
- discover relevant business scenarios and code surfaces;
- determine the smallest safe planning depth.

Allowed:

- read project and authoritative external facts;
- run bounded read-only discovery;
- propose facts and scenarios;
- request a typed missing business/external fact.

Forbidden:

- source edits;
- candidate acceptance;
- treating inferred coverage as confirmed;
- closing the goal.

Exit guard:

- Goal revision is current;
- project/base identity is recorded;
- required discovery is complete or explicitly scoped;
- every required unknown is resolved or represented as a blocker;
- applicable business scenarios are recorded or a policy-backed reason says
  they are not required.

### PLAN

Purpose:

- translate the Goal and scenario set into a bounded implementation and
  verification plan.

Allowed:

- read source and facts;
- create plan proposals in the control store;
- define expected change surfaces and verification obligations;
- run read-only plan review.

Forbidden:

- source edits;
- accepting a plan because the worker says it is good;
- expanding Goal scope without a Goal revision;
- closing the goal.

Exit guard:

- current plan binds the Goal revision and facts;
- expected change set and non-goals are explicit;
- scenarios map to implementation surfaces and verification obligations;
- plan-policy checks pass;
- no required planning blocker remains.

### IMPLEMENT

Purpose:

- create or repair one isolated candidate generation.

Allowed:

- write only inside the active mutable candidate and run-owned locations;
- execute bounded implementation commands;
- inspect and test during development;
- submit proposed facts, observations, and a Completion Request.

Forbidden:

- control-store mutation by the worker;
- editing a frozen generation;
- writing the governed source checkout directly;
- changing Goal scope through code;
- issuing acceptance.

Exit guard:

- a current mutable candidate exists;
- worker activity has ended or been interrupted safely;
- actual change set can be enumerated;
- prohibited paths/effects are absent;
- a Completion Request or runtime policy requests freeze evaluation.

### SOURCE_FREEZE

Purpose:

- establish immutable candidate identity before evidence is built.

Allowed:

- stop implementation workers;
- reconcile the workspace;
- enumerate source and change identity;
- compute and persist the frozen digest;
- change candidate state from `MUTABLE` through `FREEZING` to `FROZEN`.

Forbidden:

- source edits;
- worker-controlled digest computation as the sole source;
- evidence reuse from another digest;
- acceptance.

Exit guard:

- no write-capable worker remains active;
- candidate identity is stable across the freeze observation window;
- base and actual change set are recorded;
- frozen digest is persisted;
- integrity policy passes.

If source changes during or after freeze, the generation becomes
`INVALIDATED`; the workflow does not proceed with its evidence.

### EVIDENCE_BUILD

Purpose:

- satisfy verification obligations for the exact frozen candidate.

Allowed:

- read frozen source;
- execute exact verification specifications;
- create run-owned temporary resources and evidence outputs;
- record evidence and cleanup observations;
- perform independent read-only review.

Forbidden:

- modifying frozen source;
- repairing code inside a verification run;
- treating a worker-authored PASS string as observed proof;
- issuing acceptance.

Exit guard:

- every required obligation has current eligible evidence or an explicit
  blocking result;
- evidence binds the frozen candidate and relevant fact/policy versions;
- run-owned resources have required cleanup evidence;
- source digest still matches freeze.

### FINAL_VERIFY

Purpose:

- evaluate all current acceptance rules over one immutable input manifest.

Allowed:

- read authoritative state, frozen source, and evidence;
- recompute identities;
- evaluate deterministic acceptance rules;
- record one immutable Acceptance Decision.

Forbidden:

- source edits;
- worker invocation that can mutate the candidate;
- changing evidence to make a rule pass;
- generic human override;
- entering closeout without current `ACCEPT`.

Outcomes:

- `ACCEPT` — eligible for transactional transition to `CLOSEOUT`;
- `REJECT_REPAIRABLE` — reject the generation and return to `IMPLEMENT` with a
  new generation;
- `REJECT_BLOCKED` — remain at the current phase with a technical blocker;
- `NEEDS_DECISION` — suspend for a typed decision, then rebuild affected
  inputs and reevaluate;
- `ENGINE_ERROR` — fail closed and retry or block according to error policy.

### CLOSEOUT

Purpose:

- record the single successful technical completion truth for the Goal
  revision and accepted candidate.

Allowed:

- transactionally bind the Acceptance Decision;
- mark the candidate generation `ACCEPTED`;
- mark the Goal `CLOSED` and run status `CLOSED`;
- emit a closeout summary and evidence index.

Forbidden:

- changing accepted source;
- treating closeout as merge, push, release, deployment, or production
  authority;
- hiding known limitations or excluded scope.

## Transition Matrix

| From | To | Required authorization | Invalidates |
| --- | --- | --- | --- |
| `DISCOVERY` | `PLAN` | discovery guard | stale discovery attempts |
| `PLAN` | `IMPLEMENT` | plan guard | prior candidate generations when plan identity changed |
| `IMPLEMENT` | `SOURCE_FREEZE` | candidate + boundary guard | incomplete implementation attempt |
| `SOURCE_FREEZE` | `EVIDENCE_BUILD` | stable freeze digest | evidence for older digests |
| `EVIDENCE_BUILD` | `FINAL_VERIFY` | evidence-readiness guard | incomplete runner attempts |
| `FINAL_VERIFY` | `CLOSEOUT` | current `ACCEPT` only | no accepted inputs |
| `FINAL_VERIFY` | `IMPLEMENT` | `REJECT_REPAIRABLE` + new generation | rejected generation evidence for future acceptance |

Direct jumps, including `IMPLEMENT -> CLOSEOUT`, are illegal.

## Capability Matrix

| Phase | Project read | Candidate source write | Run-output write | Control-state command | Acceptance evaluation |
| --- | --- | --- | --- | --- | --- |
| `DISCOVERY` | yes | no | bounded discovery only | proposals | no |
| `PLAN` | yes | no | plan observations | proposals | no |
| `IMPLEMENT` | yes | current mutable generation only | bounded | completion request | no |
| `SOURCE_FREEZE` | yes | no | freeze metadata | runtime-owned | no |
| `EVIDENCE_BUILD` | read-only frozen | no | run-owned only | evidence submission | no |
| `FINAL_VERIFY` | read-only frozen | no | decision trace only | decision submission | yes, read-only |
| `CLOSEOUT` | read-only accepted | no | closeout export | runtime-owned | consume existing only |

The runtime enforces this matrix through API exposure, workspace separation,
backend sandbox settings, and post-action integrity checks.

## Suspension and Decisions

Any non-terminal phase may use run status `WAITING_FOR_INPUT` when one of the
allowed human-input classes is genuinely required. The suspension record must
identify:

- exact question or effect;
- why project evidence cannot resolve it;
- scope and invalidation conditions;
- safe resume phase.

After a decision arrives, the runtime does not blindly continue. It revises the
relevant facts/Goal when needed, invalidates dependent inputs, and reevaluates
the phase guard.

## Cancellation

The user may cancel a Goal. Cancellation:

- stops new worker dispatch;
- interrupts bounded active work when safe;
- preserves audit and candidate records according to retention policy;
- records `CANCELLED` rather than `CLOSED`;
- never issues an `ACCEPT` decision.

## Retry and Repair

Retries repeat an operation against the same valid inputs after a transient
failure. Repairs create a new candidate generation after a semantic or
implementation rejection. They are not interchangeable.

Each automatic retry records:

- failure class;
- attempt number;
- maximum budget;
- backoff;
- whether external reality must be reconciled first.

## Crash Recovery

For a non-terminal workflow, startup recovery must:

1. load current state and last committed audit sequence;
2. identify attempts left `RUNNING`;
3. mark unverifiable live worker state interrupted;
4. inspect current candidate generation and digest;
5. reconcile repository/base identity;
6. choose the same phase, a safe earlier phase, or `BLOCKED` based on explicit
   recovery rules;
7. persist the recovery decision before dispatching more work.

The last model response is never the recovery algorithm.

## M1 Required State-Machine Proof

M1 must include tests that prove:

- every documented legal transition succeeds when its guards are satisfied;
- representative direct jumps are rejected;
- a stale `expectedVersion` cannot mutate state;
- a worker Completion Request cannot enter `CLOSEOUT`;
- `FINAL_VERIFY -> CLOSEOUT` fails without current `ACCEPT`;
- a mismatched Acceptance Input Manifest fails;
- restart preserves phase and aggregate version;
- state and audit event commit or roll back together;
- cancellation cannot be rendered as success.
