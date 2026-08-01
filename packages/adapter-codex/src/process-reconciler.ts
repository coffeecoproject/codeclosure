import {
  decodeAppServerProcessIdentity,
  reconcileAppServerProcess,
} from '@codeclosure/codex-app-server-client';
import {
  ExternalProcessReconciliationDisposition,
  type ExternalProcessReconciler,
} from '@codeclosure/runtime';

type ExternalProcessIdentity = Parameters<ExternalProcessReconciler['reconcile']>[0];

export interface CodexExternalProcessReconcilerLimits {
  readonly gracefulMilliseconds?: number;
  readonly killMilliseconds?: number;
}

/**
 * Trusted host adapter for restart-time process reconciliation.
 *
 * It receives only the protocol-neutral identity already admitted by Runtime;
 * it cannot inspect or mutate Goal, Workflow, Candidate, Evidence, or
 * Acceptance authority.
 */
export class CodexExternalProcessReconciler implements ExternalProcessReconciler {
  readonly #limits: CodexExternalProcessReconcilerLimits;

  public constructor(limits: CodexExternalProcessReconcilerLimits = {}) {
    this.#limits = Object.freeze({ ...limits });
  }

  public reconcile(identity: ExternalProcessIdentity): unknown {
    const processIdentity = decodeAppServerProcessIdentity({
      schemaVersion: identity.schemaVersion,
      launchNonce: identity.launchNonce,
      processId: identity.processId,
      processGroupId: identity.processGroupId,
      processGroupKind: identity.processGroupKind,
      processStartIdentity: identity.processStartIdentity,
      executableIdentityDigest: identity.executableIdentityDigest,
      controlledStateRootIdentity: identity.controlledStateRootIdentity,
    });
    const observed = reconcileAppServerProcess(processIdentity, this.#limits);
    const disposition = ExternalProcessReconciliationDisposition[observed.disposition];
    return Object.freeze({
      schemaVersion: 1,
      processIdentityDigest: identity.identityDigest,
      disposition,
      observationRef: `codex-process:${identity.identityDigest}:${disposition}`,
    });
  }
}

export function createCodexExternalProcessReconciler(
  limits: CodexExternalProcessReconcilerLimits = {},
): CodexExternalProcessReconciler {
  return new CodexExternalProcessReconciler(limits);
}
