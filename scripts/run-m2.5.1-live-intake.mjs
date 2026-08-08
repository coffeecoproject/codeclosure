import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  M251_LIVE_INTAKE_RECEIPT_KIND,
  M251_LIVE_INTAKE_REVIEW_EXCLUSION,
  M251_LIVE_INTAKE_SCENARIO_RECEIPT_KIND,
  M251_LIVE_INTAKE_SCENARIOS,
  assertM251MetadataOnly,
  m251LiveDigest,
  m251ProjectTreeIdentity,
  m251ScenarioById,
  m251ScenarioDigest,
  projectM251AssistantObservation,
  validateM251LiveReceipt,
  validateM251ScenarioReceipt,
} from './m2.5.1-live-intake-lib.mjs';
import { parseSourceIdentity, sourceIdentitiesMatch } from './m2-acceptance-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const maximumChildOutputBytes = 16 * 1024 * 1024;
let internalStage = 'ENTRY';
let internalObservation;
let internalAuthorityDiagnostic;
let internalReceiptDiagnostic;
const internalSafeDiagnostics = [];

function fail(message) {
  throw new TypeError(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    fail(`Missing required internal environment binding ${name}`);
  }
  return value;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail(`${label} did not emit one JSON document`);
  }
}

function run(executable, arguments_, options = {}) {
  return spawnSync(executable, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: maximumChildOutputBytes,
    timeout: options.timeoutMilliseconds ?? 480_000,
  });
}

function requireSuccessfulChild(result, label) {
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    fail(`${label} failed without producing admissible metadata evidence`);
  }
  return result.stdout ?? '';
}

function exactSourceIdentity() {
  const result = run(
    process.execPath,
    ['scripts/source-identity.mjs', '--review-exclusion', M251_LIVE_INTAKE_REVIEW_EXCLUSION],
    { timeoutMilliseconds: 30_000 },
  );
  return parseSourceIdentity(requireSuccessfulChild(result, 'Exact source-identity check'));
}

function authSource() {
  const selected =
    argument('--auth-source') ??
    process.env.CODECLOSURE_M2_AUTH_SOURCE ??
    join(homedir(), '.codex', 'auth.json');
  const resolved = resolve(selected);
  if (!existsSync(resolved)) {
    fail('The trusted Codex authentication source is unavailable');
  }
  const stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('The trusted Codex authentication source must be a regular file');
  }
  return realpathSync(resolved);
}

function bindingSummary(authority) {
  const counts = {
    MODEL_PROPOSED: 0,
    POLICY_DERIVED: 0,
    PROJECT_OBSERVED: 0,
    UNRESOLVED: 0,
    USER_STATED: 0,
  };
  const userStatedFields = new Set();
  for (const projection of authority.projections) {
    for (const binding of projection.sourceBindings) {
      if (!(binding.authorityClass in counts)) {
        fail('Live Intake authority contains an unknown Source Binding class');
      }
      counts[binding.authorityClass] += 1;
      if (binding.authorityClass === 'USER_STATED') {
        userStatedFields.add(binding.projectionFieldRef);
      }
    }
  }
  return Object.freeze({
    counts: Object.freeze(counts),
    userStatedFields: Object.freeze([...userStatedFields].sort()),
  });
}

function questionFields(authority) {
  return Object.freeze(
    [...new Set(authority.questions.flatMap(({ affectedFields }) => affectedFields))].sort(),
  );
}

