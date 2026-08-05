import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const arguments_ = process.argv.slice(2);

function requireCommand(executable, commandArguments, failureMessage) {
  const result = spawnSync(executable, commandArguments, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    throw new TypeError(failureMessage);
  }
  return result.stdout.trim();
}

if (
  arguments_.length !== 2 ||
  arguments_[0] !== '--review-exclusion' ||
  !/^docs\/reviews\/[a-z0-9][a-z0-9-]*\.md$/u.test(arguments_[1] ?? '')
) {
  throw new TypeError('Usage: m2.5-preflight.mjs --review-exclusion docs/reviews/<review>.md');
}

requireCommand(
  process.execPath,
  ['scripts/source-identity.mjs', '--review-exclusion', arguments_[1]],
  'M2.5 opening source identity could not be established',
);

const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
if (
  manifest.packageManager !== 'pnpm@11.1.3' ||
  manifest.engines?.node !== '>=22.22.0 <23' ||
  manifest.engines?.pnpm !== '11.1.3'
) {
  throw new TypeError('M2.5 root toolchain declarations differ from the accepted stack');
}

const nodeVersion = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(process.versions.node);
if (
  nodeVersion?.groups === undefined ||
  Number(nodeVersion.groups.major) !== 22 ||
  Number(nodeVersion.groups.minor) < 22
) {
  throw new TypeError(`Unsupported M2.5 Node version: ${process.version}`);
}

const pnpmVersion = requireCommand(
  'corepack',
  ['pnpm', '--version'],
  'Corepack pnpm is unavailable for M2.5',
);
if (pnpmVersion !== '11.1.3') {
  throw new TypeError(`Unsupported M2.5 pnpm version: ${pnpmVersion || 'UNAVAILABLE'}`);
}

if (
  !existsSync(resolve(repositoryRoot, 'pnpm-lock.yaml')) ||
  !existsSync(resolve(repositoryRoot, 'node_modules'))
) {
  throw new TypeError('M2.5 lockfile or installed dependency tree is unavailable');
}

requireCommand('git', ['diff', '--check'], 'M2.5 source scope contains whitespace errors');
requireCommand(
  'corepack',
  ['pnpm', 'list', '--depth=-1'],
  'M2.5 installed dependency graph is unavailable',
);
requireCommand(
  process.execPath,
  ['scripts/run-m2-slice1-protocol-snapshot.mjs'],
  'M2.5 generated protocol artifacts differ from the pinned snapshot',
);
