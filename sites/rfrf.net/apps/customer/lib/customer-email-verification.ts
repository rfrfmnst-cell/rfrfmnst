import { createHmac, randomBytes } from 'node:crypto';
import { exactPublicOrigin } from '@rafraf/shared/public-origin';
import nodemailer from 'nodemailer';
import { normalizeCustomerEmail } from './customer-password.ts';

const EMAIL_VERIFICATION_TTL_SECONDS = 15 * 60;
const EMAIL_SEND_TIMEOUT_MS = 7_000;

// مزوّدا بريد خلف تجريد واحد: Resend عبر API، أو SMTP مصادَق (مثل بريد
// Hostinger على نطاقات المنصة). Resend يتقدّم عند توفر مفتاح صالح.
export type CustomerEmailConfiguration =
  | {
      provider: 'resend';
      apiKey: string;
      from: string;
      verificationBaseUrl: string;
    }
  | {
      provider: 'smtp';
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      from: string;
      verificationBaseUrl: string;
    };

const SMTP_HOST_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function customerEmailConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): CustomerEmailConfiguration | null {
  const from = normalizeCustomerEmail(env.CUSTOMER_EMAIL_FROM);
  const origin = exactPublicOrigin(
    env.CUSTOMER_PUBLIC_URL,
    env.NODE_ENV === 'production',
  );
  if (!from || !origin) return null;
  const verificationBaseUrl = `${origin}/login/verify-email`;

  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  if (apiKey.startsWith('re_') && apiKey.length >= 12) {
    return { provider: 'resend', apiKey, from, verificationBaseUrl };
  }

  const host = env.CUSTOMER_SMTP_HOST?.trim() ?? '';
  const user = env.CUSTOMER_SMTP_USER?.trim() ?? '';
  const password = env.CUSTOMER_SMTP_PASSWORD ?? '';
  const port = Number.parseInt(env.CUSTOMER_SMTP_PORT?.trim() ?? '', 10);
  if (
    !SMTP_HOST_PATTERN.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    user.length === 0 ||
    password.length < 8
  ) {
    return null;
  }
  return {
    provider: 'smtp',
    host,
    port,
    secure: port === 465,
    user,
    password,
    from,
    verificationBaseUrl,
  };
}

function hmac(kind: 'token' | 'browser', value: string): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET_CONFIGURATION');
  }
  return createHmac('sha256', secret)
    .update(`customer-email-verification:${kind}:${value}`)
    .digest('base64url');
}

export function emailVerificationTokenHash(token: string): string {
  return hmac('token', token);
}

export function emailVerificationBrowserHash(browserSecret: string): string {
  return hmac('browser', browserSecret);
}

export function createEmailVerificationChallenge(nowMs = Date.now()): {
  token: string;
  tokenHash: string;
  browserSecret: string;
  browserHash: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString('base64url');
  const browserSecret = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: emailVerificationTokenHash(token),
    browserSecret,
    browserHash: emailVerificationBrowserHash(browserSecret),
    expiresAt: new Date(nowMs + EMAIL_VERIFICATION_TTL_SECONDS * 1000),
  };
}

export async function sendCustomerVerificationEmail(input: {
  email: string;
  name: string;
  token: string;
  configuration: CustomerEmailConfiguration;
}): Promise<boolean> {
  const email = normalizeCustomerEmail(input.email);
  if (!email || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) return false;
  const url = new URL(input.configuration.verificationBaseUrl);
  url.searchParams.set('token', input.token);
  const subject = 'تأكيد بريدك الإلكتروني في رفرف';
  const text = `مرحبًا ${input.name}،\n\nأكد بريدك لإكمال تسجيل الدخول إلى رفرف:\n${url.toString()}\n\nتنتهي صلاحية الرابط خلال 15 دقيقة. إذا لم تطلب إنشاء الحساب فتجاهل الرسالة.`;
  if (input.configuration.provider === 'smtp') {
    return sendThroughSmtp(input.configuration, email, subject, text);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMAIL_SEND_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${input.configuration.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: input.configuration.from,
        to: [email],
        subject,
        text,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.text();
    if (body.length > 16_384) return false;
    const parsed = JSON.parse(body) as { id?: unknown };
    return typeof parsed.id === 'string' && parsed.id.length > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendThroughSmtp(
  configuration: Extract<CustomerEmailConfiguration, { provider: 'smtp' }>,
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  try {
    const transporter = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      requireTLS: !configuration.secure,
      auth: { user: configuration.user, pass: configuration.password },
      connectionTimeout: EMAIL_SEND_TIMEOUT_MS,
      greetingTimeout: EMAIL_SEND_TIMEOUT_MS,
      socketTimeout: EMAIL_SEND_TIMEOUT_MS,
    });
    try {
      const result = await transporter.sendMail({
        from: configuration.from,
        to,
        subject,
        text,
      });
      return result.accepted.length > 0;
    } finally {
      transporter.close();
    }
  } catch {
    return false;
  }
}

export const customerEmailBrowserCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/login/verify-email',
  maxAge: EMAIL_VERIFICATION_TTL_SECONDS,
};
