import { policyBundleId, type PolicyBundleDefinition } from '@codeclosure/domain';

import { M1_ACCEPTANCE_RULES, createM1AcceptanceCheckerIdentity } from './acceptance-policy.js';
import type { DigestProvider } from './ports.js';

export const M251_POLICY_BUNDLE_ID = policyBundleId('policy_codeclosure-m2-5-1-real-intake');
export const M251_POLICY_BUNDLE_VERSION = 'codeclosure-m2-5-1-real-intake-policy-v1';

/**
 * Exact Workflow Policy selected by the formal M2.5.1 composition.
 *
 * The new identity freezes a new-goal selection boundary. The underlying
 * control and Acceptance owners remain the existing Runtime and Acceptance
 * Engine; this definition does not reinterpret an installed M1/M2/M2.5
 * policy or add a second completion authority.
 */
export function createM251PolicyBundleDefinition(digests: DigestProvider): PolicyBundleDefinition {
  return Object.freeze({
    id: M251_POLICY_BUNDLE_ID,
    schemaVersion: 1,
    version: M251_POLICY_BUNDLE_VERSION,
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['execution-profile-bound-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['exact-candidate-and-policy']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([createM1AcceptanceCheckerIdentity(digests)]),
  });
}
