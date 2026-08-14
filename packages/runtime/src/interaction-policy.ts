import {
  ConfirmationParseDisposition,
  DirectActionGrammarNormalization,
  DirectActionHandoffRule,
  DirectActionParseDisposition,
  DirectActionTargetRule,
  FrontstageCandidateRoute,
  FrontstageProposalAmbiguity,
  FrontstageProposalKind,
  InteractionActionAdmissionDisposition,
  InteractionActionAdmissionReason,
  InteractionActionRequestSource,
  InteractionRouteDecisionOutcome,
  InteractionRouteDecisionSource,
  InteractionTargetResolution,
  InteractionTrustedParserKind,
  PendingActionDerivation,
  PendingActionKind,
  assertConfirmationGrammarInvariant,
  assertDirectActionGrammarInvariant,
  assertInteractionGoalTargetRefInvariant,
  assertInteractionQuestionTargetRefInvariant,
  decodeConfirmationGrammar,
  decodeConfirmationGrammarDefinition,
  decodeDirectActionGrammar,
  decodeDirectActionGrammarDefinition,
  decodeInteractionConfirmationPolicy,
  decodeInteractionConfirmationPolicyDefinition,
  decodeInteractionRoutingPolicy,
  decodeInteractionRoutingPolicyDefinition,
  decodeRouteProposal,
  directActionGrammarProjection,
  confirmationGrammarProjection,
  interactionConfirmationPolicyId,
  interactionConfirmationPolicyProjection,
  interactionMessageId,
  interactionRoutingPolicyId,
  interactionRoutingPolicyProjection,
  interactionSessionId,
  type ConfirmationGrammar,
  type ConfirmationGrammarDefinition,
  type ConfirmationParseResult,
  type DirectActionGrammar,
  type DirectActionGrammarDefinition,
  type DirectActionParseResult,
  type FrontstageNoActionReason,
  type InteractionActionAdmission,
  type InteractionActionAdmissionResult,
  type InteractionConfirmationPolicy,
  type InteractionConfirmationPolicyDefinition,
  type InteractionGoalTargetRef,
  type InteractionMessageId,
  type InteractionDigestVerifier,
  type InteractionPolicyTraceEntry,
  type InteractionQuestionTargetRef,
  type InteractionRoutingPolicy,
  type InteractionRoutingPolicyDefinition,
  type InteractionSessionId,
  type RouteProposal,
  type Sha256Digest,
} from '@codeclosure/domain';

export const M26_DIRECT_ACTION_GRAMMAR_ID = 'codeclosure-m2-6-zh-cn-direct-action';
export const M26_DIRECT_ACTION_GRAMMAR_VERSION = 'codeclosure-m2-6-zh-cn-direct-action-v1';
export const M26_CONFIRMATION_GRAMMAR_ID = 'codeclosure-m2-6-zh-cn-confirmation';
export const M26_CONFIRMATION_GRAMMAR_VERSION = 'codeclosure-m2-6-zh-cn-confirmation-v1';
export const M26_LOCAL_ROUTING_POLICY_ID = interactionRoutingPolicyId(
  'interaction-routing-policy_codeclosure-m2-6-local',
);
export const M26_LOCAL_ROUTING_POLICY_VERSION = 'codeclosure-m2-6-local-routing-v1';
export const M26_LOCAL_CONFIRMATION_POLICY_ID = interactionConfirmationPolicyId(
  'interaction-confirmation-policy_codeclosure-m2-6-local',
);
export const M26_LOCAL_CONFIRMATION_POLICY_VERSION = 'codeclosure-m2-6-local-confirmation-v1';

const DIRECT_ACTION_FORMS = Object.freeze([
  Object.freeze({
    messageTemplate: '请执行以下请求：<request>',
    actionKind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
    targetRule: DirectActionTargetRule.CURRENT_FRONTSTAGE_PROJECT,
    handoffRule: DirectActionHandoffRule.COMPLETE_ORIGINAL_MESSAGE_BYTES,
  }),
  Object.freeze({
    messageTemplate: '请仅创建目标：<request>',
    actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
    targetRule: DirectActionTargetRule.CURRENT_FRONTSTAGE_PROJECT,
    handoffRule: DirectActionHandoffRule.COMPLETE_ORIGINAL_MESSAGE_BYTES,
  }),
  Object.freeze({
    messageTemplate: '请开始当前目标',
    actionKind: PendingActionKind.START_GOAL,
    targetRule: DirectActionTargetRule.SOLE_CURRENT_GOAL_FOCUS,
  }),
  Object.freeze({
    messageTemplate: '请继续当前目标',
    actionKind: PendingActionKind.RESUME_GOAL,
    targetRule: DirectActionTargetRule.SOLE_CURRENT_GOAL_FOCUS,
  }),
]);

