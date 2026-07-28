# ADR 0017: Derive boundary authority and replay Evidence Sets by audit sequence

- Status: Accepted
- Date: 2026-07-28

## Context

The Slice 4 and Slice 5 control paths established strict Worker, Candidate, and
Evidence boundaries, but several values still had more than one apparent
author:

- a Worker failure event could previously choose an Attempt failure class as
  well as report its reason;
- a Candidate Source preparation could supply project and workspace identity
  even though CodeClosure owns Candidate identity;
- an Evidence producer could repeat producer, environment, payload, and status
  fields that the Check Specification or typed observation already determines;
  and
- a persisted Evidence Set was selected from current authority, but reopen did
  not reconstruct the exact eligibility state that existed when the set was
  recorded.

These are authority-duplication problems. Field equality checks at one call
site would leave another caller, Store boundary, retained row, or SQLite write
able to present a different interpretation.

## Decision

### Map Worker reasons to failure classes inside CodeClosure

A Worker failure event reports only a closed `reasonCode`. A Worker cannot
choose an `AttemptFailureClass`.

M1 has one exhaustive Runtime-owned mapping:

| Reason | Attempt failure class |
| --- | --- |
| `WORKER_BACKEND_FAILURE` | `TRANSIENT_BACKEND` |
| `WORKER_PORT_INVOCATION_FAILED` | `ABRUPT_TERMINATION` |
| `WORKER_PORT_NON_ASYNC_STREAM` | `PROTOCOL_ERROR` |
| `WORKER_STREAM_NO_TERMINAL_EVENT` | `PROTOCOL_ERROR` |
| `WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT` | `PROTOCOL_ERROR` |

The Runtime uses this mapping when constructing an Attempt event. The Store
rejects a direct caller that pairs a known Worker reason with another class,
Store startup rechecks retained Attempts, and SQLite migration 0012 plus its
update trigger enforce the same closed mapping.

The compiler-owned Worker response contract also includes `maxEventBytes`.
Event admission measures the canonical JSON bytes after strict decoding and
before semantic admission. Collection counts and individual strings remain
schema bounded as an earlier rejection layer.

### Derive Candidate identities instead of accepting them from the source port

The M1 Candidate Source preparation returns only its request bindings and
`baseDigest`. It does not return `baseProjectIdentity` or `workspaceIdentity`.

The Runtime derives:

- `baseProjectIdentity` from a canonical digest of the Goal's exact
  `projectPath`; and
- `workspaceIdentity` from the Runtime-allocated Candidate generation ID.

The Store independently derives both values during commit and reopen. SQLite
enforces the exact workspace form and the closed project-identity digest form.
The deterministic Candidate Source remains a logical M1 adapter; its fixture
labels are not authority.

### Persist producer authority in the Check Specification

Every M1 Check Specification binds `producerType` and `producerIdentity`.
Version `m1.2` fixes the two M1 producers:

- Candidate freeze -> `CANDIDATE_MANAGER` / `candidate-manager:m1`;
- fake verification -> `VERIFICATION_RUNNER` /
  `fake-verification-runner:m1`.

M1 Evidence is a strict discriminated union, not one permissive record shape:

- Candidate-freeze Evidence derives its producer, `OBSERVED` status, and sole
  payload reference from the freeze Check and change-set observation. It has no
  Verification Obligation, Fact snapshot, or environment field.
- Test-result Evidence derives its producer, result status, logical environment
  identity, and sole observation-digest payload reference from the validated
  Check and typed result. It requires one exact Verification Obligation and has
  no Fact snapshot field.

Specialized Runtime builders construct these records. A generic producer-facing
Evidence constructor is not an M1 authority surface. Domain codecs, Store
recomputation, reopen checks, and SQLite guards reject extra or inconsistent
authority fields. Verification output remains subject to the Check
Specification's byte and timeout budgets.

### Separate historical replay from current currency

An Evidence Set is built and committed only from current eligible authority.
Its recording audit event defines the historical selection boundary.

When reading or reopening a retained set, the Store:

1. requires exactly one matching `EVIDENCE_SET_RECORDED` audit and its owning
   Workflow command closure;
2. uses that audit's global sequence as the temporal cut;
3. includes only Evidence whose recording audit precedes the cut;
4. selects each Evidence eligibility version whose audit was effective at the
   cut; and
5. rebuilds the canonical Evidence Set and requires exact digest equality.

A later valid invalidation therefore does not corrupt historical truth: the old
set remains replayable as the set that was recorded then. It is not current
authority. Any new Acceptance evaluation MUST recheck the latest eligibility
and reject the old set as stale. Missing, duplicate, out-of-order, or
self-consistent-but-incomplete retained records fail reopen.

## Consequences

- External adapters report observations and closed reasons; CodeClosure authors
  their authoritative interpretation.
- One persisted Check Specification now identifies who may produce each M1
  Evidence kind.
- Candidate fixture strings cannot become project or workspace identity.
- Historical audit replay and current acceptance currency have different,
  explicit checks instead of one ambiguous "current row" lookup.
- The change remains inside M1's deterministic skeleton. It introduces no
  Codex integration, real checkout, rich UI, multi-agent execution, Acceptance
  issuer, or closeout path.

This ADR refines the Worker event and stream decisions in ADR 0014 and ADR 0015
and supersedes the Candidate fixture-identity, repeated producer-field, and
retained Evidence Set replay details in ADR 0016. All other decisions in those
records remain accepted.

## Rejected alternatives

- **Let the Worker choose a failure class and verify equality later.** Rejected
  because the untrusted party would still co-author retry and recovery policy.
- **Accept Candidate Source identities but rename them hints.** Rejected because
  persistence would still need to decide when a hint becomes identity.
- **Keep one generic Evidence builder with many optional fields.** Rejected
  because illegal M1 combinations remain representable at an authority
  boundary.
- **Validate a retained Evidence Set against only latest eligibility.** Rejected
  because a later valid invalidation would rewrite the meaning of immutable
  history.
- **Trust only the persisted Evidence Set digest during replay.** Rejected
  because a self-consistent digest cannot prove that the selected records and
  eligibility existed at the recording point.

## Validation

M1 tests MUST prove:

- Worker failure payloads containing a caller-selected class are rejected;
- every known Worker reason maps to one class at Runtime, Store, SQLite, and
  reopen boundaries;
- oversized Worker and Verification results fail before authority admission;
- Candidate Source output cannot supply project or workspace identity, and the
  Store rederives retained identity;
- M1 Check producer bindings and specialized Evidence variants reject producer,
  payload, environment, Fact, and obligation substitution;
- an Evidence Set remains historically readable after later valid invalidation
  while failing a current-currency verification; and
- post-write corruption, missing audit history, and a self-consistent but
  incomplete retained Evidence Set fail closed on reopen.
