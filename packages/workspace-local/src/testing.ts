import {
  DEFAULT_CANDIDATE_WORKSPACE_BOUNDS,
  type LocalCandidateWorkspace,
  type LocalCandidateWorkspaceOptions,
  type LocalProjectReadWorkspace,
  type LocalProjectReadWorkspaceOptions,
} from './contracts.js';
import { captureProjectReadSourceSnapshotFromRoot } from './git-source.js';
import {
  createLocalCandidateWorkspaceInternal,
  type CandidateWorkspaceFaultHooks,
} from './local-candidate-workspace.js';
import { assertPortablePathSet } from './manifests.js';
import {
  createLocalProjectReadWorkspaceInternal,
  type ProjectReadWorkspaceFaultHooks,
} from './local-project-read-workspace.js';

export type { CandidateWorkspaceFaultHooks } from './local-candidate-workspace.js';
export type { ProjectReadWorkspaceFaultHooks } from './local-project-read-workspace.js';

export function createLocalCandidateWorkspaceForTesting(
  options: LocalCandidateWorkspaceOptions,
  hooks: CandidateWorkspaceFaultHooks,
): LocalCandidateWorkspace {
  return createLocalCandidateWorkspaceInternal(options, hooks);
}

export function assertPortableCandidatePathSetForTesting(paths: readonly string[]): void {
  assertPortablePathSet(paths, 4_096);
}

export function createLocalProjectReadWorkspaceForTesting(
  options: LocalProjectReadWorkspaceOptions,
  hooks: ProjectReadWorkspaceFaultHooks,
): LocalProjectReadWorkspace {
  return createLocalProjectReadWorkspaceInternal(options, hooks);
}

export function captureProjectReadSourceSnapshotForTesting(
  projectPath: string,
): ReturnType<typeof captureProjectReadSourceSnapshotFromRoot> {
  return captureProjectReadSourceSnapshotFromRoot(projectPath, DEFAULT_CANDIDATE_WORKSPACE_BOUNDS);
}
