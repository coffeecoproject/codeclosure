import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { URL } from 'node:url';

import { M251_PROJECT_TREE_MANIFEST_SCHEMA, m251LiveDigest } from './m2.5.1-live-intake-lib.mjs';

const slice0Contract = JSON.parse(
  readFileSync(new URL('./fixtures/m2.5.1/slice0-contract.json', import.meta.url), 'utf8'),
);

export const M251_LIVE_COMPOSITION_AUTHORIZATION_ENV =
  'CODECLOSURE_M251_COMPOSITION_LIVE_AUTHORIZED';
export const M251_LIVE_COMPOSITION_RECEIPT_KIND = 'CODECLOSURE_M2_5_1_LIVE_COMPOSITION_V1';
export const M251_LIVE_COMPOSITION_REVIEW_EXCLUSION =
  'docs/reviews/m2.5.1-slice4-real-user-path-and-failure-closure.md';
export const M251_LIVE_COMPOSITION_SCENARIO = Object.freeze({
  id: 'PAYMENT_IDEMPOTENCY_LINKED_PATH',
  request: 'Objective: Prevent duplicate payment callbacks.',
  clarificationAnswer: `Required criterion: ${slice0Contract.demonstration.expectedResult}`,
});

export const M251_LIVE_COMPOSITION_STAGE_IDS = Object.freeze([
  'PREFLIGHT',
  'INTAKE_CLARIFICATION',
  'MATERIALIZATION',
  'ORDINARY_START',
  'DISCOVERY',
  'PLAN',
  'IMPLEMENT',
  'PROTECTED_VERIFICATION',
  'EVIDENCE_ACCEPTANCE_CLOSEOUT',
  'STRICT_REOPEN',
  'CLEANUP',
]);

export const M251_LIVE_COMPOSITION_PHASES = Object.freeze([
  Object.freeze({
    phase: 'DISCOVERY',
    resultKind: 'PROPOSALS',
    sourceKind: 'PROJECT_READ',
  }),
  Object.freeze({ phase: 'PLAN', resultKind: 'PROPOSALS', sourceKind: 'PROJECT_READ' }),
  Object.freeze({
    phase: 'IMPLEMENT',
    resultKind: 'COMPLETION_REQUEST',
    sourceKind: 'CANDIDATE',
  }),
]);

export const M251_LIVE_COMPOSITION_ROOT_KINDS = Object.freeze(
  [
    'AUTHORITY_HOME',
    'CANDIDATE_WORKSPACE',
    'CREDENTIAL_ROOT',
    'DEMONSTRATION_PROJECT',
    'INTAKE_CODEX_HOME',
    'INTAKE_EXECUTION_ROOT',
    'INTAKE_OPERATION_CWD',
    'INTAKE_PROCESS_HOME',
    'INTAKE_PROCESS_TEMPORARY_DIRECTORY',
    'PROJECT_READ_WORKSPACE',
    'PROTECTED_ASSET_ROOT',
    'VERIFICATION_RUN_ROOT',
    'WORKER_CODEX_HOME',
    'WORKER_PROBE_WORKSPACE',
    'WORKER_PROCESS_HOME',
    'WORKER_STATE_ROOT',
    'WORKER_TEMPORARY_DIRECTORY',
  ].toSorted(),
);

const intakeMemberKinds = new Set([
  'INTAKE_CODEX_HOME',
  'INTAKE_OPERATION_CWD',
  'INTAKE_PROCESS_HOME',
  'INTAKE_PROCESS_TEMPORARY_DIRECTORY',
]);
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const expectedToolchain = slice0Contract.toolchain.selected;
const expectedIntake = slice0Contract.intake;
const expectedExecution = slice0Contract.execution;
const expectedProject = slice0Contract.demonstration;
const expectedProjectContract = Object.freeze({
  projectFamily: expectedProject.projectFamily,
  gitCommit: expectedProject.gitCommit,
  gitTree: expectedProject.gitTree,
  sourceTreeDigest: expectedProject.sourceTreeDigest,
  sourceGitMetadataDigest: expectedProject.sourceGitMetadataDigest,
  selectedSourcePaths: expectedProject.selectedSourcePaths,
  allowedPaths: expectedProject.allowedPaths,
  expectedResult: expectedProject.expectedResult,
});

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

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return value;
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(`${label} is not the exact canonical sequence`);
  }
  return value;
}

function sameOrWithin(path, parent) {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function pathsOverlap(left, right) {
  return sameOrWithin(left, right) || sameOrWithin(right, left);
}

function exactPath(path, label) {
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    path !== path.normalize('NFC')
  ) {
    fail(`${label} must be an exact normalized absolute path`);
  }
  return path;
}

function assertPairwiseSeparated(paths, label) {
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      const leftPath = paths[left];
      const rightPath = paths[right];
      if (leftPath === undefined || rightPath === undefined || pathsOverlap(leftPath, rightPath)) {
        fail(label);
      }
    }
  }
}

function sourceIdentity(value, label) {
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
  if (!/^[0-9a-f]{40}$/u.test(value.baseGitRevision)) {
    fail(`${label} base Git revision must be one full lowercase commit identity`);
  }
  string(value.gitBranch, `${label} Git branch`);
  if (!['clean', 'modified'].includes(value.workingTreeState)) {
    fail(`${label} working-tree state is invalid`);
  }
  if (
    value.manifestSchema !== 'codeclosure-source-manifest-v1' ||
    value.reviewExclusion !== M251_LIVE_COMPOSITION_REVIEW_EXCLUSION
  ) {
    fail(`${label} contract identity is invalid`);
  }
  positiveInteger(value.pathCount, `${label} path count`);
  digest(value.digest, `${label} manifest digest`);
  return value;
}

function assertExactIdentity(left, right, label) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`${label} drifted or was substituted`);
  }
}

export function admitM251LiveCompositionAuthorization(environment) {
  if (
    environment === null ||
    typeof environment !== 'object' ||
    environment[M251_LIVE_COMPOSITION_AUTHORIZATION_ENV] !== '1'
  ) {
    fail(`${M251_LIVE_COMPOSITION_AUTHORIZATION_ENV} must be exactly 1`);
  }
  return 'EXPLICIT';
}

export function m251LiveCompositionScenarioDigest() {
  return m251LiveDigest('codeclosure-m2-5-1-live-composition-scenario-v1', {
    id: M251_LIVE_COMPOSITION_SCENARIO.id,
    request: M251_LIVE_COMPOSITION_SCENARIO.request,
    clarificationAnswer: M251_LIVE_COMPOSITION_SCENARIO.clarificationAnswer,
  });
}

export function m251LiveCompositionReferenceDigest(kind, value) {
  return m251LiveDigest(
    `codeclosure-m2-5-1-live-composition-reference-v1:${string(kind, 'Reference kind')}`,
    string(value, 'Authority reference'),
  );
}

export function projectM251LiveCompositionStages(completedStageIds) {
  exactArray(
    completedStageIds,
    M251_LIVE_COMPOSITION_STAGE_IDS,
    'Completed live composition stages',
  );
  return Object.freeze(
    completedStageIds.map((stageId) => Object.freeze({ stageId, status: 'PASSED' })),
  );
}

export function projectM251LiveCompositionProfile(input) {
  const projected = Object.freeze({
    activationKind: input.activationKind,
    execution: Object.freeze({
      id: input.executionProfile.id,
      version: input.executionProfile.version,
      digest: input.executionProfile.digest,
    }),
    workflowPolicy: Object.freeze({
      id: input.workflowPolicy.id,
      version: input.workflowPolicy.version,
      digest: input.workflowPolicy.digest,
    }),
    workerActivityPolicy: Object.freeze({
      id: input.workerActivityPolicy.id,
      version: input.workerActivityPolicy.version,
      digest: input.workerActivityPolicy.digest,
    }),
    phaseBindings: Object.freeze(
      input.phaseBindings.map((binding) =>
        Object.freeze({
          phase: binding.phase,
          workerKind: binding.workerKind,
          sourceKind: binding.sourceKind,
          adapterId: binding.adapterId,
          adapterVersion: binding.adapterVersion,
          phaseEntryDigest: binding.phaseEntryDigest,
        }),
      ),
    ),
  });
  validateProfile(projected);
  return projected;
}

export function projectM251LiveCompositionProjectIdentity(project, protectedCheck) {
  exactKeys(
    project,
    [
      'projectFamily',
      'gitCommit',
      'gitTree',
      'sourceTreeDigest',
      'sourceGitMetadataDigest',
      'selectedSourcePaths',
      'allowedPaths',
      'expectedResult',
    ],
    'Live composition project contract',
  );
  exactKeys(
    protectedCheck,
    ['id', 'version', 'assetPath', 'assetDigest', 'acceptedExitCodes'],
    'Live composition protected Check contract',
  );
  assertExactIdentity(project, expectedProjectContract, 'Live composition project contract');
  assertExactIdentity(
    protectedCheck,
    expectedProject.protectedCheck,
    'Live composition protected Check contract',
  );
  return Object.freeze({
    projectFamily: project.projectFamily,
    gitCommit: project.gitCommit,
    gitTree: project.gitTree,
    sourceTreeDigest: project.sourceTreeDigest,
    sourceGitMetadataDigest: project.sourceGitMetadataDigest,
    selectedSourcePathCount: project.selectedSourcePaths.length,
    selectedSourcePathsDigest: m251LiveDigest(
      'codeclosure-m2-5-1-live-composition-selected-source-paths-v1',
      project.selectedSourcePaths,
    ),
    allowedPathCount: project.allowedPaths.length,
    allowedPathsDigest: m251LiveDigest(
      'codeclosure-m2-5-1-live-composition-allowed-paths-v1',
      project.allowedPaths,
    ),
    protectedCheck: Object.freeze({
      id: protectedCheck.id,
      version: protectedCheck.version,
      assetPath: protectedCheck.assetPath,
      assetDigest: protectedCheck.assetDigest,
      acceptedExitCodes: Object.freeze([...protectedCheck.acceptedExitCodes]),
    }),
  });
}

