import { z } from 'zod';

import {
  InteractionActionOutcomeDisposition,
  InteractionPublicCapability,
  decodeIntakeCommandOutcome,
  isoTimestamp,
  sha256Digest,
  type CommandId,
  type IntakeCommandOutcome,
  type IntakeDigestVerifier,
  type IsoTimestamp,
  type Sha256Digest,
} from '@codeclosure/domain';

import {
  StoredCommandDisposition,
  decodeJsonValue,
  decodeStoredCommandOutcome,
  storedCommandOutcomeToJson,
  type StoredCommandOutcomeEnvelope,
} from './contracts.js';
import type { DigestProvider } from './ports.js';

const retainedPublicCommandOutcomeAuthoritySchema = z.discriminatedUnion('publicCapability', [
  z
    .object({
      publicCapability: z.literal(InteractionPublicCapability.SUBMIT_INTAKE),
      outcome: z.unknown(),
    })
    .strict(),
  z
    .object({
      publicCapability: z.enum([
        InteractionPublicCapability.START_GOAL,
        InteractionPublicCapability.RESUME_GOAL,
        InteractionPublicCapability.CANCEL_GOAL,
      ]),
      canonicalCommandInputDigest: z.string(),
      completedAt: z.string(),
      outcome: z.unknown(),
    })
    .strict(),
]);

export type RetainedInteractionPublicCommandOutcomeAuthority =
  | Readonly<{
      publicCapability: typeof InteractionPublicCapability.SUBMIT_INTAKE;
      outcome: IntakeCommandOutcome;
    }>
  | Readonly<{
      publicCapability:
        | typeof InteractionPublicCapability.START_GOAL
        | typeof InteractionPublicCapability.RESUME_GOAL
        | typeof InteractionPublicCapability.CANCEL_GOAL;
      canonicalCommandInputDigest: Sha256Digest;
      completedAt: IsoTimestamp;
      outcome: StoredCommandOutcomeEnvelope;
    }>;

export interface InteractionPublicCommandOutcomeProjection {
  readonly commandId: CommandId;
  readonly canonicalCommandInputDigest: Sha256Digest;
  readonly disposition: InteractionActionOutcomeDisposition;
  readonly publicCommandOutcomeDigest: Sha256Digest;
  readonly resultProjectionDigest: Sha256Digest;
  readonly completedAt: IsoTimestamp;
}

/**
 * Maps only strictly decoded retained public-command authority. Facade return
 * wrappers, Driver summaries, current Goal views, and infrastructure-only
 * failures are deliberately outside this input union.
 */
export function mapRetainedInteractionPublicCommandOutcome(
  rawAuthority: unknown,
  digests: DigestProvider & IntakeDigestVerifier,
): InteractionPublicCommandOutcomeProjection {
  const authority = retainedPublicCommandOutcomeAuthoritySchema.parse(rawAuthority);
  if (authority.publicCapability === InteractionPublicCapability.SUBMIT_INTAKE) {
    const outcome = decodeIntakeCommandOutcome(authority.outcome, digests);
    return Object.freeze({
      commandId: outcome.commandId,
      canonicalCommandInputDigest: outcome.canonicalCommandInputDigest,
      disposition: outcome.disposition,
      publicCommandOutcomeDigest: outcome.outcomeDigest,
      resultProjectionDigest: outcome.resultDigest,
      completedAt: outcome.completedAt,
    });
  }

  const outcome = decodeStoredCommandOutcome(decodeJsonValue(authority.outcome));
  return Object.freeze({
    commandId: outcome.output.commandId,
    canonicalCommandInputDigest: sha256Digest(authority.canonicalCommandInputDigest),
    disposition:
      outcome.disposition === StoredCommandDisposition.APPLIED
        ? InteractionActionOutcomeDisposition.APPLIED
        : InteractionActionOutcomeDisposition.REJECTED,
    publicCommandOutcomeDigest: digests.digest(storedCommandOutcomeToJson(outcome)),
    resultProjectionDigest: digests.digest(outcome.output),
    completedAt: isoTimestamp(authority.completedAt),
  });
}
