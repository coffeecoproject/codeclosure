import { Buffer } from 'node:buffer';

import {
  ClarificationAnswerSchemaKind,
  IntakeInteractionAction,
  IntakeRunStatus,
  IntentAdmissionDerivationRuleId,
  IntentAdmissionDecisionKind,
  IntentAdmissionMaterialFieldKind,
  IntentAdmissionOutcome,
  IntentAdmissionPolicyRuleKind,
  IntentAdmissionReasonCode,
  IntentAdmissionRuleTraceOutcome,
  IntentExecutionDisposition,
  IntentProjectionField,
  MaterialAmbiguityStatus,
  SourceAuthorityClass,
  assertIntentProjectionAmbiguityClosure,
  decodeClarificationQuestionSpec,
  decodeIntakeRun,
  decodeIntentAdmissionDecision,
  decodeIntentAdmissionPolicy,
  decodeIntentAnalysisProposal,
  decodeIntentProjectionRevision,
  decodeMaterialAmbiguitySet,
  decodeRawRequestRevision,
  executionProfileId,
  intentAdmissionDecisionProjection,
  policyBundleId,
  sha256Digest,
  type AbandonmentBinding,
  type ClarificationQuestionId,
  type ClarificationQuestionSpec,
  type DeclaredProjectRef,
  type ExecutionProfileId,
  type IntakeDigestVerifier,
  type IntakeRun,
  type IntentAdmissionDecision,
  type IntentAdmissionDecisionId,
  type IntentAdmissionDecisionProjectionInput,
  type IntentAdmissionPolicy,
  type IntentAdmissionRuleTraceEntry,
  type IntentAnalysisProposal,
  type IntentProjectionRevisionRecord,
  type IsoTimestamp,
  type MaterialAmbiguity,
  type MaterialAmbiguitySet,
  type PolicyBundleId,
  type RawRequestRevisionRecord,
  type Sha256Digest,
  type SourceBinding,
} from '@codeclosure/domain';

import type { DigestProvider } from './ports.js';
import { m25IntakeBudgetDefinition } from './intake-assistant.js';
import { M251_POLICY_BUNDLE_ID, M251_POLICY_BUNDLE_VERSION } from './m251-policy.js';
import {
  M251_REAL_CODEX_EXECUTION_PROFILE_ID,
  M251_REAL_CODEX_EXECUTION_PROFILE_VERSION,
} from './m251-execution-profile.js';
import {
  M25_CLARIFICATION_QUESTION_PROMPTS,
  M25_DERIVATION_RULE_VERSION,
} from './intake-projection.js';

interface IntentAdmissionInputViewCommon {
  readonly intakeRun: IntakeRun;
  readonly rawRequestRevision: RawRequestRevisionRecord;
  readonly admissionPolicy: IntentAdmissionPolicy;
}

/** Runtime-owned, immutable input for a decision that requires no assistant analysis. */
export interface PreAnalysisIntentAdmissionInputView extends IntentAdmissionInputViewCommon {
  readonly kind: 'PRE_ANALYSIS';
}

/** Runtime-owned, immutable input carrying one complete source-bound Projection view. */
export interface ProjectedIntentAdmissionInputView extends IntentAdmissionInputViewCommon {
  readonly kind: 'PROJECTED';
  readonly rawRequestRevisions: readonly RawRequestRevisionRecord[];
  readonly intentAnalysisIdentity: Readonly<{
    readonly assistantAdapterId: string;
    readonly assistantAdapterVersion: string;
    readonly responseContractDigest: Sha256Digest;
  }>;
  readonly intentAnalysisProposal: IntentAnalysisProposal;
  readonly intentProjection: IntentProjectionRevisionRecord;
  readonly materialAmbiguitySet: MaterialAmbiguitySet;
  readonly clarificationQuestionSpec?: ClarificationQuestionSpec;
  readonly clarificationQuestionId?: ClarificationQuestionId;
  readonly abandonmentBinding?: AbandonmentBinding;
  readonly projectOrScopeRef?: DeclaredProjectRef;
  readonly governedExecutionPreflight?: GovernedExecutionPreflight;
}

export type IntentAdmissionInputView =
  PreAnalysisIntentAdmissionInputView | ProjectedIntentAdmissionInputView;

export interface GovernedExecutionPreflight {
  readonly schemaVersion: 1;
  readonly workflowPolicyId: PolicyBundleId;
  readonly workflowPolicyVersion: string;
  readonly workflowPolicyDigest: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileVersion: string;
  readonly executionProfileDigest: Sha256Digest;
}

export interface M25IntentAdmissionEngineOptions {
  /** Exact trusted-composition tuple accepted for governed new-Goal admission. */
  readonly governedExecutionPreflight?: GovernedExecutionPreflight;
}

export interface IssueIntentAdmissionDecisionRequest {
  readonly decisionId: IntentAdmissionDecisionId;
  readonly decidedAt: IsoTimestamp;
  readonly input: IntentAdmissionInputView;
}

/**
 * Sole pre-Goal admission authority. It has no assistant, Store, Goal, Workflow, Worker,
 * Candidate, Evidence, Acceptance, or external-effect capability.
 */
