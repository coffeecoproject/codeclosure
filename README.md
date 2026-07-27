# CodeClosure

**Reliable runtime for AI coding.**

CodeClosure is a local-first control runtime that sits above coding agents such
as Codex. The agent can inspect code, propose a plan, edit an isolated
candidate, and run tools. It cannot decide that the engineering goal is
complete.

> LLMs propose. CodeClosure decides what may become complete.

## Status

CodeClosure is in the **M0 architecture-baseline stage**. This repository
currently defines the product contract, authority boundaries, workflow,
evidence model,
and implementation milestones. It does not yet contain a working runtime, and
the presence of these documents is not an implementation-completion claim.

M1 may begin only after the reviewed M0 document set is tracked in a
version-control baseline.

The first executable milestone, M1, will prove the control boundary with a
`FakeWorker` before Codex is connected.

## Why CodeClosure Exists

Prompt instructions can improve agent behavior, but they cannot make a
probabilistic worker the authority over its own completion. CodeClosure moves
critical state and decisions out of the conversation:

- goals and success criteria;
- project and business facts;
- workflow phase and permitted actions;
- candidate identity and freeze state;
- evidence and verification results;
- acceptance decisions and unresolved blockers.

Conversation history remains useful working memory. It is not authoritative
state and may be compacted, replaced, or discarded.

## Runtime Shape

```text
User
  |
  v
CodeClosure CLI
  |
  v
CodeClosure Control Runtime
  |-- Goal and Fact Store
  |-- Workflow Runtime
  |-- Context Compiler
  |-- Candidate Manager
  |-- Evidence Store
  |-- Acceptance Engine
  `-- Human Decision Gateway
  |
  v
Worker Adapter
  |
  v
Codex App Server (M2)
```

The public entry will be `codeclosure`. Codex is an execution backend, not the
product entry and not the completion authority.

## Canonical Documents

- [Product contract](PRODUCT.md)
- [Architecture](ARCHITECTURE.md)
- [Runtime invariants](RUNTIME_INVARIANTS.md)
- [Domain model](docs/domain-model.md)
- [Workflow state machine](docs/workflow.md)
- [Context compiler](docs/context-compiler.md)
- [Acceptance engine](docs/acceptance-engine.md)
- [Evidence model](docs/evidence-model.md)
- [Milestones](docs/milestones.md)
- [M1 deterministic-skeleton plan](docs/plans/m1-deterministic-skeleton.md)
- [M0 architecture review](docs/reviews/m0-architecture-review.md)
- [Accepted ADR index](docs/adr/README.md)

Repository instructions and document precedence are defined in
[AGENTS.md](AGENTS.md).

## Near-Term Scope

M1 is deliberately narrow:

- one local user;
- one target repository;
- one goal at a time;
- deterministic state transitions;
- SQLite-backed authoritative state;
- append-only audit events;
- a `FakeWorker` only;
- restart and resume;
- tests proving a worker cannot close a goal.

Codex App Server integration, full Fact Graph traversal, rich TUI, multi-agent
coordination, cloud execution, and automated release are later milestones.

## Non-Goals

CodeClosure is not:

- another coding agent;
- a prompt pack or an `AGENTS.md` distribution system;
- a guarantee that AI-generated code has no defects;
- a replacement for Git, CI, deployment platforms, or real-world authority;
- a Codex fork in the initial architecture;
- a compatibility layer for the former IntentOS implementation.

## Working Principle

Completion is a versioned, reproducible runtime decision over a frozen
candidate and bound evidence. A model message, successful turn, test log,
review statement, or generated report is only an input. None is completion by
itself.
