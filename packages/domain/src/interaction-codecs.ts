import { z } from 'zod';

import {
  clarificationQuestionId,
  commandId,
  focusBindingId,
  frontstageAnswerId,
  frontstageContextManifestId,
  goalId,
  goalRevision,
  intakeRunId,
  intakeRunVersion,
  interactionActionOutcomeId,
  interactionActionReservationId,
  interactionConfirmationPolicyId,
  interactionMessageHandoffId,
  interactionMessageId,
  interactionOperationId,
  interactionOperationVersion,
  interactionRoutingPolicyId,
  interactionSessionId,
  interactionSessionVersion,
  isoTimestamp,
  pendingActionId,
  pendingActionResolutionId,
  principalId,
  routeDecisionId,
  routeProposalId,
  sha256Digest,
  workflowId,
  workflowVersion,
  type Sha256Digest,
} from './identifiers.js';
import {
  DirectActionGrammarNormalization,
  DirectActionHandoffRule,
  DirectActionTargetRule,
  InteractionTrustedParserKind,
  assertConfirmationGrammarDefinitionInvariant,
  assertConfirmationGrammarInvariant,
  assertDirectActionGrammarDefinitionInvariant,
  assertDirectActionGrammarInvariant,
  assertInteractionConfirmationPolicyDefinitionInvariant,
  assertInteractionConfirmationPolicyInvariant,
  assertInteractionRoutingPolicyDefinitionInvariant,
  assertInteractionRoutingPolicyInvariant,
  confirmationGrammarProjection,
  directActionGrammarProjection,
  interactionConfirmationPolicyProjection,
  interactionRoutingPolicyProjection,
  type ConfirmationGrammar,
  type ConfirmationGrammarDefinition,
  type DirectActionGrammar,
  type DirectActionGrammarDefinition,
  type InteractionConfirmationPolicy,
  type InteractionConfirmationPolicyDefinition,
  type InteractionRoutingPolicy,
  type InteractionRoutingPolicyDefinition,
} from './interaction-policy.js';
import {
  FrontstageCandidateRoute,
  FrontstageNoActionReason,
  FrontstageProposalAmbiguity,
  FrontstageProposalKind,
  InteractionActionOutcomeDisposition,
  InteractionConfirmationRequirement,
  InteractionContentOmissionReason,
  InteractionContentRetention,
  InteractionFocusKind,
  InteractionMessageRole,
  InteractionOperationFailureReason,
  InteractionOperationKind,
  InteractionOperationResultKind,
  InteractionOperationState,
  InteractionPublicCapability,
  InteractionRouteDecisionOutcome,
  InteractionRouteDecisionSource,
  InteractionSessionState,
  InteractionSessionTerminalReason,
  PendingActionDerivation,
  PendingActionKind,
  PendingActionResolutionDisposition,
  assertFocusBindingInvariant,
  assertFrontstageAnswerInvariant,
  assertInteractionActionOutcomeInvariant,
  assertInteractionActionReservationInvariant,
  assertInteractionMessageHandoffInvariant,
  assertInteractionMessageInvariant,
  assertInteractionOperationInvariant,
  assertInteractionSessionInvariant,
  assertPendingActionInvariant,
  assertPendingActionResolutionInvariant,
  assertRouteDecisionInvariant,
  assertRouteProposalInvariant,
  focusBindingProjection,
  frontstageAnswerProjection,
  interactionActionOutcomeProjection,
  interactionActionReservationProjection,
  interactionMessageHandoffProjection,
  interactionMessageProjection,
  interactionOperationProjection,
  interactionSessionProjection,
  pendingActionProjection,
  pendingActionResolutionProjection,
  routeDecisionProjection,
  routeProposalProjection,
  type FocusBinding,
  type FrontstageAnswer,
  type InteractionActionOutcome,
  type InteractionActionReservation,
  type InteractionMessage,
  type InteractionMessageHandoff,
  type InteractionOperation,
  type InteractionSession,
  type PendingAction,
  type PendingActionResolution,
  type RouteDecision,
  type RouteProposal,
} from './interaction.js';

export interface InteractionDigestVerifier {
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
  return deepFreeze(schema.parse(value)) as ExactParsed<z.output<Schema>>;
}

