import {
  registerM251CandidateContainmentFailureProofs,
  registerM251CandidateFreezeSuccessProof,
} from './m2.5.1-candidate-change-containment.proof.ts';

registerM251CandidateFreezeSuccessProof('freeze-v2-runtime-store-evidence-closure');
registerM251CandidateContainmentFailureProofs();
