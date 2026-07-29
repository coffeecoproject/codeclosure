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
}

export function parseM1RuntimeProfileName(name: string | undefined): M1FakeExecutionProfileName {
  return m1FakeExecutionProfileRecipe(name ?? M1FakeExecutionProfileName.HAPPY_PATH).name;
}

function runtimeProfile(
  installed: InstalledExecutionProfile,
  recipe: ReturnType<typeof m1FakeExecutionProfileRecipe>,
): RuntimeExecutionProfile {
  return Object.freeze({
    schemaVersion: 1,
    profileId: installed.profile.id,
    profileDigest: installed.profile.digest,
    driverVersion: installed.profile.driverVersion,
    worker: new FakeWorker({ fixture: recipe.workerFixture }),
    candidateSource: new FakeCandidateSource(recipe.candidateSourceFixture),
    verification: new FakeVerificationRunner({ fixture: recipe.verificationFixture }),
  });
}

/** Installs the closed M1 registry before publishing any execution capability. */
export function installM1RuntimeProfiles(
  installer: ExecutionProfileInstaller,
  startProfileName: M1FakeExecutionProfileName,
): M1RuntimeProfileRegistry {
  const selectedRecipe = m1FakeExecutionProfileRecipe(startProfileName);
  const profilesById = new Map<string, RuntimeExecutionProfile>();

  for (const recipe of m1FakeExecutionProfileRecipes()) {
    const result = installer.installExecutionProfile(recipe.definition);
    if (result.status === 'PROFILE_CONFLICT') {
      throw new TypeError(
        `Built-in M1 Execution Profile conflicts with retained authority: ${recipe.name}`,
      );
    }
    const installed = result.value;
    const profile = runtimeProfile(installed, recipe);
    profilesById.set(installed.profile.id, profile);
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
  });
}
