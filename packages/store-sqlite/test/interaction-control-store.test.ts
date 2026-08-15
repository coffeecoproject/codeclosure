import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  auditEventId,
  commandId,
  createGoal,
  createWorkflow,
  decodeFrontstageContextManifest,
  decodeDirectActionGrammar,
  decodeFocusBinding,
  decodeInteractionMessage,
  decodeInteractionOperation,
  decodeInteractionActionReservation,
  decodeInteractionMessageHandoff,
  decodePendingAction,
  decodePendingActionResolution,
  decodeInteractionRoutingPolicy,
  decodeInteractionSession,
  decodeRouteDecision,
  decodeRouteProposal,
  directActionGrammarProjection,
  focusBindingId,
  focusBindingProjection,
  goalId,
  goalRevision,
  frontstageContextManifestId,
  frontstageContextManifestProjection,
  FrontstageContextOmissionReason,
  FrontstageContextOmissionSourceClass,
  FrontstageNoActionReason,
  FrontstageProposalKind,
  InteractionContentRetention,
  InteractionFocusKind,
  InteractionMessageRole,
  InteractionMessageHandoffKind,
  InteractionOperationFailureReason,
  InteractionOperationKind,
  InteractionOperationResultKind,
  InteractionOperationState,
  InteractionConfirmationRequirement,
  InteractionActionOutcomeDisposition,
  InteractionPublicCapability,
  PendingActionDerivation,
  PendingActionKind,
  PendingActionResolutionDisposition,
  InteractionRouteDecisionOutcome,
  InteractionRouteDecisionSource,
  InteractionSessionState,
  interactionRoutingPolicyProjection,
  interactionMessageId,
  interactionMessageProjection,
  interactionOperationId,
  interactionOperationProjection,
  interactionOperationVersion,
  interactionActionReservationId,
  interactionActionReservationProjection,
  interactionActionOutcomeId,
  interactionMessageHandoffId,
  interactionMessageHandoffProjection,
  interactionSessionId,
  interactionSessionProjection,
  interactionSessionVersion,
  isoTimestamp,
  principalId,
  pendingActionId,
  pendingActionProjection,
  pendingActionResolutionId,
  pendingActionResolutionProjection,
  routeDecisionId,
  routeDecisionProjection,
  routeProposalId,
  routeProposalProjection,
  successCriterionId,
  workflowId,
  decideWorkflow,
  type CompletedInteractionOperation,
  type AuthorizedIntakeActionMessageHandoff,
  type InteractionActionReservation,
  type FocusBinding,
  type FocusBindingProjectionInput,
  type FrontstageContextManifest,
  type FrontstageContextManifestId,
  type FrontstageContextManifestProjectionInput,
  type InteractionMessage,
  type RetainedInteractionMessage,
  type InteractionMessageHandoffProjectionInput,
  type InteractionOperationProjectionInput,
  type PendingAction,
  type PendingActionProjectionInput,
  type PendingActionResolution,
  type PendingActionResolutionProjectionInput,
  type ReservedInteractionOperation,
  type InteractionSessionProjectionInput,
  type InteractionSession,
  type WorkflowInstance,
  type RouteDecision,
  type RouteDecisionId,
  type RouteDecisionProjectionInput,
  type RouteProposal,
  type RouteProposalId,
  type RouteProposalProjectionInput,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  InteractionAuditAggregateType,
  InteractionAuditEventType,
  InteractionPublicOutcomeRetentionState,
  RuntimeErrorCode,
  createM26InteractionPolicies,
  goalAndWorkflowCreationPayloadProjection,
  type AdmitInteractionUserMessage,
  type CompanionFreeReservedInteractionOperation,
  type CommitInteractionRouteResult,
  type CommitInteractionPendingActionProposal,
  type CommitInteractionActionConfirmation,
  type CommitAuthorizedIntakeActionHandoff,
  type CreateInteractionSession,
  type FailedOrInterruptedInteractionOperation,
  type InstallInteractionPolicies,
  type ReserveAssistantRouteOperation,
  type InteractionAuditWrite,
  type InteractionPolicySet,
  type ReserveInteractionOperation,
  type RecordInteractionFocusBinding,
  type RecordInteractionPendingActionTerminalResolution,
  type TerminalizeInteractionOperation,
  type TransitionInteractionSession,
} from '@codeclosure/runtime';
import {
  InteractionTransactionStep,
  SqliteControlStore,
  applyMigrations,
  defaultMigrationsDirectory,
} from '@codeclosure/store-sqlite';

const digests = new CanonicalJsonSha256DigestProvider();
const INSTALLED_AT = isoTimestamp('2026-08-14T01:00:00.000Z');

function fixtureIdentifierSuffix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function createInteractionAuditWrite(
  suffix: string,
  part: string,
  aggregateType: InteractionAuditWrite['aggregateType'],
  aggregateId: string,
  eventType: InteractionAuditWrite['eventType'],
  payloadDigest: InteractionAuditWrite['payloadDigest'],
  occurredAt: InteractionAuditWrite['occurredAt'],
  beforeVersion?: number,
  afterVersion?: number,
): InteractionAuditWrite {
  return Object.freeze({
    id: auditEventId(
      `audit_interaction-${fixtureIdentifierSuffix(suffix)}-${fixtureIdentifierSuffix(part)}`,
    ),
    aggregateType,
    aggregateId,
    eventType,
    payloadDigest,
    occurredAt,
    ...(beforeVersion === undefined ? {} : { beforeVersion }),
    ...(afterVersion === undefined ? {} : { afterVersion }),
  });
}

function decodeSessionProjection(base: InteractionSessionProjectionInput): InteractionSession {
  return decodeInteractionSession(
    { ...base, sessionDigest: digests.digest(interactionSessionProjection(base)) },
    digests,
  );
}

function temporaryDatabase(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-interaction-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'authority.sqlite');
}

function installInput(policies: InteractionPolicySet): InstallInteractionPolicies {
  const audit = (
    suffix: string,
    aggregateId: string,
    payloadDigest: InteractionPolicySet['directActionGrammar']['digest'],
  ) =>
    Object.freeze({
      id: auditEventId(`audit_interaction-policy-${suffix}`),
      aggregateType: InteractionAuditAggregateType.INTERACTION_POLICY,
      aggregateId,
      eventType: InteractionAuditEventType.INTERACTION_POLICY_INSTALLED,
      payloadDigest,
      occurredAt: INSTALLED_AT,
    });
  return Object.freeze({
    policies,
    installedAt: INSTALLED_AT,
    auditWrites: Object.freeze({
      directActionGrammar: audit(
        'direct-action',
        policies.directActionGrammar.id,
        policies.directActionGrammar.digest,
      ),
      confirmationGrammar: audit(
        'confirmation-grammar',
        policies.confirmationGrammar.id,
        policies.confirmationGrammar.digest,
      ),
      routingPolicy: audit('routing', policies.routingPolicy.id, policies.routingPolicy.digest),
      confirmationPolicy: audit(
        'confirmation-policy',
        policies.confirmationPolicy.id,
        policies.confirmationPolicy.digest,
      ),
    }),
  });
}

function createReadyGoalAuthority(store: SqliteControlStore, suffix: string): WorkflowInstance {
  const createdAt = isoTimestamp('2026-08-14T00:59:00.000Z');
  const goal = createGoal({
    id: goalId(`goal_${fixtureIdentifierSuffix(suffix)}`),
    revision: goalRevision(1),
    objective: `Exercise ${suffix} public outcome authority`,
    successCriteria: [
      {
        id: successCriterionId(`criterion_${fixtureIdentifierSuffix(suffix)}`),
        description: 'The retained public command remains exact',
        required: true,
      },
    ],
    scope: {
      projectPath: `/fixture/frontstage/${suffix}`,
      allowedPaths: ['src/**'],
    },
    nonGoals: ['worker execution'],
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_${fixtureIdentifierSuffix(suffix)}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  const result = store.createGoalWithWorkflow({
    commandId: commandId(`command_create-${fixtureIdentifierSuffix(suffix)}`),
    inputDigest: digests.digest({ kind: 'create-goal', suffix }),
    goal,
    workflow,
    auditEventId: auditEventId(`audit_goal-create-${fixtureIdentifierSuffix(suffix)}`),
    workflowAuditEventId: auditEventId(`audit_workflow-create-${fixtureIdentifierSuffix(suffix)}`),
    payloadDigest: digests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow)),
  });
  assert.equal(result.status, 'APPLIED');
  return workflow;
}

function createInitialSession(
  policies: InteractionPolicySet,
  suffix: string,
  options: Readonly<{ idSuffix?: string; projectSuffix?: string }> = {},
): InteractionSession {
  const idSuffix = fixtureIdentifierSuffix(options.idSuffix ?? suffix);
  const id = interactionSessionId(`interaction-session_${idSuffix}`);
  const projectPath = `/fixture/frontstage/${options.projectSuffix ?? suffix}`;
  const configuration = Object.freeze({
    id: 'codeclosure-m2-6-frontstage-configuration',
    version: 'codeclosure-m2-6-frontstage-configuration-v1',
    digest: digests.digest({ kind: 'frontstage-configuration', version: 1 }),
  });
  const retentionProfile = Object.freeze({
    id: 'codeclosure-m2-6-frontstage-retention',
    version: 'codeclosure-m2-6-frontstage-retention-v1',
    digest: digests.digest({ kind: 'frontstage-retention', version: 1 }),
  });
  const base = {
    id,
    schemaVersion: 1 as const,
    version: interactionSessionVersion(1),
    principalRef: principalId('principal_frontstage-fixture'),
    projectRef: Object.freeze({
      schemaVersion: 1 as const,
      normalizedPath: projectPath,
      identityDigest: digests.digest({ projectPath }),
    }),
    state: InteractionSessionState.OPEN,
    configuration,
    routingPolicy: Object.freeze({
      id: policies.routingPolicy.id,
      version: policies.routingPolicy.version,
      digest: policies.routingPolicy.digest,
    }),
    confirmationPolicy: Object.freeze({
      id: policies.confirmationPolicy.id,
      version: policies.confirmationPolicy.version,
      digest: policies.confirmationPolicy.digest,
    }),
    retentionProfile,
    openedAt: INSTALLED_AT,
    updatedAt: INSTALLED_AT,
  } satisfies InteractionSessionProjectionInput;
  return decodeSessionProjection(base);
}

function transitionSession(
  current: InteractionSession,
  state: InteractionSession['state'],
  updatedAt: string,
): InteractionSession {
  const common = {
    id: current.id,
    schemaVersion: 1 as const,
    version: interactionSessionVersion(current.version + 1),
    principalRef: current.principalRef,
    projectRef: current.projectRef,
    configuration: current.configuration,
    routingPolicy: current.routingPolicy,
    confirmationPolicy: current.confirmationPolicy,
    retentionProfile: current.retentionProfile,
    ...(current.currentFocusRef === undefined ? {} : { currentFocusRef: current.currentFocusRef }),
    openedAt: current.openedAt,
    updatedAt: isoTimestamp(updatedAt),
  };
  if (state === InteractionSessionState.INTERRUPTED) {
    return decodeSessionProjection({ ...common, state: InteractionSessionState.INTERRUPTED });
  }
  if (state === InteractionSessionState.CLOSED) {
    return decodeSessionProjection({ ...common, state: InteractionSessionState.CLOSED });
  }
  return decodeSessionProjection({ ...common, state });
}

