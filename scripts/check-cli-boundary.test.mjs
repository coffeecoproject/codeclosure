import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import ts from 'typescript';

import { checkCliBoundary, findCliBoundaryViolationsInSource } from './check-cli-boundary-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const handlerFixturePath = resolve(repositoryRoot, 'apps/cli/src/commands/fixture.ts');
const compositionFixturePath = resolve(repositoryRoot, 'apps/cli/src/composition/fixture.ts');
const trustedCompositionFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/trusted-composition.ts',
);
const sqliteAuthorityFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/sqlite-authority.ts',
);
const runtimeProfilesFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m1-runtime-profiles.ts',
);
const restartObserverFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m1-restart-proof-observer.ts',
);
const restartProofFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m1-restart-resume-proof.ts',
);
const proofChildProcessFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m1-proof-child-process.ts',
);
const profileProofFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m1-profile-demo-proof.ts',
);
const staleCloseoutProofFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m1-stale-closeout-proof.ts',
);
const proofReadFacadeFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m1-proof-read-facade.ts',
);
const m2CodexInvocationFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m2-codex-worker-invocation.ts',
);
const m251IntakeInvocationFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/intake-assistant-invocation.ts',
);
const m251ExecutionAuthorityFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m251-execution-authority.ts',
);
const m251CodexInvocationFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m251-codex-worker-invocation.ts',
);
const m251ProductionCompositionFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m251-trusted-production-composition.ts',
);
const m2ProtectedProofFixturePath = resolve(
  repositoryRoot,
  'apps/cli/src/composition/m2-protected-demo-proof.ts',
);
const demoProofFixturePath = resolve(repositoryRoot, 'apps/cli/src/composition/demo-proof.ts');
const compositionRootFixturePath = resolve(repositoryRoot, 'apps/cli/src/composition/index.ts');
const entryPointFixturePath = resolve(repositoryRoot, 'apps/cli/src/index.ts');
const compileFixtureRoot = resolve(repositoryRoot, '.cli-boundary-virtual-fixture');
const compileFixturePath = resolve(compileFixtureRoot, 'apps/cli/src/commands/fixture.ts');
const compileFixtureNodeModules = resolve(compileFixtureRoot, 'apps/cli/node_modules');
const compileFixtureFiles = new Map([
  [
    resolve(compileFixtureNodeModules, '@codeclosure/store-sqlite/dist/index.d.ts'),
    'export declare const openVerifiedSqliteControlStore: unknown;',
  ],
  [
    resolve(compileFixtureNodeModules, '@codeclosure/runtime/dist/composition.d.ts'),
    'export declare const createWorkflowDriver: unknown;',
  ],
  [
    resolve(compileFixtureNodeModules, '@codeclosure/testing/dist/index.d.ts'),
    'export declare const FakeWorker: unknown;',
  ],
]);

function violations(source, filePath = handlerFixturePath) {
  return findCliBoundaryViolationsInSource(source, filePath, repositoryRoot);
}

function virtualDirectories(filePaths) {
  const directories = new Set();
  for (const filePath of filePaths) {
    let directory = dirname(filePath);
    while (!directories.has(directory)) {
      directories.add(directory);
      const parent = dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  }
  return directories;
}

function typeScriptDiagnostics(source, filePath = compileFixturePath) {
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2023,
    types: ['node'],
  };
  const virtualFiles = new Map(compileFixtureFiles);
  virtualFiles.set(resolve(filePath), source);
  const directories = virtualDirectories(virtualFiles.keys());
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalDirectoryExists = host.directoryExists?.bind(host);
  const originalRealpath = host.realpath?.bind(host);
  host.fileExists = (candidate) =>
    virtualFiles.has(resolve(candidate)) || originalFileExists(candidate);
  host.readFile = (candidate) =>
    virtualFiles.get(resolve(candidate)) ?? originalReadFile(candidate);
  host.directoryExists = (candidate) =>
    directories.has(resolve(candidate)) || originalDirectoryExists?.(candidate) === true;
  host.realpath = (candidate) => {
    const normalized = resolve(candidate);
    return virtualFiles.has(normalized) || directories.has(normalized)
      ? normalized
      : (originalRealpath?.(candidate) ?? candidate);
  };
  host.getSourceFile = (candidate, languageVersion, onError) => {
    const text = host.readFile(candidate);
    if (text === undefined) {
      onError?.(`Could not read ${candidate}`);
      return undefined;
    }
    return ts.createSourceFile(candidate, text, languageVersion, true);
  };
  return ts
    .getPreEmitDiagnostics(ts.createProgram([resolve(filePath)], options, host))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
}

