import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  CliDemoProofCode,
  type CliDemoProofResult,
  type CliDemoBlockedResult,
  type CliExternalDiagnostic,
  type CliExternalFailureCode,
  type CliM2DemoDetail,
  type CliDemoResult,
  type CliDemoScenario,
  type CliRuntimeStopDiagnostic,
} from '../cli/contracts.js';
import { runM1DemoProof } from './m1-demo-proof.js';
import {
  M2ExternalDemoBlockedError,
  runM2ProtectedDemoProof,
  type M2LiveDemoProof,
} from './m2-protected-demo-proof.js';

async function runProtected(
  scenario: 'm2-protected-repair' | 'm2-protected-failed-repair',
): Promise<CliDemoProofResult> {
  const accepted = scenario === 'm2-protected-repair';
  const proof = await runM2ProtectedDemoProof(accepted ? 'REPAIR_ACCEPTED' : 'REPAIR_FAILED_STOP');
  return Object.freeze({
    schemaVersion: 1,
    scenario,
    passed: true,
    proofCode: accepted
      ? CliDemoProofCode.M2_PROTECTED_REPAIR_ACCEPTED
      : CliDemoProofCode.M2_PROTECTED_FAILED_REPAIR_STOPPED,
    goalId: proof.goalId,
    intermediateStatus: proof.intermediateStatus,
    finalStatus: proof.finalStatus,
    reopenedStatus: proof.reopenedStatus,
    audit: proof.audit,
    finalDrive: proof.finalDrive,
    m2: Object.freeze({
      branch: proof.mode,
      evidence: proof.evidence,
      generationCount: proof.generationCount,
      initialDriveStop: proof.initialDrive.stopReason,
      planId: proof.planRef.id,
      planDigest: proof.planRef.digest,
      sourceIdentity: proof.sourceIdentity,
      sourceUnchanged: proof.sourceUnchanged,
      workerWritableTestPassed: proof.workerWritableTestPassed,
    }),
  });
}

function localAuthSource(): string | undefined {
  const configured = process.env['CODECLOSURE_M2_AUTH_SOURCE'];
  if (configured !== undefined) {
    return existsSync(configured) ? configured : undefined;
  }
  const conventional = join(homedir(), '.codex', 'auth.json');
  return existsSync(conventional) ? conventional : undefined;
}

async function runAdapterFailure(): Promise<CliDemoResult> {
  const authSource = localAuthSource();
  if (authSource === undefined) {
    return Object.freeze({
      schemaVersion: 2,
      scenario: 'm2-adapter-failure',
      passed: false,
      outcome: 'BLOCKED',
      blockerCode: 'AUTH_UNAVAILABLE',
      message: 'A local Codex authentication source is unavailable.',
    });
  }
  const proof = await runM2ProtectedDemoProof('ADAPTER_FAILURE', { authSource });
  const externalExecutionCount = proof.audit.events.filter(
    ({ eventType }) => eventType === 'EXTERNAL_EXECUTION_AUTHORIZED',
  ).length;
  if (externalExecutionCount !== 1) {
    throw new TypeError('M2 adapter failure proof has an unexpected external execution count');
  }
  return Object.freeze({
    schemaVersion: 1,
    scenario: 'm2-adapter-failure',
    passed: true,
    proofCode: CliDemoProofCode.M2_ADAPTER_FAILURE_GOVERNED,
    goalId: proof.goalId,
    finalStatus: proof.finalStatus,
    reopenedStatus: proof.reopenedStatus,
    audit: proof.audit,
    finalDrive: proof.finalDrive,
    m2: Object.freeze({
      branch: 'ADAPTER_FAILURE',
      evidence: Object.freeze([]),
      generationCount: 1,
      initialDriveStop: proof.finalDrive.stopReason,
      planId: proof.planRef.id,
      planDigest: proof.planRef.digest,
      sourceIdentity: proof.sourceIdentity,
      sourceUnchanged: proof.sourceUnchanged,
      externalExecutionCount,
      externalFailureCode: proof.externalFailureCode,
    }),
  });
}

export function createM2LiveBlockedCliResult(
  scenario: 'm2-live' | 'm2-live-repair-handoff',
  blockerCode:
    'AUTH_UNAVAILABLE' | 'BACKEND_UNAVAILABLE' | 'BINARY_UNAVAILABLE' | 'PROTOCOL_INCOMPATIBLE',
  message: string,
  details: Readonly<{
    externalFailureCode?: CliExternalFailureCode;
    externalDiagnostic?: CliExternalDiagnostic;
    runtimeStop?: CliRuntimeStopDiagnostic;
  }> = {},
): CliDemoBlockedResult {
  const { externalDiagnostic, externalFailureCode, runtimeStop } = details;
  if (externalDiagnostic !== undefined && externalFailureCode === undefined) {
    throw new TypeError('An external diagnostic requires an external failure code');
  }
  const base = {
    scenario,
    passed: false as const,
    outcome: 'BLOCKED' as const,
    blockerCode,
    message,
  };
  if (runtimeStop !== undefined) {
    if (externalFailureCode === undefined) {
      return Object.freeze({ schemaVersion: 5, ...base, runtimeStop });
    }
    return externalDiagnostic === undefined
      ? Object.freeze({ schemaVersion: 5, ...base, runtimeStop, externalFailureCode })
      : Object.freeze({
          schemaVersion: 5,
          ...base,
          runtimeStop,
          externalFailureCode,
          externalDiagnostic,
        });
  }
  if (externalFailureCode === undefined) {
    return Object.freeze({ schemaVersion: 2, ...base });
  }
  return externalDiagnostic === undefined
    ? Object.freeze({ schemaVersion: 3, ...base, externalFailureCode })
    : Object.freeze({ schemaVersion: 4, ...base, externalFailureCode, externalDiagnostic });
}

