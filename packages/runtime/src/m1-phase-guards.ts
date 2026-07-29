import { GuardOutcome, requiredGuardsForTransition } from '@codeclosure/domain';

import {
  isRuntimeOwnedPhaseGuard,
  type PhaseGuardEvaluationRequest,
  type PhaseGuardEvaluator,
} from './workflow-runtime.js';

/**
 * M1 has no real project-analysis adapter. Its non-authoritative proof profile
 * therefore supplies deterministic PASS observations only for generic guards;
 * Runtime-owned Candidate, Evidence, and Acceptance guards remain reserved.
 */
export function createM1DeterministicPhaseGuardEvaluator(): PhaseGuardEvaluator {
  return Object.freeze({
    evaluate: (input: PhaseGuardEvaluationRequest) =>
      Object.freeze(
        (requiredGuardsForTransition(input.workflow.phase, input.requestedPhase) ?? [])
          .filter((guard) => !isRuntimeOwnedPhaseGuard(guard))
          .map((guard) =>
            Object.freeze({
              guard,
              outcome: GuardOutcome.PASS,
              reasonCode: 'M1_DETERMINISTIC_SKELETON_GUARD',
              supportingRefs: Object.freeze([`m1:deterministic-guard:${guard}`]),
            }),
          ),
      ),
  });
}
