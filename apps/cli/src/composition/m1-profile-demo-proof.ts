import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkflowDriveStopReason } from '@codeclosure/runtime';

import {
  CliDemoProofCode,
  type CliDemoProofResult,
  type CliDemoScenario,
} from '../cli/contracts.js';
import { ProtectedPathKind } from './data-home.js';
import {
  assertM1ProofReopen,
  requireM1ProofAudit,
  requireM1ProofStatus,
} from './m1-demo-proof-helpers.js';
import {
  createCliCommandId,
  createCliComposition,
  createTrustedCliComposition,
  type CliComposition,
  type CreateCliCompositionOptions,
  type TrustedCliComposition,
} from './trusted-composition.js';

type DirectProfileScenario = Exclude<CliDemoScenario, 'stale-closeout' | 'restart-resume'>;
type DuplicateResultObservation = ReturnType<
  TrustedCliComposition['proofObservation']['readDuplicateResultWorker']
>;

interface DirectProfileProofComposition {
  readonly application: CliComposition['application'];
  readonly proofObservation: TrustedCliComposition['proofObservation'];
  close(): void;
}

function createDirectProfileProofComposition(
  options: CreateCliCompositionOptions,
): DirectProfileProofComposition {
  const trusted = createTrustedCliComposition(options);
  return Object.freeze({
    application: trusted.application,
    proofObservation: trusted.proofObservation,
    close: (): void => trusted.close(),
  });
}

const expectedProfileId: Readonly<Record<DirectProfileScenario, string>> = Object.freeze({
  'happy-path': 'profile_m1-happy-path',
  'lying-worker': 'profile_m1-lying-worker',
  'missing-evidence': 'profile_m1-missing-evidence',
  'failing-evidence': 'profile_m1-failing-evidence',
  'duplicate-result': 'profile_m1-duplicate-result',
  'candidate-drift': 'profile_m1-candidate-drift',
});

function assertExactCloseout(status: CliDemoProofResult['finalStatus']): void {
  if (
    status.phase !== 'CLOSEOUT' ||
    status.runStatus !== 'CLOSED' ||
    status.acceptanceSummary?.outcome !== 'ACCEPT' ||
    status.activeCandidateRef?.state !== 'ACCEPTED' ||
    !status.technicalCloseout ||
    status.closeoutRef === undefined
  ) {
    throw new TypeError('M1 demo did not reach exact technical closeout authority');
  }
}

function duplicateDeliveryHadOneEffect(
  audit: CliDemoProofResult['audit'],
  observation: DuplicateResultObservation,
): boolean {
  const claims = audit.events.filter((event) => event.eventType === 'WORKER_DISPATCH_CLAIMED');
  const observedAttemptIds = observation.requests.map((request) => request.attemptId);
  if (
    observation.fixture !== 'duplicate-result' ||
    observation.requestCount === 0 ||
    observation.requestCount !== observation.requests.length ||
    observation.eventDeliveryCount !== observation.requestCount * 2 ||
    claims.length !== observation.requestCount ||
    new Set(observedAttemptIds).size !== observedAttemptIds.length ||
    new Set(claims.map((claim) => claim.aggregateId)).size !== claims.length
  ) {
    return false;
  }

  return observation.requests.every((request) => {
    const [firstDelivery, secondDelivery] = request.deliveries;
    if (
      request.deliveries.length !== 2 ||
      firstDelivery?.ordinal !== 1 ||
      secondDelivery?.ordinal !== 2 ||
      firstDelivery.eventId === undefined ||
      secondDelivery.eventId !== firstDelivery.eventId
    ) {
      return false;
    }
    const starts = audit.events.filter(
      (event) => event.eventType === 'ATTEMPT_STARTED' && event.aggregateId === request.attemptId,
    );
    const requestClaims = claims.filter((event) => event.aggregateId === request.attemptId);
    const finishes = audit.events.filter(
      (event) => event.eventType === 'ATTEMPT_FINISHED' && event.aggregateId === request.attemptId,
    );
    const workflowFinishes = audit.events.filter(
      (event) =>
        event.eventType === 'WORKFLOW_ATTEMPT_FINISHED' &&
        event.aggregateId === request.workflowId &&
        event.causationId === firstDelivery.eventId,
    );
    const start = starts[0];
    const claim = requestClaims[0];
    const finish = finishes[0];
    const workflowFinish = workflowFinishes[0];
    return (
      starts.length === 1 &&
      requestClaims.length === 1 &&
      finishes.length === 1 &&
      workflowFinishes.length === 1 &&
      start !== undefined &&
      claim !== undefined &&
      finish !== undefined &&
      workflowFinish !== undefined &&
      start.afterVersion === request.workflowVersion &&
      claim.beforeVersion === request.workflowVersion &&
      claim.afterVersion === request.workflowVersion &&
      finish.beforeVersion === request.workflowVersion &&
      finish.causationId === firstDelivery.eventId &&
      workflowFinish.commandId === finish.commandId &&
      workflowFinish.beforeVersion === finish.beforeVersion &&
      workflowFinish.afterVersion === finish.afterVersion &&
      start.sequence < claim.sequence &&
      claim.sequence < finish.sequence &&
      finish.sequence < workflowFinish.sequence
    );
  });
}

