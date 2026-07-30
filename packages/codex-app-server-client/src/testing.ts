import process from 'node:process';

import {
  createFixtureProcessLaunch,
  createSpawnFailureFixtureProcessLaunch,
  type AppServerProcessLaunch,
  type ControlledAppServerLaunchInput,
} from './controlled-launch.js';
import { fixtureVerifiedInstallation } from './installation.js';

export interface FixtureAppServerLaunchInput extends Omit<
  ControlledAppServerLaunchInput,
  'installation'
> {
  readonly executablePath?: string;
  readonly scenario: string;
  readonly scriptPath: string;
}

export function createFixtureAppServerLaunch(
  input: FixtureAppServerLaunchInput,
): AppServerProcessLaunch {
  const { executablePath = process.execPath, scenario, scriptPath, ...launchInput } = input;
  const installation = fixtureVerifiedInstallation(executablePath);
  return createFixtureProcessLaunch({ ...launchInput, installation }, scriptPath, scenario);
}

export function createSpawnFailureAppServerLaunch(
  input: Omit<FixtureAppServerLaunchInput, 'scenario' | 'scriptPath'>,
  missingExecutablePath: string,
): AppServerProcessLaunch {
  const { executablePath = process.execPath, ...launchInput } = input;
  const installation = fixtureVerifiedInstallation(executablePath);
  return createSpawnFailureFixtureProcessLaunch(
    { ...launchInput, installation },
    missingExecutablePath,
  );
}
