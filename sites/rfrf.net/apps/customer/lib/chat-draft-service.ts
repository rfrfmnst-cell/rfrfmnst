import { randomUUID } from 'node:crypto';
import type { UIMessage } from 'ai';
import { ChatMessageRole, ChatThreadStatus, Prisma, prisma } from '@rafraf/db';
import { cleanChatDraft } from './chat-draft.ts';
import { sanitizeChatDraft } from './chat-draft-sanitizer.ts';
import { parseChatAttachmentReference } from './chat-image-parts.ts';
import {
  applyPartNumberProposal,
  assertConfirmedChatPartNumber,
  isUsableChatPartNumber,
  partNumberConfirmationSummary,
  settlePartNumberProposal,
  type TrustedCustomerEvidence,
} from './chat-part-provenance.ts';

async function ownedDraft(
  tx: Prisma.TransactionClient,
  customerId: string,
  threadId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-customer:${customerId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-attachment:${threadId}`}))`;
  const thread = await tx.chatThread.findFirst({
    where: { id: threadId, customerId, status: ChatThreadStatus.ACTIVE },
    include: { customer: { select: { user: { select: { phone: true } } } } },
  });
  if (!thread) throw new Error('THREAD_NOT_FOUND');
  return { thread, draft: cleanChatDraft(thread.draft) };
}

async function trustedEvidence(
  tx: Prisma.TransactionClient,
  threadId: string,
): Promise<TrustedCustomerEvidence[]> {
  const rows = await tx.chatMessage.findMany({
    where: { threadId, role: ChatMessageRole.USER },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: { externalId: true, parts: true },
  });
  return rows.map((row) => {
    const parts = Array.isArray(row.parts) ? row.parts : [];
    const texts: string[] = [];
    const imageKeys: string[] = [];
    for (const raw of parts) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const part = raw as Record<string, unknown>;
      if (part.type === 'text' && typeof part.text === 'string')
        texts.push(part.text);
      if (part.type === 'file' && typeof part.url === 'string') {
        const key = parseChatAttachmentReference(part.url)?.key;
        if (key) imageKeys.push(key);
      }
    }
    return { messageId: row.externalId, texts, imageKeys };
  });
}

export async function updateOwnedDraft(
  customerId: string,
  threadId: string,
  patch: Record<string, unknown>,
  client: typeof prisma = prisma,
) {
  return client.$transaction(async (tx) => {
    const { thread, draft } = await ownedDraft(tx, customerId, threadId);
    const cleanPatch = sanitizeChatDraft(patch);
    const fields = { ...cleanPatch };
    delete fields.oemNumber;
    const nextFields = { ...draft, ...fields };
    if (typeof patch.notes === 'string') {
      const notes = patch.notes.trim().slice(0, 500);
      if (notes) nextFields.notes = notes;
      else delete nextFields.notes;
    }
    const evidence = await trustedEvidence(tx, threadId);
    const templates = evidence.flatMap((entry) =>
      entry.texts.flatMap(
        (text) =>
          text.match(
            /أريد اعتماد العرض المحدد بمعرّف [A-Za-z0-9_-]{10,64}\. اعرض عليّ بطاقة الموافقة قبل التنفيذ\./gu,
          ) ?? [],
      ),
    );
    const phoneDigits = thread.customer.user.phone?.replace(/\D/g, '') ?? '';
    const national = phoneDigits.match(/^(?:00966|966|0)?(5\d{8})$/)?.[1];
    const phoneExclusions = national
      ? [national, `0${national}`, `966${national}`, `00966${national}`]
      : [phoneDigits];
    const next = applyPartNumberProposal(
      nextFields,
      patch.oemNumber,
      evidence,
      randomUUID(),
      [...phoneExclusions, ...templates],
    );
    await tx.chatThread.update({
      where: { id: thread.id },
      data: { draft: next as Prisma.InputJsonValue },
    });
    return {
      draft: next,
      ready:
        Boolean(next.partText && next.make && next.model && next.year) &&
        next.partNumberProvenance?.status !== 'pending',
    };
  });
}

export async function confirmOwnedPartNumber(
  customerId: string,
  threadId: string,
  proposalId: string,
  partNumber: string,
  approved = true,
  client: typeof prisma = prisma,
) {
  return client.$transaction(async (tx) => {
    const { thread, draft } = await ownedDraft(tx, customerId, threadId);
    const next = settlePartNumberProposal(
      draft,
      proposalId,
      partNumber,
      approved,
    );
    await tx.chatThread.update({
      where: { id: thread.id },
      data: { draft: next as Prisma.InputJsonValue },
    });
    return {
      partNumber: approved ? next.oemNumber : null,
      confirmed: approved,
    };
  });
}

export async function validateOwnedVehicle(
  customerId: string,
  threadId: string,
) {
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, customerId, status: ChatThreadStatus.ACTIVE },
  });
  if (!thread) throw new Error('THREAD_NOT_FOUND');
  const draft = cleanChatDraft(thread.draft);
  const vinValid = !draft.vin || /^[A-HJ-NPR-Z0-9]{17}$/.test(draft.vin);
  const oemValid = !draft.oemNumber || isUsableChatPartNumber(draft.oemNumber);
  let partNumberConfirmed = true;
  try {
    assertConfirmedChatPartNumber(draft);
  } catch {
    partNumberConfirmed = false;
  }
  return {
    vinValid,
    oemValid,
    partNumberConfirmed,
    partNumberProvenance: partNumberConfirmationSummary(draft),
    hasVehicle: Boolean(draft.make && draft.model && draft.year),
    requiresHumanReview: !vinValid || !oemValid || !partNumberConfirmed,
  };
}

/** The caller supplies only the #244 merge rebuilt from the stored assistant. */
export async function rejectDeclinedPartNumberConfirmations(
  customerId: string,
  threadId: string,
  message: UIMessage,
  client: typeof prisma = prisma,
) {
  for (const part of message.parts) {
    if (
      (part.type !== 'tool-confirmPartNumber' &&
        !(
          part.type === 'dynamic-tool' && part.toolName === 'confirmPartNumber'
        )) ||
      !('state' in part) ||
      part.state !== 'approval-responded' ||
      part.approval.approved !== false
    )
      continue;
    const input = part.input as { proposalId?: unknown; partNumber?: unknown };
    if (
      typeof input?.proposalId !== 'string' ||
      typeof input.partNumber !== 'string'
    )
      continue;
    try {
      await confirmOwnedPartNumber(
        customerId,
        threadId,
        input.proposalId,
        input.partNumber,
        false,
        client,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'PART_NUMBER_CONFIRMATION_STALE'
      )
        throw error;
    }
  }
}