export function projectM251LiveCompositionRootIdentity(entries) {
  if (!Array.isArray(entries)) {
    fail('Live composition roots must be an array');
  }
  const pathsByKind = new Map();
  for (const entry of entries) {
    exactKeys(entry, ['kind', 'path'], 'Live composition root entry');
    if (!M251_LIVE_COMPOSITION_ROOT_KINDS.includes(entry.kind) || pathsByKind.has(entry.kind)) {
      fail('Live composition root kind is missing, duplicated, or unknown');
    }
    pathsByKind.set(entry.kind, exactPath(entry.path, `Live composition ${entry.kind} root`));
  }
  exactArray([...pathsByKind.keys()].toSorted(), M251_LIVE_COMPOSITION_ROOT_KINDS, 'Root kinds');

  const intakeRoot = pathsByKind.get('INTAKE_EXECUTION_ROOT');
  if (intakeRoot === undefined) {
    fail('Live composition Intake execution root is missing');
  }
  const intakeMembers = [...intakeMemberKinds].map((kind) => pathsByKind.get(kind));
  if (
    intakeMembers.some(
      (path) => path === undefined || path === intakeRoot || !sameOrWithin(path, intakeRoot),
    )
  ) {
    fail('Live composition Intake members must be exact descendants of the Intake root');
  }
  assertPairwiseSeparated(
    intakeMembers,
    'Live composition Intake members must be pairwise separated',
  );
  const topLevelPaths = [...pathsByKind]
    .filter(([kind]) => !intakeMemberKinds.has(kind))
    .map(([, path]) => path);
  assertPairwiseSeparated(
    topLevelPaths,
    'Live composition top-level roots must be pairwise separated',
  );

  const projectedEntries = Object.freeze(
    M251_LIVE_COMPOSITION_ROOT_KINDS.map((kind) =>
      Object.freeze({
        kind,
        parentKind: intakeMemberKinds.has(kind) ? 'INTAKE_EXECUTION_ROOT' : null,
        pathDigest: m251LiveDigest(
          `codeclosure-m2-5-1-live-composition-root-path-v1:${kind}`,
          pathsByKind.get(kind),
        ),
      }),
    ),
  );
  return Object.freeze({
    schemaVersion: 1,
    entries: projectedEntries,
    digest: m251LiveDigest('codeclosure-m2-5-1-live-composition-root-set-v1', projectedEntries),
  });
}

function validateRootIdentity(value, label) {
  exactKeys(value, ['schemaVersion', 'entries', 'digest'], label);
  if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    fail(`${label} schema is invalid`);
  }
  if (value.entries.length !== M251_LIVE_COMPOSITION_ROOT_KINDS.length) {
    fail(`${label} root set is incomplete`);
  }
  const pathDigests = new Set();
  value.entries.forEach((entry, index) => {
    exactKeys(entry, ['kind', 'parentKind', 'pathDigest'], `${label} entry`);
    const expectedKind = M251_LIVE_COMPOSITION_ROOT_KINDS[index];
    if (
      entry.kind !== expectedKind ||
      entry.parentKind !== (intakeMemberKinds.has(entry.kind) ? 'INTAKE_EXECUTION_ROOT' : null)
    ) {
      fail(`${label} root kinds or parent bindings are invalid`);
    }
    pathDigests.add(digest(entry.pathDigest, `${label} ${entry.kind} path digest`));
  });
  if (pathDigests.size !== value.entries.length) {
    fail(`${label} root paths are not distinct`);
  }
  if (
    value.digest !==
    m251LiveDigest('codeclosure-m2-5-1-live-composition-root-set-v1', value.entries)
  ) {
    fail(`${label} digest is invalid`);
  }
  return value;
}

export function assertM251LiveCompositionRootIdentity(expected, actual) {
  validateRootIdentity(expected, 'Expected live composition root identity');
  validateRootIdentity(actual, 'Actual live composition root identity');
  assertExactIdentity(expected, actual, 'Live composition root identity');
  return actual;
}

export function assertM251LiveCompositionSourceClosure(opening, closing) {
  sourceIdentity(opening, 'Opening live composition source identity');
  sourceIdentity(closing, 'Closing live composition source identity');
  assertExactIdentity(opening, closing, 'Live composition source identity');
  return closing;
}

function validateProjectObservation(value, label) {
  exactKeys(
    value,
    [
      'gitCommit',
      'gitTree',
      'sourceTreeDigest',
      'sourceGitMetadataDigest',
      'workingTreeState',
      'projectTree',
    ],
    label,
  );
  if (
    value.gitCommit !== expectedProject.gitCommit ||
    value.gitTree !== expectedProject.gitTree ||
    value.sourceTreeDigest !== expectedProject.sourceTreeDigest ||
    value.sourceGitMetadataDigest !== expectedProject.sourceGitMetadataDigest ||
    value.workingTreeState !== 'clean'
  ) {
    fail(`${label} is not the exact clean demonstration baseline`);
  }
  exactKeys(value.projectTree, ['manifestSchema', 'entryCount', 'digest'], `${label} tree`);
  if (value.projectTree.manifestSchema !== M251_PROJECT_TREE_MANIFEST_SCHEMA) {
    fail(`${label} project-tree schema is invalid`);
  }
  positiveInteger(value.projectTree.entryCount, `${label} project-tree entry count`);
  digest(value.projectTree.digest, `${label} project-tree digest`);
  return value;
}

export function assertM251LiveCompositionProjectClosure(opening, closing) {
  validateProjectObservation(opening, 'Opening live composition project observation');
  validateProjectObservation(closing, 'Closing live composition project observation');
  assertExactIdentity(opening, closing, 'Live composition demonstration project');
  return closing;
}

export function projectM251LiveCompositionGoal(input, profile) {
  const { finalAuthority, finalStatus, processedStartCommand, startAuthorization, startResult } =
    input;
  const startCommand = startResult.command;
  const storedStart = processedStartCommand.outcome;
  const executionBinding = finalAuthority.executionProfileBinding;
  const policyBinding = finalAuthority.policyBinding;
  if (
    startCommand?.status !== 'APPLIED' ||
    startCommand.output?.ok !== true ||
    startCommand.output.commandId !== startAuthorization.startCommandId ||
    startCommand.output.goalId !== startAuthorization.goalId ||
    processedStartCommand.commandId !== startAuthorization.startCommandId ||
    processedStartCommand.aggregateType !== 'GOAL' ||
    processedStartCommand.aggregateId !== startAuthorization.goalId ||
    storedStart?.schemaVersion !== 3 ||
    storedStart.disposition !== 'APPLIED' ||
    storedStart.target?.aggregateType !== 'GOAL' ||
    storedStart.target.aggregateId !== startAuthorization.goalId ||
    storedStart.goalId !== startAuthorization.goalId ||
    storedStart.output?.commandId !== startAuthorization.startCommandId ||
    storedStart.output.ok !== true ||
    storedStart.output.goalId !== startAuthorization.goalId ||
    storedStart.output.workflowVersion !== startCommand.output.workflowVersion ||
    storedStart.output.phase !== startCommand.output.phase ||
    storedStart.output.runStatus !== startCommand.output.runStatus ||
    finalAuthority.goal?.id !== finalStatus.goalId ||
    finalAuthority.goal.revision !== finalStatus.goalRevision ||
    finalAuthority.workflow?.id !== finalStatus.workflowId ||
    finalAuthority.workflow.version !== finalStatus.workflowVersion ||
    executionBinding?.goalId !== finalStatus.goalId ||
    executionBinding.workflowId !== finalStatus.workflowId ||
    executionBinding.startCommandId !== startAuthorization.startCommandId ||
    executionBinding.profileId !== profile.execution.id ||
    executionBinding.profileVersion !== profile.execution.version ||
    executionBinding.profileDigest !== profile.execution.digest ||
    policyBinding?.goalId !== finalStatus.goalId ||
    policyBinding.workflowId !== finalStatus.workflowId ||
    policyBinding.startCommandId !== startAuthorization.startCommandId ||
    policyBinding.policyBundleId !== profile.workflowPolicy.id ||
    policyBinding.policyBundleVersion !== profile.workflowPolicy.version ||
    policyBinding.policyBundleDigest !== profile.workflowPolicy.digest ||
    startAuthorization.goalId !== finalStatus.goalId ||
    startAuthorization.goalRevision !== finalStatus.goalRevision ||
    startAuthorization.workflowId !== finalStatus.workflowId ||
    startAuthorization.executionProfileId !== profile.execution.id ||
    startAuthorization.executionProfileDigest !== profile.execution.digest ||
    finalStatus.executionProfileRef?.id !== profile.execution.id ||
    finalStatus.executionProfileRef?.version !== profile.execution.version ||
    finalStatus.executionProfileRef?.digest !== profile.execution.digest
  ) {
    fail('Live composition Goal authority is not bound to the admitted Start/Profile');
  }
  const finalStatusProjection = Object.freeze({
    schemaVersion: finalStatus.schemaVersion,
    goalId: finalStatus.goalId,
    goalRevision: finalStatus.goalRevision,
    workflowId: finalStatus.workflowId,
    workflowVersion: finalStatus.workflowVersion,
    phase: finalStatus.phase,
    runStatus: finalStatus.runStatus,
    executionProfileRef: finalStatus.executionProfileRef,
    acceptanceSummary: finalStatus.acceptanceSummary,
    closeoutRef: finalStatus.closeoutRef,
    nextSafeAction: finalStatus.nextSafeAction,
    technicalCloseout: finalStatus.technicalCloseout,
  });
  const projected = Object.freeze({
    goalRefDigest: m251LiveCompositionReferenceDigest('goal', finalStatus.goalId),
    goalRevision: finalStatus.goalRevision,
    workflowRefDigest: m251LiveCompositionReferenceDigest('workflow', finalStatus.workflowId),
    workflowVersion: finalStatus.workflowVersion,
    startAuthorizationRefDigest: m251LiveCompositionReferenceDigest(
      'goal-start-authorization',
      startAuthorization.id,
    ),
    startCommandRefDigest: m251LiveCompositionReferenceDigest(
      'start-command',
      startAuthorization.startCommandId,
    ),
    startCommandStatus: startCommand.status,
    executionProfileId: finalStatus.executionProfileRef.id,
    executionProfileVersion: finalStatus.executionProfileRef.version,
    executionProfileDigest: finalStatus.executionProfileRef.digest,
    finalStatusProjectionDigest: m251LiveDigest(
      'codeclosure-m2-5-1-live-composition-final-status-v1',
      finalStatusProjection,
    ),
  });
  validateGoal(projected, profile);
  return projected;
}

