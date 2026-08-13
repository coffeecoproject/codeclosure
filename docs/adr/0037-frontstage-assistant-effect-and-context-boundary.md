# ADR 0037: Bound each Frontstage Assistant operation by a fresh manifest

- Status: Accepted
- Date: 2026-08-06

## Context

The M2.6 frontstage needs model assistance for ordinary answers and candidate
route proposals while remaining continuously available in the CLI. Reusing a
long-lived model Thread as the session record would make restart, compaction,
retention, and authority depend on backend history. Giving the assistant
project tools or Runtime facades would also collapse the separation between
conversation, Intake, Goal control, and governed execution.

ADR 0035 established an enforceable M2.5 Intake pattern: CodeClosure grants no
authority capability, isolates each operation, binds its input and profile,
and fails the operation when tool use is observed without claiming that the
upstream model-visible tool inventory is empty. M2.6 needs a separate
Frontstage contract because its inputs and output kinds differ from Intake.

## Decision

### Use a separate Frontstage Assistant port

M2.6 will introduce a protocol-neutral `FrontstageAssistantPort`. It accepts
one immutable `FrontstageContextPackage` plus operation metadata and returns
one closed-schema untrusted result. It is not WorkerPort or the M2.5 Intake
Assistant port and cannot import their authority semantics.

Because the trusted route is not known before model assistance, M2.6 uses one
closed `FrontstageProposalResponse` discriminated union rather than selecting
between two model calls. Its variants are:

- `ANSWER_PROPOSAL`, with bounded ordinary answer content;
- `ROUTE_PROPOSAL`, with candidate route, target reference, and ambiguity;
- `CLARIFICATION_PROPOSAL`, with bounded explanatory text; and
- `NO_ACTION_PROPOSAL`.

The Runtime validates schema, byte and collection budgets, package/manifest
identity, lifecycle, and profile binding before any response becomes an
interaction record. The assistant cannot author record IDs, provenance class,
route decision, pending action, command, Goal summary, or disposition.

The initial response contract is
`frontstage-response_codeclosure-m2-6-proposal-v1`. Its variants have exactly
these semantic fields in addition to their common schema/contract bindings:

| Variant | Exact semantic fields |
| --- | --- |
| `ANSWER_PROPOSAL` | one `answerContent` string |
| `ROUTE_PROPOSAL` | one closed `candidateRoute`, zero to four distinct `candidateGoalIds` drawn from the supplied Goal summaries, one closed `ambiguity`, and optional bounded `explanationContent` |
| `CLARIFICATION_PROPOSAL` | one closed `ambiguity` and one bounded `questionContent` |
| `NO_ACTION_PROPOSAL` | one closed `reasonCode` |

The `candidateRoute` set is `LIST_GOALS`, `SHOW_GOAL`,
`SUBMIT_GOVERNED_INTAKE`, `SUBMIT_MATERIALIZE_ONLY_INTAKE`, `START_GOAL`,
`RESUME_GOAL`, and `CANCEL_GOAL`. Ordinary answers use only the separate
`ANSWER_PROPOSAL` variant. The `ambiguity` set is `NONE`,
`ACTION_AMBIGUOUS`, `TARGET_AMBIGUOUS`, and `REQUEST_INCOMPLETE`.
`NO_ACTION_PROPOSAL.reasonCode` is `UNSUPPORTED` or `NO_SAFE_PROPOSAL`.
Unknown members, a Goal ID absent from the exact supplied summary set, a Goal
candidate on a route that cannot target a Goal, `NONE` with an invalid target
cardinality, or another illegal variant combination rejects the complete
response.

These fields remain proposals. In particular, a candidate route or Goal ID is
not copied into Focus, Route Decision, Pending Action, or command authority.
Runtime resolves it against current public projections and applies ADR 0036
and ADR 0038; ambiguity or a state-changing assistant-proposed target requires
clarification or a separately gated exact action.

Trusted handling precedes assistant invocation. The closed confirmation and
decline parser, exact active-Intake-Question parser, direct-action parser, and
read-only Goal-query parser run in that order. Only a message not decided by
those parsers reserves one Assistant operation. There is at most one
Frontstage Assistant call per user message. The deterministic Routing Policy
then validates the returned Proposal and decides whether to persist a bounded
non-authoritative answer, ask a clarification, construct a Pending Action, or
take no action.

### Compile a fresh package and durable manifest per operation

The Runtime compiles one fresh package for each assistant call. The durable
Manifest binds:

- session and operation identity/version;
- exact current user-message identity and content digest;
- the ordered retained-message excerpt included as non-authoritative context;
- exact Focus Binding;
- exact Runtime-owned Goal summary and active Intake-question projections when
  selected;
- every omitted source class and reason;
- response-contract, assistant-profile, routing/answer policy, retention, and
  budget identities; and
- the canonical package digest.

The package may contain only the closed source set declared by the installed
profile. A raw Store record, mutation capability, Worker Context, Candidate
path, project content, credential, hidden reasoning, ambient instruction, or
unbounded transcript is not a legal source.

Retained Frontstage messages are working context, not authority. A model
summary of them cannot become user-stated source, Focus, Goal status, Human
Decision, Evidence, Acceptance, or a pending action.

### Use fresh isolated backend operations in M2.6

