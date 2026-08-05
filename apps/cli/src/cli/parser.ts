import { parseArgs } from 'node:util';

import {
  parseClarificationQuestionIdentifier,
  parseGoalIdentifier,
  parseIntakeRunIdentifier,
} from '@codeclosure/runtime';
import { z } from 'zod';

import { CliDemoScenario, CliIntakeAction, CliOperation } from './contracts.js';

export interface IntakeSubmitInvocation {
  readonly operation: typeof CliOperation.INTAKE_SUBMIT;
  readonly action: CliIntakeAction;
  readonly request: string;
  readonly projectOperand?: string;
  readonly constraints: readonly string[];
  readonly json: boolean;
}

export interface IntakeClarifyInvocation {
  readonly operation: typeof CliOperation.INTAKE_CLARIFY;
  readonly intakeRunId: ReturnType<typeof parseIntakeRunIdentifier>;
  readonly questionId: ReturnType<typeof parseClarificationQuestionIdentifier>;
  readonly expectedVersion: number;
  readonly answer: string;
  readonly projectOperand?: string;
  readonly json: boolean;
}

export interface IntakeAbandonInvocation {
  readonly operation: typeof CliOperation.INTAKE_ABANDON;
  readonly intakeRunId: ReturnType<typeof parseIntakeRunIdentifier>;
  readonly expectedVersion: number;
  readonly json: boolean;
}

export interface IntakeReadInvocation {
  readonly operation: typeof CliOperation.INTAKE_STATUS | typeof CliOperation.INTAKE_AUDIT;
  readonly intakeRunId: ReturnType<typeof parseIntakeRunIdentifier>;
  readonly json: boolean;
}

export interface GoalCreateInvocation {
  readonly operation: typeof CliOperation.GOAL_CREATE;
  readonly objective: string;
  readonly projectOperand: string;
  readonly criteria: readonly string[];
  readonly json: boolean;
}

export interface GoalStatusInvocation {
  readonly operation: typeof CliOperation.GOAL_STATUS;
  readonly goalId: ReturnType<typeof parseGoalIdentifier>;
  readonly json: boolean;
}

export interface GoalStartInvocation {
  readonly operation: typeof CliOperation.GOAL_START;
  readonly goalId: ReturnType<typeof parseGoalIdentifier>;
  readonly fixtureName?: string;
  readonly json: boolean;
}

export interface GoalResumeInvocation {
  readonly operation: typeof CliOperation.GOAL_RESUME;
  readonly goalId: ReturnType<typeof parseGoalIdentifier>;
  readonly json: boolean;
}

export interface GoalCancelInvocation {
  readonly operation: typeof CliOperation.GOAL_CANCEL;
  readonly goalId: ReturnType<typeof parseGoalIdentifier>;
  readonly json: boolean;
}

export interface AuditShowInvocation {
  readonly operation: typeof CliOperation.AUDIT_SHOW;
  readonly goalId: ReturnType<typeof parseGoalIdentifier>;
  readonly json: boolean;
}

export interface DemoRunInvocation {
  readonly operation: typeof CliOperation.DEMO_RUN;
  readonly scenario: CliDemoScenario;
  readonly json: boolean;
}

export type CliInvocation =
  | IntakeSubmitInvocation
  | IntakeClarifyInvocation
  | IntakeAbandonInvocation
  | IntakeReadInvocation
  | GoalCreateInvocation
  | GoalStartInvocation
  | GoalStatusInvocation
  | GoalResumeInvocation
  | GoalCancelInvocation
  | AuditShowInvocation
  | DemoRunInvocation;

export class CliUsageError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliUsageError';
  }
}

const CREATE_USAGE =
  'Usage: codeclosure goal create --objective <text> --project <path> --criterion <text> [--criterion <text> ...] [--json]';
const START_USAGE = 'Usage: codeclosure goal start <goal-id> [--fixture <name>] [--json]';
const STATUS_USAGE = 'Usage: codeclosure goal status <goal-id> [--json]';
const RESUME_USAGE = 'Usage: codeclosure goal resume <goal-id> [--json]';
const CANCEL_USAGE = 'Usage: codeclosure goal cancel <goal-id> [--json]';
const AUDIT_USAGE = 'Usage: codeclosure audit show <goal-id> [--json]';
const DEMO_USAGE = 'Usage: codeclosure demo run <scenario> [--json]';
const INTAKE_SUBMIT_USAGE =
  'Usage: codeclosure intake submit --action <answer-only|materialize-only|governed-execution> --request <text> [--project <path>] [--constraint <text> ...] [--json]';
