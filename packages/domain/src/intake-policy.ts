import {
  auditEventId,
  intentAdmissionPolicyId,
  isoTimestamp,
  sha256Digest,
  type AuditEventId,
  type IntentAdmissionPolicyId,
  type IsoTimestamp,
  type Sha256Digest,
} from './identifiers.js';
import { IntentProjectionField, SourceAuthorityClass } from './intake.js';
import type {
  IntakeInteractionAction,
  IntentAdmissionDecisionKind,
  IntentAdmissionOutcome,
  IntentAdmissionReasonCode,
  IntentExecutionDisposition,
  IntakeInteractionAction as IntakeInteractionActionType,
  IntentProjectionField as IntentProjectionFieldType,
  SourceAuthorityClass as SourceAuthorityClassType,
} from './intake.js';
import { DomainInvariantError } from './workflow.js';

export const IntentAdmissionPolicyRuleKind = {
  ANSWER_ONLY_ACTION: 'ANSWER_ONLY_ACTION',
  ABANDON_ACTIVE_QUESTION: 'ABANDON_ACTIVE_QUESTION',
  MATERIAL_FIELD_ELIGIBILITY: 'MATERIAL_FIELD_ELIGIBILITY',
  FIRST_MATERIAL_AMBIGUITY: 'FIRST_MATERIAL_AMBIGUITY',
  MATERIALIZE_ONLY_DISPOSITION: 'MATERIALIZE_ONLY_DISPOSITION',
  GOVERNED_EXECUTION_DISPOSITION: 'GOVERNED_EXECUTION_DISPOSITION',
  DENY_EXACT_PRINCIPAL: 'DENY_EXACT_PRINCIPAL',
  UNSUPPORTED_GOVERNED_EXECUTION: 'UNSUPPORTED_GOVERNED_EXECUTION',
} as const;
export type IntentAdmissionPolicyRuleKind =
  (typeof IntentAdmissionPolicyRuleKind)[keyof typeof IntentAdmissionPolicyRuleKind];

export const IntentAdmissionMaterialFieldKind = {
  OBJECTIVE: 'OBJECTIVE',
  REQUIRED_CRITERIA: 'REQUIRED_CRITERIA',
  OPTIONAL_CRITERIA: 'OPTIONAL_CRITERIA',
  PROJECT_PATH: 'PROJECT_PATH',
  ALLOWED_PATHS: 'ALLOWED_PATHS',
  NON_GOALS: 'NON_GOALS',
  ASSUMPTIONS: 'ASSUMPTIONS',
  REQUESTED_EXECUTION_DISPOSITION: 'REQUESTED_EXECUTION_DISPOSITION',
} as const;
export type IntentAdmissionMaterialFieldKind =
  (typeof IntentAdmissionMaterialFieldKind)[keyof typeof IntentAdmissionMaterialFieldKind];

export const IntentAdmissionFieldCardinality = {
  EXACTLY_ONE: 'EXACTLY_ONE',
  ONE_TO_SIXTEEN: 'ONE_TO_SIXTEEN',
  ZERO_TO_SIXTEEN: 'ZERO_TO_SIXTEEN',
  FIXED_EMPTY: 'FIXED_EMPTY',
  ACTION_DERIVED_ONE: 'ACTION_DERIVED_ONE',
} as const;
export type IntentAdmissionFieldCardinality =
  (typeof IntentAdmissionFieldCardinality)[keyof typeof IntentAdmissionFieldCardinality];

export const IntentAdmissionDerivationRuleId = {
  DECLARED_PROJECT_TO_SCOPE: 'declared-project-to-scope_codeclosure-m2-5-v1',
  INTERACTION_ACTION_TO_DISPOSITION: 'interaction-action-to-disposition_codeclosure-m2-5-v1',
  TRUSTED_POLICY_ALLOWED_PATHS_TO_SCOPE:
    'trusted-policy-allowed-paths-to-scope_codeclosure-m2-5-1-v1',
} as const;
export type IntentAdmissionDerivationRuleId =
  (typeof IntentAdmissionDerivationRuleId)[keyof typeof IntentAdmissionDerivationRuleId];

