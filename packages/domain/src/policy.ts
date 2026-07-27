import {
  policyBundleId,
  sha256Digest,
  type PolicyBundleId,
  type Sha256Digest,
} from './identifiers.js';

export interface PolicyCheckerIdentity {
  readonly checkerId: string;
  readonly checkerVersion: string;
  readonly checkerDigest: Sha256Digest;
}

export interface PolicyBundle {
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
  readonly digest: Sha256Digest;
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

export function assertPolicyBundleInvariant(bundle: PolicyBundle): void {
  policyBundleId(bundle.id);
  sha256Digest(bundle.digest);
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

export function policyBundleProjection(bundle: Omit<PolicyBundle, 'digest'>): unknown {
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
