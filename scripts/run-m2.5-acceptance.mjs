import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { release, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

import {
  M25_REVIEW_EXCLUSION,
  M25_ACCEPTANCE_MATRIX_CONTRACT_DIGEST,
  M25_REQUIRED_NON_CLAIMS,
  M25_REQUIRED_SCENARIO_EVIDENCE,
  M25AssessmentMeaning,
  M25AcceptanceOutcome,
  M25AcceptanceStage,
  M25_STAGE_ORDER,
  assertM25StageEnumeration,
  buildM25MatrixResults,
  m25AssessmentOutcome,
  m25SourceIdentitiesMatch,
  parseM25AcceptanceMatrix,
  parseM25SourceIdentity,
  parseNodeTestNames,
  parseNodeTestSummaries,
  sha256Bytes,
  validateM25EvidenceManifest,
  validateM25ScenarioEvidenceArtifact,
} from './m2.5-acceptance-lib.mjs';
import { parseM2CurrentSourceRegressionResult } from './m2-acceptance-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const planPath = join(repositoryRoot, 'docs', 'plans', 'm2.5-acceptance-plan.md');
const evidenceRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m2-5-acceptance-'));
const artifactsRoot = join(evidenceRoot, 'artifacts');
const maximumOutputBytes = 128 * 1024 * 1024;
const requireStoreDependency = createRequire(
  new URL('../packages/store-sqlite/package.json', import.meta.url),
);
mkdirSync(artifactsRoot, { mode: 0o700 });

const scenarioEvidenceDefinitions = Object.freeze([
  Object.freeze({
    ...M25_REQUIRED_SCENARIO_EVIDENCE[0],
    environmentName: 'CODECLOSURE_M25_ASSISTANT_SCENARIO_EVIDENCE_PATH',
    artifactPath: 'artifacts/m2.5-assistant-assumption.json',
  }),
  Object.freeze({
    ...M25_REQUIRED_SCENARIO_EVIDENCE[1],
    environmentName: 'CODECLOSURE_M25_GOVERNED_SCENARIO_EVIDENCE_PATH',
    artifactPath: 'artifacts/m2.5-governed-chain.json',
  }),
]);

function sourceIdentityCommand() {
  return Object.freeze([
    process.execPath,
    'scripts/source-identity.mjs',
    '--review-exclusion',
    M25_REVIEW_EXCLUSION,
  ]);
}

function preflightCommand() {
  return Object.freeze([
    process.execPath,
    'scripts/m2.5-preflight.mjs',
    '--review-exclusion',
    M25_REVIEW_EXCLUSION,
  ]);
}

const stageDefinitions = assertM25StageEnumeration([
  {
    id: M25AcceptanceStage.PREFLIGHT,
    command: preflightCommand(),
    requireTests: false,
  },
  {
    id: M25AcceptanceStage.QUALITY,
    command: ['corepack', 'pnpm', 'gate:quality'],
    requireTests: true,
  },
  {
    id: M25AcceptanceStage.M1_REGRESSION,
    command: ['corepack', 'pnpm', 'accept:m1'],
    requireTests: false,
  },
  {
    id: M25AcceptanceStage.M2_REGRESSION,
    command: ['corepack', 'pnpm', 'regress:m2'],
    requireTests: false,
  },
  {
    id: M25AcceptanceStage.STATIC_AUTHORITY,
    command: [
      process.execPath,
      'scripts/run-node-tests.mjs',
      'scripts/check-cli-boundary.test.mjs',
      'scripts/check-dependencies.test.mjs',
      'scripts/check-invariants.test.mjs',
    ],
    requireTests: true,
  },
  {
    id: M25AcceptanceStage.ADAPTER,
    command: [
      process.execPath,
      'scripts/run-node-tests.mjs',
      'packages/adapter-codex-intake/test/adapter.test.ts',
    ],
    requireTests: true,
  },
  {
    id: M25AcceptanceStage.SQLITE,
    command: [
      process.execPath,
      'scripts/run-node-tests.mjs',
      'packages/store-sqlite/test/intake-control-store.test.ts',
      'packages/store-sqlite/test/intake-coordinator.test.ts',
    ],
    requireTests: true,
  },
  {
    id: M25AcceptanceStage.CLI,
    command: [
      process.execPath,
      'scripts/run-node-tests.mjs',
      '--test-concurrency=1',
      'apps/cli/test/cli-parser.test.ts',
      'apps/cli/test/intake-cli.test.ts',
      'apps/cli/test/cli-process.test.ts',
    ],
    requireTests: true,
  },
  {
    id: M25AcceptanceStage.SOURCE_CLOSURE,
    command: sourceIdentityCommand(),
    requireTests: false,
  },
]);

function log(message) {
  process.stderr.write(`[accept:m2.5] ${message}\n`);
}

function artifactPath(stageId) {
  return `artifacts/${stageId}.log`;
}

function isolatedStateRootPath(stageId) {
  return `scenario-roots/${stageId}`;
}

function scenarioEvidenceEnvironment(stageId) {
  return Object.fromEntries(
    scenarioEvidenceDefinitions
      .filter((definition) => definition.stageId === stageId)
      .map((definition) => [
        definition.environmentName,
        join(evidenceRoot, definition.artifactPath),
      ]),
  );
}

function runStage(definition) {
  const [executable, ...arguments_] = definition.command;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const isolatedStateRoot = isolatedStateRootPath(definition.id);
  const absoluteIsolatedStateRoot = join(evidenceRoot, isolatedStateRoot);
  mkdirSync(absoluteIsolatedStateRoot, { mode: 0o700, recursive: true });
  log(`RUN ${definition.id}: ${definition.command.join(' ')}`);
  const result = spawnSync(executable, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CODECLOSURE_NODE_TEST_EVIDENCE: '1',
      TMPDIR: absoluteIsolatedStateRoot,
      TMP: absoluteIsolatedStateRoot,
      TEMP: absoluteIsolatedStateRoot,
      ...scenarioEvidenceEnvironment(definition.id),
    },
    maxBuffer: maximumOutputBytes,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const artifact = Buffer.from(`STDOUT\n${stdout}\nSTDERR\n${stderr}`, 'utf8');
  const relativeArtifactPath = artifactPath(definition.id);
  writeFileSync(join(evidenceRoot, relativeArtifactPath), artifact, { mode: 0o600 });
  let outcome = M25AcceptanceOutcome.PASS;
  let summaries = [];
  const executedTestNames = parseNodeTestNames(`${stdout}\n${stderr}`);
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    outcome =
      definition.id === M25AcceptanceStage.PREFLIGHT ||
      definition.id === M25AcceptanceStage.SOURCE_CLOSURE ||
      (definition.id === M25AcceptanceStage.M2_REGRESSION && result.status === 2)
        ? M25AcceptanceOutcome.BLOCKED
        : M25AcceptanceOutcome.FAIL;
  } else {
    try {
      summaries = parseNodeTestSummaries(`${stdout}\n${stderr}`, {
        requireTests: definition.requireTests,
      });
    } catch (error) {
      outcome = M25AcceptanceOutcome.FAIL;
      log(
        `${definition.id} evidence rejected: ${error instanceof Error ? error.message : 'unknown summary failure'}`,
      );
    }
  }
  const testCount = summaries.reduce((total, summary) => total + summary.tests, 0);
  const skipCount = summaries.reduce(
    (total, summary) => total + summary.skipped + summary.todo + summary.cancelled,
    0,
  );
  const stage = Object.freeze({
    id: definition.id,
    outcome,
    command: definition.command,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMilliseconds: Date.now() - started,
    exitCode: result.status,
    skipCount,
    testCount,
    executedTestNames,
    artifactPath: relativeArtifactPath,
    artifactDigest: sha256Bytes(artifact),
    isolatedStateRoot,
  });
  log(`${outcome} ${definition.id}`);
  return Object.freeze({ stage, stdout, stderr });
}

