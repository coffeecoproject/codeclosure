#!/usr/bin/env node

import { CliErrorCode, type CliEnvelope } from './cli/contracts.js';
import { CliUsageError, parseCliInvocation, wantsJsonOutput } from './cli/parser.js';
import {
  exitCodeForCliEnvelope,
  renderCliEnvelopeHuman,
  renderCliEnvelopeJson,
} from './cli/presentation.js';
import { resolveCliProjectPath } from './cli/project-path.js';
import { executeAuditShow } from './commands/audit-show.js';
import { executeDemoRun } from './commands/demo-run.js';
import { executeGoalCancel } from './commands/goal-cancel.js';
import { CliGoalNotFoundError } from './commands/goal-command-target.js';
import { executeGoalCreate } from './commands/goal-create.js';
import { executeGoalResume } from './commands/goal-resume.js';
import { executeGoalStart } from './commands/goal-start.js';
import { executeGoalStatus } from './commands/goal-status.js';
import {
  createCliCommandId,
  createCliInvocationComposition,
  runM1DemoProof,
  validateCliStartProfileName,
} from './composition/index.js';

function cliError(code: CliErrorCode, message: string): CliEnvelope {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'CLI_ERROR',
    error: Object.freeze({ code, message }),
  });
}

function selectedStartProfileName(fixtureName: string | undefined): string | undefined {
  if (fixtureName === undefined) {
    return undefined;
  }
  try {
    return validateCliStartProfileName(fixtureName);
  } catch (error) {
    throw new CliUsageError(`Unknown --fixture value: ${fixtureName}`, { cause: error });
  }
}

async function runCli(args: readonly string[]): Promise<number> {
  let json = wantsJsonOutput(args);
  let envelope: CliEnvelope;
  let diagnostic: string | undefined;
  try {
    const invocation = parseCliInvocation(args);
    json = invocation.json;
    switch (invocation.operation) {
      case 'goal create': {
        const projectPath = resolveCliProjectPath(invocation.projectOperand, process.cwd());
        const composition = createCliInvocationComposition({
          platform: process.platform,
          environment: process.env,
          projectPath,
        });
        try {
          envelope = executeGoalCreate({
            application: composition.application,
            commandId: createCliCommandId(),
            objective: invocation.objective,
            projectPath,
            criteria: invocation.criteria,
          });
        } finally {
          composition.close();
        }
        break;
      }
      case 'goal status': {
        const composition = createCliInvocationComposition({
          platform: process.platform,
          environment: process.env,
        });
        try {
          envelope = executeGoalStatus(composition.application, invocation.goalId);
        } finally {
          composition.close();
        }
        break;
      }
      case 'goal start': {
        const startProfileName = selectedStartProfileName(invocation.fixtureName);
        const composition = createCliInvocationComposition({
          platform: process.platform,
          environment: process.env,
          ...(startProfileName === undefined ? {} : { startProfileName }),
        });
        try {
          envelope = await executeGoalStart({
            application: composition.application,
            commandId: createCliCommandId(),
            goalId: invocation.goalId,
          });
        } finally {
          composition.close();
        }
        break;
      }
      case 'goal resume': {
        const composition = createCliInvocationComposition({
          platform: process.platform,
          environment: process.env,
        });
        try {
          envelope = await executeGoalResume({
            application: composition.application,
            commandId: createCliCommandId(),
            goalId: invocation.goalId,
          });
        } finally {
          composition.close();
        }
        break;
      }
      case 'goal cancel': {
        const composition = createCliInvocationComposition({
          platform: process.platform,
          environment: process.env,
        });
        try {
          envelope = executeGoalCancel({
            application: composition.application,
            commandId: createCliCommandId(),
            goalId: invocation.goalId,
          });
        } finally {
          composition.close();
        }
        break;
      }
      case 'audit show': {
        const composition = createCliInvocationComposition({
          platform: process.platform,
          environment: process.env,
        });
        try {
          envelope = executeAuditShow(composition.application, invocation.goalId);
        } finally {
          composition.close();
        }
        break;
      }
      case 'demo run':
        envelope = await executeDemoRun(
          Object.freeze({ run: runM1DemoProof }),
          invocation.scenario,
        );
        break;
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      envelope = cliError(CliErrorCode.USAGE, error.message);
    } else if (error instanceof CliGoalNotFoundError) {
      envelope = cliError(CliErrorCode.GOAL_NOT_FOUND, error.message);
    } else {
      const message = error instanceof Error ? error.message : 'Unknown CLI failure';
      envelope = cliError(
        CliErrorCode.INTERNAL,
        'CodeClosure could not produce a trustworthy result.',
      );
      diagnostic = message;
    }
  }

  const exitCode = exitCodeForCliEnvelope(envelope);
  if (json) {
    process.stdout.write(renderCliEnvelopeJson(envelope));
    if (diagnostic !== undefined) {
      process.stderr.write(`CodeClosure diagnostic: ${diagnostic}\n`);
    }
  } else {
    const output = renderCliEnvelopeHuman(envelope);
    (exitCode === 0 ? process.stdout : process.stderr).write(output);
    if (diagnostic !== undefined) {
      process.stderr.write(`CodeClosure diagnostic: ${diagnostic}\n`);
    }
  }
  return exitCode;
}

process.exitCode = await runCli(process.argv.slice(2));
