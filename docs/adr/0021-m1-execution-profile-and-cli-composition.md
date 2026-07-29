# ADR 0021: Bind M1 execution profiles and define local CLI composition

- Status: Accepted
- Date: 2026-07-28

## Context

The Slice 7 CLI needs several product-level contracts that were intentionally
deferred while the control mechanisms were built.

First, the documented `goal create` syntax contains only an objective and
project path even though CodeClosure invariants require at least one required
success criterion. Silently copying the objective into a criterion would
invent acceptance meaning that the user did not state.

Second, `goal start --fixture` currently selects an in-process FakeWorker, but
the selected Worker, Candidate Source, and Verification Runner behavior is not
bound to durable Workflow authority. A new process running `goal resume` has no
safe way to reconstruct the same M1 execution environment. Asking the user to
choose another fixture on resume would permit silent behavior substitution.

Third, the exact local application-data contract, production clock/identity
providers, JSON envelope behavior, and exit-code meaning must be fixed before
the CLI becomes a real product entry. Those choices must preserve the rule that
authoritative state lives outside both the project and worker-writable
candidate.

## Decision

### Goal creation requires explicit criteria

The M1 public creation command is:

```text
codeclosure goal create --objective <text> --project <path> \
  --criterion <text> [--criterion <text> ...] [--json]
```

At least one `--criterion` is required. Every criterion created by the M1 CLI
is required; optional-criterion editing is deferred until a Goal-revision
surface exists. The CLI and Runtime reject blank criteria and do not derive a
criterion from the objective, fixture, Worker output, or project path. Named
demos provide their own explicit deterministic criteria.

The CLI accepts an absolute or relative `--project` operand and resolves a
relative operand exactly once against that invocation's working directory. The
Runtime creation request and persisted Goal MUST contain the resulting
normalized absolute path, so later processes never reinterpret project
identity against a different working directory.

M1 has no real source-edit capability, so ordinary CLI creation records an
empty allowed-path set unless a later accepted interface adds explicit scope
flags. Empty means no real project write authorization; it is not an implicit
whole-repository grant.

### Installed and Workflow-bound execution profiles

An `ExecutionProfile` is immutable, versioned, and canonically digested. It
identifies the closed M1 composition needed to reproduce execution behavior,
including Worker, Candidate Source, Verification Runner, and Runtime driver
profile versions. It contains identifiers and non-secret configuration only;
credentials, process handles, and executable capabilities are never persisted
inside it.

The trusted composition module installs the built-in M1 profile definitions.
Runtime and Store independently validate their canonical identity, and the
Store persists each installed profile with an audit event. A Workflow acquires
one immutable `ExecutionProfileBinding` when its first `StartGoal` commits. The
binding records the exact profile ID, version, digest, Goal/Workflow identity,
start command, and binding time.

Installation is idempotent only for the exact existing canonical profile: the
Store returns that profile with its original installation authority and does
not append another installation audit. Reusing an ID or digest for different
content fails closed. This lets every short-lived CLI process validate the
built-in registry without rewriting history.

The Start command digest, first Context-bound Attempt, Context Manifest, and
Worker dispatch claim MUST bind the selected profile ID and digest. Later
Worker, Candidate Source, Verification Runner, recovery, and driver operations
resolve the same Workflow binding. Rebinding a started Workflow or supplying a
different profile to a replayed Start fails closed.

The CLI `--fixture <name>` is an M1 alias for one installed execution profile.
If omitted, it selects the versioned built-in `happy-path` profile. The exact
selected profile is returned in the status view. `goal resume` has no fixture
override: it loads the immutable Workflow binding, and a missing or
code-incompatible profile leaves the Goal blocked rather than selecting a new
one.

### Legacy development database migration

Pre-Slice-7 databases may contain started Workflow, Attempt, Context, dispatch,
Candidate, Evidence, Acceptance, or closeout history without an Execution
Profile binding. Migration MUST NOT assign `happy-path`, derive a fixture from
retained rows, or create a synthetic historical binding.

The Slice 7 profile migration MAY upgrade a database whose Workflows have never
started. Those Workflows acquire a real binding on their first future
`StartGoal`. If any retained authority proves that execution already started,
the migration MUST fail atomically with a specific legacy-unbound-authority
error. It leaves the original database unchanged so an operator can preserve
or inspect it and use a separate new application home. CodeClosure does not
delete, rewrite, or silently archive that database.

M1 is still in development and has no released persistence-compatibility
commitment. Supporting executable `legacy-unbound` history would add a second
authority model and is therefore outside Slice 7.

Named `demo run` scenarios are proof recipes, not extra Workflow authorities.
They use installed profiles plus the narrow Runtime application/demo
capability to exercise an expected path. A scenario may prove that a withheld,
malformed, stale, failing, or drifting input is rejected, but it cannot weaken
the phase guards or write state directly.

### Local application-data home

The CLI application, not the domain or worker, resolves the CodeClosure data
home. The defaults are:

