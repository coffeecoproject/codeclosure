# ADR 0030: Add a versioned real local-command verification contract

- Status: Accepted
- Date: 2026-07-30

## Context

M1 intentionally supports only `FAKE_VERIFICATION`, an `M1_LOGICAL`
environment identity, and small logical payloads. M2 must run one independent
real check against an exact frozen Candidate without interpreting a Worker tool
transcript as Evidence or silently reusing the M1 fake discriminator.

A real process adds executable identity, argv, environment, filesystem and
network containment, timeout, signal, output, truncation, payload-retention,
and mutation concerns. Its observation also crosses a non-authoritative adapter
boundary before the Runtime creates Evidence.

## Decision

### Preserve M1 and add explicit version-2 variants

Existing schema-version-1 `CheckSpecification`, `VerificationRequest`,
`VerificationResult`, `EvidenceEnvironmentIdentity`, and Evidence records keep
their exact meaning and digests. M2 adds closed variants; it does not reinterpret
or rehash any M1 row.

The new Check discriminator is `LOCAL_COMMAND`. Its version-2 canonical shape
binds:

- Check ID/version, producer `VERIFICATION_RUNNER`, and exact runner
  identity/version;
- executable realpath, executable content digest, and declared tool version;
- argv as an ordered string array with no shell command string;
- frozen Candidate ID/digest and read-only workspace-lease digest;
- cwd as a contained repository-relative path;
- environment inheritance `NONE`, sorted allowed variables, and environment
  digest;
- verification-isolation profile ID/digest with Candidate read-only,
  authority/credential unreadable, and network disabled;
- timeout, termination grace, stdout limit, stderr limit, total output limit,
  and payload-retention limit;
- accepted exit-code set and cleanup policy; and
- expected observation schema `LOCAL_COMMAND_OBSERVATION_V1`.

The application request repeats the current Goal revision, Workflow/version,
Attempt, Candidate and lease, Policy, obligation, Check, runner, and environment
bindings. The runner cannot select or replace any of them.

### Return observations, not Evidence or decisions

`LocalCommandVerificationResult` is untrusted boundary data. It may contain
only:

- schema version and observation discriminator;
- termination kind `EXITED`, `SIGNALED`, `TIMED_OUT`, or `SPAWN_FAILED`;
- exit code or signal where that termination kind permits it;
- bounded stdout and stderr byte sequences plus observed byte counts and
  truncation flags; and
- one closed runner diagnostic code.

It cannot provide Runtime command/event identity, authoritative timestamps,
Candidate or Check identity, digests, payload references, Evidence status,
eligibility, Acceptance, repair, or closeout.

The Runtime records invocation start/end around the port, strictly decodes the
result, computes stream and observation digests, maps the exact termination and
accepted-exit policy to an Evidence result, and creates the immutable Evidence
record. `PASS`, `FAIL`, `RUNNER_ERROR`, and `TIMEOUT` remain observations; none
can approve itself.

### Keep verification independent and read-only

The local verifier launches the exact executable directly with ordered argv;
it never invokes a shell. It receives no Worker, Store, Workflow mutation,
Candidate writer, or network capability. A platform-specific outer
`VerificationIsolationPort` must enforce the bound profile. The initial Darwin
profile uses a versioned Seatbelt policy and is supported only after black-box
proof that it permits the exact tool/Candidate reads while denying Candidate
writes, authority/credential reads, and network. An unavailable or
unenforceable profile is `UNSUPPORTED` and blocks M2 verification.

The Runtime hashes the frozen Candidate immediately before and after process
execution. A difference invalidates affected Evidence and fails the Attempt
even when the command returned an accepted exit code. Run-owned temporary
output lives outside the Candidate and authority database, has an exact owned
root, and is cleaned only by the same contained cleanup rules.

### Store bounded payloads atomically for M2

M2 adds an immutable SQLite content-addressed `evidence_payloads` table for
bounded stdout/stderr payload bytes. Its key is the Runtime-computed SHA-256
digest plus byte length. Payload insertion, Evidence record, initial
eligibility, Attempt/Workflow effect, audit, and processed-command outcome use
one SQLite transaction. A digest collision or existing row with other bytes is
an integrity failure.

The version-2 `LOCAL_COMMAND_TEST_RESULT` Evidence variant binds:

- the version-2 Check and exact Verification Obligation;
- `LOCAL_COMMAND_ENVIRONMENT_V1` identity and digest;
- frozen Candidate and read-only lease identities;
- normalized termination/exit/signal/truncation observation;
- stdout/stderr payload references and sizes; and
- the existing Policy, time, observation, record, and eligibility authority.

Output is local sensitive data. It is bounded, omitted from normal CLI/status
views, never sent back to the Worker as authority, and retained only under the
Evidence retention policy. The bounded M2 fixtures contain no secrets. General
secret redaction and arbitrary-project retention are not claimed by M2.

The Slice 4 migration is additive. It introduces the new discriminators,
payload table, and relationship/trigger checks while preserving strict decode
and replay of every M1 version-1 row. Migration or reopen fails rather than
guessing a variant.

## Consequences

- Real verification cannot masquerade as the M1 fake runner.
- Command construction is injection-resistant because argv is not a shell
  string.
- Evidence payload bytes and their authoritative references commit together in
  the bounded SQLite design.
- A passing process exit remains insufficient when Candidate, environment,
  Check, obligation, payload, or post-run integrity differs.
- Slice 4 owns the codecs, migration, platform isolation, payload persistence,
  runner, and adversarial tests.

## Rejected alternatives

- **Parse Codex command Items as Evidence.** Rejected because the Worker and its
  backend cannot verify themselves.
- **Extend `FAKE_VERIFICATION` with optional real fields.** Rejected because it
  would blur existing digest and migration semantics.
- **Persist only exit code and path existence.** Rejected because neither binds
  the exact command, environment, output, or Candidate observation.
- **Use a shell command string.** Rejected because quoting and interpolation
  become an unbounded input language.
- **Let the runner write Evidence or Store payloads.** Rejected because it would
  grant a verifier mutation authority and make state/audit atomicity
  unverifiable.
- **Run without an enforceable network/write sandbox and rely only on rehash.**
  Rejected because detection after mutation is not the same as least privilege,
  and network effects may be irreversible.

## Validation

M2 tests MUST prove:

- exact executable/argv/cwd/environment/lease/isolation binding and no shell;
- Candidate writes, authority/credential reads, and network are denied;
- timeout, signal, spawn failure, nonzero exit, output overflow, truncation,
  malformed output, and adapter exceptions map to closed outcomes;
- pre/post Candidate mutation invalidates Evidence even after exit zero;
- payload bytes, digests, Evidence, eligibility, audit, and outcome commit or
  roll back together;
- fake and real variants cannot decode or satisfy each other's obligations;
- stale Candidate, Check, runner, environment, payload, or Evidence cannot
  satisfy Acceptance; and
- strict migration/reopen preserves all M1 version-1 digests unchanged.
