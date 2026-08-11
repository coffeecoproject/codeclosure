import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import {
  M251_CANDIDATE_FREE_DENIED_BOUNDARIES,
  M251_CANDIDATE_FREE_PHASES,
  M251_IMPLEMENT_DENIED_BOUNDARIES,
  M251_LIVE_CONTAINMENT_RECEIPT_KIND,
  M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION,
  admitM251LiveContainmentAuthorization,
  assertM251LiveContainmentMetadataOnly,
  m251LiveContainmentDigest,
  projectM251CandidateFreeContainmentProbe,
  projectM251CandidateFreeContainmentProbes,
  projectM251ImplementContainmentProbe,
  projectM251LiveContainmentStages,
  validateM251LiveContainmentReceipt,
} from './m2.5.1-live-containment-lib.mjs';
import {
  assertM251LiveCompositionProjectClosure,
  projectM251LiveCompositionProjectIdentity,
} from './m2.5.1-live-composition-lib.mjs';
import { m251ProjectTreeIdentity } from './m2.5.1-live-intake-lib.mjs';
import {
  m251ExactAuthSource,
  m251ExactSourceIdentity,
  m251FileDigest,
  m251MetadataFingerprint,
  m251PnpmVersion,
  m251ProjectObservation,
  m251RemoveOwnedAssessmentRoot,
  m251RootPathDigest,
} from './m2.5.1-live-environment-lib.mjs';
import {
  m251LiveContainmentFailureReasonCode,
  runM251LiveContainmentProbe,
} from './m2.5.1-live-containment-probe.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = join(repositoryRoot, 'scripts', 'fixtures', 'm2.5.1', 'slice0-contract.json');
const terminalTimeoutMilliseconds = 300_000;
let stage = 'ENTRY';
let failureReasonCode;

function fail(message) {
  throw new TypeError(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function jsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`${label} is not one JSON document`);
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function openDeniedStatement(path, exitCode) {
  return `if : 2>/dev/null < ${shellQuote(path)}; then exit ${String(exitCode)}; fi`;
}

function candidateFreeCommand(input) {
  return Object.freeze([
    '/bin/sh',
    '-c',
    [
      `/usr/bin/head -c 1 ${shellQuote(input.selectedReadPath)} >/dev/null 2>&1 || exit 40`,
      `if /usr/bin/printf x 2>/dev/null >> ${shellQuote(input.selectedReadPath)}; then exit 41; fi`,
      ...input.deniedPaths.map(({ path }, index) => openDeniedStatement(path, 50 + index)),
      'exit 0',
    ].join('; '),
  ]);
}

function implementCommand(input) {
  return Object.freeze([
    '/bin/sh',
    '-c',
    [
      `/usr/bin/printf %s ${shellQuote(input.marker)} 2>/dev/null >> ${shellQuote(
        input.allowedWritePath,
      )} || exit 40`,
      ...input.deniedPaths.map(({ path }, index) => openDeniedStatement(path, 50 + index)),
      'exit 0',
    ].join('; '),
  ]);
}

function exactRealFile(path, label) {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(absolute) !== absolute) {
    fail(`${label} must be one exact regular file`);
  }
  return absolute;
}

function ensureDirectory(path) {
  mkdirSync(path, { mode: 0o700, recursive: true });
  return realpathSync(path);
}

function selectedSourcePaths(observation) {
  return observation.sourceTree.entries.map(({ path }) => path);
}

function materializeSelectedTree(sourceRoot, targetRoot, sourceObservation, readOnly) {
  for (const entry of sourceObservation.sourceTree.entries) {
    const sourcePath = exactRealFile(join(sourceRoot, entry.path), 'Selected source member');
    if (m251FileDigest(sourcePath) !== entry.contentDigest) {
      fail('Selected source member differs from the ProjectRead observation');
    }
    const target = join(targetRoot, entry.path);
    mkdirSync(dirname(target), { mode: 0o755, recursive: true });
    copyFileSync(sourcePath, target);
    chmodSync(target, readOnly ? (entry.mode === 'EXECUTABLE' ? 0o555 : 0o444) : 0o644);
  }
  if (readOnly) {
    const directories = [];
    const visit = (path) => {
      directories.push(path);
      for (const name of readdirSync(path)) {
        const member = join(path, name);
        if (lstatSync(member).isDirectory()) {
          visit(member);
        }
      }
    };
    visit(targetRoot);
    for (const path of directories.toReversed()) {
      chmodSync(path, 0o555);
    }
  }
}

