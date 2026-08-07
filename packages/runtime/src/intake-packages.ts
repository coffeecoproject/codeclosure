import { Buffer } from 'node:buffer';

import {
  IntakeInteractionAction,
  IntakeManifestEntryKind,
  IntakeManifestOperation,
  IntentAdmissionDecisionKind,
  IntentAdmissionOutcome,
  IntentAdmissionReasonCode,
  IntentExecutionDisposition,
  SourceAuthorityClass,
  decodeClarificationAnswerBinding,
  decodeClarificationQuestion,
  decodeIntakeManifest,
  decodeIntentAdmissionDecision,
  decodeIntentAdmissionPolicy,
  decodeIntentProjectionRevision,
  decodeRawRequestRevision,
  intentAdmissionDecisionId,
  intakeManifestProjection,
  sha256Digest,
  type ActiveQuestionRef,
  type ClarificationAnswerBinding,
  type ClarificationQuestion,
  type DeclaredProjectRef,
  type IntakeManifest,
  type IntakeManifestEntry,
  type IntakeManifestId,
  type IntakeManifestOmission,
  type IntakeRunId,
  type IntakeDigestVerifier,
  type IntentAdmissionDecision,
  type IntentAdmissionPolicy,
  type IntentProjectionRevisionRecord,
  type IsoTimestamp,
  type RawRequestRevisionRecord,
  type Sha256Digest,
  type VersionedDigestRef,
} from '@codeclosure/domain';

import {
  M25_ANSWER_ONLY_RESPONSE_CONTRACT_ID,
  M25_ANSWER_ONLY_RESPONSE_CONTRACT_VERSION,
  M25_INTAKE_ASSISTANT_ADAPTER_ID,
  M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
  M25_INTAKE_ASSISTANT_PROFILE_ID,
  M25_INTAKE_ASSISTANT_PROFILE_VERSION,
  M25_INTAKE_BUDGET_PROFILE_ID,
  M25_INTAKE_BUDGET_PROFILE_VERSION,
  M25_INTAKE_CODEX_VERSION,
  M25_INTAKE_MODEL,
  M25_INTAKE_MODEL_PROVIDER,
  M25_INTAKE_PROTOCOL_SNAPSHOT_DIGEST,
  M25_INTAKE_REASONING_EFFORT,
  M25_INTAKE_SERVICE_TIER,
  M251_INTAKE_ASSISTANT_ADAPTER_VERSION,
  M251_INTAKE_ASSISTANT_PROFILE_VERSION,
  M251_INTAKE_CLOSED_CONFIGURATION_ID,
  M251_INTAKE_CLOSED_CONFIGURATION_VERSION,
  M251_INTAKE_CODEX_VERSION,
  M251_INTAKE_PROTOCOL_PROJECTION_ID,
  M251_INTAKE_PROTOCOL_PROJECTION_VERSION,
  M251_INTAKE_PROTOCOL_SNAPSHOT_DIGEST,
  M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_ID,
  M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION,
  m25IntakeBudgetDefinition,
} from './intake-assistant.js';
import type { Canonicalizer, DigestProvider } from './ports.js';
import type { JsonValue } from './contracts.js';

export interface IntakeAssistantProfileDescriptor {
  readonly schemaVersion: 1;
  readonly id: typeof M25_INTAKE_ASSISTANT_PROFILE_ID;
  readonly version: typeof M25_INTAKE_ASSISTANT_PROFILE_VERSION;
  readonly codexVersion: typeof M25_INTAKE_CODEX_VERSION;
  readonly protocolSnapshotDigest: typeof M25_INTAKE_PROTOCOL_SNAPSHOT_DIGEST;
  readonly modelProvider: typeof M25_INTAKE_MODEL_PROVIDER;
  readonly model: typeof M25_INTAKE_MODEL;
  readonly serviceTier: typeof M25_INTAKE_SERVICE_TIER;
  readonly reasoningEffort: typeof M25_INTAKE_REASONING_EFFORT;
  readonly threadPolicy: 'FRESH_PROCESS_THREAD_TURN';
  readonly compactionPolicy: 'FAIL_ON_OBSERVATION';
  readonly fallbackPolicy: 'FAIL_CLOSED';
  readonly effectPolicy: 'ISOLATED_READ_ONLY_FAIL_ON_TOOL_OBSERVATION';
  readonly selectedAuthorityCapabilities: readonly never[];
}

export interface M251IntakeAssistantProfileDescriptor {
  readonly schemaVersion: 2;
  readonly id: typeof M25_INTAKE_ASSISTANT_PROFILE_ID;
  readonly version: typeof M251_INTAKE_ASSISTANT_PROFILE_VERSION;
  readonly codexVersion: typeof M251_INTAKE_CODEX_VERSION;
  readonly protocolSnapshotDigest: typeof M251_INTAKE_PROTOCOL_SNAPSHOT_DIGEST;
  readonly modelProvider: typeof M25_INTAKE_MODEL_PROVIDER;
  readonly model: typeof M25_INTAKE_MODEL;
  readonly serviceTier: typeof M25_INTAKE_SERVICE_TIER;
  readonly reasoningEffort: typeof M25_INTAKE_REASONING_EFFORT;
  readonly threadPolicy: 'FRESH_PROCESS_THREAD_TURN';
  readonly compactionPolicy: 'FAIL_ON_OBSERVATION';
  readonly fallbackPolicy: 'FAIL_CLOSED';
  readonly effectPolicy: 'ISOLATED_READ_ONLY_FAIL_ON_TOOL_OBSERVATION';
  readonly selectedAuthorityCapabilities: readonly never[];
  readonly closedConfiguration: Readonly<{
    schemaVersion: 1;
    id: typeof M251_INTAKE_CLOSED_CONFIGURATION_ID;
    version: typeof M251_INTAKE_CLOSED_CONFIGURATION_VERSION;
  }>;
  readonly protocolProjectionPolicy: Readonly<{
    schemaVersion: 1;
    id: typeof M251_INTAKE_PROTOCOL_PROJECTION_ID;
    version: typeof M251_INTAKE_PROTOCOL_PROJECTION_VERSION;
  }>;
}

