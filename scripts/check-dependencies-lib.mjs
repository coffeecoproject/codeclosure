import { isBuiltin } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

const sourceExtensionPattern = /\.(?:[cm]?[jt]s)$/u;
const ignoredDirectoryNames = new Set(['coverage', 'dist', 'node_modules']);

export const m25CodexIntakeAdapterDependencyExpectation = Object.freeze({
  path: 'packages/adapter-codex-intake',
  name: '@codeclosure/adapter-codex-intake',
  dependencies: Object.freeze({
    '@codeclosure/codex-app-server-client': 'workspace:*',
    '@codeclosure/runtime': 'workspace:*',
  }),
  devDependencies: Object.freeze({ '@codeclosure/domain': 'workspace:*' }),
});

export const m25CodexIntakeAdapterAllowedNodeBuiltins = Object.freeze([
  'node:buffer',
  'node:crypto',
  'node:fs',
  'node:path',
  'node:timers',
]);

const packagePolicies = Object.freeze([
  Object.freeze({
    path: '.',
    name: 'codeclosure',
    dependencies: Object.freeze({}),
    devDependencies: Object.freeze({
      '@eslint/js': '10.0.1',
      '@types/node': '22.20.1',
      eslint: '10.8.0',
      'github-slugger': '2.0.0',
      'mdast-util-from-markdown': '2.0.3',
      'mdast-util-gfm': '3.1.0',
      'micromark-extension-gfm': '3.0.0',
      prettier: '3.9.6',
      typescript: '6.0.3',
      'typescript-eslint': '8.65.0',
    }),
  }),
  Object.freeze({
    path: 'packages/codex-app-server-client',
    name: '@codeclosure/codex-app-server-client',
    dependencies: Object.freeze({}),
    devDependencies: Object.freeze({}),
  }),
  Object.freeze({
    path: 'packages/adapter-codex',
    name: '@codeclosure/adapter-codex',
    dependencies: Object.freeze({
      '@codeclosure/codex-app-server-client': 'workspace:*',
      '@codeclosure/domain': 'workspace:*',
      '@codeclosure/runtime': 'workspace:*',
    }),
    devDependencies: Object.freeze({}),
  }),
  m25CodexIntakeAdapterDependencyExpectation,
  Object.freeze({
    path: 'packages/domain',
    name: '@codeclosure/domain',
    dependencies: Object.freeze({ zod: '4.4.3' }),
    devDependencies: Object.freeze({}),
  }),
  Object.freeze({
    path: 'packages/runtime',
    name: '@codeclosure/runtime',
    dependencies: Object.freeze({ '@codeclosure/domain': 'workspace:*', zod: '4.4.3' }),
    devDependencies: Object.freeze({}),
  }),
  Object.freeze({
    path: 'packages/workspace-local',
    name: '@codeclosure/workspace-local',
    dependencies: Object.freeze({ '@codeclosure/runtime': 'workspace:*' }),
    devDependencies: Object.freeze({ '@codeclosure/domain': 'workspace:*' }),
  }),
  Object.freeze({
    path: 'packages/verification-local',
    name: '@codeclosure/verification-local',
    dependencies: Object.freeze({ '@codeclosure/runtime': 'workspace:*' }),
    devDependencies: Object.freeze({ '@codeclosure/domain': 'workspace:*' }),
  }),
  Object.freeze({
    path: 'packages/store-sqlite',
    name: '@codeclosure/store-sqlite',
    dependencies: Object.freeze({
      '@codeclosure/domain': 'workspace:*',
      '@codeclosure/runtime': 'workspace:*',
      'better-sqlite3': '13.0.1',
      zod: '4.4.3',
    }),
    devDependencies: Object.freeze({
      '@codeclosure/testing': 'workspace:*',
      '@codeclosure/verification-local': 'workspace:*',
      '@codeclosure/workspace-local': 'workspace:*',
      '@types/better-sqlite3': '7.6.13',
    }),
  }),
  Object.freeze({
    path: 'packages/testing',
    name: '@codeclosure/testing',
    dependencies: Object.freeze({
      '@codeclosure/domain': 'workspace:*',
      '@codeclosure/runtime': 'workspace:*',
    }),
    devDependencies: Object.freeze({ 'fast-check': '4.9.0' }),
  }),
  Object.freeze({
    path: 'apps/cli',
    name: '@codeclosure/cli',
    dependencies: Object.freeze({
      '@codeclosure/adapter-codex': 'workspace:*',
      '@codeclosure/adapter-codex-intake': 'workspace:*',
      '@codeclosure/codex-app-server-client': 'workspace:*',
      '@codeclosure/domain': 'workspace:*',
      '@codeclosure/runtime': 'workspace:*',
      '@codeclosure/store-sqlite': 'workspace:*',
      '@codeclosure/testing': 'workspace:*',
      '@codeclosure/verification-local': 'workspace:*',
      '@codeclosure/workspace-local': 'workspace:*',
      zod: '4.4.3',
    }),
    devDependencies: Object.freeze({}),
  }),
]);

