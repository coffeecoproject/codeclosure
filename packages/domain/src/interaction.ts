import { Buffer } from 'node:buffer';

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
  interactionMessageHandoffId,
  interactionMessageId,
  interactionOperationId,
  interactionOperationVersion,
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
  type ClarificationQuestionId,
  type CommandId,
  type FocusBindingId,
  type FrontstageAnswerId,
  type FrontstageContextManifestId,
  type GoalId,
  type GoalRevision,
  type IntakeRunId,
  type IntakeRunVersion,
  type InteractionActionOutcomeId,
  type InteractionActionReservationId,
  type InteractionMessageHandoffId,
  type InteractionMessageId,
  type InteractionOperationId,
  type InteractionOperationVersion,
  type InteractionSessionId,
  type InteractionSessionVersion,
  type IsoTimestamp,
  type PendingActionId,
  type PendingActionResolutionId,
  type PrincipalId,
  type RouteDecisionId,
  type RouteProposalId,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import {
  assertDeclaredProjectRefInvariant,
  type DeclaredProjectRef,
  type VersionedDigestRef,
} from './intake.js';
import { DomainInvariantError } from './workflow.js';

export const INTERACTION_MAXIMUM_MESSAGE_BYTES = 16_384;
export const INTERACTION_MAXIMUM_SESSION_MESSAGES = 512;
export const INTERACTION_MAXIMUM_SESSION_CONTENT_BYTES = 2_097_152;
export const INTERACTION_MAXIMUM_RETAINED_ANSWER_BYTES = 16_384;
export const INTERACTION_MAXIMUM_CLARIFICATION_OR_EXPLANATION_BYTES = 2_048;

export const InteractionSessionState = {
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED',
  INTERRUPTED: 'INTERRUPTED',
} as const;
export type InteractionSessionState =
  (typeof InteractionSessionState)[keyof typeof InteractionSessionState];

export const InteractionSessionTerminalReason = {
  RETENTION_LIMIT_REACHED: 'RETENTION_LIMIT_REACHED',
} as const;
export type InteractionSessionTerminalReason =
  (typeof InteractionSessionTerminalReason)[keyof typeof InteractionSessionTerminalReason];

export const InteractionMessageRole = {
  USER: 'USER',
  FRONTSTAGE: 'FRONTSTAGE',
  SYSTEM: 'SYSTEM',
} as const;
export type InteractionMessageRole =
  (typeof InteractionMessageRole)[keyof typeof InteractionMessageRole];

export const InteractionContentRetention = {
  RETAINED: 'RETAINED',
  OMITTED: 'OMITTED',
} as const;
export type InteractionContentRetention =
  (typeof InteractionContentRetention)[keyof typeof InteractionContentRetention];

export const InteractionContentOmissionReason = {
  RETENTION_POLICY: 'RETENTION_POLICY',
} as const;
export type InteractionContentOmissionReason =
  (typeof InteractionContentOmissionReason)[keyof typeof InteractionContentOmissionReason];

export const InteractionOperationState = {
  RESERVED: 'RESERVED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  INTERRUPTED: 'INTERRUPTED',
} as const;
export type InteractionOperationState =
  (typeof InteractionOperationState)[keyof typeof InteractionOperationState];

export const InteractionOperationKind = {
  ROUTE: 'ROUTE',
  FRONTSTAGE_ANSWER: 'FRONTSTAGE_ANSWER',
  GOAL_LIST: 'GOAL_LIST',
  GOAL_STATUS: 'GOAL_STATUS',
  INTAKE_HANDOFF: 'INTAKE_HANDOFF',
  INTAKE_CLARIFICATION: 'INTAKE_CLARIFICATION',
  ACTION_PROPOSAL: 'ACTION_PROPOSAL',
  ACTION_CONFIRMATION: 'ACTION_CONFIRMATION',
  RESULT_PROJECTION: 'RESULT_PROJECTION',
} as const;
export type InteractionOperationKind =
  (typeof InteractionOperationKind)[keyof typeof InteractionOperationKind];

export const InteractionOperationFailureReason = {
  VALIDATION_REJECTED: 'VALIDATION_REJECTED',
  ASSISTANT_FAILED: 'ASSISTANT_FAILED',
  PUBLIC_CAPABILITY_FAILED: 'PUBLIC_CAPABILITY_FAILED',
  RESULT_PROJECTION_FAILED: 'RESULT_PROJECTION_FAILED',
  INTERRUPTED: 'INTERRUPTED',
} as const;
export type InteractionOperationFailureReason =
  (typeof InteractionOperationFailureReason)[keyof typeof InteractionOperationFailureReason];

export const InteractionFocusKind = {
  NONE: 'NONE',
  INTAKE_QUESTION: 'INTAKE_QUESTION',
  GOAL: 'GOAL',
} as const;
export type InteractionFocusKind = (typeof InteractionFocusKind)[keyof typeof InteractionFocusKind];

export const FrontstageProposalKind = {
  ANSWER_PROPOSAL: 'ANSWER_PROPOSAL',
  ROUTE_PROPOSAL: 'ROUTE_PROPOSAL',
  CLARIFICATION_PROPOSAL: 'CLARIFICATION_PROPOSAL',
  NO_ACTION_PROPOSAL: 'NO_ACTION_PROPOSAL',
} as const;
export type FrontstageProposalKind =
  (typeof FrontstageProposalKind)[keyof typeof FrontstageProposalKind];

export const FrontstageCandidateRoute = {
  LIST_GOALS: 'LIST_GOALS',
  SHOW_GOAL: 'SHOW_GOAL',
  SUBMIT_GOVERNED_INTAKE: 'SUBMIT_GOVERNED_INTAKE',
  SUBMIT_MATERIALIZE_ONLY_INTAKE: 'SUBMIT_MATERIALIZE_ONLY_INTAKE',
  START_GOAL: 'START_GOAL',
  RESUME_GOAL: 'RESUME_GOAL',
  CANCEL_GOAL: 'CANCEL_GOAL',
} as const;
export type FrontstageCandidateRoute =
  (typeof FrontstageCandidateRoute)[keyof typeof FrontstageCandidateRoute];

export const FrontstageProposalAmbiguity = {
  NONE: 'NONE',
  ACTION_AMBIGUOUS: 'ACTION_AMBIGUOUS',
  TARGET_AMBIGUOUS: 'TARGET_AMBIGUOUS',
  REQUEST_INCOMPLETE: 'REQUEST_INCOMPLETE',
} as const;
export type FrontstageProposalAmbiguity =
  (typeof FrontstageProposalAmbiguity)[keyof typeof FrontstageProposalAmbiguity];

export const FrontstageNoActionReason = {
  UNSUPPORTED: 'UNSUPPORTED',
  NO_SAFE_PROPOSAL: 'NO_SAFE_PROPOSAL',
} as const;
export type FrontstageNoActionReason =
  (typeof FrontstageNoActionReason)[keyof typeof FrontstageNoActionReason];

export const InteractionRouteDecisionOutcome = {
  ANSWER: 'ANSWER',
  LIST_GOALS: 'LIST_GOALS',
  SHOW_GOAL: 'SHOW_GOAL',
  CONTINUE_EXACT_INTAKE_QUESTION: 'CONTINUE_EXACT_INTAKE_QUESTION',
  PROPOSE_INTAKE_ACTION: 'PROPOSE_INTAKE_ACTION',
  PROPOSE_GOAL_CONTROL: 'PROPOSE_GOAL_CONTROL',
  ASK_ROUTE_CLARIFICATION: 'ASK_ROUTE_CLARIFICATION',
  NO_ACTION: 'NO_ACTION',
} as const;
export type InteractionRouteDecisionOutcome =
  (typeof InteractionRouteDecisionOutcome)[keyof typeof InteractionRouteDecisionOutcome];

export const InteractionRouteDecisionSource = {
  EXACT_INTAKE_QUESTION: 'EXACT_INTAKE_QUESTION',
  DIRECT_ACTION: 'DIRECT_ACTION',
  READ_ONLY_GOAL_QUERY: 'READ_ONLY_GOAL_QUERY',
  ASSISTANT_PROPOSAL: 'ASSISTANT_PROPOSAL',
} as const;
export type InteractionRouteDecisionSource =
  (typeof InteractionRouteDecisionSource)[keyof typeof InteractionRouteDecisionSource];

export const PendingActionKind = {
  SUBMIT_GOVERNED_INTAKE: 'SUBMIT_GOVERNED_INTAKE',
  SUBMIT_MATERIALIZE_ONLY_INTAKE: 'SUBMIT_MATERIALIZE_ONLY_INTAKE',
  START_GOAL: 'START_GOAL',
  RESUME_GOAL: 'RESUME_GOAL',
  CANCEL_GOAL: 'CANCEL_GOAL',
} as const;
export type PendingActionKind = (typeof PendingActionKind)[keyof typeof PendingActionKind];

export const PendingActionDerivation = {
  ROUTED_ACTION: 'ROUTED_ACTION',
  BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE: 'BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE',
} as const;
export type PendingActionDerivation =
  (typeof PendingActionDerivation)[keyof typeof PendingActionDerivation];

export const InteractionConfirmationRequirement = {
  DIRECT_USER_MESSAGE_SUFFICIENT: 'DIRECT_USER_MESSAGE_SUFFICIENT',
  SEPARATE_RESPONSE_REQUIRED: 'SEPARATE_RESPONSE_REQUIRED',
} as const;
export type InteractionConfirmationRequirement =
  (typeof InteractionConfirmationRequirement)[keyof typeof InteractionConfirmationRequirement];

export const PendingActionResolutionDisposition = {
  DIRECT_USER_AUTHORIZED: 'DIRECT_USER_AUTHORIZED',
  SEPARATE_RESPONSE_CONFIRMED: 'SEPARATE_RESPONSE_CONFIRMED',
  DECLINED: 'DECLINED',
  UNCLEAR: 'UNCLEAR',
  EXPIRED: 'EXPIRED',
  STALE_AUTHORITY: 'STALE_AUTHORITY',
  CONFLICT: 'CONFLICT',
  INTERRUPTED: 'INTERRUPTED',
} as const;
export type PendingActionResolutionDisposition =
  (typeof PendingActionResolutionDisposition)[keyof typeof PendingActionResolutionDisposition];

export const InteractionPublicCapability = {
  SUBMIT_INTAKE: 'SUBMIT_INTAKE',
  START_GOAL: 'START_GOAL',
  RESUME_GOAL: 'RESUME_GOAL',
  CANCEL_GOAL: 'CANCEL_GOAL',
} as const;
export type InteractionPublicCapability =
  (typeof InteractionPublicCapability)[keyof typeof InteractionPublicCapability];