export const m25IntakeAssistantProfile: IntakeAssistantProfileDescriptor = Object.freeze({
  schemaVersion: 1,
  id: M25_INTAKE_ASSISTANT_PROFILE_ID,
  version: M25_INTAKE_ASSISTANT_PROFILE_VERSION,
  codexVersion: M25_INTAKE_CODEX_VERSION,
  protocolSnapshotDigest: M25_INTAKE_PROTOCOL_SNAPSHOT_DIGEST,
  modelProvider: M25_INTAKE_MODEL_PROVIDER,
  model: M25_INTAKE_MODEL,
  serviceTier: M25_INTAKE_SERVICE_TIER,
  reasoningEffort: M25_INTAKE_REASONING_EFFORT,
  threadPolicy: 'FRESH_PROCESS_THREAD_TURN',
  compactionPolicy: 'FAIL_ON_OBSERVATION',
  fallbackPolicy: 'FAIL_CLOSED',
  effectPolicy: 'ISOLATED_READ_ONLY_FAIL_ON_TOOL_OBSERVATION',
  selectedAuthorityCapabilities: Object.freeze([]),
});

export const m251IntakeAssistantProfile: M251IntakeAssistantProfileDescriptor = Object.freeze({
  schemaVersion: 2,
  id: M25_INTAKE_ASSISTANT_PROFILE_ID,
  version: M251_INTAKE_ASSISTANT_PROFILE_VERSION,
  codexVersion: M251_INTAKE_CODEX_VERSION,
  protocolSnapshotDigest: M251_INTAKE_PROTOCOL_SNAPSHOT_DIGEST,
  modelProvider: M25_INTAKE_MODEL_PROVIDER,
  model: M25_INTAKE_MODEL,
  serviceTier: M25_INTAKE_SERVICE_TIER,
  reasoningEffort: M25_INTAKE_REASONING_EFFORT,
  threadPolicy: 'FRESH_PROCESS_THREAD_TURN',
  compactionPolicy: 'FAIL_ON_OBSERVATION',
  fallbackPolicy: 'FAIL_CLOSED',
  effectPolicy: 'ISOLATED_READ_ONLY_FAIL_ON_TOOL_OBSERVATION',
  selectedAuthorityCapabilities: Object.freeze([]),
  closedConfiguration: Object.freeze({
    schemaVersion: 1,
    id: M251_INTAKE_CLOSED_CONFIGURATION_ID,
    version: M251_INTAKE_CLOSED_CONFIGURATION_VERSION,
  }),
  protocolProjectionPolicy: Object.freeze({
    schemaVersion: 1,
    id: M251_INTAKE_PROTOCOL_PROJECTION_ID,
    version: M251_INTAKE_PROTOCOL_PROJECTION_VERSION,
  }),
});

export type VersionedIntakeAssistantProfileDescriptor =
  IntakeAssistantProfileDescriptor | M251IntakeAssistantProfileDescriptor;

export type IntakeAssistantAdapterDescriptor = Readonly<{
  id: typeof M25_INTAKE_ASSISTANT_ADAPTER_ID;
  version:
    typeof M25_INTAKE_ASSISTANT_ADAPTER_VERSION | typeof M251_INTAKE_ASSISTANT_ADAPTER_VERSION;
}>;

export const m25IntakeAssistantAdapter: IntakeAssistantAdapterDescriptor = Object.freeze({
  id: M25_INTAKE_ASSISTANT_ADAPTER_ID,
  version: M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
});

export const m251IntakeAssistantAdapter: IntakeAssistantAdapterDescriptor = Object.freeze({
  id: M25_INTAKE_ASSISTANT_ADAPTER_ID,
  version: M251_INTAKE_ASSISTANT_ADAPTER_VERSION,
});

export const m25IntentAnalysisResponseSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: Object.freeze([
    'proposedCriteria',
    'proposedNonGoals',
    'proposedAssumptions',
    'proposedQuestions',
    'candidateSourceSpanSuggestions',
  ]),
  properties: Object.freeze({
    proposedObjective: Object.freeze({ type: 'string', minLength: 1 }),
    proposedCriteria: Object.freeze({
      type: 'array',
      maxItems: 16,
      uniqueItems: true,
      items: Object.freeze({ type: 'string', minLength: 1 }),
    }),
    proposedScope: Object.freeze({ type: 'string', minLength: 1 }),
    proposedNonGoals: Object.freeze({
      type: 'array',
      maxItems: 16,
      uniqueItems: true,
      items: Object.freeze({ type: 'string', minLength: 1 }),
    }),
    proposedAssumptions: Object.freeze({
      type: 'array',
      maxItems: 16,
      uniqueItems: true,
      items: Object.freeze({ type: 'string', minLength: 1 }),
    }),
    proposedQuestions: Object.freeze({
      type: 'array',
      maxItems: 8,
      uniqueItems: true,
      items: Object.freeze({ type: 'string', minLength: 1 }),
    }),
    candidateSourceSpanSuggestions: Object.freeze({
      type: 'array',
      maxItems: 64,
      items: Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: Object.freeze([
          'projectionFieldRef',
          'rawRequestRevision',
          'startByte',
          'endByte',
        ]),
        properties: Object.freeze({
          projectionFieldRef: Object.freeze({
            enum: Object.freeze([
              'OBJECTIVE',
              'REQUIRED_CRITERION',
              'SCOPE',
              'NON_GOAL',
              'ASSUMPTION',
            ]),
          }),
          itemIndex: Object.freeze({ type: 'integer', minimum: 0 }),
          rawRequestRevision: Object.freeze({ type: 'integer', minimum: 1 }),
          startByte: Object.freeze({ type: 'integer', minimum: 0 }),
          endByte: Object.freeze({ type: 'integer', minimum: 1 }),
        }),
      }),
    }),
    proposedClassification: Object.freeze({ type: 'string', minLength: 1 }),
  }),
});

export const m25AnswerOnlyResponseSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: Object.freeze(['answerContent']),
  properties: Object.freeze({
    answerContent: Object.freeze({ type: 'string', minLength: 1 }),
  }),
});