const INTAKE_CLARIFY_USAGE =
  'Usage: codeclosure intake clarify <intake-run-id> --question-id <clarification-question-id> --expected-version <number> --answer <text> [--project <path>] [--json]';
const INTAKE_ABANDON_USAGE =
  'Usage: codeclosure intake abandon <intake-run-id> --expected-version <number> [--json]';
const INTAKE_STATUS_USAGE = 'Usage: codeclosure intake status <intake-run-id> [--json]';
const INTAKE_AUDIT_USAGE = 'Usage: codeclosure intake audit <intake-run-id> [--json]';
const ROOT_USAGE = [
  INTAKE_SUBMIT_USAGE,
  INTAKE_CLARIFY_USAGE,
  INTAKE_ABANDON_USAGE,
  INTAKE_STATUS_USAGE,
  INTAKE_AUDIT_USAGE,
  CREATE_USAGE,
  START_USAGE,
  STATUS_USAGE,
  RESUME_USAGE,
  CANCEL_USAGE,
  AUDIT_USAGE,
  DEMO_USAGE,
]
  .map((usage) => `  ${usage.slice('Usage: '.length)}`)
  .join('\n');

const createOperandsSchema = z
  .object({
    objective: z.string().trim().min(1),
    projectOperand: z.string().refine((value) => value.trim().length > 0),
    criteria: z.array(z.string().trim().min(1)).min(1),
    json: z.boolean(),
  })
  .strict();

const statusOperandsSchema = z
  .object({
    goalId: z.string().trim().min(1),
    json: z.boolean(),
  })
  .strict();

const startOperandsSchema = statusOperandsSchema
  .extend({ fixtureName: z.string().trim().min(1).optional() })
  .strict();

const demoOperandsSchema = z
  .object({
    scenario: z.enum(CliDemoScenario),
    json: z.boolean(),
  })
  .strict();

const exactNonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, 'value must contain non-whitespace content');

const intakeSubmitOperandsSchema = z
  .object({
    action: z.enum(CliIntakeAction),
    request: exactNonBlankStringSchema,
    projectOperand: z
      .string()
      .refine((value) => value.trim().length > 0)
      .optional(),
    constraints: z.array(exactNonBlankStringSchema),
    json: z.boolean(),
  })
  .strict();

const intakeClarifyOperandsSchema = z
  .object({
    intakeRunId: exactNonBlankStringSchema,
    questionId: exactNonBlankStringSchema,
    expectedVersion: z.coerce.number().int().positive(),
    answer: exactNonBlankStringSchema,
    projectOperand: z
      .string()
      .refine((value) => value.trim().length > 0)
      .optional(),
    json: z.boolean(),
  })
  .strict();

const intakeAbandonOperandsSchema = z
  .object({
    intakeRunId: exactNonBlankStringSchema,
    expectedVersion: z.coerce.number().int().positive(),
    json: z.boolean(),
  })
  .strict();

function parseIntakeSubmit(args: readonly string[]): IntakeSubmitInvocation {
  for (const option of ['action', 'request', 'project', 'json']) {
    requireSingleOption(args, option, INTAKE_SUBMIT_USAGE);
  }
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        action: { type: 'string' },
        request: { type: 'string' },
        project: { type: 'string' },
        constraint: { type: 'string', multiple: true },
        json: { type: 'boolean', default: false },
      },
    });
    const operands = intakeSubmitOperandsSchema.parse({
      action: parsed.values.action,
      request: parsed.values.request,
      projectOperand: parsed.values.project,
      constraints: parsed.values.constraint ?? [],
      json: parsed.values.json,
    });
    return Object.freeze({
      operation: CliOperation.INTAKE_SUBMIT,
      action: operands.action,
      request: operands.request,
      ...(operands.projectOperand === undefined ? {} : { projectOperand: operands.projectOperand }),
      constraints: Object.freeze(operands.constraints),
      json: operands.json,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(
      `${error instanceof Error ? error.message : 'Invalid intake submit arguments'}\n${INTAKE_SUBMIT_USAGE}`,
      { cause: error },
    );
  }
}

