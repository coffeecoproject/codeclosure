import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

export const M251_LIVE_INTAKE_RECEIPT_KIND = 'CODECLOSURE_M2_5_1_LIVE_INTAKE_COMPATIBILITY_V1';
export const M251_LIVE_INTAKE_SCENARIO_RECEIPT_KIND = 'CODECLOSURE_M2_5_1_LIVE_INTAKE_SCENARIO_V1';
export const M251_LIVE_INTAKE_REVIEW_EXCLUSION =
  'docs/reviews/m2.5.1-slice2-real-intake-compatibility.md';
export const M251_PROJECT_TREE_MANIFEST_SCHEMA = 'codeclosure-m2-5-1-project-tree-v1';

export const M251_LIVE_INTAKE_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'ANSWER_ONLY',
    operation: 'ANSWER_ONLY',
    interactionAction: 'ANSWER_ONLY',
    request:
      'Explain in one sentence why an idempotency key prevents duplicate payment processing.',
    requiresProject: false,
    requiredUserStatedFields: Object.freeze([]),
    requiredQuestionFields: Object.freeze([]),
  }),
  Object.freeze({
    id: 'CLEAR_INTENT',
    operation: 'INTENT_ANALYSIS',
    interactionAction: 'MATERIALIZE_ONLY',
    request: [
      'Objective: Change greeting.txt content to hello-v2.',
      'Required criterion: greeting.txt content equals hello-v2.',
      'Scope: Only greeting.txt may change.',
    ].join('\n'),
    requiresProject: true,
    requiredUserStatedFields: Object.freeze(['OBJECTIVE', 'REQUIRED_CRITERION', 'SCOPE']),
    requiredQuestionFields: Object.freeze(['SCOPE']),
  }),
  Object.freeze({
    id: 'AMBIGUOUS_INTENT',
    operation: 'INTENT_ANALYSIS',
    interactionAction: 'MATERIALIZE_ONLY',
    request: [
      'Objective: Change greeting.txt content.',
      'Scope: Only greeting.txt may change.',
    ].join('\n'),
    requiresProject: true,
    requiredUserStatedFields: Object.freeze(['OBJECTIVE', 'SCOPE']),
    requiredQuestionFields: Object.freeze(['REQUIRED_CRITERION']),
  }),
]);

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const bindingClasses = Object.freeze([
  'MODEL_PROPOSED',
  'POLICY_DERIVED',
  'PROJECT_OBSERVED',
  'UNRESOLVED',
  'USER_STATED',
]);

function sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(object(value, label)).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    fail(`${label} has unknown or missing fields`);
  }
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 4_096) {
    fail(`${label} must be a bounded string`);
  }
  return value;
}

function digest(value, label) {
  const selected = string(value, label);
  if (!digestPattern.test(selected)) {
    fail(`${label} must be a SHA-256 digest`);
  }
  return selected;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') {
    fail(`${label} must be boolean`);
  }
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    fail(`${label} must be a string array`);
  }
  if (
    new Set(value).size !== value.length ||
    JSON.stringify(value) !== JSON.stringify([...value].sort())
  ) {
    fail(`${label} must be unique and sorted`);
  }
  return value;
}

export function m251LiveDigest(profile, value) {
  return `sha256:${createHash('sha256')
    .update(`${profile}\0${JSON.stringify(value)}`, 'utf8')
    .digest('hex')}`;
}

export function m251ScenarioDigest(scenario) {
  return m251LiveDigest('codeclosure-m2-5-1-live-intake-scenario-v1', {
    id: scenario.id,
    interactionAction: scenario.interactionAction,
    operation: scenario.operation,
    request: scenario.request,
    requiresProject: scenario.requiresProject,
  });
}

