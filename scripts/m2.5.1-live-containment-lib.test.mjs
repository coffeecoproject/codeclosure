import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

import {
  M251_CANDIDATE_FREE_DENIED_BOUNDARIES,
  M251_CANDIDATE_FREE_PHASES,
  M251_IMPLEMENT_DENIED_BOUNDARIES,
  M251_LIVE_CONTAINMENT_AUTHORIZATION_ENV,
  M251_LIVE_CONTAINMENT_RECEIPT_KIND,
  M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION,
  admitM251LiveContainmentAuthorization,
  assertM251LiveContainmentMetadataOnly,
  m251LiveContainmentDigest,
  projectM251CandidateFreeContainmentProbe,
  projectM251CandidateFreeContainmentProbes,
  projectM251ImplementContainmentProbe,
  projectM251LiveContainmentStages,
  validateM251LiveContainmentReceipt,
} from './m2.5.1-live-containment-lib.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function digest(value) {
  return m251LiveContainmentDigest('fixture-v1', value);
}

function sourceIdentity() {
  return {
    baseGitRevision: '0c83e07000000000000000000000000000000000',
    digest: digest('source'),
    gitBranch: 'm2.5-goal-intake',
    manifestSchema: 'codeclosure-source-manifest-v1',
    pathCount: 1_234,
    reviewExclusion: M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION,
    workingTreeState: 'modified',
  };
}

function deniedBoundaries(kinds, prefix) {
  return kinds.map((kind) => ({ kind, pathDigest: digest(`${prefix}:${kind}`) }));
}

function commonProbe(phase) {
  const candidateFree = M251_CANDIDATE_FREE_PHASES.includes(phase);
  return {
    approvalRequestCount: 0,
    commandDigest: digest(`${phase}:command`),
    commandExitCode: 0,
    commandItemDigest: digest(`${phase}:command-item`),
    commandOutputBytes: 0,
    commandOutputDigest: m251LiveContainmentDigest('command-output-v1', ''),
    cwdDigest: digest(`${phase}:cwd`),
    deniedBoundaries: deniedBoundaries(
      candidateFree ? M251_CANDIDATE_FREE_DENIED_BOUNDARIES : M251_IMPLEMENT_DENIED_BOUNDARIES,
      phase,
    ),
    effectiveConfigurationDigest: digest(`${phase}:config`),
    effectiveThreadDigest: digest(`${phase}:thread`),
    forbiddenEffectCount: 0,
    isolationProfileDigest: digest(`${phase}:isolation`),
    isolationProfileId: 'codeclosure-m2-5-1-codex-phase-isolation',
    networkAccess: false,
    permissionProfileDigest: digest(`${phase}:permission`),
    permissionProfileId: 'codeclosure-m2-5-1-worker',
    phase,
    phaseEntryDigest: digest(`${phase}:entry`),
    sandboxType: candidateFree ? 'READ_ONLY' : 'WORKSPACE_WRITE',
    terminalDigest: digest(`${phase}:terminal`),
  };
}

function candidateFree(phase) {
  return projectM251CandidateFreeContainmentProbe({
    common: commonProbe(phase),
    selectedReadPathDigest: digest('snapshot:package.json'),
    selectedReadSucceeded: true,
    snapshotClosingDigest: digest('snapshot'),
    snapshotOpeningDigest: digest('snapshot'),
    snapshotWriteDenied: true,
  });
}

function implement() {
  return projectM251ImplementContainmentProbe({
    allowedWritePathDigest: digest('candidate:src/payment.js'),
    candidateChangeSetDigest: digest('candidate:change-set'),
    candidateClosingDigest: digest('candidate:closing'),
    candidateOpeningDigest: digest('candidate:opening'),
    candidateWriteObserved: true,
    common: commonProbe('IMPLEMENT'),
  });
}

