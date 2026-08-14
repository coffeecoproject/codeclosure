import type {
  AuditEventId,
  CommandId,
  ConfirmationGrammar,
  DirectActionGrammar,
  InteractionConfirmationPolicy,
  InteractionMessage,
  InteractionMessageId,
  InteractionRoutingPolicy,
  InteractionSession,
  InteractionSessionId,
  IsoTimestamp,
  Sha256Digest,
} from '@codeclosure/domain';

export const InteractionAuditAggregateType = {
  INTERACTION_POLICY: 'INTERACTION_POLICY',
  INTERACTION_SESSION: 'INTERACTION_SESSION',
  INTERACTION_MESSAGE: 'INTERACTION_MESSAGE',
  INTERACTION_OPERATION: 'INTERACTION_OPERATION',
  FOCUS_BINDING: 'FOCUS_BINDING',
  ROUTE_PROPOSAL: 'ROUTE_PROPOSAL',
  ROUTE_DECISION: 'ROUTE_DECISION',
  PENDING_ACTION: 'PENDING_ACTION',
  PENDING_ACTION_RESOLUTION: 'PENDING_ACTION_RESOLUTION',
  INTERACTION_ACTION_RESERVATION: 'INTERACTION_ACTION_RESERVATION',
  INTERACTION_ACTION_OUTCOME: 'INTERACTION_ACTION_OUTCOME',
  INTERACTION_MESSAGE_HANDOFF: 'INTERACTION_MESSAGE_HANDOFF',
  FRONTSTAGE_ANSWER: 'FRONTSTAGE_ANSWER',
} as const;
export type InteractionAuditAggregateType =
  (typeof InteractionAuditAggregateType)[keyof typeof InteractionAuditAggregateType];

export const InteractionAuditEventType = {
  INTERACTION_POLICY_INSTALLED: 'INTERACTION_POLICY_INSTALLED',
  INTERACTION_SESSION_OPENED: 'INTERACTION_SESSION_OPENED',
  INTERACTION_SESSION_TRANSITIONED: 'INTERACTION_SESSION_TRANSITIONED',
  INTERACTION_MESSAGE_ADMITTED: 'INTERACTION_MESSAGE_ADMITTED',
  INTERACTION_MESSAGE_RECORDED: 'INTERACTION_MESSAGE_RECORDED',
  INTERACTION_OPERATION_RESERVED: 'INTERACTION_OPERATION_RESERVED',
  INTERACTION_OPERATION_COMPLETED: 'INTERACTION_OPERATION_COMPLETED',
  INTERACTION_OPERATION_FAILED: 'INTERACTION_OPERATION_FAILED',
  INTERACTION_OPERATION_INTERRUPTED: 'INTERACTION_OPERATION_INTERRUPTED',
  FOCUS_BINDING_RECORDED: 'FOCUS_BINDING_RECORDED',
  ROUTE_PROPOSAL_RECORDED: 'ROUTE_PROPOSAL_RECORDED',
  ROUTE_DECISION_RECORDED: 'ROUTE_DECISION_RECORDED',
  PENDING_ACTION_RECORDED: 'PENDING_ACTION_RECORDED',
  PENDING_ACTION_RESOLVED: 'PENDING_ACTION_RESOLVED',
  INTERACTION_ACTION_RESERVED: 'INTERACTION_ACTION_RESERVED',
  INTERACTION_ACTION_OUTCOME_RECORDED: 'INTERACTION_ACTION_OUTCOME_RECORDED',
  INTERACTION_MESSAGE_HANDOFF_RECORDED: 'INTERACTION_MESSAGE_HANDOFF_RECORDED',
  FRONTSTAGE_ANSWER_RECORDED: 'FRONTSTAGE_ANSWER_RECORDED',
} as const;
export type InteractionAuditEventType =
  (typeof InteractionAuditEventType)[keyof typeof InteractionAuditEventType];

