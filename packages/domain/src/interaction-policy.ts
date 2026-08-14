import {
  interactionConfirmationPolicyId,
  interactionRoutingPolicyId,
  sha256Digest,
  type InteractionConfirmationPolicyId,
  type InteractionRoutingPolicyId,
  type Sha256Digest,
} from './identifiers.js';
import {
  PendingActionKind,
  type FrontstageCandidateRoute,
  type InteractionPolicyTraceEntry,
  type InteractionRouteDecisionOutcome,
  type InteractionVersionedDigestRef,
  type PendingActionDerivation,
} from './interaction.js';
import { DomainInvariantError } from './workflow.js';

export const DirectActionGrammarNormalization = {
  NONE_EXACT_UNICODE_SCALAR_SEQUENCE: 'NONE_EXACT_UNICODE_SCALAR_SEQUENCE',
} as const;
export type DirectActionGrammarNormalization =
  (typeof DirectActionGrammarNormalization)[keyof typeof DirectActionGrammarNormalization];

export const DirectActionTargetRule = {
  CURRENT_FRONTSTAGE_PROJECT: 'CURRENT_FRONTSTAGE_PROJECT',
  SOLE_CURRENT_GOAL_FOCUS: 'SOLE_CURRENT_GOAL_FOCUS',
} as const;
export type DirectActionTargetRule =
  (typeof DirectActionTargetRule)[keyof typeof DirectActionTargetRule];

export const DirectActionHandoffRule = {
  COMPLETE_ORIGINAL_MESSAGE_BYTES: 'COMPLETE_ORIGINAL_MESSAGE_BYTES',
} as const;
export type DirectActionHandoffRule =
  (typeof DirectActionHandoffRule)[keyof typeof DirectActionHandoffRule];

export const DirectActionParseDisposition = {
  MATCHED: 'MATCHED',
  NO_MATCH: 'NO_MATCH',
} as const;
export type DirectActionParseDisposition =
  (typeof DirectActionParseDisposition)[keyof typeof DirectActionParseDisposition];

export const ConfirmationParseDisposition = {
  CONFIRM: 'CONFIRM',
  DECLINE: 'DECLINE',
  UNCLEAR: 'UNCLEAR',
} as const;
export type ConfirmationParseDisposition =
  (typeof ConfirmationParseDisposition)[keyof typeof ConfirmationParseDisposition];

export const InteractionTrustedParserKind = {
  CONFIRMATION_OR_DECLINE: 'CONFIRMATION_OR_DECLINE',
  EXACT_INTAKE_QUESTION: 'EXACT_INTAKE_QUESTION',
  DIRECT_ACTION: 'DIRECT_ACTION',
  READ_ONLY_GOAL_QUERY: 'READ_ONLY_GOAL_QUERY',
  ASSISTANT_PROPOSAL: 'ASSISTANT_PROPOSAL',
} as const;
export type InteractionTrustedParserKind =
  (typeof InteractionTrustedParserKind)[keyof typeof InteractionTrustedParserKind];

export const InteractionActionRequestSource = {
  DIRECT_ACTION: 'DIRECT_ACTION',
  ASSISTANT_PROPOSAL: 'ASSISTANT_PROPOSAL',
  BUSY_GOVERNED_ALTERNATIVE: 'BUSY_GOVERNED_ALTERNATIVE',
} as const;
export type InteractionActionRequestSource =
  (typeof InteractionActionRequestSource)[keyof typeof InteractionActionRequestSource];

export const InteractionTargetResolution = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  EXACT: 'EXACT',
  MISSING: 'MISSING',
  AMBIGUOUS: 'AMBIGUOUS',
  STALE: 'STALE',
} as const;
export type InteractionTargetResolution =
  (typeof InteractionTargetResolution)[keyof typeof InteractionTargetResolution];

export const InteractionActionAdmissionDisposition = {
  CREATE_PENDING_ACTION: 'CREATE_PENDING_ACTION',
  OFFER_MATERIALIZE_ONLY: 'OFFER_MATERIALIZE_ONLY',
  SESSION_EXECUTION_BUSY: 'SESSION_EXECUTION_BUSY',
  ASK_CLARIFICATION: 'ASK_CLARIFICATION',
} as const;
export type InteractionActionAdmissionDisposition =
  (typeof InteractionActionAdmissionDisposition)[keyof typeof InteractionActionAdmissionDisposition];