function createNoFocusBinding(
  session: InteractionSession,
  suffix: string,
  createdAt = '2026-08-14T01:00:01.000Z',
): FocusBinding {
  const base = {
    id: focusBindingId(`focus-binding_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: session.id,
    basedOnSessionVersion: session.version,
    kind: InteractionFocusKind.NONE,
    createdAt: isoTimestamp(createdAt),
  } satisfies FocusBindingProjectionInput;
  return decodeFocusBinding(
    { ...base, focusDigest: digests.digest(focusBindingProjection(base)) },
    digests,
  );
}

function applyFocusToSession(current: InteractionSession, focus: FocusBinding): InteractionSession {
  return decodeSessionProjection({
    id: current.id,
    schemaVersion: 1,
    version: interactionSessionVersion(current.version + 1),
    principalRef: current.principalRef,
    projectRef: current.projectRef,
    state: InteractionSessionState.OPEN,
    configuration: current.configuration,
    routingPolicy: current.routingPolicy,
    confirmationPolicy: current.confirmationPolicy,
    retentionProfile: current.retentionProfile,
    currentFocusRef: Object.freeze({ id: focus.id, digest: focus.focusDigest }),
    openedAt: current.openedAt,
    updatedAt: focus.createdAt,
  });
}

function createFocusBindingRecordInput(
  currentSession: InteractionSession,
  focus: FocusBinding,
  nextSession: InteractionSession,
  suffix: string,
): RecordInteractionFocusBinding {
  const auditSuffix = fixtureIdentifierSuffix(suffix);
  return Object.freeze({
    currentSession,
    focus,
    nextSession,
    focusAuditWrite: Object.freeze({
      id: auditEventId(`audit_interaction-focus-${auditSuffix}`),
      aggregateType: InteractionAuditAggregateType.FOCUS_BINDING,
      aggregateId: focus.id,
      eventType: InteractionAuditEventType.FOCUS_BINDING_RECORDED,
      payloadDigest: focus.focusDigest,
      occurredAt: focus.createdAt,
    }),
    sessionAuditWrite: Object.freeze({
      id: auditEventId(`audit_interaction-focus-session-${auditSuffix}`),
      aggregateType: InteractionAuditAggregateType.INTERACTION_SESSION,
      aggregateId: nextSession.id,
      eventType: InteractionAuditEventType.INTERACTION_SESSION_TRANSITIONED,
      payloadDigest: nextSession.sessionDigest,
      occurredAt: nextSession.updatedAt,
      beforeVersion: currentSession.version,
      afterVersion: nextSession.version,
    }),
  });
}

function createUserMessage(
  session: InteractionSession,
  suffix: string,
  content: string,
  createdAt: string,
): RetainedInteractionMessage {
  const retainedAt = isoTimestamp(createdAt);
  const id = interactionMessageId(`interaction-message_${fixtureIdentifierSuffix(suffix)}`);
  const base = {
    id,
    schemaVersion: 1 as const,
    sessionId: session.id,
    principalRef: session.principalRef,
    role: InteractionMessageRole.USER,
    retention: InteractionContentRetention.RETAINED,
    content,
    contentDigest: digests.digestUtf8(content),
    contentByteLength: Buffer.byteLength(content, 'utf8'),
    createdAt: retainedAt,
  };
  const message = decodeInteractionMessage(
    { ...base, messageDigest: digests.digest(interactionMessageProjection(base)) },
    digests,
  );
  if (message.retention !== InteractionContentRetention.RETAINED) {
    throw new TypeError('Fixture user Message must retain its exact content');
  }
  return message;
}

function createSessionInput(session: InteractionSession, suffix: string): CreateInteractionSession {
  const auditSuffix = fixtureIdentifierSuffix(suffix);
  return Object.freeze({
    session,
    auditWrite: Object.freeze({
      id: auditEventId(`audit_interaction-session-opened-${auditSuffix}`),
      aggregateType: InteractionAuditAggregateType.INTERACTION_SESSION,
      aggregateId: session.id,
      eventType: InteractionAuditEventType.INTERACTION_SESSION_OPENED,
      payloadDigest: session.sessionDigest,
      occurredAt: session.openedAt,
      afterVersion: session.version,
    }),
  });
}

function createSessionTransitionInput(
  currentSession: InteractionSession,
  nextSession: InteractionSession,
  suffix: string,
): TransitionInteractionSession {
  const auditSuffix = fixtureIdentifierSuffix(suffix);
  return Object.freeze({
    currentSession,
    nextSession,
    auditWrite: Object.freeze({
      id: auditEventId(`audit_interaction-session-transition-${auditSuffix}`),
      aggregateType: InteractionAuditAggregateType.INTERACTION_SESSION,
      aggregateId: nextSession.id,
      eventType: InteractionAuditEventType.INTERACTION_SESSION_TRANSITIONED,
      payloadDigest: nextSession.sessionDigest,
      occurredAt: nextSession.updatedAt,
      beforeVersion: currentSession.version,
      afterVersion: nextSession.version,
    }),
  });
}

function createUserMessageAdmissionInput(
  currentSession: InteractionSession,
  message: InteractionMessage,
  nextSession: InteractionSession,
  suffix: string,
): AdmitInteractionUserMessage {
  const auditSuffix = fixtureIdentifierSuffix(suffix);
  const messageAuditWrite: InteractionAuditWrite = Object.freeze({
    id: auditEventId(`audit_interaction-message-admitted-${auditSuffix}`),
    aggregateType: InteractionAuditAggregateType.INTERACTION_MESSAGE,
    aggregateId: message.id,
    eventType: InteractionAuditEventType.INTERACTION_MESSAGE_ADMITTED,
    payloadDigest: message.messageDigest,
    occurredAt: message.createdAt,
  });
  const sessionAuditWrite: InteractionAuditWrite = Object.freeze({
    id: auditEventId(`audit_interaction-session-message-${auditSuffix}`),
    aggregateType: InteractionAuditAggregateType.INTERACTION_SESSION,
    aggregateId: nextSession.id,
    eventType: InteractionAuditEventType.INTERACTION_SESSION_TRANSITIONED,
    payloadDigest: nextSession.sessionDigest,
    occurredAt: nextSession.updatedAt,
    beforeVersion: currentSession.version,
    afterVersion: nextSession.version,
  });
  return Object.freeze({
    currentSession,
    message,
    nextSession,
    messageAuditWrite,
    sessionAuditWrite,
  });
}

function decodeOperationProjection(
  base: InteractionOperationProjectionInput,
): ReturnType<typeof decodeInteractionOperation> {
  return decodeInteractionOperation(
    { ...base, operationDigest: digests.digest(interactionOperationProjection(base)) },
    digests,
  );
}

function assertCompanionFreeReservedFixtureOperation(
  operation: ReturnType<typeof decodeInteractionOperation>,
): asserts operation is CompanionFreeReservedInteractionOperation {
  if (
    operation.state !== InteractionOperationState.RESERVED ||
    operation.operationKind === InteractionOperationKind.INTAKE_CLARIFICATION ||
    operation.contextManifestRef !== undefined ||
    operation.assistantProfile !== undefined
  ) {
    throw new TypeError('Fixture Operation did not remain companion-free and reserved');
  }
}

function createReservedOperation(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
  reservedAt?: string,
): CompanionFreeReservedInteractionOperation;
function createReservedOperation(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
  reservedAt: string,
  assistantBinding: Readonly<{
    contextManifestRef: NonNullable<ReservedInteractionOperation['contextManifestRef']>;
    assistantProfile: NonNullable<ReservedInteractionOperation['assistantProfile']>;
  }>,
): ReservedInteractionOperation;
function createReservedOperation(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
  reservedAt = '2026-08-14T01:00:02.000Z',
  assistantBinding?: Readonly<{
    contextManifestRef: NonNullable<ReservedInteractionOperation['contextManifestRef']>;
    assistantProfile: NonNullable<ReservedInteractionOperation['assistantProfile']>;
  }>,
): ReservedInteractionOperation {
  const base = {
    id: interactionOperationId(`interaction-operation_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: Object.freeze({ id: message.id, digest: message.messageDigest }),
    operationKind: InteractionOperationKind.ROUTE,
    ...(assistantBinding ?? {}),
    state: InteractionOperationState.RESERVED,
    reservedAt: isoTimestamp(reservedAt),
  } satisfies InteractionOperationProjectionInput;
  const operation = decodeOperationProjection(base);
  if (operation.state !== InteractionOperationState.RESERVED) {
    throw new TypeError('Fixture Operation did not remain reserved');
  }
  return operation;
}

function createReservedClarificationOperation(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
): ReservedInteractionOperation {
  const base = {
    id: interactionOperationId(`interaction-operation_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: Object.freeze({ id: message.id, digest: message.messageDigest }),
    operationKind: InteractionOperationKind.INTAKE_CLARIFICATION,
    state: InteractionOperationState.RESERVED,
    reservedAt: isoTimestamp('2026-08-14T01:00:02.000Z'),
  } satisfies InteractionOperationProjectionInput;
  const operation = decodeOperationProjection(base);
  if (operation.state !== InteractionOperationState.RESERVED) {
    throw new TypeError('Fixture Clarification Operation did not remain reserved');
  }
  return operation;
}

function createAssistantRouteReservation(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
  reservedAt = '2026-08-14T01:00:02.000Z',
  assistantProfileVersion = 'frontstage-assistant-profile-v1',
  manifestIdentifier?: FrontstageContextManifestId,
): Readonly<{
  manifest: FrontstageContextManifest;
  operation: ReservedInteractionOperation;
}> {
  const operationId = interactionOperationId(
    `interaction-operation_${fixtureIdentifierSuffix(suffix)}`,
  );
  const assistantProfile = Object.freeze({
    id: `frontstage-assistant-profile_${fixtureIdentifierSuffix(suffix)}`,
    version: assistantProfileVersion,
    digest: digests.digest({ suffix, assistantProfileVersion }),
  });
  const manifestBase = {
    id:
      manifestIdentifier ??
      frontstageContextManifestId(`frontstage-context-manifest_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: session.id,
    operationId,
    reservedOperationVersion: interactionOperationVersion(1),
    currentMessageRef: { id: message.id, digest: message.messageDigest },
    currentMessageContentDigest: message.contentDigest,
    currentMessageContentByteLength: message.contentByteLength,
    selectedPriorMessages: [],
    ...(session.currentFocusRef === undefined ? {} : { focusRef: session.currentFocusRef }),
    selectedGoalSummaries: [],
    omissions: [
      {
        sourceClass: FrontstageContextOmissionSourceClass.PRIOR_MESSAGE,
        reasonCode: FrontstageContextOmissionReason.NOT_PRESENT,
        omittedSourceDigests: [],
      },
      ...(session.currentFocusRef === undefined
        ? [
            {
              sourceClass: FrontstageContextOmissionSourceClass.FOCUS,
              reasonCode: FrontstageContextOmissionReason.NOT_PRESENT,
              omittedSourceDigests: [],
            } as const,
          ]
        : []),
      {
        sourceClass: FrontstageContextOmissionSourceClass.GOAL_SUMMARY,
        reasonCode: FrontstageContextOmissionReason.NOT_PRESENT,
        omittedSourceDigests: [],
      },
      {
        sourceClass: FrontstageContextOmissionSourceClass.ACTIVE_INTAKE_QUESTION,
        reasonCode: FrontstageContextOmissionReason.NOT_PRESENT,
        omittedSourceDigests: [],
      },
    ],
    configuration: session.configuration,
    contextCompiler: {
      id: 'frontstage-context-compiler_fixture',
      version: 'frontstage-context-compiler-v1',
      digest: digests.digest({ contextCompiler: 'v1' }),
    },
    assistantProfile,
    assistantAdapter: {
      id: 'frontstage-assistant-adapter_fixture',
      version: 'frontstage-assistant-adapter-v1',
      digest: digests.digest({ assistantAdapter: 'v1' }),
    },
    responseContract: {
      id: 'frontstage-response-contract_fixture',
      version: 'frontstage-response-contract-v1',
      digest: digests.digest({ responseContract: 'v1' }),
    },
    routingPolicy: session.routingPolicy,
    retentionProfile: session.retentionProfile,
    budgetProfile: {
      id: 'frontstage-context-budget_fixture',
      version: 'frontstage-context-budget-v1',
      digest: digests.digest({ budgetProfile: 'v1' }),
    },
    packageDigest: digests.digest({ package: suffix, assistantProfileVersion }),
    packageByteLength: 256,
    createdAt: message.createdAt,
  } satisfies FrontstageContextManifestProjectionInput;
  const manifest = decodeFrontstageContextManifest(
    {
      ...manifestBase,
      manifestDigest: digests.digest(frontstageContextManifestProjection(manifestBase)),
    },
    digests,
  );
  const operation = createReservedOperation(session, message, suffix, reservedAt, {
    contextManifestRef: { id: manifest.id, digest: manifest.manifestDigest },
    assistantProfile,
  });
  return Object.freeze({ manifest, operation });
}

function createAssistantRouteReservationInput(
  session: InteractionSession,
  message: InteractionMessage,
  reservation: Readonly<{
    manifest: FrontstageContextManifest;
    operation: ReservedInteractionOperation;
  }>,
  suffix: string,
  focus?: FocusBinding,
): ReserveAssistantRouteOperation {
  return Object.freeze({
    session,
    message,
    ...(focus === undefined ? {} : { focus }),
    manifest: reservation.manifest,
    operation: reservation.operation,
    manifestAuditWrite: createInteractionAuditWrite(
      suffix,
      'context-manifest',
      InteractionAuditAggregateType.FRONTSTAGE_CONTEXT_MANIFEST,
      reservation.manifest.id,
      InteractionAuditEventType.FRONTSTAGE_CONTEXT_MANIFEST_RECORDED,
      reservation.manifest.manifestDigest,
      reservation.manifest.createdAt,
    ),
    operationAuditWrite: createInteractionAuditWrite(
      suffix,
      'operation-reserved',
      InteractionAuditAggregateType.INTERACTION_OPERATION,
      reservation.operation.id,
      InteractionAuditEventType.INTERACTION_OPERATION_RESERVED,
      reservation.operation.operationDigest,
      reservation.operation.reservedAt,
      undefined,
      reservation.operation.version,
    ),
  });
}

function createAssistantNoActionProposal(
  reservation: Readonly<{
    manifest: FrontstageContextManifest;
    operation: ReservedInteractionOperation;
  }>,
  suffix: string,
  observedAt = '2026-08-14T01:00:02.500Z',
  proposalIdentifier?: RouteProposalId,
): RouteProposal {
  const base = {
    id: proposalIdentifier ?? routeProposalId(`route-proposal_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: reservation.operation.sessionId,
    operationId: reservation.operation.id,
    messageRef: reservation.operation.messageRef,
    contextManifestRef: {
      id: reservation.manifest.id,
      digest: reservation.manifest.manifestDigest,
    },
    assistantProfile: reservation.manifest.assistantProfile,
    assistantAdapter: reservation.manifest.assistantAdapter,
    responseContract: reservation.manifest.responseContract,
    kind: FrontstageProposalKind.NO_ACTION_PROPOSAL,
    reasonCode: FrontstageNoActionReason.NO_SAFE_PROPOSAL,
    observedAt: isoTimestamp(observedAt),
  } satisfies RouteProposalProjectionInput;
  return decodeRouteProposal(
    { ...base, proposalDigest: digests.digest(routeProposalProjection(base)) },
    digests,
  );
}

function createRouteDecision(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
  proposal?: RouteProposal,
  focus?: FocusBinding,
  decidedAt = '2026-08-14T01:00:03.000Z',
  decisionIdentifier?: RouteDecisionId,
): RouteDecision {
  const common = {
    id: decisionIdentifier ?? routeDecisionId(`route-decision_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: { id: message.id, digest: message.messageDigest },
    ...(focus === undefined ? {} : { focusRef: { id: focus.id, digest: focus.focusDigest } }),
    ...(proposal === undefined
      ? { source: InteractionRouteDecisionSource.READ_ONLY_GOAL_QUERY }
      : {
          proposalRef: { id: proposal.id, digest: proposal.proposalDigest },
          source: InteractionRouteDecisionSource.ASSISTANT_PROPOSAL,
        }),
    routingPolicy: session.routingPolicy,
    allowedRoutes: [
      proposal === undefined
        ? InteractionRouteDecisionOutcome.LIST_GOALS
        : InteractionRouteDecisionOutcome.NO_ACTION,
    ],
    reasonTrace: [
      {
        ruleId: 'fixture-route-result',
        policyDigest: session.routingPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [message.messageDigest],
      },
    ],
    ...(proposal === undefined
      ? { outcome: InteractionRouteDecisionOutcome.LIST_GOALS }
      : {
          outcome: InteractionRouteDecisionOutcome.NO_ACTION,
          reasonCode: FrontstageNoActionReason.NO_SAFE_PROPOSAL,
        }),
    decidedAt: isoTimestamp(decidedAt),
  } satisfies RouteDecisionProjectionInput;
  return decodeRouteDecision(
    { ...common, decisionDigest: digests.digest(routeDecisionProjection(common)) },
    digests,
  );
}

function createAnswerRouteDecision(
  session: InteractionSession,
  message: InteractionMessage,
  proposal: RouteProposal,
  suffix: string,
): RouteDecision {
  const base = {
    id: routeDecisionId(`route-decision_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: { id: message.id, digest: message.messageDigest },
    proposalRef: { id: proposal.id, digest: proposal.proposalDigest },
    source: InteractionRouteDecisionSource.ASSISTANT_PROPOSAL,
    routingPolicy: session.routingPolicy,
    allowedRoutes: [InteractionRouteDecisionOutcome.ANSWER],
    reasonTrace: [
      {
        ruleId: 'fixture-answer-route-result',
        policyDigest: session.routingPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [message.messageDigest, proposal.proposalDigest],
      },
    ],
    outcome: InteractionRouteDecisionOutcome.ANSWER,
    answerProposalRef: { id: proposal.id, digest: proposal.proposalDigest },
    decidedAt: isoTimestamp('2026-08-14T01:00:03.000Z'),
  } satisfies RouteDecisionProjectionInput;
  return decodeRouteDecision(
    { ...base, decisionDigest: digests.digest(routeDecisionProjection(base)) },
    digests,
  );
}

function completeRouteOperation(
  operation: ReservedInteractionOperation,
  decision: RouteDecision,
  proposal?: RouteProposal,
  completedAt = '2026-08-14T01:00:03.500Z',
): CompletedInteractionOperation {
  const base = {
    id: operation.id,
    schemaVersion: operation.schemaVersion,
    version: interactionOperationVersion(operation.version + 1),
    sessionId: operation.sessionId,
    expectedSessionVersion: operation.expectedSessionVersion,
    messageRef: operation.messageRef,
    operationKind: operation.operationKind,
    ...(operation.contextManifestRef === undefined
      ? {}
      : { contextManifestRef: operation.contextManifestRef }),
    ...(operation.assistantProfile === undefined
      ? {}
      : { assistantProfile: operation.assistantProfile }),
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef: { id: decision.id, digest: decision.decisionDigest },
      ...(proposal === undefined
        ? {}
        : { routeProposalRef: { id: proposal.id, digest: proposal.proposalDigest } }),
    },
    reservedAt: operation.reservedAt,
    completedAt: isoTimestamp(completedAt),
  } satisfies InteractionOperationProjectionInput;
  const completed = decodeOperationProjection(base);
  if (completed.state !== InteractionOperationState.COMPLETED) {
    throw new TypeError('Fixture Route Operation did not complete');
  }
  return completed;
}

function createRouteResultCommitInput(
  session: InteractionSession,
  message: InteractionMessage,
  currentOperation: ReservedInteractionOperation,
  decision: RouteDecision,
  nextOperation: CompletedInteractionOperation,
  suffix: string,
  options: Readonly<{
    focus?: FocusBinding;
    manifest?: FrontstageContextManifest;
    proposal?: RouteProposal;
  }> = {},
): CommitInteractionRouteResult {
  return Object.freeze({
    session,
    message,
    ...(options.focus === undefined ? {} : { focus: options.focus }),
    ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
    currentOperation,
    ...(options.proposal === undefined ? {} : { proposal: options.proposal }),
    decision,
    nextOperation,
    ...(options.proposal === undefined
      ? {}
      : {
          proposalAuditWrite: createInteractionAuditWrite(
            suffix,
            'route-proposal',
            InteractionAuditAggregateType.ROUTE_PROPOSAL,
            options.proposal.id,
            InteractionAuditEventType.ROUTE_PROPOSAL_RECORDED,
            options.proposal.proposalDigest,
            options.proposal.observedAt,
          ),
        }),
    decisionAuditWrite: createInteractionAuditWrite(
      suffix,
      'route-decision',
      InteractionAuditAggregateType.ROUTE_DECISION,
      decision.id,
      InteractionAuditEventType.ROUTE_DECISION_RECORDED,
      decision.decisionDigest,
      decision.decidedAt,
    ),
    operationAuditWrite: createInteractionAuditWrite(
      suffix,
      'route-completed',
      InteractionAuditAggregateType.INTERACTION_OPERATION,
      nextOperation.id,
      InteractionAuditEventType.INTERACTION_OPERATION_COMPLETED,
      nextOperation.operationDigest,
      nextOperation.completedAt,
      currentOperation.version,
      nextOperation.version,
    ),
  });
}

function createActionRouteDecision(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
  decidedAt = '2026-08-14T01:00:03.000Z',
): RouteDecision {
  const base = {
    id: routeDecisionId(`route-decision_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: { id: message.id, digest: message.messageDigest },
    source: InteractionRouteDecisionSource.DIRECT_ACTION,
    routingPolicy: session.routingPolicy,
    allowedRoutes: [InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION],
    reasonTrace: [
      {
        ruleId: 'fixture-direct-intake-action',
        policyDigest: session.routingPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [message.messageDigest],
      },
    ],
    outcome: InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION,
    actionKind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
    decidedAt: isoTimestamp(decidedAt),
  } satisfies RouteDecisionProjectionInput;
  return decodeRouteDecision(
    { ...base, decisionDigest: digests.digest(routeDecisionProjection(base)) },
    digests,
  );
}

function createCancelGoalRouteDecision(
  session: InteractionSession,
  message: InteractionMessage,
  workflow: WorkflowInstance,
  suffix: string,
): RouteDecision {
  const base = {
    id: routeDecisionId(`route-decision_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: { id: message.id, digest: message.messageDigest },
    source: InteractionRouteDecisionSource.DIRECT_ACTION,
    routingPolicy: session.routingPolicy,
    allowedRoutes: [InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL],
    reasonTrace: [
      {
        ruleId: 'fixture-direct-cancel-goal',
        policyDigest: session.routingPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [message.messageDigest],
      },
    ],
    outcome: InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL,
    actionKind: PendingActionKind.CANCEL_GOAL,
    goalTarget: {
      goalId: workflow.goalId,
      goalRevision: workflow.goalRevision,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
    },
    decidedAt: isoTimestamp('2026-08-14T01:00:03.000Z'),
  } satisfies RouteDecisionProjectionInput;
  return decodeRouteDecision(
    { ...base, decisionDigest: digests.digest(routeDecisionProjection(base)) },
    digests,
  );
}

function createReservedActionOperation(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
  operationKind:
    | typeof InteractionOperationKind.ACTION_PROPOSAL
    | typeof InteractionOperationKind.ACTION_CONFIRMATION,
  reservedAt: string,
): CompanionFreeReservedInteractionOperation {
  const base = {
    id: interactionOperationId(`interaction-operation_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: { id: message.id, digest: message.messageDigest },
    operationKind,
    state: InteractionOperationState.RESERVED,
    reservedAt: isoTimestamp(reservedAt),
  } satisfies InteractionOperationProjectionInput;
  const operation = decodeOperationProjection(base);
  assertCompanionFreeReservedFixtureOperation(operation);
  if (
    operation.operationKind !== InteractionOperationKind.ACTION_PROPOSAL &&
    operation.operationKind !== InteractionOperationKind.ACTION_CONFIRMATION
  ) {
    throw new TypeError('Fixture Action Operation did not remain reserved');
  }
  return operation;
}

function createPendingAction(
  session: InteractionSession,
  message: InteractionMessage,
  decision: RouteDecision,
  suffix: string,
  confirmationRequirement: InteractionConfirmationRequirement,
  timestamps: Readonly<{ createdAt?: string; expiresAt?: string }> = {},
): PendingAction {
  const base = {
    id: pendingActionId(`pending-action_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: session.id,
    principalRef: session.principalRef,
    projectRef: session.projectRef,
    originatingMessageRef: { id: message.id, digest: message.messageDigest },
    routeDecisionRef: { id: decision.id, digest: decision.decisionDigest },
    preallocatedCommandId: commandId(`command_${fixtureIdentifierSuffix(suffix)}`),
    canonicalCommandInputDigest: digests.digest({ kind: 'intake-command', suffix }),
    publicCapability: InteractionPublicCapability.SUBMIT_INTAKE,
    routingPolicy: session.routingPolicy,
    confirmationPolicy: session.confirmationPolicy,
    confirmationRequirement,
    reasonTrace: [
      ...decision.reasonTrace,
      {
        ruleId: 'fixture-confirmation-policy',
        policyDigest: session.confirmationPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [decision.decisionDigest],
      },
    ],
    kind: PendingActionKind.SUBMIT_GOVERNED_INTAKE,
    actionDerivation: PendingActionDerivation.ROUTED_ACTION,
    expiresAt: isoTimestamp(timestamps.expiresAt ?? '2026-08-14T01:00:10.000Z'),
    createdAt: isoTimestamp(timestamps.createdAt ?? '2026-08-14T01:00:04.000Z'),
  } satisfies PendingActionProjectionInput;
  return decodePendingAction(
    { ...base, pendingActionDigest: digests.digest(pendingActionProjection(base)) },
    digests,
  );
}

function createCancelGoalPendingAction(
  session: InteractionSession,
  message: InteractionMessage,
  decision: RouteDecision,
  workflow: WorkflowInstance,
  suffix: string,
): PendingAction {
  const base = {
    id: pendingActionId(`pending-action_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    sessionId: session.id,
    principalRef: session.principalRef,
    projectRef: session.projectRef,
    originatingMessageRef: { id: message.id, digest: message.messageDigest },
    routeDecisionRef: { id: decision.id, digest: decision.decisionDigest },
    preallocatedCommandId: commandId(`command_${fixtureIdentifierSuffix(suffix)}`),
    canonicalCommandInputDigest: digests.digest({ kind: 'cancel-goal-command', suffix }),
    publicCapability: InteractionPublicCapability.CANCEL_GOAL,
    routingPolicy: session.routingPolicy,
    confirmationPolicy: session.confirmationPolicy,
    confirmationRequirement: InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
    reasonTrace: [
      ...decision.reasonTrace,
      {
        ruleId: 'fixture-cancel-confirmation-policy',
        policyDigest: session.confirmationPolicy.digest,
        outcome: 'MATCHED' as const,
        inputDigests: [decision.decisionDigest],
      },
    ],
    kind: PendingActionKind.CANCEL_GOAL,
    actionDerivation: PendingActionDerivation.ROUTED_ACTION,
    goalTarget: {
      goalId: workflow.goalId,
      goalRevision: workflow.goalRevision,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
    },
    expiresAt: isoTimestamp('2026-08-14T01:00:10.000Z'),
    createdAt: isoTimestamp('2026-08-14T01:00:04.000Z'),
  } satisfies PendingActionProjectionInput;
  return decodePendingAction(
    { ...base, pendingActionDigest: digests.digest(pendingActionProjection(base)) },
    digests,
  );
}

function createPendingActionResolution(
  pendingAction: PendingAction,
  suffix: string,
  disposition: PendingActionResolution['disposition'],
  responseMessage?: InteractionMessage,
): PendingActionResolution {
  const common = {
    id: pendingActionResolutionId(`pending-action-resolution_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    pendingActionRef: { id: pendingAction.id, digest: pendingAction.pendingActionDigest },
    confirmationPolicy: pendingAction.confirmationPolicy,
  };
  const base =
    disposition === PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED
      ? ({
          ...common,
          disposition,
          authorizingMessageRef: pendingAction.originatingMessageRef,
          resolvedAt: isoTimestamp('2026-08-14T01:00:04.100Z'),
        } satisfies PendingActionResolutionProjectionInput)
      : disposition === PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
        ? ({
            ...common,
            disposition,
            originatingMessageRef: pendingAction.originatingMessageRef,
            authorizingMessageRef: {
              id: responseMessage?.id ?? interactionMessageId('interaction-message_missing'),
              digest:
                responseMessage?.messageDigest ?? digests.digest({ kind: 'missing-response' }),
            },
            resolvedAt: isoTimestamp('2026-08-14T01:00:07.000Z'),
          } satisfies PendingActionResolutionProjectionInput)
        : disposition === PendingActionResolutionDisposition.DECLINED ||
            disposition === PendingActionResolutionDisposition.UNCLEAR
          ? ({
              ...common,
              disposition,
              responseMessageRef: {
                id: responseMessage?.id ?? interactionMessageId('interaction-message_missing'),
                digest:
                  responseMessage?.messageDigest ?? digests.digest({ kind: 'missing-response' }),
              },
              resolvedAt: isoTimestamp('2026-08-14T01:00:07.000Z'),
            } satisfies PendingActionResolutionProjectionInput)
          : ({
              ...common,
              disposition,
              resolvedAt: isoTimestamp(
                disposition === PendingActionResolutionDisposition.EXPIRED
                  ? '2026-08-14T01:00:10.000Z'
                  : '2026-08-14T01:00:08.000Z',
              ),
            } satisfies PendingActionResolutionProjectionInput);
  return decodePendingActionResolution(
    { ...base, resolutionDigest: digests.digest(pendingActionResolutionProjection(base)) },
    digests,
  );
}

function createActionReservation(
  pendingAction: PendingAction,
  resolution: PendingActionResolution,
  suffix: string,
): InteractionActionReservation {
  const base = {
    id: interactionActionReservationId(
      `interaction-action-reservation_${fixtureIdentifierSuffix(suffix)}`,
    ),
    schemaVersion: 1 as const,
    pendingActionRef: { id: pendingAction.id, digest: pendingAction.pendingActionDigest },
    resolutionRef: { id: resolution.id, digest: resolution.resolutionDigest },
    publicCapability: pendingAction.publicCapability,
    commandId: pendingAction.preallocatedCommandId,
    canonicalCommandInputDigest: pendingAction.canonicalCommandInputDigest,
    reservedAt: isoTimestamp(
      resolution.disposition === PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED
        ? '2026-08-14T01:00:04.200Z'
        : '2026-08-14T01:00:07.100Z',
    ),
  };
  return decodeInteractionActionReservation(
    {
      ...base,
      reservationDigest: digests.digest(interactionActionReservationProjection(base)),
    },
    digests,
  );
}

function createReservedIntakeHandoffOperation(
  session: InteractionSession,
  message: InteractionMessage,
  suffix: string,
  reservedAt = '2026-08-14T01:00:04.600Z',
): CompanionFreeReservedInteractionOperation {
  const base = {
    id: interactionOperationId(`interaction-operation_${fixtureIdentifierSuffix(suffix)}`),
    schemaVersion: 1 as const,
    version: interactionOperationVersion(1),
    sessionId: session.id,
    expectedSessionVersion: session.version,
    messageRef: { id: message.id, digest: message.messageDigest },
    operationKind: InteractionOperationKind.INTAKE_HANDOFF,
    state: InteractionOperationState.RESERVED,
    reservedAt: isoTimestamp(reservedAt),
  } satisfies InteractionOperationProjectionInput;
  const operation = decodeOperationProjection(base);
  assertCompanionFreeReservedFixtureOperation(operation);
  if (operation.operationKind !== InteractionOperationKind.INTAKE_HANDOFF) {
    throw new TypeError('Fixture Intake Handoff Operation did not remain reserved');
  }
  return operation;
}

function createAuthorizedIntakeActionHandoff(
  session: InteractionSession,
  message: RetainedInteractionMessage,
  pendingAction: PendingAction,
  resolution: PendingActionResolution,
  reservation: InteractionActionReservation,
  suffix: string,
  createdAt = '2026-08-14T01:00:04.700Z',
): AuthorizedIntakeActionMessageHandoff {
  const base = {
    id: interactionMessageHandoffId(
      `interaction-message-handoff_${fixtureIdentifierSuffix(suffix)}`,
    ),
    schemaVersion: 1 as const,
    kind: InteractionMessageHandoffKind.AUTHORIZED_INTAKE_ACTION,
    sessionId: session.id,
    messageRef: { id: message.id, digest: message.messageDigest },
    pendingActionRef: { id: pendingAction.id, digest: pendingAction.pendingActionDigest },
    resolutionRef: { id: resolution.id, digest: resolution.resolutionDigest },
    reservationRef: { id: reservation.id, digest: reservation.reservationDigest },
    admittedUserContent: message.content,
    admittedContentDigest: message.contentDigest,
    intakeCommandId: reservation.commandId,
    createdAt: isoTimestamp(createdAt),
  } satisfies InteractionMessageHandoffProjectionInput;
  const handoff = decodeInteractionMessageHandoff(
    { ...base, handoffDigest: digests.digest(interactionMessageHandoffProjection(base)) },
    digests,
  );
  if (handoff.kind !== InteractionMessageHandoffKind.AUTHORIZED_INTAKE_ACTION) {
    throw new TypeError('Fixture did not create an authorized Intake Action Handoff');
  }
  return handoff;
}

function completeIntakeHandoffOperation(
  operation: ReservedInteractionOperation,
  handoff: AuthorizedIntakeActionMessageHandoff,
  completedAt = '2026-08-14T01:00:04.800Z',
): CompletedInteractionOperation {
  const base = {
    id: operation.id,
    schemaVersion: 1 as const,
    version: interactionOperationVersion(operation.version + 1),
    sessionId: operation.sessionId,
    expectedSessionVersion: operation.expectedSessionVersion,
    messageRef: operation.messageRef,
    operationKind: operation.operationKind,
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.INTAKE_HANDOFF_RECORDED,
      handoffRef: { id: handoff.id, digest: handoff.handoffDigest },
    },
    reservedAt: operation.reservedAt,
    completedAt: isoTimestamp(completedAt),
  } satisfies InteractionOperationProjectionInput;
  const completed = decodeOperationProjection(base);
  if (completed.state !== InteractionOperationState.COMPLETED) {
    throw new TypeError('Fixture Intake Handoff Operation did not complete');
  }
  return completed;
}

function createAuthorizedIntakeActionHandoffCommitInput(
  session: InteractionSession,
  operationMessage: InteractionMessage,
  originatingMessage: InteractionMessage,
  decision: RouteDecision,
  pendingAction: PendingAction,
  resolution: PendingActionResolution,
  reservation: InteractionActionReservation,
  handoff: AuthorizedIntakeActionMessageHandoff,
  operation: ReservedInteractionOperation,
  completedOperation: CompletedInteractionOperation,
  suffix: string,
  resolutionMessage?: InteractionMessage,
): CommitAuthorizedIntakeActionHandoff {
  return Object.freeze({
    session,
    operationMessage,
    originatingMessage,
    ...(resolutionMessage === undefined ? {} : { resolutionMessage }),
    routeDecision: decision,
    pendingAction,
    resolution,
    reservation,
    handoff,
    currentOperation: operation,
    nextOperation: completedOperation,
    handoffAuditWrite: createInteractionAuditWrite(
      suffix,
      'intake-handoff',
      InteractionAuditAggregateType.INTERACTION_MESSAGE_HANDOFF,
      handoff.id,
      InteractionAuditEventType.INTERACTION_MESSAGE_HANDOFF_RECORDED,
      handoff.handoffDigest,
      handoff.createdAt,
    ),
    operationAuditWrite: createInteractionAuditWrite(
      suffix,
      'intake-handoff-completed',
      InteractionAuditAggregateType.INTERACTION_OPERATION,
      completedOperation.id,
      InteractionAuditEventType.INTERACTION_OPERATION_COMPLETED,
      completedOperation.operationDigest,
      completedOperation.completedAt,
      operation.version,
      completedOperation.version,
    ),
  });
}

function completePendingActionProposalOperation(
  operation: ReservedInteractionOperation,
  pendingAction: PendingAction,
  completedAt = '2026-08-14T01:00:04.500Z',
): CompletedInteractionOperation {
  const base = {
    id: operation.id,
    schemaVersion: 1 as const,
    version: interactionOperationVersion(operation.version + 1),
    sessionId: operation.sessionId,
    expectedSessionVersion: operation.expectedSessionVersion,
    messageRef: operation.messageRef,
    operationKind: operation.operationKind,
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.PENDING_ACTION_RECORDED,
      pendingActionRef: { id: pendingAction.id, digest: pendingAction.pendingActionDigest },
    },
    reservedAt: operation.reservedAt,
    completedAt: isoTimestamp(completedAt),
  } satisfies InteractionOperationProjectionInput;
  const completed = decodeOperationProjection(base);
  if (completed.state !== InteractionOperationState.COMPLETED) {
    throw new TypeError('Fixture Action Proposal Operation did not complete');
  }
  return completed;
}

function completeActionConfirmationOperation(
  operation: ReservedInteractionOperation,
  resolution: PendingActionResolution,
  reservation?: InteractionActionReservation,
): CompletedInteractionOperation {
  const base = {
    id: operation.id,
    schemaVersion: 1 as const,
    version: interactionOperationVersion(operation.version + 1),
    sessionId: operation.sessionId,
    expectedSessionVersion: operation.expectedSessionVersion,
    messageRef: operation.messageRef,
    operationKind: operation.operationKind,
    state: InteractionOperationState.COMPLETED,
    result: {
      kind: InteractionOperationResultKind.ACTION_RESOLUTION_RECORDED,
      resolutionRef: { id: resolution.id, digest: resolution.resolutionDigest },
      ...(reservation === undefined
        ? {}
        : { reservationRef: { id: reservation.id, digest: reservation.reservationDigest } }),
    },
    reservedAt: operation.reservedAt,
    completedAt: isoTimestamp('2026-08-14T01:00:07.500Z'),
  } satisfies InteractionOperationProjectionInput;
  const completed = decodeOperationProjection(base);
  if (completed.state !== InteractionOperationState.COMPLETED) {
    throw new TypeError('Fixture Action Confirmation Operation did not complete');
  }
  return completed;
}

function createPendingActionProposalCommitInput(
  session: InteractionSession,
  message: InteractionMessage,
  decision: RouteDecision,
  pendingAction: PendingAction,
  currentOperation: ReservedInteractionOperation,
  nextOperation: CompletedInteractionOperation,
  suffix: string,
  resolution?: PendingActionResolution,
  reservation?: InteractionActionReservation,
): CommitInteractionPendingActionProposal {
  return Object.freeze({
    session,
    message,
    routeDecision: decision,
    pendingAction,
    ...(resolution === undefined ? {} : { resolution }),
    ...(reservation === undefined ? {} : { reservation }),
    currentOperation,
    nextOperation,
    pendingActionAuditWrite: createInteractionAuditWrite(
      suffix,
      'pending-action',
      InteractionAuditAggregateType.PENDING_ACTION,
      pendingAction.id,
      InteractionAuditEventType.PENDING_ACTION_RECORDED,
      pendingAction.pendingActionDigest,
      pendingAction.createdAt,
    ),
    ...(resolution === undefined
      ? {}
      : {
          resolutionAuditWrite: createInteractionAuditWrite(
            suffix,
            'resolution',
            InteractionAuditAggregateType.PENDING_ACTION_RESOLUTION,
            resolution.id,
            InteractionAuditEventType.PENDING_ACTION_RESOLVED,
            resolution.resolutionDigest,
            resolution.resolvedAt,
          ),
        }),
    ...(reservation === undefined
      ? {}
      : {
          reservationAuditWrite: createInteractionAuditWrite(
            suffix,
            'action-reservation',
            InteractionAuditAggregateType.INTERACTION_ACTION_RESERVATION,
            reservation.id,
            InteractionAuditEventType.INTERACTION_ACTION_RESERVED,
            reservation.reservationDigest,
            reservation.reservedAt,
          ),
        }),
    operationAuditWrite: createInteractionAuditWrite(
      suffix,
      'action-proposal-completed',
      InteractionAuditAggregateType.INTERACTION_OPERATION,
      nextOperation.id,
      InteractionAuditEventType.INTERACTION_OPERATION_COMPLETED,
      nextOperation.operationDigest,
      nextOperation.completedAt,
      currentOperation.version,
      nextOperation.version,
    ),
  });
}

function createActionConfirmationCommitInput(
  session: InteractionSession,
  originatingMessage: InteractionMessage,
  responseMessage: InteractionMessage,
  decision: RouteDecision,
  pendingAction: PendingAction,
  resolution: PendingActionResolution,
  currentOperation: ReservedInteractionOperation,
  nextOperation: CompletedInteractionOperation,
  suffix: string,
  reservation?: InteractionActionReservation,
): CommitInteractionActionConfirmation {
  return Object.freeze({
    session,
    originatingMessage,
    responseMessage,
    routeDecision: decision,
    pendingAction,
    resolution,
    ...(reservation === undefined ? {} : { reservation }),
    currentOperation,
    nextOperation,
    resolutionAuditWrite: createInteractionAuditWrite(
      suffix,
      'resolution',
      InteractionAuditAggregateType.PENDING_ACTION_RESOLUTION,
      resolution.id,
      InteractionAuditEventType.PENDING_ACTION_RESOLVED,
      resolution.resolutionDigest,
      resolution.resolvedAt,
    ),
    ...(reservation === undefined
      ? {}
      : {
          reservationAuditWrite: createInteractionAuditWrite(
            suffix,
            'action-reservation',
            InteractionAuditAggregateType.INTERACTION_ACTION_RESERVATION,
            reservation.id,
            InteractionAuditEventType.INTERACTION_ACTION_RESERVED,
            reservation.reservationDigest,
            reservation.reservedAt,
          ),
        }),
    operationAuditWrite: createInteractionAuditWrite(
      suffix,
      'action-confirmation-completed',
      InteractionAuditAggregateType.INTERACTION_OPERATION,
      nextOperation.id,
      InteractionAuditEventType.INTERACTION_OPERATION_COMPLETED,
      nextOperation.operationDigest,
      nextOperation.completedAt,
      currentOperation.version,
      nextOperation.version,
    ),
  });
}

function createTerminalResolutionRecordInput(
  session: InteractionSession,
  originatingMessage: InteractionMessage,
  decision: RouteDecision,
  pendingAction: PendingAction,
  resolution: PendingActionResolution,
  suffix: string,
): RecordInteractionPendingActionTerminalResolution {
  return Object.freeze({
    session,
    originatingMessage,
    routeDecision: decision,
    pendingAction,
    resolution,
    resolutionAuditWrite: createInteractionAuditWrite(
      suffix,
      'terminal-resolution',
      InteractionAuditAggregateType.PENDING_ACTION_RESOLUTION,
      resolution.id,
      InteractionAuditEventType.PENDING_ACTION_RESOLVED,
      resolution.resolutionDigest,
      resolution.resolvedAt,
    ),
  });
}

function preparePendingActionProposal(
  store: SqliteControlStore,
  policies: InteractionPolicySet,
  suffix: string,
  confirmationRequirement: InteractionConfirmationRequirement,
): Readonly<{
  session: InteractionSession;
  message: RetainedInteractionMessage;
  decision: RouteDecision;
  pendingAction: PendingAction;
  operation: ReservedInteractionOperation;
  completedOperation: CompletedInteractionOperation;
}> {
  const initial = createInitialSession(policies, suffix);
  store.createInteractionSession(createSessionInput(initial, `${suffix}-session`));
  const message = createUserMessage(
    initial,
    `${suffix}-request`,
    '/intake implement payment idempotency',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, `${suffix}-message`),
  );
  const routeOperation = createReservedOperation(
    session,
    message,
    `${suffix}-route`,
    '2026-08-14T01:00:02.000Z',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, routeOperation, `${suffix}-route`),
  );
  const decision = createActionRouteDecision(session, message, `${suffix}-route`);
  const completedRoute = completeRouteOperation(routeOperation, decision);
  store.commitInteractionRouteResult(
    createRouteResultCommitInput(
      session,
      message,
      routeOperation,
      decision,
      completedRoute,
      `${suffix}-route`,
    ),
  );
  const operation = createReservedActionOperation(
    session,
    message,
    `${suffix}-proposal`,
    InteractionOperationKind.ACTION_PROPOSAL,
    '2026-08-14T01:00:03.600Z',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, `${suffix}-proposal`),
  );
  const pendingAction = createPendingAction(
    session,
    message,
    decision,
    suffix,
    confirmationRequirement,
  );
  return Object.freeze({
    session,
    message,
    decision,
    pendingAction,
    operation,
    completedOperation: completePendingActionProposalOperation(operation, pendingAction),
  });
}

function prepareResponseBoundConfirmation(
  store: SqliteControlStore,
  prepared: ReturnType<typeof preparePendingActionProposal>,
  suffix: string,
  disposition:
    | typeof PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
    | typeof PendingActionResolutionDisposition.DECLINED
    | typeof PendingActionResolutionDisposition.UNCLEAR,
): Readonly<{
  session: InteractionSession;
  message: RetainedInteractionMessage;
  resolution: PendingActionResolution;
  reservation?: InteractionActionReservation;
  operation: ReservedInteractionOperation;
  completedOperation: CompletedInteractionOperation;
  input: CommitInteractionActionConfirmation;
}> {
  const message = createUserMessage(
    prepared.session,
    `${suffix}-response`,
    disposition === PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
      ? '确认执行'
      : disposition === PendingActionResolutionDisposition.DECLINED
        ? '取消'
        : '我还不确定',
    '2026-08-14T01:00:06.000Z',
  );
  const session = transitionSession(
    prepared.session,
    InteractionSessionState.OPEN,
    message.createdAt,
  );
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(prepared.session, message, session, `${suffix}-response`),
  );
  const operation = createReservedActionOperation(
    session,
    message,
    `${suffix}-confirmation`,
    InteractionOperationKind.ACTION_CONFIRMATION,
    '2026-08-14T01:00:06.500Z',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, `${suffix}-confirmation`),
  );
  const resolution = createPendingActionResolution(
    prepared.pendingAction,
    suffix,
    disposition,
    message,
  );
  const reservation =
    disposition === PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
      ? createActionReservation(prepared.pendingAction, resolution, suffix)
      : undefined;
  const completedOperation = completeActionConfirmationOperation(
    operation,
    resolution,
    reservation,
  );
  return Object.freeze({
    session,
    message,
    resolution,
    ...(reservation === undefined ? {} : { reservation }),
    operation,
    completedOperation,
    input: createActionConfirmationCommitInput(
      session,
      prepared.message,
      message,
      prepared.decision,
      prepared.pendingAction,
      resolution,
      operation,
      completedOperation,
      suffix,
      reservation,
    ),
  });
}

function prepareDirectAuthorizedIntakeHandoff(
  store: SqliteControlStore,
  policies: InteractionPolicySet,
  suffix: string,
): Readonly<{
  input: CommitAuthorizedIntakeActionHandoff;
  handoff: AuthorizedIntakeActionMessageHandoff;
  reservation: InteractionActionReservation;
  completedOperation: CompletedInteractionOperation;
}> {
  const prepared = preparePendingActionProposal(
    store,
    policies,
    suffix,
    InteractionConfirmationRequirement.DIRECT_USER_MESSAGE_SUFFICIENT,
  );
  const resolution = createPendingActionResolution(
    prepared.pendingAction,
    suffix,
    PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED,
  );
  const reservation = createActionReservation(prepared.pendingAction, resolution, suffix);
  assert.equal(
    store.commitInteractionPendingActionProposal(
      createPendingActionProposalCommitInput(
        prepared.session,
        prepared.message,
        prepared.decision,
        prepared.pendingAction,
        prepared.operation,
        prepared.completedOperation,
        suffix,
        resolution,
        reservation,
      ),
    ).status,
    'APPLIED',
  );
  const operation = createReservedIntakeHandoffOperation(
    prepared.session,
    prepared.message,
    suffix,
  );
  assert.equal(
    store.reserveInteractionOperation(
      createOperationReservationInput(prepared.session, prepared.message, operation, suffix),
    ).status,
    'RESERVED',
  );
  const handoff = createAuthorizedIntakeActionHandoff(
    prepared.session,
    prepared.message,
    prepared.pendingAction,
    resolution,
    reservation,
    suffix,
  );
  const completedOperation = completeIntakeHandoffOperation(operation, handoff);
  return Object.freeze({
    input: createAuthorizedIntakeActionHandoffCommitInput(
      prepared.session,
      prepared.message,
      prepared.message,
      prepared.decision,
      prepared.pendingAction,
      resolution,
      reservation,
      handoff,
      operation,
      completedOperation,
      suffix,
    ),
    handoff,
    reservation,
    completedOperation,
  });
}

function prepareSeparatelyConfirmedIntakeHandoff(
  store: SqliteControlStore,
  policies: InteractionPolicySet,
  suffix: string,
): Readonly<{
  input: CommitAuthorizedIntakeActionHandoff;
  handoff: AuthorizedIntakeActionMessageHandoff;
  reservation: InteractionActionReservation;
  operationMessage: RetainedInteractionMessage;
  originatingMessage: RetainedInteractionMessage;
  completedOperation: CompletedInteractionOperation;
}> {
  const prepared = preparePendingActionProposal(
    store,
    policies,
    suffix,
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  assert.equal(
    store.commitInteractionPendingActionProposal(
      createPendingActionProposalCommitInput(
        prepared.session,
        prepared.message,
        prepared.decision,
        prepared.pendingAction,
        prepared.operation,
        prepared.completedOperation,
        suffix,
      ),
    ).status,
    'APPLIED',
  );
  const confirmed = prepareResponseBoundConfirmation(
    store,
    prepared,
    suffix,
    PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
  );
  assert.equal(store.commitInteractionActionConfirmation(confirmed.input).status, 'APPLIED');
  if (confirmed.reservation === undefined) {
    throw new TypeError('Confirmed Intake Action must retain its Action Reservation');
  }
  const operation = createReservedIntakeHandoffOperation(
    confirmed.session,
    confirmed.message,
    suffix,
    '2026-08-14T01:00:07.600Z',
  );
  assert.equal(
    store.reserveInteractionOperation(
      createOperationReservationInput(confirmed.session, confirmed.message, operation, suffix),
    ).status,
    'RESERVED',
  );
  const handoff = createAuthorizedIntakeActionHandoff(
    confirmed.session,
    prepared.message,
    prepared.pendingAction,
    confirmed.resolution,
    confirmed.reservation,
    suffix,
    '2026-08-14T01:00:07.700Z',
  );
  const completedOperation = completeIntakeHandoffOperation(
    operation,
    handoff,
    '2026-08-14T01:00:07.800Z',
  );
  return Object.freeze({
    input: createAuthorizedIntakeActionHandoffCommitInput(
      confirmed.session,
      confirmed.message,
      prepared.message,
      prepared.decision,
      prepared.pendingAction,
      confirmed.resolution,
      confirmed.reservation,
      handoff,
      operation,
      completedOperation,
      suffix,
      confirmed.message,
    ),
    handoff,
    reservation: confirmed.reservation,
    operationMessage: confirmed.message,
    originatingMessage: prepared.message,
    completedOperation,
  });
}

function prepareConfirmedCancelAction(
  store: SqliteControlStore,
  policies: InteractionPolicySet,
  suffix: string,
): Readonly<{
  workflow: WorkflowInstance;
  reservation: InteractionActionReservation;
}> {
  const workflow = createReadyGoalAuthority(store, suffix);
  const initial = createInitialSession(policies, suffix);
  store.createInteractionSession(createSessionInput(initial, `${suffix}-session`));
  const message = createUserMessage(
    initial,
    `${suffix}-request`,
    '/goal cancel',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, `${suffix}-message`),
  );
  const routeOperation = createReservedOperation(
    session,
    message,
    `${suffix}-route`,
    '2026-08-14T01:00:02.000Z',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, routeOperation, `${suffix}-route`),
  );
  const decision = createCancelGoalRouteDecision(session, message, workflow, `${suffix}-route`);
  store.commitInteractionRouteResult(
    createRouteResultCommitInput(
      session,
      message,
      routeOperation,
      decision,
      completeRouteOperation(routeOperation, decision),
      `${suffix}-route`,
    ),
  );
  const operation = createReservedActionOperation(
    session,
    message,
    `${suffix}-proposal`,
    InteractionOperationKind.ACTION_PROPOSAL,
    '2026-08-14T01:00:03.600Z',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, `${suffix}-proposal`),
  );
  const pendingAction = createCancelGoalPendingAction(session, message, decision, workflow, suffix);
  const completedOperation = completePendingActionProposalOperation(operation, pendingAction);
  assert.equal(
    store.commitInteractionPendingActionProposal(
      createPendingActionProposalCommitInput(
        session,
        message,
        decision,
        pendingAction,
        operation,
        completedOperation,
        suffix,
      ),
    ).status,
    'APPLIED',
  );
  const confirmed = prepareResponseBoundConfirmation(
    store,
    { session, message, decision, pendingAction, operation, completedOperation },
    suffix,
    PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
  );
  assert.equal(store.commitInteractionActionConfirmation(confirmed.input).status, 'APPLIED');
  if (confirmed.reservation === undefined) {
    throw new TypeError('Confirmed Goal cancellation must retain its Action Reservation');
  }
  return Object.freeze({ workflow, reservation: confirmed.reservation });
}

function commitCancellationPublicOutcome(
  store: SqliteControlStore,
  workflow: WorkflowInstance,
  reservation: InteractionActionReservation,
): void {
  const cancellation = decideWorkflow(workflow, {
    type: 'CANCEL_WORKFLOW',
    commandId: reservation.commandId,
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt: isoTimestamp('2026-08-14T01:00:08.000Z'),
    reason: 'The explicitly confirmed user cancelled the Goal.',
  });
  if (!cancellation.accepted) {
    throw new TypeError(`Fixture cancellation was rejected: ${cancellation.rejection.code}`);
  }
  const event = cancellation.events[0];
  assert.equal(
    store.commitWorkflowEvent({
      inputDigest: reservation.canonicalCommandInputDigest,
      target: { aggregateType: 'GOAL', aggregateId: workflow.goalId },
      event,
      auditEventId: auditEventId(
        `audit_${fixtureIdentifierSuffix(reservation.commandId)}-public-workflow`,
      ),
      payloadDigest: digests.digest({ event }),
    }).status,
    'APPLIED',
  );
}

function terminalizeOperation(
  operation: ReservedInteractionOperation,
  state: typeof InteractionOperationState.FAILED | typeof InteractionOperationState.INTERRUPTED,
  completedAt = '2026-08-14T01:00:03.000Z',
): FailedOrInterruptedInteractionOperation {
  const common = {
    id: operation.id,
    schemaVersion: operation.schemaVersion,
    version: interactionOperationVersion(operation.version + 1),
    sessionId: operation.sessionId,
    expectedSessionVersion: operation.expectedSessionVersion,
    messageRef: operation.messageRef,
    operationKind: operation.operationKind,
    ...(operation.contextManifestRef === undefined
      ? {}
      : { contextManifestRef: operation.contextManifestRef }),
    ...(operation.assistantProfile === undefined
      ? {}
      : { assistantProfile: operation.assistantProfile }),
    reservedAt: operation.reservedAt,
    completedAt: isoTimestamp(completedAt),
  };
  const base =
    state === InteractionOperationState.FAILED
      ? {
          ...common,
          state,
          failureReason:
            operation.assistantProfile === undefined
              ? InteractionOperationFailureReason.VALIDATION_REJECTED
              : InteractionOperationFailureReason.ASSISTANT_FAILED,
        }
      : {
          ...common,
          state,
          failureReason: InteractionOperationFailureReason.INTERRUPTED,
        };
  const terminal = decodeOperationProjection(base);
  if (
    terminal.state !== InteractionOperationState.FAILED &&
    terminal.state !== InteractionOperationState.INTERRUPTED
  ) {
    throw new TypeError('Fixture Operation did not terminalize');
  }
  return terminal;
}

function completeOperationWithoutOwnedResult(
  operation: ReservedInteractionOperation,
): CompletedInteractionOperation {
  const routeDecisionRef = Object.freeze({
    id: routeDecisionId('route-decision_unowned-operation-result'),
    digest: digests.digest({ kind: 'unowned-route-decision' }),
  });
  const completed = decodeOperationProjection({
    id: operation.id,
    schemaVersion: operation.schemaVersion,
    version: interactionOperationVersion(operation.version + 1),
    sessionId: operation.sessionId,
    expectedSessionVersion: operation.expectedSessionVersion,
    messageRef: operation.messageRef,
    operationKind: operation.operationKind,
    ...(operation.contextManifestRef === undefined
      ? {}
      : { contextManifestRef: operation.contextManifestRef }),
    ...(operation.assistantProfile === undefined
      ? {}
      : { assistantProfile: operation.assistantProfile }),
    state: InteractionOperationState.COMPLETED,
    result: Object.freeze({
      kind: InteractionOperationResultKind.ROUTE_DECIDED,
      routeDecisionRef,
    }),
    reservedAt: operation.reservedAt,
    completedAt: isoTimestamp('2026-08-14T01:00:03.000Z'),
  });
  if (completed.state !== InteractionOperationState.COMPLETED) {
    throw new TypeError('Fixture Operation did not complete');
  }
  return completed;
}

function createOperationReservationInput(
  session: InteractionSession,
  message: InteractionMessage,
  operation: CompanionFreeReservedInteractionOperation,
  suffix: string,
): ReserveInteractionOperation {
  return Object.freeze({
    session,
    message,
    operation,
    auditWrite: Object.freeze({
      id: auditEventId(`audit_interaction-operation-reserved-${fixtureIdentifierSuffix(suffix)}`),
      aggregateType: InteractionAuditAggregateType.INTERACTION_OPERATION,
      aggregateId: operation.id,
      eventType: InteractionAuditEventType.INTERACTION_OPERATION_RESERVED,
      payloadDigest: operation.operationDigest,
      occurredAt: operation.reservedAt,
      afterVersion: operation.version,
    }),
  });
}

function createOperationTerminalInput(
  currentOperation: ReservedInteractionOperation,
  nextOperation: FailedOrInterruptedInteractionOperation,
  suffix: string,
): TerminalizeInteractionOperation {
  return Object.freeze({
    currentOperation,
    nextOperation,
    auditWrite: Object.freeze({
      id: auditEventId(`audit_interaction-operation-terminal-${fixtureIdentifierSuffix(suffix)}`),
      aggregateType: InteractionAuditAggregateType.INTERACTION_OPERATION,
      aggregateId: nextOperation.id,
      eventType:
        nextOperation.state === InteractionOperationState.FAILED
          ? InteractionAuditEventType.INTERACTION_OPERATION_FAILED
          : InteractionAuditEventType.INTERACTION_OPERATION_INTERRUPTED,
      payloadDigest: nextOperation.operationDigest,
      occurredAt: nextOperation.completedAt,
      beforeVersion: currentOperation.version,
      afterVersion: nextOperation.version,
    }),
  });
}

function insertRawReservedInteractionOperation(
  database: Database.Database,
  operation: ReservedInteractionOperation,
): void {
  database
    .prepare(
      `INSERT INTO interaction_operations(
         id, schema_version, version, session_id, expected_session_version,
         message_id, message_digest, operation_kind, state, context_manifest_id,
         context_manifest_digest, assistant_profile_id, assistant_profile_version,
         assistant_profile_digest, reserved_at, completed_at, operation_digest,
         record_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      operation.id,
      operation.schemaVersion,
      operation.version,
      operation.sessionId,
      operation.expectedSessionVersion,
      operation.messageRef.id,
      operation.messageRef.digest,
      operation.operationKind,
      operation.contextManifestRef?.id ?? null,
      operation.contextManifestRef?.digest ?? null,
      operation.assistantProfile?.id ?? null,
      operation.assistantProfile?.version ?? null,
      operation.assistantProfile?.digest ?? null,
      operation.reservedAt,
      operation.operationDigest,
      JSON.stringify(operation),
    );
}

function insertRawInteractionRouteProposal(
  database: Database.Database,
  proposal: RouteProposal,
  overrides: Readonly<{ operationId?: string }> = {},
): void {
  database
    .prepare(
      `INSERT INTO interaction_route_proposals(
         id, schema_version, session_id, operation_id, message_id, message_digest,
         proposal_kind, proposal_digest, observed_at, record_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      proposal.id,
      proposal.schemaVersion,
      proposal.sessionId,
      overrides.operationId ?? proposal.operationId,
      proposal.messageRef.id,
      proposal.messageRef.digest,
      proposal.kind,
      proposal.proposalDigest,
      proposal.observedAt,
      JSON.stringify(proposal),
    );
}

function insertRawInteractionRouteDecision(
  database: Database.Database,
  decision: RouteDecision,
  overrides: Readonly<{ expectedSessionVersion?: number }> = {},
): void {
  database
    .prepare(
      `INSERT INTO interaction_route_decisions(
         id, schema_version, session_id, expected_session_version, message_id,
         message_digest, proposal_id, proposal_digest, focus_id, focus_digest,
         outcome, decided_at, decision_digest, record_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      decision.id,
      decision.schemaVersion,
      decision.sessionId,
      overrides.expectedSessionVersion ?? decision.expectedSessionVersion,
      decision.messageRef.id,
      decision.messageRef.digest,
      decision.proposalRef?.id ?? null,
      decision.proposalRef?.digest ?? null,
      decision.focusRef?.id ?? null,
      decision.focusRef?.digest ?? null,
      decision.outcome,
      decision.decidedAt,
      decision.decisionDigest,
      JSON.stringify(decision),
    );
}

function updateRawCompletedInteractionOperation(
  database: Database.Database,
  currentOperation: ReservedInteractionOperation,
  nextOperation: CompletedInteractionOperation,
): void {
  const result = database
    .prepare(
      `UPDATE interaction_operations
          SET version = ?, state = 'COMPLETED', completed_at = ?,
              operation_digest = ?, record_json = ?
        WHERE id = ? AND version = ? AND operation_digest = ? AND state = 'RESERVED'`,
    )
    .run(
      nextOperation.version,
      nextOperation.completedAt,
      nextOperation.operationDigest,
      JSON.stringify(nextOperation),
      currentOperation.id,
      currentOperation.version,
      currentOperation.operationDigest,
    );
  assert.equal(result.changes, 1);
}

function insertRawInteractionAuditMembership(
  database: Database.Database,
  session: InteractionSession,
  auditWrite: InteractionAuditWrite,
): void {
  database
    .prepare(
      `INSERT INTO audit_events(
         id, aggregate_type, aggregate_id, event_type, actor_type,
         before_version, after_version, payload_digest, occurred_at
       ) VALUES (?, ?, ?, ?, 'RUNTIME', ?, ?, ?, ?)`,
    )
    .run(
      auditWrite.id,
      auditWrite.aggregateType,
      auditWrite.aggregateId,
      auditWrite.eventType,
      auditWrite.beforeVersion ?? null,
      auditWrite.afterVersion ?? null,
      auditWrite.payloadDigest,
      auditWrite.occurredAt,
    );
  database
    .prepare(
      `INSERT INTO interaction_audit_events(session_id, position, audit_event_id)
       SELECT ?, COALESCE(MAX(position), -1) + 1, ?
         FROM interaction_audit_events
        WHERE session_id = ?`,
    )
    .run(session.id, auditWrite.id, session.id);
}

type StoredSessionState = 'OPEN' | 'CLOSING';

function insertSession(
  database: Database.Database,
  policies: InteractionPolicySet,
  id: string,
  state: StoredSessionState,
): void {
  const principalRef = 'principal_sql-backstop';
  const projectPath = `/fixture/${id}`;
  const projectIdentityDigest = digests.digest({ projectPath });
  const configurationId = 'frontstage-config_sql-backstop';
  const configurationVersion = 'v1';
  const configurationDigest = digests.digest({ configurationId, configurationVersion });
  const retentionProfileId = 'frontstage-retention_sql-backstop';
  const retentionProfileVersion = 'v1';
  const retentionProfileDigest = digests.digest({ retentionProfileId, retentionProfileVersion });
  const sessionDigest = digests.digest({ id, state, version: 1 });
  const record = {
    id,
    schemaVersion: 1,
    version: 1,
    principalRef,
    projectRef: { normalizedPath: projectPath, identityDigest: projectIdentityDigest },
    state,
    configuration: {
      id: configurationId,
      version: configurationVersion,
      digest: configurationDigest,
    },
    routingPolicy: {
      id: policies.routingPolicy.id,
      version: policies.routingPolicy.version,
      digest: policies.routingPolicy.digest,
    },
    confirmationPolicy: {
      id: policies.confirmationPolicy.id,
      version: policies.confirmationPolicy.version,
      digest: policies.confirmationPolicy.digest,
    },
    retentionProfile: {
      id: retentionProfileId,
      version: retentionProfileVersion,
      digest: retentionProfileDigest,
    },
    openedAt: INSTALLED_AT,
    updatedAt: INSTALLED_AT,
    sessionDigest,
  };
  database
    .prepare(
      `INSERT INTO interaction_sessions(
         id, schema_version, version, principal_ref, project_path, project_identity_digest,
         state, terminal_reason, configuration_id, configuration_version,
         configuration_digest, routing_policy_id, routing_policy_version,
         routing_policy_digest, confirmation_policy_id, confirmation_policy_version,
         confirmation_policy_digest, retention_profile_id, retention_profile_version,
         retention_profile_digest, current_focus_id, current_focus_digest, opened_at,
         updated_at, session_digest, record_json
       ) VALUES (
         ?, 1, 1, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?
       )`,
    )
    .run(
      id,
      principalRef,
      projectPath,
      projectIdentityDigest,
      state,
      configurationId,
      configurationVersion,
      configurationDigest,
      policies.routingPolicy.id,
      policies.routingPolicy.version,
      policies.routingPolicy.digest,
      policies.confirmationPolicy.id,
      policies.confirmationPolicy.version,
      policies.confirmationPolicy.digest,
      retentionProfileId,
      retentionProfileVersion,
      retentionProfileDigest,
      INSTALLED_AT,
      INSTALLED_AT,
      sessionDigest,
      JSON.stringify(record),
    );
}

function insertUserMessage(database: Database.Database, sessionId: string, id: string): string {
  const contentDigest = digests.digest({ id, content: 'fixture' });
  const messageDigest = digests.digest({ id, sessionId, role: 'USER' });
  const record = {
    id,
    schemaVersion: 1,
    sessionId,
    principalRef: 'principal_sql-backstop',
    role: 'USER',
    retention: 'RETAINED',
    contentDigest,
    contentByteLength: 7,
    createdAt: INSTALLED_AT,
    messageDigest,
  };
  database
    .prepare(
      `INSERT INTO interaction_messages(
         id, schema_version, session_id, principal_ref, role, retention, content_digest,
         content_byte_length, caused_by_operation_id, caused_by_operation_digest,
         created_at, message_digest, record_json
       ) VALUES (?, 1, ?, ?, 'USER', 'RETAINED', ?, 7, NULL, NULL, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      record.principalRef,
      contentDigest,
      INSTALLED_AT,
      messageDigest,
      JSON.stringify(record),
    );
  return messageDigest;
}

function insertReservedOperation(
  database: Database.Database,
  sessionId: string,
  messageId: string,
  messageDigest: string,
  id: string,
): string {
  const operationDigest = digests.digest({ id, sessionId, messageId });
  const record = {
    id,
    schemaVersion: 1,
    version: 1,
    sessionId,
    expectedSessionVersion: 1,
    messageRef: { id: messageId, digest: messageDigest },
    operationKind: 'ROUTE',
    state: 'RESERVED',
    reservedAt: INSTALLED_AT,
    operationDigest,
  };
  database
    .prepare(
      `INSERT INTO interaction_operations(
         id, schema_version, version, session_id, expected_session_version, message_id,
         message_digest, operation_kind, state, context_manifest_id, context_manifest_digest,
         assistant_profile_id, assistant_profile_version, assistant_profile_digest,
         reserved_at, completed_at, operation_digest, record_json
       ) VALUES (?, 1, 1, ?, 1, ?, ?, 'ROUTE', 'RESERVED', NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      messageId,
      messageDigest,
      INSTALLED_AT,
      operationDigest,
      JSON.stringify(record),
    );
  return operationDigest;
}

function insertFrontstageMessage(
  database: Database.Database,
  sessionId: string,
  operationId: string,
  operationDigest: string,
  id: string,
): void {
  const contentDigest = digests.digest({ id, content: 'frontstage fixture' });
  const messageDigest = digests.digest({ id, sessionId, operationId });
  const record = {
    id,
    schemaVersion: 1,
    sessionId,
    principalRef: 'principal_sql-backstop',
    role: 'FRONTSTAGE',
    retention: 'RETAINED',
    contentDigest,
    contentByteLength: 18,
    causedByOperationRef: { id: operationId, digest: operationDigest },
    createdAt: INSTALLED_AT,
    messageDigest,
  };
  database
    .prepare(
      `INSERT INTO interaction_messages(
         id, schema_version, session_id, principal_ref, role, retention, content_digest,
         content_byte_length, caused_by_operation_id, caused_by_operation_digest,
         created_at, message_digest, record_json
       ) VALUES (?, 1, ?, ?, 'FRONTSTAGE', 'RETAINED', ?, 18, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      record.principalRef,
      contentDigest,
      operationId,
      operationDigest,
      INSTALLED_AT,
      messageDigest,
      JSON.stringify(record),
    );
}

function insertPolicyInstallAudit(
  database: Database.Database,
  id: string,
  aggregateId: string,
  payloadDigest: string,
): void {
  database
    .prepare(
      `INSERT INTO audit_events(
         id, aggregate_type, aggregate_id, event_type, actor_type, payload_digest, occurred_at
       ) VALUES (?, ?, ?, ?, 'RUNTIME', ?, ?)`,
    )
    .run(
      id,
      InteractionAuditAggregateType.INTERACTION_POLICY,
      aggregateId,
      InteractionAuditEventType.INTERACTION_POLICY_INSTALLED,
      payloadDigest,
      INSTALLED_AT,
    );
}

function insertActionReservationChain(
  database: Database.Database,
  sessionId: string,
  suffix: string,
): Readonly<{
  id: string;
  digest: string;
  commandId: string;
  canonicalCommandInputDigest: string;
}> {
  // This adversarial fixture isolates the pre-existing Action Outcome foreign-key
  // relationship. The B2 transaction/trigger chain has separate positive and
  // failure-closed coverage and must not be fabricated here.
  database.exec('DROP TRIGGER IF EXISTS interaction_route_decisions_exact_authority_guard');
  database.exec('DROP TRIGGER IF EXISTS interaction_pending_actions_exact_authority_guard');
  database.exec(
    'DROP TRIGGER IF EXISTS interaction_pending_action_resolutions_exact_authority_guard',
  );
  database.exec('DROP TRIGGER IF EXISTS interaction_action_reservations_exact_authority_guard');
  database.exec('DROP TRIGGER IF EXISTS processed_commands_outcome_insert_guard');
  const messageId = `interaction-message_${suffix}`;
  const messageDigest = insertUserMessage(database, sessionId, messageId);
  const decisionId = `route-decision_${suffix}`;
  const decisionDigest = digests.digest({ decisionId, sessionId });
  database
    .prepare(
      `INSERT INTO interaction_route_decisions(
         id, schema_version, session_id, expected_session_version, message_id, message_digest,
         proposal_id, proposal_digest, focus_id, focus_digest, outcome, decided_at,
         decision_digest, record_json
       ) VALUES (?, 1, ?, 1, ?, ?, NULL, NULL, NULL, NULL, 'PROPOSE_GOAL_CONTROL', ?, ?, ?)`,
    )
    .run(
      decisionId,
      sessionId,
      messageId,
      messageDigest,
      INSTALLED_AT,
      decisionDigest,
      JSON.stringify({
        id: decisionId,
        schemaVersion: 1,
        sessionId,
        expectedSessionVersion: 1,
        messageRef: { id: messageId, digest: messageDigest },
        outcome: 'PROPOSE_GOAL_CONTROL',
        decisionDigest,
      }),
    );

  const pendingActionId = `pending-action_${suffix}`;
  const commandId = `command_${suffix}`;
  const canonicalCommandInputDigest = digests.digest({ commandId, kind: 'input' });
  const pendingActionDigest = digests.digest({ pendingActionId, decisionId });
  database
    .prepare(
      `INSERT INTO interaction_pending_actions(
         id, schema_version, session_id, originating_message_id,
         originating_message_digest, route_decision_id, route_decision_digest,
         focus_id, focus_digest, action_kind, confirmation_requirement, public_capability,
         preallocated_command_id, canonical_command_input_digest, expires_at, created_at,
         pending_action_digest, record_json
       ) VALUES (
         ?, 1, ?, ?, ?, ?, ?, NULL, NULL, 'START_GOAL',
         'DIRECT_USER_MESSAGE_SUFFICIENT', 'START_GOAL', ?, ?, ?, ?, ?, ?
       )`,
    )
    .run(
      pendingActionId,
      sessionId,
      messageId,
      messageDigest,
      decisionId,
      decisionDigest,
      commandId,
      canonicalCommandInputDigest,
      '2026-08-14T01:05:00.000Z',
      INSTALLED_AT,
      pendingActionDigest,
      JSON.stringify({
        id: pendingActionId,
        schemaVersion: 1,
        sessionId,
        originatingMessageRef: { id: messageId, digest: messageDigest },
        routeDecisionRef: { id: decisionId, digest: decisionDigest },
        kind: 'START_GOAL',
        confirmationRequirement: 'DIRECT_USER_MESSAGE_SUFFICIENT',
        publicCapability: 'START_GOAL',
        preallocatedCommandId: commandId,
        canonicalCommandInputDigest,
        pendingActionDigest,
      }),
    );

  const resolutionId = `pending-action-resolution_${suffix}`;
  const resolutionDigest = digests.digest({ resolutionId, pendingActionId });
  database
    .prepare(
      `INSERT INTO interaction_pending_action_resolutions(
         id, schema_version, session_id, pending_action_id, pending_action_digest,
         disposition, resolved_at, resolution_digest, record_json
       ) VALUES (?, 1, ?, ?, ?, 'DIRECT_USER_AUTHORIZED', ?, ?, ?)`,
    )
    .run(
      resolutionId,
      sessionId,
      pendingActionId,
      pendingActionDigest,
      INSTALLED_AT,
      resolutionDigest,
      JSON.stringify({
        id: resolutionId,
        schemaVersion: 1,
        pendingActionRef: { id: pendingActionId, digest: pendingActionDigest },
        disposition: 'DIRECT_USER_AUTHORIZED',
        resolutionDigest,
      }),
    );

  const reservationId = `interaction-action-reservation_${suffix}`;
  const reservationDigest = digests.digest({ reservationId, pendingActionId, resolutionId });
  database
    .prepare(
      `INSERT INTO interaction_action_reservations(
         id, schema_version, session_id, pending_action_id, pending_action_digest,
         resolution_id, resolution_digest, public_capability, command_id,
         canonical_command_input_digest, reserved_at, reservation_digest, record_json
       ) VALUES (?, 1, ?, ?, ?, ?, ?, 'START_GOAL', ?, ?, ?, ?, ?)`,
    )
    .run(
      reservationId,
      sessionId,
      pendingActionId,
      pendingActionDigest,
      resolutionId,
      resolutionDigest,
      commandId,
      canonicalCommandInputDigest,
      INSTALLED_AT,
      reservationDigest,
      JSON.stringify({
        id: reservationId,
        schemaVersion: 1,
        pendingActionRef: { id: pendingActionId, digest: pendingActionDigest },
        resolutionRef: { id: resolutionId, digest: resolutionDigest },
        publicCapability: 'START_GOAL',
        commandId,
        canonicalCommandInputDigest,
        reservedAt: INSTALLED_AT,
        reservationDigest,
      }),
    );
  return Object.freeze({
    id: reservationId,
    digest: reservationDigest,
    commandId,
    canonicalCommandInputDigest,
  });
}

function insertActionOutcome(
  database: Database.Database,
  sessionId: string,
  reservation: ReturnType<typeof insertActionReservationChain>,
  suffix: string,
): void {
  const id = `interaction-action-outcome_${suffix}`;
  const output = {
    schemaVersion: 1,
    commandId: reservation.commandId,
    ok: true,
    goalId: 'goal_action-outcome-fixture',
    workflowVersion: 1,
    phase: 'DISCOVERY',
    runStatus: 'RUNNING',
  };
  const publicOutcome = {
    schemaVersion: 3,
    disposition: 'APPLIED',
    target: { aggregateType: 'GOAL', aggregateId: 'goal_action-outcome-fixture' },
    goalId: 'goal_action-outcome-fixture',
    workflow: {
      id: 'workflow_action-outcome-fixture',
      version: 1,
      phase: 'DISCOVERY',
      runStatus: 'RUNNING',
    },
    output,
  };
  database
    .prepare(
      `INSERT OR IGNORE INTO processed_commands(
         command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
       ) VALUES (?, ?, 'GOAL', 'goal_action-outcome-fixture', ?, ?)`,
    )
    .run(
      reservation.commandId,
      reservation.canonicalCommandInputDigest,
      JSON.stringify(publicOutcome),
      INSTALLED_AT,
    );
  const publicCommandOutcomeDigest = digests.digest(publicOutcome);
  const resultProjectionDigest = digests.digest(output);
  const outcomeDigest = digests.digest({ id, reservationId: reservation.id });
  database
    .prepare(
      `INSERT INTO interaction_action_outcomes(
         id, schema_version, session_id, reservation_id, reservation_digest, command_id,
         canonical_command_input_digest, disposition, public_command_outcome_digest,
         result_projection_digest, completed_at, outcome_digest, record_json
       ) VALUES (?, 1, ?, ?, ?, ?, ?, 'APPLIED', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      reservation.id,
      reservation.digest,
      reservation.commandId,
      reservation.canonicalCommandInputDigest,
      publicCommandOutcomeDigest,
      resultProjectionDigest,
      INSTALLED_AT,
      outcomeDigest,
      JSON.stringify({
        id,
        schemaVersion: 1,
        reservationRef: { id: reservation.id, digest: reservation.digest },
        commandId: reservation.commandId,
        canonicalCommandInputDigest: reservation.canonicalCommandInputDigest,
        disposition: 'APPLIED',
        publicCommandOutcomeDigest,
        resultProjectionDigest,
        completedAt: INSTALLED_AT,
        outcomeDigest,
      }),
    );
}

void test('Slice 2 policy authority installs atomically, replays exactly, and strictly reopens', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const input = installInput(policies);
  const store = SqliteControlStore.open({ filename });

  assert.deepEqual(store.installInteractionPolicies(input), {
    status: 'INSTALLED',
    policies,
  });
  assert.deepEqual(store.installInteractionPolicies(input), {
    status: 'EXISTING',
    policies,
  });
  assert.deepEqual(store.getInstalledInteractionPolicies(), policies);
  store.close();

  const database = new Database(filename, { readonly: true });
  try {
    const auditCount = database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM audit_events
          WHERE aggregate_type = ? AND event_type = ?`,
      )
      .get(
        InteractionAuditAggregateType.INTERACTION_POLICY,
        InteractionAuditEventType.INTERACTION_POLICY_INSTALLED,
      ) as { readonly count: number };
    assert.equal(auditCount.count, 4);
  } finally {
    database.close();
  }

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInstalledInteractionPolicies(), policies);
  } finally {
    reopened.close();
  }
});

void test('Slice 2 policy install rejects unknown envelope fields and types retained conflicts', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const input = installInput(policies);
  const store = SqliteControlStore.open({ filename });
  try {
    const unknownOuterField = { ...input, unexpected: true };
    assert.throws(
      () => store.installInteractionPolicies(unknownOuterField),
      /missing or unknown fields/u,
    );
    const unknownAuditField = {
      ...input,
      auditWrites: {
        ...input.auditWrites,
        routingPolicy: { ...input.auditWrites.routingPolicy, unexpected: true },
      },
    };
    assert.throws(
      () => store.installInteractionPolicies(unknownAuditField),
      /missing or unknown fields/u,
    );
    assert.deepEqual(store.installInteractionPolicies(input).status, 'INSTALLED');

    const { digest: ignoredDirectDigest, ...retainedDirectBase } = policies.directActionGrammar;
    void ignoredDirectDigest;
    const alternateDirectBase = {
      ...retainedDirectBase,
      id: 'codeclosure-m2-6-zh-cn-direct-action-conflict',
      version: 'codeclosure-m2-6-zh-cn-direct-action-conflict-v1',
    };
    const alternateDirect = decodeDirectActionGrammar(
      {
        ...alternateDirectBase,
        digest: digests.digest(directActionGrammarProjection(alternateDirectBase)),
      },
      digests,
    );
    const { digest: ignoredRoutingDigest, ...retainedRoutingBase } = policies.routingPolicy;
    void ignoredRoutingDigest;
    const alternateRoutingBase = {
      ...retainedRoutingBase,
      directActionGrammar: {
        id: alternateDirect.id,
        version: alternateDirect.version,
        digest: alternateDirect.digest,
      },
    };
    const alternateRouting = decodeInteractionRoutingPolicy(
      {
        ...alternateRoutingBase,
        digest: digests.digest(interactionRoutingPolicyProjection(alternateRoutingBase)),
      },
      digests,
    );
    const alternatePolicies = {
      ...policies,
      directActionGrammar: alternateDirect,
      routingPolicy: alternateRouting,
    };
    assert.equal(
      store.installInteractionPolicies(installInput(alternatePolicies)).status,
      'POLICY_CONFLICT',
    );
  } finally {
    store.close();
  }
});

const policyRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_DIRECT_ACTION_GRAMMAR_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_DIRECT_ACTION_GRAMMAR_WRITE,
  InteractionTransactionStep.AFTER_CONFIRMATION_GRAMMAR_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_CONFIRMATION_GRAMMAR_WRITE,
  InteractionTransactionStep.AFTER_ROUTING_POLICY_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ROUTING_POLICY_WRITE,
  InteractionTransactionStep.AFTER_CONFIRMATION_POLICY_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_CONFIRMATION_POLICY_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of policyRollbackSteps) {
  void test(`Slice 2 policy install rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(() => store.installInteractionPolicies(installInput(policies)), new RegExp(step));
    assert.equal(store.getInstalledInteractionPolicies(), undefined);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    try {
      assert.equal(reopened.getInstalledInteractionPolicies(), undefined);
    } finally {
      reopened.close();
    }
  });
}

void test('Slice 2 Session create replays exactly, types conflicts, and strictly reopens', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const session = createInitialSession(policies, 'create');
  const input = createSessionInput(session, 'create');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));

  assert.deepEqual(store.createInteractionSession(input), {
    status: 'CREATED',
    session,
  });
  assert.deepEqual(store.createInteractionSession(input), {
    status: 'REPLAYED',
    session,
  });
  assert.deepEqual(store.getInteractionSession(session.id), session);

  const conflicting = createInitialSession(policies, 'create-conflict', {
    idSuffix: 'create',
    projectSuffix: 'substituted-project',
  });
  assert.deepEqual(
    store.createInteractionSession(createSessionInput(conflicting, 'create-conflict')),
    { status: 'SESSION_CONFLICT', currentSession: session },
  );
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionSession(session.id), session);
  } finally {
    reopened.close();
  }
});

const sessionCreateRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_SESSION_OPEN_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_SESSION_WRITE,
  InteractionTransactionStep.AFTER_AUDIT_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of sessionCreateRollbackSteps) {
  void test(`Slice 2 Session create rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const session = createInitialSession(policies, `create-rollback-${step}`);
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    setup.close();

    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () => store.createInteractionSession(createSessionInput(session, `rollback-${step}`)),
      new RegExp(step),
    );
    assert.equal(store.getInteractionSession(session.id), undefined);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    try {
      assert.equal(reopened.getInteractionSession(session.id), undefined);
    } finally {
      reopened.close();
    }
  });
}

void test('Slice 2 Session lifecycle applies once, types stale writers, and survives reopen', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'lifecycle');
  const closing = transitionSession(
    initial,
    InteractionSessionState.CLOSING,
    '2026-08-14T01:00:01.000Z',
  );
  const closeInput = createSessionTransitionInput(initial, closing, 'closing');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'lifecycle'));

  assert.deepEqual(store.transitionInteractionSession(closeInput), {
    status: 'APPLIED',
    session: closing,
  });
  assert.deepEqual(store.transitionInteractionSession(closeInput), {
    status: 'REPLAYED',
    session: closing,
  });

  const staleAlternative = transitionSession(
    initial,
    InteractionSessionState.INTERRUPTED,
    '2026-08-14T01:00:01.000Z',
  );
  assert.deepEqual(
    store.transitionInteractionSession(
      createSessionTransitionInput(initial, staleAlternative, 'stale-interrupted'),
    ),
    { status: 'VERSION_CONFLICT', currentSession: closing },
  );

  const closed = transitionSession(
    closing,
    InteractionSessionState.CLOSED,
    '2026-08-14T01:00:02.000Z',
  );
  assert.equal(
    store.transitionInteractionSession(createSessionTransitionInput(closing, closed, 'closed'))
      .status,
    'APPLIED',
  );
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionSession(initial.id), closed);
  } finally {
    reopened.close();
  }
});

const sessionTransitionRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_SESSION_TRANSITION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_SESSION_TRANSITION_WRITE,
  InteractionTransactionStep.AFTER_AUDIT_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of sessionTransitionRollbackSteps) {
  void test(`Slice 2 Session lifecycle transition rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const initial = createInitialSession(policies, `transition-rollback-${step}`);
    const closing = transitionSession(
      initial,
      InteractionSessionState.CLOSING,
      '2026-08-14T01:00:01.000Z',
    );
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    setup.createInteractionSession(createSessionInput(initial, `transition-rollback-${step}`));
    setup.close();

    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () =>
        store.transitionInteractionSession(
          createSessionTransitionInput(initial, closing, `transition-rollback-${step}`),
        ),
      new RegExp(step),
    );
    assert.deepEqual(store.getInteractionSession(initial.id), initial);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    try {
      assert.deepEqual(reopened.getInteractionSession(initial.id), initial);
    } finally {
      reopened.close();
    }
  });
}

void test('Slice 2 user-message admission is atomic, replayable, and CAS-bound', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'message');
  const message = createUserMessage(
    initial,
    'message-first',
    '请解释当前项目状态',
    '2026-08-14T01:00:01.000Z',
  );
  const afterMessage = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const input = createUserMessageAdmissionInput(initial, message, afterMessage, 'message-first');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'message'));

  assert.deepEqual(store.admitInteractionUserMessage(input), {
    status: 'ADMITTED',
    message,
    session: afterMessage,
  });
  assert.deepEqual(store.admitInteractionUserMessage(input), {
    status: 'REPLAYED',
    message,
    session: afterMessage,
  });
  assert.deepEqual(store.getInteractionMessage(message.id), message);

  const otherSession = createInitialSession(policies, 'message-other-session');
  store.createInteractionSession(createSessionInput(otherSession, 'message-other-session'));
  const otherNext = transitionSession(
    otherSession,
    InteractionSessionState.OPEN,
    message.createdAt,
  );
  assert.throws(
    () =>
      store.admitInteractionUserMessage(
        createUserMessageAdmissionInput(
          otherSession,
          message,
          otherNext,
          'message-cross-session-replay',
        ),
      ),
    /does not bind one current OPEN Session/u,
  );

  const conflictingMessage = createUserMessage(
    initial,
    'message-first',
    '替换内容',
    '2026-08-14T01:00:01.000Z',
  );
  assert.deepEqual(
    store.admitInteractionUserMessage(
      createUserMessageAdmissionInput(
        initial,
        conflictingMessage,
        afterMessage,
        'message-conflict',
      ),
    ),
    { status: 'MESSAGE_CONFLICT', currentMessage: message },
  );

  const staleMessage = createUserMessage(
    initial,
    'message-stale',
    '这是并发写入',
    '2026-08-14T01:00:02.000Z',
  );
  const staleNext = transitionSession(
    initial,
    InteractionSessionState.OPEN,
    staleMessage.createdAt,
  );
  assert.deepEqual(
    store.admitInteractionUserMessage(
      createUserMessageAdmissionInput(initial, staleMessage, staleNext, 'message-stale'),
    ),
    { status: 'VERSION_CONFLICT', currentSession: afterMessage },
  );
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionSession(initial.id), afterMessage);
    assert.deepEqual(reopened.getInteractionMessage(message.id), message);
    assert.equal(reopened.getInteractionMessage(staleMessage.id), undefined);
  } finally {
    reopened.close();
  }
});

const messageAdmissionRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_MESSAGE_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_MESSAGE_WRITE,
  InteractionTransactionStep.AFTER_AUDIT_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_SESSION_TRANSITION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_SESSION_TRANSITION_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of messageAdmissionRollbackSteps) {
  void test(`Slice 2 user-message admission rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const initial = createInitialSession(policies, `message-rollback-${step}`);
    const message = createUserMessage(
      initial,
      `message-rollback-${step}`,
      '原子写入探针',
      '2026-08-14T01:00:01.000Z',
    );
    const afterMessage = transitionSession(
      initial,
      InteractionSessionState.OPEN,
      message.createdAt,
    );
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    setup.createInteractionSession(createSessionInput(initial, `message-rollback-${step}`));
    setup.close();

    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () =>
        store.admitInteractionUserMessage(
          createUserMessageAdmissionInput(
            initial,
            message,
            afterMessage,
            `message-rollback-${step}`,
          ),
        ),
      new RegExp(step),
    );
    assert.deepEqual(store.getInteractionSession(initial.id), initial);
    assert.equal(store.getInteractionMessage(message.id), undefined);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    try {
      assert.deepEqual(reopened.getInteractionSession(initial.id), initial);
      assert.equal(reopened.getInteractionMessage(message.id), undefined);
    } finally {
      reopened.close();
    }
  });
}

void test('Slice 2 concurrent message consumers produce one winner and one typed loser', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'concurrent-message');
  const setup = SqliteControlStore.open({ filename });
  setup.installInteractionPolicies(installInput(policies));
  setup.createInteractionSession(createSessionInput(initial, 'concurrent-message'));
  setup.close();

  const firstMessage = createUserMessage(
    initial,
    'concurrent-first',
    '第一个写入',
    '2026-08-14T01:00:01.000Z',
  );
  const secondMessage = createUserMessage(
    initial,
    'concurrent-second',
    '第二个写入',
    '2026-08-14T01:00:01.000Z',
  );
  const firstNext = transitionSession(
    initial,
    InteractionSessionState.OPEN,
    firstMessage.createdAt,
  );
  const secondNext = transitionSession(
    initial,
    InteractionSessionState.OPEN,
    secondMessage.createdAt,
  );
  const firstStore = SqliteControlStore.open({ filename });
  const secondStore = SqliteControlStore.open({ filename });
  try {
    assert.equal(
      firstStore.admitInteractionUserMessage(
        createUserMessageAdmissionInput(initial, firstMessage, firstNext, 'concurrent-first'),
      ).status,
      'ADMITTED',
    );
    assert.deepEqual(
      secondStore.admitInteractionUserMessage(
        createUserMessageAdmissionInput(initial, secondMessage, secondNext, 'concurrent-second'),
      ),
      { status: 'VERSION_CONFLICT', currentSession: firstNext },
    );
  } finally {
    firstStore.close();
    secondStore.close();
  }
});

void test('Slice 2 Focus write is atomic, replayable, conflict-typed, and strictly reopens', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'focus-record');
  const focus = createNoFocusBinding(initial, 'focus-record');
  const focusedSession = applyFocusToSession(initial, focus);
  const input = createFocusBindingRecordInput(initial, focus, focusedSession, 'focus-record');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'focus-record'));

  assert.deepEqual(store.recordInteractionFocusBinding(input), {
    status: 'APPLIED',
    focus,
    session: focusedSession,
  });
  assert.deepEqual(store.recordInteractionFocusBinding(input), {
    status: 'REPLAYED',
    focus,
    session: focusedSession,
  });
  assert.deepEqual(store.getInteractionFocusBinding(focus.id), focus);

  const conflictingFocus = createNoFocusBinding(
    initial,
    'focus-record',
    '2026-08-14T01:00:01.500Z',
  );
  const conflictingSession = applyFocusToSession(initial, conflictingFocus);
  assert.deepEqual(
    store.recordInteractionFocusBinding(
      createFocusBindingRecordInput(
        initial,
        conflictingFocus,
        conflictingSession,
        'focus-record-conflict',
      ),
    ),
    { status: 'FOCUS_CONFLICT', currentFocus: focus },
  );

  const staleFocus = createNoFocusBinding(
    initial,
    'focus-record-stale',
    '2026-08-14T01:00:02.000Z',
  );
  const staleSession = applyFocusToSession(initial, staleFocus);
  assert.deepEqual(
    store.recordInteractionFocusBinding(
      createFocusBindingRecordInput(initial, staleFocus, staleSession, 'focus-record-stale'),
    ),
    { status: 'VERSION_CONFLICT', currentSession: focusedSession },
  );
  assert.equal(store.getInteractionFocusBinding(staleFocus.id), undefined);
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionSession(initial.id), focusedSession);
    assert.deepEqual(reopened.getInteractionFocusBinding(focus.id), focus);
  } finally {
    reopened.close();
  }
});

void test('Slice 2 exact Focus replay returns the current Session without restoring historical focus', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'focus-historical-replay');
  const firstFocus = createNoFocusBinding(initial, 'focus-historical-replay-first');
  const firstSession = applyFocusToSession(initial, firstFocus);
  const secondFocus = createNoFocusBinding(
    firstSession,
    'focus-historical-replay-second',
    '2026-08-14T01:00:02.000Z',
  );
  const secondSession = applyFocusToSession(firstSession, secondFocus);
  const firstInput = createFocusBindingRecordInput(
    initial,
    firstFocus,
    firstSession,
    'focus-historical-replay-first',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'focus-historical-replay'));

  assert.equal(store.recordInteractionFocusBinding(firstInput).status, 'APPLIED');
  assert.equal(
    store.recordInteractionFocusBinding(
      createFocusBindingRecordInput(
        firstSession,
        secondFocus,
        secondSession,
        'focus-historical-replay-second',
      ),
    ).status,
    'APPLIED',
  );
  assert.deepEqual(store.recordInteractionFocusBinding(firstInput), {
    status: 'REPLAYED',
    focus: firstFocus,
    session: secondSession,
  });
  assert.deepEqual(store.getInteractionSession(initial.id), secondSession);
  store.close();
});

void test('Slice 2 Focus write returns typed missing-Session and active-Operation results', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));

  const missing = createInitialSession(policies, 'focus-missing-session');
  const missingFocus = createNoFocusBinding(missing, 'focus-missing-session');
  const missingNext = applyFocusToSession(missing, missingFocus);
  assert.deepEqual(
    store.recordInteractionFocusBinding(
      createFocusBindingRecordInput(missing, missingFocus, missingNext, 'focus-missing-session'),
    ),
    { status: 'SESSION_NOT_FOUND' },
  );

  const initial = createInitialSession(policies, 'focus-operation-busy');
  const message = createUserMessage(
    initial,
    'focus-operation-busy',
    '操作执行期间不能单独切换焦点',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(session, message, 'focus-operation-busy');
  store.createInteractionSession(createSessionInput(initial, 'focus-operation-busy'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'focus-operation-busy'),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, 'focus-operation-busy'),
  );
  const focus = createNoFocusBinding(session, 'focus-operation-busy', '2026-08-14T01:00:03.000Z');
  const nextSession = applyFocusToSession(session, focus);
  assert.deepEqual(
    store.recordInteractionFocusBinding(
      createFocusBindingRecordInput(session, focus, nextSession, 'focus-operation-busy'),
    ),
    { status: 'SESSION_OPERATION_BUSY', currentOperation: operation },
  );
  assert.equal(store.getInteractionFocusBinding(focus.id), undefined);
  store.close();
});

void test('Slice 2 Focus has one write owner across Runtime and SQLite backstops', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'focus-single-owner');
  const firstFocus = createNoFocusBinding(initial, 'focus-single-owner-first');
  const firstSession = applyFocusToSession(initial, firstFocus);
  const secondFocus = createNoFocusBinding(
    firstSession,
    'focus-single-owner-second',
    '2026-08-14T01:00:02.000Z',
  );
  const secondSession = applyFocusToSession(firstSession, secondFocus);
  const revertedSession = decodeSessionProjection({
    id: secondSession.id,
    schemaVersion: 1,
    version: interactionSessionVersion(secondSession.version + 1),
    principalRef: secondSession.principalRef,
    projectRef: secondSession.projectRef,
    state: InteractionSessionState.OPEN,
    configuration: secondSession.configuration,
    routingPolicy: secondSession.routingPolicy,
    confirmationPolicy: secondSession.confirmationPolicy,
    retentionProfile: secondSession.retentionProfile,
    currentFocusRef: Object.freeze({ id: firstFocus.id, digest: firstFocus.focusDigest }),
    openedAt: secondSession.openedAt,
    updatedAt: isoTimestamp('2026-08-14T01:00:03.000Z'),
  });
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'focus-single-owner'));
  store.recordInteractionFocusBinding(
    createFocusBindingRecordInput(initial, firstFocus, firstSession, 'focus-single-owner-first'),
  );
  store.recordInteractionFocusBinding(
    createFocusBindingRecordInput(
      firstSession,
      secondFocus,
      secondSession,
      'focus-single-owner-second',
    ),
  );
  assert.throws(
    () =>
      store.transitionInteractionSession(
        createSessionTransitionInput(secondSession, revertedSession, 'focus-single-owner-revert'),
      ),
    /lifecycle transition cannot change Focus authority/u,
  );
  assert.deepEqual(store.getInteractionSession(initial.id), secondSession);
  store.close();

  const database = new Database(filename);
  try {
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE interaction_sessions
                SET version = ?, current_focus_id = ?, current_focus_digest = ?,
                    updated_at = ?, session_digest = ?, record_json = ?
              WHERE id = ?`,
          )
          .run(
            revertedSession.version,
            firstFocus.id,
            firstFocus.focusDigest,
            revertedSession.updatedAt,
            revertedSession.sessionDigest,
            JSON.stringify(revertedSession),
            revertedSession.id,
          ),
      /illegal Interaction Session transition/u,
    );
  } finally {
    database.close();
  }

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionSession(initial.id), secondSession);
    assert.deepEqual(reopened.getInteractionFocusBinding(firstFocus.id), firstFocus);
    assert.deepEqual(reopened.getInteractionFocusBinding(secondFocus.id), secondFocus);
  } finally {
    reopened.close();
  }
});

const focusRecordRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_FOCUS_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_FOCUS_WRITE,
  InteractionTransactionStep.AFTER_AUDIT_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_SESSION_TRANSITION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_SESSION_TRANSITION_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of focusRecordRollbackSteps) {
  void test(`Slice 2 Focus write rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const initial = createInitialSession(policies, `focus-rollback-${step}`);
    const focus = createNoFocusBinding(initial, `focus-rollback-${step}`);
    const nextSession = applyFocusToSession(initial, focus);
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    setup.createInteractionSession(createSessionInput(initial, `focus-rollback-${step}`));
    setup.close();

    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () =>
        store.recordInteractionFocusBinding(
          createFocusBindingRecordInput(initial, focus, nextSession, `focus-rollback-${step}`),
        ),
      new RegExp(step),
    );
    assert.deepEqual(store.getInteractionSession(initial.id), initial);
    assert.equal(store.getInteractionFocusBinding(focus.id), undefined);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    try {
      assert.deepEqual(reopened.getInteractionSession(initial.id), initial);
      assert.equal(reopened.getInteractionFocusBinding(focus.id), undefined);
    } finally {
      reopened.close();
    }
  });
}

void test('Slice 2 concurrent Focus consumers produce one winner and one typed loser', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'concurrent-focus');
  const setup = SqliteControlStore.open({ filename });
  setup.installInteractionPolicies(installInput(policies));
  setup.createInteractionSession(createSessionInput(initial, 'concurrent-focus'));
  setup.close();

  const firstFocus = createNoFocusBinding(initial, 'concurrent-focus-first');
  const secondFocus = createNoFocusBinding(initial, 'concurrent-focus-second');
  const firstNext = applyFocusToSession(initial, firstFocus);
  const secondNext = applyFocusToSession(initial, secondFocus);
  const firstStore = SqliteControlStore.open({ filename });
  const secondStore = SqliteControlStore.open({ filename });
  try {
    assert.equal(
      firstStore.recordInteractionFocusBinding(
        createFocusBindingRecordInput(initial, firstFocus, firstNext, 'concurrent-focus-first'),
      ).status,
      'APPLIED',
    );
    assert.deepEqual(
      secondStore.recordInteractionFocusBinding(
        createFocusBindingRecordInput(initial, secondFocus, secondNext, 'concurrent-focus-second'),
      ),
      { status: 'VERSION_CONFLICT', currentSession: firstNext },
    );
  } finally {
    firstStore.close();
    secondStore.close();
  }
});

void test('Slice 2 Operation reservation replays exactly, closes same-Session busy, and reopens', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'operation-reservation');
  const message = createUserMessage(
    initial,
    'operation-reservation',
    '请分析这个请求',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(session, message, 'operation-reservation');
  const input = createOperationReservationInput(
    session,
    message,
    operation,
    'operation-reservation',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  assert.deepEqual(store.reserveInteractionOperation(input), {
    status: 'SESSION_NOT_FOUND',
  });
  assert.deepEqual(
    store.terminalizeInteractionOperation(
      createOperationTerminalInput(
        operation,
        terminalizeOperation(operation, InteractionOperationState.FAILED),
        'operation-not-found',
      ),
    ),
    { status: 'OPERATION_NOT_FOUND' },
  );
  store.createInteractionSession(createSessionInput(initial, 'operation-reservation'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'operation-reservation'),
  );

  assert.deepEqual(store.reserveInteractionOperation(input), {
    status: 'RESERVED',
    operation,
  });
  assert.deepEqual(store.reserveInteractionOperation(input), {
    status: 'REPLAYED',
    operation,
  });
  assert.deepEqual(store.listReservedInteractionOperations(session.id), [operation]);

  const conflicting = createReservedOperation(
    session,
    message,
    'operation-reservation',
    '2026-08-14T01:00:03.000Z',
  );
  assert.deepEqual(
    store.reserveInteractionOperation(
      createOperationReservationInput(session, message, conflicting, 'operation-conflict'),
    ),
    { status: 'OPERATION_CONFLICT', currentOperation: operation },
  );

  const secondOperation = createReservedOperation(session, message, 'operation-busy');
  assert.deepEqual(
    store.reserveInteractionOperation(
      createOperationReservationInput(session, message, secondOperation, 'operation-busy'),
    ),
    { status: 'SESSION_OPERATION_BUSY', currentOperation: operation },
  );

  const nextMessage = createUserMessage(
    session,
    'operation-busy-message',
    '这是下一条消息',
    '2026-08-14T01:00:04.000Z',
  );
  const nextSession = transitionSession(
    session,
    InteractionSessionState.OPEN,
    nextMessage.createdAt,
  );
  assert.deepEqual(
    store.admitInteractionUserMessage(
      createUserMessageAdmissionInput(session, nextMessage, nextSession, 'operation-busy-message'),
    ),
    { status: 'SESSION_OPERATION_BUSY', currentOperation: operation },
  );
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionOperation(operation.id), operation);
    assert.deepEqual(reopened.listReservedInteractionOperations(session.id), [operation]);
    assert.equal(reopened.getInteractionMessage(nextMessage.id), undefined);
  } finally {
    reopened.close();
  }
});

void test('Slice 2 unresolved Operation permits CLOSING but blocks other Session transitions', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'operation-session-serialization');
  const message = createUserMessage(
    initial,
    'operation-session-serialization',
    '保持会话和操作串行',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(session, message, 'operation-session-serialization');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'operation-session-serialization'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'operation-session-serialization'),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, 'operation-session-serialization'),
  );

  const advancedOpen = transitionSession(
    session,
    InteractionSessionState.OPEN,
    '2026-08-14T01:00:03.000Z',
  );
  assert.deepEqual(
    store.transitionInteractionSession(
      createSessionTransitionInput(session, advancedOpen, 'operation-session-open-busy'),
    ),
    { status: 'SESSION_OPERATION_BUSY', currentOperation: operation },
  );

  const closing = transitionSession(
    session,
    InteractionSessionState.CLOSING,
    '2026-08-14T01:00:03.000Z',
  );
  const closingInput = createSessionTransitionInput(session, closing, 'operation-session-closing');
  assert.deepEqual(store.transitionInteractionSession(closingInput), {
    status: 'APPLIED',
    session: closing,
  });
  assert.deepEqual(store.transitionInteractionSession(closingInput), {
    status: 'REPLAYED',
    session: closing,
  });

  const closed = transitionSession(
    closing,
    InteractionSessionState.CLOSED,
    '2026-08-14T01:00:04.000Z',
  );
  assert.deepEqual(
    store.transitionInteractionSession(
      createSessionTransitionInput(closing, closed, 'operation-session-closed-busy'),
    ),
    { status: 'SESSION_OPERATION_BUSY', currentOperation: operation },
  );
  const interruptedSession = transitionSession(
    closing,
    InteractionSessionState.INTERRUPTED,
    '2026-08-14T01:00:04.000Z',
  );
  assert.deepEqual(
    store.transitionInteractionSession(
      createSessionTransitionInput(
        closing,
        interruptedSession,
        'operation-session-interrupted-busy',
      ),
    ),
    { status: 'SESSION_OPERATION_BUSY', currentOperation: operation },
  );
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionSession(session.id), closing);
    assert.deepEqual(reopened.listReservedInteractionOperations(session.id), [operation]);
    const backdatedInterruption = terminalizeOperation(
      operation,
      InteractionOperationState.INTERRUPTED,
      '2026-08-14T01:00:02.500Z',
    );
    assert.throws(
      () =>
        reopened.terminalizeInteractionOperation(
          createOperationTerminalInput(
            operation,
            backdatedInterruption,
            'operation-session-backdated-interruption',
          ),
        ),
      /audit time moved backwards/u,
    );
    assert.deepEqual(reopened.getInteractionOperation(operation.id), operation);
    const interruptedOperation = terminalizeOperation(
      operation,
      InteractionOperationState.INTERRUPTED,
      '2026-08-14T01:00:04.000Z',
    );
    assert.equal(
      reopened.terminalizeInteractionOperation(
        createOperationTerminalInput(
          operation,
          interruptedOperation,
          'operation-session-interrupted',
        ),
      ).status,
      'APPLIED',
    );
    assert.deepEqual(
      reopened.transitionInteractionSession(
        createSessionTransitionInput(closing, closed, 'operation-session-closed'),
      ),
      { status: 'APPLIED', session: closed },
    );
  } finally {
    reopened.close();
  }

  const finalReopen = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(finalReopen.getInteractionSession(session.id), closed);
    assert.equal(
      finalReopen.getInteractionOperation(operation.id)?.state,
      InteractionOperationState.INTERRUPTED,
    );
    assert.deepEqual(finalReopen.listReservedInteractionOperations(session.id), []);
  } finally {
    finalReopen.close();
  }
});

void test('Slice 2 Operation reservation returns typed Message and Session freshness conflicts', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));

  const missingInitial = createInitialSession(policies, 'operation-missing-message');
  const missingMessage = createUserMessage(
    missingInitial,
    'operation-missing-message',
    '尚未持久化',
    '2026-08-14T01:00:01.000Z',
  );
  const missingSession = transitionSession(
    missingInitial,
    InteractionSessionState.OPEN,
    missingMessage.createdAt,
  );
  store.createInteractionSession(createSessionInput(missingInitial, 'operation-missing-message'));
  store.transitionInteractionSession(
    createSessionTransitionInput(missingInitial, missingSession, 'operation-missing-message'),
  );
  const missingOperation = createReservedOperation(
    missingSession,
    missingMessage,
    'operation-missing-message',
  );
  assert.deepEqual(
    store.reserveInteractionOperation(
      createOperationReservationInput(
        missingSession,
        missingMessage,
        missingOperation,
        'operation-missing-message',
      ),
    ),
    { status: 'MESSAGE_NOT_FOUND' },
  );

  const initial = createInitialSession(policies, 'operation-stale-session');
  const message = createUserMessage(
    initial,
    'operation-stale-session',
    '原始消息',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  store.createInteractionSession(createSessionInput(initial, 'operation-stale-session'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'operation-stale-session'),
  );

  const substitutedMessage = createUserMessage(
    initial,
    'operation-stale-session',
    '替换消息',
    message.createdAt,
  );
  const substitutedOperation = createReservedOperation(
    session,
    substitutedMessage,
    'operation-substituted-message',
  );
  assert.deepEqual(
    store.reserveInteractionOperation(
      createOperationReservationInput(
        session,
        substitutedMessage,
        substitutedOperation,
        'operation-substituted-message',
      ),
    ),
    { status: 'MESSAGE_CONFLICT', currentMessage: message },
  );

  const closing = transitionSession(
    session,
    InteractionSessionState.CLOSING,
    '2026-08-14T01:00:03.000Z',
  );
  store.transitionInteractionSession(
    createSessionTransitionInput(session, closing, 'operation-stale-session-closing'),
  );
  const staleOperation = createReservedOperation(session, message, 'operation-stale-session');
  assert.deepEqual(
    store.reserveInteractionOperation(
      createOperationReservationInput(session, message, staleOperation, 'operation-stale-session'),
    ),
    { status: 'VERSION_CONFLICT', currentSession: closing },
  );
  store.close();
});

const operationReservationRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_OPERATION_RESERVATION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_OPERATION_WRITE,
  InteractionTransactionStep.AFTER_AUDIT_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of operationReservationRollbackSteps) {
  void test(`Slice 2 Operation reservation rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const initial = createInitialSession(policies, `operation-reserve-rollback-${step}`);
    const message = createUserMessage(
      initial,
      `operation-reserve-rollback-${step}`,
      '预约回滚',
      '2026-08-14T01:00:01.000Z',
    );
    const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
    const operation = createReservedOperation(
      session,
      message,
      `operation-reserve-rollback-${step}`,
    );
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    setup.createInteractionSession(
      createSessionInput(initial, `operation-reserve-rollback-${step}`),
    );
    setup.admitInteractionUserMessage(
      createUserMessageAdmissionInput(
        initial,
        message,
        session,
        `operation-reserve-rollback-${step}`,
      ),
    );
    setup.close();

    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () =>
        store.reserveInteractionOperation(
          createOperationReservationInput(
            session,
            message,
            operation,
            `operation-reserve-rollback-${step}`,
          ),
        ),
      new RegExp(step),
    );
    assert.equal(store.getInteractionOperation(operation.id), undefined);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    try {
      assert.equal(reopened.getInteractionOperation(operation.id), undefined);
      assert.deepEqual(reopened.listReservedInteractionOperations(session.id), []);
    } finally {
      reopened.close();
    }
  });
}

