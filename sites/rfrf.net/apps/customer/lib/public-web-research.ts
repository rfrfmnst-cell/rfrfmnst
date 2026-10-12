import { randomUUID } from 'node:crypto';
import { WebReadError, readPublicText } from './public-text-reader.ts';
import {
  extractSourceDocument,
  parseSearchResults,
  type PublicWebSource,
} from './public-web-content.ts';

export type WebResearchState =
  | 'results'
  | 'empty'
  | 'read'
  | 'unavailable'
  | 'needs_details'
  | 'limit'
  | 'disabled';
export interface WebResearchResult {
  webResearch: {
    state: WebResearchState;
    sources: PublicWebSource[];
    query?: string;
    reason?: string;
    notice: string;
  };
}

const NOTICE =
  'مصادر عامة غير متحققة؛ ليست عرض رفرف أو إثبات توافق أو مخزون أو موعد توريد. الأسعار تحتاج عرضاً معتمداً.';

export function webResearchResult(
  state: WebResearchState,
  sources: PublicWebSource[] = [],
  query?: string,
  reason?: string,
): WebResearchResult {
  return {
    webResearch: {
      state,
      sources,
      ...(query ? { query } : {}),
      ...(reason ? { reason } : {}),
      notice: NOTICE,
    },
  };
}

/** Scope and budgets live within one authenticated model run, never across users. */
export function createPublicWebResearch(reader = readPublicText) {
  const sources = new Map<string, PublicWebSource>();
  let searched = false;
  let reads = 0;
  return {
    async search(
      query: string,
      signal?: AbortSignal,
    ): Promise<WebResearchResult> {
      signal?.throwIfAborted();
      if (searched) return webResearchResult('limit');
      searched = true;
      let sawValidSearch = false;
      let reason = 'unavailable';
      for (const engine of ['bing', 'duckduckgo'] as const) {
        signal?.throwIfAborted();
        const url = new URL(
          engine === 'bing'
            ? 'https://www.bing.com/search'
            : 'https://html.duckduckgo.com/html/',
        );
        url.searchParams.set('q', query);
        if (engine === 'bing') url.searchParams.set('format', 'rss');
        try {
          const document = await reader(url.toString(), signal);
          const found = parseSearchResults(
            document.body,
            engine,
            new Date().toISOString(),
          );
          const validSearch =
            engine === 'bing'
              ? /<rss[\s>]/i.test(document.body)
              : /result__a|no-results/i.test(document.body);
          sawValidSearch ||= validSearch;
          if (!found.length) continue;
          const result = found.map((entry) => ({
            ...entry,
            sourceId: randomUUID(),
          }));
          result.forEach((entry) => sources.set(entry.sourceId, entry));
          return webResearchResult('results', result, query);
        } catch (error) {
          signal?.throwIfAborted();
          reason = error instanceof WebReadError ? error.code : 'unavailable';
        }
      }
      return webResearchResult(
        sawValidSearch ? 'empty' : 'unavailable',
        [],
        query,
        reason,
      );
    },
    async read(
      sourceId: string,
      signal?: AbortSignal,
    ): Promise<WebResearchResult> {
      signal?.throwIfAborted();
      const selected = sources.get(sourceId);
      if (!selected)
        return webResearchResult('unavailable', [], undefined, 'search_first');
      if (reads >= 2) return webResearchResult('limit');
      reads++;
      try {
        const document = await reader(selected.url, signal);
        const content = extractSourceDocument(
          document.body,
          document.contentType,
        );
        if (!content.excerpt)
          return webResearchResult(
            'unavailable',
            [],
            undefined,
            'empty_document',
          );
        return webResearchResult('read', [
          {
            ...selected,
            url: document.url,
            title: content.title || selected.title,
            excerpt: content.excerpt,
            retrievedAt: new Date().toISOString(),
            verified: false,
          },
        ]);
      } catch (error) {
        signal?.throwIfAborted();
        return webResearchResult(
          'unavailable',
          [],
          undefined,
          error instanceof WebReadError ? error.code : 'unavailable',
        );
      }
    },
  };
}
