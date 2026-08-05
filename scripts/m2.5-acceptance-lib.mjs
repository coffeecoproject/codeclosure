import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { parseM2CurrentSourceRegressionResult } from './m2-acceptance-lib.mjs';

export const M25_REVIEW_EXCLUSION = 'docs/reviews/m2.5-completion-review.md';

export const M25AcceptanceOutcome = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
});

export const M25AssessmentMeaning = Object.freeze({
  READY: 'READY_FOR_INDEPENDENT_REVIEW',
  NOT_READY: 'NOT_READY_FOR_INDEPENDENT_REVIEW',
});

export const M25AcceptanceStage = Object.freeze({
  PREFLIGHT: 'preflight',
  QUALITY: 'quality',
  M1_REGRESSION: 'm1-regression',
  M2_REGRESSION: 'm2-regression',
  STATIC_AUTHORITY: 'm2.5-static-authority',
  ADAPTER: 'm2.5-deterministic-adapter',
  SQLITE: 'm2.5-sqlite-reopen',
  CLI: 'm2.5-cli-cross-process',
  SOURCE_CLOSURE: 'source-closure-and-manifest',
});

export const M25_STAGE_ORDER = Object.freeze(Object.values(M25AcceptanceStage));

export const M25_REQUIRED_NON_CLAIMS = Object.freeze([
  'NOT_THE_INDEPENDENT_M2_5_MILESTONE_VERDICT',
  'NOT_A_TECHNICAL_ACCEPTANCE_DECISION',
  'NOT_PRODUCT_COMPLETION',
  'NOT_RELEASE_DEPLOYMENT_OR_EXTERNAL_EFFECT_AUTHORITY',
]);

export const M25_ACCEPTANCE_MATRIX_CONTRACT_DIGEST =
  'sha256:a25fe0b685588fea0d8a60a62dcdbed4ee15f715da56de08dcb30db9bdee35d2';

export const M25_REQUIRED_SCENARIO_EVIDENCE = Object.freeze([
  Object.freeze({
    scenarioId: 'M25-D02-ASSISTANT-ASSUMPTION',
    stageId: M25AcceptanceStage.ADAPTER,
  }),
  Object.freeze({
    scenarioId: 'M25-D01-D09-GOVERNED-CHAIN',
    stageId: M25AcceptanceStage.CLI,
  }),
]);

const matrixGroupCounts = Object.freeze({ E: 10, D: 9, S: 9, G: 26, R: 11, C: 6 });
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const portableArtifactPathPattern = /^[a-z0-9][a-z0-9._/-]*$/u;
const stagesRequiringTests = new Set([
  M25AcceptanceStage.QUALITY,
  M25AcceptanceStage.STATIC_AUTHORITY,
  M25AcceptanceStage.ADAPTER,
  M25AcceptanceStage.SQLITE,
  M25AcceptanceStage.CLI,
]);
const strictReopenMatrixRows = new Set([
  'M25-E05',
  'M25-E10',
  'M25-D01',
  'M25-D02',
  'M25-D03',
  'M25-D04',
  'M25-D05',
  'M25-D06',
  'M25-D07',
  'M25-D09',
  'M25-S04',
  'M25-S08',
  'M25-G20',
  'M25-G21',
  'M25-G26',
  'M25-R03',
  'M25-R05',
  'M25-R10',
]);

function expectedMatrixIds() {
  const identifiers = [];
  for (const [group, count] of Object.entries(matrixGroupCounts)) {
    for (let index = 1; index <= count; index += 1) {
      identifiers.push(`M25-${group}${String(index).padStart(2, '0')}`);
    }
  }
  return Object.freeze(identifiers);
}

export const M25_MANDATORY_MATRIX_IDS = expectedMatrixIds();

function assertObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new TypeError(`${name} has unknown or missing fields`);
  }
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function assertDigest(value, name) {
  const digest = assertString(value, name);
  if (!sha256Pattern.test(digest)) {
    throw new TypeError(`${name} must be a SHA-256 digest`);
  }
  return digest;
}

function assertOutcome(value, name) {
  if (!Object.values(M25AcceptanceOutcome).includes(value)) {
    throw new TypeError(`${name} has an unsupported outcome`);
  }
  return value;
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function assertDigestArray(value, expectedLength, name) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new TypeError(`${name} must contain exactly ${String(expectedLength)} digests`);
  }
  for (const [index, digest] of value.entries()) {
    assertDigest(digest, `${name} ${String(index)}`);
  }
  return value;
}

