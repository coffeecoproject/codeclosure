import { Buffer } from 'node:buffer';

import {
  AnswerOnlyFailureReasonCode,
  AnswerOnlyResponseKind,
  IntakeFailedOperation,
  IntakeFailureReasonCode,
  IntakeCommandOperationKind,
  IntakeInteractionAction,
  IntakeRunStatus,
  IntakeStartDisposition,
  IntentAdmissionDecisionKind,
  IntentAdmissionReasonCode,
  IntentProjectionField,
  clarificationAnswerBindingProjection,
  clarificationQuestionId,
  clarificationQuestionProjection,
  commandId,
  decodeAnswerOnlyResponse,
  decodeClarificationAnswerBinding,
  decodeClarificationQuestion,
  decodeIntakeCommandInput,
  decodeIntakeCommandReservation,
  decodeIntakeFailureRecord,
  decodeIntakeRun,
  decodeRawRequest,
  decodeRawRequestRevision,
  intakeCommandInputProjection,
  intakeCommandReservationProjection,
  intakeFailureRecordProjection,
  intakeRunId,
  intakeRunVersion,
  intentAdmissionDecisionId,
  isoTimestamp,
  rawRequestRevision,
  rawRequestRevisionProjection,
  answerOnlyResponseProjection,
  type AbandonmentBinding,
  type AuditEventId,
  type AnswerOnlyResponseId,
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
  type IntakeFailureRecordId,
  type IntakeManifest,
  type IntakeOperationId,
  type IntakeRun,
  type IntakeRunId,
  type IntentAdmissionDecisionId,
  type IntentAdmissionPolicy,
  type IsoTimestamp,
  type GoalStartAuthorizationId,
  type PrincipalId,
  type RawRequestId,
  type Sha256Digest,
} from '@codeclosure/domain';

import {
  M25_INTAKE_ASSISTANT_ADAPTER_ID,
  M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
  M251_INTAKE_ASSISTANT_ADAPTER_VERSION,
  m25IntakeBudgetDefinition,
  type IntakeAssistantFailureReasonCode,
  type IntakeAssistantPort,
} from './intake-assistant.js';
import type { GovernedExecutionPreflight, IntentAdmissionEngine } from './intake-admission.js';
import type { IntakePackageCompilerPort } from './intake-packages.js';
import type {
  IntentProjectionIdentityGenerator,
  M25IntentProjectionCompiler,
} from './intake-projection.js';
import { IntakeAnalysisResponseRejectedError } from './intake-projection.js';
import {
  classifyM25IntakeRetainedText,
  firstRejectedM25IntentAnalysisString,
  rejectedM25AnswerOnlyString,
  type M25IntakeRetentionRejectionReason,
} from './intake-retention.js';
import {
  IntakeAuditAggregateType,
  IntakeAuditEventType,
  type IntakeAuditWrite,
  type IntakeAuditRecord,
  type IntakeCommitStoreResult,
  type IntakeControlStore,
  type IntakeReservationStoreResult,
} from './intake-store.js';
import type { Clock, DigestProvider } from './ports.js';
import {
  M25IntakeMaterializer,
  classifyIntakeStartResult,
  readIntakeStartDisposition,
  type IntakeMaterializationCapability,
  type IntakeMaterializationIdentityGenerator,
  type IntakeStartCompositionPort,
} from './intake-materialization.js';

export const M25_LOCAL_PRINCIPAL_ID = 'principal_local-user' as PrincipalId;
export const M25_LOCAL_RETENTION_PROFILE_ID = 'intake-retention_codeclosure-m2-5-local';
export const M25_LOCAL_RETENTION_PROFILE_VERSION = 'codeclosure-m2-5-local-retention-v1';

/** Strict public-adapter parser for the Intake Run identity accepted by CLI commands. */
export function parseIntakeRunIdentifier(value: string): IntakeRunId {
  return intakeRunId(value);
}

/** Strict public-adapter parser for the current clarification Question identity. */
export function parseClarificationQuestionIdentifier(value: string): ClarificationQuestionId {
  return clarificationQuestionId(value);
}

export interface IntakeCoordinatorIdentityGenerator
  extends IntentProjectionIdentityGenerator, IntakeMaterializationIdentityGenerator {
  nextRawRequestId(): RawRequestId;
  nextIntakeRunId(): IntakeRunId;
  nextIntakeManifestId(): IntakeManifestId;
  nextIntakeOperationId(): IntakeOperationId;
  nextIntentAdmissionDecisionId(): IntentAdmissionDecisionId;
  nextClarificationQuestionId(): ClarificationQuestionId;
  nextClarificationAnswerBindingId(): ClarificationAnswerBindingId;
  nextAnswerOnlyResponseId(): AnswerOnlyResponseId;
  nextIntakeFailureRecordId(): IntakeFailureRecordId;
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
  | Readonly<{
      kind: 'OUTCOME';
      outcome: IntakeCommandOutcome;
      replayed: boolean;
      startDisposition: (typeof IntakeStartDisposition)[keyof typeof IntakeStartDisposition];
      answerOnlyContent?: string;
    }>
  | Readonly<{
      kind: 'IN_PROGRESS';
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      operationKind: IntakeCommandReservation['operationKind'];
    }>
  | Readonly<{
      kind: 'CONTENT_REJECTED';
      commandId: CommandId;
      retentionProfileId: typeof M25_LOCAL_RETENTION_PROFILE_ID;
      retentionProfileVersion: typeof M25_LOCAL_RETENTION_PROFILE_VERSION;
      reasonCode: M25IntakeRetentionRejectionReason;
      observedByteCount: number;
      rejectionDigest: Sha256Digest;
    }>
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
      answerOnlyResponse?: Readonly<{
        id: AnswerOnlyResponseId;
        digest: Sha256Digest;
        kind: AnswerOnlyResponseKind;
        failureReasonCode?: AnswerOnlyFailureReasonCode;
      }>;
    }>
  | Readonly<{
      schemaVersion: 1;
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      status: typeof IntakeRunStatus.MATERIALIZED;
      materializedGoalRef: Extract<
        IntakeRun,
        { readonly status: typeof IntakeRunStatus.MATERIALIZED }
      >['materializedGoalRef'];
      goalStartAuthorizationRef?: Readonly<{
        id: GoalStartAuthorizationId;
        digest: Sha256Digest;
        startCommandId: CommandId;
      }>;
      startDisposition: (typeof IntakeStartDisposition)[keyof typeof IntakeStartDisposition];
    }>
  | Readonly<{
      schemaVersion: 1;
      intakeRunId: IntakeRunId;
      intakeRunVersion: number;
      status: typeof IntakeRunStatus.FAILED;
      failure: Readonly<{
        id: IntakeFailureRecordId;
        digest: Sha256Digest;
        failedOperation: IntakeFailedOperation;
        reasonCode: IntakeFailureReasonCode;
        retryDisposition: 'NEW_INTAKE_RUN_REQUIRED';
      }>;
    }>;