function selectedTreeIdentity(root, sourceObservation) {
  const expectedFiles = sourceObservation.sourceTree.entries.map(({ path }) => path).toSorted();
  const expectedDirectories = new Set(['.']);
  for (const path of expectedFiles) {
    let current = dirname(path);
    while (current !== '.') {
      expectedDirectories.add(current);
      current = dirname(current);
    }
  }
  const observedFiles = [];
  const observedDirectories = ['.'];
  const visit = (directory, segments) => {
    for (const name of readdirSync(directory).toSorted()) {
      const path = join(directory, name);
      const relativePath = [...segments, name].join('/');
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        fail('Contained selected-source tree contains a symbolic link');
      }
      if (stat.isDirectory()) {
        observedDirectories.push(relativePath);
        visit(path, [...segments, name]);
      } else if (stat.isFile()) {
        observedFiles.push(relativePath);
      } else {
        fail('Contained selected-source tree contains a special filesystem entry');
      }
    }
  };
  visit(root, []);
  if (
    JSON.stringify(observedFiles.toSorted()) !== JSON.stringify(expectedFiles) ||
    JSON.stringify(observedDirectories.toSorted()) !==
      JSON.stringify([...expectedDirectories].toSorted())
  ) {
    fail('Contained selected-source tree differs from the exact selected shape');
  }
  return m251ProjectTreeIdentity(root).digest;
}

function candidateChangeSetIdentity(candidateRoot, sourceObservation) {
  const changes = sourceObservation.sourceTree.entries
    .map((entry) => {
      const path = exactRealFile(
        join(candidateRoot, entry.path),
        'Candidate selected-source member',
      );
      const contentDigest = m251FileDigest(path);
      return contentDigest === entry.contentDigest
        ? undefined
        : Object.freeze({ kind: 'MODIFIED', path: entry.path, contentDigest });
    })
    .filter((entry) => entry !== undefined);
  if (changes.length !== 1 || changes[0]?.path !== 'src/payment.js') {
    fail('Containment probe Candidate changed outside the exact allowed path');
  }
  return m251LiveContainmentDigest('candidate-probe-change-set-v1', changes);
}

function rootIdentity(paths) {
  const entries = paths
    .map(({ kind, path }) => m251RootPathDigest(kind, path))
    .toSorted((left, right) => left.kind.localeCompare(right.kind));
  return Object.freeze({
    entries: Object.freeze(entries),
    digest: m251LiveContainmentDigest('containment-root-set-v1', entries),
  });
}

function toolchainIdentity(profileAuthority, profileDefinition, runtime, contract) {
  const selected = contract.toolchain.selected;
  const value = Object.freeze({
    nodeVersion: process.version,
    pnpmVersion: m251PnpmVersion(repositoryRoot),
    codexVersion: profileAuthority.installation.profile.version,
    protocolSnapshotDigest: profileAuthority.installation.profile.snapshotDigest,
    launcherDigest: profileAuthority.installation.profile.launcherDigest,
    delegatedExecutableDigest: profileAuthority.installation.profile.delegatedExecutableDigest,
    workerAdapterVersion: profileDefinition.workerAdapterVersion,
    workerActivityPolicyVersion: contract.execution.workerActivityPolicy.version,
  });
  if (
    !/^v22\.\d+\.\d+$/u.test(value.nodeVersion) ||
    !/^11\.\d+\.\d+$/u.test(value.pnpmVersion) ||
    value.codexVersion !== selected.codexVersion ||
    value.protocolSnapshotDigest !== selected.snapshotDigest ||
    value.launcherDigest !== selected.launcherDigest ||
    value.delegatedExecutableDigest !== selected.delegatedExecutableDigest ||
    runtime.M251_REAL_CODEX_EXECUTION_PROFILE_VERSION !==
      contract.execution.executionProfile.version
  ) {
    fail('Live containment toolchain differs from the frozen contract');
  }
  return Object.freeze({ ...value, digest: m251LiveContainmentDigest('toolchain-v1', value) });
}

