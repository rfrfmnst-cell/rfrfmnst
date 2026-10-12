import type { UIMessage } from 'ai';
import { boundAuthoritativeModelContext } from './chat-abuse-policy.ts';

/**
 * The model context of one chat request, safe to replay to models that sign
 * their thinking.
 *
 * Claude 5 models bind each thinking block to the exact conversation before
 * it, and newer Anthropic accounts reject a block whose earlier messages
 * changed. The window drops the oldest messages as a thread grows, so thinking
 * from finished turns is never replayed; removing blocks from the front of the
 * history is allowed, and text and tool calls stay. A trailing assistant
 * message that is being continued (a tool approval) keeps its thinking, and
 * the history before it is bounded exactly as in the request that produced
 * it, so its prefix is unchanged.
 */
export function replayableModelContext<T extends UIMessage>(
  messages: T[],
): T[] {
  const last = messages.at(-1);
  const continuing = last?.role === 'assistant' ? last : undefined;
  const history = continuing ? messages.slice(0, -1) : messages;
  const bounded = boundAuthoritativeModelContext(history).map(withoutReasoning);
  return continuing ? [...bounded, continuing] : bounded;
}

function withoutReasoning<T extends UIMessage>(message: T): T {
  if (!message.parts.some((part) => part.type === 'reasoning')) return message;
  return {
    ...message,
    parts: message.parts.filter((part) => part.type !== 'reasoning'),
  };
}
