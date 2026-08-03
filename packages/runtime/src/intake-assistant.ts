import type {
  CandidateSourceSpanSuggestion,
  IntakeManifest,
  IntentProjectionField,
} from '@codeclosure/domain';

import type { AnswerOnlyPackage, IntakePackage } from './intake-packages.js';

export const M25_INTAKE_ASSISTANT_PROFILE_ID = 'intake-assistant-profile_codeclosure-m2-5-local';
export const M25_INTAKE_ASSISTANT_PROFILE_VERSION = 'codeclosure-m2-5-local-assistant-v1';
export const M25_INTAKE_ASSISTANT_ADAPTER_ID = 'intake-assistant-adapter_codex-app-server';
export const M25_INTAKE_ASSISTANT_ADAPTER_VERSION = 'codeclosure-m2-5-intake-adapter-v1';
export const M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_ID = 'intake-response_intent-analysis';
export const M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION =
  'codeclosure-m2-5-intent-analysis-response-v1';
export const M25_ANSWER_ONLY_RESPONSE_CONTRACT_ID = 'intake-response_answer-only';
export const M25_ANSWER_ONLY_RESPONSE_CONTRACT_VERSION = 'codeclosure-m2-5-answer-only-response-v1';
export const M25_INTAKE_BUDGET_PROFILE_ID = 'intake-budget_codeclosure-m2-5-local';
export const M25_INTAKE_BUDGET_PROFILE_VERSION = 'codeclosure-m2-5-local-budget-v1';

export const M25_INTAKE_CODEX_VERSION = '0.146.0';
export const M25_INTAKE_PROTOCOL_SNAPSHOT_DIGEST =
  'sha256:0b0bdf534386d796c41596693c451aabaec2526bbac5a7965ab558edc3de8e21';
export const M25_INTAKE_MODEL_PROVIDER = 'openai';
export const M25_INTAKE_MODEL = 'gpt-5.6-sol';
export const M25_INTAKE_SERVICE_TIER = 'default';
export const M25_INTAKE_REASONING_EFFORT = 'low';

export const m25IntakeBudgetDefinition = Object.freeze({
  schemaVersion: 1 as const,
  id: M25_INTAKE_BUDGET_PROFILE_ID,
  version: M25_INTAKE_BUDGET_PROFILE_VERSION,
  exactRawRequestContentBytesPerRevision: 16_384,
  exactClarificationAnswerBytesPerRevision: 16_384,
  maximumDeclaredConstraints: 16,
  maximumDeclaredConstraintBytes: 2_048,
  maximumRawRequestRevisions: 8,
  maximumClarificationTurns: 8,
  maximumSelectedRawRequestContentBytes: 131_072,
  maximumCanonicalPackageBytes: 262_144,
  maximumManifestEntries: 256,
  maximumIntentAnalysisResponseBytes: 65_536,
  maximumAnswerOnlyResponseBytes: 131_072,
  maximumRetainedAnswerContentBytes: 16_384,
  maximumProposedObjectiveBytes: 8_192,
  maximumProposedScopeBytes: 8_192,
  maximumProposedCriteria: 16,
  maximumProposedCriterionBytes: 4_096,
  maximumProposedNonGoals: 16,
  maximumProposedNonGoalBytes: 2_048,
  maximumProposedAssumptions: 16,
  maximumProposedAssumptionBytes: 2_048,
  maximumProposedQuestions: 8,
  maximumProposedQuestionBytes: 2_048,
  maximumProposedClassificationBytes: 256,
  maximumCandidateSourceSpanSuggestions: 64,
  maximumActiveClarificationQuestions: 1,
  assistantTerminalDeadlineMilliseconds: 300_000,
});

export type M25IntakeBudgetDefinition = typeof m25IntakeBudgetDefinition;

export interface IntentAnalysisAssistantResponseV1 {
  readonly proposedObjective?: string;
  readonly proposedCriteria: readonly string[];
  readonly proposedScope?: string;
  readonly proposedNonGoals: readonly string[];
  readonly proposedAssumptions: readonly string[];
  readonly proposedQuestions: readonly string[];
  readonly candidateSourceSpanSuggestions: readonly CandidateSourceSpanSuggestion[];
  readonly proposedClassification?: string;
}

export interface AnswerOnlyAssistantResponseV1 {
  readonly answerContent: string;
}

export const IntakeAssistantFailureReasonCode = {
  ASSISTANT_UNAVAILABLE: 'ASSISTANT_UNAVAILABLE',
  ASSISTANT_TIMEOUT: 'ASSISTANT_TIMEOUT',
  ASSISTANT_PROTOCOL_ERROR: 'ASSISTANT_PROTOCOL_ERROR',
  RESPONSE_REJECTED: 'RESPONSE_REJECTED',
} as const;
export type IntakeAssistantFailureReasonCode =
  (typeof IntakeAssistantFailureReasonCode)[keyof typeof IntakeAssistantFailureReasonCode];

export interface IntakeAssistantObservation {
  readonly schemaVersion: 1;
  readonly operation: 'INTENT_ANALYSIS' | 'ANSWER_ONLY';
  readonly state: 'COMPLETED' | 'FAILED';
  readonly processLaunchCount: number;
  readonly threadStartCount: number;
  readonly turnStartCount: number;
  readonly turnInterruptCount: number;
  readonly compactionCount: number;
  readonly backendSessionRef?: string;
  readonly backendOperationRef?: string;
  readonly failureReasonCode?: IntakeAssistantFailureReasonCode;
}

export type IntakeAssistantOperationResult<Response> =
  | Readonly<{
      kind: 'COMPLETED';
      response: Response;
      observation: IntakeAssistantObservation;
    }>
  | Readonly<{
      kind: 'FAILED';
      failureReasonCode: IntakeAssistantFailureReasonCode;
      observation: IntakeAssistantObservation;
    }>;

export interface IntentAnalysisAssistantInput {
  readonly package: IntakePackage;
  readonly manifest: IntakeManifest;
}

export interface AnswerOnlyAssistantInput {
  readonly package: AnswerOnlyPackage;
  readonly manifest: IntakeManifest;
}

/**
 * The assistant is a non-authoritative external-analysis port. It cannot
 * allocate retained identities, construct Source Bindings, decide Admission,
 * materialize a Goal, start execution, or persist state.
 */
export interface IntakeAssistantPort {
  analyze(
    input: IntentAnalysisAssistantInput,
    signal: AbortSignal,
  ): Promise<IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>>;

  answer(
    input: AnswerOnlyAssistantInput,
    signal: AbortSignal,
  ): Promise<IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1>>;
}

export type CandidateSourceSpanProjectionField =
  | typeof IntentProjectionField.OBJECTIVE
  | typeof IntentProjectionField.REQUIRED_CRITERION
  | typeof IntentProjectionField.SCOPE
  | typeof IntentProjectionField.NON_GOAL
  | typeof IntentProjectionField.ASSUMPTION;