export interface IntakeResponseContractDescriptor {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly operation: 'INTENT_ANALYSIS' | 'ANSWER_ONLY';
  readonly maximumCanonicalResponseBytes: number;
  readonly unknownFields: 'REJECT';
  readonly schema: JsonValue;
  readonly digest: Sha256Digest;
}

export interface IntakeBudgetProfileDescriptor {
  readonly definition: typeof m25IntakeBudgetDefinition;
  readonly digest: Sha256Digest;
}

interface IntakePackageCommon {
  readonly schemaVersion: 1;
  readonly intakeRunId: IntakeRunId;
  readonly assistantProfile: VersionedIntakeAssistantProfileDescriptor;
  readonly assistantAdapter: IntakeAssistantAdapterDescriptor;
  readonly responseContract: IntakeResponseContractDescriptor;
  readonly budgetProfile: IntakeBudgetProfileDescriptor;
}

export interface IntakePackage extends IntakePackageCommon {
  readonly kind: 'INTENT_ANALYSIS';
  readonly rawRequestRevisions: readonly RawRequestRevisionRecord[];
  readonly currentProjection?: IntentProjectionRevisionRecord;
  readonly clarificationQuestions: readonly ClarificationQuestion[];
  readonly clarificationAnswerBindings: readonly ClarificationAnswerBinding[];
  readonly activeQuestionRefs: readonly ActiveQuestionRef[];
  readonly declaredProjectRef?: DeclaredProjectRef;
  readonly admissionPolicy: IntentAdmissionPolicy;
}

export interface PreparedAnswerOnlyDecisionBinding {
  readonly decisionId: string;
  readonly decisionDigest: Sha256Digest;
  readonly intakeRunId: IntakeRunId;
  readonly rawRequestRevision: number;
  readonly rawRequestDigest: Sha256Digest;
  readonly admissionPolicy: VersionedDigestRef;
  readonly decisionKind: typeof IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION;
  readonly outcome: typeof IntentAdmissionOutcome.NO_EXECUTION;
  readonly reasonCode: typeof IntentAdmissionReasonCode.ANSWER_ONLY;
  readonly executionDisposition: typeof IntentExecutionDisposition.NONE;
}

export interface AnswerOnlyPackage extends IntakePackageCommon {
  readonly kind: 'ANSWER_ONLY';
  readonly rawRequestRevision: RawRequestRevisionRecord;
  readonly preparedDecisionBinding: PreparedAnswerOnlyDecisionBinding;
}

export interface IntakePackageCompilation<Package extends IntakePackage | AnswerOnlyPackage> {
  readonly package: Package;
  readonly manifest: IntakeManifest;
}

export interface CompileIntentAnalysisPackageInput {
  readonly manifestId: IntakeManifestId;
  readonly createdAt: IsoTimestamp;
  readonly intakeRunId: IntakeRunId;
  readonly rawRequestRevisions: readonly RawRequestRevisionRecord[];
  readonly currentProjection?: IntentProjectionRevisionRecord;
  readonly clarificationQuestions?: readonly ClarificationQuestion[];
  readonly clarificationAnswerBindings?: readonly ClarificationAnswerBinding[];
  readonly activeQuestionRefs?: readonly ActiveQuestionRef[];
  readonly admissionPolicy: IntentAdmissionPolicy;
  readonly omissions?: readonly IntakeManifestOmission[];
}

export interface CompileAnswerOnlyPackageInput {
  readonly manifestId: IntakeManifestId;
  readonly createdAt: IsoTimestamp;
  readonly intakeRunId: IntakeRunId;
  readonly rawRequestRevision: RawRequestRevisionRecord;
  readonly preparedDecision: IntentAdmissionDecision;
  readonly admissionPolicy: IntentAdmissionPolicy;
  readonly omissions?: readonly IntakeManifestOmission[];
}

export interface IntakePackageCompilerOptions {
  readonly canonicalizer: Canonicalizer;
  readonly digests: DigestProvider & IntakeDigestVerifier;
}

function canonicalBytes(value: unknown, canonicalizer: Canonicalizer): number {
  return Buffer.byteLength(canonicalizer.canonicalize(value), 'utf8');
}

function assertWithinBytes(value: string, maximum: number, field: string): void {
  if (Buffer.byteLength(value, 'utf8') > maximum) {
    throw new TypeError(`${field} exceeds the fixed Intake budget`);
  }
}

function compareKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function entryKey(entry: IntakeManifestEntry): string {
  return `${entry.kind}\u0000${entry.sourceRef}\u0000${String(entry.sourceRevision ?? 0)}`;
}

function canonicalEntries(entries: readonly IntakeManifestEntry[]): readonly IntakeManifestEntry[] {
  const sorted = entries
    .map((entry) => Object.freeze({ ...entry }))
    .sort((left, right) => compareKey(entryKey(left), entryKey(right)));
  const identities = sorted.map(entryKey);
  if (new Set(identities).size !== identities.length) {
    throw new TypeError('Intake Manifest entries must have unique source identities');
  }
  if (sorted.length > m25IntakeBudgetDefinition.maximumManifestEntries) {
    throw new TypeError('Intake Manifest exceeds the fixed entry budget');
  }
  return Object.freeze(sorted);
}

function canonicalOmissions(
  omissions: readonly IntakeManifestOmission[],
): readonly IntakeManifestOmission[] {
  const sorted = omissions
    .map((omission) => Object.freeze({ ...omission }))
    .sort((left, right) =>
      compareKey(
        `${left.sourceRef}\u0000${left.reasonCode}`,
        `${right.sourceRef}\u0000${right.reasonCode}`,
      ),
    );
  if (new Set(sorted.map(({ sourceRef }) => sourceRef)).size !== sorted.length) {
    throw new TypeError('Intake Manifest omissions must identify unique sources');
  }
  return Object.freeze(sorted);
}

