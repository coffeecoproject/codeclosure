import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConfirmationParseDisposition,
  DirectActionParseDisposition,
  DirectActionTargetRule,
  FrontstageCandidateRoute,
  FrontstageProposalAmbiguity,
  FrontstageProposalKind,
  InteractionActionAdmissionDisposition,
  InteractionActionRequestSource,
  InteractionRouteDecisionOutcome,
  InteractionTargetResolution,
  PendingActionDerivation,
  PendingActionKind,
  decodeDirectActionGrammar,
  decodeRouteProposal,
  directActionGrammarProjection,
  frontstageContextManifestId,
  goalId,
  goalRevision,
  interactionMessageId,
  interactionOperationId,
  interactionSessionId,
  isoTimestamp,
  routeProposalId,
  routeProposalProjection,
  sha256Digest,
  workflowId,
  workflowVersion,
  type RouteProposal,
  type RouteProposalProjectionInput,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  InteractionRoutingInputKind,
  createM26DirectActionGrammarDefinition,
  createM26InteractionPolicies,
  createM26RoutingPolicy,
  decideM26ActionAdmission,
  decideM26InteractionRoute,
  parseM26Confirmation,
  parseM26DirectAction,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const policies = createM26InteractionPolicies(digests);
const ONE = sha256Digest(`sha256:${'1'.repeat(64)}`);
const TWO = sha256Digest(`sha256:${'2'.repeat(64)}`);
const THREE = sha256Digest(`sha256:${'3'.repeat(64)}`);
const NOW = isoTimestamp('2026-08-14T02:00:00.000Z');
const sessionDigest = digests.digest({ session: 'routing' });
const messageDigest = digests.digest({ message: 'routing' });
const focusDigest = digests.digest({ focus: 'routing' });
const sessionId = interactionSessionId('interaction-session_routing');
const messageId = interactionMessageId('interaction-message_routing');

const runtimeGoalTarget = Object.freeze({
  goalId: goalId('goal_runtime-owned'),
  goalRevision: goalRevision(4),
  workflowId: workflowId('workflow_runtime-owned'),
  workflowVersion: workflowVersion(5),
});

function createRouteProposal(input: {
  readonly candidateRoute: FrontstageCandidateRoute;
  readonly candidateGoalIds?: readonly ReturnType<typeof goalId>[];
  readonly ambiguity?: FrontstageProposalAmbiguity;
}): RouteProposal {
  const base = {
    id: routeProposalId('route-proposal_routing'),
    schemaVersion: 1 as const,
    sessionId,
    operationId: interactionOperationId('interaction-operation_routing'),
    messageRef: {
      id: messageId,
      digest: messageDigest,
    },
    contextManifestRef: {
      id: frontstageContextManifestId('frontstage-context-manifest_routing'),
      digest: ONE,
    },
    assistantProfile: { id: 'frontstage-assistant-profile_local', version: 'v1', digest: ONE },
    assistantAdapter: { id: 'frontstage-assistant-adapter_local', version: 'v1', digest: TWO },
    responseContract: { id: 'frontstage-response_local', version: 'v1', digest: THREE },
    kind: FrontstageProposalKind.ROUTE_PROPOSAL,
    candidateRoute: input.candidateRoute,
    candidateGoalIds: input.candidateGoalIds ?? [],
    ambiguity: input.ambiguity ?? FrontstageProposalAmbiguity.NONE,
    observedAt: NOW,
  } satisfies RouteProposalProjectionInput;
  return decodeRouteProposal(
    { ...base, proposalDigest: digests.digest(routeProposalProjection(base)) },
    digests,
  );
}

