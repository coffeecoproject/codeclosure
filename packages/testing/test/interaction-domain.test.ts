import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FrontstageCandidateRoute,
  FrontstageContextOmissionReason,
  FrontstageContextOmissionSourceClass,
  FrontstageProposalAmbiguity,
  FrontstageProposalKind,
  INTERACTION_MAXIMUM_CONTEXT_ACTIVE_QUESTION_BYTES,
  INTERACTION_MAXIMUM_CONTEXT_GOAL_SUMMARIES,
  INTERACTION_MAXIMUM_CONTEXT_MANIFEST_ENTRIES,
  INTERACTION_MAXIMUM_CONTEXT_PRIOR_MESSAGE_BYTES,
  INTERACTION_MAXIMUM_CONTEXT_PRIOR_MESSAGES,
  INTERACTION_MAXIMUM_CONTEXT_PACKAGE_BYTES,
  INTERACTION_MAXIMUM_SESSION_CONTENT_BYTES,
  INTERACTION_MAXIMUM_SESSION_MESSAGES,
  InteractionActionOutcomeDisposition,
  InteractionConfirmationRequirement,
  InteractionContentOmissionReason,
  InteractionContentRetention,
  InteractionFocusKind,
  InteractionMessageRole,
  InteractionMessageHandoffKind,
  InteractionOperationFailureReason,
  InteractionOperationKind,
  InteractionOperationResultKind,
  InteractionOperationState,
  InteractionPublicCapability,
  InteractionRouteDecisionOutcome,
  InteractionRouteDecisionSource,
  InteractionSessionState,
  InteractionSessionTerminalReason,
  InteractionActionRequestSource,
  InteractionTargetResolution,
  PendingActionDerivation,
  PendingActionKind,
  PendingActionResolutionDisposition,
  assertFrontstageAnswerChainInvariant,
  assertFrontstageContextManifestReservationChain,
  assertInitialInteractionOperationInvariant,
  assertInitialInteractionSessionInvariant,
  assertInteractionActionChainInvariant,
  assertInteractionActionPersistenceChainInvariant,
  assertInteractionClarificationHandoffChainInvariant,
  assertInteractionFocusUpdate,
  assertInteractionOperationReservationChain,
  assertInteractionOperationTransition,
  assertInteractionRouteResultAuthorityChainInvariant,
  assertInteractionRouteResultChainInvariant,
  assertInteractionSessionTransition,
  assertInteractionUserMessageAdmission,
  assertPendingActionAuthorityChainInvariant,
  assertPendingActionCreationChainInvariant,
  assertPendingActionOperationResultInvariant,
  assertPendingActionProposalAuthorityChainInvariant,
  assertPendingActionProposalCommitChainInvariant,
  assertPendingActionResolutionOperationResultInvariant,
  commandId,
  clarificationQuestionId,
  decodeFocusBinding,
  decodeFrontstageAnswer,
  decodeFrontstageContextManifest,
  decodeConfirmationGrammar,
  decodeDirectActionGrammar,
  decodeInteractionActionOutcome,
  decodeInteractionActionReservation,
  decodeInteractionConfirmationPolicy,
  decodeInteractionMessage,
  decodeInteractionMessageHandoff,
  decodeInteractionOperation,
  decodeInteractionRoutingPolicy,
  decodeInteractionSession,
  decodePendingAction,
  decodePendingActionResolution,
  decodeRouteDecision,
  decodeRouteProposal,
  directActionGrammarProjection,
  focusBindingId,
  focusBindingProjection,
  frontstageAnswerId,
  frontstageAnswerProjection,
  frontstageContextManifestId,
  frontstageContextManifestProjection,
  goalId,
  goalRevision,
  interactionActionOutcomeId,
  interactionActionOutcomeProjection,
  interactionActionReservationId,
  interactionActionReservationProjection,
  interactionConfirmationPolicyProjection,
  interactionMessageHandoffId,
  interactionMessageHandoffProjection,
  interactionMessageId,
  interactionMessageProjection,
  interactionOperationId,
  interactionOperationProjection,
  interactionOperationReservationProjection,
  interactionRoutingPolicyProjection,
  interactionOperationVersion,
  interactionSessionId,
  interactionSessionProjection,
  interactionSessionVersion,
  intakeRunId,
  intakeRunVersion,
  isoTimestamp,
  pendingActionId,
  pendingActionProjection,
  pendingActionResolutionId,
  pendingActionResolutionProjection,
  confirmationGrammarProjection,
  principalId,
  routeDecisionId,
  routeDecisionProjection,
  routeProposalId,
  routeProposalProjection,
  sha256Digest,
  workflowId,
  workflowVersion,
  type FocusBindingProjectionInput,
  type FrontstageAnswerProjectionInput,
  type FrontstageContextManifestProjectionInput,
  type InteractionActionOutcomeProjectionInput,
  type InteractionActionReservationProjectionInput,
  type InteractionMessageHandoffProjectionInput,
  type InteractionMessage,
  type InteractionMessageProjectionInput,
  type InteractionOperationProjectionInput,
  type InteractionSessionProjectionInput,
  type PendingActionProjectionInput,
  type PendingActionResolutionProjectionInput,
  type RouteDecisionProjectionInput,
  type RouteProposalProjectionInput,
  type Sha256Digest,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  InteractionRoutingInputKind,
  createM26InteractionPolicies,
  decideM26ActionAdmission,
  decideM26InteractionRoute,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const ZERO = sha256Digest(`sha256:${'0'.repeat(64)}`);
const ONE = sha256Digest(`sha256:${'1'.repeat(64)}`);
const TWO = sha256Digest(`sha256:${'2'.repeat(64)}`);
const THREE = sha256Digest(`sha256:${'3'.repeat(64)}`);
const BEFORE = isoTimestamp('2026-08-14T00:59:59.000Z');
const NOW = isoTimestamp('2026-08-14T01:00:00.000Z');
const MIDDLE = isoTimestamp('2026-08-14T01:00:00.500Z');
const LATER = isoTimestamp('2026-08-14T01:00:01.000Z');
const AFTER = isoTimestamp('2026-08-14T01:00:02.000Z');

function digest(value: unknown): Sha256Digest {
  return digests.digest(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function changedProjectionValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return `${value}-bound-field-probe`;
  }
  if (typeof value === 'number') {
    return value + 1;
  }
  if (typeof value === 'boolean') {
    return !value;
  }
  if (isUnknownArray(value)) {
    return [...value, 'bound-field-probe'];
  }
  if (typeof value === 'object' && value !== null) {
    return { ...value, boundFieldProbe: true };
  }
  throw new TypeError('Golden projection contains an unsupported value');
}

function assertEveryTopLevelFieldIsBound(projection: unknown, expected: Sha256Digest): void {
  assert.equal(typeof projection, 'object');
  assert.notEqual(projection, null);
  for (const [key, value] of Object.entries(projection as Record<string, unknown>)) {
    assert.notEqual(
      digest({ ...(projection as Record<string, unknown>), [key]: changedProjectionValue(value) }),
      expected,
      `${key} must be digest-bound`,
    );
  }
}

function createFixtures() {
  const policies = createM26InteractionPolicies(digests);
  const sessionId = interactionSessionId('interaction-session_golden');
  const messageId = interactionMessageId('interaction-message_golden');
  const focusId = focusBindingId('focus-binding_golden');
  const proposalId = routeProposalId('route-proposal_golden');
  const decisionId = routeDecisionId('route-decision_golden');
  const actionId = pendingActionId('pending-action_golden');
  const resolutionId = pendingActionResolutionId('pending-action-resolution_golden');
  const reservationId = interactionActionReservationId('interaction-action-reservation_golden');
  const outcomeId = interactionActionOutcomeId('interaction-action-outcome_golden');
  const handoffId = interactionMessageHandoffId('interaction-message-handoff_golden');
  const operationId = interactionOperationId('interaction-operation_golden');
  const command = commandId('command_golden');
  const principal = principalId('principal_local-user');
  const projectRef = {
    schemaVersion: 1 as const,
    normalizedPath: '/fixture/m2-6',
    identityDigest: ONE,
  };
  const routingPolicy = {
    id: policies.routingPolicy.id,
    version: policies.routingPolicy.version,
    digest: policies.routingPolicy.digest,
  };
  const confirmationPolicy = {
    id: policies.confirmationPolicy.id,
    version: policies.confirmationPolicy.version,
    digest: policies.confirmationPolicy.digest,
  };
  const configuration = { id: 'frontstage-config_local', version: 'v1', digest: ONE };
  const contextCompiler = { id: 'frontstage-context-compiler_local', version: 'v1', digest: TWO };
  const assistantProfile = {
    id: 'frontstage-assistant-profile_local',
    version: 'v1',
    digest: TWO,
  };
  const assistantAdapter = {
    id: 'frontstage-assistant-adapter_local',
    version: 'v1',
    digest: TWO,
  };
  const responseContract = { id: 'frontstage-response_local', version: 'v1', digest: TWO };
  const retentionProfile = { id: 'frontstage-retention_local', version: 'v1', digest: TWO };
  const budgetProfile = { id: 'frontstage-budget_local', version: 'v1', digest: THREE };
  const goalTarget = {
    goalId: goalId('goal_golden'),
    goalRevision: goalRevision(2),
    workflowId: workflowId('workflow_golden'),
    workflowVersion: workflowVersion(3),
  };

  const focusBase = {
    id: focusId,
    schemaVersion: 1 as const,
    sessionId,
    basedOnSessionVersion: interactionSessionVersion(1),
    kind: InteractionFocusKind.GOAL,
    goalTarget,
    createdAt: NOW,
  } satisfies FocusBindingProjectionInput;
  const focus = decodeFocusBinding(
    { ...focusBase, focusDigest: digest(focusBindingProjection(focusBase)) },
    digests,
  );

  const content = '请执行以下请求：修复支付幂等性';
  const messageBase = {
    id: messageId,
    schemaVersion: 1 as const,
    sessionId,
    principalRef: principal,
    role: InteractionMessageRole.USER,
    retention: InteractionContentRetention.RETAINED,
    content,
    contentDigest: digests.digestUtf8(content),
    contentByteLength: Buffer.byteLength(content, 'utf8'),
    createdAt: NOW,
  } satisfies InteractionMessageProjectionInput;
  const message = decodeInteractionMessage(
    { ...messageBase, messageDigest: digest(interactionMessageProjection(messageBase)) },
    digests,
  );
  if (message.retention !== InteractionContentRetention.RETAINED) {
    throw new TypeError('Golden Interaction Message must retain its content');
  }

  const contextManifestBase = {
    id: frontstageContextManifestId('frontstage-context-manifest_golden'),
    schemaVersion: 1 as const,
    sessionId,
    operationId,
    reservedOperationVersion: interactionOperationVersion(1),
    currentMessageRef: { id: message.id, digest: message.messageDigest },
    currentMessageContentDigest: message.contentDigest,
    currentMessageContentByteLength: message.contentByteLength,
    selectedPriorMessages: [],
    focusRef: { id: focus.id, digest: focus.focusDigest },
    selectedGoalSummaries: [{ goalTarget, projectionDigest: THREE }],
    omissions: [
      {
        sourceClass: FrontstageContextOmissionSourceClass.PRIOR_MESSAGE,
        reasonCode: FrontstageContextOmissionReason.NOT_PRESENT,
        omittedSourceDigests: [],
      },
      {
        sourceClass: FrontstageContextOmissionSourceClass.ACTIVE_INTAKE_QUESTION,
        reasonCode: FrontstageContextOmissionReason.NOT_PRESENT,
        omittedSourceDigests: [],
      },
    ],
    configuration,
    contextCompiler,
    assistantProfile,
    assistantAdapter,
    responseContract,
    routingPolicy,
    retentionProfile,
    budgetProfile,
    packageDigest: ONE,
    packageByteLength: 1_024,
    createdAt: NOW,
  } satisfies FrontstageContextManifestProjectionInput;
  const contextManifest = decodeFrontstageContextManifest(
    {
      ...contextManifestBase,
      manifestDigest: digest(frontstageContextManifestProjection(contextManifestBase)),
    },
    digests,
  );

  const proposalBase = {
    id: proposalId,
    schemaVersion: 1 as const,
    sessionId,
    operationId,
    messageRef: { id: message.id, digest: message.messageDigest },
    contextManifestRef: { id: contextManifest.id, digest: contextManifest.manifestDigest },
    assistantProfile,
    assistantAdapter,
    responseContract,
    kind: FrontstageProposalKind.ROUTE_PROPOSAL,
    candidateRoute: FrontstageCandidateRoute.SUBMIT_GOVERNED_INTAKE,
    candidateGoalIds: [],
    ambiguity: FrontstageProposalAmbiguity.NONE,
    observedAt: NOW,
  } satisfies RouteProposalProjectionInput;
  const proposal = decodeRouteProposal(
    { ...proposalBase, proposalDigest: digest(routeProposalProjection(proposalBase)) },
    digests,
  );

  const routeResult = decideM26InteractionRoute(
    {
      kind: InteractionRoutingInputKind.DIRECT_ACTION,
      sessionId,
      sessionDigest: ONE,
      messageId,
      messageDigest: message.messageDigest,
      focusDigest: focus.focusDigest,
      originatingMessage: content,
      originatingMessageContentDigest: message.contentDigest,
    },
    policies,
    digests,
  );
  if (routeResult.decision.outcome !== InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION) {
    throw new TypeError('Golden direct route must propose an Intake Action');
  }

  const decisionBase = {
    id: decisionId,
    schemaVersion: 1 as const,
    sessionId,
    expectedSessionVersion: interactionSessionVersion(1),
    messageRef: { id: message.id, digest: message.messageDigest },
    focusRef: { id: focus.id, digest: focus.focusDigest },
    source: routeResult.source,
    routingPolicy,
    allowedRoutes: Object.values(InteractionRouteDecisionOutcome),
    reasonTrace: routeResult.trace,
    outcome: routeResult.decision.outcome,
    actionKind: routeResult.decision.actionKind,
    decidedAt: NOW,
  } satisfies RouteDecisionProjectionInput;
  const decision = decodeRouteDecision(
    { ...decisionBase, decisionDigest: digest(routeDecisionProjection(decisionBase)) },
    digests,
  );

  const admissionResult = decideM26ActionAdmission(
    {
      actionKind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
      requestSource: InteractionActionRequestSource.DIRECT_ACTION,
      originatingMessage: content,
      originatingMessageContentDigest: message.contentDigest,
      targetResolution: InteractionTargetResolution.EXACT,
      sessionExecutionBusy: false,
      targetsActiveSessionGoal: false,
    },
    policies,
    digests,
  );
  if (admissionResult.decision.disposition !== 'CREATE_PENDING_ACTION') {
    throw new TypeError('Golden direct admission must create a Pending Action');
  }

  const actionBase = {
    id: actionId,
    schemaVersion: 1 as const,
    sessionId,
    principalRef: principal,
    projectRef,
    originatingMessageRef: { id: message.id, digest: message.messageDigest },
    routeDecisionRef: { id: decision.id, digest: decision.decisionDigest },
    focusRef: { id: focus.id, digest: focus.focusDigest },
    kind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
    actionDerivation: admissionResult.decision.actionDerivation,
    preallocatedCommandId: command,
    canonicalCommandInputDigest: THREE,
    publicCapability: InteractionPublicCapability.SUBMIT_INTAKE,
    routingPolicy,
    confirmationPolicy,
    confirmationRequirement: admissionResult.decision.confirmationRequirement,
    reasonTrace: [...routeResult.trace, ...admissionResult.trace],
    expiresAt: LATER,
    createdAt: NOW,
  } satisfies PendingActionProjectionInput;
  const pendingAction = decodePendingAction(
    { ...actionBase, pendingActionDigest: digest(pendingActionProjection(actionBase)) },
    digests,
  );
  if (pendingAction.kind !== PendingActionKind.SUBMIT_GOVERNED_INTAKE) {
    throw new TypeError('Golden Pending Action must remain governed Intake');
  }

  const resolutionBase = {
    id: resolutionId,
    schemaVersion: 1 as const,
    pendingActionRef: { id: pendingAction.id, digest: pendingAction.pendingActionDigest },
    confirmationPolicy,
    disposition: PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED,
    authorizingMessageRef: { id: message.id, digest: message.messageDigest },
    resolvedAt: NOW,
  } satisfies PendingActionResolutionProjectionInput;
  const resolution = decodePendingActionResolution(
    {
      ...resolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(resolutionBase)),
    },
    digests,
  );
  if (resolution.disposition !== PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED) {
    throw new TypeError('Golden Resolution must remain directly authorized');
  }

  const reservationBase = {
    id: reservationId,
    schemaVersion: 1 as const,
    pendingActionRef: resolution.pendingActionRef,
    resolutionRef: { id: resolution.id, digest: resolution.resolutionDigest },
    publicCapability: pendingAction.publicCapability,
    commandId: command,
    canonicalCommandInputDigest: pendingAction.canonicalCommandInputDigest,
    reservedAt: NOW,
  } satisfies InteractionActionReservationProjectionInput;
  const reservation = decodeInteractionActionReservation(
    {
      ...reservationBase,
      reservationDigest: digest(interactionActionReservationProjection(reservationBase)),
    },
    digests,
  );

  const outcomeBase = {
    id: outcomeId,
    schemaVersion: 1 as const,
    reservationRef: { id: reservation.id, digest: reservation.reservationDigest },
    commandId: command,
    canonicalCommandInputDigest: reservation.canonicalCommandInputDigest,
    disposition: InteractionActionOutcomeDisposition.APPLIED,
    publicCommandOutcomeDigest: ONE,
    resultProjectionDigest: TWO,
    completedAt: LATER,
  } satisfies InteractionActionOutcomeProjectionInput;
  const outcome = decodeInteractionActionOutcome(
    { ...outcomeBase, outcomeDigest: digest(interactionActionOutcomeProjection(outcomeBase)) },
    digests,
  );

  const handoffBase = {
    id: handoffId,
    schemaVersion: 1 as const,
    kind: InteractionMessageHandoffKind.AUTHORIZED_INTAKE_ACTION,
    sessionId,
    messageRef: pendingAction.originatingMessageRef,
    pendingActionRef: resolution.pendingActionRef,
    resolutionRef: reservation.resolutionRef,
    reservationRef: { id: reservation.id, digest: reservation.reservationDigest },
    admittedUserContent: message.content,
    admittedContentDigest: message.contentDigest,
    intakeCommandId: command,
    createdAt: NOW,
  } satisfies InteractionMessageHandoffProjectionInput;
  const handoff = decodeInteractionMessageHandoff(
    { ...handoffBase, handoffDigest: digest(interactionMessageHandoffProjection(handoffBase)) },
    digests,
  );
  if (handoff.kind !== InteractionMessageHandoffKind.AUTHORIZED_INTAKE_ACTION) {
    throw new TypeError('Golden Action Handoff must retain its discriminant');
  }

  const sessionBase = {
    id: sessionId,
    schemaVersion: 1 as const,
    version: interactionSessionVersion(1),
    principalRef: principal,
    projectRef,
    state: InteractionSessionState.OPEN,
    configuration,
    routingPolicy,
    confirmationPolicy,
    retentionProfile,
    currentFocusRef: { id: focus.id, digest: focus.focusDigest },
    openedAt: NOW,
    updatedAt: NOW,
  } satisfies InteractionSessionProjectionInput;
  const session = decodeInteractionSession(
    { ...sessionBase, sessionDigest: digest(interactionSessionProjection(sessionBase)) },
    digests,
  );
  const contextSessionBase = {
    ...sessionBase,
    version: interactionSessionVersion(2),
  } satisfies InteractionSessionProjectionInput;
  const contextSession = decodeInteractionSession(
    {
      ...contextSessionBase,
      sessionDigest: digest(interactionSessionProjection(contextSessionBase)),
    },
    digests,
  );

  const contextManifestOperationBase = {
    id: contextManifest.operationId,
    schemaVersion: 1 as const,
    version: contextManifest.reservedOperationVersion,
    sessionId,
    expectedSessionVersion: contextSession.version,
    messageRef: contextManifest.currentMessageRef,
    operationKind: InteractionOperationKind.ROUTE,
    contextManifestRef: { id: contextManifest.id, digest: contextManifest.manifestDigest },
    assistantProfile: contextManifest.assistantProfile,
    state: InteractionOperationState.RESERVED,
    reservedAt: NOW,
  } satisfies InteractionOperationProjectionInput;
  const contextManifestOperation = decodeInteractionOperation(
    {
      ...contextManifestOperationBase,
      operationDigest: digest(interactionOperationProjection(contextManifestOperationBase)),
    },
    digests,
  );
  if (contextManifestOperation.state !== InteractionOperationState.RESERVED) {
    throw new TypeError('Golden Context Manifest Operation must remain reserved');
  }

  const answerContent = '这是一个有界回答。';
  const answerProposalBase = {
    id: routeProposalId('route-proposal_answer-golden'),
    schemaVersion: 1 as const,
    sessionId,
    operationId: interactionOperationId('interaction-operation_answer-golden'),
    messageRef: { id: message.id, digest: message.messageDigest },
    contextManifestRef: {
      id: frontstageContextManifestId('frontstage-context-manifest_answer-golden'),
      digest: TWO,
    },
    assistantProfile: proposal.assistantProfile,
    assistantAdapter: proposal.assistantAdapter,
    responseContract: proposal.responseContract,
    kind: FrontstageProposalKind.ANSWER_PROPOSAL,
    answerContent,
    observedAt: NOW,
  } satisfies RouteProposalProjectionInput;
  const answerProposal = decodeRouteProposal(
    {
      ...answerProposalBase,
      proposalDigest: digest(routeProposalProjection(answerProposalBase)),
    },
    digests,
  );
  const answerRouteResult = decideM26InteractionRoute(
    {
      kind: InteractionRoutingInputKind.ASSISTANT_PROPOSAL,
      sessionId,
      sessionDigest: ONE,
      messageId,
      messageDigest: message.messageDigest,
      focusDigest: focus.focusDigest,
      proposal: answerProposal,
    },
    policies,
    digests,
  );
  if (answerRouteResult.decision.outcome !== InteractionRouteDecisionOutcome.ANSWER) {
    throw new TypeError('Golden Answer Proposal must produce an Answer route');
  }
  const answerDecisionBase = {
    id: routeDecisionId('route-decision_answer-golden'),
    schemaVersion: 1 as const,
    sessionId,
    expectedSessionVersion: interactionSessionVersion(1),
    messageRef: { id: message.id, digest: message.messageDigest },
    focusRef: { id: focus.id, digest: focus.focusDigest },
    proposalRef: { id: answerProposal.id, digest: answerProposal.proposalDigest },
    source: answerRouteResult.source,
    routingPolicy,
    allowedRoutes: Object.values(InteractionRouteDecisionOutcome),
    reasonTrace: answerRouteResult.trace,
    outcome: answerRouteResult.decision.outcome,
    answerProposalRef: { id: answerProposal.id, digest: answerProposal.proposalDigest },
    decidedAt: NOW,
  } satisfies RouteDecisionProjectionInput;
  const answerDecision = decodeRouteDecision(
    {
      ...answerDecisionBase,
      decisionDigest: digest(routeDecisionProjection(answerDecisionBase)),
    },
    digests,
  );

  const answerBase = {
    id: frontstageAnswerId('frontstage-answer_golden'),
    schemaVersion: 1 as const,
    sessionId,
    originatingMessageRef: pendingAction.originatingMessageRef,
    routeDecisionRef: { id: answerDecision.id, digest: answerDecision.decisionDigest },
    proposalRef: { id: answerProposal.id, digest: answerProposal.proposalDigest },
    assistantProfile: answerProposal.assistantProfile,
    responseContract: answerProposal.responseContract,
    retentionProfile: session.retentionProfile,
    answerContent,
    answerContentDigest: digests.digestUtf8(answerContent),
    createdAt: NOW,
  } satisfies FrontstageAnswerProjectionInput;
  const answer = decodeFrontstageAnswer(
    { ...answerBase, answerDigest: digest(frontstageAnswerProjection(answerBase)) },
    digests,
  );

  const answerRouteOperationBase = {
    id: answerProposal.operationId,
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId,
    expectedSessionVersion: answerDecision.expectedSessionVersion,
    messageRef: answerProposal.messageRef,
    operationKind: InteractionOperationKind.ROUTE,
    contextManifestRef: answerProposal.contextManifestRef,
    assistantProfile: answerProposal.assistantProfile,
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef: { id: answerDecision.id, digest: answerDecision.decisionDigest },
      routeProposalRef: { id: answerProposal.id, digest: answerProposal.proposalDigest },
    },
    reservedAt: NOW,
    completedAt: NOW,
  } satisfies InteractionOperationProjectionInput;
  const answerRouteOperation = decodeInteractionOperation(
    {
      ...answerRouteOperationBase,
      operationDigest: digest(interactionOperationProjection(answerRouteOperationBase)),
    },
    digests,
  );
  if (answerRouteOperation.state !== InteractionOperationState.COMPLETED) {
    throw new TypeError('Golden Answer Route Operation must remain completed');
  }

  const answerOperationBase = {
    id: interactionOperationId('interaction-operation_answer-record-golden'),
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId,
    expectedSessionVersion: answerDecision.expectedSessionVersion,
    messageRef: answerProposal.messageRef,
    operationKind: InteractionOperationKind.FRONTSTAGE_ANSWER,
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ANSWER_RECORDED,
      answerRef: { id: answer.id, digest: answer.answerDigest },
    },
    reservedAt: NOW,
    completedAt: LATER,
  } satisfies InteractionOperationProjectionInput;
  const answerOperation = decodeInteractionOperation(
    {
      ...answerOperationBase,
      operationDigest: digest(interactionOperationProjection(answerOperationBase)),
    },
    digests,
  );
  if (answerOperation.state !== InteractionOperationState.COMPLETED) {
    throw new TypeError('Golden Answer Operation must remain completed');
  }

  const operationBase = {
    id: operationId,
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId,
    expectedSessionVersion: interactionSessionVersion(1),
    messageRef: pendingAction.originatingMessageRef,
    operationKind: InteractionOperationKind.ROUTE,
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef: pendingAction.routeDecisionRef,
    },
    reservedAt: NOW,
    completedAt: LATER,
  } satisfies InteractionOperationProjectionInput;
  const operation = decodeInteractionOperation(
    { ...operationBase, operationDigest: digest(interactionOperationProjection(operationBase)) },
    digests,
  );

  return {
    policies,
    session,
    contextSession,
    message,
    focus,
    contextManifest,
    contextManifestOperation,
    proposal,
    decision,
    answerProposal,
    answerDecision,
    pendingAction,
    resolution,
    reservation,
    outcome,
    handoff,
    answer,
    answerRouteOperation,
    answerOperation,
    operation,
  };
}