function collectScenarioEvidence() {
  return Object.freeze(
    scenarioEvidenceDefinitions.map((definition) => {
      const absolutePath = join(evidenceRoot, definition.artifactPath);
      if (!existsSync(absolutePath)) {
        return Object.freeze({
          availability: 'UNAVAILABLE',
          scenarioId: definition.scenarioId,
          stageId: definition.stageId,
          reasonCode: 'SCENARIO_EVIDENCE_NOT_EMITTED',
        });
      }
      try {
        const artifact = readFileSync(absolutePath);
        const parsed = validateM25ScenarioEvidenceArtifact(JSON.parse(artifact.toString('utf8')));
        if (parsed.scenarioId !== definition.scenarioId) {
          throw new TypeError('scenario identity differs from its configured artifact');
        }
        return Object.freeze({
          availability: 'AVAILABLE',
          scenarioId: definition.scenarioId,
          stageId: definition.stageId,
          artifactPath: definition.artifactPath,
          artifactDigest: sha256Bytes(artifact),
        });
      } catch (error) {
        log(
          `Scenario evidence ${definition.scenarioId} rejected: ${error instanceof Error ? error.message : 'unknown evidence failure'}`,
        );
        return Object.freeze({
          availability: 'UNAVAILABLE',
          scenarioId: definition.scenarioId,
          stageId: definition.stageId,
          reasonCode: 'SCENARIO_EVIDENCE_REJECTED',
        });
      }
    }),
  );
}

