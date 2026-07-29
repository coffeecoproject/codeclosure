# ADR 0023: Activate SQLite authority through a verified isolation bootstrap

- Status: Accepted
- Date: 2026-07-29

## Context

ADR 0021 requires the CodeClosure application-data home to remain outside every
target project and worker-writable Candidate and requires resolved filesystem
isolation before authority is opened. ADR 0020 separately requires trusted
composition to open and migrate the Store, perform startup recovery, and only
then publish handler capabilities.

`goal create` supplies its project path, but later public commands intentionally
operate only by `GoalId`. Their project paths are retained in SQLite. Opening the
current `SqliteControlStore` merely to discover those paths is unsafe because
its existing open path may change journal mode, apply migrations, and validate
retained authority only after those writes. Performing a separate read-only
query and later reopening the Store also leaves a check/use window in which the
database, a retained project binding, or a filesystem identity may change.

This is a bootstrap ordering problem, not a reason to add project arguments to
Goal commands or duplicate authority in a sidecar index.

## Decision

### One guarded activation lifecycle

Production local composition MUST use a verified SQLite activation entry point.
The raw Store opener remains available only to Store-level tests and migration
fixtures; the CLI composition boundary MUST reject use of that raw opener.

The verified entry point owns one unactivated SQLite handle from inspection
through Store construction. An unactivated handle is an internal persistence
resource: it MUST NOT be returned as a Store, passed to Runtime, used by a CLI
handler, or used to mutate CodeClosure authority.

For a filesystem database, activation performs this order:

1. require an already prepared, absolute database file rather than creating a
   parent directory inside the Store adapter;
2. configure only non-mutating connection safety settings and acquire a bounded
   SQLite writer reservation;
3. enable SQLite `query_only` enforcement before inspecting retained content;
4. strictly decode an isolation snapshot containing every retained Goal ID and
   project-path reference, or recognize an exactly empty new database;
5. ask the trusted filesystem isolation verifier to resolve the data home,
   database, explicit invocation roots, and every retained project reference;
6. revalidate the resulting isolation lease while the writer reservation is
   still held;
7. disable `query_only`, apply migrations, construct the Store, run all retained
   authority validation, and compare the post-migration decoded Goal/project
   bindings with the pre-migration snapshot inside that same transaction;
8. revalidate the isolation lease again and commit only when every check
   succeeds; and
9. apply remaining verified storage configuration, recheck the exact file and
   isolation lease, and only then return the active Store.

Any failure before the activation transaction commits MUST roll back migrations
and retained-state changes and close the handle. A failure after an already
successful, isolation-verified migration may prevent Store publication, but it
MUST NOT convert partial state into handler capability.

Acquiring a writer reservation is serialization, not an authoritative
transition. No schema creation, migration, journal-mode change, policy/profile
installation, recovery mutation, or public Store capability may precede the
first successful isolation verification.

### Isolation snapshots deny; they do not authorize

Pre-migration Goal/project rows are untrusted bootstrap input. They MAY add
paths that composition must exclude, but they MUST NOT establish Goal status,
Workflow phase, recovery safety, completion, or any other control authority.
Those meanings remain owned by the fully decoded Store and Runtime.

The bootstrap accepts only an exactly empty database or a recognizable M1
database shape containing the migration ledger and Goal table. Missing,
malformed, duplicated, unknown, or unsupported bootstrap state fails closed
before migration.

All retained Goal project references are inspected, not merely the Goal named
by the current command, because startup recovery is Store-wide. The verified
snapshot is compared with fully decoded post-migration bindings before commit;
a migration MUST NOT silently rewrite project identity.

### Filesystem isolation lease

The CLI composition layer owns filesystem interpretation. Its verifier returns
a short-lived isolation lease that binds:

- the normalized and resolved data-home identity;
- the exact `state.sqlite` file identity and safe ownership/permission shape;
- every explicit project or Candidate root known from the current invocation;
  and
- every retained Goal project reference supplied by the bootstrap snapshot.

An existing protected path binds its resolved path and filesystem identity. A
temporarily missing project MAY bind a planned path through its nearest existing
resolved ancestor so status and recovery can report project unavailability; if
that relationship cannot be resolved or changes during activation, composition
fails closed. This does not authorize work against the missing project.

The verifier is a denial boundary only. It cannot write Store state, declare a
recovery disposition, or issue Acceptance. M1 Candidate identities remain
logical deterministic identities and MUST NOT be reinterpreted as filesystem
paths. Named demos may supply explicit run-owned roots.

### New Goal admission remains bound to the check

For `goal create` and named demos, the normalized project path is known before
trusted composition activates the Store. That exact path MUST participate in
the initial isolation lease and MUST match the path later submitted to
`CreateGoal`. A different path requires a new verified invocation; an already
published facade is not a general bypass for unchecked project admission.

Goal-ID commands retain the ADR 0021 command surface and do not acquire a
`--project` option.

### Publication order remains unchanged

After verified Store activation, trusted composition installs and validates the
built-in Policy and Execution Profiles, constructs Runtime adapters, performs
startup recovery, and only then publishes the narrow application facade. CLI
handlers still receive neither SQLite nor the internal Workflow kernel.

## Consequences

- Isolation, migration, retained-authority validation, and capability
  publication have one explicit bootstrap order.
- Existing Goal-ID commands remain usable without asking the user to reconstruct
  project identity.
- SQLite remains the only authoritative current-state store; no sidecar index or
  second project registry is introduced.
- Migration code gains a transaction-owned core so verified activation can
  include migration in its wider bootstrap transaction.
- Store unit tests may continue to use the raw opener, while source-boundary
  gates make that path unavailable to production CLI composition.
- Missing projects can become typed recovery blockers without weakening
  data-home containment checks.

This ADR refines ADR 0004, ADR 0013, ADR 0020, and ADR 0021. It does not change
Workflow, Acceptance, Goal, recovery, or migration authority ownership.

## Rejected alternatives

- **Open and migrate the Store before checking retained project paths.**
  Rejected because an unsafe authority location could be modified before the
  required isolation decision.
- **Use one read-only connection, close it, and later open the Store.** Rejected
  because database and filesystem identities can change between check and use.
- **Require `--project` on every Goal command.** Rejected because it changes the
  accepted public Goal boundary and lets callers restate durable identity.
- **Maintain a Goal-to-project sidecar.** Rejected because it creates another
  authority, synchronization transaction, and recovery problem.
- **Let CLI handlers query SQLite directly.** Rejected because presentation code
  would gain raw Store capability and duplicate persistence decoding.
- **Treat M1 logical Candidate identities as paths.** Rejected because M1 has no
  real Candidate workspace and such inference would manufacture filesystem
  authority.

## Validation

M1 tests MUST prove:

- an unsafe explicit or retained project overlap fails before schema migration,
  policy/profile installation, or startup recovery;
- malformed and unknown bootstrap schemas fail without database mutation;
- the exact database, data-home, existing-project, and planned-project identities
  are rechecked and replacement is rejected;
- concurrent SQLite writers cannot change retained project bindings between
  inspection and migration;
- a migration that changes a retained project binding rolls back atomically;
- post-migration Store decoding and retained-authority validation complete before
  activation commits;
- verified production composition cannot import or invoke the raw Store opener;
- a missing but resolvable project may open only far enough for Runtime recovery
  to record or expose its unavailable state; and
- startup recovery still precedes publication of every CLI handler capability.