function assertInteractionLifecycleTransitions(fixtures: ReturnType<typeof createFixtures>): void {
  if (fixtures.session.state !== InteractionSessionState.OPEN) {
    throw new TypeError('Lifecycle fixture must start with an open Interaction Session');
  }
  if (fixtures.operation.state !== InteractionOperationState.COMPLETED) {
    throw new TypeError('Lifecycle fixture must include one completed Interaction Operation');
  }

  const { sessionDigest, ...openSession } = fixtures.session;
  void sessionDigest;
  const decodeSession = (base: InteractionSessionProjectionInput) =>
    decodeInteractionSession(
      { ...base, sessionDigest: digest(interactionSessionProjection(base)) },
      digests,
    );
  const { currentFocusRef: initialFocusRef, ...initialSessionInput } = openSession;
  void initialFocusRef;
  const initialSession = decodeSession(initialSessionInput);
  assert.doesNotThrow(() => assertInitialInteractionSessionInvariant(initialSession));
  assert.throws(
    () => assertInitialInteractionSessionInvariant(fixtures.session),
    /unfocused OPEN version 1/,
  );

  const admittedSessionBase = {
    ...initialSessionInput,
    version: interactionSessionVersion(2),
    updatedAt: fixtures.message.createdAt,
  } satisfies InteractionSessionProjectionInput;
  const admittedSession = decodeSession(admittedSessionBase);
  assert.doesNotThrow(() =>
    assertInteractionUserMessageAdmission({
      currentSession: initialSession,
      message: fixtures.message,
      nextSession: admittedSession,
      retainedMessageCountBefore: 0,
      retainedContentBytesBefore: 0,
    }),
  );
  const retentionLimitSessionBase = {
    ...initialSessionInput,
    version: interactionSessionVersion(2),
    state: InteractionSessionState.CLOSED,
    terminalReason: InteractionSessionTerminalReason.RETENTION_LIMIT_REACHED,
    updatedAt: fixtures.message.createdAt,
  } satisfies InteractionSessionProjectionInput;
  const retentionLimitSession = decodeSession(retentionLimitSessionBase);
  assert.doesNotThrow(() =>
    assertInteractionUserMessageAdmission({
      currentSession: initialSession,
      message: fixtures.message,
      nextSession: retentionLimitSession,
      retainedMessageCountBefore: INTERACTION_MAXIMUM_SESSION_MESSAGES - 1,
      retainedContentBytesBefore: 0,
    }),
  );
  assert.doesNotThrow(() =>
    assertInteractionUserMessageAdmission({
      currentSession: initialSession,
      message: fixtures.message,
      nextSession: retentionLimitSession,
      retainedMessageCountBefore: 0,
      retainedContentBytesBefore:
        INTERACTION_MAXIMUM_SESSION_CONTENT_BYTES - fixtures.message.contentByteLength,
    }),
  );
  assert.throws(
    () =>
      assertInteractionUserMessageAdmission({
        currentSession: initialSession,
        message: fixtures.message,
        nextSession: admittedSession,
        retainedMessageCountBefore: 512,
        retainedContentBytesBefore: 0,
      }),
    /retention budget is exhausted/,
  );

  const focusedSessionBase = {
    ...initialSessionInput,
    version: interactionSessionVersion(2),
    currentFocusRef: { id: fixtures.focus.id, digest: fixtures.focus.focusDigest },
    updatedAt: fixtures.focus.createdAt,
  } satisfies InteractionSessionProjectionInput;
  assert.doesNotThrow(() =>
    assertInteractionFocusUpdate({
      currentSession: initialSession,
      focus: fixtures.focus,
      nextSession: decodeSession(focusedSessionBase),
    }),
  );
  const closingBase = {
    ...openSession,
    version: interactionSessionVersion(2),
    state: InteractionSessionState.CLOSING,
    updatedAt: LATER,
  } satisfies InteractionSessionProjectionInput;
  const closing = decodeSession(closingBase);
  const closedBase = {
    ...closingBase,
    version: interactionSessionVersion(3),
    state: InteractionSessionState.CLOSED,
    updatedAt: AFTER,
  } satisfies InteractionSessionProjectionInput;
  const closed = decodeSession(closedBase);
  const interruptedBase = {
    ...openSession,
    version: interactionSessionVersion(2),
    state: InteractionSessionState.INTERRUPTED,
    updatedAt: LATER,
  } satisfies InteractionSessionProjectionInput;
  const interrupted = decodeSession(interruptedBase);
  const closingInterruptedBase = {
    ...closingBase,
    version: interactionSessionVersion(3),
    state: InteractionSessionState.INTERRUPTED,
    updatedAt: AFTER,
  } satisfies InteractionSessionProjectionInput;
  const closingInterrupted = decodeSession(closingInterruptedBase);
  const retentionClosedBase = {
    ...openSession,
    version: interactionSessionVersion(2),
    state: InteractionSessionState.CLOSED,
    terminalReason: InteractionSessionTerminalReason.RETENTION_LIMIT_REACHED,
    updatedAt: LATER,
  } satisfies InteractionSessionProjectionInput;
  const retentionClosed = decodeSession(retentionClosedBase);
  const openUpdateBase = {
    ...openSession,
    version: interactionSessionVersion(2),
    updatedAt: LATER,
  } satisfies InteractionSessionProjectionInput;
  const openUpdate = decodeSession(openUpdateBase);

  assert.doesNotThrow(() => assertInteractionSessionTransition(fixtures.session, openUpdate));
  assert.doesNotThrow(() => assertInteractionSessionTransition(fixtures.session, closing));
  assert.doesNotThrow(() => assertInteractionSessionTransition(closing, closed));
  assert.doesNotThrow(() => assertInteractionSessionTransition(fixtures.session, interrupted));
  assert.doesNotThrow(() => assertInteractionSessionTransition(closing, closingInterrupted));
  assert.doesNotThrow(() => assertInteractionSessionTransition(fixtures.session, retentionClosed));

  const directNormalCloseBase = {
    ...openSession,
    version: interactionSessionVersion(2),
    state: InteractionSessionState.CLOSED,
    updatedAt: LATER,
  } satisfies InteractionSessionProjectionInput;
  assert.throws(
    () =>
      assertInteractionSessionTransition(fixtures.session, decodeSession(directNormalCloseBase)),
    /retention limit/,
  );
  const reopenedBase = {
    ...openSession,
    version: interactionSessionVersion(3),
    updatedAt: AFTER,
  } satisfies InteractionSessionProjectionInput;
  assert.throws(
    () => assertInteractionSessionTransition(interrupted, decodeSession(reopenedBase)),
    /terminal Interaction Session/,
  );
  const repeatedClosingBase = {
    ...closingBase,
    version: interactionSessionVersion(3),
    updatedAt: AFTER,
  } satisfies InteractionSessionProjectionInput;
  assert.throws(
    () => assertInteractionSessionTransition(closing, decodeSession(repeatedClosingBase)),
    /lifecycle transition is not allowed/,
  );
  const { currentFocusRef, ...closingWithoutFocusInput } = closingBase;
  void currentFocusRef;
  const closingWithoutFocus = decodeSession(closingWithoutFocusInput);
  assert.throws(
    () => assertInteractionSessionTransition(fixtures.session, closingWithoutFocus),
    /focus cannot change/,
  );
  const replacedConfigurationBase = {
    ...openSession,
    version: interactionSessionVersion(2),
    configuration: { id: 'frontstage-config_replaced', version: 'v1', digest: THREE },
    updatedAt: LATER,
  } satisfies InteractionSessionProjectionInput;
  assert.throws(
    () =>
      assertInteractionSessionTransition(
        fixtures.session,
        decodeSession(replacedConfigurationBase),
      ),
    /changed immutable authority/,
  );

  const operationCommon = {
    id: fixtures.operation.id,
    schemaVersion: 1 as const,
    sessionId: fixtures.operation.sessionId,
    expectedSessionVersion: fixtures.operation.expectedSessionVersion,
    messageRef: fixtures.operation.messageRef,
    operationKind: fixtures.operation.operationKind,
    reservedAt: fixtures.operation.reservedAt,
  };
  const decodeOperation = (base: InteractionOperationProjectionInput) =>
    decodeInteractionOperation(
      { ...base, operationDigest: digest(interactionOperationProjection(base)) },
      digests,
    );
  const reservedBase = {
    ...operationCommon,
    version: interactionOperationVersion(1),
    state: InteractionOperationState.RESERVED,
  } satisfies InteractionOperationProjectionInput;
  const reserved = decodeOperation(reservedBase);
  if (reserved.state !== InteractionOperationState.RESERVED) {
    throw new TypeError('Reservation fixture must remain reserved');
  }
  assert.doesNotThrow(() => assertInitialInteractionOperationInvariant(reserved));
  assert.throws(
    () => assertInitialInteractionOperationInvariant(fixtures.answerRouteOperation),
    /must be reserved before terminalization/,
  );
  const admittedReservedBase = {
    ...reservedBase,
    expectedSessionVersion: admittedSession.version,
  } satisfies InteractionOperationProjectionInput;
  const admittedReserved = decodeOperation(admittedReservedBase);
  if (admittedReserved.state !== InteractionOperationState.RESERVED) {
    throw new TypeError('Admitted reservation fixture must remain reserved');
  }
  const reserveForMessage = (message: InteractionMessage) => {
    const operation = decodeOperation({
      ...admittedReservedBase,
      messageRef: { id: message.id, digest: message.messageDigest },
      reservedAt:
        message.createdAt > admittedReserved.reservedAt
          ? message.createdAt
          : admittedReserved.reservedAt,
    });
    if (operation.state !== InteractionOperationState.RESERVED) {
      throw new TypeError('Message reservation fixture must remain reserved');
    }
    return operation;
  };
  assert.doesNotThrow(() =>
    assertInteractionOperationReservationChain({
      session: admittedSession,
      message: fixtures.message,
      operation: admittedReserved,
    }),
  );
  assert.throws(
    () =>
      assertInteractionOperationReservationChain({
        session: initialSession,
        message: fixtures.message,
        operation: reserved,
      }),
    /current Session and Message/,
  );
  const staleMessageBase = {
    ...fixtures.message,
    id: interactionMessageId('interaction-message_stale-reservation-adversary'),
    createdAt: BEFORE,
  } satisfies InteractionMessageProjectionInput;
  const staleMessage = decodeInteractionMessage(
    {
      ...staleMessageBase,
      messageDigest: digest(interactionMessageProjection(staleMessageBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionOperationReservationChain({
        session: admittedSession,
        message: staleMessage,
        operation: reserveForMessage(staleMessage),
      }),
    /current Session and Message/,
  );
  const futureMessageBase = {
    ...fixtures.message,
    id: interactionMessageId('interaction-message_future-reservation-adversary'),
    createdAt: LATER,
  } satisfies InteractionMessageProjectionInput;
  const futureMessage = decodeInteractionMessage(
    {
      ...futureMessageBase,
      messageDigest: digest(interactionMessageProjection(futureMessageBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionOperationReservationChain({
        session: admittedSession,
        message: futureMessage,
        operation: reserveForMessage(futureMessage),
      }),
    /current Session and Message/,
  );
  const frontstageMessageBase = {
    ...fixtures.message,
    id: interactionMessageId('interaction-message_frontstage-reservation-adversary'),
    role: InteractionMessageRole.FRONTSTAGE,
    causedByOperationRef: { id: reserved.id, digest: reserved.operationDigest },
  } satisfies InteractionMessageProjectionInput;
  const frontstageMessage = decodeInteractionMessage(
    {
      ...frontstageMessageBase,
      messageDigest: digest(interactionMessageProjection(frontstageMessageBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionOperationReservationChain({
        session: admittedSession,
        message: frontstageMessage,
        operation: reserveForMessage(frontstageMessage),
      }),
    /current Session and Message/,
  );
  const omittedMessageBase = {
    id: interactionMessageId('interaction-message_omitted-reservation-adversary'),
    schemaVersion: 1 as const,
    sessionId: fixtures.message.sessionId,
    principalRef: fixtures.message.principalRef,
    role: InteractionMessageRole.USER,
    retention: InteractionContentRetention.OMITTED,
    omissionReason: InteractionContentOmissionReason.RETENTION_POLICY,
    contentDigest: ZERO,
    contentByteLength: 0,
    createdAt: fixtures.message.createdAt,
  } satisfies InteractionMessageProjectionInput;
  const omittedMessage = decodeInteractionMessage(
    {
      ...omittedMessageBase,
      messageDigest: digest(interactionMessageProjection(omittedMessageBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionOperationReservationChain({
        session: admittedSession,
        message: omittedMessage,
        operation: reserveForMessage(omittedMessage),
      }),
    /current Session and Message/,
  );
  const completedBase = {
    ...operationCommon,
    version: interactionOperationVersion(2),
    state: InteractionOperationState.COMPLETED,
    result: fixtures.operation.result,
    completedAt: LATER,
  } satisfies InteractionOperationProjectionInput;
  const completed = decodeOperation(completedBase);
  const failedBase = {
    ...operationCommon,
    version: interactionOperationVersion(2),
    state: InteractionOperationState.FAILED,
    failureReason: InteractionOperationFailureReason.ASSISTANT_FAILED,
    completedAt: LATER,
  } satisfies InteractionOperationProjectionInput;
  const failed = decodeOperation(failedBase);
  const interruptedOperationBase = {
    ...operationCommon,
    version: interactionOperationVersion(2),
    state: InteractionOperationState.INTERRUPTED,
    failureReason: InteractionOperationFailureReason.INTERRUPTED,
    completedAt: LATER,
  } satisfies InteractionOperationProjectionInput;
  const interruptedOperation = decodeOperation(interruptedOperationBase);
  const { contextManifestRef, assistantProfile } = fixtures.answerRouteOperation;
  if (contextManifestRef === undefined || assistantProfile === undefined) {
    throw new TypeError('Assistant Operation fixture must bind its Manifest and Profile');
  }
  const assistantReservationBase = {
    id: fixtures.answerRouteOperation.id,
    schemaVersion: fixtures.answerRouteOperation.schemaVersion,
    version: interactionOperationVersion(1),
    sessionId: fixtures.answerRouteOperation.sessionId,
    expectedSessionVersion: fixtures.answerRouteOperation.expectedSessionVersion,
    messageRef: fixtures.answerRouteOperation.messageRef,
    operationKind: fixtures.answerRouteOperation.operationKind,
    contextManifestRef,
    assistantProfile,
    state: InteractionOperationState.RESERVED,
    reservedAt: fixtures.answerRouteOperation.reservedAt,
  } satisfies InteractionOperationProjectionInput;
  const assistantReservation = decodeOperation(assistantReservationBase);
  if (assistantReservation.state !== InteractionOperationState.RESERVED) {
    throw new TypeError('Assistant reservation projection must remain reserved');
  }
  const assistantFailureBase = {
    ...assistantReservationBase,
    version: interactionOperationVersion(2),
    state: InteractionOperationState.FAILED,
    failureReason: InteractionOperationFailureReason.ASSISTANT_FAILED,
    completedAt: LATER,
  } satisfies InteractionOperationProjectionInput;
  const assistantFailure = decodeOperation(assistantFailureBase);
  assert.doesNotThrow(() =>
    assertInteractionOperationTransition(assistantReservation, assistantFailure),
  );
  assert.deepEqual(
    interactionOperationReservationProjection(assistantFailure),
    assistantReservationBase,
  );
  assert.doesNotThrow(() => assertInitialInteractionOperationInvariant(fixtures.operation));
  assert.throws(
    () => interactionOperationReservationProjection(fixtures.operation),
    /prior reservation only at version 2/,
  );
  const interruptedCreationBase = {
    ...interruptedOperationBase,
    version: interactionOperationVersion(1),
  } satisfies InteractionOperationProjectionInput;

  assert.throws(
    () => assertInitialInteractionOperationInvariant(decodeOperation(interruptedCreationBase)),
    /cannot be created directly as interrupted/,
  );

  assert.doesNotThrow(() => assertInteractionOperationTransition(reserved, completed));
  assert.doesNotThrow(() => assertInteractionOperationTransition(reserved, failed));
  assert.doesNotThrow(() => assertInteractionOperationTransition(reserved, interruptedOperation));

  const repeatedReservationBase = {
    ...reservedBase,
    version: interactionOperationVersion(2),
  } satisfies InteractionOperationProjectionInput;
  assert.throws(
    () => assertInteractionOperationTransition(reserved, decodeOperation(repeatedReservationBase)),
    /must terminalize/,
  );
  assert.throws(
    () => assertInteractionOperationTransition(completed, failed),
    /terminal Interaction Operation/,
  );
  const reboundCompletedBase = {
    ...completedBase,
    messageRef: { ...completedBase.messageRef, digest: THREE },
  } satisfies InteractionOperationProjectionInput;
  assert.throws(
    () => assertInteractionOperationTransition(reserved, decodeOperation(reboundCompletedBase)),
    /changed reserved authority/,
  );
  const sameVersionCompletedBase = {
    ...completedBase,
    version: interactionOperationVersion(1),
  } satisfies InteractionOperationProjectionInput;
  assert.throws(
    () => assertInteractionOperationTransition(reserved, decodeOperation(sameVersionCompletedBase)),
    /advance exactly one version/,
  );
}

void test('[M26-D01] owning codecs and unknown-field fixtures', () => {
  const fixtures = createFixtures();
  assertInteractionLifecycleTransitions(fixtures);
  assertFrontstageContextManifestReservationChain({
    session: fixtures.contextSession,
    currentMessage: fixtures.message,
    focus: fixtures.focus,
    manifest: fixtures.contextManifest,
    operation: fixtures.contextManifestOperation,
  });
  assertInteractionActionChainInvariant({
    originatingMessage: fixtures.message,
    routeDecision: fixtures.decision,
    pendingAction: fixtures.pendingAction,
    resolution: fixtures.resolution,
    reservation: fixtures.reservation,
    outcome: fixtures.outcome,
    handoff: fixtures.handoff,
  });
  assert.doesNotThrow(() =>
    assertInteractionActionChainInvariant({
      originatingMessage: fixtures.message,
      routeDecision: fixtures.decision,
      pendingAction: fixtures.pendingAction,
      resolution: fixtures.resolution,
      reservation: fixtures.reservation,
    }),
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: fixtures.decision,
        pendingAction: fixtures.pendingAction,
        resolution: fixtures.resolution,
        reservation: fixtures.reservation,
        outcome: fixtures.outcome,
      }),
    /Outcome requires its exact message handoff/,
  );
  const lateHandoffBase = {
    ...fixtures.handoff,
    createdAt: AFTER,
  } satisfies InteractionMessageHandoffProjectionInput;
  const lateHandoff = decodeInteractionMessageHandoff(
    {
      ...lateHandoffBase,
      handoffDigest: digest(interactionMessageHandoffProjection(lateHandoffBase)),
    },
    digests,
  );
  if (lateHandoff.kind !== InteractionMessageHandoffKind.AUTHORIZED_INTAKE_ACTION) {
    assert.fail('Late Action Handoff must retain its discriminant');
  }
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: fixtures.decision,
        pendingAction: fixtures.pendingAction,
        resolution: fixtures.resolution,
        reservation: fixtures.reservation,
        outcome: fixtures.outcome,
        handoff: lateHandoff,
      }),
    /handoff cannot follow its Action Outcome/,
  );
  assertFrontstageAnswerChainInvariant({
    session: fixtures.session,
    originatingMessage: fixtures.message,
    routeOperation: fixtures.answerRouteOperation,
    proposal: fixtures.answerProposal,
    routeDecision: fixtures.answerDecision,
    answer: fixtures.answer,
    answerOperation: fixtures.answerOperation,
  });
  assert.ok(
    [
      fixtures.session,
      fixtures.message,
      fixtures.focus,
      fixtures.proposal,
      fixtures.decision,
      fixtures.pendingAction,
      fixtures.resolution,
      fixtures.reservation,
      fixtures.outcome,
      fixtures.handoff,
      fixtures.answer,
      fixtures.answerRouteOperation,
      fixtures.answerOperation,
      fixtures.operation,
    ].every(Object.isFrozen),
  );

  const owningCodecCases: readonly {
    readonly name: string;
    readonly record: object;
    readonly digestField: string;
    readonly decode: (value: unknown) => unknown;
  }[] = [
    {
      name: 'Direct-action grammar',
      record: fixtures.policies.directActionGrammar,
      digestField: 'digest',
      decode: (value) => decodeDirectActionGrammar(value, digests),
    },
    {
      name: 'Confirmation grammar',
      record: fixtures.policies.confirmationGrammar,
      digestField: 'digest',
      decode: (value) => decodeConfirmationGrammar(value, digests),
    },
    {
      name: 'Routing policy',
      record: fixtures.policies.routingPolicy,
      digestField: 'digest',
      decode: (value) => decodeInteractionRoutingPolicy(value, digests),
    },
    {
      name: 'Confirmation policy',
      record: fixtures.policies.confirmationPolicy,
      digestField: 'digest',
      decode: (value) => decodeInteractionConfirmationPolicy(value, digests),
    },
    {
      name: 'Session',
      record: fixtures.session,
      digestField: 'sessionDigest',
      decode: (value) => decodeInteractionSession(value, digests),
    },
    {
      name: 'Message',
      record: fixtures.message,
      digestField: 'messageDigest',
      decode: (value) => decodeInteractionMessage(value, digests),
    },
    {
      name: 'Focus',
      record: fixtures.focus,
      digestField: 'focusDigest',
      decode: (value) => decodeFocusBinding(value, digests),
    },
    {
      name: 'Frontstage Context Manifest',
      record: fixtures.contextManifest,
      digestField: 'manifestDigest',
      decode: (value) => decodeFrontstageContextManifest(value, digests),
    },
    {
      name: 'Proposal',
      record: fixtures.proposal,
      digestField: 'proposalDigest',
      decode: (value) => decodeRouteProposal(value, digests),
    },
    {
      name: 'Decision',
      record: fixtures.decision,
      digestField: 'decisionDigest',
      decode: (value) => decodeRouteDecision(value, digests),
    },
    {
      name: 'Pending Action',
      record: fixtures.pendingAction,
      digestField: 'pendingActionDigest',
      decode: (value) => decodePendingAction(value, digests),
    },
    {
      name: 'Resolution',
      record: fixtures.resolution,
      digestField: 'resolutionDigest',
      decode: (value) => decodePendingActionResolution(value, digests),
    },
    {
      name: 'Reservation',
      record: fixtures.reservation,
      digestField: 'reservationDigest',
      decode: (value) => decodeInteractionActionReservation(value, digests),
    },
    {
      name: 'Outcome',
      record: fixtures.outcome,
      digestField: 'outcomeDigest',
      decode: (value) => decodeInteractionActionOutcome(value, digests),
    },
    {
      name: 'Handoff',
      record: fixtures.handoff,
      digestField: 'handoffDigest',
      decode: (value) => decodeInteractionMessageHandoff(value, digests),
    },
    {
      name: 'Answer',
      record: fixtures.answer,
      digestField: 'answerDigest',
      decode: (value) => decodeFrontstageAnswer(value, digests),
    },
    {
      name: 'Operation',
      record: fixtures.operation,
      digestField: 'operationDigest',
      decode: (value) => decodeInteractionOperation(value, digests),
    },
  ];
  for (const codecCase of owningCodecCases) {
    assert.throws(
      () => codecCase.decode({ ...codecCase.record, unexpectedAuthority: true }),
      /unrecognized key/i,
      `${codecCase.name} codec must reject unknown fields`,
    );
    assert.throws(
      () => codecCase.decode({ ...codecCase.record, [codecCase.digestField]: ZERO }),
      /does not match/i,
      `${codecCase.name} codec must reject its substituted digest`,
    );
  }

  const partialSession: Record<string, unknown> = { ...fixtures.session };
  Reflect.deleteProperty(partialSession, 'projectRef');
  assert.throws(
    () => decodeInteractionSession(partialSession, digests),
    /projectRef|invalid input/i,
  );
  assert.throws(
    () => decodeInteractionSession({ ...fixtures.session, currentFocusRef: undefined }, digests),
    /must be omitted/,
  );
  const closedSessionBase = {
    ...fixtures.session,
    state: InteractionSessionState.CLOSED,
    terminalReason: InteractionSessionTerminalReason.RETENTION_LIMIT_REACHED,
  };
  assert.equal(
    decodeInteractionSession(
      {
        ...closedSessionBase,
        sessionDigest: digest(interactionSessionProjection(closedSessionBase)),
      },
      digests,
    ).state,
    InteractionSessionState.CLOSED,
  );
  assert.throws(
    () =>
      decodeInteractionSession(
        {
          ...fixtures.session,
          terminalReason: InteractionSessionTerminalReason.RETENTION_LIMIT_REACHED,
        },
        digests,
      ),
    /unrecognized key/i,
  );
  assert.throws(
    () =>
      decodeInteractionMessage(
        {
          ...fixtures.message,
          causedByOperationRef: {
            id: interactionOperationId('interaction-operation_user-forgery'),
            digest: ONE,
          },
        },
        digests,
      ),
    /invalid input|unrecognized key/i,
  );
  assert.throws(
    () =>
      decodeInteractionMessage(
        {
          ...fixtures.message,
          content: 'a'.repeat(16_385),
          contentByteLength: 16_385,
          contentDigest: digests.digestUtf8('a'.repeat(16_385)),
          messageDigest: ZERO,
        },
        digests,
      ),
    /byte limit/,
  );
  const omittedMessageBase = {
    id: interactionMessageId('interaction-message_omitted'),
    schemaVersion: 1 as const,
    sessionId: fixtures.session.id,
    principalRef: fixtures.session.principalRef,
    role: InteractionMessageRole.SYSTEM,
    causedByOperationRef: {
      id: interactionOperationId('interaction-operation_omitted-source'),
      digest: ONE,
    },
    retention: InteractionContentRetention.OMITTED,
    omissionReason: InteractionContentOmissionReason.RETENTION_POLICY,
    contentDigest: ONE,
    contentByteLength: 4,
    createdAt: NOW,
  } satisfies InteractionMessageProjectionInput;
  assert.equal(
    decodeInteractionMessage(
      {
        ...omittedMessageBase,
        messageDigest: digest(interactionMessageProjection(omittedMessageBase)),
      },
      digests,
    ).retention,
    InteractionContentRetention.OMITTED,
  );
  const systemWithoutCause = { ...omittedMessageBase };
  Reflect.deleteProperty(systemWithoutCause, 'causedByOperationRef');
  assert.throws(
    () =>
      decodeInteractionMessage(
        {
          ...systemWithoutCause,
          messageDigest: digest(interactionMessageProjection(systemWithoutCause)),
        },
        digests,
      ),
    /invalid input/i,
  );
  if (fixtures.proposal.kind !== FrontstageProposalKind.ROUTE_PROPOSAL) {
    assert.fail('Golden proposal must be a Route Proposal');
  }
  const oversizedExplanation = '界'.repeat(683);
  const oversizedAnswerContent = '界'.repeat(5_462);
  const oversizedProposalBase = {
    ...fixtures.proposal,
    explanationContent: oversizedExplanation,
  };
  assert.throws(
    () =>
      decodeRouteProposal(
        {
          ...oversizedProposalBase,
          proposalDigest: digest(routeProposalProjection(oversizedProposalBase)),
        },
        digests,
      ),
    /byte limit/,
  );
  const oversizedAnswerProposalBase = {
    ...fixtures.answerProposal,
    answerContent: oversizedAnswerContent,
  };
  assert.throws(
    () =>
      decodeRouteProposal(
        {
          ...oversizedAnswerProposalBase,
          proposalDigest: digest(routeProposalProjection(oversizedAnswerProposalBase)),
        },
        digests,
      ),
    /byte limit/,
  );
  const oversizedClarificationBase = {
    id: routeProposalId('route-proposal_oversized-clarification'),
    schemaVersion: 1 as const,
    sessionId: fixtures.session.id,
    operationId: interactionOperationId('interaction-operation_oversized-clarification'),
    messageRef: fixtures.pendingAction.originatingMessageRef,
    contextManifestRef: fixtures.proposal.contextManifestRef,
    assistantProfile: fixtures.proposal.assistantProfile,
    assistantAdapter: fixtures.proposal.assistantAdapter,
    responseContract: fixtures.proposal.responseContract,
    kind: FrontstageProposalKind.CLARIFICATION_PROPOSAL,
    ambiguity: FrontstageProposalAmbiguity.REQUEST_INCOMPLETE,
    questionContent: oversizedExplanation,
    observedAt: NOW,
  } satisfies RouteProposalProjectionInput;
  assert.throws(
    () =>
      decodeRouteProposal(
        {
          ...oversizedClarificationBase,
          proposalDigest: digest(routeProposalProjection(oversizedClarificationBase)),
        },
        digests,
      ),
    /byte limit/,
  );
  const oversizedAnswerBase = {
    ...fixtures.answer,
    answerContent: oversizedAnswerContent,
    answerContentDigest: digests.digestUtf8(oversizedAnswerContent),
  };
  assert.throws(
    () =>
      decodeFrontstageAnswer(
        {
          ...oversizedAnswerBase,
          answerDigest: digest(frontstageAnswerProjection(oversizedAnswerBase)),
        },
        digests,
      ),
    /byte limit/,
  );
  const oversizedHandoffBase = {
    ...fixtures.handoff,
    admittedUserContent: oversizedAnswerContent,
    admittedContentDigest: digests.digestUtf8(oversizedAnswerContent),
  };
  assert.throws(
    () =>
      decodeInteractionMessageHandoff(
        {
          ...oversizedHandoffBase,
          handoffDigest: digest(interactionMessageHandoffProjection(oversizedHandoffBase)),
        },
        digests,
      ),
    /byte limit/,
  );
  assert.throws(
    () =>
      decodePendingAction(
        {
          ...fixtures.pendingAction,
          publicCapability: InteractionPublicCapability.START_GOAL,
          pendingActionDigest: ZERO,
        },
        digests,
      ),
    /invalid input|does not match|capability/i,
  );
  if (fixtures.focus.kind !== InteractionFocusKind.GOAL) {
    assert.fail('Golden Focus must be Goal-bound');
  }
  const directCancelBase = {
    ...fixtures.pendingAction,
    kind: PendingActionKind.CANCEL_GOAL,
    actionDerivation: PendingActionDerivation.ROUTED_ACTION,
    publicCapability: InteractionPublicCapability.CANCEL_GOAL,
    goalTarget: fixtures.focus.goalTarget,
    confirmationRequirement: InteractionConfirmationRequirement.DIRECT_USER_MESSAGE_SUFFICIENT,
  };
  assert.throws(
    () =>
      decodePendingAction(
        {
          ...directCancelBase,
          pendingActionDigest: digest(pendingActionProjection(directCancelBase)),
        },
        digests,
      ),
    /Cancel Goal must require/,
  );
  const repeatedConfirmationBase = {
    id: pendingActionResolutionId('pending-action-resolution_repeated-message'),
    schemaVersion: 1 as const,
    pendingActionRef: fixtures.resolution.pendingActionRef,
    confirmationPolicy: fixtures.resolution.confirmationPolicy,
    disposition: PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
    originatingMessageRef: fixtures.pendingAction.originatingMessageRef,
    authorizingMessageRef: fixtures.pendingAction.originatingMessageRef,
    resolvedAt: NOW,
  } satisfies PendingActionResolutionProjectionInput;
  assert.throws(
    () =>
      decodePendingActionResolution(
        {
          ...repeatedConfirmationBase,
          resolutionDigest: digest(pendingActionResolutionProjection(repeatedConfirmationBase)),
        },
        digests,
      ),
    /two distinct user messages/,
  );
  assert.throws(
    () =>
      decodeInteractionOperation(
        {
          ...fixtures.operation,
          operationKind: InteractionOperationKind.GOAL_LIST,
          operationDigest: ZERO,
        },
        digests,
      ),
    /Only a Route Operation|result does not match/,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: fixtures.decision,
        pendingAction: fixtures.pendingAction,
        resolution: fixtures.resolution,
        reservation: { ...fixtures.reservation, commandId: commandId('command_substituted') },
      }),
    /exact authorized Action/,
  );
  const crossSessionMessageBase = {
    ...fixtures.message,
    sessionId: interactionSessionId('interaction-session_cross-session'),
  };
  const crossSessionMessage = decodeInteractionMessage(
    {
      ...crossSessionMessageBase,
      messageDigest: digest(interactionMessageProjection(crossSessionMessageBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: crossSessionMessage,
        routeDecision: fixtures.decision,
        pendingAction: fixtures.pendingAction,
        resolution: fixtures.resolution,
      }),
    /exact retained user message/,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: fixtures.answerDecision,
        pendingAction: fixtures.pendingAction,
        resolution: fixtures.resolution,
      }),
    /reason trace|exact Route Decision authority/,
  );
  assert.throws(() => interactionSessionId('session_wrong-prefix'), /InteractionSessionId/);
});

void test('P0 Frontstage Context Manifest binds one exact Route reservation', () => {
  const fixtures = createFixtures();
  assert.doesNotThrow(() =>
    assertFrontstageContextManifestReservationChain({
      session: fixtures.contextSession,
      currentMessage: fixtures.message,
      focus: fixtures.focus,
      manifest: fixtures.contextManifest,
      operation: fixtures.contextManifestOperation,
    }),
  );

  const substitutedMessageManifestBase = {
    ...fixtures.contextManifest,
    currentMessageContentDigest: ZERO,
  } satisfies FrontstageContextManifestProjectionInput;
  const substitutedMessageManifest = decodeFrontstageContextManifest(
    {
      ...substitutedMessageManifestBase,
      manifestDigest: digest(frontstageContextManifestProjection(substitutedMessageManifestBase)),
    },
    digests,
  );
  const { operationDigest: priorOperationDigest, ...contextOperationInput } =
    fixtures.contextManifestOperation;
  void priorOperationDigest;
  const substitutedMessageOperationBase = {
    ...contextOperationInput,
    contextManifestRef: {
      id: substitutedMessageManifest.id,
      digest: substitutedMessageManifest.manifestDigest,
    },
  } satisfies InteractionOperationProjectionInput;
  const substitutedMessageOperation = decodeInteractionOperation(
    {
      ...substitutedMessageOperationBase,
      operationDigest: digest(interactionOperationProjection(substitutedMessageOperationBase)),
    },
    digests,
  );
  if (substitutedMessageOperation.state !== InteractionOperationState.RESERVED) {
    assert.fail('Substituted Message Operation must remain reserved');
  }
  assert.throws(
    () =>
      assertFrontstageContextManifestReservationChain({
        session: fixtures.contextSession,
        currentMessage: fixtures.message,
        focus: fixtures.focus,
        manifest: substitutedMessageManifest,
        operation: substitutedMessageOperation,
      }),
    /exact current Session, Message, and Route reservation/,
  );

  const { sessionDigest: priorContextSessionDigest, ...contextSessionInput } =
    fixtures.contextSession;
  void priorContextSessionDigest;
  const advancedSessionBase = {
    ...contextSessionInput,
    version: interactionSessionVersion(3),
    updatedAt: LATER,
  } satisfies InteractionSessionProjectionInput;
  const advancedSession = decodeInteractionSession(
    {
      ...advancedSessionBase,
      sessionDigest: digest(interactionSessionProjection(advancedSessionBase)),
    },
    digests,
  );
  const advancedOperationBase = {
    ...contextOperationInput,
    expectedSessionVersion: advancedSession.version,
    reservedAt: AFTER,
  } satisfies InteractionOperationProjectionInput;
  const advancedOperation = decodeInteractionOperation(
    {
      ...advancedOperationBase,
      operationDigest: digest(interactionOperationProjection(advancedOperationBase)),
    },
    digests,
  );
  if (advancedOperation.state !== InteractionOperationState.RESERVED) {
    assert.fail('Advanced Session Operation must remain reserved');
  }
  assert.throws(
    () =>
      assertFrontstageContextManifestReservationChain({
        session: advancedSession,
        currentMessage: fixtures.message,
        focus: fixtures.focus,
        manifest: fixtures.contextManifest,
        operation: advancedOperation,
      }),
    /current Session and Message/,
  );

  const oversizedPackageBase = {
    ...fixtures.contextManifest,
    packageByteLength: INTERACTION_MAXIMUM_CONTEXT_PACKAGE_BYTES + 1,
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...oversizedPackageBase,
          manifestDigest: digest(frontstageContextManifestProjection(oversizedPackageBase)),
        },
        digests,
      ),
    /Package byte length is outside its budget/,
  );

  const priorOmissionsRemoved = fixtures.contextManifest.omissions.filter(
    (omission) => omission.sourceClass !== FrontstageContextOmissionSourceClass.PRIOR_MESSAGE,
  );
  const oversizedPriorSelectionBase = {
    ...fixtures.contextManifest,
    selectedPriorMessages: [
      {
        messageRef: {
          id: interactionMessageId('interaction-message_p0-oversized-prior'),
          digest: ONE,
        },
        selectedContentDigest: TWO,
        selectedContentByteLength: INTERACTION_MAXIMUM_CONTEXT_PRIOR_MESSAGE_BYTES + 1,
      },
    ],
    omissions: priorOmissionsRemoved,
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...oversizedPriorSelectionBase,
          manifestDigest: digest(frontstageContextManifestProjection(oversizedPriorSelectionBase)),
        },
        digests,
      ),
    /prior Message content byte length is outside its budget/,
  );

  const tooManyPriorSelectionsBase = {
    ...fixtures.contextManifest,
    selectedPriorMessages: Array.from(
      { length: INTERACTION_MAXIMUM_CONTEXT_PRIOR_MESSAGES + 1 },
      (_, index) => ({
        messageRef: {
          id: interactionMessageId(`interaction-message_p0-prior-${String(index)}`),
          digest: ONE,
        },
        selectedContentDigest: TWO,
        selectedContentByteLength: 1,
      }),
    ),
    omissions: priorOmissionsRemoved,
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...tooManyPriorSelectionsBase,
          manifestDigest: digest(frontstageContextManifestProjection(tooManyPriorSelectionsBase)),
        },
        digests,
      ),
    /too many prior Messages/,
  );

  const tooManyGoalSummariesBase = {
    ...fixtures.contextManifest,
    selectedGoalSummaries: Array.from(
      { length: INTERACTION_MAXIMUM_CONTEXT_GOAL_SUMMARIES + 1 },
      (_, index) => ({
        goalTarget: {
          goalId: goalId(`goal_p0-context-${String(index)}`),
          goalRevision: goalRevision(1),
          workflowId: workflowId(`workflow_p0-context-${String(index)}`),
          workflowVersion: workflowVersion(1),
        },
        projectionDigest: THREE,
      }),
    ),
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...tooManyGoalSummariesBase,
          manifestDigest: digest(frontstageContextManifestProjection(tooManyGoalSummariesBase)),
        },
        digests,
      ),
    /too many Goal summaries/,
  );

  const omittedPriorDigests = Array.from(
    { length: INTERACTION_MAXIMUM_CONTEXT_MANIFEST_ENTRIES - 4 },
    (_, index) => digest({ kind: 'P0_OMITTED_PRIOR_MESSAGE', index }),
  );
  const atEntryBudgetBase = {
    ...fixtures.contextManifest,
    omissions: fixtures.contextManifest.omissions.map((omission) =>
      omission.sourceClass === FrontstageContextOmissionSourceClass.PRIOR_MESSAGE
        ? {
            sourceClass: omission.sourceClass,
            reasonCode: FrontstageContextOmissionReason.SELECTION_LIMIT,
            omittedSourceDigests: omittedPriorDigests,
          }
        : omission,
    ),
  } satisfies FrontstageContextManifestProjectionInput;
  assert.doesNotThrow(() =>
    decodeFrontstageContextManifest(
      {
        ...atEntryBudgetBase,
        manifestDigest: digest(frontstageContextManifestProjection(atEntryBudgetBase)),
      },
      digests,
    ),
  );
  const overEntryBudgetBase = {
    ...atEntryBudgetBase,
    omissions: atEntryBudgetBase.omissions.map((omission) =>
      omission.sourceClass === FrontstageContextOmissionSourceClass.PRIOR_MESSAGE
        ? {
            ...omission,
            omittedSourceDigests: [
              ...omission.omittedSourceDigests,
              digest({ kind: 'P0_OMITTED_PRIOR_MESSAGE', index: omittedPriorDigests.length }),
            ],
          }
        : omission,
    ),
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...overEntryBudgetBase,
          manifestDigest: digest(frontstageContextManifestProjection(overEntryBudgetBase)),
        },
        digests,
      ),
    /Manifest has too many entries/,
  );

  const goalByteBudgetOmissionBase = {
    ...fixtures.contextManifest,
    selectedGoalSummaries: [],
    omissions: [
      ...fixtures.contextManifest.omissions,
      {
        sourceClass: FrontstageContextOmissionSourceClass.GOAL_SUMMARY,
        reasonCode: FrontstageContextOmissionReason.BYTE_BUDGET,
        omittedSourceDigests: [THREE],
      },
    ],
  } satisfies FrontstageContextManifestProjectionInput;
  assert.doesNotThrow(() =>
    decodeFrontstageContextManifest(
      {
        ...goalByteBudgetOmissionBase,
        manifestDigest: digest(frontstageContextManifestProjection(goalByteBudgetOmissionBase)),
      },
      digests,
    ),
  );

  const selectedAndOmittedGoalBase = {
    ...fixtures.contextManifest,
    omissions: [
      ...fixtures.contextManifest.omissions,
      {
        sourceClass: FrontstageContextOmissionSourceClass.GOAL_SUMMARY,
        reasonCode: FrontstageContextOmissionReason.SELECTION_LIMIT,
        omittedSourceDigests: [THREE],
      },
    ],
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...selectedAndOmittedGoalBase,
          manifestDigest: digest(frontstageContextManifestProjection(selectedAndOmittedGoalBase)),
        },
        digests,
      ),
    /selected and omitted together/,
  );

  const questionOmissionsRemoved = fixtures.contextManifest.omissions.filter(
    (omission) =>
      omission.sourceClass !== FrontstageContextOmissionSourceClass.ACTIVE_INTAKE_QUESTION,
  );
  const oversizedQuestionSelectionBase = {
    ...fixtures.contextManifest,
    selectedIntakeQuestion: {
      questionTarget: {
        intakeRunId: intakeRunId('intake_p0-context-question'),
        intakeRunVersion: intakeRunVersion(1),
        clarificationQuestionId: clarificationQuestionId(
          'clarification-question_p0-context-question',
        ),
        questionSpecDigest: ONE,
        questionDigest: TWO,
      },
      projectionDigest: THREE,
      selectedContentDigest: ONE,
      selectedContentByteLength: INTERACTION_MAXIMUM_CONTEXT_ACTIVE_QUESTION_BYTES + 1,
    },
    omissions: questionOmissionsRemoved,
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...oversizedQuestionSelectionBase,
          manifestDigest: digest(
            frontstageContextManifestProjection(oversizedQuestionSelectionBase),
          ),
        },
        digests,
      ),
    /active Intake Question content byte length is outside its budget/,
  );

  const invalidOmissionBase = {
    ...fixtures.contextManifest,
    omissions: [
      ...fixtures.contextManifest.omissions,
      {
        sourceClass: FrontstageContextOmissionSourceClass.FOCUS,
        reasonCode: FrontstageContextOmissionReason.BYTE_BUDGET,
        omittedSourceDigests: [ONE],
      },
    ],
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...invalidOmissionBase,
          manifestDigest: digest(frontstageContextManifestProjection(invalidOmissionBase)),
        },
        digests,
      ),
    /omission reason is invalid/,
  );

  const falseQuestionOmissionBase = {
    ...fixtures.contextManifest,
    omissions: fixtures.contextManifest.omissions.map((omission) =>
      omission.sourceClass === FrontstageContextOmissionSourceClass.ACTIVE_INTAKE_QUESTION
        ? {
            sourceClass: omission.sourceClass,
            reasonCode: FrontstageContextOmissionReason.BYTE_BUDGET,
            omittedSourceDigests: [ONE],
          }
        : omission,
    ),
  } satisfies FrontstageContextManifestProjectionInput;
  const falseQuestionOmissionManifest = decodeFrontstageContextManifest(
    {
      ...falseQuestionOmissionBase,
      manifestDigest: digest(frontstageContextManifestProjection(falseQuestionOmissionBase)),
    },
    digests,
  );
  const falseQuestionOmissionOperationBase = {
    ...contextOperationInput,
    contextManifestRef: {
      id: falseQuestionOmissionManifest.id,
      digest: falseQuestionOmissionManifest.manifestDigest,
    },
  } satisfies InteractionOperationProjectionInput;
  const falseQuestionOmissionOperation = decodeInteractionOperation(
    {
      ...falseQuestionOmissionOperationBase,
      operationDigest: digest(interactionOperationProjection(falseQuestionOmissionOperationBase)),
    },
    digests,
  );
  if (falseQuestionOmissionOperation.state !== InteractionOperationState.RESERVED) {
    assert.fail('False Question Omission Operation must remain reserved');
  }
  assert.throws(
    () =>
      assertFrontstageContextManifestReservationChain({
        session: fixtures.contextSession,
        currentMessage: fixtures.message,
        focus: fixtures.focus,
        manifest: falseQuestionOmissionManifest,
        operation: falseQuestionOmissionOperation,
      }),
    /without Question Focus must record only a not-present Question source/,
  );
});

