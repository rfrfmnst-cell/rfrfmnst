/**
 * Data parts the chat accepts from a client, by name. Empty: the chat never
 * sends data parts. Null prototype, so names such as `toString` or
 * `__proto__` never resolve to a schema through Object.prototype.
 */
export const CHAT_DATA_PART_SCHEMAS: Readonly<Record<string, never>> =
  Object.freeze(Object.assign(Object.create(null), {}));

/** False when any message carries a `data-*` part outside the allowlist. */
export function hasOnlyAllowedDataParts(messages: unknown): boolean {
  if (!Array.isArray(messages)) return true;
  return messages.every((message) => {
    const parts = (message as { parts?: unknown } | null)?.parts;
    if (!Array.isArray(parts)) return true;
    return parts.every((part) => {
      const type = (part as { type?: unknown } | null)?.type;
      return (
        typeof type !== 'string' ||
        !type.startsWith('data-') ||
        Object.hasOwn(CHAT_DATA_PART_SCHEMAS, type.slice('data-'.length))
      );
    });
  });
}
