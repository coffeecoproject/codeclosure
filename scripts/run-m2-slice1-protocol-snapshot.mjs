import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';

import {
  canonicalizeJsonText,
  compareGeneratedManifests,
  generatedDirectoryManifest,
  parseJsonRejectingDuplicateKeys,
  sha256Bytes,
} from './m2-slice0-probe-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const packageRoot = join(repositoryRoot, 'packages', 'codex-app-server-client');
const checkedTypescriptRoot = join(packageRoot, 'src', 'protocol');
const manifestPath = join(packageRoot, 'protocol', 'codex-schema-snapshot-v1.json');
const surfacePath = join(packageRoot, 'src', 'protocol-surface.ts');
const snapshotProfile = 'codex-schema-snapshot-v1';

const targetByPlatform = Object.freeze({
  'darwin-arm64': Object.freeze({
    packageName: '@openai/codex-darwin-arm64',
    targetTriple: 'aarch64-apple-darwin',
  }),
  'darwin-x64': Object.freeze({
    packageName: '@openai/codex-darwin-x64',
    targetTriple: 'x86_64-apple-darwin',
  }),
  'linux-arm64': Object.freeze({
    packageName: '@openai/codex-linux-arm64',
    targetTriple: 'aarch64-unknown-linux-musl',
  }),
  'linux-x64': Object.freeze({
    packageName: '@openai/codex-linux-x64',
    targetTriple: 'x86_64-unknown-linux-musl',
  }),
  'win32-arm64': Object.freeze({
    packageName: '@openai/codex-win32-arm64',
    targetTriple: 'aarch64-pc-windows-msvc',
  }),
  'win32-x64': Object.freeze({
    packageName: '@openai/codex-win32-x64',
    targetTriple: 'x86_64-pc-windows-msvc',
  }),
});

const selectedStableClientMethods = Object.freeze([
  'config/read',
  'configRequirements/read',
  'initialize',
  'model/list',
  'permissionProfile/list',
  'thread/compact/start',
  'thread/resume',
  'thread/start',
  'turn/interrupt',
  'turn/start',
]);