function assertScenario(
  scenario: DirectProfileScenario,
  result: Omit<CliDemoProofResult, 'schemaVersion' | 'scenario' | 'passed' | 'proofCode'>,
  duplicateObservation: DuplicateResultObservation,
): CliDemoProofResult['proofCode'] {
  const { finalDrive, finalStatus, audit } = result;
  if (finalStatus.executionProfileRef?.id !== expectedProfileId[scenario]) {
    throw new TypeError('M1 demo did not retain the selected Execution Profile');
  }
  if (scenario !== 'duplicate-result' && duplicateObservation.requestCount !== 0) {
    throw new TypeError('Unselected duplicate-result FakeWorker unexpectedly ran');
  }
  switch (scenario) {
    case 'happy-path':
      assertExactCloseout(finalStatus);
      if (finalDrive.stopReason !== WorkflowDriveStopReason.CLOSED) {
        throw new TypeError('Happy-path demo did not stop at closeout');
      }
      return CliDemoProofCode.HAPPY_PATH_EXACT_CLOSEOUT;
    case 'lying-worker':
      if (
        finalDrive.stopReason !== WorkflowDriveStopReason.FAILED ||
        finalDrive.detailCode !== 'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT' ||
        finalStatus.phase !== 'DISCOVERY' ||
        finalStatus.runStatus !== 'FAILED' ||
        finalStatus.acceptanceSummary !== undefined ||
        finalStatus.technicalCloseout
      ) {
        throw new TypeError('Lying-worker demo did not reject fabricated completion authority');
      }
      return CliDemoProofCode.LYING_WORKER_REJECTED;
    case 'missing-evidence':
      if (
        finalDrive.stopReason !== WorkflowDriveStopReason.FAILED ||
        finalDrive.detailCode !== 'VERIFICATION_OUTPUT_MALFORMED' ||
        finalStatus.phase !== 'EVIDENCE_BUILD' ||
        finalStatus.runStatus !== 'FAILED' ||
        finalStatus.acceptanceSummary !== undefined ||
        finalStatus.technicalCloseout
      ) {
        throw new TypeError('Missing-evidence demo did not fail before Acceptance');
      }
      return CliDemoProofCode.MISSING_EVIDENCE_FAILED_CLOSED;
    case 'failing-evidence':
      if (
        finalDrive.stopReason !== WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED ||
        finalStatus.phase !== 'FINAL_VERIFY' ||
        finalStatus.runStatus !== 'READY' ||
        finalStatus.acceptanceSummary?.outcome !== 'REJECT_REPAIRABLE' ||
        finalStatus.dominantBlocker?.code !== 'ACCEPTANCE_REPAIR_REQUIRED' ||
        finalStatus.technicalCloseout
      ) {
        throw new TypeError('Failing-evidence demo did not retain repairable rejection authority');
      }
      return CliDemoProofCode.FAILING_EVIDENCE_REPAIR_REQUIRED;
    case 'duplicate-result':
      assertExactCloseout(finalStatus);
      if (
        finalDrive.stopReason !== WorkflowDriveStopReason.CLOSED ||
        !duplicateDeliveryHadOneEffect(audit, duplicateObservation)
      ) {
        throw new TypeError('Duplicate-result demo did not prove one effect per dispatch claim');
      }
      return CliDemoProofCode.DUPLICATE_RESULT_DEDUPLICATED;
    case 'candidate-drift':
      if (
        finalDrive.stopReason !== WorkflowDriveStopReason.FAILED ||
        finalDrive.detailCode !== 'SOURCE_CHANGED_DURING_FREEZE' ||
        finalStatus.phase !== 'SOURCE_FREEZE' ||
        finalStatus.runStatus !== 'FAILED' ||
        finalStatus.activeCandidateRef?.state !== 'INVALIDATED' ||
        finalStatus.acceptanceSummary !== undefined ||
        finalStatus.technicalCloseout
      ) {
        throw new TypeError('Candidate-drift demo did not invalidate changed source authority');
      }
      return CliDemoProofCode.CANDIDATE_DRIFT_INVALIDATED;
  }
}

