export interface AccountIdentityState {
  googleLinked: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface AccountIdentityPresentation {
  registrationMethod: string;
  accountStatus: string;
}

export function accountIdentityPresentation(
  identity: AccountIdentityState,
): AccountIdentityPresentation {
  if (identity.googleLinked) {
    return {
      registrationMethod: 'Google',
      accountStatus: identity.emailVerified
        ? 'نشط — Google والبريد موثّقان'
        : 'نشط — Google موثّق',
    };
  }
  if (identity.phoneVerified) {
    return {
      registrationMethod: 'رقم الجوال (OTP)',
      accountStatus: identity.emailVerified
        ? 'نشط — الجوال والبريد موثّقان'
        : 'نشط — الجوال موثّق',
    };
  }
  if (identity.emailVerified) {
    return {
      registrationMethod: 'البريد الإلكتروني',
      accountStatus: 'نشط — البريد موثّق',
    };
  }
  return {
    registrationMethod: 'غير محددة',
    accountStatus: 'نشط — التحقق غير مكتمل',
  };
}
