import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';

import {
  M251_LIVE_COMPOSITION_PHASES,
  M251_LIVE_COMPOSITION_RECEIPT_KIND,
  M251_LIVE_COMPOSITION_REVIEW_EXCLUSION,
  M251_LIVE_COMPOSITION_SCENARIO,
  admitM251LiveCompositionAuthorization,
  assertM251LiveCompositionMetadataOnly,
  assertM251LiveCompositionProjectClosure,
  assertM251LiveCompositionSourceClosure,
  m251LiveCompositionScenarioDigest,
  m251LiveCompositionCleanupFailureReasonCode,
  projectM251LiveCompositionAcceptance,
  projectM251LiveCompositionCandidate,
  projectM251LiveCompositionCleanup,
  projectM251LiveCompositionCloseout,
  projectM251LiveCompositionEvidence,
  projectM251LiveCompositionGoal,
  projectM251LiveCompositionIntake,
  projectM251LiveCompositionPhases,
  projectM251LiveCompositionProfile,
  projectM251LiveCompositionProjectIdentity,
  projectM251LiveCompositionReopen,
  projectM251LiveCompositionRootIdentity,
  projectM251LiveCompositionStages,
  projectM251LiveCompositionVerification,
  validateM251LiveCompositionReceipt,
} from './m2.5.1-live-composition-lib.mjs';
import {
  m251ExactAuthSource,
  m251ExactSourceIdentity,
  m251FileDigest,
  m251MetadataFingerprint,
  m251PnpmVersion,
  m251ProjectObservation,
} from './m2.5.1-live-environment-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = join(repositoryRoot, 'scripts', 'fixtures', 'm2.5.1', 'slice0-contract.json');
let stage = 'ENTRY';
let failureReasonCode;

function fail(message) {
  throw new TypeError(message);
}

function failWithReason(reasonCode, message) {
  failureReasonCode ??= reasonCode;
  fail(message);
}

function cleanupStep(reasonCode, operation) {
  try {
    return operation();
  } catch {
    failWithReason(reasonCode, 'M2.5.1 cleanup step failed');
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function jsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`${label} is not one JSON document`);
  }
}

function createOwnedRoots(assessmentRoot, authSource, protectedCheckPath) {
  const roots = Object.freeze({
    authorityHome: join(assessmentRoot, 'authority'),
    candidateWorkspace: join(assessmentRoot, 'candidate'),
    credentialRoot: realpathSync(dirname(authSource)),
    projectReadWorkspace: join(assessmentRoot, 'project-read'),
    protectedAssetRoot: realpathSync(dirname(protectedCheckPath)),
    verificationRunRoot: join(assessmentRoot, 'verification'),
  });
  const workerRoots = Object.freeze({
    codexHome: join(assessmentRoot, 'worker-codex-home'),
    probeWorkspace: join(assessmentRoot, 'worker-probe'),
    processHome: join(assessmentRoot, 'worker-process-home'),
    stateRoot: join(assessmentRoot, 'worker-state'),
    temporaryDirectory: join(assessmentRoot, 'worker-temporary'),
  });
  const intakeTemporaryRoot = join(assessmentRoot, 'intake-temporary');
  for (const path of [
    roots.authorityHome,
    roots.candidateWorkspace,
    roots.projectReadWorkspace,
    roots.verificationRunRoot,
    intakeTemporaryRoot,
  ]) {
    mkdirSync(path, { mode: 0o700 });
  }
  return Object.freeze({ roots, workerRoots, intakeTemporaryRoot });
}

function wrapAssistantResource(resource, operationCounter) {
  return Object.freeze({
    assistant: Object.freeze({
      analyze: async (input, signal) => {
        operationCounter.count += 1;
        return resource.assistant.analyze(input, signal);
      },
      answer: async (input, signal) => {
        operationCounter.count += 1;
        return resource.assistant.answer(input, signal);
      },
    }),
    prepare: () => resource.prepare(),
    close: () => resource.close(),
  });
}

function requireOutcome(result, kind, label, reasonCode) {
  if (result?.kind !== 'OUTCOME' || result.outcome.result.kind !== kind) {
    failWithReason(reasonCode, `${label} did not retain ${kind}`);
  }
  return result;
}

function requireFound(result, label) {
  if (result?.status !== 'FOUND') {
    fail(`${label} was not found`);
  }
  return result.view;
}

function requireValue(value, label) {
  if (value === undefined) {
    fail(`${label} is unavailable`);
  }
  return value;
}