export interface IntentAdmissionEngine {
  issueDecision(request: IssueIntentAdmissionDecisionRequest): IntentAdmissionDecision;
}

const M25_GOVERNED_WORKFLOW_POLICY_ID = 'policy_codeclosure-m1';
const M25_GOVERNED_WORKFLOW_POLICY_VERSION = 'codeclosure-m1-policy-v1';
const M25_GOVERNED_WORKFLOW_POLICY_DIGEST =
  'sha256:a6a7a4e0c9930a3a79f72b5069775430d902284d31ea650e48a213a9648adcb9';
const M25_GOVERNED_EXECUTION_PROFILE_ID = 'profile_m1-happy-path';
const M25_GOVERNED_EXECUTION_PROFILE_VERSION = 'codeclosure-m1-fake-profile-v1';
const M25_GOVERNED_EXECUTION_PROFILE_DIGEST =
  'sha256:e06f2ce15169e0beac7da4998d090718a0c506d30690d2e703cdc946c77577a4';

const m25HistoricalGovernedExecutionPreflight: GovernedExecutionPreflight = Object.freeze({
  schemaVersion: 1,
  workflowPolicyId: policyBundleId(M25_GOVERNED_WORKFLOW_POLICY_ID),
  workflowPolicyVersion: M25_GOVERNED_WORKFLOW_POLICY_VERSION,
  workflowPolicyDigest: sha256Digest(M25_GOVERNED_WORKFLOW_POLICY_DIGEST),
  executionProfileId: executionProfileId(M25_GOVERNED_EXECUTION_PROFILE_ID),
  executionProfileVersion: M25_GOVERNED_EXECUTION_PROFILE_VERSION,
  executionProfileDigest: sha256Digest(M25_GOVERNED_EXECUTION_PROFILE_DIGEST),
});

function exactProject(
  left: DeclaredProjectRef | undefined,
  right: DeclaredProjectRef | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : left.normalizedPath === right?.normalizedPath && left.identityDigest === right.identityDigest;
}

function fieldPriority(policy: IntentAdmissionPolicy): readonly IntentProjectionField[] {
  const rule = policy.orderedRules.find(
    ({ kind }) => kind === IntentAdmissionPolicyRuleKind.FIRST_MATERIAL_AMBIGUITY,
  );
  if (rule?.kind !== IntentAdmissionPolicyRuleKind.FIRST_MATERIAL_AMBIGUITY) {
    throw new TypeError('Admission Policy lacks its first-material-ambiguity rule');
  }
  return rule.fieldPriority;
}

function ambiguitySourceOrder(
  ambiguity: MaterialAmbiguity,
  bindings: readonly SourceBinding[],
): number {
  const starts = bindings.flatMap((binding) =>
    ambiguity.sourceRefs.includes(binding.bindingDigest) &&
    binding.authorityClass === SourceAuthorityClass.USER_STATED
      ? [binding.sourceSpan.startByte]
      : [],
  );
  return starts.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...starts);
}

function firstAmbiguity(
  policy: IntentAdmissionPolicy,
  set: MaterialAmbiguitySet,
  bindings: readonly SourceBinding[],
): MaterialAmbiguity | undefined {
  const priority = fieldPriority(policy);
  return set.ambiguities.slice().sort((left, right) => {
    const leftPriority = Math.min(...left.affectedFields.map((field) => priority.indexOf(field)));
    const rightPriority = Math.min(...right.affectedFields.map((field) => priority.indexOf(field)));
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftSource = ambiguitySourceOrder(left, bindings);
    const rightSource = ambiguitySourceOrder(right, bindings);
    return leftSource !== rightSource
      ? leftSource - rightSource
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;
  })[0];
}

function projectionBinding(
  proposal: IntentAnalysisProposal,
  projection: IntentProjectionRevisionRecord,
) {
  return {
    intentAnalysisProposalId: proposal.id,
    intentAnalysisProposalDigest: proposal.proposalDigest,
    intentProjectionId: projection.id,
    intentProjectionRevision: projection.revision,
    intentProjectionDigest: projection.projectionDigest,
    sourceBindingDigests: projection.sourceBindings.map(({ bindingDigest }) => bindingDigest),
    materialAmbiguityRefs: projection.materialAmbiguityRefs,
  };
}

function utf8Boundaries(value: string): ReadonlySet<number> {
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const scalar of value) {
    offset += Buffer.byteLength(scalar, 'utf8');
    boundaries.add(offset);
  }
  return boundaries;
}

function exactUserBindingValue(
  binding: SourceBinding,
  revisions: ReadonlyMap<number, RawRequestRevisionRecord>,
): string | undefined {
  if (binding.authorityClass !== SourceAuthorityClass.USER_STATED) {
    return undefined;
  }
  const revision = revisions.get(binding.sourceRevision);
  if (
    binding.sourceRecordRef !== revision?.rawRequestId ||
    binding.sourceDigest !== revision.rawRequestDigest
  ) {
    throw new TypeError('USER_STATED Source Binding does not bind an exact selected revision');
  }
  const bytes = Buffer.from(revision.admittedUserContent, 'utf8');
  const boundaries = utf8Boundaries(revision.admittedUserContent);
  if (
    binding.sourceSpan.endByte > bytes.length ||
    !boundaries.has(binding.sourceSpan.startByte) ||
    !boundaries.has(binding.sourceSpan.endByte)
  ) {
    throw new TypeError('USER_STATED Source Binding does not use exact UTF-8 boundaries');
  }
  return bytes.subarray(binding.sourceSpan.startByte, binding.sourceSpan.endByte).toString('utf8');
}

