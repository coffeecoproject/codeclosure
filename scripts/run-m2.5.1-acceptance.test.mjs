import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  M251_REVIEW_EXCLUSION,
  M251_STAGE_ORDER,
  M251AcceptanceOutcome,
  M251AcceptanceStage,
  m251Sha256Bytes,
  validateM251EvidenceManifest,
} from './m2.5.1-acceptance-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const acceptancePlanMarkdown = readFileSync(
  join(repositoryRoot, 'docs', 'plans', 'm2.5.1-acceptance-plan.md'),
  'utf8',
);
const slice0ContractBytes = readFileSync(
  join(repositoryRoot, 'scripts', 'fixtures', 'm2.5.1', 'slice0-contract.json'),
);
const packageManifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const lockfileDigest = m251Sha256Bytes(readFileSync(join(repositoryRoot, 'pnpm-lock.yaml')));

function environment(overrides = {}) {
  const selected = { ...process.env, ...overrides };
  for (const name of [
    'CODECLOSURE_M251_ACCEPTANCE_LIVE_AUTHORIZED',
    'CODECLOSURE_M251_LIVE_AUTHORIZED',
    'CODECLOSURE_M251_COMPOSITION_LIVE_AUTHORIZED',
    'CODECLOSURE_M251_CONTAINMENT_LIVE_AUTHORIZED',
    'CODECLOSURE_M2_LIVE_AUTHORIZED',
  ]) {
    if (!(name in overrides)) delete selected[name];
  }
  return selected;
}

function invoke(overrides = {}) {
  const temporaryParent = realpathSync(mkdtempSync(join(tmpdir(), 'm251-runner-test-')));
  const result = spawnSync(process.execPath, ['scripts/run-m2.5.1-acceptance.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: environment({
      TMPDIR: temporaryParent,
      TMP: temporaryParent,
      TEMP: temporaryParent,
      ...overrides,
    }),
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const output = (result.stdout ?? '').trim();
  const parsed = JSON.parse(output);
  assert.equal(parsed.kind, 'CODECLOSURE_M2_5_1_EXECUTABLE_ASSESSMENT_RESULT_V1');
  return { result, parsed, temporaryParent };
}

function readValidatedManifest(result) {
  const evidenceDirectory = realpathSync(result.evidenceDirectory);
  const manifestPath = realpathSync(result.evidenceManifest);
  assert.equal(dirname(manifestPath), evidenceDirectory);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateM251EvidenceManifest(manifest, {
    acceptancePlanMarkdown,
    slice0ContractBytes,
    packageManifest,
    lockfileDigest,
    readArtifact: (artifactPath) => readFileSync(join(evidenceDirectory, artifactPath)),
  });
  assert.deepEqual(readdirSync(evidenceDirectory).sort(), ['artifacts', 'evidence-manifest.json']);
  const referencedArtifacts = [
    manifest.sourceManifests.opening,
    manifest.sourceManifests.closing,
    ...manifest.stages,
  ]
    .filter(({ availability }) => availability !== 'UNAVAILABLE')
    .map(({ artifactPath }) => basename(artifactPath))
    .sort();
  assert.deepEqual(readdirSync(join(evidenceDirectory, 'artifacts')).sort(), referencedArtifacts);
  return { evidenceDirectory, manifest };
}

function removeEvidence(path, temporaryParent) {
  const exact = realpathSync(path);
  assert.match(exact, /\/codeclosure-m2-5-1-acceptance-[A-Za-z0-9]+$/u);
  rmSync(exact, { recursive: true, force: true });
  assert.deepEqual(readdirSync(temporaryParent), []);
  rmdirSync(temporaryParent);
}