function profileProjection(inspection, phaseDispatchEntryProjection, digests, contract) {
  const installed = inspection.getInstalledAuthority();
  const executionProfile = installed.profile.profile;
  if (executionProfile.externalExecution?.schemaVersion !== 3) {
    fail('Installed M2.5.1 Profile lost external-execution v3 authority');
  }
  const phaseBindings = M251_LIVE_COMPOSITION_PHASES.map((expected) => {
    const entry = executionProfile.externalExecution.phaseDispatch.find(
      ({ phase }) => phase === expected.phase,
    );
    if (entry === undefined) {
      fail(`Installed M2.5.1 Profile lacks ${expected.phase}`);
    }
    return Object.freeze({
      phase: entry.phase,
      workerKind: 'REAL_CODEX',
      sourceKind: entry.sourceAuthorityKind,
      adapterId: entry.workerAdapter,
      adapterVersion: entry.workerAdapterVersion,
      phaseEntryDigest: digests.digest(phaseDispatchEntryProjection(entry)),
    });
  });
  const activityPolicies = new Map(
    executionProfile.externalExecution.phaseDispatch.map((entry) => [
      `${entry.workerActivityPolicyId}\0${entry.workerActivityPolicyDigest}`,
      entry,
    ]),
  );
  if (activityPolicies.size !== 1) {
    fail('Installed M2.5.1 phase entries do not share one activity Policy');
  }
  const activity = executionProfile.externalExecution.phaseDispatch[0];
  return projectM251LiveCompositionProfile({
    activationKind: 'REAL_CODEX',
    executionProfile,
    workflowPolicy: installed.policy.bundle,
    workerActivityPolicy: {
      id: activity.workerActivityPolicyId,
      version: contract.execution.workerActivityPolicy.version,
      digest: activity.workerActivityPolicyDigest,
    },
    phaseBindings,
  });
}

function exactToolchain(profileAuthority, runtime) {
  const pnpmVersion = m251PnpmVersion(repositoryRoot);
  const installation = profileAuthority.installation.profile;
  return Object.freeze({
    nodeVersion: process.version,
    pnpmVersion,
    codexVersion: installation.version,
    protocolSnapshotDigest: installation.snapshotDigest,
    launcherDigest: installation.launcherDigest,
    delegatedExecutableDigest: installation.delegatedExecutableDigest,
    intakeAssistantProfileVersion: runtime.m251LiveIntakeAssistantProfile.version,
    intakeAssistantAdapterVersion: runtime.M251_LIVE_INTAKE_ASSISTANT_ADAPTER_VERSION,
    intakeConfigurationVersion: runtime.m251LiveIntakeAssistantProfile.closedConfiguration.version,
    intakeProjectionVersion:
      runtime.m251LiveIntakeAssistantProfile.protocolProjectionPolicy.version,
  });
}

function assertExactToolchainPreflight(toolchain, contract) {
  const selected = contract.toolchain.selected;
  const intake = contract.intake;
  if (
    !/^v22\.\d+\.\d+$/u.test(toolchain.nodeVersion) ||
    !/^11\.\d+\.\d+$/u.test(toolchain.pnpmVersion) ||
    toolchain.codexVersion !== selected.codexVersion ||
    toolchain.protocolSnapshotDigest !== selected.snapshotDigest ||
    toolchain.launcherDigest !== selected.launcherDigest ||
    toolchain.delegatedExecutableDigest !== selected.delegatedExecutableDigest ||
    toolchain.intakeAssistantProfileVersion !== intake.assistantProfile.version ||
    toolchain.intakeAssistantAdapterVersion !== intake.assistantAdapter.version ||
    toolchain.intakeConfigurationVersion !== intake.closedConfiguration.version ||
    toolchain.intakeProjectionVersion !== intake.protocolProjectionPolicy.version
  ) {
    fail('M2.5.1 actual toolchain differs from the frozen contract');
  }
}

function rootProjection(projectPath, roots, workerRoots, intakeDescriptor) {
  return projectM251LiveCompositionRootIdentity([
    { kind: 'AUTHORITY_HOME', path: roots.authorityHome },
    { kind: 'CANDIDATE_WORKSPACE', path: roots.candidateWorkspace },
    { kind: 'CREDENTIAL_ROOT', path: roots.credentialRoot },
    { kind: 'DEMONSTRATION_PROJECT', path: projectPath },
    { kind: 'INTAKE_CODEX_HOME', path: intakeDescriptor.codexHome },
    { kind: 'INTAKE_EXECUTION_ROOT', path: intakeDescriptor.root },
    { kind: 'INTAKE_OPERATION_CWD', path: intakeDescriptor.operationCwd },
    { kind: 'INTAKE_PROCESS_HOME', path: intakeDescriptor.processHome },
    {
      kind: 'INTAKE_PROCESS_TEMPORARY_DIRECTORY',
      path: intakeDescriptor.processTemporaryDirectory,
    },
    { kind: 'PROJECT_READ_WORKSPACE', path: roots.projectReadWorkspace },
    { kind: 'PROTECTED_ASSET_ROOT', path: roots.protectedAssetRoot },
    { kind: 'VERIFICATION_RUN_ROOT', path: roots.verificationRunRoot },
    { kind: 'WORKER_CODEX_HOME', path: workerRoots.codexHome },
    { kind: 'WORKER_PROBE_WORKSPACE', path: workerRoots.probeWorkspace },
    { kind: 'WORKER_PROCESS_HOME', path: workerRoots.processHome },
    { kind: 'WORKER_STATE_ROOT', path: workerRoots.stateRoot },
    { kind: 'WORKER_TEMPORARY_DIRECTORY', path: workerRoots.temporaryDirectory },
  ]);
}

