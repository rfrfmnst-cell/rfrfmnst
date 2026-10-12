import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { exactPublicOrigin } from '@rafraf/shared/public-origin';

const CHALLENGE_TTL_SECONDS = 15 * 60;
const EMAIL_SEND_TIMEOUT_MS = 7_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SUPPLIER_EMAIL_BROWSER_COOKIE = 'sp_email_browser';
export const SUPPLIER_EMAIL_REGISTRATION_COOKIE = 'sp_email_registration';

type ChallengePurpose = 'login' | 'register';

interface ChallengePayload {
  version: 1;
  purpose: ChallengePurpose;
  email: string;
  supplierId: string | null;
  browserHash: string;
  nonce: string;
  expiresAt: number;
}

function secret(): string | null {
  const configured = process.env.SESSION_SECRET?.trim();
  return configured && configured.length >= 32 ? configured : null;
}

function key(configured: string): Buffer {
  return createHash('sha256')
    .update(`rafraf-supplier-email:v1:${configured}`)
    .digest();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeSupplierEmail(value: unknown): string | null {
  const email = String(value ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function supplierEmailConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.RESEND_API_KEY?.trim().startsWith('re_') &&
      normalizeSupplierEmail(env.SUPPLIER_EMAIL_FROM) &&
      exactPublicOrigin(
        env.NEXT_PUBLIC_SUPPLIER_APP_URL,
        env.NODE_ENV === 'production',
      ) &&
      (env.SESSION_SECRET?.trim().length ?? 0) >= 32,
  );
}

function browserHash(browserSecret: string, configured: string): string {
  return createHmac('sha256', configured)
    .update(`supplier-email-browser:${browserSecret}`)
    .digest('base64url');
}

export function createSupplierEmailChallenge(input: {
  purpose: ChallengePurpose;
  email: string;
  supplierId?: string | null;
  nowMs?: number;
}): { token: string; browserSecret: string; expiresAt: number } {
  const configured = secret();
  const email = normalizeSupplierEmail(input.email);
  if (!configured || !email) throw new Error('SUPPLIER_EMAIL_AUTH_UNAVAILABLE');
  const browserSecret = randomBytes(32).toString('base64url');
  const expiresAt = (input.nowMs ?? Date.now()) + CHALLENGE_TTL_SECONDS * 1_000;
  const payload: ChallengePayload = {
    version: 1,
    purpose: input.purpose,
    email,
    supplierId: input.supplierId ?? null,
    browserHash: browserHash(browserSecret, configured),
    nonce: randomBytes(18).toString('base64url'),
    expiresAt,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(configured), iv);
  cipher.setAAD(Buffer.from('rafraf-supplier-email:v1'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    token: `v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`,
    browserSecret,
    expiresAt,
  };
}

export function parseSupplierEmailChallenge(
  token: string,
  browserSecret: string | undefined,
  nowMs = Date.now(),
): ChallengePayload | null {
  const configured = secret();
  if (!configured || !browserSecret || token.length > 2_048) return null;
  const [version, ivText, encryptedText, tagText, ...rest] = token.split('.');
  if (version !== 'v1' || !ivText || !encryptedText || !tagText || rest.length)
    return null;
  try {
    const iv = Buffer.from(ivText, 'base64url');
    const encrypted = Buffer.from(encryptedText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length > 1_024)
      return null;
    const decipher = createDecipheriv('aes-256-gcm', key(configured), iv);
    decipher.setAAD(Buffer.from('rafraf-supplier-email:v1'));
    decipher.setAuthTag(tag);
    const parsed = JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
        'utf8',
      ),
    ) as Partial<ChallengePayload>;
    const email = normalizeSupplierEmail(parsed.email);
    if (
      parsed.version !== 1 ||
      (parsed.purpose !== 'login' && parsed.purpose !== 'register') ||
      !email ||
      email !== parsed.email ||
      (parsed.supplierId !== null && typeof parsed.supplierId !== 'string') ||
      typeof parsed.browserHash !== 'string' ||
      !safeEqual(parsed.browserHash, browserHash(browserSecret, configured)) ||
      typeof parsed.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{20,32}$/.test(parsed.nonce) ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= nowMs
    ) {
      return null;
    }
    return parsed as ChallengePayload;
  } catch {
    return null;
  }
}

export function supplierEmailChallengeKey(nonce: string): string {
  return `challenge:${createHash('sha256').update(`supplier-email:${nonce}`).digest('base64url')}`;
}

export function supplierEmailSubjectKey(email: string): string {
  return `email:${createHmac('sha256', secret() ?? 'unconfigured')
    .update(email)
    .digest('base64url')}`;
}

/** Opaque subject accepted by the shared request-quota contract. */
export function supplierEmailQuotaSubjectKey(email: string): string {
  return createHmac('sha256', secret() ?? 'unconfigured')
    .update(`supplier-email-quota:${email}`)
    .digest('base64url');
}

export async function sendSupplierEmailLink(input: {
  email: string;
  token: string;
  purpose: ChallengePurpose;
}): Promise<boolean> {
  if (!supplierEmailConfigured()) return false;
  const email = normalizeSupplierEmail(input.email);
  const origin = exactPublicOrigin(
    process.env.NEXT_PUBLIC_SUPPLIER_APP_URL,
    process.env.NODE_ENV === 'production',
  );
  const from = normalizeSupplierEmail(process.env.SUPPLIER_EMAIL_FROM);
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  if (!email || !origin || !from) return false;
  const url = new URL('/login/verify-email', origin);
  url.searchParams.set('token', input.token);
  const subject =
    input.purpose === 'register'
      ? 'تأكيد تسجيل منشأتك في رفرف'
      : 'رابط دخول مورّد رفرف';
  const text =
    input.purpose === 'register'
      ? `أكد بريد المنشأة لإكمال التسجيل وفتح بوابة موردي رفرف:\n${url}\n\nتنتهي صلاحية الرابط خلال 15 دقيقة.`
      : `استخدم الرابط الآمن للدخول إلى بوابة موردي رفرف:\n${url}\n\nتنتهي صلاحية الرابط خلال 15 دقيقة. إذا لم تطلبه فتجاهل الرسالة.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMAIL_SEND_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [email], subject, text }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.text();
    if (body.length > 16_384) return false;
    return typeof (JSON.parse(body) as { id?: unknown }).id === 'string';
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export const supplierEmailBrowserCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/login/verify-email',
  maxAge: CHALLENGE_TTL_SECONDS,
};

export const supplierEmailRegistrationCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/login/verify-email',
  maxAge: CHALLENGE_TTL_SECONDS,
};
