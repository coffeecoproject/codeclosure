import { executionProfileId, type ExecutionProfileDefinition } from '@codeclosure/domain';

export function testExecutionProfileDefinition(namespace: string): ExecutionProfileDefinition {
  const profileNamespace = namespace.toLowerCase().replaceAll('_', '-');
  return Object.freeze({
    id: executionProfileId(`profile_${profileNamespace}`),
    schemaVersion: 1,
    version: 'test-profile-v1',
    workerAdapter: 'fake-worker',
    workerAdapterVersion: 'v1',
    candidateSource: 'fake-candidate-source',
    candidateSourceVersion: 'v1',
    verificationRunner: 'fake-verification-runner',
    verificationRunnerVersion: 'v1',
    driverVersion: 'test-driver-v1',
  });
}