function selectVerificationEvidence(acceptanceAuthority) {
  const verificationEntries = acceptanceAuthority.currentEvidence.filter(
    ({ record }) => record.kind === 'LOCAL_COMMAND_TEST_RESULT',
  );
  const verificationEvidence = verificationEntries[0]?.record;
  if (
    acceptanceAuthority.currentEvidence.length !== 1 ||
    verificationEntries.length !== 1 ||
    verificationEvidence === undefined
  ) {
    const evidenceKinds = acceptanceAuthority.currentEvidence.map(({ record }) => record.kind);
    failWithReason(
      `ACCEPTANCE_EVIDENCE_KINDS_${evidenceKinds.join('+') || 'NONE'}`,
      'M2.5.1 Acceptance authority lacks its exact protected Verification Evidence',
    );
  }
  return verificationEvidence;
}

function snapshotsRemoved(projectReadRoot) {
  const snapshots = join(projectReadRoot, 'snapshots');
  const markers = join(projectReadRoot, '.codeclosure-project-read', 'markers');
  return (
    (!existsSync(snapshots) || readdirSync(snapshots).length === 0) &&
    (!existsSync(markers) || readdirSync(markers).length === 0)
  );
}

async function main() {
  const authorization = admitM251LiveCompositionAuthorization(process.env);
  const contract = jsonFile(contractPath, 'M2.5.1 Slice 0 contract');
  const projectPath = realpathSync(
    resolve(
      argument('--project') ??
        process.env.CODECLOSURE_M251_DEMO_PROJECT ??
        '/Users/liushan/Developer/CodeClosureM25Demo',
    ),
  );
  const protectedCheckPath = realpathSync(
    join(repositoryRoot, contract.demonstration.protectedCheck.assetPath),
  );
  const authSource = m251ExactAuthSource(argument('--auth-source'));
  const authOpening = m251MetadataFingerprint(authSource);
  const protectedCheckOpening = m251FileDigest(protectedCheckPath);
  const sourceOpening = m251ExactSourceIdentity(
    repositoryRoot,
    M251_LIVE_COMPOSITION_REVIEW_EXCLUSION,
  );
  const assessmentRoot = realpathSync(
    mkdtempSync(join(tmpdir(), 'codeclosure-m2-5-1-live-composition-')),
  );

  let primaryComposition;
  let reopenedComposition;
  let primaryAssistant;
  let reopenedAssistant;
  let receipt;
  let failure;
  try {
    stage = 'PREFLIGHT';
    const { roots, workerRoots, intakeTemporaryRoot } = createOwnedRoots(
      assessmentRoot,
      authSource,
      protectedCheckPath,
    );
    const [runtime, domain, workspace, intakeInvocation, workerInvocation, production] =
      await Promise.all([
        import('../packages/runtime/dist/index.js'),
        import('../packages/domain/dist/index.js'),
        import('../packages/workspace-local/dist/index.js'),
        import('../apps/cli/dist/composition/intake-assistant-invocation.js'),
        import('../apps/cli/dist/composition/m251-codex-worker-invocation.js'),
        import('../apps/cli/dist/composition/m251-trusted-production-composition.js'),
      ]);
    const { createCliCommandId } = await import('../apps/cli/dist/composition/index.js');
    const projectOpening = m251ProjectObservation(
      projectPath,
      workspace.observeLocalCandidateSourceIdentity,
    );
    assertM251LiveCompositionProjectClosure(projectOpening, projectOpening);
    const expectedProject = projectM251LiveCompositionProjectIdentity(
      Object.freeze({
        projectFamily: contract.demonstration.projectFamily,
        gitCommit: contract.demonstration.gitCommit,
        gitTree: contract.demonstration.gitTree,
        sourceTreeDigest: contract.demonstration.sourceTreeDigest,
        sourceGitMetadataDigest: contract.demonstration.sourceGitMetadataDigest,
        selectedSourcePaths: Object.freeze(contract.demonstration.selectedSourcePaths),
        allowedPaths: Object.freeze(contract.demonstration.allowedPaths),
        expectedResult: contract.demonstration.expectedResult,
      }),
      contract.demonstration.protectedCheck,
    );
    if (
      projectOpening.gitCommit !== contract.demonstration.gitCommit ||
      projectOpening.gitTree !== contract.demonstration.gitTree ||
      projectOpening.sourceTreeDigest !== contract.demonstration.sourceTreeDigest ||
      projectOpening.sourceGitMetadataDigest !== contract.demonstration.sourceGitMetadataDigest ||
      projectOpening.workingTreeState !== 'clean' ||
      protectedCheckOpening !== contract.demonstration.protectedCheck.assetDigest
    ) {
      fail('M2.5.1 project or protected Check differs from the frozen contract');
    }

    const assistantEnvironment = Object.freeze({
      ...process.env,
      CODECLOSURE_M2_AUTH_SOURCE: authSource,
      TMPDIR: intakeTemporaryRoot,
      TMP: intakeTemporaryRoot,
      TEMP: intakeTemporaryRoot,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    });
    const workerForbiddenRoots = Object.freeze([
      roots.authorityHome,
      roots.credentialRoot,
      roots.protectedAssetRoot,
      roots.verificationRunRoot,
      projectPath,
    ]);
    const intakeForbiddenRoots = Object.freeze([
      ...workerForbiddenRoots,
      roots.candidateWorkspace,
      roots.projectReadWorkspace,
      ...Object.values(workerRoots),
    ]);
    const primaryAssistantOperations = { count: 0 };
    primaryAssistant = wrapAssistantResource(
      intakeInvocation.createProductionIntakeAssistant({
        environment: assistantEnvironment,
        forbiddenRoots: intakeForbiddenRoots,
      }),
      primaryAssistantOperations,
    );
    const intakeDescriptor = primaryAssistant.prepare();
    const profileAuthority = await workerInvocation.prepareM251TrustedCodexProfile({
      authSource,
      candidateWorkspaceRoot: roots.candidateWorkspace,
      forbiddenRoots: workerForbiddenRoots,
      model: 'gpt-5.6-sol',
      projectReadWorkspaceRoot: roots.projectReadWorkspace,
      roots: workerRoots,
    });
    const toolchain = exactToolchain(profileAuthority, runtime);
    assertExactToolchainPreflight(toolchain, contract);
    const activation = production.createM251RealCodexProductionActivation(profileAuthority);
    const rootIdentity = rootProjection(projectPath, roots, workerRoots, intakeDescriptor);
    const adapterDiagnostics = [];
    const adapterObservations = [];
    const ordinaryStartResults = [];
    primaryComposition = production.createM251TrustedProductionComposition({
      activation,
      intakeAssistant: primaryAssistant,
      observationSink: Object.freeze({
        onAdapterDiagnostic: (event) => adapterDiagnostics.push(event),
        onAdapterObservation: (observation) => adapterObservations.push(observation),
        onOrdinaryStartResult: (result) => ordinaryStartResults.push(result),
      }),
      projectPath,
      protectedCheckPath,
      roots,
    });
    const profile = profileProjection(
      primaryComposition.inspection,
      domain.externalExecutionPhaseDispatchEntryProjection,
      new runtime.CanonicalJsonSha256DigestProvider(),
      contract,
    );

    stage = 'INTAKE_CLARIFICATION';
    const submitCommandId = createCliCommandId();
    const submitted = requireOutcome(
      await primaryComposition.intakeApplication.submit({
        commandId: submitCommandId,
        interactionAction: 'GOVERNED_EXECUTION',
        admittedUserContent: M251_LIVE_COMPOSITION_SCENARIO.request,
        declaredProjectPath: projectPath,
      }),
      'CLARIFICATION_REQUIRED',
      'M2.5.1 initial Intake',
      'INITIAL_INTAKE_OUTCOME_NOT_CLARIFICATION_REQUIRED',
    );
    const initialStatus = requireValue(
      primaryComposition.intakeApplication.getStatus(submitted.outcome.intakeRunId),
      'M2.5.1 initial Intake status',
    );
    if (initialStatus.status !== 'NEEDS_CLARIFICATION') {
      failWithReason(
        'INITIAL_INTAKE_STATUS_NOT_NEEDS_CLARIFICATION',
        'M2.5.1 Intake did not retain one active clarification',
      );
    }
    const clarificationCommandId = createCliCommandId();
    const clarificationResult = await primaryComposition.intakeApplication.clarify({
      commandId: clarificationCommandId,
      intakeRunId: submitted.outcome.intakeRunId,
      expectedIntakeRunVersion: initialStatus.intakeRunVersion,
      clarificationQuestionId: initialStatus.activeQuestion.id,
      answer: M251_LIVE_COMPOSITION_SCENARIO.clarificationAnswer,
    });
    if (
      clarificationResult?.kind !== 'OUTCOME' ||
      clarificationResult.outcome.result.kind !== 'MATERIALIZED'
    ) {
      const currentStatus = primaryComposition.intakeApplication.getStatus(
        submitted.outcome.intakeRunId,
      );
      const outcomeKind =
        clarificationResult?.kind === 'OUTCOME'
          ? clarificationResult.outcome.result.kind
          : 'NO_OUTCOME';
      const affectedFields = currentStatus?.activeQuestion?.affectedFields.join('+') ?? 'NONE';
      failWithReason(
        `CLARIFIED_INTAKE_${outcomeKind}_${affectedFields}`,
        'M2.5.1 clarified Intake did not retain MATERIALIZED',
      );
    }
    const clarified = requireOutcome(
      clarificationResult,
      'MATERIALIZED',
      'M2.5.1 clarified Intake',
      'CLARIFIED_INTAKE_OUTCOME_NOT_MATERIALIZED',
    );
    if (clarified.startDisposition !== 'START_COMMAND_APPLIED') {
      failWithReason(
        `CLARIFIED_INTAKE_${clarified.startDisposition}`,
        'M2.5.1 governed Intake did not apply its separate ordinary Start',
      );
    }

    stage = 'EVIDENCE_ACCEPTANCE_CLOSEOUT';
    const intakeAuthority = requireValue(
      primaryComposition.inspection.getIntakeAuthority(clarified.outcome.intakeRunId),
      'M2.5.1 retained Intake authority',
    );
    const materialized = requireValue(
      intakeAuthority.materialization,
      'M2.5.1 Goal Materialization',
    );
    const startAuthorization = requireValue(
      intakeAuthority.startAuthorization,
      'M2.5.1 Start Authorization',
    );
    const finalStatus = requireFound(
      primaryComposition.application.getGoalStatus(materialized.goalId),
      'M2.5.1 final Goal status',
    );
    const finalAuthority = requireValue(
      primaryComposition.inspection.getGoalAuthority(materialized.goalId),
      'M2.5.1 final Goal authority',
    );
    const processedStartCommand = requireValue(
      primaryComposition.inspection.getProcessedCommand(startAuthorization.startCommandId),
      'M2.5.1 processed ordinary Start',
    );
    const observedStartResult = ordinaryStartResults[0];
    if (
      primaryAssistantOperations.count !== 2 ||
      ordinaryStartResults.length !== 1 ||
      adapterObservations.length !== 3
    ) {
      failWithReason(
        `LINKED_EXECUTION_COUNTS_ASSISTANT_${String(primaryAssistantOperations.count)}` +
          `_START_${String(ordinaryStartResults.length)}` +
          `_PHASES_${
            adapterObservations
              .map(
                ({ activityDisposition, failureCode, phase, state }) =>
                  `${phase}:${state}:${failureCode ?? 'NONE'}:${activityDisposition}`,
              )
              .join('+') || 'NONE'
          }` +
          `_DRIVE_${observedStartResult?.drive?.stopReason ?? 'NONE'}` +
          `_DETAIL_${observedStartResult?.drive?.detailCode ?? 'NONE'}` +
          `_DIAGNOSTICS_${
            adapterDiagnostics
              .map((event) =>
                [
                  event.kind,
                  'itemType' in event ? event.itemType : 'NONE',
                  'location' in event ? event.location : 'NONE',
                  'reasonCode' in event ? event.reasonCode : 'NONE',
                  'activityDetail' in event ? event.activityDetail : 'NONE',
                  'method' in event ? event.method : 'NONE',
                ].join(':'),
              )
              .join('+') || 'NONE'
          }`,
        'M2.5.1 linked execution did not produce one Start and three real phase observations',
      );
    }
    if (observedStartResult?.drive?.stopReason !== 'CLOSED') {
      failWithReason(
        `LINKED_EXECUTION_DRIVE_${observedStartResult?.drive?.stopReason ?? 'NONE'}` +
          `_DETAIL_${observedStartResult?.drive?.detailCode ?? 'NONE'}`,
        'M2.5.1 linked execution did not reach technical closeout',
      );
    }
    const startResult = observedStartResult;
    stage = 'PROJECT_GOAL_RECEIPT';
    const goal = projectM251LiveCompositionGoal(
      {
        finalAuthority,
        finalStatus,
        processedStartCommand,
        startAuthorization,
        startResult,
      },
      profile,
    );
    stage = 'PROJECT_INTAKE_RECEIPT';
    const intake = projectM251LiveCompositionIntake(
      {
        submitCommandId,
        clarificationCommandId,
        authority: intakeAuthority,
      },
      goal,
      profile,
    );
    stage = 'READ_ACCEPTANCE_AUTHORITY';
    let acceptanceAuthority;
    try {
      acceptanceAuthority = primaryComposition.inspection.getAcceptanceAuthority(
        finalAuthority.workflow.id,
        requireValue(finalAuthority.policyBinding, 'M2.5.1 Workflow Policy binding').policyBundleId,
      );
    } catch {
      failWithReason(
        'ACCEPTANCE_AUTHORITY_READ_FAILED',
        'M2.5.1 Acceptance authority inspection failed',
      );
    }
    if (acceptanceAuthority === undefined) {
      failWithReason(
        `ACCEPTANCE_AUTHORITY_MISSING_OUTCOME_${finalStatus.acceptanceSummary?.outcome ?? 'NONE'}` +
          `_TECHNICAL_CLOSEOUT_${String(finalStatus.technicalCloseout)}` +
          `_ACTIVE_CANDIDATE_${
            finalAuthority.workflow.activeCandidateGenerationId === undefined ? 'NONE' : 'BOUND'
          }` +
          `_CANDIDATE_STATE_${finalAuthority.candidateAuthority?.generation.state ?? 'NONE'}` +
          `_DECISION_${finalAuthority.acceptanceAuthority?.decision.outcome ?? 'NONE'}`,
        'M2.5.1 Acceptance authority is unavailable after linked closeout',
      );
    }
    stage = 'READ_CANDIDATE_FREEZE_AUTHORITY';
    let candidateFreezeAuthority;
    try {
      candidateFreezeAuthority = primaryComposition.inspection.getCurrentCandidateFreezeEvidence(
        finalAuthority.workflow.id,
      );
    } catch {
      failWithReason(
        'CANDIDATE_FREEZE_AUTHORITY_READ_FAILED',
        'M2.5.1 Candidate freeze authority inspection failed',
      );
    }
    if (candidateFreezeAuthority === undefined) {
      failWithReason(
        'CANDIDATE_FREEZE_AUTHORITY_MISSING',
        'M2.5.1 current Candidate freeze Evidence authority is unavailable',
      );
    }
    const freezeEvidence = candidateFreezeAuthority.record;
    stage = 'SELECT_ACCEPTANCE_EVIDENCE';
    const verificationEvidence = selectVerificationEvidence(acceptanceAuthority);
    stage = 'PROJECT_CANDIDATE_RECEIPT';
    const candidate = projectM251LiveCompositionCandidate(
      {
        authority: requireValue(finalAuthority.candidateAuthority, 'M2.5.1 Candidate authority'),
        freezeEvidence,
      },
      goal,
    );
    stage = 'PROJECT_PHASE_RECEIPT';
    const phaseInputs = M251_LIVE_COMPOSITION_PHASES.map((expected) => {
      const observation = adapterObservations.find(({ phase }) => phase === expected.phase);
      return primaryComposition.inspection.readPhaseAuthority(
        requireValue(observation, `M2.5.1 ${expected.phase} Adapter observation`),
      );
    });
    const phases = projectM251LiveCompositionPhases(phaseInputs, profile, goal, candidate);
    const verificationPlan = requireValue(
      finalAuthority.acceptanceCriticalVerificationPlan,
      'M2.5.1 protected Verification Plan',
    );
    stage = 'PROJECT_VERIFICATION_RECEIPT';
    const verification = projectM251LiveCompositionVerification(
      { plan: verificationPlan, evidence: verificationEvidence },
      candidate,
      expectedProject,
    );
    stage = 'PROJECT_EVIDENCE_RECEIPT';
    const evidence = projectM251LiveCompositionEvidence(
      {
        evidenceSet: acceptanceAuthority.evidenceSet,
        freezeEvidence,
        verificationEvidence,
      },
      candidate,
      verification,
    );
    stage = 'PROJECT_ACCEPTANCE_RECEIPT';
    const persistedAcceptance = requireValue(
      finalAuthority.acceptanceAuthority,
      'M2.5.1 persisted Acceptance Decision',
    );
    const acceptance = projectM251LiveCompositionAcceptance(
      {
        manifest: persistedAcceptance.manifest,
        decision: persistedAcceptance.decision,
        policyBundle: acceptanceAuthority.policyBundle,
      },
      goal,
      candidate,
      evidence,
      verification,
      profile,
    );
    stage = 'PROJECT_CLOSEOUT_RECEIPT';
    const closeout = projectM251LiveCompositionCloseout(
      {
        workflow: finalAuthority.workflow,
        closeout: requireValue(finalAuthority.closeout, 'M2.5.1 closeout authority'),
        finalStatus,
      },
      goal,
      candidate,
      acceptance,
    );

    stage = 'STRICT_REOPEN';
    primaryComposition.close();
    primaryComposition = undefined;
    const reopenedAssistantOperations = { count: 0 };
    reopenedAssistant = wrapAssistantResource(
      intakeInvocation.createProductionIntakeAssistant({
        environment: assistantEnvironment,
        forbiddenRoots: intakeForbiddenRoots,
      }),
      reopenedAssistantOperations,
    );
    const reopenedDescriptor = reopenedAssistant.prepare();
    const reopenedAdapterObservations = [];
    const reopenedStartResults = [];
    reopenedComposition = production.createM251TrustedProductionComposition({
      activation,
      intakeAssistant: reopenedAssistant,
      observationSink: Object.freeze({
        onAdapterObservation: (observation) => reopenedAdapterObservations.push(observation),
        onOrdinaryStartResult: (result) => reopenedStartResults.push(result),
      }),
      projectPath,
      protectedCheckPath,
      roots,
    });
    const reopenedStatus = requireFound(
      reopenedComposition.application.getGoalStatus(materialized.goalId),
      'Reopened M2.5.1 Goal status',
    );
    const reopenedAuthority = requireValue(
      reopenedComposition.inspection.getGoalAuthority(materialized.goalId),
      'Reopened M2.5.1 Goal authority',
    );
    const replayedSubmit = requireOutcome(
      await reopenedComposition.intakeApplication.submit({
        commandId: submitCommandId,
        interactionAction: 'GOVERNED_EXECUTION',
        admittedUserContent: M251_LIVE_COMPOSITION_SCENARIO.request,
        declaredProjectPath: projectPath,
      }),
      'CLARIFICATION_REQUIRED',
      'Reopened initial Intake replay',
      'REOPENED_INITIAL_INTAKE_REPLAY_MISMATCH',
    );
    const replayedClarification = requireOutcome(
      await reopenedComposition.intakeApplication.clarify({
        commandId: clarificationCommandId,
        intakeRunId: submitted.outcome.intakeRunId,
        expectedIntakeRunVersion: initialStatus.intakeRunVersion,
        clarificationQuestionId: initialStatus.activeQuestion.id,
        answer: M251_LIVE_COMPOSITION_SCENARIO.clarificationAnswer,
      }),
      'MATERIALIZED',
      'Reopened clarification replay',
      'REOPENED_CLARIFICATION_REPLAY_MISMATCH',
    );
    const replayedStart = await reopenedComposition.application.startGoal({
      commandId: startAuthorization.startCommandId,
      goalId: startAuthorization.goalId,
      expectedGoalRevision: startAuthorization.goalRevision,
      expectedWorkflowVersion: startAuthorization.workflowVersion,
    });
    const reopenedPhases = projectM251LiveCompositionPhases(
      M251_LIVE_COMPOSITION_PHASES.map((expected) =>
        reopenedComposition.inspection.readPhaseAuthority(
          requireValue(
            adapterObservations.find(({ phase }) => phase === expected.phase),
            `Reopened M2.5.1 ${expected.phase} observation binding`,
          ),
        ),
      ),
      profile,
      goal,
      candidate,
    );
    if (
      replayedSubmit.replayed !== true ||
      replayedClarification.replayed !== true ||
      replayedStart.command.status !== 'REPLAYED' ||
      reopenedStatus.technicalCloseout !== true ||
      reopenedAuthority.closeout === undefined ||
      JSON.stringify(reopenedPhases) !== JSON.stringify(phases) ||
      reopenedAssistantOperations.count !== 0 ||
      reopenedAdapterObservations.length !== 0
    ) {
      fail('M2.5.1 strict reopen recalled, redispatched, or changed retained authority');
    }
    const reopen = projectM251LiveCompositionReopen(
      {
        goalFound: true,
        technicalCloseout: reopenedStatus.technicalCloseout,
        finalStatusProjectionDigest: goal.finalStatusProjectionDigest,
        intakeCommandStatus: 'REPLAYED',
        startCommandStatus: replayedStart.command.status,
        assistantOperationDelta: reopenedAssistantOperations.count,
        workerDispatchDelta: reopenedAdapterObservations.length,
        modelRecallCount: 0,
      },
      goal,
      phases,
      closeout,
    );

    stage = 'CLEANUP';
    const projectReadClean = cleanupStep('CLEANUP_PROJECT_READ_INSPECTION_FAILED', () =>
      snapshotsRemoved(roots.projectReadWorkspace),
    );
    cleanupStep('CLEANUP_REOPENED_COMPOSITION_CLOSE_FAILED', () => reopenedComposition.close());
    reopenedComposition = undefined;
    const intakeRootsRemoved =
      !existsSync(intakeDescriptor.root) && !existsSync(reopenedDescriptor.root);
    const projectClosing = cleanupStep('CLEANUP_PROJECT_OBSERVATION_FAILED', () =>
      m251ProjectObservation(projectPath, workspace.observeLocalCandidateSourceIdentity),
    );
    cleanupStep('CLEANUP_PROJECT_CLOSURE_FAILED', () =>
      assertM251LiveCompositionProjectClosure(projectOpening, projectClosing),
    );
    const sourceClosingBeforeCleanup = cleanupStep(
      'CLEANUP_SOURCE_OBSERVATION_BEFORE_ROOT_REMOVAL_FAILED',
      () => m251ExactSourceIdentity(repositoryRoot, M251_LIVE_COMPOSITION_REVIEW_EXCLUSION),
    );
    cleanupStep('CLEANUP_SOURCE_CLOSURE_BEFORE_ROOT_REMOVAL_FAILED', () =>
      assertM251LiveCompositionSourceClosure(sourceOpening, sourceClosingBeforeCleanup),
    );
    const credentialUnchanged = cleanupStep(
      'CLEANUP_CREDENTIAL_ROOT_INSPECTION_FAILED',
      () => JSON.stringify(authOpening) === JSON.stringify(m251MetadataFingerprint(authSource)),
    );
    const protectedCheckUnchanged = cleanupStep(
      'CLEANUP_PROTECTED_ASSET_INSPECTION_FAILED',
      () => protectedCheckOpening === m251FileDigest(protectedCheckPath),
    );
    cleanupStep('CLEANUP_ASSESSMENT_ROOT_REMOVAL_FAILED', () =>
      rmSync(assessmentRoot, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 }),
    );
    const assessmentRootRemoved = !existsSync(assessmentRoot);
    const sourceClosing = cleanupStep('CLEANUP_SOURCE_OBSERVATION_FAILED', () =>
      m251ExactSourceIdentity(repositoryRoot, M251_LIVE_COMPOSITION_REVIEW_EXCLUSION),
    );
    cleanupStep('CLEANUP_SOURCE_CLOSURE_FAILED', () =>
      assertM251LiveCompositionSourceClosure(sourceOpening, sourceClosing),
    );
    const cleanupObservation = Object.freeze({
      ownedProcessesShutdownClean:
        adapterObservations.every(({ state }) => state === 'COMPLETED') &&
        reopenedAdapterObservations.length === 0,
      intakeExecutionRootRemoved: intakeRootsRemoved,
      workerControlledRootsRemoved: assessmentRootRemoved,
      projectReadSnapshotsRemoved: projectReadClean,
      candidateWorkspaceRemoved: assessmentRootRemoved,
      verificationRunRootRemoved: assessmentRootRemoved,
      authorityHomeRemoved: assessmentRootRemoved,
      assessmentRootRemoved,
      credentialRootUnchanged: credentialUnchanged,
      protectedAssetRootUnchanged: protectedCheckUnchanged,
      sourceUnchanged: JSON.stringify(projectOpening) === JSON.stringify(projectClosing),
    });
    const cleanupFailure = m251LiveCompositionCleanupFailureReasonCode(cleanupObservation);
    if (cleanupFailure !== undefined) {
      failWithReason(cleanupFailure, 'M2.5.1 cleanup observations are incomplete');
    }
    const cleanup = projectM251LiveCompositionCleanup(cleanupObservation);
    receipt = Object.freeze({
      schemaVersion: 1,
      kind: M251_LIVE_COMPOSITION_RECEIPT_KIND,
      scenarioId: M251_LIVE_COMPOSITION_SCENARIO.id,
      scenarioDigest: m251LiveCompositionScenarioDigest(),
      authorization,
      stages: projectM251LiveCompositionStages([
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
      ]),
      source: Object.freeze({ opening: sourceOpening, closing: sourceClosing }),
      toolchain,
      profile,
      project: expectedProject,
      projectClosure: Object.freeze({ opening: projectOpening, closing: projectClosing }),
      roots: rootIdentity,
      intake,
      goal,
      phases,
      candidate,
      verification,
      evidence,
      acceptance,
      closeout,
      reopen,
      cleanup,
      privacy: Object.freeze({
        requestContentRetained: false,
        answerContentRetained: false,
        assistantOrModelContentRetained: false,
        reasoningOrTranscriptRetained: false,
        rawProtocolOrExceptionRetained: false,
        credentialOrAccountContentRetained: false,
        sourceBytesRetained: false,
        unrestrictedCommandOutputRetained: false,
      }),
    });
    const expectedIdentity = Object.freeze({
      source: sourceOpening,
      project: projectOpening,
      roots: rootIdentity,
      profile,
    });
    validateM251LiveCompositionReceipt(receipt, expectedIdentity);
    assertM251LiveCompositionMetadataOnly(receipt, [
      authSource,
      projectPath,
      M251_LIVE_COMPOSITION_SCENARIO.request,
      M251_LIVE_COMPOSITION_SCENARIO.clarificationAnswer,
    ]);
  } catch (error) {
    failure = error;
  } finally {
    try {
      reopenedComposition?.close();
    } catch {
      failure ??= new TypeError('Reopened composition cleanup failed');
    }
    try {
      primaryComposition?.close();
    } catch {
      failure ??= new TypeError('Primary composition cleanup failed');
    }
    try {
      reopenedAssistant?.close();
      primaryAssistant?.close();
    } catch {
      failure ??= new TypeError('Intake Assistant cleanup failed');
    }
    if (existsSync(assessmentRoot)) {
      try {
        rmSync(assessmentRoot, {
          force: true,
          maxRetries: 10,
          recursive: true,
          retryDelay: 100,
        });
      } catch {
        failure ??= new TypeError('Assessment-root cleanup failed');
      }
    }
  }
  if (failure !== undefined || receipt === undefined) {
    process.stderr.write(
      `M2.5.1 live composition failed at ${stage}${
        failureReasonCode === undefined ? '' : ` (${failureReasonCode})`
      }\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

try {
  await main();
} catch {
  process.stderr.write(`M2.5.1 live composition failed at ${stage}\n`);
  process.exitCode = 1;
}