export function validateM25ScenarioEvidenceArtifact(rawArtifact) {
  const artifact = assertObject(rawArtifact, 'M2.5 scenario evidence artifact');
  assertExactKeys(
    artifact,
    [
      'schemaVersion',
      'kind',
      'scenarioId',
      'isolatedRoots',
      'inputIdentity',
      'expectedDisposition',
      'observedDisposition',
      'finalSafeAuthorityProjection',
      'strictReopen',
    ],
    'M2.5 scenario evidence artifact',
  );
  if (
    artifact.schemaVersion !== 1 ||
    artifact.kind !== 'M25_SCENARIO_EVIDENCE' ||
    !M25_REQUIRED_SCENARIO_EVIDENCE.some(({ scenarioId }) => scenarioId === artifact.scenarioId)
  ) {
    throw new TypeError('M2.5 scenario evidence identity is invalid');
  }
  const assistantScenario = artifact.scenarioId === 'M25-D02-ASSISTANT-ASSUMPTION';
  const expectedRootKinds = assistantScenario
    ? [
        'AUTHORITY_ROOT',
        'ADAPTER_STATE_ROOT',
        'OPERATION_ROOT',
        'PROCESS_STATE_ROOT',
        'PROCESS_TEMPORARY_ROOT',
      ]
    : ['AUTHORITY_HOME', 'AUTHORITY_DATABASE', 'PROJECT_ROOT'];
  if (
    !Array.isArray(artifact.isolatedRoots) ||
    artifact.isolatedRoots.length !== expectedRootKinds.length
  ) {
    throw new TypeError('M2.5 scenario evidence has an invalid isolated-root set');
  }
  const actualRootKinds = [];
  for (const rawRoot of artifact.isolatedRoots) {
    const root = assertObject(rawRoot, 'M2.5 scenario isolated root');
    assertExactKeys(root, ['kind', 'path'], 'M2.5 scenario isolated root');
    actualRootKinds.push(assertString(root.kind, 'M2.5 scenario isolated root kind'));
    assertString(root.path, 'M2.5 scenario isolated root path');
  }
  if (JSON.stringify(actualRootKinds) !== JSON.stringify(expectedRootKinds)) {
    throw new TypeError('M2.5 scenario evidence isolated-root kinds differ');
  }
  const inputIdentity = assertObject(artifact.inputIdentity, 'M2.5 scenario input identity');
  assertExactKeys(
    inputIdentity,
    ['operation', 'primaryId', 'digest'],
    'M2.5 scenario input identity',
  );
  const expectedOperation = assistantScenario ? 'INTENT_ANALYSIS' : 'GOVERNED_EXECUTION';
  if (inputIdentity.operation !== expectedOperation) {
    throw new TypeError('M2.5 scenario input operation differs from its scenario');
  }
  assertString(inputIdentity.primaryId, 'M2.5 scenario input primary identity');
  assertDigest(inputIdentity.digest, 'M2.5 scenario input digest');
  const expectedDisposition = assistantScenario
    ? 'COMPLETED/ONE_UNSUPPORTED_ASSUMPTION/NO_AUTHORITY_FIELDS'
    : 'CLARIFICATION_REQUIRED->MATERIALIZED/START_COMMAND_APPLIED/STRICT_REOPEN_MATCHED';
  if (
    artifact.expectedDisposition !== expectedDisposition ||
    artifact.observedDisposition !== expectedDisposition
  ) {
    throw new TypeError('M2.5 scenario expected and observed dispositions differ');
  }
  const projection = assertObject(
    artifact.finalSafeAuthorityProjection,
    'M2.5 scenario final safe authority projection',
  );
  if (assistantScenario) {
    assertExactKeys(
      projection,
      [
        'responseDigest',
        'proposedAssumptionCount',
        'decisionAuthorityPresent',
        'goalAuthorityPresent',
        'operationState',
        'processLaunchCount',
        'threadStartCount',
        'turnStartCount',
      ],
      'M2.5 assistant scenario final safe authority projection',
    );
    assertDigest(projection.responseDigest, 'M2.5 assistant scenario response digest');
    if (
      projection.proposedAssumptionCount !== 1 ||
      projection.decisionAuthorityPresent !== false ||
      projection.goalAuthorityPresent !== false ||
      projection.operationState !== 'COMPLETED' ||
      projection.processLaunchCount !== 1 ||
      projection.threadStartCount !== 1 ||
      projection.turnStartCount !== 1 ||
      artifact.strictReopen !== 'NOT_APPLICABLE'
    ) {
      throw new TypeError('M2.5 assistant scenario projection is not the closed D02 result');
    }
  } else {
    assertExactKeys(
      projection,
      [
        'intakeRunId',
        'intakeRunStatus',
        'intakeRunVersion',
        'assistantAdapterId',
        'assistantAdapterVersion',
        'rawRequestDigests',
        'proposalDigests',
        'projectionDigests',
        'decisionDigests',
        'answerBindingDigests',
        'materializationDigest',
        'startAuthorizationDigest',
        'goalId',
        'workflowId',
        'workflowRunStatus',
        'activeAttemptPresent',
        'declaredProjectIdentityDigest',
      ],
      'M2.5 governed scenario final safe authority projection',
    );
    for (const field of ['intakeRunId', 'goalId', 'workflowId']) {
      assertString(projection[field], `M2.5 governed scenario ${field}`);
    }
    if (
      projection.intakeRunStatus !== 'MATERIALIZED' ||
      projection.assistantAdapterId !== 'intake-assistant-adapter_codex-app-server' ||
      projection.assistantAdapterVersion !== 'codeclosure-m2-5-intake-adapter-v1' ||
      projection.workflowRunStatus !== 'CLOSED' ||
      projection.activeAttemptPresent !== false ||
      artifact.strictReopen !== 'MATCHED'
    ) {
      throw new TypeError('M2.5 governed scenario projection is not the closed D01-D09 result');
    }
    if (assertNonNegativeInteger(projection.intakeRunVersion, 'M2.5 Intake version') < 1) {
      throw new TypeError('M2.5 governed scenario Intake version must be positive');
    }
    assertDigestArray(projection.rawRequestDigests, 2, 'M2.5 governed Raw Request digests');
    assertDigestArray(projection.proposalDigests, 2, 'M2.5 governed Proposal digests');
    assertDigestArray(projection.projectionDigests, 2, 'M2.5 governed Projection digests');
    assertDigestArray(projection.decisionDigests, 2, 'M2.5 governed Decision digests');
    assertDigestArray(projection.answerBindingDigests, 1, 'M2.5 governed Answer Binding digests');
    for (const field of [
      'materializationDigest',
      'startAuthorizationDigest',
      'declaredProjectIdentityDigest',
    ]) {
      assertDigest(projection[field], `M2.5 governed scenario ${field}`);
    }
    assertBoolean(projection.activeAttemptPresent, 'M2.5 governed active Attempt presence');
  }
  if (!['MATCHED', 'NOT_APPLICABLE'].includes(artifact.strictReopen)) {
    throw new TypeError('M2.5 scenario strict-reopen disposition is invalid');
  }
  return artifact;
}

export function sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, 'utf8'));
}

export function parseM25AcceptanceMatrix(markdown) {
  const rows = [];
  const seen = new Set();
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^\| `(?<id>M25-[EDSGRC]\d{2})` \| (?<middle>.*?) \| (?<result>.*?) \|$/u.exec(
      line,
    );
    if (match?.groups === undefined) continue;
    const { id, middle, result } = match.groups;
    if (seen.has(id)) {
      throw new TypeError(`Duplicate M2.5 acceptance matrix row: ${id}`);
    }
    seen.add(id);
    rows.push(Object.freeze({ id, requiredProof: middle, requiredResult: result }));
  }
  const actual = rows.map(({ id }) => id);
  if (JSON.stringify(actual) !== JSON.stringify(M25_MANDATORY_MATRIX_IDS)) {
    throw new TypeError(
      `M2.5 acceptance matrix identifiers differ from the executable contract: ${actual.join(', ')}`,
    );
  }
  if (m25MatrixContractDigest(rows) !== M25_ACCEPTANCE_MATRIX_CONTRACT_DIGEST) {
    throw new TypeError('M2.5 acceptance matrix semantics differ from the executable contract');
  }
  return Object.freeze(rows);
}

export function m25MatrixContractDigest(rows) {
  return sha256Text(
    JSON.stringify(
      rows.map(({ id, requiredProof, requiredResult }) => ({
        id,
        requiredProof,
        requiredResult,
      })),
    ),
  );
}

function rowContractDigest(row) {
  return sha256Text(
    JSON.stringify({
      id: row.id,
      requiredProof: row.requiredProof,
      requiredResult: row.requiredResult,
    }),
  );
}

function evidenceReceiptDigest(input) {
  return sha256Text(
    JSON.stringify({
      rowContractDigest: input.rowContractDigest,
      stageArtifactDigest: input.stageArtifactDigest,
      requiredTestNames: input.requiredTestNames,
      observedDisposition: input.observedDisposition,
      strictReopen: input.strictReopen,
    }),
  );
}

export function assertM25StageEnumeration(stages) {
  const actual = stages.map(({ id }) => id);
  if (JSON.stringify(actual) !== JSON.stringify(M25_STAGE_ORDER)) {
    throw new TypeError(
      `M2.5 stage enumeration differs from the canonical order: ${actual.join(', ')}`,
    );
  }
  for (const stage of stages) {
    if (!Array.isArray(stage.command) || stage.command.length === 0) {
      throw new TypeError(`M2.5 stage ${stage.id} has no exact command`);
    }
    if (stage.command.some((part) => typeof part !== 'string' || part.length === 0)) {
      throw new TypeError(`M2.5 stage ${stage.id} has an invalid command`);
    }
  }
  return Object.freeze(stages.map((stage) => Object.freeze(stage)));
}