export function projectM251LiveCompositionIntake(input, goal, profile) {
  const { authority } = input;
  if (
    !Array.isArray(authority.outcomes) ||
    !Array.isArray(authority.questions) ||
    !Array.isArray(authority.reservations)
  ) {
    fail('Live composition Intake authority is incomplete');
  }
  const submitOutcome = authority.outcomes.find(
    ({ commandId }) => commandId === input.submitCommandId,
  );
  const clarificationOutcome = authority.outcomes.find(
    ({ commandId }) => commandId === input.clarificationCommandId,
  );
  const questionId = submitOutcome?.result?.activeQuestionRef?.clarificationQuestionId;
  const question = authority.questions.find(({ id }) => id === questionId);
  const materialization = authority.materialization;
  const startAuthorization = authority.startAuthorization;
  const assistantOperationCount = authority.reservations.filter(({ operationKind }) =>
    ['INTENT_ANALYSIS', 'CLARIFICATION_ANALYSIS'].includes(operationKind),
  ).length;
  if (
    submitOutcome?.disposition !== 'APPLIED' ||
    submitOutcome.result.kind !== 'CLARIFICATION_REQUIRED' ||
    clarificationOutcome?.disposition !== 'APPLIED' ||
    clarificationOutcome.result.kind !== 'MATERIALIZED' ||
    question === undefined ||
    materialization === undefined ||
    startAuthorization === undefined ||
    authority.intakeRun.status !== 'MATERIALIZED' ||
    materialization.goalId !== startAuthorization.goalId ||
    materialization.workflowId !== startAuthorization.workflowId ||
    startAuthorization.executionProfileDigest !== profile.execution.digest
  ) {
    fail('Live composition Intake authority does not retain the linked materialization chain');
  }
  const projected = Object.freeze({
    intakeRunRefDigest: m251LiveCompositionReferenceDigest('intake-run', authority.intakeRun.id),
    submitCommandRefDigest: m251LiveCompositionReferenceDigest(
      'intake-submit-command',
      submitOutcome.commandId,
    ),
    clarificationCommandRefDigest: m251LiveCompositionReferenceDigest(
      'intake-clarification-command',
      clarificationOutcome.commandId,
    ),
    questionRefDigest: m251LiveCompositionReferenceDigest('clarification-question', question.id),
    initialOutcomeKind: submitOutcome.result.kind,
    initialStatus: 'NEEDS_CLARIFICATION',
    questionFields: Object.freeze([...question.affectedFields]),
    clarificationOutcomeKind: clarificationOutcome.result.kind,
    finalStatus: authority.intakeRun.status,
    assistantOperationCount,
    materializedGoalRefDigest: m251LiveCompositionReferenceDigest('goal', materialization.goalId),
    startAuthorizationRefDigest: m251LiveCompositionReferenceDigest(
      'goal-start-authorization',
      startAuthorization.id,
    ),
    authorizedProfileDigest: startAuthorization.executionProfileDigest,
  });
  validateIntake(projected, goal, profile);
  return projected;
}

export function projectM251LiveCompositionCandidate(input, goal) {
  const { authority, freezeEvidence } = input;
  const { candidate, generation } = authority;
  const observation = freezeEvidence.observation;
  if (
    freezeEvidence.kind !== 'CANDIDATE_FREEZE' ||
    freezeEvidence.schemaVersion !== 2 ||
    observation?.schemaVersion !== 2 ||
    freezeEvidence.candidateGenerationId !== generation.id ||
    observation.baseSourceDigest !== generation.baseDigest ||
    freezeEvidence.candidateDigest !== generation.frozenDigest ||
    !Array.isArray(observation.changes)
  ) {
    fail('Live composition Candidate authority and freeze-v2 Evidence are not cross-bound');
  }
  const changedPaths = observation.changes.map(({ path }) => path).toSorted();
  const projected = Object.freeze({
    candidateRefDigest: m251LiveCompositionReferenceDigest('candidate', candidate.id),
    generationRefDigest: m251LiveCompositionReferenceDigest('candidate-generation', generation.id),
    goalRefDigest: m251LiveCompositionReferenceDigest('goal', candidate.goalId),
    state: generation.state,
    freezeSchemaVersion: observation.schemaVersion,
    baseSourceDigest: observation.baseSourceDigest,
    firstSourceDigest: observation.firstSourceDigest,
    secondSourceDigest: observation.secondSourceDigest,
    changeSetDigest: observation.changeSetDigest,
    allowedPathPolicyDigest: observation.allowedPathPolicyDigest,
    changedPathCount: observation.changes.length,
    addedPathCount: observation.changes.filter(({ kind }) => kind === 'ADDED').length,
    modifiedPathCount: observation.changes.filter(({ kind }) => kind === 'MODIFIED').length,
    deletedPathCount: observation.changes.filter(({ kind }) => kind === 'DELETED').length,
    changedPathsDigest: m251LiveDigest(
      'codeclosure-m2-5-1-live-composition-changed-paths-v1',
      changedPaths,
    ),
    sourceGitCommit: expectedProject.gitCommit,
    sourceGitTree: expectedProject.gitTree,
  });
  validateCandidate(projected, goal);
  return projected;
}

function phaseSourceAuthorityMatches(record, observation) {
  if (record.kind !== observation.kind) {
    return false;
  }
  return record.kind === 'PROJECT_READ'
    ? record.projectReadAuthorityId === observation.projectReadAuthorityId &&
        record.projectReadAuthorityRecordDigest === observation.projectReadAuthorityRecordDigest &&
        record.snapshotCwdIdentity === observation.snapshotCwdIdentity
    : record.candidateWorkspaceLeaseId === observation.candidateWorkspaceLeaseId &&
        record.candidateWorkspaceLeaseDigest === observation.candidateWorkspaceLeaseDigest &&
        record.candidateWorkspaceCwdIdentity === observation.candidateWorkspaceCwdIdentity;
}

function phaseContextAuthorityMatches(manifest, record, attempt, profile, goal) {
  return (
    (manifest.schemaVersion === 4 || manifest.schemaVersion === 5) &&
    manifest.id === record.contextManifestId &&
    manifest.manifestDigest === record.contextManifestDigest &&
    manifest.packageDigest === record.contextPackageDigest &&
    m251LiveCompositionReferenceDigest('goal', manifest.goalId) === goal.goalRefDigest &&
    manifest.goalRevision === goal.goalRevision &&
    m251LiveCompositionReferenceDigest('workflow', manifest.workflowId) ===
      goal.workflowRefDigest &&
    manifest.workflowVersion === record.workflowVersionAtAuthorization &&
    manifest.phase === record.phase &&
    manifest.attemptId === record.attemptId &&
    manifest.createdAt === attempt.startedAt &&
    manifest.executionProfileId === profile.execution.id &&
    manifest.executionProfileDigest === profile.execution.digest &&
    manifest.policyBundleId === profile.workflowPolicy.id &&
    manifest.policyBundleDigest === profile.workflowPolicy.digest &&
    typeof manifest.acceptanceCriticalVerificationPlanId === 'string' &&
    manifest.acceptanceCriticalVerificationPlanId.length > 0 &&
    digestPattern.test(manifest.acceptanceCriticalVerificationPlanDigest) &&
    record.goalRevision === manifest.goalRevision &&
    record.phaseVersion === manifest.workflowVersion &&
    record.policyBundleId === manifest.policyBundleId &&
    record.policyBundleDigest === manifest.policyBundleDigest
  );
}

function phaseContextSourceMatches(manifest, sourceAuthority, projectReadAuthority, candidate) {
  if (sourceAuthority.kind === 'PROJECT_READ') {
    return (
      manifest.schemaVersion === 5 &&
      manifest.candidateGenerationId === undefined &&
      manifest.candidateDigest === undefined &&
      manifest.projectReadAuthorityId === sourceAuthority.projectReadAuthorityId &&
      manifest.projectReadAuthorityRecordDigest ===
        sourceAuthority.projectReadAuthorityRecordDigest &&
      projectReadAuthority !== undefined &&
      projectReadAuthority.schemaVersion === 1 &&
      projectReadAuthority.id === sourceAuthority.projectReadAuthorityId &&
      projectReadAuthority.recordDigest === sourceAuthority.projectReadAuthorityRecordDigest &&
      projectReadAuthority.snapshotLeafRealpath === sourceAuthority.snapshotCwdIdentity &&
      projectReadAuthority.sourceTree?.projectionDigest ===
        manifest.projectReadSourceTreeProjectionDigest &&
      projectReadAuthority.gitState?.projectionDigest ===
        manifest.projectReadGitStateProjectionDigest
    );
  }
  return (
    sourceAuthority.kind === 'CANDIDATE' &&
    manifest.schemaVersion === 4 &&
    projectReadAuthority === undefined &&
    manifest.projectReadAuthorityId === undefined &&
    manifest.projectReadAuthorityRecordDigest === undefined &&
    manifest.projectReadSourceTreeProjectionDigest === undefined &&
    manifest.projectReadGitStateProjectionDigest === undefined &&
    m251LiveCompositionReferenceDigest('candidate-generation', manifest.candidateGenerationId) ===
      candidate.generationRefDigest &&
    manifest.candidateDigest === candidate.baseSourceDigest
  );
}

