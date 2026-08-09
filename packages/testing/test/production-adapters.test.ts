import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import * as publicRuntimeApi from '@codeclosure/runtime';
import { CryptographicIdentityGenerator, SystemUtcClock } from '@codeclosure/runtime/composition';

void test('[I-006][I-008] production time and identifiers pass owning domain codecs', () => {
  const clock = new SystemUtcClock();
  assert.match(clock.now(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  const ids = new CryptographicIdentityGenerator();
  const generated = [
    ids.nextGoalId(),
    ids.nextWorkflowId(),
    ids.nextSuccessCriterionId(),
    ids.nextAttemptId(),
    ids.nextAuditEventId(),
    ids.nextCommandId(),
    ids.nextContextManifestId(),
    ids.nextWorkerSessionId(),
    ids.nextCandidateId(),
    ids.nextCandidateGenerationId(),
    ids.nextCheckSpecificationId(),
    ids.nextEvidenceId(),
    ids.nextVerificationObligationId(),
    ids.nextAcceptanceDecisionId(),
    ids.nextRecoveryReconciliationId(),
    ids.nextProjectReadSnapshotCleanupOutcomeId(),
  ];
  assert.equal(new Set(generated).size, generated.length);
  for (const identifier of generated) {
    assert.match(identifier, /^[a-z-]+_[a-f0-9]{32}$/);
  }
});

void test('[I-006] production identifiers remain unique across fresh processes', () => {
  const compositionUrl = new URL('../../runtime/dist/composition.js', import.meta.url).href;
  const script = `
    import { CryptographicIdentityGenerator } from ${JSON.stringify(compositionUrl)};
    const ids = new CryptographicIdentityGenerator();
    process.stdout.write(JSON.stringify(Array.from({ length: 128 }, () => ids.nextCommandId())));
  `;
  const generated = Array.from(
    { length: 3 },
    () =>
      JSON.parse(
        execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
          encoding: 'utf8',
        }),
      ) as unknown,
  ).flatMap((value) => {
    assert.ok(Array.isArray(value));
    assert.equal(
      value.every((entry) => typeof entry === 'string'),
      true,
    );
    return value as string[];
  });
  assert.equal(generated.length, 384);
  assert.equal(new Set(generated).size, generated.length);
});

void test('[I-023] production adapters are available only from trusted composition', () => {
  assert.equal('CryptographicIdentityGenerator' in publicRuntimeApi, false);
  assert.equal('SystemUtcClock' in publicRuntimeApi, false);
});
