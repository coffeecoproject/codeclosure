import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  CanonicalJsonSha256DigestProvider,
  decodeProtectedAssetReadLease,
  protectedAssetManifestProjection,
  protectedAssetReadLeaseProjection,
  sha256Digest,
  type ProtectedAssetReadLeaseAuthorityPort,
  type ProtectedAssetReadLease,
  type ProtectedVerificationAsset,
  type Sha256Digest,
} from '@codeclosure/runtime';

import { LocalCommandRunnerError, VerificationLocalFailureCode } from './errors.js';

export interface ProtectedAssetReadLeaseAuthorityOptions {
  readonly protectedRoots: readonly string[];
}

const digests = new CanonicalJsonSha256DigestProvider();

function sameOrWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function exactProtectedRoot(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || path !== path.normalize('NFC')) {
    throw new LocalCommandRunnerError(
      VerificationLocalFailureCode.PROTECTED_ASSET_IDENTITY_MISMATCH,
      'Protected root must be one exact normalized absolute path',
    );
  }
  const stat = lstatSync(path);
  const real = realpathSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || real !== path) {
    throw new LocalCommandRunnerError(
      VerificationLocalFailureCode.PROTECTED_ASSET_IDENTITY_MISMATCH,
      'Protected root must be one exact real directory',
    );
  }
  return real;
}

function fileDigest(path: string): Sha256Digest {
  return sha256Digest(`sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
}

function inspectExactAsset(
  logicalAssetId: string,
  registeredProtectedRootIdentity: string,
  executionPath: string,
): ProtectedVerificationAsset {
  const root = exactProtectedRoot(registeredProtectedRootIdentity);
  if (
    logicalAssetId.trim().length === 0 ||
    logicalAssetId.includes('\u0000') ||
    !isAbsolute(executionPath) ||
    resolve(executionPath) !== executionPath ||
    executionPath !== executionPath.normalize('NFC')
  ) {
    throw new LocalCommandRunnerError(
      VerificationLocalFailureCode.PROTECTED_ASSET_IDENTITY_MISMATCH,
      'Protected asset identity is malformed',
    );
  }
  const stat = lstatSync(executionPath);
  const real = realpathSync(executionPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    real !== executionPath ||
    !sameOrWithin(real, root) ||
    real === root
  ) {
    throw new LocalCommandRunnerError(
      VerificationLocalFailureCode.PROTECTED_ASSET_IDENTITY_MISMATCH,
      'Protected asset is not an exact regular file in its registered root',
    );
  }
  return Object.freeze({
    logicalAssetId,
    registeredProtectedRootIdentity: root,
    exactRealpath: real,
    executionPath: real,
    fileMode: stat.mode & 0o7777,
    byteLength: stat.size,
    contentDigest: fileDigest(real),
    protectionMode: 'OUTSIDE_WORKER_WRITABLE_CANDIDATE' as const,
  });
}

export function inspectProtectedVerificationAsset(input: {
  readonly logicalAssetId: string;
  readonly registeredProtectedRootIdentity: string;
  readonly executionPath: string;
}): ProtectedVerificationAsset {
  return inspectExactAsset(
    input.logicalAssetId,
    input.registeredProtectedRootIdentity,
    input.executionPath,
  );
}

export function protectedVerificationAssetManifestDigest(
  assets: readonly ProtectedVerificationAsset[],
): Sha256Digest {
  return sha256Digest(digests.digest(protectedAssetManifestProjection(assets)));
}

export function createProtectedAssetReadLeaseAuthority(
  options: ProtectedAssetReadLeaseAuthorityOptions,
): ProtectedAssetReadLeaseAuthorityPort {
  const roots = Object.freeze(options.protectedRoots.map(exactProtectedRoot).sort());
  if (roots.length === 0 || new Set(roots).size !== roots.length) {
    throw new LocalCommandRunnerError(
      VerificationLocalFailureCode.PROTECTED_ASSET_IDENTITY_MISMATCH,
      'Protected roots must be a non-empty unique set',
    );
  }
  return Object.freeze({
    assertLeaseCurrent(rawLease: ProtectedAssetReadLease): ProtectedAssetReadLease {
      let lease: ProtectedAssetReadLease;
      try {
        lease = decodeProtectedAssetReadLease(rawLease);
        if (
          sha256Digest(digests.digest(protectedAssetReadLeaseProjection(lease))) !==
          lease.leaseDigest
        ) {
          throw new TypeError('Protected asset lease digest is false');
        }
        const observedAssets = Object.freeze(
          lease.assets.map((asset) => {
            if (!roots.includes(asset.registeredProtectedRootIdentity)) {
              throw new TypeError('Protected asset names an unregistered root');
            }
            return inspectExactAsset(
              asset.logicalAssetId,
              asset.registeredProtectedRootIdentity,
              asset.executionPath,
            );
          }),
        );
        if (
          protectedVerificationAssetManifestDigest(observedAssets) !==
            lease.protectedAssetManifestDigest ||
          JSON.stringify(observedAssets) !== JSON.stringify(lease.assets)
        ) {
          throw new TypeError('Protected asset manifest changed identity');
        }
      } catch (error) {
        throw new LocalCommandRunnerError(
          VerificationLocalFailureCode.PROTECTED_ASSET_IDENTITY_MISMATCH,
          'Protected asset lease is stale, aliased, missing, or content-drifted',
          { cause: error },
        );
      }
      return lease;
    },
  });
}