function repositoryPath(repositoryRoot, filePath) {
  return relative(repositoryRoot, filePath).split(sep).join('/');
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        files.push(...sourceFiles(entryPath));
      }
    } else if (entry.isFile() && sourceExtensionPattern.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function staticModuleSpecifier(node) {
  return ts.isStringLiteralLike(node) ? node.text : undefined;
}

export function collectModuleSpecifiers(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ['.js', '.mjs', '.cjs'].includes(extname(filePath)) ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const specifiers = new Set();

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined
    ) {
      const specifier = staticModuleSpecifier(node.moduleSpecifier);
      if (specifier !== undefined) {
        specifiers.add(specifier);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined
    ) {
      const specifier = staticModuleSpecifier(node.moduleReference.expression);
      if (specifier !== undefined) {
        specifiers.add(specifier);
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        const argument = node.arguments[0];
        const specifier = argument === undefined ? undefined : staticModuleSpecifier(argument);
        if (specifier !== undefined) {
          specifiers.add(specifier);
        }
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Object.freeze([...specifiers].sort());
}

export function modulePackageName(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return name === undefined ? specifier : `${scope}/${name}`;
  }
  return specifier.split('/')[0];
}

export function parsePnpmLockImporters(source) {
  const importers = new Map();
  let inside = false;
  let importer;
  let group;
  let dependency;
  for (const line of source.split(/\r?\n/u)) {
    if (line === 'importers:') {
      inside = true;
      continue;
    }
    if (!inside) {
      continue;
    }
    if (/^\S/u.test(line)) {
      break;
    }
    const emptyImporterMatch = /^ {2}(\S.*): \{\}$/u.exec(line);
    if (emptyImporterMatch !== null) {
      importer = unquoteYamlScalar(emptyImporterMatch[1]);
      importers.set(importer, { dependencies: new Map(), devDependencies: new Map() });
      group = undefined;
      dependency = undefined;
      continue;
    }
    const importerMatch = /^ {2}(\S.*):$/u.exec(line);
    if (importerMatch !== null) {
      importer = unquoteYamlScalar(importerMatch[1]);
      importers.set(importer, { dependencies: new Map(), devDependencies: new Map() });
      group = undefined;
      dependency = undefined;
      continue;
    }
    const groupMatch = /^ {4}(dependencies|devDependencies):$/u.exec(line);
    if (groupMatch !== null) {
      group = groupMatch[1];
      dependency = undefined;
      continue;
    }
    const dependencyMatch = /^ {6}(\S.*):$/u.exec(line);
    if (dependencyMatch !== null && importer !== undefined && group !== undefined) {
      dependency = unquoteYamlScalar(dependencyMatch[1]);
      importers.get(importer)[group].set(dependency, {});
      continue;
    }
    const valueMatch = /^ {8}(specifier|version): (.+)$/u.exec(line);
    if (
      valueMatch !== null &&
      importer !== undefined &&
      group !== undefined &&
      dependency !== undefined
    ) {
      importers.get(importer)[group].get(dependency)[valueMatch[1]] = unquoteYamlScalar(
        valueMatch[2],
      );
    }
  }
  return importers;
}

function dependencyGroup(manifest, name) {
  const value = manifest[name];
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function compareDependencyGroup(packagePath, groupName, actual, expected, violations) {
  const names = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const name of [...names].sort()) {
    if (!(name in expected)) {
      violations.push(`${packagePath}/package.json: unexpected ${groupName} entry ${name}`);
    } else if (!(name in actual)) {
      violations.push(`${packagePath}/package.json: missing ${groupName} entry ${name}`);
    } else if (actual[name] !== expected[name]) {
      violations.push(
        `${packagePath}/package.json: ${name} must use ${expected[name]}, found ${String(actual[name])}`,
      );
    }
  }
}

function expectedLockVersion(importerPath, dependencyName, specifier, policiesByName) {
  const target = policiesByName.get(dependencyName);
  if (target === undefined) {
    return specifier;
  }
  const linked = relative(importerPath, target.path).split(sep).join('/');
  return `link:${linked}`;
}

function lockVersionMatches(actual, expected) {
  return actual === expected || actual?.startsWith(`${expected}(`) === true;
}

function compareLockImporter(policy, importer, policiesByName, violations) {
  if (importer === undefined) {
    violations.push(`pnpm-lock.yaml: missing importer ${policy.path}`);
    return;
  }
  for (const groupName of ['dependencies', 'devDependencies']) {
    const expected = policy[groupName];
    const actual = importer[groupName];
    const names = new Set([...actual.keys(), ...Object.keys(expected)]);
    for (const name of [...names].sort()) {
      const entry = actual.get(name);
      if (!(name in expected)) {
        violations.push(
          `pnpm-lock.yaml: importer ${policy.path} has unexpected ${groupName} ${name}`,
        );
      } else if (entry === undefined) {
        violations.push(`pnpm-lock.yaml: importer ${policy.path} is missing ${groupName} ${name}`);
      } else {
        const expectedSpecifier = expected[name];
        if (entry.specifier !== expectedSpecifier) {
          violations.push(
            `pnpm-lock.yaml: importer ${policy.path} ${name} specifier must be ${expectedSpecifier}`,
          );
        }
        const expectedVersion = expectedLockVersion(
          policy.path,
          name,
          expectedSpecifier,
          policiesByName,
        );
        if (!lockVersionMatches(entry.version, expectedVersion)) {
          violations.push(
            `pnpm-lock.yaml: importer ${policy.path} ${name} version must resolve as ${expectedVersion}`,
          );
        }
      }
    }
  }
}

export function importViolation(specifier, filePath, packageRoot, availableDependencies) {
  if (specifier.startsWith('node:')) {
    return isBuiltin(specifier) ? undefined : `unknown Node built-in ${specifier}`;
  }
  if (isBuiltin(specifier)) {
    return `Node built-in imports must use the node: prefix (${specifier})`;
  }
  if (specifier.startsWith('file:') || isAbsolute(specifier)) {
    return `absolute or file URL import is outside the package contract (${specifier})`;
  }
  if (specifier.startsWith('.')) {
    const target = resolve(dirname(filePath), specifier);
    const fromPackage = relative(packageRoot, target);
    if (fromPackage === '..' || fromPackage.startsWith(`..${sep}`) || isAbsolute(fromPackage)) {
      return `relative import crosses the package boundary (${specifier})`;
    }
    return undefined;
  }
  const packageName = modulePackageName(specifier);
  if (!availableDependencies.has(packageName)) {
    return `undeclared package import ${specifier}`;
  }
  return undefined;
}

/** Future production-source import contract; Slice 3 test sources keep the ordinary test policy. */
export function m25CodexIntakeAdapterImportViolation(specifier, filePath, packageRoot) {
  const expectation = m25CodexIntakeAdapterDependencyExpectation;
  if (
    specifier.startsWith('node:') &&
    !m25CodexIntakeAdapterAllowedNodeBuiltins.includes(specifier)
  ) {
    return `Node built-in is outside the Intake adapter capability contract (${specifier})`;
  }
  const violation = importViolation(
    specifier,
    filePath,
    packageRoot,
    new Set([expectation.name, ...Object.keys(expectation.dependencies)]),
  );
  if (violation !== undefined) {
    return violation;
  }
  if (
    specifier.startsWith('@codeclosure/runtime/') ||
    specifier.startsWith('@codeclosure/codex-app-server-client/')
  ) {
    return `package subpath import is outside the Intake adapter contract (${specifier})`;
  }
  return undefined;
}

function discoverWorkspacePackagePaths(repositoryRoot) {
  const paths = [];
  for (const parent of ['apps', 'packages']) {
    const parentPath = resolve(repositoryRoot, parent);
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        paths.push(`${parent}/${entry.name}`);
      }
    }
  }
  return paths.sort();
}

