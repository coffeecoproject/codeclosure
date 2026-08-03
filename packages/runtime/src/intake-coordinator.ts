import { Buffer } from 'node:buffer';

import {
  IntakeCommandOperationKind,
  IntakeInteractionAction,
  IntakeRunStatus,
  IntentAdmissionDecisionKind,
  IntentAdmissionReasonCode,
  IntentProjectionField,
  clarificationAnswerBindingProjection,
  clarificationQuestionId,
  clarificationQuestionProjection,
  commandId,
  decodeClarificationAnswerBinding,
  decodeClarificationQuestion,
  decodeIntakeCommandInput,
  decodeIntakeCommandReservation,
  decodeIntakeRun,
  decodeRawRequest,
  decodeRawRequestRevision,
  intakeCommandInputProjection,
  intakeCommandReservationProjection,
  intakeRunId,
  intakeRunVersion,
  rawRequestRevision,
  rawRequestRevisionProjection,
  type AbandonmentBinding,
  type AuditEventId,
  type ClarificationAnswerBindingId,
  type ClarificationCommandBinding,
  type ClarificationQuestionId,
  type CommandId,
  type DeclaredProjectRef,
  type IntakeCommandOutcome,
  type IntakeCommandReservation,
  type IntakeDigestVerifier,
  type IntakeExternalOperationBinding,
  type IntakeManifestId,
  type IntakeManifest,
  type IntakeOperationId,
  type IntakeRun,
  type IntakeRunId,
  type IntentAdmissionDecisionId,
  type IntentAdmissionPolicy,
  type IsoTimestamp,
  type PrincipalId,
  type RawRequestId,
  type Sha256Digest,
} from '@codeclosure/domain';

import {
  M25_INTAKE_ASSISTANT_ADAPTER_ID,
  M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
  m25IntakeBudgetDefinition,
  type IntakeAssistantPort,
} from './intake-assistant.js';
import type { GovernedExecutionPreflight, IntentAdmissionEngine } from './intake-admission.js';
import type { M25IntakePackageCompiler } from './intake-packages.js';
import type {
  IntentProjectionIdentityGenerator,
  M25IntentProjectionCompiler,
} from './intake-projection.js';
import {
  IntakeAuditAggregateType,
  IntakeAuditEventType,
  type IntakeAuditWrite,
  type IntakeCommitStoreResult,
  type IntakeControlStore,
  type IntakeReservationStoreResult,
} from './intake-store.js';
import type { Clock, DigestProvider } from './ports.js';

export const M25_LOCAL_PRINCIPAL_ID = 'principal_local-user' as PrincipalId;
export const M25_LOCAL_RETENTION_PROFILE_ID = 'intake-retention_codeclosure-m2-5-local';
export const M25_LOCAL_RETENTION_PROFILE_VERSION = 'codeclosure-m2-5-local-retention-v1';

export interface IntakeCoordinatorIdentityGenerator extends IntentProjectionIdentityGenerator {
  nextRawRequestId(): RawRequestId;
  nextIntakeRunId(): IntakeRunId;
  nextIntakeManifestId(): IntakeManifestId;
  nextIntakeOperationId(): IntakeOperationId;
  nextIntentAdmissionDecisionId(): IntentAdmissionDecisionId;
  nextClarificationQuestionId(): ClarificationQuestionId;
  nextClarificationAnswerBindingId(): ClarificationAnswerBindingId;
  nextAuditEventId(): AuditEventId;
}

export interface SubmitIntakeCommand {
  readonly commandId: CommandId;
  readonly interactionAction:
    | typeof IntakeInteractionAction.ANSWER_ONLY
    | typeof IntakeInteractionAction.MATERIALIZE_ONLY
    | typeof IntakeInteractionAction.GOVERNED_EXECUTION;
  readonly admittedUserContent: string;
  readonly declaredProjectRef?: DeclaredProjectRef;
  readonly declaredConstraints?: readonly string[];
}

export interface ClarifyIntakeCommand {
  readonly commandId: CommandId;
  readonly intakeRunId: IntakeRunId;
  readonly expectedIntakeRunVersion: number;
  readonly clarificationQuestionId: ClarificationQuestionId;
  readonly answer: string;
  readonly declaredProjectRef?: DeclaredProjectRef;
}

export interface AbandonIntakeCommand {
  readonly commandId: CommandId;
  readonly intakeRunId: IntakeRunId;
  readonly expectedIntakeRunVersion: number;
}

export type IntakeCoordinatorCommandResult =
  | Readonly<{ kind: 'OUTCOME'; outcome: IntakeCommandOutcome; replayed: boolean }>
  | Readonly<{
      kind: 'IN_PROGRESS';
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      operationKind: IntakeCommandReservation['operationKind'];
    }>
  | Readonly<{
      kind: 'MATERIALIZATION_REQUIRED';
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      reasonCode:
        | typeof IntentAdmissionReasonCode.MATERIALIZE_ONLY_ADMITTED
        | typeof IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED;
    }>
  | Readonly<{ kind: 'DEFERRED_TO_SLICE_5'; operation: 'ANSWER_ONLY' | 'FAILURE' }>
  | Readonly<{ kind: 'NOT_FOUND'; intakeRunId: string }>
  | Readonly<{ kind: 'COMMAND_CONFLICT' | 'VERSION_CONFLICT'; message: string }>;

export type IntakeStatusView =
  | Readonly<{
      schemaVersion: 1;
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      status: typeof IntakeRunStatus.ANALYZING;
      operationKind?: IntakeCommandReservation['operationKind'];
    }>
  | Readonly<{
      schemaVersion: 1;
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      status: typeof IntakeRunStatus.NEEDS_CLARIFICATION;
      activeQuestion: Readonly<{
        id: ClarificationQuestionId;
        questionSpecDigest: Sha256Digest;
        questionDigest: Sha256Digest;
        issuingDecisionId: IntentAdmissionDecisionId;
        issuingDecisionDigest: Sha256Digest;
        prompt: string;
        affectedFields: readonly IntentProjectionField[];
        answerSchema: ClarificationCommandBinding['answerSchema'];
      }>;
    }>
  | Readonly<{
      schemaVersion: 1;
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      status: typeof IntakeRunStatus.NO_EXECUTION;
      reasonCode: string;
    }>
  | Readonly<{
      schemaVersion: 1;
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      status: typeof IntakeRunStatus.MATERIALIZED | typeof IntakeRunStatus.FAILED;
    }>;

interface Utf8DigestProvider extends DigestProvider, IntakeDigestVerifier {
  digestUtf8(value: string): Sha256Digest;
}

