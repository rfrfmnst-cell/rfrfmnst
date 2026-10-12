import { lookup } from 'node:dns/promises';
import { request, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export type WebReadErrorCode =
  | 'unsafe_source'
  | 'unavailable'
  | 'blocked'
  | 'too_large'
  | 'unsupported_content'
  | 'timeout';

export class WebReadError extends Error {
  readonly code: WebReadErrorCode;
  constructor(code: WebReadErrorCode) {
    super(code);
    this.code = code;
    this.name = 'WebReadError';
  }
}

const MAX_RESPONSE_BYTES = 512_000;
const MAX_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 6_000;
const BLOCKED_SUFFIXES = [
  '.local',
  '.internal',
  '.localhost',
  '.test',
  '.invalid',
  '.example',
  '.mubasatplatform.com',
  '.rfrf.net',
];

/** Only public HTTPS documents. No IP literals, credentials or secret links. */
export function publicSourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebReadError('unsafe_source');
  }
  const host = url.hostname.toLowerCase();
  if (
    value.length > 2_048 ||
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    isIP(host.replace(/^\[|\]$/g, '')) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    host === 'mubasatplatform.com' ||
    host === 'rfrf.net' ||
    [...url.searchParams.keys()].some((key) =>
      /token|api.?key|auth|password|session|signature|credential|vin|phone/i.test(
        key,
      ),
    )
  )
    throw new WebReadError('unsafe_source');
  url.hash = '';
  return url;
}

export function isPublicIpv4(address: string): boolean {
  return isIP(address) === 4 && ipaddr.parse(address).range() === 'unicast';
}

interface PinnedResponse {
  status: number;
  location: string | null;
  contentType: string;
  body: string;
}

/** Resolve once and pin that public address at the TCP connection (no rebinding). */
async function publicAddress(host: string): Promise<string> {
  const addresses = await lookup(host, { family: 4, all: true });
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicIpv4(entry.address))
  )
    throw new WebReadError('unsafe_source');
  return addresses[0]!.address;
}

function pinnedGet(
  url: URL,
  address: string,
  signal: AbortSignal,
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions & { autoSelectFamily: boolean } = {
      protocol: 'https:',
      hostname: url.hostname,
      servername: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      family: 4,
      autoSelectFamily: false,
      agent: false,
      lookup: (_host, _options, done) => done(null, address, 4),
      signal,
      headers: {
        'User-Agent': 'RafrafPublicResearch/1.0',
        Accept: 'text/html, text/plain, application/rss+xml, application/xml',
        'Accept-Encoding': 'identity',
      },
    };
    const req = request(options, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = res.headers.location ?? null;
        res.destroy();
        resolve({ status, location, contentType: '', body: '' });
        return;
      }
      if (status !== 200) {
        res.destroy();
        reject(
          new WebReadError(
            status === 403 || status === 429 ? 'blocked' : 'unavailable',
          ),
        );
        return;
      }
      const contentType = res.headers['content-type']?.toLowerCase() ?? '';
      if (
        !/^(?:text\/(?:html|plain|xml)|application\/(?:rss\+xml|xml))(?:;|$)/.test(
          contentType,
        ) ||
        (res.headers['content-encoding'] &&
          res.headers['content-encoding'] !== 'identity')
      ) {
        res.destroy();
        reject(new WebReadError('unsupported_content'));
        return;
      }
      if (Number(res.headers['content-length'] ?? 0) > MAX_RESPONSE_BYTES) {
        res.destroy();
        reject(new WebReadError('too_large'));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          reject(new WebReadError('too_large'));
          res.destroy();
          req.destroy();
        } else chunks.push(chunk);
      });
      res.on('end', () =>
        resolve({
          status,
          location: null,
          contentType,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', () => reject(new WebReadError('unavailable')));
      res.on('aborted', () => reject(new WebReadError('unavailable')));
    });
    req.on('error', () =>
      reject(new WebReadError(signal.aborted ? 'timeout' : 'unavailable')),
    );
    req.end();
  });
}

export interface PublicTextDocument {
  url: string;
  contentType: string;
  body: string;
}

/** Every redirect gets URL validation, DNS validation and its own pinned socket. */
export async function readPublicText(
  value: string,
  callerSignal?: AbortSignal,
): Promise<PublicTextDocument> {
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, deadline])
    : deadline;
  let url = publicSourceUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    signal.throwIfAborted();
    // DNS work is bounded too, even if the resolver never answers.
    const address = await Promise.race([
      publicAddress(url.hostname),
      new Promise<never>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new WebReadError('timeout')),
          { once: true },
        );
      }),
    ]);
    signal.throwIfAborted();
    const response = await pinnedGet(url, address, signal);
    if (!response.location) {
      if (response.status !== 200) throw new WebReadError('unavailable');
      return {
        url: url.toString(),
        contentType: response.contentType,
        body: response.body,
      };
    }
    url = publicSourceUrl(new URL(response.location, url).toString());
  }
  throw new WebReadError('unavailable');
}