export function m251ProjectTreeIdentity(root) {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail('M2.5.1 live project root must be one real directory');
  }
  const manifest = createHash('sha256');
  let entryCount = 0;
  manifest.update(`${M251_PROJECT_TREE_MANIFEST_SCHEMA}\0`, 'utf8');

  const record = (kind, relativePath, mode, contentDigest = '') => {
    manifest.update(`${kind}\0${relativePath}\0${mode}\0${contentDigest}\0`, 'utf8');
    entryCount += 1;
  };
  const mode = (stat) => (stat.mode & 0o777).toString(8).padStart(3, '0');
  const visit = (absoluteDirectory, relativeSegments) => {
    for (const name of readdirSync(absoluteDirectory).sort()) {
      const absolutePath = join(absoluteDirectory, name);
      const segments = [...relativeSegments, name];
      const relativePath = segments.join('/');
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        record(
          'symlink',
          relativePath,
          mode(stat),
          sha256Bytes(Buffer.from(readlinkSync(absolutePath), 'utf8')),
        );
      } else if (stat.isDirectory()) {
        record('directory', relativePath, mode(stat));
        visit(absolutePath, segments);
      } else if (stat.isFile()) {
        record('file', relativePath, mode(stat), sha256Bytes(readFileSync(absolutePath)));
      } else {
        fail('M2.5.1 live project contains an unsupported filesystem entry');
      }
    }
  };

  record('directory', '.', mode(rootStat));
  visit(root, []);
  return Object.freeze({
    manifestSchema: M251_PROJECT_TREE_MANIFEST_SCHEMA,
    entryCount,
    digest: `sha256:${manifest.digest('hex')}`,
  });
}

export function m251ScenarioById(id) {
  const scenario = M251_LIVE_INTAKE_SCENARIOS.find((candidate) => candidate.id === id);
  if (scenario === undefined) {
    fail('Unknown M2.5.1 live Intake scenario');
  }
  return scenario;
}

export function projectM251AssistantObservation(observation) {
  exactKeys(
    observation,
    [
      'schemaVersion',
      'operation',
      'state',
      'processLaunchCount',
      'threadStartCount',
      'turnStartCount',
      'turnInterruptCount',
      'compactionCount',
      'backendSessionRef',
      'backendOperationRef',
    ],
    'Intake Assistant observation',
  );
  if (
    observation.schemaVersion !== 1 ||
    observation.state !== 'COMPLETED' ||
    observation.processLaunchCount !== 1 ||
    observation.threadStartCount !== 1 ||
    observation.turnStartCount !== 1 ||
    observation.turnInterruptCount !== 0 ||
    observation.compactionCount !== 0
  ) {
    fail('Live Intake observation is not one clean process, Thread, and Turn');
  }
  return Object.freeze({
    state: observation.state,
    processLaunchCount: observation.processLaunchCount,
    threadStartCount: observation.threadStartCount,
    turnStartCount: observation.turnStartCount,
    turnInterruptCount: observation.turnInterruptCount,
    compactionCount: observation.compactionCount,
    backendSessionRefDigest: m251LiveDigest(
      'codeclosure-m2-5-1-live-intake-thread-ref-v1',
      string(observation.backendSessionRef, 'Intake backend Session reference'),
    ),
    backendOperationRefDigest: m251LiveDigest(
      'codeclosure-m2-5-1-live-intake-turn-ref-v1',
      string(observation.backendOperationRef, 'Intake backend Operation reference'),
    ),
  });
}

function validateObservation(value) {
  exactKeys(
    value,
    [
      'state',
      'processLaunchCount',
      'threadStartCount',
      'turnStartCount',
      'turnInterruptCount',
      'compactionCount',
      'backendSessionRefDigest',
      'backendOperationRefDigest',
    ],
    'Live Intake scenario observation',
  );
  if (
    value.state !== 'COMPLETED' ||
    value.processLaunchCount !== 1 ||
    value.threadStartCount !== 1 ||
    value.turnStartCount !== 1 ||
    value.turnInterruptCount !== 0 ||
    value.compactionCount !== 0
  ) {
    fail('Live Intake scenario observation is not clean and singular');
  }
  digest(value.backendSessionRefDigest, 'Live Intake Thread reference digest');
  digest(value.backendOperationRefDigest, 'Live Intake Turn reference digest');
}