export function projectM251LiveCompositionPhases(inputs, profile, goal, candidate) {
  if (!Array.isArray(inputs)) {
    fail('Live composition phase authorities must be an array');
  }
  const projected = Object.freeze(
    inputs.map((input, index) => {
      const { adapterObservation, attempt, contextManifest, externalRecord, projectReadAuthority } =
        input;
      const workerEventReceipt = input.workerEventReceipt;
      const sourceAuthority = externalRecord.sourceAuthority;
      const binding = profile.phaseBindings[index];
      const resultKind =
        typeof attempt.terminationReason === 'string' &&
        attempt.terminationReason.startsWith('WORKER_RESULT:')
          ? attempt.terminationReason.slice('WORKER_RESULT:'.length)
          : undefined;
      if (
        binding === undefined ||
        externalRecord.schemaVersion !== 2 ||
        externalRecord.id === undefined ||
        externalRecord.state !== 'COMPLETED' ||
        externalRecord.processIdentity === undefined ||
        externalRecord.failureCode !== undefined ||
        externalRecord.phase !== binding.phase ||
        externalRecord.phaseDispatchEntryDigest !== binding.phaseEntryDigest ||
        externalRecord.executionProfileId !== profile.execution.id ||
        externalRecord.executionProfileDigest !== profile.execution.digest ||
        !phaseContextAuthorityMatches(contextManifest, externalRecord, attempt, profile, goal) ||
        m251LiveCompositionReferenceDigest('goal', externalRecord.goalId) !== goal.goalRefDigest ||
        m251LiveCompositionReferenceDigest('workflow', externalRecord.workflowId) !==
          goal.workflowRefDigest ||
        attempt.id !== externalRecord.attemptId ||
        attempt.workflowId !== externalRecord.workflowId ||
        attempt.phase !== externalRecord.phase ||
        attempt.workerSessionRef !== externalRecord.workerSessionId ||
        attempt.contextManifestId !== externalRecord.contextManifestId ||
        attempt.status !== 'RESULT_RECORDED' ||
        adapterObservation.schemaVersion !== 2 ||
        adapterObservation.state !== 'COMPLETED' ||
        adapterObservation.failureCode !== undefined ||
        adapterObservation.activityDisposition !== 'ADMITTED' ||
        adapterObservation.approvalRequestCount !== 0 ||
        adapterObservation.phase !== externalRecord.phase ||
        adapterObservation.phaseDispatchEntryDigest !== externalRecord.phaseDispatchEntryDigest ||
        adapterObservation.externalExecutionIntentDigest !== externalRecord.intentDigest ||
        adapterObservation.requestAttemptId !== externalRecord.attemptId ||
        adapterObservation.requestWorkerSessionId !== externalRecord.workerSessionId ||
        adapterObservation.workerActivityPolicyId !== profile.workerActivityPolicy.id ||
        adapterObservation.workerActivityPolicyDigest !== profile.workerActivityPolicy.digest ||
        adapterObservation.processLaunchCount !== 1 ||
        adapterObservation.backendSessionRef !== externalRecord.backendSessionRef ||
        adapterObservation.backendOperationRef !== externalRecord.backendOperationRef ||
        adapterObservation.compactionCount !== externalRecord.compactionCount ||
        adapterObservation.turnInterruptCount !== externalRecord.turnInterruptCount ||
        adapterObservation.resultEventId !== externalRecord.resultEventId ||
        !phaseSourceAuthorityMatches(sourceAuthority, adapterObservation.sourceAuthority) ||
        workerEventReceipt.schemaVersion !== 1 ||
        workerEventReceipt.disposition !== 'ADMITTED' ||
        workerEventReceipt.eventId !== externalRecord.resultEventId ||
        workerEventReceipt.attemptId !== externalRecord.attemptId ||
        workerEventReceipt.workerSessionId !== externalRecord.workerSessionId ||
        workerEventReceipt.workflowId !== externalRecord.workflowId ||
        workerEventReceipt.observedWorkflowVersion !==
          externalRecord.workflowVersionAtAuthorization ||
        workerEventReceipt.contextManifestId !== externalRecord.contextManifestId ||
        workerEventReceipt.contextManifestDigest !== externalRecord.contextManifestDigest ||
        workerEventReceipt.packageDigest !== externalRecord.contextPackageDigest ||
        workerEventReceipt.receivedAt !== attempt.endedAt ||
        !digestPattern.test(workerEventReceipt.payloadDigest) ||
        typeof workerEventReceipt.internalCommandId !== 'string' ||
        workerEventReceipt.internalCommandId.length === 0 ||
        resultKind === undefined
      ) {
        fail('Live composition phase authority tuple is incomplete, substituted, or unlinked');
      }
      if (
        !phaseContextSourceMatches(
          contextManifest,
          sourceAuthority,
          projectReadAuthority,
          candidate,
        ) ||
        (sourceAuthority.kind === 'PROJECT_READ'
          ? projectReadAuthority.goalId !== contextManifest.goalId ||
            projectReadAuthority.goalRevision !== contextManifest.goalRevision ||
            projectReadAuthority.workflowId !== contextManifest.workflowId ||
            projectReadAuthority.workflowVersion !== contextManifest.workflowVersion ||
            projectReadAuthority.attemptId !== attempt.id ||
            projectReadAuthority.phase !== attempt.phase ||
            projectReadAuthority.phaseDispatchEntryDigest !== binding.phaseEntryDigest ||
            projectReadAuthority.executionProfileId !== profile.execution.id ||
            projectReadAuthority.executionProfileVersion !== profile.execution.version ||
            projectReadAuthority.executionProfileDigest !== profile.execution.digest ||
            projectReadAuthority.policyBundleId !== profile.workflowPolicy.id ||
            projectReadAuthority.policyBundleVersion !== profile.workflowPolicy.version ||
            projectReadAuthority.policyBundleDigest !== profile.workflowPolicy.digest
          : m251LiveCompositionReferenceDigest('goal', externalRecord.goalId) !==
            candidate.goalRefDigest)
      ) {
        fail('Live composition phase source authority is not the exact selected source');
      }
      return Object.freeze({
        phase: externalRecord.phase,
        workerKind: 'REAL_CODEX',
        sourceKind: sourceAuthority.kind,
        phaseEntryDigest: externalRecord.phaseDispatchEntryDigest,
        attemptRefDigest: m251LiveCompositionReferenceDigest('attempt', attempt.id),
        contextManifestRefDigest: m251LiveCompositionReferenceDigest(
          'context-manifest',
          contextManifest.id,
        ),
        contextManifestDigest: contextManifest.manifestDigest,
        contextPackageDigest: contextManifest.packageDigest,
        verificationPlanRefDigest: m251LiveCompositionReferenceDigest(
          'verification-plan',
          contextManifest.acceptanceCriticalVerificationPlanId,
        ),
        verificationPlanDigest: contextManifest.acceptanceCriticalVerificationPlanDigest,
        externalIntentRefDigest: m251LiveCompositionReferenceDigest(
          'external-execution-intent',
          externalRecord.id,
        ),
        externalIntentDigest: externalRecord.intentDigest,
        externalRecordRefDigest: m251LiveCompositionReferenceDigest(
          'external-execution-record',
          externalRecord.id,
        ),
        externalRecordDigest: externalRecord.recordDigest,
        directiveSchemaVersion: 3,
        directiveDigest: adapterObservation.directiveDigest,
        observationSchemaVersion: adapterObservation.schemaVersion,
        activityPolicyDigest: adapterObservation.workerActivityPolicyDigest,
        terminalStatus: attempt.status,
        resultKind,
        processLaunchCount: adapterObservation.processLaunchCount,
        backendSessionRefDigest: m251LiveCompositionReferenceDigest(
          'backend-session',
          externalRecord.backendSessionRef,
        ),
        backendOperationRefDigest: m251LiveCompositionReferenceDigest(
          'backend-operation',
          externalRecord.backendOperationRef,
        ),
        resultEventRefDigest: m251LiveCompositionReferenceDigest(
          'worker-result-event',
          workerEventReceipt.eventId,
        ),
        compactionCount: externalRecord.compactionCount,
        turnInterruptCount: externalRecord.turnInterruptCount,
        sourceAuthorityRefDigest: m251LiveCompositionReferenceDigest(
          sourceAuthority.kind === 'PROJECT_READ'
            ? 'project-read-authority'
            : 'candidate-workspace-lease',
          sourceAuthority.kind === 'PROJECT_READ'
            ? sourceAuthority.projectReadAuthorityId
            : sourceAuthority.candidateWorkspaceLeaseId,
        ),
        sourceAuthorityDigest:
          sourceAuthority.kind === 'PROJECT_READ'
            ? sourceAuthority.projectReadAuthorityRecordDigest
            : sourceAuthority.candidateWorkspaceLeaseDigest,
        projectReadSnapshotDigest:
          sourceAuthority.kind === 'PROJECT_READ' ? projectReadAuthority.snapshotTreeDigest : null,
        candidateGenerationRefDigest:
          sourceAuthority.kind === 'CANDIDATE' ? candidate.generationRefDigest : null,
        sourceCurrencyChecked: true,
        forbiddenActivityObserved: false,
        fakeFallbackUsed: false,
      });
    }),
  );
  validatePhases(projected, profile, candidate);
  return projected;
}

