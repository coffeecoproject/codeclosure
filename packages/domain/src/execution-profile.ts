import {
  commandId,
  executionProfileId,
  goalId,
  isoTimestamp,
  sha256Digest,
  workflowId,
  type CommandId,
  type ExecutionProfileId,
  type GoalId,
  type IsoTimestamp,
  type Sha256Digest,
  type WorkflowId,
} from './identifiers.js';

export interface ExecutionProfileDefinition {
  readonly id: ExecutionProfileId;
  readonly schemaVersion: 1;
  readonly version: string;
  readonly workerAdapter: string;
  readonly workerAdapterVersion: string;
  readonly candidateSource: string;
  readonly candidateSourceVersion: string;
  readonly verificationRunner: string;
  readonly verificationRunnerVersion: string;
  readonly driverVersion: string;
}

export interface ExecutionProfile extends ExecutionProfileDefinition {
  readonly digest: Sha256Digest;
}

export interface ExecutionProfileBinding {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly workflowId: WorkflowId;
  readonly profileId: ExecutionProfileId;
  readonly profileVersion: string;
  readonly profileDigest: Sha256Digest;
  readonly startCommandId: CommandId;
  readonly boundAt: IsoTimestamp;
  readonly bindingDigest: Sha256Digest;
}

function field(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be blank`);
  }
}

export function assertExecutionProfileDefinitionInvariant(
  profile: ExecutionProfileDefinition,
): void {
  executionProfileId(profile.id);
  if (field(profile, 'schemaVersion') !== 1) {
    throw new TypeError('Execution Profile schema version is unsupported');
  }
  assertNonBlank(profile.version, 'Execution Profile version');
  assertNonBlank(profile.workerAdapter, 'Execution Profile Worker adapter');
  assertNonBlank(profile.workerAdapterVersion, 'Execution Profile Worker adapter version');
  assertNonBlank(profile.candidateSource, 'Execution Profile Candidate Source');
  assertNonBlank(profile.candidateSourceVersion, 'Execution Profile Candidate Source version');
  assertNonBlank(profile.verificationRunner, 'Execution Profile Verification Runner');
  assertNonBlank(
    profile.verificationRunnerVersion,
    'Execution Profile Verification Runner version',
  );
  assertNonBlank(profile.driverVersion, 'Execution Profile driver version');
}

export function assertExecutionProfileInvariant(profile: ExecutionProfile): void {
  assertExecutionProfileDefinitionInvariant(profile);
  sha256Digest(profile.digest);
}

export function executionProfileProjection(profile: ExecutionProfileDefinition): unknown {
  return {
    id: profile.id,
    schemaVersion: profile.schemaVersion,
    version: profile.version,
    workerAdapter: profile.workerAdapter,
    workerAdapterVersion: profile.workerAdapterVersion,
    candidateSource: profile.candidateSource,
    candidateSourceVersion: profile.candidateSourceVersion,
    verificationRunner: profile.verificationRunner,
    verificationRunnerVersion: profile.verificationRunnerVersion,
    driverVersion: profile.driverVersion,
  };
}

export function assertExecutionProfileBindingInvariant(binding: ExecutionProfileBinding): void {
  if (field(binding, 'schemaVersion') !== 1) {
    throw new TypeError('Execution Profile binding schema version is unsupported');
  }
  goalId(binding.goalId);
  workflowId(binding.workflowId);
  executionProfileId(binding.profileId);
  assertNonBlank(binding.profileVersion, 'Execution Profile binding version');
  sha256Digest(binding.profileDigest);
  commandId(binding.startCommandId);
  isoTimestamp(binding.boundAt);
  sha256Digest(binding.bindingDigest);
}

export function executionProfileBindingProjection(
  binding: Omit<ExecutionProfileBinding, 'bindingDigest'>,
): unknown {
  return {
    schemaVersion: binding.schemaVersion,
    goalId: binding.goalId,
    workflowId: binding.workflowId,
    profileId: binding.profileId,
    profileVersion: binding.profileVersion,
    profileDigest: binding.profileDigest,
    startCommandId: binding.startCommandId,
    boundAt: binding.boundAt,
  };
}