void test('B1 deterministic Route result applies once and strictly reopens without Proposal', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'b1-deterministic-route');
  const message = createUserMessage(
    initial,
    'b1-deterministic-route',
    '列出目标',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(session, message, 'b1-deterministic-route');
  const decision = createRouteDecision(session, message, 'b1-deterministic-route');
  const completed = completeRouteOperation(operation, decision);
  const input = createRouteResultCommitInput(
    session,
    message,
    operation,
    decision,
    completed,
    'b1-deterministic-route',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'b1-deterministic-route'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'b1-deterministic-route'),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, 'b1-deterministic-route'),
  );
  assert.deepEqual(store.commitInteractionRouteResult(input), {
    status: 'APPLIED',
    decision,
    operation: completed,
  });
  assert.deepEqual(store.commitInteractionRouteResult(input), {
    status: 'REPLAYED',
    decision,
    operation: completed,
  });
  const duplicateOperation = createReservedOperation(
    session,
    message,
    'b1-deterministic-route-duplicate',
    '2026-08-14T01:00:04.000Z',
  );
  assert.deepEqual(
    store.reserveInteractionOperation(
      createOperationReservationInput(
        session,
        message,
        duplicateOperation,
        'b1-deterministic-route-duplicate',
      ),
    ),
    { status: 'OPERATION_CONFLICT', currentOperation: completed },
  );
  assert.deepEqual(store.getInteractionRouteDecision(decision.id), decision);
  assert.equal(
    store.getInteractionRouteProposal(routeProposalId('route-proposal_absent-b1')),
    undefined,
  );
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionOperation(operation.id), completed);
    assert.deepEqual(reopened.getInteractionRouteDecision(decision.id), decision);
    assert.deepEqual(reopened.commitInteractionRouteResult(input), {
      status: 'REPLAYED',
      decision,
      operation: completed,
    });
  } finally {
    reopened.close();
  }
});

void test('B1 Assistant Route reserves its Manifest, rejects generic bypass, and completes exact Proposal chain', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'b1-assistant-route');
  const message = createUserMessage(
    initial,
    'b1-assistant-route',
    '帮我判断下一步',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const reservation = createAssistantRouteReservation(session, message, 'b1-assistant-route');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'b1-assistant-route'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'b1-assistant-route'),
  );
  assert.throws(
    () =>
      store.reserveInteractionOperation({
        session,
        message,
        operation: reservation.operation,
        auditWrite: createAssistantRouteReservationInput(
          session,
          message,
          reservation,
          'b1-assistant-generic-bypass',
        ).operationAuditWrite,
      } as unknown as ReserveInteractionOperation),
    /cannot create a companion-bound Operation/u,
  );
  assert.deepEqual(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(session, message, reservation, 'b1-assistant-route'),
    ),
    { status: 'RESERVED', manifest: reservation.manifest, operation: reservation.operation },
  );
  const proposal = createAssistantNoActionProposal(reservation, 'b1-assistant-route');
  const invalidAnswerDecision = createAnswerRouteDecision(
    session,
    message,
    proposal,
    'b1-assistant-route-invalid-answer',
  );
  const invalidAnswerCompletion = completeRouteOperation(
    reservation.operation,
    invalidAnswerDecision,
    proposal,
  );
  assert.throws(
    () =>
      store.commitInteractionRouteResult(
        createRouteResultCommitInput(
          session,
          message,
          reservation.operation,
          invalidAnswerDecision,
          invalidAnswerCompletion,
          'b1-assistant-route-invalid-answer',
          { manifest: reservation.manifest, proposal },
        ),
      ),
    /exact Manifest, Proposal, Decision, and result/u,
  );
  assert.deepEqual(store.getInteractionOperation(reservation.operation.id), reservation.operation);
  assert.equal(store.getInteractionRouteProposal(proposal.id), undefined);
  assert.equal(store.getInteractionRouteDecision(invalidAnswerDecision.id), undefined);
  const decision = createRouteDecision(session, message, 'b1-assistant-route', proposal);
  const completed = completeRouteOperation(reservation.operation, decision, proposal);
  const resultInput = createRouteResultCommitInput(
    session,
    message,
    reservation.operation,
    decision,
    completed,
    'b1-assistant-route-result',
    { manifest: reservation.manifest, proposal },
  );
  assert.deepEqual(store.commitInteractionRouteResult(resultInput), {
    status: 'APPLIED',
    proposal,
    decision,
    operation: completed,
  });
  assert.deepEqual(
    store.getFrontstageContextManifest(reservation.manifest.id),
    reservation.manifest,
  );
  assert.deepEqual(store.getInteractionRouteProposal(proposal.id), proposal);
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(
      reopened.getFrontstageContextManifest(reservation.manifest.id),
      reservation.manifest,
    );
    assert.deepEqual(reopened.getInteractionRouteProposal(proposal.id), proposal);
    assert.deepEqual(reopened.getInteractionRouteDecision(decision.id), decision);
    assert.deepEqual(reopened.getInteractionOperation(reservation.operation.id), completed);
  } finally {
    reopened.close();
  }
});

void test('B1 Assistant Route reservation returns each authority conflict as typed data', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const missingInitial = createInitialSession(policies, 'b1-assistant-reservation-missing');
  const missingMessage = createUserMessage(
    missingInitial,
    'b1-assistant-reservation-missing',
    '不存在的会话',
    '2026-08-14T01:00:01.000Z',
  );
  const missingSession = transitionSession(
    missingInitial,
    InteractionSessionState.OPEN,
    missingMessage.createdAt,
  );
  const missingReservation = createAssistantRouteReservation(
    missingSession,
    missingMessage,
    'b1-assistant-reservation-missing',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  assert.deepEqual(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        missingSession,
        missingMessage,
        missingReservation,
        'b1-assistant-reservation-missing',
      ),
    ),
    { status: 'SESSION_NOT_FOUND' },
  );

  const missingMessageInitial = createInitialSession(
    policies,
    'b1-assistant-reservation-missing-message',
  );
  const unpersistedMessage = createUserMessage(
    missingMessageInitial,
    'b1-assistant-reservation-missing-message',
    '尚未持久化的消息',
    '2026-08-14T01:00:01.000Z',
  );
  const missingMessageSession = transitionSession(
    missingMessageInitial,
    InteractionSessionState.OPEN,
    unpersistedMessage.createdAt,
  );
  const missingMessageReservation = createAssistantRouteReservation(
    missingMessageSession,
    unpersistedMessage,
    'b1-assistant-reservation-missing-message',
  );
  store.createInteractionSession(
    createSessionInput(missingMessageInitial, 'b1-assistant-reservation-missing-message'),
  );
  store.transitionInteractionSession(
    createSessionTransitionInput(
      missingMessageInitial,
      missingMessageSession,
      'b1-assistant-reservation-missing-message',
    ),
  );
  assert.deepEqual(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        missingMessageSession,
        unpersistedMessage,
        missingMessageReservation,
        'b1-assistant-reservation-missing-message',
      ),
    ),
    { status: 'MESSAGE_NOT_FOUND' },
  );

  const initial = createInitialSession(policies, 'b1-assistant-reservation-conflicts');
  const message = createUserMessage(
    initial,
    'b1-assistant-reservation-conflicts',
    '保留的消息',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  store.createInteractionSession(createSessionInput(initial, 'b1-assistant-reservation-conflicts'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(
      initial,
      message,
      session,
      'b1-assistant-reservation-conflicts',
    ),
  );

  const substitutedContent = '替换后的消息';
  const substitutedMessageBase = {
    id: message.id,
    schemaVersion: message.schemaVersion,
    sessionId: message.sessionId,
    principalRef: message.principalRef,
    role: InteractionMessageRole.USER,
    retention: InteractionContentRetention.RETAINED,
    content: substitutedContent,
    contentDigest: digests.digestUtf8(substitutedContent),
    contentByteLength: Buffer.byteLength(substitutedContent, 'utf8'),
    createdAt: message.createdAt,
  };
  const substitutedMessage = decodeInteractionMessage(
    {
      ...substitutedMessageBase,
      messageDigest: digests.digest(interactionMessageProjection(substitutedMessageBase)),
    },
    digests,
  );
  const substitutedReservation = createAssistantRouteReservation(
    session,
    substitutedMessage,
    'b1-assistant-reservation-message-conflict',
  );
  assert.deepEqual(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        session,
        substitutedMessage,
        substitutedReservation,
        'b1-assistant-reservation-message-conflict',
      ),
    ),
    { status: 'MESSAGE_CONFLICT', currentMessage: message },
  );

  const reservation = createAssistantRouteReservation(
    session,
    message,
    'b1-assistant-reservation-conflicts',
  );
  assert.equal(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        session,
        message,
        reservation,
        'b1-assistant-reservation-conflicts',
      ),
    ).status,
    'RESERVED',
  );
  const manifestConflict = createAssistantRouteReservation(
    session,
    message,
    'b1-assistant-reservation-manifest-conflict',
    '2026-08-14T01:00:02.100Z',
    'frontstage-assistant-profile-v2',
    reservation.manifest.id,
  );
  assert.deepEqual(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        session,
        message,
        manifestConflict,
        'b1-assistant-reservation-manifest-conflict',
      ),
    ),
    { status: 'CONTEXT_MANIFEST_CONFLICT', currentManifest: reservation.manifest },
  );

  const closing = transitionSession(
    session,
    InteractionSessionState.CLOSING,
    '2026-08-14T01:00:04.000Z',
  );
  store.transitionInteractionSession(
    createSessionTransitionInput(session, closing, 'b1-assistant-reservation-closing'),
  );
  const staleReservation = createAssistantRouteReservation(
    session,
    message,
    'b1-assistant-reservation-version-conflict',
    '2026-08-14T01:00:05.000Z',
  );
  assert.deepEqual(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        session,
        message,
        staleReservation,
        'b1-assistant-reservation-version-conflict',
      ),
    ),
    { status: 'VERSION_CONFLICT', currentSession: closing },
  );
  store.close();
});

void test('B1 Route result commit returns missing and conflicting authority as typed data', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));

  const createAdmittedSession = (suffix: string) => {
    const initial = createInitialSession(policies, suffix);
    const message = createUserMessage(
      initial,
      suffix,
      `路由结果 ${suffix}`,
      '2026-08-14T01:00:01.000Z',
    );
    const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
    store.createInteractionSession(createSessionInput(initial, suffix));
    store.admitInteractionUserMessage(
      createUserMessageAdmissionInput(initial, message, session, suffix),
    );
    return Object.freeze({ initial, message, session });
  };

  const missing = createAdmittedSession('b1-route-result-missing');
  const missingOperation = createReservedOperation(
    missing.session,
    missing.message,
    'b1-route-result-missing',
  );
  const missingDecision = createRouteDecision(
    missing.session,
    missing.message,
    'b1-route-result-missing',
  );
  const missingCompletion = completeRouteOperation(missingOperation, missingDecision);
  assert.deepEqual(
    store.commitInteractionRouteResult(
      createRouteResultCommitInput(
        missing.session,
        missing.message,
        missingOperation,
        missingDecision,
        missingCompletion,
        'b1-route-result-missing',
      ),
    ),
    { status: 'OPERATION_NOT_FOUND' },
  );

  const stale = createAdmittedSession('b1-route-result-version-conflict');
  const staleOperation = createReservedOperation(
    stale.session,
    stale.message,
    'b1-route-result-version-conflict',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      stale.session,
      stale.message,
      staleOperation,
      'b1-route-result-version-conflict',
    ),
  );
  const staleDecision = createRouteDecision(
    stale.session,
    stale.message,
    'b1-route-result-version-conflict',
  );
  const staleCompletion = completeRouteOperation(staleOperation, staleDecision);
  const closing = transitionSession(
    stale.session,
    InteractionSessionState.CLOSING,
    '2026-08-14T01:00:04.000Z',
  );
  store.transitionInteractionSession(
    createSessionTransitionInput(
      stale.session,
      closing,
      'b1-route-result-version-conflict-closing',
    ),
  );
  assert.deepEqual(
    store.commitInteractionRouteResult(
      createRouteResultCommitInput(
        stale.session,
        stale.message,
        staleOperation,
        staleDecision,
        staleCompletion,
        'b1-route-result-version-conflict',
      ),
    ),
    { status: 'VERSION_CONFLICT', currentSession: closing },
  );

  const retained = createAdmittedSession('b1-route-result-retained-authority');
  const retainedReservation = createAssistantRouteReservation(
    retained.session,
    retained.message,
    'b1-route-result-retained-authority',
  );
  store.reserveAssistantRouteOperation(
    createAssistantRouteReservationInput(
      retained.session,
      retained.message,
      retainedReservation,
      'b1-route-result-retained-authority',
    ),
  );
  const retainedProposal = createAssistantNoActionProposal(
    retainedReservation,
    'b1-route-result-retained-authority',
  );
  const retainedDecision = createRouteDecision(
    retained.session,
    retained.message,
    'b1-route-result-retained-authority',
    retainedProposal,
  );
  const retainedCompletion = completeRouteOperation(
    retainedReservation.operation,
    retainedDecision,
    retainedProposal,
  );
  store.commitInteractionRouteResult(
    createRouteResultCommitInput(
      retained.session,
      retained.message,
      retainedReservation.operation,
      retainedDecision,
      retainedCompletion,
      'b1-route-result-retained-authority',
      { manifest: retainedReservation.manifest, proposal: retainedProposal },
    ),
  );

  const proposalConflict = createAdmittedSession('b1-route-result-proposal-conflict');
  const proposalConflictReservation = createAssistantRouteReservation(
    proposalConflict.session,
    proposalConflict.message,
    'b1-route-result-proposal-conflict',
  );
  store.reserveAssistantRouteOperation(
    createAssistantRouteReservationInput(
      proposalConflict.session,
      proposalConflict.message,
      proposalConflictReservation,
      'b1-route-result-proposal-conflict',
    ),
  );
  const conflictingProposal = createAssistantNoActionProposal(
    proposalConflictReservation,
    'b1-route-result-proposal-conflict',
    '2026-08-14T01:00:02.500Z',
    retainedProposal.id,
  );
  const proposalConflictDecision = createRouteDecision(
    proposalConflict.session,
    proposalConflict.message,
    'b1-route-result-proposal-conflict',
    conflictingProposal,
  );
  const proposalConflictCompletion = completeRouteOperation(
    proposalConflictReservation.operation,
    proposalConflictDecision,
    conflictingProposal,
  );
  assert.deepEqual(
    store.commitInteractionRouteResult(
      createRouteResultCommitInput(
        proposalConflict.session,
        proposalConflict.message,
        proposalConflictReservation.operation,
        proposalConflictDecision,
        proposalConflictCompletion,
        'b1-route-result-proposal-conflict',
        { manifest: proposalConflictReservation.manifest, proposal: conflictingProposal },
      ),
    ),
    { status: 'ROUTE_PROPOSAL_CONFLICT', currentProposal: retainedProposal },
  );

  const decisionConflict = createAdmittedSession('b1-route-result-decision-conflict');
  const decisionConflictOperation = createReservedOperation(
    decisionConflict.session,
    decisionConflict.message,
    'b1-route-result-decision-conflict',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      decisionConflict.session,
      decisionConflict.message,
      decisionConflictOperation,
      'b1-route-result-decision-conflict',
    ),
  );
  const conflictingDecision = createRouteDecision(
    decisionConflict.session,
    decisionConflict.message,
    'b1-route-result-decision-conflict',
    undefined,
    undefined,
    '2026-08-14T01:00:03.000Z',
    retainedDecision.id,
  );
  const decisionConflictCompletion = completeRouteOperation(
    decisionConflictOperation,
    conflictingDecision,
  );
  assert.deepEqual(
    store.commitInteractionRouteResult(
      createRouteResultCommitInput(
        decisionConflict.session,
        decisionConflict.message,
        decisionConflictOperation,
        conflictingDecision,
        decisionConflictCompletion,
        'b1-route-result-decision-conflict',
      ),
    ),
    { status: 'ROUTE_DECISION_CONFLICT', currentDecision: retainedDecision },
  );
  store.close();
});