function responseContract(
  operation: 'INTENT_ANALYSIS' | 'ANSWER_ONLY',
  digests: DigestProvider & IntakeDigestVerifier,
): IntakeResponseContractDescriptor {
  const base = Object.freeze(
    operation === 'INTENT_ANALYSIS'
      ? {
          schemaVersion: 1 as const,
          id: M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_ID,
          version: M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION,
          operation,
          maximumCanonicalResponseBytes:
            m25IntakeBudgetDefinition.maximumIntentAnalysisResponseBytes,
          unknownFields: 'REJECT' as const,
          schema: m25IntentAnalysisResponseSchema,
        }
      : {
          schemaVersion: 1 as const,
          id: M25_ANSWER_ONLY_RESPONSE_CONTRACT_ID,
          version: M25_ANSWER_ONLY_RESPONSE_CONTRACT_VERSION,
          operation,
          maximumCanonicalResponseBytes: m25IntakeBudgetDefinition.maximumAnswerOnlyResponseBytes,
          unknownFields: 'REJECT' as const,
          schema: m25AnswerOnlyResponseSchema,
        },
  );
  return Object.freeze({ ...base, digest: digests.digest(base) });
}

function budgetProfile(
  digests: DigestProvider & IntakeDigestVerifier,
): IntakeBudgetProfileDescriptor {
  return Object.freeze({
    definition: m25IntakeBudgetDefinition,
    digest: digests.digest(m25IntakeBudgetDefinition),
  });
}

function versionedRef(
  descriptor: Pick<IntakeResponseContractDescriptor, 'id' | 'version' | 'digest'>,
): VersionedDigestRef {
  return Object.freeze({
    id: descriptor.id,
    version: descriptor.version,
    digest: descriptor.digest,
  });
}

function budgetRef(descriptor: IntakeBudgetProfileDescriptor): VersionedDigestRef {
  return Object.freeze({
    id: M25_INTAKE_BUDGET_PROFILE_ID,
    version: M25_INTAKE_BUDGET_PROFILE_VERSION,
    digest: descriptor.digest,
  });
}

function policyRef(policy: IntentAdmissionPolicy): VersionedDigestRef {
  return Object.freeze({ id: policy.id, version: policy.version, digest: policy.digest });
}

function activeRef(question: ClarificationQuestion): ActiveQuestionRef {
  return Object.freeze({
    clarificationQuestionId: question.id,
    questionSpecDigest: question.questionSpecDigest,
    questionDigest: question.questionDigest,
    issuingDecisionId: question.intentAdmissionDecisionId,
    issuingDecisionDigest: question.intentAdmissionDecisionDigest,
  });
}

function assertRawChain(
  records: readonly RawRequestRevisionRecord[],
  intakeRunId: IntakeRunId,
  digests: DigestProvider & IntakeDigestVerifier,
): readonly RawRequestRevisionRecord[] {
  if (
    records.length === 0 ||
    records.length > m25IntakeBudgetDefinition.maximumRawRequestRevisions
  ) {
    throw new TypeError('Raw Request chain is outside the fixed revision budget');
  }
  const decoded = records
    .map((record) => decodeRawRequestRevision(record, digests))
    .sort((left, right) => left.revision - right.revision);
  const rawRequestId = decoded[0]?.rawRequestId;
  let totalBytes = 0;
  decoded.forEach((record, index) => {
    if (
      record.intakeRunId !== intakeRunId ||
      record.rawRequestId !== rawRequestId ||
      record.revision !== index + 1
    ) {
      throw new TypeError('Raw Request chain is not one complete current Intake chain');
    }
    assertWithinBytes(
      record.admittedUserContent,
      m25IntakeBudgetDefinition.exactRawRequestContentBytesPerRevision,
      'Raw Request content',
    );
    totalBytes += Buffer.byteLength(record.admittedUserContent, 'utf8');
    if (record.declaredConstraints.length > m25IntakeBudgetDefinition.maximumDeclaredConstraints) {
      throw new TypeError('Raw Request constraints exceed the fixed collection budget');
    }
    for (const constraint of record.declaredConstraints) {
      assertWithinBytes(
        constraint,
        m25IntakeBudgetDefinition.maximumDeclaredConstraintBytes,
        'Raw Request constraint',
      );
    }
  });
  if (totalBytes > m25IntakeBudgetDefinition.maximumSelectedRawRequestContentBytes) {
    throw new TypeError('Selected Raw Request content exceeds the package budget');
  }
  return Object.freeze(decoded);
}

function manifestFor(
  input: Readonly<{
    manifestId: IntakeManifestId;
    createdAt: IsoTimestamp;
    operation: 'INTENT_ANALYSIS' | 'ANSWER_ONLY';
    intakeRunId: IntakeRunId;
    rawRequestRevisions: readonly RawRequestRevisionRecord[];
    currentProjection?: IntentProjectionRevisionRecord;
    questionRefs: readonly ActiveQuestionRef[];
    answerBindingDigests: readonly Sha256Digest[];
    declaredProjectRef?: DeclaredProjectRef;
    admissionPolicy: VersionedDigestRef;
    assistantAdapter: IntakeAssistantAdapterDescriptor;
    responseContract: IntakeResponseContractDescriptor;
    budgetProfile: IntakeBudgetProfileDescriptor;
    entries: readonly IntakeManifestEntry[];
    omissions: readonly IntakeManifestOmission[];
    packageDigest: Sha256Digest;
  }>,
  digests: DigestProvider & IntakeDigestVerifier,
): IntakeManifest {
  const entries = canonicalEntries(input.entries);
  const omissions = canonicalOmissions(input.omissions);
  if (entries.length + omissions.length > m25IntakeBudgetDefinition.maximumManifestEntries) {
    throw new TypeError('Intake Manifest included and omitted sources exceed the fixed budget');
  }
  const base = {
    id: input.manifestId,
    schemaVersion: 1 as const,
    operation:
      input.operation === 'INTENT_ANALYSIS'
        ? IntakeManifestOperation.INTENT_ANALYSIS
        : IntakeManifestOperation.ANSWER_ONLY,
    intakeRunId: input.intakeRunId,
    rawRequestRevisions: Object.freeze(
      input.rawRequestRevisions.map((record) =>
        Object.freeze({
          rawRequestId: record.rawRequestId,
          revision: record.revision,
          digest: record.rawRequestDigest,
        }),
      ),
    ),
    ...(input.currentProjection === undefined
      ? {}
      : {
          currentProjectionRef: Object.freeze({
            id: input.currentProjection.id,
            revision: input.currentProjection.revision,
            digest: input.currentProjection.projectionDigest,
          }),
        }),
    questionRefs: Object.freeze([...input.questionRefs]),
    answerBindingDigests: Object.freeze([...input.answerBindingDigests]),
    ...(input.declaredProjectRef === undefined
      ? {}
      : { declaredProjectRef: input.declaredProjectRef }),
    admissionPolicy: input.admissionPolicy,
    assistantAdapter: input.assistantAdapter,
    responseContract: versionedRef(input.responseContract),
    budgetProfile: budgetRef(input.budgetProfile),
    entries,
    omissions,
    packageDigest: input.packageDigest,
    createdAt: input.createdAt,
  };
  const projected = intakeManifestProjection({
    ...base,
    manifestDigest: digests.digest({ schemaVersion: 1, placeholder: 'manifest' }),
  });
  return decodeIntakeManifest({ ...base, manifestDigest: digests.digest(projected) }, digests);
}

