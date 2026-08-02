import {
  RuntimeErrorCode,
  WorkflowDriveStopReason,
  type RuntimeCommandResult,
} from '@codeclosure/runtime';

import {
  CliErrorCode,
  CliExitCode,
  type CliEnvelope,
  type CliExitCode as CliExitCodeType,
  type CliM2DemoDetail,
  type CliExternalDiagnostic,
} from './contracts.js';

function renderExternalDiagnostic(diagnostic: CliExternalDiagnostic): string {
  switch (diagnostic.kind) {
    case 'NOTIFICATION_LIMIT':
      return diagnostic.kind;
    case 'UNSUPPORTED_NOTIFICATION':
      return `${diagnostic.kind}:${diagnostic.method}`;
    case 'MALFORMED_ITEM':
    case 'ITEM_POLICY_UNAVAILABLE':
      return `${diagnostic.kind}:${diagnostic.location}`;
    case 'UNSUPPORTED_ITEM':
      return `${diagnostic.kind}:${diagnostic.itemType}:${diagnostic.location}:${diagnostic.reasonCode}`;
  }
}

function commandFailureExit(code: string): CliExitCodeType {
  switch (code) {
    case RuntimeErrorCode.NOT_FOUND:
    case RuntimeErrorCode.DOMAIN_REJECTED:
    case RuntimeErrorCode.STALE_GOAL_REVISION:
    case RuntimeErrorCode.STALE_WORKFLOW_VERSION:
    case RuntimeErrorCode.COMMAND_ID_CONFLICT:
      return CliExitCode.REJECTED;
    case RuntimeErrorCode.INVALID_STORED_OUTCOME:
    case RuntimeErrorCode.EVALUATION_FAILURE:
    case RuntimeErrorCode.PERSISTENCE_FAILURE:
    case RuntimeErrorCode.INTERNAL_FAILURE:
      return CliExitCode.INTERNAL;
    default:
      return CliExitCode.INTERNAL;
  }
}

function drivenCommandExit(
  envelope: Extract<CliEnvelope, { readonly kind: 'DRIVEN_COMMAND_RESULT' }>,
): CliExitCodeType {
  if (!envelope.result.command.output.ok) {
    return commandFailureExit(envelope.result.command.output.error.code);
  }
  switch (envelope.result.drive?.stopReason) {
    case WorkflowDriveStopReason.CLOSED:
      return CliExitCode.SUCCESS;
    case WorkflowDriveStopReason.CANCELLED:
    case WorkflowDriveStopReason.WAITING_FOR_INPUT:
    case WorkflowDriveStopReason.BLOCKED:
    case WorkflowDriveStopReason.FAILED:
    case WorkflowDriveStopReason.ACTIVE_ATTEMPT:
    case WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED:
    case WorkflowDriveStopReason.ACCEPTANCE_BLOCKED:
    case WorkflowDriveStopReason.USER_DECISION_REQUIRED:
    case WorkflowDriveStopReason.ACCEPTANCE_ENGINE_ERROR:
      return CliExitCode.GOVERNED_STOP;
    case WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED:
    case WorkflowDriveStopReason.POLICY_UNAVAILABLE:
    case WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE:
    case WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE:
    case WorkflowDriveStopReason.OPERATION_LIMIT:
    case undefined:
      return CliExitCode.INTERNAL;
  }
}

export function exitCodeForCliEnvelope(envelope: CliEnvelope): CliExitCodeType {
  switch (envelope.kind) {
    case 'COMMAND_RESULT':
      return envelope.result.output.ok
        ? CliExitCode.SUCCESS
        : commandFailureExit(envelope.result.output.error.code);
    case 'DRIVEN_COMMAND_RESULT':
      return drivenCommandExit(envelope);
    case 'GOAL_STATUS':
      return envelope.result.status === 'FOUND' ? CliExitCode.SUCCESS : CliExitCode.REJECTED;
    case 'GOAL_AUDIT':
      return envelope.result.status === 'FOUND' ? CliExitCode.SUCCESS : CliExitCode.REJECTED;
    case 'DEMO_RESULT':
      return envelope.result.passed ? CliExitCode.SUCCESS : CliExitCode.GOVERNED_STOP;
    case 'CLI_ERROR':
      switch (envelope.error.code) {
        case CliErrorCode.USAGE:
          return CliExitCode.USAGE;
        case CliErrorCode.GOAL_NOT_FOUND:
          return CliExitCode.REJECTED;
        case CliErrorCode.INTERNAL:
          return CliExitCode.INTERNAL;
      }
  }
}