export function parseNodeTestSummaries(output, { requireTests = false } = {}) {
  const summaries = [];
  const pattern =
    /Node tests: PASS \((\d+)\/(\d+); fail=(\d+), cancelled=(\d+), skipped=(\d+), todo=(\d+)\)/gu;
  for (const match of output.matchAll(pattern)) {
    const summary = Object.freeze({
      pass: Number(match[1]),
      tests: Number(match[2]),
      fail: Number(match[3]),
      cancelled: Number(match[4]),
      skipped: Number(match[5]),
      todo: Number(match[6]),
    });
    if (
      summary.pass !== summary.tests ||
      summary.fail !== 0 ||
      summary.cancelled !== 0 ||
      summary.skipped !== 0 ||
      summary.todo !== 0
    ) {
      throw new TypeError('A passing M2.5 stage contains a non-passing Node test summary');
    }
    summaries.push(summary);
  }
  const testCount = summaries.reduce((total, summary) => total + summary.tests, 0);
  if (requireTests && testCount === 0) {
    throw new TypeError('A mandatory M2.5 test stage executed zero tests');
  }
  return Object.freeze(summaries);
}

export function parseNodeTestNames(output) {
  const names = new Set();
  for (const match of output.matchAll(/^\s*# Subtest: (?<name>.+)$/gmu)) {
    const name = match.groups?.name;
    if (name !== undefined && name.length > 0) names.add(name);
  }
  return Object.freeze([...names].sort());
}

export function parseM25SourceIdentity(output) {
  const values = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([^:]+): (.*)$/u.exec(line);
    if (match !== null) values.set(match[1], match[2]);
  }
  const required = [
    'Base Git revision',
    'Git branch',
    'Working tree state',
    'Source manifest schema',
    'Source manifest paths',
    'Source manifest digest',
    'Self-referential review exclusion',
  ];
  const missing = required.filter((field) => !values.has(field));
  if (missing.length !== 0) {
    throw new TypeError(`M2.5 source identity is missing: ${missing.join(', ')}`);
  }
  const pathCount = Number(values.get('Source manifest paths'));
  if (!Number.isSafeInteger(pathCount) || pathCount < 1) {
    throw new TypeError('M2.5 source manifest path count is invalid');
  }
  const reviewExclusion = values.get('Self-referential review exclusion');
  if (reviewExclusion !== M25_REVIEW_EXCLUSION) {
    throw new TypeError('M2.5 source identity uses an unauthorized review-file exclusion');
  }
  return Object.freeze({
    availability: 'AVAILABLE',
    baseGitRevision: values.get('Base Git revision'),
    gitBranch: values.get('Git branch'),
    workingTreeState: values.get('Working tree state'),
    manifestSchema: values.get('Source manifest schema'),
    pathCount,
    digest: assertDigest(values.get('Source manifest digest'), 'M2.5 source manifest digest'),
    reviewExclusion,
  });
}

export function m25SourceIdentitiesMatch(opening, closing) {
  if (opening.availability !== 'AVAILABLE' || closing.availability !== 'AVAILABLE') {
    return false;
  }
  return JSON.stringify(opening) === JSON.stringify(closing);
}

function validateSourceIdentityObject(rawIdentity, name) {
  const identity = assertObject(rawIdentity, name);
  if (identity.availability === 'UNAVAILABLE') {
    assertExactKeys(identity, ['availability', 'reasonCode'], name);
    assertString(identity.reasonCode, `${name} unavailable reason`);
    return identity;
  }
  assertExactKeys(
    identity,
    [
      'availability',
      'baseGitRevision',
      'gitBranch',
      'workingTreeState',
      'manifestSchema',
      'pathCount',
      'digest',
      'reviewExclusion',
    ],
    name,
  );
  if (identity.availability !== 'AVAILABLE') {
    throw new TypeError(`${name} availability is invalid`);
  }
  assertString(identity.baseGitRevision, `${name} Git revision`);
  assertString(identity.gitBranch, `${name} Git branch`);
  assertString(identity.workingTreeState, `${name} working-tree state`);
  if (
    identity.manifestSchema !== 'codeclosure-source-manifest-v1' ||
    !Number.isSafeInteger(identity.pathCount) ||
    identity.pathCount < 1 ||
    identity.reviewExclusion !== M25_REVIEW_EXCLUSION
  ) {
    throw new TypeError(`${name} has invalid source-manifest authority`);
  }
  assertDigest(identity.digest, `${name} digest`);
  return identity;
}

function validateVersionedDigestIdentity(rawIdentity, name) {
  const identity = assertObject(rawIdentity, name);
  assertExactKeys(identity, ['id', 'version', 'digest'], name);
  assertString(identity.id, `${name} ID`);
  assertString(identity.version, `${name} version`);
  assertDigest(identity.digest, `${name} digest`);
  return identity;
}

function validateProofConfiguration(rawConfiguration) {
  const configuration = assertObject(rawConfiguration, 'M2.5 proof configuration');
  if (configuration.availability === 'UNAVAILABLE') {
    assertExactKeys(configuration, ['availability', 'reasonCode'], 'M2.5 proof configuration');
    assertString(configuration.reasonCode, 'M2.5 proof configuration unavailable reason');
    return configuration;
  }
  assertExactKeys(
    configuration,
    [
      'availability',
      'admissionPolicy',
      'assistantProfile',
      'workflowPolicy',
      'executionProfile',
      'assistantAdapter',
      'budgetProfile',
      'protocol',
      'responseContracts',
      'closedInvocation',
    ],
    'M2.5 proof configuration',
  );
  if (configuration.availability !== 'AVAILABLE') {
    throw new TypeError('M2.5 proof configuration availability is invalid');
  }
  for (const field of [
    'admissionPolicy',
    'assistantProfile',
    'workflowPolicy',
    'executionProfile',
    'assistantAdapter',
    'budgetProfile',
  ]) {
    validateVersionedDigestIdentity(configuration[field], `M2.5 ${field}`);
  }
  const protocol = assertObject(configuration.protocol, 'M2.5 protocol identity');
  assertExactKeys(protocol, ['codexVersion', 'snapshotDigest'], 'M2.5 protocol identity');
  assertString(protocol.codexVersion, 'M2.5 Codex version');
  assertDigest(protocol.snapshotDigest, 'M2.5 protocol snapshot digest');

  if (
    !Array.isArray(configuration.responseContracts) ||
    configuration.responseContracts.length !== 2
  ) {
    throw new TypeError('M2.5 proof configuration requires both response contracts');
  }
  for (const contract of configuration.responseContracts) {
    validateVersionedDigestIdentity(contract, 'M2.5 response contract');
  }
  if (new Set(configuration.responseContracts.map(({ id }) => id)).size !== 2) {
    throw new TypeError('M2.5 response contract identities must be distinct');
  }

  const closedInvocation = assertObject(
    configuration.closedInvocation,
    'M2.5 closed invocation identity',
  );
  assertExactKeys(
    closedInvocation,
    [
      'permissionProfileId',
      'configurationDigest',
      'managedRequirementsDigest',
      'permissionProfileDigest',
    ],
    'M2.5 closed invocation identity',
  );
  assertString(closedInvocation.permissionProfileId, 'M2.5 permission profile ID');
  assertDigest(closedInvocation.configurationDigest, 'M2.5 closed configuration digest');
  assertDigest(closedInvocation.managedRequirementsDigest, 'M2.5 managed requirements digest');
  assertDigest(closedInvocation.permissionProfileDigest, 'M2.5 permission profile digest');
  return configuration;
}