function parseIntakeClarify(args: readonly string[]): IntakeClarifyInvocation {
  for (const option of ['question-id', 'expected-version', 'answer', 'project', 'json']) {
    requireSingleOption(args, option, INTAKE_CLARIFY_USAGE);
  }
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        'question-id': { type: 'string' },
        'expected-version': { type: 'string' },
        answer: { type: 'string' },
        project: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
    if (parsed.positionals.length !== 1) {
      throw new CliUsageError(
        `Intake clarify requires exactly one IntakeRunId.\n${INTAKE_CLARIFY_USAGE}`,
      );
    }
    const operands = intakeClarifyOperandsSchema.parse({
      intakeRunId: parsed.positionals[0],
      questionId: parsed.values['question-id'],
      expectedVersion: parsed.values['expected-version'],
      answer: parsed.values.answer,
      projectOperand: parsed.values.project,
      json: parsed.values.json,
    });
    return Object.freeze({
      operation: CliOperation.INTAKE_CLARIFY,
      intakeRunId: parseIntakeRunIdentifier(operands.intakeRunId),
      questionId: parseClarificationQuestionIdentifier(operands.questionId),
      expectedVersion: operands.expectedVersion,
      answer: operands.answer,
      ...(operands.projectOperand === undefined ? {} : { projectOperand: operands.projectOperand }),
      json: operands.json,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(
      `${error instanceof Error ? error.message : 'Invalid intake clarify arguments'}\n${INTAKE_CLARIFY_USAGE}`,
      { cause: error },
    );
  }
}

function parseIntakeAbandon(args: readonly string[]): IntakeAbandonInvocation {
  for (const option of ['expected-version', 'json']) {
    requireSingleOption(args, option, INTAKE_ABANDON_USAGE);
  }
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        'expected-version': { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
    if (parsed.positionals.length !== 1) {
      throw new CliUsageError(
        `Intake abandon requires exactly one IntakeRunId.\n${INTAKE_ABANDON_USAGE}`,
      );
    }
    const operands = intakeAbandonOperandsSchema.parse({
      intakeRunId: parsed.positionals[0],
      expectedVersion: parsed.values['expected-version'],
      json: parsed.values.json,
    });
    return Object.freeze({
      operation: CliOperation.INTAKE_ABANDON,
      intakeRunId: parseIntakeRunIdentifier(operands.intakeRunId),
      expectedVersion: operands.expectedVersion,
      json: operands.json,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(
      `${error instanceof Error ? error.message : 'Invalid intake abandon arguments'}\n${INTAKE_ABANDON_USAGE}`,
      { cause: error },
    );
  }
}

function parseIntakeRead(
  args: readonly string[],
  operation: typeof CliOperation.INTAKE_STATUS | typeof CliOperation.INTAKE_AUDIT,
  usage: string,
): IntakeReadInvocation {
  requireSingleOption(args, 'json', usage);
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: { json: { type: 'boolean', default: false } },
    });
    if (parsed.positionals.length !== 1) {
      throw new CliUsageError(`Command requires exactly one IntakeRunId.\n${usage}`);
    }
    return Object.freeze({
      operation,
      intakeRunId: parseIntakeRunIdentifier(parsed.positionals[0] ?? ''),
      json: parsed.values.json,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(
      `${error instanceof Error ? error.message : 'Invalid Intake read arguments'}\n${usage}`,
      { cause: error },
    );
  }
}

function countOption(args: readonly string[], option: string): number {
  const exact = `--${option}`;
  const assigned = `${exact}=`;
  return args.filter((argument) => argument === exact || argument.startsWith(assigned)).length;
}

function requireSingleOption(args: readonly string[], option: string, usage: string): void {
  if (countOption(args, option) > 1) {
    throw new CliUsageError(`--${option} may be provided only once.\n${usage}`);
  }
}

function parseCreate(args: readonly string[]): GoalCreateInvocation {
  requireSingleOption(args, 'objective', CREATE_USAGE);
  requireSingleOption(args, 'project', CREATE_USAGE);
  requireSingleOption(args, 'json', CREATE_USAGE);
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        objective: { type: 'string' },
        project: { type: 'string' },
        criterion: { type: 'string', multiple: true },
        json: { type: 'boolean', default: false },
      },
    });
    const operands = createOperandsSchema.parse({
      objective: parsed.values.objective ?? '',
      projectOperand: parsed.values.project ?? '',
      criteria: parsed.values.criterion ?? [],
      json: parsed.values.json,
    });
    return Object.freeze({
      operation: CliOperation.GOAL_CREATE,
      objective: operands.objective,
      projectOperand: operands.projectOperand,
      criteria: Object.freeze(operands.criteria),
      json: operands.json,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(
      `${error instanceof Error ? error.message : 'Invalid goal create arguments'}\n${CREATE_USAGE}`,
      { cause: error },
    );
  }
}

function parseStatus(args: readonly string[]): GoalStatusInvocation {
  const operands = parseSingleGoalOperands(args, STATUS_USAGE);
  return Object.freeze({
    operation: CliOperation.GOAL_STATUS,
    ...operands,
  });
}