test('M251-A12 missing aggregate authorization is BLOCKED before every executable stage', () => {
  const { result, parsed, temporaryParent } = invoke();
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.equal(parsed.outcome, M251AcceptanceOutcome.BLOCKED);
  assert.equal(parsed.reviewExclusion, M251_REVIEW_EXCLUSION);
  assert.deepEqual(parsed.stageOrder, M251_STAGE_ORDER);

  const { evidenceDirectory, manifest } = readValidatedManifest(parsed);
  try {
    assert.deepEqual(manifest.authorization, {
      availability: 'UNAVAILABLE',
      reasonCode: 'AUTHORIZATION_NOT_PROVIDED',
    });
    assert.equal(manifest.stages.length, 13);
    assert.equal(
      manifest.stages.find(({ id }) => id === M251AcceptanceStage.PREFLIGHT).outcome,
      M251AcceptanceOutcome.BLOCKED,
    );
    assert.ok(
      manifest.stages
        .slice(1)
        .every(
          (stage) =>
            stage.outcome === M251AcceptanceOutcome.BLOCKED &&
            stage.observedProofOwners.length === 0,
        ),
    );
    assert.equal(
      manifest.sourceManifests.opening.artifactDigest,
      manifest.sourceManifests.closing.artifactDigest,
    );
    assert.notEqual(
      manifest.sourceManifests.opening.artifactPath,
      manifest.sourceManifests.closing.artifactPath,
    );
  } finally {
    removeEvidence(evidenceDirectory, temporaryParent);
  }
});

test('M251-A13 malformed aggregate authorization fails closed without being treated as absence', () => {
  const { result, parsed, temporaryParent } = invoke({
    CODECLOSURE_M251_ACCEPTANCE_LIVE_AUTHORIZED: 'yes',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(parsed.outcome, M251AcceptanceOutcome.FAIL);

  const { evidenceDirectory, manifest } = readValidatedManifest(parsed);
  try {
    assert.deepEqual(manifest.authorization, {
      availability: 'UNAVAILABLE',
      reasonCode: 'AUTHORIZATION_INVALID',
    });
    assert.equal(manifest.stages[0].outcome, M251AcceptanceOutcome.FAIL);
    assert.equal(manifest.stages[0].observedProofOwners.length, 0);
    assert.ok(
      manifest.stages.slice(1).every(({ outcome }) => outcome === M251AcceptanceOutcome.BLOCKED),
    );
  } finally {
    removeEvidence(evidenceDirectory, temporaryParent);
  }
});

test('M251-A17 explicit authorization validates the assessment environment before live bindings', () => {
  const { result, parsed, temporaryParent } = invoke({
    CODECLOSURE_M251_ACCEPTANCE_LIVE_AUTHORIZED: '1',
  });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.equal(parsed.outcome, M251AcceptanceOutcome.BLOCKED);

  const { evidenceDirectory, manifest } = readValidatedManifest(parsed);
  try {
    assert.deepEqual(manifest.authorization, { availability: 'EXPLICIT' });
    const preflight = manifest.stages.find(({ id }) => id === M251AcceptanceStage.PREFLIGHT);
    const artifact = JSON.parse(
      readFileSync(join(evidenceDirectory, preflight.artifactPath), 'utf8'),
    );
    assert.equal(preflight.outcome, M251AcceptanceOutcome.BLOCKED);
    assert.equal(artifact.reasonCode, 'REQUIRED_LIVE_BINDING_UNAVAILABLE');
    assert.ok(
      manifest.stages
        .slice(1)
        .every(
          (stage) =>
            stage.outcome === M251AcceptanceOutcome.BLOCKED &&
            stage.observedProofOwners.length === 0,
        ),
    );
  } finally {
    removeEvidence(evidenceDirectory, temporaryParent);
  }
});

test('M251-A14 the package exposes one canonical non-verdict assessment command', () => {
  assert.equal(packageManifest.scripts['accept:m2.5.1'], 'node scripts/run-m2.5.1-acceptance.mjs');
  assert.equal(
    packageManifest.scripts['regress:m2.5'],
    'node scripts/run-m2.5-acceptance.mjs --regression',
  );
});
