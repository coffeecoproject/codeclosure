import { z } from 'zod';

import {
  answerOnlyResponseId,
  auditEventId,
  clarificationAnswerBindingId,
  clarificationQuestionId,
  commandId,
  executionProfileId,
  goalId,
  goalMaterializationId,
  goalRevision,
  goalStartAuthorizationId,
  intakeFailureRecordId,
  intakeManifestId,
  intakeOperationId,
  intakeRunId,
  intakeRunVersion,
  intentAdmissionDecisionId,
  intentAdmissionPolicyId,
  intentAnalysisProposalId,
  intentProjectionId,
  intentProjectionRevision,
  isoTimestamp,
  materialAmbiguityId,
  policyBundleId,
  principalId,
  rawRequestId,
  rawRequestRevision,
  sha256Digest,
  workflowId,
  workflowVersion,
  type Sha256Digest,
} from './identifiers.js';
import {
  AnswerOnlyFailureReasonCode,
  AnswerOnlyResponseKind,
  ClarificationAnswerSchemaKind,
  IntakeAnswerDisposition,
  IntakeCommandDisposition,
  IntakeCommandOperationKind,
  IntakeFailedOperation,
  IntakeFailureReasonCode,
  IntakeInteractionAction,
  IntakeManifestEntryKind,
  IntakeManifestOperation,
  IntakeMaterializationDisposition,
  IntakeRunStatus,
  IntakeStartDisposition,
  IntentAdmissionDecisionKind,
  IntentAdmissionOutcome,
  IntentAdmissionReasonCode,
  IntentAdmissionRuleTraceOutcome,
  IntentExecutionDisposition,
  IntentProjectionCanonicalProfileVersion,
  IntentProjectionField,
  MaterialAmbiguityReasonCode,
  MaterialAmbiguityStatus,
  SourceAuthorityClass,
  answerOnlyResponseProjection,
  assertAnswerOnlyResponseInvariant,
  assertClarificationAnswerBindingInvariant,
  assertClarificationQuestionInvariant,
  assertClarificationQuestionSpecInvariant,
  assertGoalMaterializationInvariant,
  assertGoalStartAuthorizationInvariant,
  assertIntakeCommandClosureInvariant,
  assertIntakeFailureRecordInvariant,
  assertIntakeRunInvariant,
  assertIntentAdmissionDecisionInvariant,
  assertIntentProjectionInvariant,
  assertMaterialAmbiguityInvariant,
  assertRawRequestInvariant,
  assertRawRequestRevisionInvariant,
  assertSourceBindingInvariant,
  clarificationAnswerBindingProjection,
  clarificationQuestionProjection,
  clarificationQuestionSpecProjection,
  goalMaterializationProjection,
  goalStartAuthorizationProjection,
  intakeCommandInputProjection,
  intakeCommandOutcomeProjection,
  intakeCommandReservationProjection,
  intakeCommandResultProjection,
  intakeFailureRecordProjection,
  intakeManifestProjection,
  intentAdmissionDecisionProjection,
  intentAnalysisProposalProjection,
  intentProjectionRevisionProjection,
  materialAmbiguitySetProjection,
  rawRequestRevisionProjection,
  sourceBindingProjection,
  type AnswerOnlyResponse,
  type ClarificationAnswerBinding,
  type ClarificationQuestion,
  type ClarificationQuestionSpec,
  type GoalMaterializationRecord,
  type GoalStartAuthorization,
  type IntakeCommandInput,
  type IntakeCommandOutcome,
  type IntakeCommandReservation,
  type IntakeCommandResult,
  type IntakeFailureRecord,
  type IntakeManifest,
  type IntakeRun,
  type IntentAdmissionDecision,
  type IntentAnalysisProposal,
  type IntentProjectionRevisionRecord,
  type MaterialAmbiguity,
  type MaterialAmbiguitySet,
  type RawRequest,
  type RawRequestRevisionRecord,
  type SourceBinding,
} from './intake.js';
import {
  IntentAdmissionDerivationRuleId,
  IntentAdmissionFieldCardinality,
  IntentAdmissionMaterialFieldKind,
  IntentAdmissionPolicyRuleKind,
  IntentAdmissionRuleId,
  assertIntentAdmissionPolicyDefinitionInvariant,
  assertIntentAdmissionPolicyInstallInputInvariant,
  assertIntentAdmissionPolicyInvariant,
  intentAdmissionPolicyProjection,
  type IntentAdmissionPolicy,
  type IntentAdmissionPolicyDefinition,
  type IntentAdmissionPolicyInstallInput,
} from './intake-policy.js';

export interface IntakeDigestVerifier {
  digest(value: unknown): Sha256Digest;
  digestUtf8(value: string): Sha256Digest;
}

