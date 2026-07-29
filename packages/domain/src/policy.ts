import {
  commandId,
  goalId,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  workflowId,
  type CommandId,
  type GoalId,
  type IsoTimestamp,
  type PolicyBundleId,
  type Sha256Digest,
  type WorkflowId,
} from './identifiers.js';

export interface PolicyCheckerIdentity {
  readonly checkerId: string;
  readonly checkerVersion: string;
  readonly checkerDigest: Sha256Digest;
}

export interface PolicyBundleDefinition {
  readonly id: PolicyBundleId;
  readonly schemaVersion: 1;
  readonly version: string;
  readonly transitionRules: readonly string[];
  readonly capabilityRules: readonly string[];
  readonly contextRules: readonly string[];
  readonly checkSpecifications: readonly string[];
  readonly applicabilityRules: readonly string[];
  readonly acceptanceRules: readonly string[];
  readonly checkerVersions: readonly PolicyCheckerIdentity[];
}

export interface PolicyBundle extends PolicyBundleDefinition {
  readonly digest: Sha256Digest;
}

/**
 * The exact Policy authority permanently selected by a Workflow's first Start.
 *
 * This is deliberately separate from ExecutionProfileBinding: Policy owns the
 * control semantics, while an Execution Profile identifies executable adapter
 * composition. Neither identity may be inferred from the other.
 */
export interface WorkflowPolicyBinding {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly workflowId: WorkflowId;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleVersion: string;
  readonly policyBundleDigest: Sha256Digest;
  readonly startCommandId: CommandId;
  readonly boundAt: IsoTimestamp;
  readonly bindingDigest: Sha256Digest;
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be blank`);
  }
}

function assertUnique(values: readonly string[], name: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertNonBlank(value, name);
    if (seen.has(value)) {
      throw new TypeError(`${name} must not contain duplicates`);
    }
    seen.add(value);
  }
}

function field(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

export function assertPolicyBundleDefinitionInvariant(bundle: PolicyBundleDefinition): void {
  policyBundleId(bundle.id);
  if (field(bundle, 'schemaVersion') !== 1) {
    throw new TypeError('Policy Bundle schema version is unsupported');
  }
  assertNonBlank(bundle.version, 'Policy Bundle version');
  assertUnique(bundle.transitionRules, 'Policy transition rule');
  assertUnique(bundle.capabilityRules, 'Policy capability rule');
  assertUnique(bundle.contextRules, 'Policy context rule');
  assertUnique(bundle.checkSpecifications, 'Policy check specification');
  assertUnique(bundle.applicabilityRules, 'Policy applicability rule');
  assertUnique(bundle.acceptanceRules, 'Policy acceptance rule');
  const checkerIds = new Set<string>();
  for (const checker of bundle.checkerVersions) {
    assertNonBlank(checker.checkerId, 'Policy checker ID');
    assertNonBlank(checker.checkerVersion, 'Policy checker version');
    sha256Digest(checker.checkerDigest);
    if (checkerIds.has(checker.checkerId)) {
      throw new TypeError('Policy checker identities must be unique');
    }
    checkerIds.add(checker.checkerId);
  }
}

export function assertPolicyBundleInvariant(bundle: PolicyBundle): void {
  assertPolicyBundleDefinitionInvariant(bundle);
  sha256Digest(bundle.digest);
}

export function policyBundleProjection(bundle: PolicyBundleDefinition): unknown {
  return {
    id: bundle.id,
    schemaVersion: bundle.schemaVersion,
    version: bundle.version,
    transitionRules: bundle.transitionRules,
    capabilityRules: bundle.capabilityRules,
    contextRules: bundle.contextRules,
    checkSpecifications: bundle.checkSpecifications,
    applicabilityRules: bundle.applicabilityRules,
    acceptanceRules: bundle.acceptanceRules,
    checkerVersions: bundle.checkerVersions,
  };
}

export function assertWorkflowPolicyBindingInvariant(binding: WorkflowPolicyBinding): void {
  if (field(binding, 'schemaVersion') !== 1) {
    throw new TypeError('Workflow Policy binding schema version is unsupported');
  }
  goalId(binding.goalId);
  workflowId(binding.workflowId);
  policyBundleId(binding.policyBundleId);
  assertNonBlank(binding.policyBundleVersion, 'Workflow Policy binding version');
  sha256Digest(binding.policyBundleDigest);
  commandId(binding.startCommandId);
  isoTimestamp(binding.boundAt);
  sha256Digest(binding.bindingDigest);
}

export function workflowPolicyBindingProjection(
  binding: Omit<WorkflowPolicyBinding, 'bindingDigest'>,
): unknown {
  return {
    schemaVersion: binding.schemaVersion,
    goalId: binding.goalId,
    workflowId: binding.workflowId,
    policyBundleId: binding.policyBundleId,
    policyBundleVersion: binding.policyBundleVersion,
    policyBundleDigest: binding.policyBundleDigest,
    startCommandId: binding.startCommandId,
    boundAt: binding.boundAt,
  };
}