function renderRuntimeCommand(operation: string, result: RuntimeCommandResult): string[] {
  const output = result.output;
  if (!output.ok) {
    return [
      `Operation: ${operation}`,
      `Result: rejected`,
      `Error: ${output.error.code}`,
      `Detail: ${output.error.detailCode}`,
      `Message: ${output.error.message}`,
    ];
  }
  return [
    `Operation: ${operation}`,
    `Result: ${result.status.toLowerCase()}`,
    `Goal: ${output.goalId}`,
    `Phase: ${output.phase}`,
    `Run status: ${output.runStatus}`,
    `Workflow version: ${String(output.workflowVersion)}`,
  ];
}

function renderCommand(
  envelope: Extract<CliEnvelope, { readonly kind: 'COMMAND_RESULT' }>,
): string {
  return renderRuntimeCommand(envelope.operation, envelope.result).join('\n');
}

function renderDrivenCommand(
  envelope: Extract<CliEnvelope, { readonly kind: 'DRIVEN_COMMAND_RESULT' }>,
): string {
  const lines = renderRuntimeCommand(envelope.operation, envelope.result.command);
  const drive = envelope.result.drive;
  if (drive === undefined) {
    lines.push('Drive: not entered');
    return lines.join('\n');
  }
  lines.push(
    `Drive stop: ${drive.stopReason}`,
    `Drive detail: ${drive.detailCode}`,
    `Drive operations: ${String(drive.operationCount)}`,
  );
  if (drive.initialWorkflowVersion !== undefined) {
    lines.push(`Drive initial workflow version: ${String(drive.initialWorkflowVersion)}`);
  }
  if (drive.finalState !== undefined) {
    lines.push(
      `Final phase: ${drive.finalState.phase}`,
      `Final run status: ${drive.finalState.runStatus}`,
      `Final workflow version: ${String(drive.finalState.workflowVersion)}`,
    );
  }
  return lines.join('\n');
}

function renderGoalStatus(
  envelope: Extract<CliEnvelope, { readonly kind: 'GOAL_STATUS' }>,
): string {
  if (envelope.result.status === 'NOT_FOUND') {
    return `Goal not found: ${envelope.result.goalId}`;
  }
  const view = envelope.result.view;
  const lines = [
    `Goal: ${view.goalId}`,
    `Goal revision: ${String(view.goalRevision)}`,
    `Workflow: ${view.workflowId}`,
    `Phase: ${view.phase}`,
    `Run status: ${view.runStatus}`,
    `Workflow version: ${String(view.workflowVersion)}`,
    `Next safe action: ${view.nextSafeAction}`,
    `Technical closeout: ${view.technicalCloseout ? 'yes' : 'no'}`,
  ];
  if (view.policyRef !== undefined) {
    lines.push(
      `Policy: ${view.policyRef.id}@${view.policyRef.version}`,
      `Policy digest: ${view.policyRef.digest}`,
    );
  }
  if (view.executionProfileRef !== undefined) {
    lines.push(
      `Execution profile: ${view.executionProfileRef.id}@${view.executionProfileRef.version}`,
      `Execution profile digest: ${view.executionProfileRef.digest}`,
    );
  }
  if (view.activeAttemptRef !== undefined) {
    lines.push(
      `Active attempt: ${view.activeAttemptRef.id}`,
      `Attempt boundary: ${view.activeAttemptRef.phase} #${String(view.activeAttemptRef.sequence)} (${view.activeAttemptRef.status})`,
    );
  }
  if (view.activeCandidateRef !== undefined) {
    lines.push(
      `Active candidate: ${view.activeCandidateRef.generationId}`,
      `Candidate boundary: #${String(view.activeCandidateRef.sequence)} (${view.activeCandidateRef.state})`,
    );
    if (view.activeCandidateRef.digest !== undefined) {
      lines.push(`Candidate digest: ${view.activeCandidateRef.digest}`);
    }
  }
  if (view.acceptanceSummary !== undefined) {
    lines.push(
      `Acceptance: ${view.acceptanceSummary.outcome} (${view.acceptanceSummary.dominantReasonCode})`,
      `Acceptance decision: ${view.acceptanceSummary.decisionId}`,
      `Acceptance digest: ${view.acceptanceSummary.decisionDigest}`,
      `Acceptance issued at: ${view.acceptanceSummary.issuedAt}`,
    );
  }
  if (view.dominantBlocker !== undefined) {
    lines.push(
      `Dominant blocker: ${view.dominantBlocker.code} (${view.dominantBlocker.detailCode})`,
    );
    if (view.dominantBlocker.sourceRefs.length > 0) {
      lines.push(`Blocker sources: ${view.dominantBlocker.sourceRefs.join(', ')}`);
    }
  }
  if (view.closeoutRef !== undefined) {
    lines.push(
      `Closeout decision: ${view.closeoutRef.acceptanceDecisionId}`,
      `Closeout candidate: ${view.closeoutRef.candidateGenerationId}`,
      `Closed at: ${view.closeoutRef.closedAt}`,
    );
  }
  return lines.join('\n');
}