export const IntentAdmissionRuleId = {
  ANSWER_ONLY_ACTION: 'answer-only_action_codeclosure-m2-5-v1',
  ABANDON_ACTIVE_QUESTION: 'abandon-active-question_codeclosure-m2-5-v1',
  MATERIAL_FIELD_ELIGIBILITY: 'material-field-eligibility_codeclosure-m2-5-v1',
  FIRST_MATERIAL_AMBIGUITY: 'first-material-ambiguity_codeclosure-m2-5-v1',
  MATERIALIZE_ONLY_DISPOSITION: 'materialize-only-disposition_codeclosure-m2-5-v1',
  GOVERNED_EXECUTION_DISPOSITION: 'governed-execution-disposition_codeclosure-m2-5-v1',
  TEST_DENY_EXACT_PRINCIPAL: 'deny-exact-principal_codeclosure-m2-5-test-v1',
  TEST_UNSUPPORTED_GOVERNED_EXECUTION: 'unsupported-governed-execution_codeclosure-m2-5-test-v1',
} as const;
export type IntentAdmissionRuleId =
  (typeof IntentAdmissionRuleId)[keyof typeof IntentAdmissionRuleId];

export interface IntentAdmissionMaterialFieldRule {
  readonly field: IntentAdmissionMaterialFieldKind;
  readonly cardinality: IntentAdmissionFieldCardinality;
  readonly allowedAuthorityClasses: readonly SourceAuthorityClassType[];
  readonly exactDerivationRuleId?: IntentAdmissionDerivationRuleId;
  readonly materializedCriterionRequired?: true;
}

export interface IntentAdmissionDerivationRuleDefinition {
  readonly id: IntentAdmissionDerivationRuleId;
  readonly version: 'codeclosure-m2-5-v1' | 'codeclosure-m2-5-1-v1';
  readonly sourceKind:
    'DECLARED_PROJECT_REF' | 'TRUSTED_INTERACTION_ACTION' | 'TRUSTED_ADMISSION_POLICY';
  readonly targetField:
    | typeof IntentProjectionField.PROJECT_IDENTITY
    | typeof IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION
    | typeof IntentProjectionField.SCOPE;
  readonly meaningPreserving: true;
}

interface IntentAdmissionPolicyRuleBase {
  readonly ruleId: IntentAdmissionRuleId;
  readonly ruleVersion: 'codeclosure-m2-5-v1' | 'codeclosure-m2-5-test-v1';
  readonly kind: IntentAdmissionPolicyRuleKind;
}

export interface AnswerOnlyActionRule extends IntentAdmissionPolicyRuleBase {
  readonly ruleId: typeof IntentAdmissionRuleId.ANSWER_ONLY_ACTION;
  readonly ruleVersion: 'codeclosure-m2-5-v1';
  readonly kind: typeof IntentAdmissionPolicyRuleKind.ANSWER_ONLY_ACTION;
  readonly interactionAction: typeof IntakeInteractionAction.ANSWER_ONLY;
  readonly decisionKind: typeof IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION;
  readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
  readonly reasonCode: typeof IntentAdmissionReasonCode.ANSWER_ONLY;
  readonly executionDisposition: typeof IntentExecutionDisposition.NONE;
}

export interface AbandonActiveQuestionRule extends IntentAdmissionPolicyRuleBase {
  readonly ruleId: typeof IntentAdmissionRuleId.ABANDON_ACTIVE_QUESTION;
  readonly ruleVersion: 'codeclosure-m2-5-v1';
  readonly kind: typeof IntentAdmissionPolicyRuleKind.ABANDON_ACTIVE_QUESTION;
  readonly requiresExactCurrentQuestionBinding: true;
  readonly decisionKind: typeof IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION;
  readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
  readonly reasonCode: typeof IntentAdmissionReasonCode.ABANDONED;
  readonly executionDisposition: typeof IntentExecutionDisposition.NONE;
}

