import {
  IntakeInteractionAction,
  IntentAdmissionDecisionKind,
  IntentAdmissionDerivationRuleId,
  IntentAdmissionFieldCardinality,
  IntentAdmissionMaterialFieldKind,
  IntentAdmissionOutcome,
  IntentAdmissionPolicyRuleKind,
  IntentAdmissionReasonCode,
  IntentAdmissionRuleId,
  IntentExecutionDisposition,
  IntentProjectionField,
  SourceAuthorityClass,
  decodeIntentAdmissionPolicy,
  decodeIntentAdmissionPolicyDefinition,
  intentAdmissionPolicyId,
  intentAdmissionPolicyProjection,
  principalId,
  sha256Digest,
  type IntakeDigestVerifier,
  type IntentAdmissionPolicy,
  type IntentAdmissionPolicyDefinition,
} from '@codeclosure/domain';

export const M25_LOCAL_ADMISSION_POLICY_ID = intentAdmissionPolicyId(
  'admission-policy_codeclosure-m2-5-local',
);
export const M25_LOCAL_ADMISSION_POLICY_VERSION = 'codeclosure-m2-5-local-admission-v1';
export const M251_PRODUCTION_ADMISSION_POLICY_ID = intentAdmissionPolicyId(
  'admission-policy_codeclosure-m2-5-1-production',
);
export const M251_PRODUCTION_ADMISSION_POLICY_VERSION =
  'codeclosure-m2-5-1-production-admission-v1';
export const M25_TEST_DENY_ADMISSION_POLICY_ID = intentAdmissionPolicyId(
  'admission-policy_codeclosure-m2-5-test-deny',
);
export const M25_TEST_DENY_ADMISSION_POLICY_VERSION = 'codeclosure-m2-5-test-deny-v1';
export const M25_TEST_UNSUPPORTED_ADMISSION_POLICY_ID = intentAdmissionPolicyId(
  'admission-policy_codeclosure-m2-5-test-unsupported',
);
export const M25_TEST_UNSUPPORTED_ADMISSION_POLICY_VERSION = 'codeclosure-m2-5-test-unsupported-v1';
export const M25_TEST_DENIED_PRINCIPAL_ID = principalId('principal_fixture-policy-denied');

const LOCAL_RULE_VERSION = 'codeclosure-m2-5-v1';
const TEST_RULE_VERSION = 'codeclosure-m2-5-test-v1';