function verifyDigest(
  actual: Sha256Digest,
  projection: unknown,
  verifier: InteractionDigestVerifier,
  name: string,
): void {
  if (actual !== sha256Digest(verifier.digest(projection))) {
    throw new TypeError(`${name} does not match its canonical projection`);
  }
}

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  error: 'String must not be blank',
});
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const digestSchema = z.string().transform(sha256Digest);
const timestampSchema = z.string().transform(isoTimestamp);
const sessionIdSchema = z.string().transform(interactionSessionId);
const sessionVersionSchema = positiveIntegerSchema.transform(interactionSessionVersion);
const messageIdSchema = z.string().transform(interactionMessageId);
const operationIdSchema = z.string().transform(interactionOperationId);
const operationVersionSchema = positiveIntegerSchema.transform(interactionOperationVersion);
const focusIdSchema = z.string().transform(focusBindingId);
const proposalIdSchema = z.string().transform(routeProposalId);
const decisionIdSchema = z.string().transform(routeDecisionId);
const pendingIdSchema = z.string().transform(pendingActionId);
const resolutionIdSchema = z.string().transform(pendingActionResolutionId);
const reservationIdSchema = z.string().transform(interactionActionReservationId);
const outcomeIdSchema = z.string().transform(interactionActionOutcomeId);
const handoffIdSchema = z.string().transform(interactionMessageHandoffId);
const answerIdSchema = z.string().transform(frontstageAnswerId);
const manifestIdSchema = z.string().transform(frontstageContextManifestId);
const principalIdSchema = z.string().transform(principalId);
const commandIdSchema = z.string().transform(commandId);
const goalIdSchema = z.string().transform(goalId);
const goalRevisionSchema = positiveIntegerSchema.transform(goalRevision);
const workflowIdSchema = z.string().transform(workflowId);
const workflowVersionSchema = positiveIntegerSchema.transform(workflowVersion);
const intakeRunIdSchema = z.string().transform(intakeRunId);
const intakeRunVersionSchema = positiveIntegerSchema.transform(intakeRunVersion);
const questionIdSchema = z.string().transform(clarificationQuestionId);

const versionedDigestRefSchema = z
  .object({ id: nonBlankStringSchema, version: nonBlankStringSchema, digest: digestSchema })
  .strict();

function digestRefSchema<Schema extends z.ZodType>(id: Schema) {
  return z.object({ id, digest: digestSchema }).strict();
}

const messageRefSchema = digestRefSchema(messageIdSchema);
const operationRefSchema = digestRefSchema(operationIdSchema);
const focusRefSchema = digestRefSchema(focusIdSchema);
const proposalRefSchema = digestRefSchema(proposalIdSchema);
const decisionRefSchema = digestRefSchema(decisionIdSchema);
const pendingRefSchema = digestRefSchema(pendingIdSchema);
const resolutionRefSchema = digestRefSchema(resolutionIdSchema);
const reservationRefSchema = digestRefSchema(reservationIdSchema);
const handoffRefSchema = digestRefSchema(handoffIdSchema);
const answerRefSchema = digestRefSchema(answerIdSchema);
const manifestRefSchema = digestRefSchema(manifestIdSchema);

const projectRefSchema = z
  .object({
    schemaVersion: z.literal(1),
    normalizedPath: nonBlankStringSchema,
    identityDigest: digestSchema,
  })
  .strict();

const goalTargetSchema = z
  .object({
    goalId: goalIdSchema,
    goalRevision: goalRevisionSchema,
    workflowId: workflowIdSchema,
    workflowVersion: workflowVersionSchema,
  })
  .strict();

const questionTargetSchema = z
  .object({
    intakeRunId: intakeRunIdSchema,
    intakeRunVersion: intakeRunVersionSchema,
    clarificationQuestionId: questionIdSchema,
    questionSpecDigest: digestSchema,
    questionDigest: digestSchema,
  })
  .strict();

const sessionCommon = {
  id: sessionIdSchema,
  schemaVersion: z.literal(1),
  version: sessionVersionSchema,
  principalRef: principalIdSchema,
  projectRef: projectRefSchema,
  configuration: versionedDigestRefSchema,
  routingPolicy: versionedDigestRefSchema,
  confirmationPolicy: versionedDigestRefSchema,
  retentionProfile: versionedDigestRefSchema,
  currentFocusRef: focusRefSchema.optional(),
  openedAt: timestampSchema,
  updatedAt: timestampSchema,
  sessionDigest: digestSchema,
};
const sessionSchema = z.discriminatedUnion('state', [
  z.object({ ...sessionCommon, state: z.literal(InteractionSessionState.OPEN) }).strict(),
  z.object({ ...sessionCommon, state: z.literal(InteractionSessionState.CLOSING) }).strict(),
  z.object({ ...sessionCommon, state: z.literal(InteractionSessionState.INTERRUPTED) }).strict(),
  z
    .object({
      ...sessionCommon,
      state: z.literal(InteractionSessionState.CLOSED),
      terminalReason: z
        .literal(InteractionSessionTerminalReason.RETENTION_LIMIT_REACHED)
        .optional(),
    })
    .strict(),
]);

