import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  CanonicalJsonSha256DigestProvider,
  RecoveryInspectionAvailability,
  RecoveryInspectionReasonCode,
  decodeRecoveryInspectionRequest,
  decodeRecoveryInspectionResult,
  deriveM1BaseProjectIdentity,
} from '@codeclosure/runtime';

import { createNormalizedProjectPathPort } from '../dist/composition/project-paths.js';
import { M1LocalRecoveryInspector } from '../dist/composition/recovery-inspector.js';

function temporaryRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-cli-recovery-inspector-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

function request(projectPath: string) {
  return decodeRecoveryInspectionRequest({
    schemaVersion: 1,
    goalId: 'goal_recovery-inspector',
    goalRevision: 1,
    workflowId: 'workflow_recovery-inspector',
    workflowVersion: 3,
    phase: 'SOURCE_FREEZE',
    sourceAttemptId: 'attempt_recovery-inspector',
    projectPath,
    expectedProjectIdentity: 'm1-project:expected-by-coordinator',
    candidateGenerationId: 'generation_recovery-inspector',
    candidateBaseIdentity: 'm1-project:logical-base',
    expectedCandidateDigest:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    executionProfileId: 'profile_m1-happy-path',
    executionProfileDigest:
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
}

void test('[I-011][I-018] local recovery observes path identity without inventing Candidate paths', (t) => {
  const project = join(temporaryRoot(t), 'project');
  mkdirSync(project, { mode: 0o700 });
  const digests = new CanonicalJsonSha256DigestProvider();
  const inspection = decodeRecoveryInspectionResult(
    new M1LocalRecoveryInspector(digests).inspect(request(project)),
  );

  assert.equal(inspection.availability, RecoveryInspectionAvailability.OBSERVED);
  assert.equal(inspection.reasonCode, RecoveryInspectionReasonCode.INSPECTION_COMPLETE);
  assert.equal(inspection.observedProjectIdentity, deriveM1BaseProjectIdentity(project, digests));
  assert.equal(inspection.candidateGenerationId, 'generation_recovery-inspector');
  assert.equal(inspection.candidateBaseIdentity, 'm1-project:logical-base');
  assert.equal(
    inspection.observedCandidateDigest,
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  );
  assert.deepEqual(inspection.observationRefs, ['m1-local:logical-authority-observed']);
});

void test('[I-011][I-027] unavailable project fails recovery observation closed', (t) => {
  const project = join(temporaryRoot(t), 'missing-project');
  const inspection = decodeRecoveryInspectionResult(
    new M1LocalRecoveryInspector(new CanonicalJsonSha256DigestProvider()).inspect(request(project)),
  );

  assert.equal(inspection.availability, RecoveryInspectionAvailability.UNAVAILABLE);
  assert.equal(inspection.reasonCode, RecoveryInspectionReasonCode.PROJECT_UNAVAILABLE);
  assert.equal(inspection.observedProjectIdentity, undefined);
  assert.equal(inspection.observedCandidateDigest, undefined);
});

void test('[I-006][I-007] CLI project paths must already have one exact absolute identity', (t) => {
  const project = join(temporaryRoot(t), 'project');
  const paths = createNormalizedProjectPathPort();

  assert.equal(paths.parseNormalizedAbsolute(project), project);
  assert.throws(
    () => paths.parseNormalizedAbsolute(`${project}/../project`),
    /must already be normalized/,
  );
  assert.throws(() => paths.parseNormalizedAbsolute('relative/project'), /must be.*absolute/);
  assert.throws(() => paths.parseNormalizedAbsolute(parse(project).root), /filesystem root/);
});