function validateEnvironment(rawEnvironment) {
  const environment = assertObject(rawEnvironment, 'M2.5 evidence environment');
  assertExactKeys(
    environment,
    [
      'platform',
      'architecture',
      'operatingSystemRelease',
      'nodeVersion',
      'pnpmVersion',
      'sqliteRuntime',
      'evidenceDirectoryName',
    ],
    'M2.5 evidence environment',
  );
  for (const field of Object.keys(environment)) {
    assertString(environment[field], `M2.5 environment ${field}`);
  }
  return environment;
}

function rowBinding(stageId, ...requiredTestNames) {
  return Object.freeze({ stageId, requiredTestNames: Object.freeze(requiredTestNames) });
}

const cliGovernedScenario =
  'M2.5 governed CLI chain carries one Adapter assumption through clarification, Materialization, Start, and strict reopen';
const cliActionSeparation =
  'explicit materialize-only and governed-execution keep Goal and Start dispositions separate';
const governedReadOnly =
  'governed read-only repository investigation is never classified as Answer-only';
const intakeEvidenceSeparation =
  'Intake observations and Answer-only content cannot create Goal-bound Evidence before fresh verification';
const cleanupFailure =
  'Intake assistant cleanup failure preserves the committed disposition and grants no second effect';
const answerSuccess =
  'Slice 5 Answer-only success is terminal, redacted in views, and replay makes no second call';
const answerFailure =
  'Slice 5 Answer-only failure remains APPLIED NO_EXECUTION and distinct from Intake FAILED';
const startupCompositionReopen =
  'trusted Intake composition strictly reopens, reconciles both orphan kinds, and publishes only terminal views';
const materializeOnly =
  'Slice 6 materialize-only atomically creates one READY Goal and exact replay makes no second call';
const startFailure =
  'Slice 6 Start infrastructure failure strictly reopens and only the exact preallocated Start wins once';
const commandConflict =
  'Slice 4 atomically clarifies, binds the answer revision, and abandons only the current question';
const strictCodecReopen =
  '[I-006][I-008][I-009] strict reopen rejects codec-invalid retained Intake authority';
const materializationAtomicity =
  '[I-006][I-008][I-009] Materialization atomically creates READY Goal/Workflow and Start Authorization without an Attempt';
const compoundWriteFaultTests = Object.freeze([
  ...[
    'AFTER_INTAKE_PROPOSAL_WRITE',
    'AFTER_INTAKE_SOURCE_BINDING_WRITE',
    'AFTER_INTAKE_PROJECTION_WRITE',
    'AFTER_INTAKE_AMBIGUITY_WRITE',
    'AFTER_INTAKE_DECISION_WRITE',
    'AFTER_INTAKE_QUESTION_WRITE',
    'AFTER_INTAKE_RUN_WRITE',
    'AFTER_INTAKE_AUDIT_WRITE',
    'AFTER_INTAKE_OUTCOME_WRITE',
    'BEFORE_INTAKE_COMMIT',
  ].map((step) => `[I-008][I-009] CLARIFY authority rolls back at ${step}`),
  ...[
    'AFTER_INTAKE_RAW_REQUEST_REVISION_WRITE',
    'AFTER_INTAKE_ANSWER_BINDING_WRITE',
    'AFTER_INTAKE_RUN_WRITE',
    'AFTER_INTAKE_MANIFEST_WRITE',
    'AFTER_INTAKE_RESERVATION_WRITE',
    'AFTER_INTAKE_AUDIT_WRITE',
    'BEFORE_INTAKE_COMMIT',
  ].map((step) => `[I-008][I-009] clarification answer reservation rolls back at ${step}`),
  ...[
    'AFTER_INTAKE_RESERVATION_WRITE',
    'AFTER_INTAKE_RUN_WRITE',
    'AFTER_INTAKE_DECISION_WRITE',
    'AFTER_INTAKE_AUDIT_WRITE',
    'AFTER_INTAKE_OUTCOME_WRITE',
    'BEFORE_INTAKE_COMMIT',
  ].map((step) => `[I-008][I-009] bound abandonment rolls back at ${step}`),
  ...[
    'AFTER_INTAKE_PROPOSAL_WRITE',
    'AFTER_INTAKE_SOURCE_BINDING_WRITE',
    'AFTER_INTAKE_PROJECTION_WRITE',
    'AFTER_INTAKE_AMBIGUITY_WRITE',
    'AFTER_INTAKE_DECISION_WRITE',
    'AFTER_INTAKE_GOAL_WRITE',
    'AFTER_INTAKE_WORKFLOW_WRITE',
    'AFTER_INTAKE_MATERIALIZATION_WRITE',
    'AFTER_INTAKE_START_AUTHORIZATION_WRITE',
    'AFTER_INTAKE_RUN_WRITE',
    'AFTER_INTAKE_AUDIT_WRITE',
    'AFTER_INTAKE_OUTCOME_WRITE',
    'BEFORE_INTAKE_COMMIT',
  ].map((step) => `[I-008][I-009] Intake Materialization rolls back at ${step}`),
]);