const messageCommon = {
  id: messageIdSchema,
  schemaVersion: z.literal(1),
  sessionId: sessionIdSchema,
  principalRef: principalIdSchema,
  contentDigest: digestSchema,
  contentByteLength: nonNegativeIntegerSchema,
  createdAt: timestampSchema,
  messageDigest: digestSchema,
};
const retainedMessageFields = {
  retention: z.literal(InteractionContentRetention.RETAINED),
  content: z.string(),
};
const omittedMessageFields = {
  retention: z.literal(InteractionContentRetention.OMITTED),
  omissionReason: z.enum(Object.values(InteractionContentOmissionReason)),
};
const messageSchema = z.union([
  z
    .object({
      ...messageCommon,
      ...retainedMessageFields,
      role: z.literal(InteractionMessageRole.USER),
    })
    .strict(),
  z
    .object({
      ...messageCommon,
      ...omittedMessageFields,
      role: z.literal(InteractionMessageRole.USER),
    })
    .strict(),
  z
    .object({
      ...messageCommon,
      ...retainedMessageFields,
      role: z.enum([InteractionMessageRole.FRONTSTAGE, InteractionMessageRole.SYSTEM]),
      causedByOperationRef: operationRefSchema,
    })
    .strict(),
  z
    .object({
      ...messageCommon,
      ...omittedMessageFields,
      role: z.enum([InteractionMessageRole.FRONTSTAGE, InteractionMessageRole.SYSTEM]),
      causedByOperationRef: operationRefSchema,
    })
    .strict(),
]);

const focusCommon = {
  id: focusIdSchema,
  schemaVersion: z.literal(1),
  sessionId: sessionIdSchema,
  basedOnSessionVersion: sessionVersionSchema,
  createdAt: timestampSchema,
  focusDigest: digestSchema,
};
const focusSchema = z.discriminatedUnion('kind', [
  z.object({ ...focusCommon, kind: z.literal(InteractionFocusKind.NONE) }).strict(),
  z
    .object({
      ...focusCommon,
      kind: z.literal(InteractionFocusKind.INTAKE_QUESTION),
      questionTarget: questionTargetSchema,
    })
    .strict(),
  z
    .object({
      ...focusCommon,
      kind: z.literal(InteractionFocusKind.GOAL),
      goalTarget: goalTargetSchema,
    })
    .strict(),
]);

const proposalCommon = {
  id: proposalIdSchema,
  schemaVersion: z.literal(1),
  sessionId: sessionIdSchema,
  operationId: operationIdSchema,
  messageRef: messageRefSchema,
  contextManifestRef: manifestRefSchema,
  assistantProfile: versionedDigestRefSchema,
  assistantAdapter: versionedDigestRefSchema,
  responseContract: versionedDigestRefSchema,
  observedAt: timestampSchema,
  proposalDigest: digestSchema,
};
const proposalSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...proposalCommon,
      kind: z.literal(FrontstageProposalKind.ANSWER_PROPOSAL),
      answerContent: nonBlankStringSchema,
    })
    .strict(),
  z
    .object({
      ...proposalCommon,
      kind: z.literal(FrontstageProposalKind.ROUTE_PROPOSAL),
      candidateRoute: z.enum(Object.values(FrontstageCandidateRoute)),
      candidateGoalIds: z.array(goalIdSchema).max(4),
      ambiguity: z.enum(Object.values(FrontstageProposalAmbiguity)),
      explanationContent: nonBlankStringSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...proposalCommon,
      kind: z.literal(FrontstageProposalKind.CLARIFICATION_PROPOSAL),
      ambiguity: z.enum([
        FrontstageProposalAmbiguity.ACTION_AMBIGUOUS,
        FrontstageProposalAmbiguity.TARGET_AMBIGUOUS,
        FrontstageProposalAmbiguity.REQUEST_INCOMPLETE,
      ]),
      questionContent: nonBlankStringSchema,
    })
    .strict(),
  z
    .object({
      ...proposalCommon,
      kind: z.literal(FrontstageProposalKind.NO_ACTION_PROPOSAL),
      reasonCode: z.enum(Object.values(FrontstageNoActionReason)),
    })
    .strict(),
]);