export const InteractionActionOutcomeDisposition = {
  APPLIED: 'APPLIED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;
export type InteractionActionOutcomeDisposition =
  (typeof InteractionActionOutcomeDisposition)[keyof typeof InteractionActionOutcomeDisposition];

export const InteractionOperationResultKind = {
  ROUTE_DECIDED: 'ROUTE_DECIDED',
  ANSWER_RECORDED: 'ANSWER_RECORDED',
  GOAL_VIEW_RECORDED: 'GOAL_VIEW_RECORDED',
  INTAKE_HANDOFF_RECORDED: 'INTAKE_HANDOFF_RECORDED',
  PUBLIC_COMMAND_RECORDED: 'PUBLIC_COMMAND_RECORDED',
  PENDING_ACTION_RECORDED: 'PENDING_ACTION_RECORDED',
  ACTION_RESOLUTION_RECORDED: 'ACTION_RESOLUTION_RECORDED',
  RESULT_PROJECTED: 'RESULT_PROJECTED',
} as const;
export type InteractionOperationResultKind =
  (typeof InteractionOperationResultKind)[keyof typeof InteractionOperationResultKind];

export type InteractionVersionedDigestRef = VersionedDigestRef;

export interface InteractionDigestRef<Id extends string> {
  readonly id: Id;
  readonly digest: Sha256Digest;
}

export type InteractionProjectRef = DeclaredProjectRef;

export interface InteractionGoalTargetRef {
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
}

export interface InteractionQuestionTargetRef {
  readonly intakeRunId: IntakeRunId;
  readonly intakeRunVersion: IntakeRunVersion;
  readonly clarificationQuestionId: ClarificationQuestionId;
  readonly questionSpecDigest: Sha256Digest;
  readonly questionDigest: Sha256Digest;
}

interface InteractionSessionCommon {
  readonly id: InteractionSessionId;
  readonly schemaVersion: 1;
  readonly version: InteractionSessionVersion;
  readonly principalRef: PrincipalId;
  readonly projectRef: InteractionProjectRef;
  readonly configuration: InteractionVersionedDigestRef;
  readonly routingPolicy: InteractionVersionedDigestRef;
  readonly confirmationPolicy: InteractionVersionedDigestRef;
  readonly retentionProfile: InteractionVersionedDigestRef;
  readonly currentFocusRef?: InteractionDigestRef<FocusBindingId>;
  readonly openedAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly sessionDigest: Sha256Digest;
}

export interface NonTerminalInteractionSession extends InteractionSessionCommon {
  readonly state: typeof InteractionSessionState.OPEN | typeof InteractionSessionState.CLOSING;
}

export interface ClosedInteractionSession extends InteractionSessionCommon {
  readonly state: typeof InteractionSessionState.CLOSED;
  readonly terminalReason?: typeof InteractionSessionTerminalReason.RETENTION_LIMIT_REACHED;
}

export interface InterruptedInteractionSession extends InteractionSessionCommon {
  readonly state: typeof InteractionSessionState.INTERRUPTED;
}

export type TerminalInteractionSession = ClosedInteractionSession | InterruptedInteractionSession;

export type InteractionSession = NonTerminalInteractionSession | TerminalInteractionSession;

interface InteractionMessageCommon {
  readonly id: InteractionMessageId;
  readonly schemaVersion: 1;
  readonly sessionId: InteractionSessionId;
  readonly principalRef: PrincipalId;
  readonly contentDigest: Sha256Digest;
  readonly contentByteLength: number;
  readonly createdAt: IsoTimestamp;
  readonly messageDigest: Sha256Digest;
}

interface UserInteractionMessageOrigin {
  readonly role: typeof InteractionMessageRole.USER;
  readonly causedByOperationRef?: never;
}

interface ProducedInteractionMessageOrigin {
  readonly role: typeof InteractionMessageRole.FRONTSTAGE | typeof InteractionMessageRole.SYSTEM;
  readonly causedByOperationRef: InteractionDigestRef<InteractionOperationId>;
}

type InteractionMessageOrigin = UserInteractionMessageOrigin | ProducedInteractionMessageOrigin;

export type RetainedInteractionMessage = InteractionMessageCommon &
  InteractionMessageOrigin & {
    readonly retention: typeof InteractionContentRetention.RETAINED;
    readonly content: string;
  };

export type OmittedInteractionMessage = InteractionMessageCommon &
  InteractionMessageOrigin & {
    readonly retention: typeof InteractionContentRetention.OMITTED;
    readonly omissionReason: InteractionContentOmissionReason;
  };

export type InteractionMessage = RetainedInteractionMessage | OmittedInteractionMessage;

interface FocusBindingCommon {
  readonly id: FocusBindingId;
  readonly schemaVersion: 1;
  readonly sessionId: InteractionSessionId;
  readonly basedOnSessionVersion: InteractionSessionVersion;
  readonly createdAt: IsoTimestamp;
  readonly focusDigest: Sha256Digest;
}

export interface NoFocusBinding extends FocusBindingCommon {
  readonly kind: typeof InteractionFocusKind.NONE;
}

export interface IntakeQuestionFocusBinding extends FocusBindingCommon {
  readonly kind: typeof InteractionFocusKind.INTAKE_QUESTION;
  readonly questionTarget: InteractionQuestionTargetRef;
}

export interface GoalFocusBinding extends FocusBindingCommon {
  readonly kind: typeof InteractionFocusKind.GOAL;
  readonly goalTarget: InteractionGoalTargetRef;
}

export type FocusBinding = NoFocusBinding | IntakeQuestionFocusBinding | GoalFocusBinding;

interface RouteProposalCommon {
  readonly id: RouteProposalId;
  readonly schemaVersion: 1;
  readonly sessionId: InteractionSessionId;
  readonly operationId: InteractionOperationId;
  readonly messageRef: InteractionDigestRef<InteractionMessageId>;
  readonly contextManifestRef: InteractionDigestRef<FrontstageContextManifestId>;
  readonly assistantProfile: InteractionVersionedDigestRef;
  readonly assistantAdapter: InteractionVersionedDigestRef;
  readonly responseContract: InteractionVersionedDigestRef;
  readonly observedAt: IsoTimestamp;
  readonly proposalDigest: Sha256Digest;
}

export interface AnswerRouteProposal extends RouteProposalCommon {
  readonly kind: typeof FrontstageProposalKind.ANSWER_PROPOSAL;
  readonly answerContent: string;
}

export interface CandidateRouteProposal extends RouteProposalCommon {
  readonly kind: typeof FrontstageProposalKind.ROUTE_PROPOSAL;
  readonly candidateRoute: FrontstageCandidateRoute;
  readonly candidateGoalIds: readonly GoalId[];
  readonly ambiguity: FrontstageProposalAmbiguity;
  readonly explanationContent?: string;
}

export interface ClarificationRouteProposal extends RouteProposalCommon {
  readonly kind: typeof FrontstageProposalKind.CLARIFICATION_PROPOSAL;
  readonly ambiguity:
    | typeof FrontstageProposalAmbiguity.ACTION_AMBIGUOUS
    | typeof FrontstageProposalAmbiguity.TARGET_AMBIGUOUS
    | typeof FrontstageProposalAmbiguity.REQUEST_INCOMPLETE;
  readonly questionContent: string;
}

export interface NoActionRouteProposal extends RouteProposalCommon {
  readonly kind: typeof FrontstageProposalKind.NO_ACTION_PROPOSAL;
  readonly reasonCode: FrontstageNoActionReason;
}

export type RouteProposal =
  AnswerRouteProposal | CandidateRouteProposal | ClarificationRouteProposal | NoActionRouteProposal;

interface RouteDecisionCommon {
  readonly id: RouteDecisionId;
  readonly schemaVersion: 1;
  readonly sessionId: InteractionSessionId;
  readonly expectedSessionVersion: InteractionSessionVersion;
  readonly messageRef: InteractionDigestRef<InteractionMessageId>;
  readonly focusRef?: InteractionDigestRef<FocusBindingId>;
  readonly proposalRef?: InteractionDigestRef<RouteProposalId>;
  readonly source: InteractionRouteDecisionSource;
  readonly routingPolicy: InteractionVersionedDigestRef;
  readonly allowedRoutes: readonly InteractionRouteDecisionOutcome[];
  readonly reasonTrace: readonly InteractionPolicyTraceEntry[];
  readonly decidedAt: IsoTimestamp;
  readonly decisionDigest: Sha256Digest;
}

export interface AnswerRouteDecision extends RouteDecisionCommon {
  readonly outcome: typeof InteractionRouteDecisionOutcome.ANSWER;
  readonly answerProposalRef: InteractionDigestRef<RouteProposalId>;
}

export interface ListGoalsRouteDecision extends RouteDecisionCommon {
  readonly outcome: typeof InteractionRouteDecisionOutcome.LIST_GOALS;
}

export interface ShowGoalRouteDecision extends RouteDecisionCommon {
  readonly outcome: typeof InteractionRouteDecisionOutcome.SHOW_GOAL;
  readonly goalTarget: InteractionGoalTargetRef;
}

export interface ContinueIntakeQuestionRouteDecision extends RouteDecisionCommon {
  readonly outcome: typeof InteractionRouteDecisionOutcome.CONTINUE_EXACT_INTAKE_QUESTION;
  readonly questionTarget: InteractionQuestionTargetRef;
}

export interface ProposeIntakeActionRouteDecision extends RouteDecisionCommon {
  readonly outcome: typeof InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION;
  readonly actionKind:
    | typeof PendingActionKind.SUBMIT_GOVERNED_INTAKE
    | typeof PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE;
}

export interface ProposeGoalControlRouteDecision extends RouteDecisionCommon {
  readonly outcome: typeof InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL;
  readonly actionKind:
    | typeof PendingActionKind.START_GOAL
    | typeof PendingActionKind.RESUME_GOAL
    | typeof PendingActionKind.CANCEL_GOAL;
  readonly goalTarget: InteractionGoalTargetRef;
}

export interface AskRouteClarificationDecision extends RouteDecisionCommon {
  readonly outcome: typeof InteractionRouteDecisionOutcome.ASK_ROUTE_CLARIFICATION;
  readonly ambiguity:
    | typeof FrontstageProposalAmbiguity.ACTION_AMBIGUOUS
    | typeof FrontstageProposalAmbiguity.TARGET_AMBIGUOUS
    | typeof FrontstageProposalAmbiguity.REQUEST_INCOMPLETE;
}

export interface NoActionRouteDecision extends RouteDecisionCommon {
  readonly outcome: typeof InteractionRouteDecisionOutcome.NO_ACTION;
  readonly reasonCode: FrontstageNoActionReason;
}

export type RouteDecision =
  | AnswerRouteDecision
  | ListGoalsRouteDecision
  | ShowGoalRouteDecision
  | ContinueIntakeQuestionRouteDecision
  | ProposeIntakeActionRouteDecision
  | ProposeGoalControlRouteDecision
  | AskRouteClarificationDecision
  | NoActionRouteDecision;

export interface InteractionPolicyTraceEntry {
  readonly ruleId: string;
  readonly policyDigest: Sha256Digest;
  readonly outcome: 'MATCHED' | 'NOT_MATCHED';
  readonly inputDigests: readonly Sha256Digest[];
}

interface PendingActionCommon {
  readonly id: PendingActionId;
  readonly schemaVersion: 1;
  readonly sessionId: InteractionSessionId;
  readonly principalRef: PrincipalId;
  readonly projectRef: InteractionProjectRef;
  readonly originatingMessageRef: InteractionDigestRef<InteractionMessageId>;
  readonly routeDecisionRef: InteractionDigestRef<RouteDecisionId>;
  readonly focusRef?: InteractionDigestRef<FocusBindingId>;
  readonly preallocatedCommandId: CommandId;
  readonly canonicalCommandInputDigest: Sha256Digest;
  readonly publicCapability: InteractionPublicCapability;
  readonly routingPolicy: InteractionVersionedDigestRef;
  readonly confirmationPolicy: InteractionVersionedDigestRef;
  readonly confirmationRequirement: InteractionConfirmationRequirement;
  readonly reasonTrace: readonly InteractionPolicyTraceEntry[];
  readonly expiresAt: IsoTimestamp;
  readonly createdAt: IsoTimestamp;
  readonly pendingActionDigest: Sha256Digest;
}

export interface IntakePendingAction extends PendingActionCommon {
  readonly kind:
    | typeof PendingActionKind.SUBMIT_GOVERNED_INTAKE
    | typeof PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE;
  readonly publicCapability: typeof InteractionPublicCapability.SUBMIT_INTAKE;
  readonly actionDerivation: PendingActionDerivation;
}

export interface GoalControlPendingAction extends PendingActionCommon {
  readonly kind:
    | typeof PendingActionKind.START_GOAL
    | typeof PendingActionKind.RESUME_GOAL
    | typeof PendingActionKind.CANCEL_GOAL;
  readonly publicCapability:
    | typeof InteractionPublicCapability.START_GOAL
    | typeof InteractionPublicCapability.RESUME_GOAL
    | typeof InteractionPublicCapability.CANCEL_GOAL;
  readonly actionDerivation: typeof PendingActionDerivation.ROUTED_ACTION;
  readonly goalTarget: InteractionGoalTargetRef;
}

export type PendingAction = IntakePendingAction | GoalControlPendingAction;

interface PendingActionResolutionCommon {
  readonly id: PendingActionResolutionId;
  readonly schemaVersion: 1;
  readonly pendingActionRef: InteractionDigestRef<PendingActionId>;
  readonly confirmationPolicy: InteractionVersionedDigestRef;
  readonly resolvedAt: IsoTimestamp;
  readonly resolutionDigest: Sha256Digest;
}

export interface DirectPendingActionAuthorization extends PendingActionResolutionCommon {
  readonly disposition: typeof PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED;
  readonly authorizingMessageRef: InteractionDigestRef<InteractionMessageId>;
}

export interface ConfirmedPendingActionAuthorization extends PendingActionResolutionCommon {
  readonly disposition: typeof PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED;
  readonly originatingMessageRef: InteractionDigestRef<InteractionMessageId>;
  readonly authorizingMessageRef: InteractionDigestRef<InteractionMessageId>;
}

export interface RespondedPendingActionResolution extends PendingActionResolutionCommon {
  readonly disposition:
    | typeof PendingActionResolutionDisposition.DECLINED
    | typeof PendingActionResolutionDisposition.UNCLEAR;
  readonly responseMessageRef: InteractionDigestRef<InteractionMessageId>;
}

export interface UnrespondedPendingActionResolution extends PendingActionResolutionCommon {
  readonly disposition:
    | typeof PendingActionResolutionDisposition.EXPIRED
    | typeof PendingActionResolutionDisposition.STALE_AUTHORITY
    | typeof PendingActionResolutionDisposition.CONFLICT
    | typeof PendingActionResolutionDisposition.INTERRUPTED;
}

export type PendingActionResolution =
  | DirectPendingActionAuthorization
  | ConfirmedPendingActionAuthorization
  | RespondedPendingActionResolution
  | UnrespondedPendingActionResolution;

export interface InteractionActionReservation {
  readonly id: InteractionActionReservationId;
  readonly schemaVersion: 1;
  readonly pendingActionRef: InteractionDigestRef<PendingActionId>;
  readonly resolutionRef: InteractionDigestRef<PendingActionResolutionId>;
  readonly publicCapability: InteractionPublicCapability;
  readonly commandId: CommandId;
  readonly canonicalCommandInputDigest: Sha256Digest;
  readonly reservedAt: IsoTimestamp;
  readonly reservationDigest: Sha256Digest;
}

export interface InteractionActionOutcome {
  readonly id: InteractionActionOutcomeId;
  readonly schemaVersion: 1;
  readonly reservationRef: InteractionDigestRef<InteractionActionReservationId>;
  readonly commandId: CommandId;
  readonly canonicalCommandInputDigest: Sha256Digest;
  readonly disposition: InteractionActionOutcomeDisposition;
  readonly publicCommandOutcomeDigest: Sha256Digest;
  readonly resultProjectionDigest: Sha256Digest;
  readonly completedAt: IsoTimestamp;
  readonly outcomeDigest: Sha256Digest;
}

export interface InteractionActionChain {
  readonly originatingMessage: InteractionMessage;
  readonly resolutionMessage?: InteractionMessage;
  readonly routeDecision: RouteDecision;
  readonly pendingAction: PendingAction;
  readonly resolution: PendingActionResolution;
  readonly reservation?: InteractionActionReservation;
  readonly outcome?: InteractionActionOutcome;
  readonly handoff?: InteractionMessageHandoff;
}

export interface FrontstageAnswerChain {
  readonly session: InteractionSession;
  readonly originatingMessage: InteractionMessage;
  readonly routeOperation: CompletedInteractionOperation;
  readonly proposal: RouteProposal;
  readonly routeDecision: RouteDecision;
  readonly answer: FrontstageAnswer;
  readonly answerOperation: CompletedInteractionOperation;
}

export interface InteractionMessageHandoff {
  readonly id: InteractionMessageHandoffId;
  readonly schemaVersion: 1;
  readonly sessionId: InteractionSessionId;
  readonly messageRef: InteractionDigestRef<InteractionMessageId>;
  readonly pendingActionRef: InteractionDigestRef<PendingActionId>;
  readonly resolutionRef: InteractionDigestRef<PendingActionResolutionId>;
  readonly reservationRef: InteractionDigestRef<InteractionActionReservationId>;
  readonly admittedUserContent: string;
  readonly admittedContentDigest: Sha256Digest;
  readonly intakeCommandId: CommandId;
  readonly createdAt: IsoTimestamp;
  readonly handoffDigest: Sha256Digest;
}

export interface FrontstageAnswer {
  readonly id: FrontstageAnswerId;
  readonly schemaVersion: 1;
  readonly sessionId: InteractionSessionId;
  readonly originatingMessageRef: InteractionDigestRef<InteractionMessageId>;
  readonly routeDecisionRef: InteractionDigestRef<RouteDecisionId>;
  readonly proposalRef: InteractionDigestRef<RouteProposalId>;
  readonly assistantProfile: InteractionVersionedDigestRef;
  readonly responseContract: InteractionVersionedDigestRef;
  readonly retentionProfile: InteractionVersionedDigestRef;
  readonly answerContent: string;
  readonly answerContentDigest: Sha256Digest;
  readonly createdAt: IsoTimestamp;
  readonly answerDigest: Sha256Digest;
}

export type InteractionOperationResult =
  | Readonly<{
      kind: typeof InteractionOperationResultKind.ROUTE_DECIDED;
      routeDecisionRef: InteractionDigestRef<RouteDecisionId>;
      routeProposalRef?: InteractionDigestRef<RouteProposalId>;
    }>
  | Readonly<{
      kind: typeof InteractionOperationResultKind.ANSWER_RECORDED;
      answerRef: InteractionDigestRef<FrontstageAnswerId>;
    }>
  | Readonly<{
      kind: typeof InteractionOperationResultKind.GOAL_VIEW_RECORDED;
      projectionDigest: Sha256Digest;
    }>
  | Readonly<{
      kind: typeof InteractionOperationResultKind.INTAKE_HANDOFF_RECORDED;
      handoffRef: InteractionDigestRef<InteractionMessageHandoffId>;
    }>
  | Readonly<{
      kind: typeof InteractionOperationResultKind.PUBLIC_COMMAND_RECORDED;
      commandId: CommandId;
      publicCommandOutcomeDigest: Sha256Digest;
    }>
  | Readonly<{
      kind: typeof InteractionOperationResultKind.PENDING_ACTION_RECORDED;
      pendingActionRef: InteractionDigestRef<PendingActionId>;
    }>
  | Readonly<{
      kind: typeof InteractionOperationResultKind.ACTION_RESOLUTION_RECORDED;
      resolutionRef: InteractionDigestRef<PendingActionResolutionId>;
      reservationRef?: InteractionDigestRef<InteractionActionReservationId>;
    }>
  | Readonly<{
      kind: typeof InteractionOperationResultKind.RESULT_PROJECTED;
      projectionDigest: Sha256Digest;
    }>;

interface InteractionOperationCommon {
  readonly id: InteractionOperationId;
  readonly schemaVersion: 1;
  readonly version: InteractionOperationVersion;
  readonly sessionId: InteractionSessionId;
  readonly expectedSessionVersion: InteractionSessionVersion;
  readonly messageRef: InteractionDigestRef<InteractionMessageId>;
  readonly operationKind: InteractionOperationKind;
  readonly contextManifestRef?: InteractionDigestRef<FrontstageContextManifestId>;
  readonly assistantProfile?: InteractionVersionedDigestRef;
  readonly reservedAt: IsoTimestamp;
  readonly operationDigest: Sha256Digest;
}

export interface ReservedInteractionOperation extends InteractionOperationCommon {
  readonly state: typeof InteractionOperationState.RESERVED;
}

export interface CompletedInteractionOperation extends InteractionOperationCommon {
  readonly state: typeof InteractionOperationState.COMPLETED;
  readonly result: InteractionOperationResult;
  readonly completedAt: IsoTimestamp;
}

export interface FailedInteractionOperation extends InteractionOperationCommon {
  readonly state: typeof InteractionOperationState.FAILED;
  readonly failureReason: Exclude<
    InteractionOperationFailureReason,
    typeof InteractionOperationFailureReason.INTERRUPTED
  >;
  readonly completedAt: IsoTimestamp;
}

export interface InterruptedInteractionOperation extends InteractionOperationCommon {
  readonly state: typeof InteractionOperationState.INTERRUPTED;
  readonly failureReason: typeof InteractionOperationFailureReason.INTERRUPTED;
  readonly completedAt: IsoTimestamp;
}

export type InteractionOperation =
  | ReservedInteractionOperation
  | CompletedInteractionOperation
  | FailedInteractionOperation
  | InterruptedInteractionOperation;

function assertKnown<Value extends string>(
  values: Readonly<Record<string, Value>>,
  value: unknown,
  name: string,
): asserts value is Value {
  if (!Object.values(values).some((candidate) => candidate === value)) {
    throw new DomainInvariantError(`${name} is unknown`);
  }
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new DomainInvariantError(`${name} must not be blank`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainInvariantError(`${name} must be a non-negative safe integer`);
  }
}

function assertUtf8ByteLimit(value: string, maximum: number, name: string): void {
  if (Buffer.byteLength(value, 'utf8') > maximum) {
    throw new DomainInvariantError(`${name} exceeds its UTF-8 byte limit`);
  }
}

function assertUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) {
    throw new DomainInvariantError(`${name} must not contain duplicates`);
  }
}