export interface InteractionAuditWrite {
  readonly id: AuditEventId;
  readonly aggregateType: InteractionAuditAggregateType;
  readonly aggregateId: string;
  readonly eventType: InteractionAuditEventType;
  readonly payloadDigest: Sha256Digest;
  readonly occurredAt: IsoTimestamp;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly commandId?: CommandId;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface InteractionPolicySet {
  readonly directActionGrammar: DirectActionGrammar;
  readonly confirmationGrammar: ConfirmationGrammar;
  readonly routingPolicy: InteractionRoutingPolicy;
  readonly confirmationPolicy: InteractionConfirmationPolicy;
}

export interface InteractionPolicyInstallAuditWrites {
  readonly directActionGrammar: InteractionAuditWrite;
  readonly confirmationGrammar: InteractionAuditWrite;
  readonly routingPolicy: InteractionAuditWrite;
  readonly confirmationPolicy: InteractionAuditWrite;
}

export interface InstallInteractionPolicies {
  readonly policies: InteractionPolicySet;
  readonly installedAt: IsoTimestamp;
  readonly auditWrites: InteractionPolicyInstallAuditWrites;
}

export type InteractionPolicyInstallResult =
  | Readonly<{
      status: 'INSTALLED' | 'EXISTING';
      policies: InteractionPolicySet;
    }>
  | Readonly<{
      status: 'POLICY_CONFLICT';
      message: string;
    }>;

export interface CreateInteractionSession {
  readonly session: InteractionSession;
  readonly auditWrite: InteractionAuditWrite;
}

export type InteractionSessionCreateResult =
  | Readonly<{
      status: 'CREATED' | 'REPLAYED';
      session: InteractionSession;
    }>
  | Readonly<{
      status: 'SESSION_CONFLICT';
      currentSession: InteractionSession;
    }>;

export interface TransitionInteractionSession {
  readonly currentSession: InteractionSession;
  readonly nextSession: InteractionSession;
  readonly auditWrite: InteractionAuditWrite;
}

export type InteractionSessionTransitionResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      session: InteractionSession;
    }>
  | Readonly<{ status: 'SESSION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>;

export interface AdmitInteractionUserMessage {
  readonly currentSession: InteractionSession;
  readonly message: InteractionMessage;
  readonly nextSession: InteractionSession;
  readonly messageAuditWrite: InteractionAuditWrite;
  readonly sessionAuditWrite: InteractionAuditWrite;
}

export type InteractionUserMessageAdmissionResult =
  | Readonly<{
      status: 'ADMITTED' | 'REPLAYED';
      message: InteractionMessage;
      session: InteractionSession;
    }>
  | Readonly<{ status: 'SESSION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'MESSAGE_CONFLICT';
      currentMessage: InteractionMessage;
    }>;

/**
 * Runtime owns the policy definitions. The Store owns only atomic installation,
 * exact replay/conflict classification, audit, and strict retained validation.
 */
export interface InteractionPolicyControlStore {
  installInteractionPolicies(input: InstallInteractionPolicies): InteractionPolicyInstallResult;
  getInstalledInteractionPolicies(): InteractionPolicySet | undefined;
}

/**
 * The Store owns durable CAS, replay/conflict classification, atomic audit
 * membership, and strict reopen. Domain validators remain the sole lifecycle
 * and aggregate-rule owners.
 */
export interface InteractionSessionControlStore extends InteractionPolicyControlStore {
  createInteractionSession(input: CreateInteractionSession): InteractionSessionCreateResult;
  transitionInteractionSession(
    input: TransitionInteractionSession,
  ): InteractionSessionTransitionResult;
  admitInteractionUserMessage(
    input: AdmitInteractionUserMessage,
  ): InteractionUserMessageAdmissionResult;
  getInteractionSession(sessionId: InteractionSessionId): InteractionSession | undefined;
  getInteractionMessage(messageId: InteractionMessageId): InteractionMessage | undefined;
}
