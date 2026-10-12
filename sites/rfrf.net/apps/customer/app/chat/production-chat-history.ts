import type { UIMessage } from 'ai';

interface ExternalMessageEntry {
  parentId: string | null;
  message: UIMessage;
}

export interface ChatExternalState {
  messages: ExternalMessageEntry[];
  headId: string | null;
}

function isUiMessage(value: unknown): value is UIMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'role' in value &&
    (value.role === 'system' ||
      value.role === 'user' ||
      value.role === 'assistant') &&
    'parts' in value &&
    Array.isArray(value.parts)
  );
}

export function messagesFromExternalState(value: unknown): UIMessage[] {
  if (!value || typeof value !== 'object' || !('messages' in value)) return [];
  const entries = value.messages;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !('message' in entry)) return [];
    return isUiMessage(entry.message) ? [entry.message] : [];
  });
}

export function mergeChatMessagePages(
  older: UIMessage[],
  current: UIMessage[],
): UIMessage[] {
  const byId = new Map<string, UIMessage>();
  for (const message of [...older, ...current]) {
    if (message.id) byId.set(message.id, message);
  }
  return [...byId.values()];
}

export function externalStateFromMessages(
  messages: UIMessage[],
): ChatExternalState {
  return {
    messages: messages.map((message, index) => ({
      parentId: index > 0 ? (messages[index - 1]?.id ?? null) : null,
      message,
    })),
    headId: messages.at(-1)?.id ?? null,
  };
}