function assertInteractionPolicyTraceEntryInvariant(entry: InteractionPolicyTraceEntry): void {
  assertNonBlank(entry.ruleId, 'Interaction policy rule ID');
  sha256Digest(entry.policyDigest);
  if (entry.inputDigests.length === 0) {
    throw new DomainInvariantError('Interaction policy trace must bind at least one input digest');
  }
  entry.inputDigests.forEach(sha256Digest);
}

function assertDigestRef<Id extends string>(reference: InteractionDigestRef<Id>): void {
  assertNonBlank(reference.id, 'Digest reference ID');
  sha256Digest(reference.digest);
}

function assertVersionedDigestRef(reference: InteractionVersionedDigestRef, name: string): void {
  assertNonBlank(reference.id, `${name} ID`);
  assertNonBlank(reference.version, `${name} version`);
  sha256Digest(reference.digest);
}

export function assertInteractionProjectRefInvariant(reference: InteractionProjectRef): void {
  assertDeclaredProjectRefInvariant(reference);
}

export function assertInteractionGoalTargetRefInvariant(reference: InteractionGoalTargetRef): void {
  goalId(reference.goalId);
  goalRevision(reference.goalRevision);
  workflowId(reference.workflowId);
  workflowVersion(reference.workflowVersion);
}

export function assertInteractionQuestionTargetRefInvariant(
  reference: InteractionQuestionTargetRef,
): void {
  intakeRunId(reference.intakeRunId);
  intakeRunVersion(reference.intakeRunVersion);
  clarificationQuestionId(reference.clarificationQuestionId);
  sha256Digest(reference.questionSpecDigest);
  sha256Digest(reference.questionDigest);
}

function sameInteractionProjectRef(
  left: InteractionProjectRef,
  right: InteractionProjectRef,
): boolean {
  return (
    left.normalizedPath === right.normalizedPath && left.identityDigest === right.identityDigest
  );
}

function sameVersionedDigestRef(
  left: InteractionVersionedDigestRef,
  right: InteractionVersionedDigestRef,
): boolean {
  return left.id === right.id && left.version === right.version && left.digest === right.digest;
}

export function assertInteractionSessionInvariant(session: InteractionSession): void {
  interactionSessionId(session.id);
  interactionSessionVersion(session.version);
  principalId(session.principalRef);
  assertInteractionProjectRefInvariant(session.projectRef);
  assertKnown(InteractionSessionState, session.state, 'Interaction Session state');
  if (session.state === InteractionSessionState.CLOSED) {
    if (session.terminalReason !== undefined) {
      assertKnown(
        InteractionSessionTerminalReason,
        session.terminalReason,
        'Interaction Session terminal reason',
      );
    }
  } else if ('terminalReason' in session) {
    throw new DomainInvariantError('Only a closed Interaction Session may have a terminal reason');
  }
  assertVersionedDigestRef(session.configuration, 'Interaction configuration');
  assertVersionedDigestRef(session.routingPolicy, 'Interaction routing policy');
  assertVersionedDigestRef(session.confirmationPolicy, 'Interaction confirmation policy');
  assertVersionedDigestRef(session.retentionProfile, 'Interaction retention profile');
  if (session.currentFocusRef !== undefined) {
    focusBindingId(session.currentFocusRef.id);
    assertDigestRef(session.currentFocusRef);
  }
  isoTimestamp(session.openedAt);
  isoTimestamp(session.updatedAt);
  if (session.updatedAt < session.openedAt) {
    throw new DomainInvariantError('Interaction Session update cannot precede opening');
  }
  sha256Digest(session.sessionDigest);
}

/**
 * Owns the initial Session shape. Persistence may allocate identity and commit
 * the record with audit, but it cannot create a pre-aged or terminal Session.
 */