const traceSchema = z
  .object({
    ruleId: nonBlankStringSchema,
    policyDigest: digestSchema,
    outcome: z.enum(['MATCHED', 'NOT_MATCHED']),
    inputDigests: z.array(digestSchema).min(1),
  })
  .strict();

const decisionCommon = {
  id: decisionIdSchema,
  schemaVersion: z.literal(1),
  sessionId: sessionIdSchema,
  expectedSessionVersion: sessionVersionSchema,
  messageRef: messageRefSchema,
  focusRef: focusRefSchema.optional(),
  proposalRef: proposalRefSchema.optional(),
  source: z.enum(Object.values(InteractionRouteDecisionSource)),
  routingPolicy: versionedDigestRefSchema,
  allowedRoutes: z.array(z.enum(Object.values(InteractionRouteDecisionOutcome))).min(1),
  reasonTrace: z.array(traceSchema).min(1),
  decidedAt: timestampSchema,
  decisionDigest: digestSchema,
};
const decisionSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      ...decisionCommon,
      outcome: z.literal(InteractionRouteDecisionOutcome.ANSWER),
      answerProposalRef: proposalRefSchema,
    })
    .strict(),
  z
    .object({ ...decisionCommon, outcome: z.literal(InteractionRouteDecisionOutcome.LIST_GOALS) })
    .strict(),
  z
    .object({
      ...decisionCommon,
      outcome: z.literal(InteractionRouteDecisionOutcome.SHOW_GOAL),
      goalTarget: goalTargetSchema,
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      outcome: z.literal(InteractionRouteDecisionOutcome.CONTINUE_EXACT_INTAKE_QUESTION),
      questionTarget: questionTargetSchema,
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      outcome: z.literal(InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION),
      actionKind: z.enum([
        PendingActionKind.SUBMIT_GOVERNED_INTAKE,
        PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      ]),
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      outcome: z.literal(InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL),
      actionKind: z.enum([
        PendingActionKind.START_GOAL,
        PendingActionKind.RESUME_GOAL,
        PendingActionKind.CANCEL_GOAL,
      ]),
      goalTarget: goalTargetSchema,
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      outcome: z.literal(InteractionRouteDecisionOutcome.ASK_ROUTE_CLARIFICATION),
      ambiguity: z.enum([
        FrontstageProposalAmbiguity.ACTION_AMBIGUOUS,
        FrontstageProposalAmbiguity.TARGET_AMBIGUOUS,
        FrontstageProposalAmbiguity.REQUEST_INCOMPLETE,
      ]),
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      outcome: z.literal(InteractionRouteDecisionOutcome.NO_ACTION),
      reasonCode: z.enum(Object.values(FrontstageNoActionReason)),
    })
    .strict(),
]);

const pendingCommon = {
  id: pendingIdSchema,
  schemaVersion: z.literal(1),
  sessionId: sessionIdSchema,
  principalRef: principalIdSchema,
  projectRef: projectRefSchema,
  originatingMessageRef: messageRefSchema,
  routeDecisionRef: decisionRefSchema,
  focusRef: focusRefSchema.optional(),
  preallocatedCommandId: commandIdSchema,
  canonicalCommandInputDigest: digestSchema,
  routingPolicy: versionedDigestRefSchema,
  confirmationPolicy: versionedDigestRefSchema,
  confirmationRequirement: z.enum(Object.values(InteractionConfirmationRequirement)),
  reasonTrace: z.array(traceSchema).min(1),
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
  pendingActionDigest: digestSchema,
};
const pendingActionSchema = z.union([
  z
    .object({
      ...pendingCommon,
      kind: z.enum([
        PendingActionKind.SUBMIT_GOVERNED_INTAKE,
        PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      ]),
      actionDerivation: z.enum(Object.values(PendingActionDerivation)),
      publicCapability: z.literal(InteractionPublicCapability.SUBMIT_INTAKE),
    })
    .strict(),
  z
    .object({
      ...pendingCommon,
      kind: z.enum([
        PendingActionKind.START_GOAL,
        PendingActionKind.RESUME_GOAL,
        PendingActionKind.CANCEL_GOAL,
      ]),
      actionDerivation: z.literal(PendingActionDerivation.ROUTED_ACTION),
      publicCapability: z.enum([
        InteractionPublicCapability.START_GOAL,
        InteractionPublicCapability.RESUME_GOAL,
        InteractionPublicCapability.CANCEL_GOAL,
      ]),
      goalTarget: goalTargetSchema,
    })
    .strict(),
]);