const explicitRowProofBinding = new Map([
  ['M25-E01', rowBinding(M25AcceptanceStage.PREFLIGHT)],
  ['M25-E02', rowBinding(M25AcceptanceStage.QUALITY)],
  [
    'M25-E03',
    rowBinding(
      M25AcceptanceStage.STATIC_AUTHORITY,
      'the Codex Intake adapter has one closed package edge and production capability set',
    ),
  ],
  [
    'M25-E04',
    rowBinding(
      M25AcceptanceStage.ADAPTER,
      'the closed profile explicitly disables every selected capability source',
      'an observed tool Item interrupts the Turn and discards the operation',
    ),
  ],
  ['M25-E05', rowBinding(M25AcceptanceStage.SQLITE, strictCodecReopen)],
  [
    'M25-E06',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      '[I-006] Intake golden vectors pin every Slice 1 canonical projection',
    ),
  ],
  [
    'M25-E07',
    rowBinding(
      M25AcceptanceStage.STATIC_AUTHORITY,
      'the repository has executable metadata for every runtime invariant',
    ),
  ],
  [
    'M25-E08',
    rowBinding(
      M25AcceptanceStage.STATIC_AUTHORITY,
      'only named composition owners may import their exact privileged package surface',
    ),
  ],
  [
    'M25-E09',
    rowBinding(
      M25AcceptanceStage.STATIC_AUTHORITY,
      'trusted composition has a closed export manifest and entry import surface',
    ),
  ],
  [
    'M25-E10',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      '[I-006][I-008][I-009] Intake reservation/failure/outcome survives exact reopen and replay',
    ),
  ],
  ['M25-D01', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-D02', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-D03', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-D04', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-D05', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-D06', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-D07', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-D08', rowBinding(M25AcceptanceStage.SQLITE, startFailure)],
  ['M25-D09', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-S01', rowBinding(M25AcceptanceStage.SQLITE, answerSuccess)],
  ['M25-S02', rowBinding(M25AcceptanceStage.SQLITE, answerFailure)],
  ['M25-S03', rowBinding(M25AcceptanceStage.CLI, governedReadOnly)],
  ['M25-S04', rowBinding(M25AcceptanceStage.CLI, startupCompositionReopen)],
  [
    'M25-S05',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      '[I-002][I-006][I-008] CreateGoal owns exact atomic creation and read views',
    ),
  ],
  ['M25-S06', rowBinding(M25AcceptanceStage.SQLITE, materializeOnly)],
  ['M25-S07', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-S08', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  ['M25-S09', rowBinding(M25AcceptanceStage.CLI, cliActionSeparation)],
  [
    'M25-G01',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      'Slice 6 governed execution commits Materialization before ordinary Start and replays one first Attempt',
    ),
  ],
  [
    'M25-G02',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      'Slice 4 atomically clarifies, binds the answer revision, and abandons only the current question',
    ),
  ],
  ['M25-G03', rowBinding(M25AcceptanceStage.SQLITE, answerSuccess, answerFailure)],
  [
    'M25-G04',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      'ineligible abandonment records only a deterministic rejection and unsupported preflight makes no assistant call',
    ),
  ],
  ['M25-G05', rowBinding(M25AcceptanceStage.CLI, governedReadOnly)],
  [
    'M25-G06',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      'unknown-response-field rejects the complete Intent response',
      '[I-032] model proposals and displayed answers cannot carry formal authority',
      'model-only material fields cannot materialize and a substituted Question cannot create a revision or call the assistant',
    ),
  ],
  [
    'M25-G07',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      'invalid-utf8-stream produces one closed protocol observation',
      'malformed-response rejects the complete Intent response',
      'duplicate-key-response rejects the complete Intent response',
      'unknown-response-field rejects the complete Intent response',
      'the Intent wire decoder rejects closed-contract, collection, span, and cross-Intake violations',
      'oversized Answer-only content rejects the complete response',
      'a response above the Answer-only wire budget is rejected before retention',
      'Answer-only compilation rejects a Decision from another Raw Request',
    ),
  ],
  [
    'M25-G08',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      '[I-006] clarification projections remain acyclic and substitution-sensitive',
      '[I-006][I-032] command, reservation, Decision, and result correlations fail closed',
      '[I-006][I-008][I-032] analyzed commit rejects Proposal identity substituted from its reservation and Manifest',
      '[I-006][I-008][I-009] clarification reservation binds one exact Question and one immutable Answer Binding',
      '[I-006][I-008][I-009][I-032] non-project clarification cannot replace retained project identity',
      'Admission rejects digest-valid Projection, Proposal-envelope, path, and source-class substitution',
      'verified activation rejects a clarification project path before revision or assistant work',
    ),
  ],
  [
    'M25-G09',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      '[I-006] local and deterministic test Admission Policies have exact registries',
      'model-only material fields cannot materialize and a substituted Question cannot create a revision or call the assistant',
      'a stale or mismatched candidate source span commits RESPONSE_REJECTED before Projection consumption',
    ),
  ],
  ['M25-G10', rowBinding(M25AcceptanceStage.SQLITE, answerSuccess, intakeEvidenceSeparation)],
  [
    'M25-G11',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      '[I-006][I-008][I-009] a new Raw Request revision invalidates earlier materialization derivation',
    ),
  ],
  [
    'M25-G12',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      '[I-006][I-008][I-009] competing clarification answers retain one revision and return a typed stale loser',
      materializationAtomicity,
    ),
  ],
  [
    'M25-G13',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      '[I-006][I-008][I-009] analyzed CLARIFY authority commits Decision, Question, active reference, audit, and outcome atomically',
      materializationAtomicity,
      '[I-008][I-009] the M2.5 compound-write fault registry covers every required authority boundary',
      ...compoundWriteFaultTests,
    ),
  ],
  ['M25-G14', rowBinding(M25AcceptanceStage.SQLITE, startFailure)],
  [
    'M25-G15',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      'Slice 6 overlapping automatic and manual Start commands retain one first-Start authority',
    ),
  ],
  [
    'M25-G16',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      materializationAtomicity,
      'Slice 6 rejects a preallocated Start applied with substituted Policy and Profile authority',
      'Slice 6 status rejects a non-Start command that occupies the preallocated Start identity',
      '[I-006][I-009] normal Goal, normal Workflow, and replay share authority checks',
      '[I-003][I-008] public Goal commands persist and replay stale Goal revision rejection',
      '[I-003][I-008] StartGoal checks Workflow freshness before first-Attempt semantics',
    ),
  ],
  ['M25-G17', rowBinding(M25AcceptanceStage.SQLITE, materializeOnly)],
  ['M25-G18', rowBinding(M25AcceptanceStage.SQLITE, materializeOnly)],
  [
    'M25-G19',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      'Slice 5 analysis failure commits one terminal FAILED result and exact replay is call-free',
      'request timeout and process exit map to closed unavailable classes',
      'host abort interrupts an already-started Turn and fails closed',
      'compact produces one closed protocol observation',
      answerFailure,
    ),
  ],
  ['M25-G20', rowBinding(M25AcceptanceStage.CLI, startupCompositionReopen)],
  ['M25-G21', rowBinding(M25AcceptanceStage.SQLITE, strictCodecReopen)],
  [
    'M25-G22',
    rowBinding(
      M25AcceptanceStage.ADAPTER,
      'compact produces one closed protocol observation',
      'thread-loss produces one closed protocol observation',
      'request timeout and process exit map to closed unavailable classes',
    ),
  ],
  [
    'M25-G23',
    rowBinding(
      M25AcceptanceStage.ADAPTER,
      'the closed profile explicitly disables every selected capability source',
      'an observed tool Item interrupts the Turn and discards the operation',
    ),
  ],
  ['M25-G24', rowBinding(M25AcceptanceStage.SQLITE, intakeEvidenceSeparation)],
  [
    'M25-G25',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      '[I-002][I-006][I-008] CreateGoal owns exact atomic creation and read views',
    ),
  ],
  ['M25-G26', rowBinding(M25AcceptanceStage.CLI, cliGovernedScenario)],
  [
    'M25-R01',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      '[I-006][I-008][I-009] clarification reservation binds one exact Question and one immutable Answer Binding',
    ),
  ],
  [
    'M25-R02',
    rowBinding(
      M25AcceptanceStage.ADAPTER,
      'one adapter instance cannot hide a second operation or retry',
    ),
  ],
  [
    'M25-R03',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      '[I-006][I-008][I-009] Intake reservation/failure/outcome survives exact reopen and replay',
      commandConflict,
    ),
  ],
  [
    'M25-R04',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      materializeOnly,
      '[I-006][I-008][I-009] ineligible abandonment records only a base reservation and REJECTED outcome',
      'Slice 5 analysis failure commits one terminal FAILED result and exact replay is call-free',
    ),
  ],
  ['M25-R05', rowBinding(M25AcceptanceStage.CLI, startupCompositionReopen)],
  [
    'M25-R06',
    rowBinding(
      M25AcceptanceStage.ADAPTER,
      'Intent analysis uses one fresh process, Thread, and Turn and returns only wire values',
    ),
  ],
  ['M25-R07', rowBinding(M25AcceptanceStage.CLI, cleanupFailure)],
  [
    'M25-R08',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      '[I-008][I-012] Intake write rejects audit time before its source authority',
    ),
  ],
  [
    'M25-R09',
    rowBinding(
      M25AcceptanceStage.QUALITY,
      'M2.5 retention grammar rejects every exact private-key marker across CR/LF forms',
      'M2.5 retention grammar rejects exact ASCII field markers and accepts fixed near misses',
    ),
  ],
  ['M25-R10', rowBinding(M25AcceptanceStage.SQLITE, startFailure)],
  [
    'M25-R11',
    rowBinding(
      M25AcceptanceStage.SQLITE,
      '[I-006][I-008][I-009] immediate deterministic NO_EXECUTION commits complete authority without an external reservation phase',
    ),
  ],
  ['M25-C01', rowBinding(M25AcceptanceStage.M1_REGRESSION)],
  ['M25-C02', rowBinding(M25AcceptanceStage.M2_REGRESSION)],
  [
    'M25-C03',
    rowBinding(
      M25AcceptanceStage.STATIC_AUTHORITY,
      'trusted composition has a closed export manifest and entry import surface',
    ),
  ],
  ['M25-C04', rowBinding(M25AcceptanceStage.QUALITY)],
  ['M25-C05', rowBinding(M25AcceptanceStage.SOURCE_CLOSURE)],
  ['M25-C06', rowBinding(M25AcceptanceStage.SOURCE_CLOSURE)],
]);