export interface M25IntakeCoordinatorOptions {
  readonly store: IntakeControlStore;
  readonly assistant: IntakeAssistantPort;
  readonly packageCompiler: M25IntakePackageCompiler;
  readonly projectionCompiler: M25IntentProjectionCompiler;
  readonly admissionEngine: IntentAdmissionEngine;
  readonly admissionPolicyId: string;
  readonly principalRef?: PrincipalId;
  readonly governedExecutionPreflight?: GovernedExecutionPreflight;
  readonly clock: Clock;
  readonly digests: Utf8DigestProvider;
  readonly ids: IntakeCoordinatorIdentityGenerator;
}

function mapStoreResult(
  result: IntakeReservationStoreResult | IntakeCommitStoreResult,
): IntakeCoordinatorCommandResult {
  switch (result.status) {
    case 'REPLAYED':
      return { kind: 'OUTCOME', outcome: result.outcome, replayed: true };
    case 'APPLIED':
      return { kind: 'OUTCOME', outcome: result.outcome, replayed: false };
    case 'ACTIVE':
    case 'RESERVED':
      return {
        kind: 'IN_PROGRESS',
        intakeRunId: result.intakeRun.id,
        intakeRunVersion: result.intakeRun.version,
        operationKind: result.reservation.operationKind,
      };
    case 'COMMAND_CONFLICT':
    case 'VERSION_CONFLICT':
      return { kind: result.status, message: result.message };
  }
}

function requireRunStatus<Status extends IntakeRun['status']>(
  run: IntakeRun,
  status: Status,
): Extract<IntakeRun, { status: Status }> {
  if (run.status !== status) {
    throw new TypeError(`Expected Intake Run status ${status}`);
  }
  return run as Extract<IntakeRun, { status: Status }>;
}

export class M25IntakeCoordinator {
  readonly #store: IntakeControlStore;
  readonly #assistant: IntakeAssistantPort;
  readonly #packageCompiler: M25IntakePackageCompiler;
  readonly #projectionCompiler: M25IntentProjectionCompiler;
  readonly #admissionEngine: IntentAdmissionEngine;
  readonly #admissionPolicyId: string;
  readonly #principalRef: PrincipalId;
  readonly #governedExecutionPreflight: GovernedExecutionPreflight | undefined;
  readonly #clock: Clock;
  readonly #digests: Utf8DigestProvider;
  readonly #ids: IntakeCoordinatorIdentityGenerator;

  public constructor(options: M25IntakeCoordinatorOptions) {
    this.#store = options.store;
    this.#assistant = options.assistant;
    this.#packageCompiler = options.packageCompiler;
    this.#projectionCompiler = options.projectionCompiler;
    this.#admissionEngine = options.admissionEngine;
    this.#admissionPolicyId = options.admissionPolicyId;
    this.#principalRef = options.principalRef ?? M25_LOCAL_PRINCIPAL_ID;
    this.#governedExecutionPreflight = options.governedExecutionPreflight;
    this.#clock = options.clock;
    this.#digests = options.digests;
    this.#ids = options.ids;
  }