export const InteractionActionAdmissionReason = {
  EXACT_DIRECT_ACTION: 'EXACT_DIRECT_ACTION',
  DIRECT_ACTION_NOT_EXACT: 'DIRECT_ACTION_NOT_EXACT',
  ASSISTANT_ACTION_REQUIRES_CONFIRMATION: 'ASSISTANT_ACTION_REQUIRES_CONFIRMATION',
  CANCEL_REQUIRES_CONFIRMATION: 'CANCEL_REQUIRES_CONFIRMATION',
  BUSY_MATERIALIZE_ONLY_REQUIRES_CONFIRMATION: 'BUSY_MATERIALIZE_ONLY_REQUIRES_CONFIRMATION',
  BUSY_GOVERNED_ALTERNATIVE_AVAILABLE: 'BUSY_GOVERNED_ALTERNATIVE_AVAILABLE',
  BUSY_START_OR_RESUME_REJECTED: 'BUSY_START_OR_RESUME_REJECTED',
  BUSY_CANCEL_TARGET_NOT_ACTIVE: 'BUSY_CANCEL_TARGET_NOT_ACTIVE',
  TARGET_NOT_EXACT: 'TARGET_NOT_EXACT',
} as const;
export type InteractionActionAdmissionReason =
  (typeof InteractionActionAdmissionReason)[keyof typeof InteractionActionAdmissionReason];

export interface DirectActionGrammarForm {
  readonly messageTemplate: string;
  readonly actionKind:
    | typeof PendingActionKind.SUBMIT_GOVERNED_INTAKE
    | typeof PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE
    | typeof PendingActionKind.START_GOAL
    | typeof PendingActionKind.RESUME_GOAL;
  readonly targetRule: DirectActionTargetRule;
  readonly handoffRule?: DirectActionHandoffRule;
}

export interface DirectActionGrammarDefinition {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly version: string;
  readonly locale: 'zh-CN';
  readonly normalization: typeof DirectActionGrammarNormalization.NONE_EXACT_UNICODE_SCALAR_SEQUENCE;
  readonly forms: readonly DirectActionGrammarForm[];
}

export interface DirectActionGrammar extends DirectActionGrammarDefinition {
  readonly digest: Sha256Digest;
}

export interface ConfirmationGrammarDefinition {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly version: string;
  readonly locale: 'zh-CN';
  readonly normalization: typeof DirectActionGrammarNormalization.NONE_EXACT_UNICODE_SCALAR_SEQUENCE;
  readonly confirmPhrases: readonly string[];
  readonly declinePhrases: readonly string[];
}

export interface ConfirmationGrammar extends ConfirmationGrammarDefinition {
  readonly digest: Sha256Digest;
}

export interface InteractionRoutingPolicyDefinition {
  readonly id: InteractionRoutingPolicyId;
  readonly schemaVersion: 1;
  readonly version: string;
  readonly directActionGrammar: InteractionVersionedDigestRef;
  readonly parserOrder: readonly InteractionTrustedParserKind[];
  readonly allowedRouteOutcomes: readonly InteractionRouteDecisionOutcome[];
  readonly allowedAssistantCandidateRoutes: readonly FrontstageCandidateRoute[];
}

export interface InteractionRoutingPolicy extends InteractionRoutingPolicyDefinition {
  readonly digest: Sha256Digest;
}

export interface InteractionConfirmationPolicyDefinition {
  readonly id: InteractionConfirmationPolicyId;
  readonly schemaVersion: 1;
  readonly version: string;
  readonly confirmationGrammar: InteractionVersionedDigestRef;
  readonly directlyAuthorizableKinds: readonly PendingActionKind[];
  readonly alwaysSeparateKinds: readonly PendingActionKind[];
  readonly busyStartOrResumeDisposition: 'SESSION_EXECUTION_BUSY';
  readonly busyGovernedAlternative: 'SAME_MESSAGE_MATERIALIZE_ONLY_SEPARATE_RESPONSE_REQUIRED';
  readonly busyCancellationTarget: 'ACTIVE_SESSION_GOAL_ONLY_SEPARATE_RESPONSE_REQUIRED';
}

export interface InteractionConfirmationPolicy extends InteractionConfirmationPolicyDefinition {
  readonly digest: Sha256Digest;
}

