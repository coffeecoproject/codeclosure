import { Buffer } from 'node:buffer';

import {
  ClarificationAnswerSchemaKind,
  IntentAdmissionDerivationRuleId,
  IntentExecutionDisposition,
  IntentProjectionCanonicalProfileVersion,
  IntentProjectionField,
  MaterialAmbiguityReasonCode,
  MaterialAmbiguityStatus,
  SourceAuthorityClass,
  assertIntentProjectionAmbiguityClosure,
  clarificationQuestionSpecProjection,
  decodeClarificationQuestionSpec,
  decodeIntentAnalysisProposal,
  decodeIntentProjectionRevision,
  decodeMaterialAmbiguitySet,
  decodeRawRequestRevision,
  decodeSourceBinding,
  intentAnalysisProposalProjection,
  intentProjectionRevision,
  intentProjectionRevisionProjection,
  materialAmbiguitySetProjection,
  rawRequestRevision,
  sourceBindingProjection,
  type ClarificationQuestionSpec,
  type ClarificationQuestionSpecProjectionInput,
  type CandidateSourceSpanSuggestion,
  type IntakeExternalOperationBinding,
  type IntakeDigestVerifier,
  type IntentAdmissionPolicy,
  type IntentAnalysisProposal,
  type IntentAnalysisProposalId,
  type IntentAnalysisProposalProjectionInput,
  type IntentProjectionId,
  type IntentProjectionRevisionRecord,
  type IntentProjectionRevisionProjectionInput,
  type IsoTimestamp,
  type MaterialAmbiguity,
  type MaterialAmbiguityId,
  type MaterialAmbiguitySet,
  type MaterialAmbiguitySetProjectionInput,
  type RawRequestRevisionRecord,
  type SourceBinding,
  type SourceBindingProjectionInput,
} from '@codeclosure/domain';
import { z } from 'zod';

import {
  M25_INTAKE_ASSISTANT_ADAPTER_ID,
  M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
  M251_INTAKE_ASSISTANT_ADAPTER_VERSION,
  M251_LIVE_INTAKE_ASSISTANT_ADAPTER_VERSION,
  m25IntakeBudgetDefinition,
  type IntentAnalysisAssistantResponseV1,
} from './intake-assistant.js';
import type { Canonicalizer, DigestProvider } from './ports.js';

export const M25_INTENT_PROJECTION_PROFILE_VERSION =
  IntentProjectionCanonicalProfileVersion.M25_LOCAL_V2;
export const M251_INTENT_PROJECTION_PROFILE_VERSION =
  IntentProjectionCanonicalProfileVersion.M251_EXACT_VALUE_MATCH_V3;
export const M251_TRUSTED_SCOPE_PROJECTION_PROFILE_VERSION =
  IntentProjectionCanonicalProfileVersion.M251_TRUSTED_SCOPE_V4;
export const M25_DERIVATION_RULE_VERSION = 'codeclosure-m2-5-v1';
export const M251_DERIVATION_RULE_VERSION = 'codeclosure-m2-5-1-v1';

export class IntakeAnalysisResponseRejectedError extends TypeError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IntakeAnalysisResponseRejectedError';
  }
}

const nonBlank = z.string().refine((value) => value.trim().length > 0, {
  message: 'must not be blank',
});
const suggestionSchema = z
  .object({
    projectionFieldRef: z.enum([
      IntentProjectionField.OBJECTIVE,
      IntentProjectionField.REQUIRED_CRITERION,
      IntentProjectionField.SCOPE,
      IntentProjectionField.NON_GOAL,
      IntentProjectionField.ASSUMPTION,
    ]),
    itemIndex: z.number().int().nonnegative().optional(),
    rawRequestRevision: z.number().int().positive(),
    startByte: z.number().int().nonnegative(),
    endByte: z.number().int().positive(),
  })
  .strict();
const responseSchema = z
  .object({
    proposedObjective: nonBlank.optional(),
    proposedCriteria: z.array(nonBlank).max(m25IntakeBudgetDefinition.maximumProposedCriteria),
    proposedScope: nonBlank.optional(),
    proposedNonGoals: z.array(nonBlank).max(m25IntakeBudgetDefinition.maximumProposedNonGoals),
    proposedAssumptions: z
      .array(nonBlank)
      .max(m25IntakeBudgetDefinition.maximumProposedAssumptions),
    proposedQuestions: z.array(nonBlank).max(m25IntakeBudgetDefinition.maximumProposedQuestions),
    candidateSourceSpanSuggestions: z
      .array(suggestionSchema)
      .max(m25IntakeBudgetDefinition.maximumCandidateSourceSpanSuggestions),
    proposedClassification: nonBlank.optional(),
  })
  .strict();

const collectionFields = new Set<IntentProjectionField>([
  IntentProjectionField.REQUIRED_CRITERION,
  IntentProjectionField.NON_GOAL,
  IntentProjectionField.ASSUMPTION,
]);

