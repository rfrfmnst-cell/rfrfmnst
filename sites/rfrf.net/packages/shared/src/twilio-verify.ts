import twilio, { type Twilio } from 'twilio';

// القناة قابلة للضبط بيئياً: SMS الافتراضي، أو واتساب عبر مرسل Twilio Verify
// المشترك — بلا رقم إرسال خاص. أي قيمة أخرى تسقط إلى SMS ولا تفشل الدخول.
export type TwilioVerifyChannel = 'sms' | 'whatsapp';
export type TwilioVerificationCheck =
  'approved' | 'pending' | 'expired' | 'unavailable';

export interface TwilioVerifyConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  serviceSid: string;
}

export type TwilioVerifyEnvironment = Partial<
  Record<
    | 'TWILIO_ACCOUNT_SID'
    | 'TWILIO_API_KEY_SID'
    | 'TWILIO_API_KEY_SECRET'
    | 'TWILIO_VERIFY_CHANNEL'
    | 'VERIFY_SERVICE_SID',
    string | undefined
  >
>;

export interface SafeTwilioError {
  code: number | string;
  status?: number;
}

interface TwilioVerifyServiceClient {
  fetch(): Promise<{ sid: string }>;
  verifications: {
    create(options: { to: string; channel: TwilioVerifyChannel }): Promise<{
      status: string;
    }>;
  };
  verificationChecks: {
    create(options: { to: string; code: string }): Promise<{ status: string }>;
  };
}

interface TwilioVerifyClient {
  verify: {
    v2: {
      services(serviceSid: string): TwilioVerifyServiceClient;
    };
  };
}

export interface TwilioVerifyDependencies {
  environment?: TwilioVerifyEnvironment;
  client?: TwilioVerifyClient;
  logError?: (event: string, details: SafeTwilioError) => void;
}

const ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
const API_KEY_SID_PATTERN = /^SK[0-9a-f]{32}$/i;
const VERIFY_SERVICE_SID_PATTERN = /^VA[0-9a-f]{32}$/i;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const VERIFY_CODE_PATTERN = /^\d{4,10}$/;

let client: Twilio | null = null;
let clientIdentity: string | null = null;

export function parseTwilioVerifyEnvironment(
  environment: TwilioVerifyEnvironment = process.env,
): TwilioVerifyConfig | null {
  const accountSid = environment.TWILIO_ACCOUNT_SID?.trim() ?? '';
  const apiKeySid = environment.TWILIO_API_KEY_SID?.trim() ?? '';
  const apiKeySecret = environment.TWILIO_API_KEY_SECRET?.trim() ?? '';
  const serviceSid = environment.VERIFY_SERVICE_SID?.trim() ?? '';
  const hasApiKey =
    API_KEY_SID_PATTERN.test(apiKeySid) && apiKeySecret.length >= 32;

  if (
    !ACCOUNT_SID_PATTERN.test(accountSid) ||
    !hasApiKey ||
    !VERIFY_SERVICE_SID_PATTERN.test(serviceSid)
  ) {
    return null;
  }

  return {
    accountSid,
    apiKeySid,
    apiKeySecret,
    serviceSid,
  };
}

function safeError(error: unknown): SafeTwilioError {
  if (!error || typeof error !== 'object') return { code: 'UNKNOWN' };
  const value = error as { code?: unknown; status?: unknown };
  return {
    code:
      typeof value.code === 'number' || typeof value.code === 'string'
        ? value.code
        : 'UNKNOWN',
    status: typeof value.status === 'number' ? value.status : undefined,
  };
}

function verifyClient(settings: TwilioVerifyConfig): Twilio {
  const identity = `${settings.accountSid}/${settings.apiKeySid}`;

  if (!client || clientIdentity !== identity) {
    client = twilio(settings.apiKeySid, settings.apiKeySecret, {
      accountSid: settings.accountSid,
    });
    clientIdentity = identity;
  }
  return client;
}

