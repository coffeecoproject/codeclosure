import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { M251_REVIEW_EXCLUSION } from './m2.5.1-acceptance-lib.mjs';

import {
  M251_LIVE_INTAKE_RECEIPT_KIND,
  M251_LIVE_INTAKE_REVIEW_EXCLUSION,
  M251_LIVE_INTAKE_SCENARIO_RECEIPT_KIND,
  M251_LIVE_INTAKE_SCENARIOS,
  M251_PROJECT_TREE_MANIFEST_SCHEMA,
  assertM251MetadataOnly,
  m251ProjectTreeIdentity,
  m251ScenarioDigest,
  validateM251LiveReceipt,
  validateM251ScenarioReceipt,
} from './m2.5.1-live-intake-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const digest = (value) => `sha256:${value.repeat(64)}`;

function sourceIdentity() {
  return {
    baseGitRevision: '0'.repeat(40),
    gitBranch: 'm2.5-goal-intake',
    workingTreeState: 'modified',
    manifestSchema: 'codeclosure-source-manifest-v1',
    pathCount: 1_023,
    digest: digest('0'),
    reviewExclusion: M251_LIVE_INTAKE_REVIEW_EXCLUSION,
  };
}

function projectTreeIdentity() {
  return {
    manifestSchema: M251_PROJECT_TREE_MANIFEST_SCHEMA,
    entryCount: 2,
    digest: digest('7'),
  };
}

function scenarioReceipt(scenario, index) {
  const answer = scenario.id === 'ANSWER_ONLY';
  const ambiguous = scenario.id === 'AMBIGUOUS_INTENT';
  return {
    schemaVersion: 1,
    kind: M251_LIVE_INTAKE_SCENARIO_RECEIPT_KIND,
    scenarioId: scenario.id,
    scenarioDigest: m251ScenarioDigest(scenario),
    operation: scenario.operation,
    authority: {
      intakeRunRefDigest: digest(String(index + 1)),
      outcomeKind: answer ? 'NO_EXECUTION' : 'CLARIFICATION_REQUIRED',
      intakeStatus: answer ? 'NO_EXECUTION' : 'NEEDS_CLARIFICATION',
      answerDisposition: answer ? 'ANSWER_RETURNED' : 'NOT_REQUESTED',
      proposalCount: answer ? 0 : 1,
      projectionCount: answer ? 0 : 1,
      decisionCount: 1,
      questionCount: answer ? 0 : 1,
      sourceBindingCounts: {
        MODEL_PROPOSED: ambiguous ? 1 : 0,
        POLICY_DERIVED: answer ? 0 : 2,
        PROJECT_OBSERVED: 0,
        UNRESOLVED: 0,
        USER_STATED: answer ? 0 : ambiguous ? 2 : 3,
      },
      userStatedFields: answer
        ? []
        : ambiguous
          ? ['OBJECTIVE', 'SCOPE']
          : ['OBJECTIVE', 'REQUIRED_CRITERION', 'SCOPE'],
      questionFields: answer ? [] : ambiguous ? ['REQUIRED_CRITERION'] : ['SCOPE'],
      materializedGoalCreated: false,
      startAuthorizationCreated: false,
    },
    observation: {
      state: 'COMPLETED',
      processLaunchCount: 1,
      threadStartCount: 1,
      turnStartCount: 1,
      turnInterruptCount: 0,
      compactionCount: 0,
      backendSessionRefDigest: digest(['a', 'b', 'c'][index]),
      backendOperationRefDigest: digest(['d', 'e', 'f'][index]),
    },
    effects: {
      closedConfigurationValidated: true,
      forbiddenEffectObserved: false,
      projectObservationGranted: false,
      assistantRetryCount: 0,
    },
    cleanup: {
      ownedProcessShutdownClean: true,
      operationRootRemoved: true,
      temporaryStateRootRemoved: true,
      projectTreeOpening: scenario.requiresProject ? projectTreeIdentity() : null,
      projectTreeClosing: scenario.requiresProject ? projectTreeIdentity() : null,
      projectUnchanged: true,
    },
  };
}

function liveReceipt() {
  return {
    schemaVersion: 1,
    kind: M251_LIVE_INTAKE_RECEIPT_KIND,
    authorization: 'EXPLICIT',
    source: { opening: sourceIdentity(), closing: sourceIdentity() },
    toolchain: {
      nodeVersion: 'v22.22.3',
      codexVersion: 'codex-cli 0.146.1',
      protocolSnapshotDigest: digest('1'),
      assistantProfileVersion: 'codeclosure-m2-5-1-local-assistant-v3',
      assistantAdapterVersion: 'codeclosure-m2-5-1-intake-adapter-v3',
      closedConfigurationVersion: 'codeclosure-m2-5-1-local-config-v2',
      protocolProjectionVersion: 'codeclosure-m2-5-1-projection-v2',
      instructionPolicyVersion: 'codeclosure-m2-5-1-exact-source-instructions-v1',
      intentAnalysisResponseContractVersion: 'codeclosure-m2-5-1-intent-analysis-response-v2',
      intentProjectionProfileVersion: 'codeclosure-m2-5-1-exact-value-match-v3',
    },
    prerequisite: {
      initialized: true,
      structuredOutput: true,
      turnCompleted: true,
      controlledStateRemoved: true,
    },
    scenarios: M251_LIVE_INTAKE_SCENARIOS.map(scenarioReceipt),
    aggregate: {
      scenarioCount: 3,
      processLaunchCount: 3,
      threadStartCount: 3,
      turnStartCount: 3,
      uniqueThreadRefs: 3,
      uniqueTurnRefs: 3,
    },
    privacy: {
      credentialContentRetained: false,
      requestContentInReceipt: false,
      assistantContentInReceipt: false,
      reasoningOrTranscriptRetained: false,
      rawPayloadOrExceptionRetained: false,
    },
    cleanup: { assessmentRootRemoved: true, scenarioAuthorityRootsRemoved: true },
  };
}

