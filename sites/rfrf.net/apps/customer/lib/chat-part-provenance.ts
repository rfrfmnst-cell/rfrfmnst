import {
  compactIdentifier,
  customerTextContainsIdentifier,
  isPlausiblePartNumber,
  isPossibleGtin,
  isVinShaped,
  normalizeIdentifierText,
} from '@rafraf/shared/part-identifiers';
import type { ChatDraft, PartNumberProvenance } from './chat-draft-types';

export type { PartNumberProvenance } from './chat-draft-types';
export interface TrustedCustomerEvidence {
  messageId: string;
  texts: string[];
  imageKeys: string[];
}

export function isUsableChatPartNumber(value: string): boolean {
  return (
    isPlausiblePartNumber(value) &&
    !isVinShaped(value) &&
    !isPossibleGtin(value)
  );
}

export function readPartNumberProvenance(
  value: unknown,
  attachments: string[],
): PartNumberProvenance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.value !== 'string' || !isUsableChatPartNumber(input.value))
    return undefined;
  if (
    input.source === 'customer_text' &&
    input.status === 'confirmed' &&
    typeof input.messageId === 'string'
  ) {
    return {
      value: normalizeIdentifierText(input.value),
      source: 'customer_text',
      status: 'confirmed',
      messageId: input.messageId,
    };
  }
  if (
    input.source !== 'image_inferred' ||
    !['pending', 'confirmed', 'rejected'].includes(String(input.status)) ||
    typeof input.proposalId !== 'string' ||
    typeof input.evidenceKey !== 'string' ||
    !attachments.includes(input.evidenceKey)
  )
    return undefined;
  return {
    value: normalizeIdentifierText(input.value),
    source: 'image_inferred',
    status: input.status as PartNumberProvenance['status'],
    proposalId: input.proposalId,
    evidenceKey: input.evidenceKey,
  };
}

/** Only the proposed number is accepted from a model; provenance is derived. */
export function applyPartNumberProposal(
  current: ChatDraft,
  proposed: unknown,
  evidence: TrustedCustomerEvidence[],
  proposalId: string,
  trustedExclude: string[] = [],
): ChatDraft {
  if (proposed === undefined) return current;
  if (typeof proposed !== 'string' || !isUsableChatPartNumber(proposed))
    throw new Error('PART_NUMBER_INVALID');
  const value = normalizeIdentifierText(proposed);
  const exclude = [current.phone, current.vin, ...trustedExclude].filter(
    (v): v is string => Boolean(v),
  );
  if (
    exclude.some(
      (entry) => compactIdentifier(entry) === compactIdentifier(value),
    )
  )
    throw new Error('PART_NUMBER_INVALID');
  // Vehicle fields are model patches, so their current year cannot establish
  // that a bare calendar-year number came from a part identifier.
  const matchesVehicleYear =
    /^(?:19[8-9]\d|20[0-2]\d)$/.test(compactIdentifier(value)) ||
    Boolean(
      current.year &&
      compactIdentifier(current.year) === compactIdentifier(value),
    );
  const typed =
    !matchesVehicleYear &&
    evidence.find((entry) =>
      customerTextContainsIdentifier(entry.texts, value, { exclude }),
    );
  if (typed)
    return {
      ...current,
      oemNumber: value,
      partNumberProvenance: {
        value,
        source: 'customer_text',
        status: 'confirmed',
        messageId: typed.messageId,
      },
    };
  const previous = current.partNumberProvenance;
  if (
    previous &&
    compactIdentifier(previous.value) === compactIdentifier(value) &&
    previous.status === 'confirmed'
  )
    return current;
  const evidenceKey = evidence
    .flatMap((entry) => entry.imageKeys)
    .find(
      (key) =>
        current.attachments?.includes(key) &&
        current.attachmentMetadata?.[key]?.imageKind !== 'VIN_PLATE',
    );
  if (!evidenceKey) throw new Error('PART_NUMBER_EVIDENCE_REQUIRED');
  if (
    previous &&
    compactIdentifier(previous.value) === compactIdentifier(value) &&
    previous.evidenceKey === evidenceKey &&
    (previous.status === 'rejected' || previous.status === 'pending')
  )
    return current;
  const rest = { ...current };
  delete rest.oemNumber;
  delete rest.partNumberProvenance;
  return {
    ...rest,
    partNumberProvenance: {
      value,
      source: 'image_inferred',
      status: 'pending',
      proposalId,
      evidenceKey,
    },
  };
}

export function settlePartNumberProposal(
  current: ChatDraft,
  proposalId: string,
  partNumber: string,
  approved: boolean,
): ChatDraft {
  const proposal = current.partNumberProvenance;
  if (
    !proposal ||
    proposal.source !== 'image_inferred' ||
    proposal.proposalId !== proposalId ||
    proposal.value !== partNumber ||
    !isUsableChatPartNumber(partNumber) ||
    !current.attachments?.includes(proposal.evidenceKey ?? '')
  )
    throw new Error('PART_NUMBER_CONFIRMATION_STALE');
  if (proposal.status === (approved ? 'confirmed' : 'rejected')) return current;
  if (proposal.status !== 'pending')
    throw new Error('PART_NUMBER_CONFIRMATION_STALE');
  const rest = { ...current };
  delete rest.oemNumber;
  return {
    ...rest,
    ...(approved ? { oemNumber: proposal.value } : {}),
    partNumberProvenance: {
      ...proposal,
      status: approved ? 'confirmed' : 'rejected',
    },
  };
}

/** Called again inside the RFQ transaction, never from model-owned flags. */
export function assertConfirmedChatPartNumber(draft: ChatDraft): void {
  const provenance = draft.partNumberProvenance;
  if (provenance?.status === 'pending')
    throw new Error('PART_NUMBER_CONFIRMATION_REQUIRED');
  if (!draft.oemNumber) return;
  if (
    !isUsableChatPartNumber(draft.oemNumber) ||
    provenance?.status !== 'confirmed' ||
    compactIdentifier(provenance.value) !== compactIdentifier(draft.oemNumber)
  )
    throw new Error('PART_NUMBER_CONFIRMATION_REQUIRED');
}

export function partNumberConfirmationSummary(draft: ChatDraft) {
  const provenance = draft.partNumberProvenance;
  if (!provenance) return null;
  const { value, source, status, proposalId } = provenance;
  return { value, source, status, ...(proposalId ? { proposalId } : {}) };
}
