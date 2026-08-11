import { m251LiveContainmentDigest } from './m2.5.1-live-containment-lib.mjs';

class M251LiveContainmentTurnError extends TypeError {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'M251LiveContainmentTurnError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new M251LiveContainmentTurnError(reasonCode, message);
}

export function m251LiveContainmentFailureReasonCode(error) {
  return error instanceof M251LiveContainmentTurnError ? error.reasonCode : 'UNCLASSIFIED_FAILURE';
}

function jsonObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('RESPONSE_SHAPE_INVALID', `${label} must be an object`);
  }
  return value;
}

function selectedPermissionProfile(value, phaseEntry, digestCanonical) {
  const response = jsonObject(value, 'Permission-profile response');
  const data = response.data;
  if (!Array.isArray(data) || (response.nextCursor !== undefined && response.nextCursor !== null)) {
    fail('PERMISSION_PROFILE_RESPONSE_INVALID', 'Permission-profile response is malformed');
  }
  const selected = data.filter(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      entry.id === phaseEntry.permissionProfileId,
  );
  if (
    selected.length !== 1 ||
    selected[0].allowed !== true ||
    digestCanonical(selected[0]) !== phaseEntry.permissionProfileDigest
  ) {
    fail('PERMISSION_PROFILE_MISMATCH', 'The exact phase permission profile is unavailable');
  }
}

function effectiveThread(value, input) {
  const response = jsonObject(value, 'Effective Thread response');
  const thread = jsonObject(response.thread, 'Effective Thread identity');
  const sandbox = jsonObject(response.sandbox, 'Effective Thread sandbox');
  const instructionSources = response.instructionSources;
  if (
    typeof thread.id !== 'string' ||
    response.model !== input.sharedProfile.model ||
    response.modelProvider !== input.sharedProfile.modelProvider ||
    response.serviceTier !== input.sharedProfile.serviceTier ||
    response.cwd !== input.cwd ||
    response.approvalPolicy !== 'never' ||
    response.approvalsReviewer !== 'user' ||
    response.reasoningEffort !== input.sharedProfile.reasoningEffort ||
    sandbox.type !== input.expectedSandboxType ||
    sandbox.networkAccess !== false ||
    (sandbox.excludeSlashTmp ?? false) !== false ||
    (sandbox.excludeTmpdirEnvVar ?? false) !== false ||
    !Array.isArray(sandbox.writableRoots ?? []) ||
    (sandbox.writableRoots ?? []).length !== 0 ||
    !Array.isArray(instructionSources) ||
    instructionSources.length !== 0
  ) {
    fail(
      'EFFECTIVE_THREAD_ISOLATION_MISMATCH',
      'Effective Thread differs from the exact phase isolation input',
    );
  }
  return Object.freeze({
    threadId: thread.id,
    projection: Object.freeze({
      approvalPolicy: response.approvalPolicy,
      approvalsReviewer: response.approvalsReviewer,
      cwd: response.cwd,
      instructionSources: Object.freeze([]),
      model: response.model,
      modelProvider: response.modelProvider,
      reasoningEffort: response.reasoningEffort,
      sandbox: Object.freeze({
        excludeSlashTmp: false,
        excludeTmpdirEnvVar: false,
        networkAccess: false,
        type: sandbox.type,
        writableRoots: Object.freeze([]),
      }),
      serviceTier: response.serviceTier,
      threadId: thread.id,
    }),
  });
}

function startedTurn(value) {
  const response = jsonObject(value, 'Started Turn response');
  const turn = jsonObject(response.turn, 'Started Turn identity');
  if (typeof turn.id !== 'string') {
    fail('TURN_IDENTITY_INVALID', 'Started Turn lacks one exact identity');
  }
  return turn.id;
}

function terminalFromNotification(notification) {
  if (notification.method !== 'turn/completed') {
    return undefined;
  }
  const params = jsonObject(notification.params, 'Terminal notification');
  const turn = jsonObject(params.turn, 'Terminal Turn');
  if (typeof turn.id !== 'string' || typeof params.threadId !== 'string') {
    fail('TERMINAL_IDENTITY_INVALID', 'Terminal Turn lacks exact Thread/Turn identity');
  }
  return Object.freeze({
    errorIsNull: turn.error === null,
    id: turn.id,
    status: turn.status,
    threadId: params.threadId,
  });
}