export function assertInitialInteractionSessionInvariant(
  session: InteractionSession,
): asserts session is NonTerminalInteractionSession {
  assertInteractionSessionInvariant(session);
  if (
    session.version !== 1 ||
    session.state !== InteractionSessionState.OPEN ||
    session.openedAt !== session.updatedAt ||
    session.currentFocusRef !== undefined
  ) {
    throw new DomainInvariantError(
      'An initial Interaction Session must be an unfocused OPEN version 1 record',
    );
  }
}

/**
 * Owns the semantic lifecycle of one Interaction Session. Persistence remains
 * responsible for compare-and-swap, atomic audit, and durable uniqueness.
 */
export function assertInteractionSessionTransition(
  current: InteractionSession,
  next: InteractionSession,
): void {
  assertInteractionSessionInvariant(current);
  assertInteractionSessionInvariant(next);

  if (
    next.id !== current.id ||
    next.principalRef !== current.principalRef ||
    !sameInteractionProjectRef(next.projectRef, current.projectRef) ||
    !sameVersionedDigestRef(next.configuration, current.configuration) ||
    !sameVersionedDigestRef(next.routingPolicy, current.routingPolicy) ||
    !sameVersionedDigestRef(next.confirmationPolicy, current.confirmationPolicy) ||
    !sameVersionedDigestRef(next.retentionProfile, current.retentionProfile) ||
    next.openedAt !== current.openedAt
  ) {
    throw new DomainInvariantError('Interaction Session transition changed immutable authority');
  }
  if (next.version !== current.version + 1) {
    throw new DomainInvariantError(
      'Interaction Session transition must advance exactly one version',
    );
  }
  if (next.updatedAt < current.updatedAt) {
    throw new DomainInvariantError('Interaction Session transition time moved backwards');
  }
  if (
    current.state === InteractionSessionState.CLOSED ||
    current.state === InteractionSessionState.INTERRUPTED
  ) {
    throw new DomainInvariantError('A terminal Interaction Session cannot transition');
  }

  if (
    current.state === InteractionSessionState.CLOSING &&
    next.state !== InteractionSessionState.CLOSED &&
    next.state !== InteractionSessionState.INTERRUPTED
  ) {
    throw new DomainInvariantError('Interaction Session lifecycle transition is not allowed');
  }

  if (
    current.state === InteractionSessionState.OPEN &&
    next.state === InteractionSessionState.CLOSED &&
    next.terminalReason !== InteractionSessionTerminalReason.RETENTION_LIMIT_REACHED
  ) {
    throw new DomainInvariantError(
      'An open Interaction Session may close directly only at the retention limit',
    );
  }
  if (
    current.state === InteractionSessionState.CLOSING &&
    next.state === InteractionSessionState.CLOSED &&
    next.terminalReason !== undefined
  ) {
    throw new DomainInvariantError(
      'A gracefully closed Interaction Session cannot claim a retention-limit terminal reason',
    );
  }
  if (
    next.state !== InteractionSessionState.OPEN &&
    !sameOptionalDigestRef(next.currentFocusRef, current.currentFocusRef)
  ) {
    throw new DomainInvariantError(
      'Interaction Session focus cannot change during a lifecycle transition',
    );
  }
}

export function assertInteractionMessageInvariant(message: InteractionMessage): void {
  interactionMessageId(message.id);
  interactionSessionId(message.sessionId);
  principalId(message.principalRef);
  assertKnown(InteractionMessageRole, message.role, 'Interaction Message role');
  assertKnown(InteractionContentRetention, message.retention, 'Interaction content retention');
  sha256Digest(message.contentDigest);
  assertNonNegativeInteger(message.contentByteLength, 'Interaction content byte length');
  if (message.contentByteLength > INTERACTION_MAXIMUM_MESSAGE_BYTES) {
    throw new DomainInvariantError('Interaction Message exceeds its UTF-8 byte limit');
  }
  if (message.role !== InteractionMessageRole.USER) {
    interactionOperationId(message.causedByOperationRef.id);
    assertDigestRef(message.causedByOperationRef);
  }
  isoTimestamp(message.createdAt);
  sha256Digest(message.messageDigest);
  if (message.retention === InteractionContentRetention.RETAINED) {
    if (message.role === InteractionMessageRole.USER) {
      assertNonBlank(message.content, 'User Interaction Message content');
    }
    if (Buffer.byteLength(message.content, 'utf8') !== message.contentByteLength) {
      throw new DomainInvariantError('Retained Interaction Message byte length is invalid');
    }
  } else {
    assertKnown(
      InteractionContentOmissionReason,
      message.omissionReason,
      'Interaction content omission reason',
    );
  }
}

export interface InteractionUserMessageAdmission {
  readonly currentSession: InteractionSession;
  readonly message: InteractionMessage;
  readonly nextSession: InteractionSession;
  readonly retainedMessageCountBefore: number;
  readonly retainedContentBytesBefore: number;
}

export type InteractionUserMessageAdmissionBinding = Pick<
  InteractionUserMessageAdmission,
  'currentSession' | 'message' | 'nextSession'
>;

/** Owns the exact Session/Message relationship independently of Store totals. */
export function assertInteractionUserMessageAdmissionBinding(
  input: InteractionUserMessageAdmissionBinding,
): void {
  const { currentSession, message, nextSession } = input;
  assertInteractionSessionInvariant(currentSession);
  assertInteractionMessageInvariant(message);
  assertInteractionSessionTransition(currentSession, nextSession);

  if (
    currentSession.state !== InteractionSessionState.OPEN ||
    message.role !== InteractionMessageRole.USER ||
    message.retention !== InteractionContentRetention.RETAINED ||
    message.sessionId !== currentSession.id ||
    message.principalRef !== currentSession.principalRef ||
    message.createdAt < currentSession.updatedAt ||
    nextSession.updatedAt !== message.createdAt ||
    !sameOptionalDigestRef(nextSession.currentFocusRef, currentSession.currentFocusRef)
  ) {
    throw new DomainInvariantError(
      'Interaction user-message admission does not bind one current OPEN Session',
    );
  }
}

/**
 * Owns the aggregate meaning of admitting one user message. Store code remains
 * responsible for CAS, counting retained rows, and committing record plus audit
 * atomically.
 */
export function assertInteractionUserMessageAdmission(
  input: InteractionUserMessageAdmission,
): void {
  const { message, nextSession } = input;
  assertInteractionUserMessageAdmissionBinding(input);
  assertNonNegativeInteger(input.retainedMessageCountBefore, 'Retained Interaction Message count');
  assertNonNegativeInteger(
    input.retainedContentBytesBefore,
    'Retained Interaction Message content bytes',
  );

  const retainedMessageCountAfter = input.retainedMessageCountBefore + 1;
  const retainedContentBytesAfter = input.retainedContentBytesBefore + message.contentByteLength;
  if (
    retainedMessageCountAfter > INTERACTION_MAXIMUM_SESSION_MESSAGES ||
    retainedContentBytesAfter > INTERACTION_MAXIMUM_SESSION_CONTENT_BYTES
  ) {
    throw new DomainInvariantError('Interaction Session retention budget is exhausted');
  }
  const reachedRetentionLimit =
    retainedMessageCountAfter === INTERACTION_MAXIMUM_SESSION_MESSAGES ||
    retainedContentBytesAfter === INTERACTION_MAXIMUM_SESSION_CONTENT_BYTES;
  if (
    (reachedRetentionLimit &&
      (nextSession.state !== InteractionSessionState.CLOSED ||
        nextSession.terminalReason !== InteractionSessionTerminalReason.RETENTION_LIMIT_REACHED)) ||
    (!reachedRetentionLimit && nextSession.state !== InteractionSessionState.OPEN)
  ) {
    throw new DomainInvariantError(
      'Interaction Session retention-limit disposition does not match its retained totals',
    );
  }
}

export function assertFocusBindingInvariant(focus: FocusBinding): void {
  focusBindingId(focus.id);
  interactionSessionId(focus.sessionId);
  interactionSessionVersion(focus.basedOnSessionVersion);
  assertKnown(InteractionFocusKind, focus.kind, 'Interaction Focus kind');
  if (focus.kind === InteractionFocusKind.INTAKE_QUESTION) {
    assertInteractionQuestionTargetRefInvariant(focus.questionTarget);
  } else if (focus.kind === InteractionFocusKind.GOAL) {
    assertInteractionGoalTargetRefInvariant(focus.goalTarget);
  }
  isoTimestamp(focus.createdAt);
  sha256Digest(focus.focusDigest);
}

export interface InteractionFocusUpdate {
  readonly currentSession: InteractionSession;
  readonly focus: FocusBinding;
  readonly nextSession: InteractionSession;
}

/** Owns the exact Focus record installed by one Session version transition. */
export function assertInteractionFocusUpdate(input: InteractionFocusUpdate): void {
  const { currentSession, focus, nextSession } = input;
  assertInteractionSessionInvariant(currentSession);
  assertFocusBindingInvariant(focus);
  assertInteractionSessionTransition(currentSession, nextSession);

  if (
    currentSession.state !== InteractionSessionState.OPEN ||
    nextSession.state !== InteractionSessionState.OPEN ||
    focus.sessionId !== currentSession.id ||
    focus.basedOnSessionVersion !== currentSession.version ||
    focus.createdAt < currentSession.updatedAt ||
    nextSession.updatedAt !== focus.createdAt ||
    nextSession.currentFocusRef === undefined ||
    !sameDigestRef(nextSession.currentFocusRef, {
      id: focus.id,
      digest: focus.focusDigest,
    })
  ) {
    throw new DomainInvariantError(
      'Interaction Focus update does not bind the exact observed Session version',
    );
  }
}

const goalCandidateRoutes = new Set<FrontstageCandidateRoute>([
  FrontstageCandidateRoute.SHOW_GOAL,
  FrontstageCandidateRoute.START_GOAL,
  FrontstageCandidateRoute.RESUME_GOAL,
  FrontstageCandidateRoute.CANCEL_GOAL,
]);

const routeDecisionSourcesByOutcome = new Map<
  InteractionRouteDecisionOutcome,
  ReadonlySet<InteractionRouteDecisionSource>
>([
  [
    InteractionRouteDecisionOutcome.ANSWER,
    new Set([InteractionRouteDecisionSource.ASSISTANT_PROPOSAL]),
  ],
  [
    InteractionRouteDecisionOutcome.LIST_GOALS,
    new Set([
      InteractionRouteDecisionSource.READ_ONLY_GOAL_QUERY,
      InteractionRouteDecisionSource.ASSISTANT_PROPOSAL,
    ]),
  ],
  [
    InteractionRouteDecisionOutcome.SHOW_GOAL,
    new Set([
      InteractionRouteDecisionSource.READ_ONLY_GOAL_QUERY,
      InteractionRouteDecisionSource.ASSISTANT_PROPOSAL,
    ]),
  ],
  [
    InteractionRouteDecisionOutcome.CONTINUE_EXACT_INTAKE_QUESTION,
    new Set([InteractionRouteDecisionSource.EXACT_INTAKE_QUESTION]),
  ],
  [
    InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION,
    new Set([
      InteractionRouteDecisionSource.DIRECT_ACTION,
      InteractionRouteDecisionSource.ASSISTANT_PROPOSAL,
    ]),
  ],
  [
    InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL,
    new Set([
      InteractionRouteDecisionSource.DIRECT_ACTION,
      InteractionRouteDecisionSource.ASSISTANT_PROPOSAL,
    ]),
  ],
  [
    InteractionRouteDecisionOutcome.ASK_ROUTE_CLARIFICATION,
    new Set(Object.values(InteractionRouteDecisionSource)),
  ],
  [
    InteractionRouteDecisionOutcome.NO_ACTION,
    new Set([InteractionRouteDecisionSource.ASSISTANT_PROPOSAL]),
  ],
]);

