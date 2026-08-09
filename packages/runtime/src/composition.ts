/**
 * Trusted Runtime composition capabilities.
 *
 * Public adapters receive the narrow CodeClosureApplication facade from the
 * package root. Only a trusted composition root may construct recovery and
 * workflow-driver coordinators from raw control ports.
 */
export { createRecoveryCoordinator } from './recovery.js';
export type { RecoveryCoordinatorDependencies } from './recovery.js';
export {
  createM2WorkflowDriver,
  createProtectedM2WorkflowDriver,
  createWorkflowDriver,
} from './workflow-driver.js';
export type {
  RuntimeExecutionProfile,
  RuntimeExecutionProfileResolver,
  WorkflowDriverDependencies,
  WorkflowDriverCapability,
  WorkflowDriverIdentityGenerator,
} from './workflow-driver.js';
export { CryptographicIdentityGenerator, SystemUtcClock } from './production-adapters.js';
export { createM1DeterministicPhaseGuardEvaluator } from './m1-phase-guards.js';
export { createCandidateLeasedWorker } from './candidate-leased-worker.js';
export type {
  CandidateLeasedWorkerAuthorityReader,
  CandidateLeasedWorkerDependencies,
  CandidateLeasedWorkerFactory,
} from './candidate-leased-worker.js';
export { createProjectReadSnapshotCleanupCoordinator } from './project-read-cleanup-coordinator.js';
export type {
  ProjectReadCleanupIdentityGenerator,
  ProjectReadSnapshotCleanupCoordinatorDependencies,
} from './project-read-cleanup-coordinator.js';