class VersionedIntakePackageCompiler {
  readonly #canonicalizer: Canonicalizer;
  readonly #digests: DigestProvider & IntakeDigestVerifier;
  readonly #assistantProfile: VersionedIntakeAssistantProfileDescriptor;
  readonly #assistantAdapter: IntakeAssistantAdapterDescriptor;

  public constructor(
    options: IntakePackageCompilerOptions,
    assistantProfile: VersionedIntakeAssistantProfileDescriptor,
    assistantAdapter: IntakeAssistantAdapterDescriptor,
  ) {
    this.#canonicalizer = options.canonicalizer;
    this.#digests = options.digests;
    this.#assistantProfile = assistantProfile;
    this.#assistantAdapter = assistantAdapter;
  }

  public validateIntentAnalysisCompilation(
    compilation: IntakePackageCompilation<IntakePackage>,
  ): void {
    const manifest = decodeIntakeManifest(compilation.manifest, this.#digests);
    const expected = this.compileIntentAnalysis({
      manifestId: manifest.id,
      createdAt: manifest.createdAt,
      intakeRunId: compilation.package.intakeRunId,
      rawRequestRevisions: compilation.package.rawRequestRevisions,
      ...(compilation.package.currentProjection === undefined
        ? {}
        : { currentProjection: compilation.package.currentProjection }),
      clarificationQuestions: compilation.package.clarificationQuestions,
      clarificationAnswerBindings: compilation.package.clarificationAnswerBindings,
      activeQuestionRefs: compilation.package.activeQuestionRefs,
      admissionPolicy: compilation.package.admissionPolicy,
      omissions: manifest.omissions,
    });
    this.#assertExactCompilation(compilation, expected);
  }

  public validateAnswerOnlyCompilation(
    compilation: IntakePackageCompilation<AnswerOnlyPackage>,
  ): void {
    const manifest = decodeIntakeManifest(compilation.manifest, this.#digests);
    const [rawRequestRevision] = assertRawChain(
      [compilation.package.rawRequestRevision],
      compilation.package.intakeRunId,
      this.#digests,
    );
    if (rawRequestRevision === undefined) {
      throw new TypeError('Answer-only requires one Raw Request revision');
    }
    const binding = compilation.package.preparedDecisionBinding;
    const admissionPolicy = Object.freeze({ ...manifest.admissionPolicy });
    if (
      rawRequestRevision.interactionAction !== IntakeInteractionAction.ANSWER_ONLY ||
      binding.intakeRunId !== rawRequestRevision.intakeRunId ||
      binding.rawRequestRevision !== rawRequestRevision.revision ||
      binding.rawRequestDigest !== rawRequestRevision.rawRequestDigest ||
      this.#canonicalizer.canonicalize(binding.admissionPolicy) !==
        this.#canonicalizer.canonicalize(admissionPolicy)
    ) {
      throw new TypeError('Prepared Answer-only Decision binding is not canonical');
    }
    const preparedDecisionBinding: PreparedAnswerOnlyDecisionBinding = Object.freeze({
      decisionId: intentAdmissionDecisionId(binding.decisionId),
      decisionDigest: sha256Digest(binding.decisionDigest),
      intakeRunId: rawRequestRevision.intakeRunId,
      rawRequestRevision: rawRequestRevision.revision,
      rawRequestDigest: rawRequestRevision.rawRequestDigest,
      admissionPolicy,
      decisionKind: IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION,
      outcome: IntentAdmissionOutcome.NO_EXECUTION,
      reasonCode: IntentAdmissionReasonCode.ANSWER_ONLY,
      executionDisposition: IntentExecutionDisposition.NONE,
    });
    const response = responseContract('ANSWER_ONLY', this.#digests);
    const budget = budgetProfile(this.#digests);
    const packageValue: AnswerOnlyPackage = Object.freeze({
      schemaVersion: 1,
      kind: 'ANSWER_ONLY',
      intakeRunId: rawRequestRevision.intakeRunId,
      rawRequestRevision,
      preparedDecisionBinding,
      assistantProfile: this.#assistantProfile,
      assistantAdapter: this.#assistantAdapter,
      responseContract: response,
      budgetProfile: budget,
    });
    if (
      canonicalBytes(packageValue, this.#canonicalizer) >
      m25IntakeBudgetDefinition.maximumCanonicalPackageBytes
    ) {
      throw new TypeError('Canonical Answer-only Package exceeds the fixed package budget');
    }
    const entries: readonly IntakeManifestEntry[] = [
      {
        kind: IntakeManifestEntryKind.RAW_REQUEST_REVISION,
        sourceRef: rawRequestRevision.rawRequestId,
        sourceRevision: rawRequestRevision.revision,
        sourceDigest: rawRequestRevision.rawRequestDigest,
        authorityClass: SourceAuthorityClass.USER_STATED,
      },
      {
        kind: IntakeManifestEntryKind.ADMISSION_POLICY,
        sourceRef: admissionPolicy.id,
        sourceDigest: admissionPolicy.digest,
        authorityClass: SourceAuthorityClass.POLICY_DERIVED,
      },
    ];
    const expectedManifest = manifestFor(
      {
        manifestId: manifest.id,
        createdAt: manifest.createdAt,
        operation: 'ANSWER_ONLY',
        intakeRunId: rawRequestRevision.intakeRunId,
        rawRequestRevisions: [rawRequestRevision],
        questionRefs: [],
        answerBindingDigests: [],
        ...(rawRequestRevision.declaredProjectRef === undefined
          ? {}
          : { declaredProjectRef: rawRequestRevision.declaredProjectRef }),
        admissionPolicy,
        assistantAdapter: this.#assistantAdapter,
        responseContract: response,
        budgetProfile: budget,
        entries,
        omissions: manifest.omissions,
        packageDigest: this.#digests.digest(packageValue),
      },
      this.#digests,
    );
    this.#assertExactCompilation(compilation, {
      package: packageValue,
      manifest: expectedManifest,
    });
  }

  public compileIntentAnalysis(
    input: CompileIntentAnalysisPackageInput,
  ): IntakePackageCompilation<IntakePackage> {
    const rawRequestRevisions = assertRawChain(
      input.rawRequestRevisions,
      input.intakeRunId,
      this.#digests,
    );
    const admissionPolicy = decodeIntentAdmissionPolicy(input.admissionPolicy, this.#digests);
    const currentProjection =
      input.currentProjection === undefined
        ? undefined
        : decodeIntentProjectionRevision(input.currentProjection, this.#digests);
    if (currentProjection !== undefined && currentProjection.intakeRunId !== input.intakeRunId) {
      throw new TypeError('Current Intent Projection belongs to another Intake Run');
    }
    const clarificationQuestions = Object.freeze(
      (input.clarificationQuestions ?? []).map((question) => {
        const decoded = decodeClarificationQuestion(question, this.#digests);
        if (decoded.intakeRunId !== input.intakeRunId) {
          throw new TypeError('Clarification Question belongs to another Intake Run');
        }
        return decoded;
      }),
    );
    const clarificationAnswerBindings = Object.freeze(
      (input.clarificationAnswerBindings ?? []).map((binding) => {
        const decoded = decodeClarificationAnswerBinding(binding, this.#digests);
        if (decoded.intakeRunId !== input.intakeRunId) {
          throw new TypeError('Clarification Answer Binding belongs to another Intake Run');
        }
        return decoded;
      }),
    );
    if (
      clarificationQuestions.length > m25IntakeBudgetDefinition.maximumClarificationTurns ||
      clarificationAnswerBindings.length > m25IntakeBudgetDefinition.maximumClarificationTurns
    ) {
      throw new TypeError('Clarification history exceeds the fixed turn budget');
    }
    const questionById = new Map(clarificationQuestions.map((question) => [question.id, question]));
    const activeQuestionRefs = Object.freeze(
      (input.activeQuestionRefs ?? []).map((reference) => {
        const question = questionById.get(reference.clarificationQuestionId);
        if (question === undefined) {
          throw new TypeError('Active Question reference does not bind an included Question');
        }
        const expected = activeRef(question);
        if (
          reference.clarificationQuestionId !== expected.clarificationQuestionId ||
          reference.questionSpecDigest !== expected.questionSpecDigest ||
          reference.questionDigest !== expected.questionDigest ||
          reference.issuingDecisionId !== expected.issuingDecisionId ||
          reference.issuingDecisionDigest !== expected.issuingDecisionDigest
        ) {
          throw new TypeError('Active Question reference does not bind an included Question');
        }
        return expected;
      }),
    );
    if (activeQuestionRefs.length > m25IntakeBudgetDefinition.maximumActiveClarificationQuestions) {
      throw new TypeError('The bounded Intake profile permits at most one active Question');
    }
    for (const binding of clarificationAnswerBindings) {
      const question = questionById.get(binding.clarificationQuestionId);
      const revision = rawRequestRevisions.find(
        (record) => record.revision === binding.rawRequestRevision,
      );
      if (
        question === undefined ||
        revision === undefined ||
        question.questionSpecDigest !== binding.questionSpecDigest ||
        question.questionDigest !== binding.questionDigest ||
        question.intentAdmissionDecisionId !== binding.intentAdmissionDecisionId ||
        question.intentAdmissionDecisionDigest !== binding.intentAdmissionDecisionDigest ||
        revision.rawRequestId !== binding.rawRequestId ||
        revision.rawRequestDigest !== binding.rawRequestDigest
      ) {
        throw new TypeError('Clarification Answer Binding does not bind included authority');
      }
    }
    const latestRawRequestRevision = rawRequestRevisions.at(-1);
    if (latestRawRequestRevision === undefined) {
      throw new TypeError('Raw Request chain has no current revision');
    }
    if (
      currentProjection !== undefined &&
      currentProjection.rawRequestRevision !== latestRawRequestRevision.revision
    ) {
      throw new TypeError('Current Intent Projection does not bind the current Raw Request');
    }
    const declaredProjectRef = latestRawRequestRevision.declaredProjectRef;
    const response = responseContract('INTENT_ANALYSIS', this.#digests);
    const budget = budgetProfile(this.#digests);
    const packageValue: IntakePackage = Object.freeze({
      schemaVersion: 1,
      kind: 'INTENT_ANALYSIS',
      intakeRunId: input.intakeRunId,
      rawRequestRevisions,
      ...(currentProjection === undefined ? {} : { currentProjection }),
      clarificationQuestions,
      clarificationAnswerBindings,
      activeQuestionRefs,
      ...(declaredProjectRef === undefined ? {} : { declaredProjectRef }),
      admissionPolicy,
      assistantProfile: this.#assistantProfile,
      assistantAdapter: this.#assistantAdapter,
      responseContract: response,
      budgetProfile: budget,
    });
    if (
      canonicalBytes(packageValue, this.#canonicalizer) >
      m25IntakeBudgetDefinition.maximumCanonicalPackageBytes
    ) {
      throw new TypeError('Canonical Intake Package exceeds the fixed package budget');
    }
    const entries: IntakeManifestEntry[] = [
      ...rawRequestRevisions.map((record) => ({
        kind: IntakeManifestEntryKind.RAW_REQUEST_REVISION,
        sourceRef: record.rawRequestId,
        sourceRevision: record.revision,
        sourceDigest: record.rawRequestDigest,
        authorityClass: SourceAuthorityClass.USER_STATED,
      })),
      ...(currentProjection === undefined
        ? []
        : [
            {
              kind: IntakeManifestEntryKind.INTENT_PROJECTION,
              sourceRef: currentProjection.id,
              sourceRevision: currentProjection.revision,
              sourceDigest: currentProjection.projectionDigest,
              authorityClass: SourceAuthorityClass.POLICY_DERIVED,
            } as const,
          ]),
      ...clarificationQuestions.map((question) => ({
        kind: IntakeManifestEntryKind.CLARIFICATION_QUESTION,
        sourceRef: question.id,
        sourceDigest: question.questionDigest,
        authorityClass: SourceAuthorityClass.POLICY_DERIVED,
      })),
      ...clarificationAnswerBindings.map((binding) => ({
        kind: IntakeManifestEntryKind.CLARIFICATION_ANSWER_BINDING,
        sourceRef: binding.id,
        sourceRevision: binding.rawRequestRevision,
        sourceDigest: binding.answerBindingDigest,
        authorityClass: SourceAuthorityClass.USER_STATED,
      })),
      ...(declaredProjectRef === undefined
        ? []
        : [
            {
              kind: IntakeManifestEntryKind.DECLARED_PROJECT,
              sourceRef: declaredProjectRef.normalizedPath,
              sourceRevision: latestRawRequestRevision.revision,
              sourceDigest: declaredProjectRef.identityDigest,
              authorityClass: SourceAuthorityClass.USER_STATED,
            } as const,
          ]),
      {
        kind: IntakeManifestEntryKind.ADMISSION_POLICY,
        sourceRef: admissionPolicy.id,
        sourceDigest: admissionPolicy.digest,
        authorityClass: SourceAuthorityClass.POLICY_DERIVED,
      },
    ];
    const manifest = manifestFor(
      {
        manifestId: input.manifestId,
        createdAt: input.createdAt,
        operation: 'INTENT_ANALYSIS',
        intakeRunId: input.intakeRunId,
        rawRequestRevisions,
        ...(currentProjection === undefined ? {} : { currentProjection }),
        questionRefs: activeQuestionRefs,
        answerBindingDigests: Object.freeze(
          clarificationAnswerBindings.map(({ answerBindingDigest }) => answerBindingDigest),
        ),
        ...(declaredProjectRef === undefined ? {} : { declaredProjectRef }),
        admissionPolicy: policyRef(admissionPolicy),
        assistantAdapter: this.#assistantAdapter,
        responseContract: response,
        budgetProfile: budget,
        entries,
        omissions: input.omissions ?? [],
        packageDigest: this.#digests.digest(packageValue),
      },
      this.#digests,
    );
    return Object.freeze({ package: packageValue, manifest });
  }

  public compileAnswerOnly(
    input: CompileAnswerOnlyPackageInput,
  ): IntakePackageCompilation<AnswerOnlyPackage> {
    const [rawRequestRevision] = assertRawChain(
      [input.rawRequestRevision],
      input.intakeRunId,
      this.#digests,
    );
    if (rawRequestRevision === undefined) {
      throw new TypeError('Answer-only requires one Raw Request revision');
    }
    const admissionPolicy = decodeIntentAdmissionPolicy(input.admissionPolicy, this.#digests);
    const preparedDecision = decodeIntentAdmissionDecision(input.preparedDecision, this.#digests);
    if (
      rawRequestRevision.interactionAction !== IntakeInteractionAction.ANSWER_ONLY ||
      preparedDecision.intakeRunId !== input.intakeRunId ||
      preparedDecision.rawRequestRevision !== rawRequestRevision.revision ||
      preparedDecision.rawRequestDigest !== rawRequestRevision.rawRequestDigest ||
      preparedDecision.admissionPolicyId !== admissionPolicy.id ||
      preparedDecision.admissionPolicyVersion !== admissionPolicy.version ||
      preparedDecision.admissionPolicyDigest !== admissionPolicy.digest ||
      preparedDecision.kind !== IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION ||
      preparedDecision.reasonCode !== IntentAdmissionReasonCode.ANSWER_ONLY
    ) {
      throw new TypeError('Prepared Answer-only Decision does not bind the exact operation input');
    }
    const response = responseContract('ANSWER_ONLY', this.#digests);
    const budget = budgetProfile(this.#digests);
    const preparedDecisionBinding: PreparedAnswerOnlyDecisionBinding = Object.freeze({
      decisionId: preparedDecision.id,
      decisionDigest: preparedDecision.decisionDigest,
      intakeRunId: preparedDecision.intakeRunId,
      rawRequestRevision: preparedDecision.rawRequestRevision,
      rawRequestDigest: preparedDecision.rawRequestDigest,
      admissionPolicy: policyRef(admissionPolicy),
      decisionKind: preparedDecision.kind,
      outcome: preparedDecision.outcome,
      reasonCode: preparedDecision.reasonCode,
      executionDisposition: preparedDecision.executionDisposition,
    });
    const packageValue: AnswerOnlyPackage = Object.freeze({
      schemaVersion: 1,
      kind: 'ANSWER_ONLY',
      intakeRunId: input.intakeRunId,
      rawRequestRevision,
      preparedDecisionBinding,
      assistantProfile: this.#assistantProfile,
      assistantAdapter: this.#assistantAdapter,
      responseContract: response,
      budgetProfile: budget,
    });
    if (
      canonicalBytes(packageValue, this.#canonicalizer) >
      m25IntakeBudgetDefinition.maximumCanonicalPackageBytes
    ) {
      throw new TypeError('Canonical Answer-only Package exceeds the fixed package budget');
    }
    const entries: readonly IntakeManifestEntry[] = [
      {
        kind: IntakeManifestEntryKind.RAW_REQUEST_REVISION,
        sourceRef: rawRequestRevision.rawRequestId,
        sourceRevision: rawRequestRevision.revision,
        sourceDigest: rawRequestRevision.rawRequestDigest,
        authorityClass: SourceAuthorityClass.USER_STATED,
      },
      {
        kind: IntakeManifestEntryKind.ADMISSION_POLICY,
        sourceRef: admissionPolicy.id,
        sourceDigest: admissionPolicy.digest,
        authorityClass: SourceAuthorityClass.POLICY_DERIVED,
      },
    ];
    const manifest = manifestFor(
      {
        manifestId: input.manifestId,
        createdAt: input.createdAt,
        operation: 'ANSWER_ONLY',
        intakeRunId: input.intakeRunId,
        rawRequestRevisions: [rawRequestRevision],
        questionRefs: [],
        answerBindingDigests: [],
        ...(rawRequestRevision.declaredProjectRef === undefined
          ? {}
          : { declaredProjectRef: rawRequestRevision.declaredProjectRef }),
        admissionPolicy: policyRef(admissionPolicy),
        assistantAdapter: this.#assistantAdapter,
        responseContract: response,
        budgetProfile: budget,
        entries,
        omissions: input.omissions ?? [],
        packageDigest: this.#digests.digest(packageValue),
      },
      this.#digests,
    );
    return Object.freeze({ package: packageValue, manifest });
  }

  public recompileAnswerOnly(
    input: CompileAnswerOnlyPackageInput,
    retainedManifest: IntakeManifest,
  ): IntakePackageCompilation<AnswerOnlyPackage> {
    if (
      retainedManifest.assistantAdapter.id !== this.#assistantAdapter.id ||
      retainedManifest.assistantAdapter.version !== this.#assistantAdapter.version
    ) {
      throw new TypeError('Retained Intake Manifest does not match this Package compiler');
    }
    return this.compileAnswerOnly(input);
  }

  #assertExactCompilation(
    actual: IntakePackageCompilation<IntakePackage | AnswerOnlyPackage>,
    expected: IntakePackageCompilation<IntakePackage | AnswerOnlyPackage>,
  ): void {
    if (
      this.#canonicalizer.canonicalize(actual.package) !==
        this.#canonicalizer.canonicalize(expected.package) ||
      this.#canonicalizer.canonicalize(actual.manifest) !==
        this.#canonicalizer.canonicalize(expected.manifest)
    ) {
      throw new TypeError('Intake package and Manifest are not one canonical compilation');
    }
  }
}

export interface IntakePackageCompilerPort {
  compileIntentAnalysis(
    input: CompileIntentAnalysisPackageInput,
  ): IntakePackageCompilation<IntakePackage>;
  compileAnswerOnly(
    input: CompileAnswerOnlyPackageInput,
  ): IntakePackageCompilation<AnswerOnlyPackage>;
  validateIntentAnalysisCompilation(compilation: IntakePackageCompilation<IntakePackage>): void;
  validateAnswerOnlyCompilation(compilation: IntakePackageCompilation<AnswerOnlyPackage>): void;
  recompileAnswerOnly(
    input: CompileAnswerOnlyPackageInput,
    retainedManifest: IntakeManifest,
  ): IntakePackageCompilation<AnswerOnlyPackage>;
}

export class M25IntakePackageCompiler
  extends VersionedIntakePackageCompiler
  implements IntakePackageCompilerPort
{
  public constructor(options: IntakePackageCompilerOptions) {
    super(options, m25IntakeAssistantProfile, m25IntakeAssistantAdapter);
  }
}

export class M251IntakePackageCompiler implements IntakePackageCompilerPort {
  readonly #v1: VersionedIntakePackageCompiler;
  readonly #v2: VersionedIntakePackageCompiler;

  public constructor(options: IntakePackageCompilerOptions) {
    this.#v1 = new VersionedIntakePackageCompiler(
      options,
      m25IntakeAssistantProfile,
      m25IntakeAssistantAdapter,
    );
    this.#v2 = new VersionedIntakePackageCompiler(
      options,
      m251IntakeAssistantProfile,
      m251IntakeAssistantAdapter,
    );
  }

  public compileIntentAnalysis(
    input: CompileIntentAnalysisPackageInput,
  ): IntakePackageCompilation<IntakePackage> {
    return this.#v2.compileIntentAnalysis(input);
  }

  public compileAnswerOnly(
    input: CompileAnswerOnlyPackageInput,
  ): IntakePackageCompilation<AnswerOnlyPackage> {
    return this.#v2.compileAnswerOnly(input);
  }

  public validateIntentAnalysisCompilation(
    compilation: IntakePackageCompilation<IntakePackage>,
  ): void {
    this.#compilerForPackage(compilation.package).validateIntentAnalysisCompilation(compilation);
  }

  public validateAnswerOnlyCompilation(
    compilation: IntakePackageCompilation<AnswerOnlyPackage>,
  ): void {
    this.#compilerForPackage(compilation.package).validateAnswerOnlyCompilation(compilation);
  }

  public recompileAnswerOnly(
    input: CompileAnswerOnlyPackageInput,
    retainedManifest: IntakeManifest,
  ): IntakePackageCompilation<AnswerOnlyPackage> {
    if (retainedManifest.assistantAdapter.id !== M25_INTAKE_ASSISTANT_ADAPTER_ID) {
      throw new TypeError('Retained Intake Manifest selects an unsupported Adapter');
    }
    if (retainedManifest.assistantAdapter.version === M25_INTAKE_ASSISTANT_ADAPTER_VERSION) {
      return this.#v1.recompileAnswerOnly(input, retainedManifest);
    }
    if (retainedManifest.assistantAdapter.version === M251_INTAKE_ASSISTANT_ADAPTER_VERSION) {
      return this.#v2.recompileAnswerOnly(input, retainedManifest);
    }
    throw new TypeError('Retained Intake Manifest selects an unsupported Adapter version');
  }

  #compilerForPackage(
    packageValue: IntakePackage | AnswerOnlyPackage,
  ): VersionedIntakePackageCompiler {
    return packageValue.assistantProfile.schemaVersion === 1 ? this.#v1 : this.#v2;
  }
}