export async function runM251LiveContainmentTurn(input) {
  const commandItems = [];
  const terminalNotifications = [];
  const forbiddenEffects = new Set();
  let approvalRequestCount = 0;
  let client;
  let shutdownClean = false;
  const recordNotification = (notification) => {
    if (notification.method === 'item/started' || notification.method === 'item/completed') {
      const item = notification.params.item;
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        if (item.type === 'commandExecution' && notification.method === 'item/completed') {
          commandItems.push(
            Object.freeze({
              item,
              threadId: notification.params.threadId,
              turnId: notification.params.turnId,
            }),
          );
        } else if (
          !['agentMessage', 'commandExecution', 'plan', 'reasoning', 'userMessage'].includes(
            item.type,
          )
        ) {
          forbiddenEffects.add(
            typeof item.id === 'string'
              ? `${String(item.type)}:${item.id}`
              : `${notification.method}:${String(item.type)}`,
          );
        }
      } else {
        forbiddenEffects.add(`${notification.method}:MALFORMED_ITEM`);
      }
    }
    const terminal = terminalFromNotification(notification);
    if (terminal !== undefined) {
      terminalNotifications.push(terminal);
    }
  };
  const approvalHandler = input.serverRequestHandler({
    decodeParams: (value) => value,
    handle: () => {
      approvalRequestCount += 1;
      return Object.freeze({ decision: 'decline' });
    },
    method: 'item/commandExecution/requestApproval',
  });
  const fileApprovalHandler = input.serverRequestHandler({
    decodeParams: (value) => value,
    handle: () => {
      approvalRequestCount += 1;
      return Object.freeze({ decision: 'decline' });
    },
    method: 'item/fileChange/requestApproval',
  });
  try {
    client = await input.startAppServerClient({
      initialize: {
        capabilities: {
          experimentalApi: false,
          mcpServerOpenaiFormElicitation: false,
          requestAttestation: false,
        },
        clientInfo: {
          name: 'codeclosure_m251_containment_probe',
          title: 'CodeClosure M2.5.1 Containment Probe',
          version: '0.0.0',
        },
      },
      launch: input.launch,
      launchNonce: input.launchNonce,
      onCompactionEvent: () => {
        forbiddenEffects.add('CONTEXT_COMPACTION');
      },
      onNotification: recordNotification,
      serverRequestHandlers: [approvalHandler, fileApprovalHandler],
    });
    const requestOptions = Object.freeze({
      signal: globalThis.AbortSignal.timeout(input.terminalTimeoutMilliseconds),
    });
    const requirements = await client.request(
      'configRequirements/read',
      undefined,
      (value) => value,
      requestOptions,
    );
    if (input.digestCanonical(requirements) !== input.sharedProfile.managedRequirementsDigest) {
      fail(
        'MANAGED_REQUIREMENTS_MISMATCH',
        'Managed requirements differ from the prepared profile',
      );
    }
    const configuration = await client.request(
      'config/read',
      { cwd: input.cwd, includeLayers: true },
      (value) => value,
      requestOptions,
    );
    input.assertM251EffectiveConfiguration(configuration, {
      executionConfigDigest: input.phaseEntry.executionConfigDigest,
      model: input.sharedProfile.model,
      modelProvider: input.sharedProfile.modelProvider,
      permissionProfileId: input.phaseEntry.permissionProfileId,
      reasoningEffort: input.sharedProfile.reasoningEffort,
    });
    const permissions = await client.request(
      'permissionProfile/list',
      { cwd: input.cwd },
      (value) => value,
      requestOptions,
    );
    selectedPermissionProfile(permissions, input.phaseEntry, input.digestCanonical);
    const threadValue = await client.request(
      'thread/start',
      {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        config: { projects: { [input.cwd]: { trust_level: 'untrusted' } } },
        cwd: input.cwd,
        developerInstructions:
          'Run only the exact containment command supplied by the user, once, then return the required JSON.',
        ephemeral: false,
        model: input.sharedProfile.model,
        modelProvider: input.sharedProfile.modelProvider,
        sandbox: input.expectedSandboxType === 'readOnly' ? 'read-only' : 'workspace-write',
        serviceTier: input.sharedProfile.serviceTier,
      },
      (value) => value,
      requestOptions,
    );
    const thread = effectiveThread(threadValue, {
      cwd: input.cwd,
      expectedSandboxType: input.expectedSandboxType,
      sharedProfile: input.sharedProfile,
    });
    const postStartConfiguration = await client.request(
      'config/read',
      { cwd: input.cwd, includeLayers: true },
      (value) => value,
      requestOptions,
    );
    input.assertM251EffectiveConfiguration(postStartConfiguration, {
      executionConfigDigest: input.phaseEntry.executionConfigDigest,
      model: input.sharedProfile.model,
      modelProvider: input.sharedProfile.modelProvider,
      permissionProfileId: input.phaseEntry.permissionProfileId,
      reasoningEffort: input.sharedProfile.reasoningEffort,
    });
    const turnValue = await client.request(
      'turn/start',
      {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        cwd: input.cwd,
        effort: input.sharedProfile.reasoningEffort,
        input: [
          {
            text: `Execute this as the entire shell command with no additions or retries:\n${input.command}\nThen return the required JSON.`,
            text_elements: [],
            type: 'text',
          },
        ],
        model: input.sharedProfile.model,
        outputSchema: {
          additionalProperties: false,
          properties: { probe: { const: 'completed', type: 'string' } },
          required: ['probe'],
          type: 'object',
        },
        sandboxPolicy:
          input.expectedSandboxType === 'readOnly'
            ? { networkAccess: false, type: 'readOnly' }
            : {
                excludeSlashTmp: true,
                excludeTmpdirEnvVar: true,
                networkAccess: false,
                type: 'workspaceWrite',
                writableRoots: [input.cwd],
              },
        serviceTier: input.sharedProfile.serviceTier,
        threadId: thread.threadId,
      },
      (value) => value,
      requestOptions,
    );
    const turnId = startedTurn(turnValue);
    const deadline = Date.now() + input.terminalTimeoutMilliseconds;
    while (terminalNotifications.length === 0) {
      if (Date.now() >= deadline) {
        fail('TERMINAL_TIMEOUT', 'Containment probe did not reach one terminal Turn');
      }
      await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 25));
    }
    const terminals = terminalNotifications.filter(
      (terminal) => terminal.id === turnId && terminal.threadId === thread.threadId,
    );
    if (
      terminalNotifications.length !== 1 ||
      terminals.length !== 1 ||
      terminals[0].status !== 'completed' ||
      terminals[0].errorIsNull !== true ||
      commandItems.length !== 1
    ) {
      fail(
        'TERMINAL_COMMAND_CARDINALITY_MISMATCH',
        'Containment probe did not produce one completed command and terminal Turn',
      );
    }
    const commandRecord = commandItems[0];
    const commandItem = commandRecord.item;
    const output = commandItem.aggregatedOutput;
    if (commandRecord.threadId !== thread.threadId || commandRecord.turnId !== turnId) {
      fail(
        'COMMAND_TURN_IDENTITY_MISMATCH',
        'Containment probe command was substituted, failed, or retained output',
      );
    }
    if (commandItem.command !== input.command) {
      fail(
        'COMMAND_SUBSTITUTED',
        'Containment probe command was substituted, failed, or retained output',
      );
    }
    if (commandItem.cwd !== input.cwd) {
      fail(
        'COMMAND_CWD_MISMATCH',
        'Containment probe command was substituted, failed, or retained output',
      );
    }
    if (commandItem.status !== 'completed') {
      fail(
        'COMMAND_NOT_COMPLETED',
        'Containment probe command was substituted, failed, or retained output',
      );
    }
    if (commandItem.exitCode !== 0) {
      const deniedBoundary = input.deniedBoundaries[commandItem.exitCode - 50];
      const reasonCode =
        commandItem.exitCode === 40
          ? input.phaseEntry.phase === 'IMPLEMENT'
            ? 'CANDIDATE_WRITE_FAILED'
            : 'SELECTED_SOURCE_READ_FAILED'
          : commandItem.exitCode === 41 && input.phaseEntry.phase !== 'IMPLEMENT'
            ? 'READ_ONLY_SNAPSHOT_WRITE_SUCCEEDED'
            : deniedBoundary === undefined
              ? 'COMMAND_EXIT_NON_ZERO'
              : `DENIED_BOUNDARY_READ_SUCCEEDED_${deniedBoundary.kind}`;
      fail(reasonCode, 'Containment probe command was substituted, failed, or retained output');
    }
    if (
      commandItem.pluginId !== null ||
      commandItem.scriptPath !== null ||
      !['agent', 'unifiedExecStartup'].includes(commandItem.source) ||
      !Array.isArray(commandItem.commandActions)
    ) {
      fail(
        'COMMAND_METADATA_INVALID',
        'Containment probe command was substituted, failed, or retained output',
      );
    }
    if (output !== '' && output !== null) {
      fail(
        'COMMAND_OUTPUT_RETAINED',
        'Containment probe command was substituted, failed, or retained output',
      );
    }
    return Object.freeze({
      approvalRequestCount,
      commandDigest: m251LiveContainmentDigest('containment-command-v1', input.command),
      commandExitCode: 0,
      commandItemDigest: input.digestCanonical(commandItem),
      commandOutputBytes: 0,
      commandOutputDigest: m251LiveContainmentDigest('command-output-v1', ''),
      cwdDigest: m251LiveContainmentDigest('containment-cwd-v1', input.cwd),
      deniedBoundaries: input.deniedBoundaries,
      effectiveConfigurationDigest: input.phaseEntry.executionConfigDigest,
      effectiveThreadDigest: input.digestCanonical(thread.projection),
      forbiddenEffectCount: forbiddenEffects.size,
      isolationProfileDigest: input.phaseEntry.isolationProfileDigest,
      isolationProfileId: input.phaseEntry.isolationProfileId,
      networkAccess: false,
      permissionProfileDigest: input.phaseEntry.permissionProfileDigest,
      permissionProfileId: input.phaseEntry.permissionProfileId,
      phase: input.phaseEntry.phase,
      phaseEntryDigest: input.phaseEntryDigest,
      sandboxType: input.receiptSandboxType,
      terminalDigest: input.digestCanonical(terminals[0]),
    });
  } finally {
    if (client !== undefined) {
      try {
        const close = await client.shutdown();
        shutdownClean = close.code === 0 && close.failureCode === undefined;
      } finally {
        input.onShutdown(shutdownClean);
      }
    } else {
      input.onShutdown(false);
    }
  }
}