async function main() {
  const authorization = admitM251LiveContainmentAuthorization(process.env);
  const contract = jsonFile(contractPath, 'M2.5.1 Slice 0 contract');
  const projectPath = realpathSync(
    resolve(
      argument('--project') ??
        process.env.CODECLOSURE_M251_DEMO_PROJECT ??
        '/Users/liushan/Developer/CodeClosureM25Demo',
    ),
  );
  const authSource = m251ExactAuthSource(argument('--auth-source'));
  const protectedCheckPath = exactRealFile(
    join(repositoryRoot, contract.demonstration.protectedCheck.assetPath),
    'Protected Check asset',
  );
  const sourceOpening = m251ExactSourceIdentity(
    repositoryRoot,
    M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION,
  );
  const authOpening = m251MetadataFingerprint(authSource);
  const protectedOpening = m251FileDigest(protectedCheckPath);
  const assessmentRoot = realpathSync(
    mkdtempSync(join(tmpdir(), 'codeclosure-m2-5-1-live-containment-')),
  );
  let receipt;
  let failure;
  let controlledProcessesShutdownClean = true;
  try {
    stage = 'PREFLIGHT';
    const authorityHome = ensureDirectory(join(assessmentRoot, 'authority'));
    const candidateWorkspace = ensureDirectory(join(assessmentRoot, 'candidate'));
    const projectReadWorkspace = ensureDirectory(join(assessmentRoot, 'project-read'));
    const verificationRunRoot = ensureDirectory(join(assessmentRoot, 'verification'));
    const workerRoots = Object.freeze({
      codexHome: join(assessmentRoot, 'worker-codex-home'),
      probeWorkspace: join(assessmentRoot, 'worker-probe'),
      processHome: join(assessmentRoot, 'worker-process-home'),
      stateRoot: join(assessmentRoot, 'worker-state'),
      temporaryDirectory: join(assessmentRoot, 'worker-temporary'),
    });
    const [runtime, domain, workspace, workerInvocation, executionAuthority, adapter, client] =
      await Promise.all([
        import('../packages/runtime/dist/index.js'),
        import('../packages/domain/dist/index.js'),
        import('../packages/workspace-local/dist/index.js'),
        import('../apps/cli/dist/composition/m251-codex-worker-invocation.js'),
        import('../apps/cli/dist/composition/m251-execution-authority.js'),
        import('../packages/adapter-codex/dist/index.js'),
        import('../packages/codex-app-server-client/dist/index.js'),
      ]);
    const projectOpening = m251ProjectObservation(
      projectPath,
      workspace.observeLocalCandidateSourceIdentity,
    );
    const projectIdentity = projectM251LiveCompositionProjectIdentity(
      Object.freeze({
        projectFamily: contract.demonstration.projectFamily,
        gitCommit: contract.demonstration.gitCommit,
        gitTree: contract.demonstration.gitTree,
        sourceTreeDigest: contract.demonstration.sourceTreeDigest,
        sourceGitMetadataDigest: contract.demonstration.sourceGitMetadataDigest,
        selectedSourcePaths: Object.freeze(contract.demonstration.selectedSourcePaths),
        allowedPaths: Object.freeze(contract.demonstration.allowedPaths),
        expectedResult: contract.demonstration.expectedResult,
      }),
      contract.demonstration.protectedCheck,
    );
    if (
      projectOpening.gitCommit !== contract.demonstration.gitCommit ||
      projectOpening.gitTree !== contract.demonstration.gitTree ||
      projectOpening.sourceTreeDigest !== contract.demonstration.sourceTreeDigest ||
      projectOpening.sourceGitMetadataDigest !== contract.demonstration.sourceGitMetadataDigest ||
      projectOpening.workingTreeState !== 'clean' ||
      protectedOpening !== contract.demonstration.protectedCheck.assetDigest
    ) {
      fail('Live containment project differs from the frozen contract');
    }
    const forbiddenRoots = Object.freeze([
      authorityHome,
      realpathSync(dirname(authSource)),
      realpathSync(dirname(protectedCheckPath)),
      verificationRunRoot,
      projectPath,
    ]);
    const profileAuthority = await workerInvocation.prepareM251TrustedCodexProfile({
      authSource,
      candidateWorkspaceRoot: candidateWorkspace,
      forbiddenRoots,
      model: 'gpt-5.6-sol',
      projectReadWorkspaceRoot: projectReadWorkspace,
      roots: workerRoots,
    });
    const digests = new runtime.CanonicalJsonSha256DigestProvider();
    const definition = executionAuthority.createM251FormalExecutionProfileDefinition(
      {
        capabilityRecord: profileAuthority.capabilityRecord,
        managedRequirementsDigest: domain.sha256Digest(
          profileAuthority.sharedProfile.managedRequirementsDigest,
        ),
        controlledStateRootIdentity: profileAuthority.sharedProfile.controlledStateRootIdentity,
        environmentProjectionDigest: domain.sha256Digest(
          profileAuthority.sharedProfile.nonSecretEnvironmentDigest,
        ),
        model: profileAuthority.sharedProfile.model,
        modelProvider: profileAuthority.sharedProfile.modelProvider,
        serviceTier: profileAuthority.sharedProfile.serviceTier,
        reasoningEffort: profileAuthority.sharedProfile.reasoningEffort,
        phaseAuthorities: profileAuthority.phaseAuthorities,
      },
      digests,
    );
    if (definition.schemaVersion !== 2 || definition.externalExecution.schemaVersion !== 3) {
      fail('Live containment requires the formal v3 external-execution Profile');
    }
    const selectedProfileIdentity = Object.freeze({
      id: definition.id,
      version: definition.version,
      digest: digests.digest(domain.executionProfileProjection(definition)),
    });
    const selectedToolchainIdentity = toolchainIdentity(
      profileAuthority,
      definition,
      runtime,
      contract,
    );
    const observationWorkspace = workspace.createLocalProjectReadWorkspace({
      authorityRoots: Object.freeze([authorityHome]),
      ownerId: 'project-read-owner_m251-live-containment',
      workspaceRoot: join(assessmentRoot, 'project-read-observer'),
    });
    const sourceObservation = observationWorkspace.observeSource({
      schemaVersion: 1,
      normalizedProjectRoot: projectPath,
    });
    if (
      JSON.stringify(selectedSourcePaths(sourceObservation)) !==
      JSON.stringify(contract.demonstration.selectedSourcePaths)
    ) {
      fail('ProjectRead source observation differs from the frozen selected source');
    }
    const snapshot = ensureDirectory(join(projectReadWorkspace, 'containment-snapshot'));
    materializeSelectedTree(projectPath, snapshot, sourceObservation, true);
    materializeSelectedTree(projectPath, candidateWorkspace, sourceObservation, false);
    const siblingRoot = ensureDirectory(join(projectReadWorkspace, 'sibling-snapshot'));
    const siblingSentinel = join(siblingRoot, 'sentinel.txt');
    writeFileSync(siblingSentinel, 'non-sensitive sibling sentinel\n', { mode: 0o600 });
    const authoritySentinel = join(authorityHome, 'sentinel.txt');
    writeFileSync(authoritySentinel, 'non-sensitive authority sentinel\n', { mode: 0o600 });
    const credentialSentinel = join(profileAuthority.roots.codexHome, 'credential-sentinel.txt');
    writeFileSync(credentialSentinel, 'non-sensitive credential-root sentinel\n', { mode: 0o600 });
    const projectionExcludedPath = exactRealFile(
      join(projectPath, 'node_modules', '.pnpm-workspace-state-v1.json'),
      'Projection-excluded sentinel',
    );
    const selectedReadPath = exactRealFile(
      join(snapshot, 'package.json'),
      'Selected snapshot file',
    );
    const candidateWritePath = exactRealFile(
      join(candidateWorkspace, 'src', 'payment.js'),
      'Candidate allowed-write file',
    );
    const candidateMarker = randomBytes(32).toString('hex');
    const candidateFreeDenied = Object.freeze([
      { kind: 'AUTHORITY_HOME', path: authoritySentinel },
      { kind: 'CANDIDATE_WORKSPACE', path: candidateWritePath },
      { kind: 'CREDENTIAL_ROOT', path: credentialSentinel },
      { kind: 'PROJECTION_EXCLUDED', path: projectionExcludedPath },
      { kind: 'PROTECTED_ASSET', path: protectedCheckPath },
      { kind: 'SIBLING_SNAPSHOT', path: siblingSentinel },
      { kind: 'SOURCE_CHECKOUT', path: join(projectPath, 'package.json') },
    ]).toSorted((left, right) => left.kind.localeCompare(right.kind));
    const implementDenied = Object.freeze([
      { kind: 'AUTHORITY_HOME', path: authoritySentinel },
      { kind: 'CREDENTIAL_ROOT', path: credentialSentinel },
      { kind: 'PROJECT_READ_SNAPSHOT', path: selectedReadPath },
      { kind: 'PROTECTED_ASSET', path: protectedCheckPath },
      { kind: 'SOURCE_CHECKOUT', path: join(projectPath, 'package.json') },
    ]).toSorted((left, right) => left.kind.localeCompare(right.kind));
    if (
      JSON.stringify(candidateFreeDenied.map(({ kind }) => kind)) !==
        JSON.stringify(M251_CANDIDATE_FREE_DENIED_BOUNDARIES) ||
      JSON.stringify(implementDenied.map(({ kind }) => kind)) !==
        JSON.stringify(M251_IMPLEMENT_DENIED_BOUNDARIES)
    ) {
      fail('Live containment denied-boundary set is inconsistent');
    }
    const phaseEntry = (phase) => {
      const entry = definition.externalExecution.phaseDispatch.find(
        (candidate) => candidate.phase === phase,
      );
      if (entry === undefined) {
        fail(`Live containment Profile lacks ${phase}`);
      }
      return Object.freeze({
        entry,
        digest: digests.digest(domain.externalExecutionPhaseDispatchEntryProjection(entry)),
      });
    };
    const launchFor = (cwd) =>
      client.createControlledAppServerLaunch({
        codexHome: profileAuthority.roots.codexHome,
        cwd,
        executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        installation: profileAuthority.installation,
        processHome: profileAuthority.roots.processHome,
        temporaryDirectory: profileAuthority.roots.temporaryDirectory,
      });
    const shutdownObservation = (clean) => {
      controlledProcessesShutdownClean &&= clean;
    };

    const candidateFreeCommands = [];
    const candidateFreeProbes = [];
    for (const phase of M251_CANDIDATE_FREE_PHASES) {
      stage = `${phase}_PROBE`;
      const snapshotOpeningDigest = selectedTreeIdentity(snapshot, sourceObservation);
      const selectedPhase = phaseEntry(phase);
      const command = candidateFreeCommand({
        selectedReadPath,
        deniedPaths: candidateFreeDenied,
      });
      candidateFreeCommands.push(command);
      const observation = await runM251LiveContainmentProbe({
        assertM251EffectiveConfiguration: adapter.assertM251EffectiveConfiguration,
        command,
        cwd: snapshot,
        deniedBoundaries: Object.freeze(
          candidateFreeDenied.map(({ kind, path }) =>
            Object.freeze({
              kind,
              pathDigest: m251LiveContainmentDigest('denied-path-v1', path),
            }),
          ),
        ),
        digestCanonical: adapter.digestCanonical,
        expectedSandboxType: 'readOnly',
        launch: launchFor(snapshot),
        launchNonce: m251LiveContainmentDigest('launch-nonce-v1', phase),
        onShutdown: shutdownObservation,
        phaseEntry: selectedPhase.entry,
        phaseEntryDigest: selectedPhase.digest,
        receiptSandboxType: 'READ_ONLY',
        serverRequestHandler: client.serverRequestHandler,
        sharedProfile: profileAuthority.sharedProfile,
        startAppServerClient: client.startAppServerClient,
        terminalTimeoutMilliseconds,
      });
      const snapshotClosingDigest = selectedTreeIdentity(snapshot, sourceObservation);
      candidateFreeProbes.push(
        projectM251CandidateFreeContainmentProbe({
          common: observation,
          selectedReadPathDigest: m251LiveContainmentDigest(
            'selected-read-path-v1',
            'package.json',
          ),
          selectedReadSucceeded: true,
          snapshotWriteDenied: true,
          snapshotOpeningDigest,
          snapshotClosingDigest,
        }),
      );
    }
    const candidateFree = projectM251CandidateFreeContainmentProbes(candidateFreeProbes);

    stage = 'IMPLEMENT_PROBE';
    const candidateOpeningDigest = selectedTreeIdentity(candidateWorkspace, sourceObservation);
    const implement = phaseEntry('IMPLEMENT');
    const candidateCommand = implementCommand({
      allowedWritePath: candidateWritePath,
      deniedPaths: implementDenied,
      marker: candidateMarker,
    });
    const implementRun = await runM251LiveContainmentProbe({
      assertM251EffectiveConfiguration: adapter.assertM251EffectiveConfiguration,
      command: candidateCommand,
      cwd: candidateWorkspace,
      deniedBoundaries: Object.freeze(
        implementDenied.map(({ kind, path }) =>
          Object.freeze({
            kind,
            pathDigest: m251LiveContainmentDigest('denied-path-v1', path),
          }),
        ),
      ),
      digestCanonical: adapter.digestCanonical,
      expectedSandboxType: 'workspaceWrite',
      launch: launchFor(candidateWorkspace),
      launchNonce: m251LiveContainmentDigest('launch-nonce-v1', 'IMPLEMENT'),
      onShutdown: shutdownObservation,
      phaseEntry: implement.entry,
      phaseEntryDigest: implement.digest,
      receiptSandboxType: 'WORKSPACE_WRITE',
      serverRequestHandler: client.serverRequestHandler,
      sharedProfile: profileAuthority.sharedProfile,
      startAppServerClient: client.startAppServerClient,
      terminalTimeoutMilliseconds,
    });
    const candidateClosingDigest = selectedTreeIdentity(candidateWorkspace, sourceObservation);
    const candidateChangeSetDigest = candidateChangeSetIdentity(
      candidateWorkspace,
      sourceObservation,
    );
    const implementProbe = projectM251ImplementContainmentProbe({
      common: implementRun,
      allowedWritePathDigest: m251LiveContainmentDigest('allowed-write-path-v1', 'src/payment.js'),
      candidateWriteObserved: true,
      candidateOpeningDigest,
      candidateClosingDigest,
      candidateChangeSetDigest,
    });

    stage = 'CLOSURE';
    const projectClosing = m251ProjectObservation(
      projectPath,
      workspace.observeLocalCandidateSourceIdentity,
    );
    assertM251LiveCompositionProjectClosure(projectOpening, projectClosing);
    const sourceBeforeCleanup = m251ExactSourceIdentity(
      repositoryRoot,
      M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION,
    );
    if (JSON.stringify(sourceOpening) !== JSON.stringify(sourceBeforeCleanup)) {
      fail('Live containment changed the CodeClosure source before cleanup');
    }
    const credentialSourceUnchanged =
      JSON.stringify(authOpening) === JSON.stringify(m251MetadataFingerprint(authSource));
    const protectedAssetUnchanged = protectedOpening === m251FileDigest(protectedCheckPath);
    const selectedRootIdentity = rootIdentity([
      { kind: 'ASSESSMENT_ROOT', path: assessmentRoot },
      { kind: 'AUTHORITY_HOME', path: authorityHome },
      { kind: 'CANDIDATE_WORKSPACE', path: candidateWorkspace },
      { kind: 'CREDENTIAL_ROOT', path: realpathSync(dirname(authSource)) },
      { kind: 'DEMONSTRATION_PROJECT', path: projectPath },
      { kind: 'PROJECT_READ_WORKSPACE', path: projectReadWorkspace },
      { kind: 'PROTECTED_ASSET_ROOT', path: realpathSync(dirname(protectedCheckPath)) },
      { kind: 'VERIFICATION_RUN_ROOT', path: verificationRunRoot },
      ...Object.entries(profileAuthority.roots).map(([kind, path]) => ({
        kind: `WORKER_${kind.replaceAll(/([A-Z])/gu, '_$1').toUpperCase()}`,
        path,
      })),
    ]);
    m251RemoveOwnedAssessmentRoot(assessmentRoot);
    const sourceClosing = m251ExactSourceIdentity(
      repositoryRoot,
      M251_LIVE_CONTAINMENT_REVIEW_EXCLUSION,
    );
    if (JSON.stringify(sourceOpening) !== JSON.stringify(sourceClosing)) {
      fail('Live containment changed the CodeClosure source');
    }
    const closure = Object.freeze({
      assessmentRootRemoved: !existsSync(assessmentRoot),
      candidateRootRemoved: !existsSync(candidateWorkspace),
      controlledProcessesShutdownClean,
      credentialSourceUnchanged,
      projectReadRootRemoved: !existsSync(projectReadWorkspace),
      protectedAssetUnchanged,
      sourceProjectUnchanged: JSON.stringify(projectOpening) === JSON.stringify(projectClosing),
      sourceUnchanged: JSON.stringify(sourceOpening) === JSON.stringify(sourceClosing),
    });
    receipt = Object.freeze({
      schemaVersion: 1,
      kind: M251_LIVE_CONTAINMENT_RECEIPT_KIND,
      authorization,
      stages: projectM251LiveContainmentStages([
        'PREFLIGHT',
        'DISCOVERY_PROBE',
        'PLAN_PROBE',
        'IMPLEMENT_PROBE',
        'CLOSURE',
      ]),
      source: Object.freeze({ opening: sourceOpening, closing: sourceClosing }),
      toolchainIdentity: selectedToolchainIdentity,
      profileIdentity: selectedProfileIdentity,
      projectIdentity,
      rootIdentity: selectedRootIdentity,
      candidateFree,
      implement: implementProbe,
      closure,
      privacy: Object.freeze({
        assistantOrModelContentRetained: false,
        credentialOrAccountContentRetained: false,
        rawCommandRetained: false,
        rawExceptionRetained: false,
        rawProtocolRetained: false,
        reasoningOrTranscriptRetained: false,
        sourceBytesRetained: false,
        unrestrictedCommandOutputRetained: false,
      }),
    });
    const expectedIdentity = Object.freeze({
      source: Object.freeze({ opening: sourceOpening, closing: sourceClosing }),
      toolchainIdentity: selectedToolchainIdentity,
      profileIdentity: selectedProfileIdentity,
      projectIdentity,
      rootIdentity: selectedRootIdentity,
    });
    validateM251LiveContainmentReceipt(receipt, expectedIdentity);
    assertM251LiveContainmentMetadataOnly(receipt, [
      authSource,
      candidateMarker,
      ...candidateFreeCommands.map((command) => JSON.stringify(command)),
      JSON.stringify(candidateCommand),
      ...candidateFreeDenied.map(({ path }) => path),
      ...implementDenied.map(({ path }) => path),
    ]);
  } catch (error) {
    failure = error;
    failureReasonCode = m251LiveContainmentFailureReasonCode(error);
  } finally {
    if (existsSync(assessmentRoot)) {
      try {
        m251RemoveOwnedAssessmentRoot(assessmentRoot);
      } catch {
        failure ??= new TypeError('Live containment assessment-root cleanup failed');
        failureReasonCode ??= 'ASSESSMENT_ROOT_CLEANUP_FAILED';
      }
    }
  }
  if (failure !== undefined || receipt === undefined) {
    process.stderr.write(
      `M2.5.1 live containment failed at ${stage} (${failureReasonCode ?? 'UNCLASSIFIED_FAILURE'})\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

try {
  await main();
} catch {
  process.stderr.write(
    `M2.5.1 live containment failed at ${stage} (${failureReasonCode ?? 'UNCLASSIFIED_FAILURE'})\n`,
  );
  process.exitCode = 1;
}
