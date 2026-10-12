export const CHAT_IMAGE_KINDS = [
  'PART_PHOTO',
  'LABEL_BARCODE',
  'VIN_PLATE',
] as const;
export type ChatImageKind = (typeof CHAT_IMAGE_KINDS)[number];
export interface ChatAttachmentMetadata {
  imageKind: ChatImageKind;
  description?: string;
}

export function chatAttachmentMetadata(
  value: unknown,
): ChatAttachmentMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!CHAT_IMAGE_KINDS.includes(input.imageKind as ChatImageKind)) return null;
  if (
    input.description !== undefined &&
    (typeof input.description !== 'string' || input.description.length > 500)
  )
    return null;
  const description =
    typeof input.description === 'string' ? input.description.trim() : '';
  return {
    imageKind: input.imageKind as ChatImageKind,
    ...(description ? { description } : {}),
  };
}

export function withChatAttachmentMetadata(
  current: Record<string, unknown>,
  key: string,
  metadata: ChatAttachmentMetadata,
) {
  const existing =
    current.attachmentMetadata &&
    typeof current.attachmentMetadata === 'object' &&
    !Array.isArray(current.attachmentMetadata)
      ? (current.attachmentMetadata as Record<string, unknown>)
      : {};
  return { ...existing, [key]: metadata };
}
