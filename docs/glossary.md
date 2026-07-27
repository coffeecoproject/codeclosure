# CodeClosure Glossary

## Acceptance Decision

A versioned decision issued only by the Acceptance Engine over an exact input
manifest. It is one of `ACCEPT`, `REJECT_REPAIRABLE`, `REJECT_BLOCKED`,
`NEEDS_DECISION`, or `ENGINE_ERROR`.

## Acceptance Engine

The read-only policy evaluator that consumes authoritative state and evidence.
It cannot edit source or mutate workflow state.

## Candidate

An isolated proposed project state evaluated for one Goal revision. Candidates
are versioned by generation and are mutable only during `IMPLEMENT`.

## Candidate Digest

A canonical content identity for the candidate source and required metadata at
freeze time. Evidence and acceptance bind to this digest.

## Closeout

The successful technical terminal phase for one accepted Goal revision and
Candidate. Closeout is not merge, release, deployment, or production consent.

## Completion Request

A worker proposal that the current phase or implementation may be ready to
advance. It has no authority by itself.

## Context Manifest

The provenance and digest record for one compiled worker context package. It
identifies every authoritative input included or intentionally omitted.

## Evidence

A typed observation produced by a known runner or authority and bound to exact
inputs. Prose produced by the worker is not evidence unless a policy explicitly
treats it as a non-authoritative observation.

## Fact

A versioned, provenance-bearing statement about the goal, business domain,
project, code, data, environment, or external system. Facts have explicit
status and cannot be silently promoted from model inference.

## Fact Graph

The set of facts and typed relationships used to model business paths and
engineering impact. Full graph traversal is planned after the M1 control
skeleton.

## Goal

The externalized unit of user intent. It contains an objective, success
criteria, scope, revisions, and lifecycle status independent of any Codex
thread.

## Human Decision

A typed, scoped record of a business fact, product preference, unavailable
external fact, or exact real-world consent. It is an acceptance input, not a
technical-gate bypass.

## Policy Bundle

The versioned collection of transition rules, acceptance rules, checker
specifications, and permission rules active for an evaluation.

## Promotion

Any action that applies, merges, releases, deploys, or otherwise moves an
accepted candidate into another real state. Promotion is outside initial
technical closeout and needs separate authority.

## Reconciliation

Comparison of persisted authoritative intent with current external reality
after interruption, retry, resume, or detected drift.

## Verification Runner

A bounded executor for exact check specifications. It produces observations
and run evidence, not goal acceptance.

## Worker

A replaceable execution backend, initially `FakeWorker` and later Codex through
App Server. Workers propose and execute permitted actions but hold no workflow
or acceptance authority.

## Workflow Runtime

The sole writer of authoritative workflow state. It validates transition
preconditions, applies phase permissions, persists transitions, and records
audit events.