function blockedStage(definition) {
  const startedAt = new Date().toISOString();
  const artifact = Buffer.from(
    `BLOCKED\nM2.5 preflight did not establish the entry conditions; ${definition.id} was not executed.\n`,
    'utf8',
  );
  const relativeArtifactPath = artifactPath(definition.id);
  const isolatedStateRoot = isolatedStateRootPath(definition.id);
  mkdirSync(join(evidenceRoot, isolatedStateRoot), { mode: 0o700, recursive: true });
  writeFileSync(join(evidenceRoot, relativeArtifactPath), artifact, { mode: 0o600 });
  return Object.freeze({
    stage: Object.freeze({
      id: definition.id,
      outcome: M25AcceptanceOutcome.BLOCKED,
      command: definition.command,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMilliseconds: 0,
      exitCode: null,
      skipCount: 0,
      testCount: 0,
      executedTestNames: Object.freeze([]),
      artifactPath: relativeArtifactPath,
      artifactDigest: sha256Bytes(artifact),
      isolatedStateRoot,
    }),
    stdout: '',
    stderr: '',
  });
}

function environmentIdentity() {
  const pnpm = spawnSync('corepack', ['pnpm', '--version'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return Object.freeze({
    platform: process.platform,
    architecture: process.arch,
    operatingSystemRelease: release(),
    nodeVersion: process.version,
    pnpmVersion: pnpm.status === 0 ? pnpm.stdout.trim() : 'UNAVAILABLE',
    sqliteRuntime: safeSqliteRuntimeIdentity(),
    evidenceDirectoryName: basename(evidenceRoot),
  });
}

function safeSqliteRuntimeIdentity() {
  try {
    return sqliteRuntimeIdentity();
  } catch {
    return 'UNAVAILABLE';
  }
}

function sqliteRuntimeIdentity() {
  const Database = requireStoreDependency('better-sqlite3');
  const database = new Database(':memory:');
  try {
    const result = database.prepare('select sqlite_version() as version').get();
    if (
      result === null ||
      typeof result !== 'object' ||
      typeof Reflect.get(result, 'version') !== 'string'
    ) {
      throw new TypeError('SQLite runtime version query returned an invalid result');
    }
    return `better-sqlite3/sqlite-${Reflect.get(result, 'version')}`;
  } finally {
    database.close();
  }
}

async function proofConfigurationIdentity() {
  const runtime = await import('../packages/runtime/dist/index.js');
  const domain = await import('../packages/domain/dist/index.js');
  const testing = await import('../packages/testing/dist/index.js');
  const adapter = await import('../packages/adapter-codex-intake/dist/index.js');
  const digests = new runtime.CanonicalJsonSha256DigestProvider();
  const admissionPolicy = runtime.createM25AdmissionPolicy(
    runtime.createM25LocalAdmissionPolicyDefinition(),
    digests,
  );
  const workflowPolicy = runtime.createM1PolicyBundleDefinition(digests);
  const executionProfile = testing.m1FakeExecutionProfileRecipe(
    testing.M1FakeExecutionProfileName.HAPPY_PATH,
  ).definition;
  const versioned = (id, version, digest) => Object.freeze({ id, version, digest });
  return Object.freeze({
    availability: 'AVAILABLE',
    admissionPolicy: versioned(admissionPolicy.id, admissionPolicy.version, admissionPolicy.digest),
    assistantProfile: versioned(
      runtime.m25IntakeAssistantProfile.id,
      runtime.m25IntakeAssistantProfile.version,
      digests.digest(runtime.m25IntakeAssistantProfile),
    ),
    workflowPolicy: versioned(
      workflowPolicy.id,
      workflowPolicy.version,
      digests.digest(domain.policyBundleProjection(workflowPolicy)),
    ),
    executionProfile: versioned(
      executionProfile.id,
      executionProfile.version,
      digests.digest(domain.executionProfileProjection(executionProfile)),
    ),
    assistantAdapter: versioned(
      runtime.M25_INTAKE_ASSISTANT_ADAPTER_ID,
      runtime.M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
      digests.digest({
        id: runtime.M25_INTAKE_ASSISTANT_ADAPTER_ID,
        version: runtime.M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
      }),
    ),
    budgetProfile: versioned(
      runtime.M25_INTAKE_BUDGET_PROFILE_ID,
      runtime.M25_INTAKE_BUDGET_PROFILE_VERSION,
      digests.digest(runtime.m25IntakeBudgetDefinition),
    ),
    protocol: Object.freeze({
      codexVersion: runtime.M25_INTAKE_CODEX_VERSION,
      snapshotDigest: runtime.M25_INTAKE_PROTOCOL_SNAPSHOT_DIGEST,
    }),
    responseContracts: Object.freeze([
      versioned(
        runtime.M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_ID,
        runtime.M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION,
        digests.digest(runtime.m25IntentAnalysisResponseSchema),
      ),
      versioned(
        runtime.M25_ANSWER_ONLY_RESPONSE_CONTRACT_ID,
        runtime.M25_ANSWER_ONLY_RESPONSE_CONTRACT_VERSION,
        digests.digest(runtime.m25AnswerOnlyResponseSchema),
      ),
    ]),
    closedInvocation: Object.freeze({
      permissionProfileId: adapter.M25_INTAKE_PERMISSION_PROFILE_ID,
      configurationDigest: digests.digest(adapter.m25IntakeClosedConfig),
      managedRequirementsDigest: digests.digest(adapter.m25IntakeManagedRequirements),
      permissionProfileDigest: digests.digest(adapter.m25IntakePermissionProfile),
    }),
  });
}

const openingExecution = runStage(stageDefinitions[0]);
const executions =
  openingExecution.stage.outcome === M25AcceptanceOutcome.PASS
    ? [openingExecution, ...stageDefinitions.slice(1).map(runStage)]
    : [
        openingExecution,
        ...stageDefinitions.slice(1, -1).map(blockedStage),
        runStage(stageDefinitions.at(-1)),
      ];
let proofConfiguration;
try {
  proofConfiguration = await proofConfigurationIdentity();
} catch (error) {
  log(
    `Proof configuration unavailable: ${error instanceof Error ? error.message : 'unknown failure'}`,
  );
}
let openingSourceIdentity;
let closingSourceIdentity;
try {
  openingSourceIdentity = parseM25SourceIdentity(executions[0].stdout);
  closingSourceIdentity = parseM25SourceIdentity(executions.at(-1).stdout);
} catch (error) {
  log(`Source identity rejected: ${error instanceof Error ? error.message : 'unknown failure'}`);
}

const scenarioEvidence = collectScenarioEvidence();
let stages = executions.map(({ stage }) => stage);
const m2RegressionExecution = executions.find(
  ({ stage }) => stage.id === M25AcceptanceStage.M2_REGRESSION,
);
if (m2RegressionExecution !== undefined && m2RegressionExecution.stage.exitCode !== null) {
  try {
    const regression = parseM2CurrentSourceRegressionResult(
      m2RegressionExecution.stdout,
      openingSourceIdentity,
    );
    const expectedExitCode =
      regression.verdict === M25AcceptanceOutcome.PASS
        ? 0
        : regression.verdict === M25AcceptanceOutcome.BLOCKED
          ? 2
          : 1;
    if (m2RegressionExecution.stage.exitCode !== expectedExitCode) {
      throw new TypeError('M2 regression exit code differs from its structured verdict');
    }
    stages = stages.map((stage) =>
      stage.id === M25AcceptanceStage.M2_REGRESSION
        ? Object.freeze({ ...stage, outcome: regression.verdict })
        : stage,
    );
  } catch (error) {
    log(
      `M2 current-source regression evidence rejected: ${error instanceof Error ? error.message : 'unknown failure'}`,
    );
    stages = stages.map((stage) =>
      stage.id === M25AcceptanceStage.M2_REGRESSION
        ? Object.freeze({ ...stage, outcome: M25AcceptanceOutcome.FAIL })
        : stage,
    );
  }
}
for (const evidence of scenarioEvidence) {
  if (evidence.availability === 'UNAVAILABLE') {
    stages = stages.map((stage) =>
      stage.id === evidence.stageId && stage.outcome === M25AcceptanceOutcome.PASS
        ? Object.freeze({ ...stage, outcome: M25AcceptanceOutcome.FAIL })
        : stage,
    );
  }
}
if (proofConfiguration === undefined) {
  stages = stages.map((stage) =>
    stage.id === M25AcceptanceStage.PREFLIGHT && stage.outcome === M25AcceptanceOutcome.PASS
      ? Object.freeze({ ...stage, outcome: M25AcceptanceOutcome.BLOCKED })
      : stage,
  );
}
if (
  openingSourceIdentity === undefined ||
  closingSourceIdentity === undefined ||
  !m25SourceIdentitiesMatch(openingSourceIdentity, closingSourceIdentity)
) {
  stages = stages.map((stage) =>
    stage.id === M25AcceptanceStage.SOURCE_CLOSURE && stage.outcome === M25AcceptanceOutcome.PASS
      ? Object.freeze({ ...stage, outcome: M25AcceptanceOutcome.BLOCKED })
      : stage,
  );
}

let rows;
try {
  rows = parseM25AcceptanceMatrix(readFileSync(planPath, 'utf8'));
} catch (error) {
  log(`Acceptance matrix rejected: ${error instanceof Error ? error.message : 'unknown failure'}`);
  rows = Object.freeze([]);
}
const matrixResults = rows.length === 0 ? Object.freeze([]) : buildM25MatrixResults(rows, stages);
const outcome =
  matrixResults.length === 0 ? M25AcceptanceOutcome.FAIL : m25AssessmentOutcome(matrixResults);
const unavailableSourceIdentity = (reasonCode) =>
  Object.freeze({ availability: 'UNAVAILABLE', reasonCode });
const manifest = Object.freeze({
  schemaVersion: 1,
  kind: 'M25_EXECUTABLE_ASSESSMENT',
  assessmentMeaning:
    outcome === M25AcceptanceOutcome.PASS
      ? M25AssessmentMeaning.READY
      : M25AssessmentMeaning.NOT_READY,
  reviewExclusion: M25_REVIEW_EXCLUSION,
  environment: environmentIdentity(),
  proofConfiguration:
    proofConfiguration ??
    Object.freeze({
      availability: 'UNAVAILABLE',
      reasonCode: 'PROOF_CONFIGURATION_UNAVAILABLE',
    }),
  matrixContractDigest: M25_ACCEPTANCE_MATRIX_CONTRACT_DIGEST,
  openingSourceIdentity:
    openingSourceIdentity ?? unavailableSourceIdentity('OPENING_SOURCE_IDENTITY_UNAVAILABLE'),
  closingSourceIdentity:
    closingSourceIdentity ?? unavailableSourceIdentity('CLOSING_SOURCE_IDENTITY_UNAVAILABLE'),
  stages: Object.freeze(stages),
  scenarioEvidence,
  matrixResults,
  outcome,
  nonClaims: M25_REQUIRED_NON_CLAIMS,
});

const manifestPath = join(evidenceRoot, 'evidence-manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
let manifestValid = false;
try {
  validateM25EvidenceManifest(manifest, (relativePath) =>
    readFileSync(join(evidenceRoot, relativePath)),
  );
  manifestValid = true;
} catch (error) {
  log(`Evidence manifest rejected: ${error instanceof Error ? error.message : 'unknown failure'}`);
}

const finalOutcome = manifestValid ? outcome : M25AcceptanceOutcome.FAIL;
process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    kind: 'M25_EXECUTABLE_ASSESSMENT_RESULT',
    outcome: finalOutcome,
    assessmentMeaning:
      finalOutcome === M25AcceptanceOutcome.PASS
        ? M25AssessmentMeaning.READY
        : M25AssessmentMeaning.NOT_READY,
    evidenceDirectory: evidenceRoot,
    evidenceManifest: manifestPath,
    reviewExclusion: M25_REVIEW_EXCLUSION,
    milestoneStatusMutationAuthorized: false,
    independentReviewRequired: true,
    stageOrder: M25_STAGE_ORDER,
  })}\n`,
);
process.exitCode =
  finalOutcome === M25AcceptanceOutcome.PASS
    ? 0
    : finalOutcome === M25AcceptanceOutcome.BLOCKED
      ? 2
      : 1;
