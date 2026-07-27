# Architecture References and Boundaries

## Purpose

These projects informed the M0 architecture. They are references, not
CodeClosure authorities or dependencies. CodeClosure does not copy their source
code, state machines, prompts, or completion semantics merely because they are
useful examples.

Review date: 2026-07-27.

External source revisions inspected for this review:

| Repository | Reviewed revision |
| --- | --- |
| OpenAI Codex | [`95637f7056835fea66bdd0044414af480fc0fd74`](https://github.com/openai/codex/tree/95637f7056835fea66bdd0044414af480fc0fd74) |
| OpenAI Symphony | [`f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7) |
| ml-intern-codex | [`b363eea69a0ccbe67bb18276eee77c02f1e11043`](https://github.com/BetterAndBetterII/ml-intern-codex/tree/b363eea69a0ccbe67bb18276eee77c02f1e11043) |
| CodexPotter | [`0b544172b70df2e2439f764a02c7e6096e34646e`](https://github.com/breezewish/CodexPotter/tree/0b544172b70df2e2439f764a02c7e6096e34646e) |
| ai-sdk-provider-codex-app-server | [`d655ec06b4849c633989b6c25af01eab85019ce1`](https://github.com/pablof7z/ai-sdk-provider-codex-app-server/tree/d655ec06b4849c633989b6c25af01eab85019ce1) |

The former IntentOS repository was reviewed locally as historical design input;
its current working tree is not a CodeClosure dependency or reproducible product
authority.

## Reference Matrix

| Source | Useful proof or pattern | Boundary for CodeClosure |
| --- | --- | --- |
| Former IntentOS / `ai-native-dev-kit` | Goal-driven operation, business-universe coverage, evidence authority, runtime trust, digest binding, review/repair, unified closure, fail-closed consumers | Much of the control remained file/report/prompt mediated and Codex-owned. CodeClosure migrates semantics, not schemas, paths, compatibility, or artifact volume. |
| [OpenAI Codex](https://github.com/openai/codex) | Mature execution engine; App Server v2; Thread/Turn/Item lifecycle; cwd, sandbox, approval, stream, interrupt, compact; generated schemas | Codex Thread and Turn state are worker-session state. `turn/completed` and compaction are not business completion or authoritative memory. |
| [OpenAI Symphony](https://github.com/openai/symphony) | Single orchestrator mutation authority, isolated per-work-item workspace, reconciliation, retries, workspace containment, App Server runner separation | Symphony is primarily scheduler/runner orchestration; workflow success may be prompt/tracker-defined and its specification does not mandate CodeClosure's evidence/acceptance model. |
| [ml-intern-codex](https://github.com/BetterAndBetterII/ml-intern-codex) | A local product can wrap installed `codex app-server`, persist its own thread/artifact state, and provide a Codex-like TUI without forking Codex | Its domain behavior is skill-first and transcript-first. It does not externalize software-goal acceptance or replace chat history with an authoritative Context Compiler. |
| [CodexPotter](https://github.com/breezewish/CodexPotter) | Fresh-context rounds, self-contained handoff files, filesystem memory, reconcile loops, and requirement-by-requirement completion audit improve long-task behavior | `::potter(ready)` / `::potter(exit)` and completion audit remain LLM/skill protocol outputs. They are useful worker strategies, not deterministic acceptance authority. |
| [ai-sdk-provider-codex-app-server](https://github.com/pablof7z/ai-sdk-provider-codex-app-server) | TypeScript proof for spawning App Server over stdio, streaming notifications, Thread resume, interrupt, and session control | It is a convenience provider abstraction, not CodeClosure's authority boundary. Before reuse, server-initiated requests, full Item fidelity, overload/backpressure, approvals, and schema/version drift require independent validation. |

## Former IntentOS: What Carries Forward

The following concepts remain valuable and are represented in current
CodeClosure documents:

- externalized Goal and current-work continuity;
- business scenario coverage rather than file-only coverage;
- exact project/task/intent/source/evidence identity;
- source freeze and evidence freshness;
- runtime identity and cleanup ownership where risk requires it;
- strict consumer validation rather than trusting report existence;
- one final closeout truth;
- claim language proportional to proof strength;
- separation of technical readiness from real-world authority.

The following implementation tendencies do not carry forward:

- making Codex responsible for selecting and obeying every governance file;
- treating generated Markdown plus checkers as the primary state model;
- growing many overlapping artifact families before a runtime domain model;
- keeping compatibility with historical commands/schemas by default;
- relying on the same worker to remember scope and judge its own completion.

The former repository remains historical evidence and design input. It is not a
runtime dependency and is not the source of CodeClosure current behavior.

## Codex Source Findings

### App Server is a viable execution boundary

Codex App Server v2 exposes:

- `thread/start`, `thread/resume`, and `thread/fork`;
- `turn/start` and `turn/interrupt`;
- streamed Thread/Turn/Item notifications;
- per-thread/per-turn cwd and sandbox or permission overrides;
- server-initiated approval requests;
- version-specific TypeScript and JSON schema generation;
- manual compaction through `thread/compact/start`.

This supports an external host runtime without initially forking Codex.

### Protocol version is part of execution identity

The generated schema corresponds to the installed Codex version. The Codex
adapter must record and validate that version instead of manually duplicating
protocol definitions in the domain.

### Compact is a model-history operation

Codex Core compaction constructs replacement history using summaries, retained
messages, and re-injected initial context, then persists a `CompactedItem` and
replaces live history. This is intentionally useful for model context, but it
confirms that Goal/Facts/Decisions/Evidence cannot live only in Thread history.

### Codex context rules align but do not replace CodeClosure

Codex source guidance already requires bounded model-context fragments and
incremental history. CodeClosure operates at a different level: it selects
authoritative phase inputs and preserves them independently of the model's
history window.

## Symphony Findings

Symphony's specification makes the Orchestrator the only scheduling-state
mutator and converts worker outcomes into explicit transitions. That directly
supports CodeClosure's one-workflow-writer invariant.

It also proves several operational patterns:

- deterministic workspace paths under one managed root;
- agent cwd containment checks;
- reconciliation before dispatch;
- distinct normal, failure, timeout, stall, and cancellation outcomes;
- backoff and retry classification;
- worker/session state separated from tracker/work authority.

CodeClosure strengthens the model in three areas:

1. durable local control state is required for exact restart recovery;
2. a successful worker exit never supplies goal acceptance;
3. acceptance binds a frozen Candidate to evidence and policy rather than a
   workflow prompt or tracker state alone.

## CodexPotter Findings

The strongest transferable idea is that each new worker context must be
self-contained and that completion should be challenged from fresh context.
CodeClosure formalizes this through Context Manifests and independent review
evidence.

The key non-transferable mechanism is LLM-emitted readiness markers. In
CodeClosure a marker is a Completion Request. Only the Acceptance Engine can
issue `ACCEPT`, and only the Workflow Runtime can enter `CLOSEOUT`.

## Wrapper Implementation Findings

Both the Rust ml-intern bridge and TypeScript provider demonstrate a practical
stdio client shape:

- spawn `codex app-server`;
- perform `initialize` / `initialized` handshake;
- correlate JSON-RPC requests and responses;
- buffer/stream notifications;
- create or resume Threads;
- start and interrupt Turns;
- map process termination into a host-level failure.

CodeClosure should build a narrow adapter after M1. It should prefer Codex's
generated v2 schema, explicitly handle server-initiated requests, bound line
sizes and queues, classify overload as retryable, and keep backend events out
of the domain model.

## Decision Summary

The references support the chosen architecture:

```text
Codex supplies execution capability.
Symphony supplies orchestration patterns.
CodexPotter supplies fresh-context worker techniques.
IntentOS supplies evidence and closure semantics.
CodeClosure combines them under an external, deterministic authority model.
```

No reference project by itself implements the complete CodeClosure contract.
