import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeCountryCode } from '@rafraf/shared/product-os/sourcing-market';
import { normalizeSupplierEmail } from './supplier-email-auth.ts';
import { normalizeSupplierPhone } from './supplier-phone.ts';

export interface SupplierEmailRegistrationDraft {
  version: 1;
  businessName: string;
  city: string | null;
  countryCode: string;
  legalRegistrationNumber: string;
  phone: string;
  email: string;
  expiresAt: number;
}

const UNSAFE_TEXT_PATTERN = /[\p{Cc}\p{Cf}]/u;

function clean(value: unknown, maximum: number): string | null {
  const raw = String(value ?? '');
  if (raw.length > 512 || UNSAFE_TEXT_PATTERN.test(raw)) return null;
  const normalized = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return normalized && Array.from(normalized).length <= maximum
    ? normalized
    : null;
}

function signingSecret(): string | null {
  const value = process.env.SESSION_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`supplier-email-registration:v1:${payload}`)
    .digest('base64url');
}

export function normalizeSupplierEmailRegistration(input: {
  businessName: unknown;
  city: unknown;
  countryCode: unknown;
  legalRegistrationNumber: unknown;
  phone: unknown;
  email: unknown;
}): Omit<SupplierEmailRegistrationDraft, 'version' | 'expiresAt'> | null {
  const businessName = clean(input.businessName, 80);
  const cityRaw = String(input.city ?? '').trim();
  const city = cityRaw ? clean(cityRaw, 40) : null;
  const countryCode = normalizeCountryCode(input.countryCode);
  const legalRegistrationNumber = clean(input.legalRegistrationNumber, 64);
  const phone =
    typeof input.phone === 'string'
      ? normalizeSupplierPhone(input.phone)
      : null;
  const email = normalizeSupplierEmail(input.email);
  if (
    !businessName ||
    (cityRaw && !city) ||
    !countryCode ||
    !legalRegistrationNumber ||
    !phone ||
    !email
  )
    return null;
  return {
    businessName,
    city,
    countryCode,
    legalRegistrationNumber,
    phone,
    email,
  };
}

export function createSupplierEmailRegistrationDraft(
  input: Omit<SupplierEmailRegistrationDraft, 'version' | 'expiresAt'>,
  nowMs = Date.now(),
): string {
  const secret = signingSecret();
  if (!secret) throw new Error('SUPPLIER_EMAIL_REGISTRATION_UNAVAILABLE');
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      ...input,
      expiresAt: nowMs + 15 * 60 * 1_000,
    } satisfies SupplierEmailRegistrationDraft),
  ).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}

export function parseSupplierEmailRegistrationDraft(
  value: string | undefined,
  nowMs = Date.now(),
): SupplierEmailRegistrationDraft | null {
  const secret = signingSecret();
  if (!secret || !value || value.length > 2_048) return null;
  const [payload, supplied, ...rest] = value.split('.');
  if (!payload || !supplied || rest.length) return null;
  const expected = signature(payload, secret);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as SupplierEmailRegistrationDraft;
    const normalized = normalizeSupplierEmailRegistration(parsed);
    if (
      parsed.version !== 1 ||
      !normalized ||
      JSON.stringify(normalized) !==
        JSON.stringify({
          businessName: parsed.businessName,
          city: parsed.city,
          countryCode: parsed.countryCode,
          legalRegistrationNumber: parsed.legalRegistrationNumber,
          phone: parsed.phone,
          email: parsed.email,
        }) ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= nowMs
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