void test('CLI boundary accepts only narrow public Runtime capability imports', () => {
  assert.deepEqual(
    violations(
      "import { RuntimeErrorCode, parseGoalIdentifier, type CodeClosureApplication, type ExternalFailureCodeView } from '@codeclosure/runtime';",
    ),
    [],
  );
  assert.deepEqual(checkCliBoundary(repositoryRoot), []);
});

void test('CLI boundary rejects Store, testing, composition, and internal path imports', () => {
  const forbidden = [
    "import { openSqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { WorkflowRuntimeKernel } from '@codeclosure/runtime/testing/workflow-runtime';",
    "import { createWorkflowDriver } from '@codeclosure/runtime/composition';",
    "import { FakeWorker } from '@codeclosure/testing';",
    "import { WorkflowRuntimeKernel } from '../../../../packages/runtime/src/workflow-runtime.js';",
  ];
  for (const source of forbidden) {
    assert.equal(violations(source).length, 1, source);
  }
});

void test('CLI boundary rejects non-facade Runtime names and namespace or literal dynamic bypasses', () => {
  const forbidden = [
    "import * as runtime from '@codeclosure/runtime';",
    "import type { WorkflowControlStore } from '@codeclosure/runtime';",
    "import { CanonicalJsonSha256DigestProvider } from '@codeclosure/runtime';",
    "import { createCodeClosureApplication as createApp } from '@codeclosure/runtime';",
    "export * from '@codeclosure/runtime';",
    "const module = await import('@codeclosure/runtime/testing/workflow-runtime');",
    "const store = require('@codeclosure/store-sqlite');",
    "type Store = import('@codeclosure/runtime').WorkflowControlStore;",
  ];
  for (const source of forbidden) {
    assert.equal(violations(source).length, 1, source);
  }
});

void test('CLI boundary rejects every supported dynamic-loader spelling before module resolution', () => {
  const forbidden = [
    'const module = await import("../composition/" + "index.js");',
    "const module = await import('@codeclosure/runtime', {});",
    'const name = "@codeclosure/store-sqlite"; const store = require(name);',
    'const load = require; const store = load("@codeclosure/store-sqlite");',
    "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    "const loader = process.getBuiltinModule('node:module');",
    'const loader = process["getBuiltinModule"]("node:module");',
    'const load = process.getBuiltinModule; const loader = load("node:module");',
    'const { getBuiltinModule: load } = process; const loader = load("node:module");',
    '({ getBuiltinModule: load } = process); const loader = load("node:module");',
    "const loader = Reflect.get(process, 'getBuiltinModule');",
    "const loader = Reflect['get'](process, 'getBuiltinModule');",
    "const descriptor = Reflect.getOwnPropertyDescriptor(process, 'getBuiltinModule');",
    "const descriptor = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule');",
  ];
  for (const source of forbidden) {
    assert.ok(violations(source).length > 0, source);
  }
});

void test('loader checks follow actual global syntax and accept ordinary identifier names', () => {
  const source = [
    'const require = (value: string): string => value;',
    "const getBuiltinModule = 'ordinary metadata';",
    'const process = { getBuiltinModule };',
    'const Reflect = { get: (value: unknown): unknown => value };',
    'const metadata = { require: true, getBuiltinModule: true };',
    "void require('safe');",
    'void process.getBuiltinModule; void Reflect.get(process); void metadata;',
  ].join('\n');
  assert.deepEqual(violations(source), []);
});