export function projectM251LiveCompositionVerification(input, candidate, project) {
  const { plan, evidence } = input;
  const check = evidence.checkSpec;
  const protectedAsset = plan.protectedAssets?.find(
    ({ logicalAssetId }) => logicalAssetId === expectedProject.protectedCheck.id,
  );
  if (
    plan.schemaVersion !== 1 ||
    check?.schemaVersion !== 3 ||
    evidence.schemaVersion !== 3 ||
    protectedAsset === undefined ||
    check.acceptanceCriticalVerificationPlanId !== plan.id ||
    check.acceptanceCriticalVerificationPlanDigest !== plan.planDigest ||
    evidence.acceptanceCriticalVerificationPlanId !== plan.id ||
    evidence.acceptanceCriticalVerificationPlanDigest !== plan.planDigest
  ) {
    fail('Live composition protected verification authority is incomplete or substituted');
  }
  const projected = Object.freeze({
    planRefDigest: m251LiveCompositionReferenceDigest('verification-plan', plan.id),
    planDigest: plan.planDigest,
    checkRefDigest: m251LiveCompositionReferenceDigest('verification-check', check.id),
    checkId: protectedAsset.logicalAssetId,
    checkVersion: check.version,
    protectedAssetDigest: protectedAsset.contentDigest,
    runnerId: check.runnerIdentity,
    runnerVersion: check.runnerVersion,
    candidateGenerationRefDigest: m251LiveCompositionReferenceDigest(
      'candidate-generation',
      evidence.candidateGenerationId,
    ),
    candidateDigest: evidence.candidateDigest,
    result: evidence.resultStatus,
    exitCode: evidence.observation?.exitCode,
  });
  validateVerification(projected, candidate, project);
  return projected;
}

export function projectM251LiveCompositionEvidence(input, candidate, verification) {
  const { evidenceSet, freezeEvidence, verificationEvidence } = input;
  const retainedEntries = new Map(
    evidenceSet.evidenceRefs?.map((entry) => [entry.evidenceId, entry.evidenceRecordDigest]),
  );
  if (
    evidenceSet.schemaVersion !== 1 ||
    evidenceSet.candidateGenerationId !== freezeEvidence.candidateGenerationId ||
    evidenceSet.candidateGenerationId !== verificationEvidence.candidateGenerationId ||
    evidenceSet.candidateDigest !== freezeEvidence.candidateDigest ||
    evidenceSet.candidateDigest !== verificationEvidence.candidateDigest ||
    evidenceSet.candidateDigest !== candidate.firstSourceDigest ||
    retainedEntries.size !== 1 ||
    retainedEntries.has(freezeEvidence.id) ||
    retainedEntries.get(verificationEvidence.id) !== verificationEvidence.recordDigest
  ) {
    fail('Live composition Candidate-freeze and Acceptance Evidence authorities are not separated');
  }
  const projected = Object.freeze({
    acceptanceEvidenceCount: retainedEntries.size,
    candidateFreezeEvidenceRefDigest: m251LiveCompositionReferenceDigest(
      'candidate-freeze-evidence',
      freezeEvidence.id,
    ),
    candidateFreezeEvidenceDigest: freezeEvidence.recordDigest,
    verificationEvidenceRefDigest: m251LiveCompositionReferenceDigest(
      'protected-verification-evidence',
      verificationEvidence.id,
    ),
    verificationEvidenceDigest: verificationEvidence.recordDigest,
    evidenceSetDigest: evidenceSet.digest,
    candidateGenerationRefDigest: m251LiveCompositionReferenceDigest(
      'candidate-generation',
      evidenceSet.candidateGenerationId,
    ),
    verificationCheckRefDigest: m251LiveCompositionReferenceDigest(
      'verification-check',
      verificationEvidence.checkSpec.id,
    ),
  });
  validateEvidence(projected, candidate, verification);
  return projected;
}

export function projectM251LiveCompositionAcceptance(
  input,
  goal,
  candidate,
  evidence,
  verification,
  profile,
) {
  const { manifest, decision, policyBundle } = input;
  if (
    manifest.schemaVersion !== 2 ||
    decision.schemaVersion !== 1 ||
    policyBundle.schemaVersion !== 1 ||
    decision.inputManifestDigest !== manifest.manifestDigest ||
    decision.policyBundleDigest !== manifest.policyBundleDigest ||
    policyBundle.digest !== manifest.policyBundleDigest ||
    !Array.isArray(policyBundle.checkerVersions) ||
    policyBundle.checkerVersions.length !== 1
  ) {
    fail('Live composition Acceptance authority chain is incomplete or substituted');
  }
  const checker = policyBundle.checkerVersions[0];
  const projected = Object.freeze({
    inputManifestDigest: manifest.manifestDigest,
    manifestSchemaVersion: manifest.schemaVersion,
    manifestPhase: manifest.phase,
    goalRefDigest: m251LiveCompositionReferenceDigest('goal', manifest.goalId),
    goalRevision: manifest.goalRevision,
    workflowRefDigest: m251LiveCompositionReferenceDigest('workflow', manifest.workflowId),
    workflowVersion: manifest.workflowVersion,
    candidateGenerationRefDigest: m251LiveCompositionReferenceDigest(
      'candidate-generation',
      manifest.candidateGenerationId,
    ),
    candidateDigest: manifest.candidateDigest,
    evidenceSetDigest: manifest.evidenceSetDigest,
    policyId: manifest.policyBundleId,
    policyVersion: policyBundle.version,
    policyDigest: manifest.policyBundleDigest,
    verificationPlanRefDigest: m251LiveCompositionReferenceDigest(
      'verification-plan',
      manifest.acceptanceCriticalVerificationPlanId,
    ),
    verificationPlanDigest: manifest.acceptanceCriticalVerificationPlanDigest,
    decisionRefDigest: m251LiveCompositionReferenceDigest('acceptance-decision', decision.id),
    decisionDigest: decision.decisionDigest,
    decisionInputManifestDigest: decision.inputManifestDigest,
    decisionPolicyDigest: decision.policyBundleDigest,
    outcome: decision.outcome,
    checkerVersion: checker?.checkerVersion,
  });
  validateAcceptance(projected, goal, candidate, evidence, verification, profile);
  return projected;
}

export function projectM251LiveCompositionCloseout(input, goal, candidate, acceptance) {
  const { workflow, closeout, finalStatus } = input;
  if (
    workflow.id !== closeout.workflowId ||
    workflow.goalId !== closeout.goalId ||
    workflow.goalRevision !== closeout.goalRevision ||
    workflow.version !== closeout.workflowVersion ||
    finalStatus.goalId !== closeout.goalId ||
    finalStatus.workflowId !== closeout.workflowId ||
    finalStatus.workflowVersion !== closeout.workflowVersion ||
    finalStatus.acceptanceSummary?.decisionId !== closeout.acceptanceDecisionId ||
    finalStatus.acceptanceSummary?.decisionDigest !== closeout.acceptanceDecisionDigest ||
    finalStatus.closeoutRef?.candidateGenerationId !== closeout.candidateGenerationId ||
    finalStatus.closeoutRef?.acceptanceDecisionId !== closeout.acceptanceDecisionId
  ) {
    fail('Live composition closeout authority and final status are not cross-bound');
  }
  const projected = Object.freeze({
    workflowPhase: workflow.phase,
    runStatus: workflow.runStatus,
    technicalCloseout: finalStatus.technicalCloseout,
    goalRefDigest: m251LiveCompositionReferenceDigest('goal', closeout.goalId),
    goalRevision: closeout.goalRevision,
    workflowRefDigest: m251LiveCompositionReferenceDigest('workflow', closeout.workflowId),
    workflowVersion: closeout.workflowVersion,
    candidateGenerationRefDigest: m251LiveCompositionReferenceDigest(
      'candidate-generation',
      closeout.candidateGenerationId,
    ),
    candidateDigest: closeout.candidateDigest,
    acceptanceDecisionRefDigest: m251LiveCompositionReferenceDigest(
      'acceptance-decision',
      closeout.acceptanceDecisionId,
    ),
    acceptanceDecisionDigest: closeout.acceptanceDecisionDigest,
    inputManifestDigest: closeout.inputManifestDigest,
    evidenceSetDigest: closeout.evidenceSetDigest,
    policyId: closeout.policyBundleId,
    policyDigest: closeout.policyBundleDigest,
    finalStatusProjectionDigest: goal.finalStatusProjectionDigest,
  });
  validateCloseout(projected, goal, candidate, acceptance);
  return projected;
}

export function projectM251LiveCompositionReopen(input, goal, phases, closeout) {
  const projected = Object.freeze({
    goalFound: input.goalFound,
    technicalCloseout: input.technicalCloseout,
    finalStatusProjectionDigest: input.finalStatusProjectionDigest,
    phaseReceiptSetDigest: m251LiveDigest(
      'codeclosure-m2-5-1-live-composition-phase-receipts-v1',
      phases,
    ),
    intakeCommandStatus: input.intakeCommandStatus,
    startCommandStatus: input.startCommandStatus,
    assistantOperationDelta: nonNegativeInteger(
      input.assistantOperationDelta,
      'Reopen Assistant operation delta',
    ),
    workerDispatchDelta: nonNegativeInteger(
      input.workerDispatchDelta,
      'Reopen Worker dispatch delta',
    ),
    modelRecallCount: nonNegativeInteger(input.modelRecallCount, 'Reopen model recall count'),
  });
  validateReopen(projected, goal, phases, closeout);
  return projected;
}

