import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { parseJsonRejectingDuplicateKeys } from './m2-slice0-probe-lib.mjs';

export const M251_REVIEW_EXCLUSION = 'docs/reviews/m2.5.1-completion-review.md';

export const M251AcceptanceOutcome = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
});

export const M251AssessmentMeaning = Object.freeze({
  READY: 'READY_FOR_INDEPENDENT_REVIEW',
  NOT_READY: 'NOT_READY_FOR_INDEPENDENT_REVIEW',
});

export const M251AcceptanceStage = Object.freeze({
  PREFLIGHT: 'preflight',
  QUALITY: 'quality',
  V1_COMPATIBILITY: 'v1-compatibility-and-reopen',
  INTAKE_PROTOCOL: 'intake-protocol-and-failure-closure',
  LIVE_INTAKE: 'live-intake',
  PROFILE_START: 'profile-and-start-binding',
  DETERMINISTIC_COMPOSITION: 'deterministic-composition-and-recovery',
  LIVE_COMPOSITION: 'live-intake-to-codex',
  INTEGRITY: 'candidate-and-acceptance-integrity',
  M1_REGRESSION: 'm1-regression',
  M2_REGRESSION: 'm2-current-source-regression',
  M25_REGRESSION: 'm2.5-current-source-regression',
  SOURCE_CLOSURE: 'source-closure-and-manifest',
});

export const M251_STAGE_ORDER = Object.freeze(Object.values(M251AcceptanceStage));

// These are per-command bounds. Nested regression commands receive the
// cumulative budget required by the complete bounded child procedures.
export const M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const qualityCommandBudgetMilliseconds = 1_800_000;
const focusedCommandBudgetMilliseconds = 600_000;
const liveCommandBudgetMilliseconds = 1_800_000;
const m1RegressionCommandBudgetMilliseconds = 2_400_000;
const m2RegressionCommandBudgetMilliseconds = 7_200_000;
const m25SpecificCommandBudgetMilliseconds = 1_800_000;

export const M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS = Object.freeze({
  [M251AcceptanceStage.PREFLIGHT]: null,
  [M251AcceptanceStage.QUALITY]: qualityCommandBudgetMilliseconds,
  [M251AcceptanceStage.V1_COMPATIBILITY]: 300_000,
  [M251AcceptanceStage.INTAKE_PROTOCOL]: focusedCommandBudgetMilliseconds,
  [M251AcceptanceStage.LIVE_INTAKE]: liveCommandBudgetMilliseconds,
  [M251AcceptanceStage.PROFILE_START]: focusedCommandBudgetMilliseconds,
  [M251AcceptanceStage.DETERMINISTIC_COMPOSITION]: focusedCommandBudgetMilliseconds,
  [M251AcceptanceStage.LIVE_COMPOSITION]: liveCommandBudgetMilliseconds,
  [M251AcceptanceStage.INTEGRITY]: focusedCommandBudgetMilliseconds,
  [M251AcceptanceStage.M1_REGRESSION]: m1RegressionCommandBudgetMilliseconds,
  [M251AcceptanceStage.M2_REGRESSION]: m2RegressionCommandBudgetMilliseconds,
  [M251AcceptanceStage.M25_REGRESSION]:
    qualityCommandBudgetMilliseconds +
    m1RegressionCommandBudgetMilliseconds +
    m2RegressionCommandBudgetMilliseconds +
    m25SpecificCommandBudgetMilliseconds,
  [M251AcceptanceStage.SOURCE_CLOSURE]: 300_000,
});

if (
  JSON.stringify(Object.keys(M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS)) !==
  JSON.stringify(M251_STAGE_ORDER)
) {
  throw new TypeError('M2.5.1 stage command-timeout policy differs from the canonical order');
}

export const M251_PREFLIGHT_BINDING_ROOT_KINDS = Object.freeze([
  'SOURCE_CHECKOUT',
  'DEMONSTRATION_PROJECT',
  'CREDENTIAL_ROOT',
  'PROTECTED_ASSET_ROOT',
  'EXECUTION_ROOT',
]);

const M251_PREFLIGHT_PROOF_SUPPORT = Object.freeze([
  Object.freeze({
    purpose: 'HISTORICAL_TOOLCHAIN_AND_MIGRATION_IDENTITIES',
    stageId: M251AcceptanceStage.QUALITY,
  }),
  Object.freeze({
    purpose: 'PRE_MODEL_ROOT_ISOLATION',
    stageId: M251AcceptanceStage.LIVE_COMPOSITION,
  }),
]);

export const M251_REQUIRED_NON_CLAIMS = Object.freeze([
  'NOT_THE_INDEPENDENT_M2_5_1_MILESTONE_VERDICT',
  'NOT_A_TECHNICAL_ACCEPTANCE_DECISION',
  'NOT_A_REISSUE_OF_THE_HISTORICAL_M2_OR_M2_5_VERDICT',
  'NOT_M2_6_IMPLEMENTATION_OR_AUTHORITY',
  'NOT_PRODUCT_COMPLETION',
  'NOT_RELEASE_DEPLOYMENT_OR_EXTERNAL_EFFECT_AUTHORITY',
]);

export const M251_ACCEPTANCE_MATRIX_CONTRACT_DIGEST =
  'sha256:59b16bf11c3083005b8482de9f5298fbc5e9b44f38d3c3ffbdd55849de58e6a1';

export const M251_SOURCE_PATH_MANIFEST_KIND = 'CODECLOSURE_M2_5_1_SOURCE_PATH_MANIFEST_V1';

export const M251_ALLOWED_SAFE_WARNING_CODES = Object.freeze([]);

const matrixGroupCounts = Object.freeze({ E: 7, P: 10, V: 6, L: 6, C: 11, X: 11, F: 11, R: 6 });
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const portableArtifactPathPattern = /^[a-z0-9][a-z0-9._/-]*$/u;
const portableSourcePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const proofOwnerPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const proofOwnerMarkerPattern = /^[a-z0-9][a-z0-9.-]*$/u;
const closedReasonCodePattern = /^[A-Z][A-Z0-9_]*$/u;
const safeWarningCodePattern = /^[A-Z][A-Z0-9_]*$/u;
const executedProofTestNamePattern = /^[^\r\n]{1,1000}$/u;

function rowRange(group, start, end) {
  return Array.from(
    { length: end - start + 1 },
    (_, index) => `M251-${group}${String(start + index).padStart(2, '0')}`,
  );
}