function exactProposalSourcePaths(
  field: IntentProjectionField,
  proposal: IntentAnalysisProposal,
): readonly string[] {
  return (() => {
    switch (field) {
      case IntentProjectionField.OBJECTIVE:
        return proposal.proposedObjective === undefined ? [] : ['/proposedObjective'];
      case IntentProjectionField.REQUIRED_CRITERION:
        return proposal.proposedCriteria.map((_, index) => `/proposedCriteria/${String(index)}`);
      case IntentProjectionField.SCOPE:
        return proposal.proposedScope === undefined ? [] : ['/proposedScope'];
      case IntentProjectionField.NON_GOAL:
        return proposal.proposedNonGoals.map((_, index) => `/proposedNonGoals/${String(index)}`);
      case IntentProjectionField.ASSUMPTION:
        return proposal.proposedAssumptions.map(
          (_, index) => `/proposedAssumptions/${String(index)}`,
        );
      case IntentProjectionField.PROJECT_IDENTITY:
      case IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION:
        return [];
    }
  })();
}

function assertExactProposalSourceBinding(
  binding: Extract<
    SourceBinding,
    {
      readonly authorityClass:
        typeof SourceAuthorityClass.MODEL_PROPOSED | typeof SourceAuthorityClass.UNRESOLVED;
    }
  >,
  proposal: IntentAnalysisProposal,
): void {
  const allowedPaths = exactProposalSourcePaths(binding.projectionFieldRef, proposal);
  if (
    binding.sourceRecordRef !== proposal.id ||
    binding.sourceRevision !== proposal.schemaVersion ||
    binding.sourceDigest !== proposal.proposalDigest ||
    !allowedPaths.includes(binding.sourceFieldPath)
  ) {
    throw new TypeError(`${binding.authorityClass} binding does not bind an exact Proposal field`);
  }
}

function trace(
  policy: IntentAdmissionPolicy,
  terminalRuleKind: string,
  reasonCode: string,
  rawRequestDigest: Sha256Digest,
): readonly IntentAdmissionRuleTraceEntry[] {
  const entries: IntentAdmissionRuleTraceEntry[] = [];
  for (const rule of policy.orderedRules) {
    const matched = rule.kind === terminalRuleKind;
    entries.push({
      ruleId: rule.ruleId,
      outcome: matched
        ? IntentAdmissionRuleTraceOutcome.MATCHED
        : IntentAdmissionRuleTraceOutcome.NOT_MATCHED,
      reasonCode: matched ? reasonCode : 'NOT_APPLICABLE',
      inputRefs: [rawRequestDigest, policy.digest],
    });
    if (matched) {
      return entries;
    }
  }
  throw new TypeError('Admission Policy does not contain the terminal rule');
}

const governedExecutionPreflightKeys = Object.freeze([
  'schemaVersion',
  'workflowPolicyId',
  'workflowPolicyVersion',
  'workflowPolicyDigest',
  'executionProfileId',
  'executionProfileVersion',
  'executionProfileDigest',
]);