void test('CLI boundary closes self-contained node_modules resolution before package authority checks', () => {
  const compilableBypass = [
    'import { openVerifiedSqliteControlStore } from "../../node_modules/@codeclosure/store-sqlite/dist/index.js";',
    'import { createWorkflowDriver } from "../../node_modules/@codeclosure/runtime/dist/composition.js";',
    'import { FakeWorker } from "../../node_modules/@codeclosure/testing/dist/index.js";',
    'void openVerifiedSqliteControlStore; void createWorkflowDriver; void FakeWorker;',
  ].join('\n');
  assert.deepEqual(typeScriptDiagnostics(compilableBypass), []);
  assert.equal(violations(compilableBypass).length, 3);

  const unapprovedExternalImports = [
    `import value from '${resolve(repositoryRoot, 'packages/store-sqlite/dist/index.js')}';`,
    "import value from 'file:///tmp/codeclosure-unapproved.js';",
    "import value from 'unapproved-package';",
  ];
  for (const source of unapprovedExternalImports) {
    assert.equal(violations(source).length, 1, source);
  }
  assert.deepEqual(
    violations(
      "import { resolve } from 'node:path'; import { z } from 'zod'; void resolve; void z;",
    ),
    [],
  );
});

void test('CLI boundary rejects NodeNext-resolved backslash specifiers on POSIX', () => {
  const compilableBypass = String.raw`
import { openVerifiedSqliteControlStore } from "..\\..\\node_modules\\@codeclosure\\store-sqlite\\dist\\index.js";
void openVerifiedSqliteControlStore;
`;
  assert.deepEqual(typeScriptDiagnostics(compilableBypass), []);
  const found = violations(compilableBypass);
  assert.equal(found.length, 1);
  assert.match(found[0].reason, /backslashes as path separators/u);
});

void test('Node built-ins are a closed source-zone and concrete-owner capability set', () => {
  const handlerBuiltins = [
    'node:sqlite',
    'node:child_process',
    'node:worker_threads',
    'node:vm',
    'node:module',
    'node:fs',
  ];
  for (const moduleName of handlerBuiltins) {
    const source = `import * as capability from '${moduleName}'; void capability;`;
    assert.equal(violations(source).length, 1, source);
  }

  assert.deepEqual(violations("import { resolve } from 'node:path'; void resolve;"), []);
  assert.deepEqual(
    violations(
      "import { spawn } from 'node:child_process'; void spawn;",
      proofChildProcessFixturePath,
    ),
    [],
  );
  assert.equal(
    violations("import { spawn } from 'node:child_process'; void spawn;", restartProofFixturePath)
      .length,
    1,
  );
});

