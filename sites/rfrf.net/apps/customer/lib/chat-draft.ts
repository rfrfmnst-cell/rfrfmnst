import { sanitizeChatDraft } from './chat-draft-sanitizer.ts';
import { chatAttachmentMetadata } from './chat-attachment-metadata.ts';
import { readPartNumberProvenance } from './chat-part-provenance.ts';

export type { ChatDraft } from './chat-draft-types';
import type { ChatDraft } from './chat-draft-types';

/** Reads a stored draft. Model patches never pass through this trusted reader. */
export function cleanChatDraft(value: unknown): ChatDraft {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const base = sanitizeChatDraft(source);
  const notes =
    typeof source.notes === 'string' ? source.notes.trim().slice(0, 500) : '';
  const attachments = Array.isArray(source.attachments)
    ? source.attachments
        .filter((v): v is string => typeof v === 'string')
        .slice(0, 2)
    : [];
  const metadata =
    source.attachmentMetadata && typeof source.attachmentMetadata === 'object'
      ? (source.attachmentMetadata as Record<string, unknown>)
      : {};
  const attachmentMetadata = Object.fromEntries(
    attachments.flatMap((key) => {
      const parsed = chatAttachmentMetadata(metadata[key]);
      return parsed ? [[key, parsed]] : [];
    }),
  );
  const partNumberProvenance = readPartNumberProvenance(
    source.partNumberProvenance,
    attachments,
  );
  return {
    ...base,
    ...(notes ? { notes } : {}),
    ...(attachments.length ? { attachments, attachmentMetadata } : {}),
    ...(partNumberProvenance ? { partNumberProvenance } : {}),
  };
}
