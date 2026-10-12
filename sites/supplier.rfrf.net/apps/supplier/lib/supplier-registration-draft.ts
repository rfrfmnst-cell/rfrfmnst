import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isCanonicalSupplierPhone } from './supplier-phone.ts';
import { normalizeCountryCode } from '@rafraf/shared/product-os/sourcing-market';

export const SUPPLIER_REGISTRATION_COOKIE = 'sp_registration_draft';
export const SUPPLIER_REGISTRATION_TTL_SECONDS = 5 * 60;

const DEVELOPMENT_SECRET = randomBytes(32).toString('base64url');
const UNSAFE_TEXT_PATTERN = /[\p{Cc}\p{Cf}]/u;

export interface SupplierRegistrationDraft {
  version: 2;
  businessName: string;
  city: string | null;
  countryCode: string;
  legalRegistrationNumber: string;
  phone: string;
  expiresAt: number;
  nonce: string;
}

export type SupplierRegistrationInputResult =
  | {
      ok: true;
      businessName: string;
      city: string | null;
      countryCode: string;
      legalRegistrationNumber: string;
    }
  | { ok: false; field: 'name' | 'city' | 'country' | 'registration' };

function registrationSecret(): string | null {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  return process.env.NODE_ENV === 'production' ? null : DEVELOPMENT_SECRET;
}

function digest(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizeText(
  input: FormDataEntryValue | string | null,
  maximumCodePoints: number,
): string | null {
  const raw = String(input ?? '');
  if (raw.length > 512 || UNSAFE_TEXT_PATTERN.test(raw)) return null;
  const normalized = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (Array.from(normalized).length > maximumCodePoints) return null;
  return normalized;
}

export function normalizeSupplierRegistrationInput(
  businessNameInput: FormDataEntryValue | string | null,
  cityInput: FormDataEntryValue | string | null,
  countryCodeInput: FormDataEntryValue | string | null,
  legalRegistrationNumberInput: FormDataEntryValue | string | null,
): SupplierRegistrationInputResult {
  const businessName = normalizeText(businessNameInput, 80);
  if (!businessName) return { ok: false, field: 'name' };
  const rawCity = String(cityInput ?? '');
  const city = normalizeText(rawCity, 40);
  if (city === null) return { ok: false, field: 'city' };
  const countryCode = normalizeCountryCode(countryCodeInput);
  if (!countryCode) {
    return { ok: false, field: 'country' };
  }
  const legalRegistrationNumber = normalizeText(
    legalRegistrationNumberInput,
    64,
  );
  if (!legalRegistrationNumber) {
    return { ok: false, field: 'registration' };
  }
  return {
    ok: true,
    businessName,
    city: city || null,
    countryCode,
    legalRegistrationNumber,
  };
}

export function createSupplierRegistrationDraft(input: {
  businessName: string;
  city: string | null;
  countryCode: string;
  legalRegistrationNumber: string;
  phone: string;
}): { cookie: string; expiresAt: number } {
  const secret = registrationSecret();
  if (!secret) throw new Error('SUPPLIER_REGISTRATION_SECRET_UNAVAILABLE');
  const expiresAt = Date.now() + SUPPLIER_REGISTRATION_TTL_SECONDS * 1_000;
  const draft: SupplierRegistrationDraft = {
    version: 2,
    businessName: input.businessName,
    city: input.city,
    countryCode: input.countryCode,
    legalRegistrationNumber: input.legalRegistrationNumber,
    phone: input.phone,
    expiresAt,
    nonce: randomBytes(16).toString('base64url'),
  };
  const payload = Buffer.from(JSON.stringify(draft)).toString('base64url');
  return {
    cookie: `${payload}.${digest(`supplier-registration:${payload}`, secret)}`,
    expiresAt,
  };
}

export function parseSupplierRegistrationDraft(
  value: string | undefined,
): SupplierRegistrationDraft | null {
  if (!value || value.length > 2_048) return null;
  const secret = registrationSecret();
  if (!secret) return null;
  const [payload, signature, ...rest] = value.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  if (
    !safeEqual(signature, digest(`supplier-registration:${payload}`, secret))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<SupplierRegistrationDraft>;
    const normalized = normalizeSupplierRegistrationInput(
      parsed.businessName ?? null,
      parsed.city ?? '',
      parsed.countryCode ?? null,
      parsed.legalRegistrationNumber ?? null,
    );
    if (
      parsed.version !== 2 ||
      !normalized.ok ||
      normalized.businessName !== parsed.businessName ||
      normalized.city !== parsed.city ||
      normalized.countryCode !== parsed.countryCode ||
      normalized.legalRegistrationNumber !== parsed.legalRegistrationNumber ||
      !isCanonicalSupplierPhone(parsed.phone) ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now() ||
      typeof parsed.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{20,32}$/.test(parsed.nonce)
    ) {
      return null;
    }
    return parsed as SupplierRegistrationDraft;
  } catch {
    return null;
  }
}

export function supplierRegistrationCookieOptions(
  maxAge = SUPPLIER_REGISTRATION_TTL_SECONDS,
) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  };
}