function validateAuthority(value, scenario) {
  exactKeys(
    value,
    [
      'intakeRunRefDigest',
      'outcomeKind',
      'intakeStatus',
      'answerDisposition',
      'proposalCount',
      'projectionCount',
      'decisionCount',
      'questionCount',
      'sourceBindingCounts',
      'userStatedFields',
      'questionFields',
      'materializedGoalCreated',
      'startAuthorizationCreated',
    ],
    'Live Intake scenario authority',
  );
  digest(value.intakeRunRefDigest, 'Intake Run reference digest');
  string(value.outcomeKind, 'Intake outcome kind');
  string(value.intakeStatus, 'Intake status');
  if (value.answerDisposition !== null && typeof value.answerDisposition !== 'string') {
    fail('Answer disposition must be a string or null');
  }
  for (const field of ['proposalCount', 'projectionCount', 'decisionCount', 'questionCount']) {
    nonNegativeInteger(value[field], `Authority ${field}`);
  }
  const counts = object(value.sourceBindingCounts, 'Source Binding counts');
  exactKeys(counts, bindingClasses, 'Source Binding counts');
  for (const authorityClass of bindingClasses) {
    nonNegativeInteger(counts[authorityClass], `Source Binding ${authorityClass} count`);
  }
  const userStatedFields = stringArray(value.userStatedFields, 'USER_STATED fields');
  const questionFields = stringArray(value.questionFields, 'Question fields');
  boolean(value.materializedGoalCreated, 'Materialized Goal flag');
  boolean(value.startAuthorizationCreated, 'Start Authorization flag');
  for (const required of scenario.requiredUserStatedFields) {
    if (!userStatedFields.includes(required)) {
      fail(`Live Intake scenario lacks required USER_STATED field ${required}`);
    }
  }
  for (const required of scenario.requiredQuestionFields) {
    if (!questionFields.includes(required)) {
      fail(`Live Intake scenario lacks required Question field ${required}`);
    }
  }
  if (scenario.id === 'ANSWER_ONLY') {
    if (
      value.outcomeKind !== 'NO_EXECUTION' ||
      value.intakeStatus !== 'NO_EXECUTION' ||
      value.answerDisposition !== 'ANSWER_RETURNED' ||
      value.proposalCount !== 0 ||
      value.projectionCount !== 0 ||
      value.decisionCount !== 1 ||
      value.questionCount !== 0 ||
      value.materializedGoalCreated ||
      value.startAuthorizationCreated
    ) {
      fail('Answer-only live scenario crossed its non-execution boundary');
    }
  } else if (scenario.id === 'CLEAR_INTENT') {
    if (
      value.outcomeKind !== 'CLARIFICATION_REQUIRED' ||
      value.intakeStatus !== 'NEEDS_CLARIFICATION' ||
      value.proposalCount !== 1 ||
      value.projectionCount !== 1 ||
      value.decisionCount !== 1 ||
      value.questionCount !== 1 ||
      value.answerDisposition !== 'NOT_REQUESTED' ||
      value.materializedGoalCreated ||
      value.startAuthorizationCreated
    ) {
      fail('Clear Intent live scenario did not retain one Runtime-owned analysis chain');
    }
  } else if (
    value.outcomeKind !== 'CLARIFICATION_REQUIRED' ||
    value.intakeStatus !== 'NEEDS_CLARIFICATION' ||
    value.answerDisposition !== 'NOT_REQUESTED' ||
    value.proposalCount !== 1 ||
    value.projectionCount !== 1 ||
    value.decisionCount !== 1 ||
    value.questionCount !== 1 ||
    value.materializedGoalCreated ||
    value.startAuthorizationCreated
  ) {
    fail('Ambiguous Intent live scenario did not fail closed to one Question');
  }
}