void test('B1 Route result chain keeps Proposal untrusted and Decision Runtime-owned', () => {
  const fixtures = createFixtures();
  const decisionBase = {
    id: routeDecisionId('route-decision_b1-assistant'),
    schemaVersion: 1 as const,
    sessionId: fixtures.contextSession.id,
    expectedSessionVersion: fixtures.contextSession.version,
    messageRef: fixtures.contextManifestOperation.messageRef,
    focusRef: { id: fixtures.focus.id, digest: fixtures.focus.focusDigest },
    proposalRef: { id: fixtures.proposal.id, digest: fixtures.proposal.proposalDigest },
    source: InteractionRouteDecisionSource.ASSISTANT_PROPOSAL,
    routingPolicy: fixtures.contextSession.routingPolicy,
    allowedRoutes: [InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION],
    reasonTrace: [
      {
        ruleId: 'b1-runtime-route',
        policyDigest: fixtures.contextSession.routingPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [fixtures.message.messageDigest, fixtures.proposal.proposalDigest],
      },
    ],
    outcome: InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION,
    actionKind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
    decidedAt: NOW,
  } satisfies RouteDecisionProjectionInput;
  const decision = decodeRouteDecision(
    { ...decisionBase, decisionDigest: digest(routeDecisionProjection(decisionBase)) },
    digests,
  );
  const operationBase = {
    ...interactionOperationReservationProjection(fixtures.contextManifestOperation),
    version: interactionOperationVersion(2),
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef: { id: decision.id, digest: decision.decisionDigest },
      routeProposalRef: {
        id: fixtures.proposal.id,
        digest: fixtures.proposal.proposalDigest,
      },
    },
    completedAt: NOW,
  } satisfies InteractionOperationProjectionInput;
  const completed = decodeInteractionOperation(
    {
      ...operationBase,
      operationDigest: digest(interactionOperationProjection(operationBase)),
    },
    digests,
  );
  if (completed.state !== InteractionOperationState.COMPLETED) {
    assert.fail('B1 Route fixture must complete');
  }
  const chain = {
    session: fixtures.contextSession,
    currentMessage: fixtures.message,
    focus: fixtures.focus,
    manifest: fixtures.contextManifest,
    currentOperation: fixtures.contextManifestOperation,
    proposal: fixtures.proposal,
    decision,
    nextOperation: completed,
  };
  assert.doesNotThrow(() => assertInteractionRouteResultChainInvariant(chain));

  const deterministicDecisionBase = {
    id: routeDecisionId('route-decision_b1-proposal-free-version'),
    schemaVersion: 1 as const,
    sessionId: fixtures.contextSession.id,
    expectedSessionVersion: fixtures.contextSession.version,
    messageRef: fixtures.contextManifestOperation.messageRef,
    focusRef: { id: fixtures.focus.id, digest: fixtures.focus.focusDigest },
    source: InteractionRouteDecisionSource.READ_ONLY_GOAL_QUERY,
    routingPolicy: fixtures.contextSession.routingPolicy,
    allowedRoutes: [InteractionRouteDecisionOutcome.LIST_GOALS],
    reasonTrace: [
      {
        ruleId: 'b1-proposal-free-version',
        policyDigest: fixtures.contextSession.routingPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [fixtures.message.messageDigest],
      },
    ],
    outcome: InteractionRouteDecisionOutcome.LIST_GOALS,
    decidedAt: NOW,
  } satisfies RouteDecisionProjectionInput;
  const deterministicDecision = decodeRouteDecision(
    {
      ...deterministicDecisionBase,
      decisionDigest: digest(routeDecisionProjection(deterministicDecisionBase)),
    },
    digests,
  );
  const invalidReservedBase = {
    id: interactionOperationId('interaction-operation_b1-proposal-free-version'),
    schemaVersion: 1 as const,
    version: interactionOperationVersion(2),
    sessionId: fixtures.contextSession.id,
    expectedSessionVersion: fixtures.contextSession.version,
    messageRef: fixtures.contextManifestOperation.messageRef,
    operationKind: InteractionOperationKind.ROUTE,
    state: InteractionOperationState.RESERVED,
    reservedAt: NOW,
  } satisfies InteractionOperationProjectionInput;
  const invalidReserved = decodeInteractionOperation(
    {
      ...invalidReservedBase,
      operationDigest: digest(interactionOperationProjection(invalidReservedBase)),
    },
    digests,
  );
  if (invalidReserved.state !== InteractionOperationState.RESERVED) {
    assert.fail('B1 proposal-free invalid reservation fixture must remain reserved');
  }
  const invalidCompletionBase = {
    ...invalidReservedBase,
    version: interactionOperationVersion(3),
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef: {
        id: deterministicDecision.id,
        digest: deterministicDecision.decisionDigest,
      },
    },
    completedAt: NOW,
  } satisfies InteractionOperationProjectionInput;
  const invalidCompletion = decodeInteractionOperation(
    {
      ...invalidCompletionBase,
      operationDigest: digest(interactionOperationProjection(invalidCompletionBase)),
    },
    digests,
  );
  if (invalidCompletion.state !== InteractionOperationState.COMPLETED) {
    assert.fail('B1 proposal-free invalid completion fixture must remain completed');
  }
  assert.throws(
    () =>
      assertInteractionRouteResultAuthorityChainInvariant({
        session: fixtures.contextSession,
        currentMessage: fixtures.message,
        focus: fixtures.focus,
        currentOperation: invalidReserved,
        decision: deterministicDecision,
        nextOperation: invalidCompletion,
      }),
    /initial Interaction Operation must use version 1/u,
  );

  const wrongKindAnswerDecisionBase = {
    id: routeDecisionId('route-decision_b1-wrong-kind-answer'),
    schemaVersion: 1 as const,
    sessionId: fixtures.contextSession.id,
    expectedSessionVersion: fixtures.contextSession.version,
    messageRef: fixtures.contextManifestOperation.messageRef,
    focusRef: { id: fixtures.focus.id, digest: fixtures.focus.focusDigest },
    proposalRef: { id: fixtures.proposal.id, digest: fixtures.proposal.proposalDigest },
    source: InteractionRouteDecisionSource.ASSISTANT_PROPOSAL,
    routingPolicy: fixtures.contextSession.routingPolicy,
    allowedRoutes: [InteractionRouteDecisionOutcome.ANSWER],
    reasonTrace: [
      {
        ruleId: 'b1-runtime-answer-route',
        policyDigest: fixtures.contextSession.routingPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [fixtures.message.messageDigest, fixtures.proposal.proposalDigest],
      },
    ],
    outcome: InteractionRouteDecisionOutcome.ANSWER,
    answerProposalRef: { id: fixtures.proposal.id, digest: fixtures.proposal.proposalDigest },
    decidedAt: NOW,
  } satisfies RouteDecisionProjectionInput;
  const wrongKindAnswerDecision = decodeRouteDecision(
    {
      ...wrongKindAnswerDecisionBase,
      decisionDigest: digest(routeDecisionProjection(wrongKindAnswerDecisionBase)),
    },
    digests,
  );
  const wrongKindAnswerOperationBase = {
    ...interactionOperationReservationProjection(fixtures.contextManifestOperation),
    version: interactionOperationVersion(2),
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef: {
        id: wrongKindAnswerDecision.id,
        digest: wrongKindAnswerDecision.decisionDigest,
      },
      routeProposalRef: {
        id: fixtures.proposal.id,
        digest: fixtures.proposal.proposalDigest,
      },
    },
    completedAt: NOW,
  } satisfies InteractionOperationProjectionInput;
  const wrongKindAnswerOperation = decodeInteractionOperation(
    {
      ...wrongKindAnswerOperationBase,
      operationDigest: digest(interactionOperationProjection(wrongKindAnswerOperationBase)),
    },
    digests,
  );
  if (wrongKindAnswerOperation.state !== InteractionOperationState.COMPLETED) {
    assert.fail('Wrong-kind B1 Answer fixture must complete');
  }
  assert.throws(
    () =>
      assertInteractionRouteResultChainInvariant({
        ...chain,
        decision: wrongKindAnswerDecision,
        nextOperation: wrongKindAnswerOperation,
      }),
    /exact Manifest, Proposal, Decision, and result/u,
  );

  const { sessionDigest, ...sessionProjection } = fixtures.contextSession;
  void sessionDigest;
  const advancedSessionBase = {
    ...sessionProjection,
    version: interactionSessionVersion(fixtures.contextSession.version + 1),
    updatedAt: LATER,
  } satisfies InteractionSessionProjectionInput;
  const advancedSession = decodeInteractionSession(
    {
      ...advancedSessionBase,
      sessionDigest: digest(interactionSessionProjection(advancedSessionBase)),
    },
    digests,
  );
  assert.doesNotThrow(() =>
    assertInteractionRouteResultAuthorityChainInvariant({ ...chain, session: advancedSession }),
  );
  assert.throws(
    () => assertInteractionRouteResultChainInvariant({ ...chain, session: advancedSession }),
    /exact current Session, Message, and Focus|current Session and Message/u,
  );

  const substitutedProposalBase = {
    ...fixtures.proposal,
    assistantAdapter: {
      ...fixtures.proposal.assistantAdapter,
      digest: ZERO,
    },
  } satisfies RouteProposalProjectionInput;
  const substitutedProposal = decodeRouteProposal(
    {
      ...substitutedProposalBase,
      proposalDigest: digest(routeProposalProjection(substitutedProposalBase)),
    },
    digests,
  );
  const substitutedProposalDecisionBase = {
    ...decisionBase,
    proposalRef: { id: substitutedProposal.id, digest: substitutedProposal.proposalDigest },
  } satisfies RouteDecisionProjectionInput;
  const substitutedProposalDecision = decodeRouteDecision(
    {
      ...substitutedProposalDecisionBase,
      decisionDigest: digest(routeDecisionProjection(substitutedProposalDecisionBase)),
    },
    digests,
  );
  const substitutedProposalResultBase = {
    ...operationBase,
    result: {
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef: {
        id: substitutedProposalDecision.id,
        digest: substitutedProposalDecision.decisionDigest,
      },
      routeProposalRef: {
        id: substitutedProposal.id,
        digest: substitutedProposal.proposalDigest,
      },
    },
  } satisfies InteractionOperationProjectionInput;
  const substitutedProposalResult = decodeInteractionOperation(
    {
      ...substitutedProposalResultBase,
      operationDigest: digest(interactionOperationProjection(substitutedProposalResultBase)),
    },
    digests,
  );
  if (substitutedProposalResult.state !== InteractionOperationState.COMPLETED) {
    assert.fail('Substituted B1 Proposal result fixture must remain completed');
  }
  assert.throws(
    () =>
      assertInteractionRouteResultAuthorityChainInvariant({
        ...chain,
        proposal: substitutedProposal,
        decision: substitutedProposalDecision,
        nextOperation: substitutedProposalResult,
      }),
    /exact Manifest, Proposal, Decision, and result/u,
  );

  assert.throws(
    () =>
      assertInteractionRouteResultAuthorityChainInvariant({
        session: chain.session,
        currentMessage: chain.currentMessage,
        focus: chain.focus,
        currentOperation: chain.currentOperation,
        proposal: chain.proposal,
        decision: chain.decision,
        nextOperation: chain.nextOperation,
      }),
    /Assistant bindings, Manifest, Proposal, Decision, and result must agree/u,
  );

  const { decisionDigest: ignoredDecisionDigest, ...decisionProjection } = decision;
  void ignoredDecisionDigest;
  const substitutedDecisionBase = {
    ...decisionProjection,
    id: routeDecisionId('route-decision_b1-substituted'),
  } satisfies RouteDecisionProjectionInput;
  const substitutedDecision = decodeRouteDecision(
    {
      ...substitutedDecisionBase,
      decisionDigest: digest(routeDecisionProjection(substitutedDecisionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionRouteResultAuthorityChainInvariant({
        ...chain,
        decision: substitutedDecision,
      }),
    /exact current Session, Message, Decision, and Operation/u,
  );

  const substitutedResultBase = {
    ...operationBase,
    result: {
      ...operationBase.result,
      routeDecisionRef: { id: decision.id, digest: ZERO },
    },
  } satisfies InteractionOperationProjectionInput;
  const substitutedResult = decodeInteractionOperation(
    {
      ...substitutedResultBase,
      operationDigest: digest(interactionOperationProjection(substitutedResultBase)),
    },
    digests,
  );
  if (substitutedResult.state !== InteractionOperationState.COMPLETED) {
    assert.fail('Substituted B1 Route result fixture must remain completed');
  }
  assert.throws(
    () =>
      assertInteractionRouteResultAuthorityChainInvariant({
        ...chain,
        nextOperation: substitutedResult,
      }),
    /exact current Session, Message, Decision, and Operation/u,
  );

  const crossSessionBase = {
    ...sessionProjection,
    id: interactionSessionId('interaction-session_b1-cross-session'),
  } satisfies InteractionSessionProjectionInput;
  const crossSession = decodeInteractionSession(
    {
      ...crossSessionBase,
      sessionDigest: digest(interactionSessionProjection(crossSessionBase)),
    },
    digests,
  );
  assert.throws(
    () => assertInteractionRouteResultAuthorityChainInvariant({ ...chain, session: crossSession }),
    /exact current Session, Message, Decision, and Operation/u,
  );
});

void test('P0 clarification Handoff preserves existing M2.5 Question authority', () => {
  const fixtures = createFixtures();
  const questionTarget = {
    intakeRunId: intakeRunId('intake_p0-clarification'),
    intakeRunVersion: intakeRunVersion(2),
    clarificationQuestionId: clarificationQuestionId('clarification-question_p0-clarification'),
    questionSpecDigest: ONE,
    questionDigest: TWO,
  };
  const focusBase = {
    id: focusBindingId('focus-binding_p0-clarification'),
    schemaVersion: 1 as const,
    sessionId: fixtures.session.id,
    basedOnSessionVersion: fixtures.session.version,
    kind: InteractionFocusKind.INTAKE_QUESTION,
    questionTarget,
    createdAt: NOW,
  } satisfies FocusBindingProjectionInput;
  const focus = decodeFocusBinding(
    { ...focusBase, focusDigest: digest(focusBindingProjection(focusBase)) },
    digests,
  );
  const { sessionDigest: priorSessionDigest, ...sessionInput } = fixtures.session;
  void priorSessionDigest;
  const sessionBase = {
    ...sessionInput,
    version: interactionSessionVersion(2),
    currentFocusRef: { id: focus.id, digest: focus.focusDigest },
  } satisfies InteractionSessionProjectionInput;
  const session = decodeInteractionSession(
    { ...sessionBase, sessionDigest: digest(interactionSessionProjection(sessionBase)) },
    digests,
  );
  const questionManifestBase = {
    ...fixtures.contextManifest,
    id: frontstageContextManifestId('frontstage-context-manifest_p0-question'),
    operationId: interactionOperationId('interaction-operation_p0-question-context'),
    currentMessageRef: { id: fixtures.message.id, digest: fixtures.message.messageDigest },
    currentMessageContentDigest: fixtures.message.contentDigest,
    currentMessageContentByteLength: fixtures.message.contentByteLength,
    focusRef: { id: focus.id, digest: focus.focusDigest },
    selectedGoalSummaries: [],
    selectedIntakeQuestion: {
      questionTarget,
      projectionDigest: THREE,
      selectedContentDigest: TWO,
      selectedContentByteLength: 64,
    },
    omissions: [
      {
        sourceClass: FrontstageContextOmissionSourceClass.PRIOR_MESSAGE,
        reasonCode: FrontstageContextOmissionReason.NOT_PRESENT,
        omittedSourceDigests: [],
      },
      {
        sourceClass: FrontstageContextOmissionSourceClass.GOAL_SUMMARY,
        reasonCode: FrontstageContextOmissionReason.NOT_PRESENT,
        omittedSourceDigests: [],
      },
    ],
  } satisfies FrontstageContextManifestProjectionInput;
  const questionManifest = decodeFrontstageContextManifest(
    {
      ...questionManifestBase,
      manifestDigest: digest(frontstageContextManifestProjection(questionManifestBase)),
    },
    digests,
  );
  const questionOperationBase = {
    id: questionManifest.operationId,
    schemaVersion: 1 as const,
    version: questionManifest.reservedOperationVersion,
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: questionManifest.currentMessageRef,
    operationKind: InteractionOperationKind.ROUTE,
    contextManifestRef: { id: questionManifest.id, digest: questionManifest.manifestDigest },
    assistantProfile: questionManifest.assistantProfile,
    state: InteractionOperationState.RESERVED,
    reservedAt: LATER,
  } satisfies InteractionOperationProjectionInput;
  const questionOperation = decodeInteractionOperation(
    {
      ...questionOperationBase,
      operationDigest: digest(interactionOperationProjection(questionOperationBase)),
    },
    digests,
  );
  if (questionOperation.state !== InteractionOperationState.RESERVED) {
    assert.fail('Question Context Operation must remain reserved');
  }
  assert.doesNotThrow(() =>
    assertFrontstageContextManifestReservationChain({
      session,
      currentMessage: fixtures.message,
      focus,
      manifest: questionManifest,
      operation: questionOperation,
    }),
  );
  const selectedAndOmittedQuestionBase = {
    ...questionManifest,
    omissions: [
      ...questionManifest.omissions,
      {
        sourceClass: FrontstageContextOmissionSourceClass.ACTIVE_INTAKE_QUESTION,
        reasonCode: FrontstageContextOmissionReason.BYTE_BUDGET,
        omittedSourceDigests: [questionTarget.questionDigest],
      },
    ],
  } satisfies FrontstageContextManifestProjectionInput;
  assert.throws(
    () =>
      decodeFrontstageContextManifest(
        {
          ...selectedAndOmittedQuestionBase,
          manifestDigest: digest(
            frontstageContextManifestProjection(selectedAndOmittedQuestionBase),
          ),
        },
        digests,
      ),
    /selected Intake Question cannot also be omitted/,
  );

  const { selectedIntakeQuestion: selectedQuestion, ...questionManifestWithoutSelection } =
    questionManifestBase;
  void selectedQuestion;
  const omittedQuestionManifestBase = {
    ...questionManifestWithoutSelection,
    omissions: [
      ...questionManifestBase.omissions,
      {
        sourceClass: FrontstageContextOmissionSourceClass.ACTIVE_INTAKE_QUESTION,
        reasonCode: FrontstageContextOmissionReason.BYTE_BUDGET,
        omittedSourceDigests: [questionTarget.questionDigest],
      },
    ],
  } satisfies FrontstageContextManifestProjectionInput;
  const omittedQuestionManifest = decodeFrontstageContextManifest(
    {
      ...omittedQuestionManifestBase,
      manifestDigest: digest(frontstageContextManifestProjection(omittedQuestionManifestBase)),
    },
    digests,
  );
  const omittedQuestionOperationBase = {
    ...questionOperationBase,
    contextManifestRef: {
      id: omittedQuestionManifest.id,
      digest: omittedQuestionManifest.manifestDigest,
    },
  } satisfies InteractionOperationProjectionInput;
  const omittedQuestionOperation = decodeInteractionOperation(
    {
      ...omittedQuestionOperationBase,
      operationDigest: digest(interactionOperationProjection(omittedQuestionOperationBase)),
    },
    digests,
  );
  if (omittedQuestionOperation.state !== InteractionOperationState.RESERVED) {
    assert.fail('Omitted Question Operation must remain reserved');
  }
  assert.doesNotThrow(() =>
    assertFrontstageContextManifestReservationChain({
      session,
      currentMessage: fixtures.message,
      focus,
      manifest: omittedQuestionManifest,
      operation: omittedQuestionOperation,
    }),
  );
  const handoffBase = {
    id: interactionMessageHandoffId('interaction-message-handoff_p0-clarification'),
    schemaVersion: 1 as const,
    kind: InteractionMessageHandoffKind.INTAKE_CLARIFICATION,
    sessionId: session.id,
    messageRef: { id: fixtures.message.id, digest: fixtures.message.messageDigest },
    focusRef: { id: focus.id, digest: focus.focusDigest },
    questionTarget,
    admittedUserContent: fixtures.message.content,
    admittedContentDigest: fixtures.message.contentDigest,
    intakeCommandId: commandId('command_p0-clarification'),
    canonicalCommandInputDigest: THREE,
    createdAt: LATER,
  } satisfies InteractionMessageHandoffProjectionInput;
  const handoff = decodeInteractionMessageHandoff(
    { ...handoffBase, handoffDigest: digest(interactionMessageHandoffProjection(handoffBase)) },
    digests,
  );
  if (handoff.kind !== InteractionMessageHandoffKind.INTAKE_CLARIFICATION) {
    assert.fail('Clarification Handoff must retain its discriminant');
  }
  assert.equal(
    handoff.handoffDigest,
    'sha256:4a05c559f8f4b8dcf319f96c5c44e0aaf914acf927fb3e525b33ff4e751e198b',
  );
  assertEveryTopLevelFieldIsBound(
    interactionMessageHandoffProjection(handoff),
    handoff.handoffDigest,
  );
  assert.doesNotThrow(() =>
    assertInteractionClarificationHandoffChainInvariant({
      session,
      message: fixtures.message,
      focus,
      handoff,
    }),
  );
  assert.throws(
    () =>
      decodeInteractionMessageHandoff(
        { ...handoff, pendingActionRef: fixtures.resolution.pendingActionRef },
        digests,
      ),
    /unrecognized key/i,
  );
  assert.throws(
    () => decodeInteractionMessageHandoff({ ...handoff, kind: 'UNKNOWN_HANDOFF_KIND' }, digests),
    /invalid discriminator/i,
  );
  const substitutedQuestionHandoffBase = {
    ...handoffBase,
    questionTarget: { ...questionTarget, questionDigest: THREE },
  } satisfies InteractionMessageHandoffProjectionInput;
  const substitutedQuestionHandoff = decodeInteractionMessageHandoff(
    {
      ...substitutedQuestionHandoffBase,
      handoffDigest: digest(interactionMessageHandoffProjection(substitutedQuestionHandoffBase)),
    },
    digests,
  );
  if (substitutedQuestionHandoff.kind !== InteractionMessageHandoffKind.INTAKE_CLARIFICATION) {
    assert.fail('Substituted Question Handoff must remain a clarification member');
  }
  assert.throws(
    () =>
      assertInteractionClarificationHandoffChainInvariant({
        session,
        message: fixtures.message,
        focus,
        handoff: substitutedQuestionHandoff,
      }),
    /exact Session, Message, Focus, and Question/,
  );

  const advancedSessionBase = {
    ...sessionBase,
    version: interactionSessionVersion(3),
    updatedAt: MIDDLE,
  } satisfies InteractionSessionProjectionInput;
  const advancedSession = decodeInteractionSession(
    {
      ...advancedSessionBase,
      sessionDigest: digest(interactionSessionProjection(advancedSessionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionClarificationHandoffChainInvariant({
        session: advancedSession,
        message: fixtures.message,
        focus,
        handoff,
      }),
    /current Session and Message/,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: fixtures.decision,
        pendingAction: fixtures.pendingAction,
        resolution: fixtures.resolution,
        reservation: fixtures.reservation,
        handoff: handoff as never,
      }),
    /authorized Intake Action handoff/,
  );
});

void test('B2 Pending Action persistence prefix and result owners stay exact', () => {
  const fixtures = createFixtures();
  const currentDecisionBase = {
    ...fixtures.decision,
    id: routeDecisionId('route-decision_b2-pending-action'),
    expectedSessionVersion: fixtures.contextSession.version,
  } satisfies RouteDecisionProjectionInput;
  const currentDecision = decodeRouteDecision(
    {
      ...currentDecisionBase,
      decisionDigest: digest(routeDecisionProjection(currentDecisionBase)),
    },
    digests,
  );
  const currentActionBase = {
    ...fixtures.pendingAction,
    id: pendingActionId('pending-action_b2-persistence'),
    routeDecisionRef: { id: currentDecision.id, digest: currentDecision.decisionDigest },
    preallocatedCommandId: commandId('command_b2-persistence'),
  } satisfies PendingActionProjectionInput;
  const currentAction = decodePendingAction(
    {
      ...currentActionBase,
      pendingActionDigest: digest(pendingActionProjection(currentActionBase)),
    },
    digests,
  );
  const actionAuthority = {
    session: fixtures.contextSession,
    originatingMessage: fixtures.message,
    focus: fixtures.focus,
    routeDecision: currentDecision,
    pendingAction: currentAction,
  };
  assert.doesNotThrow(() => assertPendingActionCreationChainInvariant(actionAuthority));

  const advancedSessionBase = {
    ...fixtures.contextSession,
    version: interactionSessionVersion(3),
    updatedAt: MIDDLE,
  } satisfies InteractionSessionProjectionInput;
  const advancedSession = decodeInteractionSession(
    {
      ...advancedSessionBase,
      sessionDigest: digest(interactionSessionProjection(advancedSessionBase)),
    },
    digests,
  );
  assert.doesNotThrow(() =>
    assertPendingActionAuthorityChainInvariant({ ...actionAuthority, session: advancedSession }),
  );
  assert.throws(
    () =>
      assertPendingActionCreationChainInvariant({
        ...actionAuthority,
        session: advancedSession,
      }),
    /exact current Session, Message, and Focus|current Session and Message/,
  );

  const substitutedProjectSessionBase = {
    ...fixtures.contextSession,
    projectRef: {
      ...fixtures.contextSession.projectRef,
      identityDigest: TWO,
    },
  } satisfies InteractionSessionProjectionInput;
  const substitutedProjectSession = decodeInteractionSession(
    {
      ...substitutedProjectSessionBase,
      sessionDigest: digest(interactionSessionProjection(substitutedProjectSessionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertPendingActionAuthorityChainInvariant({
        ...actionAuthority,
        session: substitutedProjectSession,
      }),
    /exact retained Session and installed policies/,
  );

  const directResolutionBase = {
    ...fixtures.resolution,
    id: pendingActionResolutionId('pending-action-resolution_b2-persistence'),
    pendingActionRef: { id: currentAction.id, digest: currentAction.pendingActionDigest },
  } satisfies PendingActionResolutionProjectionInput;
  const directResolution = decodePendingActionResolution(
    {
      ...directResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(directResolutionBase)),
    },
    digests,
  );
  const directReservationBase = {
    ...fixtures.reservation,
    id: interactionActionReservationId('interaction-action-reservation_b2-persistence'),
    pendingActionRef: directResolution.pendingActionRef,
    resolutionRef: { id: directResolution.id, digest: directResolution.resolutionDigest },
    commandId: currentAction.preallocatedCommandId,
  } satisfies InteractionActionReservationProjectionInput;
  const directReservation = decodeInteractionActionReservation(
    {
      ...directReservationBase,
      reservationDigest: digest(interactionActionReservationProjection(directReservationBase)),
    },
    digests,
  );
  const directPersistenceChain = {
    originatingMessage: fixtures.message,
    routeDecision: currentDecision,
    pendingAction: currentAction,
    resolution: directResolution,
  };
  assert.throws(
    () => assertInteractionActionPersistenceChainInvariant(directPersistenceChain),
    /authorized Resolution requires its exact Action Reservation/,
  );
  assert.doesNotThrow(() =>
    assertInteractionActionPersistenceChainInvariant({
      ...directPersistenceChain,
      reservation: directReservation,
    }),
  );

  const proposalOperationBase = {
    id: interactionOperationId('interaction-operation_b2-action-proposal'),
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId: currentAction.sessionId,
    expectedSessionVersion: currentDecision.expectedSessionVersion,
    messageRef: currentAction.originatingMessageRef,
    operationKind: InteractionOperationKind.ACTION_PROPOSAL,
    state: InteractionOperationState.RESERVED,
    reservedAt: NOW,
  } satisfies InteractionOperationProjectionInput;
  const proposalOperation = decodeInteractionOperation(
    {
      ...proposalOperationBase,
      operationDigest: digest(interactionOperationProjection(proposalOperationBase)),
    },
    digests,
  );
  if (proposalOperation.state !== InteractionOperationState.RESERVED) {
    assert.fail('B2 Action Proposal Operation fixture must remain reserved');
  }
  const completedProposalOperationBase = {
    ...proposalOperation,
    version: interactionOperationVersion(2),
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.PENDING_ACTION_RECORDED,
      pendingActionRef: { id: currentAction.id, digest: currentAction.pendingActionDigest },
    },
    completedAt: NOW,
  } satisfies InteractionOperationProjectionInput;
  const completedProposalOperation = decodeInteractionOperation(
    {
      ...completedProposalOperationBase,
      operationDigest: digest(interactionOperationProjection(completedProposalOperationBase)),
    },
    digests,
  );
  if (completedProposalOperation.state !== InteractionOperationState.COMPLETED) {
    assert.fail('B2 Action Proposal Operation fixture must complete');
  }
  assert.doesNotThrow(() =>
    assertPendingActionOperationResultInvariant({
      pendingAction: currentAction,
      currentOperation: proposalOperation,
      nextOperation: completedProposalOperation,
    }),
  );
  const directProposalChain = {
    ...actionAuthority,
    currentOperation: proposalOperation,
    nextOperation: completedProposalOperation,
  };
  assert.throws(
    () => assertPendingActionProposalCommitChainInvariant(directProposalChain),
    /direct Action Proposal requires its exact Resolution and Reservation/,
  );
  assert.doesNotThrow(() =>
    assertPendingActionProposalCommitChainInvariant({
      ...directProposalChain,
      resolution: directResolution,
      reservation: directReservation,
    }),
  );
  assert.doesNotThrow(() =>
    assertPendingActionProposalAuthorityChainInvariant({
      ...directProposalChain,
      session: advancedSession,
      resolution: directResolution,
      reservation: directReservation,
    }),
  );
  const lateDirectReservationBase = {
    id: interactionActionReservationId('interaction-action-reservation_b2-late'),
    schemaVersion: 1 as const,
    pendingActionRef: directResolution.pendingActionRef,
    resolutionRef: { id: directResolution.id, digest: directResolution.resolutionDigest },
    publicCapability: currentAction.publicCapability,
    commandId: currentAction.preallocatedCommandId,
    canonicalCommandInputDigest: currentAction.canonicalCommandInputDigest,
    reservedAt: MIDDLE,
  } satisfies InteractionActionReservationProjectionInput;
  const lateDirectReservation = decodeInteractionActionReservation(
    {
      ...lateDirectReservationBase,
      reservationDigest: digest(interactionActionReservationProjection(lateDirectReservationBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertPendingActionProposalCommitChainInvariant({
        ...directProposalChain,
        resolution: directResolution,
        reservation: lateDirectReservation,
      }),
    /cannot follow its Action Proposal completion/,
  );
  const substitutedProposalResultBase = {
    ...completedProposalOperation,
    result: {
      kind: InteractionOperationResultKind.PENDING_ACTION_RECORDED,
      pendingActionRef: { id: currentAction.id, digest: THREE },
    },
  } satisfies InteractionOperationProjectionInput;
  const substitutedProposalResult = decodeInteractionOperation(
    {
      ...substitutedProposalResultBase,
      operationDigest: digest(interactionOperationProjection(substitutedProposalResultBase)),
    },
    digests,
  );
  if (substitutedProposalResult.state !== InteractionOperationState.COMPLETED) {
    assert.fail('Substituted B2 Action Proposal Operation must remain completed');
  }
  assert.throws(
    () =>
      assertPendingActionOperationResultInvariant({
        pendingAction: currentAction,
        currentOperation: proposalOperation,
        nextOperation: substitutedProposalResult,
      }),
    /exact Pending Action result/,
  );

  const separateActionBase = {
    ...currentAction,
    id: pendingActionId('pending-action_b2-separate-response'),
    preallocatedCommandId: commandId('command_b2-separate-response'),
    confirmationRequirement: InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  } satisfies PendingActionProjectionInput;
  const separateAction = decodePendingAction(
    {
      ...separateActionBase,
      pendingActionDigest: digest(pendingActionProjection(separateActionBase)),
    },
    digests,
  );
  const completedSeparateProposalOperationBase = {
    ...completedProposalOperation,
    result: {
      kind: InteractionOperationResultKind.PENDING_ACTION_RECORDED,
      pendingActionRef: { id: separateAction.id, digest: separateAction.pendingActionDigest },
    },
  } satisfies InteractionOperationProjectionInput;
  const completedSeparateProposalOperation = decodeInteractionOperation(
    {
      ...completedSeparateProposalOperationBase,
      operationDigest: digest(
        interactionOperationProjection(completedSeparateProposalOperationBase),
      ),
    },
    digests,
  );
  if (completedSeparateProposalOperation.state !== InteractionOperationState.COMPLETED) {
    assert.fail('Separate B2 Action Proposal Operation fixture must complete');
  }
  const separateProposalChain = {
    ...actionAuthority,
    pendingAction: separateAction,
    currentOperation: proposalOperation,
    nextOperation: completedSeparateProposalOperation,
  };
  assert.doesNotThrow(() => assertPendingActionProposalCommitChainInvariant(separateProposalChain));
  const sameMessageDeclineBase = {
    id: pendingActionResolutionId('pending-action-resolution_b2-same-message'),
    schemaVersion: 1 as const,
    pendingActionRef: { id: separateAction.id, digest: separateAction.pendingActionDigest },
    confirmationPolicy: separateAction.confirmationPolicy,
    disposition: PendingActionResolutionDisposition.DECLINED,
    responseMessageRef: separateAction.originatingMessageRef,
    resolvedAt: NOW,
  } satisfies PendingActionResolutionProjectionInput;
  const sameMessageDecline = decodePendingActionResolution(
    {
      ...sameMessageDeclineBase,
      resolutionDigest: digest(pendingActionResolutionProjection(sameMessageDeclineBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertPendingActionProposalCommitChainInvariant({
        ...separateProposalChain,
        resolution: sameMessageDecline,
      }),
    /separate Action Proposal must remain unresolved/,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        resolutionMessage: fixtures.message,
        routeDecision: currentDecision,
        pendingAction: separateAction,
        resolution: sameMessageDecline,
      }),
    /response must differ from its originating message/,
  );

  const responseContent = '不确认';
  const responseMessageBase = {
    ...fixtures.message,
    id: interactionMessageId('interaction-message_b2-decline'),
    content: responseContent,
    contentDigest: digests.digestUtf8(responseContent),
    contentByteLength: Buffer.byteLength(responseContent, 'utf8'),
    createdAt: MIDDLE,
  } satisfies InteractionMessageProjectionInput;
  const responseMessage = decodeInteractionMessage(
    {
      ...responseMessageBase,
      messageDigest: digest(interactionMessageProjection(responseMessageBase)),
    },
    digests,
  );
  const declinedResolutionBase = {
    id: pendingActionResolutionId('pending-action-resolution_b2-decline'),
    schemaVersion: 1 as const,
    pendingActionRef: sameMessageDecline.pendingActionRef,
    confirmationPolicy: sameMessageDecline.confirmationPolicy,
    disposition: PendingActionResolutionDisposition.DECLINED,
    responseMessageRef: { id: responseMessage.id, digest: responseMessage.messageDigest },
    resolvedAt: MIDDLE,
  } satisfies PendingActionResolutionProjectionInput;
  const declinedResolution = decodePendingActionResolution(
    {
      ...declinedResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(declinedResolutionBase)),
    },
    digests,
  );
  assert.doesNotThrow(() =>
    assertInteractionActionPersistenceChainInvariant({
      originatingMessage: fixtures.message,
      resolutionMessage: responseMessage,
      routeDecision: currentDecision,
      pendingAction: separateAction,
      resolution: declinedResolution,
    }),
  );

  const confirmationOperationBase = {
    id: interactionOperationId('interaction-operation_b2-action-confirmation'),
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId: separateAction.sessionId,
    expectedSessionVersion: interactionSessionVersion(3),
    messageRef: { id: responseMessage.id, digest: responseMessage.messageDigest },
    operationKind: InteractionOperationKind.ACTION_CONFIRMATION,
    state: InteractionOperationState.RESERVED,
    reservedAt: MIDDLE,
  } satisfies InteractionOperationProjectionInput;
  const confirmationOperation = decodeInteractionOperation(
    {
      ...confirmationOperationBase,
      operationDigest: digest(interactionOperationProjection(confirmationOperationBase)),
    },
    digests,
  );
  if (confirmationOperation.state !== InteractionOperationState.RESERVED) {
    assert.fail('B2 Action Confirmation Operation fixture must remain reserved');
  }
  const completedConfirmationOperationBase = {
    ...confirmationOperation,
    version: interactionOperationVersion(2),
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ACTION_RESOLUTION_RECORDED,
      resolutionRef: {
        id: declinedResolution.id,
        digest: declinedResolution.resolutionDigest,
      },
    },
    completedAt: MIDDLE,
  } satisfies InteractionOperationProjectionInput;
  const completedConfirmationOperation = decodeInteractionOperation(
    {
      ...completedConfirmationOperationBase,
      operationDigest: digest(interactionOperationProjection(completedConfirmationOperationBase)),
    },
    digests,
  );
  if (completedConfirmationOperation.state !== InteractionOperationState.COMPLETED) {
    assert.fail('B2 Action Confirmation Operation fixture must complete');
  }
  assert.doesNotThrow(() =>
    assertPendingActionResolutionOperationResultInvariant({
      pendingAction: separateAction,
      resolution: declinedResolution,
      currentOperation: confirmationOperation,
      nextOperation: completedConfirmationOperation,
    }),
  );

  const confirmedContent = '确认';
  const confirmedMessageBase = {
    ...fixtures.message,
    id: interactionMessageId('interaction-message_b2-confirmed'),
    content: confirmedContent,
    contentDigest: digests.digestUtf8(confirmedContent),
    contentByteLength: Buffer.byteLength(confirmedContent, 'utf8'),
    createdAt: MIDDLE,
  } satisfies InteractionMessageProjectionInput;
  const confirmedMessage = decodeInteractionMessage(
    {
      ...confirmedMessageBase,
      messageDigest: digest(interactionMessageProjection(confirmedMessageBase)),
    },
    digests,
  );
  const confirmedResolutionBase = {
    id: pendingActionResolutionId('pending-action-resolution_b2-confirmed'),
    schemaVersion: 1 as const,
    pendingActionRef: { id: separateAction.id, digest: separateAction.pendingActionDigest },
    confirmationPolicy: separateAction.confirmationPolicy,
    disposition: PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
    originatingMessageRef: separateAction.originatingMessageRef,
    authorizingMessageRef: { id: confirmedMessage.id, digest: confirmedMessage.messageDigest },
    resolvedAt: MIDDLE,
  } satisfies PendingActionResolutionProjectionInput;
  const confirmedResolution = decodePendingActionResolution(
    {
      ...confirmedResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(confirmedResolutionBase)),
    },
    digests,
  );
  const confirmedReservationBase = {
    id: interactionActionReservationId('interaction-action-reservation_b2-confirmed'),
    schemaVersion: 1 as const,
    pendingActionRef: confirmedResolution.pendingActionRef,
    resolutionRef: { id: confirmedResolution.id, digest: confirmedResolution.resolutionDigest },
    publicCapability: separateAction.publicCapability,
    commandId: separateAction.preallocatedCommandId,
    canonicalCommandInputDigest: separateAction.canonicalCommandInputDigest,
    reservedAt: MIDDLE,
  } satisfies InteractionActionReservationProjectionInput;
  const confirmedReservation = decodeInteractionActionReservation(
    {
      ...confirmedReservationBase,
      reservationDigest: digest(interactionActionReservationProjection(confirmedReservationBase)),
    },
    digests,
  );
  assert.doesNotThrow(() =>
    assertInteractionActionPersistenceChainInvariant({
      originatingMessage: fixtures.message,
      resolutionMessage: confirmedMessage,
      routeDecision: currentDecision,
      pendingAction: separateAction,
      resolution: confirmedResolution,
      reservation: confirmedReservation,
    }),
  );
  const confirmedOperationBase = {
    ...confirmationOperation,
    id: interactionOperationId('interaction-operation_b2-confirmed'),
    messageRef: { id: confirmedMessage.id, digest: confirmedMessage.messageDigest },
  } satisfies InteractionOperationProjectionInput;
  const confirmedOperation = decodeInteractionOperation(
    {
      ...confirmedOperationBase,
      operationDigest: digest(interactionOperationProjection(confirmedOperationBase)),
    },
    digests,
  );
  if (confirmedOperation.state !== InteractionOperationState.RESERVED) {
    assert.fail('Confirmed B2 Action Confirmation Operation fixture must remain reserved');
  }
  const completedConfirmedOperationBase = {
    ...confirmedOperation,
    version: interactionOperationVersion(2),
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ACTION_RESOLUTION_RECORDED,
      resolutionRef: {
        id: confirmedResolution.id,
        digest: confirmedResolution.resolutionDigest,
      },
      reservationRef: {
        id: confirmedReservation.id,
        digest: confirmedReservation.reservationDigest,
      },
    },
    completedAt: MIDDLE,
  } satisfies InteractionOperationProjectionInput;
  const completedConfirmedOperation = decodeInteractionOperation(
    {
      ...completedConfirmedOperationBase,
      operationDigest: digest(interactionOperationProjection(completedConfirmedOperationBase)),
    },
    digests,
  );
  if (completedConfirmedOperation.state !== InteractionOperationState.COMPLETED) {
    assert.fail('Confirmed B2 Action Confirmation Operation fixture must complete');
  }
  assert.throws(
    () =>
      assertPendingActionResolutionOperationResultInvariant({
        pendingAction: separateAction,
        resolution: confirmedResolution,
        currentOperation: confirmedOperation,
        nextOperation: completedConfirmedOperation,
      }),
    /exact Resolution and Reservation result/,
  );
  assert.doesNotThrow(() =>
    assertPendingActionResolutionOperationResultInvariant({
      pendingAction: separateAction,
      resolution: confirmedResolution,
      reservation: confirmedReservation,
      currentOperation: confirmedOperation,
      nextOperation: completedConfirmedOperation,
    }),
  );

  const expiredResolutionBase = {
    id: pendingActionResolutionId('pending-action-resolution_b2-expired'),
    schemaVersion: 1 as const,
    pendingActionRef: { id: separateAction.id, digest: separateAction.pendingActionDigest },
    confirmationPolicy: separateAction.confirmationPolicy,
    disposition: PendingActionResolutionDisposition.EXPIRED,
    resolvedAt: LATER,
  } satisfies PendingActionResolutionProjectionInput;
  const expiredResolution = decodePendingActionResolution(
    {
      ...expiredResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(expiredResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertPendingActionResolutionOperationResultInvariant({
        pendingAction: separateAction,
        resolution: expiredResolution,
        currentOperation: confirmationOperation,
        nextOperation: completedConfirmationOperation,
      }),
    /response-free Pending Action Resolution has no Action Confirmation Operation/,
  );
});

void test('action authority provenance, confirmation, and causal ordering', () => {
  const fixtures = createFixtures();
  const assistantRoute = decideM26InteractionRoute(
    {
      kind: InteractionRoutingInputKind.ASSISTANT_PROPOSAL,
      sessionId: fixtures.session.id,
      sessionDigest: fixtures.session.sessionDigest,
      messageId: fixtures.message.id,
      messageDigest: fixtures.message.messageDigest,
      focusDigest: fixtures.focus.focusDigest,
      proposal: fixtures.proposal,
    },
    fixtures.policies,
    digests,
  );
  if (assistantRoute.decision.outcome !== InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION) {
    assert.fail('Assistant fixture must propose an Intake Action');
  }
  const assistantDecisionBase = {
    ...fixtures.decision,
    proposalRef: { id: fixtures.proposal.id, digest: fixtures.proposal.proposalDigest },
    source: assistantRoute.source,
    reasonTrace: assistantRoute.trace,
    outcome: assistantRoute.decision.outcome,
    actionKind: assistantRoute.decision.actionKind,
  } satisfies RouteDecisionProjectionInput;
  const assistantDecision = decodeRouteDecision(
    {
      ...assistantDecisionBase,
      decisionDigest: digest(routeDecisionProjection(assistantDecisionBase)),
    },
    digests,
  );
  const assistantAdmission = decideM26ActionAdmission(
    {
      actionKind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
      requestSource: InteractionActionRequestSource.ASSISTANT_PROPOSAL,
      originatingMessage: fixtures.message.content,
      originatingMessageContentDigest: fixtures.message.contentDigest,
      targetResolution: InteractionTargetResolution.EXACT,
      sessionExecutionBusy: false,
      targetsActiveSessionGoal: false,
    },
    fixtures.policies,
    digests,
  );
  if (assistantAdmission.decision.disposition !== 'CREATE_PENDING_ACTION') {
    assert.fail('Assistant fixture must create a separately confirmed Pending Action');
  }
  const assistantActionBase = {
    ...fixtures.pendingAction,
    routeDecisionRef: { id: assistantDecision.id, digest: assistantDecision.decisionDigest },
    actionDerivation: assistantAdmission.decision.actionDerivation,
    confirmationRequirement: assistantAdmission.decision.confirmationRequirement,
    reasonTrace: [...assistantRoute.trace, ...assistantAdmission.trace],
  } satisfies PendingActionProjectionInput;
  const assistantAction = decodePendingAction(
    {
      ...assistantActionBase,
      pendingActionDigest: digest(pendingActionProjection(assistantActionBase)),
    },
    digests,
  );
  if (assistantAction.kind !== PendingActionKind.SUBMIT_GOVERNED_INTAKE) {
    assert.fail('Assistant Pending Action fixture must remain governed Intake');
  }
  const confirmationContent = '确认';
  const confirmationMessageBase = {
    ...fixtures.message,
    id: interactionMessageId('interaction-message_confirmation'),
    content: confirmationContent,
    contentDigest: digests.digestUtf8(confirmationContent),
    contentByteLength: Buffer.byteLength(confirmationContent, 'utf8'),
    createdAt: MIDDLE,
  } satisfies InteractionMessageProjectionInput;
  const confirmationMessage = decodeInteractionMessage(
    {
      ...confirmationMessageBase,
      messageDigest: digest(interactionMessageProjection(confirmationMessageBase)),
    },
    digests,
  );
  const separateResolutionBase = {
    ...fixtures.resolution,
    pendingActionRef: { id: assistantAction.id, digest: assistantAction.pendingActionDigest },
    disposition: PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
    originatingMessageRef: assistantAction.originatingMessageRef,
    authorizingMessageRef: {
      id: confirmationMessage.id,
      digest: confirmationMessage.messageDigest,
    },
    resolvedAt: MIDDLE,
  } satisfies PendingActionResolutionProjectionInput;
  const separateResolution = decodePendingActionResolution(
    {
      ...separateResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(separateResolutionBase)),
    },
    digests,
  );
  if (
    separateResolution.disposition !==
    PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
  ) {
    assert.fail('Assistant Resolution fixture must remain separately confirmed');
  }
  assert.doesNotThrow(() =>
    assertInteractionActionChainInvariant({
      originatingMessage: fixtures.message,
      resolutionMessage: confirmationMessage,
      routeDecision: assistantDecision,
      pendingAction: assistantAction,
      resolution: separateResolution,
    }),
  );

  const busyOffer = decideM26ActionAdmission(
    {
      actionKind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
      requestSource: InteractionActionRequestSource.DIRECT_ACTION,
      originatingMessage: fixtures.message.content,
      originatingMessageContentDigest: fixtures.message.contentDigest,
      targetResolution: InteractionTargetResolution.EXACT,
      sessionExecutionBusy: true,
      targetsActiveSessionGoal: false,
    },
    fixtures.policies,
    digests,
  );
  assert.equal(busyOffer.decision.disposition, 'OFFER_MATERIALIZE_ONLY');
  const busyAlternativeAdmission = decideM26ActionAdmission(
    {
      actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      requestSource: InteractionActionRequestSource.BUSY_GOVERNED_ALTERNATIVE,
      originatingMessage: fixtures.message.content,
      originatingMessageContentDigest: fixtures.message.contentDigest,
      targetResolution: InteractionTargetResolution.EXACT,
      sessionExecutionBusy: true,
      targetsActiveSessionGoal: false,
    },
    fixtures.policies,
    digests,
  );
  if (busyAlternativeAdmission.decision.disposition !== 'CREATE_PENDING_ACTION') {
    assert.fail('Busy governed alternative must create a separately confirmed Pending Action');
  }
  const busyAlternativeActionBase = {
    ...fixtures.pendingAction,
    id: pendingActionId('pending-action_busy-governed-alternative'),
    kind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
    actionDerivation: busyAlternativeAdmission.decision.actionDerivation,
    confirmationRequirement: busyAlternativeAdmission.decision.confirmationRequirement,
    reasonTrace: [...fixtures.decision.reasonTrace, ...busyAlternativeAdmission.trace],
  } satisfies PendingActionProjectionInput;
  const busyAlternativeAction = decodePendingAction(
    {
      ...busyAlternativeActionBase,
      pendingActionDigest: digest(pendingActionProjection(busyAlternativeActionBase)),
    },
    digests,
  );
  if (busyAlternativeAction.kind !== PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE) {
    assert.fail('Busy alternative fixture must remain materialize-only Intake');
  }
  const busyAlternativeResolutionBase = {
    ...separateResolution,
    id: pendingActionResolutionId('pending-action-resolution_busy-governed-alternative'),
    pendingActionRef: {
      id: busyAlternativeAction.id,
      digest: busyAlternativeAction.pendingActionDigest,
    },
    originatingMessageRef: busyAlternativeAction.originatingMessageRef,
  } satisfies PendingActionResolutionProjectionInput;
  const busyAlternativeResolution = decodePendingActionResolution(
    {
      ...busyAlternativeResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(busyAlternativeResolutionBase)),
    },
    digests,
  );
  if (
    busyAlternativeResolution.disposition !==
    PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
  ) {
    assert.fail('Busy alternative Resolution must remain separately confirmed');
  }
  assert.doesNotThrow(() =>
    assertInteractionActionChainInvariant({
      originatingMessage: fixtures.message,
      resolutionMessage: confirmationMessage,
      routeDecision: fixtures.decision,
      pendingAction: busyAlternativeAction,
      resolution: busyAlternativeResolution,
    }),
  );

  const mismatchedBusyActionBase = {
    ...busyAlternativeAction,
    actionDerivation: PendingActionDerivation.ROUTED_ACTION,
  } satisfies PendingActionProjectionInput;
  const mismatchedBusyAction = decodePendingAction(
    {
      ...mismatchedBusyActionBase,
      pendingActionDigest: digest(pendingActionProjection(mismatchedBusyActionBase)),
    },
    digests,
  );
  const mismatchedBusyResolutionBase = {
    ...busyAlternativeResolution,
    pendingActionRef: {
      id: mismatchedBusyAction.id,
      digest: mismatchedBusyAction.pendingActionDigest,
    },
  } satisfies PendingActionResolutionProjectionInput;
  const mismatchedBusyResolution = decodePendingActionResolution(
    {
      ...mismatchedBusyResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(mismatchedBusyResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        resolutionMessage: confirmationMessage,
        routeDecision: fixtures.decision,
        pendingAction: mismatchedBusyAction,
        resolution: mismatchedBusyResolution,
      }),
    /Intake Action kind must match its Route Decision/,
  );

  const earlyDecisionBase = {
    ...fixtures.decision,
    decidedAt: BEFORE,
  } satisfies RouteDecisionProjectionInput;
  const earlyDecision = decodeRouteDecision(
    {
      ...earlyDecisionBase,
      decisionDigest: digest(routeDecisionProjection(earlyDecisionBase)),
    },
    digests,
  );
  const earlyDecisionActionBase = {
    ...fixtures.pendingAction,
    routeDecisionRef: { id: earlyDecision.id, digest: earlyDecision.decisionDigest },
  } satisfies PendingActionProjectionInput;
  const earlyDecisionAction = decodePendingAction(
    {
      ...earlyDecisionActionBase,
      pendingActionDigest: digest(pendingActionProjection(earlyDecisionActionBase)),
    },
    digests,
  );
  const earlyDecisionResolutionBase = {
    ...fixtures.resolution,
    pendingActionRef: {
      id: earlyDecisionAction.id,
      digest: earlyDecisionAction.pendingActionDigest,
    },
  } satisfies PendingActionResolutionProjectionInput;
  const earlyDecisionResolution = decodePendingActionResolution(
    {
      ...earlyDecisionResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(earlyDecisionResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: earlyDecision,
        pendingAction: earlyDecisionAction,
        resolution: earlyDecisionResolution,
      }),
    /Route Decision cannot precede its originating message/,
  );

  const earlyActionBase = {
    ...fixtures.pendingAction,
    createdAt: BEFORE,
  } satisfies PendingActionProjectionInput;
  const earlyAction = decodePendingAction(
    {
      ...earlyActionBase,
      pendingActionDigest: digest(pendingActionProjection(earlyActionBase)),
    },
    digests,
  );
  const earlyActionResolutionBase = {
    ...fixtures.resolution,
    pendingActionRef: { id: earlyAction.id, digest: earlyAction.pendingActionDigest },
  } satisfies PendingActionResolutionProjectionInput;
  const earlyActionResolution = decodePendingActionResolution(
    {
      ...earlyActionResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(earlyActionResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: fixtures.decision,
        pendingAction: earlyAction,
        resolution: earlyActionResolution,
      }),
    /Pending Action cannot precede its Route Decision/,
  );

  const directAssistantResolutionBase = {
    ...fixtures.resolution,
    pendingActionRef: separateResolution.pendingActionRef,
  } satisfies PendingActionResolutionProjectionInput;
  const directAssistantResolution = decodePendingActionResolution(
    {
      ...directAssistantResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(directAssistantResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: assistantDecision,
        pendingAction: assistantAction,
        resolution: directAssistantResolution,
      }),
    /Direct authorization must bind the originating direct Action/,
  );

  const directRequirementAssistantActionBase = {
    ...assistantAction,
    confirmationRequirement: InteractionConfirmationRequirement.DIRECT_USER_MESSAGE_SUFFICIENT,
  } satisfies PendingActionProjectionInput;
  const directRequirementAssistantAction = decodePendingAction(
    {
      ...directRequirementAssistantActionBase,
      pendingActionDigest: digest(pendingActionProjection(directRequirementAssistantActionBase)),
    },
    digests,
  );
  const expiredAssistantResolutionBase = {
    id: pendingActionResolutionId('pending-action-resolution_assistant-expired'),
    schemaVersion: 1 as const,
    pendingActionRef: {
      id: directRequirementAssistantAction.id,
      digest: directRequirementAssistantAction.pendingActionDigest,
    },
    confirmationPolicy: directRequirementAssistantAction.confirmationPolicy,
    disposition: PendingActionResolutionDisposition.EXPIRED,
    resolvedAt: AFTER,
  } satisfies PendingActionResolutionProjectionInput;
  const expiredAssistantResolution = decodePendingActionResolution(
    {
      ...expiredAssistantResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(expiredAssistantResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: assistantDecision,
        pendingAction: directRequirementAssistantAction,
        resolution: expiredAssistantResolution,
      }),
    /Assistant-proposed Action must require a separate response/,
  );

  const invalidResponseMessages: InteractionMessageProjectionInput[] = [];
  const crossSessionBase = {
    ...confirmationMessage,
    sessionId: interactionSessionId('interaction-session_confirmation-substitution'),
  } satisfies InteractionMessageProjectionInput;
  invalidResponseMessages.push(crossSessionBase);
  const crossPrincipalBase = {
    ...confirmationMessage,
    principalRef: principalId('principal_confirmation-substitution'),
  } satisfies InteractionMessageProjectionInput;
  invalidResponseMessages.push(crossPrincipalBase);
  const systemResponseBase = {
    ...confirmationMessage,
    role: InteractionMessageRole.SYSTEM,
    causedByOperationRef: { id: fixtures.operation.id, digest: fixtures.operation.operationDigest },
  } satisfies InteractionMessageProjectionInput;
  invalidResponseMessages.push(systemResponseBase);
  const omittedResponseBase = {
    id: confirmationMessage.id,
    schemaVersion: 1 as const,
    sessionId: confirmationMessage.sessionId,
    principalRef: confirmationMessage.principalRef,
    role: InteractionMessageRole.USER,
    retention: InteractionContentRetention.OMITTED,
    omissionReason: InteractionContentOmissionReason.RETENTION_POLICY,
    contentDigest: confirmationMessage.contentDigest,
    contentByteLength: confirmationMessage.contentByteLength,
    createdAt: confirmationMessage.createdAt,
  } satisfies InteractionMessageProjectionInput;
  invalidResponseMessages.push(omittedResponseBase);

  for (const responseBase of invalidResponseMessages) {
    const substitutedMessage = decodeInteractionMessage(
      {
        ...responseBase,
        messageDigest: digest(interactionMessageProjection(responseBase)),
      },
      digests,
    );
    assert.throws(
      () =>
        assertInteractionActionChainInvariant({
          originatingMessage: fixtures.message,
          resolutionMessage: substitutedMessage,
          routeDecision: assistantDecision,
          pendingAction: assistantAction,
          resolution: separateResolution,
        }),
      /same principal and Session/,
    );
  }

  const lateMessageBase = {
    ...confirmationMessage,
    createdAt: LATER,
  } satisfies InteractionMessageProjectionInput;
  const lateMessage = decodeInteractionMessage(
    {
      ...lateMessageBase,
      messageDigest: digest(interactionMessageProjection(lateMessageBase)),
    },
    digests,
  );
  const lateResolutionBase = {
    ...separateResolutionBase,
    authorizingMessageRef: { id: lateMessage.id, digest: lateMessage.messageDigest },
  } satisfies PendingActionResolutionProjectionInput;
  const lateResolution = decodePendingActionResolution(
    {
      ...lateResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(lateResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        resolutionMessage: lateMessage,
        routeDecision: assistantDecision,
        pendingAction: assistantAction,
        resolution: lateResolution,
      }),
    /cannot precede its authorizing response message/,
  );

  const oldMessageBase = {
    ...confirmationMessage,
    createdAt: BEFORE,
  } satisfies InteractionMessageProjectionInput;
  const oldMessage = decodeInteractionMessage(
    {
      ...oldMessageBase,
      messageDigest: digest(interactionMessageProjection(oldMessageBase)),
    },
    digests,
  );
  const oldMessageResolutionBase = {
    ...separateResolutionBase,
    authorizingMessageRef: { id: oldMessage.id, digest: oldMessage.messageDigest },
  } satisfies PendingActionResolutionProjectionInput;
  const oldMessageResolution = decodePendingActionResolution(
    {
      ...oldMessageResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(oldMessageResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        resolutionMessage: oldMessage,
        routeDecision: assistantDecision,
        pendingAction: assistantAction,
        resolution: oldMessageResolution,
      }),
    /response message cannot precede Action creation/,
  );

  const directDeclinedResolutionBase = {
    id: pendingActionResolutionId('pending-action-resolution_direct-declined'),
    schemaVersion: 1 as const,
    pendingActionRef: {
      id: fixtures.pendingAction.id,
      digest: fixtures.pendingAction.pendingActionDigest,
    },
    confirmationPolicy: fixtures.pendingAction.confirmationPolicy,
    disposition: PendingActionResolutionDisposition.DECLINED,
    responseMessageRef: {
      id: confirmationMessage.id,
      digest: confirmationMessage.messageDigest,
    },
    resolvedAt: MIDDLE,
  } satisfies PendingActionResolutionProjectionInput;
  const directDeclinedResolution = decodePendingActionResolution(
    {
      ...directDeclinedResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(directDeclinedResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        resolutionMessage: confirmationMessage,
        routeDecision: fixtures.decision,
        pendingAction: fixtures.pendingAction,
        resolution: directDeclinedResolution,
      }),
    /response Resolution requires an Action with separate confirmation/,
  );

  const expiredResponseBase = {
    ...separateResolution,
    resolvedAt: LATER,
  } satisfies PendingActionResolutionProjectionInput;
  const expiredResponse = decodePendingActionResolution(
    {
      ...expiredResponseBase,
      resolutionDigest: digest(pendingActionResolutionProjection(expiredResponseBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        resolutionMessage: confirmationMessage,
        routeDecision: assistantDecision,
        pendingAction: assistantAction,
        resolution: expiredResponse,
      }),
    /cannot resolve an expired Pending Action/,
  );

  const earlyExpiredResolutionBase = {
    id: pendingActionResolutionId('pending-action-resolution_early-expiry'),
    schemaVersion: 1 as const,
    pendingActionRef: {
      id: assistantAction.id,
      digest: assistantAction.pendingActionDigest,
    },
    confirmationPolicy: assistantAction.confirmationPolicy,
    disposition: PendingActionResolutionDisposition.EXPIRED,
    resolvedAt: NOW,
  } satisfies PendingActionResolutionProjectionInput;
  const earlyExpiredResolution = decodePendingActionResolution(
    {
      ...earlyExpiredResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(earlyExpiredResolutionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: assistantDecision,
        pendingAction: assistantAction,
        resolution: earlyExpiredResolution,
      }),
    /unexpired Pending Action cannot receive an expired Resolution/,
  );

  const earlyReservationResolutionBase = {
    ...fixtures.resolution,
    resolvedAt: MIDDLE,
  } satisfies PendingActionResolutionProjectionInput;
  const earlyReservationResolution = decodePendingActionResolution(
    {
      ...earlyReservationResolutionBase,
      resolutionDigest: digest(pendingActionResolutionProjection(earlyReservationResolutionBase)),
    },
    digests,
  );
  const earlyReservationBase = {
    ...fixtures.reservation,
    resolutionRef: {
      id: earlyReservationResolution.id,
      digest: earlyReservationResolution.resolutionDigest,
    },
  } satisfies InteractionActionReservationProjectionInput;
  const earlyReservation = decodeInteractionActionReservation(
    {
      ...earlyReservationBase,
      reservationDigest: digest(interactionActionReservationProjection(earlyReservationBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: fixtures.decision,
        pendingAction: fixtures.pendingAction,
        resolution: earlyReservationResolution,
        reservation: earlyReservation,
      }),
    /Reservation cannot precede its Resolution/,
  );

  const forgedRouteTraceBase = {
    ...fixtures.decision,
    reasonTrace: fixtures.decision.reasonTrace.map((entry) => ({
      ...entry,
      policyDigest: ZERO,
    })),
  } satisfies RouteDecisionProjectionInput;
  assert.throws(
    () =>
      decodeRouteDecision(
        {
          ...forgedRouteTraceBase,
          decisionDigest: digest(routeDecisionProjection(forgedRouteTraceBase)),
        },
        digests,
      ),
    /reason trace must bind its routing policy/,
  );

  const forgedAuthorizationTrace = fixtures.pendingAction.reasonTrace.map((entry, index) =>
    index < fixtures.decision.reasonTrace.length ? entry : { ...entry, policyDigest: ZERO },
  );
  const forgedAuthorizationActionBase = {
    ...fixtures.pendingAction,
    reasonTrace: forgedAuthorizationTrace,
  } satisfies PendingActionProjectionInput;
  const forgedAuthorizationAction = decodePendingAction(
    {
      ...forgedAuthorizationActionBase,
      pendingActionDigest: digest(pendingActionProjection(forgedAuthorizationActionBase)),
    },
    digests,
  );
  assert.throws(
    () =>
      assertInteractionActionChainInvariant({
        originatingMessage: fixtures.message,
        routeDecision: fixtures.decision,
        pendingAction: forgedAuthorizationAction,
        resolution: fixtures.resolution,
      }),
    /authorization trace must bind its confirmation policy/,
  );

  const interruptedFailure: Record<string, unknown> = {
    ...fixtures.operation,
    state: InteractionOperationState.FAILED,
    failureReason: InteractionOperationFailureReason.INTERRUPTED,
  };
  Reflect.deleteProperty(interruptedFailure, 'result');
  assert.throws(
    () =>
      decodeInteractionOperation(
        {
          ...interruptedFailure,
          operationDigest: ZERO,
        },
        digests,
      ),
    /Invalid option|failureReason/i,
  );
});

void test('frontstage answer authority and causal ordering', () => {
  const fixtures = createFixtures();
  const chain = {
    session: fixtures.session,
    originatingMessage: fixtures.message,
    routeOperation: fixtures.answerRouteOperation,
    proposal: fixtures.answerProposal,
    routeDecision: fixtures.answerDecision,
    answer: fixtures.answer,
    answerOperation: fixtures.answerOperation,
  };
  assert.doesNotThrow(() => assertFrontstageAnswerChainInvariant(chain));

  const substitutedSessionBase = {
    ...fixtures.session,
    retentionProfile: {
      id: 'frontstage-retention_substituted',
      version: 'v2',
      digest: THREE,
    },
  } satisfies InteractionSessionProjectionInput;
  const substitutedSession = decodeInteractionSession(
    {
      ...substitutedSessionBase,
      sessionDigest: digest(interactionSessionProjection(substitutedSessionBase)),
    },
    digests,
  );
  assert.throws(
    () => assertFrontstageAnswerChainInvariant({ ...chain, session: substitutedSession }),
    /exact Answer Proposal chain/,
  );

  const substitutedRouteOperationBase = {
    ...fixtures.answerRouteOperation,
    result: {
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef: {
        id: fixtures.decision.id,
        digest: fixtures.decision.decisionDigest,
      },
      routeProposalRef: {
        id: fixtures.answerProposal.id,
        digest: fixtures.answerProposal.proposalDigest,
      },
    },
  } satisfies InteractionOperationProjectionInput;
  const substitutedRouteOperation = decodeInteractionOperation(
    {
      ...substitutedRouteOperationBase,
      operationDigest: digest(interactionOperationProjection(substitutedRouteOperationBase)),
    },
    digests,
  );
  if (substitutedRouteOperation.state !== InteractionOperationState.COMPLETED) {
    assert.fail('Substituted Route Operation fixture must remain completed');
  }
  assert.throws(
    () =>
      assertFrontstageAnswerChainInvariant({
        ...chain,
        routeOperation: substitutedRouteOperation,
      }),
    /exact Answer Proposal chain/,
  );
  assert.throws(
    () =>
      assertFrontstageAnswerChainInvariant({
        ...chain,
        routeOperation: fixtures.answerOperation,
        answerOperation: fixtures.answerRouteOperation,
      }),
    /completed Route Operation/,
  );

  const lateAnswerBase = {
    ...fixtures.answer,
    createdAt: AFTER,
  } satisfies FrontstageAnswerProjectionInput;
  const lateAnswer = decodeFrontstageAnswer(
    {
      ...lateAnswerBase,
      answerDigest: digest(frontstageAnswerProjection(lateAnswerBase)),
    },
    digests,
  );
  const lateAnswerOperationBase = {
    ...fixtures.answerOperation,
    result: {
      kind: InteractionOperationResultKind.ANSWER_RECORDED,
      answerRef: { id: lateAnswer.id, digest: lateAnswer.answerDigest },
    },
  } satisfies InteractionOperationProjectionInput;
  const lateAnswerOperation = decodeInteractionOperation(
    {
      ...lateAnswerOperationBase,
      operationDigest: digest(interactionOperationProjection(lateAnswerOperationBase)),
    },
    digests,
  );
  if (lateAnswerOperation.state !== InteractionOperationState.COMPLETED) {
    assert.fail('Late Answer Operation fixture must remain completed');
  }
  assert.throws(
    () =>
      assertFrontstageAnswerChainInvariant({
        ...chain,
        answer: lateAnswer,
        answerOperation: lateAnswerOperation,
      }),
    /invalid causal ordering/,
  );
});

void test('[M26-D02] canonical golden vectors', () => {
  const fixtures = createFixtures();
  const actual = {
    directActionGrammar: fixtures.policies.directActionGrammar.digest,
    confirmationGrammar: fixtures.policies.confirmationGrammar.digest,
    routingPolicy: fixtures.policies.routingPolicy.digest,
    confirmationPolicy: fixtures.policies.confirmationPolicy.digest,
    session: fixtures.session.sessionDigest,
    message: fixtures.message.messageDigest,
    focus: fixtures.focus.focusDigest,
    contextManifest: fixtures.contextManifest.manifestDigest,
    proposal: fixtures.proposal.proposalDigest,
    decision: fixtures.decision.decisionDigest,
    pendingAction: fixtures.pendingAction.pendingActionDigest,
    resolution: fixtures.resolution.resolutionDigest,
    reservation: fixtures.reservation.reservationDigest,
    outcome: fixtures.outcome.outcomeDigest,
    handoff: fixtures.handoff.handoffDigest,
    answer: fixtures.answer.answerDigest,
    operation: fixtures.operation.operationDigest,
  };
  assert.deepEqual(actual, {
    directActionGrammar: 'sha256:eb192d5c9727770b5accb3442496dde66284cb62ee5da01563e5c6d093cf9882',
    confirmationGrammar: 'sha256:7abc832882636436617dcae14d4cfbb77e7e66d6742b0215d11e5eb719bffffe',
    routingPolicy: 'sha256:d4a266585adeafad4e360ba71686d555bc3d3eabbaca67392c17c1072d84b5fd',
    confirmationPolicy: 'sha256:74fa3cca12288d01793c2bc305b2bf61dc7e8d17486207ecf4a2eff0ff632e9e',
    session: 'sha256:a651f26e725bd77fc64c92a746700df72eb9455509ec691f071cb08522306bf8',
    message: 'sha256:50b229eae7c553a2357280c6478d62a18fa26dd2486e6a7cbedc1c872648bf16',
    focus: 'sha256:a7259d55c773e90ebef398de8dd76fcde8143d9e23beb7734c10f8534d1912f1',
    contextManifest: 'sha256:c3b9a279990d3864640b1df7b9be57e5c9b3281c30b0ec52f7914efe4da09b3e',
    proposal: 'sha256:08185238dcc56e965d02aa9b0f15299ef9abe4e9cf58685d1200d6da7ff7d5f3',
    decision: 'sha256:8e087d54fa593f191b4609969bfe4828bc153a93dfe56476d810880b03107c4a',
    pendingAction: 'sha256:1fa4a4092908e7cfb3bb9f27da7fbe3b71aeb29808ebb10655364dfb52762e47',
    resolution: 'sha256:8d02d48d078e5d3115aaf478ead51a2fc186c12f26fd1287bb5c7a9db913a385',
    reservation: 'sha256:9251019400e2c57edbeb1f6d0e4dc8ac82afd511364e20638c72067850ed0c19',
    outcome: 'sha256:b5ff78714528468a5ae063ae4c7c383d044b3b889757469b579da039f047cdc3',
    handoff: 'sha256:31a2f13329e6f4b03d93861fc011a72fef1db43d4efe0cda7c0bb878dd22a538',
    answer: 'sha256:8965a2113cb9fe234f22f8dbc8ea323718da7d36c50a8d3a1b84bbcf1f8670ad',
    operation: 'sha256:05a114dea91fd19aa11805acb037a289623ef0b17f0da5aec377748b6b0b20c8',
  });

  const projections = [
    [
      directActionGrammarProjection(fixtures.policies.directActionGrammar),
      actual.directActionGrammar,
    ],
    [
      confirmationGrammarProjection(fixtures.policies.confirmationGrammar),
      actual.confirmationGrammar,
    ],
    [interactionRoutingPolicyProjection(fixtures.policies.routingPolicy), actual.routingPolicy],
    [
      interactionConfirmationPolicyProjection(fixtures.policies.confirmationPolicy),
      actual.confirmationPolicy,
    ],
    [interactionSessionProjection(fixtures.session), actual.session],
    [interactionMessageProjection(fixtures.message), actual.message],
    [focusBindingProjection(fixtures.focus), actual.focus],
    [frontstageContextManifestProjection(fixtures.contextManifest), actual.contextManifest],
    [routeProposalProjection(fixtures.proposal), actual.proposal],
    [routeDecisionProjection(fixtures.decision), actual.decision],
    [pendingActionProjection(fixtures.pendingAction), actual.pendingAction],
    [pendingActionResolutionProjection(fixtures.resolution), actual.resolution],
    [interactionActionReservationProjection(fixtures.reservation), actual.reservation],
    [interactionActionOutcomeProjection(fixtures.outcome), actual.outcome],
    [interactionMessageHandoffProjection(fixtures.handoff), actual.handoff],
    [frontstageAnswerProjection(fixtures.answer), actual.answer],
    [interactionOperationProjection(fixtures.operation), actual.operation],
  ] as const;
  for (const [projection, expected] of projections) {
    assertEveryTopLevelFieldIsBound(projection, expected);
  }
});