export interface MaterialFieldEligibilityRule extends IntentAdmissionPolicyRuleBase {
  readonly ruleId: typeof IntentAdmissionRuleId.MATERIAL_FIELD_ELIGIBILITY;
  readonly ruleVersion: 'codeclosure-m2-5-v1';
  readonly kind: typeof IntentAdmissionPolicyRuleKind.MATERIAL_FIELD_ELIGIBILITY;
  readonly fields: readonly IntentAdmissionMaterialFieldRule[];
}

export interface FirstMaterialAmbiguityRule extends IntentAdmissionPolicyRuleBase {
  readonly ruleId: typeof IntentAdmissionRuleId.FIRST_MATERIAL_AMBIGUITY;
  readonly ruleVersion: 'codeclosure-m2-5-v1';
  readonly kind: typeof IntentAdmissionPolicyRuleKind.FIRST_MATERIAL_AMBIGUITY;
  readonly fieldPriority: readonly IntentProjectionFieldType[];
  readonly tieBreak: 'SOURCE_BYTE_ORDER';
  readonly maxActiveQuestions: 1;
}

export interface MaterializeOnlyDispositionRule extends IntentAdmissionPolicyRuleBase {
  readonly ruleId: typeof IntentAdmissionRuleId.MATERIALIZE_ONLY_DISPOSITION;
  readonly ruleVersion: 'codeclosure-m2-5-v1';
  readonly kind: typeof IntentAdmissionPolicyRuleKind.MATERIALIZE_ONLY_DISPOSITION;
  readonly interactionAction: typeof IntakeInteractionAction.MATERIALIZE_ONLY;
  readonly decisionKind: typeof IntentAdmissionDecisionKind.MATERIALIZE;
  readonly outcome: typeof IntentAdmissionOutcome.MATERIALIZE;
  readonly reasonCode: typeof IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED;
  readonly executionDisposition: typeof IntentExecutionDisposition.LEAVE_READY;
}

export interface GovernedExecutionDispositionRule extends IntentAdmissionPolicyRuleBase {
  readonly ruleId: typeof IntentAdmissionRuleId.GOVERNED_EXECUTION_DISPOSITION;
  readonly ruleVersion: 'codeclosure-m2-5-v1';
  readonly kind: typeof IntentAdmissionPolicyRuleKind.GOVERNED_EXECUTION_DISPOSITION;
  readonly interactionAction: typeof IntakeInteractionAction.GOVERNED_EXECUTION;
  readonly requiresExactWorkflowPolicyAndProfilePreflight: true;
  readonly decisionKind: typeof IntentAdmissionDecisionKind.MATERIALIZE;
  readonly outcome: typeof IntentAdmissionOutcome.MATERIALIZE;
  readonly reasonCode: typeof IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED;
  readonly executionDisposition: typeof IntentExecutionDisposition.AUTHORIZE_START;
}

export interface DenyExactPrincipalRule extends IntentAdmissionPolicyRuleBase {
  readonly ruleId: typeof IntentAdmissionRuleId.TEST_DENY_EXACT_PRINCIPAL;
  readonly ruleVersion: 'codeclosure-m2-5-test-v1';
  readonly kind: typeof IntentAdmissionPolicyRuleKind.DENY_EXACT_PRINCIPAL;
  readonly principalRef: 'principal_fixture-policy-denied';
  readonly interactionAction: typeof IntakeInteractionAction.MATERIALIZE_ONLY;
  readonly decisionKind: typeof IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION;
  readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
  readonly reasonCode: typeof IntentAdmissionReasonCode.POLICY_DENIED;
  readonly executionDisposition: typeof IntentExecutionDisposition.NONE;
}

export interface UnsupportedGovernedExecutionRule extends IntentAdmissionPolicyRuleBase {
  readonly ruleId: typeof IntentAdmissionRuleId.TEST_UNSUPPORTED_GOVERNED_EXECUTION;
  readonly ruleVersion: 'codeclosure-m2-5-test-v1';
  readonly kind: typeof IntentAdmissionPolicyRuleKind.UNSUPPORTED_GOVERNED_EXECUTION;
  readonly interactionAction: typeof IntakeInteractionAction.GOVERNED_EXECUTION;
  readonly decisionKind: typeof IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION;
  readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
  readonly reasonCode: typeof IntentAdmissionReasonCode.UNSUPPORTED;
  readonly executionDisposition: typeof IntentExecutionDisposition.NONE;
}