export type DirectActionParseResult =
  | Readonly<{
      disposition: typeof DirectActionParseDisposition.NO_MATCH;
    }>
  | Readonly<{
      disposition: typeof DirectActionParseDisposition.MATCHED;
      actionKind: DirectActionGrammarForm['actionKind'];
      targetRule: DirectActionTargetRule;
      completeOriginalMessage: string;
      requestRemainder?: string;
      handoffRule?: DirectActionHandoffRule;
    }>;

export interface ConfirmationParseResult {
  readonly disposition: ConfirmationParseDisposition;
}

export type InteractionActionAdmission =
  | Readonly<{
      disposition: typeof InteractionActionAdmissionDisposition.CREATE_PENDING_ACTION;
      actionKind: PendingActionKind;
      actionDerivation: PendingActionDerivation;
      confirmationRequirement: 'DIRECT_USER_MESSAGE_SUFFICIENT' | 'SEPARATE_RESPONSE_REQUIRED';
      reason: InteractionActionAdmissionReason;
    }>
  | Readonly<{
      disposition: typeof InteractionActionAdmissionDisposition.OFFER_MATERIALIZE_ONLY;
      actionKind: typeof PendingActionKind.SUBMIT_MATERIALIZE_ONLY_INTAKE;
      actionDerivation: typeof PendingActionDerivation.BUSY_GOVERNED_MATERIALIZE_ONLY_ALTERNATIVE;
      confirmationRequirement: 'SEPARATE_RESPONSE_REQUIRED';
      reason: typeof InteractionActionAdmissionReason.BUSY_GOVERNED_ALTERNATIVE_AVAILABLE;
    }>
  | Readonly<{
      disposition: typeof InteractionActionAdmissionDisposition.SESSION_EXECUTION_BUSY;
      reason: typeof InteractionActionAdmissionReason.BUSY_START_OR_RESUME_REJECTED;
    }>
  | Readonly<{
      disposition: typeof InteractionActionAdmissionDisposition.ASK_CLARIFICATION;
      reason:
        | typeof InteractionActionAdmissionReason.BUSY_CANCEL_TARGET_NOT_ACTIVE
        | typeof InteractionActionAdmissionReason.DIRECT_ACTION_NOT_EXACT
        | typeof InteractionActionAdmissionReason.TARGET_NOT_EXACT;
    }>;

export interface InteractionActionAdmissionResult {
  readonly decision: InteractionActionAdmission;
  readonly trace: readonly InteractionPolicyTraceEntry[];
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new DomainInvariantError(`${name} must not be blank`);
  }
}

function assertUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) {
    throw new DomainInvariantError(`${name} must not contain duplicates`);
  }
}

function assertVersionedRef(reference: InteractionVersionedDigestRef, name: string): void {
  assertNonBlank(reference.id, `${name} ID`);
  assertNonBlank(reference.version, `${name} version`);
  sha256Digest(reference.digest);
}

export function assertDirectActionGrammarDefinitionInvariant(
  grammar: DirectActionGrammarDefinition,
): void {
  assertNonBlank(grammar.id, 'Direct-action grammar ID');
  assertNonBlank(grammar.version, 'Direct-action grammar version');
  if (grammar.forms.length === 0) {
    throw new DomainInvariantError('Direct-action grammar must contain at least one form');
  }
  assertUnique(
    grammar.forms.map((form) => form.messageTemplate),
    'Direct-action grammar message templates',
  );
  grammar.forms.forEach((form) => {
    assertNonBlank(form.messageTemplate, 'Direct-action message template');
    const firstMarker = form.messageTemplate.indexOf('<request>');
    const hasOneTerminalRequestMarker =
      firstMarker >= 0 &&
      firstMarker === form.messageTemplate.lastIndexOf('<request>') &&
      firstMarker + '<request>'.length === form.messageTemplate.length;
    if (
      (firstMarker >= 0 && !hasOneTerminalRequestMarker) ||
      (hasOneTerminalRequestMarker && form.handoffRule === undefined) ||
      (firstMarker < 0 && form.handoffRule !== undefined)
    ) {
      throw new DomainInvariantError(
        'Direct-action request marker and handoff rule are inconsistent',
      );
    }
  });
}

export function assertDirectActionGrammarInvariant(grammar: DirectActionGrammar): void {
  assertDirectActionGrammarDefinitionInvariant(grammar);
  sha256Digest(grammar.digest);
}

