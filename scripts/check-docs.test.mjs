import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

import { checkDocumentation } from './check-docs-lib.mjs';

function createFixture(t, files = {}) {
  const repositoryRoot = mkdtempSync(resolve(tmpdir(), 'codeclosure-docs-check-'));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));

  const fixtureFiles = {
    'README.md': `# Fixture

## Status

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md) and
[milestones](docs/milestones.md).

## Development
`,
    'docs/milestones.md': '# Milestones\n',
    'docs/plans/m2.6-unified-frontstage-interaction.md': '# M2.6 Frontstage plan\n',
    ...files,
  };

  for (const [relativePath, contents] of Object.entries(fixtureFiles)) {
    const filePath = resolve(repositoryRoot, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }

  return repositoryRoot;
}

function errorText(repositoryRoot) {
  return checkDocumentation({ repositoryRoot }).errors.join('\n');
}

test('accepts structural GFM links, GitHub anchors, and ignored code examples', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

See the [M2.6 plan][plan] and [milestones](docs/milestones.md).

## Development

[same heading](#development)
[first duplicate](docs/guide_(copy).md#repeated-heading)
[second duplicate](docs/guide_(copy).md#repeated-heading-1)

\`\`\`md
[example only](docs/does-not-exist.md)
Slice 99 is example text only.
\`\`\`

[plan]: docs/plans/m2.6-unified-frontstage-interaction.md
`,
    'docs/guide_(copy).md': `# Repeated heading

## Repeated heading
`,
  });

  assert.deepEqual(checkDocumentation({ repositoryRoot }).errors, []);
});