const ROUTE_OUTCOMES = Object.freeze(Object.values(InteractionRouteDecisionOutcome));
const ASSISTANT_CANDIDATE_ROUTES = Object.freeze(Object.values(FrontstageCandidateRoute));
const PARSER_ORDER = Object.freeze([
  InteractionTrustedParserKind.CONFIRMATION_OR_DECLINE,
  InteractionTrustedParserKind.EXACT_INTAKE_QUESTION,
  InteractionTrustedParserKind.DIRECT_ACTION,
  InteractionTrustedParserKind.READ_ONLY_GOAL_QUERY,
  InteractionTrustedParserKind.ASSISTANT_PROPOSAL,
]);

export interface M26InteractionPolicies {
  readonly directActionGrammar: DirectActionGrammar;
  readonly confirmationGrammar: ConfirmationGrammar;
  readonly routingPolicy: InteractionRoutingPolicy;
  readonly confirmationPolicy: InteractionConfirmationPolicy;
}

export function assertM26InteractionPoliciesInvariant(
  policies: M26InteractionPolicies,
  digests: InteractionDigestVerifier,
): void {
  const directActionGrammar = decodeDirectActionGrammar(policies.directActionGrammar, digests);
  const confirmationGrammar = decodeConfirmationGrammar(policies.confirmationGrammar, digests);
  const routingPolicy = decodeInteractionRoutingPolicy(policies.routingPolicy, digests);
  const confirmationPolicy = decodeInteractionConfirmationPolicy(
    policies.confirmationPolicy,
    digests,
  );
  if (
    directActionGrammar.id !== M26_DIRECT_ACTION_GRAMMAR_ID ||
    directActionGrammar.version !== M26_DIRECT_ACTION_GRAMMAR_VERSION ||
    confirmationGrammar.id !== M26_CONFIRMATION_GRAMMAR_ID ||
    confirmationGrammar.version !== M26_CONFIRMATION_GRAMMAR_VERSION ||
    routingPolicy.id !== M26_LOCAL_ROUTING_POLICY_ID ||
    routingPolicy.version !== M26_LOCAL_ROUTING_POLICY_VERSION ||
    confirmationPolicy.id !== M26_LOCAL_CONFIRMATION_POLICY_ID ||
    confirmationPolicy.version !== M26_LOCAL_CONFIRMATION_POLICY_VERSION
  ) {
    throw new TypeError('Interaction policy bundle does not use the installed M2.6 identities');
  }
  const expectedDigests = {
    directActionGrammar: digests.digest(
      directActionGrammarProjection(createM26DirectActionGrammarDefinition()),
    ),
    confirmationGrammar: digests.digest(
      confirmationGrammarProjection(createM26ConfirmationGrammarDefinition()),
    ),
    routingPolicy: digests.digest(
      interactionRoutingPolicyProjection(createM26RoutingPolicyDefinition(directActionGrammar)),
    ),
    confirmationPolicy: digests.digest(
      interactionConfirmationPolicyProjection(
        createM26ConfirmationPolicyDefinition(confirmationGrammar),
      ),
    ),
  };
  if (
    directActionGrammar.digest !== expectedDigests.directActionGrammar ||
    confirmationGrammar.digest !== expectedDigests.confirmationGrammar ||
    routingPolicy.digest !== expectedDigests.routingPolicy ||
    confirmationPolicy.digest !== expectedDigests.confirmationPolicy
  ) {
    throw new TypeError('Interaction policy bundle differs from the installed M2.6 definitions');
  }
  if (
    routingPolicy.directActionGrammar.id !== directActionGrammar.id ||
    routingPolicy.directActionGrammar.version !== directActionGrammar.version ||
    routingPolicy.directActionGrammar.digest !== directActionGrammar.digest
  ) {
    throw new TypeError('Interaction Routing Policy does not bind the installed direct grammar');
  }
  if (
    confirmationPolicy.confirmationGrammar.id !== confirmationGrammar.id ||
    confirmationPolicy.confirmationGrammar.version !== confirmationGrammar.version ||
    confirmationPolicy.confirmationGrammar.digest !== confirmationGrammar.digest
  ) {
    throw new TypeError(
      'Interaction Confirmation Policy does not bind the installed confirmation grammar',
    );
  }
}

export function createM26DirectActionGrammarDefinition(): DirectActionGrammarDefinition {
  return decodeDirectActionGrammarDefinition({
    id: M26_DIRECT_ACTION_GRAMMAR_ID,
    schemaVersion: 1,
    version: M26_DIRECT_ACTION_GRAMMAR_VERSION,
    locale: 'zh-CN',
    normalization: DirectActionGrammarNormalization.NONE_EXACT_UNICODE_SCALAR_SEQUENCE,
    forms: DIRECT_ACTION_FORMS,
  });
}

