# Implementation plans

Plans translate accepted product and architecture decisions into bounded work.
They may sequence decisions but cannot weaken runtime invariants.

M2.5 completed its corrected canonical assessment and independent bounded
review on 2026-08-06. A later real integration test exposed an Intake Adapter
compatibility defect and the absence of a proven product composition from
M2.5 Materialization through ordinary Start to a phase-complete real Codex
path. The M2.5.1 documents below define candidate-free real Codex over exact
Runtime-owned read-only selected-source snapshots for `DISCOVERY`/`PLAN`,
Candidate-bound real Codex for `IMPLEMENT`, and no production fake fallback.
[ADR 0043](../adr/0043-candidate-free-codex-project-read-authority.md) is
accepted and closes the new project-read snapshot, Context, configuration/
instruction, and cleanup authority before implementation. The Slice 0
executable contract and proof-owner freeze select the exact reviewed Codex
`0.146.1` toolchain and retain the historical `0.146.0` identity without
cross-version substitution. The final canonical assessment passed 13/13 stages
and 68/68 rows on exact source `dfe4798`, and the independent completion review
issued bounded `PASS` on 2026-08-13. This post-completion correction does not
rewrite the historical M2.5 verdict. M2.6 is now the current formalization:
ADRs 0036 through 0039 are accepted and its executable Slice 0 decision/proof
contract passed bounded review on 2026-08-14, but Slice 1 feature
implementation is still under bounded review. Its Domain/codecs and
deterministic Runtime-policy candidate exist; later M2.6 slices have not
started. M2.7 remains a separate proposal whose ADRs are not binding.

- [M1 deterministic skeleton](m1-deterministic-skeleton.md)
- [M1 milestone acceptance plan](m1-acceptance-plan.md)
- [M2 Codex vertical slice](m2-codex-vertical-slice.md)
- [M2 milestone acceptance plan](m2-acceptance-plan.md)
- [M2.5 Goal Intake and Materialization](m2.5-goal-intake-materialization.md)
- [M2.5 milestone acceptance plan](m2.5-acceptance-plan.md)
- [M2.5.1 Real Intake-to-Codex Composition Closure](m2.5.1-real-intake-codex-composition-closure.md)
- [M2.5.1 Slice 0 contract and proof-owner freeze](m2.5.1-slice0-contract.md)
- [M2.5.1 Slice 4 effective read-containment closure plan](m2.5.1-slice4-effective-read-containment-closure.md)
- [M2.5.1 milestone acceptance plan](m2.5.1-acceptance-plan.md)
- [M2.6 Unified Frontstage Interaction and Control](m2.6-unified-frontstage-interaction.md)
- [M2.6 Slice 0 contract and proof-owner freeze](m2.6-slice0-contract.md)
- [M2.6 milestone acceptance plan](m2.6-acceptance-plan.md)
- [M2.7 Local Runtime Host and Single-Goal Project Control](m2.7-local-runtime-host-single-goal-control.md)
- [M2.7 milestone acceptance plan](m2.7-acceptance-plan.md)