export function assertRouteProposalInvariant(proposal: RouteProposal): void {
  routeProposalId(proposal.id);
  interactionSessionId(proposal.sessionId);
  interactionOperationId(proposal.operationId);
  interactionMessageId(proposal.messageRef.id);
  assertDigestRef(proposal.messageRef);
  frontstageContextManifestId(proposal.contextManifestRef.id);
  assertDigestRef(proposal.contextManifestRef);
  assertVersionedDigestRef(proposal.assistantProfile, 'Frontstage Assistant Profile');
  assertVersionedDigestRef(proposal.assistantAdapter, 'Frontstage Assistant Adapter');
  assertVersionedDigestRef(proposal.responseContract, 'Frontstage response contract');
  assertKnown(FrontstageProposalKind, proposal.kind, 'Frontstage Proposal kind');
  if (proposal.kind === FrontstageProposalKind.ANSWER_PROPOSAL) {
    assertNonBlank(proposal.answerContent, 'Frontstage answer proposal');
    assertUtf8ByteLimit(
      proposal.answerContent,
      INTERACTION_MAXIMUM_RETAINED_ANSWER_BYTES,
      'Frontstage answer proposal',
    );
  } else if (proposal.kind === FrontstageProposalKind.ROUTE_PROPOSAL) {
    assertKnown(FrontstageCandidateRoute, proposal.candidateRoute, 'Frontstage candidate route');
    assertKnown(FrontstageProposalAmbiguity, proposal.ambiguity, 'Frontstage ambiguity');
    assertUnique(proposal.candidateGoalIds, 'Frontstage candidate Goal IDs');
    if (proposal.candidateGoalIds.length > 4) {
      throw new DomainInvariantError('Frontstage Route Proposal has too many candidate Goal IDs');
    }
    proposal.candidateGoalIds.forEach(goalId);
    const goalRoute = goalCandidateRoutes.has(proposal.candidateRoute);
    if (!goalRoute && proposal.candidateGoalIds.length !== 0) {
      throw new DomainInvariantError('Non-Goal Frontstage route cannot carry candidate Goal IDs');
    }
    if (
      goalRoute &&
      proposal.ambiguity === FrontstageProposalAmbiguity.NONE &&
      proposal.candidateGoalIds.length !== 1
    ) {
      throw new DomainInvariantError('Unambiguous Goal route must carry one candidate Goal ID');
    }
    if (
      goalRoute &&
      proposal.ambiguity === FrontstageProposalAmbiguity.TARGET_AMBIGUOUS &&
      proposal.candidateGoalIds.length < 2
    ) {
      throw new DomainInvariantError('Ambiguous Goal route must carry at least two candidates');
    }
    if (proposal.explanationContent !== undefined) {
      assertNonBlank(proposal.explanationContent, 'Frontstage route explanation');
      assertUtf8ByteLimit(
        proposal.explanationContent,
        INTERACTION_MAXIMUM_CLARIFICATION_OR_EXPLANATION_BYTES,
        'Frontstage route explanation',
      );
    }
  } else if (proposal.kind === FrontstageProposalKind.CLARIFICATION_PROPOSAL) {
    assertKnown(FrontstageProposalAmbiguity, proposal.ambiguity, 'Frontstage ambiguity');
    assertNonBlank(proposal.questionContent, 'Frontstage clarification question');
    assertUtf8ByteLimit(
      proposal.questionContent,
      INTERACTION_MAXIMUM_CLARIFICATION_OR_EXPLANATION_BYTES,
      'Frontstage clarification question',
    );
  } else {
    assertKnown(FrontstageNoActionReason, proposal.reasonCode, 'Frontstage no-action reason');
  }
  isoTimestamp(proposal.observedAt);
  sha256Digest(proposal.proposalDigest);
}

export function assertRouteDecisionInvariant(decision: RouteDecision): void {
  routeDecisionId(decision.id);
  interactionSessionId(decision.sessionId);
  interactionSessionVersion(decision.expectedSessionVersion);
  interactionMessageId(decision.messageRef.id);
  assertDigestRef(decision.messageRef);
  if (decision.focusRef !== undefined) {
    focusBindingId(decision.focusRef.id);
    assertDigestRef(decision.focusRef);
  }
  if (decision.proposalRef !== undefined) {
    routeProposalId(decision.proposalRef.id);
    assertDigestRef(decision.proposalRef);
  }
  assertKnown(InteractionRouteDecisionSource, decision.source, 'Route Decision source');
  if (
    (decision.source === InteractionRouteDecisionSource.ASSISTANT_PROPOSAL) !==
    (decision.proposalRef !== undefined)
  ) {
    throw new DomainInvariantError(
      'Assistant Route Decision source and Proposal reference must be bound together',
    );
  }
  assertVersionedDigestRef(decision.routingPolicy, 'Interaction routing policy');
  assertUnique(decision.allowedRoutes, 'Allowed Interaction routes');
  decision.allowedRoutes.forEach((route) =>
    assertKnown(InteractionRouteDecisionOutcome, route, 'Allowed Interaction route'),
  );
  assertKnown(InteractionRouteDecisionOutcome, decision.outcome, 'Route Decision outcome');
  if (!decision.allowedRoutes.includes(decision.outcome)) {
    throw new DomainInvariantError('Route Decision outcome is outside its allowed route set');
  }
  if (decision.reasonTrace.length === 0) {
    throw new DomainInvariantError('Route Decision reason trace must not be empty');
  }
  decision.reasonTrace.forEach(assertInteractionPolicyTraceEntryInvariant);
  if (decision.reasonTrace.some((entry) => entry.policyDigest !== decision.routingPolicy.digest)) {
    throw new DomainInvariantError('Route Decision reason trace must bind its routing policy');
  }
  const allowedSources = routeDecisionSourcesByOutcome.get(decision.outcome);
  if (!allowedSources?.has(decision.source)) {
    throw new DomainInvariantError('Route Decision source cannot issue its selected outcome');
  }
  if (decision.outcome === InteractionRouteDecisionOutcome.ANSWER) {
    routeProposalId(decision.answerProposalRef.id);
    assertDigestRef(decision.answerProposalRef);
    if (
      decision.proposalRef?.id !== decision.answerProposalRef.id ||
      decision.proposalRef.digest !== decision.answerProposalRef.digest
    ) {
      throw new DomainInvariantError('Answer Route Decision must bind its Proposal');
    }
  } else if (decision.outcome === InteractionRouteDecisionOutcome.SHOW_GOAL) {
    assertInteractionGoalTargetRefInvariant(decision.goalTarget);
  } else if (decision.outcome === InteractionRouteDecisionOutcome.CONTINUE_EXACT_INTAKE_QUESTION) {
    assertInteractionQuestionTargetRefInvariant(decision.questionTarget);
  } else if (decision.outcome === InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL) {
    assertInteractionGoalTargetRefInvariant(decision.goalTarget);
  } else if (decision.outcome === InteractionRouteDecisionOutcome.ASK_ROUTE_CLARIFICATION) {
    assertKnown(FrontstageProposalAmbiguity, decision.ambiguity, 'Route Decision ambiguity');
  } else if (decision.outcome === InteractionRouteDecisionOutcome.NO_ACTION) {
    assertKnown(FrontstageNoActionReason, decision.reasonCode, 'Route Decision no-action reason');
  }
  isoTimestamp(decision.decidedAt);
  sha256Digest(decision.decisionDigest);
}

function expectedCapability(kind: PendingActionKind): InteractionPublicCapability {
  if (
    kind === PendingActionKind.SUBMIT_GOVERNED_INTAKE ||
    kind === PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE
  ) {
    return InteractionPublicCapability.SUBMIT_INTAKE;
  }
  if (kind === PendingActionKind.START_GOAL) {
    return InteractionPublicCapability.START_GOAL;
  }
  if (kind === PendingActionKind.RESUME_GOAL) {
    return InteractionPublicCapability.RESUME_GOAL;
  }
  return InteractionPublicCapability.CANCEL_GOAL;
}

export function assertPendingActionInvariant(action: PendingAction): void {
  pendingActionId(action.id);
  interactionSessionId(action.sessionId);
  principalId(action.principalRef);
  assertInteractionProjectRefInvariant(action.projectRef);
  interactionMessageId(action.originatingMessageRef.id);
  assertDigestRef(action.originatingMessageRef);
  routeDecisionId(action.routeDecisionRef.id);
  assertDigestRef(action.routeDecisionRef);
  if (action.focusRef !== undefined) {
    focusBindingId(action.focusRef.id);
    assertDigestRef(action.focusRef);
  }
  assertKnown(PendingActionKind, action.kind, 'Pending Action kind');
  assertKnown(PendingActionDerivation, action.actionDerivation, 'Pending Action derivation');
  commandId(action.preallocatedCommandId);
  sha256Digest(action.canonicalCommandInputDigest);
  assertKnown(InteractionPublicCapability, action.publicCapability, 'Interaction capability');
  if (action.publicCapability !== expectedCapability(action.kind)) {
    throw new DomainInvariantError('Pending Action kind and public capability do not match');
  }
  if ('goalTarget' in action) {
    assertInteractionGoalTargetRefInvariant(action.goalTarget);
  }
  assertVersionedDigestRef(action.routingPolicy, 'Pending Action routing policy');
  assertVersionedDigestRef(action.confirmationPolicy, 'Pending Action confirmation policy');
  assertKnown(
    InteractionConfirmationRequirement,
    action.confirmationRequirement,
    'Pending Action confirmation requirement',
  );
  if (
    action.kind === PendingActionKind.CANCEL_GOAL &&
    action.confirmationRequirement !== InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED
  ) {
    throw new DomainInvariantError('Cancel Goal must require a separate confirmation response');
  }
  if (action.reasonTrace.length === 0) {
    throw new DomainInvariantError('Pending Action reason trace must not be empty');
  }
  action.reasonTrace.forEach(assertInteractionPolicyTraceEntryInvariant);
  isoTimestamp(action.expiresAt);
  isoTimestamp(action.createdAt);
  if (action.expiresAt <= action.createdAt) {
    throw new DomainInvariantError('Pending Action expiration must follow creation');
  }
  sha256Digest(action.pendingActionDigest);
}

export function assertPendingActionResolutionInvariant(resolution: PendingActionResolution): void {
  pendingActionResolutionId(resolution.id);
  pendingActionId(resolution.pendingActionRef.id);
  assertDigestRef(resolution.pendingActionRef);
  assertVersionedDigestRef(resolution.confirmationPolicy, 'Resolution confirmation policy');
  assertKnown(
    PendingActionResolutionDisposition,
    resolution.disposition,
    'Pending Action Resolution disposition',
  );
  if (resolution.disposition === PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED) {
    interactionMessageId(resolution.authorizingMessageRef.id);
    assertDigestRef(resolution.authorizingMessageRef);
  } else if (
    resolution.disposition === PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
  ) {
    interactionMessageId(resolution.originatingMessageRef.id);
    interactionMessageId(resolution.authorizingMessageRef.id);
    assertDigestRef(resolution.originatingMessageRef);
    assertDigestRef(resolution.authorizingMessageRef);
    if (resolution.originatingMessageRef.id === resolution.authorizingMessageRef.id) {
      throw new DomainInvariantError('Separate confirmation requires two distinct user messages');
    }
  } else if (
    resolution.disposition === PendingActionResolutionDisposition.DECLINED ||
    resolution.disposition === PendingActionResolutionDisposition.UNCLEAR
  ) {
    interactionMessageId(resolution.responseMessageRef.id);
    assertDigestRef(resolution.responseMessageRef);
  }
  isoTimestamp(resolution.resolvedAt);
  sha256Digest(resolution.resolutionDigest);
}

export function assertInteractionActionReservationInvariant(
  reservation: InteractionActionReservation,
): void {
  interactionActionReservationId(reservation.id);
  pendingActionId(reservation.pendingActionRef.id);
  pendingActionResolutionId(reservation.resolutionRef.id);
  assertDigestRef(reservation.pendingActionRef);
  assertDigestRef(reservation.resolutionRef);
  assertKnown(InteractionPublicCapability, reservation.publicCapability, 'Interaction capability');
  commandId(reservation.commandId);
  sha256Digest(reservation.canonicalCommandInputDigest);
  isoTimestamp(reservation.reservedAt);
  sha256Digest(reservation.reservationDigest);
}

export function assertInteractionActionOutcomeInvariant(outcome: InteractionActionOutcome): void {
  interactionActionOutcomeId(outcome.id);
  interactionActionReservationId(outcome.reservationRef.id);
  assertDigestRef(outcome.reservationRef);
  commandId(outcome.commandId);
  sha256Digest(outcome.canonicalCommandInputDigest);
  assertKnown(
    InteractionActionOutcomeDisposition,
    outcome.disposition,
    'Interaction Action Outcome disposition',
  );
  sha256Digest(outcome.publicCommandOutcomeDigest);
  sha256Digest(outcome.resultProjectionDigest);
  isoTimestamp(outcome.completedAt);
  sha256Digest(outcome.outcomeDigest);
}

