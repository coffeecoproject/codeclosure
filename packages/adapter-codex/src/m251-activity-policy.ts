import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { JsonObject, JsonValue } from '@codeclosure/codex-app-server-client';

import type { CodexItemRejectionCode } from './contracts.js';
import {
  CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
  CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
  type CodexWorkerDirectiveV3,
  type CodexWorkerSourceAuthorityV1,
} from './m251-contracts.js';

export interface CodexWorkerActivityPolicyV1 {
  readonly schemaVersion: 1;
  readonly id: typeof CODEX_M251_WORKER_ACTIVITY_POLICY_ID;
  readonly digest: typeof CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST;
  readonly phase: 'DISCOVERY' | 'IMPLEMENT' | 'PLAN';
  readonly cwd: string;
  readonly forbiddenRoots: readonly string[];
  readonly candidateAllowedPaths: readonly string[];
}

export type CodexWorkerActivityEvaluation =
  | Readonly<{ readonly disposition: 'ADMITTED' }>
  | Readonly<{
      readonly disposition: 'REJECTED_DISCARDED';
      readonly rejectionCode: CodexItemRejectionCode;
    }>;

function isSameOrWithin(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function sourceCwd(source: CodexWorkerSourceAuthorityV1): string {
  return source.kind === 'PROJECT_READ'
    ? source.authorityRecord.snapshotLeafRealpath
    : source.workspaceLease.root;
}

export function codexWorkerActivityPolicyV1(
  directive: CodexWorkerDirectiveV3,
): CodexWorkerActivityPolicyV1 {
  const source = directive.sourceAuthority;
  const forbiddenRoots = Object.freeze(
    [
      ...directive.profile.phase.forbiddenRoots,
      ...(source.kind === 'CANDIDATE'
        ? source.workspaceLease.forbiddenRoots
        : source.authorityRecord.forbiddenRoots),
    ]
      .filter((root, index, roots) => roots.indexOf(root) === index)
      .sort(),
  );
  return Object.freeze({
    schemaVersion: 1,
    id: CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
    digest: CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
    phase: directive.request.phase,
    cwd: sourceCwd(source),
    forbiddenRoots,
    candidateAllowedPaths:
      source.kind === 'CANDIDATE' ? source.workspaceLease.allowedPaths : Object.freeze([]),
  });
}

function rejection(rejectionCode: CodexItemRejectionCode): CodexWorkerActivityEvaluation {
  return Object.freeze({ disposition: 'REJECTED_DISCARDED', rejectionCode });
}

function optionalActionPath(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function admittedPath(path: string, policy: CodexWorkerActivityPolicyV1): boolean {
  const absolute = isAbsolute(path) ? path : resolve(policy.cwd, path);
  return (
    isSameOrWithin(absolute, policy.cwd) &&
    policy.forbiddenRoots.every((root) => !isSameOrWithin(absolute, root))
  );
}

function commandActivity(
  item: JsonObject,
  policy: CodexWorkerActivityPolicyV1,
): CodexWorkerActivityEvaluation {
  if (item['cwd'] !== policy.cwd) {
    return rejection('COMMAND_CWD');
  }
  const actions = item['commandActions'];
  if (!Array.isArray(actions) || actions.length === 0) {
    return rejection('COMMAND_ACTIONS');
  }
  for (const value of actions) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return rejection('COMMAND_ACTIONS');
    }
    const action = value as JsonObject;
    if (action['type'] === 'unknown') {
      return rejection('COMMAND_ACTIONS');
    }
    if (
      action['type'] !== 'read' &&
      action['type'] !== 'listFiles' &&
      action['type'] !== 'search'
    ) {
      return rejection('COMMAND_ACTIONS');
    }
    const path = optionalActionPath(action['path']);
    if (path !== undefined && !admittedPath(path, policy)) {
      return rejection('COMMAND_ACTIONS');
    }
  }
  return Object.freeze({ disposition: 'ADMITTED' });
}

function candidateFilePathAllowed(path: string, policy: CodexWorkerActivityPolicyV1): boolean {
  const absolute = isAbsolute(path) ? path : resolve(policy.cwd, path);
  if (!admittedPath(absolute, policy)) {
    return false;
  }
  return policy.candidateAllowedPaths.some((allowedPath) =>
    isSameOrWithin(absolute, resolve(policy.cwd, allowedPath)),
  );
}

function fileChangeActivity(
  item: JsonObject,
  policy: CodexWorkerActivityPolicyV1,
): CodexWorkerActivityEvaluation {
  if (policy.phase !== 'IMPLEMENT') {
    return rejection('UNSELECTED_ITEM_TYPE');
  }
  const changes = item['changes'];
  if (!Array.isArray(changes) || changes.length === 0) {
    return rejection('ITEM_SCHEMA');
  }
  for (const value of changes) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return rejection('ITEM_SCHEMA');
    }
    const change = value as JsonObject;
    if (typeof change['path'] !== 'string' || !candidateFilePathAllowed(change['path'], policy)) {
      return rejection('ITEM_SCHEMA');
    }
    const kind = change['kind'];
    if (
      typeof kind === 'object' &&
      kind !== null &&
      !Array.isArray(kind) &&
      typeof (kind as JsonObject)['move_path'] === 'string' &&
      !candidateFilePathAllowed((kind as JsonObject)['move_path'] as string, policy)
    ) {
      return rejection('ITEM_SCHEMA');
    }
  }
  return Object.freeze({ disposition: 'ADMITTED' });
}

export function evaluateCodexWorkerActivityV1(
  item: JsonObject,
  policy: CodexWorkerActivityPolicyV1,
): CodexWorkerActivityEvaluation {
  if (item['type'] === 'commandExecution') {
    return commandActivity(item, policy);
  }
  if (item['type'] === 'fileChange') {
    return fileChangeActivity(item, policy);
  }
  return Object.freeze({ disposition: 'ADMITTED' });
}