if (
  JSON.stringify([...explicitRowProofBinding.keys()]) !== JSON.stringify(M25_MANDATORY_MATRIX_IDS)
) {
  throw new TypeError('M2.5 row proof bindings omit or reorder a mandatory row');
}

export function proofBindingForM25MatrixRow(identifier) {
  const binding = explicitRowProofBinding.get(identifier);
  if (binding === undefined) {
    throw new TypeError(`M2.5 matrix row has no executable proof binding: ${identifier}`);
  }
  return binding;
}

export function requiredM25TestNamesForStage(stageId) {
  return Object.freeze(
    [
      ...new Set(
        [...explicitRowProofBinding.values()]
          .filter((binding) => binding.stageId === stageId)
          .flatMap((binding) => binding.requiredTestNames),
      ),
    ].sort(),
  );
}

export function stageForM25MatrixRow(identifier) {
  return proofBindingForM25MatrixRow(identifier).stageId;
}

export function buildM25MatrixResults(rows, stages) {
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]));
  return Object.freeze(
    rows.map((row) => {
      const binding = proofBindingForM25MatrixRow(row.id);
      const stageId = binding.stageId;
      const stage = stagesById.get(stageId);
      if (stage === undefined) {
        throw new TypeError(`M2.5 matrix row ${row.id} has no recorded stage`);
      }
      const stageOutcome = assertOutcome(stage.outcome, `M2.5 stage ${stageId}`);
      const executedTestNames = new Set(stage.executedTestNames ?? []);
      const missingRequiredTest = binding.requiredTestNames.some(
        (name) => !executedTestNames.has(name),
      );
      const outcome =
        stageOutcome === M25AcceptanceOutcome.PASS && missingRequiredTest
          ? M25AcceptanceOutcome.FAIL
          : stageOutcome;
      const contractDigest = rowContractDigest(row);
      const strictReopen = strictReopenMatrixRows.has(row.id) ? 'MATCHED' : 'NOT_APPLICABLE';
      return Object.freeze({
        id: row.id,
        requiredProof: row.requiredProof,
        requiredResult: row.requiredResult,
        rowContractDigest: contractDigest,
        stageId,
        isolatedStateRoot: stage.isolatedStateRoot,
        expectedDisposition: M25AcceptanceOutcome.PASS,
        observedDisposition: outcome,
        strictReopen,
        outcome,
        artifactDigest: stage.artifactDigest,
        requiredTestNames: binding.requiredTestNames,
        evidenceReceiptDigest: evidenceReceiptDigest({
          rowContractDigest: contractDigest,
          stageArtifactDigest: stage.artifactDigest,
          requiredTestNames: binding.requiredTestNames,
          observedDisposition: outcome,
          strictReopen,
        }),
      });
    }),
  );
}

export function m25AssessmentOutcome(matrixResults) {
  if (matrixResults.length !== M25_MANDATORY_MATRIX_IDS.length) {
    throw new TypeError('M2.5 assessment cannot omit a mandatory matrix row');
  }
  if (matrixResults.some(({ outcome }) => outcome === M25AcceptanceOutcome.FAIL)) {
    return M25AcceptanceOutcome.FAIL;
  }
  if (matrixResults.some(({ outcome }) => outcome === M25AcceptanceOutcome.BLOCKED)) {
    return M25AcceptanceOutcome.BLOCKED;
  }
  return M25AcceptanceOutcome.PASS;
}