function rejectExplicitUndefined(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectExplicitUndefined(entry, `${path}[${String(index)}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  for (const key of Object.keys(value)) {
    const entry = Reflect.get(value, key) as unknown;
    if (entry === undefined) {
      throw new TypeError(`Optional property ${path}.${key} must be omitted instead of undefined`);
    }
    rejectExplicitUndefined(entry, `${path}.${key}`);
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(Reflect.get(value, key));
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

type ExactParsed<Value> = Value extends string | number | boolean | bigint | symbol | null
  ? Value
  : Value extends readonly (infer Entry)[]
    ? readonly ExactParsed<Entry>[]
    : Value extends object
      ? {
          [Key in keyof Value as undefined extends Value[Key] ? never : Key]: ExactParsed<
            Value[Key]
          >;
        } & {
          [Key in keyof Value as undefined extends Value[Key] ? Key : never]?: ExactParsed<
            Exclude<Value[Key], undefined>
          >;
        }
      : Value;

function parse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): ExactParsed<z.output<Schema>> {
  rejectExplicitUndefined(value);
  // Zod models an omitted optional property as `T | undefined`. The recursive precheck above
  // proves explicit `undefined` is absent, so this mapped result removes only that impossible arm.
  return deepFreeze(schema.parse(value)) as ExactParsed<z.output<Schema>>;
}

function verifyDigest(
  actual: Sha256Digest,
  projection: unknown,
  verifier: IntakeDigestVerifier,
  name: string,
): void {
  const expected = sha256Digest(verifier.digest(projection));
  if (actual !== expected) {
    throw new TypeError(`${name} does not match its canonical projection`);
  }
}

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  error: 'String must not be blank',
});
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const sha256Schema = z.string().transform(sha256Digest);
const timestampSchema = z.string().transform(isoTimestamp);
const rawRequestIdSchema = z.string().transform(rawRequestId);
const intakeRunIdSchema = z.string().transform(intakeRunId);
const intakeManifestIdSchema = z.string().transform(intakeManifestId);
const operationIdSchema = z.string().transform(intakeOperationId);
const proposalIdSchema = z.string().transform(intentAnalysisProposalId);
const projectionIdSchema = z.string().transform(intentProjectionId);
const ambiguityIdSchema = z.string().transform(materialAmbiguityId);
const questionIdSchema = z.string().transform(clarificationQuestionId);
const answerBindingIdSchema = z.string().transform(clarificationAnswerBindingId);
const admissionDecisionIdSchema = z.string().transform(intentAdmissionDecisionId);
const admissionPolicyIdSchema = z.string().transform(intentAdmissionPolicyId);
const answerResponseIdSchema = z.string().transform(answerOnlyResponseId);
const failureIdSchema = z.string().transform(intakeFailureRecordId);
const materializationIdSchema = z.string().transform(goalMaterializationId);
const startAuthorizationIdSchema = z.string().transform(goalStartAuthorizationId);
const principalIdSchema = z.string().transform(principalId);
const commandIdSchema = z.string().transform(commandId);
const goalIdSchema = z.string().transform(goalId);
const workflowIdSchema = z.string().transform(workflowId);
const policyBundleIdSchema = z.string().transform(policyBundleId);
const executionProfileIdSchema = z.string().transform(executionProfileId);
const auditEventIdSchema = z.string().transform(auditEventId);
const rawRevisionSchema = positiveIntegerSchema.transform(rawRequestRevision);
const intakeVersionSchema = positiveIntegerSchema.transform(intakeRunVersion);
const projectionRevisionSchema = positiveIntegerSchema.transform(intentProjectionRevision);
const goalRevisionSchema = positiveIntegerSchema.transform(goalRevision);
const workflowVersionSchema = positiveIntegerSchema.transform(workflowVersion);

const versionedDigestRefSchema = z
  .object({ id: nonBlankStringSchema, version: nonBlankStringSchema, digest: sha256Schema })
  .strict();
const declaredProjectRefSchema = z
  .object({
    schemaVersion: z.literal(1),
    normalizedPath: nonBlankStringSchema,
    identityDigest: sha256Schema,
  })
  .strict();
const answeredQuestionBindingSchema = z
  .object({
    clarificationQuestionId: questionIdSchema,
    questionSpecDigest: sha256Schema,
    questionDigest: sha256Schema,
    intentAdmissionDecisionId: admissionDecisionIdSchema,
    intentAdmissionDecisionDigest: sha256Schema,
  })
  .strict();
const rawRequestRevisionRefSchema = z
  .object({ rawRequestId: rawRequestIdSchema, revision: rawRevisionSchema, digest: sha256Schema })
  .strict();

const rawRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: rawRequestIdSchema,
    intakeRunId: intakeRunIdSchema,
    createdAt: timestampSchema,
  })
  .strict();

export function decodeRawRequest(value: unknown): RawRequest {
  const record = parse(rawRequestSchema, value);
  assertRawRequestInvariant(record);
  return record;
}

const rawRequestRevisionRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    rawRequestId: rawRequestIdSchema,
    intakeRunId: intakeRunIdSchema,
    revision: rawRevisionSchema,
    parentRevision: rawRevisionSchema.optional(),
    answeredQuestionBinding: answeredQuestionBindingSchema.optional(),
    principalRef: principalIdSchema,
    interactionAction: z.enum(Object.values(IntakeInteractionAction)),
    admittedUserContent: nonBlankStringSchema,
    admittedContentDigest: sha256Schema,
    declaredProjectRef: declaredProjectRefSchema.optional(),
    declaredConstraints: z.array(nonBlankStringSchema),
    retentionProfile: versionedDigestRefSchema,
    submittedAt: timestampSchema,
    rawRequestDigest: sha256Schema,
  })
  .strict();

export function decodeRawRequestRevision(
  value: unknown,
  verifier: IntakeDigestVerifier,
): RawRequestRevisionRecord {
  const record = parse(rawRequestRevisionRecordSchema, value);
  assertRawRequestRevisionInvariant(record);
  const contentDigest = sha256Digest(verifier.digestUtf8(record.admittedUserContent));
  if (contentDigest !== record.admittedContentDigest) {
    throw new TypeError('Raw Request admitted content digest does not match exact UTF-8 bytes');
  }
  verifyDigest(
    record.rawRequestDigest,
    rawRequestRevisionProjection(record),
    verifier,
    'Raw Request revision digest',
  );
  return record;
}

const candidateSourceSpanSuggestionSchema = z
  .object({
    projectionFieldRef: z.enum([
      IntentProjectionField.OBJECTIVE,
      IntentProjectionField.REQUIRED_CRITERION,
      IntentProjectionField.SCOPE,
      IntentProjectionField.NON_GOAL,
      IntentProjectionField.ASSUMPTION,
    ]),
    itemIndex: nonNegativeIntegerSchema.optional(),
    rawRequestRevision: rawRevisionSchema,
    startByte: nonNegativeIntegerSchema,
    endByte: positiveIntegerSchema,
  })
  .strict();
const proposalSchema = z
  .object({
    id: proposalIdSchema,
    schemaVersion: z.literal(1),
    intakeRunId: intakeRunIdSchema,
    rawRequestRevision: rawRevisionSchema,
    rawRequestDigest: sha256Schema,
    assistantAdapterId: nonBlankStringSchema,
    assistantAdapterVersion: nonBlankStringSchema,
    responseContractDigest: sha256Schema,
    proposedObjective: nonBlankStringSchema.optional(),
    proposedCriteria: z.array(nonBlankStringSchema),
    proposedScope: nonBlankStringSchema.optional(),
    proposedNonGoals: z.array(nonBlankStringSchema),
    proposedAssumptions: z.array(nonBlankStringSchema),
    proposedQuestions: z.array(nonBlankStringSchema),
    candidateSourceSpanSuggestions: z.array(candidateSourceSpanSuggestionSchema),
    proposedClassification: nonBlankStringSchema.optional(),
    proposalDigest: sha256Schema,
    observedAt: timestampSchema,
  })
  .strict();

export function decodeIntentAnalysisProposal(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntentAnalysisProposal {
  const proposal = parse(proposalSchema, value);
  const arrays = [
    proposal.proposedCriteria,
    proposal.proposedNonGoals,
    proposal.proposedAssumptions,
    proposal.proposedQuestions,
  ];
  if (arrays.some((entries) => new Set(entries).size !== entries.length)) {
    throw new TypeError('Intent Analysis Proposal arrays must not contain duplicates');
  }
  for (const suggestion of proposal.candidateSourceSpanSuggestions) {
    const collectionFields = new Set<IntentProjectionField>([
      IntentProjectionField.REQUIRED_CRITERION,
      IntentProjectionField.NON_GOAL,
      IntentProjectionField.ASSUMPTION,
    ]);
    const collectionField = collectionFields.has(suggestion.projectionFieldRef);
    if (
      collectionField !== (suggestion.itemIndex !== undefined) ||
      suggestion.endByte <= suggestion.startByte
    ) {
      throw new TypeError('Candidate Source Span item and byte coordinates are invalid');
    }
  }
  verifyDigest(
    proposal.proposalDigest,
    intentAnalysisProposalProjection(proposal),
    verifier,
    'Intent Analysis Proposal digest',
  );
  return proposal;
}

const sourceBindingBase = {
  schemaVersion: z.literal(1),
  projectionFieldRef: z.enum(Object.values(IntentProjectionField)),
  sourceRecordRef: nonBlankStringSchema,
  sourceRevision: positiveIntegerSchema,
  sourceDigest: sha256Schema,
  bindingDigest: sha256Schema,
};
const sourceSpanSchema = z
  .object({ startByte: nonNegativeIntegerSchema, endByte: positiveIntegerSchema })
  .strict();
const derivationPolicyRefSchema = versionedDigestRefSchema
  .extend({ orderedInputBindingDigests: z.array(sha256Schema) })
  .strict();
const sourceBindingSchema = z.discriminatedUnion('authorityClass', [
  z
    .object({
      ...sourceBindingBase,
      authorityClass: z.literal(SourceAuthorityClass.USER_STATED),
      sourceSpan: sourceSpanSchema,
    })
    .strict(),
  z
    .object({
      ...sourceBindingBase,
      authorityClass: z.literal(SourceAuthorityClass.POLICY_DERIVED),
      sourceFieldPath: nonBlankStringSchema,
      derivationPolicyRef: derivationPolicyRefSchema,
    })
    .strict(),
  z
    .object({
      ...sourceBindingBase,
      authorityClass: z.literal(SourceAuthorityClass.PROJECT_OBSERVED),
      sourceFieldPath: nonBlankStringSchema,
      observationRef: nonBlankStringSchema,
    })
    .strict(),
  z
    .object({
      ...sourceBindingBase,
      authorityClass: z.literal(SourceAuthorityClass.MODEL_PROPOSED),
      sourceFieldPath: nonBlankStringSchema,
    })
    .strict(),
  z
    .object({
      ...sourceBindingBase,
      authorityClass: z.literal(SourceAuthorityClass.UNRESOLVED),
      sourceFieldPath: nonBlankStringSchema,
    })
    .strict(),
]);

export function decodeSourceBinding(value: unknown, verifier: IntakeDigestVerifier): SourceBinding {
  const binding = parse(sourceBindingSchema, value);
  assertSourceBindingInvariant(binding);
  verifyDigest(
    binding.bindingDigest,
    sourceBindingProjection(binding),
    verifier,
    'Source Binding digest',
  );
  return binding;
}

const projectionSchemaBase = {
  id: projectionIdSchema,
  intakeRunId: intakeRunIdSchema,
  revision: projectionRevisionSchema,
  parentRevision: projectionRevisionSchema.optional(),
  rawRequestRevision: rawRevisionSchema,
  intentAnalysisProposalRef: z.object({ id: proposalIdSchema, digest: sha256Schema }).strict(),
  requiredCriteria: z.array(nonBlankStringSchema),
  optionalCriteria: z.array(nonBlankStringSchema),
  scope: z
    .object({
      projectPath: nonBlankStringSchema.optional(),
      allowedPaths: z.array(nonBlankStringSchema),
    })
    .strict(),
  nonGoals: z.array(nonBlankStringSchema),
  assumptions: z.array(nonBlankStringSchema),
  requestedExecutionDisposition: z.enum([
    IntentExecutionDisposition.LEAVE_READY,
    IntentExecutionDisposition.AUTHORIZE_START,
  ]),
  sourceBindings: z.array(sourceBindingSchema),
  materialAmbiguityRefs: z.array(ambiguityIdSchema),
  projectionDigest: sha256Schema,
  createdAt: timestampSchema,
};
const projectionSchema = z.discriminatedUnion('schemaVersion', [
  z
    .object({
      ...projectionSchemaBase,
      schemaVersion: z.literal(1),
      objective: nonBlankStringSchema,
      canonicalProfileVersion: z.literal(IntentProjectionCanonicalProfileVersion.M25_LOCAL_V1),
    })
    .strict(),
  z
    .object({
      ...projectionSchemaBase,
      schemaVersion: z.literal(2),
      objective: nonBlankStringSchema.optional(),
      canonicalProfileVersion: z.enum([
        IntentProjectionCanonicalProfileVersion.M25_LOCAL_V2,
        IntentProjectionCanonicalProfileVersion.M251_EXACT_VALUE_MATCH_V3,
        IntentProjectionCanonicalProfileVersion.M251_TRUSTED_SCOPE_V4,
      ]),
    })
    .strict(),
]);

export function decodeIntentProjectionRevision(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntentProjectionRevisionRecord {
  const projection = parse(projectionSchema, value);
  for (const binding of projection.sourceBindings) {
    assertSourceBindingInvariant(binding);
    verifyDigest(
      binding.bindingDigest,
      sourceBindingProjection(binding),
      verifier,
      'Intent Projection Source Binding digest',
    );
  }
  assertIntentProjectionInvariant(projection);
  verifyDigest(
    projection.projectionDigest,
    intentProjectionRevisionProjection(projection),
    verifier,
    'Intent Projection digest',
  );
  return projection;
}

const materialAmbiguitySchema = z
  .object({
    id: ambiguityIdSchema,
    schemaVersion: z.literal(1),
    intakeRunId: intakeRunIdSchema,
    basedOnProjectionRevision: projectionRevisionSchema.optional(),
    reasonCode: z.enum(Object.values(MaterialAmbiguityReasonCode)),
    affectedFields: z.array(z.enum(Object.values(IntentProjectionField))).min(1),
    sourceRefs: z.array(sha256Schema),
    materialityPolicyRef: versionedDigestRefSchema,
    status: z.enum(Object.values(MaterialAmbiguityStatus)),
    createdAt: timestampSchema,
    resolvedByRawRequestRevision: rawRevisionSchema.optional(),
  })
  .strict();
const materialAmbiguitySetSchema = z
  .object({
    schemaVersion: z.literal(1),
    intakeRunId: intakeRunIdSchema,
    intentProjectionId: projectionIdSchema,
    intentProjectionRevision: projectionRevisionSchema,
    intentProjectionDigest: sha256Schema,
    ambiguities: z.array(materialAmbiguitySchema),
    ambiguitySetDigest: sha256Schema,
  })
  .strict();

export function decodeMaterialAmbiguity(value: unknown): MaterialAmbiguity {
  const ambiguity = parse(materialAmbiguitySchema, value);
  assertMaterialAmbiguityInvariant(ambiguity);
  return ambiguity;
}

export function decodeMaterialAmbiguitySet(
  value: unknown,
  verifier: IntakeDigestVerifier,
): MaterialAmbiguitySet {
  const set = parse(materialAmbiguitySetSchema, value);
  let priorId: string | undefined;
  for (const ambiguity of set.ambiguities) {
    assertMaterialAmbiguityInvariant(ambiguity);
    if (
      ambiguity.intakeRunId !== set.intakeRunId ||
      (priorId !== undefined && ambiguity.id <= priorId)
    ) {
      throw new TypeError('Material Ambiguity Set must be same-Intake and ordered by ID');
    }
    priorId = ambiguity.id;
  }
  verifyDigest(
    set.ambiguitySetDigest,
    materialAmbiguitySetProjection(set),
    verifier,
    'Material Ambiguity Set digest',
  );
  return set;
}

const answerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal(ClarificationAnswerSchemaKind.TEXT),
      maxUtf8Bytes: positiveIntegerSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal(ClarificationAnswerSchemaKind.PROJECT_PATH),
    })
    .strict(),
]);
const questionSpecFields = {
  schemaVersion: z.literal(1),
  intakeRunId: intakeRunIdSchema,
  basedOnProjectionRevision: projectionRevisionSchema.optional(),
  ambiguityRef: ambiguityIdSchema,
  prompt: nonBlankStringSchema,
  affectedFields: z.array(z.enum(Object.values(IntentProjectionField))).min(1),
  answerSchema,
  questionSpecDigest: sha256Schema,
};
const questionSpecSchema = z.object(questionSpecFields).strict();
const questionSchema = z
  .object({
    id: questionIdSchema,
    ...questionSpecFields,
    intentAdmissionDecisionId: admissionDecisionIdSchema,
    intentAdmissionDecisionDigest: sha256Schema,
    createdAt: timestampSchema,
    questionDigest: sha256Schema,
  })
  .strict();

export function decodeClarificationQuestionSpec(
  value: unknown,
  verifier: IntakeDigestVerifier,
): ClarificationQuestionSpec {
  const spec = parse(questionSpecSchema, value);
  assertClarificationQuestionSpecInvariant(spec);
  verifyDigest(
    spec.questionSpecDigest,
    clarificationQuestionSpecProjection(spec),
    verifier,
    'Clarification Question specification digest',
  );
  return spec;
}

export function decodeClarificationQuestion(
  value: unknown,
  verifier: IntakeDigestVerifier,
): ClarificationQuestion {
  const question = parse(questionSchema, value);
  assertClarificationQuestionInvariant(question);
  verifyDigest(
    question.questionSpecDigest,
    clarificationQuestionSpecProjection(question),
    verifier,
    'Clarification Question specification digest',
  );
  verifyDigest(
    question.questionDigest,
    clarificationQuestionProjection(question),
    verifier,
    'Clarification Question record digest',
  );
  return question;
}

const answerBindingSchema = z
  .object({
    id: answerBindingIdSchema,
    schemaVersion: z.literal(1),
    intakeRunId: intakeRunIdSchema,
    clarificationQuestionId: questionIdSchema,
    questionSpecDigest: sha256Schema,
    questionDigest: sha256Schema,
    intentAdmissionDecisionId: admissionDecisionIdSchema,
    intentAdmissionDecisionDigest: sha256Schema,
    rawRequestId: rawRequestIdSchema,
    rawRequestRevision: rawRevisionSchema,
    rawRequestDigest: sha256Schema,
    commandId: commandIdSchema,
    canonicalCommandInputDigest: sha256Schema,
    answeredAt: timestampSchema,
    answerBindingDigest: sha256Schema,
  })
  .strict();

export function decodeClarificationAnswerBinding(
  value: unknown,
  verifier: IntakeDigestVerifier,
): ClarificationAnswerBinding {
  const binding = parse(answerBindingSchema, value);
  assertClarificationAnswerBindingInvariant(binding);
  verifyDigest(
    binding.answerBindingDigest,
    clarificationAnswerBindingProjection(binding),
    verifier,
    'Clarification Answer Binding digest',
  );
  return binding;
}

const projectionBindingSchema = z
  .object({
    intentAnalysisProposalId: proposalIdSchema,
    intentAnalysisProposalDigest: sha256Schema,
    intentProjectionId: projectionIdSchema,
    intentProjectionRevision: projectionRevisionSchema,
    intentProjectionDigest: sha256Schema,
    sourceBindingDigests: z.array(sha256Schema),
    materialAmbiguityRefs: z.array(ambiguityIdSchema),
  })
  .strict();
const abandonmentReservationBindingSchema = z
  .object({
    clarificationQuestionId: questionIdSchema,
    questionSpecDigest: sha256Schema,
    questionDigest: sha256Schema,
    issuingClarifyDecisionId: admissionDecisionIdSchema,
    issuingClarifyDecisionDigest: sha256Schema,
  })
  .strict();
const abandonmentBindingSchema = abandonmentReservationBindingSchema
  .extend({ commandId: commandIdSchema, canonicalCommandInputDigest: sha256Schema })
  .strict();
const reasonTraceSchema = z
  .object({
    ruleId: nonBlankStringSchema,
    outcome: z.enum(Object.values(IntentAdmissionRuleTraceOutcome)),
    reasonCode: nonBlankStringSchema,
    inputRefs: z.array(nonBlankStringSchema),
  })
  .strict();
const decisionCommon = {
  id: admissionDecisionIdSchema,
  schemaVersion: z.literal(1),
  intakeRunId: intakeRunIdSchema,
  intakeRunVersion: intakeVersionSchema,
  principalRef: principalIdSchema,
  interactionAction: z.enum(Object.values(IntakeInteractionAction)),
  rawRequestRevision: rawRevisionSchema,
  rawRequestDigest: sha256Schema,
  admissionPolicyId: admissionPolicyIdSchema,
  admissionPolicyVersion: nonBlankStringSchema,
  admissionPolicyDigest: sha256Schema,
  orderedReasonTrace: z.array(reasonTraceSchema).min(1),
  decidedAt: timestampSchema,
  decisionDigest: sha256Schema,
};
const decisionSchema = z.union([
  z
    .object({
      ...decisionCommon,
      interactionAction: z.literal(IntakeInteractionAction.ANSWER_ONLY),
      kind: z.literal(IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION),
      projectOrScopeRef: declaredProjectRefSchema.optional(),
      outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
      reasonCode: z.literal(IntentAdmissionReasonCode.ANSWER_ONLY),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      interactionAction: z.literal(IntakeInteractionAction.MATERIALIZE_ONLY),
      kind: z.literal(IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION),
      projectOrScopeRef: declaredProjectRefSchema.optional(),
      outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
      reasonCode: z.literal(IntentAdmissionReasonCode.POLICY_DENIED),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      interactionAction: z.literal(IntakeInteractionAction.GOVERNED_EXECUTION),
      kind: z.literal(IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION),
      projectOrScopeRef: declaredProjectRefSchema.optional(),
      outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
      reasonCode: z.literal(IntentAdmissionReasonCode.UNSUPPORTED),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      kind: z.literal(IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION),
      projectionBinding: projectionBindingSchema,
      abandonmentBinding: abandonmentBindingSchema.optional(),
      projectOrScopeRef: declaredProjectRefSchema.optional(),
      outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
      reasonCode: z.enum([
        IntentAdmissionReasonCode.POLICY_DENIED,
        IntentAdmissionReasonCode.UNSUPPORTED,
        IntentAdmissionReasonCode.ABANDONED,
      ]),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      interactionAction: z.enum([
        IntakeInteractionAction.MATERIALIZE_ONLY,
        IntakeInteractionAction.GOVERNED_EXECUTION,
      ]),
      kind: z.literal(IntentAdmissionDecisionKind.CLARIFY),
      projectionBinding: projectionBindingSchema,
      questionPlanBinding: z
        .object({ questionId: questionIdSchema, questionSpecDigest: sha256Schema })
        .strict(),
      projectOrScopeRef: declaredProjectRefSchema.optional(),
      outcome: z.literal(IntentAdmissionOutcome.CLARIFY),
      reasonCode: z.literal(IntentAdmissionReasonCode.MATERIAL_AMBIGUITY),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      interactionAction: z.literal(IntakeInteractionAction.MATERIALIZE_ONLY),
      kind: z.literal(IntentAdmissionDecisionKind.MATERIALIZE),
      projectionBinding: projectionBindingSchema,
      projectOrScopeRef: declaredProjectRefSchema,
      outcome: z.literal(IntentAdmissionOutcome.MATERIALIZE),
      reasonCode: z.literal(IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED),
      executionDisposition: z.literal(IntentExecutionDisposition.LEAVE_READY),
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      interactionAction: z.literal(IntakeInteractionAction.GOVERNED_EXECUTION),
      kind: z.literal(IntentAdmissionDecisionKind.MATERIALIZE),
      projectionBinding: projectionBindingSchema,
      projectOrScopeRef: declaredProjectRefSchema,
      outcome: z.literal(IntentAdmissionOutcome.MATERIALIZE),
      reasonCode: z.literal(IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED),
      executionDisposition: z.literal(IntentExecutionDisposition.AUTHORIZE_START),
    })
    .strict(),
]);

export function decodeIntentAdmissionDecision(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntentAdmissionDecision {
  const decision = parse(decisionSchema, value);
  assertIntentAdmissionDecisionInvariant(decision);
  verifyDigest(
    decision.decisionDigest,
    intentAdmissionDecisionProjection(decision),
    verifier,
    'Intent Admission Decision digest',
  );
  return decision;
}

const activeQuestionRefSchema = z
  .object({
    clarificationQuestionId: questionIdSchema,
    questionSpecDigest: sha256Schema,
    questionDigest: sha256Schema,
    issuingDecisionId: admissionDecisionIdSchema,
    issuingDecisionDigest: sha256Schema,
  })
  .strict();
const decisionRefSchema = z
  .object({
    id: admissionDecisionIdSchema,
    digest: sha256Schema,
    outcome: z.enum(Object.values(IntentAdmissionOutcome)),
    reasonCode: z.enum(Object.values(IntentAdmissionReasonCode)),
  })
  .strict();
const clarifyDecisionRefSchema = decisionRefSchema.extend({
  outcome: z.literal(IntentAdmissionOutcome.CLARIFY),
  reasonCode: z.literal(IntentAdmissionReasonCode.MATERIAL_AMBIGUITY),
});
const materializeDecisionRefSchema = decisionRefSchema.extend({
  outcome: z.literal(IntentAdmissionOutcome.MATERIALIZE),
  reasonCode: z.enum([
    IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED,
    IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED,
  ]),
});
const noExecutionDecisionRefSchema = decisionRefSchema.extend({
  outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
});
const answerOnlyDecisionRefSchema = noExecutionDecisionRefSchema.extend({
  reasonCode: z.literal(IntentAdmissionReasonCode.ANSWER_ONLY),
});
const otherNoExecutionDecisionRefSchema = noExecutionDecisionRefSchema.extend({
  reasonCode: z.enum([
    IntentAdmissionReasonCode.POLICY_DENIED,
    IntentAdmissionReasonCode.UNSUPPORTED,
    IntentAdmissionReasonCode.ABANDONED,
  ]),
});
const failureRefSchema = z.object({ id: failureIdSchema, digest: sha256Schema }).strict();
const answerResponseRefSchema = z
  .object({
    id: answerResponseIdSchema,
    digest: sha256Schema,
    kind: z.enum(Object.values(AnswerOnlyResponseKind)),
  })
  .strict();
const answerReturnedResponseRefSchema = answerResponseRefSchema.extend({
  kind: z.literal(AnswerOnlyResponseKind.ANSWER_RETURNED),
});
const answerFailedResponseRefSchema = answerResponseRefSchema.extend({
  kind: z.literal(AnswerOnlyResponseKind.ANSWER_FAILED),
});
const materializedGoalRefSchema = z
  .object({
    goalMaterializationId: materializationIdSchema,
    materializationDigest: sha256Schema,
    goalId: goalIdSchema,
    goalRevision: goalRevisionSchema,
    workflowId: workflowIdSchema,
    workflowVersion: workflowVersionSchema,
  })
  .strict();
const intakeRunCommon = {
  id: intakeRunIdSchema,
  schemaVersion: z.literal(1),
  version: intakeVersionSchema,
  principalRef: principalIdSchema,
  projectRef: declaredProjectRefSchema.optional(),
  activeRawRequestRevision: rawRequestRevisionRefSchema,
  activeIntentProjectionRevision: z
    .object({ id: projectionIdSchema, revision: projectionRevisionSchema, digest: sha256Schema })
    .strict()
    .optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};
const intakeRunSchema = z.union([
  z.object({ ...intakeRunCommon, status: z.literal(IntakeRunStatus.ANALYZING) }).strict(),
  z
    .object({
      ...intakeRunCommon,
      status: z.literal(IntakeRunStatus.NEEDS_CLARIFICATION),
      activeQuestionRef: activeQuestionRefSchema,
    })
    .strict(),
  z
    .object({
      ...intakeRunCommon,
      status: z.literal(IntakeRunStatus.MATERIALIZED),
      terminalDecisionRef: materializeDecisionRefSchema,
      materializedGoalRef: materializedGoalRefSchema,
    })
    .strict(),
  z
    .object({
      ...intakeRunCommon,
      status: z.literal(IntakeRunStatus.NO_EXECUTION),
      terminalDecisionRef: answerOnlyDecisionRefSchema,
      answerOnlyResponseRef: answerResponseRefSchema,
    })
    .strict(),
  z
    .object({
      ...intakeRunCommon,
      status: z.literal(IntakeRunStatus.NO_EXECUTION),
      terminalDecisionRef: otherNoExecutionDecisionRefSchema,
    })
    .strict(),
  z
    .object({
      ...intakeRunCommon,
      status: z.literal(IntakeRunStatus.FAILED),
      terminalFailureRef: failureRefSchema,
    })
    .strict(),
]);

export function decodeIntakeRun(value: unknown): IntakeRun {
  const run = parse(intakeRunSchema, value);
  assertIntakeRunInvariant(run);
  return run;
}

const answerResponseCommon = {
  id: answerResponseIdSchema,
  schemaVersion: z.literal(1),
  intakeRunId: intakeRunIdSchema,
  rawRequestRevision: rawRevisionSchema,
  rawRequestDigest: sha256Schema,
  intentAdmissionDecisionId: admissionDecisionIdSchema,
  intentAdmissionDecisionDigest: sha256Schema,
  assistantAdapterId: nonBlankStringSchema,
  assistantAdapterVersion: nonBlankStringSchema,
  responseContractDigest: sha256Schema,
  observedAt: timestampSchema,
  responseDigest: sha256Schema,
};
const answerResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...answerResponseCommon,
      kind: z.literal(AnswerOnlyResponseKind.ANSWER_RETURNED),
      answerContent: nonBlankStringSchema,
      answerContentDigest: sha256Schema,
    })
    .strict(),
  z
    .object({
      ...answerResponseCommon,
      kind: z.literal(AnswerOnlyResponseKind.ANSWER_FAILED),
      failureReasonCode: z.enum(Object.values(AnswerOnlyFailureReasonCode)),
    })
    .strict(),
]);

export function decodeAnswerOnlyResponse(
  value: unknown,
  verifier: IntakeDigestVerifier,
): AnswerOnlyResponse {
  const response = parse(answerResponseSchema, value);
  assertAnswerOnlyResponseInvariant(response);
  if (
    response.kind === AnswerOnlyResponseKind.ANSWER_RETURNED &&
    verifier.digestUtf8(response.answerContent) !== response.answerContentDigest
  ) {
    throw new TypeError('Answer-only content digest does not match exact UTF-8 bytes');
  }
  verifyDigest(
    response.responseDigest,
    answerOnlyResponseProjection(response),
    verifier,
    'Answer-only Response digest',
  );
  return response;
}

const failureSchema = z
  .object({
    id: failureIdSchema,
    schemaVersion: z.literal(1),
    commandId: commandIdSchema,
    intakeRunId: intakeRunIdSchema,
    intakeRunVersion: intakeVersionSchema,
    rawRequestRevision: rawRevisionSchema,
    rawRequestDigest: sha256Schema,
    failedOperation: z.enum(Object.values(IntakeFailedOperation)),
    assistantAdapterId: nonBlankStringSchema.optional(),
    assistantAdapterVersion: nonBlankStringSchema.optional(),
    responseContractDigest: sha256Schema.optional(),
    reasonCode: z.enum(Object.values(IntakeFailureReasonCode)),
    retryDisposition: z.literal('NEW_INTAKE_RUN_REQUIRED'),
    failedAt: timestampSchema,
    failureDigest: sha256Schema,
  })
  .strict();

export function decodeIntakeFailureRecord(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntakeFailureRecord {
  const failure = parse(failureSchema, value);
  assertIntakeFailureRecordInvariant(failure);
  verifyDigest(
    failure.failureDigest,
    intakeFailureRecordProjection(failure),
    verifier,
    'Intake Failure Record digest',
  );
  return failure;
}

const manifestSchema = z
  .object({
    id: intakeManifestIdSchema,
    schemaVersion: z.literal(1),
    operation: z.enum(Object.values(IntakeManifestOperation)),
    intakeRunId: intakeRunIdSchema,
    rawRequestRevisions: z.array(rawRequestRevisionRefSchema).min(1),
    currentProjectionRef: z
      .object({ id: projectionIdSchema, revision: projectionRevisionSchema, digest: sha256Schema })
      .strict()
      .optional(),
    questionRefs: z.array(activeQuestionRefSchema),
    answerBindingDigests: z.array(sha256Schema),
    declaredProjectRef: declaredProjectRefSchema.optional(),
    admissionPolicy: versionedDigestRefSchema,
    assistantAdapter: z
      .object({ id: nonBlankStringSchema, version: nonBlankStringSchema })
      .strict(),
    responseContract: versionedDigestRefSchema,
    budgetProfile: versionedDigestRefSchema,
    entries: z.array(
      z
        .object({
          kind: z.enum(Object.values(IntakeManifestEntryKind)),
          sourceRef: nonBlankStringSchema,
          sourceRevision: positiveIntegerSchema.optional(),
          sourceDigest: sha256Schema,
          authorityClass: z.enum(Object.values(SourceAuthorityClass)),
        })
        .strict(),
    ),
    omissions: z.array(
      z.object({ sourceRef: nonBlankStringSchema, reasonCode: nonBlankStringSchema }).strict(),
    ),
    packageDigest: sha256Schema,
    createdAt: timestampSchema,
    manifestDigest: sha256Schema,
  })
  .strict();

export function decodeIntakeManifest(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntakeManifest {
  const manifest = parse(manifestSchema, value);
  if (
    new Set(manifest.rawRequestRevisions.map(({ revision }) => revision)).size !==
    manifest.rawRequestRevisions.length
  ) {
    throw new TypeError('Intake Manifest Raw Request revisions must be unique');
  }
  verifyDigest(
    manifest.manifestDigest,
    intakeManifestProjection(manifest),
    verifier,
    'Intake Manifest digest',
  );
  return manifest;
}

const commandInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('SUBMIT'),
      commandId: commandIdSchema,
      principalRef: principalIdSchema,
      interactionAction: z.enum(Object.values(IntakeInteractionAction)),
      admittedUserContent: nonBlankStringSchema,
      declaredProjectRef: declaredProjectRefSchema.optional(),
      declaredConstraints: z.array(nonBlankStringSchema),
      canonicalCommandInputDigest: sha256Schema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('CLARIFY'),
      commandId: commandIdSchema,
      principalRef: principalIdSchema,
      intakeRunId: intakeRunIdSchema,
      expectedIntakeRunVersion: intakeVersionSchema,
      clarificationBinding: abandonmentReservationBindingSchema.extend({ answerSchema }).strict(),
      answer: nonBlankStringSchema,
      declaredProjectRef: declaredProjectRefSchema.optional(),
      canonicalCommandInputDigest: sha256Schema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('ABANDON'),
      commandId: commandIdSchema,
      principalRef: principalIdSchema,
      intakeRunId: intakeRunIdSchema,
      expectedIntakeRunVersion: intakeVersionSchema,
      canonicalCommandInputDigest: sha256Schema,
    })
    .strict(),
]);

export function decodeIntakeCommandInput(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntakeCommandInput {
  const input = parse(commandInputSchema, value);
  verifyDigest(
    input.canonicalCommandInputDigest,
    intakeCommandInputProjection(input),
    verifier,
    'Intake command input digest',
  );
  return input;
}

const externalOperationBindingSchema = z
  .object({
    manifestId: intakeManifestIdSchema,
    manifestDigest: sha256Schema,
    admissionPolicyId: admissionPolicyIdSchema,
    admissionPolicyVersion: nonBlankStringSchema,
    admissionPolicyDigest: sha256Schema,
    assistantAdapterId: nonBlankStringSchema,
    assistantAdapterVersion: nonBlankStringSchema,
    responseContractDigest: sha256Schema,
  })
  .strict();
const clarificationBindingSchema = abandonmentReservationBindingSchema
  .extend({ answerSchema })
  .strict();
const reservationBase = {
  schemaVersion: z.literal(1),
  commandId: commandIdSchema,
  principalRef: principalIdSchema,
  rawRequestId: rawRequestIdSchema,
  intakeRunId: intakeRunIdSchema,
  canonicalCommandInputDigest: sha256Schema,
  observedIntakeRunVersion: intakeVersionSchema,
  operationId: operationIdSchema,
  reservedAt: timestampSchema,
  reservationDigest: sha256Schema,
};
const reservationSchema = z.union([
  z
    .object({
      ...reservationBase,
      operationKind: z.literal(IntakeCommandOperationKind.INTENT_ANALYSIS),
      externalOperationBinding: externalOperationBindingSchema,
    })
    .strict(),
  z
    .object({
      ...reservationBase,
      operationKind: z.literal(IntakeCommandOperationKind.ANSWER_ONLY),
      externalOperationBinding: externalOperationBindingSchema,
    })
    .strict(),
  z
    .object({
      ...reservationBase,
      operationKind: z.literal(IntakeCommandOperationKind.CLARIFICATION_ANALYSIS),
      expectedIntakeRunVersion: intakeVersionSchema,
      clarificationBinding: clarificationBindingSchema,
      externalOperationBinding: externalOperationBindingSchema,
    })
    .strict(),
  z
    .object({
      ...reservationBase,
      operationKind: z.literal(IntakeCommandOperationKind.CLARIFICATION_ANALYSIS),
      expectedIntakeRunVersion: intakeVersionSchema,
      clarificationBinding: clarificationBindingSchema,
    })
    .strict(),
  z
    .object({
      ...reservationBase,
      operationKind: z.literal(IntakeCommandOperationKind.IMMEDIATE_NO_EXECUTION),
      expectedIntakeRunVersion: intakeVersionSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...reservationBase,
      operationKind: z.literal(IntakeCommandOperationKind.ABANDON_CLARIFICATION),
      expectedIntakeRunVersion: intakeVersionSchema,
      abandonClarificationBinding: abandonmentReservationBindingSchema.optional(),
    })
    .strict(),
]);

export function decodeIntakeCommandReservation(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntakeCommandReservation {
  const reservation = parse(reservationSchema, value);
  verifyDigest(
    reservation.reservationDigest,
    intakeCommandReservationProjection(reservation),
    verifier,
    'Intake command reservation digest',
  );
  return reservation;
}

const appliedResultSchema = z.union([
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('CLARIFICATION_REQUIRED'),
      intakeRunId: intakeRunIdSchema,
      intakeRunVersion: intakeVersionSchema,
      decisionRef: clarifyDecisionRefSchema,
      activeQuestionRef: activeQuestionRefSchema,
      answerDisposition: z.literal(IntakeAnswerDisposition.NOT_REQUESTED),
      materializationDisposition: z.literal(IntakeMaterializationDisposition.NO_GOAL),
      startDisposition: z.literal(IntakeStartDisposition.NOT_AUTHORIZED),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('NO_EXECUTION'),
      intakeRunId: intakeRunIdSchema,
      intakeRunVersion: intakeVersionSchema,
      decisionRef: answerOnlyDecisionRefSchema,
      answerDisposition: z.literal(IntakeAnswerDisposition.ANSWER_RETURNED),
      answerOnlyResponseRef: answerReturnedResponseRefSchema,
      materializationDisposition: z.literal(IntakeMaterializationDisposition.NO_GOAL),
      startDisposition: z.literal(IntakeStartDisposition.NOT_AUTHORIZED),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('NO_EXECUTION'),
      intakeRunId: intakeRunIdSchema,
      intakeRunVersion: intakeVersionSchema,
      decisionRef: answerOnlyDecisionRefSchema,
      answerDisposition: z.literal(IntakeAnswerDisposition.ANSWER_FAILED),
      answerOnlyResponseRef: answerFailedResponseRefSchema,
      materializationDisposition: z.literal(IntakeMaterializationDisposition.NO_GOAL),
      startDisposition: z.literal(IntakeStartDisposition.NOT_AUTHORIZED),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('NO_EXECUTION'),
      intakeRunId: intakeRunIdSchema,
      intakeRunVersion: intakeVersionSchema,
      decisionRef: otherNoExecutionDecisionRefSchema,
      answerDisposition: z.literal(IntakeAnswerDisposition.NOT_REQUESTED),
      materializationDisposition: z.literal(IntakeMaterializationDisposition.NO_GOAL),
      startDisposition: z.literal(IntakeStartDisposition.NOT_AUTHORIZED),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('MATERIALIZED'),
      intakeRunId: intakeRunIdSchema,
      intakeRunVersion: intakeVersionSchema,
      decisionRef: materializeDecisionRefSchema.extend({
        reasonCode: z.literal(IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED),
      }),
      materializedGoalRef: materializedGoalRefSchema,
      answerDisposition: z.literal(IntakeAnswerDisposition.NOT_REQUESTED),
      materializationDisposition: z.literal(IntakeMaterializationDisposition.MATERIALIZED_READY),
      startDisposition: z.literal(IntakeStartDisposition.NOT_AUTHORIZED),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('MATERIALIZED'),
      intakeRunId: intakeRunIdSchema,
      intakeRunVersion: intakeVersionSchema,
      decisionRef: materializeDecisionRefSchema.extend({
        reasonCode: z.literal(IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED),
      }),
      materializedGoalRef: materializedGoalRefSchema,
      goalStartAuthorizationRef: z
        .object({
          id: startAuthorizationIdSchema,
          digest: sha256Schema,
          startCommandId: commandIdSchema,
        })
        .strict(),
      answerDisposition: z.literal(IntakeAnswerDisposition.NOT_REQUESTED),
      materializationDisposition: z.literal(IntakeMaterializationDisposition.MATERIALIZED_READY),
      startDisposition: z.enum([
        IntakeStartDisposition.READY_PENDING_START,
        IntakeStartDisposition.START_COMMAND_APPLIED,
        IntakeStartDisposition.START_COMMAND_REJECTED,
        IntakeStartDisposition.START_INFRASTRUCTURE_FAILURE,
      ]),
    })
    .strict(),
]);
const rejectedResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('REJECTED'),
    intakeRunId: intakeRunIdSchema,
    observedIntakeRunVersion: intakeVersionSchema,
    detailCode: nonBlankStringSchema,
  })
  .strict();
const failedResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('FAILED'),
    intakeRunId: intakeRunIdSchema,
    intakeRunVersion: intakeVersionSchema,
    failureRef: failureRefSchema,
  })
  .strict();
const resultSchema = z.union([appliedResultSchema, rejectedResultSchema, failedResultSchema]);
const outcomeCommon = {
  schemaVersion: z.literal(1),
  commandId: commandIdSchema,
  intakeRunId: intakeRunIdSchema,
  canonicalCommandInputDigest: sha256Schema,
  reservationDigest: sha256Schema,
  observedIntakeRunVersion: intakeVersionSchema,
  resultDigest: sha256Schema,
  completedAt: timestampSchema,
  outcomeDigest: sha256Schema,
};
const outcomeSchema = z.discriminatedUnion('disposition', [
  z
    .object({
      ...outcomeCommon,
      disposition: z.literal(IntakeCommandDisposition.APPLIED),
      result: appliedResultSchema,
    })
    .strict(),
  z
    .object({
      ...outcomeCommon,
      disposition: z.literal(IntakeCommandDisposition.REJECTED),
      result: rejectedResultSchema,
    })
    .strict(),
  z
    .object({
      ...outcomeCommon,
      disposition: z.literal(IntakeCommandDisposition.FAILED),
      result: failedResultSchema,
    })
    .strict(),
]);

export function decodeIntakeCommandResult(value: unknown): IntakeCommandResult {
  return parse(resultSchema, value);
}

export function decodeIntakeCommandOutcome(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntakeCommandOutcome {
  const outcome = parse(outcomeSchema, value);
  decodeIntakeCommandResult(outcome.result);
  verifyDigest(
    outcome.resultDigest,
    intakeCommandResultProjection(outcome.result),
    verifier,
    'Intake command result digest',
  );
  verifyDigest(
    outcome.outcomeDigest,
    intakeCommandOutcomeProjection(outcome),
    verifier,
    'Intake command outcome digest',
  );
  return outcome;
}

export function decodeIntakeCommandClosure(
  rawReservation: unknown,
  rawOutcome: unknown,
  verifier: IntakeDigestVerifier,
): Readonly<{ reservation: IntakeCommandReservation; outcome: IntakeCommandOutcome }> {
  const reservation = decodeIntakeCommandReservation(rawReservation, verifier);
  const outcome = decodeIntakeCommandOutcome(rawOutcome, verifier);
  assertIntakeCommandClosureInvariant(reservation, outcome);
  return Object.freeze({ reservation, outcome });
}

const materializationSchema = z
  .object({
    id: materializationIdSchema,
    schemaVersion: z.literal(1),
    intakeRunId: intakeRunIdSchema,
    rawRequestRevision: rawRevisionSchema,
    rawRequestDigest: sha256Schema,
    intentAdmissionDecisionId: admissionDecisionIdSchema,
    intentAdmissionDecisionDigest: sha256Schema,
    intentProjectionId: projectionIdSchema,
    intentProjectionRevision: projectionRevisionSchema,
    intentProjectionDigest: sha256Schema,
    projectOrScopeRef: declaredProjectRefSchema,
    goalId: goalIdSchema,
    goalRevision: goalRevisionSchema,
    workflowId: workflowIdSchema,
    workflowVersion: workflowVersionSchema,
    materializedAt: timestampSchema,
    materializationDigest: sha256Schema,
  })
  .strict();
const startAuthorizationSchema = z
  .object({
    id: startAuthorizationIdSchema,
    schemaVersion: z.literal(1),
    principalRef: principalIdSchema,
    rawRequestRevision: rawRevisionSchema,
    rawRequestDigest: sha256Schema,
    intentAdmissionDecisionId: admissionDecisionIdSchema,
    intentAdmissionDecisionDigest: sha256Schema,
    goalMaterializationId: materializationIdSchema,
    goalMaterializationDigest: sha256Schema,
    goalId: goalIdSchema,
    goalRevision: goalRevisionSchema,
    workflowId: workflowIdSchema,
    workflowVersion: workflowVersionSchema,
    startCommandId: commandIdSchema,
    policyBundleId: policyBundleIdSchema,
    policyBundleDigest: sha256Schema,
    executionProfileId: executionProfileIdSchema,
    executionProfileDigest: sha256Schema,
    authorizedAt: timestampSchema,
    authorizationDigest: sha256Schema,
  })
  .strict();

export function decodeGoalMaterializationRecord(
  value: unknown,
  verifier: IntakeDigestVerifier,
): GoalMaterializationRecord {
  const record = parse(materializationSchema, value);
  assertGoalMaterializationInvariant(record);
  verifyDigest(
    record.materializationDigest,
    goalMaterializationProjection(record),
    verifier,
    'Goal Materialization digest',
  );
  return record;
}

export function decodeGoalStartAuthorization(
  value: unknown,
  verifier: IntakeDigestVerifier,
): GoalStartAuthorization {
  const record = parse(startAuthorizationSchema, value);
  assertGoalStartAuthorizationInvariant(record);
  verifyDigest(
    record.authorizationDigest,
    goalStartAuthorizationProjection(record),
    verifier,
    'Goal Start Authorization digest',
  );
  return record;
}

const materialFieldRuleSchema = z
  .object({
    field: z.enum(Object.values(IntentAdmissionMaterialFieldKind)),
    cardinality: z.enum(Object.values(IntentAdmissionFieldCardinality)),
    allowedAuthorityClasses: z.array(z.enum(Object.values(SourceAuthorityClass))),
    exactDerivationRuleId: z.enum(Object.values(IntentAdmissionDerivationRuleId)).optional(),
    materializedCriterionRequired: z.literal(true).optional(),
  })
  .strict();
const policyRuleSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ruleId: z.literal(IntentAdmissionRuleId.ANSWER_ONLY_ACTION),
      ruleVersion: z.literal('codeclosure-m2-5-v1'),
      kind: z.literal(IntentAdmissionPolicyRuleKind.ANSWER_ONLY_ACTION),
      interactionAction: z.literal(IntakeInteractionAction.ANSWER_ONLY),
      decisionKind: z.literal(IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION),
      outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
      reasonCode: z.literal(IntentAdmissionReasonCode.ANSWER_ONLY),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
  z
    .object({
      ruleId: z.literal(IntentAdmissionRuleId.ABANDON_ACTIVE_QUESTION),
      ruleVersion: z.literal('codeclosure-m2-5-v1'),
      kind: z.literal(IntentAdmissionPolicyRuleKind.ABANDON_ACTIVE_QUESTION),
      requiresExactCurrentQuestionBinding: z.literal(true),
      decisionKind: z.literal(IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION),
      outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
      reasonCode: z.literal(IntentAdmissionReasonCode.ABANDONED),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
  z
    .object({
      ruleId: z.literal(IntentAdmissionRuleId.MATERIAL_FIELD_ELIGIBILITY),
      ruleVersion: z.literal('codeclosure-m2-5-v1'),
      kind: z.literal(IntentAdmissionPolicyRuleKind.MATERIAL_FIELD_ELIGIBILITY),
      fields: z.array(materialFieldRuleSchema),
    })
    .strict(),
  z
    .object({
      ruleId: z.literal(IntentAdmissionRuleId.FIRST_MATERIAL_AMBIGUITY),
      ruleVersion: z.literal('codeclosure-m2-5-v1'),
      kind: z.literal(IntentAdmissionPolicyRuleKind.FIRST_MATERIAL_AMBIGUITY),
      fieldPriority: z.array(z.enum(Object.values(IntentProjectionField))),
      tieBreak: z.literal('SOURCE_BYTE_ORDER'),
      maxActiveQuestions: z.literal(1),
    })
    .strict(),
  z
    .object({
      ruleId: z.literal(IntentAdmissionRuleId.MATERIALIZE_ONLY_DISPOSITION),
      ruleVersion: z.literal('codeclosure-m2-5-v1'),
      kind: z.literal(IntentAdmissionPolicyRuleKind.MATERIALIZE_ONLY_DISPOSITION),
      interactionAction: z.literal(IntakeInteractionAction.MATERIALIZE_ONLY),
      decisionKind: z.literal(IntentAdmissionDecisionKind.MATERIALIZE),
      outcome: z.literal(IntentAdmissionOutcome.MATERIALIZE),
      reasonCode: z.literal(IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED),
      executionDisposition: z.literal(IntentExecutionDisposition.LEAVE_READY),
    })
    .strict(),
  z
    .object({
      ruleId: z.literal(IntentAdmissionRuleId.GOVERNED_EXECUTION_DISPOSITION),
      ruleVersion: z.literal('codeclosure-m2-5-v1'),
      kind: z.literal(IntentAdmissionPolicyRuleKind.GOVERNED_EXECUTION_DISPOSITION),
      interactionAction: z.literal(IntakeInteractionAction.GOVERNED_EXECUTION),
      requiresExactWorkflowPolicyAndProfilePreflight: z.literal(true),
      decisionKind: z.literal(IntentAdmissionDecisionKind.MATERIALIZE),
      outcome: z.literal(IntentAdmissionOutcome.MATERIALIZE),
      reasonCode: z.literal(IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED),
      executionDisposition: z.literal(IntentExecutionDisposition.AUTHORIZE_START),
    })
    .strict(),
  z
    .object({
      ruleId: z.literal(IntentAdmissionRuleId.TEST_DENY_EXACT_PRINCIPAL),
      ruleVersion: z.literal('codeclosure-m2-5-test-v1'),
      kind: z.literal(IntentAdmissionPolicyRuleKind.DENY_EXACT_PRINCIPAL),
      principalRef: z.literal('principal_fixture-policy-denied'),
      interactionAction: z.literal(IntakeInteractionAction.MATERIALIZE_ONLY),
      decisionKind: z.literal(IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION),
      outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
      reasonCode: z.literal(IntentAdmissionReasonCode.POLICY_DENIED),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
  z
    .object({
      ruleId: z.literal(IntentAdmissionRuleId.TEST_UNSUPPORTED_GOVERNED_EXECUTION),
      ruleVersion: z.literal('codeclosure-m2-5-test-v1'),
      kind: z.literal(IntentAdmissionPolicyRuleKind.UNSUPPORTED_GOVERNED_EXECUTION),
      interactionAction: z.literal(IntakeInteractionAction.GOVERNED_EXECUTION),
      decisionKind: z.literal(IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION),
      outcome: z.literal(IntentAdmissionOutcome.NO_EXECUTION),
      reasonCode: z.literal(IntentAdmissionReasonCode.UNSUPPORTED),
      executionDisposition: z.literal(IntentExecutionDisposition.NONE),
    })
    .strict(),
]);
const derivationRuleSchema = z
  .object({
    id: z.enum(Object.values(IntentAdmissionDerivationRuleId)),
    version: z.enum(['codeclosure-m2-5-v1', 'codeclosure-m2-5-1-v1']),
    sourceKind: z.enum([
      'DECLARED_PROJECT_REF',
      'TRUSTED_INTERACTION_ACTION',
      'TRUSTED_ADMISSION_POLICY',
    ]),
    targetField: z.enum([
      IntentProjectionField.PROJECT_IDENTITY,
      IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION,
      IntentProjectionField.SCOPE,
    ]),
    meaningPreserving: z.literal(true),
  })
  .strict();
const policyDefinitionFields = {
  id: admissionPolicyIdSchema,
  schemaVersion: z.literal(1),
  version: nonBlankStringSchema,
  orderedRules: z.array(policyRuleSchema),
  derivationRules: z.array(derivationRuleSchema),
  trustedProjectScope: z
    .object({
      projectPath: nonBlankStringSchema,
      allowedPaths: z.array(nonBlankStringSchema),
    })
    .strict()
    .optional(),
  policyDeniedRuleIds: z.array(z.enum(Object.values(IntentAdmissionRuleId))),
  unsupportedRuleIds: z.array(z.enum(Object.values(IntentAdmissionRuleId))),
};
const policyDefinitionSchema = z.object(policyDefinitionFields).strict();
const policySchema = z.object({ ...policyDefinitionFields, digest: sha256Schema }).strict();
const policyInstallInputSchema = z
  .object({
    policy: policySchema,
    installedAt: timestampSchema,
    auditEventId: auditEventIdSchema,
    payloadDigest: sha256Schema,
  })
  .strict();

export function decodeIntentAdmissionPolicyDefinition(
  value: unknown,
): IntentAdmissionPolicyDefinition {
  const definition = parse(policyDefinitionSchema, value);
  assertIntentAdmissionPolicyDefinitionInvariant(definition);
  return definition;
}

export function decodeIntentAdmissionPolicy(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntentAdmissionPolicy {
  const policy = parse(policySchema, value);
  assertIntentAdmissionPolicyInvariant(policy);
  verifyDigest(
    policy.digest,
    intentAdmissionPolicyProjection(policy),
    verifier,
    'Intent Admission Policy digest',
  );
  return policy;
}

export function decodeIntentAdmissionPolicyInstallInput(
  value: unknown,
  verifier: IntakeDigestVerifier,
): IntentAdmissionPolicyInstallInput {
  const input = parse(policyInstallInputSchema, value);
  assertIntentAdmissionPolicyInstallInputInvariant(input);
  verifyDigest(
    input.policy.digest,
    intentAdmissionPolicyProjection(input.policy),
    verifier,
    'Installed Intent Admission Policy digest',
  );
  return input;
}