export interface IntakeAuditView {
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly events: readonly Readonly<{
    id: AuditEventId;
    sequence: number;
    eventType: string;
    commandId?: CommandId;
    beforeVersion?: number;
    afterVersion?: number;
    payloadDigest: Sha256Digest;
    occurredAt: IsoTimestamp;
  }>[];
  readonly questionHistory: readonly Readonly<{
    id: ClarificationQuestionId;
    questionSpecDigest: Sha256Digest;
    questionDigest: Sha256Digest;
    issuingDecisionId: IntentAdmissionDecisionId;
    issuingDecisionDigest: Sha256Digest;
    answerSchema: ClarificationCommandBinding['answerSchema'];
    answerBinding?: Readonly<{
      id: ClarificationAnswerBindingId;
      digest: Sha256Digest;
      commandId: CommandId;
      rawRequestId: RawRequestId;
      rawRequestRevision: number;
      rawRequestDigest: Sha256Digest;
      answeredAt: IsoTimestamp;
    }>;
  }>[];
}

export interface M25IntakeStartupRecoverySummary {
  readonly scanned: number;
  readonly reconciledAnalysisFailures: number;
  readonly reconciledAnswerFailures: number;
}

interface Utf8DigestProvider extends DigestProvider, IntakeDigestVerifier {
  digestUtf8(value: string): Sha256Digest;
}

export interface M25IntakeCoordinatorOptions {
  readonly store: IntakeControlStore;
  readonly assistant: IntakeAssistantPort;
  readonly packageCompiler: IntakePackageCompilerPort;
  readonly projectionCompiler: M25IntentProjectionCompiler;
  readonly admissionEngine: IntentAdmissionEngine;
  readonly admissionPolicyId: string;
  readonly principalRef?: PrincipalId;
  readonly governedExecutionPreflight?: GovernedExecutionPreflight;
  readonly clock: Clock;
  readonly digests: Utf8DigestProvider;
  readonly ids: IntakeCoordinatorIdentityGenerator;
  readonly materializer?: IntakeMaterializationCapability;
  readonly startComposition?: IntakeStartCompositionPort;
}

