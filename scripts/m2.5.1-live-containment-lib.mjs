import { createHash } from 'node:crypto';
import { M251_REVIEW_EXCLUSION } from './m2.5.1-acceptance-lib.mjs';

export const M251_LIVE_CONTAINMENT_AUTHORIZATION_ENV =
  'CODECLOSURE_M251_CONTAINMENT_LIVE_AUTHORIZED';
export const M251_LIVE_CONTAINMENT_RECEIPT_KIND = 'CODECLOSURE_M2_5_1_LIVE_CONTAINMENT_V1';
export const M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION =
  'docs/reviews/m2.5.1-slice4-real-user-path-and-failure-closure.md';

export const M251_LIVE_CONTAINMENT_STAGE_IDS = Object.freeze([
  'PREFLIGHT',
  'DISCOVERY_PROBE',
  'PLAN_PROBE',
  'IMPLEMENT_PROBE',
  'CLOSURE',
]);

export const M251_CANDIDATE_FREE_PHASES = Object.freeze(['DISCOVERY', 'PLAN']);

export const M251_CANDIDATE_FREE_DENIED_BOUNDARIES = Object.freeze(
  [
    'AUTHORITY_HOME',
    'CANDIDATE_WORKSPACE',
    'CREDENTIAL_ROOT',
    'PROJECTION_EXCLUDED',
    'PROTECTED_ASSET',
    'SIBLING_SNAPSHOT',
    'SOURCE_CHECKOUT',
  ].toSorted(),
);

export const M251_IMPLEMENT_DENIED_BOUNDARIES = Object.freeze(
  [
    'AUTHORITY_HOME',
    'CREDENTIAL_ROOT',
    'PROJECT_READ_SNAPSHOT',
    'PROTECTED_ASSET',
    'SOURCE_CHECKOUT',
  ].toSorted(),
);

