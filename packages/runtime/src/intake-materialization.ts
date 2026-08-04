import {
  IntakeRunStatus,
  IntakeStartDisposition,
  IntentExecutionDisposition,
  RunStatus,
  WorkflowPhase,
  commandId,
  createGoalPreservingExactText,
  createWorkflow,
  decodeGoalMaterializationRecord,
  decodeGoalStartAuthorization,
  decodeIntakeRun,
  decodeWorkflowSnapshot,
  goalMaterializationId,
  goalMaterializationProjection,
  goalRevision,
  goalStartAuthorizationId,
  goalStartAuthorizationProjection,
  intakeRunVersion,
  isoTimestamp,
  type AuditEventId,
  type CommandId,
  type ExecutionProfileBinding,
  type GoalId,
  type GoalMaterializationId,
  type GoalStartAuthorization,
  type GoalStartAuthorizationId,
  type IntakeDigestVerifier,
  type IntakeRun,
  type IntentAdmissionDecision,
  type IntentAnalysisProposal,
  type IntentProjectionRevisionRecord,
  type IsoTimestamp,
  type MaterialAmbiguitySet,
  type SuccessCriterionId,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowPolicyBinding,
} from '@codeclosure/domain';

import {
  RuntimeErrorCode,
  StoredCommandDisposition,
  assertStoredCommandOutcomeBinding,
  decodeStoredCommandOutcome,
  goalAndWorkflowCreationPayloadProjection,
  type RuntimeCommandResult,
} from './contracts.js';
import {
  IntakeAuditAggregateType,
  IntakeAuditEventType,
  type IntakeAuditWrite,
  type IntakeCommitStoreResult,
  type IntakeControlStore,
} from './intake-store.js';
import type { GovernedExecutionPreflight } from './intake-admission.js';
import type { Clock, DigestProvider, ProcessedCommandView } from './ports.js';
import type { DrivenGoalCommandResult } from './workflow-driver.js';
import type { StartGoalRequest } from './workflow-runtime.js';

export interface IntakeMaterializationIdentityGenerator {
  nextGoalId(): GoalId;
  nextWorkflowId(): WorkflowId;
  nextSuccessCriterionId(): SuccessCriterionId;
  nextGoalMaterializationId(): GoalMaterializationId;
  nextGoalStartAuthorizationId(): GoalStartAuthorizationId;
  nextCommandId(): CommandId;
  nextAuditEventId(): AuditEventId;
}

export interface MaterializeAdmittedIntakeInput {
  readonly commandId: CommandId;
  readonly intakeRun: Extract<IntakeRun, { readonly status: 'ANALYZING' }>;
  readonly proposal: IntentAnalysisProposal;
  readonly projection: IntentProjectionRevisionRecord;
  readonly ambiguitySet: MaterialAmbiguitySet;
  readonly decision: Extract<IntentAdmissionDecision, { readonly kind: 'MATERIALIZE' }>;
  readonly governedExecutionPreflight?: GovernedExecutionPreflight;
}

export interface IntakeMaterializationCapability {
  materialize(input: MaterializeAdmittedIntakeInput): IntakeCommitStoreResult;
}

export interface M25IntakeMaterializerOptions {
  readonly store: IntakeControlStore;
  readonly clock: Clock;
  readonly digests: DigestProvider & IntakeDigestVerifier;
  readonly ids: IntakeMaterializationIdentityGenerator;
}

/**
 * Trusted Runtime primitive for the atomic pre-Goal -> Goal/Workflow boundary.
 * It has no StartGoal, Worker, Candidate, Evidence, or Acceptance capability.
 */
export class M25IntakeMaterializer implements IntakeMaterializationCapability {
  readonly #store: IntakeControlStore;
  readonly #clock: Clock;
  readonly #digests: DigestProvider & IntakeDigestVerifier;
  readonly #ids: IntakeMaterializationIdentityGenerator;

  public constructor(options: M25IntakeMaterializerOptions) {
    this.#store = options.store;
    this.#clock = options.clock;
    this.#digests = options.digests;
    this.#ids = options.ids;
  }

