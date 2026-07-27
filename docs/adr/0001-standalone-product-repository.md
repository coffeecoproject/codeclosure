# ADR 0001: Standalone product repository

- Status: Accepted
- Date: 2026-07-27

## Context

The predecessor work, IntentOS, began as governance around a coding agent. The
new product has a different responsibility: it owns authoritative goal state,
workflow transitions, evidence binding, and acceptance. Treating this as an
extension inside the predecessor repository would preserve compatibility costs
and blur which system is authoritative.

The product also needs its own executable entry point, release lifecycle, state
store, and security boundary.

## Decision

CodeClosure is a standalone product in the `coffeecoproject/codeclosure`
repository.

- The user starts and interacts with `codeclosure`.
- CodeClosure owns the task lifecycle and authoritative runtime state.
- Codex and future LLM-backed systems are replaceable worker integrations.
- IntentOS material may inform the design, but CodeClosure has no compatibility
  obligation to its protocols, storage layout, prompts, or command surface.
- No CodeClosure runtime state is stored in the predecessor repository.

## Consequences

- Product terminology and APIs can be designed around runtime guarantees rather
  than legacy abstractions.
- Migration from IntentOS, if ever needed, is a separate feature with explicit
  acceptance criteria.
- Shared code must be imported deliberately and relicensed or attributed where
  required; history is not copied wholesale.
- The new repository must establish its own engineering baseline before runtime
  implementation begins.

## Rejected alternatives

- **Rename the IntentOS repository in place.** Rejected because it would mix the
  old prompt-governance architecture with the new authority boundary.
- **Fork Codex first.** Rejected because the required control plane can initially
  be implemented above the public App Server interface.
- **Ship only a Codex plugin or prompt package.** Rejected because such a package
  cannot independently own completion authority or durable state transitions.

## Validation

M1 must run without importing the IntentOS runtime and without modifying Codex
Core. Its deterministic tests must use a fake worker behind the same worker port
that a future Codex adapter will implement.