export const M251_STAGE_MATRIX_ROWS = Object.freeze({
  [M251AcceptanceStage.PREFLIGHT]: Object.freeze(['M251-E01', 'M251-E02']),
  [M251AcceptanceStage.QUALITY]: Object.freeze(rowRange('E', 3, 7)),
  [M251AcceptanceStage.V1_COMPATIBILITY]: Object.freeze(rowRange('V', 1, 6)),
  [M251AcceptanceStage.INTAKE_PROTOCOL]: Object.freeze([...rowRange('P', 1, 10), 'M251-F01']),
  [M251AcceptanceStage.LIVE_INTAKE]: Object.freeze(rowRange('L', 1, 6)),
  [M251AcceptanceStage.PROFILE_START]: Object.freeze([
    ...rowRange('C', 1, 7),
    'M251-F02',
    'M251-F03',
  ]),
  [M251AcceptanceStage.DETERMINISTIC_COMPOSITION]: Object.freeze([
    ...rowRange('C', 8, 10),
    'M251-X09',
    'M251-X10',
    'M251-X11',
    ...rowRange('F', 6, 11),
  ]),
  [M251AcceptanceStage.LIVE_COMPOSITION]: Object.freeze([
    'M251-X01',
    'M251-X02',
    ...rowRange('X', 4, 8),
  ]),
  [M251AcceptanceStage.INTEGRITY]: Object.freeze([
    'M251-C11',
    'M251-X03',
    'M251-F04',
    'M251-F05',
    'M251-R04',
  ]),
  [M251AcceptanceStage.M1_REGRESSION]: Object.freeze(['M251-R01']),
  [M251AcceptanceStage.M2_REGRESSION]: Object.freeze(['M251-R02']),
  [M251AcceptanceStage.M25_REGRESSION]: Object.freeze(['M251-R03']),
  [M251AcceptanceStage.SOURCE_CLOSURE]: Object.freeze(['M251-R05', 'M251-R06']),
});

function expectedMatrixIds() {
  const identifiers = [];
  for (const [group, count] of Object.entries(matrixGroupCounts)) {
    for (let index = 1; index <= count; index += 1) {
      identifiers.push(`M251-${group}${String(index).padStart(2, '0')}`);
    }
  }
  return Object.freeze(identifiers);
}

export const M251_MANDATORY_MATRIX_IDS = expectedMatrixIds();

const stageByMatrixRow = new Map();
for (const stageId of M251_STAGE_ORDER) {
  const rowIds = M251_STAGE_MATRIX_ROWS[stageId];
  if (rowIds === undefined) {
    throw new TypeError(`M2.5.1 stage ${stageId} has no matrix-row mapping`);
  }
  for (const rowId of rowIds) {
    if (stageByMatrixRow.has(rowId)) {
      throw new TypeError(`M2.5.1 matrix row ${rowId} has multiple assessment stages`);
    }
    stageByMatrixRow.set(rowId, stageId);
  }
}
if (
  JSON.stringify([...stageByMatrixRow.keys()].sort()) !==
  JSON.stringify([...M251_MANDATORY_MATRIX_IDS].sort())
) {
  throw new TypeError('M2.5.1 stage mapping does not cover the exact mandatory matrix');
}

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

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function assertOutcome(value, name) {
  if (!Object.values(M251AcceptanceOutcome).includes(value)) {
    throw new TypeError(`${name} has an unsupported outcome`);
  }
  return value;
}

function assertPortableArtifactPath(value, name) {
  const selected = assertString(value, name);
  if (
    !portableArtifactPathPattern.test(selected) ||
    selected.startsWith('/') ||
    selected.split('/').includes('..')
  ) {
    throw new TypeError(`${name} is not a safe repository-relative artifact path`);
  }
  return selected;
}

function assertSortedUniqueStrings(value, name, pattern) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || !pattern.test(entry)) ||
    JSON.stringify(value) !== JSON.stringify([...new Set(value)].sort())
  ) {
    throw new TypeError(`${name} must be a string-sorted unique closed set`);
  }
  return value;
}

function bytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  throw new TypeError('Evidence artifact content must be bytes or text');
}

