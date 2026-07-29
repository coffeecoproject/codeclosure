import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

const PRIVILEGED_PACKAGE_ROOTS = new Map([
  [
    '@codeclosure/runtime/composition',
    'CLI adapters must receive the public application facade, not construct Runtime coordinators.',
  ],
  ['@codeclosure/store-sqlite', 'CLI adapters must not import the control Store.'],
  ['@codeclosure/testing', 'CLI adapters must not import test fixtures or fake capabilities.'],
]);

const PUBLIC_ADAPTER_RUNTIME_IMPORTS = new Set([
  'CancelGoalRequest',
  'CodeClosureApplication',
  'CommandError',
  'CommandOutput',
  'CreateGoalRequest',
  'DrivenGoalCommandResult',
  'FailedCommandOutput',
  'GoalAuditEventView',
  'GoalAuditView',
  'GoalDominantBlocker',
  'GoalDominantBlockerCode',
  'GoalNextSafeAction',
  'GoalReadResult',
  'GoalStatusView',
  'JsonPrimitive',
  'JsonValue',
  'ResumeGoalRequest',
  'RuntimeCommandResult',
  'RuntimeErrorCode',
  'StartGoalRequest',
  'SuccessfulCommandOutput',
  'WorkflowDriveFinalState',
  'WorkflowDriveStopReason',
  'WorkflowDriveSummary',
]);

const CliSourceZone = Object.freeze({
  ENTRY_POINT: 'ENTRY_POINT',
  HANDLER: 'HANDLER',
  TRUSTED_COMPOSITION: 'TRUSTED_COMPOSITION',
});

function isWithin(candidate, root) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

function sourceZone(filePath, repositoryRoot) {
  const absoluteFilePath = resolve(filePath);
  if (isWithin(absoluteFilePath, resolve(repositoryRoot, 'apps/cli/src/composition'))) {
    return CliSourceZone.TRUSTED_COMPOSITION;
  }
  if (absoluteFilePath === resolve(repositoryRoot, 'apps/cli/src/index.ts')) {
    return CliSourceZone.ENTRY_POINT;
  }
  return CliSourceZone.HANDLER;
}

function privilegedPackageMatch(specifier) {
  for (const [root, reason] of PRIVILEGED_PACKAGE_ROOTS) {
    if (specifier === root || specifier.startsWith(`${root}/`)) {
      return Object.freeze({ exact: specifier === root, reason, root });
    }
  }
  return undefined;
}

function relativeModuleTarget(specifier, filePath) {
  return specifier.startsWith('.') ? resolve(dirname(filePath), specifier) : undefined;
}

function repositoryInternalReason(specifier, filePath, repositoryRoot) {
  const target = relativeModuleTarget(specifier, filePath);
  return target !== undefined && isWithin(target, resolve(repositoryRoot, 'packages'))
    ? 'CLI source must use declared package exports, not repository-internal package paths.'
    : undefined;
}

function importedName(specifier) {
  return specifier.propertyName?.text ?? specifier.name.text;
}

function position(sourceFile, node) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return Object.freeze({ line: location.line + 1, column: location.character + 1 });
}

function violation(sourceFile, node, specifier, reason) {
  return Object.freeze({
    filePath: sourceFile.fileName,
    specifier,
    reason,
    ...position(sourceFile, node),
  });
}

