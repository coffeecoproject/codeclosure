import {
  type IntakeAuditView,
  type IntakeCoordinatorCommandResult,
  type IntakeStatusView,
  type SubmitIntakeCommand,
  type ClarifyIntakeCommand,
  type AbandonIntakeCommand,
} from '@codeclosure/runtime';

import {
  CliIntakeAction,
  CliOperation,
  type CliIntakeAuditEnvelope,
  type CliIntakeCommandResultEnvelope,
  type CliIntakeStatusEnvelope,
} from '../cli/contracts.js';
import type {
  IntakeAbandonInvocation,
  IntakeClarifyInvocation,
  IntakeSubmitInvocation,
} from '../cli/parser.js';

export interface IntakeCliApplication {
  submit(
    input: Readonly<{
      commandId: SubmitIntakeCommand['commandId'];
      interactionAction: SubmitIntakeCommand['interactionAction'];
      admittedUserContent: string;
      declaredProjectPath?: string;
      declaredConstraints?: readonly string[];
    }>,
  ): Promise<IntakeCoordinatorCommandResult>;
  clarify(
    input: Readonly<{
      commandId: ClarifyIntakeCommand['commandId'];
      intakeRunId: ClarifyIntakeCommand['intakeRunId'];
      expectedIntakeRunVersion: number;
      clarificationQuestionId: ClarifyIntakeCommand['clarificationQuestionId'];
      answer: string;
      declaredProjectPath?: string;
    }>,
  ): Promise<IntakeCoordinatorCommandResult>;
  abandon(input: AbandonIntakeCommand): IntakeCoordinatorCommandResult;
  getStatus(intakeRunId: string): IntakeStatusView | undefined;
  getAudit(intakeRunId: string): IntakeAuditView | undefined;
}

function runtimeAction(
  action: IntakeSubmitInvocation['action'],
): SubmitIntakeCommand['interactionAction'] {
  switch (action) {
    case CliIntakeAction.ANSWER_ONLY:
      return 'ANSWER_ONLY';
    case CliIntakeAction.MATERIALIZE_ONLY:
      return 'MATERIALIZE_ONLY';
    case CliIntakeAction.GOVERNED_EXECUTION:
      return 'GOVERNED_EXECUTION';
  }
}

export async function executeIntakeSubmit(
  options: Readonly<{
    application: IntakeCliApplication;
    commandId: SubmitIntakeCommand['commandId'];
    invocation: IntakeSubmitInvocation;
    projectPath?: string;
  }>,
): Promise<CliIntakeCommandResultEnvelope> {
  const result = await options.application.submit({
    commandId: options.commandId,
    interactionAction: runtimeAction(options.invocation.action),
    admittedUserContent: options.invocation.request,
    ...(options.projectPath === undefined ? {} : { declaredProjectPath: options.projectPath }),
    ...(options.invocation.constraints.length === 0
      ? {}
      : { declaredConstraints: options.invocation.constraints }),
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: 'INTAKE_COMMAND_RESULT',
    operation: CliOperation.INTAKE_SUBMIT,
    result,
  });
}

export async function executeIntakeClarify(
  options: Readonly<{
    application: IntakeCliApplication;
    commandId: ClarifyIntakeCommand['commandId'];
    invocation: IntakeClarifyInvocation;
    projectPath?: string;
  }>,
): Promise<CliIntakeCommandResultEnvelope> {
  const current = options.application.getStatus(options.invocation.intakeRunId);
  const declaresProjectIdentity =
    current?.status === 'NEEDS_CLARIFICATION' &&
    current.activeQuestion.affectedFields.includes('PROJECT_IDENTITY');
  const result = await options.application.clarify({
    commandId: options.commandId,
    intakeRunId: options.invocation.intakeRunId,
    expectedIntakeRunVersion: options.invocation.expectedVersion,
    clarificationQuestionId: options.invocation.questionId,
    answer: options.invocation.answer,
    ...(options.projectPath === undefined || !declaresProjectIdentity
      ? {}
      : { declaredProjectPath: options.projectPath }),
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: 'INTAKE_COMMAND_RESULT',
    operation: CliOperation.INTAKE_CLARIFY,
    result,
  });
}

export function executeIntakeAbandon(
  options: Readonly<{
    application: IntakeCliApplication;
    commandId: AbandonIntakeCommand['commandId'];
    invocation: IntakeAbandonInvocation;
  }>,
): CliIntakeCommandResultEnvelope {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'INTAKE_COMMAND_RESULT',
    operation: CliOperation.INTAKE_ABANDON,
    result: options.application.abandon({
      commandId: options.commandId,
      intakeRunId: options.invocation.intakeRunId,
      expectedIntakeRunVersion: options.invocation.expectedVersion,
    }),
  });
}

export function executeIntakeStatus(
  application: IntakeCliApplication,
  intakeRunId: string,
): CliIntakeStatusEnvelope {
  const view = application.getStatus(intakeRunId);
  return Object.freeze({
    schemaVersion: 1,
    kind: 'INTAKE_STATUS',
    operation: CliOperation.INTAKE_STATUS,
    result:
      view === undefined
        ? Object.freeze({ status: 'NOT_FOUND', intakeRunId })
        : Object.freeze({ status: 'FOUND', view }),
  });
}

export function executeIntakeAudit(
  application: IntakeCliApplication,
  intakeRunId: string,
): CliIntakeAuditEnvelope {
  const view = application.getAudit(intakeRunId);
  return Object.freeze({
    schemaVersion: 1,
    kind: 'INTAKE_AUDIT',
    operation: CliOperation.INTAKE_AUDIT,
    result:
      view === undefined
        ? Object.freeze({ status: 'NOT_FOUND', intakeRunId })
        : Object.freeze({ status: 'FOUND', view }),
  });
}
