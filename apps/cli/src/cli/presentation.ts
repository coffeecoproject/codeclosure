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

function intakeCommandExit(
  envelope: Extract<CliEnvelope, { readonly kind: 'INTAKE_COMMAND_RESULT' }>,
): CliExitCodeType {
  const result = envelope.result;
  switch (result.kind) {
    case 'CONTENT_REJECTED':
    case 'NOT_FOUND':
    case 'COMMAND_CONFLICT':
    case 'VERSION_CONFLICT':
      return CliExitCode.REJECTED;
    case 'IN_PROGRESS':
      return CliExitCode.GOVERNED_STOP;
    case 'OUTCOME': {
      if (result.outcome.result.kind === 'REJECTED') {
        return CliExitCode.REJECTED;
      }
      if (result.outcome.result.kind === 'FAILED') {
        return CliExitCode.GOVERNED_STOP;
      }
      switch (result.startDisposition) {
        case 'START_COMMAND_REJECTED':
          return CliExitCode.REJECTED;
        case 'READY_PENDING_START':
          return CliExitCode.GOVERNED_STOP;
        case 'START_INFRASTRUCTURE_FAILURE':
          return CliExitCode.INTERNAL;
        case 'NOT_AUTHORIZED':
        case 'START_COMMAND_APPLIED':
          return CliExitCode.SUCCESS;
      }
    }
  }
}