  public materialize(input: MaterializeAdmittedIntakeInput): IntakeCommitStoreResult {
    const objective = input.projection.objective;
    if (objective === undefined) {
      throw new TypeError('Materialization requires one resolved objective');
    }
    if (
      input.decision.intakeRunId !== input.intakeRun.id ||
      input.decision.intakeRunVersion !== input.intakeRun.version ||
      input.decision.projectionBinding.intentAnalysisProposalId !== input.proposal.id ||
      input.decision.projectionBinding.intentAnalysisProposalDigest !==
        input.proposal.proposalDigest ||
      input.decision.projectionBinding.intentProjectionId !== input.projection.id ||
      input.decision.projectionBinding.intentProjectionRevision !== input.projection.revision ||
      input.decision.projectionBinding.intentProjectionDigest !==
        input.projection.projectionDigest ||
      input.ambiguitySet.intentProjectionId !== input.projection.id ||
      input.ambiguitySet.intentProjectionRevision !== input.projection.revision ||
      input.ambiguitySet.intentProjectionDigest !== input.projection.projectionDigest ||
      input.ambiguitySet.ambiguities.length !== 0 ||
      input.projection.optionalCriteria.length !== 0 ||
      input.projection.assumptions.length !== 0 ||
      input.projection.scope.projectPath !== input.decision.projectOrScopeRef.normalizedPath
    ) {
      throw new TypeError('Materialization input is not one exact current admitted Projection');
    }

    const materializedAt = this.#causalNow(
      input.intakeRun.updatedAt,
      input.proposal.observedAt,
      input.projection.createdAt,
      input.decision.decidedAt,
    );
    const goal = createGoalPreservingExactText({
      id: this.#ids.nextGoalId(),
      revision: goalRevision(1),
      objective,
      successCriteria: Object.freeze([
        ...input.projection.requiredCriteria.map((description) =>
          Object.freeze({
            id: this.#ids.nextSuccessCriterionId(),
            description,
            required: true,
          }),
        ),
      ]),
      scope: Object.freeze({
        projectPath: input.decision.projectOrScopeRef.normalizedPath,
        allowedPaths: Object.freeze([...input.projection.scope.allowedPaths]),
      }),
      nonGoals: Object.freeze([...input.projection.nonGoals]),
      createdAt: materializedAt,
    });
    const workflow = createWorkflow({
      id: this.#ids.nextWorkflowId(),
      goalId: goal.id,
      goalRevision: goal.revision,
      createdAt: materializedAt,
    });

    const materializationBase = {
      id: goalMaterializationId(this.#ids.nextGoalMaterializationId()),
      schemaVersion: 1 as const,
      intakeRunId: input.intakeRun.id,
      rawRequestRevision: input.decision.rawRequestRevision,
      rawRequestDigest: input.decision.rawRequestDigest,
      intentAdmissionDecisionId: input.decision.id,
      intentAdmissionDecisionDigest: input.decision.decisionDigest,
      intentProjectionId: input.projection.id,
      intentProjectionRevision: input.projection.revision,
      intentProjectionDigest: input.projection.projectionDigest,
      projectOrScopeRef: input.decision.projectOrScopeRef,
      goalId: goal.id,
      goalRevision: goal.revision,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      materializedAt,
    };
    const materialization = decodeGoalMaterializationRecord(
      {
        ...materializationBase,
        materializationDigest: this.#digests.digest(
          goalMaterializationProjection(materializationBase),
        ),
      },
      this.#digests,
    );

