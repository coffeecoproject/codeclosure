# ADR 0040: Move local execution ownership into one attachable Runtime Host

- Status: Proposed
- Date: 2026-08-06

## Context

Proposed M2.6 keeps the Frontstage Coordinator and one launched Goal task in
the foreground CLI process. That proves a persistent interaction loop while
the CLI is alive, but cannot promise that Goal execution continues after the
CLI exits. Treating CLI shutdown as cancellation would also confuse process
lifecycle with user intent.

Providing detach/reconnect requires a durable owner outside the visible client,
plus exact single-owner startup, Store activation, local transport, process
identity, compatibility, shutdown, and recovery rules. A background Codex
Thread is not that owner and cannot replace the Runtime.

## Decision

### Introduce one deterministic local Runtime Host

M2.7 will run the M2.6 Interaction Coordinator, public Goal/Intake facades,
Workflow driver, and existing external-execution coordination inside one local
Runtime Host. The Host is deterministic application infrastructure and receives
no new Goal, Workflow, Admission, Acceptance, or external-effect decision
authority.

One authority home has at most one active Host. Trusted bootstrap binds an
OS-owned exclusive lock/control endpoint to a durable `RuntimeHostRecord`,
monotonic `HostEpoch`, executable/configuration identity, Runtime-issued launch
nonce, and exact process identity. A missing PID or elapsed timeout alone is
not proof that another process may take ownership.

Before becoming `ACTIVE`, a Host must:

1. prove it may own the exact authority home;
2. activate and migrate SQLite through ADR 0023's verified bootstrap;
3. strictly reopen all retained authority;
4. reconcile incomplete M2.6 Interaction operations;
5. complete existing Goal/Workflow/Candidate/external-execution recovery; and
6. atomically publish its higher Host Epoch and compatible control endpoint.

Ambiguous owner/process identity, incompatible configuration, corrupt Store,
or failed recovery leaves the Host unpublished and fails closed.

### Make CLI a local attached client

The supported M2.7 CLI uses a versioned bounded local control transport. It
attaches to the compatible active Host or asks trusted bootstrap to start one.
The transport exposes only public interaction, query, and command DTOs; it
cannot serialize Store ports, the Workflow kernel, Candidate leases, Worker
ports, or backend protocol objects.

The endpoint lives under the verified authority home with local-principal-only
access and binds the exact Host identity/epoch during handshake. Messages have
closed framing, schema versions, byte limits, request IDs, deadlines, and typed
failure results. Endpoint presence, a successful connection, or a claimed PID
does not prove Host identity.

### Separate client detach from Host and Goal lifecycle

Closing a CLI releases only that client's control lease and transport. It does
not issue `CancelGoal`, stop the Host, release a project execution slot,
interrupt an owned Worker, or change Goal/Workflow state. While the Host remains
alive, it continues existing Runtime-owned execution.

Stopping the Host is a separate explicit operator action. Graceful Host
shutdown drains clients and Frontstage operations, reaches bounded persisted
Runtime interruption boundaries, records Host disposition, and releases its
endpoint/lock. Host crash or forced termination requires a later exact bootstrap
and reconciliation; it is not user cancellation or technical completion.

### Preserve existing external-execution recovery

The Host cannot adopt a process merely because it appears related. Recovery
uses the exact Runtime-issued launch nonce, process identity, dispatch claim,
ExternalExecutionRecord, Candidate lease, and existing reconciliation rules.
Only a matching owned process group may be terminated or reconciled. Missing
or ambiguous identity remains blocked and cannot be redispatched.

## Consequences

- A foreground CLI can detach while the active Host continues the current Goal.
- Reopening the CLI reconnects to Runtime-owned state instead of reconstructing
  it from conversation or model history.
- Host lifecycle adds local IPC, single-owner bootstrap, epoch, compatibility,
  shutdown, and crash-recovery implementation work.
- M2.6 remains valid as the prior foreground-only milestone.
- A live Host is availability infrastructure, not a completion or scheduling
  authority.

## Rejected alternatives

- **Keep the CLI process as owner while claiming detached execution.** Rejected
  because no process remains to own execution after exit.
- **Treat CLI exit as `CancelGoal`.** Rejected because process lifecycle is not
  exact user cancellation intent.
- **Use a Codex Thread as the background controller.** Rejected because Thread
  state is backend execution detail and cannot own Runtime authority.
- **Allow every CLI to open the Store and become a Host.** Rejected because
  this creates competing recovery/orchestration owners.
- **Take over when a PID is absent or a heartbeat is late.** Rejected because
  process identity may be stale, reused, or ambiguous.
- **Adopt any surviving Worker process after restart.** Rejected because only
  exact retained execution authority may identify owned work.

## Validation

M2.7 tests must prove:

- two concurrent Host starters produce one exact owner and a typed loser;
- endpoint spoofing, stale Host Epoch, PID reuse, lock mismatch, incompatible
  executable/configuration, and corrupt authority fail closed;
- the Host publishes no client capability before activation and recovery
  complete;
- local transport rejects malformed, oversized, stale, unauthenticated, and
  backend-protocol-bearing messages;
- normal CLI detach issues no Goal command and active execution continues while
  the Host is alive;
- graceful Host stop and abrupt Host death are distinct and neither becomes
  `CancelGoal` or `ACCEPT`;
- restart never adopts or redispatches an unproven/consumed process claim; and
- M1, M2, M2.5, and M2.6 regression boundaries remain green.
