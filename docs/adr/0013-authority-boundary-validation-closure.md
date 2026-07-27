# ADR 0013: Close authority validation across Runtime and persistence

- Status: Accepted
- Date: 2026-07-27

## Context

M1 already assigns each control mutation to one authority, validates selected
domain transitions, decodes persisted rows, and adds SQLite backstops. Those
checks do not yet form one closed contract.

TypeScript brands and port return annotations disappear at runtime. A value can
therefore satisfy a compile-time `Sha256Digest`, identifier, timestamp, or
aggregate type while carrying an invalid runtime representation. The early M1
Store accepted some such values and returned `APPLIED`, while its stricter read
decoder later rejected the same processed-command, audit, Workflow, or Attempt
record. Restart then exposed corruption that the committing transaction had
already reported as successful.

The Runtime also resolved Goal/Workflow authority differently for normal Goal
commands, normal Workflow commands, and replay. A Store implementation or test
double could consequently return a relationship that one path rejected and
another path accepted. State-tagged records had a related risk when optional
fields could describe a shape that was impossible for the named state.

These are not separate ownership decisions. They are one missing closure rule:
data admitted as authority must remain valid through every supported write,
read, replay, adapter, and restart path.

## Decision

### Runtime types are not boundary proof

A TypeScript type, interface, brand, generic constraint, or adapter return
annotation MUST NOT be treated as runtime validation.

Every value crossing into or back into an authority-bearing path MUST pass its
owning runtime decoder. This includes:

- application and worker request data at their owning adapter boundary;
- Clock, identifier-generator, digest-provider, evaluator, and Store returns;
- current aggregate snapshots and domain events supplied to a Store mutation;
- processed-command, audit, and current-state records loaded from persistence;
- migration preflight data that will retain authoritative meaning.

Malformed port output is an infrastructure failure owned by that boundary. It
MUST NOT be converted into a deterministic domain rejection or persisted
command outcome.

### One owning codec and one semantic invariant

Each authority-bearing record has one owning codec contract. The codec:

1. accepts `unknown` at a boundary;
2. rejects unknown fields and unknown enum variants where the record is closed;
3. validates and materializes every branded scalar through its canonical
   parser;
4. validates state-specific field presence and absence;
5. invokes the record's semantic invariant;
6. returns an immutable canonical domain value.

Adapter row schemas MAY validate storage-column shape, but after materializing
a record they MUST delegate to the owning codec rather than reimplementing a
second domain snapshot definition. Pure reducers continue to use semantic
invariants for current and resulting typed state; an invariant is not a
substitute for decoding unknown boundary data.

State-tagged records SHOULD use discriminated unions when fields are required
or forbidden by state. In particular, a frozen or accepted Candidate
generation cannot be represented without its exact frozen identity.

### Persistence round-trip closure

A control Store may return `APPLIED` only if every authority record written by
that transaction satisfies its owning codec.

For each supported mutation, the following property is normative:

```text
APPLIED
  => resulting current state decodes
  => audit record(s) decode
  => processed-command outcome decodes and remains correctly bound
  => the same records decode after close and reopen
```

The Store validates mutation input and resulting state before persistence.
SQLite mirrors critical, representable scalar, relationship, lifecycle, and
causal constraints as defense in depth. A migration that introduces a stronger
authority rule MUST preflight retained rows and fail closed without partial
schema application; it MUST NOT silently normalize or invent historical
authority.

### One Goal/Workflow authority resolver

Normal command admission and command replay use the same authority-resolution
semantics for both target variants. Resolution proves:

- the Goal and Workflow both exist;
- the Workflow owns that exact Goal;
- the Workflow binds the current Goal revision;
- Goal lifecycle status equals the Workflow run-status projection;
- a Workflow target names that exact Workflow;
- both records pass their owning codecs.

Normal execution may map a genuinely missing target to `NOT_FOUND`. Replay
maps missing, malformed, or mismatched authority to replay-integrity failure.
Those different public outcomes do not permit different relationship checks.

### Adapter contract proof

Every implementation of the control Store port, including in-memory test
doubles, MUST pass a shared behavioral contract for authority resolution,
conflicts, Store-authored outcomes, and invalid input. SQLite additionally runs
transaction, migration, immediate-read, and reopen tests.

Property and mutation tests cover the negative space of every closed record:
each branded scalar, enum, state-specific field, port output, and authority
relationship is poisoned independently. A collection of valid fixtures alone
does not prove boundary closure.

This ADR refines ADR 0004, ADR 0006, ADR 0008, ADR 0010, ADR 0011, and ADR 0012.
It does not change workflow ownership, acceptance ownership, idempotency
meaning, timestamp ordering, or canonical digest profiles.

## Consequences

- A successful transaction cannot defer discovery of malformed authority until
  status rendering or restart.
- Runtime, SQLite, and test Store implementations share observable authority
  semantics even when their internal representations differ.
- Adding a field to an authority record requires updating its owning codec,
  Store mapping, SQL backstop where applicable, and contract matrix together.
- Boundary decoding adds deliberate validation work, but it removes scattered
  type assertions and repeated partial checks.
- Existing development databases containing rows that fail the stronger
  contract require inspection and deliberate reset or remediation.
- ADR 0006's RFC 8785 and named-projection work remains required. Validating a
  digest string establishes representation only; it does not prove that the
  correct canonical projection was hashed.

## Rejected alternatives

- **Trust internal ports because they are typed.** Rejected because adapters,
  JavaScript callers, unsafe casts, test doubles, and implementation defects
  are not constrained by erased TypeScript types.
- **Validate only when reading SQLite.** Rejected because it permits `APPLIED`
  to create state that fails during recovery.
- **Add one check for each discovered defect.** Rejected because write, read,
  replay, and alternative-Store paths would continue to drift.
- **Make SQLite the only domain validator.** Rejected because reducers and
  replaceable Store adapters must preserve the same authority semantics.
- **Silently repair malformed historical rows.** Rejected because normalization
  can manufacture identity or chronology that the retained record never proved.

## Validation

M1 tests MUST prove:

- malformed Clock, ID-generator, digest-provider, evaluator, and Store returns
  fail before an admitted command outcome is persisted;
- every Store `APPLIED` path immediately reads and reopens all records written
  by the transaction;
- Store write inputs and persistence reads use the same Goal, Workflow,
  Attempt, Candidate, capability, event, audit, and processed-command rules;
- normal Goal commands, normal Workflow commands, and replay reject the same
  malformed or mismatched Goal/Workflow relationships;
- each control Store implementation passes the shared port contract;
- state/field mutation matrices reject impossible Workflow, Attempt, and
  Candidate snapshots;
- SQLite rejects bypassed malformed scalar representations and relationship
  violations covered by its schema;
- the strengthening migration refuses poisoned retained rows atomically.
