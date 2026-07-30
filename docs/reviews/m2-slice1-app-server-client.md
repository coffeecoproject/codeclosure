# M2 Slice 1 App Server Client Review

- Review date: 2026-07-31
- Scope: M2 Slice 1 only
- Status: Complete
- Verdict: `PASS`; the version-bound lower client satisfies the bounded Slice 1
  exit contract and Slice 2 may begin

## Review question

This review asks whether CodeClosure has one fail-closed, version-bound Codex
App Server client that can support the later Goal-bound Worker Adapter without
importing or acquiring any CodeClosure Domain, Workflow, Candidate, Evidence,
Acceptance, or Intake authority.

It does not assess a Worker Adapter, real Candidate, real verifier, Runtime
orchestration, M2 milestone exit, Goal Intake, product completion, or authority
to merge, release, deploy, or perform another external effect.

## Authority and source identity

The review applies the repository authority order, accepted ADR 0028, the
[Slice 1 contract](../plans/m2-codex-vertical-slice.md#slice-1--version-bound-app-server-client),
and the App Server cases in the
[M2 acceptance plan](../plans/m2-acceptance-plan.md#app-server-client). Slice 0
was already committed on `main` as
`d9360a92e6720e965e541852473021c73291d11a` before Slice 1 began.

The reviewed working tree has this source identity when this review file alone
is excluded to avoid self-reference:

```text
Base Git revision: d9360a92e6720e965e541852473021c73291d11a
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 873
Source manifest digest: sha256:d60c0deab36ffa1200b0879232d0c35517d3d5d434dc6e59584a300cb954dba7
Self-referential review exclusion: docs/reviews/m2-slice1-app-server-client.md
```

The closing quality gate and this review use the same non-review source
identity. A later commit hash may package this exact tree, but is not itself
part of the Slice 1 technical verdict.

## Exact supported protocol identity

The checked profile binds:

```text
Codex version: codex-cli 0.146.0
launcher SHA-256: sha256:134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477
delegated executable SHA-256: sha256:ae1d3ffe6d48aec6a4dc3f50e7eb8e0d11962485a6a9406c5a7012139383da02
snapshot profile: codex-schema-snapshot-v1
snapshot SHA-256: sha256:0b0bdf534386d796c41596693c451aabaec2526bbac5a7965ab558edc3de8e21
```

Repeated generation produced 622 raw-byte-identical TypeScript files and 275
RFC-8785-canonical-identity JSON Schema files. Their aggregate digests are:

```text
TypeScript: sha256:63c7a5d3d92b1ba1218d92711a81c39bf5b2ee60d978736166615efe5f947684
JSON Schema: sha256:9c13d0c5385a5eeeed6b0f4f59e7b3b91ca07db451ee78724756d87b6f84e50e
```

`pnpm check:m2:protocol` regenerates each projection twice, checks raw or
canonical file identity as appropriate, validates the selected stable surface,
and compares it with the checked snapshot. A binary, version, file-set,
semantic-schema, selected-method, or checked-snapshot change fails before a
live dispatch.

## Lower-client boundary

The new `@codeclosure/codex-app-server-client` package has no production
dependency. Its production source imports only Node built-ins and its own
generated or handwritten modules. The dependency audit scans package source,
tests, and scripts, and reverse fixtures reject imports from every CodeClosure
authority package.

The client owns only process and wire concerns:

- exact verified launcher/delegated-binary identity, revalidated immediately
  before process spawn, and a controlled process launch with explicit argv,
  cwd, environment, config/state roots, and one selected
  credential-environment name;
- one `initialize` then `initialized` handshake, with pre-handshake traffic and
  any second initialization rejected;
- bounded strict-UTF-8 JSONL with null-prototype object projection,
  duplicate-key rejection, and depth/node/collection, line, buffer,
  pending-request, server-request, pending-manual-compaction,
  observed-compaction, stderr, timeout, and shutdown limits;
- exactly correlated responses, typed caller decoders, bounded notifications,
  explicit server-request handlers, and fail-closed unknown or malformed input;
- distinct spawn, process, stream, protocol, timeout, host-cancellation,
  interruption, request-rejection, handler, and shutdown outcomes; and
- manual Compact `contextCompaction` lifecycle plus deterministic later
  same-Thread continuation without recording opaque compaction state or private
  reasoning.

The client does not retry a Turn or process, resume or create a Thread, answer
an approval, select a model fallback, infer Worker completion, mutate a
Candidate, write the Store, or issue Acceptance.

## Deterministic evidence

The fake App Server suite has 40 zero-skip cases. It proves:

- initialization, one Thread/Turn, manual Compact, and post-Compact
  continuation;
- partial-line reconstruction and fail-closed malformed JSON, duplicate keys,
  prototype-bearing objects, empty lines, oversized lines/collections,
  incomplete EOF, nonzero/signal exit, request timeout, spawn failure, and
  bounded stderr;
- exact correlation under reordered, duplicate, conflicting, and unknown
  response identifiers, including deterministic rejection of all concurrent
  pending requests after process exit;
- registered and unknown server-request behavior, unknown notifications,
  response-decoder failure, host cancellation, and bounded SIGTERM/SIGKILL
  shutdown;
- runtime and compile-time rejection of unselected `turn/steer` and a second
  `initialize`; and
- ambient-environment exclusion, secret-value redaction, rejection of
  credential environment names outside the exact allowlist, and rejection when
  a verified executable changes or becomes unavailable between launch
  construction and process spawn, with stable `VERSION_MISMATCH`
  classification; and
- separate bounding of manual compactions awaiting lifecycle observation and
  observed unfinished `contextCompaction` lifecycles, including proof that a
  completed lifecycle releases its slot.

The first bounded closing review found and corrected a shutdown race: the
pre-handshake guard reused the ordinary ready flag, so a late notification
during requested shutdown could be misclassified as initialization traffic.
A second bounded review found and corrected three additional in-scope defects
before commit: prototype-bearing JSON could synthesize inherited fields,
unfinished compaction tracking had no explicit cap, and an executable could
change after launch construction without a final identity check. The final
client uses a separate handshake-complete state, stops consuming stdout after
requested shutdown, projects JSON objects without a prototype, bounds active
compaction lifecycles, and revalidates executable identity at the spawn
boundary. A third bounded review found that manual compactions awaiting their
first lifecycle event were not covered by the observed-lifecycle limit and
that a filesystem read race could escape the version-mismatch error class.
Both were corrected locally with a separate pending-manual limit and normalized
identity-read failure. The focused suite and final repository gate pass after
these corrections.

## Bounded live compatibility proof

After explicit user authorization, the live preflight used the exact selected
binary, a unique temporary controlled `CODEX_HOME`, state root, process home,
temporary root, Candidate, strict config, and owner-only credential copy. It
started one Thread and one structured no-tool Turn with `gpt-5.6-sol`.

The proof returned:

```text
effective config digest: sha256:7fb830f46c625dfa4941f42bfc57048a52dd5c515464a1e5b5b2554d4a2b97d2
managed requirements digest: sha256:5d03954b4b08048fc5591a7c02849e64e495e49bf79202d1526e89ea92aa2e7c
stderr digest: sha256:5a3dfd4ed671e2db3e2c8754046bec689173a0f0e26f62ed1bbed0a097525441
```

Initialization, configuration read, managed-requirements read, permission
profile admission, exact instruction-source comparison, Thread start, and the
Turn all completed. The poisoned project model, search setting, and developer
instruction did not widen the controlled config. No server request or tool was
used. Stderr was bounded to 628 hashed in-memory bytes and was not persisted as
content.

The preflight projects only terminal Thread/Turn identifiers and status. It
does not cache or persist response prose, reasoning deltas, private reasoning,
or opaque compaction state. It removed the controlled home, credential copy,
state, Thread fixture, and Candidate before reporting success.

## Closing executable evidence

The final `pnpm gate:quality` passes with no failed, cancelled, skipped, or todo
case:

| Stage | Result |
| --- | --- |
| documentation tests and structural check | `75/75`, 57 documents |
| CLI/dependency boundary tests | `23/23`, six workspace packages |
| runner and Slice 0 probe tests | `7/7` |
| Slice 1 lower-client tests | `40/40` |
| M1 package unit regression | `136/136` |
| digest tests | `36/36` |
| migration tests | `99/99` |
| authority tests | `244/244` |
| CLI integration | `58/58` |
| M1 adversarial demonstrations | `8/8` |
| Runtime Invariant coverage | `31/31` |

Formatting, strict typecheck, protocol regeneration, package and CLI dependency
audits, documentation checks, and forced production build also pass.

## Documentation and architectural review

The root README, Architecture status, Domain status, Workflow status, Context
Compiler status, M2 milestone, implementation plan, acceptance-plan status,
review index, and ADR index were reviewed together. No new ADR is required:
Slice 1 implements the lower-client boundary already fixed by accepted ADR
0028 and does not change a durable decision. No new Runtime Invariant is added
because no Domain, Workflow, Store, Candidate, Evidence, or Acceptance
authority is introduced. M0/M1 history remains unchanged.

## Verdict, limitations, and next action

Every bounded Slice 1 exit condition passes. Slice 1 is implemented and Slice 2
may begin.

This verdict does not prove a Goal-bound Worker mapping, phase prompt/response
contract, real Candidate, real verifier, repair orchestration, restart
persistence, CLI Codex path, M2 milestone exit, or Goal Intake. Automatic
compaction triggering remains `UNKNOWN` and unselected; the client supports
only the selected manual method and observed lifecycle. Slice 2 must preserve
all M1 guards and may consume this client only through a protocol-neutral
Worker Adapter boundary.