function receipt() {
  const source = sourceIdentity();
  return {
    authorization: 'EXPLICIT',
    candidateFree: projectM251CandidateFreeContainmentProbes(
      M251_CANDIDATE_FREE_PHASES.map(candidateFree),
    ),
    closure: {
      assessmentRootRemoved: true,
      candidateRootRemoved: true,
      controlledProcessesShutdownClean: true,
      credentialSourceUnchanged: true,
      projectReadRootRemoved: true,
      protectedAssetUnchanged: true,
      sourceProjectUnchanged: true,
      sourceUnchanged: true,
    },
    implement: implement(),
    kind: M251_LIVE_CONTAINMENT_RECEIPT_KIND,
    privacy: {
      assistantOrModelContentRetained: false,
      credentialOrAccountContentRetained: false,
      rawCommandRetained: false,
      rawExceptionRetained: false,
      rawProtocolRetained: false,
      reasoningOrTranscriptRetained: false,
      sourceBytesRetained: false,
      unrestrictedCommandOutputRetained: false,
    },
    profileIdentity: { digest: digest('profile'), id: 'profile', version: 'v3' },
    projectIdentity: { digest: digest('project') },
    rootIdentity: { digest: digest('roots') },
    schemaVersion: 1,
    source: { closing: source, opening: source },
    stages: projectM251LiveContainmentStages([
      'PREFLIGHT',
      'DISCOVERY_PROBE',
      'PLAN_PROBE',
      'IMPLEMENT_PROBE',
      'CLOSURE',
    ]),
    toolchainIdentity: { digest: digest('toolchain') },
  };
}

