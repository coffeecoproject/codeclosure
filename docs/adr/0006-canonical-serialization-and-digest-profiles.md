# ADR 0006: Canonical serialization and digest profiles

- Status: Accepted
- Date: 2026-07-27

## Context

Candidate, context, evidence, policy, and acceptance identities depend on exact
digests. A vague instruction such as "canonical JSON" or "RFC 8785-style" is not
enough at an authority boundary: field omission, object ordering, timestamps,
generated record IDs, and self-referential digest fields can otherwise make
equivalent inputs hash differently or make replay requirements impossible to
state precisely.

CodeClosure also needs to distinguish semantic decision equality from storage
envelope equality. A replay may occur at a different time and create a new
record ID without changing the control decision.

## Decision

M1 uses versioned, named digest projections with the following profile:

- canonical JSON bytes MUST use
  [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
  exactly, encoded as UTF-8;
- the hash algorithm is SHA-256;
- a persisted digest string uses `sha256:` followed by 64 lowercase hexadecimal
  characters;
- values entering a canonical projection MUST first pass the owning schema;
  unsupported JSON values, non-finite numbers, unsafe integers, and ambiguous
  timestamp representations are rejected;
- timestamps use RFC 3339 UTC with fixed millisecond precision
  (`YYYY-MM-DDTHH:mm:ss.sssZ`) in record envelopes, whether or not a particular
  semantic projection includes them;
- absent optional properties are omitted; `undefined` is rejected, while
  `null` is permitted only when the owning schema declares it meaningful;
- every authority-bearing digest MUST name a schema-versioned projection; code
  must not hash an arbitrary in-memory object or rely on default `JSON.stringify`
  behavior;
- a projection always excludes its own output digest field;
- governed identities such as Goal, Workflow, Candidate generation, policy, and
  checker identities are included when the record contract lists them;
- storage-only record IDs and observation timestamps are excluded only when the
  owning contract explicitly declares them envelope metadata.

The initial named projections are:

- `AcceptanceInputManifest.manifestDigest` covers all semantic fields from
  `schemaVersion` through `policyBundleDigest`; it excludes `createdAt` and
  `manifestDigest`;
- `AcceptanceDecision.decisionDigest` covers `schemaVersion`,
  `inputManifestDigest`, `policyBundleDigest`, `outcome`,
  `dominantReasonCode`, ordered `ruleResults`, and `engineVersion`; it excludes
  `id`, `issuedAt`, and `decisionDigest`;
- `PolicyBundle.digest` covers the bundle identity, schema version, all ordered
  rule/check specifications, and checker versions; it excludes `digest`;
- `ContextManifest.packageDigest` covers the exact canonical dispatch payload
  received by the worker;
- `ContextManifest.manifestDigest` covers schema/compiler versions, governed
  identities, policy/capability/response-contract digests, entries, omission
  decisions, and `packageDigest`; it excludes `id`, `createdAt`, and
  `manifestDigest`;
- `EvidenceRecord.observationDigest` covers its schema-versioned normalized typed
  observation;
- `EvidenceRecord.recordDigest` covers producer identity; governed Goal,
  Workflow, Attempt, and Candidate bindings; Fact and policy bindings; canonical
  Check Specification; environment identity; observed start/end times;
  `observationDigest`, ordered payload references, and `resultStatus`; it
  excludes `id`, `recordedAt`, and `recordDigest`;
- `EvidenceSet.digest` covers its Goal/Candidate bindings, ordered obligation
  mappings, canonical Evidence references including record digest and current
  eligibility version/state, and unresolved requirements; it excludes `digest`.

Each owning schema defines stable array ordering before serialization. A change
to a projection or canonicalization rule requires a new schema version. Existing
records retain their original schema meaning; migrations must not silently
rehash historical authority under a new profile.

Raw file, artifact, source-tree, and payload digests hash their declared byte
representation directly rather than passing bytes through JSON. Their identity
contract must still record the algorithm and representation.

A digest proves content equality under its declared profile. It is not a
signature and does not grant mutation or acceptance authority.

## Consequences

- Replaying the same acceptance inputs produces the same semantic decision
  digest even when record IDs and timestamps differ.
- Golden digest vectors become part of migration and compatibility testing.
- Domain schemas must avoid values that cannot be represented consistently by
  the selected JSON profile.
- Adapters may use different internal structures, but they must convert through
  the canonical domain schema before computing an authority-bearing digest.
- Future algorithm or projection changes require explicit versioning and
  compatibility handling.

## Rejected alternatives

- **Default JSON serialization.** Rejected because property insertion order and
  unsupported values are not a sufficient cross-boundary identity contract.
- **"RFC 8785-style" canonicalization.** Rejected because partial conformance is
  not testable or interoperable.
- **Hash full persisted rows.** Rejected because generated IDs, timestamps, and
  the digest field itself would make semantic replay unstable or self-referential.
- **Treat a digest as authorization.** Rejected because content identity does not
  establish producer trust or mutation authority.

## Validation

M1 must include:

- published RFC 8785 vectors plus repository-owned golden vectors;
- equal digests for semantically identical inputs constructed with different
  object insertion orders;
- rejection tests for unsupported values and unsafe integers;
- tests proving every projection excludes its own digest field;
- acceptance replay tests showing stable semantic decision digests across
  different record IDs and timestamps;
- schema-version tests proving a projection change cannot be interpreted as the
  old profile.
