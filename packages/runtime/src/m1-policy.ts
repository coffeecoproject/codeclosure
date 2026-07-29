import { policyBundleId, type PolicyBundleDefinition } from '@codeclosure/domain';

import { M1_ACCEPTANCE_RULES, createM1AcceptanceCheckerIdentity } from './acceptance-policy.js';
import type { DigestProvider } from './ports.js';

export const M1_POLICY_BUNDLE_ID = policyBundleId('policy_codeclosure-m1');
export const M1_POLICY_BUNDLE_VERSION = 'codeclosure-m1-policy-v1';

/** Exact built-in control policy installed by trusted M1 composition. */
export function createM1PolicyBundleDefinition(digests: DigestProvider): PolicyBundleDefinition {
  return Object.freeze({
    id: M1_POLICY_BUNDLE_ID,
    schemaVersion: 1,
    version: M1_POLICY_BUNDLE_VERSION,
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['execution-profile-bound-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['exact-candidate-and-policy']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([createM1AcceptanceCheckerIdentity(digests)]),
  });
}