function dependenciesClient(
  settings: TwilioVerifyConfig,
  dependencies: TwilioVerifyDependencies,
): TwilioVerifyClient {
  return (
    dependencies.client ??
    (verifyClient(settings) as unknown as TwilioVerifyClient)
  );
}

function logSafeError(
  event: string,
  error: unknown,
  dependencies: TwilioVerifyDependencies,
): SafeTwilioError {
  const details = safeError(error);
  if (dependencies.logError) dependencies.logError(event, details);
  else console.error(event, details);
  return details;
}

export function mapTwilioVerificationError(
  error: SafeTwilioError,
): Extract<TwilioVerificationCheck, 'expired' | 'unavailable'> {
  const code = Number(error.code);
  return error.status === 404 || code === 20404 || code === 60203
    ? 'expired'
    : 'unavailable';
}

export function mapTwilioVerificationStatus(
  status: string,
): Exclude<TwilioVerificationCheck, 'unavailable'> {
  if (status === 'approved') return 'approved';
  if (
    status === 'expired' ||
    status === 'canceled' ||
    status === 'max_attempts_reached' ||
    status === 'deleted'
  ) {
    return 'expired';
  }
  return 'pending';
}

export function twilioVerifyChannel(
  environment: TwilioVerifyEnvironment = process.env,
): TwilioVerifyChannel {
  return environment.TWILIO_VERIFY_CHANNEL?.trim().toLowerCase() === 'whatsapp'
    ? 'whatsapp'
    : 'sms';
}

export function twilioVerificationCreateOptions(
  to: string,
  environment: TwilioVerifyEnvironment = process.env,
) {
  return { to, channel: twilioVerifyChannel(environment) };
}

export function twilioVerifyConfigured(
  environment: TwilioVerifyEnvironment = process.env,
): boolean {
  return parseTwilioVerifyEnvironment(environment) !== null;
}

export async function twilioVerifyReady(
  dependencies: TwilioVerifyDependencies = {},
): Promise<boolean> {
  const settings = parseTwilioVerifyEnvironment(dependencies.environment);
  if (!settings) return false;
  try {
    const service = await dependenciesClient(settings, dependencies)
      .verify.v2.services(settings.serviceSid)
      .fetch();
    return service.sid === settings.serviceSid;
  } catch (error) {
    logSafeError('[otp:twilio] readiness failed', error, dependencies);
    return false;
  }
}

export async function sendTwilioVerification(
  to: string,
  dependencies: TwilioVerifyDependencies = {},
): Promise<boolean> {
  const settings = parseTwilioVerifyEnvironment(dependencies.environment);
  if (!settings || !E164_PATTERN.test(to)) return false;
  try {
    const verification = await dependenciesClient(settings, dependencies)
      .verify.v2.services(settings.serviceSid)
      .verifications.create(
        twilioVerificationCreateOptions(to, dependencies.environment),
      );
    return verification.status === 'pending';
  } catch (error) {
    logSafeError(
      '[otp:twilio] verification delivery failed',
      error,
      dependencies,
    );
    return false;
  }
}

export async function checkTwilioVerification(
  to: string,
  code: string,
  dependencies: TwilioVerifyDependencies = {},
): Promise<TwilioVerificationCheck> {
  const settings = parseTwilioVerifyEnvironment(dependencies.environment);
  if (!settings || !E164_PATTERN.test(to)) {
    return 'unavailable';
  }
  if (!VERIFY_CODE_PATTERN.test(code)) return 'pending';
  try {
    const check = await dependenciesClient(settings, dependencies)
      .verify.v2.services(settings.serviceSid)
      .verificationChecks.create({ to, code });
    return mapTwilioVerificationStatus(check.status);
  } catch (error) {
    const safe = logSafeError(
      '[otp:twilio] verification check failed',
      error,
      dependencies,
    );
    return mapTwilioVerificationError(safe);
  }
}