export async function runM1DirectProfileProof(
  scenario: DirectProfileScenario,
): Promise<CliDemoProofResult> {
  const runRoot = mkdtempSync(join(tmpdir(), `codeclosure-m1-${scenario}-`));
  const projectPath = join(runRoot, 'project');
  mkdirSync(projectPath, { mode: 0o700 });
  const compositionOptions: CreateCliCompositionOptions = Object.freeze({
    dataHomePath: join(runRoot, 'authority'),
    protectedPaths: Object.freeze([
      Object.freeze({ kind: ProtectedPathKind.PROJECT, path: projectPath }),
    ]),
    allowedProjectPaths: Object.freeze([projectPath]),
    startProfileName: scenario,
  });
  let composition: DirectProfileProofComposition | undefined;
  try {
    composition = createDirectProfileProofComposition(compositionOptions);
    const created = composition.application.createGoal({
      commandId: createCliCommandId(),
      objective: `Prove the ${scenario} M1 control scenario`,
      projectPath,
      criteria: [`The ${scenario} scenario reaches its exact expected authority`],
    });
    if (created.status !== 'APPLIED') {
      throw new TypeError('M1 demo could not create its isolated Goal');
    }
    const createdStatus = requireM1ProofStatus(composition.application, created.output.goalId);
    const started = await composition.application.startGoal({
      commandId: createCliCommandId(),
      goalId: created.output.goalId,
      expectedGoalRevision: createdStatus.goalRevision,
      expectedWorkflowVersion: createdStatus.workflowVersion,
    });
    if (!started.command.output.ok || started.drive === undefined) {
      throw new TypeError('M1 demo could not enter the Runtime driver');
    }
    const finalStatus = requireM1ProofStatus(composition.application, created.output.goalId);
    const audit = requireM1ProofAudit(composition.application, created.output.goalId);
    const duplicateObservation = composition.proofObservation.readDuplicateResultWorker();
    composition.close();
    composition = undefined;

    const reopened = createCliComposition({
      ...compositionOptions,
      startProfileName: 'happy-path',
    });
    let reopenedStatus: typeof finalStatus;
    try {
      reopenedStatus = requireM1ProofStatus(reopened.application, created.output.goalId);
      assertM1ProofReopen(
        finalStatus,
        reopenedStatus,
        audit,
        requireM1ProofAudit(reopened.application, created.output.goalId),
      );
    } finally {
      reopened.close();
    }

    const authority = Object.freeze({
      goalId: created.output.goalId,
      finalStatus,
      reopenedStatus,
      audit,
      finalDrive: started.drive,
    });
    return Object.freeze({
      schemaVersion: 1,
      scenario,
      passed: true,
      proofCode: assertScenario(scenario, authority, duplicateObservation),
      ...authority,
    });
  } finally {
    composition?.close();
    rmSync(runRoot, { force: true, recursive: true });
  }
}