  public async submit(
    raw: SubmitIntakeCommand,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<IntakeCoordinatorCommandResult> {
    commandId(raw.commandId);
    const commandBase = {
      schemaVersion: 1 as const,
      kind: 'SUBMIT' as const,
      commandId: raw.commandId,
      principalRef: this.#principalRef,
      interactionAction: raw.interactionAction,
      admittedUserContent: raw.admittedUserContent,
      ...(raw.declaredProjectRef === undefined
        ? {}
        : { declaredProjectRef: raw.declaredProjectRef }),
      declaredConstraints: raw.declaredConstraints ?? [],
    };
    const command = decodeIntakeCommandInput(
      {
        ...commandBase,
        canonicalCommandInputDigest: this.#digests.digest(
          intakeCommandInputProjection(commandBase as never),
        ),
      },
      this.#digests,
    );
    if (command.kind !== 'SUBMIT') {
      throw new TypeError('Submit command decoder returned another command kind');
    }
    const replay = this.#existingCommand(command.commandId, command.canonicalCommandInputDigest);
    if (replay !== undefined) {
      return replay;
    }
    if (
      Buffer.byteLength(command.admittedUserContent, 'utf8') >
      m25IntakeBudgetDefinition.exactRawRequestContentBytesPerRevision
    ) {
      throw new TypeError('Raw Request content exceeds the fixed Intake budget');
    }
    if (
      command.declaredConstraints.length > m25IntakeBudgetDefinition.maximumDeclaredConstraints ||
      command.declaredConstraints.some(
        (entry) =>
          Buffer.byteLength(entry, 'utf8') >
          m25IntakeBudgetDefinition.maximumDeclaredConstraintBytes,
      )
    ) {
      throw new TypeError('Raw Request constraints exceed the fixed Intake budget');
    }
    if (command.interactionAction === IntakeInteractionAction.ANSWER_ONLY) {
      return { kind: 'DEFERRED_TO_SLICE_5', operation: 'ANSWER_ONLY' };
    }
    const policy = this.#requiredPolicy();
    const createdAt = this.#clock.now();
    const rawRequestId = this.#ids.nextRawRequestId();
    const intakeRunId = this.#ids.nextIntakeRunId();
    const root = decodeRawRequest({
      schemaVersion: 1,
      id: rawRequestId,
      intakeRunId,
      createdAt,
    });
    const retentionProfile = this.#retentionProfile();
    const revisionBase = {
      schemaVersion: 1 as const,
      rawRequestId,
      intakeRunId,
      revision: rawRequestRevision(1),
      principalRef: command.principalRef,
      interactionAction: command.interactionAction,
      admittedUserContent: command.admittedUserContent,
      admittedContentDigest: this.#digests.digestUtf8(command.admittedUserContent),
      ...(command.declaredProjectRef === undefined
        ? {}
        : { declaredProjectRef: command.declaredProjectRef }),
      declaredConstraints: command.declaredConstraints,
      retentionProfile,
      submittedAt: createdAt,
    };
    const revision = decodeRawRequestRevision(
      {
        ...revisionBase,
        rawRequestDigest: this.#digests.digest(rawRequestRevisionProjection(revisionBase as never)),
      },
      this.#digests,
    );
    const analyzing = requireRunStatus(
      decodeIntakeRun({
        id: intakeRunId,
        schemaVersion: 1,
        version: intakeRunVersion(1),
        principalRef: command.principalRef,
        ...(revision.declaredProjectRef === undefined
          ? {}
          : { projectRef: revision.declaredProjectRef }),
        activeRawRequestRevision: {
          rawRequestId,
          revision: revision.revision,
          digest: revision.rawRequestDigest,
        },
        status: IntakeRunStatus.ANALYZING,
        createdAt,
        updatedAt: createdAt,
      }),
      IntakeRunStatus.ANALYZING,
    );

    try {
      const immediateDecision = this.#admissionEngine.issueDecision({
        decisionId: this.#ids.nextIntentAdmissionDecisionId(),
        decidedAt: createdAt,
        input: {
          kind: 'PRE_ANALYSIS',
          intakeRun: analyzing,
          rawRequestRevision: revision,
          admissionPolicy: policy,
        },
      });
      if (immediateDecision.reasonCode !== IntentAdmissionReasonCode.ANSWER_ONLY) {
        return this.#commitImmediateNoExecution(
          command.commandId,
          command.canonicalCommandInputDigest,
          root,
          revision,
          analyzing,
          immediateDecision,
          createdAt,
        );
      }
    } catch (error) {
      if (
        !(error instanceof TypeError) ||
        error.message !== 'Pre-analysis Admission is not dispositive for this exact input'
      ) {
        throw error;
      }
    }

    const compilation = this.#packageCompiler.compileIntentAnalysis({
      manifestId: this.#ids.nextIntakeManifestId(),
      createdAt,
      intakeRunId,
      rawRequestRevisions: [revision],
      admissionPolicy: policy,
    });
    const reservation = this.#externalReservation({
      commandId: command.commandId,
      canonicalCommandInputDigest: command.canonicalCommandInputDigest,
      rawRequestId,
      intakeRun: analyzing,
      operationKind: IntakeCommandOperationKind.INTENT_ANALYSIS,
      manifest: compilation.manifest,
      reservedAt: createdAt,
    });
    const reserved = this.#store.reserveInitialIntake({
      rawRequest: root,
      rawRequestRevision: revision,
      intakeRun: analyzing,
      manifest: compilation.manifest,
      reservation,
      auditEvents: this.#audits(
        intakeRunId,
        [
          IntakeAuditEventType.RAW_REQUEST_ADMITTED,
          IntakeAuditEventType.INTAKE_RUN_CREATED,
          IntakeAuditEventType.INTAKE_COMMAND_RESERVED,
        ],
        createdAt,
        [revision.rawRequestDigest, this.#digests.digest(analyzing), reservation.reservationDigest],
      ),
    });
    if (reserved.status !== 'RESERVED') {
      return mapStoreResult(reserved);
    }
    return this.#analyzeAndCommit({
      commandId: command.commandId,
      authority: this.#store.getIntakeAuthority(intakeRunId),
      package: compilation.package,
      manifest: compilation.manifest,
      policy,
      signal,
    });
  }

  public async clarify(
    raw: ClarifyIntakeCommand,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<IntakeCoordinatorCommandResult> {
    commandId(raw.commandId);
    const targetIntakeRunId = intakeRunId(raw.intakeRunId);
    const questionIdentifier = clarificationQuestionId(raw.clarificationQuestionId);
    const expectedIntakeRunVersion = intakeRunVersion(raw.expectedIntakeRunVersion);
    const decodeCommand = (clarificationBinding: ClarificationCommandBinding) => {
      const base = {
        schemaVersion: 1 as const,
        kind: 'CLARIFY' as const,
        commandId: raw.commandId,
        principalRef: this.#principalRef,
        intakeRunId: targetIntakeRunId,
        expectedIntakeRunVersion,
        clarificationBinding,
        answer: raw.answer,
        ...(raw.declaredProjectRef === undefined
          ? {}
          : { declaredProjectRef: raw.declaredProjectRef }),
      };
      const decoded = decodeIntakeCommandInput(
        {
          ...base,
          canonicalCommandInputDigest: this.#digests.digest(
            intakeCommandInputProjection(base as never),
          ),
        },
        this.#digests,
      );
      if (decoded.kind !== 'CLARIFY') {
        throw new TypeError('Clarification command decoder returned another command kind');
      }
      return decoded;
    };
    const existingReservation = this.#store.getIntakeCommandReservation(raw.commandId);
    if (existingReservation !== undefined) {
      if (
        existingReservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS ||
        existingReservation.intakeRunId !== targetIntakeRunId ||
        existingReservation.expectedIntakeRunVersion !== expectedIntakeRunVersion ||
        existingReservation.clarificationBinding.clarificationQuestionId !== questionIdentifier
      ) {
        return {
          kind: 'COMMAND_CONFLICT',
          message: 'Command ID is bound to another canonical input',
        };
      }
      const existingCommand = decodeCommand(existingReservation.clarificationBinding);
      const replay = this.#existingCommand(
        existingCommand.commandId,
        existingCommand.canonicalCommandInputDigest,
      );
      if (replay === undefined) {
        throw new TypeError('Existing clarification reservation disappeared during replay');
      }
      return replay;
    }
    const authority = this.#store.getIntakeAuthority(targetIntakeRunId);
    if (authority === undefined) {
      return { kind: 'NOT_FOUND', intakeRunId: targetIntakeRunId };
    }
    const question = authority.questions.find(({ id }) => id === questionIdentifier);
    if (question === undefined) {
      return {
        kind: 'VERSION_CONFLICT',
        message: 'Clarification Question is not retained by the target Intake Run',
      };
    }
    const clarificationBinding: ClarificationCommandBinding = {
      clarificationQuestionId: question.id,
      questionSpecDigest: question.questionSpecDigest,
      questionDigest: question.questionDigest,
      issuingClarifyDecisionId: question.intentAdmissionDecisionId,
      issuingClarifyDecisionDigest: question.intentAdmissionDecisionDigest,
      answerSchema: question.answerSchema,
    };
    const command = decodeCommand(clarificationBinding);
    const run = authority.intakeRun;
    if (
      run.status !== IntakeRunStatus.NEEDS_CLARIFICATION ||
      run.version !== command.expectedIntakeRunVersion ||
      run.principalRef !== command.principalRef ||
      run.activeQuestionRef.clarificationQuestionId !== question.id ||
      run.activeQuestionRef.questionSpecDigest !== question.questionSpecDigest ||
      run.activeQuestionRef.questionDigest !== question.questionDigest ||
      run.activeQuestionRef.issuingDecisionId !== question.intentAdmissionDecisionId ||
      run.activeQuestionRef.issuingDecisionDigest !== question.intentAdmissionDecisionDigest
    ) {
      return {
        kind: 'VERSION_CONFLICT',
        message: 'Clarification does not target current NEEDS_CLARIFICATION authority',
      };
    }
    if (
      Buffer.byteLength(command.answer, 'utf8') >
      m25IntakeBudgetDefinition.exactClarificationAnswerBytesPerRevision
    ) {
      throw new TypeError('Clarification answer exceeds the fixed Intake budget');
    }
    const isProjectQuestion =
      question.affectedFields.length === 1 &&
      question.affectedFields[0] === IntentProjectionField.PROJECT_IDENTITY &&
      question.answerSchema.kind === 'PROJECT_PATH';
    if (command.declaredProjectRef !== undefined && !isProjectQuestion) {
      const rejectedAt = this.#clock.now();
      const reservationBase = {
        schemaVersion: 1 as const,
        commandId: command.commandId,
        operationKind: IntakeCommandOperationKind.CLARIFICATION_ANALYSIS,
        principalRef: command.principalRef,
        rawRequestId: run.activeRawRequestRevision.rawRequestId,
        intakeRunId: run.id,
        canonicalCommandInputDigest: command.canonicalCommandInputDigest,
        observedIntakeRunVersion: run.version,
        expectedIntakeRunVersion: command.expectedIntakeRunVersion,
        operationId: this.#ids.nextIntakeOperationId(),
        clarificationBinding: command.clarificationBinding,
        reservedAt: rejectedAt,
      };
      const reservation = decodeIntakeCommandReservation(
        {
          ...reservationBase,
          reservationDigest: this.#digests.digest(
            intakeCommandReservationProjection(reservationBase as never),
          ),
        },
        this.#digests,
      );
      return mapStoreResult(
        this.#store.commitIntakeCommandRejection({
          reservation,
          observedIntakeRun: run,
          detailCode: 'PROJECT_CORRECTION_REQUIRES_PROJECT_IDENTITY_QUESTION',
          completedAt: rejectedAt,
          auditEvents: this.#audits(
            run.id,
            [IntakeAuditEventType.INTAKE_COMMAND_REJECTED],
            rejectedAt,
            [reservation.reservationDigest],
          ),
        }),
      );
    }
    const priorRevision = authority.rawRequestRevisions.at(-1);
    if (priorRevision === undefined) {
      throw new TypeError('Clarification has no current Raw Request revision');
    }
    const policy = this.#requiredPolicy();
    const reservedAt = this.#clock.now();
    const nextRevisionNumber = rawRequestRevision(priorRevision.revision + 1);
    const declaredProjectRef = command.declaredProjectRef ?? priorRevision.declaredProjectRef;
    const revisionBase = {
      schemaVersion: 1 as const,
      rawRequestId: priorRevision.rawRequestId,
      intakeRunId: run.id,
      revision: nextRevisionNumber,
      parentRevision: priorRevision.revision,
      answeredQuestionBinding: {
        clarificationQuestionId: question.id,
        questionSpecDigest: question.questionSpecDigest,
        questionDigest: question.questionDigest,
        intentAdmissionDecisionId: question.intentAdmissionDecisionId,
        intentAdmissionDecisionDigest: question.intentAdmissionDecisionDigest,
      },
      principalRef: priorRevision.principalRef,
      interactionAction: priorRevision.interactionAction,
      admittedUserContent: command.answer,
      admittedContentDigest: this.#digests.digestUtf8(command.answer),
      ...(declaredProjectRef === undefined ? {} : { declaredProjectRef }),
      declaredConstraints: priorRevision.declaredConstraints,
      retentionProfile: priorRevision.retentionProfile,
      submittedAt: reservedAt,
    };
    const revision = decodeRawRequestRevision(
      {
        ...revisionBase,
        rawRequestDigest: this.#digests.digest(rawRequestRevisionProjection(revisionBase as never)),
      },
      this.#digests,
    );
    const nextRun = requireRunStatus(
      decodeIntakeRun({
        id: run.id,
        schemaVersion: 1,
        version: intakeRunVersion(run.version + 1),
        principalRef: run.principalRef,
        ...(declaredProjectRef === undefined ? {} : { projectRef: declaredProjectRef }),
        activeRawRequestRevision: {
          rawRequestId: revision.rawRequestId,
          revision: revision.revision,
          digest: revision.rawRequestDigest,
        },
        ...(run.activeIntentProjectionRevision === undefined
          ? {}
          : { activeIntentProjectionRevision: run.activeIntentProjectionRevision }),
        status: IntakeRunStatus.ANALYZING,
        createdAt: run.createdAt,
        updatedAt: reservedAt,
      }),
      IntakeRunStatus.ANALYZING,
    );
    const answerBindingBase = {
      id: this.#ids.nextClarificationAnswerBindingId(),
      schemaVersion: 1 as const,
      intakeRunId: run.id,
      clarificationQuestionId: question.id,
      questionSpecDigest: question.questionSpecDigest,
      questionDigest: question.questionDigest,
      intentAdmissionDecisionId: question.intentAdmissionDecisionId,
      intentAdmissionDecisionDigest: question.intentAdmissionDecisionDigest,
      rawRequestId: revision.rawRequestId,
      rawRequestRevision: revision.revision,
      rawRequestDigest: revision.rawRequestDigest,
      commandId: command.commandId,
      canonicalCommandInputDigest: command.canonicalCommandInputDigest,
      answeredAt: reservedAt,
    };
    const answerBinding = decodeClarificationAnswerBinding(
      {
        ...answerBindingBase,
        answerBindingDigest: this.#digests.digest(
          clarificationAnswerBindingProjection(answerBindingBase as never),
        ),
      },
      this.#digests,
    );
    const compilation = this.#packageCompiler.compileIntentAnalysis({
      manifestId: this.#ids.nextIntakeManifestId(),
      createdAt: reservedAt,
      intakeRunId: run.id,
      rawRequestRevisions: [...authority.rawRequestRevisions, revision],
      clarificationQuestions: authority.questions,
      clarificationAnswerBindings: [...authority.answerBindings, answerBinding],
      activeQuestionRefs: [],
      admissionPolicy: policy,
    });
    const reservationBase = {
      schemaVersion: 1 as const,
      commandId: command.commandId,
      operationKind: IntakeCommandOperationKind.CLARIFICATION_ANALYSIS,
      principalRef: command.principalRef,
      rawRequestId: revision.rawRequestId,
      intakeRunId: run.id,
      canonicalCommandInputDigest: command.canonicalCommandInputDigest,
      observedIntakeRunVersion: nextRun.version,
      expectedIntakeRunVersion: command.expectedIntakeRunVersion,
      operationId: this.#ids.nextIntakeOperationId(),
      clarificationBinding: command.clarificationBinding,
      externalOperationBinding: this.#externalBinding(compilation.manifest, policy),
      reservedAt,
    };
    const reservation = decodeIntakeCommandReservation(
      {
        ...reservationBase,
        reservationDigest: this.#digests.digest(
          intakeCommandReservationProjection(reservationBase as never),
        ),
      },
      this.#digests,
    );
    if (reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS) {
      throw new TypeError('Clarification reservation kind was substituted');
    }
    const reserved = this.#store.reserveClarificationIntake({
      rawRequestRevision: revision,
      answerBinding,
      intakeRun: nextRun,
      manifest: compilation.manifest,
      reservation,
      auditEvents: this.#audits(
        run.id,
        [
          IntakeAuditEventType.RAW_REQUEST_ADMITTED,
          IntakeAuditEventType.CLARIFICATION_ANSWER_BOUND,
          IntakeAuditEventType.INTAKE_COMMAND_RESERVED,
        ],
        reservedAt,
        [
          revision.rawRequestDigest,
          answerBinding.answerBindingDigest,
          reservation.reservationDigest,
        ],
      ),
    });
    if (reserved.status !== 'RESERVED') {
      return mapStoreResult(reserved);
    }
    return this.#analyzeAndCommit({
      commandId: command.commandId,
      authority: this.#store.getIntakeAuthority(run.id),
      package: compilation.package,
      manifest: compilation.manifest,
      policy,
      signal,
      parentProjection: authority.projections.find(
        (projection) =>
          projection.id === run.activeIntentProjectionRevision?.id &&
          projection.revision === run.activeIntentProjectionRevision.revision,
      ),
    });
  }

  public abandon(raw: AbandonIntakeCommand): IntakeCoordinatorCommandResult {
    const commandBase = {
      schemaVersion: 1 as const,
      kind: 'ABANDON' as const,
      commandId: raw.commandId,
      principalRef: this.#principalRef,
      intakeRunId: raw.intakeRunId,
      expectedIntakeRunVersion: intakeRunVersion(raw.expectedIntakeRunVersion),
    };
    const command = decodeIntakeCommandInput(
      {
        ...commandBase,
        canonicalCommandInputDigest: this.#digests.digest(
          intakeCommandInputProjection(commandBase as never),
        ),
      },
      this.#digests,
    );
    if (command.kind !== 'ABANDON') {
      throw new TypeError('Abandon command decoder returned another command kind');
    }
    const replay = this.#existingCommand(command.commandId, command.canonicalCommandInputDigest);
    if (replay !== undefined) {
      return replay;
    }
    const authority = this.#store.getIntakeAuthority(command.intakeRunId);
    if (authority === undefined) {
      return { kind: 'NOT_FOUND', intakeRunId: command.intakeRunId };
    }
    const run = authority.intakeRun;
    const reservedAt = this.#clock.now();
    const eligible =
      run.status === IntakeRunStatus.NEEDS_CLARIFICATION &&
      run.version === command.expectedIntakeRunVersion &&
      run.principalRef === command.principalRef;
    const reservation = this.#abandonReservation(command, run, reservedAt, eligible);
    if (
      !eligible ||
      reservation.operationKind !== IntakeCommandOperationKind.ABANDON_CLARIFICATION ||
      !('abandonClarificationBinding' in reservation)
    ) {
      return mapStoreResult(
        this.#store.commitIntakeCommandRejection({
          reservation,
          observedIntakeRun: run,
          detailCode: 'ABANDONMENT_NOT_ELIGIBLE',
          completedAt: reservedAt,
          auditEvents: this.#audits(
            run.id,
            [IntakeAuditEventType.INTAKE_COMMAND_REJECTED],
            reservedAt,
            [reservation.reservationDigest],
          ),
        }),
      );
    }
    const currentProjection = authority.projections.find(
      ({ id, revision }) =>
        id === run.activeIntentProjectionRevision?.id &&
        revision === run.activeIntentProjectionRevision.revision,
    );
    const proposal = authority.proposals.find(
      ({ id }) => id === currentProjection?.intentAnalysisProposalRef.id,
    );
    const ambiguitySet = authority.ambiguitySets.find(
      ({ intentProjectionId, intentProjectionRevision: revision }) =>
        intentProjectionId === currentProjection?.id && revision === currentProjection.revision,
    );
    const currentRevision = authority.rawRequestRevisions.at(-1);
    if (
      currentProjection === undefined ||
      proposal === undefined ||
      ambiguitySet === undefined ||
      currentRevision === undefined
    ) {
      throw new TypeError('Eligible abandonment lacks exact projected authority');
    }
    const policy = this.#requiredPolicy();
    const intentAnalysisIdentity = this.#proposalAnalysisIdentity(authority, proposal);
    const abandonmentBinding: AbandonmentBinding = {
      ...reservation.abandonClarificationBinding,
      commandId: command.commandId,
      canonicalCommandInputDigest: command.canonicalCommandInputDigest,
    };
    const decision = this.#admissionEngine.issueDecision({
      decisionId: this.#ids.nextIntentAdmissionDecisionId(),
      decidedAt: reservedAt,
      input: {
        kind: 'PROJECTED',
        intakeRun: run,
        rawRequestRevision: currentRevision,
        rawRequestRevisions: authority.rawRequestRevisions,
        admissionPolicy: policy,
        intentAnalysisIdentity,
        intentAnalysisProposal: proposal,
        intentProjection: currentProjection,
        materialAmbiguitySet: ambiguitySet,
        abandonmentBinding,
        ...(currentRevision.declaredProjectRef === undefined
          ? {}
          : { projectOrScopeRef: currentRevision.declaredProjectRef }),
      },
    });
    if (decision.kind !== IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION) {
      throw new TypeError('Abandonment did not produce PROJECTED_NO_EXECUTION');
    }
    const nextRun = requireRunStatus(
      decodeIntakeRun({
        id: run.id,
        schemaVersion: 1,
        version: intakeRunVersion(run.version + 1),
        principalRef: run.principalRef,
        ...(run.projectRef === undefined ? {} : { projectRef: run.projectRef }),
        activeRawRequestRevision: run.activeRawRequestRevision,
        ...(run.activeIntentProjectionRevision === undefined
          ? {}
          : { activeIntentProjectionRevision: run.activeIntentProjectionRevision }),
        status: IntakeRunStatus.NO_EXECUTION,
        terminalDecisionRef: {
          id: decision.id,
          digest: decision.decisionDigest,
          outcome: decision.outcome,
          reasonCode: decision.reasonCode,
        },
        createdAt: run.createdAt,
        updatedAt: reservedAt,
      }),
      IntakeRunStatus.NO_EXECUTION,
    );
    return mapStoreResult(
      this.#store.commitIntakeNoExecution({
        kind: 'ABANDONMENT',
        reservation,
        decision,
        intakeRun: nextRun,
        completedAt: reservedAt,
        auditEvents: this.#audits(
          run.id,
          [
            IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
            IntakeAuditEventType.INTAKE_RUN_UPDATED,
            IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
          ],
          reservedAt,
          [decision.decisionDigest, this.#digests.digest(nextRun), decision.decisionDigest],
        ),
      }),
    );
  }

  public getStatus(intakeRunIdentifier: string): IntakeStatusView | undefined {
    const authority = this.#store.getIntakeAuthority(intakeRunIdentifier);
    if (authority === undefined) {
      return undefined;
    }
    const run = authority.intakeRun;
    if (run.status === IntakeRunStatus.NEEDS_CLARIFICATION) {
      const question = authority.questions.find(
        ({ id }) => id === run.activeQuestionRef.clarificationQuestionId,
      );
      if (question === undefined) {
        throw new TypeError('Active Intake Question is missing');
      }
      return {
        schemaVersion: 1,
        intakeRunId: run.id,
        intakeRunVersion: run.version,
        status: run.status,
        activeQuestion: {
          id: question.id,
          questionSpecDigest: question.questionSpecDigest,
          questionDigest: question.questionDigest,
          issuingDecisionId: question.intentAdmissionDecisionId,
          issuingDecisionDigest: question.intentAdmissionDecisionDigest,
          prompt: question.prompt,
          affectedFields: question.affectedFields,
          answerSchema: question.answerSchema,
        },
      };
    }
    if (run.status === IntakeRunStatus.NO_EXECUTION) {
      return {
        schemaVersion: 1,
        intakeRunId: run.id,
        intakeRunVersion: run.version,
        status: run.status,
        reasonCode: run.terminalDecisionRef.reasonCode,
      };
    }
    return {
      schemaVersion: 1,
      intakeRunId: run.id,
      intakeRunVersion: run.version,
      status: run.status,
      ...(run.status === IntakeRunStatus.ANALYZING
        ? {
            operationKind: authority.reservations.find(
              ({ observedIntakeRunVersion }) => observedIntakeRunVersion === run.version,
            )?.operationKind,
          }
        : {}),
    } as IntakeStatusView;
  }

  async #analyzeAndCommit(input: {
    readonly commandId: CommandId;
    readonly authority: ReturnType<IntakeControlStore['getIntakeAuthority']>;
    readonly package: Parameters<IntakeAssistantPort['analyze']>[0]['package'];
    readonly manifest: Parameters<IntakeAssistantPort['analyze']>[0]['manifest'];
    readonly policy: IntentAdmissionPolicy;
    readonly signal: AbortSignal;
    readonly parentProjection?: Parameters<
      M25IntentProjectionCompiler['project']
    >[0]['currentProjection'];
  }): Promise<IntakeCoordinatorCommandResult> {
    if (input.authority === undefined) {
      throw new TypeError('Reserved Intake authority disappeared before analysis');
    }
    const reservation = input.authority.reservations.find(
      ({ commandId: reservedCommandId }) => reservedCommandId === input.commandId,
    );
    if (
      reservation === undefined ||
      !('externalOperationBinding' in reservation) ||
      reservation.externalOperationBinding.manifestId !== input.manifest.id ||
      reservation.externalOperationBinding.manifestDigest !== input.manifest.manifestDigest
    ) {
      throw new TypeError('Analysis does not bind the exact retained reservation and Manifest');
    }
    const intentAnalysisIdentity = this.#analysisIdentity(reservation.externalOperationBinding);
    const operation = await this.#assistant.analyze(
      { package: input.package, manifest: input.manifest },
      input.signal,
    );
    if (operation.kind === 'FAILED') {
      return { kind: 'DEFERRED_TO_SLICE_5', operation: 'FAILURE' };
    }
    const observedAt = this.#clock.now();
    const projected = this.#projectionCompiler.project({
      intakeRunId: input.authority.intakeRun.id,
      rawRequestRevisions: input.authority.rawRequestRevisions,
      ...(input.parentProjection === undefined
        ? {}
        : { currentProjection: input.parentProjection }),
      admissionPolicy: input.policy,
      responseContractDigest: input.manifest.responseContract.digest,
      response: operation.response,
      observedAt,
      ids: this.#ids,
    });
    const questionId =
      projected.clarificationQuestionSpec === undefined
        ? undefined
        : this.#ids.nextClarificationQuestionId();
    const currentRevision = input.authority.rawRequestRevisions.at(-1);
    if (currentRevision === undefined) {
      throw new TypeError('Reserved Intake has no current Raw Request revision');
    }
    const decision = this.#admissionEngine.issueDecision({
      decisionId: this.#ids.nextIntentAdmissionDecisionId(),
      decidedAt: observedAt,
      input: {
        kind: 'PROJECTED',
        intakeRun: input.authority.intakeRun,
        rawRequestRevision: currentRevision,
        rawRequestRevisions: input.authority.rawRequestRevisions,
        admissionPolicy: input.policy,
        intentAnalysisIdentity,
        intentAnalysisProposal: projected.proposal,
        intentProjection: projected.projection,
        materialAmbiguitySet: projected.ambiguitySet,
        ...(projected.clarificationQuestionSpec === undefined
          ? {}
          : { clarificationQuestionSpec: projected.clarificationQuestionSpec }),
        ...(questionId === undefined ? {} : { clarificationQuestionId: questionId }),
        ...(currentRevision.declaredProjectRef === undefined
          ? {}
          : { projectOrScopeRef: currentRevision.declaredProjectRef }),
        ...(this.#governedExecutionPreflight === undefined
          ? {}
          : { governedExecutionPreflight: this.#governedExecutionPreflight }),
      },
    });
    if (decision.kind === IntentAdmissionDecisionKind.MATERIALIZE) {
      return {
        kind: 'MATERIALIZATION_REQUIRED',
        intakeRunId: input.authority.intakeRun.id,
        intakeRunVersion: input.authority.intakeRun.version,
        reasonCode: decision.reasonCode,
      };
    }
    if (
      decision.kind !== IntentAdmissionDecisionKind.CLARIFY ||
      projected.clarificationQuestionSpec === undefined ||
      questionId === undefined
    ) {
      throw new TypeError('Slice 4 analysis produced an unsupported projected disposition');
    }
    const questionBase = {
      id: questionId,
      schemaVersion: 1 as const,
      intakeRunId: decision.intakeRunId,
      intentAdmissionDecisionId: decision.id,
      intentAdmissionDecisionDigest: decision.decisionDigest,
      basedOnProjectionRevision: projected.projection.revision,
      ambiguityRef: projected.clarificationQuestionSpec.ambiguityRef,
      prompt: projected.clarificationQuestionSpec.prompt,
      affectedFields: projected.clarificationQuestionSpec.affectedFields,
      answerSchema: projected.clarificationQuestionSpec.answerSchema,
      questionSpecDigest: projected.clarificationQuestionSpec.questionSpecDigest,
      createdAt: observedAt,
    };
    const question = decodeClarificationQuestion(
      {
        ...questionBase,
        questionDigest: this.#digests.digest(
          clarificationQuestionProjection(questionBase as never),
        ),
      },
      this.#digests,
    );
    const nextRun = requireRunStatus(
      decodeIntakeRun({
        id: input.authority.intakeRun.id,
        schemaVersion: 1,
        version: intakeRunVersion(input.authority.intakeRun.version + 1),
        principalRef: input.authority.intakeRun.principalRef,
        ...(input.authority.intakeRun.projectRef === undefined
          ? {}
          : { projectRef: input.authority.intakeRun.projectRef }),
        activeRawRequestRevision: input.authority.intakeRun.activeRawRequestRevision,
        activeIntentProjectionRevision: {
          id: projected.projection.id,
          revision: projected.projection.revision,
          digest: projected.projection.projectionDigest,
        },
        status: IntakeRunStatus.NEEDS_CLARIFICATION,
        activeQuestionRef: {
          clarificationQuestionId: question.id,
          questionSpecDigest: question.questionSpecDigest,
          questionDigest: question.questionDigest,
          issuingDecisionId: decision.id,
          issuingDecisionDigest: decision.decisionDigest,
        },
        createdAt: input.authority.intakeRun.createdAt,
        updatedAt: observedAt,
      }),
      IntakeRunStatus.NEEDS_CLARIFICATION,
    );
    return mapStoreResult(
      this.#store.commitAnalyzedIntake({
        kind: 'CLARIFY',
        commandId: input.commandId,
        proposal: projected.proposal,
        projection: projected.projection,
        ambiguitySet: projected.ambiguitySet,
        decision,
        questionSpec: projected.clarificationQuestionSpec,
        question,
        intakeRun: nextRun,
        completedAt: observedAt,
        auditEvents: this.#audits(
          nextRun.id,
          [
            IntakeAuditEventType.INTENT_ANALYSIS_RECORDED,
            IntakeAuditEventType.INTENT_PROJECTION_RECORDED,
            IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
            IntakeAuditEventType.CLARIFICATION_QUESTION_ACTIVATED,
            IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
          ],
          observedAt,
          [
            projected.proposal.proposalDigest,
            projected.projection.projectionDigest,
            decision.decisionDigest,
            question.questionDigest,
            decision.decisionDigest,
          ],
        ),
      }),
    );
  }

  #requiredPolicy() {
    const policy = this.#store.getIntentAdmissionPolicy(this.#admissionPolicyId);
    if (policy === undefined) {
      throw new TypeError(`Required Admission Policy ${this.#admissionPolicyId} is not installed`);
    }
    return policy;
  }

  #retentionProfile() {
    const definition = {
      schemaVersion: 1 as const,
      id: M25_LOCAL_RETENTION_PROFILE_ID,
      version: M25_LOCAL_RETENTION_PROFILE_VERSION,
      exactRawRequestContentBytesPerRevision:
        m25IntakeBudgetDefinition.exactRawRequestContentBytesPerRevision,
      exactClarificationAnswerBytesPerRevision:
        m25IntakeBudgetDefinition.exactClarificationAnswerBytesPerRevision,
    };
    return {
      id: definition.id,
      version: definition.version,
      digest: this.#digests.digest(definition),
    };
  }

  #existingCommand(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
  ): IntakeCoordinatorCommandResult | undefined {
    const outcome = this.#store.getIntakeCommandOutcome(commandIdentifier);
    if (outcome !== undefined) {
      return outcome.canonicalCommandInputDigest === inputDigest
        ? { kind: 'OUTCOME', outcome, replayed: true }
        : { kind: 'COMMAND_CONFLICT', message: 'Command ID is bound to another canonical input' };
    }
    const reservation = this.#store.getIntakeCommandReservation(commandIdentifier);
    if (reservation === undefined) {
      return undefined;
    }
    return reservation.canonicalCommandInputDigest === inputDigest
      ? {
          kind: 'IN_PROGRESS',
          intakeRunId: reservation.intakeRunId,
          intakeRunVersion: reservation.observedIntakeRunVersion,
          operationKind: reservation.operationKind,
        }
      : { kind: 'COMMAND_CONFLICT', message: 'Command ID is bound to another canonical input' };
  }

  #externalBinding(manifest: IntakeManifest, policy: IntentAdmissionPolicy) {
    return {
      manifestId: manifest.id,
      manifestDigest: manifest.manifestDigest,
      admissionPolicyId: policy.id,
      admissionPolicyVersion: policy.version,
      admissionPolicyDigest: policy.digest,
      assistantAdapterId: M25_INTAKE_ASSISTANT_ADAPTER_ID,
      assistantAdapterVersion: M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
      responseContractDigest: manifest.responseContract.digest,
    };
  }

  #analysisIdentity(binding: IntakeExternalOperationBinding) {
    return Object.freeze({
      assistantAdapterId: binding.assistantAdapterId,
      assistantAdapterVersion: binding.assistantAdapterVersion,
      responseContractDigest: binding.responseContractDigest,
    });
  }

  #proposalAnalysisIdentity(
    authority: NonNullable<ReturnType<IntakeControlStore['getIntakeAuthority']>>,
    proposal: NonNullable<
      ReturnType<IntakeControlStore['getIntakeAuthority']>
    >['proposals'][number],
  ) {
    const decisionIds = new Set(
      authority.decisions.flatMap((decision) =>
        'projectionBinding' in decision &&
        decision.projectionBinding.intentAnalysisProposalId === proposal.id &&
        decision.projectionBinding.intentAnalysisProposalDigest === proposal.proposalDigest
          ? [decision.id]
          : [],
      ),
    );
    const bindings = authority.outcomes.flatMap((outcome) => {
      const result = outcome.result;
      if (!('decisionRef' in result) || !decisionIds.has(result.decisionRef.id)) {
        return [];
      }
      const reservation = authority.reservations.find(
        ({ commandId: reservedCommandId }) => reservedCommandId === outcome.commandId,
      );
      return reservation !== undefined && 'externalOperationBinding' in reservation
        ? [reservation.externalOperationBinding]
        : [];
    });
    const binding = bindings[0];
    if (bindings.length !== 1 || binding === undefined) {
      throw new TypeError('Proposal does not have one exact originating analysis operation');
    }
    return this.#analysisIdentity(binding);
  }

  #externalReservation(input: {
    readonly commandId: CommandId;
    readonly canonicalCommandInputDigest: Sha256Digest;
    readonly rawRequestId: RawRequestId;
    readonly intakeRun: Extract<IntakeRun, { status: 'ANALYZING' }>;
    readonly operationKind: typeof IntakeCommandOperationKind.INTENT_ANALYSIS;
    readonly manifest: IntakeManifest;
    readonly reservedAt: IsoTimestamp;
  }) {
    const policy = this.#requiredPolicy();
    const base = {
      schemaVersion: 1 as const,
      commandId: input.commandId,
      operationKind: input.operationKind,
      principalRef: input.intakeRun.principalRef,
      rawRequestId: input.rawRequestId,
      intakeRunId: input.intakeRun.id,
      canonicalCommandInputDigest: input.canonicalCommandInputDigest,
      observedIntakeRunVersion: input.intakeRun.version,
      operationId: this.#ids.nextIntakeOperationId(),
      externalOperationBinding: this.#externalBinding(input.manifest, policy),
      reservedAt: input.reservedAt,
    };
    const reservation = decodeIntakeCommandReservation(
      {
        ...base,
        reservationDigest: this.#digests.digest(intakeCommandReservationProjection(base as never)),
      },
      this.#digests,
    );
    if (reservation.operationKind !== IntakeCommandOperationKind.INTENT_ANALYSIS) {
      throw new TypeError('Initial reservation kind was substituted');
    }
    return reservation;
  }

  #abandonReservation(
    command: Extract<ReturnType<typeof decodeIntakeCommandInput>, { kind: 'ABANDON' }>,
    run: IntakeRun,
    reservedAt: IsoTimestamp,
    eligible: boolean,
  ) {
    const base = {
      schemaVersion: 1 as const,
      commandId: command.commandId,
      operationKind: IntakeCommandOperationKind.ABANDON_CLARIFICATION,
      principalRef: command.principalRef,
      rawRequestId: run.activeRawRequestRevision.rawRequestId,
      intakeRunId: run.id,
      canonicalCommandInputDigest: command.canonicalCommandInputDigest,
      observedIntakeRunVersion: run.version,
      expectedIntakeRunVersion: command.expectedIntakeRunVersion,
      operationId: this.#ids.nextIntakeOperationId(),
      ...(eligible && run.status === IntakeRunStatus.NEEDS_CLARIFICATION
        ? {
            abandonClarificationBinding: {
              clarificationQuestionId: run.activeQuestionRef.clarificationQuestionId,
              questionSpecDigest: run.activeQuestionRef.questionSpecDigest,
              questionDigest: run.activeQuestionRef.questionDigest,
              issuingClarifyDecisionId: run.activeQuestionRef.issuingDecisionId,
              issuingClarifyDecisionDigest: run.activeQuestionRef.issuingDecisionDigest,
            },
          }
        : {}),
      reservedAt,
    };
    return decodeIntakeCommandReservation(
      {
        ...base,
        reservationDigest: this.#digests.digest(intakeCommandReservationProjection(base as never)),
      },
      this.#digests,
    );
  }

  #commitImmediateNoExecution(
    commandIdentifier: CommandId,
    canonicalCommandInputDigest: Sha256Digest,
    root: ReturnType<typeof decodeRawRequest>,
    revision: ReturnType<typeof decodeRawRequestRevision>,
    analyzing: Extract<IntakeRun, { status: 'ANALYZING' }>,
    decision: ReturnType<IntentAdmissionEngine['issueDecision']>,
    completedAt: IsoTimestamp,
  ): IntakeCoordinatorCommandResult {
    if (decision.kind !== IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION) {
      throw new TypeError('Immediate NO_EXECUTION requires a pre-analysis Decision');
    }
    const run = requireRunStatus(
      decodeIntakeRun({
        ...analyzing,
        status: IntakeRunStatus.NO_EXECUTION,
        terminalDecisionRef: {
          id: decision.id,
          digest: decision.decisionDigest,
          outcome: decision.outcome,
          reasonCode: decision.reasonCode,
        },
      }),
      IntakeRunStatus.NO_EXECUTION,
    );
    const base = {
      schemaVersion: 1 as const,
      commandId: commandIdentifier,
      operationKind: IntakeCommandOperationKind.IMMEDIATE_NO_EXECUTION,
      principalRef: run.principalRef,
      rawRequestId: root.id,
      intakeRunId: run.id,
      canonicalCommandInputDigest,
      observedIntakeRunVersion: run.version,
      operationId: this.#ids.nextIntakeOperationId(),
      reservedAt: completedAt,
    };
    const reservation = decodeIntakeCommandReservation(
      {
        ...base,
        reservationDigest: this.#digests.digest(intakeCommandReservationProjection(base as never)),
      },
      this.#digests,
    );
    if (reservation.operationKind !== IntakeCommandOperationKind.IMMEDIATE_NO_EXECUTION) {
      throw new TypeError('Immediate NO_EXECUTION reservation kind was substituted');
    }
    return mapStoreResult(
      this.#store.commitIntakeNoExecution({
        kind: 'IMMEDIATE',
        rawRequest: root,
        rawRequestRevision: revision,
        reservation,
        decision,
        intakeRun: run,
        completedAt,
        auditEvents: this.#audits(
          run.id,
          [
            IntakeAuditEventType.RAW_REQUEST_ADMITTED,
            IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
            IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
          ],
          completedAt,
          [revision.rawRequestDigest, decision.decisionDigest, decision.decisionDigest],
        ),
      }),
    );
  }

  #audits(
    intakeRunId: IntakeRunId,
    eventTypes: readonly (typeof IntakeAuditEventType)[keyof typeof IntakeAuditEventType][],
    occurredAt: IsoTimestamp,
    payloadDigests: readonly Sha256Digest[],
  ): readonly IntakeAuditWrite[] {
    return eventTypes.map((eventType, index) => ({
      id: this.#ids.nextAuditEventId(),
      aggregateType: IntakeAuditAggregateType.INTAKE_RUN,
      aggregateId: intakeRunId,
      eventType,
      payloadDigest: payloadDigests[index] ?? this.#digests.digest({ eventType }),
      occurredAt,
    }));
  }
}