const resolutionCommon = {
  id: resolutionIdSchema,
  schemaVersion: z.literal(1),
  pendingActionRef: pendingRefSchema,
  confirmationPolicy: versionedDigestRefSchema,
  resolvedAt: timestampSchema,
  resolutionDigest: digestSchema,
};
const resolutionSchema = z.discriminatedUnion('disposition', [
  z
    .object({
      ...resolutionCommon,
      disposition: z.literal(PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED),
      authorizingMessageRef: messageRefSchema,
    })
    .strict(),
  z
    .object({
      ...resolutionCommon,
      disposition: z.literal(PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED),
      originatingMessageRef: messageRefSchema,
      authorizingMessageRef: messageRefSchema,
    })
    .strict(),
  z
    .object({
      ...resolutionCommon,
      disposition: z.enum([
        PendingActionResolutionDisposition.DECLINED,
        PendingActionResolutionDisposition.UNCLEAR,
      ]),
      responseMessageRef: messageRefSchema,
    })
    .strict(),
  z
    .object({
      ...resolutionCommon,
      disposition: z.enum([
        PendingActionResolutionDisposition.EXPIRED,
        PendingActionResolutionDisposition.STALE_AUTHORITY,
        PendingActionResolutionDisposition.CONFLICT,
        PendingActionResolutionDisposition.INTERRUPTED,
      ]),
    })
    .strict(),
]);

const reservationSchema = z
  .object({
    id: reservationIdSchema,
    schemaVersion: z.literal(1),
    pendingActionRef: pendingRefSchema,
    resolutionRef: resolutionRefSchema,
    publicCapability: z.enum(Object.values(InteractionPublicCapability)),
    commandId: commandIdSchema,
    canonicalCommandInputDigest: digestSchema,
    reservedAt: timestampSchema,
    reservationDigest: digestSchema,
  })
  .strict();

const outcomeSchema = z
  .object({
    id: outcomeIdSchema,
    schemaVersion: z.literal(1),
    reservationRef: reservationRefSchema,
    commandId: commandIdSchema,
    canonicalCommandInputDigest: digestSchema,
    disposition: z.enum(Object.values(InteractionActionOutcomeDisposition)),
    publicCommandOutcomeDigest: digestSchema,
    resultProjectionDigest: digestSchema,
    completedAt: timestampSchema,
    outcomeDigest: digestSchema,
  })
  .strict();

const handoffSchema = z
  .object({
    id: handoffIdSchema,
    schemaVersion: z.literal(1),
    sessionId: sessionIdSchema,
    messageRef: messageRefSchema,
    pendingActionRef: pendingRefSchema,
    resolutionRef: resolutionRefSchema,
    reservationRef: reservationRefSchema,
    admittedUserContent: nonBlankStringSchema,
    admittedContentDigest: digestSchema,
    intakeCommandId: commandIdSchema,
    createdAt: timestampSchema,
    handoffDigest: digestSchema,
  })
  .strict();

const answerSchema = z
  .object({
    id: answerIdSchema,
    schemaVersion: z.literal(1),
    sessionId: sessionIdSchema,
    originatingMessageRef: messageRefSchema,
    routeDecisionRef: decisionRefSchema,
    proposalRef: proposalRefSchema,
    assistantProfile: versionedDigestRefSchema,
    responseContract: versionedDigestRefSchema,
    retentionProfile: versionedDigestRefSchema,
    answerContent: nonBlankStringSchema,
    answerContentDigest: digestSchema,
    createdAt: timestampSchema,
    answerDigest: digestSchema,
  })
  .strict();

const operationResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal(InteractionOperationResultKind.ROUTE_DECIDED),
      routeDecisionRef: decisionRefSchema,
      routeProposalRef: proposalRefSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(InteractionOperationResultKind.ANSWER_RECORDED),
      answerRef: answerRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal(InteractionOperationResultKind.GOAL_VIEW_RECORDED),
      projectionDigest: digestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal(InteractionOperationResultKind.INTAKE_HANDOFF_RECORDED),
      handoffRef: handoffRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal(InteractionOperationResultKind.PUBLIC_COMMAND_RECORDED),
      commandId: commandIdSchema,
      publicCommandOutcomeDigest: digestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal(InteractionOperationResultKind.PENDING_ACTION_RECORDED),
      pendingActionRef: pendingRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal(InteractionOperationResultKind.ACTION_RESOLUTION_RECORDED),
      resolutionRef: resolutionRefSchema,
      reservationRef: reservationRefSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(InteractionOperationResultKind.RESULT_PROJECTED),
      projectionDigest: digestSchema,
    })
    .strict(),
]);
const operationCommon = {
  id: operationIdSchema,
  schemaVersion: z.literal(1),
  version: operationVersionSchema,
  sessionId: sessionIdSchema,
  expectedSessionVersion: sessionVersionSchema,
  messageRef: messageRefSchema,
  operationKind: z.enum(Object.values(InteractionOperationKind)),
  contextManifestRef: manifestRefSchema.optional(),
  assistantProfile: versionedDigestRefSchema.optional(),
  reservedAt: timestampSchema,
  operationDigest: digestSchema,
};
const operationSchema = z.discriminatedUnion('state', [
  z.object({ ...operationCommon, state: z.literal(InteractionOperationState.RESERVED) }).strict(),
  z
    .object({
      ...operationCommon,
      state: z.literal(InteractionOperationState.COMPLETED),
      result: operationResultSchema,
      completedAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      ...operationCommon,
      state: z.literal(InteractionOperationState.FAILED),
      failureReason: z.enum([
        InteractionOperationFailureReason.VALIDATION_REJECTED,
        InteractionOperationFailureReason.ASSISTANT_FAILED,
        InteractionOperationFailureReason.PUBLIC_CAPABILITY_FAILED,
        InteractionOperationFailureReason.RESULT_PROJECTION_FAILED,
      ]),
      completedAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      ...operationCommon,
      state: z.literal(InteractionOperationState.INTERRUPTED),
      failureReason: z.literal(InteractionOperationFailureReason.INTERRUPTED),
      completedAt: timestampSchema,
    })
    .strict(),
]);

const directFormSchema = z
  .object({
    messageTemplate: nonBlankStringSchema,
    actionKind: z.enum([
      PendingActionKind.SUBMIT_GOVERNED_INTAKE,
      PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      PendingActionKind.START_GOAL,
      PendingActionKind.RESUME_GOAL,
    ]),
    targetRule: z.enum(Object.values(DirectActionTargetRule)),
    handoffRule: z.enum(Object.values(DirectActionHandoffRule)).optional(),
  })
  .strict();
const directGrammarDefinitionSchema = z
  .object({
    id: nonBlankStringSchema,
    schemaVersion: z.literal(1),
    version: nonBlankStringSchema,
    locale: z.literal('zh-CN'),
    normalization: z.literal(DirectActionGrammarNormalization.NONE_EXACT_UNICODE_SCALAR_SEQUENCE),
    forms: z.array(directFormSchema),
  })
  .strict();
const directGrammarSchema = directGrammarDefinitionSchema.extend({ digest: digestSchema }).strict();
const confirmationGrammarDefinitionSchema = z
  .object({
    id: nonBlankStringSchema,
    schemaVersion: z.literal(1),
    version: nonBlankStringSchema,
    locale: z.literal('zh-CN'),
    normalization: z.literal(DirectActionGrammarNormalization.NONE_EXACT_UNICODE_SCALAR_SEQUENCE),
    confirmPhrases: z.array(nonBlankStringSchema),
    declinePhrases: z.array(nonBlankStringSchema),
  })
  .strict();
const confirmationGrammarSchema = confirmationGrammarDefinitionSchema
  .extend({ digest: digestSchema })
  .strict();
const routingPolicyDefinitionSchema = z
  .object({
    id: z.string().transform(interactionRoutingPolicyId),
    schemaVersion: z.literal(1),
    version: nonBlankStringSchema,
    directActionGrammar: versionedDigestRefSchema,
    parserOrder: z.array(z.enum(Object.values(InteractionTrustedParserKind))),
    allowedRouteOutcomes: z.array(z.enum(Object.values(InteractionRouteDecisionOutcome))),
    allowedAssistantCandidateRoutes: z.array(z.enum(Object.values(FrontstageCandidateRoute))),
  })
  .strict();
