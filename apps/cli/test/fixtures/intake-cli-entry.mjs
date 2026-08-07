import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

import { createCodexIntakeAssistantAdapter } from '@codeclosure/adapter-codex-intake';
import { createFixtureAppServerLaunch } from '@codeclosure/codex-app-server-client/testing';
import { m251IntakeAssistantProfile } from '@codeclosure/runtime';

import { runCli } from '../../dist/index.js';
import { createIntakeCliInvocationCompositionWithAssistant } from '../../dist/composition/trusted-intake-composition.js';

const fixtureScript = fileURLToPath(
  new URL(
    '../../../../packages/adapter-codex-intake/test/fixtures/fake-app-server.mjs',
    import.meta.url,
  ),
);

const fixtureScenarios = new Map([
  ['answer-success', 'v2-observed-sequence'],
  ['cleanup-failure', 'v2-cli-exact-source'],
  ['exact-source', 'v2-cli-exact-source'],
  ['governed-assumption', 'v2-cli-unsupported-assumption'],
  ['project-question', 'v2-cli-exact-source'],
]);

class FixtureIntakeAssistant {
  #forbiddenRoots;
  #injectCleanupFailure;
  #root;
  #launch;
  #sequence = 0;
  #closed = false;

  constructor(fixtureName, forbiddenRoots) {
    const scenario = fixtureScenarios.get(fixtureName);
    if (scenario === undefined) {
      throw new TypeError(`Unknown M2.5 CLI Intake fixture: ${fixtureName}`);
    }
    this.#forbiddenRoots = Object.freeze([...forbiddenRoots]);
    this.#injectCleanupFailure = fixtureName === 'cleanup-failure';
    this.#root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m2-5-cli-fixture-')));
    const codexHome = join(this.#root, 'codex-home');
    const operationCwd = join(this.#root, 'operation');
    const processHome = join(this.#root, 'process-home');
    const processTemporaryDirectory = join(this.#root, 'process-tmp');
    for (const path of [codexHome, operationCwd, processHome, processTemporaryDirectory]) {
      mkdirSync(path, { mode: 0o700 });
    }
    this.#launch = createFixtureAppServerLaunch({
      codexHome,
      cwd: operationCwd,
      executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
      processHome,
      protocolIdentity: Object.freeze({
        version: `codex-cli ${m251IntakeAssistantProfile.codexVersion}`,
        snapshotDigest: m251IntakeAssistantProfile.protocolSnapshotDigest,
      }),
      scenario,
      scriptPath: fixtureScript,
      temporaryDirectory: processTemporaryDirectory,
    });
  }

  analyze(input, signal) {
    return this.#nextAdapter().analyze(input, signal);
  }

  answer(input, signal) {
    return this.#nextAdapter().answer(input, signal);
  }

  close() {
    this.#closed = true;
    try {
      rmSync(this.#root, { force: true, recursive: true });
    } catch {
      // Fixture cleanup cannot rewrite a committed Intake disposition.
    }
    if (this.#injectCleanupFailure) {
      throw new TypeError('Injected M2.5 Intake assistant cleanup failure');
    }
  }

  #nextAdapter() {
    if (this.#closed) {
      throw new TypeError('M2.5 CLI Intake fixture is closed');
    }
    this.#sequence += 1;
    const nonce = `sha256:${createHash('sha256')
      .update(`m2.5-cli-fixture:${String(this.#sequence)}`)
      .digest('hex')}`;
    return createCodexIntakeAssistantAdapter({
      launch: this.#launch,
      launchNonce: nonce,
      forbiddenRoots: this.#forbiddenRoots,
      clientLimits: {
        initializationTimeoutMilliseconds: 1_000,
        requestTimeoutMilliseconds: 1_000,
        shutdownGraceMilliseconds: 1_000,
        shutdownKillMilliseconds: 1_000,
      },
    });
  }
}

function createFixtureIntakeAssistant(fixtureName, forbiddenRoots) {
  const fixture = new FixtureIntakeAssistant(fixtureName, forbiddenRoots);
  return Object.freeze({
    assistant: fixture,
    close: () => fixture.close(),
  });
}

const fixtureName = process.env['CODECLOSURE_M25_ACCEPTANCE_FIXTURE'];
if (fixtureName === undefined) {
  throw new TypeError('M2.5 test-only CLI entry requires an explicit fixture name');
}

process.exitCode = await runCli(process.argv.slice(2), {
  createIntakeComposition: (options) =>
    createIntakeCliInvocationCompositionWithAssistant({
      ...options,
      createAssistant: ({ forbiddenRoots }) =>
        createFixtureIntakeAssistant(fixtureName, forbiddenRoots),
    }),
});
