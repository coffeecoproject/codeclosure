import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  M2AcceptanceOutcome,
  M2AcceptanceStage,
  M2_CURRENT_SOURCE_REGRESSION_EXCLUDED_ROWS,
  M2_CURRENT_SOURCE_REGRESSION_NON_CLAIMS,
  acceptanceVerdict,
  buildM2CurrentSourceRegressionMatrixResults,
  buildMatrixResults,
  parseAcceptanceMatrix,
  parseNodeTestSummaries,
  parseSourceIdentity,
  sha256Text,
  sourceIdentitiesMatch,
  validateLivePreflight,
  validateM2DemoEnvelope,
  validateM2CurrentSourceRegressionScope,
  validateM2ScopeReview,
} from './m2-acceptance-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const acceptancePlanPath = join(repositoryRoot, 'docs', 'plans', 'm2-acceptance-plan.md');
const cliEntryPoint = join(repositoryRoot, 'apps', 'cli', 'dist', 'index.js');
const defaultReviewExclusion = 'docs/reviews/m2-completion-review.md';
const currentMilestoneReviewExclusion = 'docs/reviews/m2.5-completion-review.md';
const m251MilestoneReviewExclusion = 'docs/reviews/m2.5.1-completion-review.md';
const invocationArguments = process.argv.slice(2);
if (
  invocationArguments.length > 1 ||
  (invocationArguments.length === 1 && invocationArguments[0] !== '--regression')
) {
  throw new TypeError('run-m2-acceptance accepts only the optional --regression argument');
}
const currentSourceRegression = invocationArguments[0] === '--regression';
const expectedPnpmVersion = '11.1.3';
const expectedCodexVersion = currentSourceRegression ? 'codex-cli 0.146.1' : 'codex-cli 0.146.0';
const maximumOutputBytes = 128 * 1024 * 1024;
const stages = [];
let openingSourceIdentity;
let closingSourceIdentity;
let protocolIdentity;
let environmentIdentity;

function log(message) {
  process.stderr.write(`[${currentSourceRegression ? 'regress:m2' : 'accept:m2'}] ${message}\n`);
}

function outcomeRank(outcome) {
  return outcome === M2AcceptanceOutcome.FAIL ? 2 : outcome === M2AcceptanceOutcome.BLOCKED ? 1 : 0;
}

function addStage(stage) {
  const existingIndex = stages.findIndex(({ id }) => id === stage.id);
  if (existingIndex === -1) {
    stages.push(Object.freeze(stage));
  } else if (outcomeRank(stage.outcome) > outcomeRank(stages[existingIndex].outcome)) {
    stages[existingIndex] = Object.freeze(stage);
  }
  log(
    `${stage.outcome} ${stage.id}${stage.reasonCode === undefined ? '' : ` (${stage.reasonCode})`}`,
  );
}

function sanitizedCommand(executable, arguments_, sensitiveValues = []) {
  return [executable, ...arguments_]
    .map((part) => (sensitiveValues.includes(part) ? '<REDACTED_AUTH_SOURCE>' : String(part)))
    .join(' ');
}

function sanitizedDiagnostic(value, sensitiveValues = []) {
  let result = value;
  for (const sensitive of sensitiveValues) {
    if (sensitive.length !== 0) {
      result = result.replaceAll(sensitive, '<REDACTED_AUTH_SOURCE>');
    }
  }
  const limit = 64 * 1024;
  return result.length <= limit ? result : `${result.slice(0, limit)}\n<diagnostic truncated>`;
}

function runCommand({
  id,
  executable,
  arguments_: arguments_ = [],
  cwd = repositoryRoot,
  environment = {},
  timeoutMilliseconds,
  sensitiveValues = [],
  echoOutput = true,
}) {
  const command = sanitizedCommand(executable, arguments_, sensitiveValues);
  log(`RUN ${id}: ${command}`);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(executable, arguments_, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      ...environment,
    },
    maxBuffer: maximumOutputBytes,
    timeout: timeoutMilliseconds,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (echoOutput) {
    const diagnostic = sanitizedDiagnostic(`${stdout}${stderr}`, sensitiveValues).trim();
    if (diagnostic.length !== 0) {
      process.stderr.write(`${diagnostic}\n`);
    }
  }
  return Object.freeze({
    command,
    startedAt,
    durationMilliseconds: Date.now() - started,
    exitCode: result.status,
    signal: result.signal,
    error: result.error,
    stdout,
    stderr,
    outputDigest: sha256Text(`${stdout}\0${stderr}`),
  });
}