void test('only named composition owners may import their exact privileged package surface', () => {
  assert.deepEqual(
    violations(
      "import { createWorkflowDriver } from '@codeclosure/runtime/composition';",
      trustedCompositionFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "import { openVerifiedSqliteControlStore, type SqliteAuthorityIsolationSnapshot } from '@codeclosure/store-sqlite';",
      sqliteAuthorityFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations("import { FakeWorker } from '@codeclosure/testing';", runtimeProfilesFixturePath),
    [],
  );
  assert.deepEqual(
    violations(
      "import { M251_LIVE_INTAKE_DISABLED_FEATURES } from '@codeclosure/adapter-codex-intake';",
      m251IntakeInvocationFixturePath,
    ),
    [],
  );
  assert.equal(
    violations(
      "import { M251_LIVE_INTAKE_DISABLED_FEATURES } from '@codeclosure/adapter-codex-intake';",
      compositionFixturePath,
    ).length,
    1,
  );
  assert.equal(
    violations(
      "import type { RuntimeExecutionProfile } from '@codeclosure/runtime/composition';",
      trustedCompositionFixturePath,
    ).length,
    1,
  );
  assert.equal(
    violations(
      "import { createWorkflowDriver } from '@codeclosure/runtime/composition';",
      runtimeProfilesFixturePath,
    ).length,
    1,
  );

  const privilegedImports = [
    "import { createWorkflowDriver } from '@codeclosure/runtime/composition';",
    "import { openVerifiedSqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { FakeWorker } from '@codeclosure/testing';",
  ];
  for (const source of privilegedImports) {
    assert.equal(violations(source, compositionFixturePath).length, 1, source);
  }
});

void test('M2.5.1 execution authority and B4 production consumers have exact named owners', () => {
  const allowedOwnerImports = [
    "import { CODEX_M251_WORKER_ACTIVITY_POLICY_ID } from '@codeclosure/adapter-codex';",
    "import { WorkflowPhase } from '@codeclosure/domain';",
    "import { bindRuntimeExecutionProfileAuthority } from '@codeclosure/runtime/composition';",
  ];
  for (const source of allowedOwnerImports) {
    assert.deepEqual(violations(source, m251ExecutionAuthorityFixturePath), [], source);
    assert.equal(violations(source, compositionFixturePath).length, 1, source);
  }

  const forbiddenOwnerImports = [
    "import { createCodexWorkerAdapter } from '@codeclosure/adapter-codex';",
    "import { createWorkflowDriver } from '@codeclosure/runtime/composition';",
    "import { FakeWorker } from '@codeclosure/testing';",
  ];
  for (const source of forbiddenOwnerImports) {
    assert.equal(violations(source, m251ExecutionAuthorityFixturePath).length, 1, source);
  }

  assert.equal(
    violations(
      "import { installM251ExecutionAuthority } from './m251-execution-authority.js';",
      trustedCompositionFixturePath,
    ).length,
    1,
  );
  assert.deepEqual(
    violations(
      "import { installM251ExecutionAuthority } from './m251-execution-authority.js';",
      m251ProductionCompositionFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "import type { M251PhaseExecutionAuthorityInput } from './m251-execution-authority.js';",
      m251CodexInvocationFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "import { createM251TrustedCodexInvocation, type M251TrustedCodexProfileAuthority } from './m251-codex-worker-invocation.js';",
      m251ProductionCompositionFixturePath,
    ),
    [],
  );
  assert.equal(
    violations(
      "import { createM251TrustedCodexInvocation } from './m251-codex-worker-invocation.js';",
      trustedCompositionFixturePath,
    ).length,
    1,
  );
});

void test('Slice 7 raw client, workspace, verifier, Store, and Runtime capabilities remain behind exact proof owners', () => {
  assert.deepEqual(
    violations(
      "import { CODEX_WORKER_CANDIDATE_TRUST_POLICY } from '@codeclosure/adapter-codex';",
      m2CodexInvocationFixturePath,
    ),
    [],
  );
  assert.equal(
    violations(
      "import { CODEX_WORKER_CANDIDATE_TRUST_POLICY } from '@codeclosure/adapter-codex';",
      m2ProtectedProofFixturePath,
    ).length,
    1,
  );
  assert.deepEqual(
    violations(
      "import { CODEX_WORKER_DISABLED_FEATURES } from '@codeclosure/adapter-codex';",
      m2CodexInvocationFixturePath,
    ),
    [],
  );
  assert.equal(
    violations(
      "import { CODEX_WORKER_DISABLED_FEATURES } from '@codeclosure/adapter-codex';",
      m2ProtectedProofFixturePath,
    ).length,
    1,
  );
  assert.deepEqual(
    violations(
      "import { startAppServerClient } from '@codeclosure/codex-app-server-client';",
      m2CodexInvocationFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "import { createLocalCommandVerificationRunner } from '@codeclosure/verification-local';",
      m2ProtectedProofFixturePath,
    ),
    [],
  );
  for (const source of [
    "import { startAppServerClient } from '@codeclosure/codex-app-server-client';",
    "import { createLocalCandidateWorkspace } from '@codeclosure/workspace-local';",
    "import { createLocalCommandVerificationRunner } from '@codeclosure/verification-local';",
    "import { openSqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { createProtectedM2WorkflowDriver } from '@codeclosure/runtime/composition';",
  ]) {
    assert.equal(violations(source, demoProofFixturePath).length, 1, source);
  }
  assert.deepEqual(
    violations(
      "import { createTrustedCodexInvocation, type M2CodexAdapterDiagnostic } from './m2-codex-worker-invocation.js';",
      m2ProtectedProofFixturePath,
    ),
    [],
  );
  assert.equal(
    violations(
      "import { createTrustedCodexInvocation, type M2CodexAdapterDiagnostic } from './m2-codex-worker-invocation.js';",
      demoProofFixturePath,
    ).length,
    1,
  );
  assert.equal(
    violations(
      "import type { M2CodexAdapterDiagnostic } from './m2-codex-worker-invocation.js';",
      demoProofFixturePath,
    ).length,
    1,
  );
  assert.deepEqual(
    violations(
      "import { runM2ProtectedDemoProof } from './m2-protected-demo-proof.js';",
      demoProofFixturePath,
    ),
    [],
  );
});

void test('trusted production composition rejects raw or alternate Store open paths', () => {
  const forbidden = [
    "import { openSqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { SqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { applyMigrations } from '@codeclosure/store-sqlite';",
  ];
  for (const source of forbidden) {
    assert.equal(violations(source, sqliteAuthorityFixturePath).length, 1, source);
  }
});

void test('trusted production composition accepts only the closed M1 Fake registry', () => {
  assert.deepEqual(
    violations(
      "import { FakeCandidateSource, FakeVerificationRunner, FakeWorker, M1FakeExecutionProfileName, m1FakeExecutionProfileRecipe, m1FakeExecutionProfileRecipes } from '@codeclosure/testing';",
      runtimeProfilesFixturePath,
    ),
    [],
  );
  assert.equal(
    violations(
      "import { DeterministicIds } from '@codeclosure/testing';",
      runtimeProfilesFixturePath,
    ).length,
    1,
  );
});

void test('trusted composition cannot use internal subpaths, implicit imports, or re-export control capabilities', () => {
  assert.equal(
    violations(
      "import { WorkflowRuntimeKernel } from '@codeclosure/runtime/testing/workflow-runtime';",
      trustedCompositionFixturePath,
    ).length,
    1,
  );
  const forbiddenStore = [
    "import { openSqliteControlStore } from '@codeclosure/store-sqlite/internal';",
    "import * as store from '@codeclosure/store-sqlite';",
    "const store = await import('@codeclosure/store-sqlite');",
    "export { openSqliteControlStore } from '@codeclosure/store-sqlite';",
    "import { openVerifiedSqliteControlStore } from '@codeclosure/store-sqlite'; export { openVerifiedSqliteControlStore };",
  ];
  for (const source of forbiddenStore) {
    assert.ok(violations(source, sqliteAuthorityFixturePath).length > 0, source);
  }
  assert.equal(
    violations(
      "import { WorkflowRuntimeKernel } from '../../../../packages/runtime/src/workflow-runtime.js';",
      trustedCompositionFixturePath,
    ).length,
    1,
  );
});

void test('restart proof can observe SQLite only through its named narrow observer', () => {
  const source = "import { openCliSqliteAuthority } from './sqlite-authority.js';";
  assert.equal(violations(source, compositionFixturePath).length, 1);
  assert.deepEqual(violations(source, restartObserverFixturePath), []);
  assert.deepEqual(
    violations(
      "import { observeClaimedActiveAttempt } from './m1-restart-proof-observer.js'; void observeClaimedActiveAttempt;",
      restartProofFixturePath,
    ),
    [],
  );

  const forwardedStoreCapabilities = [
    "export { openCliSqliteAuthority } from './sqlite-authority.js';",
    "import { openCliSqliteAuthority } from './sqlite-authority.js'; export { openCliSqliteAuthority };",
    'export function openCliSqliteAuthority(): never { throw new Error("forbidden"); }',
  ];
  for (const forwarded of forwardedStoreCapabilities) {
    assert.ok(violations(forwarded, restartObserverFixturePath).length > 0, forwarded);
  }
  assert.equal(
    violations(
      "import { openCliSqliteAuthority } from './m1-restart-proof-observer.js';",
      restartProofFixturePath,
    ).length,
    1,
  );
});

void test('only the restart proof may use the closed M1 child-process capability', () => {
  const source =
    "import { spawnM1ProofChildProcess } from './m1-proof-child-process.js'; void spawnM1ProofChildProcess;";
  assert.deepEqual(violations(source, restartProofFixturePath), []);
  assert.equal(violations(source, compositionFixturePath).length, 1);
  assert.equal(
    violations('export function spawnAnything(): void {}', proofChildProcessFixturePath).length,
    1,
  );
  assert.ok(
    violations(
      "import { spawnM1ProofChildProcess } from './m1-proof-child-process.js'; export { spawnM1ProofChildProcess };",
      restartProofFixturePath,
    ).length > 0,
  );
});

void test('trusted composition local authority has exact named consumers and one re-export root', () => {
  const untrustedSupportImports = [
    "import { createTrustedCliComposition } from './trusted-composition.js';",
    "import { createCliComposition } from './trusted-composition.js';",
  ];
  for (const source of untrustedSupportImports) {
    assert.equal(violations(source, compositionFixturePath).length, 1, source);
  }

  assert.deepEqual(
    violations(
      "import { createCliCommandId, createCliComposition, createTrustedCliComposition, type CliComposition, type CreateCliCompositionOptions, type TrustedCliComposition } from './trusted-composition.js';",
      profileProofFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "import { createCliCommandId, createCliComposition, createTrustedCliComposition, type CreateCliCompositionOptions, type TrustedCliComposition } from './trusted-composition.js';",
      staleCloseoutProofFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "import { createCliComposition, type CreateCliCompositionOptions } from './trusted-composition.js';",
      proofReadFacadeFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "import type { CreateCliCompositionOptions } from './trusted-composition.js';",
      restartProofFixturePath,
    ),
    [],
  );
  assert.deepEqual(
    violations(
      "export { createCliComposition } from './trusted-composition.js';",
      compositionRootFixturePath,
    ),
    [],
  );

  const unapprovedConsumers = [
    [
      profileProofFixturePath,
      "import { validateCliStartProfileName } from './trusted-composition.js';",
    ],
    [
      proofReadFacadeFixturePath,
      "import { createTrustedCliComposition } from './trusted-composition.js';",
    ],
    [
      restartProofFixturePath,
      "import { CreateCliCompositionOptions } from './trusted-composition.js';",
    ],
  ];
  for (const [filePath, source] of unapprovedConsumers) {
    assert.equal(violations(source, filePath).length, 1, source);
  }
});

void test('authorized proof consumers cannot forward raw trusted composition capabilities', () => {
  const rawForward = [
    "import { createCliComposition } from './trusted-composition.js';",
    'export { createCliComposition };',
  ].join('\n');
  for (const filePath of [
    profileProofFixturePath,
    staleCloseoutProofFixturePath,
    proofReadFacadeFixturePath,
  ]) {
    assert.ok(violations(rawForward, filePath).length > 0, filePath);
  }
});

void test('proof read facade is available only to the exact restart proof consumer', () => {
  const exactImport =
    "import { createM1ProofReadFacade, type M1ProofReadFacade } from './m1-proof-read-facade.js';";
  assert.deepEqual(violations(exactImport, restartProofFixturePath), []);
  assert.equal(violations(exactImport, compositionFixturePath).length, 1);

  const wrongValueOrTypeImports = [
    "import type { createM1ProofReadFacade } from './m1-proof-read-facade.js';",
    "import { M1ProofReadFacade } from './m1-proof-read-facade.js';",
    "import { createM1ProofReadFacade as M1ProofReadFacade } from './m1-proof-read-facade.js';",
  ];
  for (const source of wrongValueOrTypeImports) {
    assert.equal(violations(source, restartProofFixturePath).length, 1, source);
  }
});

void test('only the CLI entry point may invoke the local trusted composition module', () => {
  const source = "import { createCliComposition } from '../composition/index.js';";
  assert.equal(violations(source).length, 1);
  assert.deepEqual(
    violations(
      "import { createCliInvocationComposition } from './composition/index.js';",
      entryPointFixturePath,
    ),
    [],
  );
  assert.equal(
    violations(
      "import { openCliSqliteAuthority } from './composition/sqlite-authority.js';",
      entryPointFixturePath,
    ).length,
    1,
  );
  assert.equal(
    violations("export * from './composition/index.js';", entryPointFixturePath).length,
    1,
  );
});

void test('trusted composition has a closed export manifest and entry import surface', () => {
  const forbiddenRootExports = [
    "export { createTrustedCliComposition } from './trusted-composition.js';",
    "export { openCliSqliteAuthority } from './sqlite-authority.js';",
    "export { createTrustedCliComposition as createCliComposition } from './trusted-composition.js';",
    "export * from './trusted-composition.js';",
  ];
  for (const source of forbiddenRootExports) {
    assert.ok(violations(source, compositionRootFixturePath).length > 0, source);
  }

  const forbiddenEntryImports = [
    "import { createTrustedCliComposition } from './composition/index.js';",
    "import { openCliSqliteAuthority } from './composition/index.js';",
    "import { createCliComposition } from './composition/index.js';",
  ];
  for (const source of forbiddenEntryImports) {
    assert.equal(violations(source, entryPointFixturePath).length, 1, source);
  }
});
