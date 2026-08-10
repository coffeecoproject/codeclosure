import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Digest } from '@codeclosure/domain';
import {
  CandidateChangeKind,
  MAXIMUM_CANDIDATE_CHANGE_ENTRIES_V2,
  candidateChangesStayWithinAllowedPaths,
  createCandidateChangeSetV2,
  decodeCandidateChangeEntries,
  decodeCandidateChangeSetV2,
  type CandidateChangeEntry,
} from '@codeclosure/runtime';

function digest(character: string) {
  return sha256Digest(`sha256:${character.repeat(64)}`);
}

function identity(character: string, byteLength: number) {
  return Object.freeze({
    byteLength,
    contentDigest: digest(character),
    mode: 'REGULAR' as const,
  });
}

const changes = Object.freeze([
  Object.freeze({
    after: identity('b', 2),
    before: null,
    kind: CandidateChangeKind.ADDED,
    path: 'src/added.ts',
  }),
  Object.freeze({
    after: null,
    before: identity('c', 3),
    kind: CandidateChangeKind.DELETED,
    path: 'src/deleted.ts',
  }),
  Object.freeze({
    after: identity('e', 5),
    before: identity('d', 4),
    kind: CandidateChangeKind.MODIFIED,
    path: 'src/modified.ts',
  }),
] satisfies readonly CandidateChangeEntry[]);

function changeAt(index: number): CandidateChangeEntry {
  const change = changes[index];
  assert.ok(change !== undefined);
  return change;
}

void test('[I-014][M251-C11] Candidate change-set v2 has one canonical digest', () => {
  const created = createCandidateChangeSetV2({
    baseSourceDigest: digest('a'),
    changes,
    frozenSourceDigest: digest('f'),
  });
  assert.deepEqual(decodeCandidateChangeSetV2(created), created);
  assert.throws(
    () => decodeCandidateChangeSetV2({ ...created, changeSetDigest: digest('0') }),
    /digest is inconsistent/,
  );
});

void test('[I-014][I-027][M251-C11] Candidate changes are uniquely path-sorted', () => {
  assert.throws(() => decodeCandidateChangeEntries([...changes].reverse()), /path-sorted/);
  const added = changeAt(0);
  const deleted = changeAt(1);
  assert.throws(() => decodeCandidateChangeEntries([added, added]), /path-sorted/);
  assert.throws(() =>
    decodeCandidateChangeEntries(
      Array.from({ length: MAXIMUM_CANDIDATE_CHANGE_ENTRIES_V2 + 1 }, () => added),
    ),
  );
  assert.throws(
    () =>
      decodeCandidateChangeEntries([
        Object.freeze({ ...added, path: 'src/A.ts' }),
        Object.freeze({ ...deleted, path: 'src/a.ts' }),
      ]),
    /path alias/,
  );
});

void test('[I-014][I-027][M251-C11] Candidate change kind owns exact before/after shape', () => {
  const added = changes[0];
  assert.ok(added !== undefined);
  assert.throws(
    () =>
      decodeCandidateChangeEntries([
        { ...added, before: identity('1', 1), kind: CandidateChangeKind.ADDED },
      ]),
    /does not match its kind/,
  );
  const modified = changeAt(2);
  assert.ok(modified.before !== null);
  assert.throws(
    () =>
      decodeCandidateChangeEntries([
        { ...modified, after: modified.before, before: modified.before },
      ]),
    /does not match its kind/,
  );
});

void test('[I-014][I-023][M251-C11] allowed paths use exact component containment', () => {
  const added = changeAt(0);
  const modified = changeAt(2);
  assert.equal(candidateChangesStayWithinAllowedPaths(changes, ['src']), true);
  assert.equal(candidateChangesStayWithinAllowedPaths([modified], ['src/modified.ts']), true);
  assert.equal(candidateChangesStayWithinAllowedPaths(changes, ['src/modified.ts']), false);
  assert.equal(
    candidateChangesStayWithinAllowedPaths(
      [Object.freeze({ ...added, path: 'src-other/added.ts' })],
      ['src'],
    ),
    false,
  );
  assert.equal(candidateChangesStayWithinAllowedPaths([], ['src']), true);
});