- macOS: `$HOME/Library/Application Support/CodeClosure`;
- Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/codeclosure`;
- Windows: `%LOCALAPPDATA%\CodeClosure`.

`CODECLOSURE_HOME` is an optional explicit override for tests, controlled
automation, and operators. When present it MUST be an absolute path. The CLI
does not require the variable and otherwise uses the platform default.

The resolved home contains `state.sqlite` and future CodeClosure-owned audit,
evidence, policy, and workspace locations. It MUST NOT be the target project,
be nested beneath the target project, or be inside a candidate workspace. On
platforms with owner permission bits, the application creates the directory
owner-only and fails closed when the authority location cannot be safely
created or opened.

Isolation checks MUST compare normalized, resolved filesystem identities and
path ancestry rather than textual prefixes. Existing symbolic links, aliases,
case behavior, and the nearest existing ancestor of a not-yet-created home
must be resolved before authority is opened. An ambiguous, changed, or
unresolvable relationship fails closed.

CLI and subprocess tests inject an explicit temporary application home. Named
demos use a run-owned isolated home so they neither read nor mutate ordinary
user authority. The Store may still use `:memory:` only in tests that do not
claim restart persistence.

### Production time and identity

The trusted composition module supplies a UTC system clock and a
cryptographically random, collision-resistant identity generator. Every value
still passes the existing branded identifier and timestamp codecs before use.
Domain code does not read process globals, wall time, randomness, or the
filesystem. Deterministic clocks and identifiers remain injectable test
fixtures and are not reused as a cross-process production sequence.

### CLI envelopes and exit meaning

Human and JSON output are renderings of the same Runtime command or read view.
JSON mode writes exactly one schema-versioned JSON document to stdout, emits no
ANSI formatting, and sends operational diagnostics to stderr. A CLI envelope
may contain a stored command output and a current status view, but it MUST NOT
rewrite the stored command outcome into Acceptance or closeout authority.

M1 reserves these exit classifications:

| Exit | Meaning |
| --- | --- |
| `0` | The CLI operation itself completed successfully. A status/audit read may still describe a blocked Goal. An adversarial demo uses `0` only when its expected fail-closed assertion passed. |
| `2` | CLI usage or unadmitted input validation failed. |
| `3` | An admitted command was deterministically rejected, stale, or conflicted. |
| `4` | Start/resume applied, but controlled execution stopped in `WAITING_FOR_INPUT`, `BLOCKED`, `FAILED`, or `CANCELLED` before the requested progress boundary. |
| `5` | Persistence, evaluation, composition, or Runtime internal failure prevented a trustworthy result. |

An applied `goal cancel` returns `0` even though cancellation is not success;
the operation requested cancellation and the resulting view remains explicitly
`CANCELLED`. A successful status query over `BLOCKED` also returns `0` because
the query succeeded. Only exact current closeout authority may render
`technicalCloseout: true`.

## Consequences

- Goal creation cannot acquire a vacuous or invented acceptance boundary.
- Restart and resume select the same exact M1 execution behavior without user
  reconstruction or silent fixture substitution.
- Fixture terminology remains at the M1 composition edge rather than leaking
  FakeWorker types into core Goal or Workflow semantics.
- Production IDs do not collide merely because separate CLI processes restart
  a deterministic counter.
- Normal state is outside source and candidate trees, while tests and demos are
  isolated from user authority.
- Scripts can distinguish usage, deterministic control rejection, governed
  blocking, and infrastructure failure without treating any of them as
  Acceptance.
- The platform-path implementation library remains replaceable; the path and
  safety behavior in this ADR is the contract.

## Rejected alternatives

- **Use the objective as an implicit required criterion.** Rejected because it
  invents a verification statement instead of recording user intent.
- **Pass `--fixture` again to `goal resume`.** Rejected because the caller could
  substitute execution behavior after state and Candidate authority exist.
- **Persist FakeWorker enum values directly on Goal.** Rejected because testing
  vocabulary is not durable product-domain identity.
- **Choose a fixture from the Goal ID or last Attempt text.** Rejected because
  neither is an execution-profile authority.
- **Store state under `.codeclosure/` in the project.** Rejected because project
  and candidate write access could reach control authority.
- **Use deterministic test IDs for the real CLI.** Rejected because independent
  processes would reuse identities.
- **Return zero for every schema-valid command.** Rejected because automation
  could not distinguish governed blocking from requested progress.

## Validation

M1 tests MUST prove criterion and project-path normalization, exact idempotent
profile installation/binding, profile mismatch and reopen failure, restart
selection of the same profile, Context and dispatch profile causality,
platform-default and absolute-override resolution, resolved project/candidate
overlap and symbolic-link rejection, cross-process identity uniqueness, strict
JSON rendering, stderr separation, every exit classification, atomic refusal of
legacy started authority without database mutation, upgrade of unstarted
authority, and adversarial-demo success only when its expected final authority
is present.
