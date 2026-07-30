import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canonicalizeJsonText,
  compareGeneratedManifests,
  generatedDirectoryManifest,
  parseJsonRejectingDuplicateKeys,
  validateCandidateWorkspaceLeaseRoot,
} from './m2-slice0-probe-lib.mjs';

test('M2-S0-P01 duplicate-key scanner rejects direct, nested, and escaped duplicates', () => {
  assert.throws(() => parseJsonRejectingDuplicateKeys('{"a":1,"a":2}'), /duplicate/u);
  assert.throws(() => parseJsonRejectingDuplicateKeys('{"outer":{"a":1,"a":2}}'), /duplicate/u);
  assert.throws(() => parseJsonRejectingDuplicateKeys('{"a":1,"\\u0061":2}'), /duplicate/u);
  assert.deepEqual(parseJsonRejectingDuplicateKeys('{"a":[1,true,null]}'), {
    a: [1, true, null],
  });
});

test('M2-S0-P02 RFC 8785 profile ignores object member order but preserves array order', () => {
  assert.equal(canonicalizeJsonText('{"b":2,"a":1}'), '{"a":1,"b":2}');
  assert.equal(canonicalizeJsonText('{"a":1,"b":2}'), '{"a":1,"b":2}');
  assert.notEqual(canonicalizeJsonText('[1,2]'), canonicalizeJsonText('[2,1]'));
  assert.throws(() => canonicalizeJsonText('{"x":"\\ud800"}'), /surrogate/u);
});

test('M2-S0-P03 generated JSON manifests separate raw ordering from semantic drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m2-schema-test-'));
  try {
    const left = join(root, 'left');
    const right = join(root, 'right');
    mkdirSync(left);
    mkdirSync(right);
    writeFileSync(join(left, 'schema.json'), '{"b":2,"a":1}\n');
    writeFileSync(join(right, 'schema.json'), '{"a":1,"b":2}\n');
    const comparison = compareGeneratedManifests(
      generatedDirectoryManifest(left, 'RFC8785_JSON'),
      generatedDirectoryManifest(right, 'RFC8785_JSON'),
    );
    assert.equal(comparison.equal, true);
    assert.deepEqual(comparison.rawDifferences, ['schema.json']);

    writeFileSync(join(right, 'schema.json'), '{"a":1,"b":3}\n');
    const drift = compareGeneratedManifests(
      generatedDirectoryManifest(left, 'RFC8785_JSON'),
      generatedDirectoryManifest(right, 'RFC8785_JSON'),
    );
    assert.equal(drift.equal, false);
    assert.deepEqual(drift.semanticDifferences, ['schema.json']);

    writeFileSync(join(right, 'schema.json'), Buffer.from([0xff]));
    assert.throws(() => generatedDirectoryManifest(right, 'RFC8785_JSON'), /not valid UTF-8/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('M2-S0-P04 Candidate lease resolution rejects source, authority, siblings, and aliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m2-lease-test-'));
  try {
    const owned = join(root, 'workspaces');
    const generationOne = join(owned, 'generation-1');
    const generationTwo = join(owned, 'generation-2');
    const source = join(root, 'source');
    const authority = join(root, 'authority');
    mkdirSync(generationOne, { recursive: true });
    mkdirSync(generationTwo);
    mkdirSync(source);
    mkdirSync(authority);
    const alias = join(root, 'generation-alias');
    symlinkSync(generationOne, alias);
    const nestedParent = join(owned, 'nested');
    const nestedGeneration = join(nestedParent, 'generation-3');
    mkdirSync(nestedGeneration, { recursive: true });
    const aliasedParent = join(owned, 'aliased-parent');
    symlinkSync(nestedParent, aliasedParent);

    assert.equal(
      validateCandidateWorkspaceLeaseRoot({
        ownedRoot: owned,
        registeredRoot: generationOne,
        requestedRoot: generationOne,
        forbiddenRoots: [source, authority],
      }).candidateRoot,
      realpathSync(generationOne),
    );
    for (const requestedRoot of [source, authority, generationTwo, alias]) {
      assert.throws(
        () =>
          validateCandidateWorkspaceLeaseRoot({
            ownedRoot: owned,
            registeredRoot: generationOne,
            requestedRoot,
            forbiddenRoots: [source, authority],
          }),
        /outside|does not equal|link|intersects/u,
      );
    }
    assert.throws(
      () =>
        validateCandidateWorkspaceLeaseRoot({
          ownedRoot: owned,
          registeredRoot: join(aliasedParent, 'generation-3'),
          requestedRoot: join(aliasedParent, 'generation-3'),
          forbiddenRoots: [source, authority],
        }),
      /symbolic-link component/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