test('M2.5.1 live Intake receipt accepts only the complete metadata proof', () => {
  const receipt = liveReceipt();
  assert.equal(validateM251LiveReceipt(receipt), receipt);
  receipt.scenarios.forEach((scenario) =>
    assert.equal(validateM251ScenarioReceipt(scenario), scenario),
  );
});

test('M2.5.1 live Intake receipt can bind the sole canonical completion-review exclusion', () => {
  const receipt = liveReceipt();
  receipt.source.opening.reviewExclusion = M251_REVIEW_EXCLUSION;
  receipt.source.closing.reviewExclusion = M251_REVIEW_EXCLUSION;
  assert.equal(validateM251LiveReceipt(receipt, M251_REVIEW_EXCLUSION), receipt);
  assert.throws(() => validateM251LiveReceipt(receipt), /review exclusion is invalid/u);
});

test('M2.5.1 live Intake receipt rejects content-bearing diagnostics', () => {
  assert.throws(
    () => assertM251MetadataOnly({ answerContent: 'not metadata' }),
    /prohibited content-bearing field/u,
  );
  assert.throws(
    () =>
      assertM251MetadataOnly({ value: M251_LIVE_INTAKE_SCENARIOS[0].request }, [
        M251_LIVE_INTAKE_SCENARIOS[0].request,
      ]),
    /prohibited request, response, or credential content/u,
  );
});

test('M2.5.1 live Intake receipt rejects same-status source content drift', () => {
  const receipt = liveReceipt();
  receipt.source.closing.digest = digest('9');
  assert.equal(receipt.source.opening.baseGitRevision, receipt.source.closing.baseGitRevision);
  assert.equal(receipt.source.opening.workingTreeState, receipt.source.closing.workingTreeState);
  assert.throws(
    () => validateM251LiveReceipt(receipt),
    /source identity drifted during Intake execution/u,
  );
});

test('M2.5.1 project tree identity detects an added file outside the original fixture', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m251-project-tree-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(join(root, 'greeting.txt'), 'hello-v1\n', { mode: 0o600 });
  const opening = m251ProjectTreeIdentity(root);
  writeFileSync(join(root, 'unexpected.txt'), 'unexpected\n', { mode: 0o600 });
  const closing = m251ProjectTreeIdentity(root);
  assert.equal(opening.manifestSchema, M251_PROJECT_TREE_MANIFEST_SCHEMA);
  assert.notEqual(opening.entryCount, closing.entryCount);
  assert.notEqual(opening.digest, closing.digest);
});

test('M2.5.1 live Intake scenario rejects whole-project tree drift', () => {
  const clear = JSON.parse(JSON.stringify(scenarioReceipt(M251_LIVE_INTAKE_SCENARIOS[1], 1)));
  clear.cleanup.projectTreeClosing.digest = digest('8');
  assert.throws(
    () => validateM251ScenarioReceipt(clear),
    /project tree changed during the scenario/u,
  );
});

test('M2.5.1 ambiguous live Intake receipt cannot claim Goal or Start authority', () => {
  const ambiguous = JSON.parse(JSON.stringify(scenarioReceipt(M251_LIVE_INTAKE_SCENARIOS[2], 2)));
  ambiguous.authority.materializedGoalCreated = true;
  assert.throws(
    () => validateM251ScenarioReceipt(ambiguous),
    /Ambiguous Intent live scenario did not fail closed/u,
  );
});

test('M2.5.1 clear live Intake requires the deterministic explicit-scope clarification', () => {
  const clear = JSON.parse(JSON.stringify(scenarioReceipt(M251_LIVE_INTAKE_SCENARIOS[1], 1)));
  assert.equal(validateM251ScenarioReceipt(clear), clear);
  clear.authority.questionFields = [];
  assert.throws(() => validateM251ScenarioReceipt(clear), /lacks required Question field SCOPE/u);
});

test('M2.5.1 live command requires explicit authorization before external work', () => {
  const environment = { ...process.env };
  delete environment.CODECLOSURE_M251_LIVE_AUTHORIZED;
  const result = spawnSync(
    process.execPath,
    [resolve(repositoryRoot, 'scripts', 'run-m2.5.1-live-intake.mjs')],
    { cwd: repositoryRoot, encoding: 'utf8', env: environment },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CODECLOSURE_M251_LIVE_AUTHORIZED must be exactly 1/u);
});