void test('B1 SQLite guards exact Manifest, Proposal parent, and Runtime Decision authority', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'b1-route-result-sql-guards');
  const message = createUserMessage(
    initial,
    'b1-route-result-sql-guards',
    'SQL 守卫',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const reservation = createAssistantRouteReservation(
    session,
    message,
    'b1-route-result-sql-guards',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'b1-route-result-sql-guards'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'b1-route-result-sql-guards'),
  );
  store.reserveAssistantRouteOperation(
    createAssistantRouteReservationInput(
      session,
      message,
      reservation,
      'b1-route-result-sql-guards',
    ),
  );
  store.close();

  const proposal = createAssistantNoActionProposal(reservation, 'b1-route-result-sql-guards');
  const decision = createRouteDecision(session, message, 'b1-route-result-sql-guards');
  const substitutedOperation = createReservedOperation(
    session,
    message,
    'b1-route-result-sql-guards-substituted-operation',
    '2026-08-14T01:00:02.100Z',
    {
      contextManifestRef: {
        id: reservation.manifest.id,
        digest: reservation.manifest.manifestDigest,
      },
      assistantProfile: reservation.manifest.assistantProfile,
    },
  );
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    assert.throws(
      () => insertRawReservedInteractionOperation(database, substitutedOperation),
      /Assistant Route Operation lacks its exact Context Manifest/u,
    );
    assert.throws(
      () =>
        insertRawInteractionRouteProposal(database, proposal, {
          operationId: interactionOperationId('interaction-operation_substituted-parent'),
        }),
      /Route Proposal lacks its exact Assistant reservation parent/u,
    );
    assert.throws(
      () =>
        insertRawInteractionRouteDecision(database, decision, {
          expectedSessionVersion: decision.expectedSessionVersion + 1,
        }),
      /Route Decision lacks exact current Runtime authority/u,
    );
  } finally {
    database.close();
  }
});

void test('B1 concurrent Route consumers produce one completion and one typed loser', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'b1-concurrent-route');
  const message = createUserMessage(
    initial,
    'b1-concurrent-route',
    '列出当前目标',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(session, message, 'b1-concurrent-route');
  const firstDecision = createRouteDecision(session, message, 'b1-concurrent-route-first');
  const secondDecision = createRouteDecision(session, message, 'b1-concurrent-route-second');
  const firstCompleted = completeRouteOperation(operation, firstDecision);
  const secondCompleted = completeRouteOperation(operation, secondDecision);
  const setup = SqliteControlStore.open({ filename });
  setup.installInteractionPolicies(installInput(policies));
  setup.createInteractionSession(createSessionInput(initial, 'b1-concurrent-route'));
  setup.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'b1-concurrent-route'),
  );
  setup.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, 'b1-concurrent-route'),
  );
  setup.close();

  const firstStore = SqliteControlStore.open({ filename });
  const secondStore = SqliteControlStore.open({ filename });
  try {
    assert.equal(
      firstStore.commitInteractionRouteResult(
        createRouteResultCommitInput(
          session,
          message,
          operation,
          firstDecision,
          firstCompleted,
          'b1-concurrent-route-first',
        ),
      ).status,
      'APPLIED',
    );
    assert.deepEqual(
      secondStore.commitInteractionRouteResult(
        createRouteResultCommitInput(
          session,
          message,
          operation,
          secondDecision,
          secondCompleted,
          'b1-concurrent-route-second',
        ),
      ),
      { status: 'OPERATION_CONFLICT', currentOperation: firstCompleted },
    );
  } finally {
    firstStore.close();
    secondStore.close();
  }
});

const assistantRouteReservationRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_CONTEXT_MANIFEST_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_CONTEXT_MANIFEST_WRITE,
  InteractionTransactionStep.AFTER_CONTEXT_MANIFEST_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_OPERATION_RESERVATION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_OPERATION_WRITE,
  InteractionTransactionStep.AFTER_ASSISTANT_ROUTE_RESERVATION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of assistantRouteReservationRollbackSteps) {
  void test(`B1 Assistant Route reservation rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const initial = createInitialSession(policies, `b1-assistant-reserve-${step}`);
    const message = createUserMessage(
      initial,
      `b1-assistant-reserve-${step}`,
      'Assistant 预约回滚',
      '2026-08-14T01:00:01.000Z',
    );
    const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
    const reservation = createAssistantRouteReservation(
      session,
      message,
      `b1-assistant-reserve-${step}`,
    );
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    setup.createInteractionSession(createSessionInput(initial, `b1-assistant-reserve-${step}`));
    setup.admitInteractionUserMessage(
      createUserMessageAdmissionInput(initial, message, session, `b1-assistant-reserve-${step}`),
    );
    setup.close();
    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () =>
        store.reserveAssistantRouteOperation(
          createAssistantRouteReservationInput(
            session,
            message,
            reservation,
            `b1-assistant-reserve-${step}`,
          ),
        ),
      new RegExp(step),
    );
    assert.equal(store.getFrontstageContextManifest(reservation.manifest.id), undefined);
    assert.equal(store.getInteractionOperation(reservation.operation.id), undefined);
    store.close();
    const reopened = SqliteControlStore.open({ filename });
    reopened.close();
  });
}

const routeResultRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_ROUTE_PROPOSAL_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ROUTE_PROPOSAL_WRITE,
  InteractionTransactionStep.AFTER_ROUTE_PROPOSAL_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_ROUTE_DECISION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ROUTE_DECISION_WRITE,
  InteractionTransactionStep.AFTER_ROUTE_DECISION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_ROUTE_COMPLETION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ROUTE_COMPLETION_WRITE,
  InteractionTransactionStep.AFTER_ROUTE_COMPLETION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of routeResultRollbackSteps) {
  void test(`B1 Route result rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const initial = createInitialSession(policies, `b1-route-result-${step}`);
    const message = createUserMessage(
      initial,
      `b1-route-result-${step}`,
      'Route 结果回滚',
      '2026-08-14T01:00:01.000Z',
    );
    const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
    const reservation = createAssistantRouteReservation(
      session,
      message,
      `b1-route-result-${step}`,
    );
    const proposal = createAssistantNoActionProposal(reservation, `b1-route-result-${step}`);
    const decision = createRouteDecision(session, message, `b1-route-result-${step}`, proposal);
    const completed = completeRouteOperation(reservation.operation, decision, proposal);
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    setup.createInteractionSession(createSessionInput(initial, `b1-route-result-${step}`));
    setup.admitInteractionUserMessage(
      createUserMessageAdmissionInput(initial, message, session, `b1-route-result-${step}`),
    );
    setup.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        session,
        message,
        reservation,
        `b1-route-result-reserve-${step}`,
      ),
    );
    setup.close();
    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () =>
        store.commitInteractionRouteResult(
          createRouteResultCommitInput(
            session,
            message,
            reservation.operation,
            decision,
            completed,
            `b1-route-result-${step}`,
            { manifest: reservation.manifest, proposal },
          ),
        ),
      new RegExp(step),
    );
    assert.deepEqual(
      store.getInteractionOperation(reservation.operation.id),
      reservation.operation,
    );
    assert.equal(store.getInteractionRouteProposal(proposal.id), undefined);
    assert.equal(store.getInteractionRouteDecision(decision.id), undefined);
    store.close();
    const reopened = SqliteControlStore.open({ filename });
    reopened.close();
  });
}

void test('B2 direct Pending Action proposal atomically authorizes, reserves, replays, and reopens', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const prepared = preparePendingActionProposal(
    store,
    policies,
    'b2-direct-action',
    InteractionConfirmationRequirement.DIRECT_USER_MESSAGE_SUFFICIENT,
  );
  const resolution = createPendingActionResolution(
    prepared.pendingAction,
    'b2-direct-action',
    PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED,
  );
  const reservation = createActionReservation(
    prepared.pendingAction,
    resolution,
    'b2-direct-action',
  );
  const input = createPendingActionProposalCommitInput(
    prepared.session,
    prepared.message,
    prepared.decision,
    prepared.pendingAction,
    prepared.operation,
    prepared.completedOperation,
    'b2-direct-action',
    resolution,
    reservation,
  );

  assert.deepEqual(store.commitInteractionPendingActionProposal(input), {
    status: 'APPLIED',
    pendingAction: prepared.pendingAction,
    resolution,
    reservation,
    operation: prepared.completedOperation,
  });
  assert.deepEqual(store.commitInteractionPendingActionProposal(input), {
    status: 'REPLAYED',
    pendingAction: prepared.pendingAction,
    resolution,
    reservation,
    operation: prepared.completedOperation,
  });
  assert.deepEqual(
    store.getInteractionPendingAction(prepared.pendingAction.id),
    prepared.pendingAction,
  );
  assert.deepEqual(store.getInteractionPendingActionResolution(resolution.id), resolution);
  assert.deepEqual(store.getInteractionActionReservation(reservation.id), reservation);
  assert.equal(store.getUnresolvedInteractionPendingAction(prepared.session.id), undefined);
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  assert.deepEqual(
    reopened.getInteractionPendingAction(prepared.pendingAction.id),
    prepared.pendingAction,
  );
  assert.deepEqual(reopened.getInteractionPendingActionResolution(resolution.id), resolution);
  assert.deepEqual(reopened.getInteractionActionReservation(reservation.id), reservation);
  reopened.close();
});

void test('B2 separate confirmation preserves one unresolved Action until its exact response commits', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const prepared = preparePendingActionProposal(
    store,
    policies,
    'b2-separate-action',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  const proposalInput = createPendingActionProposalCommitInput(
    prepared.session,
    prepared.message,
    prepared.decision,
    prepared.pendingAction,
    prepared.operation,
    prepared.completedOperation,
    'b2-separate-action',
  );
  assert.equal(store.commitInteractionPendingActionProposal(proposalInput).status, 'APPLIED');
  assert.deepEqual(
    store.getUnresolvedInteractionPendingAction(prepared.session.id),
    prepared.pendingAction,
  );

  const responseMessage = createUserMessage(
    prepared.session,
    'b2-separate-action-response',
    '确认执行',
    '2026-08-14T01:00:06.000Z',
  );
  const responseSession = transitionSession(
    prepared.session,
    InteractionSessionState.OPEN,
    responseMessage.createdAt,
  );
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(
      prepared.session,
      responseMessage,
      responseSession,
      'b2-separate-action-response',
    ),
  );
  const confirmationOperation = createReservedActionOperation(
    responseSession,
    responseMessage,
    'b2-separate-action-confirmation',
    InteractionOperationKind.ACTION_CONFIRMATION,
    '2026-08-14T01:00:06.500Z',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      responseSession,
      responseMessage,
      confirmationOperation,
      'b2-separate-action-confirmation',
    ),
  );
  const resolution = createPendingActionResolution(
    prepared.pendingAction,
    'b2-separate-action',
    PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
    responseMessage,
  );
  const reservation = createActionReservation(
    prepared.pendingAction,
    resolution,
    'b2-separate-action',
  );
  const completedOperation = completeActionConfirmationOperation(
    confirmationOperation,
    resolution,
    reservation,
  );
  const confirmationInput = createActionConfirmationCommitInput(
    responseSession,
    prepared.message,
    responseMessage,
    prepared.decision,
    prepared.pendingAction,
    resolution,
    confirmationOperation,
    completedOperation,
    'b2-separate-action',
    reservation,
  );
  assert.deepEqual(store.commitInteractionActionConfirmation(confirmationInput), {
    status: 'APPLIED',
    resolution,
    reservation,
    operation: completedOperation,
  });
  assert.deepEqual(store.commitInteractionActionConfirmation(confirmationInput), {
    status: 'REPLAYED',
    resolution,
    reservation,
    operation: completedOperation,
  });
  assert.deepEqual(store.commitInteractionPendingActionProposal(proposalInput), {
    status: 'REPLAYED',
    pendingAction: prepared.pendingAction,
    operation: prepared.completedOperation,
  });
  assert.equal(store.getUnresolvedInteractionPendingAction(responseSession.id), undefined);
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  assert.deepEqual(reopened.getInteractionPendingActionResolution(resolution.id), resolution);
  assert.deepEqual(reopened.getInteractionActionReservation(reservation.id), reservation);
  reopened.close();
});

void test('B2 response-free terminal Resolution closes an unresolved Action without inventing an Operation', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const prepared = preparePendingActionProposal(
    store,
    policies,
    'b2-expired-action',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  const proposalInput = createPendingActionProposalCommitInput(
    prepared.session,
    prepared.message,
    prepared.decision,
    prepared.pendingAction,
    prepared.operation,
    prepared.completedOperation,
    'b2-expired-action',
  );
  store.commitInteractionPendingActionProposal(proposalInput);
  const resolution = createPendingActionResolution(
    prepared.pendingAction,
    'b2-expired-action',
    PendingActionResolutionDisposition.EXPIRED,
  );
  const input = createTerminalResolutionRecordInput(
    prepared.session,
    prepared.message,
    prepared.decision,
    prepared.pendingAction,
    resolution,
    'b2-expired-action',
  );
  assert.deepEqual(store.recordInteractionPendingActionTerminalResolution(input), {
    status: 'APPLIED',
    resolution,
  });
  assert.deepEqual(store.recordInteractionPendingActionTerminalResolution(input), {
    status: 'REPLAYED',
    resolution,
  });
  assert.deepEqual(store.commitInteractionPendingActionProposal(proposalInput), {
    status: 'REPLAYED',
    pendingAction: prepared.pendingAction,
    operation: prepared.completedOperation,
  });
  assert.equal(store.getUnresolvedInteractionPendingAction(prepared.session.id), undefined);
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  assert.deepEqual(reopened.getInteractionPendingActionResolution(resolution.id), resolution);
  reopened.close();
});

for (const disposition of [
  PendingActionResolutionDisposition.DECLINED,
  PendingActionResolutionDisposition.UNCLEAR,
] as const) {
  void test(`B2 ${disposition} response completes confirmation without a Reservation`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const store = SqliteControlStore.open({ filename });
    store.installInteractionPolicies(installInput(policies));
    const prepared = preparePendingActionProposal(
      store,
      policies,
      `b2-${disposition}`,
      InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
    );
    store.commitInteractionPendingActionProposal(
      createPendingActionProposalCommitInput(
        prepared.session,
        prepared.message,
        prepared.decision,
        prepared.pendingAction,
        prepared.operation,
        prepared.completedOperation,
        `b2-${disposition}`,
      ),
    );
    const confirmation = prepareResponseBoundConfirmation(
      store,
      prepared,
      `b2-${disposition}`,
      disposition,
    );
    assert.deepEqual(store.commitInteractionActionConfirmation(confirmation.input), {
      status: 'APPLIED',
      resolution: confirmation.resolution,
      operation: confirmation.completedOperation,
    });
    assert.equal(store.getUnresolvedInteractionPendingAction(confirmation.session.id), undefined);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    assert.deepEqual(
      reopened.getInteractionPendingActionResolution(confirmation.resolution.id),
      confirmation.resolution,
    );
    reopened.close();
  });
}

for (const disposition of [
  PendingActionResolutionDisposition.STALE_AUTHORITY,
  PendingActionResolutionDisposition.CONFLICT,
  PendingActionResolutionDisposition.INTERRUPTED,
] as const) {
  void test(`B2 response-free ${disposition} closes independently and strictly reopens`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const store = SqliteControlStore.open({ filename });
    store.installInteractionPolicies(installInput(policies));
    const prepared = preparePendingActionProposal(
      store,
      policies,
      `b2-${disposition}`,
      InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
    );
    store.commitInteractionPendingActionProposal(
      createPendingActionProposalCommitInput(
        prepared.session,
        prepared.message,
        prepared.decision,
        prepared.pendingAction,
        prepared.operation,
        prepared.completedOperation,
        `b2-${disposition}`,
      ),
    );
    const resolution = createPendingActionResolution(
      prepared.pendingAction,
      `b2-${disposition}`,
      disposition,
    );
    const result = store.recordInteractionPendingActionTerminalResolution(
      createTerminalResolutionRecordInput(
        prepared.session,
        prepared.message,
        prepared.decision,
        prepared.pendingAction,
        resolution,
        `b2-${disposition}`,
      ),
    );
    assert.deepEqual(result, { status: 'APPLIED', resolution });
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    assert.deepEqual(reopened.getInteractionPendingActionResolution(resolution.id), resolution);
    reopened.close();
  });
}

void test('B2 competing Pending Action proposals produce one winner and one typed loser', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const setup = SqliteControlStore.open({ filename });
  setup.installInteractionPolicies(installInput(policies));
  const prepared = preparePendingActionProposal(
    setup,
    policies,
    'b2-competing-proposal',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  const competingAction = createPendingAction(
    prepared.session,
    prepared.message,
    prepared.decision,
    'b2-competing-proposal-second',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  const competingCompletion = completePendingActionProposalOperation(
    prepared.operation,
    competingAction,
  );
  const winningInput = createPendingActionProposalCommitInput(
    prepared.session,
    prepared.message,
    prepared.decision,
    prepared.pendingAction,
    prepared.operation,
    prepared.completedOperation,
    'b2-competing-proposal-first',
  );
  const competingInput = createPendingActionProposalCommitInput(
    prepared.session,
    prepared.message,
    prepared.decision,
    competingAction,
    prepared.operation,
    competingCompletion,
    'b2-competing-proposal-second',
  );
  setup.close();

  const firstStore = SqliteControlStore.open({ filename });
  const secondStore = SqliteControlStore.open({ filename });
  try {
    assert.equal(firstStore.commitInteractionPendingActionProposal(winningInput).status, 'APPLIED');
    assert.deepEqual(secondStore.commitInteractionPendingActionProposal(competingInput), {
      status: 'OPERATION_CONFLICT',
      currentOperation: prepared.completedOperation,
    });
    assert.deepEqual(
      secondStore.getUnresolvedInteractionPendingAction(prepared.session.id),
      prepared.pendingAction,
    );
  } finally {
    firstStore.close();
    secondStore.close();
  }
});

void test('B2 competing Action Confirmations retain one exact Resolution and Reservation winner', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const setup = SqliteControlStore.open({ filename });
  setup.installInteractionPolicies(installInput(policies));
  const prepared = preparePendingActionProposal(
    setup,
    policies,
    'b2-competing-confirmation',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  setup.commitInteractionPendingActionProposal(
    createPendingActionProposalCommitInput(
      prepared.session,
      prepared.message,
      prepared.decision,
      prepared.pendingAction,
      prepared.operation,
      prepared.completedOperation,
      'b2-competing-confirmation',
    ),
  );
  const winning = prepareResponseBoundConfirmation(
    setup,
    prepared,
    'b2-competing-confirmation-first',
    PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
  );
  const competingResolution = createPendingActionResolution(
    prepared.pendingAction,
    'b2-competing-confirmation-second',
    PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
    winning.message,
  );
  const competingReservation = createActionReservation(
    prepared.pendingAction,
    competingResolution,
    'b2-competing-confirmation-second',
  );
  const competingCompletion = completeActionConfirmationOperation(
    winning.operation,
    competingResolution,
    competingReservation,
  );
  const competingInput = createActionConfirmationCommitInput(
    winning.session,
    prepared.message,
    winning.message,
    prepared.decision,
    prepared.pendingAction,
    competingResolution,
    winning.operation,
    competingCompletion,
    'b2-competing-confirmation-second',
    competingReservation,
  );
  setup.close();

  const firstStore = SqliteControlStore.open({ filename });
  const secondStore = SqliteControlStore.open({ filename });
  try {
    assert.equal(firstStore.commitInteractionActionConfirmation(winning.input).status, 'APPLIED');
    assert.deepEqual(secondStore.commitInteractionActionConfirmation(competingInput), {
      status: 'OPERATION_CONFLICT',
      currentOperation: winning.completedOperation,
    });
    assert.deepEqual(
      secondStore.getInteractionPendingActionResolution(winning.resolution.id),
      winning.resolution,
    );
    assert.deepEqual(
      secondStore.getInteractionActionReservation(
        winning.reservation?.id ?? competingReservation.id,
      ),
      winning.reservation,
    );
  } finally {
    firstStore.close();
    secondStore.close();
  }
});

void test('B2 competing response-free Resolutions produce one winner and one typed conflict', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const setup = SqliteControlStore.open({ filename });
  setup.installInteractionPolicies(installInput(policies));
  const prepared = preparePendingActionProposal(
    setup,
    policies,
    'b2-competing-terminal',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  setup.commitInteractionPendingActionProposal(
    createPendingActionProposalCommitInput(
      prepared.session,
      prepared.message,
      prepared.decision,
      prepared.pendingAction,
      prepared.operation,
      prepared.completedOperation,
      'b2-competing-terminal',
    ),
  );
  const winningResolution = createPendingActionResolution(
    prepared.pendingAction,
    'b2-competing-terminal-first',
    PendingActionResolutionDisposition.CONFLICT,
  );
  const competingResolution = createPendingActionResolution(
    prepared.pendingAction,
    'b2-competing-terminal-second',
    PendingActionResolutionDisposition.INTERRUPTED,
  );
  const winningInput = createTerminalResolutionRecordInput(
    prepared.session,
    prepared.message,
    prepared.decision,
    prepared.pendingAction,
    winningResolution,
    'b2-competing-terminal-first',
  );
  const competingInput = createTerminalResolutionRecordInput(
    prepared.session,
    prepared.message,
    prepared.decision,
    prepared.pendingAction,
    competingResolution,
    'b2-competing-terminal-second',
  );
  setup.close();

  const firstStore = SqliteControlStore.open({ filename });
  const secondStore = SqliteControlStore.open({ filename });
  try {
    assert.equal(
      firstStore.recordInteractionPendingActionTerminalResolution(winningInput).status,
      'APPLIED',
    );
    assert.deepEqual(secondStore.recordInteractionPendingActionTerminalResolution(competingInput), {
      status: 'PENDING_ACTION_RESOLUTION_CONFLICT',
      currentResolution: winningResolution,
    });
  } finally {
    firstStore.close();
    secondStore.close();
  }
});

void test('B2 response-free Resolution cannot strand an already reserved confirmation Operation', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const prepared = preparePendingActionProposal(
    store,
    policies,
    'b2-terminal-busy',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  store.commitInteractionPendingActionProposal(
    createPendingActionProposalCommitInput(
      prepared.session,
      prepared.message,
      prepared.decision,
      prepared.pendingAction,
      prepared.operation,
      prepared.completedOperation,
      'b2-terminal-busy',
    ),
  );
  const confirmation = prepareResponseBoundConfirmation(
    store,
    prepared,
    'b2-terminal-busy',
    PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
  );
  const terminalResolution = createPendingActionResolution(
    prepared.pendingAction,
    'b2-terminal-busy',
    PendingActionResolutionDisposition.INTERRUPTED,
  );
  assert.deepEqual(
    store.recordInteractionPendingActionTerminalResolution(
      createTerminalResolutionRecordInput(
        confirmation.session,
        prepared.message,
        prepared.decision,
        prepared.pendingAction,
        terminalResolution,
        'b2-terminal-busy',
      ),
    ),
    {
      status: 'SESSION_OPERATION_BUSY',
      currentOperation: confirmation.operation,
    },
  );
  assert.equal(store.getInteractionPendingActionResolution(terminalResolution.id), undefined);
  store.close();
});

void test('B2 a second unresolved Pending Action is rejected by the retained derived owner', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const first = preparePendingActionProposal(
    store,
    policies,
    'b2-one-unresolved-first',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
  );
  store.commitInteractionPendingActionProposal(
    createPendingActionProposalCommitInput(
      first.session,
      first.message,
      first.decision,
      first.pendingAction,
      first.operation,
      first.completedOperation,
      'b2-one-unresolved-first',
    ),
  );

  const secondMessage = createUserMessage(
    first.session,
    'b2-one-unresolved-second',
    '/intake another request',
    '2026-08-14T01:00:05.000Z',
  );
  const secondSession = transitionSession(
    first.session,
    InteractionSessionState.OPEN,
    secondMessage.createdAt,
  );
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(
      first.session,
      secondMessage,
      secondSession,
      'b2-one-unresolved-second',
    ),
  );
  const routeOperation = createReservedOperation(
    secondSession,
    secondMessage,
    'b2-one-unresolved-second-route',
    '2026-08-14T01:00:05.100Z',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      secondSession,
      secondMessage,
      routeOperation,
      'b2-one-unresolved-second-route',
    ),
  );
  const decision = createActionRouteDecision(
    secondSession,
    secondMessage,
    'b2-one-unresolved-second-route',
    '2026-08-14T01:00:05.200Z',
  );
  const completedRoute = completeRouteOperation(
    routeOperation,
    decision,
    undefined,
    '2026-08-14T01:00:05.300Z',
  );
  store.commitInteractionRouteResult(
    createRouteResultCommitInput(
      secondSession,
      secondMessage,
      routeOperation,
      decision,
      completedRoute,
      'b2-one-unresolved-second-route',
    ),
  );
  const actionOperation = createReservedActionOperation(
    secondSession,
    secondMessage,
    'b2-one-unresolved-second-proposal',
    InteractionOperationKind.ACTION_PROPOSAL,
    '2026-08-14T01:00:05.400Z',
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      secondSession,
      secondMessage,
      actionOperation,
      'b2-one-unresolved-second-proposal',
    ),
  );
  const secondAction = createPendingAction(
    secondSession,
    secondMessage,
    decision,
    'b2-one-unresolved-second',
    InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
    {
      createdAt: '2026-08-14T01:00:05.500Z',
      expiresAt: '2026-08-14T01:00:15.000Z',
    },
  );
  const completedActionOperation = completePendingActionProposalOperation(
    actionOperation,
    secondAction,
    '2026-08-14T01:00:05.600Z',
  );
  assert.deepEqual(
    store.commitInteractionPendingActionProposal(
      createPendingActionProposalCommitInput(
        secondSession,
        secondMessage,
        decision,
        secondAction,
        actionOperation,
        completedActionOperation,
        'b2-one-unresolved-second',
      ),
    ),
    { status: 'PENDING_ACTION_CONFLICT', currentPendingAction: first.pendingAction },
  );
  assert.deepEqual(
    store.terminalizeInteractionOperation(
      createOperationTerminalInput(
        actionOperation,
        terminalizeOperation(
          actionOperation,
          InteractionOperationState.FAILED,
          '2026-08-14T01:00:05.600Z',
        ),
        'b2-one-unresolved-second',
      ),
    ).status,
    'APPLIED',
  );
  assert.deepEqual(
    store.getUnresolvedInteractionPendingAction(secondSession.id),
    first.pendingAction,
  );
  store.close();
});

const pendingActionProposalRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_PENDING_ACTION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_ACTION_RESERVATION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ACTION_RESERVATION_WRITE,
  InteractionTransactionStep.AFTER_ACTION_RESERVATION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of pendingActionProposalRollbackSteps) {
  void test(`B2 direct Pending Action proposal rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    const prepared = preparePendingActionProposal(
      setup,
      policies,
      `b2-proposal-rollback-${step}`,
      InteractionConfirmationRequirement.DIRECT_USER_MESSAGE_SUFFICIENT,
    );
    const resolution = createPendingActionResolution(
      prepared.pendingAction,
      `b2-proposal-rollback-${step}`,
      PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED,
    );
    const reservation = createActionReservation(
      prepared.pendingAction,
      resolution,
      `b2-proposal-rollback-${step}`,
    );
    const input = createPendingActionProposalCommitInput(
      prepared.session,
      prepared.message,
      prepared.decision,
      prepared.pendingAction,
      prepared.operation,
      prepared.completedOperation,
      `b2-proposal-rollback-${step}`,
      resolution,
      reservation,
    );
    setup.close();
    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(() => store.commitInteractionPendingActionProposal(input), /fixture failure/u);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    assert.equal(reopened.getInteractionPendingAction(prepared.pendingAction.id), undefined);
    assert.equal(reopened.getInteractionPendingActionResolution(resolution.id), undefined);
    assert.equal(reopened.getInteractionActionReservation(reservation.id), undefined);
    assert.deepEqual(reopened.getInteractionOperation(prepared.operation.id), prepared.operation);
    reopened.close();
  });
}

const actionConfirmationRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_ACTION_RESERVATION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ACTION_RESERVATION_WRITE,
  InteractionTransactionStep.AFTER_ACTION_RESERVATION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const [stepIndex, step] of actionConfirmationRollbackSteps.entries()) {
  void test(`B2 Action Confirmation rolls back at ${step}`, (t) => {
    const fixtureSuffix = `b2-confirmation-rollback-${stepIndex}`;
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    const prepared = preparePendingActionProposal(
      setup,
      policies,
      fixtureSuffix,
      InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
    );
    setup.commitInteractionPendingActionProposal(
      createPendingActionProposalCommitInput(
        prepared.session,
        prepared.message,
        prepared.decision,
        prepared.pendingAction,
        prepared.operation,
        prepared.completedOperation,
        fixtureSuffix,
      ),
    );
    const confirmation = prepareResponseBoundConfirmation(
      setup,
      prepared,
      fixtureSuffix,
      PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED,
    );
    setup.close();
    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () => store.commitInteractionActionConfirmation(confirmation.input),
      /fixture failure/u,
    );
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    assert.equal(
      reopened.getInteractionPendingActionResolution(confirmation.resolution.id),
      undefined,
    );
    if (confirmation.reservation !== undefined) {
      assert.equal(
        reopened.getInteractionActionReservation(confirmation.reservation.id),
        undefined,
      );
    }
    assert.deepEqual(
      reopened.getInteractionOperation(confirmation.operation.id),
      confirmation.operation,
    );
    assert.deepEqual(
      reopened.getUnresolvedInteractionPendingAction(confirmation.session.id),
      prepared.pendingAction,
    );
    reopened.close();
  });
}

const terminalResolutionRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_WRITE,
  InteractionTransactionStep.AFTER_PENDING_ACTION_RESOLUTION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of terminalResolutionRollbackSteps) {
  void test(`B2 response-free terminal Resolution rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    const prepared = preparePendingActionProposal(
      setup,
      policies,
      `b2-terminal-rollback-${step}`,
      InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED,
    );
    setup.commitInteractionPendingActionProposal(
      createPendingActionProposalCommitInput(
        prepared.session,
        prepared.message,
        prepared.decision,
        prepared.pendingAction,
        prepared.operation,
        prepared.completedOperation,
        `b2-terminal-rollback-${step}`,
      ),
    );
    const resolution = createPendingActionResolution(
      prepared.pendingAction,
      `b2-terminal-rollback-${step}`,
      PendingActionResolutionDisposition.INTERRUPTED,
    );
    const input = createTerminalResolutionRecordInput(
      prepared.session,
      prepared.message,
      prepared.decision,
      prepared.pendingAction,
      resolution,
      `b2-terminal-rollback-${step}`,
    );
    setup.close();
    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () => store.recordInteractionPendingActionTerminalResolution(input),
      /fixture failure/u,
    );
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    assert.equal(reopened.getInteractionPendingActionResolution(resolution.id), undefined);
    assert.deepEqual(
      reopened.getUnresolvedInteractionPendingAction(prepared.session.id),
      prepared.pendingAction,
    );
    reopened.close();
  });
}

void test('B1 historical Intake Clarification replays and failure-closes without reopening creation', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'b1-historical-clarification');
  const message = createUserMessage(
    initial,
    'b1-historical-clarification',
    '历史澄清回答',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedClarificationOperation(
    session,
    message,
    'b1-historical-clarification',
  );
  const setup = SqliteControlStore.open({ filename });
  setup.installInteractionPolicies(installInput(policies));
  setup.createInteractionSession(createSessionInput(initial, 'b1-historical-clarification'));
  setup.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'b1-historical-clarification'),
  );
  setup.close();

  const reservationAudit = createInteractionAuditWrite(
    'b1-historical-clarification',
    'operation-reserved',
    InteractionAuditAggregateType.INTERACTION_OPERATION,
    operation.id,
    InteractionAuditEventType.INTERACTION_OPERATION_RESERVED,
    operation.operationDigest,
    operation.reservedAt,
    undefined,
    operation.version,
  );
  const database = new Database(filename);
  try {
    const clarificationCreationGuard = database
      .prepare(
        `SELECT sql
           FROM sqlite_schema
          WHERE type = 'trigger'
            AND name = 'interaction_operations_clarification_creation_guard'`,
      )
      .pluck()
      .get();
    assert.equal(typeof clarificationCreationGuard, 'string');
    database.exec('DROP TRIGGER interaction_operations_clarification_creation_guard');
    insertRawReservedInteractionOperation(database, operation);
    insertRawInteractionAuditMembership(database, session, reservationAudit);
    database.exec(clarificationCreationGuard as string);
  } finally {
    database.close();
  }

  const store = SqliteControlStore.open({ filename });
  const replayInput = {
    session,
    message,
    operation,
    auditWrite: createInteractionAuditWrite(
      'b1-historical-clarification-replay',
      'operation-reserved',
      InteractionAuditAggregateType.INTERACTION_OPERATION,
      operation.id,
      InteractionAuditEventType.INTERACTION_OPERATION_RESERVED,
      operation.operationDigest,
      operation.reservedAt,
      undefined,
      operation.version,
    ),
  } as unknown as ReserveInteractionOperation;
  assert.deepEqual(store.reserveInteractionOperation(replayInput), {
    status: 'REPLAYED',
    operation,
  });

  const failed = terminalizeOperation(operation, InteractionOperationState.FAILED);
  const terminalInput = createOperationTerminalInput(
    operation,
    failed,
    'b1-historical-clarification',
  );
  assert.deepEqual(store.terminalizeInteractionOperation(terminalInput), {
    status: 'APPLIED',
    operation: failed,
  });
  assert.deepEqual(store.terminalizeInteractionOperation(terminalInput), {
    status: 'REPLAYED',
    operation: failed,
  });

  const newClarification = createReservedClarificationOperation(
    session,
    message,
    'b1-new-clarification-rejected',
  );
  assert.throws(
    () =>
      store.reserveInteractionOperation({
        session,
        message,
        operation: newClarification,
        auditWrite: createInteractionAuditWrite(
          'b1-new-clarification-rejected',
          'operation-reserved',
          InteractionAuditAggregateType.INTERACTION_OPERATION,
          newClarification.id,
          InteractionAuditEventType.INTERACTION_OPERATION_RESERVED,
          newClarification.operationDigest,
          newClarification.reservedAt,
          undefined,
          newClarification.version,
        ),
      } as unknown as ReserveInteractionOperation),
    /cannot create a companion-bound Operation/u,
  );
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionOperation(operation.id), failed);
  } finally {
    reopened.close();
  }
});

void test('B1 SQLite rejects a new Intake Clarification without its B4 creation owner', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'b1-clarification-sql-guard');
  const message = createUserMessage(
    initial,
    'b1-clarification-sql-guard',
    '不能提前创建澄清',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedClarificationOperation(
    session,
    message,
    'b1-clarification-sql-guard',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'b1-clarification-sql-guard'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'b1-clarification-sql-guard'),
  );
  store.close();

  const database = new Database(filename);
  try {
    assert.throws(
      () => insertRawReservedInteractionOperation(database, operation),
      /Intake Clarification requires its result-specific creation owner/u,
    );
  } finally {
    database.close();
  }
});

void test('Slice 2 Operation failure/interruption terminalization replays and releases serialization', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'operation-terminal');
  const firstMessage = createUserMessage(
    initial,
    'operation-terminal-first',
    '第一次操作',
    '2026-08-14T01:00:01.000Z',
  );
  const firstSession = transitionSession(
    initial,
    InteractionSessionState.OPEN,
    firstMessage.createdAt,
  );
  const firstAssistantReservation = createAssistantRouteReservation(
    firstSession,
    firstMessage,
    'operation-terminal-first',
    '2026-08-14T01:00:02.000Z',
  );
  const firstOperation = firstAssistantReservation.operation;
  const failed = terminalizeOperation(firstOperation, InteractionOperationState.FAILED);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'operation-terminal'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(
      initial,
      firstMessage,
      firstSession,
      'operation-terminal-first',
    ),
  );
  store.reserveAssistantRouteOperation(
    createAssistantRouteReservationInput(
      firstSession,
      firstMessage,
      firstAssistantReservation,
      'operation-terminal-first',
    ),
  );

  const terminalInput = createOperationTerminalInput(
    firstOperation,
    failed,
    'operation-terminal-first',
  );
  assert.deepEqual(store.terminalizeInteractionOperation(terminalInput), {
    status: 'APPLIED',
    operation: failed,
  });
  assert.deepEqual(store.terminalizeInteractionOperation(terminalInput), {
    status: 'REPLAYED',
    operation: failed,
  });
  assert.deepEqual(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        firstSession,
        firstMessage,
        firstAssistantReservation,
        'operation-terminal-first-reservation-replay',
      ),
    ),
    { status: 'REPLAYED', manifest: firstAssistantReservation.manifest, operation: failed },
  );
  const conflictingReservation = createAssistantRouteReservation(
    firstSession,
    firstMessage,
    'operation-terminal-first',
    firstOperation.reservedAt,
    'frontstage-assistant-profile-v2',
  );
  assert.deepEqual(
    store.reserveAssistantRouteOperation(
      createAssistantRouteReservationInput(
        firstSession,
        firstMessage,
        conflictingReservation,
        'operation-terminal-first-reservation-conflict',
      ),
    ),
    { status: 'OPERATION_CONFLICT', currentOperation: failed },
  );
  const conflictingTerminal = terminalizeOperation(
    firstOperation,
    InteractionOperationState.INTERRUPTED,
  );
  assert.deepEqual(
    store.terminalizeInteractionOperation(
      createOperationTerminalInput(
        firstOperation,
        conflictingTerminal,
        'operation-terminal-conflict',
      ),
    ),
    { status: 'VERSION_CONFLICT', currentOperation: failed },
  );
  assert.deepEqual(store.listReservedInteractionOperations(firstSession.id), []);

  const backdatedMessage = createUserMessage(
    firstSession,
    'operation-terminal-backdated-message',
    '不能写入旧时间消息',
    '2026-08-14T01:00:02.500Z',
  );
  const backdatedSession = transitionSession(
    firstSession,
    InteractionSessionState.OPEN,
    backdatedMessage.createdAt,
  );
  assert.throws(
    () =>
      store.admitInteractionUserMessage(
        createUserMessageAdmissionInput(
          firstSession,
          backdatedMessage,
          backdatedSession,
          'operation-terminal-backdated-message',
        ),
      ),
    /audit time moved backwards/u,
  );
  assert.equal(store.getInteractionMessage(backdatedMessage.id), undefined);
  assert.deepEqual(store.getInteractionSession(firstSession.id), firstSession);

  const secondMessage = createUserMessage(
    firstSession,
    'operation-terminal-second',
    '第二次操作',
    '2026-08-14T01:00:04.000Z',
  );
  const secondSession = transitionSession(
    firstSession,
    InteractionSessionState.OPEN,
    secondMessage.createdAt,
  );
  assert.equal(
    store.admitInteractionUserMessage(
      createUserMessageAdmissionInput(
        firstSession,
        secondMessage,
        secondSession,
        'operation-terminal-second',
      ),
    ).status,
    'ADMITTED',
  );
  const secondOperation = createReservedOperation(
    secondSession,
    secondMessage,
    'operation-terminal-second',
    '2026-08-14T01:00:05.000Z',
  );
  assert.equal(
    store.reserveInteractionOperation(
      createOperationReservationInput(
        secondSession,
        secondMessage,
        secondOperation,
        'operation-terminal-second',
      ),
    ).status,
    'RESERVED',
  );
  const interrupted = terminalizeOperation(
    secondOperation,
    InteractionOperationState.INTERRUPTED,
    '2026-08-14T01:00:06.000Z',
  );
  assert.equal(
    store.terminalizeInteractionOperation(
      createOperationTerminalInput(secondOperation, interrupted, 'operation-terminal-second'),
    ).status,
    'APPLIED',
  );
  assert.deepEqual(
    store.reserveInteractionOperation(
      createOperationReservationInput(
        secondSession,
        secondMessage,
        secondOperation,
        'operation-terminal-second-reservation-replay',
      ),
    ),
    { status: 'REPLAYED', operation: interrupted },
  );
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getInteractionOperation(firstOperation.id), failed);
    assert.deepEqual(reopened.getInteractionOperation(secondOperation.id), interrupted);
    assert.deepEqual(
      reopened.reserveAssistantRouteOperation(
        createAssistantRouteReservationInput(
          firstSession,
          firstMessage,
          firstAssistantReservation,
          'operation-terminal-first-reopen-replay',
        ),
      ),
      { status: 'REPLAYED', manifest: firstAssistantReservation.manifest, operation: failed },
    );
    assert.deepEqual(
      reopened.reserveInteractionOperation(
        createOperationReservationInput(
          secondSession,
          secondMessage,
          secondOperation,
          'operation-terminal-second-reopen-replay',
        ),
      ),
      { status: 'REPLAYED', operation: interrupted },
    );
    assert.deepEqual(reopened.listReservedInteractionOperations(secondSession.id), []);
  } finally {
    reopened.close();
  }
});

const operationTerminalRollbackSteps = Object.freeze([
  InteractionTransactionStep.AFTER_OPERATION_TERMINAL_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_OPERATION_TERMINAL_WRITE,
  InteractionTransactionStep.AFTER_AUDIT_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
]);

for (const step of operationTerminalRollbackSteps) {
  void test(`Slice 2 Operation terminalization rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const initial = createInitialSession(policies, `operation-terminal-rollback-${step}`);
    const message = createUserMessage(
      initial,
      `operation-terminal-rollback-${step}`,
      '终态回滚',
      '2026-08-14T01:00:01.000Z',
    );
    const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
    const operation = createReservedOperation(
      session,
      message,
      `operation-terminal-rollback-${step}`,
    );
    const failed = terminalizeOperation(operation, InteractionOperationState.FAILED);
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    setup.createInteractionSession(
      createSessionInput(initial, `operation-terminal-rollback-${step}`),
    );
    setup.admitInteractionUserMessage(
      createUserMessageAdmissionInput(
        initial,
        message,
        session,
        `operation-terminal-rollback-${step}`,
      ),
    );
    setup.reserveInteractionOperation(
      createOperationReservationInput(
        session,
        message,
        operation,
        `operation-terminal-rollback-${step}`,
      ),
    );
    setup.close();

    const store = SqliteControlStore.open({
      filename,
      transactionProbe(observed) {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () =>
        store.terminalizeInteractionOperation(
          createOperationTerminalInput(operation, failed, `operation-terminal-rollback-${step}`),
        ),
      new RegExp(step),
    );
    assert.deepEqual(store.getInteractionOperation(operation.id), operation);
    store.close();

    const reopened = SqliteControlStore.open({ filename });
    try {
      assert.deepEqual(reopened.getInteractionOperation(operation.id), operation);
      assert.deepEqual(reopened.listReservedInteractionOperations(session.id), [operation]);
    } finally {
      reopened.close();
    }
  });
}

void test('Slice 2 concurrent Operation consumers produce one reservation and one typed busy result', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'concurrent-operation');
  const message = createUserMessage(
    initial,
    'concurrent-operation',
    '并发预约',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const setup = SqliteControlStore.open({ filename });
  setup.installInteractionPolicies(installInput(policies));
  setup.createInteractionSession(createSessionInput(initial, 'concurrent-operation'));
  setup.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'concurrent-operation'),
  );
  setup.close();

  const firstOperation = createReservedOperation(session, message, 'concurrent-operation-first');
  const secondOperation = createReservedOperation(session, message, 'concurrent-operation-second');
  const firstStore = SqliteControlStore.open({ filename });
  const secondStore = SqliteControlStore.open({ filename });
  try {
    assert.equal(
      firstStore.reserveInteractionOperation(
        createOperationReservationInput(
          session,
          message,
          firstOperation,
          'concurrent-operation-first',
        ),
      ).status,
      'RESERVED',
    );
    assert.deepEqual(
      secondStore.reserveInteractionOperation(
        createOperationReservationInput(
          session,
          message,
          secondOperation,
          'concurrent-operation-second',
        ),
      ),
      { status: 'SESSION_OPERATION_BUSY', currentOperation: firstOperation },
    );
  } finally {
    firstStore.close();
    secondStore.close();
  }
});

void test('B1 strict reopen independently rejects two Route Operations for one Message', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'b1-duplicate-decision-owner');
  const message = createUserMessage(
    initial,
    'b1-duplicate-decision-owner',
    '只允许一个路由结果所有者',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const firstOperation = createReservedOperation(
    session,
    message,
    'b1-duplicate-decision-owner-first',
  );
  const decision = createRouteDecision(session, message, 'b1-duplicate-decision-owner');
  const firstCompletion = completeRouteOperation(firstOperation, decision);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'b1-duplicate-decision-owner'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'b1-duplicate-decision-owner'),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      session,
      message,
      firstOperation,
      'b1-duplicate-decision-owner-first',
    ),
  );
  store.commitInteractionRouteResult(
    createRouteResultCommitInput(
      session,
      message,
      firstOperation,
      decision,
      firstCompletion,
      'b1-duplicate-decision-owner-first',
    ),
  );
  store.close();

  const secondOperation = createReservedOperation(
    session,
    message,
    'b1-duplicate-decision-owner-second',
    '2026-08-14T01:00:02.100Z',
  );
  const secondDecision = createRouteDecision(
    session,
    message,
    'b1-duplicate-decision-owner-second',
    undefined,
    undefined,
    '2026-08-14T01:00:03.100Z',
  );
  const secondCompletion = completeRouteOperation(
    secondOperation,
    secondDecision,
    undefined,
    '2026-08-14T01:00:03.600Z',
  );
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    database.exec('DROP INDEX interaction_operations_one_route_per_message_idx');
    insertRawReservedInteractionOperation(database, secondOperation);
    insertRawInteractionRouteDecision(database, secondDecision);
    updateRawCompletedInteractionOperation(database, secondOperation, secondCompletion);
  } finally {
    database.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /Interaction Message .* has multiple Route Operations/u,
  );
});

void test('B1 strict reopen binds a Proposal audit to its exact owning Decision', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'b1-proposal-decision-audit-binding');
  const message = createUserMessage(
    initial,
    'b1-proposal-decision-audit-binding',
    '提案审计必须绑定自己的决策',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const reservation = createAssistantRouteReservation(
    session,
    message,
    'b1-proposal-decision-audit-binding',
  );
  const proposal = createAssistantNoActionProposal(
    reservation,
    'b1-proposal-decision-audit-binding',
  );
  const decision = createRouteDecision(
    session,
    message,
    'b1-proposal-decision-audit-binding',
    proposal,
  );
  const completion = completeRouteOperation(reservation.operation, decision, proposal);
  const commitInput = createRouteResultCommitInput(
    session,
    message,
    reservation.operation,
    decision,
    completion,
    'b1-proposal-decision-audit-binding',
    { manifest: reservation.manifest, proposal },
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'b1-proposal-decision-audit-binding'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(
      initial,
      message,
      session,
      'b1-proposal-decision-audit-binding',
    ),
  );
  store.reserveAssistantRouteOperation(
    createAssistantRouteReservationInput(
      session,
      message,
      reservation,
      'b1-proposal-decision-audit-binding',
    ),
  );
  store.commitInteractionRouteResult(commitInput);
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER audit_events_no_update');
    database
      .prepare('UPDATE audit_events SET aggregate_id = ? WHERE id = ?')
      .run(
        routeDecisionId('route-decision_substituted-proposal-audit-owner'),
        commitInput.decisionAuditWrite.id,
      );
  } finally {
    database.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /Route Proposal .* lost its atomic Decision audit/u,
  );
});

void test('Slice 2 strict reopen rejects a standalone successful Operation without its result owner', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'unowned-operation-result');
  const message = createUserMessage(
    initial,
    'unowned-operation-result',
    '不能单独成功',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(session, message, 'unowned-operation-result');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'unowned-operation-result'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'unowned-operation-result'),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, 'unowned-operation-result'),
  );
  store.close();

  const completed = completeOperationWithoutOwnedResult(operation);
  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER interaction_operations_route_completion_guard');
    database
      .prepare(
        `UPDATE interaction_operations
            SET version = ?, state = ?, completed_at = ?, operation_digest = ?, record_json = ?
          WHERE id = ?`,
      )
      .run(
        completed.version,
        completed.state,
        completed.completedAt,
        completed.operationDigest,
        JSON.stringify(completed),
        completed.id,
      );
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /lost its exact Decision/u);
});

void test('Slice 2 strict reopen rejects a terminal Session with an unresolved Operation', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'terminal-session-reserved-operation');
  const message = createUserMessage(
    initial,
    'terminal-session-reserved-operation',
    '终态会话不能掩盖未完成操作',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(
    session,
    message,
    'terminal-session-reserved-operation',
  );
  const closing = transitionSession(
    session,
    InteractionSessionState.CLOSING,
    '2026-08-14T01:00:03.000Z',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(
    createSessionInput(initial, 'terminal-session-reserved-operation'),
  );
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(
      initial,
      message,
      session,
      'terminal-session-reserved-operation',
    ),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      session,
      message,
      operation,
      'terminal-session-reserved-operation',
    ),
  );
  store.transitionInteractionSession(
    createSessionTransitionInput(session, closing, 'terminal-session-reserved-operation-closing'),
  );
  store.close();

  const closed = transitionSession(
    closing,
    InteractionSessionState.CLOSED,
    '2026-08-14T01:00:04.000Z',
  );
  const closedInput = createSessionTransitionInput(
    closing,
    closed,
    'terminal-session-reserved-operation-closed',
  );
  const database = new Database(filename);
  try {
    database
      .prepare(
        `UPDATE interaction_sessions
            SET version = ?, state = ?, terminal_reason = NULL, updated_at = ?,
                session_digest = ?, record_json = ?
          WHERE id = ?`,
      )
      .run(
        closed.version,
        closed.state,
        closed.updatedAt,
        closed.sessionDigest,
        JSON.stringify(closed),
        closed.id,
      );
    database
      .prepare(
        `INSERT INTO audit_events(
           id, aggregate_type, aggregate_id, event_type, actor_type,
           before_version, after_version, payload_digest, occurred_at
         ) VALUES (?, ?, ?, ?, 'RUNTIME', ?, ?, ?, ?)`,
      )
      .run(
        closedInput.auditWrite.id,
        closedInput.auditWrite.aggregateType,
        closedInput.auditWrite.aggregateId,
        closedInput.auditWrite.eventType,
        closedInput.auditWrite.beforeVersion,
        closedInput.auditWrite.afterVersion,
        closedInput.auditWrite.payloadDigest,
        closedInput.auditWrite.occurredAt,
      );
    database
      .prepare(
        `INSERT INTO interaction_audit_events(session_id, position, audit_event_id)
         SELECT ?, COALESCE(MAX(position), -1) + 1, ?
           FROM interaction_audit_events
          WHERE session_id = ?`,
      )
      .run(closed.id, closedInput.auditWrite.id, closed.id);
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /has no implemented valid closure/u);
});

void test('Slice 2 strict reopen rejects a backdated Operation terminal audit', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'backdated-operation-terminal-audit');
  const message = createUserMessage(
    initial,
    'backdated-operation-terminal-audit',
    '终态审计时间不可倒退',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(session, message, 'backdated-operation-terminal-audit');
  const closing = transitionSession(
    session,
    InteractionSessionState.CLOSING,
    '2026-08-14T01:00:03.000Z',
  );
  const interrupted = terminalizeOperation(
    operation,
    InteractionOperationState.INTERRUPTED,
    '2026-08-14T01:00:04.000Z',
  );
  const terminalInput = createOperationTerminalInput(
    operation,
    interrupted,
    'backdated-operation-terminal-audit',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'backdated-operation-terminal-audit'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(
      initial,
      message,
      session,
      'backdated-operation-terminal-audit',
    ),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      session,
      message,
      operation,
      'backdated-operation-terminal-audit',
    ),
  );
  store.transitionInteractionSession(
    createSessionTransitionInput(session, closing, 'backdated-operation-terminal-audit-closing'),
  );
  assert.equal(store.terminalizeInteractionOperation(terminalInput).status, 'APPLIED');
  store.close();

  const backdated = terminalizeOperation(
    operation,
    InteractionOperationState.INTERRUPTED,
    '2026-08-14T01:00:02.500Z',
  );
  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER interaction_operations_update_guard');
    database.exec('DROP TRIGGER audit_events_no_update');
    database
      .prepare(
        `UPDATE interaction_operations
            SET completed_at = ?, operation_digest = ?, record_json = ?
          WHERE id = ?`,
      )
      .run(
        backdated.completedAt,
        backdated.operationDigest,
        JSON.stringify(backdated),
        backdated.id,
      );
    database
      .prepare(
        `UPDATE audit_events
            SET payload_digest = ?, occurred_at = ?
          WHERE id = ?`,
      )
      .run(backdated.operationDigest, backdated.completedAt, terminalInput.auditWrite.id);
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /Runtime-owned and ordered/u);
});

void test('Slice 2 strict reopen rejects substituted Operation audit authority', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'operation-audit-substitution');
  const message = createUserMessage(
    initial,
    'operation-audit-substitution',
    '审计不可替换',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(session, message, 'operation-audit-substitution');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'operation-audit-substitution'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'operation-audit-substitution'),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(session, message, operation, 'operation-audit-substitution'),
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER audit_events_no_update');
    database
      .prepare(
        `UPDATE audit_events
            SET payload_digest = ?
          WHERE aggregate_type = ? AND aggregate_id = ?`,
      )
      .run(
        digests.digest({ substituted: true }),
        InteractionAuditAggregateType.INTERACTION_OPERATION,
        operation.id,
      );
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /lost its reservation audit/u);
});

void test('Slice 2 strict reopen rejects an orphan Session audit', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const session = createInitialSession(policies, 'orphan-session-audit');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(session, 'orphan-session-audit'));
  store.close();

  const database = new Database(filename);
  try {
    database
      .prepare(
        `INSERT INTO audit_events(
           id, aggregate_type, aggregate_id, event_type, actor_type,
           before_version, after_version, payload_digest, occurred_at
         ) VALUES (?, ?, ?, ?, 'RUNTIME', 1, 2, ?, ?)`,
      )
      .run(
        auditEventId('audit_interaction-session-orphan-transition'),
        InteractionAuditAggregateType.INTERACTION_SESSION,
        session.id,
        InteractionAuditEventType.INTERACTION_SESSION_TRANSITIONED,
        digests.digest({ orphan: true }),
        '2026-08-14T01:00:01.000Z',
      );
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /orphan or substituted audit/u);
});

void test('Slice 2 strict reopen rejects missing Session audit membership', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const session = createInitialSession(policies, 'missing-session-audit-membership');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(session, 'missing-session-audit-membership'));
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER interaction_audit_events_no_delete');
    database
      .prepare('DELETE FROM interaction_audit_events WHERE session_id = ? AND position = 0')
      .run(session.id);
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /orphan or substituted audit/u);
});

void test('Slice 2 strict reopen rejects retained Message content substitution', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'message-substitution');
  const message = createUserMessage(
    initial,
    'message-substitution',
    '原始内容',
    '2026-08-14T01:00:01.000Z',
  );
  const afterMessage = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'message-substitution'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, afterMessage, 'message-substitution'),
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER interaction_messages_no_update');
    database
      .prepare(
        `UPDATE interaction_messages
            SET record_json = json_set(record_json, '$.content', '替换内容')
          WHERE id = ?`,
      )
      .run(message.id);
  } finally {
    database.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /Interaction Session\/Message\/Operation\/Focus authority failed strict reopen/u,
  );
});

void test('Slice 2 strict reopen rejects a Focus without its atomic audit membership', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'focus-missing-audit');
  const focus = createNoFocusBinding(initial, 'focus-missing-audit');
  const focusedSession = applyFocusToSession(initial, focus);
  const input = createFocusBindingRecordInput(
    initial,
    focus,
    focusedSession,
    'focus-missing-audit',
  );
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'focus-missing-audit'));
  store.recordInteractionFocusBinding(input);
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER interaction_audit_events_no_delete');
    database
      .prepare('DELETE FROM interaction_audit_events WHERE audit_event_id = ?')
      .run(input.focusAuditWrite.id);
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /orphan or substituted audit/u);
});

void test('Slice 2 strict reopen rejects substituted Focus authority JSON', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'focus-authority-substitution');
  const focus = createNoFocusBinding(initial, 'focus-authority-substitution');
  const focusedSession = applyFocusToSession(initial, focus);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'focus-authority-substitution'));
  store.recordInteractionFocusBinding(
    createFocusBindingRecordInput(initial, focus, focusedSession, 'focus-authority-substitution'),
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER interaction_focus_bindings_no_update');
    database
      .prepare(
        `UPDATE interaction_focus_bindings
            SET record_json = json_set(record_json, '$.createdAt', ?)
          WHERE id = ?`,
      )
      .run('2026-08-14T01:00:01.500Z', focus.id);
  } finally {
    database.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /Interaction Session\/Message\/Operation\/Focus authority failed strict reopen/u,
  );
});

void test('Slice 2 strict reopen rejects a Session rebound to historical Focus', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'focus-historical-rebind');
  const firstFocus = createNoFocusBinding(initial, 'focus-historical-rebind-first');
  const firstSession = applyFocusToSession(initial, firstFocus);
  const secondFocus = createNoFocusBinding(
    firstSession,
    'focus-historical-rebind-second',
    '2026-08-14T01:00:02.000Z',
  );
  const secondSession = applyFocusToSession(firstSession, secondFocus);
  const reboundSession = decodeSessionProjection({
    id: secondSession.id,
    schemaVersion: 1,
    version: interactionSessionVersion(secondSession.version + 1),
    principalRef: secondSession.principalRef,
    projectRef: secondSession.projectRef,
    state: InteractionSessionState.OPEN,
    configuration: secondSession.configuration,
    routingPolicy: secondSession.routingPolicy,
    confirmationPolicy: secondSession.confirmationPolicy,
    retentionProfile: secondSession.retentionProfile,
    currentFocusRef: Object.freeze({ id: firstFocus.id, digest: firstFocus.focusDigest }),
    openedAt: secondSession.openedAt,
    updatedAt: isoTimestamp('2026-08-14T01:00:03.000Z'),
  });
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'focus-historical-rebind'));
  store.recordInteractionFocusBinding(
    createFocusBindingRecordInput(
      initial,
      firstFocus,
      firstSession,
      'focus-historical-rebind-first',
    ),
  );
  store.recordInteractionFocusBinding(
    createFocusBindingRecordInput(
      firstSession,
      secondFocus,
      secondSession,
      'focus-historical-rebind-second',
    ),
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER interaction_sessions_update_guard');
    database
      .prepare(
        `UPDATE interaction_sessions
            SET version = ?, current_focus_id = ?, current_focus_digest = ?,
                updated_at = ?, session_digest = ?, record_json = ?
          WHERE id = ?`,
      )
      .run(
        reboundSession.version,
        firstFocus.id,
        firstFocus.focusDigest,
        reboundSession.updatedAt,
        reboundSession.sessionDigest,
        JSON.stringify(reboundSession),
        reboundSession.id,
      );
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /has no exact current Focus/u);
});

void test('Slice 2 strict reopen rejects an orphan Route Proposal', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'orphan-route-proposal');
  const message = createUserMessage(
    initial,
    'orphan-route-proposal',
    '孤立路由提案',
    '2026-08-14T01:00:01.000Z',
  );
  const session = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const reservation = createAssistantRouteReservation(session, message, 'orphan-route-proposal');
  const proposal = createAssistantNoActionProposal(reservation, 'orphan-route-proposal');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'orphan-route-proposal'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, session, 'orphan-route-proposal'),
  );
  store.reserveAssistantRouteOperation(
    createAssistantRouteReservationInput(session, message, reservation, 'orphan-route-proposal'),
  );
  store.close();

  const database = new Database(filename);
  try {
    database
      .prepare(
        `INSERT INTO interaction_route_proposals(
           id, schema_version, session_id, operation_id, message_id, message_digest,
           proposal_kind, proposal_digest, observed_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        proposal.id,
        proposal.schemaVersion,
        proposal.sessionId,
        proposal.operationId,
        proposal.messageRef.id,
        proposal.messageRef.digest,
        proposal.kind,
        proposal.proposalDigest,
        proposal.observedAt,
        JSON.stringify(proposal),
      );
  } finally {
    database.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /Interaction result authority has no exact Operation owner/u,
  );
});

