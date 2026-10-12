'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestIpSubject } from '@rafraf/shared/security/request-subject';
import { CUSTOMER_OTP_COOKIE } from '../../lib/customer-otp';
import {
  customerOtpCookieOptions,
  customerSessionCookieOptions,
  registerCustomerAccount,
  requestCustomerOtpFlow,
  signInCustomerWithPassword,
  verifyCustomerOtpFlow,
} from '../../lib/customer-auth-service';
import { signSession } from '../../lib/session';
import {
  CUSTOMER_REGISTRATION_COOKIE,
  customerRegistrationCookieOptions,
} from '../../lib/customer-registration-proof';
import { customerEmailBrowserCookieOptions } from '../../lib/customer-email-verification';
import { authMethodPath } from './auth-navigation';
import {
  CUSTOMER_AUTH_RETURN_COOKIE,
  customerAuthReturnCookieOptions,
  safePostAuthPath,
  withCustomerAuthReturnPath,
} from '../../lib/customer-auth-return-path';

const EMAIL_BROWSER_COOKIE = 'cu_email_verify';

export async function requestCustomerOtp(formData: FormData) {
  const next = safePostAuthPath(formData.get('next'));
  const headerStore = await headers();
  const result = await requestCustomerOtpFlow(
    String(formData.get('phone') ?? ''),
    formData.get('turnstileToken'),
    requestIpSubject(headerStore),
  );
  if (result.status !== 'sent')
    redirect(
      `${authMethodPath(formData.get('intent') === 'register' ? 'register' : 'login', 'phone', next)}&err=${result.status === 'delivery_failed' ? 'delivery' : result.status}`,
    );
  (await cookies()).set(
    CUSTOMER_OTP_COOKIE,
    result.challengeCookie,
    customerOtpCookieOptions(),
  );
  redirect(withCustomerAuthReturnPath('/login?step=verify', next));
}

export async function verifyCustomerOtp(formData: FormData) {
  const next = safePostAuthPath(formData.get('next'));
  const cookieStore = await cookies();
  const result = await verifyCustomerOtpFlow(
    cookieStore.get(CUSTOMER_OTP_COOKIE)?.value,
    String(formData.get('code') ?? ''),
  );
  if (result.status === 'invalid') {
    cookieStore.set(
      CUSTOMER_OTP_COOKIE,
      result.challengeCookie,
      customerOtpCookieOptions(result.remainingSeconds),
    );
    redirect(
      withCustomerAuthReturnPath('/login?step=verify&err=invalid_otp', next),
    );
  }
  if (result.status !== 'verified') {
    if (result.status === 'registration_required') {
      cookieStore.delete(CUSTOMER_OTP_COOKIE);
      cookieStore.set(
        CUSTOMER_REGISTRATION_COOKIE,
        result.registrationProof,
        customerRegistrationCookieOptions,
      );
      redirect(withCustomerAuthReturnPath('/login?step=register', next));
    }
    cookieStore.delete(CUSTOMER_OTP_COOKIE);
    redirect(
      withCustomerAuthReturnPath(
        `/login?method=phone&err=${result.status === 'used' ? 'locked' : result.status}`,
        next,
      ),
    );
  }
  cookieStore.delete(CUSTOMER_OTP_COOKIE);
  cookieStore.set(
    'cu_auth',
    await signSession(result.customerId),
    customerSessionCookieOptions,
  );
  cookieStore.delete(CUSTOMER_AUTH_RETURN_COOKIE);
  redirect(next);
}

export async function signInCustomerPassword(formData: FormData) {
  const next = safePostAuthPath(formData.get('next'));
  const headerStore = await headers();
  const result = await signInCustomerWithPassword({
    email: formData.get('email'),
    password: formData.get('password'),
    turnstileToken: formData.get('turnstileToken'),
    requestIpSubject: requestIpSubject(headerStore),
  });
  if (result.status !== 'authenticated') {
    redirect(
      withCustomerAuthReturnPath(
        `/login?err=${result.status === 'rate_limited' ? 'rate_limited' : result.status === 'unavailable' ? 'unavailable' : 'invalid'}`,
        next,
      ),
    );
  }
  const cookieStore = await cookies();
  cookieStore.set(
    'cu_auth',
    await signSession(result.customerId),
    customerSessionCookieOptions,
  );
  cookieStore.delete(CUSTOMER_AUTH_RETURN_COOKIE);
  redirect(next);
}

export async function registerCustomer(formData: FormData) {
  const next = safePostAuthPath(formData.get('next'));
  const cookieStore = await cookies();
  const headerStore = await headers();
  const registrationProof = cookieStore.get(
    CUSTOMER_REGISTRATION_COOKIE,
  )?.value;
  const result = await registerCustomerAccount({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    turnstileToken: formData.get('turnstileToken'),
    requestIpSubject: requestIpSubject(headerStore),
    registrationProof,
  });
  if (result.status !== 'verification_sent') {
    redirect(
      withCustomerAuthReturnPath(
        `/login?step=register&err=${result.status === 'rate_limited' ? 'rate_limited' : result.status === 'invalid' ? 'invalid_registration' : 'unavailable'}`,
        next,
      ),
    );
  }
  cookieStore.delete(CUSTOMER_REGISTRATION_COOKIE);
  if (result.browserSecret) {
    cookieStore.set(
      EMAIL_BROWSER_COOKIE,
      result.browserSecret,
      customerEmailBrowserCookieOptions,
    );
    cookieStore.set(
      CUSTOMER_AUTH_RETURN_COOKIE,
      next,
      customerAuthReturnCookieOptions,
    );
  }
  if (result.authenticatedCustomerId) {
    cookieStore.set(
      'cu_auth',
      await signSession(result.authenticatedCustomerId),
      customerSessionCookieOptions,
    );
    cookieStore.delete(CUSTOMER_AUTH_RETURN_COOKIE);
    redirect(next);
  }
  redirect(withCustomerAuthReturnPath('/login?step=check_email', next));
}

export async function logoutCustomer() {
  const cookieStore = await cookies();
  cookieStore.delete('cu_auth');
  cookieStore.delete(CUSTOMER_OTP_COOKIE);
  cookieStore.delete(CUSTOMER_REGISTRATION_COOKIE);
  cookieStore.delete(EMAIL_BROWSER_COOKIE);
  cookieStore.delete(CUSTOMER_AUTH_RETURN_COOKIE);
  redirect('/');
}
