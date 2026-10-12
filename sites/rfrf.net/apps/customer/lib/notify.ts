import { sendTwilioSms } from '@rafraf/shared/twilio-sms';

/**
 * Optional server-only intake alert. Missing or invalid configuration fails closed,
 * and transport failures never affect the customer's RFQ submission.
 */
export async function notifyOps(text: string): Promise<void> {
  const recipient = process.env.TWILIO_OPS_SMS_TO?.trim();
  if (!recipient) return;

  await sendTwilioSms(recipient, text);
}
