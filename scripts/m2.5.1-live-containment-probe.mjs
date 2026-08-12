import { m251LiveContainmentDigest } from './m2.5.1-live-containment-lib.mjs';

class M251LiveContainmentProbeError extends TypeError {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'M251LiveContainmentProbeError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new M251LiveContainmentProbeError(reasonCode, message);
}

export function m251LiveContainmentFailureReasonCode(error) {
  return error instanceof M251LiveContainmentProbeError ? error.reasonCode : 'UNCLASSIFIED_FAILURE';
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
    (sandbox.excludeSlashTmp ?? false) !== (input.expectedSandboxType === 'workspaceWrite') ||
    (sandbox.excludeTmpdirEnvVar ?? false) !== (input.expectedSandboxType === 'workspaceWrite') ||
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
        excludeSlashTmp: input.expectedSandboxType === 'workspaceWrite',
        excludeTmpdirEnvVar: input.expectedSandboxType === 'workspaceWrite',
        networkAccess: false,
        type: sandbox.type,
        writableRoots: Object.freeze([]),
      }),
      serviceTier: response.serviceTier,
      threadId: thread.id,
    }),
  });
}

function commandFailureReasonCode(exitCode, phase, deniedBoundaries) {
  const deniedBoundary = deniedBoundaries[exitCode - 50];
  if (exitCode === 40) {
    return phase === 'IMPLEMENT' ? 'CANDIDATE_WRITE_FAILED' : 'SELECTED_SOURCE_READ_FAILED';
  }
  if (exitCode === 41 && phase !== 'IMPLEMENT') {
    return 'READ_ONLY_SNAPSHOT_WRITE_SUCCEEDED';
  }
  return deniedBoundary === undefined
    ? 'COMMAND_EXIT_NON_ZERO'
    : `DENIED_BOUNDARY_READ_SUCCEEDED_${deniedBoundary.kind}`;
}

function commandRequestFailureReasonCode(error) {
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? Reflect.get(error, 'code')
      : undefined;
  const code =
    typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(rawCode) ? rawCode : 'UNKNOWN';
  const rawDetail =
    typeof error === 'object' && error !== null && 'detail' in error
      ? Reflect.get(error, 'detail')
      : undefined;
  const protocolCode =
    typeof rawDetail === 'object' &&
    rawDetail !== null &&
    'protocolCode' in rawDetail &&
    Number.isSafeInteger(Reflect.get(rawDetail, 'protocolCode'))
      ? Reflect.get(rawDetail, 'protocolCode')
      : undefined;
  const protocolSuffix =
    typeof protocolCode === 'number'
      ? `_PROTOCOL_${protocolCode < 0 ? 'NEG_' : ''}${String(Math.abs(protocolCode))}`
      : '';
  return `COMMAND_REQUEST_${code}${protocolSuffix}`;
}

export async function runM251LiveContainmentProbe(input) {
  const forbiddenEffects = new Set();
  let approvalRequestCount = 0;
  let client;
  let shutdownClean = false;
  const recordNotification = (notification) => {
    if (
      notification.method === 'item/started' ||
      notification.method === 'item/completed' ||
      notification.method === 'turn/completed' ||
      notification.method === 'command/exec/outputDelta'
    ) {
      forbiddenEffects.add(notification.method);
    }
  };
  if (input.launch.summary?.defaultPermissionProfileId !== input.phaseEntry.permissionProfileId) {
    fail(
      'LAUNCH_PERMISSION_PROFILE_MISMATCH',
      'Controlled launch does not select the exact phase permission profile',
    );
  }
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
        developerInstructions: 'This Thread exists only to inspect effective phase isolation.',
        ephemeral: false,
        model: input.sharedProfile.model,
        modelProvider: input.sharedProfile.modelProvider,
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
    let commandExecution;
    try {
      commandExecution = await client.executeProfileBoundSandboxCommand(
        {
          command: input.command,
          cwd: input.cwd,
          permissionProfileId: input.phaseEntry.permissionProfileId,
          timeoutMilliseconds: input.terminalTimeoutMilliseconds,
        },
        { signal: requestOptions.signal },
      );
    } catch (error) {
      fail(
        commandRequestFailureReasonCode(error),
        'Containment command request failed before a response was available',
      );
    }
    const commandRequest = jsonObject(commandExecution.request, 'Command request');
    const commandResponse = jsonObject(commandExecution.response, 'Command response');
    const expectedCommandRequest = Object.freeze({
      command: input.command,
      cwd: input.cwd,
      outputBytesCap: 1_024,
      timeoutMs: input.terminalTimeoutMilliseconds,
    });
    if (input.digestCanonical(commandRequest) !== input.digestCanonical(expectedCommandRequest)) {
      fail('COMMAND_REQUEST_MISMATCH', 'Containment command request was substituted');
    }
    if (
      JSON.stringify(Object.keys(commandResponse).toSorted()) !==
        JSON.stringify(['exitCode', 'stderr', 'stdout']) ||
      !Number.isSafeInteger(commandResponse.exitCode) ||
      typeof commandResponse.stdout !== 'string' ||
      typeof commandResponse.stderr !== 'string'
    ) {
      fail('COMMAND_RESPONSE_INVALID', 'Containment command response is malformed');
    }
    if (commandResponse.exitCode !== 0) {
      fail(
        commandFailureReasonCode(
          commandResponse.exitCode,
          input.phaseEntry.phase,
          input.deniedBoundaries,
        ),
        'Containment command failed under the selected isolation',
      );
    }
    if (commandResponse.stdout !== '' || commandResponse.stderr !== '') {
      fail('COMMAND_OUTPUT_RETAINED', 'Containment command retained output');
    }
    return Object.freeze({
      approvalRequestCount,
      commandDigest: m251LiveContainmentDigest('containment-command-v1', input.command),
      commandExitCode: 0,
      commandRequestDigest: input.digestCanonical(commandRequest),
      commandOutputBytes: 0,
      commandOutputDigest: m251LiveContainmentDigest('command-output-v1', ''),
      commandResponseDigest: input.digestCanonical(commandResponse),
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
