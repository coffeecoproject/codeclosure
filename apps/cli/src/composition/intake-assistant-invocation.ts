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
  M251_LIVE_INTAKE_DISABLED_FEATURES,
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
  readonly onSafeDiagnostic?: NonNullable<
    Parameters<typeof createCodexIntakeAssistantAdapter>[0]['onSafeDiagnostic']
  >;
}

export interface PreparedIntakeExecutionRootDescriptor {
  readonly root: string;
  readonly codexHome: string;
  readonly operationCwd: string;
  readonly processHome: string;
  readonly processTemporaryDirectory: string;
}

export interface ProductionIntakeAssistantResource {
  readonly assistant: IntakeAssistantPort;
  prepare(): PreparedIntakeExecutionRootDescriptor;
  close(): void;
}

function controlledConfiguration(): string {
  const disabledFeatures = M251_LIVE_INTAKE_DISABLED_FEATURES.map(
    (feature) => `${feature} = false`,
  ).join('\n');
  return `model = ${JSON.stringify(M25_INTAKE_MODEL)}
model_provider = ${JSON.stringify(M25_INTAKE_MODEL_PROVIDER)}
model_reasoning_effort = ${JSON.stringify(M25_INTAKE_REASONING_EFFORT)}
approval_policy = "never"
approvals_reviewer = "user"
default_permissions = "${M25_INTAKE_PERMISSION_PROFILE_ID}"
web_search = "disabled"
check_for_update_on_startup = false
allow_login_shell = false
cli_auth_credentials_store = "file"
include_apps_instructions = false
include_collaboration_mode_instructions = false

[analytics]
enabled = false

[feedback]
enabled = false

[history]
persistence = "none"

[agents]
enabled = false

[apps._default]
enabled = false
destructive_enabled = false
open_world_enabled = false

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

[shell_environment_policy]
inherit = "none"
experimental_use_profile = false

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

interface PreparedIntakeAssistantExecution {
  readonly descriptor: PreparedIntakeExecutionRootDescriptor;
  readonly launch: AppServerProcessLaunch;
}

class FreshCodexIntakeAssistant implements IntakeAssistantPort {
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #forbiddenRoots: readonly string[];
  readonly #onSafeDiagnostic: CreateProductionIntakeAssistantOptions['onSafeDiagnostic'];
  #root: string | undefined;
  #prepared: PreparedIntakeAssistantExecution | undefined;
  #sequence = 0;
  #closed = false;

  public constructor(options: CreateProductionIntakeAssistantOptions) {
    this.#environment = options.environment;
    this.#forbiddenRoots = Object.freeze([...options.forbiddenRoots]);
    this.#onSafeDiagnostic = options.onSafeDiagnostic;
  }

  public prepare(): PreparedIntakeExecutionRootDescriptor {
    if (this.#closed) {
      throw new TypeError('Intake assistant resource is closed');
    }
    return this.#prepareExecution().descriptor;
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
        // Cleanup cannot rewrite a committed Intake disposition. Retain the
        // exact root so a repeated close can retry only that same resource.
        return;
      }
      this.#root = undefined;
      this.#prepared = undefined;
    }
  }

  #nextAdapter(): ReturnType<typeof createCodexIntakeAssistantAdapter> {
    if (this.#closed) {
      throw new TypeError('Intake assistant resource is closed');
    }
    const launch = this.#prepareExecution().launch;
    this.#sequence += 1;
    return createCodexIntakeAssistantAdapter({
      launch,
      launchNonce: launchNonce(launch, this.#sequence),
      forbiddenRoots: this.#forbiddenRoots,
      ...(this.#onSafeDiagnostic === undefined ? {} : { onSafeDiagnostic: this.#onSafeDiagnostic }),
    });
  }

  #prepareExecution(): PreparedIntakeAssistantExecution {
    if (this.#prepared !== undefined) {
      return this.#prepared;
    }
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m2-5-intake-')));
    this.#root = root;
    try {
      const declaredPaths = [
        join(root, 'codex-home'),
        join(root, 'operation'),
        join(root, 'process-home'),
        join(root, 'process-tmp'),
      ];
      for (const path of declaredPaths) {
        mkdirSync(path, { mode: 0o700 });
      }
      const [codexHome, operationCwd, processHome, processTemporaryDirectory] = declaredPaths.map(
        (path) => realpathSync(path),
      );
      if (
        codexHome === undefined ||
        operationCwd === undefined ||
        processHome === undefined ||
        processTemporaryDirectory === undefined
      ) {
        throw new TypeError('Intake assistant execution-root members are incomplete');
      }
      writeFileSync(join(codexHome, 'config.toml'), controlledConfiguration(), { mode: 0o600 });
      const authSource = optionalAuthSource(this.#environment);
      if (authSource !== undefined) {
        copyFileSync(authSource, join(codexHome, 'auth.json'));
      }
      const installation = verifyBundledCodexInstallation();
      const launch = createControlledAppServerLaunch({
        codexHome,
        cwd: operationCwd,
        executableSearchPath:
          this.#environment['PATH'] ?? `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        installation,
        processHome,
        temporaryDirectory: processTemporaryDirectory,
      });
      const prepared = Object.freeze({
        descriptor: Object.freeze({
          root,
          codexHome,
          operationCwd,
          processHome,
          processTemporaryDirectory,
        }),
        launch,
      });
      this.#prepared = prepared;
      return prepared;
    } catch (error) {
      try {
        rmSync(root, { force: true, recursive: true });
      } catch (cleanupError) {
        this.#closed = true;
        throw new AggregateError(
          [error, cleanupError],
          'Intake assistant preparation failed and its execution root could not be removed',
          { cause: cleanupError },
        );
      }
      if (this.#root === root) {
        this.#root = undefined;
        this.#prepared = undefined;
      }
      throw error;
    }
  }
}

export function createProductionIntakeAssistant(
  options: CreateProductionIntakeAssistantOptions,
): ProductionIntakeAssistantResource {
  const resource = new FreshCodexIntakeAssistant(options);
  return Object.freeze({
    assistant: resource,
    prepare: (): PreparedIntakeExecutionRootDescriptor => resource.prepare(),
    close: (): void => resource.close(),
  });
}