export function createM26DirectActionGrammar(
  digests: InteractionDigestVerifier,
): DirectActionGrammar {
  const definition = createM26DirectActionGrammarDefinition();
  return decodeDirectActionGrammar(
    { ...definition, digest: digests.digest(directActionGrammarProjection(definition)) },
    digests,
  );
}

export function createM26ConfirmationGrammarDefinition(): ConfirmationGrammarDefinition {
  return decodeConfirmationGrammarDefinition({
    id: M26_CONFIRMATION_GRAMMAR_ID,
    schemaVersion: 1,
    version: M26_CONFIRMATION_GRAMMAR_VERSION,
    locale: 'zh-CN',
    normalization: DirectActionGrammarNormalization.NONE_EXACT_UNICODE_SCALAR_SEQUENCE,
    confirmPhrases: ['确认', '确认执行'],
    declinePhrases: ['不确认', '取消本次操作'],
  });
}

export function createM26ConfirmationGrammar(
  digests: InteractionDigestVerifier,
): ConfirmationGrammar {
  const definition = createM26ConfirmationGrammarDefinition();
  return decodeConfirmationGrammar(
    { ...definition, digest: digests.digest(confirmationGrammarProjection(definition)) },
    digests,
  );
}

export function createM26RoutingPolicyDefinition(
  directActionGrammar: DirectActionGrammar,
): InteractionRoutingPolicyDefinition {
  return decodeInteractionRoutingPolicyDefinition({
    id: M26_LOCAL_ROUTING_POLICY_ID,
    schemaVersion: 1,
    version: M26_LOCAL_ROUTING_POLICY_VERSION,
    directActionGrammar: {
      id: directActionGrammar.id,
      version: directActionGrammar.version,
      digest: directActionGrammar.digest,
    },
    parserOrder: PARSER_ORDER,
    allowedRouteOutcomes: ROUTE_OUTCOMES,
    allowedAssistantCandidateRoutes: ASSISTANT_CANDIDATE_ROUTES,
  });
}

export function createM26RoutingPolicy(
  directActionGrammar: DirectActionGrammar,
  digests: InteractionDigestVerifier,
): InteractionRoutingPolicy {
  const definition = createM26RoutingPolicyDefinition(directActionGrammar);
  return decodeInteractionRoutingPolicy(
    { ...definition, digest: digests.digest(interactionRoutingPolicyProjection(definition)) },
    digests,
  );
}

export function createM26ConfirmationPolicyDefinition(
  confirmationGrammar: ConfirmationGrammar,
): InteractionConfirmationPolicyDefinition {
  return decodeInteractionConfirmationPolicyDefinition({
    id: M26_LOCAL_CONFIRMATION_POLICY_ID,
    schemaVersion: 1,
    version: M26_LOCAL_CONFIRMATION_POLICY_VERSION,
    confirmationGrammar: {
      id: confirmationGrammar.id,
      version: confirmationGrammar.version,
      digest: confirmationGrammar.digest,
    },
    directlyAuthorizableKinds: [
      PendingActionKind.SUBMIT_GOVERNED_INTAKE,
      PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      PendingActionKind.START_GOAL,
      PendingActionKind.RESUME_GOAL,
    ],
    alwaysSeparateKinds: [PendingActionKind.CANCEL_GOAL],
    busyStartOrResumeDisposition: 'SESSION_EXECUTION_BUSY',
    busyGovernedAlternative: 'SAME_MESSAGE_MATERIALIZE_ONLY_SEPARATE_RESPONSE_REQUIRED',
    busyCancellationTarget: 'ACTIVE_SESSION_GOAL_ONLY_SEPARATE_RESPONSE_REQUIRED',
  });
}

export function createM26ConfirmationPolicy(
  confirmationGrammar: ConfirmationGrammar,
  digests: InteractionDigestVerifier,
): InteractionConfirmationPolicy {
  const definition = createM26ConfirmationPolicyDefinition(confirmationGrammar);
  return decodeInteractionConfirmationPolicy(
    {
      ...definition,
      digest: digests.digest(interactionConfirmationPolicyProjection(definition)),
    },
    digests,
  );
}

export function createM26InteractionPolicies(
  digests: InteractionDigestVerifier,
): M26InteractionPolicies {
  const directActionGrammar = createM26DirectActionGrammar(digests);
  const confirmationGrammar = createM26ConfirmationGrammar(digests);
  return Object.freeze({
    directActionGrammar,
    confirmationGrammar,
    routingPolicy: createM26RoutingPolicy(directActionGrammar, digests),
    confirmationPolicy: createM26ConfirmationPolicy(confirmationGrammar, digests),
  });
}

