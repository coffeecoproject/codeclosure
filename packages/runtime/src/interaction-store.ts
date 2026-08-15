import type {
  AuditEventId,
  AuthorizedIntakeActionMessageHandoff,
  CommandId,
  CompletedInteractionOperation,
  ConfirmationGrammar,
  DirectActionGrammar,
  FocusBinding,
  FocusBindingId,
  FrontstageAnswer,
  FrontstageAnswerId,
  FrontstageContextManifest,
  FrontstageContextManifestId,
  IntakeClarificationMessageHandoff,
  InteractionConfirmationPolicy,
  InteractionMessage,
  InteractionMessageId,
  InteractionOperation,
  InteractionOperationId,
  InteractionOperationKind,
  InteractionActionReservation,
  InteractionActionReservationId,
  InteractionActionOutcome,
  InteractionActionOutcomeId,
  InteractionMessageHandoffId,
  InteractionMessageHandoff,
  InteractionPublicCapability,
  InteractionRoutingPolicy,
  InteractionSession,
  InteractionSessionId,
  IsoTimestamp,
  FailedInteractionOperation,
  InterruptedInteractionOperation,
  ReservedInteractionOperation,
  PendingAction,
  PendingActionId,
  PendingActionResolution,
  PendingActionResolutionId,
  RouteDecision,
  RouteDecisionId,
  RouteProposal,
  RouteProposalId,
  Sha256Digest,
} from '@codeclosure/domain';

export const InteractionAuditAggregateType = {
  INTERACTION_POLICY: 'INTERACTION_POLICY',
  INTERACTION_SESSION: 'INTERACTION_SESSION',
  INTERACTION_MESSAGE: 'INTERACTION_MESSAGE',
  INTERACTION_OPERATION: 'INTERACTION_OPERATION',
  FOCUS_BINDING: 'FOCUS_BINDING',
  FRONTSTAGE_CONTEXT_MANIFEST: 'FRONTSTAGE_CONTEXT_MANIFEST',
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
  FRONTSTAGE_CONTEXT_MANIFEST_RECORDED: 'FRONTSTAGE_CONTEXT_MANIFEST_RECORDED',
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

export type InteractionSessionOperationBusyResult = Readonly<{
  status: 'SESSION_OPERATION_BUSY';
  currentOperation: ReservedInteractionOperation;
}>;

export type InteractionSessionTransitionResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      session: InteractionSession;
    }>
  | Readonly<{ status: 'SESSION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | InteractionSessionOperationBusyResult;

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
    }>
  | InteractionSessionOperationBusyResult;

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

export type CompanionFreeReservedInteractionOperation = Omit<
  ReservedInteractionOperation,
  'operationKind' | 'contextManifestRef' | 'assistantProfile'
> &
  Readonly<{
    operationKind: Exclude<InteractionOperationKind, 'INTAKE_CLARIFICATION'>;
    contextManifestRef?: never;
    assistantProfile?: never;
  }>;

export interface ReserveInteractionOperation {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly operation: CompanionFreeReservedInteractionOperation;
  readonly auditWrite: InteractionAuditWrite;
}

export type InteractionOperationReservationResult =
  | Readonly<{
      status: 'RESERVED';
      operation: ReservedInteractionOperation;
    }>
  | Readonly<{
      status: 'REPLAYED';
      operation: InteractionOperation;
    }>
  | Readonly<{ status: 'SESSION_NOT_FOUND' | 'MESSAGE_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'MESSAGE_CONFLICT';
      currentMessage: InteractionMessage;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | InteractionSessionOperationBusyResult;

export type FailedOrInterruptedInteractionOperation =
  FailedInteractionOperation | InterruptedInteractionOperation;

export interface TerminalizeInteractionOperation {
  readonly currentOperation: ReservedInteractionOperation;
  readonly nextOperation: FailedOrInterruptedInteractionOperation;
  readonly auditWrite: InteractionAuditWrite;
}

export type InteractionOperationTerminalResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      operation: FailedOrInterruptedInteractionOperation;
    }>
  | Readonly<{ status: 'OPERATION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentOperation: InteractionOperation;
    }>;

/**
 * Successful completion remains owned by the later result-specific atomic
 * transaction. This port closes reservation plus payload-free failure and
 * interruption without creating a competing success authority.
 */
