import { Buffer } from 'node:buffer';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { AppServerClientErrorCode, clientError } from './errors.js';
import {
  assertCurrentVerifiedCodexInstallation,
  type VerifiedCodexInstallation,
} from './installation.js';

const processLaunchBrand = Symbol('AppServerProcessLaunch');
const processLaunchInstallation = Symbol('AppServerProcessLaunchInstallation');
const credentialEnvironmentNames = new Set(['OPENAI_API_KEY']);
const requiredEnvironmentNames = Object.freeze([
  'CODEX_HOME',
  'HOME',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
  'PATH',
  'TERM',
  'TMPDIR',
]);

export interface ControlledAppServerLaunchInput {
  readonly codexHome: string;
  readonly credentialEnvironment?: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly executableSearchPath: string;
  readonly installation: VerifiedCodexInstallation;
  readonly locale?: string;
  readonly processHome: string;
  readonly temporaryDirectory: string;
}

export interface AppServerLaunchSummary {
  readonly arguments: readonly string[];
  readonly codexHome: string;
  readonly codexVersion: string;
  readonly cwd: string;
  readonly delegatedExecutableDigest: string;
  readonly environmentNames: readonly string[];
  readonly executablePath: string;
  readonly launcherDigest: string;
  readonly nonSecretEnvironment: Readonly<Record<string, string>>;
  readonly protocolSnapshotDigest: string;
  readonly secretEnvironmentNames: readonly string[];
}

export interface AppServerProcessLaunch {
  readonly [processLaunchBrand]: true;
  readonly [processLaunchInstallation]: VerifiedCodexInstallation;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly executablePath: string;
  readonly summary: AppServerLaunchSummary;
}

function exactDirectory(path: string, field: string): string {
  if (!isAbsolute(path)) {
    throw clientError(
      AppServerClientErrorCode.INVALID_LAUNCH,
      `${field} must be an absolute directory`,
    );
  }
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw clientError(AppServerClientErrorCode.INVALID_LAUNCH, `${field} is unavailable`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw clientError(
      AppServerClientErrorCode.INVALID_LAUNCH,
      `${field} must be a real directory rather than a link or special entry`,
    );
  }
  return realpathSync(path);
}

function credentialEnvironment(
  input: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!credentialEnvironmentNames.has(name) || requiredEnvironmentNames.includes(name)) {
      throw clientError(
        AppServerClientErrorCode.INVALID_LAUNCH,
        'Credential environment name is outside the selected M2 allowlist',
      );
    }
    if (value.length === 0 || Buffer.byteLength(value, 'utf8') > 32 * 1024) {
      throw clientError(
        AppServerClientErrorCode.INVALID_LAUNCH,
        'Credential environment contains an invalid value',
      );
    }
    result[name] = value;
  }
  return Object.freeze(result);
}

function makeLaunch(
  executablePath: string,
  arguments_: readonly string[],
  input: ControlledAppServerLaunchInput,
): AppServerProcessLaunch {
  assertCurrentVerifiedCodexInstallation(input.installation);
  const cwd = exactDirectory(input.cwd, 'cwd');
  const codexHome = exactDirectory(input.codexHome, 'CODEX_HOME');
  const processHome = exactDirectory(input.processHome, 'HOME');
  const temporaryDirectory = exactDirectory(input.temporaryDirectory, 'TMPDIR');
  if (input.executableSearchPath.length === 0 || input.executableSearchPath.length > 16_384) {
    throw clientError(
      AppServerClientErrorCode.INVALID_LAUNCH,
      'The explicit executable search path is invalid',
    );
  }
  const secrets = credentialEnvironment(input.credentialEnvironment);
  const nonSecretEnvironment = Object.freeze({
    CODEX_HOME: codexHome,
    HOME: processHome,
    LANG: input.locale ?? 'C.UTF-8',
    LC_ALL: input.locale ?? 'C.UTF-8',
    NO_COLOR: '1',
    PATH: input.executableSearchPath,
    TERM: 'dumb',
    TMPDIR: temporaryDirectory,
  });
  const environment = Object.freeze({
    ...nonSecretEnvironment,
    ...secrets,
  });
  const secretEnvironmentNames = Object.freeze(Object.keys(secrets).sort());
  const summary: AppServerLaunchSummary = Object.freeze({
    arguments: Object.freeze([...arguments_]),
    codexHome,
    codexVersion: input.installation.profile.version,
    cwd,
    delegatedExecutableDigest: input.installation.profile.delegatedExecutableDigest,
    environmentNames: Object.freeze(Object.keys(environment).sort()),
    executablePath,
    launcherDigest: input.installation.profile.launcherDigest,
    nonSecretEnvironment,
    protocolSnapshotDigest: input.installation.profile.snapshotDigest,
    secretEnvironmentNames,
  });
  return Object.freeze({
    [processLaunchBrand]: true as const,
    [processLaunchInstallation]: input.installation,
    arguments: summary.arguments,
    cwd,
    environment,
    executablePath,
    summary,
  });
}

export function createControlledAppServerLaunch(
  input: ControlledAppServerLaunchInput,
): AppServerProcessLaunch {
  if (input.installation.launcherPath !== input.installation.profile.launcherPath) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Verified launcher path no longer matches its supported profile',
    );
  }
  return makeLaunch(
    input.installation.delegatedExecutablePath,
    Object.freeze(['app-server', '--stdio', '--strict-config']),
    input,
  );
}

export function assertAppServerProcessLaunch(
  launch: unknown,
): asserts launch is AppServerProcessLaunch {
  if (
    typeof launch !== 'object' ||
    launch === null ||
    Reflect.get(launch, processLaunchBrand) !== true
  ) {
    throw clientError(
      AppServerClientErrorCode.INVALID_LAUNCH,
      'App Server process launch was not created by the controlled launch boundary',
    );
  }
  assertCurrentVerifiedCodexInstallation(Reflect.get(launch, processLaunchInstallation));
}

export function createFixtureProcessLaunch(
  input: ControlledAppServerLaunchInput,
  scriptPath: string,
  scenario: string,
): AppServerProcessLaunch {
  if (!isAbsolute(scriptPath) || !lstatSync(scriptPath).isFile()) {
    throw new TypeError('Fixture App Server path must name a regular absolute file');
  }
  return makeLaunch(
    input.installation.launcherPath,
    Object.freeze([realpathSync(scriptPath), scenario, 'app-server', '--stdio', '--strict-config']),
    input,
  );
}

export function createSpawnFailureFixtureProcessLaunch(
  input: ControlledAppServerLaunchInput,
  missingExecutablePath: string,
): AppServerProcessLaunch {
  if (!isAbsolute(missingExecutablePath)) {
    throw new TypeError('Missing fixture executable path must be absolute');
  }
  return makeLaunch(
    missingExecutablePath,
    Object.freeze(['app-server', '--stdio', '--strict-config']),
    input,
  );
}