function createAnswerProposal(): RouteProposal {
  const base = {
    id: routeProposalId('route-proposal_answer-routing'),
    schemaVersion: 1 as const,
    sessionId,
    operationId: interactionOperationId('interaction-operation_answer-routing'),
    messageRef: { id: messageId, digest: messageDigest },
    contextManifestRef: {
      id: frontstageContextManifestId('frontstage-context-manifest_answer-routing'),
      digest: ONE,
    },
    assistantProfile: { id: 'frontstage-assistant-profile_local', version: 'v1', digest: ONE },
    assistantAdapter: { id: 'frontstage-assistant-adapter_local', version: 'v1', digest: TWO },
    responseContract: { id: 'frontstage-response_local', version: 'v1', digest: THREE },
    kind: FrontstageProposalKind.ANSWER_PROPOSAL,
    answerContent: '这是一个有界回答。',
    observedAt: NOW,
  } satisfies RouteProposalProjectionInput;
  return decodeRouteProposal(
    { ...base, proposalDigest: digests.digest(routeProposalProjection(base)) },
    digests,
  );
}

function admission(input: {
  readonly actionKind: PendingActionKind;
  readonly requestSource?: InteractionActionRequestSource;
  readonly originatingMessage?: string;
  readonly targetResolution?: InteractionTargetResolution;
  readonly sessionExecutionBusy?: boolean;
  readonly targetsActiveSessionGoal?: boolean;
}) {
  return admissionResult(input).decision;
}

function admissionResult(input: {
  readonly actionKind: PendingActionKind;
  readonly requestSource?: InteractionActionRequestSource;
  readonly originatingMessage?: string;
  readonly targetResolution?: InteractionTargetResolution;
  readonly sessionExecutionBusy?: boolean;
  readonly targetsActiveSessionGoal?: boolean;
}) {
  const originatingMessage = input.originatingMessage ?? '请开始当前目标';
  return decideM26ActionAdmission(
    {
      actionKind: input.actionKind,
      requestSource: input.requestSource ?? InteractionActionRequestSource.DIRECT_ACTION,
      originatingMessage,
      originatingMessageContentDigest: digests.digestUtf8(originatingMessage),
      targetResolution: input.targetResolution ?? InteractionTargetResolution.EXACT,
      sessionExecutionBusy: input.sessionExecutionBusy ?? false,
      targetsActiveSessionGoal: input.targetsActiveSessionGoal ?? false,
    },
    policies,
    digests,
  );
}

void test('[M26-R01] forged proposal and decision authority', () => {
  const proposal = createRouteProposal({
    candidateRoute: FrontstageCandidateRoute.START_GOAL,
    candidateGoalIds: [goalId('goal_model-selected')],
  });
  const result = decideM26InteractionRoute(
    {
      kind: InteractionRoutingInputKind.ASSISTANT_PROPOSAL,
      sessionId,
      sessionDigest,
      messageId,
      messageDigest,
      focusDigest,
      proposal,
      resolvedGoalTarget: runtimeGoalTarget,
    },
    policies,
    digests,
  );
  assert.deepEqual(result.decision, {
    outcome: InteractionRouteDecisionOutcome.ASK_ROUTE_CLARIFICATION,
    ambiguity: FrontstageProposalAmbiguity.TARGET_AMBIGUOUS,
  });
  assert.equal('id' in result.decision, false);
  assert.equal('publicCapability' in result.decision, false);
  assert.deepEqual(
    admission({
      actionKind: PendingActionKind.START_GOAL,
      requestSource: InteractionActionRequestSource.ASSISTANT_PROPOSAL,
      originatingMessage: '请开始当前目标',
    }),
    {
      disposition: InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION,
      actionKind: PendingActionKind.START_GOAL,
      actionDerivation: PendingActionDerivation.ROUTED_ACTION,
      confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED',
      reason: 'ASSISTANT_ACTION_REQUIRES_CONFIRMATION',
    },
  );
  assert.throws(
    () =>
      decodeRouteProposal(
        {
          ...proposal,
          publicCapability: 'START_GOAL',
          routeDecisionId: 'route-decision_forged',
        },
        digests,
      ),
    /unrecognized key/i,
  );
  assert.throws(
    () =>
      decideM26InteractionRoute(
        {
          kind: InteractionRoutingInputKind.READ_ONLY_GOAL_LIST,
          sessionId,
          sessionDigest,
          messageId,
          messageDigest,
        },
        {
          ...policies,
          routingPolicy: { ...policies.routingPolicy, digest: ONE },
        },
        digests,
      ),
    /does not match its canonical projection/,
  );
  const directDefinition = createM26DirectActionGrammarDefinition();
  const substitutedDefinition = {
    ...directDefinition,
    forms: [
      ...directDefinition.forms,
      {
        messageTemplate: '请马上开始当前目标',
        actionKind: PendingActionKind.START_GOAL,
        targetRule: DirectActionTargetRule.SOLE_CURRENT_GOAL_FOCUS,
      },
    ],
  };
  const substitutedGrammar = decodeDirectActionGrammar(
    {
      ...substitutedDefinition,
      digest: digests.digest(directActionGrammarProjection(substitutedDefinition)),
    },
    digests,
  );
  assert.throws(
    () =>
      decideM26InteractionRoute(
        {
          kind: InteractionRoutingInputKind.READ_ONLY_GOAL_LIST,
          sessionId,
          sessionDigest,
          messageId,
          messageDigest,
        },
        {
          ...policies,
          directActionGrammar: substitutedGrammar,
          routingPolicy: createM26RoutingPolicy(substitutedGrammar, digests),
        },
        digests,
      ),
    /differs from the installed M2\.6 definitions/,
  );
});