export type IntentAdmissionPolicyRule =
  | AnswerOnlyActionRule
  | AbandonActiveQuestionRule
  | MaterialFieldEligibilityRule
  | FirstMaterialAmbiguityRule
  | MaterializeOnlyDispositionRule
  | GovernedExecutionDispositionRule
  | DenyExactPrincipalRule
  | UnsupportedGovernedExecutionRule;

export interface IntentAdmissionPolicyDefinition {
  readonly id: IntentAdmissionPolicyId;
  readonly schemaVersion: 1;
  readonly version: string;
  readonly orderedRules: readonly IntentAdmissionPolicyRule[];
  readonly derivationRules: readonly IntentAdmissionDerivationRuleDefinition[];
  readonly trustedProjectScope?: {
    readonly projectPath: string;
    readonly allowedPaths: readonly string[];
  };
  readonly policyDeniedRuleIds: readonly IntentAdmissionRuleId[];
  readonly unsupportedRuleIds: readonly IntentAdmissionRuleId[];
}

export interface IntentAdmissionPolicy extends IntentAdmissionPolicyDefinition {
  readonly digest: Sha256Digest;
}

export interface IntentAdmissionPolicyInstallInput {
  readonly policy: IntentAdmissionPolicy;
  readonly installedAt: IsoTimestamp;
  readonly auditEventId: AuditEventId;
  readonly payloadDigest: Sha256Digest;
}

function assertKnown<Value extends string>(
  values: Readonly<Record<string, Value>>,
  value: unknown,
  name: string,
): asserts value is Value {
  if (!Object.values(values).some((candidate) => candidate === value)) {
    throw new DomainInvariantError(`${name} is unknown`);
  }
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new DomainInvariantError(`${name} must not be blank`);
  }
}

function assertUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) {
    throw new DomainInvariantError(`${name} must not contain duplicates`);
  }
}

const localAdmissionRuleOrder = [
  IntentAdmissionRuleId.ANSWER_ONLY_ACTION,
  IntentAdmissionRuleId.ABANDON_ACTIVE_QUESTION,
  IntentAdmissionRuleId.MATERIAL_FIELD_ELIGIBILITY,
  IntentAdmissionRuleId.FIRST_MATERIAL_AMBIGUITY,
  IntentAdmissionRuleId.MATERIALIZE_ONLY_DISPOSITION,
  IntentAdmissionRuleId.GOVERNED_EXECUTION_DISPOSITION,
] as const;

const localMaterialFieldRules: readonly IntentAdmissionMaterialFieldRule[] = [
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
    cardinality: IntentAdmissionFieldCardinality.FIXED_EMPTY,
    allowedAuthorityClasses: [],
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
];

const m251ProductionMaterialFieldRules: readonly IntentAdmissionMaterialFieldRule[] =
  localMaterialFieldRules.map((rule) =>
    rule.field === IntentAdmissionMaterialFieldKind.ALLOWED_PATHS
      ? {
          field: IntentAdmissionMaterialFieldKind.ALLOWED_PATHS,
          cardinality: IntentAdmissionFieldCardinality.ONE_TO_SIXTEEN,
          allowedAuthorityClasses: [SourceAuthorityClass.POLICY_DERIVED],
          exactDerivationRuleId:
            IntentAdmissionDerivationRuleId.TRUSTED_POLICY_ALLOWED_PATHS_TO_SCOPE,
        }
      : rule,
  );

const localAmbiguityFieldPriority = [
  IntentProjectionField.PROJECT_IDENTITY,
  IntentProjectionField.OBJECTIVE,
  IntentProjectionField.REQUIRED_CRITERION,
  IntentProjectionField.SCOPE,
  IntentProjectionField.ASSUMPTION,
  IntentProjectionField.NON_GOAL,
] as const;