export function validateM25EvidenceManifest(rawManifest, readArtifact) {
  const manifest = assertObject(rawManifest, 'M2.5 evidence manifest');
  assertExactKeys(
    manifest,
    [
      'schemaVersion',
      'kind',
      'assessmentMeaning',
      'reviewExclusion',
      'environment',
      'proofConfiguration',
      'matrixContractDigest',
      'openingSourceIdentity',
      'closingSourceIdentity',
      'stages',
      'scenarioEvidence',
      'matrixResults',
      'outcome',
      'nonClaims',
    ],
    'M2.5 evidence manifest',
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'M25_EXECUTABLE_ASSESSMENT' ||
    manifest.reviewExclusion !== M25_REVIEW_EXCLUSION
  ) {
    throw new TypeError('M2.5 evidence manifest identity or non-verdict meaning is invalid');
  }
  if (manifest.matrixContractDigest !== M25_ACCEPTANCE_MATRIX_CONTRACT_DIGEST) {
    throw new TypeError('M2.5 evidence manifest matrix contract identity is invalid');
  }
  validateEnvironment(manifest.environment);
  const proofConfiguration = validateProofConfiguration(manifest.proofConfiguration);
  const openingSourceIdentity = validateSourceIdentityObject(
    manifest.openingSourceIdentity,
    'M2.5 opening source identity',
  );
  const closingSourceIdentity = validateSourceIdentityObject(
    manifest.closingSourceIdentity,
    'M2.5 closing source identity',
  );
  const stages = manifest.stages;
  if (!Array.isArray(stages)) throw new TypeError('M2.5 evidence stages must be an array');
  if (JSON.stringify(stages.map(({ id }) => id)) !== JSON.stringify(M25_STAGE_ORDER)) {
    throw new TypeError('M2.5 evidence manifest omits or reorders a mandatory stage');
  }
  const stagesById = new Map();
  const artifactPaths = new Set();
  for (const rawStage of stages) {
    const stage = assertObject(rawStage, 'M2.5 evidence stage');
    assertExactKeys(
      stage,
      [
        'id',
        'outcome',
        'command',
        'startedAt',
        'completedAt',
        'durationMilliseconds',
        'exitCode',
        'skipCount',
        'testCount',
        'executedTestNames',
        'artifactPath',
        'artifactDigest',
        'isolatedStateRoot',
      ],
      `M2.5 evidence stage ${stage.id ?? '<unknown>'}`,
    );
    assertOutcome(stage.outcome, `M2.5 evidence stage ${stage.id}`);
    if (
      !Array.isArray(stage.command) ||
      stage.command.length === 0 ||
      stage.command.some((part) => typeof part !== 'string' || part.length === 0) ||
      typeof stage.startedAt !== 'string' ||
      typeof stage.completedAt !== 'string' ||
      Number.isNaN(Date.parse(stage.startedAt)) ||
      Number.isNaN(Date.parse(stage.completedAt)) ||
      Date.parse(stage.completedAt) < Date.parse(stage.startedAt) ||
      !Number.isSafeInteger(stage.durationMilliseconds) ||
      stage.durationMilliseconds < 0 ||
      (stage.exitCode !== null && !Number.isSafeInteger(stage.exitCode)) ||
      (stage.outcome === M25AcceptanceOutcome.PASS && stage.exitCode !== 0)
    ) {
      throw new TypeError(`M2.5 evidence stage ${stage.id} has invalid execution evidence`);
    }
    if (
      !portableArtifactPathPattern.test(stage.artifactPath) ||
      stage.artifactPath.startsWith('/') ||
      stage.artifactPath.split('/').includes('..')
    ) {
      throw new TypeError(`M2.5 evidence stage ${stage.id} has an unsafe artifact path`);
    }
    if (
      typeof stage.isolatedStateRoot !== 'string' ||
      !portableArtifactPathPattern.test(stage.isolatedStateRoot) ||
      stage.isolatedStateRoot.startsWith('/') ||
      stage.isolatedStateRoot.split('/').includes('..')
    ) {
      throw new TypeError(`M2.5 evidence stage ${stage.id} has an unsafe isolated state root`);
    }
    if (artifactPaths.has(stage.artifactPath)) {
      throw new TypeError(`M2.5 evidence stage ${stage.id} reuses an artifact path`);
    }
    artifactPaths.add(stage.artifactPath);
    const artifact = readArtifact(stage.artifactPath);
    if (sha256Bytes(artifact) !== assertDigest(stage.artifactDigest, 'Stage artifact digest')) {
      throw new TypeError(`M2.5 evidence stage ${stage.id} artifact digest does not match`);
    }
    if (stage.id === M25AcceptanceStage.M2_REGRESSION && stage.exitCode !== null) {
      const regression = parseM2CurrentSourceRegressionResult(
        Buffer.from(artifact).toString('utf8'),
        openingSourceIdentity.availability === 'AVAILABLE' ? openingSourceIdentity : undefined,
      );
      const expectedExitCode =
        regression.verdict === M25AcceptanceOutcome.PASS
          ? 0
          : regression.verdict === M25AcceptanceOutcome.BLOCKED
            ? 2
            : 1;
      if (stage.outcome !== regression.verdict || stage.exitCode !== expectedExitCode) {
        throw new TypeError('M2.5 M2-regression stage differs from its structured proof');
      }
    }
    if (
      !Array.isArray(stage.executedTestNames) ||
      stage.executedTestNames.some((name) => typeof name !== 'string' || name.length === 0) ||
      JSON.stringify(stage.executedTestNames) !==
        JSON.stringify([...new Set(stage.executedTestNames)].sort()) ||
      JSON.stringify(stage.executedTestNames) !==
        JSON.stringify(parseNodeTestNames(Buffer.from(artifact).toString('utf8')))
    ) {
      throw new TypeError(`M2.5 evidence stage ${stage.id} has invalid named-test evidence`);
    }
    if (
      !Number.isSafeInteger(stage.skipCount) ||
      stage.skipCount !== 0 ||
      !Number.isSafeInteger(stage.testCount) ||
      stage.testCount < 0
    ) {
      throw new TypeError(`M2.5 evidence stage ${stage.id} has skipped or invalid test evidence`);
    }
    if (
      stagesRequiringTests.has(stage.id) &&
      stage.outcome === M25AcceptanceOutcome.PASS &&
      stage.testCount === 0
    ) {
      throw new TypeError(`M2.5 evidence stage ${stage.id} executed zero tests`);
    }
    stagesById.set(stage.id, stage);
  }
  if (
    !m25SourceIdentitiesMatch(openingSourceIdentity, closingSourceIdentity) &&
    stagesById.get(M25AcceptanceStage.SOURCE_CLOSURE)?.outcome !== M25AcceptanceOutcome.BLOCKED
  ) {
    throw new TypeError(
      'Unavailable or drifting M2.5 source identity requires a BLOCKED source-closure stage',
    );
  }
  if (!Array.isArray(manifest.scenarioEvidence)) {
    throw new TypeError('M2.5 scenario evidence manifest must be an array');
  }
  if (
    JSON.stringify(
      manifest.scenarioEvidence.map(({ scenarioId, stageId }) => ({ scenarioId, stageId })),
    ) !== JSON.stringify(M25_REQUIRED_SCENARIO_EVIDENCE)
  ) {
    throw new TypeError('M2.5 scenario evidence omits or reorders a required scenario');
  }
  for (const rawEvidence of manifest.scenarioEvidence) {
    const evidence = assertObject(rawEvidence, 'M2.5 scenario evidence manifest entry');
    const ownerStage = stagesById.get(evidence.stageId);
    if (ownerStage === undefined) {
      throw new TypeError(`M2.5 scenario ${evidence.scenarioId} has no owner stage`);
    }
    if (evidence.availability === 'UNAVAILABLE') {
      assertExactKeys(
        evidence,
        ['availability', 'scenarioId', 'stageId', 'reasonCode'],
        `M2.5 scenario evidence ${evidence.scenarioId}`,
      );
      assertString(evidence.reasonCode, `M2.5 scenario ${evidence.scenarioId} unavailable reason`);
      if (ownerStage.outcome === M25AcceptanceOutcome.PASS) {
        throw new TypeError(`Passing M2.5 stage omitted scenario evidence ${evidence.scenarioId}`);
      }
      continue;
    }
    assertExactKeys(
      evidence,
      ['availability', 'scenarioId', 'stageId', 'artifactPath', 'artifactDigest'],
      `M2.5 scenario evidence ${evidence.scenarioId}`,
    );
    if (evidence.availability !== 'AVAILABLE') {
      throw new TypeError(`M2.5 scenario evidence ${evidence.scenarioId} availability is invalid`);
    }
    if (
      !portableArtifactPathPattern.test(evidence.artifactPath) ||
      evidence.artifactPath.startsWith('/') ||
      evidence.artifactPath.split('/').includes('..') ||
      artifactPaths.has(evidence.artifactPath)
    ) {
      throw new TypeError(`M2.5 scenario ${evidence.scenarioId} has an unsafe artifact path`);
    }
    artifactPaths.add(evidence.artifactPath);
    const artifact = readArtifact(evidence.artifactPath);
    if (
      sha256Bytes(artifact) !==
      assertDigest(evidence.artifactDigest, `M2.5 scenario ${evidence.scenarioId} digest`)
    ) {
      throw new TypeError(`M2.5 scenario ${evidence.scenarioId} artifact digest does not match`);
    }
    let parsedArtifact;
    try {
      parsedArtifact = JSON.parse(Buffer.from(artifact).toString('utf8'));
    } catch (error) {
      throw new TypeError(`M2.5 scenario ${evidence.scenarioId} artifact is not JSON`, {
        cause: error,
      });
    }
    const validatedArtifact = validateM25ScenarioEvidenceArtifact(parsedArtifact);
    if (validatedArtifact.scenarioId !== evidence.scenarioId) {
      throw new TypeError(`M2.5 scenario ${evidence.scenarioId} artifact identity differs`);
    }
  }
  if (!Array.isArray(manifest.matrixResults)) {
    throw new TypeError('M2.5 evidence matrix results must be an array');
  }
  const matrixIds = manifest.matrixResults.map(({ id }) => id);
  if (JSON.stringify(matrixIds) !== JSON.stringify(M25_MANDATORY_MATRIX_IDS)) {
    throw new TypeError('M2.5 evidence manifest omits or reorders a mandatory matrix row');
  }
  for (const rawResult of manifest.matrixResults) {
    const result = assertObject(rawResult, 'M2.5 evidence matrix result');
    assertExactKeys(
      result,
      [
        'id',
        'requiredProof',
        'requiredResult',
        'rowContractDigest',
        'stageId',
        'isolatedStateRoot',
        'expectedDisposition',
        'observedDisposition',
        'strictReopen',
        'outcome',
        'artifactDigest',
        'requiredTestNames',
        'evidenceReceiptDigest',
      ],
      `M2.5 evidence matrix result ${result.id ?? '<unknown>'}`,
    );
    assertString(result.requiredProof, `M2.5 evidence matrix result ${result.id} required proof`);
    assertString(result.requiredResult, `M2.5 evidence matrix result ${result.id} required result`);
    const binding = proofBindingForM25MatrixRow(result.id);
    const expectedStageId = binding.stageId;
    const stage = stagesById.get(expectedStageId);
    const missingRequiredTest = binding.requiredTestNames.some(
      (name) => !stage?.executedTestNames.includes(name),
    );
    const expectedRowOutcome =
      stage?.outcome === M25AcceptanceOutcome.PASS && missingRequiredTest
        ? M25AcceptanceOutcome.FAIL
        : stage?.outcome;
    const contractDigest = rowContractDigest(result);
    const strictReopen = strictReopenMatrixRows.has(result.id) ? 'MATCHED' : 'NOT_APPLICABLE';
    const expectedEvidenceReceiptDigest = evidenceReceiptDigest({
      rowContractDigest: contractDigest,
      stageArtifactDigest: result.artifactDigest,
      requiredTestNames: result.requiredTestNames,
      observedDisposition: result.observedDisposition,
      strictReopen: result.strictReopen,
    });
    if (
      result.stageId !== expectedStageId ||
      stage === undefined ||
      result.rowContractDigest !== contractDigest ||
      result.isolatedStateRoot !== stage.isolatedStateRoot ||
      result.expectedDisposition !== M25AcceptanceOutcome.PASS ||
      result.observedDisposition !== expectedRowOutcome ||
      result.strictReopen !== strictReopen ||
      result.outcome !== expectedRowOutcome ||
      result.artifactDigest !== stage.artifactDigest ||
      JSON.stringify(result.requiredTestNames) !== JSON.stringify(binding.requiredTestNames) ||
      result.evidenceReceiptDigest !== expectedEvidenceReceiptDigest
    ) {
      throw new TypeError(
        `M2.5 evidence matrix result ${result.id} differs from its proof binding`,
      );
    }
    assertOutcome(result.outcome, `M2.5 evidence matrix result ${result.id}`);
    assertDigest(result.artifactDigest, `M2.5 evidence matrix result ${result.id} digest`);
    assertDigest(
      result.rowContractDigest,
      `M2.5 evidence matrix result ${result.id} row contract digest`,
    );
    assertDigest(
      result.evidenceReceiptDigest,
      `M2.5 evidence matrix result ${result.id} evidence receipt digest`,
    );
  }
  if (m25MatrixContractDigest(manifest.matrixResults) !== manifest.matrixContractDigest) {
    throw new TypeError('M2.5 evidence matrix semantics differ from the recorded contract');
  }
  const expectedOutcome = m25AssessmentOutcome(manifest.matrixResults);
  if (manifest.outcome !== expectedOutcome) {
    throw new TypeError('M2.5 evidence manifest outcome differs from executable rows');
  }
  const expectedMeaning =
    expectedOutcome === M25AcceptanceOutcome.PASS
      ? M25AssessmentMeaning.READY
      : M25AssessmentMeaning.NOT_READY;
  if (manifest.assessmentMeaning !== expectedMeaning) {
    throw new TypeError('M2.5 evidence manifest readiness differs from its outcome');
  }
  if (
    (openingSourceIdentity.availability !== 'AVAILABLE' ||
      closingSourceIdentity.availability !== 'AVAILABLE') &&
    expectedOutcome !== M25AcceptanceOutcome.BLOCKED
  ) {
    throw new TypeError('Unavailable M2.5 source identity requires a BLOCKED assessment');
  }
  if (
    expectedOutcome === M25AcceptanceOutcome.PASS &&
    !m25SourceIdentitiesMatch(openingSourceIdentity, closingSourceIdentity)
  ) {
    throw new TypeError('A passing M2.5 manifest requires one exact source identity');
  }
  if (
    expectedOutcome === M25AcceptanceOutcome.PASS &&
    proofConfiguration.availability !== 'AVAILABLE'
  ) {
    throw new TypeError('A passing M2.5 manifest requires available proof configuration');
  }
  if (
    expectedOutcome === M25AcceptanceOutcome.PASS &&
    manifest.scenarioEvidence.some(({ availability }) => availability !== 'AVAILABLE')
  ) {
    throw new TypeError('A passing M2.5 manifest requires every scenario evidence artifact');
  }
  if (JSON.stringify(manifest.nonClaims) !== JSON.stringify(M25_REQUIRED_NON_CLAIMS)) {
    throw new TypeError('M2.5 evidence manifest must retain the exact non-claims');
  }
  return Object.freeze(manifest);
}
