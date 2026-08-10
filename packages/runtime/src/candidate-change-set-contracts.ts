import { z } from 'zod';

import { sha256Digest, type Sha256Digest } from '@codeclosure/domain';

import {
  decodeCandidateWorkspaceAllowedPaths,
  decodeCandidateWorkspaceRelativePath,
  digestCandidateWorkspaceValue,
} from './candidate-workspace-contracts.js';

export const CandidateChangeKind = {
  ADDED: 'ADDED',
  DELETED: 'DELETED',
  MODIFIED: 'MODIFIED',
} as const;
export type CandidateChangeKind = (typeof CandidateChangeKind)[keyof typeof CandidateChangeKind];

export const CandidateChangeFileMode = {
  EXECUTABLE: 'EXECUTABLE',
  REGULAR: 'REGULAR',
} as const;
export type CandidateChangeFileMode =
  (typeof CandidateChangeFileMode)[keyof typeof CandidateChangeFileMode];

export interface CandidateChangeFileIdentity {
  readonly byteLength: number;
  readonly contentDigest: Sha256Digest;
  readonly mode: CandidateChangeFileMode;
}

export interface CandidateChangeEntry {
  readonly after: CandidateChangeFileIdentity | null;
  readonly before: CandidateChangeFileIdentity | null;
  readonly kind: CandidateChangeKind;
  readonly path: string;
}

export interface CandidateChangeSetV2 {
  readonly baseSourceDigest: Sha256Digest;
  readonly changes: readonly CandidateChangeEntry[];
  readonly changeSetDigest: Sha256Digest;
  readonly frozenSourceDigest: Sha256Digest;
  readonly profile: 'candidate-change-set-v2';
  readonly schemaVersion: 2;
}

export const MAXIMUM_CANDIDATE_CHANGE_ENTRIES_V2 = 8_192;

const fileIdentitySchema = z
  .object({
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    contentDigest: z.string(),
    mode: z.enum([CandidateChangeFileMode.EXECUTABLE, CandidateChangeFileMode.REGULAR]),
  })
  .strict();

const changeEntrySchema = z
  .object({
    after: fileIdentitySchema.nullable(),
    before: fileIdentitySchema.nullable(),
    kind: z.enum([
      CandidateChangeKind.ADDED,
      CandidateChangeKind.DELETED,
      CandidateChangeKind.MODIFIED,
    ]),
    path: z.string(),
  })
  .strict();

function decodeFileIdentity(
  value: z.infer<typeof fileIdentitySchema>,
): CandidateChangeFileIdentity {
  return Object.freeze({
    byteLength: value.byteLength,
    contentDigest: sha256Digest(value.contentDigest),
    mode: value.mode,
  });
}

function sameFileIdentity(
  left: CandidateChangeFileIdentity,
  right: CandidateChangeFileIdentity,
): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.contentDigest === right.contentDigest &&
    left.mode === right.mode
  );
}

export function decodeCandidateChangeEntries(value: unknown): readonly CandidateChangeEntry[] {
  const parsed = z.array(changeEntrySchema).max(MAXIMUM_CANDIDATE_CHANGE_ENTRIES_V2).parse(value);
  const changes = parsed.map((entry) => {
    const before = entry.before === null ? null : decodeFileIdentity(entry.before);
    const after = entry.after === null ? null : decodeFileIdentity(entry.after);
    if (
      (entry.kind === CandidateChangeKind.ADDED && (before !== null || after === null)) ||
      (entry.kind === CandidateChangeKind.DELETED && (before === null || after !== null)) ||
      (entry.kind === CandidateChangeKind.MODIFIED &&
        (before === null || after === null || sameFileIdentity(before, after)))
    ) {
      throw new TypeError('Candidate change entry does not match its kind');
    }
    const path = decodeCandidateWorkspaceRelativePath(entry.path, 'Candidate change path');
    return Object.freeze({
      after,
      before,
      kind: entry.kind,
      path,
    });
  });
  const paths = changes.map((entry) => entry.path);
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify([...paths].sort())
  ) {
    throw new TypeError('Candidate change entries must be uniquely path-sorted');
  }
  const aliases = new Map<string, string>();
  for (const path of paths) {
    const components = path.split('/');
    for (let length = 1; length <= components.length; length += 1) {
      const prefix = components.slice(0, length).join('/');
      const alias = prefix.normalize('NFC').toLocaleLowerCase('en-US');
      const previous = aliases.get(alias);
      if (previous !== undefined && previous !== prefix) {
        throw new TypeError('Candidate change entries contain a path alias');
      }
      aliases.set(alias, prefix);
    }
  }
  return Object.freeze(changes);
}

export function candidateChangeSetV2Projection(input: {
  readonly baseSourceDigest: Sha256Digest;
  readonly changes: readonly CandidateChangeEntry[];
  readonly frozenSourceDigest: Sha256Digest;
}): unknown {
  return {
    baseSourceDigest: input.baseSourceDigest,
    changes: input.changes,
    frozenSourceDigest: input.frozenSourceDigest,
    profile: 'candidate-change-set-v2',
    schemaVersion: 2,
  };
}

export function createCandidateChangeSetV2(input: {
  readonly baseSourceDigest: Sha256Digest;
  readonly changes: readonly CandidateChangeEntry[];
  readonly frozenSourceDigest: Sha256Digest;
}): CandidateChangeSetV2 {
  const changes = decodeCandidateChangeEntries(input.changes);
  const baseSourceDigest = sha256Digest(input.baseSourceDigest);
  const frozenSourceDigest = sha256Digest(input.frozenSourceDigest);
  const semantic = Object.freeze({ baseSourceDigest, changes, frozenSourceDigest });
  return Object.freeze({
    ...semantic,
    changeSetDigest: digestCandidateWorkspaceValue(candidateChangeSetV2Projection(semantic)),
    profile: 'candidate-change-set-v2',
    schemaVersion: 2,
  });
}

export function decodeCandidateChangeSetV2(value: unknown): CandidateChangeSetV2 {
  const parsed = z
    .object({
      baseSourceDigest: z.string(),
      changes: z.array(changeEntrySchema).max(MAXIMUM_CANDIDATE_CHANGE_ENTRIES_V2),
      changeSetDigest: z.string(),
      frozenSourceDigest: z.string(),
      profile: z.literal('candidate-change-set-v2'),
      schemaVersion: z.literal(2),
    })
    .strict()
    .parse(value);
  const changes = decodeCandidateChangeEntries(parsed.changes);
  const created = createCandidateChangeSetV2({
    baseSourceDigest: sha256Digest(parsed.baseSourceDigest),
    changes,
    frozenSourceDigest: sha256Digest(parsed.frozenSourceDigest),
  });
  if (created.changeSetDigest !== sha256Digest(parsed.changeSetDigest)) {
    throw new TypeError('Candidate change-set digest is inconsistent');
  }
  return created;
}

export function candidateChangesStayWithinAllowedPaths(
  changes: readonly CandidateChangeEntry[],
  allowedPaths: readonly string[],
): boolean {
  const decodedChanges = decodeCandidateChangeEntries(changes);
  const decodedAllowedPaths = decodeCandidateWorkspaceAllowedPaths(allowedPaths);
  return decodedChanges.every((change) =>
    decodedAllowedPaths.some(
      (allowedPath) => change.path === allowedPath || change.path.startsWith(`${allowedPath}/`),
    ),
  );
}
