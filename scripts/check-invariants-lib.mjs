import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

const ignoredDirectoryNames = new Set(['.git', 'coverage', 'dist', 'node_modules']);
const testFilePattern = /\.test\.(?:[cm]?[jt]s)$/u;
const invariantTagPattern = /\[(I-\d{3})\]/gu;
const invariantLikeTagPattern = /\[(I-[^\]]+)\]/gu;

function repositoryPath(repositoryRoot, filePath) {
  return relative(repositoryRoot, filePath).split(sep).join('/');
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function staticTitle(node) {
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return `${node.head.text}${node.templateSpans
      .map((span) => `\${expression}${span.literal.text}`)
      .join('')}`;
  }
  return undefined;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
    return node.text;
  }
  return undefined;
}

function directTestCallKind(expression) {
  if (ts.isIdentifier(expression) && (expression.text === 'test' || expression.text === 'it')) {
    return 'EXECUTABLE';
  }
  if (!ts.isPropertyAccessExpression(expression)) {
    return undefined;
  }
  if (expression.name.text === 'test' || expression.name.text === 'it') {
    return 'EXECUTABLE';
  }
  if (
    ts.isIdentifier(expression.expression) &&
    (expression.expression.text === 'test' || expression.expression.text === 'it')
  ) {
    if (expression.name.text === 'skip' || expression.name.text === 'todo') {
      return 'NON_EXECUTABLE';
    }
    if (expression.name.text === 'only') {
      return 'FOCUSED';
    }
  }
  return undefined;
}

function dynamicSkipOrTodo(call) {
  const options = call.arguments[1];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    return undefined;
  }
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const name = propertyName(property.name);
    if (name !== 'skip' && name !== 'todo') {
      continue;
    }
    if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) {
      return name;
    }
  }
  return undefined;
}

function tagsInTitle(title) {
  return Object.freeze([...title.matchAll(invariantTagPattern)].map((match) => match[1]));
}

export function parseInvariantCatalog(source) {
  const entries = [];
  const pattern = /^### (I-\d{3}) — (.+)$/gmu;
  for (const match of source.matchAll(pattern)) {
    const prefix = source.slice(0, match.index);
    entries.push(
      Object.freeze({
        id: match[1],
        title: match[2].trim(),
        line: prefix.split(/\r?\n/u).length,
      }),
    );
  }
  return Object.freeze(entries);
}

export function collectTestMetadataFromSource(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ['.js', '.mjs', '.cjs'].includes(extname(filePath)) ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const executable = [];
  const controls = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const kind = directTestCallKind(node.expression);
      const title = node.arguments[0] === undefined ? undefined : staticTitle(node.arguments[0]);
      if (kind !== undefined) {
        const runtimeControl = kind === 'EXECUTABLE' ? dynamicSkipOrTodo(node) : undefined;
        if (kind !== 'EXECUTABLE' || runtimeControl !== undefined) {
          controls.push(
            Object.freeze({
              filePath,
              line: lineNumber(sourceFile, node),
              kind: runtimeControl ?? kind,
              title,
            }),
          );
        } else if (title !== undefined) {
          const tags = tagsInTitle(title);
          if (tags.length !== 0) {
            executable.push(
              Object.freeze({
                filePath,
                line: lineNumber(sourceFile, node),
                tags,
                title,
              }),
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Object.freeze({
    executable: Object.freeze(executable),
    controls: Object.freeze(controls),
  });
}

function collectTestFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        files.push(...collectTestFiles(entryPath));
      }
    } else if (entry.isFile() && testFilePattern.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

export function buildInvariantCoverage(catalog, executableMetadata) {
  const coverage = new Map(catalog.map((entry) => [entry.id, []]));
  const violations = [];
  const seenCatalogIds = new Set();

  for (const [index, entry] of catalog.entries()) {
    const expected = `I-${String(index + 1).padStart(3, '0')}`;
    if (entry.id !== expected) {
      violations.push(
        `Invariant catalog expected ${expected} at position ${index + 1}, found ${entry.id}`,
      );
    }
    if (seenCatalogIds.has(entry.id)) {
      violations.push(`Invariant catalog duplicates ${entry.id}`);
    }
    seenCatalogIds.add(entry.id);
  }

  for (const metadata of executableMetadata) {
    const malformed = [...metadata.title.matchAll(invariantLikeTagPattern)]
      .map((match) => match[1])
      .filter((tag) => !/^I-\d{3}$/u.test(tag));
    for (const tag of malformed) {
      violations.push(`${metadata.filePath}:${metadata.line}: malformed invariant tag ${tag}`);
    }
    for (const tag of metadata.tags) {
      const entries = coverage.get(tag);
      if (entries === undefined) {
        violations.push(`${metadata.filePath}:${metadata.line}: unknown invariant tag ${tag}`);
      } else {
        entries.push(metadata);
      }
    }
  }

  for (const entry of catalog) {
    if (coverage.get(entry.id)?.length === 0) {
      violations.push(`${entry.id} has no executable test metadata`);
    }
  }
  return Object.freeze({ coverage, violations: Object.freeze(violations) });
}

export function auditInvariantCoverage(repositoryRoot) {
  const catalog = parseInvariantCatalog(
    readFileSync(resolve(repositoryRoot, 'RUNTIME_INVARIANTS.md'), 'utf8'),
  );
  const testFiles = collectTestFiles(repositoryRoot);
  const executable = [];
  const controls = [];
  for (const filePath of testFiles) {
    const metadata = collectTestMetadataFromSource(readFileSync(filePath, 'utf8'), filePath);
    executable.push(...metadata.executable);
    controls.push(...metadata.controls);
  }
  const normalizedExecutable = executable.map((metadata) =>
    Object.freeze({
      ...metadata,
      filePath: repositoryPath(repositoryRoot, metadata.filePath),
    }),
  );
  const built = buildInvariantCoverage(catalog, normalizedExecutable);
  const controlViolations = controls.map((control) => {
    const title = control.title === undefined ? '' : ` (${control.title})`;
    return `${repositoryPath(repositoryRoot, control.filePath)}:${control.line}: test control ${control.kind} blocks M1 evidence${title}`;
  });
  return Object.freeze({
    catalog,
    coverage: built.coverage,
    executableMetadata: Object.freeze(normalizedExecutable),
    testFileCount: testFiles.length,
    violations: Object.freeze([...built.violations, ...controlViolations]),
  });
}

export function formatInvariantCoverageReport(audit) {
  const covered = audit.catalog.filter(
    (entry) => (audit.coverage.get(entry.id)?.length ?? 0) > 0,
  ).length;
  const lines = [
    `M1 invariant coverage: ${covered}/${audit.catalog.length}`,
    `Test sources inspected: ${audit.testFileCount}`,
    `Executable metadata-bearing tests: ${audit.executableMetadata.length}`,
    '',
    '| Invariant | Tests | Source files |',
    '| --- | ---: | --- |',
  ];
  for (const entry of audit.catalog) {
    const metadata = audit.coverage.get(entry.id) ?? [];
    const files = [...new Set(metadata.map((item) => item.filePath))].sort();
    lines.push(`| ${entry.id} | ${metadata.length} | ${files.join(', ')} |`);
  }
  return `${lines.join('\n')}\n`;
}
