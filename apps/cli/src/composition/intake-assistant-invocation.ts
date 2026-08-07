import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  M251_INTAKE_DISABLED_FEATURES,
  M25_INTAKE_PERMISSION_PROFILE_ID,
  createCodexIntakeAssistantAdapter,
} from '@codeclosure/adapter-codex-intake';
import {
  createControlledAppServerLaunch,
  verifyBundledCodexInstallation,
  type AppServerProcessLaunch,
} from '@codeclosure/codex-app-server-client';
import {
  M25_INTAKE_MODEL,
  M25_INTAKE_MODEL_PROVIDER,
  M25_INTAKE_REASONING_EFFORT,
  type AnswerOnlyAssistantInput,
  type AnswerOnlyAssistantResponseV1,
  type IntakeAssistantOperationResult,
  type IntakeAssistantPort,
  type IntentAnalysisAssistantInput,
  type IntentAnalysisAssistantResponseV1,
} from '@codeclosure/runtime';

export interface CreateProductionIntakeAssistantOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly forbiddenRoots: readonly string[];
}

export interface ProductionIntakeAssistantResource {
  readonly assistant: IntakeAssistantPort;
  close(): void;
}

function controlledConfiguration(): string {
  const disabledFeatures = M251_INTAKE_DISABLED_FEATURES.map(
    (feature) => `${feature} = false`,
  ).join('\n');
  return `model = ${JSON.stringify(M25_INTAKE_MODEL)}
model_provider = ${JSON.stringify(M25_INTAKE_MODEL_PROVIDER)}
model_reasoning_effort = ${JSON.stringify(M25_INTAKE_REASONING_EFFORT)}
approval_policy = "never"
default_permissions = "${M25_INTAKE_PERMISSION_PROFILE_ID}"
web_search = "disabled"
include_apps_instructions = false
include_collaboration_mode_instructions = false

[features]
${disabledFeatures}

[orchestrator.mcp]
enabled = false

[orchestrator.skills]
enabled = false

[skills]
include_instructions = false

[skills.bundled]
enabled = false

[permissions.${JSON.stringify(M25_INTAKE_PERMISSION_PROFILE_ID)}]
description = "CodeClosure M2.5 Intake isolated read-only"

[permissions.${JSON.stringify(M25_INTAKE_PERMISSION_PROFILE_ID)}.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"

[permissions.${JSON.stringify(M25_INTAKE_PERMISSION_PROFILE_ID)}.filesystem.":workspace_roots"]
"." = "read"

[permissions.${JSON.stringify(M25_INTAKE_PERMISSION_PROFILE_ID)}.network]
enabled = false
`;
}

function optionalAuthSource(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const configured = environment['CODECLOSURE_M2_AUTH_SOURCE'];
  const candidate = configured ?? join(homedir(), '.codex', 'auth.json');
  if (!existsSync(candidate)) {
    return undefined;
  }
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError('Codex authentication source must be a regular file');
  }
  return realpathSync(candidate);
}

function launchNonce(launch: AppServerProcessLaunch, sequence: number): string {
  return `sha256:${createHash('sha256')
    .update(`${launch.summary.launcherDigest}:${String(sequence)}`)
    .digest('hex')}`;
}

class FreshCodexIntakeAssistant implements IntakeAssistantPort {
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #forbiddenRoots: readonly string[];
  #root: string | undefined;
  #launch: AppServerProcessLaunch | undefined;
  #sequence = 0;
  #closed = false;

  public constructor(options: CreateProductionIntakeAssistantOptions) {
    this.#environment = options.environment;
    this.#forbiddenRoots = Object.freeze([...options.forbiddenRoots]);
  }

  public analyze(
    input: IntentAnalysisAssistantInput,
    signal: AbortSignal,
  ): Promise<IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>> {
    const adapter = this.#nextAdapter();
    return adapter.analyze(input, signal);
  }

  public answer(
    input: AnswerOnlyAssistantInput,
    signal: AbortSignal,
  ): Promise<IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1>> {
    const adapter = this.#nextAdapter();
    return adapter.answer(input, signal);
  }

  public close(): void {
    this.#closed = true;
    if (this.#root !== undefined) {
      try {
        rmSync(this.#root, { force: true, recursive: true });
      } catch {
        // Cleanup cannot rewrite a committed Intake disposition.
      }
      this.#root = undefined;
      this.#launch = undefined;
    }
  }

  #nextAdapter(): ReturnType<typeof createCodexIntakeAssistantAdapter> {
    if (this.#closed) {
      throw new TypeError('Intake assistant resource is closed');
    }
    const launch = this.#prepareLaunch();
    this.#sequence += 1;
    return createCodexIntakeAssistantAdapter({
      launch,
      launchNonce: launchNonce(launch, this.#sequence),
      forbiddenRoots: this.#forbiddenRoots,
    });
  }

  #prepareLaunch(): AppServerProcessLaunch {
    if (this.#launch !== undefined) {
      return this.#launch;
    }
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m2-5-intake-')));
    this.#root = root;
    const codexHome = join(root, 'codex-home');
    const operationCwd = join(root, 'operation');
    const processHome = join(root, 'process-home');
    const processTemporaryDirectory = join(root, 'process-tmp');
    for (const path of [codexHome, operationCwd, processHome, processTemporaryDirectory]) {
      mkdirSync(path, { mode: 0o700 });
    }
    writeFileSync(join(codexHome, 'config.toml'), controlledConfiguration(), { mode: 0o600 });
    writeFileSync(
      join(codexHome, 'requirements.toml'),
      'managed = true\nprofile = "codeclosure-m2-5-intake"\n',
      { mode: 0o600 },
    );
    const authSource = optionalAuthSource(this.#environment);
    if (authSource !== undefined) {
      copyFileSync(authSource, join(codexHome, 'auth.json'));
    }
    const installation = verifyBundledCodexInstallation();
    this.#launch = createControlledAppServerLaunch({
      codexHome,
      cwd: operationCwd,
      executableSearchPath:
        this.#environment['PATH'] ?? `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      installation,
      processHome,
      temporaryDirectory: processTemporaryDirectory,
    });
    return this.#launch;
  }
}

export function createProductionIntakeAssistant(
  options: CreateProductionIntakeAssistantOptions,
): ProductionIntakeAssistantResource {
  const resource = new FreshCodexIntakeAssistant(options);
  return Object.freeze({
    assistant: resource,
    close: (): void => resource.close(),
  });
}
