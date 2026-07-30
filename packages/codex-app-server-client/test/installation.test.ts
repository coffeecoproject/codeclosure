import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AppServerClientError,
  AppServerClientErrorCode,
  loadBundledCodexProfile,
  verifyBundledCodexInstallation,
} from '@codeclosure/codex-app-server-client';

void test('bundled profile binds the exact Slice 1 binary and canonical schema identity', () => {
  const profile = loadBundledCodexProfile();
  assert.equal(profile.version, 'codex-cli 0.146.0');
  assert.equal(
    profile.snapshotDigest,
    'sha256:0b0bdf534386d796c41596693c451aabaec2526bbac5a7965ab558edc3de8e21',
  );
  const installation = verifyBundledCodexInstallation();
  assert.equal(installation.launcherPath, profile.launcherPath);
  assert.equal(installation.delegatedExecutablePath, profile.delegatedExecutablePath);
});

void test('a different executable path is rejected before an App Server process can start', () => {
  assert.throws(
    () => verifyBundledCodexInstallation('/bin/echo'),
    (error: unknown) =>
      error instanceof AppServerClientError &&
      error.code === AppServerClientErrorCode.VERSION_MISMATCH,
  );
});