export function projectM251LiveCompositionCleanup(observation) {
  const projected = Object.freeze({
    ownedProcessesShutdownClean: observation.ownedProcessesShutdownClean,
    intakeExecutionRootRemoved: observation.intakeExecutionRootRemoved,
    workerControlledRootsRemoved: observation.workerControlledRootsRemoved,
    projectReadSnapshotsRemoved: observation.projectReadSnapshotsRemoved,
    candidateWorkspaceRemoved: observation.candidateWorkspaceRemoved,
    verificationRunRootRemoved: observation.verificationRunRootRemoved,
    authorityHomeRemoved: observation.authorityHomeRemoved,
    assessmentRootRemoved: observation.assessmentRootRemoved,
    credentialRootUnchanged: observation.credentialRootUnchanged,
    protectedAssetRootUnchanged: observation.protectedAssetRootUnchanged,
    sourceUnchanged: observation.sourceUnchanged,
  });
  validateCleanup(projected);
  return projected;
}

function validateStages(value) {
  if (!Array.isArray(value) || value.length !== M251_LIVE_COMPOSITION_STAGE_IDS.length) {
    fail('Live composition stage set is incomplete');
  }
  value.forEach((stage, index) => {
    exactKeys(stage, ['stageId', 'status'], 'Live composition stage');
    if (stage.stageId !== M251_LIVE_COMPOSITION_STAGE_IDS[index] || stage.status !== 'PASSED') {
      fail('Live composition stages are not complete and canonical');
    }
  });
}

function validateToolchain(value) {
  exactKeys(
    value,
    [
      'nodeVersion',
      'pnpmVersion',
      'codexVersion',
      'protocolSnapshotDigest',
      'launcherDigest',
      'delegatedExecutableDigest',
      'intakeAssistantProfileVersion',
      'intakeAssistantAdapterVersion',
      'intakeConfigurationVersion',
      'intakeProjectionVersion',
    ],
    'Live composition toolchain',
  );
  if (!/^v22\.\d+\.\d+$/u.test(string(value.nodeVersion, 'Node version'))) {
    fail('Live composition requires Node 22');
  }
  if (!/^11\.\d+\.\d+$/u.test(string(value.pnpmVersion, 'pnpm version'))) {
    fail('Live composition requires pnpm 11');
  }
  const exact = {
    codexVersion: expectedToolchain.codexVersion,
    protocolSnapshotDigest: expectedToolchain.snapshotDigest,
    launcherDigest: expectedToolchain.launcherDigest,
    delegatedExecutableDigest: expectedToolchain.delegatedExecutableDigest,
    intakeAssistantProfileVersion: expectedIntake.assistantProfile.version,
    intakeAssistantAdapterVersion: expectedIntake.assistantAdapter.version,
    intakeConfigurationVersion: expectedIntake.closedConfiguration.version,
    intakeProjectionVersion: expectedIntake.protocolProjectionPolicy.version,
  };
  for (const [field, expected] of Object.entries(exact)) {
    if (value[field] !== expected) {
      fail(`Live composition toolchain ${field} is not the frozen identity`);
    }
  }
}

function validateProfile(value) {
  exactKeys(
    value,
    ['activationKind', 'execution', 'workflowPolicy', 'workerActivityPolicy', 'phaseBindings'],
    'Live composition Profile',
  );
  if (value.activationKind !== 'REAL_CODEX') {
    fail('Live composition Profile is not the real Codex activation');
  }
  exactKeys(value.execution, ['id', 'version', 'digest'], 'Execution Profile identity');
  if (
    value.execution.id !== expectedExecution.executionProfile.id ||
    value.execution.version !== expectedExecution.executionProfile.version
  ) {
    fail('Live composition Execution Profile identity is invalid');
  }
  digest(value.execution.digest, 'Execution Profile digest');
  exactKeys(value.workflowPolicy, ['id', 'version', 'digest'], 'Workflow Policy identity');
  if (
    value.workflowPolicy.id !== expectedExecution.workflowPolicy.id ||
    value.workflowPolicy.version !== expectedExecution.workflowPolicy.version
  ) {
    fail('Live composition Workflow Policy identity is invalid');
  }
  digest(value.workflowPolicy.digest, 'Workflow Policy digest');
  exactKeys(
    value.workerActivityPolicy,
    ['id', 'version', 'digest'],
    'Worker activity Policy identity',
  );
  if (
    value.workerActivityPolicy.id !== expectedExecution.workerActivityPolicy.id ||
    value.workerActivityPolicy.version !== expectedExecution.workerActivityPolicy.version
  ) {
    fail('Live composition Worker activity Policy identity is invalid');
  }
  digest(value.workerActivityPolicy.digest, 'Worker activity Policy digest');
  if (!Array.isArray(value.phaseBindings) || value.phaseBindings.length !== 3) {
    fail('Live composition phase Profile is incomplete');
  }
  value.phaseBindings.forEach((binding, index) => {
    exactKeys(
      binding,
      ['phase', 'workerKind', 'sourceKind', 'adapterId', 'adapterVersion', 'phaseEntryDigest'],
      'Live composition phase Profile binding',
    );
    const expected = M251_LIVE_COMPOSITION_PHASES[index];
    if (
      expected === undefined ||
      binding.phase !== expected.phase ||
      binding.workerKind !== 'REAL_CODEX' ||
      binding.sourceKind !== expected.sourceKind ||
      binding.adapterId !== 'codex-app-server-worker' ||
      binding.adapterVersion !== 'codeclosure-m2-5-1-worker-v1'
    ) {
      fail('Live composition phase Profile contains a fake or substituted component');
    }
    digest(binding.phaseEntryDigest, `${binding.phase} Profile entry digest`);
  });
}

function validateProject(value) {
  exactKeys(
    value,
    [
      'projectFamily',
      'gitCommit',
      'gitTree',
      'sourceTreeDigest',
      'sourceGitMetadataDigest',
      'selectedSourcePathCount',
      'selectedSourcePathsDigest',
      'allowedPathCount',
      'allowedPathsDigest',
      'protectedCheck',
    ],
    'Live composition project identity',
  );
  const projected = projectM251LiveCompositionProjectIdentity(
    expectedProjectContract,
    expectedProject.protectedCheck,
  );
  assertExactIdentity(value, projected, 'Live composition project identity');
}

function validateIntake(value, goal, profile) {
  exactKeys(
    value,
    [
      'intakeRunRefDigest',
      'submitCommandRefDigest',
      'clarificationCommandRefDigest',
      'questionRefDigest',
      'initialOutcomeKind',
      'initialStatus',
      'questionFields',
      'clarificationOutcomeKind',
      'finalStatus',
      'assistantOperationCount',
      'materializedGoalRefDigest',
      'startAuthorizationRefDigest',
      'authorizedProfileDigest',
    ],
    'Live composition Intake projection',
  );
  for (const field of [
    'intakeRunRefDigest',
    'submitCommandRefDigest',
    'clarificationCommandRefDigest',
    'questionRefDigest',
  ]) {
    digest(value[field], `Intake ${field}`);
  }
  if (
    value.initialOutcomeKind !== 'CLARIFICATION_REQUIRED' ||
    value.initialStatus !== 'NEEDS_CLARIFICATION' ||
    JSON.stringify(value.questionFields) !== JSON.stringify(['REQUIRED_CRITERION']) ||
    value.clarificationOutcomeKind !== 'MATERIALIZED' ||
    value.finalStatus !== 'MATERIALIZED' ||
    value.assistantOperationCount !== 2 ||
    value.materializedGoalRefDigest !== goal.goalRefDigest ||
    value.startAuthorizationRefDigest !== goal.startAuthorizationRefDigest ||
    value.authorizedProfileDigest !== profile.execution.digest
  ) {
    fail('Live composition Intake did not retain the exact clarification/materialization chain');
  }
}

function validateGoal(value, profile) {
  exactKeys(
    value,
    [
      'goalRefDigest',
      'goalRevision',
      'workflowRefDigest',
      'workflowVersion',
      'startAuthorizationRefDigest',
      'startCommandRefDigest',
      'startCommandStatus',
      'executionProfileId',
      'executionProfileVersion',
      'executionProfileDigest',
      'finalStatusProjectionDigest',
    ],
    'Live composition Goal projection',
  );
  for (const field of [
    'goalRefDigest',
    'workflowRefDigest',
    'startAuthorizationRefDigest',
    'startCommandRefDigest',
    'executionProfileDigest',
    'finalStatusProjectionDigest',
  ]) {
    digest(value[field], `Goal ${field}`);
  }
  positiveInteger(value.goalRevision, 'Goal revision');
  positiveInteger(value.workflowVersion, 'Workflow version');
  if (
    value.startCommandStatus !== 'APPLIED' ||
    value.executionProfileId !== profile.execution.id ||
    value.executionProfileVersion !== profile.execution.version ||
    value.executionProfileDigest !== profile.execution.digest
  ) {
    fail('Live composition Goal did not bind the admitted real Profile and ordinary Start');
  }
}