function assertExactOrderedValues(
  actual: readonly string[],
  expected: readonly string[],
  name: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new DomainInvariantError(`${name} must match the fixed ordered registry`);
  }
}

function materialFieldRuleFingerprint(rule: IntentAdmissionMaterialFieldRule): string {
  return [
    rule.field,
    rule.cardinality,
    rule.allowedAuthorityClasses.join(','),
    rule.exactDerivationRuleId ?? '',
    rule.materializedCriterionRequired === true ? 'required' : '',
  ].join('\u0000');
}

function expectedPolicyRuleOrder(policy: IntentAdmissionPolicyDefinition): readonly string[] {
  const identity = `${policy.id}\u0000${policy.version}`;
  switch (identity) {
    case 'admission-policy_codeclosure-m2-5-local\u0000codeclosure-m2-5-local-admission-v1':
    case 'admission-policy_codeclosure-m2-5-1-production\u0000codeclosure-m2-5-1-production-admission-v1':
      return localAdmissionRuleOrder;
    case 'admission-policy_codeclosure-m2-5-test-deny\u0000codeclosure-m2-5-test-deny-v1':
      return [
        localAdmissionRuleOrder[0],
        IntentAdmissionRuleId.TEST_DENY_EXACT_PRINCIPAL,
        ...localAdmissionRuleOrder.slice(1),
      ];
    case 'admission-policy_codeclosure-m2-5-test-unsupported\u0000codeclosure-m2-5-test-unsupported-v1':
      return [
        localAdmissionRuleOrder[0],
        IntentAdmissionRuleId.TEST_UNSUPPORTED_GOVERNED_EXECUTION,
        ...localAdmissionRuleOrder.slice(1),
      ];
    default:
      throw new DomainInvariantError(
        'Intent Admission Policy identity and version must select one reviewed M2.5 registry',
      );
  }
}

function isM251ProductionPolicy(policy: IntentAdmissionPolicyDefinition): boolean {
  return (
    policy.id === 'admission-policy_codeclosure-m2-5-1-production' &&
    policy.version === 'codeclosure-m2-5-1-production-admission-v1'
  );
}

