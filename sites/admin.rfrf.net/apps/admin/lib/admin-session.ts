export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8;
export const ADMIN_MFA_TTL_SECONDS = 5 * 60;

export const ADMIN_PERMISSIONS = [
  'OPERATIONS_READ',
  'RFQ_WRITE',
  'QUOTE_WRITE',
  'FITMENT_APPROVE',
  'PAYMENT_WRITE',
  'MESSAGING_SEND',
  'RISK_REVIEW',
  'CATALOG_WRITE',
  /** مراجعة دورة حياة المورد واعتمادها أو رفضها. */
  'SUPPLIER_WRITE',
  /** إنشاء الشحنات الخارجية وإدارة بوليصاتها. */
  'SHIPMENT_WRITE',
  /** تجهيز طلب صرف المورد دون صلاحية اعتماده. */
  'PAYOUT_MAKER',
  /** اعتماد صرف المورد؛ يجب أن يكون منفذاً مختلفاً عن المنشئ. */
  'PAYOUT_CHECKER',
  /** إرسال الفواتير النظامية ومصالحة حالتها. */
  'EINVOICE_WRITE',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export interface AdminSession {
  userId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export type AdminMfaChallenge = AdminSession;

const encoder = new TextEncoder();
const ADMIN_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const OTP_PATTERN = /^\d{6}$/;

function configuredSessionSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmac(
  namespace: string,
  payload: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`rafraf-admin:${namespace}:${payload}`),
    ),
  );
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function localAdminOtp(): string | null {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.OTP_DELIVERY_PROVIDER !== 'local'
  ) {
    return null;
  }
  const code = process.env.ADMIN_LOCAL_OTP?.trim() ?? '';
  return OTP_PATTERN.test(code) ? code : null;
}

function twilioMfaConfigured(): boolean {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? '';
  const serviceSid = process.env.VERIFY_SERVICE_SID?.trim() ?? '';
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim() ?? '';
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim() ?? '';

  return Boolean(
    /^AC[0-9a-f]{32}$/i.test(accountSid) &&
    /^VA[0-9a-f]{32}$/i.test(serviceSid) &&
    /^SK[0-9a-f]{32}$/i.test(apiKeySid) &&
    apiKeySecret.length >= 32,
  );
}

export function localAdminMfaEnabled(): boolean {
  return localAdminOtp() !== null;
}

export function adminMfaConfigured(): boolean {
  return localAdminMfaEnabled() || twilioMfaConfigured();
}

export function adminAuthConfigured(): boolean {
  return Boolean(configuredSessionSecret() && adminMfaConfigured());
}

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

async function signToken(
  version: 'v2' | 'm1',
  namespace: 'session' | 'mfa',
  userId: string,
  ttlSeconds: number,
  nowMs = Date.now(),
  nonce = randomNonce(),
): Promise<string> {
  const secret = configuredSessionSecret();
  if (!secret || !ADMIN_ID_PATTERN.test(userId)) {
    throw new Error('Rafraf admin authentication is not configured');
  }

  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const payload = `${issuedAt}.${expiresAt}.${userId}.${nonce}`;
  return `${version}.${payload}.${await hmac(namespace, payload, secret)}`;
}

async function verifyToken(
  token: string | undefined,
  version: 'v2' | 'm1',
  namespace: 'session' | 'mfa',
  ttlSeconds: number,
  nowMs = Date.now(),
): Promise<AdminSession | null> {
  if (!token) return null;
  const secret = configuredSessionSecret();
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 6 || parts[0] !== version) return null;
  const [, issuedRaw, expiresRaw, userId, nonce, signature] = parts;
  if (
    !issuedRaw ||
    !expiresRaw ||
    !userId ||
    !nonce ||
    !signature ||
    !ADMIN_ID_PATTERN.test(userId) ||
    !NONCE_PATTERN.test(nonce) ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return null;
  }

  const issuedAt = Number(issuedRaw);
  const expiresAt = Number(expiresRaw);
  const now = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt > now + 60 ||
    expiresAt <= now ||
    expiresAt - issuedAt !== ttlSeconds
  ) {
    return null;
  }

  const payload = `${issuedAt}.${expiresAt}.${userId}.${nonce}`;
  if (!timingSafeHexEqual(signature, await hmac(namespace, payload, secret))) {
    return null;
  }

  return { userId, issuedAt, expiresAt, nonce };
}

export async function signAdminSession(
  userId: string,
  nowMs = Date.now(),
  nonce = randomNonce(),
): Promise<string> {
  return signToken(
    'v2',
    'session',
    userId,
    ADMIN_SESSION_TTL_SECONDS,
    nowMs,
    nonce,
  );
}

export async function verifyAdminSession(
  token: string | undefined,
  nowMs = Date.now(),
): Promise<AdminSession | null> {
  return verifyToken(token, 'v2', 'session', ADMIN_SESSION_TTL_SECONDS, nowMs);
}

export async function signAdminMfaChallenge(
  userId: string,
  nowMs = Date.now(),
  nonce = randomNonce(),
): Promise<string> {
  return signToken('m1', 'mfa', userId, ADMIN_MFA_TTL_SECONDS, nowMs, nonce);
}

export async function verifyAdminMfaChallenge(
  token: string | undefined,
  nowMs = Date.now(),
): Promise<AdminMfaChallenge | null> {
  return verifyToken(token, 'm1', 'mfa', ADMIN_MFA_TTL_SECONDS, nowMs);
}

export function localAdminOtpMatches(candidate: string): boolean {
  const expected = localAdminOtp();
  if (
    !expected ||
    !OTP_PATTERN.test(candidate) ||
    expected.length !== candidate.length
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
  }
  return difference === 0;
}

export async function adminLoginSubject(value: string): Promise<string> {
  const secret = configuredSessionSecret();
  if (!secret) throw new Error('Rafraf admin authentication is not configured');
  return `ip:${await hmac('login-subject', value, secret)}`;
}