test('accepts repository-root-relative authority links', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

See the [M2.6 plan](/docs/plans/m2.6-unified-frontstage-interaction.md) and
[milestones](/docs/milestones.md).
`,
  });

  assert.deepEqual(checkDocumentation({ repositoryRoot }).errors, []);
});

test('accepts protocol-relative and multi-character ASCII-scheme external links', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/guide.md': `[https](https://example.com/guide)
[mailto](mailto:docs@example.com)
[protocol relative](//example.com/guide)
`,
  });

  assert.deepEqual(checkDocumentation({ repositoryRoot }).errors, []);
});

for (const [description, localUrl] of [
  ['forward-slash absolute drive', 'C:/workspace/guide.md'],
  ['backslash absolute drive', 'C:\\workspace\\guide.md'],
  ['drive-relative path', 'C:workspace/guide.md'],
  ['bare drive designator', 'd:'],
]) {
  test(`rejects a ${description} before general URI-scheme classification`, (t) => {
    const repositoryRoot = createFixture(t, {
      'docs/broken.md': `[drive path](${localUrl})\n`,
    });

    assert.match(errorText(repositoryRoot), /uses an ambiguous Windows drive path/u);
  });
}

test('does not treat a Unicode case-fold lookalike as an ASCII URI scheme', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[lookalike](K:guide.md)\n',
  });

  assert.match(errorText(repositoryRoot), /uses a non-portable repository path segment/u);
});

test('accepts standard dot-segment operands and a trailing slash for a directory', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/guide.md': `[normalized](placeholder/../milestones.md)
[directory](plans/)
`,
  });

  assert.deepEqual(checkDocumentation({ repositoryRoot }).errors, []);
});

test('accepts terminal literal dot segments when they resolve to directories', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/guide.md': `[current directory](plans/.)
[parent directory](plans/..)
`,
  });

  assert.deepEqual(checkDocumentation({ repositoryRoot }).errors, []);
});

test('requires terminal literal dot segments to resolve to directories', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': `[single dot](milestones.md/.)
[single dot before query](milestones.md/.?plain=1)
[double dot](file-target/child/..)
`,
    'docs/file-target': 'This is a file, not a directory.\n',
  });

  const errors = errorText(repositoryRoot);
  assert.match(errors, /uses directory URL syntax for a non-directory path: milestones\.md\/\./u);
  assert.match(
    errors,
    /uses directory URL syntax for a non-directory path: milestones\.md\/\.\?plain=1/u,
  );
  assert.match(
    errors,
    /uses directory URL syntax for a non-directory path: file-target\/child\/\.\./u,
  );
});

test('accepts percent encoding that remains inside one portable path segment', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/encoded link.md': '# Encoded heading\n',
    'docs/guide.md': '[encoded](encoded%20link.md#encoded-heading)\n',
  });

  assert.deepEqual(checkDocumentation({ repositoryRoot }).errors, []);
});

test('rejects a missing local path', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[missing](does-not-exist.md)\n',
  });

  assert.match(errorText(repositoryRoot), /links to missing path: does-not-exist\.md/u);
});

test('checks Markdown files inside repository-owned dot directories', (t) => {
  const repositoryRoot = createFixture(t, {
    '.github/broken.md': '[missing](does-not-exist.md)\n',
  });

  assert.match(
    errorText(repositoryRoot),
    /\.github\/broken\.md:1 links to missing path: does-not-exist\.md/u,
  );
});

test('ignores exactly the four documented Markdown discovery directories at any depth', (t) => {
  const repositoryRoot = createFixture(t, {
    '.git/broken.md': '[missing](does-not-exist.md)\n',
    'coverage/broken.MD': '[missing](does-not-exist.md)\n',
    'docs/generated/dist/broken.md': '[missing](does-not-exist.md)\n',
    'docs/vendor/node_modules/broken.md': '[missing](does-not-exist.md)\n',
  });

  const result = checkDocumentation({ repositoryRoot });
  assert.deepEqual(result.errors, []);
  assert.equal(result.markdownFileCount, 3);
});

test('does not broaden Markdown discovery exclusions by case, prefix, or suffix', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/.git-notes/broken.md': '[missing](does-not-exist.md)\n',
    'docs/Coverage/broken.md': '[missing](does-not-exist.md)\n',
    'docs/distribution/broken.md': '[missing](does-not-exist.md)\n',
    'docs/node_modules-copy/broken.md': '[missing](does-not-exist.md)\n',
  });

  const errors = errorText(repositoryRoot);
  for (const repositoryPath of [
    'docs/.git-notes/broken.md',
    'docs/Coverage/broken.md',
    'docs/distribution/broken.md',
    'docs/node_modules-copy/broken.md',
  ]) {
    assert.ok(
      errors.includes(`${repositoryPath}:1 links to missing path: does-not-exist.md`),
      `expected ${repositoryPath} to remain inside Markdown discovery`,
    );
  }
});

test('checks Markdown extension casing without silently excluding the file', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/BROKEN.MD': '[missing](does-not-exist.md)\n',
  });

  assert.match(
    errorText(repositoryRoot),
    /docs\/BROKEN\.MD:1 links to missing path: does-not-exist\.md/u,
  );
});

test(
  'rejects non-portable paths on discovered Markdown sources',
  { skip: process.platform === 'win32' },
  (t) => {
    const repositoryRoot = createFixture(t, {
      'docs/COM¹.md': '# Reserved source name\n',
      'docs/AUX/guide.MD': '# Reserved source directory\n',
      'docs/bad\\name.md': '# Backslash in a repository segment\n',
    });

    const errors = errorText(repositoryRoot);
    assert.match(
      errors,
      /docs\/COM¹\.md is a Markdown source with a non-portable repository path segment/u,
    );
    assert.match(
      errors,
      /docs\/AUX\/guide\.MD is a Markdown source with a non-portable repository path segment/u,
    );
    assert.ok(
      errors.includes(
        'docs/bad\\name.md is a Markdown source with a non-portable repository path segment',
      ),
    );
  },
);

test('rejects a Markdown-named symbolic link as an unsupported source', (t) => {
  const repositoryRoot = createFixture(t);
  symlinkSync('milestones.md', resolve(repositoryRoot, 'docs/milestones-alias.md'));

  assert.match(
    errorText(repositoryRoot),
    /docs\/milestones-alias\.md is a symbolic link; Markdown sources must be regular files/u,
  );
});

test('rejects a path that escapes the repository', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[outside](../../outside.md)\n',
  });

  assert.match(errorText(repositoryRoot), /links outside the repository: \.\.\/\.\.\/outside\.md/u);
});

test('rejects incorrect path casing independently of filesystem case sensitivity', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[wrong case](MILESTONES.md)\n',
  });

  assert.match(errorText(repositoryRoot), /uses incorrect path casing: MILESTONES\.md/u);
});

test('rejects a repository path whose symbolic-link target is outside the repository', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[outside](external-link#outside)\n',
  });
  const outsideRoot = mkdtempSync(resolve(tmpdir(), 'codeclosure-docs-outside-'));
  t.after(() => rmSync(outsideRoot, { force: true, recursive: true }));
  const outsideFile = resolve(outsideRoot, 'external.md');
  writeFileSync(outsideFile, '# Outside\n');
  symlinkSync(outsideFile, resolve(repositoryRoot, 'docs/external-link'));

  assert.match(
    errorText(repositoryRoot),
    /resolves outside the repository: external-link#outside/u,
  );
});

test('rejects a relative symbolic-link target that escapes the repository', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[outside](external-link)\n',
  });
  symlinkSync('../../outside.md', resolve(repositoryRoot, 'docs/external-link'));

  assert.match(
    errorText(repositoryRoot),
    /links through a path that resolves outside the repository: external-link/u,
  );
});

test('accepts an exact symbolic-link path whose target remains inside the repository', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/link.md': '[inside](milestones-link#milestones)\n',
  });
  symlinkSync('milestones.md', resolve(repositoryRoot, 'docs/milestones-link'));

  assert.deepEqual(checkDocumentation({ repositoryRoot }).errors, []);
});

test('rejects incorrect casing stored inside a symbolic-link target', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/link.md': '[inside](milestones-link#milestones)\n',
  });
  symlinkSync('MILESTONES.md', resolve(repositoryRoot, 'docs/milestones-link'));

  assert.match(
    errorText(repositoryRoot),
    /uses incorrect symbolic-link target casing: milestones-link#milestones/u,
  );
});

test('rejects an absolute symbolic-link target even when it currently remains inside', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/link.md': '[inside](milestones-link#milestones)\n',
  });
  symlinkSync(
    resolve(repositoryRoot, 'docs/milestones.md'),
    resolve(repositoryRoot, 'docs/milestones-link'),
  );

  assert.match(
    errorText(repositoryRoot),
    /links through a symbolic link with a non-portable target: milestones-link#milestones/u,
  );
});

test('rejects a non-portable symbolic-link segment before traversal could erase it', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/link.md': '[inside](milestones-link)\n',
  });
  symlinkSync('NUL/../milestones.md', resolve(repositoryRoot, 'docs/milestones-link'));

  assert.match(
    errorText(repositoryRoot),
    /links through a symbolic link with a non-portable target: milestones-link/u,
  );
});

for (const [description, storedTarget] of [
  ['backslash target', 'milestones\\bad'],
  ['repeated-separator target', 'plans//m2.6-unified-frontstage-interaction.md'],
  ['directory-suffixed file target', 'milestones.md/'],
]) {
  test(`rejects a symbolic link with a ${description}`, (t) => {
    const repositoryRoot = createFixture(t, {
      'docs/link.md': '[non-portable](milestones-link)\n',
    });
    symlinkSync(storedTarget, resolve(repositoryRoot, 'docs/milestones-link'));

    assert.match(
      errorText(repositoryRoot),
      /links through a symbolic link with a non-portable target: milestones-link/u,
    );
  });
}

test('rejects a symbolic-link cycle explicitly', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/link.md': '[cycle](cycle-a)\n',
  });
  symlinkSync('cycle-b', resolve(repositoryRoot, 'docs/cycle-a'));
  symlinkSync('cycle-a', resolve(repositoryRoot, 'docs/cycle-b'));

  assert.match(errorText(repositoryRoot), /links through a symbolic-link cycle: cycle-a/u);
});

test('rejects an excessive symbolic-link chain without unbounded recursion', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/link.md': '[chain](chain-0)\n',
  });

  for (let index = 0; index <= 40; index += 1) {
    const target = index === 40 ? 'milestones.md' : `chain-${index + 1}`;
    symlinkSync(target, resolve(repositoryRoot, `docs/chain-${index}`));
  }

  assert.match(errorText(repositoryRoot), /links through too many symbolic links: chain-0/u);
});

test('rejects missing same-file and cross-file heading anchors', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': `# Present

[same](#missing)
[cross](milestones.md#missing)
`,
  });

  const errors = errorText(repositoryRoot);
  assert.match(errors, /missing Markdown heading anchor "missing": #missing/u);
  assert.match(errors, /missing Markdown heading anchor "missing": milestones\.md#missing/u);
});

test('validates the destination of a reference-style link', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': `[missing][target]

[target]: does-not-exist.md
`,
  });

  assert.match(errorText(repositoryRoot), /links to missing path: does-not-exist\.md/u);
});

test('rejects raw HTML that bypasses the closed Markdown structure', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '<a href="milestones.md">Milestones</a>\n',
  });

  assert.match(
    errorText(repositoryRoot),
    /uses raw HTML; use GitHub Flavored Markdown syntax instead/u,
  );
});

test('rejects invalid percent encoding in a local link', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[invalid](guide%ZZ.md)\n',
  });

  assert.match(errorText(repositoryRoot), /invalid percent-encoded local link: guide%ZZ\.md/u);
});

test('rejects invalid percent encoding in a local-link fragment', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[invalid](milestones.md#%ZZ)\n',
  });

  assert.match(
    errorText(repositoryRoot),
    /invalid percent-encoded local link: milestones\.md#%ZZ/u,
  );
});

for (const [description, localUrl] of [
  ['literal backslash', 'milestones\\link.md'],
  ['percent-encoded backslash', 'milestones%5Clink.md'],
  ['percent-encoded forward slash', 'milestones%2Flink.md'],
  ['repeated forward slash', 'plans//m1.md'],
]) {
  test(`rejects a ${description} separator in a repository-local link`, (t) => {
    const repositoryRoot = createFixture(t, {
      'docs/broken.md': `[non-portable](${localUrl})\n`,
    });

    assert.match(
      errorText(repositoryRoot),
      /uses a non-portable or encoded path separator in a local link/u,
    );
  });
}

test('rejects an encoded dot segment instead of treating it as traversal syntax', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[ambiguous](plans/%2E%2E/milestones.md)\n',
  });

  assert.match(errorText(repositoryRoot), /uses an encoded dot segment in a local link/u);
});

test('rejects non-portable segments before a later dot segment can erase them', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': `[device](NUL/../milestones.md)
[wildcard](bad%2A/../milestones.md)
`,
  });

  const errors = errorText(repositoryRoot);
  assert.match(errors, /non-portable repository path segment: NUL\/\.\.\/milestones\.md/u);
  assert.match(errors, /non-portable repository path segment: bad%2A\/\.\.\/milestones\.md/u);
});

test('rejects directory URL syntax when the exact target is a file', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[file](milestones.md/)\n',
  });

  assert.match(errorText(repositoryRoot), /directory URL syntax for a non-directory path/u);
});

test('does not trim path-significant whitespace from an angle-bracket destination', (t) => {
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': '[space](<milestones.md >)\n',
  });

  assert.match(errorText(repositoryRoot), /uses a non-portable repository path segment/u);
});

for (const [description, localUrl] of [
  ['drive-like colon', 'docs/folder%3Aname.md'],
  ['Windows device name', 'docs/NUL.md'],
  ['trailing dot', 'docs/guide.'],
  ['encoded wildcard', 'docs/bad%2Aname.md'],
]) {
  test(`rejects the ${description} repository path segment`, (t) => {
    const repositoryRoot = createFixture(t, {
      'docs/broken.md': `[non-portable](${localUrl})\n`,
    });

    assert.match(errorText(repositoryRoot), /uses a non-portable repository path segment/u);
  });
}

test('rejects every Windows superscript device-name form before filesystem lookup', (t) => {
  const reservedNames = ['COM¹.md', 'com².txt', 'Com³', 'LPT¹.md', 'lpt².txt', 'LpT³'];
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': `${reservedNames
      .map((reservedName) => `[reserved](${reservedName})`)
      .join('\n')}\n`,
  });

  const errors = errorText(repositoryRoot);
  for (const reservedName of reservedNames) {
    assert.ok(
      errors.includes(`uses a non-portable repository path segment: ${reservedName}`),
      `expected ${reservedName} to be rejected as a non-portable repository path segment`,
    );
  }
});

test('rejects Windows console DOS device names before filesystem lookup', (t) => {
  const reservedNames = ['CONIN$', 'conin$.md', 'CONOUT$', 'conout$.txt'];
  const repositoryRoot = createFixture(t, {
    'docs/broken.md': `${reservedNames
      .map((reservedName) => `[reserved](${reservedName})`)
      .join('\n')}\n`,
  });

  const errors = errorText(repositoryRoot);
  for (const reservedName of reservedNames) {
    assert.ok(
      errors.includes(`uses a non-portable repository path segment: ${reservedName}`),
      `expected ${reservedName} to be rejected as a non-portable repository path segment`,
    );
  }
});

test('requires README status authority links', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

M2 implementation is in progress.
`,
  });

  const errors = errorText(repositoryRoot);
  assert.match(
    errors,
    /Status must link to docs\/plans\/m2\.6-unified-frontstage-interaction\.md/u,
  );
  assert.match(errors, /Status must link to docs\/milestones\.md/u);
});

test('requires README status authority links to have visible text', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

Authorities: [](docs/plans/m2.6-unified-frontstage-interaction.md) and [ ][milestones].

[milestones]: docs/milestones.md
`,
  });

  const errors = errorText(repositoryRoot);
  assert.equal(
    errors.match(/README\.md Status authority links must have visible link text\./gu)?.length,
    2,
  );
  assert.match(
    errors,
    /Status must link to docs\/plans\/m2\.6-unified-frontstage-interaction\.md/u,
  );
  assert.match(errors, /Status must link to docs\/milestones\.md/u);
});

for (const [description, defaultIgnorable] of [
  ['zero-width space', '\u200b'],
  ['zero-width non-joiner', '\u200c'],
  ['left-to-right embedding', '\u202a'],
  ['word joiner', '\u2060'],
  ['variation selector', '\ufe0f'],
  ['Unicode control character', '\u0007'],
]) {
  test(`does not count ${description} as visible README authority text`, (t) => {
    const repositoryRoot = createFixture(t, {
      'README.md': `# Fixture

## Status

Authorities: [${defaultIgnorable}](docs/plans/m2.6-unified-frontstage-interaction.md) and
[${defaultIgnorable}](docs/milestones.md).
`,
    });

    const errors = errorText(repositoryRoot);
    assert.equal(
      errors.match(/README\.md Status authority links must have visible link text\./gu)?.length,
      2,
    );
    assert.match(
      errors,
      /Status must link to docs\/plans\/m2\.6-unified-frontstage-interaction\.md/u,
    );
    assert.match(errors, /Status must link to docs\/milestones\.md/u);
  });
}

test('requires exactly one README Status section', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md) and
[milestones](docs/milestones.md).

## Status

M2 is still in progress.
`,
  });

  assert.match(errorText(repositoryRoot), /exactly one level-two Status section; found 2/u);
});