export function assertConfirmationGrammarDefinitionInvariant(
  grammar: ConfirmationGrammarDefinition,
): void {
  assertNonBlank(grammar.id, 'Confirmation grammar ID');
  assertNonBlank(grammar.version, 'Confirmation grammar version');
  if (grammar.confirmPhrases.length === 0 || grammar.declinePhrases.length === 0) {
    throw new DomainInvariantError('Confirmation grammar phrase sets must not be empty');
  }
  grammar.confirmPhrases.forEach((phrase) => assertNonBlank(phrase, 'Confirmation phrase'));
  grammar.declinePhrases.forEach((phrase) => assertNonBlank(phrase, 'Decline phrase'));
  assertUnique(grammar.confirmPhrases, 'Confirmation phrases');
  assertUnique(grammar.declinePhrases, 'Decline phrases');
  if (grammar.confirmPhrases.some((phrase) => grammar.declinePhrases.includes(phrase))) {
    throw new DomainInvariantError('Confirmation and decline phrases must be disjoint');
  }
}

export function assertConfirmationGrammarInvariant(grammar: ConfirmationGrammar): void {
  assertConfirmationGrammarDefinitionInvariant(grammar);
  sha256Digest(grammar.digest);
}

export function assertInteractionRoutingPolicyDefinitionInvariant(
  policy: InteractionRoutingPolicyDefinition,
): void {
  interactionRoutingPolicyId(policy.id);
  assertNonBlank(policy.version, 'Interaction Routing Policy version');
  assertVersionedRef(policy.directActionGrammar, 'Direct-action grammar');
  assertUnique(policy.parserOrder, 'Interaction trusted parser order');
  if (policy.parserOrder.length === 0) {
    throw new DomainInvariantError('Interaction trusted parser order must not be empty');
  }
  assertUnique(policy.allowedRouteOutcomes, 'Interaction allowed route outcomes');
  if (policy.allowedRouteOutcomes.length === 0) {
    throw new DomainInvariantError('Interaction allowed route outcomes must not be empty');
  }
  assertUnique(policy.allowedAssistantCandidateRoutes, 'Assistant candidate routes');
  if (policy.allowedAssistantCandidateRoutes.length === 0) {
    throw new DomainInvariantError('Assistant candidate routes must not be empty');
  }
}

export function assertInteractionRoutingPolicyInvariant(policy: InteractionRoutingPolicy): void {
  assertInteractionRoutingPolicyDefinitionInvariant(policy);
  sha256Digest(policy.digest);
}

export function assertInteractionConfirmationPolicyDefinitionInvariant(
  policy: InteractionConfirmationPolicyDefinition,
): void {
  interactionConfirmationPolicyId(policy.id);
  assertNonBlank(policy.version, 'Interaction Confirmation Policy version');
  assertVersionedRef(policy.confirmationGrammar, 'Confirmation grammar');
  assertUnique(policy.directlyAuthorizableKinds, 'Directly authorizable action kinds');
  assertUnique(policy.alwaysSeparateKinds, 'Separately confirmed action kinds');
  if (
    policy.directlyAuthorizableKinds.some((kind) => policy.alwaysSeparateKinds.includes(kind)) ||
    new Set([...policy.directlyAuthorizableKinds, ...policy.alwaysSeparateKinds]).size !==
      Object.values(PendingActionKind).length
  ) {
    throw new DomainInvariantError(
      'Interaction Confirmation Policy action sets must be disjoint and complete',
    );
  }
}

export function assertInteractionConfirmationPolicyInvariant(
  policy: InteractionConfirmationPolicy,
): void {
  assertInteractionConfirmationPolicyDefinitionInvariant(policy);
  sha256Digest(policy.digest);
}

function projectionWithout(record: object, excludedField: string): unknown {
  const projection: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== excludedField) {
      projection[key] = value;
    }
  }
  return projection;
}

export function directActionGrammarProjection(grammar: DirectActionGrammarDefinition): unknown {
  return projectionWithout(grammar, 'digest');
}

export function confirmationGrammarProjection(grammar: ConfirmationGrammarDefinition): unknown {
  return projectionWithout(grammar, 'digest');
}

export function interactionRoutingPolicyProjection(
  policy: InteractionRoutingPolicyDefinition,
): unknown {
  return projectionWithout(policy, 'digest');
}

export function interactionConfirmationPolicyProjection(
  policy: InteractionConfirmationPolicyDefinition,
): unknown {
  return projectionWithout(policy, 'digest');
}
