import { z } from 'zod';

import {
  assertExecutionProfileBindingInvariant,
  assertExecutionProfileDefinitionInvariant,
  assertExecutionProfileInvariant,
  type ExecutionProfile,
  type ExecutionProfileBinding,
  type ExecutionProfileDefinition,
} from './execution-profile.js';
import {
  commandId,
  executionProfileId,
  goalId,
  isoTimestamp,
  sha256Digest,
  workflowId,
} from './identifiers.js';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  error: 'String must not be blank',
});

const executionProfileDefinitionSchema = z
  .object({
    id: z.string(),
    schemaVersion: z.literal(1),
    version: nonBlankStringSchema,
    workerAdapter: nonBlankStringSchema,
    workerAdapterVersion: nonBlankStringSchema,
    candidateSource: nonBlankStringSchema,
    candidateSourceVersion: nonBlankStringSchema,
    verificationRunner: nonBlankStringSchema,
    verificationRunnerVersion: nonBlankStringSchema,
    driverVersion: nonBlankStringSchema,
  })
  .strict();

const executionProfileSchema = executionProfileDefinitionSchema
  .extend({ digest: z.string() })
  .strict();

const executionProfileBindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    workflowId: z.string(),
    profileId: z.string(),
    profileVersion: nonBlankStringSchema,
    profileDigest: z.string(),
    startCommandId: z.string(),
    boundAt: z.string(),
    bindingDigest: z.string(),
  })
  .strict();

function materializeDefinition(
  parsed: z.infer<typeof executionProfileDefinitionSchema>,
): ExecutionProfileDefinition {
  const definition: ExecutionProfileDefinition = Object.freeze({
    id: executionProfileId(parsed.id),
    schemaVersion: parsed.schemaVersion,
    version: parsed.version,
    workerAdapter: parsed.workerAdapter,
    workerAdapterVersion: parsed.workerAdapterVersion,
    candidateSource: parsed.candidateSource,
    candidateSourceVersion: parsed.candidateSourceVersion,
    verificationRunner: parsed.verificationRunner,
    verificationRunnerVersion: parsed.verificationRunnerVersion,
    driverVersion: parsed.driverVersion,
  });
  assertExecutionProfileDefinitionInvariant(definition);
  return definition;
}

export function decodeExecutionProfileDefinition(value: unknown): ExecutionProfileDefinition {
  return materializeDefinition(executionProfileDefinitionSchema.parse(value));
}

export function decodeExecutionProfile(value: unknown): ExecutionProfile {
  const parsed = executionProfileSchema.parse(value);
  const profile: ExecutionProfile = Object.freeze({
    ...materializeDefinition(parsed),
    digest: sha256Digest(parsed.digest),
  });
  assertExecutionProfileInvariant(profile);
  return profile;
}

export function decodeExecutionProfileBinding(value: unknown): ExecutionProfileBinding {
  const parsed = executionProfileBindingSchema.parse(value);
  const binding: ExecutionProfileBinding = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    workflowId: workflowId(parsed.workflowId),
    profileId: executionProfileId(parsed.profileId),
    profileVersion: parsed.profileVersion,
    profileDigest: sha256Digest(parsed.profileDigest),
    startCommandId: commandId(parsed.startCommandId),
    boundAt: isoTimestamp(parsed.boundAt),
    bindingDigest: sha256Digest(parsed.bindingDigest),
  });
  assertExecutionProfileBindingInvariant(binding);
  return binding;
}