Each assistant call uses one controlled process, one fresh ephemeral Thread,
and one bounded Turn through the reusable App Server client. M2.6 does not
require Thread reuse, Thread recovery, or Compact policy.

The initial identities are
`frontstage-assistant-profile_codeclosure-m2-6-local /
codeclosure-m2-6-local-assistant-v1` and
`frontstage-assistant-adapter_codex-app-server /
codeclosure-m2-6-frontstage-adapter-v1`. The Profile declares
`selectedAuthorityCapabilities: []` and
`effectPolicy: ISOLATED_READ_ONLY_FAIL_ON_TOOL_OBSERVATION`. It is a new
Frontstage identity and does not reuse or relabel an M2.5 Intake Profile,
Adapter, response contract, or operation record.

The bounded implementation baseline pins Codex CLI `0.146.1` and protocol
snapshot
`sha256:312156edfdf765f134ce5f754419a9509fd34186798a1bdbb0c219ac7c19c610`.
A 2026-08-14 read-only lower-client probe confirmed that exact installed
binary can initialize, create a fresh Thread, complete one structured-output
Turn, and clean its controlled state. That planning probe is feasibility
evidence only: it does not prove the unimplemented Frontstage Adapter,
Frontstage isolation, tool containment, semantic response quality, or the
M2.6 milestone. The final Profile digest and effective-configuration proof
must be produced from the implemented Frontstage composition.

Trusted composition selects no CodeClosure authority capability and supplies
an isolated operation cwd/state root outside project, Candidate, authority,
credential, and other forbidden roots. It disables configurable shell, exec,
network, Web Search, MCP, app, plugin, skill, subagent, browser, computer-use,
image-generation, hook, and external-integration sources. Approval policy is
`never` and no ambient instruction source is accepted.

As in ADR 0035, this decision does not claim that the pinned App Server proves
an empty model-visible built-in tool inventory. Any observed command, file,
image, MCP, dynamic-tool, or other non-message/non-reasoning item fails the
whole operation, interrupts the known Turn when possible, discards its output,
and produces no Route Proposal or Frontstage Answer.

### Keep project-specific assistance governed

The Frontstage Assistant cannot inspect the project. A message requiring
project observation must either:

- become an authorized governed Intake request under the existing M2.5/public
  Runtime path;
- receive a transparent `NO_ACTION` or clarification result; or
- wait for a later accepted project-observation port with exact read scope,
  provenance, budgets, audit, and policy.

Ambient model tools cannot substitute for that port.

## Consequences

- Session continuity survives restart through CodeClosure records rather than
  backend Thread memory.
- Each model call has exact inputs, omissions, profile, response contract, and
  replay identity.
- A message never incurs a route-model call followed by a second answer-model
  call.
- Frontstage and Goal-bound Worker operations may use the same lower transport
  without sharing ports or authority.
- Fresh calls cost more context reconstruction than a long-lived Thread but
  keep the M2.6 boundary deterministic and reviewable.
- Project-aware ordinary chat and long-term assistant memory remain outside
  M2.6.

## Rejected alternatives

- **Reuse one long-lived Thread as the interaction session.** Rejected because
  backend history is not durable CodeClosure authority and Compact may replace
  it.
- **Give the assistant the public Runtime facade.** Rejected because model code
  must not execute queries or mutations; Runtime owns both selection and
  invocation.
- **Permit read-only project tools as harmless.** Rejected because exact
  project identity, read scope, provenance, budgets, retention, and audit are
  not defined by ambient tools.
- **Select separate route and answer calls before trusted routing.** Rejected
  because the answer/route distinction is not yet trusted and two calls create
  avoidable reservation, budget, failure, and replay ambiguity. One closed
  proposal union keeps the operation exact.
- **Reuse the M2.5 Intake Assistant response contract.** Rejected because a
  route proposal or casual answer is not an Intent Projection proposal or an
  Intake Answer-only result.
- **Treat post-observation rejection as proof that no tool effect occurred.**
  Rejected for the same notification-order reason recorded in ADR 0035.

## Validation

M2.6 tests must prove:

- dependency boundaries exclude Store, Goal/Workflow mutation, Worker,
  Candidate, Evidence, Acceptance, CLI handler, and external-effect imports;
- Package and Manifest identity changes for every authoritative selected input,
  omission, profile, policy, response contract, or budget change;
- transcript excerpts remain explicitly non-authoritative and bounded;
- missing, extra, stale, oversized, or digest-mismatched input/output fails
  closed;
- every exact Proposal variant and closed enum combination decodes, while an
  unknown, cross-variant, out-of-context Goal, or illegal-cardinality value
  discards the whole result;
- trusted exact parsers bypass model invocation, while every unresolved message
  invokes at most one proposal operation;
- observed tool use interrupts and discards the entire result;
- cwd/state/forbidden-root overlap fails before Thread creation;
- the assessed composition binds the exact accepted Frontstage Profile,
  Adapter, Codex `0.146.1`, and protocol snapshot identities without
  substituting an Intake identity or treating the Slice 0 probe as Live
  Frontstage evidence;
- exact replay returns stored output without a second assistant call; and
- process, timeout, interruption, and restart failures create no Route Decision,
  Pending Action, Goal, Workflow, Evidence, or Acceptance authority.
