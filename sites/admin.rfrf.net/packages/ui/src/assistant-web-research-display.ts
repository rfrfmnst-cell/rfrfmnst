export interface WebSourceCard {
  title: string;
  url: string;
  excerpt: string;
  retrievedAt: string;
}

const STATES = [
  'results',
  'empty',
  'read',
  'unavailable',
  'needs_details',
  'limit',
  'disabled',
] as const;
export type WebResearchState = (typeof STATES)[number];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function webResearchDisplay(
  value: unknown,
): { state: WebResearchState; sources: WebSourceCard[] } | null {
  const research = record(record(value)?.webResearch);
  if (!research || !STATES.includes(research.state as WebResearchState))
    return null;
  const sources: WebSourceCard[] = [];
  if (Array.isArray(research.sources)) {
    for (const entry of research.sources.slice(0, 5)) {
      const source = record(entry);
      if (
        !source ||
        source.verified !== false ||
        typeof source.title !== 'string' ||
        typeof source.url !== 'string' ||
        typeof source.excerpt !== 'string' ||
        typeof source.retrievedAt !== 'string'
      )
        continue;
      try {
        const url = new URL(source.url);
        if (
          url.protocol !== 'https:' ||
          !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
            url.hostname,
          ) ||
          /\.(?:local|internal|localhost|test|invalid|example)$/i.test(
            url.hostname,
          ) ||
          url.username ||
          url.password ||
          source.url.length > 2048 ||
          (url.port && url.port !== '443') ||
          !Number.isFinite(Date.parse(source.retrievedAt))
        )
          continue;
        sources.push({
          title: source.title.slice(0, 180),
          url: url.toString(),
          excerpt: source.excerpt.slice(0, 3000),
          retrievedAt: source.retrievedAt,
        });
      } catch {
        continue;
      }
    }
  }
  return { state: research.state as WebResearchState, sources };
}