function cliRuntimeStopDiagnostic(
  input: NonNullable<M2ExternalDemoBlockedError['runtimeStop']>,
): CliRuntimeStopDiagnostic {
  return Object.freeze({
    schemaVersion: 1,
    stage: input.stage,
    commandStatus: input.commandStatus,
    externalExecution:
      input.externalExecution === undefined
        ? null
        : Object.freeze({
            schemaVersion: 1,
            id: input.externalExecution.id,
            attemptId: input.externalExecution.attemptId,
            state: input.externalExecution.state,
            failureCode: input.externalExecution.failureCode ?? null,
          }),
    drive:
      input.drive === undefined
        ? null
        : Object.freeze({
            schemaVersion: 1,
            stopReason: input.drive.stopReason,
            detailCode: input.drive.detailCode,
            operationCount: input.drive.operationCount,
          }),
  });
}

function liveM2Detail(proof: M2LiveDemoProof): CliM2DemoDetail {
  return Object.freeze({
    branch: proof.branch,
    evidence: proof.evidence,
    generationCount: proof.generationCount,
    initialDriveStop: proof.initialDrive.stopReason,
    planId: proof.planRef.id,
    planDigest: proof.planRef.digest,
    sourceIdentity: proof.sourceIdentity,
    sourceUnchanged: proof.sourceUnchanged,
    externalExecutionCount: proof.externalExecutionCount,
  });
}

export function createM2LiveCliResult(
  scenario: 'm2-live' | 'm2-live-repair-handoff',
  proof: M2LiveDemoProof,
): CliDemoResult {
  const m2 = liveM2Detail(proof);
  if (
    proof.branch === 'LIVE_REPAIR_FAILED_STOP' ||
    proof.branch === 'LIVE_REPAIR_HANDOFF_FAILED_STOP'
  ) {
    return Object.freeze({
      schemaVersion: 3,
      scenario,
      passed: false,
      outcome: 'FAILED',
      failureCode: 'LIVE_VERIFICATION_FAILED',
      message: 'The bounded live Codex repair did not satisfy protected verification.',
      goalId: proof.goalId,
      finalStatus: proof.finalStatus,
      reopenedStatus: proof.reopenedStatus,
      audit: proof.audit,
      finalDrive: proof.finalDrive,
      m2,
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    scenario,
    passed: true,
    proofCode:
      scenario === 'm2-live'
        ? CliDemoProofCode.M2_LIVE_NATURAL_BRANCH_CLOSED
        : CliDemoProofCode.M2_LIVE_REPAIR_HANDOFF_CLOSED,
    goalId: proof.goalId,
    finalStatus: proof.finalStatus,
    reopenedStatus: proof.reopenedStatus,
    audit: proof.audit,
    finalDrive: proof.finalDrive,
    m2,
  });
}

async function runLive(scenario: 'm2-live' | 'm2-live-repair-handoff'): Promise<CliDemoResult> {
  const authSource = localAuthSource();
  if (authSource === undefined) {
    return createM2LiveBlockedCliResult(
      scenario,
      'AUTH_UNAVAILABLE',
      'A local Codex authentication source is unavailable.',
    );
  }
  try {
    const liveOptions = Object.freeze({
      authSource,
      model: process.env['CODECLOSURE_M2_MODEL'] ?? 'gpt-5.6-sol',
    });
    const proof =
      scenario === 'm2-live'
        ? await runM2ProtectedDemoProof('LIVE', liveOptions)
        : await runM2ProtectedDemoProof('LIVE_REPAIR_HANDOFF', liveOptions);
    return createM2LiveCliResult(scenario, proof);
  } catch (error) {
    if (error instanceof M2ExternalDemoBlockedError) {
      return createM2LiveBlockedCliResult(
        scenario,
        error.blockerCode,
        'The bounded live Codex backend is unavailable.',
        {
          ...(error.externalFailureCode === undefined
            ? {}
            : { externalFailureCode: error.externalFailureCode }),
          ...(error.externalDiagnostic === undefined
            ? {}
            : { externalDiagnostic: error.externalDiagnostic }),
          ...(error.runtimeStop === undefined
            ? {}
            : { runtimeStop: cliRuntimeStopDiagnostic(error.runtimeStop) }),
        },
      );
    }
    throw error;
  }
}

export async function runDemoProof(scenario: CliDemoScenario): Promise<CliDemoResult> {
  switch (scenario) {
    case 'm2-protected-repair':
    case 'm2-protected-failed-repair':
      return runProtected(scenario);
    case 'm2-adapter-failure':
      return runAdapterFailure();
    case 'm2-live':
      return runLive(scenario);
    case 'm2-live-repair-handoff':
      return runLive(scenario);
    case 'happy-path':
    case 'lying-worker':
    case 'missing-evidence':
    case 'failing-evidence':
    case 'stale-closeout':
    case 'restart-resume':
    case 'duplicate-result':
    case 'candidate-drift':
      return runM1DemoProof(scenario);
  }
}