function rawField(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

function exactGovernedPreflight(
  left: GovernedExecutionPreflight,
  right: GovernedExecutionPreflight,
): boolean {
  return (
    left.workflowPolicyId === right.workflowPolicyId &&
    left.workflowPolicyVersion === right.workflowPolicyVersion &&
    left.workflowPolicyDigest === right.workflowPolicyDigest &&
    left.executionProfileId === right.executionProfileId &&
    left.executionProfileVersion === right.executionProfileVersion &&
    left.executionProfileDigest === right.executionProfileDigest
  );
}

function assertClosedGovernedPreflight(preflight: GovernedExecutionPreflight): void {
  const keys = Reflect.ownKeys(preflight);
  if (
    keys.length !== governedExecutionPreflightKeys.length ||
    governedExecutionPreflightKeys.some((key) => !keys.includes(key)) ||
    rawField(preflight, 'schemaVersion') !== 1
  ) {
    throw new TypeError('Governed execution preflight must be one closed schema-version-1 tuple');
  }
  policyBundleId(preflight.workflowPolicyId);
  sha256Digest(preflight.workflowPolicyDigest);
  executionProfileId(preflight.executionProfileId);
  sha256Digest(preflight.executionProfileDigest);
  if (
    preflight.workflowPolicyVersion.trim().length === 0 ||
    preflight.executionProfileVersion.trim().length === 0
  ) {
    throw new TypeError('Governed execution preflight versions must not be blank');
  }
}

function assertSupportedGovernedPreflight(preflight: GovernedExecutionPreflight): void {
  assertClosedGovernedPreflight(preflight);
  const historical = exactGovernedPreflight(preflight, m25HistoricalGovernedExecutionPreflight);
  const m251 =
    preflight.workflowPolicyId === M251_POLICY_BUNDLE_ID &&
    preflight.workflowPolicyVersion === M251_POLICY_BUNDLE_VERSION &&
    preflight.executionProfileId === M251_REAL_CODEX_EXECUTION_PROFILE_ID &&
    preflight.executionProfileVersion === M251_REAL_CODEX_EXECUTION_PROFILE_VERSION;
  if (!historical && !m251) {
    throw new TypeError('Governed execution preflight selects an unsupported authority tuple');
  }
}

function validateGovernedPreflight(
  preflight: GovernedExecutionPreflight | undefined,
  expected: GovernedExecutionPreflight,
): void {
  if (preflight === undefined) {
    throw new TypeError('Governed execution requires the exact fixed Workflow/Profile preflight');
  }
  assertClosedGovernedPreflight(preflight);
  if (!exactGovernedPreflight(preflight, expected)) {
    throw new TypeError('Governed execution requires the exact fixed Workflow/Profile preflight');
  }
}

/** Deterministic, capability-free M2.5 Admission Policy with one trusted exact preflight tuple. */
export class M25IntentAdmissionEngine implements IntentAdmissionEngine {
  readonly #digests: DigestProvider & IntakeDigestVerifier;
  readonly #governedExecutionPreflight: GovernedExecutionPreflight;

  public constructor(
    digests: DigestProvider & IntakeDigestVerifier,
    options: M25IntentAdmissionEngineOptions = {},
  ) {
    this.#digests = digests;
    const governedExecutionPreflight =
      options.governedExecutionPreflight ?? m25HistoricalGovernedExecutionPreflight;
    assertSupportedGovernedPreflight(governedExecutionPreflight);
    this.#governedExecutionPreflight = Object.freeze({ ...governedExecutionPreflight });
  }

  public issueDecision(request: IssueIntentAdmissionDecisionRequest): IntentAdmissionDecision {
    const policy = decodeIntentAdmissionPolicy(request.input.admissionPolicy, this.#digests);
    const run = decodeIntakeRun(request.input.intakeRun);
    const current = decodeRawRequestRevision(request.input.rawRequestRevision, this.#digests);
    if (
      run.id !== current.intakeRunId ||
      run.principalRef !== current.principalRef ||
      run.activeRawRequestRevision.rawRequestId !== current.rawRequestId ||
      run.activeRawRequestRevision.revision !== current.revision ||
      run.activeRawRequestRevision.digest !== current.rawRequestDigest ||
      !exactProject(run.projectRef, current.declaredProjectRef)
    ) {
      throw new TypeError('Admission input does not bind the exact current Intake snapshot');
    }
    const common = {
      id: request.decisionId,
      schemaVersion: 1 as const,
      intakeRunId: run.id,
      intakeRunVersion: run.version,
      principalRef: run.principalRef,
      rawRequestRevision: current.revision,
      rawRequestDigest: current.rawRequestDigest,
      admissionPolicyId: policy.id,
      admissionPolicyVersion: policy.version,
      admissionPolicyDigest: policy.digest,
      decidedAt: request.decidedAt,
    };

    if (request.input.kind === 'PRE_ANALYSIS') {
      const answerRule = policy.orderedRules.find(
        ({ kind }) => kind === IntentAdmissionPolicyRuleKind.ANSWER_ONLY_ACTION,
      );
      const denyRule = policy.orderedRules.find(
        ({ kind }) => kind === IntentAdmissionPolicyRuleKind.DENY_EXACT_PRINCIPAL,
      );
      const unsupportedRule = policy.orderedRules.find(
        ({ kind }) => kind === IntentAdmissionPolicyRuleKind.UNSUPPORTED_GOVERNED_EXECUTION,
      );
      const selected =
        current.interactionAction === IntakeInteractionAction.ANSWER_ONLY &&
        answerRule?.kind === IntentAdmissionPolicyRuleKind.ANSWER_ONLY_ACTION
          ? {
              ruleKind: answerRule.kind,
              reasonCode: IntentAdmissionReasonCode.ANSWER_ONLY,
            }
          : denyRule?.kind === IntentAdmissionPolicyRuleKind.DENY_EXACT_PRINCIPAL &&
              current.principalRef === denyRule.principalRef &&
              current.interactionAction === denyRule.interactionAction
            ? {
                ruleKind: denyRule.kind,
                reasonCode: IntentAdmissionReasonCode.POLICY_DENIED,
              }
            : unsupportedRule?.kind ===
                  IntentAdmissionPolicyRuleKind.UNSUPPORTED_GOVERNED_EXECUTION &&
                current.interactionAction === unsupportedRule.interactionAction
              ? {
                  ruleKind: unsupportedRule.kind,
                  reasonCode: IntentAdmissionReasonCode.UNSUPPORTED,
                }
              : undefined;
      if (selected === undefined) {
        throw new TypeError('Pre-analysis Admission is not dispositive for this exact input');
      }
      const decisionIdentity =
        selected.reasonCode === IntentAdmissionReasonCode.ANSWER_ONLY
          ? {
              interactionAction: IntakeInteractionAction.ANSWER_ONLY,
              reasonCode: IntentAdmissionReasonCode.ANSWER_ONLY,
            }
          : selected.reasonCode === IntentAdmissionReasonCode.POLICY_DENIED
            ? {
                interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
                reasonCode: IntentAdmissionReasonCode.POLICY_DENIED,
              }
            : {
                interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
                reasonCode: IntentAdmissionReasonCode.UNSUPPORTED,
              };
      const base = {
        ...common,
        ...decisionIdentity,
        kind: IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION,
        ...(current.declaredProjectRef === undefined
          ? {}
          : { projectOrScopeRef: current.declaredProjectRef }),
        outcome: IntentAdmissionOutcome.NO_EXECUTION,
        executionDisposition: IntentExecutionDisposition.NONE,
        orderedReasonTrace: trace(
          policy,
          selected.ruleKind,
          selected.reasonCode,
          current.rawRequestDigest,
        ),
      } satisfies IntentAdmissionDecisionProjectionInput;
      return decodeIntentAdmissionDecision(
        {
          ...base,
          decisionDigest: this.#digests.digest(intentAdmissionDecisionProjection(base)),
        },
        this.#digests,
      );
    }

    const revisions = request.input.rawRequestRevisions.map((revision) =>
      decodeRawRequestRevision(revision, this.#digests),
    );
    const revisionsByNumber = new Map(revisions.map((revision) => [revision.revision, revision]));
    revisions.forEach((revision, index) => {
      if (
        revision.intakeRunId !== run.id ||
        revision.rawRequestId !== current.rawRequestId ||
        revision.revision !== index + 1
      ) {
        throw new TypeError('Admission Raw Request history is not one exact ordered chain');
      }
    });
    if (revisions.at(-1)?.rawRequestDigest !== current.rawRequestDigest) {
      throw new TypeError('Admission Raw Request history is stale');
    }
    const proposal = decodeIntentAnalysisProposal(
      request.input.intentAnalysisProposal,
      this.#digests,
    );
    if (
      proposal.assistantAdapterId !== request.input.intentAnalysisIdentity.assistantAdapterId ||
      proposal.assistantAdapterVersion !==
        request.input.intentAnalysisIdentity.assistantAdapterVersion ||
      proposal.responseContractDigest !==
        request.input.intentAnalysisIdentity.responseContractDigest
    ) {
      throw new TypeError('Intent Analysis Proposal does not bind the trusted analysis identity');
    }
    const projection = decodeIntentProjectionRevision(
      request.input.intentProjection,
      this.#digests,
    );
    const ambiguities = decodeMaterialAmbiguitySet(
      request.input.materialAmbiguitySet,
      this.#digests,
    );
    if (
      proposal.intakeRunId !== run.id ||
      proposal.rawRequestRevision !== current.revision ||
      proposal.rawRequestDigest !== current.rawRequestDigest ||
      projection.intakeRunId !== run.id ||
      projection.rawRequestRevision !== current.revision ||
      projection.intentAnalysisProposalRef.id !== proposal.id ||
      projection.intentAnalysisProposalRef.digest !== proposal.proposalDigest ||
      ambiguities.intakeRunId !== run.id ||
      ambiguities.intentProjectionId !== projection.id ||
      ambiguities.intentProjectionRevision !== projection.revision ||
      ambiguities.intentProjectionDigest !== projection.projectionDigest ||
      projection.materialAmbiguityRefs.length !== ambiguities.ambiguities.length ||
      projection.materialAmbiguityRefs.some(
        (id, index) => id !== ambiguities.ambiguities[index]?.id,
      ) ||
      !exactProject(request.input.projectOrScopeRef, current.declaredProjectRef) ||
      projection.scope.projectPath !== current.declaredProjectRef?.normalizedPath
    ) {
      throw new TypeError('Projected Admission input contains a stale or substituted binding');
    }
    assertIntentProjectionAmbiguityClosure(proposal, projection, ambiguities);
    const activeProjection = run.activeIntentProjectionRevision;
    if (request.input.abandonmentBinding === undefined) {
      if (
        activeProjection === undefined
          ? projection.revision !== 1 || projection.parentRevision !== undefined
          : projection.id !== activeProjection.id ||
            projection.revision !== activeProjection.revision + 1 ||
            projection.parentRevision !== activeProjection.revision
      ) {
        throw new TypeError(
          'Projected Admission input does not extend the exact active Projection',
        );
      }
    } else {
      if (activeProjection === undefined) {
        throw new TypeError('Abandonment requires an active Projection');
      }
      if (
        projection.id !== activeProjection.id ||
        projection.revision !== activeProjection.revision ||
        projection.projectionDigest !== activeProjection.digest
      ) {
        throw new TypeError('Abandonment does not bind the exact active Projection');
      }
    }
    const allowedAmbiguitySources = new Set([
      proposal.proposalDigest,
      ...projection.sourceBindings.map(({ bindingDigest }) => bindingDigest),
    ]);
    for (const ambiguity of ambiguities.ambiguities) {
      if (
        ambiguity.basedOnProjectionRevision !== projection.revision ||
        ambiguity.status !== MaterialAmbiguityStatus.UNRESOLVED ||
        ambiguity.resolvedByRawRequestRevision !== undefined ||
        ambiguity.materialityPolicyRef.id !== policy.id ||
        ambiguity.materialityPolicyRef.version !== policy.version ||
        ambiguity.materialityPolicyRef.digest !== policy.digest ||
        ambiguity.sourceRefs.length === 0 ||
        ambiguity.sourceRefs.some((sourceRef) => !allowedAmbiguitySources.has(sourceRef))
      ) {
        throw new TypeError('Material Ambiguity does not bind the exact Projection and Policy');
      }
    }
    projection.sourceBindings.forEach((binding) => {
      switch (binding.authorityClass) {
        case SourceAuthorityClass.USER_STATED:
          exactUserBindingValue(binding, revisionsByNumber);
          break;
        case SourceAuthorityClass.MODEL_PROPOSED:
          assertExactProposalSourceBinding(binding, proposal);
          break;
        case SourceAuthorityClass.POLICY_DERIVED:
          if (
            binding.sourceRecordRef !== current.rawRequestId ||
            binding.sourceRevision !== current.revision ||
            binding.sourceDigest !== current.rawRequestDigest ||
            binding.derivationPolicyRef.digest !== policy.digest ||
            binding.derivationPolicyRef.orderedInputBindingDigests.length !== 0 ||
            (binding.projectionFieldRef === IntentProjectionField.PROJECT_IDENTITY
              ? binding.sourceFieldPath !== '/declaredProjectRef/normalizedPath' ||
                binding.derivationPolicyRef.id !==
                  IntentAdmissionDerivationRuleId.DECLARED_PROJECT_TO_SCOPE ||
                binding.derivationPolicyRef.version !== M25_DERIVATION_RULE_VERSION
              : binding.projectionFieldRef === IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION
                ? binding.sourceFieldPath !== '/interactionAction' ||
                  binding.derivationPolicyRef.id !==
                    IntentAdmissionDerivationRuleId.INTERACTION_ACTION_TO_DISPOSITION ||
                  binding.derivationPolicyRef.version !== M25_DERIVATION_RULE_VERSION
                : true)
          ) {
            throw new TypeError('POLICY_DERIVED binding does not bind the exact policy input');
          }
          break;
        case SourceAuthorityClass.PROJECT_OBSERVED:
          throw new TypeError('M2.5 local Admission does not admit project observation');
        case SourceAuthorityClass.UNRESOLVED:
          assertExactProposalSourceBinding(binding, proposal);
          if (
            !ambiguities.ambiguities.some(
              (ambiguity) =>
                ambiguity.affectedFields.includes(binding.projectionFieldRef) &&
                ambiguity.sourceRefs.includes(binding.bindingDigest),
            )
          ) {
            throw new TypeError(
              'UNRESOLVED binding is not owned by an exact same-field Material Ambiguity',
            );
          }
          break;
      }
    });
    if (current.interactionAction === IntakeInteractionAction.ANSWER_ONLY) {
      throw new TypeError(
        'Projection execution disposition does not agree with trusted interaction action',
      );
    }
    const expectedExecutionDisposition =
      current.interactionAction === IntakeInteractionAction.MATERIALIZE_ONLY
        ? IntentExecutionDisposition.LEAVE_READY
        : IntentExecutionDisposition.AUTHORIZE_START;
    if (projection.requestedExecutionDisposition !== expectedExecutionDisposition) {
      throw new TypeError(
        'Projection execution disposition does not agree with trusted interaction action',
      );
    }

    const binding = projectionBinding(proposal, projection);
    if (request.input.abandonmentBinding !== undefined) {
      const abandonment = request.input.abandonmentBinding;
      if (
        run.status !== IntakeRunStatus.NEEDS_CLARIFICATION ||
        abandonment.clarificationQuestionId !== run.activeQuestionRef.clarificationQuestionId ||
        abandonment.questionSpecDigest !== run.activeQuestionRef.questionSpecDigest ||
        abandonment.questionDigest !== run.activeQuestionRef.questionDigest ||
        abandonment.issuingClarifyDecisionId !== run.activeQuestionRef.issuingDecisionId ||
        abandonment.issuingClarifyDecisionDigest !== run.activeQuestionRef.issuingDecisionDigest
      ) {
        throw new TypeError('Abandonment does not bind the exact singular active Question');
      }
      const base = {
        ...common,
        interactionAction: current.interactionAction,
        kind: IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION,
        projectionBinding: binding,
        abandonmentBinding: abandonment,
        ...(current.declaredProjectRef === undefined
          ? {}
          : { projectOrScopeRef: current.declaredProjectRef }),
        outcome: IntentAdmissionOutcome.NO_EXECUTION,
        reasonCode: IntentAdmissionReasonCode.ABANDONED,
        executionDisposition: IntentExecutionDisposition.NONE,
        orderedReasonTrace: trace(
          policy,
          IntentAdmissionPolicyRuleKind.ABANDON_ACTIVE_QUESTION,
          IntentAdmissionReasonCode.ABANDONED,
          current.rawRequestDigest,
        ),
      } satisfies IntentAdmissionDecisionProjectionInput;
      return decodeIntentAdmissionDecision(
        {
          ...base,
          decisionDigest: this.#digests.digest(intentAdmissionDecisionProjection(base)),
        },
        this.#digests,
      );
    }

    const first = firstAmbiguity(policy, ambiguities, projection.sourceBindings);
    if (first !== undefined) {
      if (
        run.status !== IntakeRunStatus.ANALYZING ||
        request.input.clarificationQuestionSpec === undefined ||
        request.input.clarificationQuestionId === undefined
      ) {
        throw new TypeError('CLARIFY requires one preallocated Question over ANALYZING authority');
      }
      const spec = decodeClarificationQuestionSpec(
        request.input.clarificationQuestionSpec,
        this.#digests,
      );
      const expectedProjectAnswer =
        first.affectedFields.length === 1 &&
        first.affectedFields[0] === IntentProjectionField.PROJECT_IDENTITY;
      const exactAnswerSchema = expectedProjectAnswer
        ? spec.answerSchema.kind === ClarificationAnswerSchemaKind.PROJECT_PATH
        : spec.answerSchema.kind === ClarificationAnswerSchemaKind.TEXT &&
          spec.answerSchema.maxUtf8Bytes ===
            m25IntakeBudgetDefinition.exactClarificationAnswerBytesPerRevision;
      if (
        spec.intakeRunId !== run.id ||
        spec.basedOnProjectionRevision !== projection.revision ||
        spec.ambiguityRef !== first.id ||
        spec.prompt !== M25_CLARIFICATION_QUESTION_PROMPTS[first.reasonCode] ||
        spec.affectedFields.length !== first.affectedFields.length ||
        spec.affectedFields.some((field, index) => field !== first.affectedFields[index]) ||
        !exactAnswerSchema
      ) {
        throw new TypeError('Clarification Question specification does not bind first ambiguity');
      }
      const base = {
        ...common,
        interactionAction: current.interactionAction,
        kind: IntentAdmissionDecisionKind.CLARIFY,
        projectionBinding: binding,
        questionPlanBinding: {
          questionId: request.input.clarificationQuestionId,
          questionSpecDigest: spec.questionSpecDigest,
        },
        ...(current.declaredProjectRef === undefined
          ? {}
          : { projectOrScopeRef: current.declaredProjectRef }),
        outcome: IntentAdmissionOutcome.CLARIFY,
        reasonCode: IntentAdmissionReasonCode.MATERIAL_AMBIGUITY,
        executionDisposition: IntentExecutionDisposition.NONE,
        orderedReasonTrace: trace(
          policy,
          IntentAdmissionPolicyRuleKind.FIRST_MATERIAL_AMBIGUITY,
          IntentAdmissionReasonCode.MATERIAL_AMBIGUITY,
          current.rawRequestDigest,
        ),
      } satisfies IntentAdmissionDecisionProjectionInput;
      return decodeIntentAdmissionDecision(
        {
          ...base,
          decisionDigest: this.#digests.digest(intentAdmissionDecisionProjection(base)),
        },
        this.#digests,
      );
    }

    this.assertMaterialFieldsEligible(projection, revisionsByNumber, current, policy);
    if (current.declaredProjectRef === undefined || run.status !== IntakeRunStatus.ANALYZING) {
      throw new TypeError('MATERIALIZE requires exact project-bound ANALYZING authority');
    }
    const governed = current.interactionAction === IntakeInteractionAction.GOVERNED_EXECUTION;
    if (governed) {
      validateGovernedPreflight(
        request.input.governedExecutionPreflight,
        this.#governedExecutionPreflight,
      );
    }
    const reasonCode = governed
      ? IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED
      : IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED;
    const terminalRuleKind = governed
      ? IntentAdmissionPolicyRuleKind.GOVERNED_EXECUTION_DISPOSITION
      : IntentAdmissionPolicyRuleKind.MATERIALIZE_ONLY_DISPOSITION;
    const base = governed
      ? ({
          ...common,
          interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
          kind: IntentAdmissionDecisionKind.MATERIALIZE,
          projectionBinding: binding,
          projectOrScopeRef: current.declaredProjectRef,
          outcome: IntentAdmissionOutcome.MATERIALIZE,
          reasonCode: IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED,
          executionDisposition: IntentExecutionDisposition.AUTHORIZE_START,
          orderedReasonTrace: trace(policy, terminalRuleKind, reasonCode, current.rawRequestDigest),
        } satisfies IntentAdmissionDecisionProjectionInput)
      : ({
          ...common,
          interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
          kind: IntentAdmissionDecisionKind.MATERIALIZE,
          projectionBinding: binding,
          projectOrScopeRef: current.declaredProjectRef,
          outcome: IntentAdmissionOutcome.MATERIALIZE,
          reasonCode: IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED,
          executionDisposition: IntentExecutionDisposition.LEAVE_READY,
          orderedReasonTrace: trace(policy, terminalRuleKind, reasonCode, current.rawRequestDigest),
        } satisfies IntentAdmissionDecisionProjectionInput);
    return decodeIntentAdmissionDecision(
      {
        ...base,
        decisionDigest: this.#digests.digest(intentAdmissionDecisionProjection(base)),
      },
      this.#digests,
    );
  }

  private assertMaterialFieldsEligible(
    projection: IntentProjectionRevisionRecord,
    revisions: ReadonlyMap<number, RawRequestRevisionRecord>,
    current: RawRequestRevisionRecord,
    policy: IntentAdmissionPolicy,
  ): void {
    const materialRule = policy.orderedRules.find(
      (rule) => rule.kind === IntentAdmissionPolicyRuleKind.MATERIAL_FIELD_ELIGIBILITY,
    );
    if (materialRule?.kind !== IntentAdmissionPolicyRuleKind.MATERIAL_FIELD_ELIGIBILITY) {
      throw new TypeError('Admission Policy lacks its material-field eligibility rule');
    }
    const allowedClasses = (
      field: IntentAdmissionMaterialFieldKind,
    ): ReadonlySet<SourceAuthorityClass> => {
      const rule = materialRule.fields.find((candidate) => candidate.field === field);
      if (rule === undefined) {
        throw new TypeError(`Admission Policy lacks material-field rule ${field}`);
      }
      return new Set(rule.allowedAuthorityClasses);
    };
    const allowedByProjectionField = new Map<
      IntentProjectionField,
      ReadonlySet<SourceAuthorityClass>
    >([
      [IntentProjectionField.OBJECTIVE, allowedClasses(IntentAdmissionMaterialFieldKind.OBJECTIVE)],
      [
        IntentProjectionField.REQUIRED_CRITERION,
        allowedClasses(IntentAdmissionMaterialFieldKind.REQUIRED_CRITERIA),
      ],
      [
        IntentProjectionField.PROJECT_IDENTITY,
        allowedClasses(IntentAdmissionMaterialFieldKind.PROJECT_PATH),
      ],
      [IntentProjectionField.SCOPE, new Set()],
      [IntentProjectionField.NON_GOAL, allowedClasses(IntentAdmissionMaterialFieldKind.NON_GOALS)],
      [
        IntentProjectionField.ASSUMPTION,
        allowedClasses(IntentAdmissionMaterialFieldKind.ASSUMPTIONS),
      ],
      [
        IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION,
        allowedClasses(IntentAdmissionMaterialFieldKind.REQUESTED_EXECUTION_DISPOSITION),
      ],
    ]);
    if (
      projection.sourceBindings.some(
        (binding) =>
          !allowedByProjectionField.get(binding.projectionFieldRef)?.has(binding.authorityClass),
      )
    ) {
      throw new TypeError('Projection contains a Source Binding class forbidden by policy');
    }
    const bindings = (field: IntentProjectionField) =>
      projection.sourceBindings.filter(
        (binding) =>
          binding.projectionFieldRef === field &&
          binding.authorityClass === SourceAuthorityClass.USER_STATED,
      );
    const values = (field: IntentProjectionField): readonly string[] =>
      bindings(field).map((binding) => {
        const value = exactUserBindingValue(binding, revisions);
        if (value === undefined) {
          throw new TypeError('Expected a USER_STATED Source Binding');
        }
        return value;
      });
    const objectiveValues = values(IntentProjectionField.OBJECTIVE);
    const criterionValues = values(IntentProjectionField.REQUIRED_CRITERION);
    const nonGoalValues = values(IntentProjectionField.NON_GOAL);
    const projectBinding = projection.sourceBindings.find(
      (binding) =>
        binding.projectionFieldRef === IntentProjectionField.PROJECT_IDENTITY &&
        binding.authorityClass === SourceAuthorityClass.POLICY_DERIVED,
    );
    const actionBinding = projection.sourceBindings.find(
      (binding) =>
        binding.projectionFieldRef === IntentProjectionField.REQUESTED_EXECUTION_DISPOSITION &&
        binding.authorityClass === SourceAuthorityClass.POLICY_DERIVED,
    );
    if (
      projection.objective === undefined ||
      projection.objective.trim().length === 0 ||
      !objectiveValues.includes(projection.objective) ||
      objectiveValues.some((value) => value !== projection.objective) ||
      projection.requiredCriteria.length < 1 ||
      projection.requiredCriteria.length > 16 ||
      projection.requiredCriteria.some((criterion) => !criterionValues.includes(criterion)) ||
      criterionValues.some((criterion) => !projection.requiredCriteria.includes(criterion)) ||
      projection.optionalCriteria.length !== 0 ||
      projection.scope.projectPath !== current.declaredProjectRef?.normalizedPath ||
      projection.scope.allowedPaths.length !== 0 ||
      projection.nonGoals.length > 16 ||
      projection.nonGoals.some((nonGoal) => !nonGoalValues.includes(nonGoal)) ||
      nonGoalValues.some((nonGoal) => !projection.nonGoals.includes(nonGoal)) ||
      projection.assumptions.length !== 0 ||
      projectBinding?.authorityClass !== SourceAuthorityClass.POLICY_DERIVED ||
      projectBinding.derivationPolicyRef.digest !== policy.digest ||
      actionBinding?.authorityClass !== SourceAuthorityClass.POLICY_DERIVED ||
      actionBinding.derivationPolicyRef.digest !== policy.digest ||
      projection.materialAmbiguityRefs.length !== 0
    ) {
      throw new TypeError('Projection material fields are not eligible under the exact policy');
    }
  }
}