export function assertIntentAdmissionPolicyDefinitionInvariant(
  policy: IntentAdmissionPolicyDefinition,
): void {
  intentAdmissionPolicyId(policy.id);
  assertNonBlank(policy.version, 'Intent Admission Policy version');
  if (policy.orderedRules.length < 6) {
    throw new DomainInvariantError(
      'Intent Admission Policy must contain the complete local registry',
    );
  }
  const ruleIds = policy.orderedRules.map(({ ruleId }) => ruleId);
  assertUnique(ruleIds, 'Intent Admission Policy rule ID');
  assertExactOrderedValues(
    ruleIds,
    expectedPolicyRuleOrder(policy),
    'Intent Admission Policy rules',
  );
  for (const rule of policy.orderedRules) {
    assertKnown(IntentAdmissionRuleId, rule.ruleId, 'Intent Admission rule ID');
    assertKnown(IntentAdmissionPolicyRuleKind, rule.kind, 'Intent Admission rule kind');
    assertNonBlank(rule.ruleVersion, 'Intent Admission rule version');
    switch (rule.kind) {
      case IntentAdmissionPolicyRuleKind.ANSWER_ONLY_ACTION:
        break;
      case IntentAdmissionPolicyRuleKind.ABANDON_ACTIVE_QUESTION:
        break;
      case IntentAdmissionPolicyRuleKind.MATERIAL_FIELD_ELIGIBILITY: {
        const fields = rule.fields.map(({ field }) => field);
        assertUnique(fields, 'Admission material field');
        if (
          fields.length !== Object.values(IntentAdmissionMaterialFieldKind).length ||
          !Object.values(IntentAdmissionMaterialFieldKind).every((field) => fields.includes(field))
        ) {
          throw new DomainInvariantError(
            'Material-field rule must cover the exact closed field set',
          );
        }
        for (const fieldRule of rule.fields) {
          assertKnown(IntentAdmissionMaterialFieldKind, fieldRule.field, 'Material field');
          assertKnown(IntentAdmissionFieldCardinality, fieldRule.cardinality, 'Field cardinality');
          for (const authorityClass of fieldRule.allowedAuthorityClasses) {
            assertKnown(SourceAuthorityClass, authorityClass, 'Allowed source authority class');
          }
          assertUnique(fieldRule.allowedAuthorityClasses, 'Allowed source authority class');
          if (fieldRule.exactDerivationRuleId !== undefined) {
            assertKnown(
              IntentAdmissionDerivationRuleId,
              fieldRule.exactDerivationRuleId,
              'Exact derivation rule',
            );
          }
        }
        assertExactOrderedValues(
          rule.fields.map(materialFieldRuleFingerprint),
          (isM251ProductionPolicy(policy)
            ? m251ProductionMaterialFieldRules
            : localMaterialFieldRules
          ).map(materialFieldRuleFingerprint),
          'Intent Admission material fields',
        );
        break;
      }
      case IntentAdmissionPolicyRuleKind.FIRST_MATERIAL_AMBIGUITY:
        if (new Set(rule.fieldPriority).size !== rule.fieldPriority.length) {
          throw new DomainInvariantError(
            'Material Ambiguity selection must be singular and ordered',
          );
        }
        assertExactOrderedValues(
          rule.fieldPriority,
          localAmbiguityFieldPriority,
          'Material Ambiguity field priority',
        );
        break;
      case IntentAdmissionPolicyRuleKind.MATERIALIZE_ONLY_DISPOSITION:
        break;
      case IntentAdmissionPolicyRuleKind.GOVERNED_EXECUTION_DISPOSITION:
        break;
      case IntentAdmissionPolicyRuleKind.DENY_EXACT_PRINCIPAL:
        break;
      case IntentAdmissionPolicyRuleKind.UNSUPPORTED_GOVERNED_EXECUTION:
        break;
    }
  }
  const derivationIds = policy.derivationRules.map(({ id }) => id);
  assertUnique(derivationIds, 'Intent Admission derivation rule ID');
  const expectedDerivationIds = isM251ProductionPolicy(policy)
    ? [
        IntentAdmissionDerivationRuleId.DECLARED_PROJECT_TO_SCOPE,
        IntentAdmissionDerivationRuleId.INTERACTION_ACTION_TO_DISPOSITION,
        IntentAdmissionDerivationRuleId.TRUSTED_POLICY_ALLOWED_PATHS_TO_SCOPE,
      ]
    : [
        IntentAdmissionDerivationRuleId.DECLARED_PROJECT_TO_SCOPE,
        IntentAdmissionDerivationRuleId.INTERACTION_ACTION_TO_DISPOSITION,
      ];
  assertExactOrderedValues(
    derivationIds,
    expectedDerivationIds,
    'Intent Admission derivation rules',
  );
  for (const rule of policy.derivationRules) {
    assertKnown(IntentAdmissionDerivationRuleId, rule.id, 'Intent Admission derivation rule ID');
    switch (rule.id) {
      case IntentAdmissionDerivationRuleId.DECLARED_PROJECT_TO_SCOPE:
        if (
          rule.sourceKind !== 'DECLARED_PROJECT_REF' ||
          rule.targetField !== IntentProjectionField.PROJECT_IDENTITY
        ) {
          throw new DomainInvariantError('Declared Project derivation has invalid fixed semantics');
        }
        break;
      case IntentAdmissionDerivationRuleId.INTERACTION_ACTION_TO_DISPOSITION:
        if (
          rule.sourceKind !== 'TRUSTED_INTERACTION_ACTION' ||
          rule.targetField !== IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION
        ) {
          throw new DomainInvariantError(
            'Interaction-action derivation has invalid fixed semantics',
          );
        }
        break;
      case IntentAdmissionDerivationRuleId.TRUSTED_POLICY_ALLOWED_PATHS_TO_SCOPE:
        if (
          rule.version !== 'codeclosure-m2-5-1-v1' ||
          rule.sourceKind !== 'TRUSTED_ADMISSION_POLICY' ||
          rule.targetField !== IntentProjectionField.SCOPE
        ) {
          throw new DomainInvariantError(
            'Trusted allowed-path derivation has invalid fixed semantics',
          );
        }
        break;
    }
  }
  if (isM251ProductionPolicy(policy)) {
    const scope = policy.trustedProjectScope;
    if (
      scope === undefined ||
      scope.projectPath.trim().length === 0 ||
      scope.allowedPaths.length < 1 ||
      scope.allowedPaths.length > 16 ||
      scope.allowedPaths.some((path) => path.trim().length === 0) ||
      new Set(scope.allowedPaths).size !== scope.allowedPaths.length ||
      scope.allowedPaths.some((path, index, paths) => {
        const previous = paths[index - 1];
        return previous !== undefined && path <= previous;
      })
    ) {
      throw new DomainInvariantError(
        'M2.5.1 production Admission Policy requires one exact sorted trusted project scope',
      );
    }
  } else if (policy.trustedProjectScope !== undefined) {
    throw new DomainInvariantError(
      'Historical M2.5 Admission Policies cannot acquire a trusted project scope',
    );
  }
  assertUnique(policy.policyDeniedRuleIds, 'POLICY_DENIED rule ID');
  assertUnique(policy.unsupportedRuleIds, 'UNSUPPORTED rule ID');
  for (const ruleId of [...policy.policyDeniedRuleIds, ...policy.unsupportedRuleIds]) {
    if (!ruleIds.includes(ruleId)) {
      throw new DomainInvariantError('Admission reason collection references an absent rule');
    }
  }
  const deniedRuleIds = policy.orderedRules
    .filter(({ kind }) => kind === IntentAdmissionPolicyRuleKind.DENY_EXACT_PRINCIPAL)
    .map(({ ruleId }) => ruleId);
  const unsupportedRuleIds = policy.orderedRules
    .filter(({ kind }) => kind === IntentAdmissionPolicyRuleKind.UNSUPPORTED_GOVERNED_EXECUTION)
    .map(({ ruleId }) => ruleId);
  if (deniedRuleIds.join('\u0000') !== policy.policyDeniedRuleIds.join('\u0000')) {
    throw new DomainInvariantError('POLICY_DENIED collection must match the ordered rule registry');
  }
  if (unsupportedRuleIds.join('\u0000') !== policy.unsupportedRuleIds.join('\u0000')) {
    throw new DomainInvariantError('UNSUPPORTED collection must match the ordered rule registry');
  }
}