function sameDigestRef<Id extends string>(
  left: InteractionDigestRef<Id>,
  right: InteractionDigestRef<Id>,
): boolean {
  return left.id === right.id && left.digest === right.digest;
}

function sameOptionalDigestRef<Id extends string>(
  left: InteractionDigestRef<Id> | undefined,
  right: InteractionDigestRef<Id> | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && sameDigestRef(left, right);
}

function sameGoalTarget(left: InteractionGoalTargetRef, right: InteractionGoalTargetRef): boolean {
  return (
    left.goalId === right.goalId &&
    left.goalRevision === right.goalRevision &&
    left.workflowId === right.workflowId &&
    left.workflowVersion === right.workflowVersion
  );
}

function samePolicyTrace(
  left: InteractionPolicyTraceEntry,
  right: InteractionPolicyTraceEntry,
): boolean {
  return (
    left.ruleId === right.ruleId &&
    left.policyDigest === right.policyDigest &&
    left.outcome === right.outcome &&
    left.inputDigests.length === right.inputDigests.length &&
    left.inputDigests.every((digest, index) => digest === right.inputDigests[index])
  );
}

function isAuthorizedResolution(resolution: PendingActionResolution): boolean {
  return (
    resolution.disposition === PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED ||
    resolution.disposition === PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
  );
}

/**
 * Checks one immutable action-chain snapshot. Store uniqueness and atomicity
 * remain persistence concerns; this function owns the cross-record meaning.
 */
export function assertInteractionActionChainInvariant(chain: InteractionActionChain): void {
  const {
    originatingMessage,
    resolutionMessage,
    routeDecision,
    pendingAction,
    resolution,
    reservation,
    outcome,
    handoff,
  } = chain;
  assertInteractionMessageInvariant(originatingMessage);
  assertRouteDecisionInvariant(routeDecision);
  assertPendingActionInvariant(pendingAction);
  assertPendingActionResolutionInvariant(resolution);
  if (
    originatingMessage.role !== InteractionMessageRole.USER ||
    originatingMessage.retention !== InteractionContentRetention.RETAINED ||
    originatingMessage.sessionId !== pendingAction.sessionId ||
    originatingMessage.principalRef !== pendingAction.principalRef ||
    !sameDigestRef(pendingAction.originatingMessageRef, {
      id: originatingMessage.id,
      digest: originatingMessage.messageDigest,
    })
  ) {
    throw new DomainInvariantError('Pending Action must bind its exact retained user message');
  }
  if (
    pendingAction.reasonTrace.length <= routeDecision.reasonTrace.length ||
    !routeDecision.reasonTrace.every((entry, index) => {
      const actionTraceEntry = pendingAction.reasonTrace[index];
      return actionTraceEntry !== undefined && samePolicyTrace(entry, actionTraceEntry);
    })
  ) {
    throw new DomainInvariantError(
      'Pending Action reason trace must preserve its Route Decision trace and add authorization policy trace',
    );
  }
  const authorizationTrace = pendingAction.reasonTrace.slice(routeDecision.reasonTrace.length);
  if (
    authorizationTrace.some(
      (entry) => entry.policyDigest !== pendingAction.confirmationPolicy.digest,
    )
  ) {
    throw new DomainInvariantError(
      'Pending Action authorization trace must bind its confirmation policy',
    );
  }
  if (
    routeDecision.sessionId !== pendingAction.sessionId ||
    !sameDigestRef(routeDecision.messageRef, pendingAction.originatingMessageRef) ||
    !sameDigestRef(pendingAction.routeDecisionRef, {
      id: routeDecision.id,
      digest: routeDecision.decisionDigest,
    }) ||
    !sameOptionalDigestRef(routeDecision.focusRef, pendingAction.focusRef) ||
    routeDecision.routingPolicy.id !== pendingAction.routingPolicy.id ||
    routeDecision.routingPolicy.version !== pendingAction.routingPolicy.version ||
    routeDecision.routingPolicy.digest !== pendingAction.routingPolicy.digest
  ) {
    throw new DomainInvariantError('Pending Action must bind its exact Route Decision authority');
  }
  if (routeDecision.decidedAt < originatingMessage.createdAt) {
    throw new DomainInvariantError('Route Decision cannot precede its originating message');
  }
  if (pendingAction.createdAt < routeDecision.decidedAt) {
    throw new DomainInvariantError('Pending Action cannot precede its Route Decision');
  }
  if (
    pendingAction.kind === PendingActionKind.SUBMIT_GOVERNED_INTAKE ||
    pendingAction.kind === PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE
  ) {
    const routedActionMatches =
      pendingAction.actionDerivation === PendingActionDerivation.ROUTED_ACTION &&
      routeDecision.outcome === InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION &&
      routeDecision.actionKind === pendingAction.kind;
    const busyGovernedAlternativeMatches =
      pendingAction.actionDerivation ===
        PendingActionDerivation.BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE &&
      routeDecision.outcome === InteractionRouteDecisionOutcome.PROPOSE_INTAKE_ACTION &&
      routeDecision.actionKind === PendingActionKind.SUBMIT_GOVERNED_INTAKE &&
      pendingAction.kind === PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE &&
      pendingAction.confirmationRequirement ===
        InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED;
    if (!routedActionMatches && !busyGovernedAlternativeMatches) {
      throw new DomainInvariantError('Intake Action kind must match its Route Decision');
    }
  } else if (
    pendingAction.actionDerivation !== PendingActionDerivation.ROUTED_ACTION ||
    routeDecision.outcome !== InteractionRouteDecisionOutcome.PROPOSE_GOAL_CONTROL ||
    routeDecision.actionKind !== pendingAction.kind ||
    !sameGoalTarget(routeDecision.goalTarget, pendingAction.goalTarget)
  ) {
    throw new DomainInvariantError('Goal Action target must match its Route Decision');
  }
  if (
    routeDecision.source === InteractionRouteDecisionSource.ASSISTANT_PROPOSAL &&
    pendingAction.confirmationRequirement !==
      InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED
  ) {
    throw new DomainInvariantError('Assistant-proposed Action must require a separate response');
  }
  if (
    !sameDigestRef(resolution.pendingActionRef, {
      id: pendingAction.id,
      digest: pendingAction.pendingActionDigest,
    }) ||
    resolution.confirmationPolicy.id !== pendingAction.confirmationPolicy.id ||
    resolution.confirmationPolicy.version !== pendingAction.confirmationPolicy.version ||
    resolution.confirmationPolicy.digest !== pendingAction.confirmationPolicy.digest
  ) {
    throw new DomainInvariantError(
      'Pending Action Resolution must bind its exact Action and policy',
    );
  }
  if (resolution.resolvedAt < pendingAction.createdAt) {
    throw new DomainInvariantError('Pending Action Resolution cannot precede Action creation');
  }
  const messageResolvedDisposition =
    resolution.disposition === PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED ||
    resolution.disposition === PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED ||
    resolution.disposition === PendingActionResolutionDisposition.DECLINED ||
    resolution.disposition === PendingActionResolutionDisposition.UNCLEAR;
  if (messageResolvedDisposition && resolution.resolvedAt >= pendingAction.expiresAt) {
    throw new DomainInvariantError('A user response cannot resolve an expired Pending Action');
  }
  if (
    resolution.disposition === PendingActionResolutionDisposition.EXPIRED &&
    resolution.resolvedAt < pendingAction.expiresAt
  ) {
    throw new DomainInvariantError(
      'An unexpired Pending Action cannot receive an expired Resolution',
    );
  }
  if (
    resolution.disposition === PendingActionResolutionDisposition.DIRECT_USER_AUTHORIZED &&
    (pendingAction.confirmationRequirement !==
      InteractionConfirmationRequirement.DIRECT_USER_MESSAGE_SUFFICIENT ||
      !sameDigestRef(resolution.authorizingMessageRef, pendingAction.originatingMessageRef) ||
      routeDecision.source !== InteractionRouteDecisionSource.DIRECT_ACTION)
  ) {
    throw new DomainInvariantError('Direct authorization must bind the originating direct Action');
  }
  if (
    resolution.disposition === PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED &&
    (pendingAction.confirmationRequirement !==
      InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED ||
      !sameDigestRef(resolution.originatingMessageRef, pendingAction.originatingMessageRef))
  ) {
    throw new DomainInvariantError('Separate authorization must bind the originating gated Action');
  }
  const responseMessageRef =
    resolution.disposition === PendingActionResolutionDisposition.SEPARATE_RESPONSE_CONFIRMED
      ? resolution.authorizingMessageRef
      : resolution.disposition === PendingActionResolutionDisposition.DECLINED ||
          resolution.disposition === PendingActionResolutionDisposition.UNCLEAR
        ? resolution.responseMessageRef
        : undefined;
  if (
    responseMessageRef !== undefined &&
    pendingAction.confirmationRequirement !==
      InteractionConfirmationRequirement.SEPARATE_RESPONSE_REQUIRED
  ) {
    throw new DomainInvariantError(
      'A response Resolution requires an Action with separate confirmation',
    );
  }
  if (responseMessageRef === undefined) {
    if (resolutionMessage !== undefined) {
      throw new DomainInvariantError('A response-free Resolution cannot bind another message');
    }
  } else {
    if (resolutionMessage === undefined) {
      throw new DomainInvariantError('A user-response Resolution must include its exact message');
    }
    assertInteractionMessageInvariant(resolutionMessage);
    if (
      resolutionMessage.role !== InteractionMessageRole.USER ||
      resolutionMessage.retention !== InteractionContentRetention.RETAINED ||
      resolutionMessage.sessionId !== pendingAction.sessionId ||
      resolutionMessage.principalRef !== pendingAction.principalRef ||
      !sameDigestRef(responseMessageRef, {
        id: resolutionMessage.id,
        digest: resolutionMessage.messageDigest,
      })
    ) {
      throw new DomainInvariantError(
        'Pending Action response must bind one exact retained user message from the same principal and Session',
      );
    }
    if (resolutionMessage.createdAt > resolution.resolvedAt) {
      throw new DomainInvariantError(
        'Pending Action Resolution cannot precede its authorizing response message',
      );
    }
    if (resolutionMessage.createdAt < pendingAction.createdAt) {
      throw new DomainInvariantError(
        'Pending Action response message cannot precede Action creation',
      );
    }
  }
  if (!isAuthorizedResolution(resolution) && reservation !== undefined) {
    throw new DomainInvariantError('A non-authorized Resolution cannot have an Action Reservation');
  }
  if (reservation === undefined) {
    if (outcome !== undefined || handoff !== undefined) {
      throw new DomainInvariantError('Action Outcome or handoff requires an Action Reservation');
    }
    return;
  }

  assertInteractionActionReservationInvariant(reservation);
  if (reservation.reservedAt < resolution.resolvedAt) {
    throw new DomainInvariantError('Action Reservation cannot precede its Resolution');
  }
  if (
    !sameDigestRef(reservation.pendingActionRef, resolution.pendingActionRef) ||
    !sameDigestRef(reservation.resolutionRef, {
      id: resolution.id,
      digest: resolution.resolutionDigest,
    }) ||
    reservation.publicCapability !== pendingAction.publicCapability ||
    reservation.commandId !== pendingAction.preallocatedCommandId ||
    reservation.canonicalCommandInputDigest !== pendingAction.canonicalCommandInputDigest
  ) {
    throw new DomainInvariantError('Action Reservation must bind the exact authorized Action');
  }
  if (outcome !== undefined) {
    assertInteractionActionOutcomeInvariant(outcome);
    if (outcome.completedAt < reservation.reservedAt) {
      throw new DomainInvariantError('Action Outcome cannot precede its Reservation');
    }
    if (
      !sameDigestRef(outcome.reservationRef, {
        id: reservation.id,
        digest: reservation.reservationDigest,
      }) ||
      outcome.commandId !== reservation.commandId ||
      outcome.canonicalCommandInputDigest !== reservation.canonicalCommandInputDigest
    ) {
      throw new DomainInvariantError('Action Outcome must bind the exact Reservation');
    }
  }
  if (
    outcome !== undefined &&
    pendingAction.publicCapability === InteractionPublicCapability.SUBMIT_INTAKE &&
    handoff === undefined
  ) {
    throw new DomainInvariantError('An Intake Action Outcome requires its exact message handoff');
  }
  if (handoff !== undefined) {
    assertInteractionMessageHandoffInvariant(handoff);
    if (handoff.createdAt < reservation.reservedAt) {
      throw new DomainInvariantError('Intake handoff cannot precede its Action Reservation');
    }
    if (outcome !== undefined && handoff.createdAt > outcome.completedAt) {
      throw new DomainInvariantError('Intake handoff cannot follow its Action Outcome');
    }
    if (
      pendingAction.publicCapability !== InteractionPublicCapability.SUBMIT_INTAKE ||
      handoff.sessionId !== pendingAction.sessionId ||
      !sameDigestRef(handoff.messageRef, pendingAction.originatingMessageRef) ||
      !sameDigestRef(handoff.pendingActionRef, resolution.pendingActionRef) ||
      !sameDigestRef(handoff.resolutionRef, reservation.resolutionRef) ||
      !sameDigestRef(handoff.reservationRef, {
        id: reservation.id,
        digest: reservation.reservationDigest,
      }) ||
      handoff.intakeCommandId !== reservation.commandId ||
      handoff.admittedUserContent !== originatingMessage.content ||
      handoff.admittedContentDigest !== originatingMessage.contentDigest
    ) {
      throw new DomainInvariantError(
        'Intake handoff must preserve the exact authorized user message',
      );
    }
  }
}

