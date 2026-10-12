import type { UIMessage } from 'ai';

export const MAX_APPROVAL_REASON_CHARS = 500;

type ToolPartShape = {
  type: string;
  toolCallId?: unknown;
  state?: unknown;
  approval?: {
    id?: unknown;
    approved?: unknown;
    reason?: unknown;
  };
};

function toolParts(message: UIMessage): ToolPartShape[] {
  return message.parts.filter(
    (part) => part.type.startsWith('tool-') || part.type === 'dynamic-tool',
  ) as ToolPartShape[];
}

/**
 * The stored assistant message with the customer's approval responses applied.
 *
 * The client resends the whole assistant message to continue after a tool
 * approval, but the approval signature only covers the tool call, so nothing
 * else in that copy is trusted: text, inputs, outputs, extra parts and
 * metadata come from the stored message. Only `state: 'approval-responded'`
 * and `approval.approved` / `approval.reason` are taken from the client, and
 * only for parts the stored message is still waiting on. Returns null when
 * the messages do not match or no response can be applied.
 */
export function mergeApprovalContinuation<T extends UIMessage>(
  stored: T | undefined,
  incoming: UIMessage,
): T | null {
  if (
    !stored ||
    stored.id !== incoming.id ||
    stored.role !== 'assistant' ||
    incoming.role !== 'assistant'
  )
    return null;
  const storedTools = toolParts(stored);
  const incomingTools = toolParts(incoming);
  if (
    storedTools.length === 0 ||
    storedTools.length !== incomingTools.length ||
    storedTools.some(
      (part, index) =>
        part.type !== incomingTools[index]?.type ||
        part.toolCallId !== incomingTools[index]?.toolCallId,
    )
  )
    return null;

  const responses = new Map<ToolPartShape, ToolPartShape['approval']>();
  for (const [index, part] of storedTools.entries()) {
    if (part.state !== 'approval-requested') continue;
    const response = incomingTools[index];
    if (!response?.approval) continue;
    if (response.approval.id !== part.approval?.id) return null;
    if (response.state !== 'approval-responded') continue;
    const { approved, reason } = response.approval;
    if (typeof approved !== 'boolean') return null;
    if (
      reason !== undefined &&
      (typeof reason !== 'string' || reason.length > MAX_APPROVAL_REASON_CHARS)
    )
      return null;
    responses.set(part, { approved, reason });
  }
  if (responses.size === 0) return null;

  return {
    ...stored,
    parts: stored.parts.map((part) => {
      const response = responses.get(part as ToolPartShape);
      if (!response) return part;
      const approval = (part as ToolPartShape).approval;
      return {
        ...part,
        state: 'approval-responded',
        approval: {
          ...approval,
          approved: response.approved,
          ...(response.reason !== undefined ? { reason: response.reason } : {}),
        },
      };
    }),
  };
}