function mapStoreResult(
  result: IntakeReservationStoreResult | IntakeCommitStoreResult,
): IntakeCoordinatorCommandResult {
  switch (result.status) {
    case 'REPLAYED':
      return {
        kind: 'OUTCOME',
        outcome: result.outcome,
        replayed: true,
        startDisposition:
          'startDisposition' in result.outcome.result
            ? result.outcome.result.startDisposition
            : IntakeStartDisposition.NOT_AUTHORIZED,
      };
    case 'APPLIED':
      return {
        kind: 'OUTCOME',
        outcome: result.outcome,
        replayed: false,
        startDisposition:
          'startDisposition' in result.outcome.result
            ? result.outcome.result.startDisposition
            : IntakeStartDisposition.NOT_AUTHORIZED,
      };
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
  readonly #packageCompiler: IntakePackageCompilerPort;
  readonly #projectionCompiler: M25IntentProjectionCompiler;
  readonly #admissionEngine: IntentAdmissionEngine;
  readonly #admissionPolicyId: string;
  readonly #principalRef: PrincipalId;
  readonly #governedExecutionPreflight: GovernedExecutionPreflight | undefined;
  readonly #clock: Clock;
  readonly #digests: Utf8DigestProvider;
  readonly #ids: IntakeCoordinatorIdentityGenerator;
  readonly #materializer: IntakeMaterializationCapability;
  readonly #startComposition: IntakeStartCompositionPort | undefined;

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
    this.#materializer =
      options.materializer ??
      new M25IntakeMaterializer({
        store: options.store,
        clock: options.clock,
        digests: options.digests,
        ids: options.ids,
      });
    this.#startComposition = options.startComposition;
    if (this.#governedExecutionPreflight !== undefined && this.#startComposition === undefined) {
      throw new TypeError('Governed execution preflight requires ordinary StartGoal composition');
    }
  }

  public async submit(
    raw: SubmitIntakeCommand,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<IntakeCoordinatorCommandResult> {
    const commandIdentifier = commandId(raw.commandId);
    for (const value of [raw.admittedUserContent, ...(raw.declaredConstraints ?? [])]) {
      const retention = classifyM25IntakeRetainedText(value);
      if (!retention.accepted) {
        return this.#contentRejected(commandIdentifier, retention);
      }
    }
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
          intakeCommandInputProjection(commandBase),
        ),
      },
      this.#digests,
    );
    if (command.kind !== 'SUBMIT') {
      throw new TypeError('Submit command decoder returned another command kind');
    }
    const replay = this.#existingCommand(command.commandId, command.canonicalCommandInputDigest);
    if (replay !== undefined) {
      return this.#composeStartForResult(replay);
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
        rawRequestDigest: this.#digests.digest(rawRequestRevisionProjection(revisionBase)),
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

    let answerOnlyDecision:
      | Extract<
          ReturnType<IntentAdmissionEngine['issueDecision']>,
          { kind: typeof IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION }
        >
      | undefined;
    try {
      const immediateDecision = this.#admissionEngine.issueDecision({
        decisionId:
          command.interactionAction === IntakeInteractionAction.ANSWER_ONLY
            ? this.#answerOnlyDecisionId(command.canonicalCommandInputDigest)
            : this.#ids.nextIntentAdmissionDecisionId(),
        decidedAt: createdAt,
        input: {
          kind: 'PRE_ANALYSIS',
          intakeRun: analyzing,
          rawRequestRevision: revision,
          admissionPolicy: policy,
        },
      });
      if (immediateDecision.reasonCode === IntentAdmissionReasonCode.ANSWER_ONLY) {
        answerOnlyDecision = immediateDecision;
      } else {
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

    if (command.interactionAction === IntakeInteractionAction.ANSWER_ONLY) {
      if (answerOnlyDecision === undefined) {
        throw new TypeError('Answer-only pre-analysis Decision was not produced');
      }
      const compilation = this.#packageCompiler.compileAnswerOnly({
        manifestId: this.#ids.nextIntakeManifestId(),
        createdAt,
        intakeRunId,
        rawRequestRevision: revision,
        preparedDecision: answerOnlyDecision,
        admissionPolicy: policy,
      });
      const reservation = this.#externalReservation({
        commandId: command.commandId,
        canonicalCommandInputDigest: command.canonicalCommandInputDigest,
        rawRequestId,
        intakeRun: analyzing,
        operationKind: IntakeCommandOperationKind.ANSWER_ONLY,
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
          [
            revision.rawRequestDigest,
            this.#digests.digest(analyzing),
            reservation.reservationDigest,
          ],
        ),
      });
      if (reserved.status !== 'RESERVED') {
        return mapStoreResult(reserved);
      }
      return this.#answerAndCommit({
        commandId: command.commandId,
        authority: this.#store.getIntakeAuthority(intakeRunId),
        package: compilation.package,
        manifest: compilation.manifest,
        decision: answerOnlyDecision,
        signal,
      });
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
    const commandIdentifier = commandId(raw.commandId);
    const retention = classifyM25IntakeRetainedText(raw.answer);
    if (!retention.accepted) {
      return this.#contentRejected(commandIdentifier, retention);
    }
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
          canonicalCommandInputDigest: this.#digests.digest(intakeCommandInputProjection(base)),
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
      return this.#composeStartForResult(replay);
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
            intakeCommandReservationProjection(reservationBase),
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
        rawRequestDigest: this.#digests.digest(rawRequestRevisionProjection(revisionBase)),
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
          clarificationAnswerBindingProjection(answerBindingBase),
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
          intakeCommandReservationProjection(reservationBase),
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
          intakeCommandInputProjection(commandBase),
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

  /**
   * Reconciles non-resumable Intake operations after strict Store validation.
   * Composition must call this before publishing any Intake capability.
   */
  public reconcileStartup(): M25IntakeStartupRecoverySummary {
    const orphanIds = this.#store.listOrphanedIntakeRunIds();
    let reconciledAnalysisFailures = 0;
    let reconciledAnswerFailures = 0;
    for (const orphanId of orphanIds) {
      const authority = this.#store.getIntakeAuthority(orphanId);
      if (authority?.intakeRun.status !== IntakeRunStatus.ANALYZING) {
        throw new TypeError(`Orphaned Intake Run ${orphanId} is not reproducible`);
      }
      const activeReservations = authority.reservations.filter(
        (reservation) =>
          reservation.observedIntakeRunVersion === authority.intakeRun.version &&
          authority.outcomes.every((outcome) => outcome.commandId !== reservation.commandId),
      );
      const reservation = activeReservations[0];
      if (
        activeReservations.length !== 1 ||
        reservation === undefined ||
        !('externalOperationBinding' in reservation)
      ) {
        throw new TypeError(`Orphaned Intake Run ${orphanId} has no unique external reservation`);
      }
      if (reservation.operationKind === IntakeCommandOperationKind.ANSWER_ONLY) {
        this.#reconcileInterruptedAnswer(authority, reservation);
        reconciledAnswerFailures += 1;
      } else {
        const result = this.#commitAnalysisFailure(
          reservation.commandId,
          authority,
          reservation,
          IntakeFailureReasonCode.INTERRUPTED_ANALYSIS,
        );
        if (result.kind !== 'OUTCOME' || result.outcome.disposition !== 'FAILED') {
          throw new TypeError(`Orphaned Intake Run ${orphanId} did not close as FAILED`);
        }
        reconciledAnalysisFailures += 1;
      }
    }
    return {
      scanned: orphanIds.length,
      reconciledAnalysisFailures,
      reconciledAnswerFailures,
    };
  }

  #reconcileInterruptedAnswer(
    authority: NonNullable<ReturnType<IntakeControlStore['getIntakeAuthority']>>,
    reservation: IntakeCommandReservation,
  ): void {
    if (
      reservation.operationKind !== IntakeCommandOperationKind.ANSWER_ONLY ||
      !('externalOperationBinding' in reservation)
    ) {
      throw new TypeError('Interrupted Answer-only reservation shape is invalid');
    }
    const revision = authority.rawRequestRevisions.at(-1);
    const manifest = authority.manifests.find(
      ({ id }) => id === reservation.externalOperationBinding.manifestId,
    );
    const policy = this.#store.getIntentAdmissionPolicy(
      reservation.externalOperationBinding.admissionPolicyId,
    );
    if (
      revision === undefined ||
      manifest === undefined ||
      policy?.version !== reservation.externalOperationBinding.admissionPolicyVersion ||
      policy.digest !== reservation.externalOperationBinding.admissionPolicyDigest
    ) {
      throw new TypeError('Interrupted Answer-only input is not reproducible');
    }
    const decidedAt = this.#causalNow(
      revision.submittedAt,
      reservation.reservedAt,
      authority.intakeRun.updatedAt,
    );
    const decision = this.#admissionEngine.issueDecision({
      decisionId: this.#answerOnlyDecisionId(reservation.canonicalCommandInputDigest),
      decidedAt,
      input: {
        kind: 'PRE_ANALYSIS',
        intakeRun: authority.intakeRun,
        rawRequestRevision: revision,
        admissionPolicy: policy,
      },
    });
    if (
      decision.kind !== IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION ||
      decision.reasonCode !== IntentAdmissionReasonCode.ANSWER_ONLY
    ) {
      throw new TypeError('Interrupted Answer-only Decision cannot be reproduced');
    }
    const compilation = this.#packageCompiler.recompileAnswerOnly(
      {
        manifestId: manifest.id,
        createdAt: manifest.createdAt,
        intakeRunId: authority.intakeRun.id,
        rawRequestRevision: revision,
        preparedDecision: decision,
        admissionPolicy: policy,
        omissions: manifest.omissions,
      },
      manifest,
    );
    if (
      compilation.manifest.manifestDigest !== manifest.manifestDigest ||
      compilation.manifest.packageDigest !== manifest.packageDigest ||
      compilation.package.preparedDecisionBinding.decisionDigest !== decision.decisionDigest
    ) {
      throw new TypeError('Interrupted Answer-only Package cannot be reproduced');
    }
    const responseBase = {
      id: this.#ids.nextAnswerOnlyResponseId(),
      schemaVersion: 1 as const,
      intakeRunId: authority.intakeRun.id,
      rawRequestRevision: revision.revision,
      rawRequestDigest: revision.rawRequestDigest,
      intentAdmissionDecisionId: decision.id,
      intentAdmissionDecisionDigest: decision.decisionDigest,
      assistantAdapterId: reservation.externalOperationBinding.assistantAdapterId,
      assistantAdapterVersion: reservation.externalOperationBinding.assistantAdapterVersion,
      responseContractDigest: reservation.externalOperationBinding.responseContractDigest,
      kind: AnswerOnlyResponseKind.ANSWER_FAILED,
      failureReasonCode: AnswerOnlyFailureReasonCode.INTERRUPTED_ANSWER_DELIVERY,
      observedAt: decidedAt,
    };
    const response = decodeAnswerOnlyResponse(
      {
        ...responseBase,
        responseDigest: this.#digests.digest(answerOnlyResponseProjection(responseBase)),
      },
      this.#digests,
    );
    const terminalRun = requireRunStatus(
      decodeIntakeRun({
        ...authority.intakeRun,
        version: intakeRunVersion(authority.intakeRun.version + 1),
        status: IntakeRunStatus.NO_EXECUTION,
        terminalDecisionRef: {
          id: decision.id,
          digest: decision.decisionDigest,
          outcome: decision.outcome,
          reasonCode: decision.reasonCode,
        },
        answerOnlyResponseRef: {
          id: response.id,
          digest: response.responseDigest,
          kind: response.kind,
        },
        updatedAt: decidedAt,
      }),
      IntakeRunStatus.NO_EXECUTION,
    );
    const result = mapStoreResult(
      this.#store.commitIntakeNoExecution({
        kind: 'ANSWER_ONLY',
        commandId: reservation.commandId,
        decision,
        response,
        intakeRun: terminalRun,
        completedAt: decidedAt,
        auditEvents: this.#audits(
          terminalRun.id,
          [
            IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
            IntakeAuditEventType.ANSWER_ONLY_RESPONSE_RECORDED,
            IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
          ],
          decidedAt,
          [decision.decisionDigest, response.responseDigest, response.responseDigest],
        ),
      }),
    );
    if (result.kind !== 'OUTCOME' || result.outcome.disposition !== 'APPLIED') {
      throw new TypeError('Interrupted Answer-only operation did not close as APPLIED');
    }
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
      const response =
        'answerOnlyResponseRef' in run
          ? authority.answerOnlyResponses.find(({ id }) => id === run.answerOnlyResponseRef.id)
          : undefined;
      if ('answerOnlyResponseRef' in run && response === undefined) {
        throw new TypeError('Terminal Answer-only Response is missing');
      }
      return {
        schemaVersion: 1,
        intakeRunId: run.id,
        intakeRunVersion: run.version,
        status: run.status,
        reasonCode: run.terminalDecisionRef.reasonCode,
        ...(response === undefined
          ? {}
          : {
              answerOnlyResponse: {
                id: response.id,
                digest: response.responseDigest,
                kind: response.kind,
                ...(response.kind === AnswerOnlyResponseKind.ANSWER_FAILED
                  ? { failureReasonCode: response.failureReasonCode }
                  : {}),
              },
            }),
      };
    }
    if (run.status === IntakeRunStatus.FAILED) {
      const failure = authority.failures.find(({ id }) => id === run.terminalFailureRef.id);
      if (failure === undefined) {
        throw new TypeError('Terminal Intake Failure is missing');
      }
      return {
        schemaVersion: 1,
        intakeRunId: run.id,
        intakeRunVersion: run.version,
        status: run.status,
        failure: {
          id: failure.id,
          digest: failure.failureDigest,
          failedOperation: failure.failedOperation,
          reasonCode: failure.reasonCode,
          retryDisposition: failure.retryDisposition,
        },
      };
    }
    if (run.status === IntakeRunStatus.MATERIALIZED) {
      const materialization = authority.materialization;
      if (
        materialization?.id !== run.materializedGoalRef.goalMaterializationId ||
        materialization.materializationDigest !== run.materializedGoalRef.materializationDigest
      ) {
        throw new TypeError('Terminal Intake Materialization authority is missing');
      }
      const startAuthorization = authority.startAuthorization;
      return {
        schemaVersion: 1,
        intakeRunId: run.id,
        intakeRunVersion: run.version,
        status: run.status,
        materializedGoalRef: run.materializedGoalRef,
        ...(startAuthorization === undefined
          ? {}
          : {
              goalStartAuthorizationRef: {
                id: startAuthorization.id,
                digest: startAuthorization.authorizationDigest,
                startCommandId: startAuthorization.startCommandId,
              },
            }),
        startDisposition: readIntakeStartDisposition(startAuthorization, this.#startComposition),
      };
    }
    const operationKind = authority.reservations.find(
      ({ observedIntakeRunVersion }) => observedIntakeRunVersion === run.version,
    )?.operationKind;
    return {
      schemaVersion: 1,
      intakeRunId: run.id,
      intakeRunVersion: run.version,
      status: run.status,
      ...(operationKind === undefined ? {} : { operationKind }),
    };
  }

  public getAudit(intakeRunIdentifier: string): IntakeAuditView | undefined {
    const authority = this.#store.getIntakeAuthority(intakeRunIdentifier);
    if (authority === undefined) {
      return undefined;
    }
    return {
      schemaVersion: 1,
      intakeRunId: authority.intakeRun.id,
      events: Object.freeze(
        this.#store.getIntakeAudit(authority.intakeRun.id).map((event: IntakeAuditRecord) => ({
          id: event.id,
          sequence: event.sequence,
          eventType: event.eventType,
          ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
          ...(event.beforeVersion === undefined ? {} : { beforeVersion: event.beforeVersion }),
          ...(event.afterVersion === undefined ? {} : { afterVersion: event.afterVersion }),
          payloadDigest: event.payloadDigest,
          occurredAt: event.occurredAt,
        })),
      ),
      questionHistory: Object.freeze(
        authority.questions.map((question) => {
          const binding = authority.answerBindings.find(
            ({ clarificationQuestionId: questionId }) => questionId === question.id,
          );
          return {
            id: question.id,
            questionSpecDigest: question.questionSpecDigest,
            questionDigest: question.questionDigest,
            issuingDecisionId: question.intentAdmissionDecisionId,
            issuingDecisionDigest: question.intentAdmissionDecisionDigest,
            answerSchema: question.answerSchema,
            ...(binding === undefined
              ? {}
              : {
                  answerBinding: {
                    id: binding.id,
                    digest: binding.answerBindingDigest,
                    commandId: binding.commandId,
                    rawRequestId: binding.rawRequestId,
                    rawRequestRevision: binding.rawRequestRevision,
                    rawRequestDigest: binding.rawRequestDigest,
                    answeredAt: binding.answeredAt,
                  },
                }),
          };
        }),
      ),
    };
  }

  async #answerAndCommit(input: {
    readonly commandId: CommandId;
    readonly authority: ReturnType<IntakeControlStore['getIntakeAuthority']>;
    readonly package: Parameters<IntakeAssistantPort['answer']>[0]['package'];
    readonly manifest: Parameters<IntakeAssistantPort['answer']>[0]['manifest'];
    readonly decision: Extract<
      ReturnType<IntentAdmissionEngine['issueDecision']>,
      { kind: typeof IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION }
    >;
    readonly signal: AbortSignal;
  }): Promise<IntakeCoordinatorCommandResult> {
    if (input.authority === undefined) {
      throw new TypeError('Reserved Answer-only authority disappeared before delivery');
    }
    const reservation = input.authority.reservations.find(
      ({ commandId: reservedCommandId }) => reservedCommandId === input.commandId,
    );
    const revision = input.authority.rawRequestRevisions.at(-1);
    if (
      reservation?.operationKind !== IntakeCommandOperationKind.ANSWER_ONLY ||
      revision === undefined ||
      reservation.externalOperationBinding.manifestId !== input.manifest.id ||
      reservation.externalOperationBinding.manifestDigest !== input.manifest.manifestDigest ||
      input.decision.reasonCode !== IntentAdmissionReasonCode.ANSWER_ONLY
    ) {
      throw new TypeError('Answer-only delivery does not bind exact retained authority');
    }
    const operation = await this.#assistant.answer(
      { package: input.package, manifest: input.manifest },
      input.signal,
    );
    const observedAt = this.#causalNow(
      input.authority.intakeRun.updatedAt,
      input.decision.decidedAt,
      reservation.reservedAt,
    );
    const common = {
      id: this.#ids.nextAnswerOnlyResponseId(),
      schemaVersion: 1 as const,
      intakeRunId: input.authority.intakeRun.id,
      rawRequestRevision: revision.revision,
      rawRequestDigest: revision.rawRequestDigest,
      intentAdmissionDecisionId: input.decision.id,
      intentAdmissionDecisionDigest: input.decision.decisionDigest,
      assistantAdapterId: reservation.externalOperationBinding.assistantAdapterId,
      assistantAdapterVersion: reservation.externalOperationBinding.assistantAdapterVersion,
      responseContractDigest: reservation.externalOperationBinding.responseContractDigest,
      observedAt,
    };
    const retainedRejection =
      operation.kind === 'COMPLETED' ? rejectedM25AnswerOnlyString(operation.response) : undefined;
    const answerTooLarge =
      operation.kind === 'COMPLETED' &&
      Buffer.byteLength(operation.response.answerContent, 'utf8') >
        m25IntakeBudgetDefinition.maximumRetainedAnswerContentBytes;
    const responseBase =
      operation.kind === 'COMPLETED' && retainedRejection === undefined && !answerTooLarge
        ? {
            ...common,
            kind: AnswerOnlyResponseKind.ANSWER_RETURNED,
            answerContent: operation.response.answerContent,
            answerContentDigest: this.#digests.digestUtf8(operation.response.answerContent),
          }
        : {
            ...common,
            kind: AnswerOnlyResponseKind.ANSWER_FAILED,
            failureReasonCode:
              operation.kind === 'FAILED'
                ? operation.failureReasonCode
                : AnswerOnlyFailureReasonCode.RESPONSE_REJECTED,
          };
    const response = decodeAnswerOnlyResponse(
      {
        ...responseBase,
        responseDigest: this.#digests.digest(answerOnlyResponseProjection(responseBase)),
      },
      this.#digests,
    );
    const terminalRun = requireRunStatus(
      decodeIntakeRun({
        ...input.authority.intakeRun,
        version: intakeRunVersion(input.authority.intakeRun.version + 1),
        status: IntakeRunStatus.NO_EXECUTION,
        terminalDecisionRef: {
          id: input.decision.id,
          digest: input.decision.decisionDigest,
          outcome: input.decision.outcome,
          reasonCode: input.decision.reasonCode,
        },
        answerOnlyResponseRef: {
          id: response.id,
          digest: response.responseDigest,
          kind: response.kind,
        },
        updatedAt: observedAt,
      }),
      IntakeRunStatus.NO_EXECUTION,
    );
    const committed = this.#store.commitIntakeNoExecution({
      kind: 'ANSWER_ONLY',
      commandId: input.commandId,
      decision: input.decision,
      response,
      intakeRun: terminalRun,
      completedAt: observedAt,
      auditEvents: this.#audits(
        terminalRun.id,
        [
          IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
          IntakeAuditEventType.ANSWER_ONLY_RESPONSE_RECORDED,
          IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
        ],
        observedAt,
        [input.decision.decisionDigest, response.responseDigest, response.responseDigest],
      ),
    });
    return committed.status === 'APPLIED' || committed.status === 'REPLAYED'
      ? this.#outcomeResult(committed.outcome, committed.status === 'REPLAYED')
      : mapStoreResult(committed);
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
      (reservation.operationKind !== IntakeCommandOperationKind.INTENT_ANALYSIS &&
        reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS) ||
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
      return this.#commitAnalysisFailure(
        input.commandId,
        input.authority,
        reservation,
        this.#analysisFailureReason(operation.failureReasonCode),
      );
    }
    if (firstRejectedM25IntentAnalysisString(operation.response) !== undefined) {
      return this.#commitAnalysisFailure(
        input.commandId,
        input.authority,
        reservation,
        IntakeFailureReasonCode.RESPONSE_REJECTED,
      );
    }
    const observedAt = this.#causalNow(input.authority.intakeRun.updatedAt, reservation.reservedAt);
    let projected: ReturnType<M25IntentProjectionCompiler['project']>;
    try {
      projected = this.#projectionCompiler.project({
        intakeRunId: input.authority.intakeRun.id,
        rawRequestRevisions: input.authority.rawRequestRevisions,
        ...(input.parentProjection === undefined
          ? {}
          : { currentProjection: input.parentProjection }),
        admissionPolicy: input.policy,
        intentAnalysisIdentity,
        response: operation.response,
        observedAt,
        ids: this.#ids,
      });
    } catch (error) {
      if (error instanceof IntakeAnalysisResponseRejectedError) {
        return this.#commitAnalysisFailure(
          input.commandId,
          input.authority,
          reservation,
          IntakeFailureReasonCode.RESPONSE_REJECTED,
          observedAt,
        );
      }
      throw error;
    }
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
      const committed = this.#materializer.materialize({
        commandId: input.commandId,
        intakeRun: requireRunStatus(input.authority.intakeRun, IntakeRunStatus.ANALYZING),
        proposal: projected.proposal,
        projection: projected.projection,
        ambiguitySet: projected.ambiguitySet,
        decision,
        ...(this.#governedExecutionPreflight === undefined
          ? {}
          : { governedExecutionPreflight: this.#governedExecutionPreflight }),
      });
      if (committed.status !== 'APPLIED' && committed.status !== 'REPLAYED') {
        return mapStoreResult(committed);
      }
      return this.#composeMaterializedStart(committed.outcome, committed.status === 'REPLAYED');
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
        questionDigest: this.#digests.digest(clarificationQuestionProjection(questionBase)),
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

  #commitAnalysisFailure(
    commandIdentifier: CommandId,
    authority: NonNullable<ReturnType<IntakeControlStore['getIntakeAuthority']>>,
    reservation: IntakeCommandReservation,
    reasonCode: IntakeFailureReasonCode,
    observedFailureAt?: IsoTimestamp,
  ): IntakeCoordinatorCommandResult {
    const revision = authority.rawRequestRevisions.at(-1);
    if (
      revision === undefined ||
      !('externalOperationBinding' in reservation) ||
      (reservation.operationKind !== IntakeCommandOperationKind.INTENT_ANALYSIS &&
        reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS)
    ) {
      throw new TypeError('Failed analysis has no exact retained source authority');
    }
    const failedAt =
      observedFailureAt ?? this.#causalNow(authority.intakeRun.updatedAt, reservation.reservedAt);
    const failureBase = {
      id: this.#ids.nextIntakeFailureRecordId(),
      schemaVersion: 1 as const,
      commandId: commandIdentifier,
      intakeRunId: authority.intakeRun.id,
      intakeRunVersion: authority.intakeRun.version,
      rawRequestRevision: revision.revision,
      rawRequestDigest: revision.rawRequestDigest,
      failedOperation: IntakeFailedOperation.INTENT_ANALYSIS,
      assistantAdapterId: reservation.externalOperationBinding.assistantAdapterId,
      assistantAdapterVersion: reservation.externalOperationBinding.assistantAdapterVersion,
      responseContractDigest: reservation.externalOperationBinding.responseContractDigest,
      reasonCode,
      retryDisposition: 'NEW_INTAKE_RUN_REQUIRED' as const,
      failedAt,
    };
    const failure = decodeIntakeFailureRecord(
      {
        ...failureBase,
        failureDigest: this.#digests.digest(intakeFailureRecordProjection(failureBase)),
      },
      this.#digests,
    );
    const terminalRun = requireRunStatus(
      decodeIntakeRun({
        ...authority.intakeRun,
        version: intakeRunVersion(authority.intakeRun.version + 1),
        status: IntakeRunStatus.FAILED,
        terminalFailureRef: { id: failure.id, digest: failure.failureDigest },
        updatedAt: failedAt,
      }),
      IntakeRunStatus.FAILED,
    );
    return mapStoreResult(
      this.#store.commitIntakeFailure({
        commandId: commandIdentifier,
        failure,
        intakeRun: terminalRun,
        completedAt: failedAt,
        auditEvents: this.#audits(
          terminalRun.id,
          [
            IntakeAuditEventType.INTAKE_FAILURE_RECORDED,
            IntakeAuditEventType.INTAKE_RUN_UPDATED,
            IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
          ],
          failedAt,
          [failure.failureDigest, this.#digests.digest(terminalRun), failure.failureDigest],
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

  #contentRejected(
    commandIdentifier: CommandId,
    classification: Readonly<{
      reasonCode: M25IntakeRetentionRejectionReason;
      observedByteCount: number;
    }>,
  ): IntakeCoordinatorCommandResult {
    const projection = {
      schemaVersion: 1 as const,
      commandId: commandIdentifier,
      retentionProfileId: M25_LOCAL_RETENTION_PROFILE_ID,
      retentionProfileVersion: M25_LOCAL_RETENTION_PROFILE_VERSION,
      reasonCode: classification.reasonCode,
      observedByteCount: classification.observedByteCount,
    } as const;
    return {
      kind: 'CONTENT_REJECTED',
      ...projection,
      rejectionDigest: this.#digests.digest(projection),
    };
  }

  #answerOnlyDecisionId(inputDigest: Sha256Digest): IntentAdmissionDecisionId {
    return intentAdmissionDecisionId(
      `intent-admission_answer-${inputDigest.slice('sha256:'.length)}`,
    );
  }

  #analysisFailureReason(reasonCode: IntakeAssistantFailureReasonCode): IntakeFailureReasonCode {
    switch (reasonCode) {
      case 'ASSISTANT_UNAVAILABLE':
        return IntakeFailureReasonCode.ASSISTANT_UNAVAILABLE;
      case 'ASSISTANT_TIMEOUT':
        return IntakeFailureReasonCode.ASSISTANT_TIMEOUT;
      case 'ASSISTANT_PROTOCOL_ERROR':
        return IntakeFailureReasonCode.ASSISTANT_PROTOCOL_ERROR;
      case 'RESPONSE_REJECTED':
        return IntakeFailureReasonCode.RESPONSE_REJECTED;
    }
  }

  #causalNow(...floors: readonly IsoTimestamp[]): IsoTimestamp {
    const observed = isoTimestamp(this.#clock.now());
    return floors.reduce((latest, floor) => (floor > latest ? floor : latest), observed);
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
        ? this.#outcomeResult(outcome, true)
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

  async #composeStartForResult(
    result: IntakeCoordinatorCommandResult,
  ): Promise<IntakeCoordinatorCommandResult> {
    return result.kind === 'OUTCOME' && result.outcome.result.kind === 'MATERIALIZED'
      ? this.#composeMaterializedStart(result.outcome, result.replayed)
      : result;
  }

  async #composeMaterializedStart(
    outcome: IntakeCommandOutcome,
    replayed: boolean,
  ): Promise<IntakeCoordinatorCommandResult> {
    if (outcome.result.kind !== 'MATERIALIZED') {
      throw new TypeError('Start composition requires a MATERIALIZED Intake outcome');
    }
    const authority = this.#store.getIntakeAuthority(outcome.intakeRunId);
    const materialization = authority?.materialization;
    if (
      materialization?.id !== outcome.result.materializedGoalRef.goalMaterializationId ||
      materialization.materializationDigest !==
        outcome.result.materializedGoalRef.materializationDigest
    ) {
      throw new TypeError('Committed Intake outcome has no exact Materialization authority');
    }
    const authorization = authority?.startAuthorization;
    if (!('goalStartAuthorizationRef' in outcome.result)) {
      if (authorization !== undefined) {
        throw new TypeError('Leave-ready Materialization retained unexpected Start authority');
      }
      return this.#outcomeResult(outcome, replayed, IntakeStartDisposition.NOT_AUTHORIZED);
    }
    if (
      authorization?.id !== outcome.result.goalStartAuthorizationRef.id ||
      authorization.authorizationDigest !== outcome.result.goalStartAuthorizationRef.digest ||
      authorization.startCommandId !== outcome.result.goalStartAuthorizationRef.startCommandId
    ) {
      throw new TypeError('Committed Intake outcome has no exact Start Authorization');
    }
    const preflight = this.#governedExecutionPreflight;
    const start = this.#startComposition;
    if (
      preflight === undefined ||
      start === undefined ||
      authorization.policyBundleId !== preflight.workflowPolicyId ||
      authorization.policyBundleDigest !== preflight.workflowPolicyDigest ||
      authorization.executionProfileId !== preflight.executionProfileId ||
      authorization.executionProfileDigest !== preflight.executionProfileDigest
    ) {
      return this.#outcomeResult(
        outcome,
        replayed,
        IntakeStartDisposition.START_INFRASTRUCTURE_FAILURE,
      );
    }
    let startDisposition: (typeof IntakeStartDisposition)[keyof typeof IntakeStartDisposition];
    try {
      startDisposition = classifyIntakeStartResult(
        await start.startGoal({
          commandId: authorization.startCommandId,
          goalId: authorization.goalId,
          expectedGoalRevision: authorization.goalRevision,
          expectedWorkflowVersion: authorization.workflowVersion,
        }),
      );
    } catch {
      startDisposition = IntakeStartDisposition.START_INFRASTRUCTURE_FAILURE;
    }
    try {
      const retainedDisposition = readIntakeStartDisposition(authorization, start);
      if (
        retainedDisposition === IntakeStartDisposition.START_COMMAND_APPLIED ||
        retainedDisposition === IntakeStartDisposition.START_COMMAND_REJECTED
      ) {
        startDisposition = retainedDisposition;
      } else if (startDisposition === IntakeStartDisposition.START_COMMAND_APPLIED) {
        startDisposition = IntakeStartDisposition.START_INFRASTRUCTURE_FAILURE;
      }
    } catch {
      startDisposition = IntakeStartDisposition.START_INFRASTRUCTURE_FAILURE;
    }
    return this.#outcomeResult(outcome, replayed, startDisposition);
  }

  #outcomeResult(
    outcome: IntakeCommandOutcome,
    replayed: boolean,
    startDisposition: (typeof IntakeStartDisposition)[keyof typeof IntakeStartDisposition] = 'startDisposition' in
    outcome.result
      ? outcome.result.startDisposition
      : IntakeStartDisposition.NOT_AUTHORIZED,
  ): IntakeCoordinatorCommandResult {
    if (
      outcome.result.kind !== 'NO_EXECUTION' ||
      outcome.result.answerDisposition !== 'ANSWER_RETURNED' ||
      !('answerOnlyResponseRef' in outcome.result)
    ) {
      return { kind: 'OUTCOME', outcome, replayed, startDisposition };
    }
    const responseRef = outcome.result.answerOnlyResponseRef;
    const authority = this.#store.getIntakeAuthority(outcome.intakeRunId);
    const response = authority?.answerOnlyResponses.find(({ id }) => id === responseRef.id);
    if (response?.kind !== AnswerOnlyResponseKind.ANSWER_RETURNED) {
      throw new TypeError('Committed Answer-only outcome has no deliverable response');
    }
    return {
      kind: 'OUTCOME',
      outcome,
      replayed,
      startDisposition,
      answerOnlyContent: response.answerContent,
    };
  }

  #externalBinding(manifest: IntakeManifest, policy: IntentAdmissionPolicy) {
    if (
      manifest.assistantAdapter.id !== M25_INTAKE_ASSISTANT_ADAPTER_ID ||
      (manifest.assistantAdapter.version !== M25_INTAKE_ASSISTANT_ADAPTER_VERSION &&
        manifest.assistantAdapter.version !== M251_INTAKE_ASSISTANT_ADAPTER_VERSION)
    ) {
      throw new TypeError('Intake Manifest selects an unsupported Assistant Adapter');
    }
    return {
      manifestId: manifest.id,
      manifestDigest: manifest.manifestDigest,
      admissionPolicyId: policy.id,
      admissionPolicyVersion: policy.version,
      admissionPolicyDigest: policy.digest,
      assistantAdapterId: manifest.assistantAdapter.id,
      assistantAdapterVersion: manifest.assistantAdapter.version,
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
    readonly operationKind:
      | typeof IntakeCommandOperationKind.INTENT_ANALYSIS
      | typeof IntakeCommandOperationKind.ANSWER_ONLY;
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
        reservationDigest: this.#digests.digest(intakeCommandReservationProjection(base)),
      },
      this.#digests,
    );
    if (reservation.operationKind !== input.operationKind) {
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
        reservationDigest: this.#digests.digest(intakeCommandReservationProjection(base)),
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
        reservationDigest: this.#digests.digest(intakeCommandReservationProjection(base)),
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