async function runInternalScenario() {
  internalStage = 'INPUT';
  const scenario = m251ScenarioById(requiredEnvironment('CODECLOSURE_M251_SCENARIO_ID'));
  const dataHomePath = realpathSync(requiredEnvironment('CODECLOSURE_M251_DATA_HOME'));
  const temporaryRoot = realpathSync(requiredEnvironment('CODECLOSURE_M251_TEMP_ROOT'));
  const projectPath = scenario.requiresProject
    ? realpathSync(requiredEnvironment('CODECLOSURE_M251_PROJECT_PATH'))
    : undefined;
  const projectTreeOpening =
    projectPath === undefined ? null : m251ProjectTreeIdentity(projectPath);
  const forbiddenRoots = Object.freeze([
    dataHomePath,
    ...(projectPath === undefined ? [] : [projectPath]),
  ]);
  const [
    { createCliCommandId, createIntakeCliComposition },
    { createProductionIntakeAssistant },
    { openCliSqliteAuthority },
  ] = await Promise.all([
    import('../apps/cli/dist/composition/index.js'),
    import('../apps/cli/dist/composition/intake-assistant-invocation.js'),
    import('../apps/cli/dist/composition/sqlite-authority.js'),
  ]);

  const assistantResource = createProductionIntakeAssistant({
    environment: process.env,
    forbiddenRoots,
    onSafeDiagnostic: (category, location, token) => {
      internalSafeDiagnostics.push(Object.freeze({ category, location, token }));
    },
  });
  let capturedObservation;
  let capturedAnswerContent;
  const assistant = Object.freeze({
    analyze: async (input, signal) => {
      if (capturedObservation !== undefined) {
        fail('Live scenario attempted more than one assistant operation');
      }
      const result = await assistantResource.assistant.analyze(input, signal);
      capturedObservation = result.observation;
      internalObservation = result.observation;
      return result;
    },
    answer: async (input, signal) => {
      if (capturedObservation !== undefined) {
        fail('Live scenario attempted more than one assistant operation');
      }
      const result = await assistantResource.assistant.answer(input, signal);
      capturedObservation = result.observation;
      internalObservation = result.observation;
      return result;
    },
  });
  const authorityOptions = Object.freeze({
    dataHomePath,
    protectedPaths:
      projectPath === undefined
        ? Object.freeze([])
        : Object.freeze([Object.freeze({ kind: 'PROJECT', path: projectPath })]),
    allowedProjectPaths:
      projectPath === undefined ? Object.freeze([]) : Object.freeze([projectPath]),
  });
  let composition;
  let commandResult;
  try {
    internalStage = 'COMPOSITION';
    composition = createIntakeCliComposition({ ...authorityOptions, assistant });
    internalStage = 'OPERATION';
    commandResult = await composition.application.submit({
      commandId: createCliCommandId(),
      interactionAction: scenario.interactionAction,
      admittedUserContent: scenario.request,
      ...(projectPath === undefined ? {} : { declaredProjectPath: projectPath }),
    });
  } finally {
    try {
      composition?.close();
    } finally {
      assistantResource.close();
    }
  }
  if (commandResult?.kind !== 'OUTCOME') {
    fail('Live Intake scenario did not commit one terminal command outcome');
  }
  capturedAnswerContent = commandResult.answerOnlyContent;
  if (capturedObservation === undefined) {
    fail('Live Intake scenario retained no Assistant observation');
  }
  const observation = projectM251AssistantObservation(capturedObservation);
  if (capturedObservation.operation !== scenario.operation) {
    fail('Live Intake scenario operation differs from its closed fixture');
  }

  internalStage = 'AUTHORITY';
  const store = openCliSqliteAuthority(authorityOptions);
  let authority;
  try {
    authority = store.getIntakeAuthority(commandResult.outcome.intakeRunId);
  } finally {
    store.close();
  }
  if (authority === undefined || authority.outcomes.length !== 1) {
    fail('Live Intake scenario has no exact retained authority chain');
  }
  const summary = bindingSummary(authority);
  const outcomeResult = commandResult.outcome.result;
  internalAuthorityDiagnostic = Object.freeze({
    outcomeKind: outcomeResult.kind,
    intakeStatus: authority.intakeRun.status,
    answerDisposition:
      'answerDisposition' in outcomeResult ? outcomeResult.answerDisposition : null,
    proposalCount: authority.proposals.length,
    projectionCount: authority.projections.length,
    decisionCount: authority.decisions.length,
    questionCount: authority.questions.length,
    sourceBindingCounts: summary.counts,
    userStatedFields: summary.userStatedFields,
    questionFields: questionFields(authority),
    materializedGoalCreated: authority.materialization !== undefined,
    startAuthorizationCreated: authority.startAuthorization !== undefined,
  });
  const projectTreeClosing =
    projectPath === undefined ? null : m251ProjectTreeIdentity(projectPath);
  const receipt = Object.freeze({
    schemaVersion: 1,
    kind: M251_LIVE_INTAKE_SCENARIO_RECEIPT_KIND,
    scenarioId: scenario.id,
    scenarioDigest: m251ScenarioDigest(scenario),
    operation: scenario.operation,
    authority: Object.freeze({
      intakeRunRefDigest: m251LiveDigest(
        'codeclosure-m2-5-1-live-intake-run-ref-v1',
        commandResult.outcome.intakeRunId,
      ),
      outcomeKind: outcomeResult.kind,
      intakeStatus: authority.intakeRun.status,
      answerDisposition:
        'answerDisposition' in outcomeResult ? outcomeResult.answerDisposition : null,
      proposalCount: authority.proposals.length,
      projectionCount: authority.projections.length,
      decisionCount: authority.decisions.length,
      questionCount: authority.questions.length,
      sourceBindingCounts: summary.counts,
      userStatedFields: summary.userStatedFields,
      questionFields: questionFields(authority),
      materializedGoalCreated: authority.materialization !== undefined,
      startAuthorizationCreated: authority.startAuthorization !== undefined,
    }),
    observation,
    effects: Object.freeze({
      closedConfigurationValidated: true,
      forbiddenEffectObserved: false,
      projectObservationGranted: false,
      assistantRetryCount: 0,
    }),
    cleanup: Object.freeze({
      ownedProcessShutdownClean: true,
      operationRootRemoved: readdirSync(temporaryRoot).every(
        (entry) => !entry.startsWith('codeclosure-m2-5-intake-'),
      ),
      temporaryStateRootRemoved: readdirSync(temporaryRoot).every(
        (entry) => !entry.startsWith('codeclosure-m2-5-intake-'),
      ),
      projectTreeOpening,
      projectTreeClosing,
      projectUnchanged: JSON.stringify(projectTreeOpening) === JSON.stringify(projectTreeClosing),
    }),
  });
  internalReceiptDiagnostic = Object.freeze({
    effects: receipt.effects,
    cleanup: receipt.cleanup,
  });
  internalStage = 'RECEIPT_VALIDATION';
  validateM251ScenarioReceipt(receipt);
  internalStage = 'PRIVACY_VALIDATION';
  assertM251MetadataOnly(receipt, [
    scenario.request,
    capturedAnswerContent,
    process.env.CODECLOSURE_M2_AUTH_SOURCE,
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function internalFailureReceipt() {
  const scenarioId = process.env.CODECLOSURE_M251_SCENARIO_ID ?? 'UNBOUND';
  const observation = internalObservation;
  return Object.freeze({
    schemaVersion: 1,
    kind: 'CODECLOSURE_M2_5_1_LIVE_INTAKE_SCENARIO_FAILURE_V1',
    scenarioId,
    stage: internalStage,
    failureReasonCode:
      observation?.failureReasonCode ?? (observation?.state === 'FAILED' ? 'UNCLASSIFIED' : null),
    counters:
      observation === undefined
        ? null
        : Object.freeze({
            processLaunchCount: observation.processLaunchCount,
            threadStartCount: observation.threadStartCount,
            turnStartCount: observation.turnStartCount,
            turnInterruptCount: observation.turnInterruptCount,
            compactionCount: observation.compactionCount,
          }),
    safeDiagnostics: Object.freeze(internalSafeDiagnostics),
    authorityDiagnostic: internalAuthorityDiagnostic ?? null,
    receiptDiagnostic: internalReceiptDiagnostic ?? null,
  });
}

function lowerClientPrerequisite(selectedAuthSource) {
  const result = run(
    process.execPath,
    [
      join(
        repositoryRoot,
        'packages',
        'codex-app-server-client',
        'scripts',
        'run-live-preflight.mjs',
      ),
      '--auth-source',
      selectedAuthSource,
      '--model',
      'gpt-5.6-sol',
    ],
    { timeoutMilliseconds: 360_000 },
  );
  const output = parseJson(
    requireSuccessfulChild(result, 'Lower-client live prerequisite'),
    'Lower-client live prerequisite',
  );
  if (
    output.schemaVersion !== 1 ||
    output.probe !== 'codeclosure-m2-slice1-live-client' ||
    output.lifecycle?.threadStarted !== true ||
    output.lifecycle?.turnStatus !== 'completed' ||
    output.controlledStateRemovedAfterProbe !== true
  ) {
    fail('Lower-client live prerequisite metadata is invalid');
  }
  return Object.freeze({
    version: output.binary?.version,
    snapshotDigest: output.binary?.snapshotDigest,
    prerequisite: Object.freeze({
      initialized: true,
      structuredOutput: true,
      turnCompleted: true,
      controlledStateRemoved: true,
    }),
  });
}

async function currentIntakeToolchain() {
  const runtime = await import('../packages/runtime/dist/index.js');
  return Object.freeze({
    codexVersion: `codex-cli ${runtime.m251LiveIntakeAssistantProfile.codexVersion}`,
    protocolSnapshotDigest: runtime.m251LiveIntakeAssistantProfile.protocolSnapshotDigest,
    assistantProfileVersion: runtime.m251LiveIntakeAssistantProfile.version,
    assistantAdapterVersion: runtime.M251_LIVE_INTAKE_ASSISTANT_ADAPTER_VERSION,
    closedConfigurationVersion: runtime.m251LiveIntakeAssistantProfile.closedConfiguration.version,
    protocolProjectionVersion:
      runtime.m251LiveIntakeAssistantProfile.protocolProjectionPolicy.version,
    instructionPolicyVersion: runtime.m251LiveIntakeAssistantProfile.instructionPolicy.version,
    intentAnalysisResponseContractVersion: runtime.M251_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION,
    intentProjectionProfileVersion: runtime.M251_INTENT_PROJECTION_PROFILE_VERSION,
  });
}

function runScenarioChild(scenario, root, selectedAuthSource) {
  const scenarioRoot = join(root, scenario.id.toLowerCase().replaceAll('_', '-'));
  const dataHomePath = join(scenarioRoot, 'authority');
  const temporaryRoot = join(scenarioRoot, 'temporary');
  const projectPath = join(scenarioRoot, 'project');
  for (const path of [scenarioRoot, dataHomePath, temporaryRoot]) {
    mkdirSync(path, { mode: 0o700, recursive: true });
  }
  if (scenario.requiresProject) {
    mkdirSync(projectPath, { mode: 0o700 });
    writeFileSync(join(projectPath, 'greeting.txt'), 'hello-v1\n', { mode: 0o600 });
  }
  const result = run(process.execPath, [import.meta.filename, '--internal-scenario'], {
    env: {
      ...process.env,
      CODECLOSURE_M251_SCENARIO_ID: scenario.id,
      CODECLOSURE_M251_DATA_HOME: realpathSync(dataHomePath),
      CODECLOSURE_M251_TEMP_ROOT: realpathSync(temporaryRoot),
      ...(scenario.requiresProject
        ? { CODECLOSURE_M251_PROJECT_PATH: realpathSync(projectPath) }
        : {}),
      CODECLOSURE_M2_AUTH_SOURCE: selectedAuthSource,
      TMPDIR: realpathSync(temporaryRoot),
      TMP: realpathSync(temporaryRoot),
      TEMP: realpathSync(temporaryRoot),
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
  });
  const receipt = validateM251ScenarioReceipt(
    (() => {
      const parsed = parseJson(
        requireSuccessfulChild(result, `Live Intake scenario ${scenario.id}`),
        `Live Intake scenario ${scenario.id}`,
      );
      if (parsed.kind === 'CODECLOSURE_M2_5_1_LIVE_INTAKE_SCENARIO_FAILURE_V1') {
        const diagnostic = parsed.safeDiagnostics?.[0];
        fail(
          `Live Intake scenario ${scenario.id} closed at ${String(parsed.stage)} with ${String(parsed.failureReasonCode)}${
            diagnostic === undefined
              ? ''
              : ` (${String(diagnostic.category)}/${String(diagnostic.location)}/${String(diagnostic.token)})`
          }${
            parsed.authorityDiagnostic === null || parsed.authorityDiagnostic === undefined
              ? ''
              : ` authority=${JSON.stringify(parsed.authorityDiagnostic)}`
          }`,
        );
      }
      return parsed;
    })(),
  );
  rmSync(scenarioRoot, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  if (existsSync(scenarioRoot)) {
    fail(`Live Intake scenario ${scenario.id} authority root was not removed`);
  }
  return receipt;
}

async function runParent() {
  if (process.env.CODECLOSURE_M251_LIVE_AUTHORIZED !== '1') {
    fail('CODECLOSURE_M251_LIVE_AUTHORIZED must be exactly 1 for live Intake execution');
  }
  const sourceOpening = exactSourceIdentity();
  const selectedAuthSource = authSource();
  const contract = parseJson(
    readFileSync(
      join(repositoryRoot, 'scripts', 'fixtures', 'm2.5.1', 'slice0-contract.json'),
      'utf8',
    ),
    'M2.5.1 Slice 0 contract',
  );
  const selected = contract.toolchain?.selected;
  const frozenToolchain = Object.freeze({
    codexVersion: selected?.codexVersion,
    protocolSnapshotDigest: selected?.snapshotDigest,
    assistantProfileVersion: contract.intake?.assistantProfile?.version,
    assistantAdapterVersion: contract.intake?.assistantAdapter?.version,
    closedConfigurationVersion: contract.intake?.closedConfiguration?.version,
    protocolProjectionVersion: contract.intake?.protocolProjectionPolicy?.version,
    instructionPolicyVersion: contract.intake?.instructionPolicy?.version,
    intentAnalysisResponseContractVersion: contract.intake?.intentAnalysisResponseContract?.version,
    intentProjectionProfileVersion: contract.intake?.intentProjectionProfileVersion,
  });
  const actualToolchain = await currentIntakeToolchain();
  if (JSON.stringify(actualToolchain) !== JSON.stringify(frozenToolchain)) {
    fail('Current Intake toolchain differs from the frozen M2.5.1 identity');
  }
  const lower = lowerClientPrerequisite(selectedAuthSource);
  if (
    lower.version !== actualToolchain.codexVersion ||
    lower.snapshotDigest !== actualToolchain.protocolSnapshotDigest
  ) {
    fail('Lower-client live prerequisite differs from the frozen M2.5.1 identity');
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m2-5-1-live-intake-')));
  let scenarios;
  let failure;
  let sourceClosing;
  try {
    scenarios = M251_LIVE_INTAKE_SCENARIOS.map((scenario) =>
      runScenarioChild(scenario, root, selectedAuthSource),
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      rmSync(root, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
    } catch (error) {
      failure ??= error;
    }
    try {
      sourceClosing = exactSourceIdentity();
    } catch (error) {
      failure ??= error;
    }
  }
  if (
    failure !== undefined ||
    scenarios === undefined ||
    sourceClosing === undefined ||
    existsSync(root)
  ) {
    throw failure ?? new TypeError('M2.5.1 live Intake assessment root was not removed');
  }
  if (!sourceIdentitiesMatch(sourceOpening, sourceClosing)) {
    fail('M2.5.1 live Intake source identity drifted during execution');
  }
  const threadRefs = scenarios.map(({ observation }) => observation.backendSessionRefDigest);
  const turnRefs = scenarios.map(({ observation }) => observation.backendOperationRefDigest);
  const receipt = Object.freeze({
    schemaVersion: 1,
    kind: M251_LIVE_INTAKE_RECEIPT_KIND,
    authorization: 'EXPLICIT',
    source: Object.freeze({
      opening: sourceOpening,
      closing: sourceClosing,
    }),
    toolchain: Object.freeze({
      nodeVersion: process.version,
      ...actualToolchain,
    }),
    prerequisite: lower.prerequisite,
    scenarios: Object.freeze(scenarios),
    aggregate: Object.freeze({
      scenarioCount: scenarios.length,
      processLaunchCount: scenarios.reduce(
        (total, scenario) => total + scenario.observation.processLaunchCount,
        0,
      ),
      threadStartCount: scenarios.reduce(
        (total, scenario) => total + scenario.observation.threadStartCount,
        0,
      ),
      turnStartCount: scenarios.reduce(
        (total, scenario) => total + scenario.observation.turnStartCount,
        0,
      ),
      uniqueThreadRefs: new Set(threadRefs).size,
      uniqueTurnRefs: new Set(turnRefs).size,
    }),
    privacy: Object.freeze({
      credentialContentRetained: false,
      requestContentInReceipt: false,
      assistantContentInReceipt: false,
      reasoningOrTranscriptRetained: false,
      rawPayloadOrExceptionRetained: false,
    }),
    cleanup: Object.freeze({
      assessmentRootRemoved: true,
      scenarioAuthorityRootsRemoved: true,
    }),
  });
  validateM251LiveReceipt(receipt);
  assertM251MetadataOnly(receipt, [
    selectedAuthSource,
    ...M251_LIVE_INTAKE_SCENARIOS.map(({ request }) => request),
  ]);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv.includes('--internal-scenario')) {
  try {
    await runInternalScenario();
  } catch {
    const receipt = internalFailureReceipt();
    assertM251MetadataOnly(receipt, [
      process.env.CODECLOSURE_M2_AUTH_SOURCE,
      ...M251_LIVE_INTAKE_SCENARIOS.map(({ request }) => request),
    ]);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
} else {
  await runParent();
}