function renderGoalAudit(envelope: Extract<CliEnvelope, { readonly kind: 'GOAL_AUDIT' }>): string {
  if (envelope.result.status === 'NOT_FOUND') {
    return `Goal not found: ${envelope.result.goalId}`;
  }
  const view = envelope.result.view;
  const lines = [
    `Goal audit: ${view.goalId}`,
    `Through sequence: ${String(view.throughSequence)}`,
    `Event count: ${String(view.events.length)}`,
  ];
  for (const event of view.events) {
    lines.push(
      `[${String(event.sequence)}] ${event.occurredAt} ${event.eventType}`,
      `  Aggregate: ${event.aggregateType}:${event.aggregateId}`,
      `  Actor: ${event.actorType}`,
      `  Payload digest: ${event.payloadDigest}`,
    );
    if (event.commandId !== undefined) {
      lines.push(`  Command: ${event.commandId}`);
    }
    if (event.beforeVersion !== undefined || event.afterVersion !== undefined) {
      lines.push(
        `  Version: ${event.beforeVersion === undefined ? '-' : String(event.beforeVersion)} -> ${event.afterVersion === undefined ? '-' : String(event.afterVersion)}`,
      );
    }
    if (event.correlationId !== undefined) {
      lines.push(`  Correlation: ${event.correlationId}`);
    }
    if (event.causationId !== undefined) {
      lines.push(`  Causation: ${event.causationId}`);
    }
  }
  return lines.join('\n');
}

function renderM2DemoDetail(m2: CliM2DemoDetail): string[] {
  const lines = [
    `M2 branch: ${m2.branch}`,
    `Protected plan: ${m2.planId}`,
    `Protected plan digest: ${m2.planDigest}`,
    `Candidate generations: ${String(m2.generationCount)}`,
    `Source tree digest: ${m2.sourceIdentity.sourceTreeDigest}`,
    `Source Git metadata digest: ${m2.sourceIdentity.sourceGitMetadataDigest}`,
    'Source unchanged: yes',
  ];
  if (m2.externalFailureCode !== undefined) {
    lines.push(`External failure: ${m2.externalFailureCode}`);
  }
  for (const evidence of m2.evidence) {
    lines.push(
      `M2 evidence: ${evidence.result} ${evidence.evidenceDigest}`,
      `  Candidate: ${evidence.candidateGenerationId} ${evidence.candidateDigest}`,
      `  Check: ${evidence.checkId}`,
    );
  }
  return lines;
}

