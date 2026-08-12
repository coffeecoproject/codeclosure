import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { M251_REVIEW_EXCLUSION } from './m2.5.1-acceptance-lib.mjs';
import { URL, fileURLToPath } from 'node:url';

import {
  M251_LIVE_COMPOSITION_AUTHORIZATION_ENV,
  M251_LIVE_COMPOSITION_PHASES,
  M251_LIVE_COMPOSITION_PROFILE_CONTRACT,
  M251_LIVE_COMPOSITION_RECEIPT_KIND,
  M251_LIVE_COMPOSITION_REVIEW_EXCLUSION,
  M251_LIVE_COMPOSITION_ROOT_KINDS,
  M251_LIVE_COMPOSITION_SCENARIO,
  M251_LIVE_COMPOSITION_STAGE_IDS,
  admitM251LiveCompositionAuthorization,
  assertM251LiveCompositionMetadataOnly,
  assertM251LiveCompositionProjectClosure,
  assertM251LiveCompositionRootIdentity,
  m251LiveCompositionCleanupFailureReasonCode,
  m251LiveCompositionReferenceDigest,
  m251LiveCompositionScenarioDigest,
  projectM251LiveCompositionAcceptance,
  projectM251LiveCompositionCandidate,
  projectM251LiveCompositionCleanup,
  projectM251LiveCompositionCloseout,
  projectM251LiveCompositionEvidence,
  projectM251LiveCompositionGoal,
  projectM251LiveCompositionIntake,
  projectM251LiveCompositionPhases,
  projectM251LiveCompositionProjectIdentity,
  projectM251LiveCompositionProfile,
  projectM251LiveCompositionReopen,
  projectM251LiveCompositionRootIdentity,
  projectM251LiveCompositionStages,
  projectM251LiveCompositionVerification,
  validateM251LiveCompositionReceipt,
} from './m2.5.1-live-composition-lib.mjs';
import { m251RemoveOwnedAssessmentRoot } from './m2.5.1-live-environment-lib.mjs';
const contract = JSON.parse(
  readFileSync(new URL('./fixtures/m2.5.1/slice0-contract.json', import.meta.url), 'utf8'),
);
const { protectedCheck, ...projectContract } = contract.demonstration;
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function digest(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function reference(kind, value = kind) {
  return m251LiveCompositionReferenceDigest(kind, value);
}

function sourceIdentity() {
  return {
    baseGitRevision: '5f2e532000000000000000000000000000000000',
    gitBranch: 'm2.5-goal-intake',
    workingTreeState: 'modified',
    manifestSchema: 'codeclosure-source-manifest-v1',
    pathCount: 1_200,
    digest: digest('source'),
    reviewExclusion: M251_LIVE_COMPOSITION_REVIEW_EXCLUSION,
  };
}

function projectObservation() {
  return {
    gitCommit: contract.demonstration.gitCommit,
    gitTree: contract.demonstration.gitTree,
    sourceTreeDigest: contract.demonstration.sourceTreeDigest,
    sourceGitMetadataDigest: contract.demonstration.sourceGitMetadataDigest,
    workingTreeState: 'clean',
    projectTree: {
      manifestSchema: 'codeclosure-m2-5-1-project-tree-v1',
      entryCount: 12,
      digest: digest('project-tree'),
    },
  };
}

function rootEntries(prefix = '/tmp/codeclosure-m251-b2') {
  const paths = {
    AUTHORITY_HOME: `${prefix}/authority`,
    CANDIDATE_WORKSPACE: `${prefix}/candidate`,
    CREDENTIAL_ROOT: `${prefix}/credentials`,
    DEMONSTRATION_PROJECT: `${prefix}/demonstration-project`,
    INTAKE_CODEX_HOME: `${prefix}/intake/codex-home`,
    INTAKE_EXECUTION_ROOT: `${prefix}/intake`,
    INTAKE_OPERATION_CWD: `${prefix}/intake/operation-cwd`,
    INTAKE_PROCESS_HOME: `${prefix}/intake/process-home`,
    INTAKE_PROCESS_TEMPORARY_DIRECTORY: `${prefix}/intake/process-tmp`,
    PROJECT_READ_WORKSPACE: `${prefix}/project-read`,
    PROTECTED_ASSET_ROOT: `${prefix}/protected-assets`,
    VERIFICATION_RUN_ROOT: `${prefix}/verification`,
    WORKER_CODEX_HOME: `${prefix}/worker-codex-home`,
    WORKER_PROBE_WORKSPACE: `${prefix}/worker-probe`,
    WORKER_PROCESS_HOME: `${prefix}/worker-process-home`,
    WORKER_STATE_ROOT: `${prefix}/worker-state`,
    WORKER_TEMPORARY_DIRECTORY: `${prefix}/worker-tmp`,
  };
  return M251_LIVE_COMPOSITION_ROOT_KINDS.map((kind) => ({ kind, path: paths[kind] }));
}

function profile({
  executionProfile = M251_LIVE_COMPOSITION_PROFILE_CONTRACT.executionProfile,
  workerAdapter = M251_LIVE_COMPOSITION_PROFILE_CONTRACT.workerAdapter,
} = {}) {
  return projectM251LiveCompositionProfile({
    activationKind: 'REAL_CODEX',
    executionProfile: {
      id: executionProfile.id,
      version: executionProfile.version,
      digest: digest('execution-profile'),
    },
    workflowPolicy: {
      id: contract.execution.workflowPolicy.id,
      version: contract.execution.workflowPolicy.version,
      digest: digest('workflow-policy'),
    },
    workerActivityPolicy: {
      id: contract.execution.workerActivityPolicy.id,
      version: contract.execution.workerActivityPolicy.version,
      digest: digest('worker-activity-policy'),
    },
    phaseBindings: M251_LIVE_COMPOSITION_PHASES.map(({ phase, sourceKind }) => ({
      phase,
      workerKind: 'REAL_CODEX',
      sourceKind,
      adapterId: workerAdapter.id,
      adapterVersion: workerAdapter.version,
      phaseEntryDigest: digest(`phase-entry:${phase}`),
    })),
  });
}

function receipt(options = {}) {
  const selectedProfile = profile();
  const project = projectM251LiveCompositionProjectIdentity(projectContract, protectedCheck);
  const roots = projectM251LiveCompositionRootIdentity(rootEntries());
  const identifiers = {
    goalId: 'goal_live-composition',
    workflowId: 'workflow_live-composition',
    startAuthorizationId: 'goal-start-authorization_live-composition',
    startCommandId: 'command_start-live-composition',
    intakeRunId: 'intake_live-composition',
    submitCommandId: 'command_intake-submit',
    clarificationCommandId: 'command_intake-clarify',
    questionId: 'question_live-composition',
    materializationId: 'materialization_live-composition',
    candidateId: 'candidate_live-composition',
    generationId: 'generation_live-composition',
    verificationPlanId: 'acceptance-verification-plan_live-composition',
    verificationCheckId: 'check-spec_live-composition',
    freezeEvidenceId: 'evidence_freeze-live-composition',
    verificationEvidenceId: 'evidence_verification-live-composition',
    acceptanceDecisionId: 'acceptance-decision_live-composition',
  };
  const policyBundle = {
    id: selectedProfile.workflowPolicy.id,
    schemaVersion: 1,
    version: selectedProfile.workflowPolicy.version,
    digest: selectedProfile.workflowPolicy.digest,
    checkerVersions: [
      { checkerId: 'acceptance-checker', checkerVersion: 'v1', checkerDigest: digest('checker') },
    ],
  };
  const finalStatus = {
    schemaVersion: 1,
    goalId: identifiers.goalId,
    goalRevision: 1,
    workflowId: identifiers.workflowId,
    workflowVersion: 14,
    phase: 'CLOSEOUT',
    runStatus: 'CLOSED',
    executionProfileRef: selectedProfile.execution,
    acceptanceSummary: {
      decisionId: identifiers.acceptanceDecisionId,
      outcome: 'ACCEPT',
      dominantReasonCode: 'ALL_RULES_PASSED',
      decisionDigest: digest('acceptance-decision'),
      issuedAt: '2026-08-11T00:00:14.000Z',
    },
    closeoutRef: {
      acceptanceDecisionId: identifiers.acceptanceDecisionId,
      candidateGenerationId: identifiers.generationId,
      closedAt: '2026-08-11T00:00:15.000Z',
    },
    nextSafeAction: 'NO_ACTION',
    technicalCloseout: true,
  };
  const startAuthorization = {
    id: identifiers.startAuthorizationId,
    goalId: identifiers.goalId,
    goalRevision: 1,
    workflowId: identifiers.workflowId,
    workflowVersion: 1,
    startCommandId: identifiers.startCommandId,
    executionProfileId: selectedProfile.execution.id,
    executionProfileDigest: selectedProfile.execution.digest,
  };
  const startResult = {
    command: {
      status: 'APPLIED',
      output: {
        schemaVersion: 1,
        commandId: identifiers.startCommandId,
        ok: true,
        goalId: identifiers.goalId,
        workflowVersion: 2,
        phase: 'DISCOVERY',
        runStatus: 'RUNNING',
      },
    },
  };
  const processedStartCommand = {
    commandId: identifiers.startCommandId,
    aggregateType: 'GOAL',
    aggregateId: identifiers.goalId,
    outcome: {
      schemaVersion: 3,
      disposition: 'APPLIED',
      target: { aggregateType: 'GOAL', aggregateId: identifiers.goalId },
      goalId: identifiers.goalId,
      workflow: {
        id: identifiers.workflowId,
        version: 2,
        phase: 'DISCOVERY',
        runStatus: 'RUNNING',
      },
      output: { ...startResult.command.output },
    },
  };
  const finalAuthority = {
    goal: { id: identifiers.goalId, revision: 1 },
    workflow: { id: identifiers.workflowId, version: 14 },
    executionProfileBinding: {
      goalId: identifiers.goalId,
      workflowId: identifiers.workflowId,
      startCommandId: identifiers.startCommandId,
      profileId: selectedProfile.execution.id,
      profileVersion: selectedProfile.execution.version,
      profileDigest: selectedProfile.execution.digest,
    },
    policyBinding: {
      goalId: identifiers.goalId,
      workflowId: identifiers.workflowId,
      startCommandId: identifiers.startCommandId,
      policyBundleId: selectedProfile.workflowPolicy.id,
      policyBundleVersion: selectedProfile.workflowPolicy.version,
      policyBundleDigest: selectedProfile.workflowPolicy.digest,
    },
  };
  options.mutateStartAuthority?.({
    finalAuthority,
    processedStartCommand,
    startAuthorization,
    startResult,
  });
  const goal = projectM251LiveCompositionGoal(
    { finalAuthority, finalStatus, processedStartCommand, startAuthorization, startResult },
    selectedProfile,
  );
  const intake = projectM251LiveCompositionIntake(
    {
      submitCommandId: identifiers.submitCommandId,
      clarificationCommandId: identifiers.clarificationCommandId,
      authority: {
        intakeRun: { id: identifiers.intakeRunId, status: 'MATERIALIZED' },
        outcomes: [
          {
            commandId: identifiers.submitCommandId,
            disposition: 'APPLIED',
            result: {
              kind: 'CLARIFICATION_REQUIRED',
              activeQuestionRef: { clarificationQuestionId: identifiers.questionId },
            },
          },
          {
            commandId: identifiers.clarificationCommandId,
            disposition: 'APPLIED',
            result: { kind: 'MATERIALIZED' },
          },
        ],
        questions: [{ id: identifiers.questionId, affectedFields: ['REQUIRED_CRITERION'] }],
        reservations: [
          { operationKind: 'INTENT_ANALYSIS' },
          { operationKind: 'CLARIFICATION_ANALYSIS' },
        ],
        materialization: {
          id: identifiers.materializationId,
          goalId: identifiers.goalId,
          workflowId: identifiers.workflowId,
        },
        startAuthorization,
      },
    },
    goal,
    selectedProfile,
  );
  const candidateAuthority = {
    candidate: { id: identifiers.candidateId, goalId: identifiers.goalId },
    generation: {
      id: identifiers.generationId,
      candidateId: identifiers.candidateId,
      state: 'ACCEPTED',
      baseDigest: digest('candidate-base'),
      frozenDigest: digest('candidate-current'),
    },
  };
  const freezeEvidence = {
    id: identifiers.freezeEvidenceId,
    schemaVersion: 2,
    kind: 'CANDIDATE_FREEZE',
    candidateGenerationId: identifiers.generationId,
    candidateDigest: digest('candidate-current'),
    recordDigest: digest('freeze-evidence'),
    observation: {
      schemaVersion: 2,
      kind: 'CANDIDATE_FREEZE',
      baseSourceDigest: digest('candidate-base'),
      firstSourceDigest: digest('candidate-current'),
      secondSourceDigest: digest('candidate-current'),
      changeSetDigest: digest('candidate-change-set'),
      allowedPathPolicyDigest: digest('allowed-path-policy'),
      changes: [{ path: 'src/payment.js', kind: 'MODIFIED' }],
    },
  };
  const candidate = projectM251LiveCompositionCandidate(
    { authority: candidateAuthority, freezeEvidence },
    goal,
  );
  const phaseAuthorities = M251_LIVE_COMPOSITION_PHASES.map((expected, index) => {
    const attemptId = `attempt_${expected.phase}`;
    const workerSessionId = `worker-session_${expected.phase}`;
    const externalExecutionId = `external_${expected.phase}`;
    const resultEventId = `event_${expected.phase}`;
    const contextManifestId = `context_${expected.phase}`;
    const contextManifestDigest = digest(`context:${expected.phase}`);
    const contextPackageDigest = digest(`package:${expected.phase}`);
    const workflowVersionAtAuthorization = index + 2;
    const receivedAt = `2026-08-11T00:00:0${index + 2}.000Z`;
    const sourceAuthority =
      expected.sourceKind === 'PROJECT_READ'
        ? {
            kind: 'PROJECT_READ',
            projectReadAuthorityId: `project-read_${expected.phase}`,
            projectReadAuthorityRecordDigest: digest(`project-read-authority:${expected.phase}`),
            snapshotCwdIdentity: `/tmp/project-read/${expected.phase}`,
          }
        : {
            kind: 'CANDIDATE',
            candidateWorkspaceLeaseId: 'candidate-lease_IMPLEMENT',
            candidateWorkspaceLeaseDigest: digest('candidate-lease:IMPLEMENT'),
            candidateWorkspaceCwdIdentity: '/tmp/candidate/IMPLEMENT',
          };
    const externalRecord = {
      id: externalExecutionId,
      schemaVersion: 2,
      goalId: identifiers.goalId,
      goalRevision: 1,
      workflowId: identifiers.workflowId,
      workflowVersionAtAuthorization,
      phase: expected.phase,
      phaseVersion: workflowVersionAtAuthorization,
      attemptId,
      workerSessionId,
      contextManifestId,
      contextManifestDigest,
      contextPackageDigest,
      executionProfileId: selectedProfile.execution.id,
      executionProfileDigest: selectedProfile.execution.digest,
      policyBundleId: selectedProfile.workflowPolicy.id,
      policyBundleDigest: selectedProfile.workflowPolicy.digest,
      phaseDispatchEntryDigest: selectedProfile.phaseBindings[index].phaseEntryDigest,
      sourceAuthority,
      intentDigest: digest(`external-intent:${expected.phase}`),
      state: 'COMPLETED',
      processIdentity: { identityDigest: digest(`process:${expected.phase}`) },
      backendSessionRef: `thread_${expected.phase}`,
      backendOperationRef: `turn_${expected.phase}`,
      compactionCount: 0,
      turnInterruptCount: 0,
      resultEventId,
      recordDigest: digest(`external-record:${expected.phase}`),
    };
    const contextManifest = {
      id: contextManifestId,
      schemaVersion: expected.sourceKind === 'PROJECT_READ' ? 5 : 4,
      compilerVersion: 'm251-context-v1',
      createdAt: `2026-08-11T00:00:0${index + 1}.000Z`,
      goalId: identifiers.goalId,
      goalRevision: 1,
      workflowId: identifiers.workflowId,
      workflowVersion: workflowVersionAtAuthorization,
      phase: expected.phase,
      attemptId,
      executionProfileId: selectedProfile.execution.id,
      executionProfileDigest: selectedProfile.execution.digest,
      policyBundleId: selectedProfile.workflowPolicy.id,
      policyBundleDigest: selectedProfile.workflowPolicy.digest,
      acceptanceCriticalVerificationPlanId: identifiers.verificationPlanId,
      acceptanceCriticalVerificationPlanDigest: digest('verification-plan'),
      capabilityGrantDigest: digest(`capability-grant:${expected.phase}`),
      responseContractDigest: digest(`response-contract:${expected.phase}`),
      entries: [],
      omissionDecisions: [],
      packageDigest: contextPackageDigest,
      manifestDigest: contextManifestDigest,
      ...(expected.sourceKind === 'PROJECT_READ'
        ? {
            projectReadAuthorityId: sourceAuthority.projectReadAuthorityId,
            projectReadAuthorityRecordDigest: sourceAuthority.projectReadAuthorityRecordDigest,
            projectReadSourceTreeProjectionDigest: digest(
              `project-read-source-tree:${expected.phase}`,
            ),
            projectReadGitStateProjectionDigest: digest(`project-read-git-state:${expected.phase}`),
          }
        : {
            candidateGenerationId: identifiers.generationId,
            candidateDigest: candidate.baseSourceDigest,
          }),
    };
    return {
      attempt: {
        id: attemptId,
        workflowId: identifiers.workflowId,
        phase: expected.phase,
        sequence: 1,
        contextManifestId,
        capabilityGrant: { kind: 'fixture-only-not-projected' },
        workerSessionRef: workerSessionId,
        startedAt: `2026-08-11T00:00:0${index + 1}.000Z`,
        status: 'RESULT_RECORDED',
        terminationReason: `WORKER_RESULT:${expected.resultKind}`,
        endedAt: receivedAt,
      },
      contextManifest,
      externalRecord,
      adapterObservation: {
        schemaVersion: 2,
        state: 'COMPLETED',
        activityDisposition: 'ADMITTED',
        approvalRequestCount: 0,
        phase: expected.phase,
        phaseDispatchEntryDigest: externalRecord.phaseDispatchEntryDigest,
        directiveDigest: digest(`directive:${expected.phase}`),
        externalExecutionIntentDigest: externalRecord.intentDigest,
        requestAttemptId: attemptId,
        requestWorkerSessionId: workerSessionId,
        workerActivityPolicyId: selectedProfile.workerActivityPolicy.id,
        workerActivityPolicyDigest: selectedProfile.workerActivityPolicy.digest,
        processLaunchCount: 1,
        backendSessionRef: externalRecord.backendSessionRef,
        backendOperationRef: externalRecord.backendOperationRef,
        compactionCount: 0,
        turnInterruptCount: 0,
        resultEventId,
        sourceAuthority: { ...sourceAuthority },
      },
      workerEventReceipt: {
        schemaVersion: 1,
        disposition: 'ADMITTED',
        eventId: resultEventId,
        payloadDigest: digest(`worker-event:${expected.phase}`),
        attemptId,
        workerSessionId,
        workflowId: identifiers.workflowId,
        observedWorkflowVersion: workflowVersionAtAuthorization,
        contextManifestId,
        contextManifestDigest,
        packageDigest: contextPackageDigest,
        receivedAt,
        internalCommandId: `command_admit-worker-event_${expected.phase}`,
      },
      ...(expected.sourceKind === 'PROJECT_READ'
        ? {
            projectReadAuthority: {
              schemaVersion: 1,
              id: sourceAuthority.projectReadAuthorityId,
              goalId: identifiers.goalId,
              goalRevision: 1,
              workflowId: identifiers.workflowId,
              workflowVersion: workflowVersionAtAuthorization,
              recordDigest: sourceAuthority.projectReadAuthorityRecordDigest,
              snapshotLeafRealpath: sourceAuthority.snapshotCwdIdentity,
              snapshotTreeDigest: digest(`project-read-snapshot:${expected.phase}`),
              sourceTree: {
                projectionDigest: contextManifest.projectReadSourceTreeProjectionDigest,
              },
              gitState: {
                projectionDigest: contextManifest.projectReadGitStateProjectionDigest,
              },
              attemptId,
              phase: expected.phase,
              phaseDispatchEntryDigest: externalRecord.phaseDispatchEntryDigest,
              executionProfileId: selectedProfile.execution.id,
              executionProfileVersion: selectedProfile.execution.version,
              executionProfileDigest: selectedProfile.execution.digest,
              policyBundleId: selectedProfile.workflowPolicy.id,
              policyBundleVersion: selectedProfile.workflowPolicy.version,
              policyBundleDigest: selectedProfile.workflowPolicy.digest,
            },
          }
        : {}),
    };
  });
  options.mutatePhaseAuthorities?.(phaseAuthorities);
  const phases = projectM251LiveCompositionPhases(
    phaseAuthorities,
    selectedProfile,
    goal,
    candidate,
  );
  const verificationPlan = {
    schemaVersion: 1,
    id: identifiers.verificationPlanId,
    planDigest: digest('verification-plan'),
    protectedAssets: [
      { logicalAssetId: protectedCheck.id, contentDigest: protectedCheck.assetDigest },
    ],
  };
  const verificationCheck = {
    id: identifiers.verificationCheckId,
    schemaVersion: 3,
    version: protectedCheck.version,
    runnerIdentity: 'protected-local-verification',
    runnerVersion: 'v1',
    acceptanceCriticalVerificationPlanId: identifiers.verificationPlanId,
    acceptanceCriticalVerificationPlanDigest: verificationPlan.planDigest,
  };
  const verificationEvidence = {
    id: identifiers.verificationEvidenceId,
    schemaVersion: 3,
    candidateGenerationId: identifiers.generationId,
    candidateDigest: candidate.firstSourceDigest,
    recordDigest: digest('verification-evidence'),
    resultStatus: 'PASS',
    observation: { exitCode: 0 },
    checkSpec: verificationCheck,
    acceptanceCriticalVerificationPlanId: identifiers.verificationPlanId,
    acceptanceCriticalVerificationPlanDigest: verificationPlan.planDigest,
  };
  const verification = projectM251LiveCompositionVerification(
    { plan: verificationPlan, evidence: verificationEvidence },
    candidate,
    project,
  );
  const evidenceSet = {
    schemaVersion: 1,
    candidateGenerationId: identifiers.generationId,
    candidateDigest: candidate.firstSourceDigest,
    digest: digest('evidence-set'),
    evidenceRefs: [
      {
        evidenceId: verificationEvidence.id,
        evidenceRecordDigest: verificationEvidence.recordDigest,
      },
    ],
  };
  options.mutateEvidenceAuthorities?.({ evidenceSet, freezeEvidence, verificationEvidence });
  const evidence = projectM251LiveCompositionEvidence(
    { evidenceSet, freezeEvidence, verificationEvidence },
    candidate,
    verification,
  );
  const acceptanceManifest = {
    schemaVersion: 2,
    phase: 'FINAL_VERIFY',
    goalId: identifiers.goalId,
    goalRevision: 1,
    workflowId: identifiers.workflowId,
    workflowVersion: 13,
    candidateGenerationId: identifiers.generationId,
    candidateDigest: candidate.firstSourceDigest,
    evidenceSetDigest: evidenceSet.digest,
    policyBundleId: policyBundle.id,
    policyBundleDigest: policyBundle.digest,
    acceptanceCriticalVerificationPlanId: verificationPlan.id,
    acceptanceCriticalVerificationPlanDigest: verificationPlan.planDigest,
    manifestDigest: digest('acceptance-input-manifest'),
  };
  const acceptanceDecision = {
    id: identifiers.acceptanceDecisionId,
    schemaVersion: 1,
    inputManifestDigest: acceptanceManifest.manifestDigest,
    policyBundleDigest: policyBundle.digest,
    outcome: 'ACCEPT',
    decisionDigest: finalStatus.acceptanceSummary.decisionDigest,
  };
  const acceptance = projectM251LiveCompositionAcceptance(
    { manifest: acceptanceManifest, decision: acceptanceDecision, policyBundle },
    goal,
    candidate,
    evidence,
    verification,
    selectedProfile,
  );
  const workflow = {
    id: identifiers.workflowId,
    goalId: identifiers.goalId,
    goalRevision: 1,
    version: 14,
    phase: 'CLOSEOUT',
    runStatus: 'CLOSED',
  };
  const closeoutAuthority = {
    goalId: identifiers.goalId,
    goalRevision: 1,
    workflowId: identifiers.workflowId,
    workflowVersion: 14,
    acceptanceDecisionId: identifiers.acceptanceDecisionId,
    acceptanceDecisionDigest: acceptanceDecision.decisionDigest,
    inputManifestDigest: acceptanceManifest.manifestDigest,
    candidateGenerationId: identifiers.generationId,
    candidateDigest: candidate.firstSourceDigest,
    evidenceSetDigest: evidenceSet.digest,
    policyBundleId: policyBundle.id,
    policyBundleDigest: policyBundle.digest,
  };
  const closeout = projectM251LiveCompositionCloseout(
    { workflow, closeout: closeoutAuthority, finalStatus },
    goal,
    candidate,
    acceptance,
  );
  const reopen = projectM251LiveCompositionReopen(
    {
      goalFound: true,
      technicalCloseout: true,
      finalStatusProjectionDigest: goal.finalStatusProjectionDigest,
      intakeCommandStatus: 'REPLAYED',
      startCommandStatus: 'REPLAYED',
      assistantOperationDelta: 0,
      workerDispatchDelta: 0,
      modelRecallCount: 0,
    },
    goal,
    phases,
    closeout,
  );
  const cleanup = projectM251LiveCompositionCleanup({
    ownedProcessesShutdownClean: true,
    intakeExecutionRootRemoved: true,
    workerControlledRootsRemoved: true,
    projectReadSnapshotsRemoved: true,
    candidateWorkspaceRemoved: true,
    verificationRunRootRemoved: true,
    authorityHomeRemoved: true,
    assessmentRootRemoved: true,
    credentialRootUnchanged: true,
    protectedAssetRootUnchanged: true,
    sourceUnchanged: true,
  });
  return clone({
    schemaVersion: 1,
    kind: M251_LIVE_COMPOSITION_RECEIPT_KIND,
    scenarioId: M251_LIVE_COMPOSITION_SCENARIO.id,
    scenarioDigest: m251LiveCompositionScenarioDigest(),
    authorization: 'EXPLICIT',
    stages: projectM251LiveCompositionStages(M251_LIVE_COMPOSITION_STAGE_IDS),
    source: { opening: sourceIdentity(), closing: sourceIdentity() },
    toolchain: {
      nodeVersion: 'v22.22.3',
      pnpmVersion: '11.1.3',
      codexVersion: contract.toolchain.selected.codexVersion,
      protocolSnapshotDigest: contract.toolchain.selected.snapshotDigest,
      launcherDigest: contract.toolchain.selected.launcherDigest,
      delegatedExecutableDigest: contract.toolchain.selected.delegatedExecutableDigest,
      intakeAssistantProfileVersion: contract.intake.assistantProfile.version,
      intakeAssistantAdapterVersion: contract.intake.assistantAdapter.version,
      intakeConfigurationVersion: contract.intake.closedConfiguration.version,
      intakeProjectionVersion: contract.intake.protocolProjectionPolicy.version,
    },
    profile: selectedProfile,
    project,
    projectClosure: { opening: projectObservation(), closing: projectObservation() },
    roots,
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
    privacy: {
      requestContentRetained: false,
      answerContentRetained: false,
      assistantOrModelContentRetained: false,
      reasoningOrTranscriptRetained: false,
      rawProtocolOrExceptionRetained: false,
      credentialOrAccountContentRetained: false,
      sourceBytesRetained: false,
      unrestrictedCommandOutputRetained: false,
    },
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

void test('[M251-S4-B5] cleanup diagnostics name only failed metadata checks', () => {
  const cleanup = receipt().cleanup;
  assert.equal(m251LiveCompositionCleanupFailureReasonCode(cleanup), undefined);
  assert.equal(
    m251LiveCompositionCleanupFailureReasonCode({
      ...cleanup,
      intakeExecutionRootRemoved: false,
      projectReadSnapshotsRemoved: false,
    }),
    'CLEANUP_INCOMPLETE_INTAKE_EXECUTION_ROOT+PROJECT_READ_SNAPSHOTS',
  );
  assert.throws(
    () =>
      m251LiveCompositionCleanupFailureReasonCode({
        ...cleanup,
        unexpectedPath: '/private/sensitive/path',
      }),
    /cleanup observation has unknown or missing fields/u,
  );
});

void test('[M251-S4-B5] owned assessment cleanup removes frozen trees without following aliases', (t) => {
  const temporaryRoot = realpathSync(tmpdir());
  const ownedRoot = realpathSync(
    mkdtempSync(join(temporaryRoot, 'codeclosure-m2-5-1-live-composition-test-')),
  );
  const frozenRoot = join(ownedRoot, 'candidate', 'generation');
  mkdirSync(frozenRoot, { recursive: true });
  writeFileSync(join(frozenRoot, 'source.js'), 'fixture\n');
  chmodSync(frozenRoot, 0o500);
  m251RemoveOwnedAssessmentRoot(ownedRoot);
  assert.equal(existsSync(ownedRoot), false);

  const externalRoot = mkdtempSync(join(temporaryRoot, 'codeclosure-m251-cleanup-external-'));
  const aliasedRoot = realpathSync(
    mkdtempSync(join(temporaryRoot, 'codeclosure-m2-5-1-live-containment-test-')),
  );
  t.after(() => {
    rmSync(aliasedRoot, { force: true, recursive: true });
    rmSync(externalRoot, { force: true, recursive: true });
  });
  symlinkSync(externalRoot, join(aliasedRoot, 'escape'));
  assert.throws(
    () => m251RemoveOwnedAssessmentRoot(aliasedRoot),
    /cleanup encountered a symbolic link/u,
  );
  assert.equal(existsSync(externalRoot), true);

  const unownedRoot = realpathSync(
    mkdtempSync(join(temporaryRoot, 'codeclosure-unowned-assessment-')),
  );
  t.after(() => rmSync(unownedRoot, { force: true, recursive: true }));
  assert.throws(
    () => m251RemoveOwnedAssessmentRoot(unownedRoot),
    /cleanup target is not one exact owned root/u,
  );
});

function strictValidate(value) {
  const baseline = receipt();
  return validateM251LiveCompositionReceipt(value, {
    source: baseline.source.opening,
    project: baseline.projectClosure.opening,
    roots: baseline.roots,
    profile: baseline.profile,
  });
}

test('M2.5.1 Live composition receipt accepts one complete metadata-only linked path', () => {
  const value = receipt();
  assert.equal(strictValidate(value), value);
  assert.equal(value.intake.assistantOperationCount, 2);
  assert.doesNotMatch(JSON.stringify(value), /Prevent duplicate payment callbacks/u);
  assert.doesNotMatch(JSON.stringify(value), /duplicate callback for one order/u);
  assert.doesNotMatch(JSON.stringify(value), /src\/payment\.js/u);
});

test('M2.5.1 Live composition Receipt can bind the canonical assessment source identity', () => {
  const value = receipt();
  value.source.opening.reviewExclusion = M251_REVIEW_EXCLUSION;
  value.source.closing.reviewExclusion = M251_REVIEW_EXCLUSION;
  assert.equal(
    validateM251LiveCompositionReceipt(
      value,
      {
        source: value.source.opening,
        project: value.projectClosure.opening,
        roots: value.roots,
        profile: value.profile,
      },
      M251_REVIEW_EXCLUSION,
    ),
    value,
  );
  assert.throws(() => strictValidate(value), /contract identity is invalid/u);
});

test('M2.5.1 Live composition keeps Candidate freeze outside the Acceptance Evidence Set', () => {
  assert.throws(
    () =>
      receipt({
        mutateEvidenceAuthorities({ evidenceSet, freezeEvidence }) {
          evidenceSet.evidenceRefs.push({
            evidenceId: freezeEvidence.id,
            evidenceRecordDigest: freezeEvidence.recordDigest,
          });
        },
      }),
    /Candidate-freeze and Acceptance Evidence authorities are not separated/u,
  );

  assert.throws(
    () =>
      receipt({
        mutateEvidenceAuthorities({ evidenceSet, freezeEvidence }) {
          evidenceSet.evidenceRefs.splice(0, 1, {
            evidenceId: freezeEvidence.id,
            evidenceRecordDigest: freezeEvidence.recordDigest,
          });
        },
      }),
    /Candidate-freeze and Acceptance Evidence authorities are not separated/u,
  );
});

test('M2.5.1 Live composition scenario fully states the protected observable result and leaves scope to Policy', () => {
  assert.equal(
    M251_LIVE_COMPOSITION_SCENARIO.request,
    'Objective: Prevent duplicate payment callbacks.',
  );
  assert.doesNotMatch(M251_LIVE_COMPOSITION_SCENARIO.request, /(?:^|\n)Scope:/u);
  assert.doesNotMatch(M251_LIVE_COMPOSITION_SCENARIO.request, /src\/payment\.js/u);
  assert.match(M251_LIVE_COMPOSITION_SCENARIO.clarificationAnswer, /^Required criterion: /u);
  assert.equal(
    M251_LIVE_COMPOSITION_SCENARIO.clarificationAnswer,
    `Required criterion: ${contract.demonstration.expectedResult}`,
  );
  assert.match(M251_LIVE_COMPOSITION_SCENARIO.clarificationAnswer, /\bduplicate_ignored\b/u);
});

test('M2.5.1 Live composition authorization is one new exact admission binding', () => {
  assert.equal(
    admitM251LiveCompositionAuthorization({
      [M251_LIVE_COMPOSITION_AUTHORIZATION_ENV]: '1',
    }),
    'EXPLICIT',
  );
  assert.throws(() => admitM251LiveCompositionAuthorization({}), /must be exactly 1/u);
  assert.throws(
    () =>
      admitM251LiveCompositionAuthorization({
        [M251_LIVE_COMPOSITION_AUTHORIZATION_ENV]: 'true',
      }),
    /must be exactly 1/u,
  );
});

test('M2.5.1 Live composition metadata projection rejects content and unrestricted output', () => {
  for (const prohibited of [
    { request: 'content' },
    { answer: 'content' },
    { modelOutput: 'content' },
    { reasoning: 'content' },
    { transcript: 'content' },
    { rawProtocolPayload: {} },
    { rawException: 'content' },
    { credential: 'content' },
    { accountId: 'content' },
    { sourceBytes: 'content' },
    { stdout: 'content' },
  ]) {
    assert.throws(
      () => assertM251LiveCompositionMetadataOnly(prohibited),
      /prohibited content-bearing field/u,
    );
  }
  assert.throws(
    () => assertM251LiveCompositionMetadataOnly({ value: 'credential-secret' }, ['secret']),
    /prohibited request, response, source, or credential content/u,
  );
});

test('M2.5.1 Live composition receipt rejects source drift with unchanged Git status', () => {
  const value = receipt();
  value.source.closing.digest = digest('changed-source');
  assert.equal(value.source.opening.workingTreeState, value.source.closing.workingTreeState);
  assert.throws(() => strictValidate(value), /source identity drifted or was substituted/u);

  const substituted = receipt();
  substituted.source.opening.digest = digest('substituted-source');
  substituted.source.closing.digest = digest('substituted-source');
  assert.throws(
    () => strictValidate(substituted),
    /Expected live composition source identity drifted or was substituted/u,
  );
});

test('M2.5.1 Live composition project closure rejects worktree and whole-tree drift', () => {
  const changedStatus = projectObservation();
  changedStatus.workingTreeState = 'modified';
  assert.throws(
    () => assertM251LiveCompositionProjectClosure(projectObservation(), changedStatus),
    /not the exact clean demonstration baseline/u,
  );

  const changedTree = projectObservation();
  changedTree.projectTree.digest = digest('changed-project-tree');
  assert.throws(
    () => assertM251LiveCompositionProjectClosure(projectObservation(), changedTree),
    /demonstration project drifted or was substituted/u,
  );

  const substituted = receipt();
  substituted.projectClosure.opening.projectTree.digest = digest('substituted-project-tree');
  substituted.projectClosure.closing.projectTree.digest = digest('substituted-project-tree');
  assert.throws(
    () => strictValidate(substituted),
    /Expected live composition project observation drifted or was substituted/u,
  );
});

test('M2.5.1 Live composition root projector enforces the prepared hierarchy and separation', () => {
  const projected = projectM251LiveCompositionRootIdentity(rootEntries());
  assert.equal(projected.entries.length, M251_LIVE_COMPOSITION_ROOT_KINDS.length);
  assert.doesNotMatch(JSON.stringify(projected), /\/tmp\/codeclosure/u);

  const overlap = rootEntries();
  overlap.find(({ kind }) => kind === 'AUTHORITY_HOME').path =
    '/tmp/codeclosure-m251-b2/candidate/authority';
  assert.throws(
    () => projectM251LiveCompositionRootIdentity(overlap),
    /top-level roots must be pairwise separated/u,
  );

  const substitutedMember = rootEntries();
  substitutedMember.find(({ kind }) => kind === 'INTAKE_CODEX_HOME').path =
    '/tmp/codeclosure-m251-b2/not-intake/codex-home';
  assert.throws(
    () => projectM251LiveCompositionRootIdentity(substitutedMember),
    /Intake members must be exact descendants/u,
  );

  const realProtectedAssetLayout = rootEntries();
  realProtectedAssetLayout.find(({ kind }) => kind === 'PROTECTED_ASSET_ROOT').path =
    '/opt/codeclosure/source/scripts/fixtures/m2.5.1';
  assert.doesNotThrow(() => projectM251LiveCompositionRootIdentity(realProtectedAssetLayout));
  assert.equal(M251_LIVE_COMPOSITION_ROOT_KINDS.includes('CODECLOSURE_SOURCE'), false);
});

test('M2.5.1 Live composition expected root identity rejects a self-consistent substituted set', () => {
  const expected = projectM251LiveCompositionRootIdentity(rootEntries());
  const substituted = projectM251LiveCompositionRootIdentity(
    rootEntries('/tmp/codeclosure-m251-b2-substituted'),
  );
  assert.throws(
    () => assertM251LiveCompositionRootIdentity(expected, substituted),
    /root identity drifted or was substituted/u,
  );
});

test('M2.5.1 Live composition receipt rejects a missing or reordered stage', () => {
  assert.throws(
    () => projectM251LiveCompositionStages(M251_LIVE_COMPOSITION_STAGE_IDS.slice(0, -1)),
    /Completed live composition stages/u,
  );

  const missing = clone(receipt());
  missing.stages.splice(4, 1);
  assert.throws(() => strictValidate(missing), /stage set is incomplete/u);

  const reordered = clone(receipt());
  [reordered.stages[4], reordered.stages[5]] = [reordered.stages[5], reordered.stages[4]];
  assert.throws(() => strictValidate(reordered), /stages are not complete and canonical/u);
});

test('M2.5.1 Live composition receipt cross-binds Manifest, Decision, and closeout authority', () => {
  const substitutedManifest = receipt();
  substitutedManifest.acceptance.decisionInputManifestDigest = digest('other-manifest');
  assert.throws(
    () => strictValidate(substitutedManifest),
    /Acceptance identity or authority binding is invalid/u,
  );

  const substitutedCandidate = receipt();
  substitutedCandidate.closeout.candidateDigest = digest('other-candidate');
  assert.throws(
    () => strictValidate(substitutedCandidate),
    /closeout is not bound to the accepted Goal authority/u,
  );

  const substitutedEvidence = receipt();
  substitutedEvidence.closeout.evidenceSetDigest = digest('other-evidence-set');
  assert.throws(
    () => strictValidate(substitutedEvidence),
    /closeout is not bound to the accepted Goal authority/u,
  );

  const substitutedPolicy = receipt();
  substitutedPolicy.closeout.policyDigest = digest('other-policy');
  assert.throws(
    () => strictValidate(substitutedPolicy),
    /closeout is not bound to the accepted Goal authority/u,
  );
});

test('M2.5.1 Live composition Goal projection rejects substituted Start authority', () => {
  assert.throws(
    () =>
      receipt({
        mutateStartAuthority({ processedStartCommand }) {
          processedStartCommand.outcome.output.commandId = 'command_substituted-start';
        },
      }),
    /Goal authority is not bound to the admitted Start\/Profile/u,
  );

  assert.throws(
    () =>
      receipt({
        mutateStartAuthority({ finalAuthority }) {
          finalAuthority.executionProfileBinding.startCommandId = 'command_substituted-start';
        },
      }),
    /Goal authority is not bound to the admitted Start\/Profile/u,
  );
});

test('M2.5.1 Live composition phase projection rejects substituted authority tuples', () => {
  assert.throws(
    () =>
      receipt({
        mutatePhaseAuthorities(phases) {
          phases[0].adapterObservation.externalExecutionIntentDigest = digest(
            'substituted-external-intent',
          );
        },
      }),
    /phase authority tuple is incomplete, substituted, or unlinked/u,
  );

  const substitutedVerificationPlan = receipt({
    mutatePhaseAuthorities(phases) {
      phases[1].contextManifest.acceptanceCriticalVerificationPlanDigest = digest(
        'substituted-verification-plan',
      );
    },
  });
  assert.throws(
    () => strictValidate(substitutedVerificationPlan),
    /phase Context is not bound to protected verification/u,
  );

  assert.throws(
    () =>
      receipt({
        mutatePhaseAuthorities(phases) {
          phases[1].projectReadAuthority = clone(phases[0].projectReadAuthority);
        },
      }),
    /phase source authority is not the exact selected source/u,
  );

  assert.throws(
    () =>
      receipt({
        mutatePhaseAuthorities(phases) {
          phases[2].contextManifest.candidateGenerationId = 'candidate-generation_substituted';
        },
      }),
    /phase source authority is not the exact selected source/u,
  );

  assert.throws(
    () =>
      receipt({
        mutatePhaseAuthorities(phases) {
          phases[0].externalRecord.policyBundleDigest = digest('substituted-policy');
        },
      }),
    /phase authority tuple is incomplete, substituted, or unlinked/u,
  );

  assert.throws(
    () =>
      receipt({
        mutatePhaseAuthorities(phases) {
          phases[2].workerEventReceipt.eventId = 'event_substituted-result';
        },
      }),
    /phase authority tuple is incomplete, substituted, or unlinked/u,
  );
});

test('M2.5.1 Live composition receipt rejects duplicate phase and FakeWorker substitution', () => {
  const duplicate = receipt();
  duplicate.phases[1].phase = 'DISCOVERY';
  assert.throws(
    () => strictValidate(duplicate),
    /phase receipt is incomplete, substituted, or not real Codex/u,
  );

  const fake = receipt();
  fake.profile.phaseBindings[0].workerKind = 'FAKE_WORKER';
  assert.throws(() => strictValidate(fake), /fake or substituted component/u);
});

test('M2.5.1 Live composition projector rejects retained Profile and Adapter v1 substitution', () => {
  assert.throws(
    () => profile({ executionProfile: contract.execution.executionProfile }),
    /Execution Profile identity is invalid/u,
  );
  assert.throws(
    () =>
      profile({
        workerAdapter: {
          id: M251_LIVE_COMPOSITION_PROFILE_CONTRACT.workerAdapter.id,
          version: 'codeclosure-m2-5-1-worker-v1',
        },
      }),
    /fake or substituted component/u,
  );
});

test('M2.5.1 Live composition receipt rejects reopen recall or dispatch replay', () => {
  const value = receipt();
  value.reopen.workerDispatchDelta = 1;
  assert.throws(
    () => strictValidate(value),
    /recalled, redispatched, drifted, or failed strict replay/u,
  );
});

test('M2.5.1 Live composition receipt rejects Profile, Candidate, and Check substitution', () => {
  const profileSubstitution = receipt();
  profileSubstitution.goal.executionProfileDigest = digest('substituted-profile');
  assert.throws(
    () => strictValidate(profileSubstitution),
    /Goal did not bind the admitted real Profile/u,
  );

  const coordinatedProfileSubstitution = receipt();
  const substitutedProfileDigest = digest('coordinated-substituted-profile');
  coordinatedProfileSubstitution.profile.execution.digest = substitutedProfileDigest;
  coordinatedProfileSubstitution.goal.executionProfileDigest = substitutedProfileDigest;
  coordinatedProfileSubstitution.intake.authorizedProfileDigest = substitutedProfileDigest;
  assert.throws(
    () => strictValidate(coordinatedProfileSubstitution),
    /Profile identity drifted or was substituted/u,
  );

  const candidateSubstitution = receipt();
  candidateSubstitution.verification.candidateGenerationRefDigest =
    reference('substituted-candidate');
  assert.throws(
    () => strictValidate(candidateSubstitution),
    /protected verification identity or result is invalid/u,
  );

  const checkSubstitution = receipt();
  checkSubstitution.verification.checkId = 'check_substituted';
  assert.throws(
    () => strictValidate(checkSubstitution),
    /protected verification identity or result is invalid/u,
  );

  const inventedResultStatus = receipt();
  inventedResultStatus.verification.result = 'PASSED';
  assert.throws(
    () => strictValidate(inventedResultStatus),
    /protected verification identity or result is invalid/u,
  );
});

test('M2.5.1 Live composition receipt rejects root digest drift and unknown fields', () => {
  const drift = clone(receipt());
  drift.roots.entries[0].pathDigest = digest('substituted-root');
  assert.throws(() => strictValidate(drift), /root identity digest is invalid/u);

  const widened = receipt();
  widened.coordinator = 'generic';
  assert.throws(() => strictValidate(widened), /unknown or missing fields/u);
});

test('M2.5.1 Live composition project projection rejects a changed demonstration contract', () => {
  const changed = clone(projectContract);
  changed.gitCommit = '0'.repeat(40);
  assert.throws(
    () => projectM251LiveCompositionProjectIdentity(changed, protectedCheck),
    /project contract drifted or was substituted/u,
  );
});

test('M2.5.1 Live composition command rejects missing authorization before external work', () => {
  const environment = { ...process.env };
  delete environment[M251_LIVE_COMPOSITION_AUTHORIZATION_ENV];
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./run-m2.5.1-live-composition.mjs', import.meta.url))],
    { cwd: repositoryRoot, encoding: 'utf8', env: environment },
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'M2.5.1 live composition failed at ENTRY\n');
});

test('M2.5.1 Live composition command has one explicit non-automatic package entry', () => {
  const packageDocument = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    Object.entries(packageDocument.scripts).filter(([, command]) =>
      command.includes('run-m2.5.1-live-composition.mjs'),
    ),
    [
      [
        'probe:m2.5.1:composition:live',
        'pnpm build && node scripts/run-m2.5.1-live-composition.mjs',
      ],
    ],
  );
});