const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function fail(message) {
  throw new TypeError(message);
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function m251LiveContainmentDigest(profile, value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify([profile, canonical(value)]), 'utf8')
    .digest('hex')}`;
}

function exactKeys(value, keys, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  if (JSON.stringify(Object.keys(value).toSorted()) !== JSON.stringify([...keys].toSorted())) {
    fail(`${label} has unknown or missing fields`);
  }
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function digest(value, label) {
  const selected = string(value, label);
  if (!digestPattern.test(selected)) {
    fail(`${label} must be a SHA-256 digest`);
  }
  return selected;
}

function exactIdentity(expected, actual, label) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    fail(`${label} drifted or was substituted`);
  }
}

export function admitM251LiveContainmentAuthorization(environment) {
  if (environment[M251_LIVE_CONTAINMENT_AUTHORIZATION_ENV] !== '1') {
    fail(`${M251_LIVE_CONTAINMENT_AUTHORIZATION_ENV} must be exactly 1`);
  }
  return 'EXPLICIT';
}

export function projectM251LiveContainmentStages(completedStageIds) {
  if (
    !Array.isArray(completedStageIds) ||
    JSON.stringify(completedStageIds) !== JSON.stringify(M251_LIVE_CONTAINMENT_STAGE_IDS)
  ) {
    fail('Live containment stages are incomplete or reordered');
  }
  return Object.freeze(
    completedStageIds.map((stageId) => Object.freeze({ stageId, status: 'PASSED' })),
  );
}

function deniedBoundaryProjection(boundaries, expectedKinds, label) {
  if (!Array.isArray(boundaries) || boundaries.length !== expectedKinds.length) {
    fail(`${label} denied-boundary set is incomplete`);
  }
  const projected = boundaries
    .map((entry) => {
      exactKeys(entry, ['kind', 'pathDigest'], `${label} denied boundary`);
      return Object.freeze({
        kind: string(entry.kind, `${label} denied-boundary kind`),
        pathDigest: digest(entry.pathDigest, `${label} denied-boundary path digest`),
      });
    })
    .toSorted((left, right) => left.kind.localeCompare(right.kind));
  if (
    JSON.stringify(projected.map(({ kind }) => kind)) !== JSON.stringify(expectedKinds) ||
    new Set(projected.map(({ pathDigest }) => pathDigest)).size !== projected.length
  ) {
    fail(`${label} denied-boundary identity is incomplete or duplicated`);
  }
  return Object.freeze(projected);
}

function commonProbeProjection(input, expectedPhase, expectedSandbox, expectedBoundaries) {
  exactKeys(
    input,
    [
      'approvalRequestCount',
      'commandDigest',
      'commandExitCode',
      'commandOutputBytes',
      'commandOutputDigest',
      'commandRequestDigest',
      'commandResponseDigest',
      'cwdDigest',
      'deniedBoundaries',
      'effectiveConfigurationDigest',
      'effectiveThreadDigest',
      'forbiddenEffectCount',
      'isolationProfileDigest',
      'isolationProfileId',
      'networkAccess',
      'permissionProfileDigest',
      'permissionProfileId',
      'phase',
      'phaseEntryDigest',
      'sandboxType',
    ],
    `${expectedPhase} containment probe`,
  );
  if (
    input.phase !== expectedPhase ||
    input.sandboxType !== expectedSandbox ||
    input.networkAccess !== false ||
    input.commandExitCode !== 0 ||
    input.commandOutputBytes !== 0 ||
    input.forbiddenEffectCount !== 0 ||
    input.approvalRequestCount !== 0
  ) {
    fail(`${expectedPhase} containment probe did not close under the exact isolation policy`);
  }
  const projected = Object.freeze({
    phase: input.phase,
    phaseEntryDigest: digest(input.phaseEntryDigest, `${expectedPhase} phase-entry digest`),
    isolationProfileId: string(input.isolationProfileId, `${expectedPhase} isolation-profile ID`),
    isolationProfileDigest: digest(
      input.isolationProfileDigest,
      `${expectedPhase} isolation-profile digest`,
    ),
    permissionProfileId: string(
      input.permissionProfileId,
      `${expectedPhase} permission-profile ID`,
    ),
    permissionProfileDigest: digest(
      input.permissionProfileDigest,
      `${expectedPhase} permission-profile digest`,
    ),
    sandboxType: input.sandboxType,
    networkAccess: false,
    cwdDigest: digest(input.cwdDigest, `${expectedPhase} cwd digest`),
    commandDigest: digest(input.commandDigest, `${expectedPhase} command digest`),
    commandRequestDigest: digest(
      input.commandRequestDigest,
      `${expectedPhase} command-request digest`,
    ),
    commandResponseDigest: digest(
      input.commandResponseDigest,
      `${expectedPhase} command-response digest`,
    ),
    commandExitCode: 0,
    commandOutputBytes: 0,
    commandOutputDigest: digest(
      input.commandOutputDigest,
      `${expectedPhase} command-output digest`,
    ),
    effectiveConfigurationDigest: digest(
      input.effectiveConfigurationDigest,
      `${expectedPhase} effective-configuration digest`,
    ),
    effectiveThreadDigest: digest(
      input.effectiveThreadDigest,
      `${expectedPhase} effective-Thread digest`,
    ),
    deniedBoundaries: deniedBoundaryProjection(
      input.deniedBoundaries,
      expectedBoundaries,
      expectedPhase,
    ),
    forbiddenEffectCount: 0,
    approvalRequestCount: 0,
  });
  if (projected.commandOutputDigest !== m251LiveContainmentDigest('command-output-v1', '')) {
    fail(`${expectedPhase} containment probe retained command output`);
  }
  return projected;
}

export function projectM251CandidateFreeContainmentProbe(input) {
  exactKeys(
    input,
    [
      'common',
      'selectedReadPathDigest',
      'selectedReadSucceeded',
      'snapshotClosingDigest',
      'snapshotOpeningDigest',
      'snapshotWriteDenied',
    ],
    'Candidate-free containment input',
  );
  const phase = input.common?.phase;
  if (!M251_CANDIDATE_FREE_PHASES.includes(phase)) {
    fail('Candidate-free containment phase is not supported');
  }
  const common = commonProbeProjection(
    input.common,
    phase,
    'READ_ONLY',
    M251_CANDIDATE_FREE_DENIED_BOUNDARIES,
  );
  if (
    input.selectedReadSucceeded !== true ||
    input.snapshotWriteDenied !== true ||
    input.snapshotOpeningDigest !== input.snapshotClosingDigest
  ) {
    fail('Candidate-free containment did not prove selected read and snapshot immutability');
  }
  return Object.freeze({
    ...common,
    selectedReadPathDigest: digest(
      input.selectedReadPathDigest,
      'Candidate-free selected-read path digest',
    ),
    selectedReadSucceeded: true,
    snapshotWriteDenied: true,
    snapshotOpeningDigest: digest(
      input.snapshotOpeningDigest,
      'Candidate-free snapshot opening digest',
    ),
    snapshotClosingDigest: digest(
      input.snapshotClosingDigest,
      'Candidate-free snapshot closing digest',
    ),
  });
}

const candidateFreeDetailKeys = Object.freeze([
  'selectedReadPathDigest',
  'selectedReadSucceeded',
  'snapshotClosingDigest',
  'snapshotOpeningDigest',
  'snapshotWriteDenied',
]);

function candidateFreeProbeInput(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('Candidate-free containment probe must be an object');
  }
  return {
    common: Object.fromEntries(
      Object.entries(value).filter(([key]) => !candidateFreeDetailKeys.includes(key)),
    ),
    selectedReadPathDigest: value.selectedReadPathDigest,
    selectedReadSucceeded: value.selectedReadSucceeded,
    snapshotWriteDenied: value.snapshotWriteDenied,
    snapshotOpeningDigest: value.snapshotOpeningDigest,
    snapshotClosingDigest: value.snapshotClosingDigest,
  };
}

export function projectM251CandidateFreeContainmentProbes(values) {
  if (!Array.isArray(values)) {
    fail('Candidate-free containment probes must be an array');
  }
  const projected = values.map((value) =>
    projectM251CandidateFreeContainmentProbe(candidateFreeProbeInput(value)),
  );
  if (
    JSON.stringify(projected.map(({ phase }) => phase)) !==
    JSON.stringify(M251_CANDIDATE_FREE_PHASES)
  ) {
    fail('Candidate-free containment phases are incomplete or reordered');
  }
  return Object.freeze(projected);
}

export function projectM251ImplementContainmentProbe(input) {
  exactKeys(
    input,
    [
      'allowedWritePathDigest',
      'candidateChangeSetDigest',
      'candidateClosingDigest',
      'candidateOpeningDigest',
      'candidateWriteObserved',
      'common',
    ],
    'IMPLEMENT containment input',
  );
  const common = commonProbeProjection(
    input.common,
    'IMPLEMENT',
    'WORKSPACE_WRITE',
    M251_IMPLEMENT_DENIED_BOUNDARIES,
  );
  if (
    input.candidateWriteObserved !== true ||
    input.candidateOpeningDigest === input.candidateClosingDigest
  ) {
    fail('IMPLEMENT containment did not prove one Candidate-local mutation');
  }
  return Object.freeze({
    ...common,
    allowedWritePathDigest: digest(
      input.allowedWritePathDigest,
      'IMPLEMENT allowed-write path digest',
    ),
    candidateWriteObserved: true,
    candidateOpeningDigest: digest(
      input.candidateOpeningDigest,
      'IMPLEMENT Candidate opening digest',
    ),
    candidateClosingDigest: digest(
      input.candidateClosingDigest,
      'IMPLEMENT Candidate closing digest',
    ),
    candidateChangeSetDigest: digest(
      input.candidateChangeSetDigest,
      'IMPLEMENT Candidate change-set digest',
    ),
  });
}

function validateSourceIdentity(value, label, expectedReviewExclusion) {
  exactKeys(
    value,
    [
      'baseGitRevision',
      'digest',
      'gitBranch',
      'manifestSchema',
      'pathCount',
      'reviewExclusion',
      'workingTreeState',
    ],
    label,
  );
  digest(value.digest, `${label} digest`);
  if (value.reviewExclusion !== expectedReviewExclusion) {
    fail(`${label} uses the wrong review exclusion`);
  }
}

function validateClosure(value) {
  exactKeys(
    value,
    [
      'assessmentRootRemoved',
      'candidateRootRemoved',
      'controlledProcessesShutdownClean',
      'credentialSourceUnchanged',
      'projectReadRootRemoved',
      'protectedAssetUnchanged',
      'sourceProjectUnchanged',
      'sourceUnchanged',
    ],
    'Live containment closure',
  );
  if (Object.values(value).some((entry) => entry !== true)) {
    fail('Live containment closure is incomplete');
  }
}

function validatePrivacy(value) {
  exactKeys(
    value,
    [
      'assistantOrModelContentRetained',
      'credentialOrAccountContentRetained',
      'rawCommandRetained',
      'rawExceptionRetained',
      'rawProtocolRetained',
      'reasoningOrTranscriptRetained',
      'sourceBytesRetained',
      'unrestrictedCommandOutputRetained',
    ],
    'Live containment privacy receipt',
  );
  if (Object.values(value).some((entry) => entry !== false)) {
    fail('Live containment receipt retained prohibited content');
  }
}

export function validateM251LiveContainmentReceipt(
  value,
  expectedIdentity,
  expectedReviewExclusion = M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION,
) {
  if (
    ![M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION, M251_REVIEW_EXCLUSION].includes(
      expectedReviewExclusion,
    )
  ) {
    fail('Live containment receipt uses an unsupported review exclusion');
  }
  exactKeys(
    value,
    [
      'authorization',
      'candidateFree',
      'closure',
      'implement',
      'kind',
      'privacy',
      'profileIdentity',
      'projectIdentity',
      'rootIdentity',
      'schemaVersion',
      'source',
      'stages',
      'toolchainIdentity',
    ],
    'M2.5.1 Live containment receipt',
  );
  exactKeys(
    expectedIdentity,
    ['profileIdentity', 'projectIdentity', 'rootIdentity', 'source', 'toolchainIdentity'],
    'Expected Live containment identity',
  );
  if (
    value.schemaVersion !== 1 ||
    value.kind !== M251_LIVE_CONTAINMENT_RECEIPT_KIND ||
    value.authorization !== 'EXPLICIT'
  ) {
    fail('M2.5.1 Live containment receipt identity is invalid');
  }
  value.stages.forEach((entry) =>
    exactKeys(entry, ['stageId', 'status'], 'Live containment stage'),
  );
  projectM251LiveContainmentStages(value.stages.map(({ stageId }) => stageId));
  if (value.stages.some(({ status }) => status !== 'PASSED')) {
    fail('M2.5.1 Live containment stage did not pass');
  }
  exactKeys(value.source, ['closing', 'opening'], 'Live containment source closure');
  validateSourceIdentity(value.source.opening, 'Opening source identity', expectedReviewExclusion);
  validateSourceIdentity(value.source.closing, 'Closing source identity', expectedReviewExclusion);
  exactIdentity(value.source.opening, value.source.closing, 'Live containment source identity');
  for (const field of [
    'source',
    'toolchainIdentity',
    'profileIdentity',
    'projectIdentity',
    'rootIdentity',
  ]) {
    exactIdentity(expectedIdentity[field], value[field], `Expected ${field}`);
  }
  projectM251CandidateFreeContainmentProbes(value.candidateFree);
  projectM251ImplementContainmentProbe({
    common: Object.fromEntries(
      Object.entries(value.implement).filter(
        ([key]) =>
          ![
            'allowedWritePathDigest',
            'candidateChangeSetDigest',
            'candidateClosingDigest',
            'candidateOpeningDigest',
            'candidateWriteObserved',
          ].includes(key),
      ),
    ),
    allowedWritePathDigest: value.implement.allowedWritePathDigest,
    candidateWriteObserved: value.implement.candidateWriteObserved,
    candidateOpeningDigest: value.implement.candidateOpeningDigest,
    candidateClosingDigest: value.implement.candidateClosingDigest,
    candidateChangeSetDigest: value.implement.candidateChangeSetDigest,
  });
  validateClosure(value.closure);
  validatePrivacy(value.privacy);
  return value;
}

export function assertM251LiveContainmentMetadataOnly(value, forbiddenStrings = []) {
  const serialized = JSON.stringify(value);
  for (const forbidden of forbiddenStrings) {
    if (typeof forbidden === 'string' && forbidden.length > 0 && serialized.includes(forbidden)) {
      fail('Live containment receipt contains a prohibited raw value');
    }
  }
  return value;
}
