import type { UIMessage } from 'ai';

/**
 * The parts of a customer message, rebuilt from an allowlist: text as
 * `{type, text}` and files as `{type, mediaType, url, filename}`. Every other
 * part type is dropped, and so are fields the chat client never sends, such as
 * `providerMetadata` (replayed to the provider as `providerOptions`) and
 * `providerReference` (sent to the provider in place of the checked url).
 */
export function customerMessageParts(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  return parts.flatMap((part): UIMessage['parts'] => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
    if (part.type !== 'file') return [];
    return [
      {
        type: 'file',
        mediaType: part.mediaType,
        url: part.url,
        ...(typeof part.filename === 'string'
          ? { filename: part.filename }
          : {}),
      },
    ];
  });
}

/**
 * The latest request message as the route may store it. A customer message
 * keeps only its id, role and allowlisted parts (no metadata); undefined when
 * no allowed part is left. Assistant messages are returned as received: the
 * route only stores the approval merge built from the stored copy.
 */
export function storableLatestMessage<T extends UIMessage>(
  message: T | undefined,
): T | undefined {
  if (!message || message.role !== 'user') return message;
  const parts = customerMessageParts(message.parts);
  if (parts.length === 0) return undefined;
  return { id: message.id, role: 'user', parts } as T;
}

/**
 * Customer messages with allowlisted parts only, so rows stored before the
 * allowlist never replay client-chosen provider data. A customer message with
 * no allowed part left is dropped.
 */
export function withCustomerPartsOnly<T extends UIMessage>(messages: T[]): T[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user') return [message];
    const parts = customerMessageParts(message.parts);
    return parts.length ? [{ ...message, parts }] : [];
  });
}
