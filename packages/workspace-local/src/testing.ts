import type { LocalCandidateWorkspace, LocalCandidateWorkspaceOptions } from './contracts.js';
import {
  createLocalCandidateWorkspaceInternal,
  type CandidateWorkspaceFaultHooks,
} from './local-candidate-workspace.js';
import { assertPortablePathSet } from './manifests.js';

export type { CandidateWorkspaceFaultHooks } from './local-candidate-workspace.js';

export function createLocalCandidateWorkspaceForTesting(
  options: LocalCandidateWorkspaceOptions,
  hooks: CandidateWorkspaceFaultHooks,
): LocalCandidateWorkspace {
  return createLocalCandidateWorkspaceInternal(options, hooks);
}

export function assertPortableCandidatePathSetForTesting(paths: readonly string[]): void {
  assertPortablePathSet(paths, 4_096);
}
