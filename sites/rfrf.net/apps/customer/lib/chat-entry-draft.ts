export const CHAT_ENTRY_DRAFT_KEY = 'rafraf:chat-entry-draft:v1';
export const CHAT_ENTRY_DRAFT_TTL_MS = 15 * 60 * 1000;
export const CHAT_ENTRY_DRAFT_MAX_LENGTH = 600;

export interface ChatEntryDraft {
  text: string;
  attachmentRequested: boolean;
}

interface StoredChatEntryDraft extends ChatEntryDraft {
  version: 1;
  expiresAt: number;
}

type DraftWriter = Pick<Storage, 'setItem'>;
type DraftReader = Pick<Storage, 'getItem' | 'removeItem'>;

function normalizeText(value: unknown) {
  return typeof value === 'string'
    ? value.trim().slice(0, CHAT_ENTRY_DRAFT_MAX_LENGTH)
    : '';
}

export function hasChatEntryDraftContent(input: Partial<ChatEntryDraft>) {
  return Boolean(
    normalizeText(input.text) || input.attachmentRequested === true,
  );
}

/**
 * Keeps landing-page intake out of URLs, access logs, analytics referrers and
 * browser history. A failed storage write is reported so the caller can avoid
 * navigating away and silently losing the customer's draft.
 */
export function storeChatEntryDraft(
  storage: DraftWriter,
  input: Partial<ChatEntryDraft>,
  now = Date.now(),
) {
  const draft: StoredChatEntryDraft = {
    version: 1,
    text: normalizeText(input.text),
    attachmentRequested: input.attachmentRequested === true,
    expiresAt: now + CHAT_ENTRY_DRAFT_TTL_MS,
  };

  if (!hasChatEntryDraftContent(draft)) return true;

  try {
    storage.setItem(CHAT_ENTRY_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and removes the hand-off atomically from the UI's point of view. The
 * value is never replayed after refresh, and malformed or expired data is
 * discarded instead of reaching a composer.
 */
export function consumeChatEntryDraft(
  storage: DraftReader,
  now = Date.now(),
): ChatEntryDraft | null {
  let raw: string | null;
  try {
    raw = storage.getItem(CHAT_ENTRY_DRAFT_KEY);
    storage.removeItem(CHAT_ENTRY_DRAFT_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<StoredChatEntryDraft>;
    if (
      value.version !== 1 ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= now ||
      (typeof value.text !== 'string' &&
        typeof value.attachmentRequested !== 'boolean')
    ) {
      return null;
    }

    const draft: ChatEntryDraft = {
      text: normalizeText(value.text),
      attachmentRequested: value.attachmentRequested === true,
    };
    return draft.text || draft.attachmentRequested ? draft : null;
  } catch {
    return null;
  }
}