export function validateM251ScenarioReceipt(value) {
  exactKeys(
    value,
    [
      'schemaVersion',
      'kind',
      'scenarioId',
      'scenarioDigest',
      'operation',
      'authority',
      'observation',
      'effects',
      'cleanup',
    ],
    'M2.5.1 live Intake scenario receipt',
  );
  const scenario = m251ScenarioById(value.scenarioId);
  if (
    value.schemaVersion !== 1 ||
    value.kind !== M251_LIVE_INTAKE_SCENARIO_RECEIPT_KIND ||
    value.scenarioDigest !== m251ScenarioDigest(scenario) ||
    value.operation !== scenario.operation
  ) {
    fail('M2.5.1 live Intake scenario identity is invalid');
  }
  validateAuthority(object(value.authority, 'Scenario authority'), scenario);
  validateObservation(object(value.observation, 'Scenario observation'));
  exactKeys(
    value.effects,
    [
      'closedConfigurationValidated',
      'forbiddenEffectObserved',
      'projectObservationGranted',
      'assistantRetryCount',
    ],
    'Scenario effects',
  );
  if (
    value.effects.closedConfigurationValidated !== true ||
    value.effects.forbiddenEffectObserved !== false ||
    value.effects.projectObservationGranted !== false ||
    value.effects.assistantRetryCount !== 0
  ) {
    fail('Live Intake scenario widened its effect boundary');
  }
  exactKeys(
    value.cleanup,
    [
      'ownedProcessShutdownClean',
      'operationRootRemoved',
      'temporaryStateRootRemoved',
      'projectTreeOpening',
      'projectTreeClosing',
      'projectUnchanged',
    ],
    'Scenario cleanup',
  );
  for (const key of [
    'ownedProcessShutdownClean',
    'operationRootRemoved',
    'temporaryStateRootRemoved',
  ]) {
    if (value.cleanup[key] !== true) {
      fail(`Live Intake cleanup check failed: ${key}`);
    }
  }
  if (scenario.requiresProject) {
    validateProjectTreeIdentity(value.cleanup.projectTreeOpening, 'Opening project tree identity');
    validateProjectTreeIdentity(value.cleanup.projectTreeClosing, 'Closing project tree identity');
    if (
      JSON.stringify(value.cleanup.projectTreeOpening) !==
        JSON.stringify(value.cleanup.projectTreeClosing) ||
      value.cleanup.projectUnchanged !== true
    ) {
      fail('Live Intake project tree changed during the scenario');
    }
  } else if (
    value.cleanup.projectTreeOpening !== null ||
    value.cleanup.projectTreeClosing !== null ||
    value.cleanup.projectUnchanged !== true
  ) {
    fail('Candidate-free Answer-only scenario reported an unexpected project tree');
  }
  return value;
}

function validateProjectTreeIdentity(value, label) {
  exactKeys(value, ['manifestSchema', 'entryCount', 'digest'], label);
  if (value.manifestSchema !== M251_PROJECT_TREE_MANIFEST_SCHEMA) {
    fail(`${label} uses an unknown manifest schema`);
  }
  nonNegativeInteger(value.entryCount, `${label} entry count`);
  if (value.entryCount < 1) {
    fail(`${label} must contain the project root`);
  }
  digest(value.digest, `${label} digest`);
}

function validateSourceIdentity(value, label) {
  exactKeys(
    value,
    [
      'baseGitRevision',
      'gitBranch',
      'workingTreeState',
      'manifestSchema',
      'pathCount',
      'digest',
      'reviewExclusion',
    ],
    label,
  );
  string(value.baseGitRevision, `${label} base Git revision`);
  string(value.gitBranch, `${label} Git branch`);
  if (!['clean', 'modified'].includes(value.workingTreeState)) {
    fail(`${label} working-tree state is invalid`);
  }
  if (value.manifestSchema !== 'codeclosure-source-manifest-v1') {
    fail(`${label} manifest schema is invalid`);
  }
  nonNegativeInteger(value.pathCount, `${label} path count`);
  if (value.pathCount < 1) {
    fail(`${label} path count must be positive`);
  }
  digest(value.digest, `${label} manifest digest`);
  if (value.reviewExclusion !== M251_LIVE_INTAKE_REVIEW_EXCLUSION) {
    fail(`${label} review exclusion is invalid`);
  }
}

export function assertM251MetadataOnly(value, forbiddenStrings = []) {
  const serialized = JSON.stringify(value);
  const forbiddenKeys = [
    'request',
    'answerContent',
    'proposedObjective',
    'proposedCriteria',
    'proposedQuestions',
    'admittedUserContent',
    'rawNotification',
    'reasoning',
    'transcript',
    'authSource',
    'account',
    'rateLimit',
    'exception',
  ];
  const keyPattern = new RegExp(`"(?:${forbiddenKeys.join('|')})"\\s*:`, 'u');
  if (keyPattern.test(serialized)) {
    fail('Live Intake receipt contains a prohibited content-bearing field');
  }
  for (const forbidden of forbiddenStrings) {
    if (typeof forbidden === 'string' && forbidden.length > 0 && serialized.includes(forbidden)) {
      fail('Live Intake receipt contains prohibited request, response, or credential content');
    }
  }
  return value;
}

