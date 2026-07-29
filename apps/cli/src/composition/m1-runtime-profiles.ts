import {
  type ExecutionProfileInstaller,
  type InstalledExecutionProfile,
} from '@codeclosure/runtime';
import {
  type RuntimeExecutionProfile,
  type RuntimeExecutionProfileResolver,
} from '@codeclosure/runtime/composition';
import {
  FakeCandidateSource,
  FakeVerificationRunner,
  FakeWorker,
  M1FakeExecutionProfileName,
  m1FakeExecutionProfileRecipe,
  m1FakeExecutionProfileRecipes,
} from '@codeclosure/testing';

export interface M1RuntimeProfileRegistry {
  readonly startProfile: RuntimeExecutionProfile;
  readonly resolver: RuntimeExecutionProfileResolver;
  readonly scenarioControl: M1RuntimeProfileScenarioControl;
  /** Run-owned fixture telemetry; never part of the Runtime execution facade. */
  readonly proofObservation: {
    readDuplicateResultWorker(): ReturnType<FakeWorker['readObservation']>;
  };
}

export interface M1RuntimeProfileScenarioControl {
  armStaleCloseoutDrift(
    generationId: Parameters<FakeCandidateSource['simulateFrozenDrift']>[0],
  ): void;
}

export function parseM1RuntimeProfileName(name: string | undefined): M1FakeExecutionProfileName {
  return m1FakeExecutionProfileRecipe(name ?? M1FakeExecutionProfileName.HAPPY_PATH).name;
}

interface CreatedRuntimeProfile {
  readonly profile: RuntimeExecutionProfile;
  readonly candidateSource: FakeCandidateSource;
  readonly worker: FakeWorker;
}

function runtimeProfile(
  installed: InstalledExecutionProfile,
  recipe: ReturnType<typeof m1FakeExecutionProfileRecipe>,
): CreatedRuntimeProfile {
  const candidateSource = new FakeCandidateSource(recipe.candidateSourceFixture);
  const worker = new FakeWorker({ fixture: recipe.workerFixture });
  return Object.freeze({
    profile: Object.freeze({
      schemaVersion: 1,
      profileId: installed.profile.id,
      profileDigest: installed.profile.digest,
      driverVersion: installed.profile.driverVersion,
      worker,
      candidateSource,
      verification: new FakeVerificationRunner({ fixture: recipe.verificationFixture }),
    }),
    candidateSource,
    worker,
  });
}

/** Installs the closed M1 registry before publishing any execution capability. */
export function installM1RuntimeProfiles(
  installer: ExecutionProfileInstaller,
  startProfileName: M1FakeExecutionProfileName,
): M1RuntimeProfileRegistry {
  const selectedRecipe = m1FakeExecutionProfileRecipe(startProfileName);
  const profilesById = new Map<string, RuntimeExecutionProfile>();
  const candidateSourcesByName = new Map<M1FakeExecutionProfileName, FakeCandidateSource>();
  const workersByName = new Map<M1FakeExecutionProfileName, FakeWorker>();

  for (const recipe of m1FakeExecutionProfileRecipes()) {
    const result = installer.installExecutionProfile(recipe.definition);
    if (result.status === 'PROFILE_CONFLICT') {
      throw new TypeError(
        `Built-in M1 Execution Profile conflicts with retained authority: ${recipe.name}`,
      );
    }
    const installed = result.value;
    const created = runtimeProfile(installed, recipe);
    profilesById.set(installed.profile.id, created.profile);
    candidateSourcesByName.set(recipe.name, created.candidateSource);
    workersByName.set(recipe.name, created.worker);
  }

  const startProfile = profilesById.get(selectedRecipe.definition.id);
  if (startProfile === undefined) {
    throw new TypeError('Selected M1 Execution Profile was not installed');
  }

  return Object.freeze({
    startProfile,
    resolver: Object.freeze({
      resolve: (installed: Parameters<RuntimeExecutionProfileResolver['resolve']>[0]) => {
        const resolved = profilesById.get(installed.id);
        if (
          resolved?.profileDigest !== installed.digest ||
          resolved.driverVersion !== installed.driverVersion
        ) {
          throw new TypeError(
            'Installed Execution Profile has no exact trusted M1 capability binding',
          );
        }
        return resolved;
      },
    }),
    scenarioControl: Object.freeze({
      armStaleCloseoutDrift: (
        generationId: Parameters<FakeCandidateSource['simulateFrozenDrift']>[0],
      ): void => {
        const source = candidateSourcesByName.get(M1FakeExecutionProfileName.STALE_CLOSEOUT);
        if (source === undefined) {
          throw new TypeError('Stale-closeout Candidate Source is unavailable');
        }
        source.simulateFrozenDrift(generationId);
      },
    }),
    proofObservation: Object.freeze({
      readDuplicateResultWorker: (): ReturnType<FakeWorker['readObservation']> => {
        const worker = workersByName.get(M1FakeExecutionProfileName.DUPLICATE_RESULT);
        if (worker === undefined) {
          throw new TypeError('Duplicate-result FakeWorker is unavailable');
        }
        return worker.readObservation();
      },
    }),
  });
}