export function exitCodeForCliEnvelope(envelope: CliEnvelope): CliExitCodeType {
  switch (envelope.kind) {
    case 'INTAKE_COMMAND_RESULT':
      return intakeCommandExit(envelope);
    case 'INTAKE_STATUS':
    case 'INTAKE_AUDIT':
      return envelope.result.status === 'FOUND' ? CliExitCode.SUCCESS : CliExitCode.REJECTED;
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

function renderIntakeCommand(
  envelope: Extract<CliEnvelope, { readonly kind: 'INTAKE_COMMAND_RESULT' }>,
): string {
  const result = envelope.result;
  const lines = [`Operation: ${envelope.operation}`];
  switch (result.kind) {
    case 'CONTENT_REJECTED':
      lines.push(
        'Result: content rejected',
        `Reason: ${result.reasonCode}`,
        `Observed bytes: ${String(result.observedByteCount)}`,
        `Rejection digest: ${result.rejectionDigest}`,
      );
      break;
    case 'NOT_FOUND':
      lines.push('Result: not found', `Intake run: ${result.intakeRunId}`);
      break;
    case 'COMMAND_CONFLICT':
    case 'VERSION_CONFLICT':
      lines.push(
        `Result: ${result.kind.toLowerCase().replace('_', ' ')}`,
        `Message: ${result.message}`,
      );
      break;
    case 'IN_PROGRESS':
      lines.push(
        'Result: in progress',
        `Intake run: ${result.intakeRunId}`,
        `Intake version: ${String(result.intakeRunVersion)}`,
        `Operation kind: ${result.operationKind}`,
      );
      break;
    case 'OUTCOME': {
      const stored = result.outcome.result;
      lines.push(
        `Result: ${stored.kind.toLowerCase().replaceAll('_', ' ')}`,
        `Command disposition: ${result.outcome.disposition}`,
        `Intake run: ${result.outcome.intakeRunId}`,
        `Intake version: ${String(result.outcome.observedIntakeRunVersion)}`,
        `Replay: ${result.replayed ? 'yes' : 'no'}`,
        `Start disposition: ${result.startDisposition}`,
      );
      if ('answerDisposition' in stored) {
        lines.push(`Answer disposition: ${stored.answerDisposition}`);
      }
      if ('materializationDisposition' in stored) {
        lines.push(`Materialization disposition: ${stored.materializationDisposition}`);
      }
      if (result.answerOnlyContent !== undefined) {
        lines.push(`Answer: ${result.answerOnlyContent}`);
      }
      break;
    }
  }
  return lines.join('\n');
}

function renderIntakeStatus(
  envelope: Extract<CliEnvelope, { readonly kind: 'INTAKE_STATUS' }>,
): string {
  if (envelope.result.status === 'NOT_FOUND') {
    return `Intake run not found: ${envelope.result.intakeRunId}`;
  }
  const view = envelope.result.view;
  const lines = [
    `Intake run: ${view.intakeRunId}`,
    `Intake version: ${String(view.intakeRunVersion)}`,
    `Status: ${view.status}`,
  ];
  if (view.status === 'NEEDS_CLARIFICATION') {
    lines.push(
      `Question: ${view.activeQuestion.id}`,
      `Question spec digest: ${view.activeQuestion.questionSpecDigest}`,
      `Question digest: ${view.activeQuestion.questionDigest}`,
      `Issuing decision: ${view.activeQuestion.issuingDecisionId}`,
      `Issuing decision digest: ${view.activeQuestion.issuingDecisionDigest}`,
      `Prompt: ${view.activeQuestion.prompt}`,
      `Affected fields: ${view.activeQuestion.affectedFields.join(', ')}`,
      `Answer schema: ${view.activeQuestion.answerSchema.kind}`,
    );
  } else if (view.status === 'NO_EXECUTION') {
    lines.push(`Reason: ${view.reasonCode}`);
    if (view.answerOnlyResponse !== undefined) {
      lines.push(
        `Answer response: ${view.answerOnlyResponse.id}`,
        `Answer response digest: ${view.answerOnlyResponse.digest}`,
        `Answer response kind: ${view.answerOnlyResponse.kind}`,
      );
    }
  } else if (view.status === 'MATERIALIZED') {
    lines.push(
      `Goal: ${view.materializedGoalRef.goalId}`,
      `Goal revision: ${String(view.materializedGoalRef.goalRevision)}`,
      `Workflow: ${view.materializedGoalRef.workflowId}`,
      `Materialization: ${view.materializedGoalRef.goalMaterializationId}`,
      `Materialization digest: ${view.materializedGoalRef.materializationDigest}`,
      `Start disposition: ${view.startDisposition}`,
    );
  } else if (view.status === 'FAILED') {
    lines.push(
      `Failure: ${view.failure.id}`,
      `Failure digest: ${view.failure.digest}`,
      `Failed operation: ${view.failure.failedOperation}`,
      `Reason: ${view.failure.reasonCode}`,
      `Retry disposition: ${view.failure.retryDisposition}`,
    );
  } else if (view.operationKind !== undefined) {
    lines.push(`Operation kind: ${view.operationKind}`);
  }
  return lines.join('\n');
}

function renderIntakeAudit(
  envelope: Extract<CliEnvelope, { readonly kind: 'INTAKE_AUDIT' }>,
): string {
  if (envelope.result.status === 'NOT_FOUND') {
    return `Intake run not found: ${envelope.result.intakeRunId}`;
  }
  const view = envelope.result.view;
  const lines = [
    `Intake audit: ${view.intakeRunId}`,
    `Event count: ${String(view.events.length)}`,
    `Question count: ${String(view.questionHistory.length)}`,
  ];
  for (const event of view.events) {
    lines.push(
      `[${String(event.sequence)}] ${event.occurredAt} ${event.eventType}`,
      `  Payload digest: ${event.payloadDigest}`,
    );
    if (event.commandId !== undefined) {
      lines.push(`  Command: ${event.commandId}`);
    }
  }
  for (const question of view.questionHistory) {
    lines.push(
      `Question: ${question.id}`,
      `  Question spec digest: ${question.questionSpecDigest}`,
      `  Question digest: ${question.questionDigest}`,
      `  Issuing decision: ${question.issuingDecisionId}`,
      `  Issuing decision digest: ${question.issuingDecisionDigest}`,
      `  Answer schema: ${question.answerSchema.kind}`,
    );
    if (question.answerBinding !== undefined) {
      lines.push(
        `  Answer binding: ${question.answerBinding.id}`,
        `  Answer binding digest: ${question.answerBinding.digest}`,
        `  Answer command: ${question.answerBinding.commandId}`,
        `  Raw request: ${question.answerBinding.rawRequestId}@${String(question.answerBinding.rawRequestRevision)}`,
        `  Raw request digest: ${question.answerBinding.rawRequestDigest}`,
      );
    }
  }
  return lines.join('\n');
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
    case 'INTAKE_COMMAND_RESULT':
      return `${renderIntakeCommand(envelope)}\n`;
    case 'INTAKE_STATUS':
      return `${renderIntakeStatus(envelope)}\n`;
    case 'INTAKE_AUDIT':
      return `${renderIntakeAudit(envelope)}\n`;
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
