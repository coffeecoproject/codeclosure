# M2 Slice 0 Decision-Closure Review

- Review date: 2026-07-30
- Scope: M2 Slice 0 only
- Status: Complete
- Verdict: `PASS`; every bounded Slice 0 exit condition is closed and Slice 1
  may begin

## Review question

This review asks whether M2 may begin product implementation against an exact
Codex App Server protocol/configuration profile, Runtime-owned external
execution lifecycle, isolated Candidate mechanism, and real-verification
contract without weakening the M1 authority baseline.

It does not assess M2 product implementation or milestone exit. The passing
verdict permits Slice 1 to begin; it does not claim that a production Codex
client exists.

## Authority and opening identity

The review used the repository authority order and the Slice 0 contract in the
[M2 implementation plan](../plans/m2-codex-vertical-slice.md#slice-0--authority-and-protocol-decision-closure).
The opening worktree was clean on `main` at
`1aa72ee239f7ec13ecc41b3317e463b8ad9f234b`. Its source identity was:

```text
path count: 225
sha256:0e9e78108d683bc7b5f4062b23b430a3896a24f92961f8625ec0521fddbaad65
```

The complete M1 acceptance entry gate passed at that identity. Its opening and
closing source identities matched, and all required documentation, dependency,
CLI-boundary, unit, digest, migration, authority, CLI, demo, invariant, and
build stages passed without a skipped proof.

## Exact backend observation

The local preflight resolved:

```text
Codex version: codex-cli 0.146.0
launcher: /Users/liushan/.nvm/versions/node/v22.22.3/bin/codex
launcher SHA-256: 134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477
delegated executable: /Users/liushan/.nvm/versions/node/v22.22.3/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex
delegated executable SHA-256: ae1d3ffe6d48aec6a4dc3f50e7eb8e0d11962485a6a9406c5a7012139383da02
```

The earlier 0.145.0 planning preflight remains historical evidence only. It is
not the Slice 0 selected observation and cannot satisfy a future installed
profile.

Repeated generation through the 0.146.0 launcher produced:

| Projection | Files | Result | Aggregate digest |
| --- | ---: | --- | --- |
| generated TypeScript | 622 | raw bytes identical | `sha256:63c7a5d3d92b1ba1218d92711a81c39bf5b2ee60d978736166615efe5f947684` |
| generated JSON Schema | 275 | canonical bytes identical | `sha256:9c13d0c5385a5eeeed6b0f4f59e7b3b91ca07db451ee78724756d87b6f84e50e` |

One JSON Schema file, `codex_app_server_protocol.v2.schemas.json`, differed in
raw object-member order between generations while remaining canonically
identical. The probe therefore treats generated TypeScript as raw bytes and
JSON Schema through duplicate-key rejection plus the named RFC 8785-style
canonical profile. Array ordering remains semantic. The complete static-probe
result digest was
`sha256:04d3b825a51c967a695413409eae8c03ca43bc321805c9839ef81a3bae59c144`.

The stable generated surface contains initialization, Thread start/resume,
manual compact, Turn start/interrupt/steer, terminal Turn notifications,
`contextCompaction`, deprecated compact notification compatibility, and known
command/file approval plus user-input/MCP/tool server-request methods. Presence
in a schema is not counted as successful operation.

## Configuration and workspace probes

A non-production App Server spike used a unique temporary `CODEX_HOME`, state
root, empty `HOME`, minimal environment, custom permission profile, untrusted
project configuration, disabled optional integrations/history/telemetry, and a
disposable Candidate. Before a model Turn, the actual App Server proved:

- initialization used the controlled home;
- `config/read` excluded a poisoned project model, Web Search, and developer
  instruction;
- `permissionProfile/list` resolved the selected custom profile;
- `thread/start` reported the exact requested model, provider, cwd, approval
  policy, effort, and network-disabled stable sandbox projection; and
- returned instruction sources matched the one manifest-bound fixture
  `AGENTS.md`.

The stable response projects the custom profile as legacy `workspaceWrite`
with `network=false`; it does not return the profile name. Therefore no single
response field proves the profile. ADR 0028 requires effective-config,
permission-profile, instruction-source, and black-box containment evidence
together.

The workspace comparison selected a Runtime-managed controlled copy. A
detached Git worktree created a `.git` indirection and changed administrative
state below the source repository's `.git/worktrees` directory. The controlled
lease probe accepted only the registered generation root and rejected the user
source, authority root, sibling generation, and symlink alias. This is a
decision probe, not the Slice 3 workspace implementation.

## Accepted decisions

The local evidence closed three decisions without adding production packages,
domain codecs, Store migrations, or CLI behavior:

- [ADR 0028](../adr/0028-runtime-owned-external-execution-and-codex-profile.md)
  makes external execution Runtime-owned, configuration profile-bound, and
  recoverable without transcript or Thread authority;
- [ADR 0029](../adr/0029-controlled-copy-candidate-workspaces.md) selects
  controlled-copy Candidate workspaces, exact leases, complete retained-file
  freeze manifests, and ownership-bound cleanup; and
- [ADR 0030](../adr/0030-real-local-verification-contract.md) adds explicit
  version-2 local-command Check, observation, environment, Evidence, isolation,
  and bounded SQLite payload contracts while preserving M1 version 1.

No new Runtime Invariant is added in Slice 0 because none of those planned
records is executable yet. The implementation slice that introduces each
authority boundary MUST add its executable invariant and non-skipped test
metadata in the same change.

## Capability record

The current version-bound classification is deliberately narrower than the
generated protocol surface:

| Capability | Classification | Proof or reason |
| --- | --- | --- |
| repeated TypeScript/JSON Schema generation | `SUPPORTED` | local repeated-generation and canonicalization probe |
| controlled initialize/config/profile/instruction preflight | `SUPPORTED` | actual 0.146.0 App Server requests before a model Turn |
| controlled Candidate command and credential-read denial | `SUPPORTED` | one completed command Item ran the unchanged read-only probe, failed the real credential read, and wrote the exact random Candidate marker |
| same-Thread tool-loop continuity | `SUPPORTED` | bounded model Turn and its command Item completed on the started Thread |
| known approval server request and decline | `SUPPORTED` | `item/commandExecution/requestApproval` was observed and declined; the denied target was absent |
| exact Thread resume after process restart | `SUPPORTED` | a second App Server process resumed the same exact retained Thread under matching settings/instructions |
| manual compaction lifecycle | `SUPPORTED` | `thread/compact/start`, maintenance Turn, and completed `contextCompaction` Item were observed |
| post-compaction continuation | `SUPPORTED` | a later bounded Turn completed on the compacted Thread |
| automatic-compaction configuration surface | `SUPPORTED` | the repeated-generation static probe requires the exact 0.146.0 `model_auto_compact_token_limit` and `model_auto_compact_token_limit_scope` fields |
| automatic-compaction trigger | `UNKNOWN` | no bounded trigger was observed |
| Turn interruption | `SUPPORTED` | interrupt was sent only after the resumed Turn's command Item started and the Turn ended `interrupted` |
| `turn/steer` | not selected | exposed by the schema but prohibited by ADR 0028 |
| private reasoning inspection | not performed | neither probe reads, copies, edits, nor persists it |

No M2 Execution Profile may select an `UNKNOWN` capability.

## Bounded live proof

The sandboxed attempt reached controlled initialization and Thread start, but
the first model Turn emitted bounded retry/error notifications and ended
failed. The surrounding execution sandbox blocks external network, so this
result cannot distinguish an environment restriction from backend behavior and
is not capability proof. After the user explicitly authorized the exact
credential-bearing data egress, the current live probe completed through
`codex-cli 0.146.0` and `gpt-5.6-sol`.

The model-service payload was limited to a disposable temporary fixture
containing:

- the literal fixture text `CodeClosure M2 Slice 0 disposable fixture`;
- a fixture `AGENTS.md` that permits only the explicitly requested command;
- fixed probe instructions to run `pwd`, verify that the temporary credential
  copy is unreadable, request and accept a decline for writing the literal word
  `denied` outside the Candidate, return two tiny structured responses, compact
  the Thread, resume it after process restart, and interrupt `sleep 20`;
- the selected model/configuration metadata and random temporary paths needed
  for those checks.

No CodeClosure repository source is placed in the fixture or prompt. The
credential is copied to an owner-only controlled home and used for
authentication, not inserted into model content. Candidate command network is
disabled. The probe retains only typed capability outcomes and bounded
diagnostic digests, never response prose or private reasoning, and removes the
controlled home, credential copy, state, Thread fixture, and Candidate after
the run.

The successful proof returned:

```text
config requirements digest: sha256:25b86fa3671a4ee1ea904a1f5777c164347763d01dda591fcac3022b64235e10
effective config digest: sha256:fceeb9189ad93d8a18613f380915df09cafca224421c131f85ea4cbe3b9e728e
first process stderr digest: sha256:0396c2b725df93f554fab31a018e30f05d1c11d9dc17e853912a9c9ffeaf06bf
second process stderr digest: sha256:61e381df97bdba85e1c405c5c16d5478048fdba5ba7a9a80598ee2890e2eab70
```

Stderr bytes were hashed in memory and were not persisted as content. The run
observed exactly the command-approval server request, declined it, created no
outside target, selected no `turn/steer`, and inspected no private reasoning.
Automatic compaction was deliberately not forced; only its configuration
surface is supported while trigger behavior remains `UNKNOWN` and unselected.

Three authorized fail-closed pre-runs improved the probe without becoming
positive evidence: a readability predicate was replaced with an actual
one-byte read whose output is discarded; brittle model-command string equality
was replaced with an unchanged read-only script plus random marker; and
interrupt now waits for the command Item to start. The final result above comes
from the corrected current script.

## Focused executable evidence

The checked-in local probe tests cover:

- duplicate JSON keys, including escaped-equivalent keys;
- canonical object ordering, semantic array ordering, and lone-surrogate
  rejection;
- raw-order-only versus semantic generated-schema drift; and
- Candidate lease rejection for source, authority, sibling, and symlink-alias
  roots.

All four focused tests pass. The static schema/workspace probe also passes and
cleans its temporary roots. The live script cleans controlled processes and
temporary roots on both success and failure and emits only redacted capability
metadata.

The complete current-tree quality gate also passes: documentation tests
`75/75`, dependency/CLI-boundary tests `22/22`, probe/runner harness tests
`7/7`, package unit tests `136/136`, digest tests `36/36`, migration tests
`99/99`, authority tests `244/244`, CLI tests `58/58`, all eight M1 demos, and
all `31/31` Runtime Invariants. Formatting, strict typecheck, dependency audits,
documentation checks, and the forced production build pass. No invoked test is
failed, cancelled, skipped, or marked todo.

## Scope and next action

This Slice 0 work does not implement a Codex client, Worker adapter, real
Candidate, verifier, Store migration, Goal Intake, Goal Revision, promotion,
release, deployment, or another external effect. M1 history and direct
`CreateGoal` behavior remain unchanged.

Slice 0 has no remaining action. Slice 1 may now implement the version-bound
lower App Server client and checked-in supported profile. M2.5 Goal Intake,
production Worker mapping, Candidate creation, verification, and later M2
slices remain outside this verdict until their own implementation and evidence
exist.
