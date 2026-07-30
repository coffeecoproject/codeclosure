# ADR 0025: Separate Worker event idempotency from current-dispatch termination

- Status: Accepted
- Date: 2026-07-30

## Context

ADR 0014 defines `WorkerEventId` as delivery identity: the same ID and payload
reuse the original receipt, while the same ID with another payload conflicts.
ADR 0015 also lets replay of a previously admitted terminal event satisfy
stream accounting.

Those rules answer two different questions:

1. has this exact delivery already been recorded; and
2. may that historical delivery terminate the dispatch being consumed now?

Treating both questions as one boolean caused an exact historical event to be
reported as an ID conflict when it was delivered during another valid
Workflow or Attempt. It also risked blaming untrusted Worker input when the
retained receipt, terminal Attempt, Context Manifest, dispatch claim, or
processed command contradicted one another. Such contradictions belong to the
control plane under ADR 0010 and ADR 0013.

## Decision

### Delivery identity is global and payload-bound

After current request and dispatch preflight succeeds, Worker replay MUST
validate the retained historical authority independently.

- The same `WorkerEventId` and exact canonical payload digest MUST return
  `DUPLICATE` with the original receipt disposition, regardless of the
  Workflow or Attempt currently consuming the delivery.
- The same `WorkerEventId` with a different canonical payload digest MUST fail
  as `WORKER_EVENT_ID_CONFLICT` and MUST NOT mutate Workflow authority.
- With an equal payload digest, disagreement between the event and duplicated
  receipt fields, or among the receipt and its retained claim, Manifest,
  terminal Attempt, or processed command, is a control-plane integrity failure.
  It MUST NOT be relabelled as untrusted Worker reuse.

The Runtime MUST compute the current request Context Package digest once for
the admission operation and pass that proven value through replay
classification. Replay MUST NOT ask a stateful dependency to establish the
same fact a second time.

### Terminal relevance is explicit

A duplicate result MUST carry an explicit `terminalForCurrentDispatch`
classification.

- An original `IGNORED` receipt is always non-terminal.
- An original `ADMITTED` receipt is terminal only when the exact historical
  admitted event is bound to the current dispatched request and its retained
  dispatch, Context, terminal Attempt, and command outcome remain exact.
- An exact admitted duplicate delivered while another Workflow or Attempt is
  being consumed remains `DUPLICATE`, but it is non-terminal for that current
  dispatch.

Worker stream coordinators MUST use `terminalForCurrentDispatch`, not the
historical receipt disposition alone, when deciding whether a stream supplied
an admitted terminal event. A non-terminal duplicate cannot keep the current
Attempt running after the stream ends; the existing explicit stream-failure
rules still apply.

## Consequences

- Delivery deduplication remains stable across Workflows and Attempts.
- Historical idempotency cannot accidentally terminate unrelated current work.
- Retained control-plane contradictions fail under the owning failure class
  instead of being blamed on the Worker.
- The public admission result becomes slightly more explicit, while no second
  completion authority is introduced.

This ADR refines ADR 0010, ADR 0013, ADR 0014, and ADR 0015. It does not change
application-command idempotency, authorize redispatch, or expand M1 beyond the
single-terminal-event Worker protocol.

## Rejected alternatives

- **Scope `WorkerEventId` uniqueness to the current Workflow.** Rejected
  because the persisted receipt table and ADR 0014 define one delivery
  identity domain, and scope inference would make replay ambiguous.
- **Treat every duplicate admitted receipt as terminal.** Rejected because an
  old Attempt's outcome cannot terminate a different current dispatch.
- **Treat every cross-dispatch duplicate as an ID conflict.** Rejected because
  equal payload proves the exact delivery was reused, not that its identity was
  reused for another payload.
- **Return Worker conflict for malformed retained replay authority.** Rejected
  because persistence and Runtime integrity are control-plane responsibilities.

## Validation

M1 tests MUST prove:

- same ID plus same payload replays as `DUPLICATE` across Attempts and
  Workflows;
- same ID plus a different payload remains `WORKER_EVENT_ID_CONFLICT`;
- an ignored duplicate and a cross-dispatch admitted duplicate are not
  terminal for current stream accounting;
- an exact current-dispatch admitted duplicate is terminal;
- a retained terminal-reason or copied-receipt contradiction is a
  control-plane failure; and
- one admission operation computes the current Context Package digest only
  once, including replay.