function collectPolicySourceFiles(repositoryRoot, policy) {
  const packageRoot = resolve(repositoryRoot, policy.path);
  if (policy.path === '.') {
    const rootFiles = readdirSync(repositoryRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && sourceExtensionPattern.test(entry.name))
      .map((entry) => resolve(repositoryRoot, entry.name));
    return Object.freeze([
      ...rootFiles.map((filePath) => ({ filePath, mode: 'TEST' })),
      ...sourceFiles(resolve(repositoryRoot, 'scripts')).map((filePath) => ({
        filePath,
        mode: 'TEST',
      })),
    ]);
  }
  const files = [];
  for (const [directoryName, mode] of [
    ['src', 'PRODUCTION'],
    ['test', 'TEST'],
    ['scripts', 'TEST'],
  ]) {
    const directory = resolve(packageRoot, directoryName);
    try {
      files.push(...sourceFiles(directory).map((filePath) => ({ filePath, mode })));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return Object.freeze(files);
}

export function auditPackageDependencies(repositoryRoot) {
  const violations = [];
  const policiesByName = new Map(packagePolicies.map((policy) => [policy.name, policy]));
  const policyPaths = packagePolicies
    .filter((policy) => policy.path !== '.')
    .map((policy) => policy.path)
    .sort();
  const discoveredPaths = discoverWorkspacePackagePaths(repositoryRoot);
  if (JSON.stringify(discoveredPaths) !== JSON.stringify(policyPaths)) {
    violations.push(
      `Workspace package paths must be ${policyPaths.join(', ')}, found ${discoveredPaths.join(', ')}`,
    );
  }

  const lockSource = readFileSync(resolve(repositoryRoot, 'pnpm-lock.yaml'), 'utf8');
  if (!/^lockfileVersion: '9\.0'$/mu.test(lockSource)) {
    violations.push('pnpm-lock.yaml must use lockfileVersion 9.0');
  }
  const lockImporters = parsePnpmLockImporters(lockSource);
  const expectedImporterPaths = packagePolicies.map((policy) => policy.path).sort();
  const actualImporterPaths = [...lockImporters.keys()].sort();
  if (JSON.stringify(actualImporterPaths) !== JSON.stringify(expectedImporterPaths)) {
    violations.push(
      `pnpm-lock.yaml importers must be ${expectedImporterPaths.join(', ')}, found ${actualImporterPaths.join(', ')}`,
    );
  }

  const productionGraph = new Map();
  let sourceFileCount = 0;
  for (const policy of packagePolicies) {
    const manifestPath = resolve(repositoryRoot, policy.path, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== policy.name) {
      violations.push(`${policy.path}/package.json: expected package name ${policy.name}`);
    }
    if (policy.path === '.') {
      if (manifest.packageManager !== 'pnpm@11.1.3') {
        violations.push('package.json: packageManager must be pnpm@11.1.3');
      }
      if (manifest.engines?.node !== '>=22.22.0 <23' || manifest.engines?.pnpm !== '11.1.3') {
        violations.push(
          'package.json: Node and pnpm engine bounds must match the accepted M1 stack',
        );
      }
    }
    const dependencies = dependencyGroup(manifest, 'dependencies');
    const devDependencies = dependencyGroup(manifest, 'devDependencies');
    compareDependencyGroup(
      policy.path,
      'dependencies',
      dependencies,
      policy.dependencies,
      violations,
    );
    compareDependencyGroup(
      policy.path,
      'devDependencies',
      devDependencies,
      policy.devDependencies,
      violations,
    );
    compareLockImporter(policy, lockImporters.get(policy.path), policiesByName, violations);

    const packageRoot = resolve(repositoryRoot, policy.path);
    const productionImports = new Set();
    for (const source of collectPolicySourceFiles(repositoryRoot, policy)) {
      sourceFileCount += 1;
      const available = new Set([
        policy.name,
        ...Object.keys(dependencies),
        ...(source.mode === 'TEST' ? Object.keys(devDependencies) : []),
      ]);
      for (const specifier of collectModuleSpecifiers(
        readFileSync(source.filePath, 'utf8'),
        source.filePath,
      )) {
        const violation = importViolation(specifier, source.filePath, packageRoot, available);
        if (violation !== undefined) {
          violations.push(`${repositoryPath(repositoryRoot, source.filePath)}: ${violation}`);
        } else if (
          source.mode === 'PRODUCTION' &&
          !specifier.startsWith('.') &&
          !specifier.startsWith('node:')
        ) {
          productionImports.add(modulePackageName(specifier));
        }
      }
    }
    for (const dependencyName of Object.keys(policy.dependencies)) {
      if (!productionImports.has(dependencyName)) {
        violations.push(
          `${policy.path}/package.json: production dependency ${dependencyName} has no source import`,
        );
      }
    }
    if (policy.path !== '.') {
      productionGraph.set(policy.name, Object.freeze([...productionImports].sort()));
    }
  }

  return Object.freeze({
    packageCount: packagePolicies.length - 1,
    productionGraph,
    sourceFileCount,
    violations: Object.freeze(violations),
  });
}

export function formatDependencyAuditReport(audit) {
  const lines = [
    `Current-milestone package dependency audit: ${audit.violations.length === 0 ? 'PASS' : 'FAIL'}`,
    `Workspace packages: ${audit.packageCount}`,
    `JavaScript/TypeScript sources inspected: ${audit.sourceFileCount}`,
    'Production dependency graph:',
  ];
  for (const [name, dependencies] of [...audit.productionGraph.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`- ${name} -> ${dependencies.length === 0 ? '(none)' : dependencies.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
