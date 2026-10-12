export interface CustomerAccountMatch {
  id: string;
  active: boolean;
  role: string;
  emailVerified: boolean;
  googleSubject: string | null;
}

export type GoogleCustomerAccountDecision =
  | { action: 'sign_in' | 'link'; userId: string }
  | { action: 'register' }
  | { action: 'deny' };

/**
 * A provider subject is authoritative once linked. Linking by email is allowed
 * only for an active customer whose ownership of that email was already
 * verified. Other roles and pending emails are intentionally indistinguishable.
 */
export function decideGoogleCustomerAccount(input: {
  bySubject: CustomerAccountMatch | null;
  byEmail: CustomerAccountMatch | null;
}): GoogleCustomerAccountDecision {
  if (input.bySubject) {
    return input.bySubject.active && input.bySubject.role === 'CUSTOMER'
      ? { action: 'sign_in', userId: input.bySubject.id }
      : { action: 'deny' };
  }
  if (!input.byEmail) return { action: 'register' };
  if (
    input.byEmail.active &&
    input.byEmail.role === 'CUSTOMER' &&
    input.byEmail.emailVerified &&
    input.byEmail.googleSubject === null
  ) {
    return { action: 'link', userId: input.byEmail.id };
  }
  return { action: 'deny' };
}