test('rejects a README without a Status section', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Development

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md) and
[milestones](docs/milestones.md).
`,
  });

  assert.match(errorText(repositoryRoot), /exactly one level-two Status section; found 0/u);
});

test('requires a root README Markdown source', (t) => {
  const repositoryRoot = createFixture(t);
  rmSync(resolve(repositoryRoot, 'README.md'));

  assert.match(errorText(repositoryRoot), /README\.md is required/u);
});

test('limits README Status to prose paragraphs', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md) and
[milestones](docs/milestones.md).

- Candidate generation is implemented.
- Persistence tests pass.
`,
  });

  assert.match(errorText(repositoryRoot), /Status must contain prose paragraphs only/u);
});

test('recognizes a GFM table as non-prose README Status structure', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

| Feature | State |
| --- | --- |
| Candidate | Done |

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md) and
[milestones](docs/milestones.md).
`,
  });

  assert.match(errorText(repositoryRoot), /Status must contain prose paragraphs only/u);
});

test('rejects a GFM footnote as an indirect README Status source', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md),
[milestones](docs/milestones.md), and details[^progress].

## Notes

[^progress]: [progress](docs/progress.md)
`,
    'docs/progress.md': '# Progress\n',
  });

  assert.match(errorText(repositoryRoot), /Status must contain prose paragraphs only/u);
});

