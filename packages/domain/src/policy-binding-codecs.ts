import { z } from 'zod';

import {
  commandId,
  goalId,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  workflowId,
} from './identifiers.js';
import { assertWorkflowPolicyBindingInvariant, type WorkflowPolicyBinding } from './policy.js';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  error: 'String must not be blank',
});

const workflowPolicyBindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    workflowId: z.string(),
    policyBundleId: z.string(),
    policyBundleVersion: nonBlankStringSchema,
    policyBundleDigest: z.string(),
    startCommandId: z.string(),
    boundAt: z.string(),
    bindingDigest: z.string(),
  })
  .strict();

export function decodeWorkflowPolicyBinding(value: unknown): WorkflowPolicyBinding {
  const parsed = workflowPolicyBindingSchema.parse(value);
  const binding: WorkflowPolicyBinding = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    workflowId: workflowId(parsed.workflowId),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleVersion: parsed.policyBundleVersion,
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    startCommandId: commandId(parsed.startCommandId),
    boundAt: isoTimestamp(parsed.boundAt),
    bindingDigest: sha256Digest(parsed.bindingDigest),
  });
  assertWorkflowPolicyBindingInvariant(binding);
  return binding;
}