    const startAuthorization = this.#startAuthorization(
      input,
      materialization,
      workflow,
      materializedAt,
    );
    const materializedRun = decodeIntakeRun({
      ...input.intakeRun,
      version: intakeRunVersion(input.intakeRun.version + 1),
      status: IntakeRunStatus.MATERIALIZED,
      activeIntentProjectionRevision: {
        id: input.projection.id,
        revision: input.projection.revision,
        digest: input.projection.projectionDigest,
      },
      terminalDecisionRef: {
        id: input.decision.id,
        digest: input.decision.decisionDigest,
        outcome: input.decision.outcome,
        reasonCode: input.decision.reasonCode,
      },
      materializedGoalRef: {
        goalMaterializationId: materialization.id,
        materializationDigest: materialization.materializationDigest,
        goalId: goal.id,
        goalRevision: goal.revision,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
      },
      updatedAt: materializedAt,
    });
    if (materializedRun.status !== IntakeRunStatus.MATERIALIZED) {
      throw new TypeError('Materialization did not produce a terminal MATERIALIZED Intake Run');
    }

    const auditPayloads = [
      [IntakeAuditEventType.INTENT_ANALYSIS_RECORDED, input.proposal.proposalDigest],
      [IntakeAuditEventType.INTENT_PROJECTION_RECORDED, input.projection.projectionDigest],
      [IntakeAuditEventType.INTENT_ADMISSION_DECIDED, input.decision.decisionDigest],
      [IntakeAuditEventType.GOAL_MATERIALIZED, materialization.materializationDigest],
      ...(startAuthorization === undefined
        ? []
        : [
            [
              IntakeAuditEventType.GOAL_START_AUTHORIZED,
              startAuthorization.authorizationDigest,
            ] as const,
          ]),
      [IntakeAuditEventType.INTAKE_COMMAND_COMPLETED, materialization.materializationDigest],
    ] as const;
    const auditEvents: readonly IntakeAuditWrite[] = Object.freeze(
      auditPayloads.map(([eventType, payloadDigest]) =>
        Object.freeze({
          id: this.#ids.nextAuditEventId(),
          aggregateType: IntakeAuditAggregateType.INTAKE_RUN,
          aggregateId: input.intakeRun.id,
          eventType,
          payloadDigest,
          occurredAt: materializedAt,
        }),
      ),
    );

    return this.#store.commitIntakeMaterialization({
      kind: 'MATERIALIZE',
      commandId: commandId(input.commandId),
      proposal: input.proposal,
      projection: input.projection,
      ambiguitySet: input.ambiguitySet,
      decision: input.decision,
      goal,
      workflow,
      materialization,
      ...(startAuthorization === undefined ? {} : { startAuthorization }),
      intakeRun: materializedRun,
      goalAuditEventId: this.#ids.nextAuditEventId(),
      workflowAuditEventId: this.#ids.nextAuditEventId(),
      goalCreationPayloadDigest: this.#digests.digest(
        goalAndWorkflowCreationPayloadProjection(goal, workflow),
      ),
      completedAt: materializedAt,
      auditEvents,
    });
  }

  #startAuthorization(
    input: MaterializeAdmittedIntakeInput,
    materialization: ReturnType<typeof decodeGoalMaterializationRecord>,
    workflow: WorkflowInstance,
    authorizedAt: IsoTimestamp,
  ): GoalStartAuthorization | undefined {
    if (input.decision.executionDisposition === IntentExecutionDisposition.LEAVE_READY) {
      return undefined;
    }
    if (input.governedExecutionPreflight === undefined) {
      throw new TypeError('Governed Materialization requires exact Start preflight authority');
    }
    const preflight = input.governedExecutionPreflight;
    const authorizationBase = {
      id: goalStartAuthorizationId(this.#ids.nextGoalStartAuthorizationId()),
      schemaVersion: 1 as const,
      principalRef: input.intakeRun.principalRef,
      rawRequestRevision: input.decision.rawRequestRevision,
      rawRequestDigest: input.decision.rawRequestDigest,
      intentAdmissionDecisionId: input.decision.id,
      intentAdmissionDecisionDigest: input.decision.decisionDigest,
      goalMaterializationId: materialization.id,
      goalMaterializationDigest: materialization.materializationDigest,
      goalId: materialization.goalId,
      goalRevision: materialization.goalRevision,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      startCommandId: this.#ids.nextCommandId(),
      policyBundleId: preflight.workflowPolicyId,
      policyBundleDigest: preflight.workflowPolicyDigest,
      executionProfileId: preflight.executionProfileId,
      executionProfileDigest: preflight.executionProfileDigest,
      authorizedAt,
    };
    return decodeGoalStartAuthorization(
      {
        ...authorizationBase,
        authorizationDigest: this.#digests.digest(
          goalStartAuthorizationProjection(authorizationBase),
        ),
      },
      this.#digests,
    );
  }

  #causalNow(...floors: readonly IsoTimestamp[]): IsoTimestamp {
    const observed = isoTimestamp(this.#clock.now());
    return floors.reduce((latest, floor) => (floor > latest ? floor : latest), observed);
  }
}

export interface IntakeStartCompositionPort {
  startGoal(input: StartGoalRequest): Promise<DrivenGoalCommandResult>;
  getProcessedCommand(commandId: CommandId): ProcessedCommandView | undefined;
  getWorkflow(workflowId: WorkflowId): WorkflowInstance | undefined;
  getExecutionProfileBinding(workflowId: WorkflowId): ExecutionProfileBinding | undefined;
  getWorkflowPolicyBinding(workflowId: WorkflowId): WorkflowPolicyBinding | undefined;
}

export function classifyIntakeStartResult(
  driven: DrivenGoalCommandResult,
): Exclude<
  (typeof IntakeStartDisposition)[keyof typeof IntakeStartDisposition],
  typeof IntakeStartDisposition.NOT_AUTHORIZED | typeof IntakeStartDisposition.READY_PENDING_START
