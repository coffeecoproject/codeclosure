import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WorkflowDriveStopReason,
  type CodeClosureApplication,
  type GoalStatusView,
  type WorkflowDriveSummary,
} from '@codeclosure/runtime';
import { CryptographicIdentityGenerator } from '@codeclosure/runtime/composition';
import { M1FakeExecutionProfileName } from '@codeclosure/testing';

import { ProtectedPathKind } from './data-home.js';
import {
  createCliComposition,
  createTrustedCliComposition,
  type CreateCliCompositionOptions,
  type TrustedCliComposition,
} from './trusted-composition.js';

export interface RunM1StaleCloseoutProofOptions {
  readonly projectPath: string;
}

export interface M1StaleCloseoutProofResult {
  readonly schemaVersion: 1;
  readonly scenario: 'stale-closeout';
  readonly goalId: GoalStatusView['goalId'];
  readonly beforeDrift: GoalStatusView;
  readonly finalStatus: GoalStatusView;
  readonly reopenedStatus: GoalStatusView;
  readonly finalDrive: WorkflowDriveSummary;
}

/** Bound to m1-deterministic-driver-v1: operation 15 persists ACCEPT, 16 closes. */
const M1_STALE_CLOSEOUT_ACCEPT_OPERATION_LIMIT = 15;

function requireGoalStatus(
  application: CodeClosureApplication,
  goalIdentifier: GoalStatusView['goalId'],
): GoalStatusView {
  const status = application.getGoalStatus(goalIdentifier);
  if (status.status !== 'FOUND') {
    throw new TypeError('M1 proof Goal status is unavailable');
  }
  return status.view;
}

/**
 * Runs the temporal stale-closeout proof through public StartGoal replay. The
 * Runtime driver still owns every internal phase operation.
 */
export async function runM1StaleCloseoutProof(
  options: RunM1StaleCloseoutProofOptions,
): Promise<M1StaleCloseoutProofResult> {
  const runRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m1-stale-closeout-'));
  const compositionOptions: CreateCliCompositionOptions = Object.freeze({
    dataHomePath: join(runRoot, 'authority'),
    protectedPaths: Object.freeze([
      Object.freeze({ kind: ProtectedPathKind.PROJECT, path: options.projectPath }),
    ]),
    allowedProjectPaths: Object.freeze([options.projectPath]),
    startProfileName: M1FakeExecutionProfileName.STALE_CLOSEOUT,
  });
  let trusted: TrustedCliComposition | undefined;
  try {
    trusted = createTrustedCliComposition(
      compositionOptions,
      M1_STALE_CLOSEOUT_ACCEPT_OPERATION_LIMIT,
    );
    const commandIds = new CryptographicIdentityGenerator();
    const created = trusted.application.createGoal({
      commandId: commandIds.nextCommandId(),
      objective: 'Prove stale source authority cannot be consumed by Closeout',
      projectPath: options.projectPath,
      criteria: ['Closeout rejects source drift after an ACCEPT decision'],
    });
    if (created.status !== 'APPLIED') {
      throw new TypeError('M1 stale-closeout proof could not create its isolated Goal');
    }
    const createdStatus = requireGoalStatus(trusted.application, created.output.goalId);
    const startRequest = Object.freeze({
      commandId: commandIds.nextCommandId(),
      goalId: created.output.goalId,
      expectedGoalRevision: createdStatus.goalRevision,
      expectedWorkflowVersion: created.output.workflowVersion,
    });
    const accepted = await trusted.application.startGoal(startRequest);
    const beforeDrift = requireGoalStatus(trusted.application, created.output.goalId);
    if (
      !accepted.command.output.ok ||
      accepted.drive?.stopReason !== WorkflowDriveStopReason.OPERATION_LIMIT ||
      accepted.drive.operationCount !== M1_STALE_CLOSEOUT_ACCEPT_OPERATION_LIMIT ||
      beforeDrift.phase !== 'FINAL_VERIFY' ||
      beforeDrift.runStatus !== 'READY' ||
      beforeDrift.acceptanceSummary?.outcome !== 'ACCEPT' ||
      beforeDrift.executionProfileRef?.id !== 'profile_m1-stale-closeout-v2' ||
      beforeDrift.activeCandidateRef?.state !== 'FROZEN' ||
      beforeDrift.technicalCloseout ||
      beforeDrift.closeoutRef !== undefined
    ) {
      throw new TypeError('M1 stale-closeout proof did not reach exact pre-drift authority');
    }

    trusted.scenarioControl.armStaleCloseoutDrift(beforeDrift.activeCandidateRef.generationId);
    const closedAttempt = await trusted.application.startGoal(startRequest);
    if (!closedAttempt.command.output.ok || closedAttempt.drive === undefined) {
      throw new TypeError('M1 stale-closeout proof could not re-enter the Runtime driver');
    }
    const finalStatus = requireGoalStatus(trusted.application, created.output.goalId);
    if (
      closedAttempt.drive.stopReason !== WorkflowDriveStopReason.FAILED ||
      finalStatus.phase !== 'FINAL_VERIFY' ||
      finalStatus.runStatus !== 'FAILED' ||
      finalStatus.activeCandidateRef?.state !== 'INVALIDATED' ||
      finalStatus.technicalCloseout ||
      finalStatus.closeoutRef !== undefined
    ) {
      throw new TypeError('M1 stale-closeout proof did not finish with fail-closed authority');
    }

    trusted.close();
    const reopened = createCliComposition({
      ...compositionOptions,
      startProfileName: M1FakeExecutionProfileName.HAPPY_PATH,
    });
    let reopenedStatus: GoalStatusView;
    try {
      reopenedStatus = requireGoalStatus(reopened.application, created.output.goalId);
    } finally {
      reopened.close();
    }
    if (
      reopenedStatus.phase !== finalStatus.phase ||
      reopenedStatus.runStatus !== finalStatus.runStatus ||
      reopenedStatus.activeCandidateRef?.state !== finalStatus.activeCandidateRef.state ||
      reopenedStatus.technicalCloseout ||
      reopenedStatus.closeoutRef !== undefined
    ) {
      throw new TypeError('M1 stale-closeout proof did not survive strict reopen');
    }

    return Object.freeze({
      schemaVersion: 1,
      scenario: M1FakeExecutionProfileName.STALE_CLOSEOUT,
      goalId: created.output.goalId,
      beforeDrift,
      finalStatus,
      reopenedStatus,
      finalDrive: closedAttempt.drive,
    });
  } finally {
    trusted?.close();
    rmSync(runRoot, { force: true, recursive: true });
  }
}