function localRuleRegistry(
  options: { readonly trustedAllowedPaths: boolean } = {
    trustedAllowedPaths: false,
  },
): readonly unknown[] {
  return [
    {
      ruleId: IntentAdmissionRuleId.ANSWER_ONLY_ACTION,
      ruleVersion: LOCAL_RULE_VERSION,
      kind: IntentAdmissionPolicyRuleKind.ANSWER_ONLY_ACTION,
      interactionAction: IntakeInteractionAction.ANSWER_ONLY,
      decisionKind: IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION,
      outcome: IntentAdmissionOutcome.NO_EXECUTION,
      reasonCode: IntentAdmissionReasonCode.ANSWER_ONLY,
      executionDisposition: IntentExecutionDisposition.NONE,
    },
    {
      ruleId: IntentAdmissionRuleId.ABANDON_ACTIVE_QUESTION,
      ruleVersion: LOCAL_RULE_VERSION,
      kind: IntentAdmissionPolicyRuleKind.ABANDON_ACTIVE_QUESTION,
      requiresExactCurrentQuestionBinding: true,
      decisionKind: IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION,
      outcome: IntentAdmissionOutcome.NO_EXECUTION,
      reasonCode: IntentAdmissionReasonCode.ABANDONED,
      executionDisposition: IntentExecutionDisposition.NONE,
    },
    {
      ruleId: IntentAdmissionRuleId.MATERIAL_FIELD_ELIGIBILITY,
      ruleVersion: LOCAL_RULE_VERSION,
      kind: IntentAdmissionPolicyRuleKind.MATERIAL_FIELD_ELIGIBILITY,
      fields: [
        {
          field: IntentAdmissionMaterialFieldKind.OBJECTIVE,
          cardinality: IntentAdmissionFieldCardinality.EXACTLY_ONE,
          allowedAuthorityClasses: [SourceAuthorityClass.USER_STATED],
        },
        {
          field: IntentAdmissionMaterialFieldKind.REQUIRED_CRITERIA,
          cardinality: IntentAdmissionFieldCardinality.ONE_TO_SIXTEEN,
          allowedAuthorityClasses: [SourceAuthorityClass.USER_STATED],
          materializedCriterionRequired: true,
        },
        {
          field: IntentAdmissionMaterialFieldKind.OPTIONAL_CRITERIA,
          cardinality: IntentAdmissionFieldCardinality.FIXED_EMPTY,
          allowedAuthorityClasses: [],
        },
        {
          field: IntentAdmissionMaterialFieldKind.PROJECT_PATH,
          cardinality: IntentAdmissionFieldCardinality.EXACTLY_ONE,
          allowedAuthorityClasses: [SourceAuthorityClass.POLICY_DERIVED],
          exactDerivationRuleId: IntentAdmissionDerivationRuleId.DECLARED_PROJECT_TO_SCOPE,
        },
        {
          field: IntentAdmissionMaterialFieldKind.ALLOWED_PATHS,
          cardinality: options.trustedAllowedPaths
            ? IntentAdmissionFieldCardinality.ONE_TO_SIXTEEN
            : IntentAdmissionFieldCardinality.FIXED_EMPTY,
          allowedAuthorityClasses: options.trustedAllowedPaths
            ? [SourceAuthorityClass.POLICY_DERIVED]
            : [],
          ...(options.trustedAllowedPaths
            ? {
                exactDerivationRuleId:
                  IntentAdmissionDerivationRuleId.TRUSTED_POLICY_ALLOWED_PATHS_TO_SCOPE,
              }
            : {}),
        },
        {
          field: IntentAdmissionMaterialFieldKind.NON_GOALS,
          cardinality: IntentAdmissionFieldCardinality.ZERO_TO_SIXTEEN,
          allowedAuthorityClasses: [SourceAuthorityClass.USER_STATED],
        },
        {
          field: IntentAdmissionMaterialFieldKind.ASSUMPTIONS,
          cardinality: IntentAdmissionFieldCardinality.FIXED_EMPTY,
          allowedAuthorityClasses: [],
        },
        {
          field: IntentAdmissionMaterialFieldKind.REQUESTED_EXECUTION_DISPOSITION,
          cardinality: IntentAdmissionFieldCardinality.ACTION_DERIVED_ONE,
          allowedAuthorityClasses: [SourceAuthorityClass.POLICY_DERIVED],
          exactDerivationRuleId: IntentAdmissionDerivationRuleId.INTERACTION_ACTION_TO_DISPOSITION,
        },
      ],
    },
    {
      ruleId: IntentAdmissionRuleId.FIRST_MATERIAL_AMBIGUITY,
      ruleVersion: LOCAL_RULE_VERSION,
      kind: IntentAdmissionPolicyRuleKind.FIRST_MATERIAL_AMBIGUITY,
      fieldPriority: [
        IntentProjectionField.PROJECT_IDENTITY,
        IntentProjectionField.OBJECTIVE,
        IntentProjectionField.REQUIRED_CRITERION,
        IntentProjectionField.SCOPE,
        IntentProjectionField.ASSUMPTION,
        IntentProjectionField.NON_GOAL,
      ],
      tieBreak: 'SOURCE_BYTE_ORDER',
      maxActiveQuestions: 1,
    },
    {
      ruleId: IntentAdmissionRuleId.MATERIALIZE_ONLY_DISPOSITION,
      ruleVersion: LOCAL_RULE_VERSION,
      kind: IntentAdmissionPolicyRuleKind.MATERIALIZE_ONLY_DISPOSITION,
      interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
      decisionKind: IntentAdmissionDecisionKind.MATERIALIZE,
      outcome: IntentAdmissionOutcome.MATERIALIZE,
      reasonCode: IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED,
      executionDisposition: IntentExecutionDisposition.LEAVE_READY,
    },
    {
      ruleId: IntentAdmissionRuleId.GOVERNED_EXECUTION_DISPOSITION,
      ruleVersion: LOCAL_RULE_VERSION,
      kind: IntentAdmissionPolicyRuleKind.GOVERNED_EXECUTION_DISPOSITION,
      interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
      requiresExactWorkflowPolicyAndProfilePreflight: true,
      decisionKind: IntentAdmissionDecisionKind.MATERIALIZE,
      outcome: IntentAdmissionOutcome.MATERIALIZE,
      reasonCode: IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED,
      executionDisposition: IntentExecutionDisposition.AUTHORIZE_START,
    },
  ];
}

function derivationRuleRegistry(
  options: { readonly trustedAllowedPaths: boolean } = {
    trustedAllowedPaths: false,
  },
): readonly unknown[] {
  return [
    {
      id: IntentAdmissionDerivationRuleId.DECLARED_PROJECT_TO_SCOPE,
      version: LOCAL_RULE_VERSION,
      sourceKind: 'DECLARED_PROJECT_REF',
      targetField: IntentProjectionField.PROJECT_IDENTITY,
      meaningPreserving: true,
    },
    {
      id: IntentAdmissionDerivationRuleId.INTERACTION_ACTION_TO_DISPOSITION,
      version: LOCAL_RULE_VERSION,
      sourceKind: 'TRUSTED_INTERACTION_ACTION',
      targetField: IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION,
      meaningPreserving: true,
    },
    ...(options.trustedAllowedPaths
      ? [
          {
            id: IntentAdmissionDerivationRuleId.TRUSTED_POLICY_ALLOWED_PATHS_TO_SCOPE,
            version: 'codeclosure-m2-5-1-v1',
            sourceKind: 'TRUSTED_ADMISSION_POLICY',
            targetField: IntentProjectionField.SCOPE,
            meaningPreserving: true,
          },
        ]
      : []),
  ];
}