function commandFailureReason(result) {
  if (result.error !== undefined) {
    return result.error.code === 'ETIMEDOUT' ? 'COMMAND_TIMEOUT' : 'COMMAND_START_FAILED';
  }
  if (result.signal !== null) return 'COMMAND_SIGNALLED';
  return `COMMAND_EXIT_${String(result.exitCode)}`;
}

function passCommandStage(id, result, evidence = {}, testSummaries = []) {
  addStage({
    id,
    outcome: M2AcceptanceOutcome.PASS,
    command: result.command,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    durationMilliseconds: result.durationMilliseconds,
    outputDigest: result.outputDigest,
    testSummaries,
    evidence,
  });
}

function failCommandStage(id, result, reasonCode = commandFailureReason(result), details) {
  addStage({
    id,
    outcome: M2AcceptanceOutcome.FAIL,
    command: result.command,
    exitCode: result.exitCode,
    signal: result.signal,
    startedAt: result.startedAt,
    durationMilliseconds: result.durationMilliseconds,
    outputDigest: result.outputDigest,
    reasonCode,
    ...(details === undefined ? {} : { details }),
  });
}

function blockStage(id, reasonCode, details) {
  addStage({
    id,
    outcome: M2AcceptanceOutcome.BLOCKED,
    reasonCode,
    ...(details === undefined ? {} : { details }),
  });
}

function stagePassed(identifier) {
  return stages.find(({ id }) => id === identifier)?.outcome === M2AcceptanceOutcome.PASS;
}