function isUnicodeScalarSequence(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function containsNonWhitespaceScalar(value: string): boolean {
  return Array.from(value).some((scalar) => !/^\s$/u.test(scalar));
}

export function parseM26DirectAction(
  message: string,
  grammar: DirectActionGrammar,
): DirectActionParseResult {
  assertDirectActionGrammarInvariant(grammar);
  if (!isUnicodeScalarSequence(message)) {
    return Object.freeze({ disposition: DirectActionParseDisposition.NO_MATCH });
  }

  for (const form of grammar.forms) {
    const requestMarkerIndex = form.messageTemplate.indexOf('<request>');
    if (requestMarkerIndex < 0) {
      if (message === form.messageTemplate) {
        return Object.freeze({
          disposition: DirectActionParseDisposition.MATCHED,
          actionKind: form.actionKind,
          targetRule: form.targetRule,
          completeOriginalMessage: message,
        });
      }
      continue;
    }

    const prefix = form.messageTemplate.slice(0, requestMarkerIndex);
    if (!message.startsWith(prefix)) {
      continue;
    }
    const requestRemainder = message.slice(prefix.length);
    if (requestRemainder.length === 0 || !containsNonWhitespaceScalar(requestRemainder)) {
      continue;
    }
    return Object.freeze({
      disposition: DirectActionParseDisposition.MATCHED,
      actionKind: form.actionKind,
      targetRule: form.targetRule,
      completeOriginalMessage: message,
      requestRemainder,
      ...(form.handoffRule === undefined ? {} : { handoffRule: form.handoffRule }),
    });
  }

  return Object.freeze({ disposition: DirectActionParseDisposition.NO_MATCH });
}

export function parseM26Confirmation(
  message: string,
  grammar: ConfirmationGrammar,
): ConfirmationParseResult {
  assertConfirmationGrammarInvariant(grammar);
  if (!isUnicodeScalarSequence(message)) {
    return Object.freeze({ disposition: ConfirmationParseDisposition.UNCLEAR });
  }
  if (grammar.confirmPhrases.includes(message)) {
    return Object.freeze({ disposition: ConfirmationParseDisposition.CONFIRM });
  }
  if (grammar.declinePhrases.includes(message)) {
    return Object.freeze({ disposition: ConfirmationParseDisposition.DECLINE });
  }
  return Object.freeze({ disposition: ConfirmationParseDisposition.UNCLEAR });
}

export interface InteractionActionAdmissionInput {
  readonly actionKind: PendingActionKind;
  readonly requestSource: InteractionActionRequestSource;
  readonly originatingMessage: string;
  readonly originatingMessageContentDigest: Sha256Digest;
  readonly targetResolution: InteractionTargetResolution;
  readonly sessionExecutionBusy: boolean;
  readonly targetsActiveSessionGoal: boolean;
}

function createPendingAdmission(
  actionKind: PendingActionKind,
  actionDerivation: PendingActionDerivation,
  confirmationRequirement: 'DIRECT_USER_MESSAGE_SUFFICIENT' | 'SEPARATE_RESPONSE_REQUIRED',
  reason: InteractionActionAdmissionReason,
): InteractionActionAdmission {
  return Object.freeze({
    disposition: InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION,
    actionKind,
    actionDerivation,
    confirmationRequirement,
    reason,
  });
}

function decideBusyAction(input: InteractionActionAdmissionInput): InteractionActionAdmission {
  switch (input.actionKind) {
    case PendingActionKind.SUBMIT_GOVERNED_INTAKE:
      return Object.freeze({
        disposition: InteractionActionAdmissionDisposition.OFFER_MATERIALIZE_ONLY,
        actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
        actionDerivation: PendingActionDerivation.BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE,
        confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED',
        reason: InteractionActionAdmissionReason.BUSY_GOVERNED_ALTERNATIVE_AVAILABLE,
      });
    case PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE:
      return createPendingAdmission(
        input.actionKind,
        input.requestSource === InteractionActionRequestSource.BUSY_GOVERNED_ALTERNATIVE
          ? PendingActionDerivation.BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE
          : PendingActionDerivation.ROUTED_ACTION,
        'SEPARATE_RESPONSE_REQUIRED',
        InteractionActionAdmissionReason.BUSY_MATERIALIZE_ONLY_REQUIRES_CONFIRMATION,
      );
    case PendingActionKind.START_GOAL:
    case PendingActionKind.RESUME_GOAL:
      return Object.freeze({
        disposition: InteractionActionAdmissionDisposition.SESSION_EXECUTION_BUSY,
        reason: InteractionActionAdmissionReason.BUSY_START_OR_RESUME_REJECTED,
      });
    case PendingActionKind.CANCEL_GOAL:
      return input.targetsActiveSessionGoal
        ? createPendingAdmission(
            input.actionKind,
            PendingActionDerivation.ROUTED_ACTION,
            'SEPARATE_RESPONSE_REQUIRED',
            InteractionActionAdmissionReason.CANCEL_REQUIRES_CONFIRMATION,
          )
        : Object.freeze({
            disposition: InteractionActionAdmissionDisposition.ASK_CLARIFICATION,
            reason: InteractionActionAdmissionReason.BUSY_CANCEL_TARGET_NOT_ACTIVE,
          });
  }
}

/**
 * Selects an authorization requirement solely from trusted Runtime inputs.
 * Assistant classifications and proposal fields can only select the separately
 * confirmed branch and are never direct-authorization evidence.
 */
export function decideM26ActionAdmission(
  input: InteractionActionAdmissionInput,
  policies: M26InteractionPolicies,
  digests: InteractionDigestVerifier,
): InteractionActionAdmissionResult {
  assertM26InteractionPoliciesInvariant(policies, digests);
  if (digests.digestUtf8(input.originatingMessage) !== input.originatingMessageContentDigest) {
    throw new TypeError('Action admission message does not match its retained content digest');
  }
  if (
    input.requestSource === InteractionActionRequestSource.BUSY_GOVERNED_ALTERNATIVE &&
    (input.actionKind !== PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE ||
      !input.sessionExecutionBusy)
  ) {
    throw new TypeError('Busy governed alternative must be a busy-session materialize-only action');
  }
  let decision: InteractionActionAdmission;
  if (input.targetResolution !== InteractionTargetResolution.EXACT) {
    decision = Object.freeze({
      disposition: InteractionActionAdmissionDisposition.ASK_CLARIFICATION,
      reason: InteractionActionAdmissionReason.TARGET_NOT_EXACT,
    });
  } else if (input.sessionExecutionBusy) {
    decision = decideBusyAction(input);
  } else if (input.actionKind === PendingActionKind.CANCEL_GOAL) {
    decision = createPendingAdmission(
      input.actionKind,
      PendingActionDerivation.ROUTED_ACTION,
      'SEPARATE_RESPONSE_REQUIRED',
      InteractionActionAdmissionReason.CANCEL_REQUIRES_CONFIRMATION,
    );
  } else if (input.requestSource !== InteractionActionRequestSource.DIRECT_ACTION) {
    decision = createPendingAdmission(
      input.actionKind,
      PendingActionDerivation.ROUTED_ACTION,
      'SEPARATE_RESPONSE_REQUIRED',
      InteractionActionAdmissionReason.ASSISTANT_ACTION_REQUIRES_CONFIRMATION,
    );
  } else {
    const parsed = parseM26DirectAction(input.originatingMessage, policies.directActionGrammar);
    decision =
      parsed.disposition !== DirectActionParseDisposition.MATCHED ||
      parsed.actionKind !== input.actionKind
        ? Object.freeze({
            disposition: InteractionActionAdmissionDisposition.ASK_CLARIFICATION,
            reason: InteractionActionAdmissionReason.DIRECT_ACTION_NOT_EXACT,
          })
        : createPendingAdmission(
            input.actionKind,
            PendingActionDerivation.ROUTED_ACTION,
            'DIRECT_USER_MESSAGE_SUFFICIENT',
            InteractionActionAdmissionReason.EXACT_DIRECT_ACTION,
          );
  }
  const inputDigest = digests.digest({
    actionKind: input.actionKind,
    requestSource: input.requestSource,
    originatingMessageContentDigest: input.originatingMessageContentDigest,
    targetResolution: input.targetResolution,
    sessionExecutionBusy: input.sessionExecutionBusy,
    targetsActiveSessionGoal: input.targetsActiveSessionGoal,
  });
  return Object.freeze({
    decision,
    trace: Object.freeze([
      trace(
        `M26_CONFIRMATION_${decision.reason}`,
        true,
        policies.confirmationPolicy.digest,
        inputDigest,
      ),
    ]),
  });
}

export const InteractionRoutingInputKind = {
  EXACT_INTAKE_QUESTION: 'EXACT_INTAKE_QUESTION',
  DIRECT_ACTION: 'DIRECT_ACTION',
  READ_ONLY_GOAL_LIST: 'READ_ONLY_GOAL_LIST',
  READ_ONLY_GOAL_STATUS: 'READ_ONLY_GOAL_STATUS',
  ASSISTANT_PROPOSAL: 'ASSISTANT_PROPOSAL',
} as const;
export type InteractionRoutingInputKind =
  (typeof InteractionRoutingInputKind)[keyof typeof InteractionRoutingInputKind];

interface InteractionRoutingInputCommon {
  readonly sessionId: InteractionSessionId;
  readonly messageDigest: Sha256Digest;
  readonly messageId: InteractionMessageId;
  readonly sessionDigest: Sha256Digest;
  readonly focusDigest?: Sha256Digest;
}

export type InteractionRoutingInput =
  | Readonly<
      InteractionRoutingInputCommon & {
        kind: typeof InteractionRoutingInputKind.EXACT_INTAKE_QUESTION;
        questionTarget: InteractionQuestionTargetRef;
      }
    >
  | Readonly<
      InteractionRoutingInputCommon & {
        kind: typeof InteractionRoutingInputKind.DIRECT_ACTION;
        originatingMessage: string;
        originatingMessageContentDigest: Sha256Digest;
        goalTarget?: InteractionGoalTargetRef;
      }
    >
  | Readonly<
      InteractionRoutingInputCommon & {
        kind: typeof InteractionRoutingInputKind.READ_ONLY_GOAL_LIST;
      }
    >
  | Readonly<
      InteractionRoutingInputCommon & {
        kind: typeof InteractionRoutingInputKind.READ_ONLY_GOAL_STATUS;
        goalTarget?: InteractionGoalTargetRef;
      }
    >
  | Readonly<
      InteractionRoutingInputCommon & {
        kind: typeof InteractionRoutingInputKind.ASSISTANT_PROPOSAL;
        proposal: RouteProposal;
        resolvedGoalTarget?: InteractionGoalTargetRef;
      }
    >;

export type InteractionSemanticRouteDecision =
  | Readonly<{ outcome: typeof InteractionRouteDecisionOutcome.ANSWER }>
  | Readonly<{ outcome: typeof InteractionRouteDecisionOutcome.LIST_GOALS }>
  | Readonly<{
      outcome: typeof InteractionRouteDecisionOutcome.SHOW_GOAL;
      goalTarget: InteractionGoalTargetRef;
    }>
  | Readonly<{
      outcome: typeof InteractionRouteDecisionOutcome.CONTINUE_EXACT_INTAKE_QUESTION;
      questionTarget: InteractionQuestionTargetRef;
    }>
  | Readonly<{
      outcome: typeof InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION;
      actionKind:
        | typeof PendingActionKind.SUBMIT_GOVERNED_INTAKE
        | typeof PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE;
    }>
  | Readonly<{
      outcome: typeof InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL;
      actionKind:
        | typeof PendingActionKind.START_GOAL
        | typeof PendingActionKind.RESUME_GOAL
        | typeof PendingActionKind.CANCEL_GOAL;
      goalTarget: InteractionGoalTargetRef;
    }>
  | Readonly<{
      outcome: typeof InteractionRouteDecisionOutcome.ASK_ROUTE_CLARIFICATION;
      ambiguity:
        | typeof FrontstageProposalAmbiguity.ACTION_AMBIGUOUS
        | typeof FrontstageProposalAmbiguity.TARGET_AMBIGUOUS
        | typeof FrontstageProposalAmbiguity.REQUEST_INCOMPLETE;
    }>
  | Readonly<{
      outcome: typeof InteractionRouteDecisionOutcome.NO_ACTION;
      reasonCode: FrontstageNoActionReason;
    }>;

export interface InteractionRoutingPolicyResult {
  readonly source: InteractionRouteDecisionSource;
  readonly decision: InteractionSemanticRouteDecision;
  readonly trace: readonly InteractionPolicyTraceEntry[];
}

function routeSource(input: InteractionRoutingInput): InteractionRouteDecisionSource {
  switch (input.kind) {
    case InteractionRoutingInputKind.EXACT_INTAKE_QUESTION:
      return InteractionRouteDecisionSource.EXACT_INTAKE_QUESTION;
    case InteractionRoutingInputKind.DIRECT_ACTION:
      return InteractionRouteDecisionSource.DIRECT_ACTION;
    case InteractionRoutingInputKind.READ_ONLY_GOAL_LIST:
    case InteractionRoutingInputKind.READ_ONLY_GOAL_STATUS:
      return InteractionRouteDecisionSource.READ_ONLY_GOAL_QUERY;
    case InteractionRoutingInputKind.ASSISTANT_PROPOSAL:
      return InteractionRouteDecisionSource.ASSISTANT_PROPOSAL;
  }
}

function routeTraceInputProjection(input: InteractionRoutingInput): unknown {
  const common = {
    kind: input.kind,
    sessionId: input.sessionId,
    sessionDigest: input.sessionDigest,
    messageId: input.messageId,
    messageDigest: input.messageDigest,
    ...(input.focusDigest === undefined ? {} : { focusDigest: input.focusDigest }),
  };
  switch (input.kind) {
    case InteractionRoutingInputKind.EXACT_INTAKE_QUESTION:
      return { ...common, questionTarget: input.questionTarget };
    case InteractionRoutingInputKind.DIRECT_ACTION:
      return {
        ...common,
        originatingMessageContentDigest: input.originatingMessageContentDigest,
        ...(input.goalTarget === undefined ? {} : { goalTarget: input.goalTarget }),
      };
    case InteractionRoutingInputKind.READ_ONLY_GOAL_LIST:
      return common;
    case InteractionRoutingInputKind.READ_ONLY_GOAL_STATUS:
      return {
        ...common,
        ...(input.goalTarget === undefined ? {} : { goalTarget: input.goalTarget }),
      };
    case InteractionRoutingInputKind.ASSISTANT_PROPOSAL:
      return {
        ...common,
        proposalDigest: input.proposal.proposalDigest,
        ...(input.resolvedGoalTarget === undefined
          ? {}
          : { resolvedGoalTarget: input.resolvedGoalTarget }),
      };
  }
}

function trace(
  ruleId: string,
  matched: boolean,
  policyDigest: Sha256Digest,
  inputDigest: Sha256Digest,
): InteractionPolicyTraceEntry {
  return Object.freeze({
    ruleId,
    policyDigest,
    outcome: matched ? 'MATCHED' : 'NOT_MATCHED',
    inputDigests: Object.freeze([inputDigest]),
  });
}

function clarification(
  ambiguity:
    | typeof FrontstageProposalAmbiguity.ACTION_AMBIGUOUS
    | typeof FrontstageProposalAmbiguity.TARGET_AMBIGUOUS
    | typeof FrontstageProposalAmbiguity.REQUEST_INCOMPLETE,
): InteractionSemanticRouteDecision {
  return Object.freeze({
    outcome: InteractionRouteDecisionOutcome.ASK_ROUTE_CLARIFICATION,
    ambiguity,
  });
}

function routeGoalControl(
  actionKind:
    | typeof PendingActionKind.START_GOAL
    | typeof PendingActionKind.RESUME_GOAL
    | typeof PendingActionKind.CANCEL_GOAL,
  goalTarget: InteractionGoalTargetRef | undefined,
): InteractionSemanticRouteDecision {
  if (goalTarget === undefined) {
    return clarification(FrontstageProposalAmbiguity.TARGET_AMBIGUOUS);
  }
  assertInteractionGoalTargetRefInvariant(goalTarget);
  return Object.freeze({
    outcome: InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL,
    actionKind,
    goalTarget,
  });
}

function proposalMatchesResolvedGoal(
  proposal: Extract<RouteProposal, { kind: 'ROUTE_PROPOSAL' }>,
  goalTarget: InteractionGoalTargetRef | undefined,
): goalTarget is InteractionGoalTargetRef {
  return goalTarget !== undefined && proposal.candidateGoalIds[0] === goalTarget.goalId;
}

function routeDirectAction(
  input: Extract<InteractionRoutingInput, { kind: 'DIRECT_ACTION' }>,
  parsed: DirectActionParseResult,
) {
  if (parsed.disposition === DirectActionParseDisposition.NO_MATCH) {
    return clarification(FrontstageProposalAmbiguity.ACTION_AMBIGUOUS);
  }
  switch (parsed.actionKind) {
    case PendingActionKind.SUBMIT_GOVERNED_INTAKE:
    case PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE:
      return Object.freeze({
        outcome: InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION,
        actionKind: parsed.actionKind,
      });
    case PendingActionKind.START_GOAL:
    case PendingActionKind.RESUME_GOAL:
      return routeGoalControl(parsed.actionKind, input.goalTarget);
  }
}

function routeAssistantProposal(
  input: Extract<InteractionRoutingInput, { kind: 'ASSISTANT_PROPOSAL' }>,
): InteractionSemanticRouteDecision {
  const proposal = input.proposal;
  switch (proposal.kind) {
    case FrontstageProposalKind.ANSWER_PROPOSAL:
      return Object.freeze({ outcome: InteractionRouteDecisionOutcome.ANSWER });
    case FrontstageProposalKind.CLARIFICATION_PROPOSAL:
      return clarification(proposal.ambiguity);
    case FrontstageProposalKind.NO_ACTION_PROPOSAL:
      return Object.freeze({
        outcome: InteractionRouteDecisionOutcome.NO_ACTION,
        reasonCode: proposal.reasonCode,
      });
    case FrontstageProposalKind.ROUTE_PROPOSAL:
      if (proposal.ambiguity !== FrontstageProposalAmbiguity.NONE) {
        return clarification(
          proposal.ambiguity === FrontstageProposalAmbiguity.TARGET_AMBIGUOUS
            ? FrontstageProposalAmbiguity.TARGET_AMBIGUOUS
            : proposal.ambiguity === FrontstageProposalAmbiguity.REQUEST_INCOMPLETE
              ? FrontstageProposalAmbiguity.REQUEST_INCOMPLETE
              : FrontstageProposalAmbiguity.ACTION_AMBIGUOUS,
        );
      }
      switch (proposal.candidateRoute) {
        case FrontstageCandidateRoute.LIST_GOALS:
          return Object.freeze({ outcome: InteractionRouteDecisionOutcome.LIST_GOALS });
        case FrontstageCandidateRoute.SHOW_GOAL:
          if (!proposalMatchesResolvedGoal(proposal, input.resolvedGoalTarget)) {
            return clarification(FrontstageProposalAmbiguity.TARGET_AMBIGUOUS);
          }
          assertInteractionGoalTargetRefInvariant(input.resolvedGoalTarget);
          return Object.freeze({
            outcome: InteractionRouteDecisionOutcome.SHOW_GOAL,
            goalTarget: input.resolvedGoalTarget,
          });
        case FrontstageCandidateRoute.SUBMIT_GOVERNED_INTAKE:
        case FrontstageCandidateRoute.SUBMIT_MATERIALIZE_ONLY_INTAKE:
          return Object.freeze({
            outcome: InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION,
            actionKind: proposal.candidateRoute,
          });
        case FrontstageCandidateRoute.START_GOAL:
        case FrontstageCandidateRoute.RESUME_GOAL:
        case FrontstageCandidateRoute.CANCEL_GOAL:
          if (!proposalMatchesResolvedGoal(proposal, input.resolvedGoalTarget)) {
            return clarification(FrontstageProposalAmbiguity.TARGET_AMBIGUOUS);
          }
          return routeGoalControl(proposal.candidateRoute, input.resolvedGoalTarget);
      }
  }
}

/**
 * Produces only a semantic route. Record identity, persistence and every
 * state-changing capability remain with the later Runtime coordinator.
 */
export function decideM26InteractionRoute(
  input: InteractionRoutingInput,
  policies: M26InteractionPolicies,
  digests: InteractionDigestVerifier,
): InteractionRoutingPolicyResult {
  assertM26InteractionPoliciesInvariant(policies, digests);
  interactionSessionId(input.sessionId);
  interactionMessageId(input.messageId);
  const policy = policies.routingPolicy;
  let decision: InteractionSemanticRouteDecision;
  switch (input.kind) {
    case InteractionRoutingInputKind.EXACT_INTAKE_QUESTION:
      assertInteractionQuestionTargetRefInvariant(input.questionTarget);
      decision = Object.freeze({
        outcome: InteractionRouteDecisionOutcome.CONTINUE_EXACT_INTAKE_QUESTION,
        questionTarget: input.questionTarget,
      });
      break;
    case InteractionRoutingInputKind.DIRECT_ACTION:
      if (digests.digestUtf8(input.originatingMessage) !== input.originatingMessageContentDigest) {
        throw new TypeError('Direct route message does not match its retained content digest');
      }
      decision = routeDirectAction(
        input,
        parseM26DirectAction(input.originatingMessage, policies.directActionGrammar),
      );
      break;
    case InteractionRoutingInputKind.READ_ONLY_GOAL_LIST:
      decision = Object.freeze({ outcome: InteractionRouteDecisionOutcome.LIST_GOALS });
      break;
    case InteractionRoutingInputKind.READ_ONLY_GOAL_STATUS:
      if (input.goalTarget !== undefined) {
        assertInteractionGoalTargetRefInvariant(input.goalTarget);
      }
      decision =
        input.goalTarget === undefined
          ? clarification(FrontstageProposalAmbiguity.TARGET_AMBIGUOUS)
          : Object.freeze({
              outcome: InteractionRouteDecisionOutcome.SHOW_GOAL,
              goalTarget: input.goalTarget,
            });
      break;
    case InteractionRoutingInputKind.ASSISTANT_PROPOSAL:
      decodeRouteProposal(input.proposal, digests);
      if (
        input.proposal.sessionId !== input.sessionId ||
        input.proposal.messageRef.id !== input.messageId ||
        input.proposal.messageRef.digest !== input.messageDigest
      ) {
        throw new TypeError('Assistant proposal does not bind the routed Interaction Message');
      }
      decision = routeAssistantProposal(input);
      break;
  }
  if (!policy.allowedRouteOutcomes.includes(decision.outcome)) {
    throw new TypeError('Interaction Routing Policy produced an outcome outside its closed set');
  }
  const inputDigest = digests.digest(routeTraceInputProjection(input));
  return Object.freeze({
    source: routeSource(input),
    decision,
    trace: Object.freeze([
      trace('M26_TRUSTED_PARSER_ORDER', true, policy.digest, inputDigest),
      trace(`M26_ROUTE_${input.kind}`, true, policy.digest, inputDigest),
    ]),
  });
}