const routingPolicySchema = routingPolicyDefinitionSchema.extend({ digest: digestSchema }).strict();
const confirmationPolicyDefinitionSchema = z
  .object({
    id: z.string().transform(interactionConfirmationPolicyId),
    schemaVersion: z.literal(1),
    version: nonBlankStringSchema,
    confirmationGrammar: versionedDigestRefSchema,
    directlyAuthorizableKinds: z.array(z.enum(Object.values(PendingActionKind))),
    alwaysSeparateKinds: z.array(z.enum(Object.values(PendingActionKind))),
    busyStartOrResumeDisposition: z.literal('SESSION_EXECUTION_BUSY'),
    busyGovernedAlternative: z.literal('SAME_MESSAGE_MATERIALIZE_ONLY_SEPARATE_RESPONSE_REQUIRED'),
    busyCancellationTarget: z.literal('ACTIVE_SESSION_GOAL_ONLY_SEPARATE_RESPONSE_REQUIRED'),
  })
  .strict();
const confirmationPolicySchema = confirmationPolicyDefinitionSchema
  .extend({ digest: digestSchema })
  .strict();

export function decodeInteractionSession(
  value: unknown,
  verifier: InteractionDigestVerifier,
): InteractionSession {
  const record = parse(sessionSchema, value);
  assertInteractionSessionInvariant(record);
  verifyDigest(
    record.sessionDigest,
    interactionSessionProjection(record),
    verifier,
    'Session digest',
  );
  return record;
}

export function decodeInteractionMessage(
  value: unknown,
  verifier: InteractionDigestVerifier,
): InteractionMessage {
  const record = parse(messageSchema, value);
  assertInteractionMessageInvariant(record);
  if (
    record.retention === InteractionContentRetention.RETAINED &&
    record.contentDigest !== sha256Digest(verifier.digestUtf8(record.content))
  ) {
    throw new TypeError('Interaction Message content digest does not match exact UTF-8 bytes');
  }
  verifyDigest(
    record.messageDigest,
    interactionMessageProjection(record),
    verifier,
    'Message digest',
  );
  return record;
}

export function decodeFocusBinding(
  value: unknown,
  verifier: InteractionDigestVerifier,
): FocusBinding {
  const record = parse(focusSchema, value);
  assertFocusBindingInvariant(record);
  verifyDigest(record.focusDigest, focusBindingProjection(record), verifier, 'Focus digest');
  return record;
}

export function decodeRouteProposal(
  value: unknown,
  verifier: InteractionDigestVerifier,
): RouteProposal {
  const record = parse(proposalSchema, value);
  assertRouteProposalInvariant(record);
  verifyDigest(record.proposalDigest, routeProposalProjection(record), verifier, 'Proposal digest');
  return record;
}

export function decodeRouteDecision(
  value: unknown,
  verifier: InteractionDigestVerifier,
): RouteDecision {
  const record = parse(decisionSchema, value);
  assertRouteDecisionInvariant(record);
  verifyDigest(record.decisionDigest, routeDecisionProjection(record), verifier, 'Decision digest');
  return record;
}

export function decodePendingAction(
  value: unknown,
  verifier: InteractionDigestVerifier,
): PendingAction {
  const record = parse(pendingActionSchema, value);
  assertPendingActionInvariant(record);
  verifyDigest(
    record.pendingActionDigest,
    pendingActionProjection(record),
    verifier,
    'Pending Action digest',
  );
  return record;
}

export function decodePendingActionResolution(
  value: unknown,
  verifier: InteractionDigestVerifier,
): PendingActionResolution {
  const record = parse(resolutionSchema, value);
  assertPendingActionResolutionInvariant(record);
  verifyDigest(
    record.resolutionDigest,
    pendingActionResolutionProjection(record),
    verifier,
    'Pending Action Resolution digest',
  );
  return record;
}

export function decodeInteractionActionReservation(
  value: unknown,
  verifier: InteractionDigestVerifier,
): InteractionActionReservation {
  const record = parse(reservationSchema, value);
  assertInteractionActionReservationInvariant(record);
  verifyDigest(
    record.reservationDigest,
    interactionActionReservationProjection(record),
    verifier,
    'Interaction Action Reservation digest',
  );
  return record;
}

export function decodeInteractionActionOutcome(
  value: unknown,
  verifier: InteractionDigestVerifier,
): InteractionActionOutcome {
  const record = parse(outcomeSchema, value);
  assertInteractionActionOutcomeInvariant(record);
  verifyDigest(
    record.outcomeDigest,
    interactionActionOutcomeProjection(record),
    verifier,
    'Interaction Action Outcome digest',
  );
  return record;
}

