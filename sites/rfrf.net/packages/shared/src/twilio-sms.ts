import { Buffer } from 'node:buffer';

const ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
const API_KEY_SID_PATTERN = /^SK[0-9a-f]{32}$/i;
const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-f]{32}$/i;
const MESSAGE_SID_PATTERN = /^SM[0-9a-f]{32}$/i;
const PHONE_NUMBER_SID_PATTERN = /^PN[0-9a-f]{32}$/i;
const SHORT_CODE_SID_PATTERN = /^SC[0-9a-f]{32}$/i;
const ALPHA_SENDER_SID_PATTERN = /^AI[0-9a-f]{32}$/i;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const GSM_7_BASIC = new Set(
  `@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà`,
);
const GSM_7_EXTENDED = new Set(`^{}\\[~]|€\f`);

export const MAX_SMS_SEGMENTS = 6;
const MAX_TWILIO_BODY_CHARACTERS = 1600;
const SEND_REQUEST_TIMEOUT_MS = 8_000;
const READINESS_TIMEOUT_MS = 2_000;

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsAnalysis {
  encoding: SmsEncoding;
  units: number;
  segments: number;
}

export type TwilioSmsEnvironment = Partial<
  Record<
    | 'TWILIO_ACCOUNT_SID'
    | 'TWILIO_API_KEY_SID'
    | 'TWILIO_API_KEY_SECRET'
    | 'TWILIO_MESSAGING_SERVICE_SID'
    | 'TWILIO_SMS_FROM',
    string | undefined
  >
>;

export type TwilioSmsSender =
  { kind: 'messaging-service'; sid: string } | { kind: 'from'; phone: string };

export interface TwilioSmsConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  sender: TwilioSmsSender;
}

export interface SafeTwilioMessagingError {
  code: number | string;
  status?: number;
}

export interface TwilioSmsDependencies {
  environment?: TwilioSmsEnvironment;
  fetch?: typeof fetch;
  logError?: (event: string, details: SafeTwilioMessagingError) => void;
}

function runtimeTwilioSmsEnvironment(): TwilioSmsEnvironment {
  return {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID: process.env.TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET: process.env.TWILIO_API_KEY_SECRET,
    TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,
    TWILIO_SMS_FROM: process.env.TWILIO_SMS_FROM,
  };
}

export interface TwilioSmsSendResult {
  status: 'accepted' | 'rejected' | 'unknown';
  reason:
    | 'accepted'
    | 'configuration'
    | 'recipient'
    | 'body'
    | 'segments'
    | 'provider'
    | 'network';
  encoding: SmsEncoding | null;
  segments: number;
}

export function parseTwilioSmsEnvironment(
  environment: TwilioSmsEnvironment = runtimeTwilioSmsEnvironment(),
): TwilioSmsConfig | null {
  const accountSid = environment.TWILIO_ACCOUNT_SID?.trim() ?? '';
  const apiKeySid = environment.TWILIO_API_KEY_SID?.trim() ?? '';
  const apiKeySecret = environment.TWILIO_API_KEY_SECRET?.trim() ?? '';
  const messagingServiceSid =
    environment.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? '';
  const from = environment.TWILIO_SMS_FROM?.trim() ?? '';

  if (
    !ACCOUNT_SID_PATTERN.test(accountSid) ||
    !API_KEY_SID_PATTERN.test(apiKeySid) ||
    apiKeySecret.length < 32 ||
    Boolean(messagingServiceSid) === Boolean(from)
  ) {
    return null;
  }

  if (messagingServiceSid) {
    if (!MESSAGING_SERVICE_SID_PATTERN.test(messagingServiceSid)) return null;
    return {
      accountSid,
      apiKeySid,
      apiKeySecret,
      sender: { kind: 'messaging-service', sid: messagingServiceSid },
    };
  }
  if (!E164_PATTERN.test(from)) return null;
  return {
    accountSid,
    apiKeySid,
    apiKeySecret,
    sender: { kind: 'from', phone: from },
  };
}

