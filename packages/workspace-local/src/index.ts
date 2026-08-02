export {
  DEFAULT_CANDIDATE_WORKSPACE_BOUNDS,
  LocalCandidateWorkspaceError,
  LocalCandidateWorkspaceFailureCode,
  WorkspaceReconciliationClassification,
  type CandidateWorkspaceBounds,
  type CandidateWorkspaceCleanupResult,
  type CandidateWorkspaceReconciliationEntry,
  type LocalCandidateSourceIdentity,
  type LocalCandidateWorkspace,
  type LocalCandidateWorkspaceOptions,
} from './contracts.js';
export { createLocalCandidateWorkspace } from './local-candidate-workspace.js';
export { observeLocalCandidateSourceIdentity } from './git-source.js';