export interface InteractionOperationControlStore extends InteractionSessionControlStore {
  reserveInteractionOperation(
    input: ReserveInteractionOperation,
  ): InteractionOperationReservationResult;
  terminalizeInteractionOperation(
    input: TerminalizeInteractionOperation,
  ): InteractionOperationTerminalResult;
  getInteractionOperation(operationId: InteractionOperationId): InteractionOperation | undefined;
  listReservedInteractionOperations(
    sessionId: InteractionSessionId,
  ): readonly ReservedInteractionOperation[];
}

export interface ReserveAssistantRouteOperation {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly focus?: FocusBinding;
  readonly manifest: FrontstageContextManifest;
  readonly operation: ReservedInteractionOperation;
  readonly manifestAuditWrite: InteractionAuditWrite;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export type AssistantRouteOperationReservationResult =
  | Readonly<{
      status: 'RESERVED' | 'REPLAYED';
      manifest: FrontstageContextManifest;
      operation: InteractionOperation;
    }>
  | Readonly<{
      status: 'SESSION_NOT_FOUND' | 'MESSAGE_NOT_FOUND';
    }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'MESSAGE_CONFLICT';
      currentMessage: InteractionMessage;
    }>
  | Readonly<{
      status: 'CONTEXT_MANIFEST_CONFLICT';
      currentManifest: FrontstageContextManifest;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | InteractionSessionOperationBusyResult;

export interface CommitInteractionRouteResult {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly focus?: FocusBinding;
  readonly manifest?: FrontstageContextManifest;
  readonly currentOperation: ReservedInteractionOperation;
  readonly proposal?: RouteProposal;
  readonly decision: RouteDecision;
  readonly nextOperation: CompletedInteractionOperation;
  readonly proposalAuditWrite?: InteractionAuditWrite;
  readonly decisionAuditWrite: InteractionAuditWrite;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export type InteractionRouteResultCommitResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      proposal?: RouteProposal;
      decision: RouteDecision;
      operation: CompletedInteractionOperation;
    }>
  | Readonly<{
      status: 'OPERATION_NOT_FOUND';
    }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | Readonly<{
      status: 'ROUTE_PROPOSAL_CONFLICT';
      currentProposal: RouteProposal;
    }>
  | Readonly<{
      status: 'ROUTE_DECISION_CONFLICT';
      currentDecision: RouteDecision;
    }>;

/**
 * Successful Route completion has one result-specific owner. It never exposes
 * a generic successful Operation transition and never treats a Proposal as a
 * trusted Decision.
 */
export interface InteractionRouteResultControlStore extends InteractionOperationControlStore {
  reserveAssistantRouteOperation(
    input: ReserveAssistantRouteOperation,
  ): AssistantRouteOperationReservationResult;
  commitInteractionRouteResult(
    input: CommitInteractionRouteResult,
  ): InteractionRouteResultCommitResult;
  getFrontstageContextManifest(
    manifestId: FrontstageContextManifestId,
  ): FrontstageContextManifest | undefined;
  getInteractionRouteProposal(proposalId: RouteProposalId): RouteProposal | undefined;
  getInteractionRouteDecision(decisionId: RouteDecisionId): RouteDecision | undefined;
}

export interface CommitInteractionPendingActionProposal {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly focus?: FocusBinding;
  readonly routeDecision: RouteDecision;
  readonly pendingAction: PendingAction;
  readonly resolution?: PendingActionResolution;
  readonly reservation?: InteractionActionReservation;
  readonly currentOperation: ReservedInteractionOperation;
  readonly nextOperation: CompletedInteractionOperation;
  readonly pendingActionAuditWrite: InteractionAuditWrite;
  readonly resolutionAuditWrite?: InteractionAuditWrite;
  readonly reservationAuditWrite?: InteractionAuditWrite;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export type InteractionPendingActionProposalCommitResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      pendingAction: PendingAction;
      resolution?: PendingActionResolution;
      reservation?: InteractionActionReservation;
      operation: CompletedInteractionOperation;
    }>
  | Readonly<{ status: 'OPERATION_NOT_FOUND' | 'ROUTE_DECISION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | Readonly<{
      status: 'PENDING_ACTION_CONFLICT';
      currentPendingAction: PendingAction;
    }>
  | Readonly<{
      status: 'PENDING_ACTION_RESOLUTION_CONFLICT';
      currentResolution: PendingActionResolution;
    }>
  | Readonly<{
      status: 'ACTION_RESERVATION_CONFLICT';
      currentReservation: InteractionActionReservation;
    }>;

export interface CommitInteractionActionConfirmation {
  readonly session: InteractionSession;
  readonly originatingMessage: InteractionMessage;
  readonly responseMessage: InteractionMessage;
  readonly focus?: FocusBinding;
  readonly routeDecision: RouteDecision;
  readonly pendingAction: PendingAction;
  readonly resolution: PendingActionResolution;
  readonly reservation?: InteractionActionReservation;
  readonly currentOperation: ReservedInteractionOperation;
  readonly nextOperation: CompletedInteractionOperation;
  readonly resolutionAuditWrite: InteractionAuditWrite;
  readonly reservationAuditWrite?: InteractionAuditWrite;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export type InteractionActionConfirmationCommitResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      resolution: PendingActionResolution;
      reservation?: InteractionActionReservation;
      operation: CompletedInteractionOperation;
    }>
  | Readonly<{
      status: 'OPERATION_NOT_FOUND' | 'PENDING_ACTION_NOT_FOUND';
    }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | Readonly<{
      status: 'PENDING_ACTION_CONFLICT';
      currentPendingAction: PendingAction;
    }>
  | Readonly<{
      status: 'PENDING_ACTION_RESOLUTION_CONFLICT';
      currentResolution: PendingActionResolution;
    }>
  | Readonly<{
      status: 'ACTION_RESERVATION_CONFLICT';
      currentReservation: InteractionActionReservation;
    }>;

export interface RecordInteractionPendingActionTerminalResolution {
  readonly session: InteractionSession;
  readonly originatingMessage: InteractionMessage;
  readonly focus?: FocusBinding;
  readonly routeDecision: RouteDecision;
  readonly pendingAction: PendingAction;
  readonly resolution: PendingActionResolution;
  readonly resolutionAuditWrite: InteractionAuditWrite;
}

export type InteractionPendingActionTerminalResolutionRecordResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      resolution: PendingActionResolution;
    }>
  | Readonly<{ status: 'PENDING_ACTION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | InteractionSessionOperationBusyResult
  | Readonly<{
      status: 'PENDING_ACTION_CONFLICT';
      currentPendingAction: PendingAction;
    }>
  | Readonly<{
      status: 'PENDING_ACTION_RESOLUTION_CONFLICT';
      currentResolution: PendingActionResolution;
    }>;

/**
 * Pending Action persistence owns only immutable authority, atomic audit,
 * replay/conflict classification, and strict reopen. It invokes no public
 * capability and derives no authorization policy inside the Store.
 */
export interface InteractionPendingActionControlStore extends InteractionRouteResultControlStore {
  commitInteractionPendingActionProposal(
    input: CommitInteractionPendingActionProposal,
  ): InteractionPendingActionProposalCommitResult;
  commitInteractionActionConfirmation(
    input: CommitInteractionActionConfirmation,
  ): InteractionActionConfirmationCommitResult;
  recordInteractionPendingActionTerminalResolution(
    input: RecordInteractionPendingActionTerminalResolution,
  ): InteractionPendingActionTerminalResolutionRecordResult;
  getInteractionPendingAction(actionId: PendingActionId): PendingAction | undefined;
  getInteractionPendingActionResolution(
    resolutionId: PendingActionResolutionId,
  ): PendingActionResolution | undefined;
  getInteractionActionReservation(
    reservationId: InteractionActionReservationId,
  ): InteractionActionReservation | undefined;
  getUnresolvedInteractionPendingAction(sessionId: InteractionSessionId): PendingAction | undefined;
}

export interface CommitAuthorizedIntakeActionHandoff {
  readonly session: InteractionSession;
  readonly operationMessage: InteractionMessage;
  readonly originatingMessage: InteractionMessage;
  readonly resolutionMessage?: InteractionMessage;
  readonly routeDecision: RouteDecision;
  readonly pendingAction: PendingAction;
  readonly resolution: PendingActionResolution;
  readonly reservation: InteractionActionReservation;
  readonly handoff: AuthorizedIntakeActionMessageHandoff;
  readonly currentOperation: ReservedInteractionOperation;
  readonly nextOperation: CompletedInteractionOperation;
  readonly handoffAuditWrite: InteractionAuditWrite;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export type AuthorizedIntakeActionHandoffCommitResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      handoff: AuthorizedIntakeActionMessageHandoff;
      operation: CompletedInteractionOperation;
    }>
  | Readonly<{ status: 'OPERATION_NOT_FOUND' | 'ACTION_RESERVATION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | Readonly<{
      status: 'MESSAGE_HANDOFF_CONFLICT';
      currentHandoff: AuthorizedIntakeActionMessageHandoff;
    }>
  | Readonly<{
      status: 'ACTION_RESERVATION_CONFLICT';
      currentReservation: InteractionActionReservation;
    }>;

/**
 * The caller allocates identities only. The Store resolves the exact retained
 * Reservation and public-command outcome, then uses the Runtime mapper to
 * author the Action Outcome and audit atomically.
 */
export interface CommitInteractionActionOutcome {
  readonly reservationId: InteractionActionReservationId;
  readonly outcomeId: InteractionActionOutcomeId;
  readonly auditEventId: AuditEventId;
}

export type InteractionActionOutcomeCommitResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      outcome: InteractionActionOutcome;
    }>
  | Readonly<{ status: 'ACTION_RESERVATION_NOT_FOUND' | 'PUBLIC_COMMAND_OUTCOME_NOT_RETAINED' }>
  | Readonly<{
      status: 'ACTION_OUTCOME_CONFLICT';
      currentOutcome: InteractionActionOutcome;
    }>;