function validatePhases(value, profile, candidate) {
  if (!Array.isArray(value) || value.length !== M251_LIVE_COMPOSITION_PHASES.length) {
    fail('Live composition phase receipt set is incomplete');
  }
  const uniqueReferences = new Set();
  value.forEach((phase, index) => {
    exactKeys(
      phase,
      [
        'phase',
        'workerKind',
        'sourceKind',
        'phaseEntryDigest',
        'attemptRefDigest',
        'contextManifestRefDigest',
        'contextManifestDigest',
        'contextPackageDigest',
        'verificationPlanRefDigest',
        'verificationPlanDigest',
        'externalIntentRefDigest',
        'externalIntentDigest',
        'externalRecordRefDigest',
        'externalRecordDigest',
        'directiveSchemaVersion',
        'directiveDigest',
        'observationSchemaVersion',
        'activityPolicyDigest',
        'terminalStatus',
        'resultKind',
        'processLaunchCount',
        'backendSessionRefDigest',
        'backendOperationRefDigest',
        'resultEventRefDigest',
        'compactionCount',
        'turnInterruptCount',
        'sourceAuthorityRefDigest',
        'sourceAuthorityDigest',
        'projectReadSnapshotDigest',
        'candidateGenerationRefDigest',
        'sourceCurrencyChecked',
        'forbiddenActivityObserved',
        'fakeFallbackUsed',
      ],
      'Live composition phase receipt',
    );
    const expected = M251_LIVE_COMPOSITION_PHASES[index];
    const binding = profile.phaseBindings[index];
    if (
      expected === undefined ||
      binding === undefined ||
      phase.phase !== expected.phase ||
      phase.workerKind !== 'REAL_CODEX' ||
      phase.sourceKind !== expected.sourceKind ||
      phase.phaseEntryDigest !== binding.phaseEntryDigest ||
      phase.directiveSchemaVersion !== 3 ||
      phase.observationSchemaVersion !== 2 ||
      phase.activityPolicyDigest !== profile.workerActivityPolicy.digest ||
      phase.terminalStatus !== 'RESULT_RECORDED' ||
      phase.resultKind !== expected.resultKind ||
      phase.processLaunchCount !== 1 ||
      phase.compactionCount !== 0 ||
      phase.turnInterruptCount !== 0 ||
      phase.sourceCurrencyChecked !== true ||
      phase.forbiddenActivityObserved !== false ||
      phase.fakeFallbackUsed !== false
    ) {
      fail('Live composition phase receipt is incomplete, substituted, or not real Codex');
    }
    for (const field of [
      'attemptRefDigest',
      'contextManifestRefDigest',
      'externalIntentRefDigest',
      'externalRecordRefDigest',
    ]) {
      const reference = digest(phase[field], `${phase.phase} ${field}`);
      if (uniqueReferences.has(reference)) {
        fail('Live composition phase receipt reused an authority reference');
      }
      uniqueReferences.add(reference);
    }
    for (const field of [
      'externalIntentDigest',
      'contextManifestDigest',
      'contextPackageDigest',
      'verificationPlanRefDigest',
      'verificationPlanDigest',
      'externalRecordDigest',
      'directiveDigest',
      'backendSessionRefDigest',
      'backendOperationRefDigest',
      'resultEventRefDigest',
      'sourceAuthorityRefDigest',
      'sourceAuthorityDigest',
    ]) {
      digest(phase[field], `${phase.phase} ${field}`);
    }
    if (expected.sourceKind === 'PROJECT_READ') {
      digest(phase.projectReadSnapshotDigest, `${phase.phase} ProjectRead snapshot digest`);
      if (phase.candidateGenerationRefDigest !== null) {
        fail('Candidate-free phase reported Candidate authority');
      }
    } else {
      if (
        phase.projectReadSnapshotDigest !== null ||
        phase.candidateGenerationRefDigest !== candidate.generationRefDigest
      ) {
        fail('IMPLEMENT phase did not bind the exact Candidate exclusively');
      }
    }
  });
}

function validatePhaseVerificationBinding(phases, verification) {
  if (
    phases.some(
      (phase) =>
        phase.verificationPlanRefDigest !== verification.planRefDigest ||
        phase.verificationPlanDigest !== verification.planDigest,
    )
  ) {
    fail('Live composition phase Context is not bound to protected verification');
  }
}

function validateCandidate(value, goal) {
  exactKeys(
    value,
    [
      'candidateRefDigest',
      'generationRefDigest',
      'goalRefDigest',
      'state',
      'freezeSchemaVersion',
      'baseSourceDigest',
      'firstSourceDigest',
      'secondSourceDigest',
      'changeSetDigest',
      'allowedPathPolicyDigest',
      'changedPathCount',
      'addedPathCount',
      'modifiedPathCount',
      'deletedPathCount',
      'changedPathsDigest',
      'sourceGitCommit',
      'sourceGitTree',
    ],
    'Live composition Candidate projection',
  );
  for (const field of [
    'candidateRefDigest',
    'generationRefDigest',
    'baseSourceDigest',
    'firstSourceDigest',
    'secondSourceDigest',
    'changeSetDigest',
    'allowedPathPolicyDigest',
    'changedPathsDigest',
  ]) {
    digest(value[field], `Candidate ${field}`);
  }
  if (
    value.goalRefDigest !== goal.goalRefDigest ||
    value.state !== 'ACCEPTED' ||
    value.freezeSchemaVersion !== 2 ||
    value.firstSourceDigest !== value.secondSourceDigest ||
    value.changedPathCount !== 1 ||
    value.addedPathCount !== 0 ||
    value.modifiedPathCount !== 1 ||
    value.deletedPathCount !== 0 ||
    value.changedPathsDigest !==
      m251LiveDigest('codeclosure-m2-5-1-live-composition-changed-paths-v1', ['src/payment.js']) ||
    value.sourceGitCommit !== expectedProject.gitCommit ||
    value.sourceGitTree !== expectedProject.gitTree
  ) {
    fail('Live composition Candidate change identity is invalid or out of scope');
  }
}

function validateVerification(value, candidate, project) {
  exactKeys(
    value,
    [
      'planRefDigest',
      'planDigest',
      'checkRefDigest',
      'checkId',
      'checkVersion',
      'protectedAssetDigest',
      'runnerId',
      'runnerVersion',
      'candidateGenerationRefDigest',
      'candidateDigest',
      'result',
      'exitCode',
    ],
    'Live composition verification projection',
  );
  for (const field of ['planRefDigest', 'planDigest', 'checkRefDigest', 'candidateDigest']) {
    digest(value[field], `Verification ${field}`);
  }
  if (
    value.checkId !== project.protectedCheck.id ||
    value.checkVersion !== project.protectedCheck.version ||
    value.protectedAssetDigest !== project.protectedCheck.assetDigest ||
    value.runnerId !== 'protected-local-verification' ||
    value.runnerVersion !== 'v1' ||
    value.candidateGenerationRefDigest !== candidate.generationRefDigest ||
    value.candidateDigest !== candidate.firstSourceDigest ||
    value.result !== 'PASSED' ||
    value.exitCode !== 0
  ) {
    fail('Live composition protected verification identity or result is invalid');
  }
}

function validateEvidence(value, candidate, verification) {
  exactKeys(
    value,
    [
      'acceptanceEvidenceCount',
      'candidateFreezeEvidenceRefDigest',
      'candidateFreezeEvidenceDigest',
      'verificationEvidenceRefDigest',
      'verificationEvidenceDigest',
      'evidenceSetDigest',
      'candidateGenerationRefDigest',
      'verificationCheckRefDigest',
    ],
    'Live composition Evidence projection',
  );
  for (const field of [
    'candidateFreezeEvidenceRefDigest',
    'candidateFreezeEvidenceDigest',
    'verificationEvidenceRefDigest',
    'verificationEvidenceDigest',
    'evidenceSetDigest',
  ]) {
    digest(value[field], `Evidence ${field}`);
  }
  if (
    value.acceptanceEvidenceCount !== 1 ||
    value.candidateFreezeEvidenceRefDigest === value.verificationEvidenceRefDigest ||
    value.candidateGenerationRefDigest !== candidate.generationRefDigest ||
    value.verificationCheckRefDigest !== verification.checkRefDigest
  ) {
    fail('Live composition Evidence authorities are incomplete or incorrectly bound');
  }
}

function validateAcceptance(value, goal, candidate, evidence, verification, profile) {
  exactKeys(
    value,
    [
      'inputManifestDigest',
      'manifestSchemaVersion',
      'manifestPhase',
      'goalRefDigest',
      'goalRevision',
      'workflowRefDigest',
      'workflowVersion',
      'candidateGenerationRefDigest',
      'candidateDigest',
      'evidenceSetDigest',
      'policyId',
      'policyVersion',
      'policyDigest',
      'verificationPlanRefDigest',
      'verificationPlanDigest',
      'decisionRefDigest',
      'decisionDigest',
      'decisionInputManifestDigest',
      'decisionPolicyDigest',
      'outcome',
      'checkerVersion',
    ],
    'Live composition Acceptance projection',
  );
  for (const field of [
    'inputManifestDigest',
    'goalRefDigest',
    'workflowRefDigest',
    'candidateGenerationRefDigest',
    'candidateDigest',
    'evidenceSetDigest',
    'policyDigest',
    'verificationPlanRefDigest',
    'verificationPlanDigest',
    'decisionRefDigest',
    'decisionDigest',
    'decisionInputManifestDigest',
    'decisionPolicyDigest',
  ]) {
    digest(value[field], `Acceptance ${field}`);
  }
  if (
    value.manifestSchemaVersion !== 2 ||
    value.manifestPhase !== 'FINAL_VERIFY' ||
    value.outcome !== 'ACCEPT' ||
    value.goalRefDigest !== goal.goalRefDigest ||
    value.goalRevision !== goal.goalRevision ||
    value.workflowRefDigest !== goal.workflowRefDigest ||
    value.candidateGenerationRefDigest !== candidate.generationRefDigest ||
    value.candidateDigest !== candidate.firstSourceDigest ||
    value.evidenceSetDigest !== evidence.evidenceSetDigest ||
    value.policyId !== profile.workflowPolicy.id ||
    value.policyVersion !== profile.workflowPolicy.version ||
    value.policyDigest !== profile.workflowPolicy.digest ||
    value.verificationPlanRefDigest !== verification.planRefDigest ||
    value.verificationPlanDigest !== verification.planDigest ||
    value.decisionInputManifestDigest !== value.inputManifestDigest ||
    value.decisionPolicyDigest !== value.policyDigest
  ) {
    fail('Live composition Acceptance identity or authority binding is invalid');
  }
  positiveInteger(value.goalRevision, 'Acceptance Goal revision');
  positiveInteger(value.workflowVersion, 'Acceptance Workflow version');
  string(value.policyId, 'Acceptance Policy ID');
  string(value.policyVersion, 'Acceptance Policy version');
  string(value.checkerVersion, 'Acceptance checker version');
}

