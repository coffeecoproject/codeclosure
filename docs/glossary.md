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

## Execution Profile

An immutable, versioned, digested description of the Worker, Candidate Source,
Verification Runner, and Runtime driver composition bound to a Workflow at
first start. M1 fixture names are aliases for installed profiles, not Goal
semantics.

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
thread. A Codex thread-scoped goal or plan is disposable worker execution state
and is not this authoritative product object.

## Human Decision

A typed, scoped record of a business fact, product preference, unavailable
external fact, or exact real-world consent. It is an acceptance input, not a
technical-gate bypass.

## Policy Bundle

The versioned collection of transition rules, acceptance rules, checker
specifications, and permission rules active for an evaluation.

## Workflow Policy Binding

The immutable first-start record selecting the exact installed Policy ID,
version, and digest that governs one Workflow for its lifetime. Installing or
configuring another Policy does not replace this binding.

## Promotion

Any action that applies, merges, releases, deploys, or otherwise moves an
accepted candidate into another real state. Promotion is outside initial
technical closeout and needs separate authority.

## Reconciliation

Comparison of persisted authoritative intent with current external reality
after interruption, retry, resume, or detected drift.

## Recovery Reconciliation Record

The immutable, digest-bound result of one Runtime recovery inspection. It binds
the inspected Workflow, Attempt/dispatch and Candidate authority, safe phase or
blocker, observation references, and resulting Workflow version. It is not
permission to reuse an old Attempt.

## Runtime Application Coordinator

The product-facing Runtime service that owns Goal commands, startup recovery,
deterministic M1 driving, and read-only Goal views. Trusted composition invokes
startup recovery before publishing its narrow application facade. It does not
replace the Workflow Runtime or Acceptance Engine as an authority owner.

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