const ambiguityPriority = new Map<IntentProjectionField, number>([
  [IntentProjectionField.PROJECT_IDENTITY, 0],
  [IntentProjectionField.OBJECTIVE, 1],
  [IntentProjectionField.REQUIRED_CRITERION, 2],
  [IntentProjectionField.SCOPE, 3],
  [IntentProjectionField.ASSUMPTION, 4],
  [IntentProjectionField.NON_GOAL, 5],
]);

export const M25_CLARIFICATION_QUESTION_PROMPTS: Readonly<
  Record<MaterialAmbiguityReasonCode, string>
> = Object.freeze({
  [MaterialAmbiguityReasonCode.PROJECT_IDENTITY_UNRESOLVED]:
    'Which exact local project path should this request target?',
  [MaterialAmbiguityReasonCode.OBJECTIVE_UNRESOLVED]:
    'What exact objective should the formal Goal use?',
  [MaterialAmbiguityReasonCode.REQUIRED_CRITERION_UNRESOLVED]:
    'What exact required success criterion should the formal Goal use?',
  [MaterialAmbiguityReasonCode.SCOPE_UNRESOLVED]:
    'Please restate the exact bounded scope that the formal Goal must preserve.',
  [MaterialAmbiguityReasonCode.ASSUMPTION_UNRESOLVED]:
    'Please restate this assumption as explicit objective, criterion, scope, or non-goal content.',
  [MaterialAmbiguityReasonCode.NON_GOAL_UNRESOLVED]:
    'What exact non-goal should the formal Goal preserve?',
});

export interface IntentProjectionIdentityGenerator {
  nextIntentAnalysisProposalId(): IntentAnalysisProposalId;
  nextIntentProjectionId(): IntentProjectionId;
  nextMaterialAmbiguityId(): MaterialAmbiguityId;
}

export interface ProjectIntentAnalysisInput {
  readonly intakeRunId: string;
  readonly rawRequestRevisions: readonly RawRequestRevisionRecord[];
  readonly currentProjection?: IntentProjectionRevisionRecord;
  readonly admissionPolicy: IntentAdmissionPolicy;
  readonly intentAnalysisIdentity: Pick<
    IntakeExternalOperationBinding,
    'assistantAdapterId' | 'assistantAdapterVersion' | 'responseContractDigest'
  >;
  readonly response: IntentAnalysisAssistantResponseV1;
  readonly observedAt: IsoTimestamp;
  readonly ids: IntentProjectionIdentityGenerator;
}

export interface ProjectedIntentAnalysis {
  readonly proposal: IntentAnalysisProposal;
  readonly projection: IntentProjectionRevisionRecord;
  readonly ambiguitySet: MaterialAmbiguitySet;
  readonly clarificationQuestionSpec?: ClarificationQuestionSpec;
}

interface FieldItem {
  readonly field: CandidateSourceSpanSuggestion['projectionFieldRef'];
  readonly itemIndex?: number;
  readonly value: string;
}

interface BoundFieldItem extends FieldItem {
  readonly bindings: readonly SourceBinding[];
}

function proposalSourceFieldPath(item: FieldItem): string {
  const indexedPath = (field: string): string => {
    if (item.itemIndex === undefined) {
      throw new TypeError('Collection Proposal source path requires an item index');
    }
    return `/${field}/${String(item.itemIndex)}`;
  };
  switch (item.field) {
    case IntentProjectionField.OBJECTIVE:
      return '/proposedObjective';
    case IntentProjectionField.REQUIRED_CRITERION:
      return indexedPath('proposedCriteria');
    case IntentProjectionField.SCOPE:
      return '/proposedScope';
    case IntentProjectionField.NON_GOAL:
      return indexedPath('proposedNonGoals');
    case IntentProjectionField.ASSUMPTION:
      return indexedPath('proposedAssumptions');
    default:
      throw new TypeError('Projection field has no Intent Analysis Proposal source path');
  }
}