void test('[M26-R02] deterministic route replay', () => {
  const originatingMessage = '请开始当前目标';
  const input = Object.freeze({
    kind: InteractionRoutingInputKind.DIRECT_ACTION,
    sessionId,
    sessionDigest,
    messageId,
    messageDigest,
    focusDigest,
    originatingMessage,
    originatingMessageContentDigest: digests.digestUtf8(originatingMessage),
    goalTarget: runtimeGoalTarget,
  });
  const first = decideM26InteractionRoute(input, policies, digests);
  const second = decideM26InteractionRoute(input, policies, digests);
  assert.deepEqual(first, second);
  assert.deepEqual(first.decision, {
    outcome: InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL,
    actionKind: PendingActionKind.START_GOAL,
    goalTarget: runtimeGoalTarget,
  });
  assert.deepEqual(first.trace, second.trace);
  const changedTarget = {
    ...runtimeGoalTarget,
    goalRevision: goalRevision(5),
    workflowVersion: workflowVersion(6),
  };
  const changed = decideM26InteractionRoute(
    { ...input, goalTarget: changedTarget },
    policies,
    digests,
  );
  assert.notDeepEqual(changed.decision, first.decision);
  assert.notDeepEqual(changed.trace, first.trace);
});

void test('[M26-R03] read-only route capability set', () => {
  const list = decideM26InteractionRoute(
    {
      kind: InteractionRoutingInputKind.READ_ONLY_GOAL_LIST,
      sessionId,
      sessionDigest,
      messageId,
      messageDigest,
    },
    policies,
    digests,
  ).decision;
  const status = decideM26InteractionRoute(
    {
      kind: InteractionRoutingInputKind.READ_ONLY_GOAL_STATUS,
      sessionId,
      sessionDigest,
      messageId,
      messageDigest,
      focusDigest,
      goalTarget: runtimeGoalTarget,
    },
    policies,
    digests,
  ).decision;
  const answerProposal = createAnswerProposal();
  const answer = decideM26InteractionRoute(
    {
      kind: InteractionRoutingInputKind.ASSISTANT_PROPOSAL,
      sessionId,
      sessionDigest,
      messageId,
      messageDigest,
      proposal: answerProposal,
    },
    policies,
    digests,
  ).decision;
  assert.equal(list.outcome, InteractionRouteDecisionOutcome.LIST_GOALS);
  assert.equal(status.outcome, InteractionRouteDecisionOutcome.SHOW_GOAL);
  assert.equal(answer.outcome, InteractionRouteDecisionOutcome.ANSWER);
  for (const decision of [answer, list, status]) {
    assert.equal('actionKind' in decision, false);
    assert.equal('publicCapability' in decision, false);
  }
});