function validateCloseout(value, goal, candidate, acceptance) {
  exactKeys(
    value,
    [
      'workflowPhase',
      'runStatus',
      'technicalCloseout',
      'goalRefDigest',
      'goalRevision',
      'workflowRefDigest',
      'workflowVersion',
      'candidateGenerationRefDigest',
      'candidateDigest',
      'acceptanceDecisionRefDigest',
      'acceptanceDecisionDigest',
      'inputManifestDigest',
      'evidenceSetDigest',
      'policyId',
      'policyDigest',
      'finalStatusProjectionDigest',
    ],
    'Live composition closeout projection',
  );
  if (
    value.workflowPhase !== 'CLOSEOUT' ||
    value.runStatus !== 'CLOSED' ||
    value.technicalCloseout !== true ||
    value.goalRefDigest !== goal.goalRefDigest ||
    value.goalRevision !== goal.goalRevision ||
    value.workflowRefDigest !== goal.workflowRefDigest ||
    value.workflowVersion !== goal.workflowVersion ||
    value.candidateGenerationRefDigest !== candidate.generationRefDigest ||
    value.candidateDigest !== candidate.firstSourceDigest ||
    value.acceptanceDecisionRefDigest !== acceptance.decisionRefDigest ||
    value.acceptanceDecisionDigest !== acceptance.decisionDigest ||
    value.inputManifestDigest !== acceptance.inputManifestDigest ||
    value.evidenceSetDigest !== acceptance.evidenceSetDigest ||
    value.policyId !== acceptance.policyId ||
    value.policyDigest !== acceptance.policyDigest ||
    value.finalStatusProjectionDigest !== goal.finalStatusProjectionDigest
  ) {
    fail('Live composition closeout is not bound to the accepted Goal authority');
  }
}

function validateReopen(value, goal, phases, closeout) {
  exactKeys(
    value,
    [
      'goalFound',
      'technicalCloseout',
      'finalStatusProjectionDigest',
      'phaseReceiptSetDigest',
      'intakeCommandStatus',
      'startCommandStatus',
      'assistantOperationDelta',
      'workerDispatchDelta',
      'modelRecallCount',
    ],
    'Live composition reopen projection',
  );
  if (
    value.goalFound !== true ||
    value.technicalCloseout !== true ||
    value.finalStatusProjectionDigest !== goal.finalStatusProjectionDigest ||
    value.finalStatusProjectionDigest !== closeout.finalStatusProjectionDigest ||
    value.phaseReceiptSetDigest !==
      m251LiveDigest('codeclosure-m2-5-1-live-composition-phase-receipts-v1', phases) ||
    value.intakeCommandStatus !== 'REPLAYED' ||
    value.startCommandStatus !== 'REPLAYED' ||
    value.assistantOperationDelta !== 0 ||
    value.workerDispatchDelta !== 0 ||
    value.modelRecallCount !== 0
  ) {
    fail('Live composition reopen recalled, redispatched, drifted, or failed strict replay');
  }
}

function validateCleanup(value) {
  exactKeys(
    value,
    [
      'ownedProcessesShutdownClean',
      'intakeExecutionRootRemoved',
      'workerControlledRootsRemoved',
      'projectReadSnapshotsRemoved',
      'candidateWorkspaceRemoved',
      'verificationRunRootRemoved',
      'authorityHomeRemoved',
      'assessmentRootRemoved',
      'credentialRootUnchanged',
      'protectedAssetRootUnchanged',
      'sourceUnchanged',
    ],
    'Live composition cleanup projection',
  );
  if (Object.values(value).some((selected) => selected !== true)) {
    fail('Live composition cleanup is incomplete');
  }
}

export function assertM251LiveCompositionMetadataOnly(value, forbiddenStrings = []) {
  const serialized = JSON.stringify(value);
  const forbiddenKeys = [
    'request',
    'clarificationAnswer',
    'answer',
    'answerContent',
    'assistantContent',
    'modelText',
    'modelOutput',
    'reasoning',
    'transcript',
    'rawNotification',
    'rawProtocolPayload',
    'rawPayload',
    'rawException',
    'exception',
    'authSource',
    'credential',
    'credentials',
    'account',
    'accountId',
    'rateLimit',
    'sourceBytes',
    'fileContent',
    'commandOutput',
    'stdout',
    'stderr',
  ];
  const keyPattern = new RegExp(`"(?:${forbiddenKeys.join('|')})"\\s*:`, 'u');
  if (keyPattern.test(serialized)) {
    fail('Live composition receipt contains a prohibited content-bearing field');
  }
  const prohibitedValues = [
    M251_LIVE_COMPOSITION_SCENARIO.request,
    M251_LIVE_COMPOSITION_SCENARIO.clarificationAnswer,
    expectedProject.expectedResult,
    ...forbiddenStrings,
  ];
  for (const forbidden of prohibitedValues) {
    if (typeof forbidden === 'string' && forbidden.length > 0 && serialized.includes(forbidden)) {
      fail(
        'Live composition receipt contains prohibited request, response, source, or credential content',
      );
    }
  }
  return value;
}

export function validateM251LiveCompositionReceipt(value, expectedIdentity) {
  exactKeys(
    value,
    [
      'schemaVersion',
      'kind',
      'scenarioId',
      'scenarioDigest',
      'authorization',
      'stages',
      'source',
      'toolchain',
      'profile',
      'project',
      'projectClosure',
      'roots',
      'intake',
      'goal',
      'phases',
      'candidate',
      'verification',
      'evidence',
      'acceptance',
      'closeout',
      'reopen',
      'cleanup',
      'privacy',
    ],
    'M2.5.1 live composition receipt',
  );
  if (
    value.schemaVersion !== 1 ||
    value.kind !== M251_LIVE_COMPOSITION_RECEIPT_KIND ||
    value.scenarioId !== M251_LIVE_COMPOSITION_SCENARIO.id ||
    value.scenarioDigest !== m251LiveCompositionScenarioDigest() ||
    value.authorization !== 'EXPLICIT'
  ) {
    fail('M2.5.1 live composition receipt identity is invalid');
  }
  exactKeys(
    expectedIdentity,
    ['source', 'project', 'roots', 'profile'],
    'Expected live composition identity',
  );
  validateStages(value.stages);
  exactKeys(value.source, ['opening', 'closing'], 'Live composition source closure');
  assertM251LiveCompositionSourceClosure(value.source.opening, value.source.closing);
  sourceIdentity(expectedIdentity.source, 'Expected live composition source identity');
  assertExactIdentity(
    expectedIdentity.source,
    value.source.opening,
    'Expected live composition source identity',
  );
  validateToolchain(value.toolchain);
  validateProfile(value.profile);
  validateProfile(expectedIdentity.profile);
  assertExactIdentity(expectedIdentity.profile, value.profile, 'Live composition Profile identity');
  validateProject(value.project);
  exactKeys(value.projectClosure, ['opening', 'closing'], 'Live composition project closure');
  assertM251LiveCompositionProjectClosure(
    value.projectClosure.opening,
    value.projectClosure.closing,
  );
  validateProjectObservation(
    expectedIdentity.project,
    'Expected live composition project observation',
  );
  assertExactIdentity(
    expectedIdentity.project,
    value.projectClosure.opening,
    'Expected live composition project observation',
  );
  validateRootIdentity(value.roots, 'Live composition root identity');
  assertM251LiveCompositionRootIdentity(expectedIdentity.roots, value.roots);
  validateGoal(value.goal, value.profile);
  validateIntake(value.intake, value.goal, value.profile);
  validateCandidate(value.candidate, value.goal);
  validatePhases(value.phases, value.profile, value.candidate);
  validateVerification(value.verification, value.candidate, value.project);
  validatePhaseVerificationBinding(value.phases, value.verification);
  validateEvidence(value.evidence, value.candidate, value.verification);
  validateAcceptance(
    value.acceptance,
    value.goal,
    value.candidate,
    value.evidence,
    value.verification,
    value.profile,
  );
  validateCloseout(value.closeout, value.goal, value.candidate, value.acceptance);
  validateReopen(value.reopen, value.goal, value.phases, value.closeout);
  validateCleanup(value.cleanup);
  exactKeys(
    value.privacy,
    [
      'requestContentRetained',
      'answerContentRetained',
      'assistantOrModelContentRetained',
      'reasoningOrTranscriptRetained',
      'rawProtocolOrExceptionRetained',
      'credentialOrAccountContentRetained',
      'sourceBytesRetained',
      'unrestrictedCommandOutputRetained',
    ],
    'Live composition privacy projection',
  );
  if (Object.values(value.privacy).some((selected) => selected !== false)) {
    fail('Live composition privacy projection reports retained prohibited content');
  }
  assertM251LiveCompositionMetadataOnly(value);
  return value;
}