export const InteractionPublicOutcomeRetentionState = {
  NOT_RETAINED: 'NOT_RETAINED',
  RETAINED: 'RETAINED',
} as const;
export type InteractionPublicOutcomeRetentionState =
  (typeof InteractionPublicOutcomeRetentionState)[keyof typeof InteractionPublicOutcomeRetentionState];

export interface InteractionUnresolvedActionReservationDescriptor {
  readonly reservationRef: Readonly<{
    id: InteractionActionReservationId;
    digest: Sha256Digest;
  }>;
  readonly publicCapability: InteractionPublicCapability;
  readonly commandId: CommandId;
  readonly canonicalCommandInputDigest: Sha256Digest;
  readonly publicOutcomeState: InteractionPublicOutcomeRetentionState;
}

/**
 * B3 persists only the action-authorized Intake member and never invokes or
 * retries a public capability. Clarification Handoff ownership remains closed
 * until B4.
 */
export interface InteractionPublicActionControlStore extends InteractionPendingActionControlStore {
  commitAuthorizedIntakeActionHandoff(
    input: CommitAuthorizedIntakeActionHandoff,
  ): AuthorizedIntakeActionHandoffCommitResult;
  commitInteractionActionOutcome(
    input: CommitInteractionActionOutcome,
  ): InteractionActionOutcomeCommitResult;
  getInteractionMessageHandoff(
    handoffId: InteractionMessageHandoffId,
  ): InteractionMessageHandoff | undefined;
  getInteractionActionOutcome(
    outcomeId: InteractionActionOutcomeId,
  ): InteractionActionOutcome | undefined;
  getUnresolvedInteractionActionReservation(
    reservationId: InteractionActionReservationId,
  ): InteractionUnresolvedActionReservationDescriptor | undefined;
}