void test('[M26-R05] deterministic direct authorization grammar', () => {
  const cases = [
    ['请执行以下请求：修复支付幂等性', PendingActionKind.SUBMIT_GOVERNED_INTAKE],
    ['请仅创建目标：分析支付回调', PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE],
    ['请开始当前目标', PendingActionKind.START_GOAL],
    ['请继续当前目标', PendingActionKind.RESUME_GOAL],
  ] as const;
  for (const [message, actionKind] of cases) {
    const parsed = parseM26DirectAction(message, policies.directActionGrammar);
    if (parsed.disposition !== DirectActionParseDisposition.MATCHED) {
      assert.fail(`Exact direct form did not match: ${message}`);
    }
    assert.equal(parsed.actionKind, actionKind);
    assert.equal(parsed.completeOriginalMessage, message);
    const result = admissionResult({ actionKind, originatingMessage: message });
    assert.deepEqual(result.decision, {
      disposition: InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION,
      actionKind,
      actionDerivation: PendingActionDerivation.ROUTED_ACTION,
      confirmationRequirement: 'DIRECT_USER_MESSAGE_SUFFICIENT',
      reason: 'EXACT_DIRECT_ACTION',
    });
    assert.equal(result.trace.length, 1);
  }

  const governed = parseM26DirectAction(
    '请执行以下请求： 修复支付幂等性 ',
    policies.directActionGrammar,
  );
  if (governed.disposition !== DirectActionParseDisposition.MATCHED) {
    assert.fail('Exact governed Intake form did not match');
  }
  assert.equal(governed.requestRemainder, ' 修复支付幂等性 ');
  assert.equal(governed.completeOriginalMessage, '请执行以下请求： 修复支付幂等性 ');

  for (const variant of [
    ' 请开始当前目标',
    '请开始当前目标 ',
    '请开始当前目标。',
    '请开始当前目標',
    '请执行以下请求:修复支付幂等性',
    '请执行以下请求：',
    '请执行以下请求： \t\n',
    `请执行以下请求：\ud800`,
  ]) {
    assert.deepEqual(parseM26DirectAction(variant, policies.directActionGrammar), {
      disposition: DirectActionParseDisposition.NO_MATCH,
    });
  }
});