export function decodeInteractionMessageHandoff(
  value: unknown,
  verifier: InteractionDigestVerifier,
): InteractionMessageHandoff {
  const record = parse(handoffSchema, value);
  assertInteractionMessageHandoffInvariant(record);
  if (
    record.admittedContentDigest !== sha256Digest(verifier.digestUtf8(record.admittedUserContent))
  ) {
    throw new TypeError('Interaction Message Handoff content digest does not match exact bytes');
  }
  verifyDigest(
    record.handoffDigest,
    interactionMessageHandoffProjection(record),
    verifier,
    'Interaction Message Handoff digest',
  );
  return record;
}

export function decodeFrontstageAnswer(
  value: unknown,
  verifier: InteractionDigestVerifier,
): FrontstageAnswer {
  const record = parse(answerSchema, value);
  assertFrontstageAnswerInvariant(record);
  if (record.answerContentDigest !== sha256Digest(verifier.digestUtf8(record.answerContent))) {
    throw new TypeError('Frontstage Answer content digest does not match exact bytes');
  }
  verifyDigest(record.answerDigest, frontstageAnswerProjection(record), verifier, 'Answer digest');
  return record;
}

export function decodeInteractionOperation(
  value: unknown,
  verifier: InteractionDigestVerifier,
): InteractionOperation {
  const record = parse(operationSchema, value);
  assertInteractionOperationInvariant(record);
  verifyDigest(
    record.operationDigest,
    interactionOperationProjection(record),
    verifier,
    'Interaction Operation digest',
  );
  return record;
}

export function decodeDirectActionGrammarDefinition(value: unknown): DirectActionGrammarDefinition {
  const grammar = parse(directGrammarDefinitionSchema, value);
  assertDirectActionGrammarDefinitionInvariant(grammar);
  return grammar;
}

export function decodeDirectActionGrammar(
  value: unknown,
  verifier: InteractionDigestVerifier,
): DirectActionGrammar {
  const grammar = parse(directGrammarSchema, value);
  assertDirectActionGrammarInvariant(grammar);
  verifyDigest(grammar.digest, directActionGrammarProjection(grammar), verifier, 'Grammar digest');
  return grammar;
}

export function decodeConfirmationGrammarDefinition(value: unknown): ConfirmationGrammarDefinition {
  const grammar = parse(confirmationGrammarDefinitionSchema, value);
  assertConfirmationGrammarDefinitionInvariant(grammar);
  return grammar;
}

export function decodeConfirmationGrammar(
  value: unknown,
  verifier: InteractionDigestVerifier,
): ConfirmationGrammar {
  const grammar = parse(confirmationGrammarSchema, value);
  assertConfirmationGrammarInvariant(grammar);
  verifyDigest(grammar.digest, confirmationGrammarProjection(grammar), verifier, 'Grammar digest');
  return grammar;
}

export function decodeInteractionRoutingPolicyDefinition(
  value: unknown,
): InteractionRoutingPolicyDefinition {
  const policy = parse(routingPolicyDefinitionSchema, value);
  assertInteractionRoutingPolicyDefinitionInvariant(policy);
  return policy;
}

export function decodeInteractionRoutingPolicy(
  value: unknown,
  verifier: InteractionDigestVerifier,
): InteractionRoutingPolicy {
  const policy = parse(routingPolicySchema, value);
  assertInteractionRoutingPolicyInvariant(policy);
  verifyDigest(
    policy.digest,
    interactionRoutingPolicyProjection(policy),
    verifier,
    'Policy digest',
  );
  return policy;
}

export function decodeInteractionConfirmationPolicyDefinition(
  value: unknown,
): InteractionConfirmationPolicyDefinition {
  const policy = parse(confirmationPolicyDefinitionSchema, value);
  assertInteractionConfirmationPolicyDefinitionInvariant(policy);
  return policy;
}

export function decodeInteractionConfirmationPolicy(
  value: unknown,
  verifier: InteractionDigestVerifier,
): InteractionConfirmationPolicy {
  const policy = parse(confirmationPolicySchema, value);
  assertInteractionConfirmationPolicyInvariant(policy);
  verifyDigest(
    policy.digest,
    interactionConfirmationPolicyProjection(policy),
    verifier,
    'Policy digest',
  );
  return policy;
}