export interface ReserveInteractionClarificationOperation {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly focus: FocusBinding;
  readonly handoff: IntakeClarificationMessageHandoff;
  readonly operation: ReservedInteractionOperation;
  readonly handoffAuditWrite: InteractionAuditWrite;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export type InteractionClarificationOperationReservationResult =
  | Readonly<{
      status: 'RESERVED' | 'REPLAYED';
      handoff: IntakeClarificationMessageHandoff;
      operation: ReservedInteractionOperation;
    }>
  | Readonly<{ status: 'SESSION_NOT_FOUND' | 'MESSAGE_NOT_FOUND' | 'FOCUS_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'MESSAGE_CONFLICT';
      currentMessage: InteractionMessage;
    }>
  | Readonly<{
      status: 'FOCUS_CONFLICT';
      currentFocus: FocusBinding;
    }>
  | Readonly<{
      status: 'MESSAGE_HANDOFF_CONFLICT';
      currentHandoff: InteractionMessageHandoff;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | InteractionSessionOperationBusyResult;

export interface CommitFrontstageAnswerResult {
  readonly session: InteractionSession;
  readonly originatingMessage: InteractionMessage;
  readonly routeOperation: CompletedInteractionOperation;
  readonly proposal: RouteProposal;
  readonly routeDecision: RouteDecision;
  readonly answer: FrontstageAnswer;
  readonly currentOperation: ReservedInteractionOperation;
  readonly nextOperation: CompletedInteractionOperation;
  readonly resultMessage: InteractionMessage;
  readonly answerAuditWrite: InteractionAuditWrite;
  readonly messageAuditWrite: InteractionAuditWrite;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export type FrontstageAnswerResultCommitResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      answer: FrontstageAnswer;
      message: InteractionMessage;
      operation: CompletedInteractionOperation;
    }>
  | Readonly<{ status: 'OPERATION_NOT_FOUND' | 'ROUTE_DECISION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | Readonly<{
      status: 'FRONTSTAGE_ANSWER_CONFLICT';
      currentAnswer: FrontstageAnswer;
    }>
  | Readonly<{
      status: 'MESSAGE_CONFLICT';
      currentMessage: InteractionMessage;
    }>;

export interface CommitInteractionGoalViewResult {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly currentOperation: ReservedInteractionOperation;
  readonly nextOperation: CompletedInteractionOperation;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export interface CommitInteractionClarificationResult {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly focus: FocusBinding;
  readonly handoff: IntakeClarificationMessageHandoff;
  readonly currentOperation: ReservedInteractionOperation;
  readonly nextOperation: CompletedInteractionOperation;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export interface CommitInteractionResultProjection {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly currentOperation: ReservedInteractionOperation;
  readonly nextOperation: CompletedInteractionOperation;
  readonly resultMessage: InteractionMessage;
  readonly messageAuditWrite: InteractionAuditWrite;
  readonly operationAuditWrite: InteractionAuditWrite;
}

export type InteractionPresentationResultCommitResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      operation: CompletedInteractionOperation;
      message?: InteractionMessage;
    }>
  | Readonly<{ status: 'OPERATION_NOT_FOUND' | 'PUBLIC_COMMAND_OUTCOME_NOT_RETAINED' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'OPERATION_CONFLICT';
      currentOperation: InteractionOperation;
    }>
  | Readonly<{
      status: 'MESSAGE_CONFLICT';
      currentMessage: InteractionMessage;
    }>;

export interface InteractionUnresolvedClarificationOperationDescriptor {
  readonly operationRef: Readonly<{
    id: InteractionOperationId;
    digest: Sha256Digest;
  }>;
  readonly handoffRef: Readonly<{
    id: InteractionMessageHandoffId;
    digest: Sha256Digest;
  }>;
  readonly questionTarget: IntakeClarificationMessageHandoff['questionTarget'];
  readonly commandId: CommandId;
  readonly canonicalCommandInputDigest: Sha256Digest;
  readonly publicOutcomeState: InteractionPublicOutcomeRetentionState;
}

export interface InteractionStartupReservedOperationDescriptor {
  readonly sessionRef: Readonly<{
    id: InteractionSessionId;
    digest: Sha256Digest;
  }>;
  readonly operationRef: Readonly<{
    id: InteractionOperationId;
    digest: Sha256Digest;
  }>;
  readonly operationKind: Exclude<InteractionOperationKind, 'INTAKE_CLARIFICATION'>;
}

export interface InteractionStartupClarificationOperationDescriptor extends InteractionUnresolvedClarificationOperationDescriptor {
  readonly sessionRef: Readonly<{
    id: InteractionSessionId;
    digest: Sha256Digest;
  }>;
  readonly operationKind: 'INTAKE_CLARIFICATION';
}

export interface InteractionStartupPendingActionDescriptor {
  readonly sessionRef: Readonly<{
    id: InteractionSessionId;
    digest: Sha256Digest;
  }>;
  readonly pendingActionRef: Readonly<{
    id: PendingActionId;
    digest: Sha256Digest;
  }>;
}

export const InteractionStartupHandoffState = {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  NOT_RETAINED: 'NOT_RETAINED',
  RETAINED: 'RETAINED',
} as const;
export type InteractionStartupHandoffState =
  (typeof InteractionStartupHandoffState)[keyof typeof InteractionStartupHandoffState];

export type InteractionStartupHandoffDescriptor =
  | Readonly<{ state: 'NOT_APPLICABLE' | 'NOT_RETAINED' }>
  | Readonly<{
      state: 'RETAINED';
      handoffRef: Readonly<{
        id: InteractionMessageHandoffId;
        digest: Sha256Digest;
      }>;
    }>;

export interface InteractionStartupActionReservationDescriptor extends InteractionUnresolvedActionReservationDescriptor {
  readonly sessionRef: Readonly<{
    id: InteractionSessionId;
    digest: Sha256Digest;
  }>;
  readonly handoff: InteractionStartupHandoffDescriptor;
}

/**
 * This catalog is a read-only projection over retained Store authority. It
 * detects startup work but cannot terminalize, replay, or invoke anything.
 */
export interface InteractionStartupDetectionCatalog {
  readonly reservedOperations: readonly InteractionStartupReservedOperationDescriptor[];
  readonly clarificationOperations: readonly InteractionStartupClarificationOperationDescriptor[];
  readonly pendingActions: readonly InteractionStartupPendingActionDescriptor[];
  readonly actionReservations: readonly InteractionStartupActionReservationDescriptor[];
}

/**
 * Presentation results complete through their own atomic owner. Projection
 * digests and produced messages remain non-authoritative views, while an
 * Intake clarification completion binds the existing public Intake outcome.
 */
export interface InteractionPresentationResultControlStore extends InteractionPublicActionControlStore {
  reserveInteractionClarificationOperation(
    input: ReserveInteractionClarificationOperation,
  ): InteractionClarificationOperationReservationResult;
  commitFrontstageAnswerResult(
    input: CommitFrontstageAnswerResult,
  ): FrontstageAnswerResultCommitResult;
  commitInteractionGoalViewResult(
    input: CommitInteractionGoalViewResult,
  ): InteractionPresentationResultCommitResult;
  commitInteractionClarificationResult(
    input: CommitInteractionClarificationResult,
  ): InteractionPresentationResultCommitResult;
  commitInteractionResultProjection(
    input: CommitInteractionResultProjection,
  ): InteractionPresentationResultCommitResult;
  getFrontstageAnswer(answerId: FrontstageAnswerId): FrontstageAnswer | undefined;
  getUnresolvedInteractionClarificationOperation(
    operationId: InteractionOperationId,
  ): InteractionUnresolvedClarificationOperationDescriptor | undefined;
}

/**
 * Startup detection reads one complete catalog from retained Interaction
 * authority. Reconciliation and capability re-entry remain separate Runtime
 * responsibilities.
 */
export interface InteractionStartupDetectionControlStore extends InteractionPresentationResultControlStore {
  getInteractionStartupDetectionCatalog(): InteractionStartupDetectionCatalog;
}

export interface RecordInteractionFocusBinding {
  readonly currentSession: InteractionSession;
  readonly focus: FocusBinding;
  readonly nextSession: InteractionSession;
  readonly focusAuditWrite: InteractionAuditWrite;
  readonly sessionAuditWrite: InteractionAuditWrite;
}

export type InteractionFocusBindingRecordResult =
  | Readonly<{
      status: 'APPLIED' | 'REPLAYED';
      focus: FocusBinding;
      session: InteractionSession;
    }>
  | Readonly<{ status: 'SESSION_NOT_FOUND' }>
  | Readonly<{
      status: 'VERSION_CONFLICT';
      currentSession: InteractionSession;
    }>
  | Readonly<{
      status: 'FOCUS_CONFLICT';
      currentFocus: FocusBinding;
    }>
  | InteractionSessionOperationBusyResult;

/**
 * Runtime authors the exact Focus and Session transition. The Store owns their
 * atomic CAS, replay/conflict classification, audit membership, and strict
 * reopen. Successful Operation completion remains with result-specific ports.
 */
export interface InteractionFocusControlStore extends InteractionSessionControlStore {
  recordInteractionFocusBinding(
    input: RecordInteractionFocusBinding,
  ): InteractionFocusBindingRecordResult;
  getInteractionFocusBinding(focusId: FocusBindingId): FocusBinding | undefined;
}