export function assertIntentAdmissionPolicyInvariant(policy: IntentAdmissionPolicy): void {
  assertIntentAdmissionPolicyDefinitionInvariant(policy);
  sha256Digest(policy.digest);
}

export function assertIntentAdmissionPolicyInstallInputInvariant(
  input: IntentAdmissionPolicyInstallInput,
): void {
  assertIntentAdmissionPolicyInvariant(input.policy);
  isoTimestamp(input.installedAt);
  auditEventId(input.auditEventId);
  sha256Digest(input.payloadDigest);
  if (input.payloadDigest !== input.policy.digest) {
    throw new DomainInvariantError('Admission Policy install payload must use the Policy digest');
  }
}

export function intentAdmissionPolicyProjection(policy: IntentAdmissionPolicyDefinition): unknown {
  return {
    id: policy.id,
    schemaVersion: policy.schemaVersion,
    version: policy.version,
    orderedRules: policy.orderedRules,
    derivationRules: policy.derivationRules,
    ...(policy.trustedProjectScope === undefined
      ? {}
      : { trustedProjectScope: policy.trustedProjectScope }),
    policyDeniedRuleIds: policy.policyDeniedRuleIds,
    unsupportedRuleIds: policy.unsupportedRuleIds,
  };
}

export function isAdmissionRuleForAction(
  rule: IntentAdmissionPolicyRule,
  action: IntakeInteractionActionType,
): boolean {
  return 'interactionAction' in rule && rule.interactionAction === action;
}
