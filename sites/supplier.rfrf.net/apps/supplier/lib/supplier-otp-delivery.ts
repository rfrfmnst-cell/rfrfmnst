import {
  twilioVerifyConfigured,
  twilioVerifyReady,
} from '@rafraf/shared/twilio-verify';

export function supplierLocalOtpEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.OTP_DELIVERY_PROVIDER === 'local'
  );
}

export function supplierOtpSecurityConfigured(): boolean {
  if (supplierLocalOtpEnabled()) return true;
  return (
    (process.env.SESSION_SECRET?.trim().length ?? 0) >= 32 &&
    twilioVerifyConfigured()
  );
}

export async function supplierOtpSecurityReady(): Promise<boolean> {
  if (supplierLocalOtpEnabled()) return true;
  return (
    (process.env.SESSION_SECRET?.trim().length ?? 0) >= 32 &&
    (await twilioVerifyReady())
  );
}

export function supplierOtpAuditChannel(): 'LOCAL' | 'SMS' {
  return supplierLocalOtpEnabled() ? 'LOCAL' : 'SMS';
}