test('rejects an additional README Status link as a competing local source', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md),
[milestones](docs/milestones.md), and [progress](docs/progress.md).
`,
    'docs/progress.md': '# Progress\n',
  });

  assert.match(errorText(repositoryRoot), /Status may link only to/u);
});

test('rejects a rolling numbered-slice status in README', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

Slice 5 is complete. See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md)
and [milestones](docs/milestones.md).
`,
  });

  assert.match(errorText(repositoryRoot), /must not duplicate the rolling numbered-slice status/u);
});

test('rejects a rolling numbered-slice status outside README Status', (t) => {
  const repositoryRoot = createFixture(t, {
    'README.md': `# Fixture

## Status

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md) and
[milestones](docs/milestones.md).

## Progress

Slice 99 is complete.
`,
  });

  assert.match(errorText(repositoryRoot), /must not duplicate the rolling numbered-slice status/u);
});

for (const [description, phrase] of [
  ['strong emphasis', 'Sli**ce** 99'],
  ['emphasis', 'Sli*ce* 99'],
  ['link', 'Sli[ce](#status) 99'],
  ['inline code', 'Sli`ce` 99'],
  ['GFM strikethrough', 'Sli~~ce~~ 99'],
  ['Unicode default-ignorable code point', 'Sli\u200bce 99'],
  ['Unicode control character', 'Sli\u0007ce 99'],
]) {
  test(`rejects a numbered-slice status split by ${description}`, (t) => {
    const repositoryRoot = createFixture(t, {
      'README.md': `# Fixture

## Status

See the [M2.6 plan](docs/plans/m2.6-unified-frontstage-interaction.md) and
[milestones](docs/milestones.md).

## Progress

${phrase} is complete.
`,
    });

    assert.match(
      errorText(repositoryRoot),
      /must not duplicate the rolling numbered-slice status/u,
    );
  });
}