export function m251Sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(bytes(value)).digest('hex')}`;
}

export function m251Sha256Text(value) {
  return m251Sha256Bytes(Buffer.from(value, 'utf8'));
}

export function m251AssessmentCommandDigest(input) {
  const command = assertObject(input, 'M2.5.1 assessment command digest input');
  assertExactKeys(
    command,
    ['commandId', 'commands', 'commandTimeoutMilliseconds', 'maximumOutputBytes'],
    'M2.5.1 assessment command digest input',
  );
  const commandId = assertString(command.commandId, 'M2.5.1 assessment command ID');
  if (!/^[a-z0-9][a-z0-9.-]*$/u.test(commandId)) {
    throw new TypeError('M2.5.1 assessment command ID is not closed');
  }
  if (
    !Array.isArray(command.commands) ||
    command.commands.some(
      (parts) =>
        !Array.isArray(parts) ||
        parts.length === 0 ||
        parts.some((part) => typeof part !== 'string' || part.length === 0),
    )
  ) {
    throw new TypeError('M2.5.1 assessment commands must be non-empty string arrays');
  }
  const timeout =
    command.commandTimeoutMilliseconds === null
      ? null
      : assertPositiveInteger(
          command.commandTimeoutMilliseconds,
          'M2.5.1 assessment command timeout',
        );
  const maximumOutputBytes = assertPositiveInteger(
    command.maximumOutputBytes,
    'M2.5.1 assessment command output limit',
  );
  return m251Sha256Text(
    JSON.stringify({
      schemaVersion: 2,
      commandId,
      commands: command.commands,
      commandTimeoutMilliseconds: timeout,
      maximumOutputBytes,
    }),
  );
}

export function classifyM251AssessmentCommandFailure(input) {
  const failure = assertObject(input, 'M2.5.1 assessment command failure');
  assertExactKeys(failure, ['errorCode', 'signal', 'status'], 'M2.5.1 assessment command failure');
  if (
    failure.errorCode !== undefined &&
    (typeof failure.errorCode !== 'string' || failure.errorCode.length === 0)
  ) {
    throw new TypeError('M2.5.1 assessment command error code is invalid');
  }
  if (
    failure.signal !== null &&
    (typeof failure.signal !== 'string' || failure.signal.length === 0)
  ) {
    throw new TypeError('M2.5.1 assessment command signal is invalid');
  }
  if (failure.status !== null && (!Number.isSafeInteger(failure.status) || failure.status < 0)) {
    throw new TypeError('M2.5.1 assessment command status is invalid');
  }
  if (failure.errorCode === 'ETIMEDOUT') {
    return Object.freeze({
      kind: 'TIMEOUT',
      outcome: M251AcceptanceOutcome.FAIL,
      exitCode: 1,
      reasonCode: 'COMMAND_TIMEOUT',
    });
  }
  if (failure.errorCode === 'ENOBUFS') {
    return Object.freeze({
      kind: 'OUTPUT_LIMIT',
      outcome: M251AcceptanceOutcome.FAIL,
      exitCode: 1,
      reasonCode: 'COMMAND_OUTPUT_LIMIT_EXCEEDED',
    });
  }
  if (failure.errorCode !== undefined) {
    return Object.freeze({
      kind: 'START_FAILED',
      outcome: M251AcceptanceOutcome.FAIL,
      exitCode: 1,
      reasonCode: 'COMMAND_START_FAILED',
    });
  }
  if (failure.signal !== null) {
    return Object.freeze({
      kind: 'SIGNALLED',
      outcome: M251AcceptanceOutcome.FAIL,
      exitCode: 1,
      reasonCode: 'COMMAND_SIGNALLED',
    });
  }
  if (failure.status === 2) {
    return Object.freeze({
      kind: 'EXIT_BLOCKED',
      outcome: M251AcceptanceOutcome.BLOCKED,
      exitCode: 2,
      reasonCode: 'COMMAND_BLOCKED',
    });
  }
  return Object.freeze({
    kind: 'EXIT_FAILED',
    outcome: M251AcceptanceOutcome.FAIL,
    exitCode: 1,
    reasonCode: 'COMMAND_FAILED',
  });
}

function proofOwnerForRow(proofOwners, rowId) {
  const owner = proofOwners[rowId];
  const separator = typeof owner === 'string' ? owner.indexOf('#') : -1;
  const ownerPath = separator < 1 ? '' : owner.slice(0, separator);
  if (
    separator < 1 ||
    !proofOwnerPathPattern.test(ownerPath) ||
    ownerPath.split('/').some((segment) => segment.length === 0 || segment === '.') ||
    !proofOwnerMarkerPattern.test(owner.slice(separator + 1))
  ) {
    throw new TypeError(`M2.5.1 matrix row ${rowId} has an invalid proof owner`);
  }
  return owner;
}

export function validateM251ProofOwners(rawProofOwners) {
  const proofOwners = assertObject(rawProofOwners, 'M2.5.1 proof-owner contract');
  assertExactKeys(proofOwners, M251_MANDATORY_MATRIX_IDS, 'M2.5.1 proof-owner contract');
  const owners = M251_MANDATORY_MATRIX_IDS.map((rowId) => proofOwnerForRow(proofOwners, rowId));
  if (new Set(owners).size !== owners.length) {
    throw new TypeError('M2.5.1 proof-owner contract assigns one producer to multiple rows');
  }
  return proofOwners;
}

function matrixContractProjection(rows) {
  return rows.map(({ id, proof, requiredResult, proofOwner, stageId }) => ({
    id,
    proof,
    requiredResult,
    proofOwner,
    stageId,
  }));
}

export function m251MatrixContractDigest(rows) {
  return m251Sha256Text(JSON.stringify(matrixContractProjection(rows)));
}

function rowContractDigest(row) {
  return m251Sha256Text(JSON.stringify(matrixContractProjection([row])[0]));
}

export function parseM251AcceptanceMatrix(markdown, rawProofOwners) {
  const proofOwners = validateM251ProofOwners(rawProofOwners);
  const rows = [];
  const seen = new Set();
  for (const line of markdown.split(/\r?\n/u)) {
    const match =
      /^\| `(?<id>M251-[EPVLCXFR]\d{2})` \| (?<proof>.*?) \| (?<requiredResult>.*?) \|$/u.exec(
        line,
      );
    if (match?.groups === undefined) continue;
    const { id, proof, requiredResult } = match.groups;
    if (seen.has(id)) {
      throw new TypeError(`Duplicate M2.5.1 acceptance matrix row: ${id}`);
    }
    seen.add(id);
    const row = {
      id,
      proof,
      requiredResult,
      proofOwner: proofOwnerForRow(proofOwners, id),
      stageId: stageByMatrixRow.get(id),
    };
    rows.push(Object.freeze({ ...row, rowContractDigest: rowContractDigest(row) }));
  }
  if (JSON.stringify(rows.map(({ id }) => id)) !== JSON.stringify(M251_MANDATORY_MATRIX_IDS)) {
    throw new TypeError('M2.5.1 acceptance matrix identifiers differ from the executable contract');
  }
  if (m251MatrixContractDigest(rows) !== M251_ACCEPTANCE_MATRIX_CONTRACT_DIGEST) {
    throw new TypeError('M2.5.1 acceptance matrix semantics differ from the executable contract');
  }
  return Object.freeze(rows);
}

function validateSourceIdentity(rawIdentity, name) {
  const identity = assertObject(rawIdentity, name);
  if (identity.availability === 'UNAVAILABLE') {
    assertExactKeys(identity, ['availability', 'reasonCode'], name);
    if (!closedReasonCodePattern.test(identity.reasonCode)) {
      throw new TypeError(`${name} has an invalid unavailable reason code`);
    }
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
  if (
    identity.availability !== 'AVAILABLE' ||
    !['clean', 'modified'].includes(identity.workingTreeState) ||
    identity.manifestSchema !== 'codeclosure-source-manifest-v1' ||
    identity.reviewExclusion !== M251_REVIEW_EXCLUSION
  ) {
    throw new TypeError(`${name} does not bind the canonical M2.5.1 source identity`);
  }
  assertString(identity.baseGitRevision, `${name} base Git revision`);
  assertString(identity.gitBranch, `${name} Git branch`);
  if (assertNonNegativeInteger(identity.pathCount, `${name} path count`) < 1) {
    throw new TypeError(`${name} path count must be positive`);
  }
  assertDigest(identity.digest, `${name} digest`);
  return identity;
}

export function m251SourceIdentitiesMatch(opening, closing) {
  return (
    opening.availability === 'AVAILABLE' &&
    closing.availability === 'AVAILABLE' &&
    [
      'availability',
      'baseGitRevision',
      'gitBranch',
      'workingTreeState',
      'manifestSchema',
      'pathCount',
      'digest',
      'reviewExclusion',
    ].every((field) => opening[field] === closing[field])
  );
}

function validateSourcePathManifestEntry(rawEntry, index) {
  const entry = assertObject(rawEntry, `M2.5.1 source path entry ${String(index)}`);
  assertExactKeys(
    entry,
    ['path', 'kind', 'contentDigest'],
    `M2.5.1 source path entry ${String(index)}`,
  );
  if (
    !portableSourcePathPattern.test(entry.path) ||
    entry.path.split('/').some((segment) => segment.length === 0 || segment === '.') ||
    entry.path === M251_REVIEW_EXCLUSION
  ) {
    throw new TypeError(`M2.5.1 source path entry ${String(index)} has an unsafe path`);
  }
  if (!['DELETED', 'SYMLINK', 'REGULAR', 'EXECUTABLE'].includes(entry.kind)) {
    throw new TypeError(`M2.5.1 source path entry ${String(index)} has an unsupported kind`);
  }
  if (entry.kind === 'DELETED') {
    if (entry.contentDigest !== null) {
      throw new TypeError(`M2.5.1 deleted source path ${entry.path} retains a content digest`);
    }
  } else {
    assertDigest(entry.contentDigest, `M2.5.1 source path ${entry.path} content digest`);
  }
  return entry;
}

export function m251SourceIdentityDigestFromEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('M2.5.1 source path entries must be an array');
  }
  entries.forEach(validateSourcePathManifestEntry);
  const paths = entries.map(({ path }) => path);
  if (JSON.stringify(paths) !== JSON.stringify([...new Set(paths)].sort())) {
    throw new TypeError('M2.5.1 source path entries are not unique and path-sorted');
  }
  const manifest = createHash('sha256');
  manifest.update('codeclosure-source-manifest-v1\0', 'utf8');
  for (const entry of entries) {
    const kind = entry.kind.toLowerCase();
    if (entry.kind === 'DELETED') {
      manifest.update(`deleted\0${entry.path}\0`, 'utf8');
    } else {
      manifest.update(`${kind}\0${entry.path}\0${entry.contentDigest.slice(7)}\0`, 'utf8');
    }
  }
  return `sha256:${manifest.digest('hex')}`;
}

export function validateM251SourcePathManifest(rawManifest) {
  const manifest = assertObject(rawManifest, 'M2.5.1 source path manifest');
  assertExactKeys(
    manifest,
    ['schemaVersion', 'kind', 'reviewExclusion', 'entries'],
    'M2.5.1 source path manifest',
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== M251_SOURCE_PATH_MANIFEST_KIND ||
    manifest.reviewExclusion !== M251_REVIEW_EXCLUSION ||
    !Array.isArray(manifest.entries)
  ) {
    throw new TypeError('M2.5.1 source path manifest identity is invalid');
  }
  manifest.entries.forEach(validateSourcePathManifestEntry);
  const paths = manifest.entries.map(({ path }) => path);
  if (JSON.stringify(paths) !== JSON.stringify([...new Set(paths)].sort())) {
    throw new TypeError('M2.5.1 source path manifest is not unique and path-sorted');
  }
  return manifest;
}

function validateSourceManifestReference(rawReference, name, sourceIdentity, readArtifact) {
  const reference = assertObject(rawReference, name);
  if (reference.availability === 'UNAVAILABLE') {
    assertExactKeys(reference, ['availability', 'reasonCode'], name);
    if (
      sourceIdentity.availability !== 'UNAVAILABLE' ||
      !closedReasonCodePattern.test(reference.reasonCode)
    ) {
      throw new TypeError(`${name} has an invalid unavailable disposition`);
    }
    return Object.freeze({ reference, manifest: undefined });
  }
  assertExactKeys(reference, ['availability', 'artifactPath', 'artifactDigest'], name);
  if (reference.availability !== 'AVAILABLE' || sourceIdentity.availability !== 'AVAILABLE') {
    throw new TypeError(`${name} availability differs from its source identity`);
  }
  assertPortableArtifactPath(reference.artifactPath, `${name} artifact path`);
  const artifact = bytes(readArtifact(reference.artifactPath));
  if (m251Sha256Bytes(artifact) !== assertDigest(reference.artifactDigest, `${name} digest`)) {
    throw new TypeError(`${name} artifact digest does not match`);
  }
  let manifest;
  try {
    manifest = parseJsonRejectingDuplicateKeys(
      Buffer.from(artifact).toString('utf8'),
      `${name} artifact`,
    );
  } catch {
    throw new TypeError(`${name} artifact is not unique-key JSON`);
  }
  validateM251SourcePathManifest(manifest);
  if (
    sourceIdentity.availability === 'AVAILABLE' &&
    (manifest.entries.length !== sourceIdentity.pathCount ||
      m251SourceIdentityDigestFromEntries(manifest.entries) !== sourceIdentity.digest)
  ) {
    throw new TypeError(`${name} does not reproduce its source identity`);
  }
  return Object.freeze({ reference, manifest });
}

function validateSourceManifestClosure(rawClosure, opening, closing, readArtifact) {
  const closure = assertObject(rawClosure, 'M2.5.1 source manifest closure');
  assertExactKeys(closure, ['opening', 'closing'], 'M2.5.1 source manifest closure');
  const openingManifest = validateSourceManifestReference(
    closure.opening,
    'M2.5.1 opening source manifest',
    opening,
    readArtifact,
  );
  const closingManifest = validateSourceManifestReference(
    closure.closing,
    'M2.5.1 closing source manifest',
    closing,
    readArtifact,
  );
  if (
    closure.opening.availability === 'AVAILABLE' &&
    closure.closing.availability === 'AVAILABLE' &&
    closure.opening.artifactPath === closure.closing.artifactPath
  ) {
    throw new TypeError('M2.5.1 source manifests reuse one mutable artifact path');
  }
  const artifactPaths = new Set(
    [closure.opening, closure.closing]
      .filter(({ availability }) => availability === 'AVAILABLE')
      .map(({ artifactPath }) => artifactPath),
  );
  return Object.freeze({
    opening: openingManifest,
    closing: closingManifest,
    matches:
      closure.opening.availability === 'AVAILABLE' &&
      closure.closing.availability === 'AVAILABLE' &&
      closure.opening.artifactDigest === closure.closing.artifactDigest,
    artifactPaths,
  });
}

function validateSelectedToolchain(rawToolchain, expected) {
  const toolchain = assertObject(rawToolchain, 'M2.5.1 selected toolchain');
  assertExactKeys(toolchain, Object.keys(expected), 'M2.5.1 selected toolchain');
  if (Object.keys(expected).some((field) => toolchain[field] !== expected[field])) {
    throw new TypeError('M2.5.1 selected toolchain differs from the Slice 0 contract');
  }
  for (const [field, value] of Object.entries(toolchain)) {
    if (field.endsWith('Digest')) assertDigest(value, `M2.5.1 selected toolchain ${field}`);
  }
  return toolchain;
}

function nodeVersionSatisfiesRepositoryContract(nodeVersion, engineRange) {
  const selected = /^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(nodeVersion)?.groups;
  const range = /^>=(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+) <(?<upperMajor>\d+)$/u.exec(
    engineRange,
  )?.groups;
  if (selected === undefined || range === undefined) return false;
  const selectedParts = [selected.major, selected.minor, selected.patch].map(Number);
  const lowerParts = [range.major, range.minor, range.patch].map(Number);
  const aboveLowerBound = selectedParts.some(
    (part, index) =>
      part > lowerParts[index] &&
      selectedParts
        .slice(0, index)
        .every((prefix, prefixIndex) => prefix === lowerParts[prefixIndex]),
  );
  const equalToLowerBound = selectedParts.every((part, index) => part === lowerParts[index]);
  return (
    Number(selected.major) < Number(range.upperMajor) && (aboveLowerBound || equalToLowerBound)
  );
}

export function validateM251AssessmentEnvironment(rawEnvironment, inputs) {
  const environment = assertObject(rawEnvironment, 'M2.5.1 assessment environment');
  assertExactKeys(
    environment,
    [
      'nodeVersion',
      'pnpmVersion',
      'packageManager',
      'lockfileDigest',
      'slice0ContractId',
      'slice0ContractVersion',
      'slice0ContractDigest',
      'selectedToolchain',
    ],
    'M2.5.1 assessment environment',
  );
  if (
    typeof inputs.packageManifest.engines?.node !== 'string' ||
    !nodeVersionSatisfiesRepositoryContract(
      environment.nodeVersion,
      inputs.packageManifest.engines.node,
    )
  ) {
    throw new TypeError('M2.5.1 assessment Node version is outside the repository contract');
  }
  if (
    inputs.packageManifest.engines?.pnpm !== environment.pnpmVersion ||
    inputs.packageManifest.packageManager !== environment.packageManager ||
    environment.packageManager !== `pnpm@${environment.pnpmVersion}`
  ) {
    throw new TypeError('M2.5.1 assessment package toolchain differs from package.json');
  }
  assertDigest(environment.lockfileDigest, 'M2.5.1 assessment lockfile digest');
  if (environment.lockfileDigest !== inputs.lockfileDigest) {
    throw new TypeError('M2.5.1 assessment lockfile digest differs from the reviewed lockfile');
  }
  const contract = inputs.slice0Contract;
  if (
    environment.slice0ContractId !== contract.contractId ||
    environment.slice0ContractVersion !== contract.contractVersion ||
    environment.slice0ContractDigest !== inputs.slice0ContractDigest
  ) {
    throw new TypeError('M2.5.1 assessment environment differs from the Slice 0 contract identity');
  }
  validateSelectedToolchain(environment.selectedToolchain, contract.toolchain.selected);
  return environment;
}

function preflightStagesById(stages) {
  if (stages instanceof Map) {
    return stages;
  }
  if (!Array.isArray(stages)) {
    throw new TypeError('M2.5.1 preflight proof support must be an array or Map');
  }
  const stagesById = new Map();
  for (const stage of stages) {
    const value = assertObject(stage, 'M2.5.1 preflight supporting stage');
    if (typeof value.id !== 'string' || stagesById.has(value.id)) {
      throw new TypeError('M2.5.1 preflight proof support has a duplicate or invalid stage');
    }
    stagesById.set(value.id, value);
  }
  return stagesById;
}

export function m251PreflightProofSupportSatisfied(stages) {
  const stagesById = preflightStagesById(stages);
  return M251_PREFLIGHT_PROOF_SUPPORT.every(
    ({ stageId }) =>
      stagesById.get(stageId)?.id === stageId &&
      stagesById.get(stageId)?.outcome === M251AcceptanceOutcome.PASS,
  );
}

export function projectM251PreflightProofEvidence(earlyGateEvidence, stages) {
  const earlyGate = assertObject(earlyGateEvidence, 'M2.5.1 preflight early-gate evidence');
  const stagesById = preflightStagesById(stages);
  const supportingStages = M251_PREFLIGHT_PROOF_SUPPORT.map(({ purpose, stageId }) => {
    const stage = assertObject(
      stagesById.get(stageId),
      `M2.5.1 preflight supporting stage ${stageId}`,
    );
    if (stage.id !== stageId || stage.outcome !== M251AcceptanceOutcome.PASS) {
      throw new TypeError(`M2.5.1 preflight supporting stage ${stageId} did not pass`);
    }
    return Object.freeze({
      purpose,
      stageId,
      artifactDigest: assertDigest(
        stage.artifactDigest,
        `M2.5.1 preflight supporting stage ${stageId} artifact digest`,
      ),
    });
  });
  return Object.freeze({
    earlyGate: Object.freeze({ ...earlyGate }),
    proofClosure: Object.freeze({
      environmentAndSourceIdentityValidated: true,
      historicalToolchainAndMigrationIdentityValidated: true,
      preModelIsolationAndCandidateAbsenceValidated: true,
    }),
    supportingStages: Object.freeze(supportingStages),
  });
}

function validatePassingPreflightEvidence(rawEvidence, context) {
  const evidence = assertObject(rawEvidence, 'M2.5.1 passing preflight evidence');
  assertExactKeys(
    evidence,
    ['earlyGate', 'proofClosure', 'supportingStages'],
    'M2.5.1 passing preflight evidence',
  );
  const expectedProjection = projectM251PreflightProofEvidence(evidence.earlyGate, context.stages);
  if (JSON.stringify(evidence) !== JSON.stringify(expectedProjection)) {
    throw new TypeError('M2.5.1 preflight evidence differs from its supporting stages');
  }

  const earlyGate = assertObject(evidence.earlyGate, 'M2.5.1 preflight early gate');
  assertExactKeys(
    earlyGate,
    [
      'bindingRoots',
      'candidateAuthorityAllocated',
      'environment',
      'openingSource',
      'project',
      'retainedHistoricalToolchain',
      'selectedToolchain',
    ],
    'M2.5.1 preflight early gate',
  );
  const environment = assertObject(earlyGate.environment, 'M2.5.1 preflight environment identity');
  assertExactKeys(
    environment,
    ['lockfileDigest', 'nodeVersion', 'packageManager', 'pnpmVersion'],
    'M2.5.1 preflight environment identity',
  );
  if (
    environment.nodeVersion !== context.environment.nodeVersion ||
    environment.pnpmVersion !== context.environment.pnpmVersion ||
    environment.packageManager !== context.environment.packageManager ||
    environment.lockfileDigest !== context.environment.lockfileDigest
  ) {
    throw new TypeError('M2.5.1 preflight environment differs from the manifest environment');
  }

  const openingSource = assertObject(
    earlyGate.openingSource,
    'M2.5.1 preflight opening source identity',
  );
  assertExactKeys(
    openingSource,
    ['artifactDigest', 'identityDigest'],
    'M2.5.1 preflight opening source identity',
  );
  if (
    context.opening.availability !== 'AVAILABLE' ||
    context.openingSourceReference.availability !== 'AVAILABLE' ||
    openingSource.identityDigest !== context.opening.digest ||
    openingSource.artifactDigest !== context.openingSourceReference.artifactDigest
  ) {
    throw new TypeError('M2.5.1 preflight does not bind the exact opening source identity');
  }

  validateSelectedToolchain(earlyGate.selectedToolchain, context.contract.toolchain.selected);
  validateSelectedToolchain(
    earlyGate.retainedHistoricalToolchain,
    context.contract.toolchain.retainedHistorical,
  );
  const project = assertObject(earlyGate.project, 'M2.5.1 preflight demonstration project');
  assertExactKeys(
    project,
    ['gitCommit', 'gitTree', 'workingTreeState'],
    'M2.5.1 preflight demonstration project',
  );
  if (
    project.gitCommit !== context.contract.demonstration.gitCommit ||
    project.gitTree !== context.contract.demonstration.gitTree ||
    project.workingTreeState !== 'clean'
  ) {
    throw new TypeError('M2.5.1 preflight demonstration project differs from the contract');
  }

  if (
    !Array.isArray(earlyGate.bindingRoots) ||
    JSON.stringify(earlyGate.bindingRoots.map(({ kind }) => kind)) !==
      JSON.stringify(M251_PREFLIGHT_BINDING_ROOT_KINDS)
  ) {
    throw new TypeError('M2.5.1 preflight binding roots are incomplete or reordered');
  }
  for (const root of earlyGate.bindingRoots) {
    assertExactKeys(root, ['kind', 'pathDigest'], 'M2.5.1 preflight binding root');
    assertDigest(root.pathDigest, `M2.5.1 preflight ${root.kind} path digest`);
  }
  if (earlyGate.candidateAuthorityAllocated !== false) {
    throw new TypeError('M2.5.1 preflight allocated Candidate authority before execution');
  }
  return evidence;
}

function validateCounts(rawCounts, name) {
  const counts = assertObject(rawCounts, name);
  const fields = [
    'executed',
    'passed',
    'failed',
    'cancelled',
    'skipped',
    'todo',
    'waived',
    'expectedFailure',
    'unexpectedNotApplicable',
    'sourceDrift',
    'unexplainedWarning',
  ];
  assertExactKeys(counts, fields, name);
  for (const field of fields) assertNonNegativeInteger(counts[field], `${name} ${field}`);
  if (counts.passed > counts.executed) {
    throw new TypeError(`${name} passed count exceeds its executed count`);
  }
  return counts;
}

export function projectM251SourceClosureStage(input) {
  const noCommandCounts = Object.freeze({
    executed: 0,
    passed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    waived: 0,
    expectedFailure: 0,
    unexpectedNotApplicable: 0,
    sourceDrift: input.sourceDriftObserved ? 1 : 0,
    unexplainedWarning: 0,
  });

  if (!input.priorStagesPassed) {
    return Object.freeze({
      outcome: M251AcceptanceOutcome.BLOCKED,
      counts: noCommandCounts,
      evidence: Object.freeze({
        documentationCheckExecuted: false,
        executionRootRemoved: true,
        sourceDriftObserved: input.sourceDriftObserved,
      }),
      reasonCode: 'PRIOR_STAGE_NOT_SATISFIED',
      observedProofOwners: Object.freeze([]),
      executedProofTestNames: Object.freeze([]),
      exitCode: 2,
      durationMilliseconds: 0,
    });
  }

  const documentation = input.documentationEvaluation;

  const closureEvidence = (details) =>
    Object.freeze({
      ...documentation.evidence,
      documentationCheckExecuted: true,
      executionRootRemoved: true,
      sourceDriftObserved: input.sourceDriftObserved,
      ...details,
    });

  if (documentation.outcome !== M251AcceptanceOutcome.PASS) {
    return Object.freeze({
      ...documentation,
      counts: Object.freeze({
        ...documentation.counts,
        sourceDrift: input.sourceDriftObserved ? 1 : documentation.counts.sourceDrift,
      }),
      evidence: closureEvidence({ documentationCheckPassed: false }),
    });
  }
  if (input.sourceDriftObserved) {
    return Object.freeze({
      outcome: M251AcceptanceOutcome.BLOCKED,
      counts: noCommandCounts,
      evidence: closureEvidence({ documentationCheckPassed: true }),
      reasonCode: 'SOURCE_IDENTITY_DRIFTED',
      observedProofOwners: documentation.observedProofOwners,
      executedProofTestNames: documentation.executedProofTestNames,
      exitCode: 2,
      durationMilliseconds: documentation.durationMilliseconds,
    });
  }
  return Object.freeze({
    outcome: M251AcceptanceOutcome.PASS,
    counts: documentation.counts,
    evidence: closureEvidence({
      documentationCheckPassed: true,
      sourceIdentityClosed: true,
    }),
    reasonCode: undefined,
    observedProofOwners: input.requiredProofOwners,
    executedProofTestNames: documentation.executedProofTestNames,
    exitCode: 0,
    durationMilliseconds: documentation.durationMilliseconds,
  });
}

function passingCountsAreClosed(counts) {
  return (
    counts.executed > 0 &&
    counts.passed === counts.executed &&
    [
      counts.failed,
      counts.cancelled,
      counts.skipped,
      counts.todo,
      counts.waived,
      counts.expectedFailure,
      counts.unexpectedNotApplicable,
      counts.sourceDrift,
      counts.unexplainedWarning,
    ].every((count) => count === 0)
  );
}

function expectedProofOwners(stageId, rows) {
  const rowIds = new Set(M251_STAGE_MATRIX_ROWS[stageId]);
  return rows
    .filter(({ id }) => rowIds.has(id))
    .map(({ proofOwner }) => proofOwner)
    .sort();
}

function validateStageArtifact(rawArtifact, stage) {
  let artifact;
  try {
    artifact = parseJsonRejectingDuplicateKeys(
      Buffer.from(bytes(rawArtifact)).toString('utf8'),
      `M2.5.1 stage ${stage.id} artifact`,
    );
  } catch {
    throw new TypeError(`M2.5.1 stage ${stage.id} artifact is not unique-key JSON`);
  }
  assertObject(artifact, `M2.5.1 stage ${stage.id} artifact`);
  assertExactKeys(
    artifact,
    [
      'schemaVersion',
      'kind',
      'stageId',
      'commandId',
      'commandDigest',
      'durationMilliseconds',
      'exitCode',
      'outcome',
      'counts',
      'safeWarningCodes',
      'observedProofOwners',
      'executedProofTestNames',
      'evidence',
      'reasonCode',
      'privacy',
    ],
    `M2.5.1 stage ${stage.id} artifact`,
  );
  if (
    artifact.schemaVersion !== 1 ||
    artifact.kind !== 'CODECLOSURE_M2_5_1_STAGE_EVIDENCE_V1' ||
    artifact.stageId !== stage.id ||
    artifact.commandId !== stage.commandId ||
    artifact.commandDigest !== stage.commandDigest ||
    artifact.durationMilliseconds !== stage.durationMilliseconds ||
    artifact.exitCode !== stage.exitCode ||
    artifact.outcome !== stage.outcome ||
    JSON.stringify(artifact.counts) !== JSON.stringify(stage.counts) ||
    JSON.stringify(artifact.safeWarningCodes) !== JSON.stringify(stage.safeWarningCodes) ||
    JSON.stringify(artifact.observedProofOwners) !== JSON.stringify(stage.observedProofOwners) ||
    JSON.stringify(artifact.executedProofTestNames) !== JSON.stringify(stage.executedProofTestNames)
  ) {
    throw new TypeError(`M2.5.1 stage ${stage.id} artifact differs from its manifest binding`);
  }
  assertObject(artifact.evidence, `M2.5.1 stage ${stage.id} evidence`);
  if (
    (stage.outcome === M251AcceptanceOutcome.PASS && artifact.reasonCode !== null) ||
    (stage.outcome !== M251AcceptanceOutcome.PASS &&
      (typeof artifact.reasonCode !== 'string' ||
        !closedReasonCodePattern.test(artifact.reasonCode)))
  ) {
    throw new TypeError(`M2.5.1 stage ${stage.id} artifact has an invalid closed reason`);
  }
  const privacy = assertObject(artifact.privacy, `M2.5.1 stage ${stage.id} artifact privacy`);
  const privacyFields = [
    'rawCommandOutputRetained',
    'rawExceptionRetained',
    'rawUserOrModelContentRetained',
    'credentialOrAccountContentRetained',
    'sourceBytesRetained',
  ];
  assertExactKeys(privacy, privacyFields, `M2.5.1 stage ${stage.id} artifact privacy`);
  if (privacyFields.some((field) => privacy[field] !== false)) {
    throw new TypeError(`M2.5.1 stage ${stage.id} artifact retains prohibited content`);
  }
  assertM251AssessmentMetadataOnly(artifact);
  return artifact;
}

function validateStages(rawStages, rows, readArtifact, reservedArtifactPaths = new Set()) {
  if (!Array.isArray(rawStages)) throw new TypeError('M2.5.1 assessment stages must be an array');
  if (JSON.stringify(rawStages.map(({ id }) => id)) !== JSON.stringify(M251_STAGE_ORDER)) {
    throw new TypeError('M2.5.1 assessment stages omit, duplicate, or reorder a required stage');
  }
  const artifactPaths = new Set(reservedArtifactPaths);
  const stages = new Map();
  let preflightEvidence;
  for (const rawStage of rawStages) {
    const stage = assertObject(rawStage, `M2.5.1 stage ${rawStage?.id ?? '<unknown>'}`);
    assertExactKeys(
      stage,
      [
        'id',
        'outcome',
        'commandId',
        'commandDigest',
        'durationMilliseconds',
        'exitCode',
        'counts',
        'safeWarningCodes',
        'observedProofOwners',
        'executedProofTestNames',
        'artifactPath',
        'artifactDigest',
      ],
      `M2.5.1 stage ${stage.id ?? '<unknown>'}`,
    );
    assertOutcome(stage.outcome, `M2.5.1 stage ${stage.id}`);
    if (
      !M251_STAGE_ORDER.includes(stage.id) ||
      !/^[a-z0-9][a-z0-9.-]*$/u.test(stage.commandId) ||
      !Number.isSafeInteger(stage.durationMilliseconds) ||
      stage.durationMilliseconds < 0 ||
      (stage.exitCode !== null && !Number.isSafeInteger(stage.exitCode)) ||
      (stage.outcome === M251AcceptanceOutcome.PASS && stage.exitCode !== 0) ||
      (stage.outcome === M251AcceptanceOutcome.FAIL &&
        (stage.exitCode === null || stage.exitCode === 0)) ||
      (stage.outcome === M251AcceptanceOutcome.BLOCKED && ![null, 2].includes(stage.exitCode))
    ) {
      throw new TypeError(`M2.5.1 stage ${stage.id} has invalid execution evidence`);
    }
    assertDigest(stage.commandDigest, `M2.5.1 stage ${stage.id} command digest`);
    const counts = validateCounts(stage.counts, `M2.5.1 stage ${stage.id} counts`);
    if (stage.outcome === M251AcceptanceOutcome.PASS && !passingCountsAreClosed(counts)) {
      throw new TypeError(`M2.5.1 stage ${stage.id} passed with incomplete or disallowed counts`);
    }
    assertSortedUniqueStrings(
      stage.safeWarningCodes,
      `M2.5.1 stage ${stage.id} safe warning codes`,
      safeWarningCodePattern,
    );
    if (stage.safeWarningCodes.some((code) => !M251_ALLOWED_SAFE_WARNING_CODES.includes(code))) {
      throw new TypeError(`M2.5.1 stage ${stage.id} claims an unowned safe-warning policy`);
    }
    assertSortedUniqueStrings(
      stage.executedProofTestNames,
      `M2.5.1 stage ${stage.id} executed proof test names`,
      executedProofTestNamePattern,
    );
    const expectedOwners = expectedProofOwners(stage.id, rows);
    if (
      !Array.isArray(stage.observedProofOwners) ||
      JSON.stringify(stage.observedProofOwners) !==
        JSON.stringify([...new Set(stage.observedProofOwners)].sort()) ||
      stage.observedProofOwners.some((owner) => !expectedOwners.includes(owner)) ||
      (stage.outcome === M251AcceptanceOutcome.PASS &&
        JSON.stringify(stage.observedProofOwners) !== JSON.stringify(expectedOwners))
    ) {
      throw new TypeError(`M2.5.1 stage ${stage.id} has invalid proof-owner observations`);
    }
    for (const owner of stage.observedProofOwners) {
      const separator = owner.indexOf('#');
      const path = owner.slice(0, separator);
      const marker = owner.slice(separator + 1);
      if (
        /(?:\.test\.(?:mjs|ts))$/u.test(path) &&
        !stage.executedProofTestNames.some((testName) => testName.includes(marker))
      ) {
        throw new TypeError(
          `M2.5.1 stage ${stage.id} claims a test proof owner without its executed test name`,
        );
      }
    }
    assertPortableArtifactPath(stage.artifactPath, `M2.5.1 stage ${stage.id} artifact path`);
    if (artifactPaths.has(stage.artifactPath)) {
      throw new TypeError(`M2.5.1 stage ${stage.id} reuses an artifact path`);
    }
    artifactPaths.add(stage.artifactPath);
    const artifact = readArtifact(stage.artifactPath);
    if (m251Sha256Bytes(artifact) !== assertDigest(stage.artifactDigest, 'Stage artifact digest')) {
      throw new TypeError(`M2.5.1 stage ${stage.id} artifact digest does not match`);
    }
    const validatedArtifact = validateStageArtifact(artifact, stage);
    if (stage.id === M251AcceptanceStage.PREFLIGHT) {
      preflightEvidence = validatedArtifact.evidence;
    }
    stages.set(stage.id, stage);
  }
  return Object.freeze({ stages, preflightEvidence });
}

function evidenceReceiptDigest(input) {
  return m251Sha256Text(
    JSON.stringify({
      rowContractDigest: input.rowContractDigest,
      stageId: input.stageId,
      proofOwner: input.proofOwner,
      artifactDigest: input.artifactDigest,
      outcome: input.outcome,
    }),
  );
}

export function buildM251MatrixResults(rows, stages) {
  const stagesById =
    stages instanceof Map ? stages : new Map(stages.map((stage) => [stage.id, stage]));
  return Object.freeze(
    rows.map((row) => {
      const stage = stagesById.get(row.stageId);
      if (stage === undefined) {
        throw new TypeError(`M2.5.1 matrix row ${row.id} has no assessment stage`);
      }
      const observed = stage.observedProofOwners.includes(row.proofOwner);
      const outcome =
        stage.outcome === M251AcceptanceOutcome.FAIL
          ? M251AcceptanceOutcome.FAIL
          : observed
            ? stage.outcome
            : M251AcceptanceOutcome.BLOCKED;
      const result = {
        ...row,
        outcome,
        artifactPath: stage.artifactPath,
        artifactDigest: stage.artifactDigest,
      };
      return Object.freeze({
        ...result,
        evidenceReceiptDigest: evidenceReceiptDigest(result),
      });
    }),
  );
}

export function m251AssessmentOutcome(matrixResults) {
  if (
    matrixResults.length !== M251_MANDATORY_MATRIX_IDS.length ||
    JSON.stringify(matrixResults.map(({ id }) => id)) !== JSON.stringify(M251_MANDATORY_MATRIX_IDS)
  ) {
    throw new TypeError('M2.5.1 assessment cannot omit or reorder a mandatory matrix row');
  }
  for (const result of matrixResults) {
    assertOutcome(result.outcome, `M2.5.1 matrix row ${result.id}`);
  }
  if (matrixResults.some(({ outcome }) => outcome === M251AcceptanceOutcome.FAIL)) {
    return M251AcceptanceOutcome.FAIL;
  }
  if (matrixResults.some(({ outcome }) => outcome === M251AcceptanceOutcome.BLOCKED)) {
    return M251AcceptanceOutcome.BLOCKED;
  }
  return M251AcceptanceOutcome.PASS;
}

function validateMatrixResults(rawResults, expectedResults) {
  if (!Array.isArray(rawResults)) {
    throw new TypeError('M2.5.1 evidence matrix results must be an array');
  }
  if (
    JSON.stringify(rawResults.map(({ id }) => id)) !== JSON.stringify(M251_MANDATORY_MATRIX_IDS)
  ) {
    throw new TypeError('M2.5.1 evidence matrix omits, duplicates, or reorders a mandatory row');
  }
  for (const [index, rawResult] of rawResults.entries()) {
    const result = assertObject(rawResult, `M2.5.1 evidence matrix row ${String(index)}`);
    const expected = expectedResults[index];
    assertExactKeys(result, Object.keys(expected), `M2.5.1 evidence matrix row ${expected.id}`);
    for (const field of Object.keys(expected)) {
      if (result[field] !== expected[field]) {
        throw new TypeError(
          `M2.5.1 evidence matrix row ${expected.id} differs from its exact proof binding`,
        );
      }
    }
  }
  return rawResults;
}

function parseAssessmentInputs(options) {
  const slice0ContractBytes = bytes(options.slice0ContractBytes);
  let slice0Contract;
  try {
    slice0Contract = parseJsonRejectingDuplicateKeys(
      Buffer.from(slice0ContractBytes).toString('utf8'),
      'M2.5.1 Slice 0 contract',
    );
  } catch {
    throw new TypeError('M2.5.1 Slice 0 contract is not unique-key JSON');
  }
  const packageManifest = assertObject(options.packageManifest, 'M2.5.1 package manifest');
  const lockfileDigest = assertDigest(options.lockfileDigest, 'M2.5.1 reviewed lockfile digest');
  if (typeof options.acceptancePlanMarkdown !== 'string') {
    throw new TypeError('M2.5.1 acceptance plan must be Markdown text');
  }
  if (typeof options.readArtifact !== 'function') {
    throw new TypeError('M2.5.1 assessment requires an artifact reader');
  }
  validateM251ProofOwners(slice0Contract.proofOwners);
  return Object.freeze({
    slice0Contract,
    slice0ContractDigest: m251Sha256Bytes(slice0ContractBytes),
    packageManifest,
    lockfileDigest,
    acceptancePlanMarkdown: options.acceptancePlanMarkdown,
    readArtifact: options.readArtifact,
  });
}

function validateAuthorization(rawAuthorization) {
  const authorization = assertObject(rawAuthorization, 'M2.5.1 live authorization');
  if (authorization.availability === 'UNAVAILABLE') {
    assertExactKeys(authorization, ['availability', 'reasonCode'], 'M2.5.1 live authorization');
    if (!closedReasonCodePattern.test(authorization.reasonCode)) {
      throw new TypeError('M2.5.1 live authorization reason code is invalid');
    }
    return authorization;
  }
  assertExactKeys(authorization, ['availability'], 'M2.5.1 live authorization');
  if (authorization.availability !== 'EXPLICIT') {
    throw new TypeError('M2.5.1 live authorization is invalid');
  }
  return authorization;
}

function validatePrivacy(rawPrivacy) {
  const privacy = assertObject(rawPrivacy, 'M2.5.1 assessment privacy projection');
  const fields = [
    'userContentRetained',
    'assistantOrModelContentRetained',
    'credentialOrAccountContentRetained',
    'reasoningOrTranscriptRetained',
    'rawProtocolRetained',
    'rawExceptionRetained',
    'sourceBytesRetained',
    'unrestrictedCommandOutputRetained',
  ];
  assertExactKeys(privacy, fields, 'M2.5.1 assessment privacy projection');
  if (fields.some((field) => privacy[field] !== false)) {
    throw new TypeError('M2.5.1 assessment privacy projection retains prohibited content');
  }
  return privacy;
}

export function assertM251AssessmentMetadataOnly(value, forbiddenStrings = []) {
  const serialized = JSON.stringify(value);
  const forbiddenKeys = [
    'request',
    'answerContent',
    'proposedObjective',
    'proposedCriteria',
    'proposedQuestions',
    'rawNotification',
    'reasoning',
    'transcript',
    'authSource',
    'account',
    'rateLimit',
    'exception',
  ];
  if (new RegExp(`"(?:${forbiddenKeys.join('|')})"\\s*:`, 'u').test(serialized)) {
    throw new TypeError('M2.5.1 assessment contains a prohibited content-bearing field');
  }
  for (const forbidden of forbiddenStrings) {
    if (typeof forbidden === 'string' && forbidden.length > 0 && serialized.includes(forbidden)) {
      throw new TypeError('M2.5.1 assessment contains prohibited raw content');
    }
  }
  return value;
}

export function validateM251EvidenceManifest(rawManifest, options) {
  const inputs = parseAssessmentInputs(options);
  const rows = parseM251AcceptanceMatrix(
    inputs.acceptancePlanMarkdown,
    inputs.slice0Contract.proofOwners,
  );
  const manifest = assertObject(rawManifest, 'M2.5.1 evidence manifest');
  assertExactKeys(
    manifest,
    [
      'schemaVersion',
      'kind',
      'assessmentMeaning',
      'reviewExclusion',
      'authorization',
      'environment',
      'matrixContractDigest',
      'openingSourceIdentity',
      'closingSourceIdentity',
      'sourceManifests',
      'stages',
      'matrixResults',
      'outcome',
      'nonClaims',
      'privacy',
    ],
    'M2.5.1 evidence manifest',
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'CODECLOSURE_M2_5_1_EXECUTABLE_ASSESSMENT_V1' ||
    manifest.reviewExclusion !== M251_REVIEW_EXCLUSION ||
    manifest.matrixContractDigest !== M251_ACCEPTANCE_MATRIX_CONTRACT_DIGEST
  ) {
    throw new TypeError('M2.5.1 evidence manifest identity or non-verdict meaning is invalid');
  }
  const authorization = validateAuthorization(manifest.authorization);
  const environment = validateM251AssessmentEnvironment(manifest.environment, inputs);
  const opening = validateSourceIdentity(manifest.openingSourceIdentity, 'Opening source identity');
  const closing = validateSourceIdentity(manifest.closingSourceIdentity, 'Closing source identity');
  const sourceManifests = validateSourceManifestClosure(
    manifest.sourceManifests,
    opening,
    closing,
    inputs.readArtifact,
  );
  const validatedStages = validateStages(
    manifest.stages,
    rows,
    inputs.readArtifact,
    sourceManifests.artifactPaths,
  );
  const stages = validatedStages.stages;
  if (stages.get(M251AcceptanceStage.PREFLIGHT)?.outcome === M251AcceptanceOutcome.PASS) {
    validatePassingPreflightEvidence(validatedStages.preflightEvidence, {
      environment,
      opening,
      openingSourceReference: sourceManifests.opening.reference,
      stages,
      contract: inputs.slice0Contract,
    });
  }
  const expectedMatrixResults = buildM251MatrixResults(rows, stages);
  validateMatrixResults(manifest.matrixResults, expectedMatrixResults);
  const expectedOutcome = m251AssessmentOutcome(expectedMatrixResults);
  if (manifest.outcome !== expectedOutcome) {
    throw new TypeError('M2.5.1 evidence manifest outcome differs from executable evidence');
  }
  const expectedMeaning =
    expectedOutcome === M251AcceptanceOutcome.PASS
      ? M251AssessmentMeaning.READY
      : M251AssessmentMeaning.NOT_READY;
  if (manifest.assessmentMeaning !== expectedMeaning) {
    throw new TypeError('M2.5.1 evidence manifest readiness differs from executable evidence');
  }
  const sourceClosure = stages.get(M251AcceptanceStage.SOURCE_CLOSURE);
  if (
    (!m251SourceIdentitiesMatch(opening, closing) || !sourceManifests.matches) &&
    sourceClosure?.outcome === M251AcceptanceOutcome.PASS
  ) {
    throw new TypeError('M2.5.1 source closure passed without one exact source identity');
  }
  if (
    opening.availability === 'AVAILABLE' &&
    closing.availability === 'AVAILABLE' &&
    (!m251SourceIdentitiesMatch(opening, closing) || !sourceManifests.matches) &&
    sourceClosure?.counts.sourceDrift === 0
  ) {
    throw new TypeError('M2.5.1 source-closure evidence omitted observed source drift');
  }
  if (
    authorization.availability !== 'EXPLICIT' &&
    [M251AcceptanceStage.LIVE_INTAKE, M251AcceptanceStage.LIVE_COMPOSITION].some(
      (stageId) => stages.get(stageId)?.outcome === M251AcceptanceOutcome.PASS,
    )
  ) {
    throw new TypeError('M2.5.1 Live evidence cannot pass without explicit authorization');
  }
  if (
    expectedOutcome === M251AcceptanceOutcome.PASS &&
    (!m251SourceIdentitiesMatch(opening, closing) ||
      !sourceManifests.matches ||
      authorization.availability !== 'EXPLICIT')
  ) {
    throw new TypeError(
      'A passing M2.5.1 assessment requires exact source closure and authorization',
    );
  }
  if (JSON.stringify(manifest.nonClaims) !== JSON.stringify(M251_REQUIRED_NON_CLAIMS)) {
    throw new TypeError('M2.5.1 evidence manifest must retain the exact non-claims');
  }
  validatePrivacy(manifest.privacy);
  assertM251AssessmentMetadataOnly(manifest);
  return Object.freeze(manifest);
}