export function analyzeSmsBody(body: string): SmsAnalysis {
  let septets = 0;
  let gsm7 = true;
  for (const character of body) {
    if (GSM_7_BASIC.has(character)) septets += 1;
    else if (GSM_7_EXTENDED.has(character)) septets += 2;
    else {
      gsm7 = false;
      break;
    }
  }

  if (gsm7) {
    return {
      encoding: 'GSM-7',
      units: septets,
      segments:
        septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153),
    };
  }

  const units = body.length;
  return {
    encoding: 'UCS-2',
    units,
    segments: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67),
  };
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function containsUnsafeControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint < 0x20 && codePoint !== 0x0a) || codePoint === 0x7f)
    ) {
      return true;
    }
  }
  return false;
}

function authorization(config: TwilioSmsConfig): string {
  return `Basic ${Buffer.from(
    `${config.apiKeySid}:${config.apiKeySecret}`,
    'utf8',
  ).toString('base64')}`;
}

function fetcher(dependencies: TwilioSmsDependencies): typeof fetch {
  return dependencies.fetch ?? fetch;
}

function logSafeError(
  event: string,
  details: SafeTwilioMessagingError,
  dependencies: TwilioSmsDependencies,
): void {
  if (dependencies.logError) dependencies.logError(event, details);
  else console.error(event, details);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasSmsCapability(sender: Record<string, unknown>): boolean {
  const capabilities = Array.isArray(sender.capabilities)
    ? sender.capabilities
    : [];
  return capabilities.some(
    (capability) =>
      typeof capability === 'string' && capability.toUpperCase() === 'SMS',
  );
}

async function responseError(
  response: Response,
): Promise<SafeTwilioMessagingError> {
  let code: number | string = `HTTP_${response.status}`;
  try {
    const payload = asRecord(await response.json());
    if (typeof payload.code === 'number' || typeof payload.code === 'string') {
      code = payload.code;
    }
  } catch {
    // The HTTP status is enough; never log the provider's raw body.
  }
  return { code, status: response.status };
}

export function twilioSmsConfigured(
  environment: TwilioSmsEnvironment = runtimeTwilioSmsEnvironment(),
): boolean {
  return parseTwilioSmsEnvironment(environment) !== null;
}

export async function sendTwilioSms(
  to: string,
  text: string,
  dependencies: TwilioSmsDependencies = {},
): Promise<TwilioSmsSendResult> {
  if (!E164_PATTERN.test(to)) {
    return {
      status: 'rejected',
      reason: 'recipient',
      encoding: null,
      segments: 0,
    };
  }

  const body = normalizeBody(text);
  const analysis = analyzeSmsBody(body);
  if (!body || containsUnsafeControl(body)) {
    return {
      status: 'rejected',
      reason: 'body',
      encoding: analysis.encoding,
      segments: analysis.segments,
    };
  }
  if (
    body.length > MAX_TWILIO_BODY_CHARACTERS ||
    analysis.segments > MAX_SMS_SEGMENTS
  ) {
    return {
      status: 'rejected',
      reason: 'segments',
      encoding: analysis.encoding,
      segments: analysis.segments,
    };
  }

  const config = parseTwilioSmsEnvironment(dependencies.environment);
  if (!config) {
    return {
      status: 'rejected',
      reason: 'configuration',
      encoding: analysis.encoding,
      segments: analysis.segments,
    };
  }

  const form = new URLSearchParams({ To: to, Body: body });
  if (config.sender.kind === 'messaging-service') {
    form.set('MessagingServiceSid', config.sender.sid);
    form.set('RiskCheck', 'enable');
  } else {
    form.set('From', config.sender.phone);
  }

  let response: Response;
  try {
    response = await fetcher(dependencies)(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: authorization(config),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
        cache: 'no-store',
        signal: AbortSignal.timeout(SEND_REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    logSafeError(
      '[messaging:sms] request outcome unknown',
      { code: 'NETWORK' },
      dependencies,
    );
    return {
      status: 'unknown',
      reason: 'network',
      encoding: analysis.encoding,
      segments: analysis.segments,
    };
  }

  if (response.status !== 201) {
    logSafeError(
      '[messaging:sms] provider rejected request',
      await responseError(response),
      dependencies,
    );
    return {
      status: 'rejected',
      reason: 'provider',
      encoding: analysis.encoding,
      segments: analysis.segments,
    };
  }

  try {
    const payload = asRecord(await response.json());
    if (
      typeof payload.sid !== 'string' ||
      !MESSAGE_SID_PATTERN.test(payload.sid)
    ) {
      throw new Error('message_sid_missing');
    }
  } catch {
    logSafeError(
      '[messaging:sms] request outcome unknown',
      { code: 'RESPONSE_INVALID', status: response.status },
      dependencies,
    );
    return {
      status: 'unknown',
      reason: 'provider',
      encoding: analysis.encoding,
      segments: analysis.segments,
    };
  }

  return {
    status: 'accepted',
    reason: 'accepted',
    encoding: analysis.encoding,
    segments: analysis.segments,
  };
}

export async function twilioSmsReady(
  dependencies: TwilioSmsDependencies = {},
): Promise<boolean> {
  const config = parseTwilioSmsEnvironment(dependencies.environment);
  if (!config) return false;

  const request = (url: string) =>
    fetcher(dependencies)(url, {
      headers: {
        accept: 'application/json',
        authorization: authorization(config),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
    });
  try {
    if (config.sender.kind === 'messaging-service') {
      const serviceUrl = `https://messaging.twilio.com/v1/Services/${config.sender.sid}`;
      const serviceResponse = await request(serviceUrl);
      if (!serviceResponse.ok) {
        logSafeError(
          '[messaging:sms] readiness failed',
          await responseError(serviceResponse),
          dependencies,
        );
        return false;
      }
      const service = asRecord(await serviceResponse.json());
      if (service.sid !== config.sender.sid) return false;

      // A Messaging Service is not send-ready until its Sender Pool contains
      // at least one SMS-capable sender. Merely resolving the MG resource is a
      // configuration false-positive: Twilio cannot choose a From value from
      // an empty pool.
      const senderPoolBase = `${serviceUrl}/`;
      const senderResponses = await Promise.all([
        request(`${senderPoolBase}PhoneNumbers?PageSize=1`),
        request(`${senderPoolBase}ShortCodes?PageSize=1`),
        request(`${senderPoolBase}AlphaSenders?PageSize=1`),
        request(`${senderPoolBase}DestinationAlphaSenders?PageSize=1`),
      ]);
      const senders = await Promise.all(
        senderResponses.map(async (response) =>
          response.ok ? asRecord(await response.json()) : {},
        ),
      );
      const phoneNumbers = Array.isArray(senders[0]?.phone_numbers)
        ? senders[0].phone_numbers
        : [];
      const shortCodes = Array.isArray(senders[1]?.short_codes)
        ? senders[1].short_codes
        : [];
      const alphaSenders = Array.isArray(senders[2]?.alpha_senders)
        ? senders[2].alpha_senders
        : [];
      const destinationAlphaSenders = Array.isArray(senders[3]?.alpha_senders)
        ? senders[3].alpha_senders
        : [];
      return (
        phoneNumbers.some((entry) => {
          const sender = asRecord(entry);
          return (
            typeof sender.sid === 'string' &&
            PHONE_NUMBER_SID_PATTERN.test(sender.sid) &&
            hasSmsCapability(sender)
          );
        }) ||
        shortCodes.some((entry) => {
          const sender = asRecord(entry);
          return (
            typeof sender.sid === 'string' &&
            SHORT_CODE_SID_PATTERN.test(sender.sid) &&
            hasSmsCapability(sender)
          );
        }) ||
        alphaSenders.some((entry) => {
          const sender = asRecord(entry);
          return (
            typeof sender.sid === 'string' &&
            ALPHA_SENDER_SID_PATTERN.test(sender.sid) &&
            hasSmsCapability(sender)
          );
        }) ||
        destinationAlphaSenders.some((entry) => {
          const sender = asRecord(entry);
          return (
            typeof sender.sid === 'string' &&
            ALPHA_SENDER_SID_PATTERN.test(sender.sid) &&
            hasSmsCapability(sender)
          );
        })
      );
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(config.sender.phone)}&PageSize=1`;
    const response = await request(url);
    if (!response.ok) {
      logSafeError(
        '[messaging:sms] readiness failed',
        await responseError(response),
        dependencies,
      );
      return false;
    }
    const payload = asRecord(await response.json());
    const fromPhone = config.sender.phone;
    const numbers = Array.isArray(payload.incoming_phone_numbers)
      ? payload.incoming_phone_numbers
      : [];
    return numbers.some((entry) => {
      const number = asRecord(entry);
      const capabilities = asRecord(number.capabilities);
      return number.phone_number === fromPhone && capabilities.sms === true;
    });
  } catch {
    logSafeError(
      '[messaging:sms] readiness failed',
      { code: 'NETWORK' },
      dependencies,
    );
    return false;
  }
}