export function assertFrontstageAnswerChainInvariant(chain: FrontstageAnswerChain): void {
  const {
    session,
    originatingMessage,
    routeOperation,
    proposal,
    routeDecision,
    answer,
    answerOperation,
  } = chain;
  assertInteractionSessionInvariant(session);
  assertInteractionMessageInvariant(originatingMessage);
  assertInteractionOperationInvariant(routeOperation);
  assertRouteProposalInvariant(proposal);
  assertRouteDecisionInvariant(routeDecision);
  assertFrontstageAnswerInvariant(answer);
  assertInteractionOperationInvariant(answerOperation);
  if (
    routeOperation.operationKind !== InteractionOperationKind.ROUTE ||
    routeOperation.result.kind !== InteractionOperationResultKind.ROUTE_DECIDED
  ) {
    throw new DomainInvariantError('Frontstage Answer must bind one completed Route Operation');
  }
  if (
    answerOperation.operationKind !== InteractionOperationKind.FRONTSTAGE_ANSWER ||
    answerOperation.result.kind !== InteractionOperationResultKind.ANSWER_RECORDED
  ) {
    throw new DomainInvariantError('Frontstage Answer must bind one completed Answer Operation');
  }
  if (
    session.id !== originatingMessage.sessionId ||
    session.principalRef !== originatingMessage.principalRef ||
    originatingMessage.role !== InteractionMessageRole.USER ||
    originatingMessage.retention !== InteractionContentRetention.RETAINED ||
    originatingMessage.sessionId !== proposal.sessionId ||
    !sameDigestRef(proposal.messageRef, {
      id: originatingMessage.id,
      digest: originatingMessage.messageDigest,
    }) ||
    proposal.kind !== FrontstageProposalKind.ANSWER_PROPOSAL ||
    proposal.operationId !== routeOperation.id ||
    routeOperation.sessionId !== session.id ||
    !sameDigestRef(routeOperation.messageRef, proposal.messageRef) ||
    routeOperation.expectedSessionVersion !== routeDecision.expectedSessionVersion ||
    routeOperation.contextManifestRef === undefined ||
    !sameDigestRef(routeOperation.contextManifestRef, proposal.contextManifestRef) ||
    routeOperation.assistantProfile?.id !== proposal.assistantProfile.id ||
    routeOperation.assistantProfile.version !== proposal.assistantProfile.version ||
    routeOperation.assistantProfile.digest !== proposal.assistantProfile.digest ||
    !sameDigestRef(routeOperation.result.routeDecisionRef, {
      id: routeDecision.id,
      digest: routeDecision.decisionDigest,
    }) ||
    routeOperation.result.routeProposalRef === undefined ||
    !sameDigestRef(routeOperation.result.routeProposalRef, {
      id: proposal.id,
      digest: proposal.proposalDigest,
    }) ||
    routeDecision.outcome !== InteractionRouteDecisionOutcome.ANSWER ||
    routeDecision.sessionId !== proposal.sessionId ||
    !sameDigestRef(routeDecision.messageRef, proposal.messageRef) ||
    routeDecision.proposalRef === undefined ||
    !sameDigestRef(routeDecision.proposalRef, {
      id: proposal.id,
      digest: proposal.proposalDigest,
    }) ||
    answer.sessionId !== proposal.sessionId ||
    !sameDigestRef(answer.originatingMessageRef, proposal.messageRef) ||
    !sameDigestRef(answer.routeDecisionRef, {
      id: routeDecision.id,
      digest: routeDecision.decisionDigest,
    }) ||
    !sameDigestRef(answer.proposalRef, routeDecision.answerProposalRef) ||
    answer.assistantProfile.id !== proposal.assistantProfile.id ||
    answer.assistantProfile.version !== proposal.assistantProfile.version ||
    answer.assistantProfile.digest !== proposal.assistantProfile.digest ||
    answer.responseContract.id !== proposal.responseContract.id ||
    answer.responseContract.version !== proposal.responseContract.version ||
    answer.responseContract.digest !== proposal.responseContract.digest ||
    answer.retentionProfile.id !== session.retentionProfile.id ||
    answer.retentionProfile.version !== session.retentionProfile.version ||
    answer.retentionProfile.digest !== session.retentionProfile.digest ||
    answer.answerContent !== proposal.answerContent ||
    answerOperation.id === routeOperation.id ||
    answerOperation.sessionId !== session.id ||
    !sameDigestRef(answerOperation.messageRef, proposal.messageRef) ||
    !sameDigestRef(answerOperation.result.answerRef, {
      id: answer.id,
      digest: answer.answerDigest,
    })
  ) {
    throw new DomainInvariantError('Frontstage Answer must bind one exact Answer Proposal chain');
  }
  if (
    session.openedAt > originatingMessage.createdAt ||
    originatingMessage.createdAt > routeOperation.reservedAt ||
    routeOperation.reservedAt > proposal.observedAt ||
    proposal.observedAt > routeDecision.decidedAt ||
    routeDecision.decidedAt > routeOperation.completedAt ||
    routeOperation.completedAt > answerOperation.reservedAt ||
    answerOperation.reservedAt > answer.createdAt ||
    answer.createdAt > answerOperation.completedAt
  ) {
    throw new DomainInvariantError('Frontstage Answer chain has invalid causal ordering');
  }
}

export function assertInteractionMessageHandoffInvariant(handoff: InteractionMessageHandoff): void {
  interactionMessageHandoffId(handoff.id);
  interactionSessionId(handoff.sessionId);
  interactionMessageId(handoff.messageRef.id);
  pendingActionId(handoff.pendingActionRef.id);
  pendingActionResolutionId(handoff.resolutionRef.id);
  interactionActionReservationId(handoff.reservationRef.id);
  assertDigestRef(handoff.messageRef);
  assertDigestRef(handoff.pendingActionRef);
  assertDigestRef(handoff.resolutionRef);
  assertDigestRef(handoff.reservationRef);
  assertNonBlank(handoff.admittedUserContent, 'Interaction handoff content');
  assertUtf8ByteLimit(
    handoff.admittedUserContent,
    INTERACTION_MAXIMUM_MESSAGE_BYTES,
    'Interaction handoff content',
  );
  sha256Digest(handoff.admittedContentDigest);
  commandId(handoff.intakeCommandId);
  isoTimestamp(handoff.createdAt);
  sha256Digest(handoff.handoffDigest);
}

export function assertFrontstageAnswerInvariant(answer: FrontstageAnswer): void {
  frontstageAnswerId(answer.id);
  interactionSessionId(answer.sessionId);
  interactionMessageId(answer.originatingMessageRef.id);
  routeDecisionId(answer.routeDecisionRef.id);
  routeProposalId(answer.proposalRef.id);
  assertDigestRef(answer.originatingMessageRef);
  assertDigestRef(answer.routeDecisionRef);
  assertDigestRef(answer.proposalRef);
  assertVersionedDigestRef(answer.assistantProfile, 'Frontstage Answer Assistant Profile');
  assertVersionedDigestRef(answer.responseContract, 'Frontstage Answer response contract');
  assertVersionedDigestRef(answer.retentionProfile, 'Frontstage Answer retention profile');
  assertNonBlank(answer.answerContent, 'Frontstage Answer content');
  assertUtf8ByteLimit(
    answer.answerContent,
    INTERACTION_MAXIMUM_RETAINED_ANSWER_BYTES,
    'Frontstage Answer content',
  );
  sha256Digest(answer.answerContentDigest);
  isoTimestamp(answer.createdAt);
  sha256Digest(answer.answerDigest);
}

const resultKindForOperation = new Map<InteractionOperationKind, InteractionOperationResultKind>([
  [InteractionOperationKind.ROUTE, InteractionOperationResultKind.ROUTE_DECIDED],
  [InteractionOperationKind.FRONTSTAGE_ANSWER, InteractionOperationResultKind.ANSWER_RECORDED],
  [InteractionOperationKind.GOAL_LIST, InteractionOperationResultKind.GOAL_VIEW_RECORDED],
  [InteractionOperationKind.GOAL_STATUS, InteractionOperationResultKind.GOAL_VIEW_RECORDED],
  [InteractionOperationKind.INTAKE_HANDOFF, InteractionOperationResultKind.INTAKE_HANDOFF_RECORDED],
  [
    InteractionOperationKind.INTAKE_CLARIFICATION,
    InteractionOperationResultKind.PUBLIC_COMMAND_RECORDED,
  ],
  [
    InteractionOperationKind.ACTION_PROPOSAL,
    InteractionOperationResultKind.PENDING_ACTION_RECORDED,
  ],
  [
    InteractionOperationKind.ACTION_CONFIRMATION,
    InteractionOperationResultKind.ACTION_RESOLUTION_RECORDED,
  ],
  [InteractionOperationKind.RESULT_PROJECTION, InteractionOperationResultKind.RESULT_PROJECTED],
]);

function assertInteractionOperationResultInvariant(result: InteractionOperationResult): void {
  assertKnown(InteractionOperationResultKind, result.kind, 'Interaction Operation result kind');
  if (result.kind === InteractionOperationResultKind.ROUTE_DECIDED) {
    routeDecisionId(result.routeDecisionRef.id);
    assertDigestRef(result.routeDecisionRef);
    if (result.routeProposalRef !== undefined) {
      routeProposalId(result.routeProposalRef.id);
      assertDigestRef(result.routeProposalRef);
    }
  } else if (result.kind === InteractionOperationResultKind.ANSWER_RECORDED) {
    frontstageAnswerId(result.answerRef.id);
    assertDigestRef(result.answerRef);
  } else if (
    result.kind === InteractionOperationResultKind.GOAL_VIEW_RECORDED ||
    result.kind === InteractionOperationResultKind.RESULT_PROJECTED
  ) {
    sha256Digest(result.projectionDigest);
  } else if (result.kind === InteractionOperationResultKind.INTAKE_HANDOFF_RECORDED) {
    interactionMessageHandoffId(result.handoffRef.id);
    assertDigestRef(result.handoffRef);
  } else if (result.kind === InteractionOperationResultKind.PUBLIC_COMMAND_RECORDED) {
    commandId(result.commandId);
    sha256Digest(result.publicCommandOutcomeDigest);
  } else if (result.kind === InteractionOperationResultKind.PENDING_ACTION_RECORDED) {
    pendingActionId(result.pendingActionRef.id);
    assertDigestRef(result.pendingActionRef);
  } else {
    pendingActionResolutionId(result.resolutionRef.id);
    assertDigestRef(result.resolutionRef);
    if (result.reservationRef !== undefined) {
      interactionActionReservationId(result.reservationRef.id);
      assertDigestRef(result.reservationRef);
    }
  }
}