void test('Slice 2 strict reopen rejects partial Interaction Policy authority', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.close();

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = OFF');
    const partialAuditId = auditEventId('audit_interaction-policy-partial');
    database
      .prepare(
        `INSERT INTO audit_events(
           id, aggregate_type, aggregate_id, event_type, actor_type,
           payload_digest, occurred_at
         ) VALUES (?, ?, ?, ?, 'RUNTIME', ?, ?)`,
      )
      .run(
        partialAuditId,
        InteractionAuditAggregateType.INTERACTION_POLICY,
        policies.directActionGrammar.id,
        InteractionAuditEventType.INTERACTION_POLICY_INSTALLED,
        policies.directActionGrammar.digest,
        INSTALLED_AT,
      );
    database
      .prepare(
        `INSERT INTO interaction_direct_action_grammars(
           id, schema_version, grammar_version, grammar_digest, installed_at,
           install_audit_event_id, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        policies.directActionGrammar.id,
        policies.directActionGrammar.schemaVersion,
        policies.directActionGrammar.version,
        policies.directActionGrammar.digest,
        INSTALLED_AT,
        partialAuditId,
        JSON.stringify(policies.directActionGrammar),
      );
  } finally {
    database.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /Interaction Policy authority is partial or duplicated/u,
  );
});

void test('Slice 2 strict reopen cannot treat a missing policy anchor table as absent', (t) => {
  const filename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename });
  store.close();

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = OFF');
    database.exec('DROP TABLE interaction_direct_action_grammars');
  } finally {
    database.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /missing an Interaction Policy authority table/u,
  );
});

void test('Slice 2 strict reopen rejects an orphan Interaction Policy install audit', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.close();

  const database = new Database(filename);
  try {
    insertPolicyInstallAudit(
      database,
      auditEventId('audit_interaction-policy-orphan'),
      policies.directActionGrammar.id,
      policies.directActionGrammar.digest,
    );
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /orphan install audit/u);
});

void test('Slice 2 strict reopen rejects an extra Interaction Policy install audit', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.close();

  const database = new Database(filename);
  try {
    insertPolicyInstallAudit(
      database,
      auditEventId('audit_interaction-policy-extra'),
      policies.directActionGrammar.id,
      policies.directActionGrammar.digest,
    );
  } finally {
    database.close();
  }

  assert.throws(() => SqliteControlStore.open({ filename }), /extra or substituted install audit/u);
});

void test('Slice 2 migration establishes the bounded Interaction authority skeleton only', (t) => {
  const filename = temporaryDatabase(t);
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    applyMigrations(database, defaultMigrationsDirectory(), () => INSTALLED_AT);
    const rows = database
      .prepare(
        `SELECT name
           FROM sqlite_schema
          WHERE type = 'table'
            AND (name LIKE 'interaction_%' OR name = 'frontstage_answers')
          ORDER BY name`,
      )
      .all() as readonly { readonly name: string }[];
    assert.deepEqual(
      rows.map((row) => row.name),
      [
        'frontstage_answers',
        'interaction_action_outcomes',
        'interaction_action_reservations',
        'interaction_audit_events',
        'interaction_confirmation_grammars',
        'interaction_confirmation_policies',
        'interaction_direct_action_grammars',
        'interaction_focus_bindings',
        'interaction_message_handoffs',
        'interaction_messages',
        'interaction_operations',
        'interaction_pending_action_resolutions',
        'interaction_pending_actions',
        'interaction_route_decisions',
        'interaction_route_proposals',
        'interaction_routing_policies',
        'interaction_sessions',
      ],
    );
    const deferredCount = database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM sqlite_schema
          WHERE type = 'table'
            AND name IN (
              'interaction_manifests',
              'interaction_configurations',
              'interaction_assistant_profiles'
            )`,
      )
      .get() as { readonly count: number };
    assert.equal(deferredCount.count, 0);

    const answerColumns = database
      .prepare("PRAGMA table_info('frontstage_answers')")
      .all() as readonly { readonly name: string }[];
    assert.equal(
      answerColumns.some((column) => column.name === 'operation_id'),
      false,
    );
    assert.equal(
      answerColumns.some((column) => column.name === 'operation_digest'),
      false,
    );

    const messageForeignKeys = database
      .prepare("PRAGMA foreign_key_list('interaction_messages')")
      .all() as readonly {
      readonly table: string;
      readonly from: string;
      readonly to: string;
    }[];
    assert.deepEqual(
      messageForeignKeys
        .filter((foreignKey) => foreignKey.table === 'interaction_operations')
        .map((foreignKey) => [foreignKey.from, foreignKey.to])
        .sort(),
      [
        ['caused_by_operation_digest', 'operation_digest'],
        ['caused_by_operation_id', 'id'],
        ['session_id', 'session_id'],
      ],
    );

    const reservationSql = database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'interaction_action_reservations'",
      )
      .pluck()
      .get();
    assert.equal(typeof reservationSql, 'string');
    assert.match(
      reservationSql as string,
      /public_capability TEXT NOT NULL CHECK \(public_capability IN/u,
    );

    const sessionTriggerSql = database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'interaction_sessions_update_guard'",
      )
      .pluck()
      .get();
    assert.equal(typeof sessionTriggerSql, 'string');
    assert.match(
      sessionTriggerSql as string,
      /OLD\.state = 'OPEN'.*NEW\.state = 'CLOSED'.*RETENTION_LIMIT_REACHED/su,
    );
    assert.match(
      sessionTriggerSql as string,
      /OLD\.state = 'CLOSING'.*NEW\.state = 'CLOSED'.*terminal_reason IS NOT NULL/su,
    );
    assert.match(
      sessionTriggerSql as string,
      /interaction_focus_bindings AS focus.*focus\.based_on_session_version = OLD\.version.*focus\.created_at = NEW\.updated_at/su,
    );
  } finally {
    database.close();
  }
});

void test('Slice 2 Session lifecycle backstops reject both illegal direct-close forms', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.close();

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    insertSession(database, policies, 'interaction-session_open-backstop', 'OPEN');
    insertSession(database, policies, 'interaction-session_closing-backstop', 'CLOSING');

    const update = database.prepare(
      `UPDATE interaction_sessions
          SET version = 2, state = ?, terminal_reason = ?, updated_at = ?,
              session_digest = ?, record_json = ?
        WHERE id = ?`,
    );
    const directCloseId = 'interaction-session_open-backstop';
    const directCloseDigest = digests.digest({ id: directCloseId, state: 'CLOSED', version: 2 });
    assert.throws(
      () =>
        update.run(
          'CLOSED',
          null,
          '2026-08-14T01:00:01.000Z',
          directCloseDigest,
          JSON.stringify({
            id: directCloseId,
            schemaVersion: 1,
            version: 2,
            principalRef: 'principal_sql-backstop',
            projectRef: {
              normalizedPath: `/fixture/${directCloseId}`,
              identityDigest: digests.digest({ projectPath: `/fixture/${directCloseId}` }),
            },
            state: 'CLOSED',
            sessionDigest: directCloseDigest,
          }),
          directCloseId,
        ),
      /illegal Interaction Session transition/u,
    );

    const terminalCloseId = 'interaction-session_closing-backstop';
    const terminalCloseDigest = digests.digest({
      id: terminalCloseId,
      state: 'CLOSED',
      version: 2,
    });
    assert.throws(
      () =>
        update.run(
          'CLOSED',
          'RETENTION_LIMIT_REACHED',
          '2026-08-14T01:00:01.000Z',
          terminalCloseDigest,
          JSON.stringify({
            id: terminalCloseId,
            schemaVersion: 1,
            version: 2,
            principalRef: 'principal_sql-backstop',
            projectRef: {
              normalizedPath: `/fixture/${terminalCloseId}`,
              identityDigest: digests.digest({ projectPath: `/fixture/${terminalCloseId}` }),
            },
            state: 'CLOSED',
            sessionDigest: terminalCloseDigest,
          }),
          terminalCloseId,
        ),
      /illegal Interaction Session transition/u,
    );
  } finally {
    database.close();
  }
});

void test('Slice 2 Reservation storage rejects capabilities outside the Domain enum', (t) => {
  const filename = temporaryDatabase(t);
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    applyMigrations(database, defaultMigrationsDirectory(), () => INSTALLED_AT);
    // This test isolates the column-level enum backstop. The relational chain
    // remains owned by its separate schema and Store transaction tests.
    database.pragma('foreign_keys = OFF');
    const invalidCapability = 'UNKNOWN_CAPABILITY';
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO interaction_action_reservations(
               id, schema_version, session_id, pending_action_id, pending_action_digest,
               resolution_id, resolution_digest, public_capability, command_id,
               canonical_command_input_digest, reserved_at, reservation_digest, record_json
             ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'interaction-action-reservation_invalid-capability',
            'interaction-session_missing',
            'pending-action_missing',
            digests.digest({ kind: 'pending-action' }),
            'pending-action-resolution_missing',
            digests.digest({ kind: 'pending-action-resolution' }),
            invalidCapability,
            'command_invalid-capability',
            digests.digest({ kind: 'command-input' }),
            INSTALLED_AT,
            digests.digest({ kind: 'reservation' }),
            JSON.stringify({
              id: 'interaction-action-reservation_invalid-capability',
              pendingActionRef: {
                id: 'pending-action_missing',
                digest: digests.digest({ kind: 'pending-action' }),
              },
              resolutionRef: {
                id: 'pending-action-resolution_missing',
                digest: digests.digest({ kind: 'pending-action-resolution' }),
              },
              publicCapability: invalidCapability,
              commandId: 'command_invalid-capability',
              canonicalCommandInputDigest: digests.digest({ kind: 'command-input' }),
              reservationDigest: digests.digest({ kind: 'reservation' }),
            }),
          ),
      /public_capability IN/u,
    );
  } finally {
    database.close();
  }
});

void test('Slice 2 Message causal backstop rejects absent and cross-Session Operations', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.close();

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    const firstSessionId = 'interaction-session_causal-first';
    const secondSessionId = 'interaction-session_causal-second';
    insertSession(database, policies, firstSessionId, 'OPEN');
    insertSession(database, policies, secondSessionId, 'OPEN');

    assert.throws(
      () =>
        database.transaction(() => {
          insertFrontstageMessage(
            database,
            firstSessionId,
            'interaction-operation_missing',
            digests.digest({ kind: 'missing-operation' }),
            'interaction-message_missing-operation',
          );
        })(),
      /FOREIGN KEY constraint failed|exact retained public authority/u,
    );

    const userMessageId = 'interaction-message_causal-user';
    const userMessageDigest = insertUserMessage(database, firstSessionId, userMessageId);
    const operationId = 'interaction-operation_causal-first';
    const operationDigest = insertReservedOperation(
      database,
      firstSessionId,
      userMessageId,
      userMessageDigest,
      operationId,
    );
    assert.throws(
      () =>
        database.transaction(() => {
          insertFrontstageMessage(
            database,
            secondSessionId,
            operationId,
            operationDigest,
            'interaction-message_cross-session-operation',
          );
        })(),
      /FOREIGN KEY constraint failed|exact retained public authority/u,
    );
  } finally {
    database.close();
  }
});

void test('B3 commits one authorized Intake Handoff, replays exactly, and detects its unresolved Reservation', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const { input, handoff, reservation, completedOperation } = prepareDirectAuthorizedIntakeHandoff(
    store,
    policies,
    'b3-direct-handoff',
  );
  assert.deepEqual(store.commitAuthorizedIntakeActionHandoff(input), {
    status: 'APPLIED',
    handoff,
    operation: completedOperation,
  });
  assert.deepEqual(store.commitAuthorizedIntakeActionHandoff(input), {
    status: 'REPLAYED',
    handoff,
    operation: completedOperation,
  });
  assert.deepEqual(store.getInteractionMessageHandoff(handoff.id), handoff);
  assert.deepEqual(store.getUnresolvedInteractionActionReservation(reservation.id), {
    reservationRef: { id: reservation.id, digest: reservation.reservationDigest },
    publicCapability: InteractionPublicCapability.SUBMIT_INTAKE,
    commandId: reservation.commandId,
    canonicalCommandInputDigest: reservation.canonicalCommandInputDigest,
    publicOutcomeState: InteractionPublicOutcomeRetentionState.NOT_RETAINED,
  });
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  assert.deepEqual(reopened.getInteractionMessageHandoff(handoff.id), handoff);
  reopened.close();
});

void test('B3 separately confirmed Intake Handoff preserves the originating request bytes', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const prepared = prepareSeparatelyConfirmedIntakeHandoff(store, policies, 'b3-confirmed-handoff');
  const committed = store.commitAuthorizedIntakeActionHandoff(prepared.input);
  assert.equal(committed.status, 'APPLIED');
  assert.equal(prepared.handoff.messageRef.id, prepared.originatingMessage.id);
  assert.notEqual(prepared.handoff.messageRef.id, prepared.operationMessage.id);
  assert.equal(prepared.handoff.admittedUserContent, prepared.originatingMessage.content);
  assert.equal(prepared.handoff.admittedContentDigest, prepared.originatingMessage.contentDigest);
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  assert.deepEqual(reopened.getInteractionMessageHandoff(prepared.handoff.id), prepared.handoff);
  reopened.close();
});

void test('B3 SQLite keeps the clarification Handoff writer closed until B4', (t) => {
  const filename = temporaryDatabase(t);
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    applyMigrations(database, defaultMigrationsDirectory(), () => INSTALLED_AT);
    database.pragma('foreign_keys = OFF');
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO interaction_message_handoffs(
               id, schema_version, handoff_kind, session_id, message_id, message_digest,
               pending_action_id, pending_action_digest, resolution_id, resolution_digest,
               reservation_id, reservation_digest, focus_id, focus_digest, intake_run_id,
               intake_run_version, clarification_question_id, question_spec_digest,
               question_digest, canonical_command_input_digest, intake_command_id,
               admitted_user_content, admitted_content_digest, created_at, handoff_digest,
               record_json
             ) VALUES (?, 1, 'INTAKE_CLARIFICATION', ?, ?, ?, NULL, NULL, NULL, NULL,
                       NULL, NULL, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'interaction-message-handoff_b3-premature-clarification',
            'interaction-session_b3-premature-clarification',
            'interaction-message_b3-premature-clarification',
            digests.digest({ kind: 'message' }),
            'focus-binding_b3-premature-clarification',
            digests.digest({ kind: 'focus' }),
            'intake_b3-premature-clarification',
            'clarification-question_b3-premature-clarification',
            digests.digest({ kind: 'question-spec' }),
            digests.digest({ kind: 'question' }),
            digests.digest({ kind: 'command-input' }),
            'command_b3-premature-clarification',
            '澄清回答',
            digests.digestUtf8('澄清回答'),
            '2026-08-15T00:00:00.000Z',
            digests.digest({ kind: 'handoff' }),
            JSON.stringify({ kind: InteractionMessageHandoffKind.INTAKE_CLARIFICATION }),
          ),
      /Intake clarification Handoff has no B3 Store owner/u,
    );
  } finally {
    database.close();
  }
});

for (const step of [
  InteractionTransactionStep.AFTER_MESSAGE_HANDOFF_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_MESSAGE_HANDOFF_WRITE,
  InteractionTransactionStep.AFTER_MESSAGE_HANDOFF_MEMBERSHIP_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_WRITE,
  InteractionTransactionStep.AFTER_ACTION_COMPLETION_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
] as const) {
  void test(`B3 authorized Intake Handoff rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    const prepared = prepareDirectAuthorizedIntakeHandoff(
      setup,
      policies,
      `b3-handoff-rollback-${step}`,
    );
    setup.close();

    const failing = SqliteControlStore.open({
      filename,
      transactionProbe: (observed) => {
        if (observed === step) {
          throw new Error('fixture failure');
        }
      },
    });
    assert.throws(
      () => failing.commitAuthorizedIntakeActionHandoff(prepared.input),
      /fixture failure/u,
    );
    failing.close();

    const reopened = SqliteControlStore.open({ filename });
    assert.equal(reopened.getInteractionMessageHandoff(prepared.handoff.id), undefined);
    assert.equal(
      reopened.getInteractionOperation(prepared.completedOperation.id)?.state,
      InteractionOperationState.RESERVED,
    );
    reopened.close();
  });
}

void test('B3 derives one Goal-control Action Outcome from retained public authority and strictly reopens', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const { workflow, reservation } = prepareConfirmedCancelAction(
    store,
    policies,
    'b3-cancel-outcome',
  );
  assert.equal(
    store.getUnresolvedInteractionActionReservation(reservation.id)?.publicOutcomeState,
    InteractionPublicOutcomeRetentionState.NOT_RETAINED,
  );

  commitCancellationPublicOutcome(store, workflow, reservation);
  assert.equal(
    store.getUnresolvedInteractionActionReservation(reservation.id)?.publicOutcomeState,
    InteractionPublicOutcomeRetentionState.RETAINED,
  );
  const outcomeId = interactionActionOutcomeId('interaction-action-outcome_b3-cancel-outcome');
  const outcomeInput = {
    reservationId: reservation.id,
    outcomeId,
    auditEventId: auditEventId('audit_b3-cancel-action-outcome'),
  };
  const committed = store.commitInteractionActionOutcome(outcomeInput);
  assert.equal(committed.status, 'APPLIED');
  assert.equal(committed.outcome.commandId, reservation.commandId);
  assert.equal(
    committed.outcome.canonicalCommandInputDigest,
    reservation.canonicalCommandInputDigest,
  );
  assert.equal(committed.outcome.disposition, InteractionActionOutcomeDisposition.APPLIED);
  assert.equal(store.getUnresolvedInteractionActionReservation(reservation.id), undefined);
  assert.deepEqual(store.commitInteractionActionOutcome(outcomeInput), {
    status: 'REPLAYED',
    outcome: committed.outcome,
  });
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  assert.deepEqual(reopened.getInteractionActionOutcome(outcomeId), committed.outcome);
  reopened.close();
});

void test('B3 retains a rejected Goal-control public outcome without changing its disposition', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  const { workflow, reservation } = prepareConfirmedCancelAction(
    store,
    policies,
    'b3-cancel-rejected-outcome',
  );
  assert.equal(
    store.recordCommandRejection({
      commandId: reservation.commandId,
      inputDigest: reservation.canonicalCommandInputDigest,
      target: { aggregateType: 'GOAL', aggregateId: workflow.goalId },
      workflowId: workflow.id,
      observedWorkflowVersion: workflow.version,
      error: {
        code: RuntimeErrorCode.DOMAIN_REJECTED,
        message: 'The deterministic cancellation was rejected.',
        retryable: false,
        detailCode: 'B3_REJECTED_CANCELLATION_FIXTURE',
      },
      completedAt: isoTimestamp('2026-08-14T01:00:08.000Z'),
    }).status,
    'APPLIED',
  );

  const outcomeId = interactionActionOutcomeId(
    'interaction-action-outcome_b3-cancel-rejected-outcome',
  );
  const input = {
    reservationId: reservation.id,
    outcomeId,
    auditEventId: auditEventId('audit_b3-cancel-rejected-action-outcome'),
  };
  const committed = store.commitInteractionActionOutcome(input);
  assert.equal(committed.status, 'APPLIED');
  assert.equal(committed.outcome.disposition, InteractionActionOutcomeDisposition.REJECTED);
  assert.deepEqual(store.commitInteractionActionOutcome(input), {
    status: 'REPLAYED',
    outcome: committed.outcome,
  });
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  assert.deepEqual(reopened.getInteractionActionOutcome(outcomeId), committed.outcome);
  reopened.close();
});

for (const step of [
  InteractionTransactionStep.AFTER_ACTION_OUTCOME_AUDIT_WRITE,
  InteractionTransactionStep.AFTER_ACTION_OUTCOME_WRITE,
  InteractionTransactionStep.AFTER_ACTION_OUTCOME_MEMBERSHIP_WRITE,
  InteractionTransactionStep.BEFORE_COMMIT,
] as const) {
  void test(`B3 Goal-control Action Outcome rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policies = createM26InteractionPolicies(digests);
    const suffix = `b3-outcome-rollback-${fixtureIdentifierSuffix(step)}`;
    const setup = SqliteControlStore.open({ filename });
    setup.installInteractionPolicies(installInput(policies));
    const { workflow, reservation } = prepareConfirmedCancelAction(setup, policies, suffix);
    commitCancellationPublicOutcome(setup, workflow, reservation);
    setup.close();

    const outcomeId = interactionActionOutcomeId(`interaction-action-outcome_${suffix}`);
    const failing = SqliteControlStore.open({
      filename,
      transactionProbe: (observed) => {
        if (observed === step) {
          throw new Error('fixture failure');
        }
      },
    });
    assert.throws(
      () =>
        failing.commitInteractionActionOutcome({
          reservationId: reservation.id,
          outcomeId,
          auditEventId: auditEventId(`audit_${suffix}`),
        }),
      /fixture failure/u,
    );
    failing.close();

    const reopened = SqliteControlStore.open({ filename });
    assert.equal(reopened.getInteractionActionOutcome(outcomeId), undefined);
    assert.deepEqual(reopened.getUnresolvedInteractionActionReservation(reservation.id), {
      reservationRef: { id: reservation.id, digest: reservation.reservationDigest },
      publicCapability: InteractionPublicCapability.CANCEL_GOAL,
      commandId: reservation.commandId,
      canonicalCommandInputDigest: reservation.canonicalCommandInputDigest,
      publicOutcomeState: InteractionPublicOutcomeRetentionState.RETAINED,
    });
    reopened.close();
  });
}

void test('Slice 2 Action Outcome binds the exact Reservation Session', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.close();

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    const reservationSessionId = 'interaction-session_outcome-reservation';
    const substitutedSessionId = 'interaction-session_outcome-substituted';
    insertSession(database, policies, reservationSessionId, 'OPEN');
    insertSession(database, policies, substitutedSessionId, 'OPEN');
    const reservation = insertActionReservationChain(
      database,
      reservationSessionId,
      'outcome-session-binding',
    );

    assert.throws(
      () =>
        insertActionOutcome(database, substitutedSessionId, reservation, 'cross-session-adversary'),
      /FOREIGN KEY constraint failed|exact retained public authority/u,
    );
    assert.doesNotThrow(() =>
      insertActionOutcome(database, reservationSessionId, reservation, 'same-session'),
    );
  } finally {
    database.close();
  }
});