function decodeDefinition(value: unknown): IntentAdmissionPolicyDefinition {
  return decodeIntentAdmissionPolicyDefinition(value);
}

export function createM25LocalAdmissionPolicyDefinition(): IntentAdmissionPolicyDefinition {
  return decodeDefinition({
    id: M25_LOCAL_ADMISSION_POLICY_ID,
    schemaVersion: 1,
    version: M25_LOCAL_ADMISSION_POLICY_VERSION,
    orderedRules: localRuleRegistry(),
    derivationRules: derivationRuleRegistry(),
    policyDeniedRuleIds: [],
    unsupportedRuleIds: [],
  });
}

export function createM251ProductionAdmissionPolicyDefinition(input: {
  readonly projectPath: string;
  readonly allowedPaths: readonly string[];
}): IntentAdmissionPolicyDefinition {
  const trustedProjectScope = Object.freeze({
    projectPath: input.projectPath,
    allowedPaths: Object.freeze([...input.allowedPaths].toSorted()),
  });
  return decodeDefinition({
    id: M251_PRODUCTION_ADMISSION_POLICY_ID,
    schemaVersion: 1,
    version: M251_PRODUCTION_ADMISSION_POLICY_VERSION,
    orderedRules: localRuleRegistry({ trustedAllowedPaths: true }),
    derivationRules: derivationRuleRegistry({ trustedAllowedPaths: true }),
    trustedProjectScope,
    policyDeniedRuleIds: [],
    unsupportedRuleIds: [],
  });
}

export function createM25TestDenyAdmissionPolicyDefinition(): IntentAdmissionPolicyDefinition {
  const local = createM25LocalAdmissionPolicyDefinition();
  const denyRule = {
    ruleId: IntentAdmissionRuleId.TEST_DENY_EXACT_PRINCIPAL,
    ruleVersion: TEST_RULE_VERSION,
    kind: IntentAdmissionPolicyRuleKind.DENY_EXACT_PRINCIPAL,
    principalRef: M25_TEST_DENIED_PRINCIPAL_ID,
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    decisionKind: IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION,
    outcome: IntentAdmissionOutcome.NO_EXECUTION,
    reasonCode: IntentAdmissionReasonCode.POLICY_DENIED,
    executionDisposition: IntentExecutionDisposition.NONE,
  };
  return decodeDefinition({
    ...local,
    id: M25_TEST_DENY_ADMISSION_POLICY_ID,
    version: M25_TEST_DENY_ADMISSION_POLICY_VERSION,
    orderedRules: [local.orderedRules[0], denyRule, ...local.orderedRules.slice(1)],
    policyDeniedRuleIds: [IntentAdmissionRuleId.TEST_DENY_EXACT_PRINCIPAL],
  });
}

export function createM25TestUnsupportedAdmissionPolicyDefinition(): IntentAdmissionPolicyDefinition {
  const local = createM25LocalAdmissionPolicyDefinition();
  const unsupportedRule = {
    ruleId: IntentAdmissionRuleId.TEST_UNSUPPORTED_GOVERNED_EXECUTION,
    ruleVersion: TEST_RULE_VERSION,
    kind: IntentAdmissionPolicyRuleKind.UNSUPPORTED_GOVERNED_EXECUTION,
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    decisionKind: IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION,
    outcome: IntentAdmissionOutcome.NO_EXECUTION,
    reasonCode: IntentAdmissionReasonCode.UNSUPPORTED,
    executionDisposition: IntentExecutionDisposition.NONE,
  };
  return decodeDefinition({
    ...local,
    id: M25_TEST_UNSUPPORTED_ADMISSION_POLICY_ID,
    version: M25_TEST_UNSUPPORTED_ADMISSION_POLICY_VERSION,
    orderedRules: [local.orderedRules[0], unsupportedRule, ...local.orderedRules.slice(1)],
    unsupportedRuleIds: [IntentAdmissionRuleId.TEST_UNSUPPORTED_GOVERNED_EXECUTION],
  });
}

export function createM25AdmissionPolicy(
  definition: IntentAdmissionPolicyDefinition,
  digests: IntakeDigestVerifier,
): IntentAdmissionPolicy {
  const digest = sha256Digest(digests.digest(intentAdmissionPolicyProjection(definition)));
  return decodeIntentAdmissionPolicy({ ...definition, digest }, digests);
}