function fail(message) {
  throw new TypeError(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function run(executable, args, options = {}) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function resolveLauncher() {
  const selected = argument('--codex');
  return resolve(selected ?? run('/usr/bin/which', ['codex'], { maxBuffer: 64 * 1024 }).trim());
}

function regularFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is not a regular file: ${path}`);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    fail(`${label} is not a regular file or executable link: ${path}`);
  }
  if (!lstatSync(realpathSync(path)).isFile()) {
    fail(`${label} does not resolve to a regular file: ${path}`);
  }
  return path;
}

function delegatedExecutable(launcherRealPath) {
  const target = targetByPlatform[`${process.platform}-${process.arch}`];
  if (target === undefined) {
    fail(`Unsupported Codex platform: ${process.platform}-${process.arch}`);
  }
  const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const codexPackageRoot =
    basename(launcherRealPath) === 'codex.js'
      ? dirname(dirname(launcherRealPath))
      : dirname(launcherRealPath);
  const candidates = [
    join(
      codexPackageRoot,
      'node_modules',
      target.packageName,
      'vendor',
      target.targetTriple,
      'bin',
      executableName,
    ),
    join(codexPackageRoot, 'vendor', target.targetTriple, 'bin', executableName),
  ];
  const selected = candidates.find((candidate) => existsSync(candidate));
  if (selected === undefined) {
    fail('The delegated Codex platform executable could not be resolved');
  }
  return Object.freeze({
    architecture: process.arch,
    packageName: target.packageName,
    path: realpathSync(regularFile(selected, 'Delegated Codex executable')),
    platform: process.platform,
    targetTriple: target.targetTriple,
  });
}

function installationIdentity(launcherPath) {
  const launcherRealPath = realpathSync(regularFile(launcherPath, 'Codex launcher'));
  const delegated = delegatedExecutable(launcherRealPath);
  return Object.freeze({
    architecture: delegated.architecture,
    delegatedExecutableDigest: sha256Bytes(readFileSync(delegated.path)),
    delegatedExecutablePath: delegated.path,
    launcherDigest: sha256Bytes(readFileSync(launcherPath)),
    launcherPath,
    launcherRealPath,
    platform: delegated.platform,
    platformPackage: delegated.packageName,
    targetTriple: delegated.targetTriple,
    version: run(launcherPath, ['--version'], { maxBuffer: 64 * 1024 }).trim(),
  });
}

function generate(launcher, temporaryRoot) {
  const roots = Object.freeze({
    jsonA: join(temporaryRoot, 'json-a'),
    jsonB: join(temporaryRoot, 'json-b'),
    tsA: join(temporaryRoot, 'ts-a'),
    tsB: join(temporaryRoot, 'ts-b'),
  });
  for (const root of Object.values(roots)) {
    mkdirSync(root);
  }
  for (const root of [roots.tsA, roots.tsB]) {
    run(launcher, ['app-server', 'generate-ts', '--out', root]);
  }
  for (const root of [roots.jsonA, roots.jsonB]) {
    run(launcher, ['app-server', 'generate-json-schema', '--out', root]);
  }
  const typescriptA = generatedDirectoryManifest(roots.tsA, 'RAW_BYTES');
  const typescriptB = generatedDirectoryManifest(roots.tsB, 'RAW_BYTES');
  const jsonA = generatedDirectoryManifest(roots.jsonA, 'RFC8785_JSON');
  const jsonB = generatedDirectoryManifest(roots.jsonB, 'RFC8785_JSON');
  if (!compareGeneratedManifests(typescriptA, typescriptB).equal) {
    fail('Repeated generated TypeScript output is not raw-byte-identical');
  }
  if (!compareGeneratedManifests(jsonA, jsonB).equal) {
    fail('Repeated generated JSON Schema output is not canonically identical');
  }
  return Object.freeze({ jsonSchema: jsonA, roots, typescript: typescriptA });
}

function methodLiterals(source) {
  return Object.freeze(
    [...source.matchAll(/"method": "([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((value) => value !== undefined)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort(),
  );
}

function protocolSurface(tsRoot) {
  const clientMethods = methodLiterals(readFileSync(join(tsRoot, 'ClientRequest.ts'), 'utf8'));
  const serverRequestMethods = methodLiterals(
    readFileSync(join(tsRoot, 'ServerRequest.ts'), 'utf8'),
  );
  const serverNotificationMethods = methodLiterals(
    readFileSync(join(tsRoot, 'ServerNotification.ts'), 'utf8'),
  );
  const missingSelected = selectedStableClientMethods.filter(
    (method) => !clientMethods.includes(method),
  );
  if (missingSelected.length !== 0) {
    fail(`Selected stable methods are absent: ${missingSelected.join(', ')}`);
  }
  return Object.freeze({ clientMethods, serverNotificationMethods, serverRequestMethods });
}

function requiredSurface(tsRoot) {
  const sources = [
    readFileSync(join(tsRoot, 'ClientRequest.ts'), 'utf8'),
    readFileSync(join(tsRoot, 'ServerRequest.ts'), 'utf8'),
    readFileSync(join(tsRoot, 'ServerNotification.ts'), 'utf8'),
    readFileSync(join(tsRoot, 'v2', 'ThreadItem.ts'), 'utf8'),
  ].join('\n');
  const methods = [
    'initialize',
    'thread/start',
    'thread/resume',
    'thread/compact/start',
    'turn/start',
    'turn/interrupt',
    'turn/steer',
    'turn/completed',
    'contextCompaction',
    'thread/compacted',
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/tool/requestUserInput',
    'mcpServer/elicitation/request',
    'item/tool/call',
  ];
  const missing = methods.filter((method) => !sources.includes(`"${method}"`));
  if (missing.length !== 0) {
    fail(`Required generated protocol surface is absent: ${missing.join(', ')}`);
  }
  const configSource = readFileSync(join(tsRoot, 'v2', 'Config.ts'), 'utf8');
  const configurationFields = [
    ['model_auto_compact_token_limit', 'model_auto_compact_token_limit: bigint | null'],
    [
      'model_auto_compact_token_limit_scope',
      'model_auto_compact_token_limit_scope: AutoCompactTokenLimitScope | null',
    ],
  ];
  const missingFields = configurationFields
    .filter(([, declaration]) => !configSource.includes(declaration))
    .map(([field]) => field);
  if (missingFields.length !== 0) {
    fail(`Required generated configuration fields are absent: ${missingFields.join(', ')}`);
  }
  return Object.freeze({
    configurationFields: Object.freeze(configurationFields.map(([field]) => field)),
    methods: Object.freeze(methods),
  });
}

function identityEntries(manifest) {
  return manifest.entries.map(({ path, digest }) => Object.freeze({ digest, path }));
}

function snapshotManifest(codex, generated) {
  const surface = protocolSurface(generated.roots.tsA);
  const required = requiredSurface(generated.roots.tsA);
  const projection = {
    codex,
    jsonSchema: {
      digest: generated.jsonSchema.digest,
      entries: identityEntries(generated.jsonSchema),
      fileCount: generated.jsonSchema.fileCount,
      profile: generated.jsonSchema.profile,
    },
    protocolSurface: surface,
    requiredStableConfigurationFields: required.configurationFields,
    requiredStableSurface: required.methods,
    selectedStableClientMethods,
    snapshotProfile,
    typescript: {
      digest: generated.typescript.digest,
      entries: identityEntries(generated.typescript),
      fileCount: generated.typescript.fileCount,
      profile: generated.typescript.profile,
    },
  };
  const canonical = canonicalizeJsonText(JSON.stringify(projection), snapshotProfile);
  return Object.freeze({
    schemaVersion: 1,
    ...projection,
    snapshotDigest: sha256Bytes(Buffer.from(canonical, 'utf8')),
  });
}

function surfaceSource(surface) {
  const array = (name, values) =>
    `export const ${name} = Object.freeze(${JSON.stringify(values, null, 2)} as const);`;
  return `// Generated by scripts/run-m2-slice1-protocol-snapshot.mjs. Do not edit.\n\n${array(
    'generatedClientMethods',
    surface.clientMethods,
  )}\n\n${array(
    'generatedServerNotificationMethods',
    surface.serverNotificationMethods,
  )}\n\n${array('generatedServerRequestMethods', surface.serverRequestMethods)}\n\n${array(
    'selectedStableClientMethods',
    selectedStableClientMethods,
  )}\n\nexport type SelectedStableClientMethod = (typeof selectedStableClientMethods)[number];\n`;
}

function canonicalManifest(value) {
  return canonicalizeJsonText(JSON.stringify(value), manifestPath);
}

function updateSnapshot(generated, manifest) {
  rmSync(checkedTypescriptRoot, { force: true, recursive: true });
  mkdirSync(dirname(checkedTypescriptRoot), { recursive: true });
  cpSync(generated.roots.tsA, checkedTypescriptRoot, { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(surfacePath, surfaceSource(manifest.protocolSurface));
}

function checkSnapshot(generated, manifest) {
  if (!existsSync(manifestPath) || !existsSync(checkedTypescriptRoot) || !existsSync(surfacePath)) {
    fail('The checked-in Codex protocol snapshot is incomplete');
  }
  const checkedManifest = parseJsonRejectingDuplicateKeys(
    readFileSync(manifestPath, 'utf8'),
    manifestPath,
  );
  if (canonicalManifest(checkedManifest) !== canonicalManifest(manifest)) {
    fail('The checked-in Codex protocol manifest differs from the installed binary');
  }
  const checkedTypescript = generatedDirectoryManifest(checkedTypescriptRoot, 'RAW_BYTES');
  if (!compareGeneratedManifests(checkedTypescript, generated.typescript).equal) {
    fail('The checked-in generated TypeScript differs from the installed binary');
  }
  if (readFileSync(surfacePath, 'utf8') !== surfaceSource(manifest.protocolSurface)) {
    fail('The checked-in generated protocol method surface is stale');
  }
}

const launcher = resolveLauncher();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m2-slice1-schema-'));
try {
  const codex = installationIdentity(launcher);
  const generated = generate(launcher, temporaryRoot);
  const manifest = snapshotManifest(codex, generated);
  if (process.argv.includes('--update')) {
    updateSnapshot(generated, manifest);
  } else {
    checkSnapshot(generated, manifest);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        codex,
        jsonSchema: {
          digest: generated.jsonSchema.digest,
          fileCount: generated.jsonSchema.fileCount,
        },
        mode: process.argv.includes('--update') ? 'UPDATE' : 'CHECK',
        snapshotDigest: manifest.snapshotDigest,
        typescript: {
          digest: generated.typescript.digest,
          fileCount: generated.typescript.fileCount,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