function renderDemoResult(
  envelope: Extract<CliEnvelope, { readonly kind: 'DEMO_RESULT' }>,
): string {
  const proof = envelope.result;
  if (!proof.passed) {
    if (proof.outcome === 'FAILED') {
      const lines = [
        `Demo: ${proof.scenario}`,
        'Expected proof: failed',
        `Failure: ${proof.failureCode}`,
        `Message: ${proof.message}`,
        `Goal: ${proof.goalId}`,
        `Drive stop: ${proof.finalDrive.stopReason}`,
        `Final phase: ${proof.finalStatus.phase}`,
        `Final run status: ${proof.finalStatus.runStatus}`,
        `Technical closeout: ${proof.finalStatus.technicalCloseout ? 'yes' : 'no'}`,
        `Audit through sequence: ${String(proof.audit.throughSequence)}`,
        'Strict reopen: matched',
      ];
      if (proof.finalStatus.acceptanceSummary !== undefined) {
        lines.push(
          `Acceptance: ${proof.finalStatus.acceptanceSummary.outcome} (${proof.finalStatus.acceptanceSummary.dominantReasonCode})`,
        );
      }
      lines.push(...renderM2DemoDetail(proof.m2));
      return lines.join('\n');
    }
    const lines = [
      `Demo: ${proof.scenario}`,
      'Expected proof: blocked',
      `Blocker: ${proof.blockerCode}`,
      `Message: ${proof.message}`,
    ];
    if (proof.externalFailureCode !== undefined) {
      lines.push(`External failure: ${proof.externalFailureCode}`);
    }
    if ('externalDiagnostic' in proof) {
      lines.push(`External diagnostic: ${renderExternalDiagnostic(proof.externalDiagnostic)}`);
    }
    if ('runtimeStop' in proof) {
      lines.push(
        `Runtime stage: ${proof.runtimeStop.stage}`,
        `Command status: ${proof.runtimeStop.commandStatus}`,
      );
      if (proof.runtimeStop.drive === null) {
        lines.push('Drive stop: unavailable');
      } else {
        lines.push(
          `Drive stop: ${proof.runtimeStop.drive.stopReason}`,
          `Drive detail: ${proof.runtimeStop.drive.detailCode}`,
          `Drive operations: ${String(proof.runtimeStop.drive.operationCount)}`,
        );
      }
      if (proof.runtimeStop.externalExecution === null) {
        lines.push('External execution: not authorized');
      } else {
        lines.push(
          `External execution: ${proof.runtimeStop.externalExecution.id}`,
          `External attempt: ${proof.runtimeStop.externalExecution.attemptId}`,
          `External state: ${proof.runtimeStop.externalExecution.state}`,
        );
        if (proof.runtimeStop.externalExecution.failureCode !== null) {
          lines.push(
            `External execution failure: ${proof.runtimeStop.externalExecution.failureCode}`,
          );
        }
      }
    }
    return lines.join('\n');
  }
  const lines = [
    `Demo: ${proof.scenario}`,
    `Expected proof: passed`,
    `Proof code: ${proof.proofCode}`,
    `Goal: ${proof.goalId}`,
    `Drive stop: ${proof.finalDrive.stopReason}`,
    `Final phase: ${proof.finalStatus.phase}`,
    `Final run status: ${proof.finalStatus.runStatus}`,
    `Technical closeout: ${proof.finalStatus.technicalCloseout ? 'yes' : 'no'}`,
    `Audit through sequence: ${String(proof.audit.throughSequence)}`,
    `Strict reopen: matched`,
  ];
  if (proof.finalStatus.acceptanceSummary !== undefined) {
    lines.push(
      `Acceptance: ${proof.finalStatus.acceptanceSummary.outcome} (${proof.finalStatus.acceptanceSummary.dominantReasonCode})`,
    );
  }
  if (proof.finalStatus.dominantBlocker !== undefined) {
    lines.push(
      `Dominant blocker: ${proof.finalStatus.dominantBlocker.code} (${proof.finalStatus.dominantBlocker.detailCode})`,
    );
  }
  if (proof.intermediateStatus !== undefined) {
    lines.push(
      `Intermediate phase: ${proof.intermediateStatus.phase}`,
      `Intermediate run status: ${proof.intermediateStatus.runStatus}`,
    );
  }
  if (proof.startupRecovery !== undefined) {
    lines.push(`Startup reconciled: ${String(proof.startupRecovery.reconciledCount)}`);
  }
  if (proof.m2 !== undefined) {
    lines.push(...renderM2DemoDetail(proof.m2));
  }
  return lines.join('\n');
}

export function renderCliEnvelopeHuman(envelope: CliEnvelope): string {
  switch (envelope.kind) {
    case 'COMMAND_RESULT':
      return `${renderCommand(envelope)}\n`;
    case 'DRIVEN_COMMAND_RESULT':
      return `${renderDrivenCommand(envelope)}\n`;
    case 'GOAL_STATUS':
      return `${renderGoalStatus(envelope)}\n`;
    case 'GOAL_AUDIT':
      return `${renderGoalAudit(envelope)}\n`;
    case 'DEMO_RESULT':
      return `${renderDemoResult(envelope)}\n`;
    case 'CLI_ERROR':
      return `CodeClosure CLI error [${envelope.error.code}]: ${envelope.error.message}\n`;
  }
}

export function renderCliEnvelopeJson(envelope: CliEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}