> {
  const result: RuntimeCommandResult = driven.command;
  if (result.status === 'APPLIED' || (result.status === 'REPLAYED' && result.output.ok)) {
    return IntakeStartDisposition.START_COMMAND_APPLIED;
  }
  if (result.status === 'REPLAYED') {
    return IntakeStartDisposition.START_COMMAND_REJECTED;
  }
  switch (result.output.error.code) {
    case RuntimeErrorCode.INVALID_STORED_OUTCOME:
    case RuntimeErrorCode.EVALUATION_FAILURE:
    case RuntimeErrorCode.PERSISTENCE_FAILURE:
    case RuntimeErrorCode.INTERNAL_FAILURE:
      return IntakeStartDisposition.START_INFRASTRUCTURE_FAILURE;
    default:
      return IntakeStartDisposition.START_COMMAND_REJECTED;
  }
}

export function readIntakeStartDisposition(
  authorization: GoalStartAuthorization | undefined,
  port:
    | Pick<
        IntakeStartCompositionPort,
        | 'getExecutionProfileBinding'
        | 'getProcessedCommand'
        | 'getWorkflow'
        | 'getWorkflowPolicyBinding'
      >
    | undefined,
): (typeof IntakeStartDisposition)[keyof typeof IntakeStartDisposition] {
  if (authorization === undefined) {
    return IntakeStartDisposition.NOT_AUTHORIZED;
  }
  if (port === undefined) {
    throw new TypeError('Authorized Intake Start status requires Workflow authority access');
  }
  const processed = port.getProcessedCommand(authorization.startCommandId);
  if (processed !== undefined) {
    if (
      processed.commandId !== authorization.startCommandId ||
      processed.aggregateType !== 'GOAL' ||
      processed.aggregateId !== authorization.goalId
    ) {
      throw new TypeError('Preallocated Start command was substituted');
    }
    const outcome = decodeStoredCommandOutcome(processed.outcome);
    assertStoredCommandOutcomeBinding(
      outcome,
      authorization.startCommandId,
      { aggregateType: 'GOAL', aggregateId: authorization.goalId },
      authorization.goalId,
      authorization.workflowId,
    );
    const appliedAsFirstStart =
      outcome.disposition === StoredCommandDisposition.APPLIED &&
      outcome.workflow.version === authorization.workflowVersion + 1 &&
      outcome.workflow.phase === WorkflowPhase.DISCOVERY &&
      outcome.workflow.runStatus === RunStatus.RUNNING;
    if (!appliedAsFirstStart) {
      return IntakeStartDisposition.START_COMMAND_REJECTED;
    }
    const policyBinding = port.getWorkflowPolicyBinding(authorization.workflowId);
    const profileBinding = port.getExecutionProfileBinding(authorization.workflowId);
    const hasExactAuthorizedBindings =
      policyBinding?.goalId === authorization.goalId &&
      policyBinding.workflowId === authorization.workflowId &&
      policyBinding.startCommandId === authorization.startCommandId &&
      policyBinding.policyBundleId === authorization.policyBundleId &&
      policyBinding.policyBundleDigest === authorization.policyBundleDigest &&
      profileBinding?.goalId === authorization.goalId &&
      profileBinding.workflowId === authorization.workflowId &&
      profileBinding.startCommandId === authorization.startCommandId &&
      profileBinding.profileId === authorization.executionProfileId &&
      profileBinding.profileDigest === authorization.executionProfileDigest;
    return hasExactAuthorizedBindings
      ? IntakeStartDisposition.START_COMMAND_APPLIED
      : IntakeStartDisposition.START_COMMAND_REJECTED;
  }
  const workflow = port.getWorkflow(authorization.workflowId);
  if (workflow === undefined) {
    throw new TypeError('Materialized Workflow authority is missing');
  }
  const current = decodeWorkflowSnapshot(workflow);
  if (
    current.goalId !== authorization.goalId ||
    current.goalRevision !== authorization.goalRevision
  ) {
    throw new TypeError('Materialized Workflow was substituted');
  }
  return current.version === authorization.workflowVersion &&
    current.phase === WorkflowPhase.DISCOVERY &&
    current.runStatus === RunStatus.READY &&
    current.activeAttemptId === undefined
    ? IntakeStartDisposition.READY_PENDING_START
    : IntakeStartDisposition.START_COMMAND_REJECTED;
}