function assertUniqueStrings(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must not contain duplicate byte-identical values`);
  }
}

function assertUtf8Bytes(value: string, maximum: number, field: string): void {
  if (Buffer.byteLength(value, 'utf8') > maximum) {
    throw new TypeError(`${field} exceeds the fixed Intake budget`);
  }
}

function validateResponse(
  value: unknown,
  canonicalizer: Canonicalizer,
): IntentAnalysisAssistantResponseV1 {
  const response = responseSchema.parse(value);
  if (
    Buffer.byteLength(canonicalizer.canonicalize(response), 'utf8') >
    m25IntakeBudgetDefinition.maximumIntentAnalysisResponseBytes
  ) {
    throw new TypeError('Intent-analysis response exceeds its canonical byte budget');
  }
  assertUniqueStrings(response.proposedCriteria, 'proposedCriteria');
  assertUniqueStrings(response.proposedNonGoals, 'proposedNonGoals');
  assertUniqueStrings(response.proposedAssumptions, 'proposedAssumptions');
  assertUniqueStrings(response.proposedQuestions, 'proposedQuestions');
  if (response.proposedObjective !== undefined) {
    assertUtf8Bytes(
      response.proposedObjective,
      m25IntakeBudgetDefinition.maximumProposedObjectiveBytes,
      'proposedObjective',
    );
  }
  if (response.proposedScope !== undefined) {
    assertUtf8Bytes(
      response.proposedScope,
      m25IntakeBudgetDefinition.maximumProposedScopeBytes,
      'proposedScope',
    );
  }
  response.proposedCriteria.forEach((entry) =>
    assertUtf8Bytes(
      entry,
      m25IntakeBudgetDefinition.maximumProposedCriterionBytes,
      'proposedCriteria item',
    ),
  );
  response.proposedNonGoals.forEach((entry) =>
    assertUtf8Bytes(
      entry,
      m25IntakeBudgetDefinition.maximumProposedNonGoalBytes,
      'proposedNonGoals item',
    ),
  );
  response.proposedAssumptions.forEach((entry) =>
    assertUtf8Bytes(
      entry,
      m25IntakeBudgetDefinition.maximumProposedAssumptionBytes,
      'proposedAssumptions item',
    ),
  );
  response.proposedQuestions.forEach((entry) =>
    assertUtf8Bytes(
      entry,
      m25IntakeBudgetDefinition.maximumProposedQuestionBytes,
      'proposedQuestions item',
    ),
  );
  if (response.proposedClassification !== undefined) {
    assertUtf8Bytes(
      response.proposedClassification,
      m25IntakeBudgetDefinition.maximumProposedClassificationBytes,
      'proposedClassification',
    );
  }
  for (const suggestion of response.candidateSourceSpanSuggestions) {
    const requiresIndex = collectionFields.has(suggestion.projectionFieldRef);
    if (
      requiresIndex !== (suggestion.itemIndex !== undefined) ||
      suggestion.endByte <= suggestion.startByte
    ) {
      throw new TypeError('Candidate Source Span field/item coordinates are invalid');
    }
  }
  return {
    ...(response.proposedObjective === undefined
      ? {}
      : { proposedObjective: response.proposedObjective }),
    proposedCriteria: response.proposedCriteria,
    ...(response.proposedScope === undefined ? {} : { proposedScope: response.proposedScope }),
    proposedNonGoals: response.proposedNonGoals,
    proposedAssumptions: response.proposedAssumptions,
    proposedQuestions: response.proposedQuestions,
    candidateSourceSpanSuggestions: response.candidateSourceSpanSuggestions.map((suggestion) => ({
      projectionFieldRef: suggestion.projectionFieldRef,
      ...(suggestion.itemIndex === undefined ? {} : { itemIndex: suggestion.itemIndex }),
      rawRequestRevision: rawRequestRevision(suggestion.rawRequestRevision),
      startByte: suggestion.startByte,
      endByte: suggestion.endByte,
    })),
    ...(response.proposedClassification === undefined
      ? {}
      : { proposedClassification: response.proposedClassification }),
  };
}

function valueForSuggestion(
  response: IntentAnalysisAssistantResponseV1,
  field: IntentProjectionField,
  itemIndex: number | undefined,
): string | undefined {
  switch (field) {
    case IntentProjectionField.OBJECTIVE:
      return response.proposedObjective;
    case IntentProjectionField.SCOPE:
      return response.proposedScope;
    case IntentProjectionField.REQUIRED_CRITERION:
      return itemIndex === undefined ? undefined : response.proposedCriteria[itemIndex];
    case IntentProjectionField.NON_GOAL:
      return itemIndex === undefined ? undefined : response.proposedNonGoals[itemIndex];
    case IntentProjectionField.ASSUMPTION:
      return itemIndex === undefined ? undefined : response.proposedAssumptions[itemIndex];
    default:
      return undefined;
  }
}

function utf8Boundaries(value: string): ReadonlySet<number> {
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const scalar of value) {
    offset += Buffer.byteLength(scalar, 'utf8');
    boundaries.add(offset);
  }
  return boundaries;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fieldItemsFor(response: IntentAnalysisAssistantResponseV1): readonly FieldItem[] {
  return Object.freeze([
    ...(response.proposedObjective === undefined
      ? []
      : [{ field: IntentProjectionField.OBJECTIVE, value: response.proposedObjective }]),
    ...response.proposedCriteria.map((value, itemIndex) => ({
      field: IntentProjectionField.REQUIRED_CRITERION,
      itemIndex,
      value,
    })),
    ...(response.proposedScope === undefined
      ? []
      : [{ field: IntentProjectionField.SCOPE, value: response.proposedScope }]),
    ...response.proposedNonGoals.map((value, itemIndex) => ({
      field: IntentProjectionField.NON_GOAL,
      itemIndex,
      value,
    })),
    ...response.proposedAssumptions.map((value, itemIndex) => ({
      field: IntentProjectionField.ASSUMPTION,
      itemIndex,
      value,
    })),
  ]);
}

function exactValueMatchSuggestions(
  response: IntentAnalysisAssistantResponseV1,
  revisions: readonly RawRequestRevisionRecord[],
): readonly CandidateSourceSpanSuggestion[] {
  if (response.candidateSourceSpanSuggestions.length !== 0) {
    throw new IntakeAnalysisResponseRejectedError(
      'M2.5.1 exact-value projection rejects assistant-authored source coordinates',
    );
  }
  const suggestions: CandidateSourceSpanSuggestion[] = [];
  for (const item of fieldItemsFor(response)) {
    const needle = Buffer.from(item.value, 'utf8');
    for (const revision of revisions) {
      const source = Buffer.from(revision.admittedUserContent, 'utf8');
      const boundaries = utf8Boundaries(revision.admittedUserContent);
      let offset = source.indexOf(needle);
      while (offset !== -1) {
        const endByte = offset + needle.length;
        if (boundaries.has(offset) && boundaries.has(endByte)) {
          suggestions.push(
            Object.freeze({
              projectionFieldRef: item.field,
              ...(item.itemIndex === undefined ? {} : { itemIndex: item.itemIndex }),
              rawRequestRevision: revision.revision,
              startByte: offset,
              endByte,
            }),
          );
          if (
            suggestions.length > m25IntakeBudgetDefinition.maximumCandidateSourceSpanSuggestions
          ) {
            throw new IntakeAnalysisResponseRejectedError(
              'M2.5.1 exact-value projection exceeds the fixed source-binding budget',
            );
          }
        }
        offset = source.indexOf(needle, offset + 1);
      }
    }
  }
  return Object.freeze(suggestions);
}

/** Deterministically converts one validated assistant Proposal into non-authoritative Projection authority. */
export class M25IntentProjectionCompiler {
  readonly #canonicalizer: Canonicalizer;
  readonly #digests: DigestProvider & IntakeDigestVerifier;

  public constructor(options: {
    readonly canonicalizer: Canonicalizer;
    readonly digests: DigestProvider & IntakeDigestVerifier;
  }) {
    this.#canonicalizer = options.canonicalizer;
    this.#digests = options.digests;
  }

  public project(input: ProjectIntentAnalysisInput): ProjectedIntentAnalysis {
    let response: IntentAnalysisAssistantResponseV1;
    try {
      response = validateResponse(input.response, this.#canonicalizer);
    } catch (error) {
      throw new IntakeAnalysisResponseRejectedError(
        'Intent-analysis response failed bounded semantic validation',
        { cause: error },
      );
    }
    const revisions = input.rawRequestRevisions.map((revision) =>
      decodeRawRequestRevision(revision, this.#digests),
    );
    if (
      revisions.length === 0 ||
      revisions.length > m25IntakeBudgetDefinition.maximumRawRequestRevisions
    ) {
      throw new TypeError('Projection requires one bounded Raw Request revision chain');
    }
    const current = revisions.at(-1);
    if (current?.intakeRunId !== input.intakeRunId) {
      throw new TypeError('Projection current Raw Request revision does not belong to the Intake');
    }
    revisions.forEach((revision, index) => {
      if (
        revision.intakeRunId !== input.intakeRunId ||
        revision.rawRequestId !== current.rawRequestId ||
        revision.revision !== index + 1
      ) {
        throw new TypeError('Projection Raw Request revisions must form one exact ordered chain');
      }
    });
    if (
      input.intentAnalysisIdentity.assistantAdapterId !== M25_INTAKE_ASSISTANT_ADAPTER_ID ||
      (input.intentAnalysisIdentity.assistantAdapterVersion !==
        M25_INTAKE_ASSISTANT_ADAPTER_VERSION &&
        input.intentAnalysisIdentity.assistantAdapterVersion !==
          M251_INTAKE_ASSISTANT_ADAPTER_VERSION &&
        input.intentAnalysisIdentity.assistantAdapterVersion !==
          M251_LIVE_INTAKE_ASSISTANT_ADAPTER_VERSION)
    ) {
      throw new TypeError('Projection selects an unsupported Intake Assistant identity');
    }
    const currentProjection =
      input.currentProjection === undefined
        ? undefined
        : decodeIntentProjectionRevision(input.currentProjection, this.#digests);
    if (
      currentProjection !== undefined &&
      (currentProjection.intakeRunId !== input.intakeRunId ||
        currentProjection.revision !== input.currentProjection?.revision)
    ) {
      throw new TypeError('Parent Projection does not belong to the current Intake snapshot');
    }

    const proposalBase = {
      id: input.ids.nextIntentAnalysisProposalId(),
      schemaVersion: 1 as const,
      intakeRunId: current.intakeRunId,
      rawRequestRevision: current.revision,
      rawRequestDigest: current.rawRequestDigest,
      assistantAdapterId: input.intentAnalysisIdentity.assistantAdapterId,
      assistantAdapterVersion: input.intentAnalysisIdentity.assistantAdapterVersion,
      responseContractDigest: input.intentAnalysisIdentity.responseContractDigest,
      ...response,
      observedAt: input.observedAt,
    } satisfies IntentAnalysisProposalProjectionInput;
    const proposal = decodeIntentAnalysisProposal(
      {
        ...proposalBase,
        proposalDigest: this.#digests.digest(intentAnalysisProposalProjection(proposalBase)),
      },
      this.#digests,
    );

    const revisionsByNumber = new Map(revisions.map((revision) => [revision.revision, revision]));
    const userBindingsByItem = new Map<string, SourceBinding[]>();
    const itemKey = (field: IntentProjectionField, index: number | undefined): string =>
      `${field}\u0000${index === undefined ? '' : String(index)}`;

    for (const suggestion of this.sourceSpanSuggestions(response, revisions)) {
      const value = valueForSuggestion(
        response,
        suggestion.projectionFieldRef,
        suggestion.itemIndex,
      );
      const revision = revisionsByNumber.get(suggestion.rawRequestRevision);
      if (value === undefined || revision === undefined) {
        throw new IntakeAnalysisResponseRejectedError(
          'Candidate Source Span addresses an absent field or unselected revision',
        );
      }
      const bytes = Buffer.from(revision.admittedUserContent, 'utf8');
      const boundaries = utf8Boundaries(revision.admittedUserContent);
      if (
        suggestion.endByte > bytes.length ||
        !boundaries.has(suggestion.startByte) ||
        !boundaries.has(suggestion.endByte) ||
        bytes.subarray(suggestion.startByte, suggestion.endByte).toString('utf8') !== value
      ) {
        throw new IntakeAnalysisResponseRejectedError(
          'Candidate Source Span does not match exact retained user bytes',
        );
      }
      const bindingBase = {
        schemaVersion: 1 as const,
        projectionFieldRef: suggestion.projectionFieldRef,
        authorityClass: SourceAuthorityClass.USER_STATED,
        sourceRecordRef: revision.rawRequestId,
        sourceRevision: revision.revision,
        sourceDigest: revision.rawRequestDigest,
        sourceSpan: {
          startByte: suggestion.startByte,
          endByte: suggestion.endByte,
        },
      } satisfies SourceBindingProjectionInput;
      const binding = decodeSourceBinding(
        {
          ...bindingBase,
          bindingDigest: this.#digests.digest(sourceBindingProjection(bindingBase)),
        },
        this.#digests,
      );
      const key = itemKey(suggestion.projectionFieldRef, suggestion.itemIndex);
      userBindingsByItem.set(key, [...(userBindingsByItem.get(key) ?? []), binding]);
    }

    const fieldItems = fieldItemsFor(response);
    const boundItems: BoundFieldItem[] = fieldItems.map((item) => {
      const userBindings = userBindingsByItem.get(itemKey(item.field, item.itemIndex)) ?? [];
      if (userBindings.length > 0) {
        return { ...item, bindings: userBindings };
      }
      const bindingBase = {
        schemaVersion: 1 as const,
        projectionFieldRef: item.field,
        authorityClass: SourceAuthorityClass.MODEL_PROPOSED,
        sourceRecordRef: proposal.id,
        sourceRevision: 1,
        sourceDigest: proposal.proposalDigest,
        sourceFieldPath: proposalSourceFieldPath(item),
      } satisfies SourceBindingProjectionInput;
      return {
        ...item,
        bindings: [
          decodeSourceBinding(
            {
              ...bindingBase,
              bindingDigest: this.#digests.digest(sourceBindingProjection(bindingBase)),
            },
            this.#digests,
          ),
        ],
      };
    });

    const policyDerivedBindings: SourceBinding[] = [];
    if (current.declaredProjectRef !== undefined) {
      const base = {
        schemaVersion: 1 as const,
        projectionFieldRef: IntentProjectionField.PROJECT_IDENTITY,
        authorityClass: SourceAuthorityClass.POLICY_DERIVED,
        sourceRecordRef: current.rawRequestId,
        sourceRevision: current.revision,
        sourceDigest: current.rawRequestDigest,
        sourceFieldPath: '/declaredProjectRef/normalizedPath',
        derivationPolicyRef: {
          id: IntentAdmissionDerivationRuleId.DECLARED_PROJECT_TO_SCOPE,
          version: M25_DERIVATION_RULE_VERSION,
          digest: input.admissionPolicy.digest,
          orderedInputBindingDigests: [],
        },
      } satisfies SourceBindingProjectionInput;
      policyDerivedBindings.push(
        decodeSourceBinding(
          {
            ...base,
            bindingDigest: this.#digests.digest(sourceBindingProjection(base)),
          },
          this.#digests,
        ),
      );
    }
    const trustedAllowedPaths = this.trustedAllowedPaths(input.admissionPolicy, current);
    trustedAllowedPaths.forEach((_, index) => {
      const base = {
        schemaVersion: 1 as const,
        projectionFieldRef: IntentProjectionField.SCOPE,
        authorityClass: SourceAuthorityClass.POLICY_DERIVED,
        sourceRecordRef: input.admissionPolicy.id,
        sourceRevision: input.admissionPolicy.schemaVersion,
        sourceDigest: input.admissionPolicy.digest,
        sourceFieldPath: `/trustedProjectScope/allowedPaths/${String(index)}`,
        derivationPolicyRef: {
          id: IntentAdmissionDerivationRuleId.TRUSTED_POLICY_ALLOWED_PATHS_TO_SCOPE,
          version: M251_DERIVATION_RULE_VERSION,
          digest: input.admissionPolicy.digest,
          orderedInputBindingDigests: [],
        },
      } satisfies SourceBindingProjectionInput;
      policyDerivedBindings.push(
        decodeSourceBinding(
          {
            ...base,
            bindingDigest: this.#digests.digest(sourceBindingProjection(base)),
          },
          this.#digests,
        ),
      );
    });
    const actionBase = {
      schemaVersion: 1 as const,
      projectionFieldRef: IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION,
      authorityClass: SourceAuthorityClass.POLICY_DERIVED,
      sourceRecordRef: current.rawRequestId,
      sourceRevision: current.revision,
      sourceDigest: current.rawRequestDigest,
      sourceFieldPath: '/interactionAction',
      derivationPolicyRef: {
        id: IntentAdmissionDerivationRuleId.INTERACTION_ACTION_TO_DISPOSITION,
        version: M25_DERIVATION_RULE_VERSION,
        digest: input.admissionPolicy.digest,
        orderedInputBindingDigests: [],
      },
    } satisfies SourceBindingProjectionInput;
    policyDerivedBindings.push(
      decodeSourceBinding(
        {
          ...actionBase,
          bindingDigest: this.#digests.digest(sourceBindingProjection(actionBase)),
        },
        this.#digests,
      ),
    );

    const ambiguityDrafts: {
      readonly id: MaterialAmbiguityId;
      readonly reasonCode: MaterialAmbiguityReasonCode;
      readonly field: IntentProjectionField;
      readonly sourceRefs: readonly ReturnType<DigestProvider['digest']>[];
      readonly sourceOrder: number;
    }[] = [];
    const addAmbiguity = (
      reasonCode: MaterialAmbiguityReasonCode,
      field: IntentProjectionField,
      bindings: readonly SourceBinding[],
    ): void => {
      const userStarts = bindings
        .filter((binding) => binding.authorityClass === SourceAuthorityClass.USER_STATED)
        .map((binding) => binding.sourceSpan.startByte);
      ambiguityDrafts.push({
        id: input.ids.nextMaterialAmbiguityId(),
        reasonCode,
        field,
        sourceRefs:
          bindings.length === 0
            ? [proposal.proposalDigest]
            : bindings.map(({ bindingDigest }) => bindingDigest),
        sourceOrder: userStarts.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...userStarts),
      });
    };
    if (current.declaredProjectRef === undefined) {
      addAmbiguity(
        MaterialAmbiguityReasonCode.PROJECT_IDENTITY_UNRESOLVED,
        IntentProjectionField.PROJECT_IDENTITY,
        [],
      );
    }
    const objectiveItem = boundItems.find(({ field }) => field === IntentProjectionField.OBJECTIVE);
    if (
      objectiveItem === undefined ||
      objectiveItem.bindings.every(
        ({ authorityClass }) => authorityClass !== SourceAuthorityClass.USER_STATED,
      )
    ) {
      addAmbiguity(
        MaterialAmbiguityReasonCode.OBJECTIVE_UNRESOLVED,
        IntentProjectionField.OBJECTIVE,
        objectiveItem?.bindings ?? [],
      );
    }
    const criteriaItems = boundItems.filter(
      ({ field }) => field === IntentProjectionField.REQUIRED_CRITERION,
    );
    if (criteriaItems.length === 0) {
      addAmbiguity(
        MaterialAmbiguityReasonCode.REQUIRED_CRITERION_UNRESOLVED,
        IntentProjectionField.REQUIRED_CRITERION,
        [],
      );
    } else {
      criteriaItems.forEach((item) => {
        if (
          item.bindings.every(
            ({ authorityClass }) => authorityClass !== SourceAuthorityClass.USER_STATED,
          )
        ) {
          addAmbiguity(
            MaterialAmbiguityReasonCode.REQUIRED_CRITERION_UNRESOLVED,
            IntentProjectionField.REQUIRED_CRITERION,
            item.bindings,
          );
        }
      });
    }
    boundItems
      .filter(({ field }) => field === IntentProjectionField.SCOPE)
      .forEach((item) =>
        addAmbiguity(
          MaterialAmbiguityReasonCode.SCOPE_UNRESOLVED,
          IntentProjectionField.SCOPE,
          item.bindings,
        ),
      );
    boundItems
      .filter(({ field }) => field === IntentProjectionField.ASSUMPTION)
      .forEach((item) =>
        addAmbiguity(
          MaterialAmbiguityReasonCode.ASSUMPTION_UNRESOLVED,
          IntentProjectionField.ASSUMPTION,
          item.bindings,
        ),
      );
    boundItems
      .filter(({ field }) => field === IntentProjectionField.NON_GOAL)
      .forEach((item) => {
        if (
          item.bindings.every(
            ({ authorityClass }) => authorityClass !== SourceAuthorityClass.USER_STATED,
          )
        ) {
          addAmbiguity(
            MaterialAmbiguityReasonCode.NON_GOAL_UNRESOLVED,
            IntentProjectionField.NON_GOAL,
            item.bindings,
          );
        }
      });

    const projectionRevision = intentProjectionRevision((currentProjection?.revision ?? 0) + 1);
    const ambiguities: MaterialAmbiguity[] = ambiguityDrafts
      .map((draft) => ({
        id: draft.id,
        schemaVersion: 1 as const,
        intakeRunId: current.intakeRunId,
        basedOnProjectionRevision: projectionRevision,
        reasonCode: draft.reasonCode,
        affectedFields: [draft.field],
        sourceRefs: draft.sourceRefs,
        materialityPolicyRef: {
          id: input.admissionPolicy.id,
          version: input.admissionPolicy.version,
          digest: input.admissionPolicy.digest,
        },
        status: MaterialAmbiguityStatus.UNRESOLVED,
        createdAt: input.observedAt,
      }))
      .sort((left, right) => compareStrings(left.id, right.id));

    const allBindings = [
      ...boundItems.flatMap(({ bindings }) => bindings),
      ...policyDerivedBindings,
    ];
    if (
      new Set(allBindings.map(({ bindingDigest }) => bindingDigest)).size !== allBindings.length
    ) {
      throw new IntakeAnalysisResponseRejectedError(
        'Intent-analysis response creates duplicate Source Bindings',
      );
    }
    const projectionBase = {
      id: currentProjection?.id ?? input.ids.nextIntentProjectionId(),
      schemaVersion: 2 as const,
      intakeRunId: current.intakeRunId,
      revision: projectionRevision,
      ...(currentProjection === undefined ? {} : { parentRevision: currentProjection.revision }),
      rawRequestRevision: current.revision,
      intentAnalysisProposalRef: { id: proposal.id, digest: proposal.proposalDigest },
      ...(proposal.proposedObjective === undefined
        ? {}
        : { objective: proposal.proposedObjective }),
      requiredCriteria: proposal.proposedCriteria,
      optionalCriteria: [],
      scope: {
        ...(current.declaredProjectRef === undefined
          ? {}
          : { projectPath: current.declaredProjectRef.normalizedPath }),
        allowedPaths: trustedAllowedPaths,
      },
      nonGoals: boundItems
        .filter(
          (item) =>
            item.field === IntentProjectionField.NON_GOAL &&
            item.bindings.some(
              ({ authorityClass }) => authorityClass === SourceAuthorityClass.USER_STATED,
            ),
        )
        .map(({ value }) => value),
      assumptions: proposal.proposedAssumptions,
      requestedExecutionDisposition:
        current.interactionAction === 'GOVERNED_EXECUTION'
          ? IntentExecutionDisposition.AUTHORIZE_START
          : IntentExecutionDisposition.LEAVE_READY,
      sourceBindings: allBindings,
      materialAmbiguityRefs: ambiguities.map(({ id }) => id),
      canonicalProfileVersion: this.canonicalProfileVersion(),
      createdAt: input.observedAt,
    } satisfies IntentProjectionRevisionProjectionInput;
    const projection = decodeIntentProjectionRevision(
      {
        ...projectionBase,
        projectionDigest: this.#digests.digest(intentProjectionRevisionProjection(projectionBase)),
      },
      this.#digests,
    );
    const ambiguitySetBase = {
      schemaVersion: 1 as const,
      intakeRunId: projection.intakeRunId,
      intentProjectionId: projection.id,
      intentProjectionRevision: projection.revision,
      intentProjectionDigest: projection.projectionDigest,
      ambiguities,
    } satisfies MaterialAmbiguitySetProjectionInput;
    const ambiguitySet = decodeMaterialAmbiguitySet(
      {
        ...ambiguitySetBase,
        ambiguitySetDigest: this.#digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
      },
      this.#digests,
    );

    const firstAmbiguity = ambiguityDrafts.slice().sort((left, right) => {
      const byPriority =
        (ambiguityPriority.get(left.field) ?? Number.MAX_SAFE_INTEGER) -
        (ambiguityPriority.get(right.field) ?? Number.MAX_SAFE_INTEGER);
      return byPriority !== 0
        ? byPriority
        : left.sourceOrder !== right.sourceOrder
          ? left.sourceOrder - right.sourceOrder
          : compareStrings(left.id, right.id);
    })[0];
    const clarificationQuestionSpecBase =
      firstAmbiguity === undefined
        ? undefined
        : ({
            schemaVersion: 1,
            intakeRunId: projection.intakeRunId,
            basedOnProjectionRevision: projection.revision,
            ambiguityRef: firstAmbiguity.id,
            prompt: M25_CLARIFICATION_QUESTION_PROMPTS[firstAmbiguity.reasonCode],
            affectedFields: [firstAmbiguity.field],
            answerSchema:
              firstAmbiguity.field === IntentProjectionField.PROJECT_IDENTITY
                ? { schemaVersion: 1, kind: ClarificationAnswerSchemaKind.PROJECT_PATH }
                : {
                    schemaVersion: 1,
                    kind: ClarificationAnswerSchemaKind.TEXT,
                    maxUtf8Bytes:
                      m25IntakeBudgetDefinition.exactClarificationAnswerBytesPerRevision,
                  },
          } satisfies ClarificationQuestionSpecProjectionInput);
    const clarificationQuestionSpec =
      clarificationQuestionSpecBase === undefined
        ? undefined
        : decodeClarificationQuestionSpec(
            {
              ...clarificationQuestionSpecBase,
              questionSpecDigest: this.#digests.digest(
                clarificationQuestionSpecProjection(clarificationQuestionSpecBase),
              ),
            },
            this.#digests,
          );

    assertIntentProjectionAmbiguityClosure(proposal, projection, ambiguitySet);

    return Object.freeze({
      proposal,
      projection,
      ambiguitySet,
      ...(clarificationQuestionSpec === undefined ? {} : { clarificationQuestionSpec }),
    });
  }

  protected sourceSpanSuggestions(
    response: IntentAnalysisAssistantResponseV1,
    revisions: readonly RawRequestRevisionRecord[],
  ): readonly CandidateSourceSpanSuggestion[] {
    void revisions;
    return response.candidateSourceSpanSuggestions;
  }

  protected trustedAllowedPaths(
    policy: IntentAdmissionPolicy,
    current: RawRequestRevisionRecord,
  ): readonly string[] {
    void policy;
    void current;
    return Object.freeze([]);
  }

  protected canonicalProfileVersion():
    | typeof IntentProjectionCanonicalProfileVersion.M25_LOCAL_V2
    | typeof IntentProjectionCanonicalProfileVersion.M251_EXACT_VALUE_MATCH_V3
    | typeof IntentProjectionCanonicalProfileVersion.M251_TRUSTED_SCOPE_V4 {
    return M25_INTENT_PROJECTION_PROFILE_VERSION;
  }
}

export class M251IntentProjectionCompiler extends M25IntentProjectionCompiler {
  protected override sourceSpanSuggestions(
    response: IntentAnalysisAssistantResponseV1,
    revisions: readonly RawRequestRevisionRecord[],
  ): readonly CandidateSourceSpanSuggestion[] {
    return exactValueMatchSuggestions(response, revisions);
  }

  protected override canonicalProfileVersion():
    | typeof IntentProjectionCanonicalProfileVersion.M251_EXACT_VALUE_MATCH_V3
    | typeof IntentProjectionCanonicalProfileVersion.M251_TRUSTED_SCOPE_V4 {
    return M251_INTENT_PROJECTION_PROFILE_VERSION;
  }
}

/** M2.5.1 production projection with exact-value provenance and Policy-owned allowed paths. */
export class M251TrustedIntentProjectionCompiler extends M251IntentProjectionCompiler {
  protected override trustedAllowedPaths(
    policy: IntentAdmissionPolicy,
    current: RawRequestRevisionRecord,
  ): readonly string[] {
    const scope = policy.trustedProjectScope;
    if (scope === undefined || current.declaredProjectRef?.normalizedPath !== scope.projectPath) {
      throw new TypeError(
        'M2.5.1 trusted-scope Projection requires the exact Policy-owned project scope',
      );
    }
    return Object.freeze([...scope.allowedPaths]);
  }

  protected override canonicalProfileVersion(): typeof IntentProjectionCanonicalProfileVersion.M251_TRUSTED_SCOPE_V4 {
    return M251_TRUSTED_SCOPE_PROJECTION_PROFILE_VERSION;
  }
}
