import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  auditEventId,
  decodeDirectActionGrammar,
  decodeInteractionMessage,
  decodeInteractionOperation,
  decodeInteractionRoutingPolicy,
  decodeInteractionSession,
  directActionGrammarProjection,
  frontstageContextManifestId,
  InteractionContentRetention,
  InteractionMessageRole,
  InteractionOperationFailureReason,
  InteractionOperationKind,
  InteractionOperationResultKind,
  InteractionOperationState,
  InteractionSessionState,
  interactionRoutingPolicyProjection,
  interactionMessageId,
  interactionMessageProjection,
  interactionOperationId,
  interactionOperationProjection,
  interactionOperationVersion,
  interactionSessionId,
  interactionSessionProjection,
  interactionSessionVersion,
  isoTimestamp,
  principalId,
  routeDecisionId,
  type CompletedInteractionOperation,
  type InteractionMessage,
  type InteractionOperationProjectionInput,
  type ReservedInteractionOperation,
  type InteractionSessionProjectionInput,
  type InteractionSession,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  InteractionAuditAggregateType,
  InteractionAuditEventType,
  createM26InteractionPolicies,
  type AdmitInteractionUserMessage,
  type CreateInteractionSession,
  type FailedOrInterruptedInteractionOperation,
  type InstallInteractionPolicies,
  type InteractionAuditWrite,
  type InteractionPolicySet,
  type ReserveInteractionOperation,
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

function createUserMessage(
  session: InteractionSession,
  suffix: string,
  content: string,
  createdAt: string,
): InteractionMessage {
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
  return decodeInteractionMessage(
    { ...base, messageDigest: digests.digest(interactionMessageProjection(base)) },
    digests,
  );
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
  operation: ReservedInteractionOperation,
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
  const publicCommandOutcomeDigest = digests.digest({ id, kind: 'public-outcome' });
  const resultProjectionDigest = digests.digest({ id, kind: 'result-projection' });
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
  const firstAssistantBinding = Object.freeze({
    contextManifestRef: Object.freeze({
      id: frontstageContextManifestId('frontstage-context-manifest_operation-terminal-first'),
      digest: digests.digest({ manifest: 'operation-terminal-first' }),
    }),
    assistantProfile: Object.freeze({
      id: 'frontstage-assistant-profile_operation-terminal-first',
      version: 'frontstage-assistant-profile-v1',
      digest: digests.digest({ profile: 'operation-terminal-first-v1' }),
    }),
  });
  const firstOperation = createReservedOperation(
    firstSession,
    firstMessage,
    'operation-terminal-first',
    '2026-08-14T01:00:02.000Z',
    firstAssistantBinding,
  );
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
  store.reserveInteractionOperation(
    createOperationReservationInput(
      firstSession,
      firstMessage,
      firstOperation,
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
    store.reserveInteractionOperation(
      createOperationReservationInput(
        firstSession,
        firstMessage,
        firstOperation,
        'operation-terminal-first-reservation-replay',
      ),
    ),
    { status: 'REPLAYED', operation: failed },
  );
  const conflictingReservation = createReservedOperation(
    firstSession,
    firstMessage,
    'operation-terminal-first',
    firstOperation.reservedAt,
    Object.freeze({
      contextManifestRef: firstAssistantBinding.contextManifestRef,
      assistantProfile: Object.freeze({
        ...firstAssistantBinding.assistantProfile,
        version: 'frontstage-assistant-profile-v2',
        digest: digests.digest({ profile: 'operation-terminal-first-v2' }),
      }),
    }),
  );
  assert.deepEqual(
    store.reserveInteractionOperation(
      createOperationReservationInput(
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
      reopened.reserveInteractionOperation(
        createOperationReservationInput(
          firstSession,
          firstMessage,
          firstOperation,
          'operation-terminal-first-reopen-replay',
        ),
      ),
      { status: 'REPLAYED', operation: failed },
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

  assert.throws(() => SqliteControlStore.open({ filename }), /has no implemented valid closure/u);
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
    /Interaction Session\/Message\/Operation authority failed strict reopen/u,
  );
});

void test('Slice 2 strict reopen rejects later-slice rows without an owning Store path', (t) => {
  const filename = temporaryDatabase(t);
  const policies = createM26InteractionPolicies(digests);
  const initial = createInitialSession(policies, 'unimplemented-operation');
  const message = createUserMessage(
    initial,
    'unimplemented-operation',
    '尚未实现的操作',
    '2026-08-14T01:00:01.000Z',
  );
  const afterMessage = transitionSession(initial, InteractionSessionState.OPEN, message.createdAt);
  const operation = createReservedOperation(afterMessage, message, 'unimplemented-route-proposal');
  const store = SqliteControlStore.open({ filename });
  store.installInteractionPolicies(installInput(policies));
  store.createInteractionSession(createSessionInput(initial, 'unimplemented-operation'));
  store.admitInteractionUserMessage(
    createUserMessageAdmissionInput(initial, message, afterMessage, 'unimplemented-operation'),
  );
  store.reserveInteractionOperation(
    createOperationReservationInput(
      afterMessage,
      message,
      operation,
      'unimplemented-route-proposal',
    ),
  );
  store.close();

  const database = new Database(filename);
  try {
    const proposalId = 'route-proposal_unimplemented-path';
    const proposalDigest = digests.digest({ proposalId, operationId: operation.id });
    const record = {
      id: proposalId,
      schemaVersion: 1,
      sessionId: initial.id,
      operationId: operation.id,
      messageRef: { id: message.id, digest: message.messageDigest },
      kind: 'NO_ACTION_PROPOSAL',
      observedAt: '2026-08-14T01:00:03.000Z',
      proposalDigest,
    };
    database
      .prepare(
        `INSERT INTO interaction_route_proposals(
           id, schema_version, session_id, operation_id, message_id, message_digest,
           proposal_kind, proposal_digest, observed_at, record_json
         ) VALUES (?, 1, ?, ?, ?, ?, 'NO_ACTION_PROPOSAL', ?, ?, ?)`,
      )
      .run(
        proposalId,
        initial.id,
        operation.id,
        message.id,
        message.messageDigest,
        proposalDigest,
        record.observedAt,
        JSON.stringify(record),
      );
  } finally {
    database.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /interaction_route_proposals rows have no implemented M2\.6 Store authority path/u,
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
      /FOREIGN KEY constraint failed/u,
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
      /FOREIGN KEY constraint failed/u,
    );
  } finally {
    database.close();
  }
});

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
      /FOREIGN KEY constraint failed/u,
    );
    assert.doesNotThrow(() =>
      insertActionOutcome(database, reservationSessionId, reservation, 'same-session'),
    );
  } finally {
    database.close();
  }
});
