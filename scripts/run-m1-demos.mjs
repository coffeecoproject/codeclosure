import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const entryPoint = resolve(repositoryRoot, 'apps/cli/dist/index.js');
const scenarios = Object.freeze([
  Object.freeze({
    name: 'happy-path',
    proofCode: 'HAPPY_PATH_EXACT_CLOSEOUT',
    runStatus: 'CLOSED',
    technicalCloseout: true,
  }),
  Object.freeze({
    name: 'lying-worker',
    proofCode: 'LYING_WORKER_REJECTED',
    runStatus: 'FAILED',
    technicalCloseout: false,
  }),
  Object.freeze({
    name: 'missing-evidence',
    proofCode: 'MISSING_EVIDENCE_FAILED_CLOSED',
    runStatus: 'FAILED',
    technicalCloseout: false,
  }),
  Object.freeze({
    name: 'failing-evidence',
    proofCode: 'FAILING_EVIDENCE_REPAIR_REQUIRED',
    runStatus: 'READY',
    technicalCloseout: false,
  }),
  Object.freeze({
    name: 'stale-closeout',
    proofCode: 'STALE_CLOSEOUT_INVALIDATED',
    runStatus: 'FAILED',
    technicalCloseout: false,
  }),
  Object.freeze({
    name: 'restart-resume',
    proofCode: 'RESTART_RESUME_FRESH_ATTEMPT',
    runStatus: 'CLOSED',
    technicalCloseout: true,
  }),
  Object.freeze({
    name: 'duplicate-result',
    proofCode: 'DUPLICATE_RESULT_DEDUPLICATED',
    runStatus: 'CLOSED',
    technicalCloseout: true,
  }),
  Object.freeze({
    name: 'candidate-drift',
    proofCode: 'CANDIDATE_DRIFT_INVALIDATED',
    runStatus: 'FAILED',
    technicalCloseout: false,
  }),
]);

function object(value, name) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} object`);
  return value;
}

const runRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m1-demo-audit-'));
const ordinaryAuthorityHome = join(runRoot, 'ordinary-authority-must-remain-absent');
try {
  for (const expected of scenarios) {
    const result = spawnSync(
      process.execPath,
      [entryPoint, 'demo', 'run', expected.name, '--json'],
      {
        cwd: runRoot,
        encoding: 'utf8',
        env: { ...process.env, CODECLOSURE_HOME: ordinaryAuthorityHome },
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
      },
    );
    assert.equal(result.error, undefined, `${expected.name}: ${result.error?.message ?? ''}`);
    assert.equal(result.signal, null, `${expected.name}: terminated by ${String(result.signal)}`);
    assert.equal(result.status, 0, `${expected.name}: ${result.stderr}`);
    assert.equal(result.stderr, '', `${expected.name}: stderr must remain empty`);
    const envelope = object(JSON.parse(result.stdout), `${expected.name} envelope`);
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.kind, 'DEMO_RESULT');
    assert.equal(envelope.operation, 'demo run');
    const proof = object(envelope.result, `${expected.name} proof`);
    assert.equal(proof.scenario, expected.name);
    assert.equal(proof.passed, true);
    assert.equal(proof.proofCode, expected.proofCode);
    const finalStatus = object(proof.finalStatus, `${expected.name} final status`);
    const reopenedStatus = object(proof.reopenedStatus, `${expected.name} reopened status`);
    assert.equal(finalStatus.runStatus, expected.runStatus);
    assert.equal(finalStatus.technicalCloseout, expected.technicalCloseout);
    assert.deepEqual(reopenedStatus, finalStatus);
    const audit = object(proof.audit, `${expected.name} audit`);
    assert.equal(audit.goalId, proof.goalId);
    assert.ok(Number(audit.throughSequence) > 0, `${expected.name}: audit sequence`);
    process.stdout.write(`PASS ${expected.name}: ${expected.proofCode}\n`);
  }
  assert.equal(
    existsSync(ordinaryAuthorityHome),
    false,
    'named demos must not open ordinary application authority',
  );
  process.stdout.write(`M1 adversarial demos: ${scenarios.length}/${scenarios.length} passed\n`);
} finally {
  rmSync(runRoot, { force: true, recursive: true });
}