export function assertInteractionOperationInvariant(operation: InteractionOperation): void {
  interactionOperationId(operation.id);
  interactionOperationVersion(operation.version);
  interactionSessionId(operation.sessionId);
  interactionSessionVersion(operation.expectedSessionVersion);
  interactionMessageId(operation.messageRef.id);
  assertDigestRef(operation.messageRef);
  assertKnown(InteractionOperationKind, operation.operationKind, 'Interaction Operation kind');
  assertKnown(InteractionOperationState, operation.state, 'Interaction Operation state');
  if (operation.contextManifestRef !== undefined) {
    frontstageContextManifestId(operation.contextManifestRef.id);
    assertDigestRef(operation.contextManifestRef);
  }
  if (operation.assistantProfile !== undefined) {
    assertVersionedDigestRef(operation.assistantProfile, 'Interaction Operation Assistant Profile');
  }
  if ((operation.contextManifestRef === undefined) !== (operation.assistantProfile === undefined)) {
    throw new DomainInvariantError(
      'Interaction Operation Assistant Profile and Context Manifest must be bound together',
    );
  }
  if (
    operation.assistantProfile !== undefined &&
    operation.operationKind !== InteractionOperationKind.ROUTE
  ) {
    throw new DomainInvariantError('Only a Route Operation may bind Frontstage Assistant work');
  }
  isoTimestamp(operation.reservedAt);
  if (operation.state === InteractionOperationState.COMPLETED) {
    assertInteractionOperationResultInvariant(operation.result);
    if (resultKindForOperation.get(operation.operationKind) !== operation.result.kind) {
      throw new DomainInvariantError('Interaction Operation result does not match its kind');
    }
    isoTimestamp(operation.completedAt);
    if (operation.completedAt < operation.reservedAt) {
      throw new DomainInvariantError('Interaction Operation completion cannot precede reservation');
    }
  } else if (
    operation.state === InteractionOperationState.FAILED ||
    operation.state === InteractionOperationState.INTERRUPTED
  ) {
    const failureReason: InteractionOperationFailureReason = operation.failureReason;
    assertKnown(
      InteractionOperationFailureReason,
      failureReason,
      'Interaction Operation failure reason',
    );
    if (
      operation.state === InteractionOperationState.INTERRUPTED &&
      failureReason !== InteractionOperationFailureReason.INTERRUPTED
    ) {
      throw new DomainInvariantError('Interrupted Operation must use the interrupted reason');
    }
    if (
      operation.state === InteractionOperationState.FAILED &&
      failureReason === InteractionOperationFailureReason.INTERRUPTED
    ) {
      throw new DomainInvariantError('Failed Operation cannot use the interrupted reason');
    }
    isoTimestamp(operation.completedAt);
    if (operation.completedAt < operation.reservedAt) {
      throw new DomainInvariantError(
        'Interaction Operation terminal time cannot precede reservation',
      );
    }
  }
  sha256Digest(operation.operationDigest);
}

/**
 * Owns the creation shape of an Interaction Operation. External Assistant work
 * can enter persistence only as a reserved version-1 operation; deterministic
 * local bookkeeping may be committed terminally in one transaction.
 */
export function assertInitialInteractionOperationInvariant(operation: InteractionOperation): void {
  assertInteractionOperationInvariant(operation);
  if (operation.version !== 1) {
    throw new DomainInvariantError('An initial Interaction Operation must use version 1');
  }
  if (
    operation.assistantProfile !== undefined &&
    operation.state !== InteractionOperationState.RESERVED
  ) {
    throw new DomainInvariantError(
      'An Assistant-bound Interaction Operation must be reserved before terminalization',
    );
  }
  if (operation.state === InteractionOperationState.INTERRUPTED) {
    throw new DomainInvariantError(
      'An Interaction Operation cannot be created directly as interrupted',
    );
  }
}

export interface InteractionOperationReservationChain {
  readonly session: InteractionSession;
  readonly message: InteractionMessage;
  readonly operation: ReservedInteractionOperation;
}

/** Owns the Session and Message binding for one reserved operation. */
export function assertInteractionOperationReservationChain(
  chain: InteractionOperationReservationChain,
): void {
  const { session, message, operation } = chain;
  assertInteractionSessionInvariant(session);
  assertInteractionMessageInvariant(message);
  assertInitialInteractionOperationInvariant(operation);

  if (
    session.state !== InteractionSessionState.OPEN ||
    session.version <= 1 ||
    message.role !== InteractionMessageRole.USER ||
    message.retention !== InteractionContentRetention.RETAINED ||
    operation.sessionId !== session.id ||
    operation.expectedSessionVersion !== session.version ||
    message.sessionId !== session.id ||
    message.principalRef !== session.principalRef ||
    !sameDigestRef(operation.messageRef, {
      id: message.id,
      digest: message.messageDigest,
    }) ||
    message.createdAt !== session.updatedAt ||
    operation.reservedAt < message.createdAt ||
    operation.reservedAt < session.updatedAt
  ) {
    throw new DomainInvariantError(
      'Interaction Operation reservation does not bind the exact current Session and Message',
    );
  }
}

/**
 * Owns the only legal Interaction Operation transition. A reserved operation
 * may terminalize exactly once; replay and transaction atomicity remain Store
 * responsibilities.
 */
export function assertInteractionOperationTransition(
  current: InteractionOperation,
  next: InteractionOperation,
): void {
  assertInteractionOperationInvariant(current);
  assertInteractionOperationInvariant(next);

  if (current.state !== InteractionOperationState.RESERVED) {
    throw new DomainInvariantError('A terminal Interaction Operation cannot transition');
  }
  if (next.state === InteractionOperationState.RESERVED) {
    throw new DomainInvariantError('An Interaction Operation transition must terminalize');
  }
  if (next.version !== current.version + 1) {
    throw new DomainInvariantError(
      'Interaction Operation transition must advance exactly one version',
    );
  }
  if (
    next.id !== current.id ||
    next.sessionId !== current.sessionId ||
    next.expectedSessionVersion !== current.expectedSessionVersion ||
    !sameDigestRef(next.messageRef, current.messageRef) ||
    next.operationKind !== current.operationKind ||
    !sameOptionalDigestRef(next.contextManifestRef, current.contextManifestRef) ||
    (next.assistantProfile === undefined) !== (current.assistantProfile === undefined) ||
    (next.assistantProfile !== undefined &&
      current.assistantProfile !== undefined &&
      !sameVersionedDigestRef(next.assistantProfile, current.assistantProfile)) ||
    next.reservedAt !== current.reservedAt
  ) {
    throw new DomainInvariantError('Interaction Operation transition changed reserved authority');
  }
}

export type InteractionOperationReservationProjection = Omit<
  ReservedInteractionOperation,
  'operationDigest'
>;

/**
 * Owns reconstruction of the immutable version-1 reservation represented by
 * a reservation or its one legal terminal successor. Persistence may hash
 * this projection for replay and audit validation but must not redefine the
 * reservation fields or invent a reservation for an initially terminal local
 * Operation.
 */
export function interactionOperationReservationProjection(
  operation: InteractionOperation,
): InteractionOperationReservationProjection {
  assertInteractionOperationInvariant(operation);
  if (operation.state === InteractionOperationState.RESERVED) {
    assertInitialInteractionOperationInvariant(operation);
  } else if (operation.version !== 2) {
    throw new DomainInvariantError(
      'A terminal Interaction Operation represents a prior reservation only at version 2',
    );
  }
  return Object.freeze({
    id: operation.id,
    schemaVersion: operation.schemaVersion,
    version: interactionOperationVersion(1),
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
    state: InteractionOperationState.RESERVED,
    reservedAt: operation.reservedAt,
  });
}

export type InteractionSessionProjectionInput =
  | Omit<NonTerminalInteractionSession, 'sessionDigest'>
  | Omit<ClosedInteractionSession, 'sessionDigest'>
  | Omit<InterruptedInteractionSession, 'sessionDigest'>;
function projectionWithout(record: object, excludedField: string): unknown {
  const projection: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== excludedField) {
      projection[key] = value;
    }
  }
  return projection;
}

export function interactionSessionProjection(record: InteractionSessionProjectionInput): unknown {
  return projectionWithout(record, 'sessionDigest');
}

export type InteractionMessageProjectionInput =
  | Omit<RetainedInteractionMessage, 'messageDigest'>
  | Omit<OmittedInteractionMessage, 'messageDigest'>;
export function interactionMessageProjection(record: InteractionMessageProjectionInput): unknown {
  return projectionWithout(record, 'messageDigest');
}

export type FocusBindingProjectionInput =
  | Omit<NoFocusBinding, 'focusDigest'>
  | Omit<IntakeQuestionFocusBinding, 'focusDigest'>
  | Omit<GoalFocusBinding, 'focusDigest'>;
export function focusBindingProjection(record: FocusBindingProjectionInput): unknown {
  return projectionWithout(record, 'focusDigest');
}

export type RouteProposalProjectionInput =
  | Omit<AnswerRouteProposal, 'proposalDigest'>
  | Omit<CandidateRouteProposal, 'proposalDigest'>
  | Omit<ClarificationRouteProposal, 'proposalDigest'>
  | Omit<NoActionRouteProposal, 'proposalDigest'>;
export function routeProposalProjection(record: RouteProposalProjectionInput): unknown {
  return projectionWithout(record, 'proposalDigest');
}

export type RouteDecisionProjectionInput =
  | Omit<AnswerRouteDecision, 'decisionDigest'>
  | Omit<ListGoalsRouteDecision, 'decisionDigest'>
  | Omit<ShowGoalRouteDecision, 'decisionDigest'>
  | Omit<ContinueIntakeQuestionRouteDecision, 'decisionDigest'>
  | Omit<ProposeIntakeActionRouteDecision, 'decisionDigest'>
  | Omit<ProposeGoalControlRouteDecision, 'decisionDigest'>
  | Omit<AskRouteClarificationDecision, 'decisionDigest'>
  | Omit<NoActionRouteDecision, 'decisionDigest'>;
export function routeDecisionProjection(record: RouteDecisionProjectionInput): unknown {
  return projectionWithout(record, 'decisionDigest');
}

export type PendingActionProjectionInput =
  | Omit<IntakePendingAction, 'pendingActionDigest'>
  | Omit<GoalControlPendingAction, 'pendingActionDigest'>;
export function pendingActionProjection(record: PendingActionProjectionInput): unknown {
  return projectionWithout(record, 'pendingActionDigest');
}

export type PendingActionResolutionProjectionInput =
  | Omit<DirectPendingActionAuthorization, 'resolutionDigest'>
  | Omit<ConfirmedPendingActionAuthorization, 'resolutionDigest'>
  | Omit<RespondedPendingActionResolution, 'resolutionDigest'>
  | Omit<UnrespondedPendingActionResolution, 'resolutionDigest'>;
export function pendingActionResolutionProjection(
  record: PendingActionResolutionProjectionInput,
): unknown {
  return projectionWithout(record, 'resolutionDigest');
}

export type InteractionActionReservationProjectionInput = Omit<
  InteractionActionReservation,
  'reservationDigest'
>;
export function interactionActionReservationProjection(
  record: InteractionActionReservationProjectionInput,
): unknown {
  return projectionWithout(record, 'reservationDigest');
}

export type InteractionActionOutcomeProjectionInput = Omit<
  InteractionActionOutcome,
  'outcomeDigest'
>;
export function interactionActionOutcomeProjection(
  record: InteractionActionOutcomeProjectionInput,
): unknown {
  return projectionWithout(record, 'outcomeDigest');
}

export type InteractionMessageHandoffProjectionInput = Omit<
  InteractionMessageHandoff,
  'handoffDigest'
>;
export function interactionMessageHandoffProjection(
  record: InteractionMessageHandoffProjectionInput,
): unknown {
  return projectionWithout(record, 'handoffDigest');
}

export type FrontstageAnswerProjectionInput = Omit<FrontstageAnswer, 'answerDigest'>;
export function frontstageAnswerProjection(record: FrontstageAnswerProjectionInput): unknown {
  return projectionWithout(record, 'answerDigest');
}

export type InteractionOperationProjectionInput =
  | Omit<ReservedInteractionOperation, 'operationDigest'>
  | Omit<CompletedInteractionOperation, 'operationDigest'>
  | Omit<FailedInteractionOperation, 'operationDigest'>
  | Omit<InterruptedInteractionOperation, 'operationDigest'>;
export function interactionOperationProjection(
  record: InteractionOperationProjectionInput,
): unknown {
  return projectionWithout(record, 'operationDigest');
}