export function findCliBoundaryViolationsInSource(source, filePath, repositoryRoot) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations = [];
  const zone = sourceZone(filePath, repositoryRoot);
  const trustedImportedBindings = new Set();

  if (zone === CliSourceZone.TRUSTED_COMPOSITION) {
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (specifier !== '@codeclosure/runtime' && privilegedPackageMatch(specifier) === undefined) {
        continue;
      }
      const bindings = statement.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          trustedImportedBindings.add(element.name.text);
        }
      }
    }
  }

  function record(reasonNode, specifier, reason) {
    violations.push(violation(sourceFile, reasonNode, specifier, reason));
  }

  function requireExplicitNamedImport(node, specifier, kind, audience) {
    if (kind !== 'IMPORT_DECLARATION') {
      record(
        node,
        specifier,
        `${audience} may use this module only through an explicit static named import.`,
      );
      return false;
    }
    const clause = node.importClause;
    if (
      clause === undefined ||
      clause.name !== undefined ||
      clause.namedBindings === undefined ||
      ts.isNamespaceImport(clause.namedBindings)
    ) {
      record(
        node,
        specifier,
        `${audience} may not use side-effect, default, or namespace imports for this module.`,
      );
      return false;
    }
    return true;
  }

  function recordModuleUse(node, specifier, kind) {
    const internalReason = repositoryInternalReason(specifier, filePath, repositoryRoot);
    if (internalReason !== undefined) {
      record(node, specifier, internalReason);
      return;
    }

    if (specifier.startsWith('@codeclosure/runtime/')) {
      const privileged = privilegedPackageMatch(specifier);
      if (
        zone === CliSourceZone.TRUSTED_COMPOSITION &&
        privileged?.exact === true &&
        specifier === '@codeclosure/runtime/composition'
      ) {
        requireExplicitNamedImport(node, specifier, kind, 'Trusted CLI composition');
        return;
      }
      record(
        node,
        specifier,
        zone === CliSourceZone.TRUSTED_COMPOSITION
          ? 'Trusted CLI composition may use only the named Runtime composition export, never testing or other Runtime subpaths.'
          : 'CLI adapters must not import Runtime composition, testing, or other package subpaths.',
      );
      return;
    }

    const privileged = privilegedPackageMatch(specifier);
    if (privileged !== undefined) {
      if (zone !== CliSourceZone.TRUSTED_COMPOSITION) {
        record(node, specifier, privileged.reason);
      } else if (!privileged.exact) {
        record(
          node,
          specifier,
          'Trusted CLI composition must use the declared package root, not an undeclared package subpath.',
        );
      } else {
        requireExplicitNamedImport(node, specifier, kind, 'Trusted CLI composition');
      }
      return;
    }

    const relativeTarget = relativeModuleTarget(specifier, filePath);
    if (
      relativeTarget !== undefined &&
      isWithin(relativeTarget, resolve(repositoryRoot, 'apps/cli/src/composition')) &&
      zone !== CliSourceZone.TRUSTED_COMPOSITION
    ) {
      if (zone !== CliSourceZone.ENTRY_POINT) {
        record(
          node,
          specifier,
          'CLI handlers must receive facade capabilities; only the CLI entry point may invoke trusted composition.',
        );
      } else {
        requireExplicitNamedImport(node, specifier, kind, 'The CLI entry point');
      }
      return;
    }

    if (specifier !== '@codeclosure/runtime') {
      return;
    }

    if (
      !requireExplicitNamedImport(
        node,
        specifier,
        kind,
        zone === CliSourceZone.TRUSTED_COMPOSITION ? 'Trusted CLI composition' : 'CLI adapters',
      )
    ) {
      return;
    }

    if (zone === CliSourceZone.TRUSTED_COMPOSITION) {
      return;
    }
    for (const element of node.importClause.namedBindings.elements) {
      const name = importedName(element);
      if (!PUBLIC_ADAPTER_RUNTIME_IMPORTS.has(name)) {
        record(
          element,
          specifier,
          `CLI adapters may not import non-facade Runtime capability ${name}.`,
        );
      }
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      recordModuleUse(node, node.moduleSpecifier.text, 'IMPORT_DECLARATION');
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        recordModuleUse(node, node.moduleSpecifier.text, 'EXPORT_DECLARATION');
      } else if (
        zone === CliSourceZone.TRUSTED_COMPOSITION &&
        node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const element of node.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text;
          if (trustedImportedBindings.has(localName)) {
            record(
              element,
              localName,
              'Trusted CLI composition must not re-export an imported control capability.',
            );
          }
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      recordModuleUse(node, node.moduleReference.expression.text, 'IMPORT_EQUALS');
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        recordModuleUse(node, argument.literal.text, 'IMPORT_TYPE');
      }
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          recordModuleUse(node, argument.text, 'DYNAMIC_IMPORT');
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          recordModuleUse(node, argument.text, 'REQUIRE');
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Object.freeze(violations);
}

function listTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new TypeError(`CLI source must not be a symbolic link: ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (!lstatSync(path).isFile()) {
        throw new TypeError(`CLI TypeScript source is not a regular file: ${path}`);
      }
      files.push(path);
    }
  }
  return files.sort();
}

export function checkCliBoundary(repositoryRoot) {
  const sourceRoot = resolve(repositoryRoot, 'apps/cli/src');
  return Object.freeze(
    listTypeScriptFiles(sourceRoot).flatMap((filePath) =>
      findCliBoundaryViolationsInSource(readFileSync(filePath, 'utf8'), filePath, repositoryRoot),
    ),
  );
}