export function validateM251LiveReceipt(value) {
  exactKeys(
    value,
    [
      'schemaVersion',
      'kind',
      'authorization',
      'source',
      'toolchain',
      'prerequisite',
      'scenarios',
      'aggregate',
      'privacy',
      'cleanup',
    ],
    'M2.5.1 live Intake receipt',
  );
  if (
    value.schemaVersion !== 1 ||
    value.kind !== M251_LIVE_INTAKE_RECEIPT_KIND ||
    value.authorization !== 'EXPLICIT'
  ) {
    fail('M2.5.1 live Intake receipt identity is invalid');
  }
  exactKeys(value.source, ['opening', 'closing'], 'Live source identity');
  validateSourceIdentity(value.source.opening, 'Opening live source identity');
  validateSourceIdentity(value.source.closing, 'Closing live source identity');
  if (JSON.stringify(value.source.opening) !== JSON.stringify(value.source.closing)) {
    fail('Live source identity drifted during Intake execution');
  }
  exactKeys(
    value.toolchain,
    [
      'nodeVersion',
      'codexVersion',
      'protocolSnapshotDigest',
      'assistantProfileVersion',
      'assistantAdapterVersion',
      'closedConfigurationVersion',
      'protocolProjectionVersion',
      'instructionPolicyVersion',
      'intentAnalysisResponseContractVersion',
      'intentProjectionProfileVersion',
    ],
    'Live toolchain identity',
  );
  for (const field of [
    'nodeVersion',
    'codexVersion',
    'assistantProfileVersion',
    'assistantAdapterVersion',
    'closedConfigurationVersion',
    'protocolProjectionVersion',
    'instructionPolicyVersion',
    'intentAnalysisResponseContractVersion',
    'intentProjectionProfileVersion',
  ]) {
    string(value.toolchain[field], `Live toolchain ${field}`);
  }
  digest(value.toolchain.protocolSnapshotDigest, 'Live protocol snapshot digest');
  exactKeys(
    value.prerequisite,
    ['initialized', 'structuredOutput', 'turnCompleted', 'controlledStateRemoved'],
    'Lower-client prerequisite',
  );
  if (Object.values(value.prerequisite).some((selected) => selected !== true)) {
    fail('Lower-client live prerequisite did not pass');
  }
  if (
    !Array.isArray(value.scenarios) ||
    value.scenarios.length !== M251_LIVE_INTAKE_SCENARIOS.length
  ) {
    fail('Live Intake receipt has an incomplete scenario set');
  }
  value.scenarios.forEach(validateM251ScenarioReceipt);
  if (
    JSON.stringify(value.scenarios.map(({ scenarioId }) => scenarioId)) !==
    JSON.stringify(M251_LIVE_INTAKE_SCENARIOS.map(({ id }) => id))
  ) {
    fail('Live Intake scenarios are not in canonical order');
  }
  exactKeys(
    value.aggregate,
    [
      'scenarioCount',
      'processLaunchCount',
      'threadStartCount',
      'turnStartCount',
      'uniqueThreadRefs',
      'uniqueTurnRefs',
    ],
    'Live Intake aggregate',
  );
  if (
    value.aggregate.scenarioCount !== 3 ||
    value.aggregate.processLaunchCount !== 3 ||
    value.aggregate.threadStartCount !== 3 ||
    value.aggregate.turnStartCount !== 3 ||
    value.aggregate.uniqueThreadRefs !== 3 ||
    value.aggregate.uniqueTurnRefs !== 3
  ) {
    fail('Live Intake aggregate does not prove fresh bounded operations');
  }
  exactKeys(
    value.privacy,
    [
      'credentialContentRetained',
      'requestContentInReceipt',
      'assistantContentInReceipt',
      'reasoningOrTranscriptRetained',
      'rawPayloadOrExceptionRetained',
    ],
    'Live Intake privacy',
  );
  if (Object.values(value.privacy).some((selected) => selected !== false)) {
    fail('Live Intake privacy receipt reports retained prohibited content');
  }
  exactKeys(
    value.cleanup,
    ['assessmentRootRemoved', 'scenarioAuthorityRootsRemoved'],
    'Live Intake aggregate cleanup',
  );
  if (
    value.cleanup.assessmentRootRemoved !== true ||
    value.cleanup.scenarioAuthorityRootsRemoved !== true
  ) {
    fail('Live Intake aggregate cleanup is incomplete');
  }
  assertM251MetadataOnly(
    value,
    M251_LIVE_INTAKE_SCENARIOS.map(({ request }) => request),
  );
  return value;
}
