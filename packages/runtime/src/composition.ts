/**
 * Trusted Runtime composition capabilities.
 *
 * Public adapters receive the narrow CodeClosureApplication facade from the
 * package root. Only a trusted composition root may construct recovery and
 * workflow-driver coordinators from raw control ports.
 */
export { createRecoveryCoordinator } from './recovery.js';
export type { RecoveryCoordinatorDependencies } from './recovery.js';
export { createWorkflowDriver } from './workflow-driver.js';
export type {
  RuntimeExecutionProfile,
  RuntimeExecutionProfileResolver,
  WorkflowDriverDependencies,
  WorkflowDriverIdentityGenerator,
} from './workflow-driver.js';
export { CryptographicIdentityGenerator, SystemUtcClock } from './production-adapters.js';
