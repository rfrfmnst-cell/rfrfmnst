export type CustomerAuthMode = 'login' | 'register';
export type CustomerAuthMethod = 'email' | 'phone';
export type CustomerLoginSearchParams = {
  err?: string;
  method?: string;
  step?: string;
  next?: string;
};

export function authLandingPath(mode: CustomerAuthMode, next?: string) {
  return withCustomerAuthReturnPath(
    mode === 'register' ? '/login?step=register' : '/login',
    next,
  );
}

export function authMethodPath(
  mode: CustomerAuthMode,
  method: CustomerAuthMethod,
  next?: string,
) {
  const params = new URLSearchParams();
  if (mode === 'register') params.set('step', 'register');
  params.set('method', method);
  return withCustomerAuthReturnPath(`/login?${params.toString()}`, next);
}
import { withCustomerAuthReturnPath } from '../../lib/customer-auth-return-path.ts';