void test('[M26-R06] forbidden direct authorization', () => {
  assert.deepEqual(
    admission({
      actionKind: PendingActionKind.CANCEL_GOAL,
      requestSource: InteractionActionRequestSource.DIRECT_ACTION,
      originatingMessage: '请取消当前目标',
    }),
    {
      disposition: InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION,
      actionKind: PendingActionKind.CANCEL_GOAL,
      actionDerivation: PendingActionDerivation.ROUTED_ACTION,
      confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED',
      reason: 'CANCEL_REQUIRES_CONFIRMATION',
    },
  );
  for (const message of ['请取消当前目标', '请替换当前目标', '请删除当前目标']) {
    assert.deepEqual(parseM26DirectAction(message, policies.directActionGrammar), {
      disposition: DirectActionParseDisposition.NO_MATCH,
    });
  }
  assert.deepEqual(
    admission({
      actionKind: PendingActionKind.CANCEL_GOAL,
      requestSource: InteractionActionRequestSource.ASSISTANT_PROPOSAL,
    }),
    {
      disposition: InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION,
      actionKind: PendingActionKind.CANCEL_GOAL,
      actionDerivation: PendingActionDerivation.ROUTED_ACTION,
      confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED',
      reason: 'CANCEL_REQUIRES_CONFIRMATION',
    },
  );
  assert.equal(
    admission({
      actionKind: PendingActionKind.START_GOAL,
      targetResolution: InteractionTargetResolution.AMBIGUOUS,
    }).disposition,
    InteractionActionAdmissionDisposition.ASK_CLARIFICATION,
  );
  assert.deepEqual(
    admission({
      actionKind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
      originatingMessage: '请执行以下请求：修复问题',
      sessionExecutionBusy: true,
    }),
    {
      disposition: InteractionActionAdmissionDisposition.OFFER_MATERIALIZE_ONLY,
      actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      actionDerivation: PendingActionDerivation.BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE,
      confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED',
      reason: 'BUSY_GOVERNED_ALTERNATIVE_AVAILABLE',
    },
  );
  for (const actionKind of [PendingActionKind.START_GOAL, PendingActionKind.RESUME_GOAL]) {
    assert.equal(
      admission({ actionKind, sessionExecutionBusy: true }).disposition,
      InteractionActionAdmissionDisposition.SESSION_EXECUTION_BUSY,
    );
  }
  assert.deepEqual(
    admission({
      actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      originatingMessage: '请仅创建目标：记录问题',
      sessionExecutionBusy: true,
    }),
    {
      disposition: InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION,
      actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      actionDerivation: PendingActionDerivation.ROUTED_ACTION,
      confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED',
      reason: 'BUSY_MATERIALIZE_ONLY_REQUIRES_CONFIRMATION',
    },
  );
  assert.deepEqual(
    admission({
      actionKind: PendingActionKind.CANCEL_GOAL,
      sessionExecutionBusy: true,
      targetsActiveSessionGoal: true,
    }),
    {
      disposition: InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION,
      actionKind: PendingActionKind.CANCEL_GOAL,
      actionDerivation: PendingActionDerivation.ROUTED_ACTION,
      confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED',
      reason: 'CANCEL_REQUIRES_CONFIRMATION',
    },
  );
  assert.equal(
    admission({
      actionKind: PendingActionKind.CANCEL_GOAL,
      sessionExecutionBusy: true,
      targetsActiveSessionGoal: false,
    }).disposition,
    InteractionActionAdmissionDisposition.ASK_CLARIFICATION,
  );
  assert.deepEqual(
    admission({
      actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      requestSource: InteractionActionRequestSource.BUSY_GOVERNED_ALTERNATIVE,
      originatingMessage: '请执行以下请求：记录问题',
      sessionExecutionBusy: true,
    }),
    {
      disposition: InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION,
      actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
      actionDerivation: PendingActionDerivation.BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE,
      confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED',
      reason: 'BUSY_MATERIALIZE_ONLY_REQUIRES_CONFIRMATION',
    },
  );
  assert.throws(
    () =>
      admission({
        actionKind: PendingActionKind.START_GOAL,
        requestSource: InteractionActionRequestSource.BUSY_GOVERNED_ALTERNATIVE,
      }),
    /must be a busy-session materialize-only action/,
  );
  assert.throws(
    () =>
      admission({
        actionKind: PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE,
        requestSource: InteractionActionRequestSource.BUSY_GOVERNED_ALTERNATIVE,
        originatingMessage: '请执行以下请求：记录问题',
      }),
    /must be a busy-session materialize-only action/,
  );
});

void test('separate-confirmation grammar recognizes only its four exact phrases', () => {
  for (const message of ['确认', '确认执行']) {
    assert.equal(
      parseM26Confirmation(message, policies.confirmationGrammar).disposition,
      ConfirmationParseDisposition.CONFIRM,
    );
  }
  for (const message of ['不确认', '取消本次操作']) {
    assert.equal(
      parseM26Confirmation(message, policies.confirmationGrammar).disposition,
      ConfirmationParseDisposition.DECLINE,
    );
  }
  for (const message of ['取消', '确认 ', ' 确认', '好的', '\ud800']) {
    assert.equal(
      parseM26Confirmation(message, policies.confirmationGrammar).disposition,
      ConfirmationParseDisposition.UNCLEAR,
    );
  }
});
