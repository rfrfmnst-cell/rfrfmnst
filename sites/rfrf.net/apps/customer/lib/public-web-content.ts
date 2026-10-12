import { load } from 'cheerio';
import {
  isVinShaped,
  normalizeIdentifierText,
} from '@rafraf/shared/part-identifiers';
import { publicSourceUrl } from './public-text-reader.ts';

export interface PublicWebSource {
  sourceId: string;
  title: string;
  url: string;
  excerpt: string;
  retrievedAt: string;
  verified: false;
}

function normalized(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) =>
      String(digit.charCodeAt(0) - (digit <= '\u0669' ? 0x0660 : 0x06f0)),
    );
}

function hasVinShape(value: string): boolean {
  // This matching view never changes the outgoing query's original text.
  const text = normalizeIdentifierText(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/(?<![A-Z0-9])VIN(?=[A-HJ-NPR-Z0-9])/gu, 'VIN ');
  const atoms = [...text.matchAll(/[A-Z0-9]+/gu)];
  for (const [index, atom] of atoms.entries()) {
    let candidate = '';
    let previousStop = atom.index;
    for (let position = index; position < atoms.length; position += 1) {
      const next = atoms[position];
      if (
        !next ||
        !/^[\s\p{P}\p{S}]*$/u.test(text.slice(previousStop, next.index))
      )
        break;
      candidate += next[0];
      // Whole atoms only, apart from the explicit VIN label split above.
      if (candidate.length > 17) break;
      // A grouped VIN has a numeric serial; avoid joining ordinary English prose.
      if (/[0-9]/u.test(candidate) && isVinShaped(candidate)) return true;
      previousStop = next.index + next[0].length;
    }
  }
  return false;
}

function hasPrivateData(value: string): boolean {
  const text = normalized(value);
  const digits = text.replace(/[\s().-]/g, '');
  return (
    /[\p{L}\p{N}._%+-]+@/u.test(text) ||
    /https?:|www\.|\b(?:token|password|api.?key|secret)\b/i.test(text) ||
    /(?:^|[^A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?:$|[^A-Z0-9])/i.test(text) ||
    hasVinShape(text) ||
    /(?:\+?9665\d{8}|05\d{8}|\+\d{8,15})/.test(digits) ||
    /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i.test(digits) ||
    /عنوان|شارع|صندوق بريد|الرمز البريدي|حي\s|\b(?:address|street|postcode)\b/i.test(
      text,
    )
  );
}

/** External queries only use part/vehicle fields; never notes, VIN, name or images. */
export function publicPartQuery(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Record<string, unknown>;
  const provenance = draft.partNumberProvenance as
    Record<string, unknown> | undefined;
  if (provenance?.status === 'pending' || provenance?.status === 'rejected')
    return null;
  const fields = ['oemNumber', 'partText', 'make', 'model', 'year'] as const;
  const parts: string[] = [];
  for (const field of fields) {
    const raw = draft[field];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || raw.length > 240 || hasPrivateData(raw))
      return null;
    const text = normalized(raw)
      .replace(/[^\p{L}\p{N}\s._/-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) parts.push(text);
  }
  if (!draft.oemNumber && !draft.partText) return null;
  const query = parts.join(' ').trim();
  const compact = query.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  for (const field of ['vin', 'phone', 'fullName']) {
    const privateValue = draft[field];
    if (typeof privateValue !== 'string') continue;
    const excluded = normalized(privateValue)
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLowerCase();
    if (excluded.length >= 3 && compact.includes(excluded)) return null;
  }
  return query.length >= 3 && query.length <= 180 && !hasPrivateData(query)
    ? query
    : null;
}

/** Plain text only; public prices and contact details are not customer quotes. */
export function sourceExcerpt(text: string, maxLength: number): string {
  const clean = normalized(text)
    .replace(
      /(?:[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+|\+\d[\d\s().-]{7,}\d|(?:\+?966|0)5[\d\s().-]{7,}\d)/gu,
      '[بيانات اتصال محجوبة]',
    )
    .replace(
      /(?:[$€£]\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR|GBP|AED|SAR|ر\.س|ريال|درهم))/gi,
      '[سعر يحتاج عرض رفرف]',
    )
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, maxLength);
}

function source(
  title: string,
  link: string,
  excerpt: string,
  retrievedAt: string,
): Omit<PublicWebSource, 'sourceId'> | null {
  try {
    const url = publicSourceUrl(link).toString();
    const safeTitle = sourceExcerpt(title, 180);
    if (!safeTitle) return null;
    return {
      title: safeTitle,
      url,
      excerpt: sourceExcerpt(excerpt, 600),
      retrievedAt,
      verified: false,
    };
  } catch {
    return null;
  }
}

export function parseSearchResults(
  body: string,
  engine: 'bing' | 'duckduckgo',
  retrievedAt: string,
): Omit<PublicWebSource, 'sourceId'>[] {
  const $ = load(body, { xmlMode: engine === 'bing' });
  const results: Omit<PublicWebSource, 'sourceId'>[] = [];
  const seen = new Set<string>();
  const rows = engine === 'bing' ? $('item') : $('.result');
  rows.each((_, row) => {
    if (results.length >= 5) return;
    const el = $(row);
    const anchor = el.find('.result__a').first();
    let link =
      engine === 'bing'
        ? el.find('link').first().text()
        : (anchor.attr('href') ?? '');
    if (engine === 'duckduckgo') {
      try {
        const parsed = new URL(link, 'https://html.duckduckgo.com');
        link = parsed.searchParams.get('uddg') ?? parsed.toString();
      } catch {
        return;
      }
    }
    const candidate = source(
      engine === 'bing' ? el.find('title').first().text() : anchor.text(),
      link,
      engine === 'bing'
        ? el.find('description').first().text()
        : el.find('.result__snippet').text(),
      retrievedAt,
    );
    if (candidate && !seen.has(candidate.url)) {
      seen.add(candidate.url);
      results.push(candidate);
    }
  });
  return results;
}

export function extractSourceDocument(
  body: string,
  contentType: string,
): { title: string; excerpt: string } {
  if (contentType.startsWith('text/plain'))
    return { title: '', excerpt: sourceExcerpt(body, 3_000) };
  const $ = load(body);
  const title = sourceExcerpt(
    $('title').first().text() || $('h1').first().text(),
    180,
  );
  $(
    'script, style, noscript, iframe, svg, form, nav, header, footer, [hidden]',
  ).remove();
  $('p, div, li, tr, h1, h2, h3, section, br').append('\n');
  const main = $('main, article, [itemprop="description"]').first();
  const text = (main.length ? main : $('body')).text();
  return { title, excerpt: sourceExcerpt(text, 3_000) };
}