function parseSingleGoalOperands(
  args: readonly string[],
  usage: string,
): Omit<GoalStatusInvocation, 'operation'> {
  requireSingleOption(args, 'json', usage);
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean', default: false },
      },
    });
    if (parsed.positionals.length !== 1) {
      throw new CliUsageError(`Command requires exactly one GoalId.\n${usage}`);
    }
    const operands = statusOperandsSchema.parse({
      goalId: parsed.positionals[0],
      json: parsed.values.json,
    });
    return Object.freeze({
      goalId: parseGoalIdentifier(operands.goalId),
      json: operands.json,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(
      `${error instanceof Error ? error.message : 'Invalid Goal command arguments'}\n${usage}`,
      { cause: error },
    );
  }
}

function parseStart(args: readonly string[]): GoalStartInvocation {
  requireSingleOption(args, 'fixture', START_USAGE);
  requireSingleOption(args, 'json', START_USAGE);
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        fixture: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
    if (parsed.positionals.length !== 1) {
      throw new CliUsageError(`Goal start requires exactly one GoalId.\n${START_USAGE}`);
    }
    const operands = startOperandsSchema.parse({
      goalId: parsed.positionals[0],
      fixtureName: parsed.values.fixture,
      json: parsed.values.json,
    });
    return Object.freeze({
      operation: CliOperation.GOAL_START,
      goalId: parseGoalIdentifier(operands.goalId),
      ...(operands.fixtureName === undefined ? {} : { fixtureName: operands.fixtureName }),
      json: operands.json,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(
      `${error instanceof Error ? error.message : 'Invalid goal start arguments'}\n${START_USAGE}`,
      { cause: error },
    );
  }
}

function parseResume(args: readonly string[]): GoalResumeInvocation {
  return Object.freeze({
    operation: CliOperation.GOAL_RESUME,
    ...parseSingleGoalOperands(args, RESUME_USAGE),
  });
}

function parseCancel(args: readonly string[]): GoalCancelInvocation {
  return Object.freeze({
    operation: CliOperation.GOAL_CANCEL,
    ...parseSingleGoalOperands(args, CANCEL_USAGE),
  });
}

function parseAuditShow(args: readonly string[]): AuditShowInvocation {
  return Object.freeze({
    operation: CliOperation.AUDIT_SHOW,
    ...parseSingleGoalOperands(args, AUDIT_USAGE),
  });
}

function parseDemoRun(args: readonly string[]): DemoRunInvocation {
  requireSingleOption(args, 'json', DEMO_USAGE);
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean', default: false },
      },
    });
    if (parsed.positionals.length !== 1) {
      throw new CliUsageError(`Demo run requires exactly one scenario.\n${DEMO_USAGE}`);
    }
    const operands = demoOperandsSchema.parse({
      scenario: parsed.positionals[0],
      json: parsed.values.json,
    });
    return Object.freeze({
      operation: CliOperation.DEMO_RUN,
      scenario: operands.scenario,
      json: operands.json,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(
      `${error instanceof Error ? error.message : 'Invalid demo run arguments'}\n${DEMO_USAGE}`,
      { cause: error },
    );
  }
}

export function wantsJsonOutput(args: readonly string[]): boolean {
  return args.includes('--json');
}

export function parseCliInvocation(args: readonly string[]): CliInvocation {
  const [group, action, ...remaining] = args;
  if (group === 'intake' && action === 'submit') {
    return parseIntakeSubmit(remaining);
  }
  if (group === 'intake' && action === 'clarify') {
    return parseIntakeClarify(remaining);
  }
  if (group === 'intake' && action === 'abandon') {
    return parseIntakeAbandon(remaining);
  }
  if (group === 'intake' && action === 'status') {
    return parseIntakeRead(remaining, CliOperation.INTAKE_STATUS, INTAKE_STATUS_USAGE);
  }
  if (group === 'intake' && action === 'audit') {
    return parseIntakeRead(remaining, CliOperation.INTAKE_AUDIT, INTAKE_AUDIT_USAGE);
  }
  if (group === 'goal' && action === 'create') {
    return parseCreate(remaining);
  }
  if (group === 'goal' && action === 'status') {
    return parseStatus(remaining);
  }
  if (group === 'goal' && action === 'start') {
    return parseStart(remaining);
  }
  if (group === 'goal' && action === 'resume') {
    return parseResume(remaining);
  }
  if (group === 'goal' && action === 'cancel') {
    return parseCancel(remaining);
  }
  if (group === 'audit' && action === 'show') {
    return parseAuditShow(remaining);
  }
  if (group === 'demo' && action === 'run') {
    return parseDemoRun(remaining);
  }
  throw new CliUsageError(`Usage:\n${ROOT_USAGE}`);
}