function expectedIdentity(value) {
  return {
    profileIdentity: value.profileIdentity,
    projectIdentity: value.projectIdentity,
    rootIdentity: value.rootIdentity,
    source: value.source,
    toolchainIdentity: value.toolchainIdentity,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('M2.5.1 Live containment authorization is exact and separately scoped', () => {
  assert.equal(
    admitM251LiveContainmentAuthorization({
      [M251_LIVE_CONTAINMENT_AUTHORIZATION_ENV]: '1',
    }),
    'EXPLICIT',
  );
  for (const value of [undefined, '', '0', 'true', ' 1']) {
    assert.throws(
      () =>
        admitM251LiveContainmentAuthorization({
          [M251_LIVE_CONTAINMENT_AUTHORIZATION_ENV]: value,
        }),
      /must be exactly 1/u,
    );
  }
});

test('M2.5.1 Live containment Receipt accepts one exact metadata-only proof', () => {
  const value = receipt();
  assert.equal(validateM251LiveContainmentReceipt(value, expectedIdentity(value)), value);
  assert.equal(assertM251LiveContainmentMetadataOnly(value), value);
});

test('M2.5.1 Live containment Receipt rejects denied-boundary omission and duplication', () => {
  const omitted = clone(receipt());
  omitted.candidateFree[0].deniedBoundaries.pop();
  assert.throws(
    () => validateM251LiveContainmentReceipt(omitted, expectedIdentity(omitted)),
    /denied-boundary set is incomplete/u,
  );

  const duplicated = clone(receipt());
  duplicated.implement.deniedBoundaries[1].pathDigest =
    duplicated.implement.deniedBoundaries[0].pathDigest;
  assert.throws(
    () => validateM251LiveContainmentReceipt(duplicated, expectedIdentity(duplicated)),
    /incomplete or duplicated/u,
  );
});

test('M2.5.1 Live containment Receipt rejects no-op or mutable candidate-free probes', () => {
  const unread = clone(receipt());
  unread.candidateFree[1].selectedReadSucceeded = false;
  assert.throws(
    () => validateM251LiveContainmentReceipt(unread, expectedIdentity(unread)),
    /selected read and snapshot immutability/u,
  );

  const changed = clone(receipt());
  changed.candidateFree[0].snapshotClosingDigest = digest('changed-snapshot');
  assert.throws(
    () => validateM251LiveContainmentReceipt(changed, expectedIdentity(changed)),
    /selected read and snapshot immutability/u,
  );
});

test('M2.5.1 Live containment Receipt requires exact DISCOVERY and PLAN probes', () => {
  for (const mutate of [
    (value) => {
      value.candidateFree.pop();
    },
    (value) => {
      value.candidateFree[1] = clone(value.candidateFree[0]);
    },
    (value) => {
      value.candidateFree.reverse();
    },
    (value) => {
      value.candidateFree[1].phase = 'IMPLEMENT';
    },
  ]) {
    const value = clone(receipt());
    mutate(value);
    assert.throws(
      () => validateM251LiveContainmentReceipt(value, expectedIdentity(value)),
      /Candidate-free containment (?:phase is not supported|phases are incomplete or reordered)/u,
    );
  }
});

test('M2.5.1 Live containment Receipt rejects missing Candidate mutation', () => {
  const value = clone(receipt());
  value.implement.candidateClosingDigest = value.implement.candidateOpeningDigest;
  assert.throws(
    () => validateM251LiveContainmentReceipt(value, expectedIdentity(value)),
    /one Candidate-local mutation/u,
  );
});

test('M2.5.1 Live containment Receipt rejects output, approvals, effects, and network', () => {
  for (const mutate of [
    (value) => {
      value.candidateFree[0].commandOutputBytes = 1;
    },
    (value) => {
      value.candidateFree[1].approvalRequestCount = 1;
    },
    (value) => {
      value.implement.forbiddenEffectCount = 1;
    },
    (value) => {
      value.implement.networkAccess = true;
    },
  ]) {
    const value = clone(receipt());
    mutate(value);
    assert.throws(
      () => validateM251LiveContainmentReceipt(value, expectedIdentity(value)),
      /did not close under the exact isolation policy/u,
    );
  }
});

test('M2.5.1 Live containment Receipt rejects expected identity substitution', () => {
  const value = receipt();
  const expected = clone(expectedIdentity(value));
  expected.profileIdentity.digest = digest('another-profile');
  assert.throws(
    () => validateM251LiveContainmentReceipt(value, expected),
    /Expected profileIdentity drifted or was substituted/u,
  );
});

test('M2.5.1 Live containment Receipt rejects privacy claims and prohibited raw values', () => {
  const value = receipt();
  value.privacy.rawProtocolRetained = true;
  assert.throws(
    () => validateM251LiveContainmentReceipt(value, expectedIdentity(value)),
    /retained prohibited content/u,
  );

  const raw = receipt();
  raw.projectIdentity = { digest: digest('project'), leaked: 'SECRET_SENTINEL' };
  assert.throws(
    () => assertM251LiveContainmentMetadataOnly(raw, ['SECRET_SENTINEL']),
    /prohibited raw value/u,
  );
});

test('M2.5.1 Live containment Receipt rejects unknown fields and reordered stages', () => {
  const widened = receipt();
  widened.workerVerdict = 'contained';
  assert.throws(
    () => validateM251LiveContainmentReceipt(widened, expectedIdentity(widened)),
    /unknown or missing fields/u,
  );

  const reordered = clone(receipt());
  reordered.stages.reverse();
  assert.throws(
    () => validateM251LiveContainmentReceipt(reordered, expectedIdentity(reordered)),
    /incomplete or reordered/u,
  );
});

test('M2.5.1 Live containment command rejects missing authorization before external work', () => {
  const environment = { ...process.env };
  delete environment[M251_LIVE_CONTAINMENT_AUTHORIZATION_ENV];
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./run-m2.5.1-live-containment.mjs', import.meta.url))],
    { cwd: repositoryRoot, encoding: 'utf8', env: environment },
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'M2.5.1 live containment failed at ENTRY (UNCLASSIFIED_FAILURE)\n');
});

test('M2.5.1 Live containment command has one explicit non-automatic package entry', () => {
  const packageDocument = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    Object.entries(packageDocument.scripts).filter(([, command]) =>
      command.includes('run-m2.5.1-live-containment.mjs'),
    ),
    [
      [
        'probe:m2.5.1:containment:live',
        'pnpm build && node scripts/run-m2.5.1-live-containment.mjs',
      ],
    ],
  );
});