function parseJsonDocument(output, name) {
  const value = JSON.parse(output.trim());
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be one JSON object`);
  }
  return value;
}

function git(arguments_) {
  const result = runCommand({
    id: `git-${arguments_[0] ?? 'command'}`,
    executable: 'git',
    arguments_,
    timeoutMilliseconds: 30_000,
    echoOutput: false,
  });
  if (result.error !== undefined || result.signal !== null || result.exitCode !== 0) {
    throw new TypeError(`Git command failed: ${result.command}`);
  }
  return result.stdout;
}

function selectedReviewExclusion() {
  const configured = process.env['CODECLOSURE_M2_REVIEW_EXCLUSION'];
  const value =
    configured ??
    (currentSourceRegression ? currentMilestoneReviewExclusion : defaultReviewExclusion);
  if (!/^docs\/reviews\/[a-z0-9][a-z0-9.-]*\.md$/u.test(value)) {
    throw new TypeError('CODECLOSURE_M2_REVIEW_EXCLUSION is not a portable review path');
  }
  if (
    currentSourceRegression &&
    ![currentMilestoneReviewExclusion, m251MilestoneReviewExclusion].includes(value)
  ) {
    throw new TypeError(
      'M2 current-source regression requires a closed enclosing-milestone review exclusion',
    );
  }
  return value;
}

function validateEntryConditions() {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    if (realpathSync(process.cwd()) !== realpathSync(repositoryRoot)) {
      throw new TypeError('The repository root must be the current working directory');
    }
    const nodeMatch = /^v22\.(\d+)\.(\d+)$/u.exec(process.version);
    if (nodeMatch === null || Number(nodeMatch[1]) < 22) {
      throw new TypeError(`Unsupported Node version: ${process.version}`);
    }
    const manifest = parseJsonDocument(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
      'package.json',
    );
    if (
      manifest.packageManager !== `pnpm@${expectedPnpmVersion}` ||
      manifest.engines?.pnpm !== expectedPnpmVersion
    ) {
      throw new TypeError('The root pnpm declaration differs from the M2 toolchain');
    }
    if (
      !existsSync(join(repositoryRoot, 'pnpm-lock.yaml')) ||
      !existsSync(join(repositoryRoot, 'node_modules'))
    ) {
      throw new TypeError('The lockfile or installed dependency tree is unavailable');
    }
    const pnpm = runCommand({
      id: 'pnpm-version',
      executable: 'corepack',
      arguments_: ['pnpm', '--version'],
      timeoutMilliseconds: 30_000,
      echoOutput: false,
    });
    if (pnpm.error !== undefined || pnpm.signal !== null || pnpm.exitCode !== 0) {
      throw new TypeError('Corepack pnpm is unavailable');
    }
    const pnpmVersion = pnpm.stdout.trim();
    if (pnpmVersion !== expectedPnpmVersion) {
      throw new TypeError(`Unsupported pnpm version: ${pnpmVersion}`);
    }
    if (process.platform !== 'darwin') {
      blockStage(M2AcceptanceStage.ENTRY, 'UNSUPPORTED_M2_PLATFORM', {
        platform: process.platform,
        architecture: process.arch,
      });
      return;
    }
    const liveAuthorization = process.env['CODECLOSURE_M2_LIVE_AUTHORIZED'];
    if (liveAuthorization !== undefined && liveAuthorization !== '1') {
      throw new TypeError('CODECLOSURE_M2_LIVE_AUTHORIZED must be exactly 1 when present');
    }
    const root = realpathSync(git(['rev-parse', '--show-toplevel']).trim());
    if (root !== realpathSync(repositoryRoot)) {
      throw new TypeError('Git repository identity differs from the acceptance root');
    }
    environmentIdentity = Object.freeze({
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      node: process.version,
      pnpm: pnpmVersion,
      branch: git(['branch', '--show-current']).trim(),
      baseGitRevision: git(['rev-parse', 'HEAD']).trim(),
      gitStatusDigest: sha256Text(git(['status', '--porcelain=v1', '-z'])),
      requestedModel: process.env['CODECLOSURE_M2_MODEL'] ?? 'gpt-5.6-sol',
      requestedProvider: 'openai',
      liveAuthorization: liveAuthorization === '1' ? 'EXPLICIT' : 'ABSENT',
      reviewExclusion: selectedReviewExclusion(),
    });
    addStage({
      id: M2AcceptanceStage.ENTRY,
      outcome: M2AcceptanceOutcome.PASS,
      startedAt,
      durationMilliseconds: Date.now() - started,
      evidence: environmentIdentity,
    });
  } catch (error) {
    addStage({
      id: M2AcceptanceStage.ENTRY,
      outcome: M2AcceptanceOutcome.FAIL,
      startedAt,
      durationMilliseconds: Date.now() - started,
      reasonCode: 'ENTRY_CONDITION_INVALID',
      details: error instanceof Error ? error.message : 'Unknown entry-condition failure',
    });
  }
}

function runSourceIdentity(id) {
  let reviewExclusion;
  try {
    reviewExclusion = selectedReviewExclusion();
  } catch (error) {
    addStage({
      id,
      outcome: M2AcceptanceOutcome.FAIL,
      reasonCode: 'SOURCE_IDENTITY_CONFIGURATION_INVALID',
      details: error instanceof Error ? error.message : 'Invalid source identity configuration',
    });
    return undefined;
  }
  const result = runCommand({
    id,
    executable: process.execPath,
    arguments_: [
      join(repositoryRoot, 'scripts', 'source-identity.mjs'),
      '--review-exclusion',
      reviewExclusion,
    ],
    timeoutMilliseconds: 60_000,
  });
  if (result.error !== undefined || result.signal !== null || result.exitCode !== 0) {
    failCommandStage(id, result);
    return undefined;
  }
  try {
    const identity = parseSourceIdentity(result.stdout);
    passCommandStage(id, result, identity);
    return identity;
  } catch (error) {
    failCommandStage(
      id,
      result,
      'SOURCE_IDENTITY_INVALID',
      error instanceof Error ? error.message : undefined,
    );
    return undefined;
  }
}

function runProtocolSnapshot() {
  const id = M2AcceptanceStage.PROTOCOL;
  const result = runCommand({
    id,
    executable: process.execPath,
    arguments_: [join(repositoryRoot, 'scripts', 'run-m2-slice1-protocol-snapshot.mjs')],
    timeoutMilliseconds: 240_000,
  });
  if (result.error !== undefined || result.signal !== null || result.exitCode !== 0) {
    failCommandStage(id, result);
    return;
  }
  try {
    const value = parseJsonDocument(result.stdout, 'M2 protocol snapshot result');
    if (
      value.mode !== 'CHECK' ||
      value.codex?.version !== expectedCodexVersion ||
      typeof value.snapshotDigest !== 'string' ||
      typeof value.typescript?.digest !== 'string' ||
      typeof value.jsonSchema?.digest !== 'string'
    ) {
      throw new TypeError('The protocol snapshot result differs from the pinned M2 profile');
    }
    protocolIdentity = Object.freeze({
      codex: value.codex,
      snapshotDigest: value.snapshotDigest,
      rawTypescriptDigest: value.typescript.digest,
      rawTypescriptFileCount: value.typescript.fileCount,
      canonicalJsonDigest: value.jsonSchema.digest,
      canonicalJsonFileCount: value.jsonSchema.fileCount,
      normalizationProfile: 'RFC8785_JSON',
    });
    passCommandStage(id, result, protocolIdentity);
  } catch (error) {
    failCommandStage(
      id,
      result,
      'PROTOCOL_IDENTITY_INVALID',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function runQualityGate() {
  const id = M2AcceptanceStage.QUALITY;
  const result = runCommand({
    id,
    executable: 'corepack',
    arguments_: ['pnpm', 'gate:quality'],
    timeoutMilliseconds: 1_800_000,
  });
  if (result.error !== undefined || result.signal !== null || result.exitCode !== 0) {
    failCommandStage(id, result);
    return;
  }
  try {
    const summaries = parseNodeTestSummaries(result.stdout);
    if (summaries.length < 10) {
      throw new TypeError('The complete quality gate emitted too few no-skip stage summaries');
    }
    const aggregate = summaries.reduce(
      (total, summary) => ({
        tests: total.tests + summary.tests,
        pass: total.pass + summary.pass,
        fail: total.fail + summary.fail,
        cancelled: total.cancelled + summary.cancelled,
        skipped: total.skipped + summary.skipped,
        todo: total.todo + summary.todo,
      }),
      { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 },
    );
    passCommandStage(id, result, { aggregate, summaryCount: summaries.length }, summaries);
  } catch (error) {
    failCommandStage(
      id,
      result,
      'QUALITY_EVIDENCE_INVALID',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function runM1BlackBox() {
  const id = M2AcceptanceStage.M1_BLACK_BOX;
  const result = runCommand({
    id,
    executable: process.execPath,
    arguments_: [join(repositoryRoot, 'scripts', 'run-m1-acceptance.mjs')],
    timeoutMilliseconds: 240_000,
  });
  if (result.error !== undefined || result.signal !== null || result.exitCode !== 0) {
    failCommandStage(id, result);
    return;
  }
  const passLines = result.stdout.match(/^PASS M1-[^\n]+$/gmu) ?? [];
  if (
    passLines.length !== 8 ||
    !result.stdout.includes('M1 independent black-box acceptance: 8/8 passed')
  ) {
    failCommandStage(id, result, 'M1_BLACK_BOX_EVIDENCE_INVALID');
    return;
  }
  passCommandStage(id, result, { passedCases: 8, expectedCases: 8 });
}

function runDemo(id, scenario, environment = {}, sensitiveValues = []) {
  const invocationRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m2-acceptance-demo-'));
  const ordinaryAuthorityHome = join(invocationRoot, 'ordinary-authority-must-remain-absent');
  try {
    const result = runCommand({
      id,
      executable: process.execPath,
      arguments_: [cliEntryPoint, 'demo', 'run', scenario, '--json'],
      cwd: invocationRoot,
      environment: { CODECLOSURE_HOME: ordinaryAuthorityHome, ...environment },
      timeoutMilliseconds: scenario.startsWith('m2-live') ? 720_000 : 240_000,
      sensitiveValues,
      echoOutput: false,
    });
    if (result.error !== undefined || result.signal !== null) {
      failCommandStage(id, result);
      return;
    }
    let validated;
    try {
      validated = validateM2DemoEnvelope(parseJsonDocument(result.stdout, scenario), scenario);
    } catch (error) {
      failCommandStage(
        id,
        result,
        'DEMO_PROOF_INVALID',
        error instanceof Error ? error.message : undefined,
      );
      return;
    }
    if (existsSync(ordinaryAuthorityHome)) {
      failCommandStage(id, result, 'ORDINARY_AUTHORITY_HOME_WAS_OPENED');
      return;
    }
    if (validated.outcome === M2AcceptanceOutcome.PASS) {
      if (result.exitCode !== 0) {
        failCommandStage(id, result, 'DEMO_EXIT_MISMATCH');
        return;
      }
      passCommandStage(id, result, validated.proof);
      return;
    }
    if (validated.outcome === M2AcceptanceOutcome.BLOCKED) {
      addStage({
        id,
        outcome: M2AcceptanceOutcome.BLOCKED,
        command: result.command,
        exitCode: result.exitCode,
        startedAt: result.startedAt,
        durationMilliseconds: result.durationMilliseconds,
        outputDigest: result.outputDigest,
        reasonCode: validated.reasonCode,
      });
      return;
    }
    failCommandStage(id, result, validated.reasonCode);
  } finally {
    rmSync(invocationRoot, { force: true, recursive: true });
  }
}

function productSourceSet() {
  const paths = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(
      (path) =>
        existsSync(join(repositoryRoot, path)) &&
        (path.startsWith('apps/') || path.startsWith('packages/')) &&
        path.includes('/src/') &&
        path.endsWith('.ts'),
    );
  return Object.freeze(
    paths.map((path) =>
      Object.freeze({ path, text: readFileSync(join(repositoryRoot, path), 'utf8') }),
    ),
  );
}

function runScopeReview() {
  const id = M2AcceptanceStage.SCOPE_REVIEW;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const read = (path) => readFileSync(join(repositoryRoot, path), 'utf8');
    const documents = {
      agents: read('AGENTS.md'),
      readme: read('README.md'),
      m2CompletionReview: read('docs/reviews/m2-completion-review.md'),
      architecture: read('ARCHITECTURE.md'),
      domainModel: read('docs/domain-model.md'),
      workflow: read('docs/workflow.md'),
      contextCompiler: read('docs/context-compiler.md'),
      acceptanceEngine: read('docs/acceptance-engine.md'),
      evidenceModel: read('docs/evidence-model.md'),
      adrIndex: read('docs/adr/README.md'),
      milestones: read('docs/milestones.md'),
      implementationPlan: read('docs/plans/m2-codex-vertical-slice.md'),
      acceptancePlan: read('docs/plans/m2-acceptance-plan.md'),
      goalIntake: read('docs/goal-intake.md'),
      m25ImplementationPlan: read('docs/plans/m2.5-goal-intake-materialization.md'),
      m25AcceptancePlan: read('docs/plans/m2.5-acceptance-plan.md'),
    };
    const evidence = currentSourceRegression
      ? validateM2CurrentSourceRegressionScope(documents, productSourceSet())
      : validateM2ScopeReview(documents, productSourceSet());
    addStage({
      id,
      outcome: M2AcceptanceOutcome.PASS,
      startedAt,
      durationMilliseconds: Date.now() - started,
      outputDigest: sha256Text(JSON.stringify(evidence)),
      evidence,
    });
  } catch (error) {
    addStage({
      id,
      outcome: M2AcceptanceOutcome.FAIL,
      startedAt,
      durationMilliseconds: Date.now() - started,
      reasonCode: 'M2_SCOPE_REVIEW_FAILED',
      details: error instanceof Error ? error.message : 'Unknown M2 scope-review failure',
    });
  }
}

function localAuthSource() {
  const configured = process.env['CODECLOSURE_M2_AUTH_SOURCE'];
  const selected = configured ?? join(homedir(), '.codex', 'auth.json');
  if (!existsSync(selected) || !lstatSync(selected).isFile()) {
    return undefined;
  }
  return realpathSync(selected);
}

function runLivePreflight(authSource) {
  const id = M2AcceptanceStage.LIVE_PREFLIGHT;
  const model = environmentIdentity.requestedModel;
  const result = runCommand({
    id,
    executable: process.execPath,
    arguments_: [
      join(
        repositoryRoot,
        'packages',
        'codex-app-server-client',
        'scripts',
        'run-live-preflight.mjs',
      ),
      '--auth-source',
      authSource,
      '--model',
      model,
    ],
    timeoutMilliseconds: 360_000,
    sensitiveValues: [authSource],
    echoOutput: false,
  });
  if (result.error !== undefined || result.signal !== null || result.exitCode !== 0) {
    addStage({
      id,
      outcome: M2AcceptanceOutcome.BLOCKED,
      command: result.command,
      exitCode: result.exitCode,
      signal: result.signal,
      startedAt: result.startedAt,
      durationMilliseconds: result.durationMilliseconds,
      outputDigest: result.outputDigest,
      reasonCode: commandFailureReason(result),
    });
    return;
  }
  try {
    const evidence = validateLivePreflight(
      parseJsonDocument(result.stdout, 'M2 live compatibility preflight'),
    );
    if (
      evidence.version !== expectedCodexVersion ||
      evidence.snapshotDigest !== protocolIdentity.snapshotDigest
    ) {
      throw new TypeError('Live preflight identity differs from the opening protocol identity');
    }
    passCommandStage(id, result, evidence);
  } catch (error) {
    failCommandStage(
      id,
      result,
      'LIVE_PREFLIGHT_EVIDENCE_INVALID',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function offlineStagesPassed() {
  return [
    M2AcceptanceStage.ENTRY,
    M2AcceptanceStage.SOURCE_OPENING,
    M2AcceptanceStage.PROTOCOL,
    M2AcceptanceStage.QUALITY,
    M2AcceptanceStage.M1_BLACK_BOX,
    M2AcceptanceStage.SCOPE_REVIEW,
    M2AcceptanceStage.PROTECTED_REPAIR,
    M2AcceptanceStage.FAILED_REPAIR,
    M2AcceptanceStage.ADAPTER_FAILURE,
  ].every(stagePassed);
}

function runDeterministicStages() {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m2-acceptance-offline-'));
  try {
    const authSource = join(root, 'non-secret-empty-auth.json');
    writeFileSync(authSource, '{}\n', { mode: 0o600 });
    runM1BlackBox();
    runDemo(M2AcceptanceStage.PROTECTED_REPAIR, 'm2-protected-repair');
    runDemo(M2AcceptanceStage.FAILED_REPAIR, 'm2-protected-failed-repair');
    runDemo(
      M2AcceptanceStage.ADAPTER_FAILURE,
      'm2-adapter-failure',
      { CODECLOSURE_M2_AUTH_SOURCE: authSource },
      [authSource],
    );
    runScopeReview();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function recordUnrunLive(reasonCode) {
  for (const id of [
    M2AcceptanceStage.LIVE_PREFLIGHT,
    M2AcceptanceStage.LIVE_REPAIR_HANDOFF,
    M2AcceptanceStage.LIVE_NATURAL,
  ]) {
    blockStage(id, reasonCode);
  }
}

function runLiveStages() {
  if (!offlineStagesPassed()) {
    recordUnrunLive('OFFLINE_ENTRY_NOT_SATISFIED');
    return;
  }
  if (environmentIdentity.liveAuthorization !== 'EXPLICIT') {
    recordUnrunLive('LIVE_AUTHORIZATION_REQUIRED');
    return;
  }
  const authSource = localAuthSource();
  if (authSource === undefined) {
    recordUnrunLive('AUTH_UNAVAILABLE');
    return;
  }
  runLivePreflight(authSource);
  if (!stagePassed(M2AcceptanceStage.LIVE_PREFLIGHT)) {
    blockStage(M2AcceptanceStage.LIVE_REPAIR_HANDOFF, 'LIVE_PREFLIGHT_UNAVAILABLE');
    blockStage(M2AcceptanceStage.LIVE_NATURAL, 'LIVE_PREFLIGHT_UNAVAILABLE');
    return;
  }
  const environment = {
    CODECLOSURE_M2_AUTH_SOURCE: authSource,
    CODECLOSURE_M2_MODEL: environmentIdentity.requestedModel,
  };
  runDemo(M2AcceptanceStage.LIVE_REPAIR_HANDOFF, 'm2-live-repair-handoff', environment, [
    authSource,
  ]);
  runDemo(M2AcceptanceStage.LIVE_NATURAL, 'm2-live', environment, [authSource]);
}

function closeSourceIdentity() {
  closingSourceIdentity = runSourceIdentity(M2AcceptanceStage.SOURCE_CLOSING);
  if (
    openingSourceIdentity !== undefined &&
    closingSourceIdentity !== undefined &&
    !sourceIdentitiesMatch(openingSourceIdentity, closingSourceIdentity)
  ) {
    addStage({
      id: M2AcceptanceStage.SOURCE_CLOSING,
      outcome: M2AcceptanceOutcome.FAIL,
      reasonCode: 'SOURCE_IDENTITY_CHANGED',
      evidence: { opening: openingSourceIdentity, closing: closingSourceIdentity },
    });
  }
}

function aggregateTests() {
  const summaries = stages.flatMap((stage) => stage.testSummaries ?? []);
  return Object.freeze(
    summaries.reduce(
      (total, summary) => ({
        summaryCount: total.summaryCount + 1,
        tests: total.tests + summary.tests,
        pass: total.pass + summary.pass,
        fail: total.fail + summary.fail,
        cancelled: total.cancelled + summary.cancelled,
        skipped: total.skipped + summary.skipped,
        todo: total.todo + summary.todo,
      }),
      { summaryCount: 0, tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 },
    ),
  );
}

function finalResult() {
  let matrixRows;
  try {
    matrixRows = parseAcceptanceMatrix(readFileSync(acceptancePlanPath, 'utf8'));
  } catch (error) {
    addStage({
      id: M2AcceptanceStage.SCOPE_REVIEW,
      outcome: M2AcceptanceOutcome.FAIL,
      reasonCode: 'ACCEPTANCE_MATRIX_INVALID',
      details: error instanceof Error ? error.message : 'Unknown acceptance-matrix failure',
    });
    matrixRows = Object.freeze([]);
  }
  const matrix =
    matrixRows.length === 0
      ? Object.freeze([])
      : currentSourceRegression
        ? buildM2CurrentSourceRegressionMatrixResults(matrixRows, stages)
        : buildMatrixResults(matrixRows, stages);
  const verdict = matrix.length === 0 ? M2AcceptanceOutcome.FAIL : acceptanceVerdict(matrix);
  const rowCounts = Object.freeze({
    total: matrix.length,
    pass: matrix.filter(({ outcome }) => outcome === M2AcceptanceOutcome.PASS).length,
    fail: matrix.filter(({ outcome }) => outcome === M2AcceptanceOutcome.FAIL).length,
    blocked: matrix.filter(({ outcome }) => outcome === M2AcceptanceOutcome.BLOCKED).length,
  });
  const common = {
    schemaVersion: 1,
    verdict,
    sourceIdentity: Object.freeze({
      opening: openingSourceIdentity ?? null,
      closing: closingSourceIdentity ?? null,
      matched:
        openingSourceIdentity !== undefined &&
        closingSourceIdentity !== undefined &&
        sourceIdentitiesMatch(openingSourceIdentity, closingSourceIdentity),
    }),
    environment: environmentIdentity ?? null,
    protocol: protocolIdentity ?? null,
    stages: Object.freeze(stages),
    tests: aggregateTests(),
    matrix,
    rowCounts,
    failedChecks: Object.freeze(
      matrix.filter(({ outcome }) => outcome === M2AcceptanceOutcome.FAIL).map(({ id }) => id),
    ),
    unavailableChecks: Object.freeze(
      matrix.filter(({ outcome }) => outcome === M2AcceptanceOutcome.BLOCKED).map(({ id }) => id),
    ),
  };
  if (currentSourceRegression) {
    return Object.freeze({
      ...common,
      kind: 'M2_CURRENT_SOURCE_REGRESSION_EXECUTION',
      claimScope: 'CURRENT_SOURCE_M2_REGRESSION_BASELINE',
      canonicalCommand: 'corepack pnpm regress:m2',
      excludedHistoricalMilestoneRows: M2_CURRENT_SOURCE_REGRESSION_EXCLUDED_ROWS,
      nonClaims: M2_CURRENT_SOURCE_REGRESSION_NON_CLAIMS,
      historicalM2MilestoneVerdictReissued: false,
      milestoneStatusMutationAuthorized: false,
      datedIndependentReviewRequired: false,
    });
  }
  return Object.freeze({
    ...common,
    kind: 'M2_MILESTONE_ACCEPTANCE_EXECUTION',
    claimScope: 'CANONICAL_EXECUTABLE_PROCEDURE',
    canonicalCommand: 'corepack pnpm accept:m2',
    nonClaims: Object.freeze([
      'NOT_A_TECHNICAL_ACCEPTANCE_DECISION',
      'NOT_GOAL_INTAKE_OR_GOAL_MATERIALIZATION',
      'NOT_AUTOMATIC_MULTI_ROUND_REPAIR',
      'NOT_ARBITRARY_PROJECT_VALIDATION_COMPLETENESS',
      'NOT_PRODUCT_COMPLETION',
      'NOT_CANDIDATE_PROMOTION_OR_EXTERNAL_EFFECT_AUTHORITY',
    ]),
    milestoneStatusMutationAuthorized: false,
    datedIndependentReviewRequired: true,
  });
}

validateEntryConditions();
try {
  if (stagePassed(M2AcceptanceStage.ENTRY)) {
    openingSourceIdentity = runSourceIdentity(M2AcceptanceStage.SOURCE_OPENING);
  } else {
    blockStage(M2AcceptanceStage.SOURCE_OPENING, 'ENTRY_CONDITIONS_NOT_SATISFIED');
  }
  if (stagePassed(M2AcceptanceStage.SOURCE_OPENING)) {
    runProtocolSnapshot();
  } else {
    blockStage(M2AcceptanceStage.PROTOCOL, 'OPENING_SOURCE_IDENTITY_UNAVAILABLE');
  }
  if (stagePassed(M2AcceptanceStage.PROTOCOL)) {
    runQualityGate();
  } else {
    blockStage(M2AcceptanceStage.QUALITY, 'PROTOCOL_IDENTITY_UNAVAILABLE');
  }
  if (stagePassed(M2AcceptanceStage.QUALITY)) {
    runDeterministicStages();
  } else {
    for (const id of [
      M2AcceptanceStage.M1_BLACK_BOX,
      M2AcceptanceStage.PROTECTED_REPAIR,
      M2AcceptanceStage.FAILED_REPAIR,
      M2AcceptanceStage.ADAPTER_FAILURE,
      M2AcceptanceStage.SCOPE_REVIEW,
    ]) {
      blockStage(id, 'QUALITY_GATE_NOT_SATISFIED');
    }
  }
  runLiveStages();
} catch (error) {
  addStage({
    id: M2AcceptanceStage.SCOPE_REVIEW,
    outcome: M2AcceptanceOutcome.FAIL,
    reasonCode: 'ACCEPTANCE_HARNESS_FAILURE',
    details: error instanceof Error ? error.message : 'Unknown acceptance harness failure',
  });
} finally {
  closeSourceIdentity();
}

const result = finalResult();
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode =
  result.verdict === M2AcceptanceOutcome.PASS
    ? 0
    : result.verdict === M2AcceptanceOutcome.BLOCKED
      ? 2
      : 1;
