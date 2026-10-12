import type { Experimental_DownloadFunction, UIMessage } from 'ai';
import {
  detectEvidenceImage,
  EVIDENCE_MAX_BYTES,
  isEvidenceStorageKey,
} from '@rafraf/shared/evidence-image';

export const CHAT_IMAGE_MAX_BYTES = EVIDENCE_MAX_BYTES;
export const CHAT_ATTACHMENT_PATH = '/api/chat/attachments';

export type ChatImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

const extensionByMediaType: Record<ChatImageMediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const mediaTypeByExtension: Record<string, ChatImageMediaType> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const storageKeyPattern =
  /^[-\w]+\/[-\w]+\/[-\w]+\.(?:jpg|png|webp)$/;

export class ChatImagePartError extends Error {
  constructor() {
    super('INVALID_CHAT_IMAGE');
    this.name = 'ChatImagePartError';
  }
}

export function isChatImageMediaType(
  value: unknown,
): value is ChatImageMediaType {
  return (
    value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'
  );
}

export function extensionForChatImageMediaType(
  mediaType: ChatImageMediaType,
): string {
  return extensionByMediaType[mediaType];
}

export function mediaTypeForChatAttachmentKey(
  key: string,
): ChatImageMediaType | null {
  const extension = key.split('.').at(-1)?.toLowerCase() ?? '';
  return mediaTypeByExtension[extension] ?? null;
}

export function detectChatImageMediaType(
  bytes: Uint8Array,
): ChatImageMediaType | null {
  return detectEvidenceImage(bytes)?.contentType ?? null;
}

export interface ChatAttachmentReference {
  key: string;
  mediaType: ChatImageMediaType;
  url: URL;
}

export function parseChatAttachmentReference(
  value: string,
  expectedOrigin?: string,
): ChatAttachmentReference | null {
  try {
    const base = expectedOrigin ?? 'https://chat.rafraf.invalid';
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (expectedOrigin && url.origin !== new URL(expectedOrigin).origin) {
      return null;
    }
    if (
      url.pathname !== CHAT_ATTACHMENT_PATH ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }
    const parameters = [...url.searchParams.keys()];
    if (parameters.length !== 1 || parameters[0] !== 'key') return null;
    const key = url.searchParams.get('key') ?? '';
    if (!storageKeyPattern.test(key) || !isEvidenceStorageKey(key)) return null;
    const mediaType = mediaTypeForChatAttachmentKey(key);
    return mediaType ? { key, mediaType, url } : null;
  } catch {
    return null;
  }
}

export function createChatAttachmentUrl(key: string, origin: string): string {
  if (!storageKeyPattern.test(key)) throw new ChatImagePartError();
  const url = new URL(CHAT_ATTACHMENT_PATH, origin);
  url.searchParams.set('key', key);
  return url.toString();
}

export function draftChatAttachmentKeys(draft: unknown): Set<string> {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return new Set();
  }
  const attachments = (draft as Record<string, unknown>).attachments;
  if (!Array.isArray(attachments)) return new Set();
  return new Set(
    attachments.filter(
      (value): value is string =>
        typeof value === 'string' && storageKeyPattern.test(value),
    ),
  );
}

interface OwnedChatImageContext {
  customerId: string;
  threadId: string;
  draft: unknown;
  origin: string;
}

function assertOwnedFilePart(
  part: Extract<UIMessage['parts'][number], { type: 'file' }>,
  context: OwnedChatImageContext,
  requireCurrentOrigin: boolean,
): ChatAttachmentReference {
  if (
    !isChatImageMediaType(part.mediaType) ||
    ('providerReference' in part && part.providerReference != null)
  ) {
    throw new ChatImagePartError();
  }
  const reference = parseChatAttachmentReference(
    part.url,
    requireCurrentOrigin ? context.origin : undefined,
  );
  const allowedKeys = draftChatAttachmentKeys(context.draft);
  if (
    !reference ||
    reference.mediaType !== part.mediaType ||
    !reference.key.startsWith(`${context.customerId}/${context.threadId}/`) ||
    !allowedKeys.has(reference.key)
  ) {
    throw new ChatImagePartError();
  }
  return reference;
}

export function validateLatestUserChatImages(
  message: UIMessage,
  context: OwnedChatImageContext,
): string[] {
  if (message.role !== 'user') return [];
  const files = message.parts.filter(
    (part): part is Extract<UIMessage['parts'][number], { type: 'file' }> =>
      part.type === 'file',
  );
  if (files.length > 2) throw new ChatImagePartError();
  return files.map(
    (part) => assertOwnedFilePart(part, context, true).key,
  );
}

export function resolveOwnedChatImageMessages(
  messages: UIMessage[],
  context: OwnedChatImageContext,
): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message;
    let changed = false;
    const parts = message.parts.map((part) => {
      if (part.type !== 'file') return part;
      const reference = assertOwnedFilePart(part, context, false);
      changed = true;
      return {
        ...part,
        url: createChatAttachmentUrl(reference.key, context.origin),
      };
    });
    return changed ? { ...message, parts } : message;
  });
}

interface OwnedChatImageDownloadOptions extends OwnedChatImageContext {
  getEvidence: (key: string) => Promise<Uint8Array>;
}

export function createOwnedChatImageDownload({
  customerId,
  threadId,
  draft,
  origin,
  getEvidence,
}: OwnedChatImageDownloadOptions): Experimental_DownloadFunction {
  const allowedKeys = draftChatAttachmentKeys(draft);
  return async (downloads) =>
    Promise.all(
      downloads.map(async ({ url }) => {
        const reference = parseChatAttachmentReference(url.toString(), origin);
        if (
          !reference ||
          !reference.key.startsWith(`${customerId}/${threadId}/`) ||
          !allowedKeys.has(reference.key)
        ) {
          throw new ChatImagePartError();
        }
        const bytes = await getEvidence(reference.key);
        const detected = detectChatImageMediaType(bytes);
        if (
          bytes.length === 0 ||
          bytes.length > CHAT_IMAGE_MAX_BYTES ||
          detected !== reference.mediaType
        ) {
          throw new ChatImagePartError();
        }
        return { data: bytes, mediaType: detected };
      }),
    );
}
