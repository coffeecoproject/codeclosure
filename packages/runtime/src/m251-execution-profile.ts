import { type ExecutionProfile } from '@codeclosure/domain';

export const M251_REAL_CODEX_EXECUTION_PROFILE_ID = 'profile_m2-5-1-real-codex';
export const M251_REAL_CODEX_EXECUTION_PROFILE_VERSION = 'codeclosure-m2-5-1-real-codex-profile-v1';
export const M251_CANDIDATE_SOURCE_ID = 'controlled-copy-candidate';
export const M251_CANDIDATE_SOURCE_VERSION = 'candidate-freeze-v2';
export const M251_VERIFICATION_RUNNER_ID = 'protected-local-verification';
export const M251_VERIFICATION_RUNNER_VERSION = 'v1';

export const M251CandidateFreezeProfileClassification = {
  HISTORICAL: 'HISTORICAL',
  M251_FREEZE_V2: 'M251_FREEZE_V2',
  INCOMPATIBLE_M251: 'INCOMPATIBLE_M251',
} as const;
export type M251CandidateFreezeProfileClassification =
  (typeof M251CandidateFreezeProfileClassification)[keyof typeof M251CandidateFreezeProfileClassification];

export function classifyM251CandidateFreezeProfile(
  profile: ExecutionProfile,
): M251CandidateFreezeProfileClassification {
  if (profile.id !== M251_REAL_CODEX_EXECUTION_PROFILE_ID) {
    return M251CandidateFreezeProfileClassification.HISTORICAL;
  }
  return profile.schemaVersion === 2 &&
    profile.version === M251_REAL_CODEX_EXECUTION_PROFILE_VERSION &&
    profile.candidateSource === M251_CANDIDATE_SOURCE_ID &&
    profile.candidateSourceVersion === M251_CANDIDATE_SOURCE_VERSION &&
    profile.verificationRunner === M251_VERIFICATION_RUNNER_ID &&
    profile.verificationRunnerVersion === M251_VERIFICATION_RUNNER_VERSION &&
    profile.externalExecution.schemaVersion === 3
    ? M251CandidateFreezeProfileClassification.M251_FREEZE_V2
    : M251CandidateFreezeProfileClassification.INCOMPATIBLE_M251;
}
