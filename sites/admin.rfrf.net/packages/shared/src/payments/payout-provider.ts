export type PayoutTransferStatus =
  'PENDING' | 'SUBMITTED' | 'SETTLED' | 'REJECTED' | 'FAILED' | 'UNKNOWN';

export interface PayoutMoney {
  amount: string;
  currency: string;
}

export interface PayoutBalance {
  available: PayoutMoney;
  asOf: Date;
}

export interface PayoutTransferResult {
  provider: string;
  externalRef: string;
  status: PayoutTransferStatus;
  settledAt: Date | null;
  failureCode: string | null;
}

export interface PayoutProvider {
  readonly name: string;
  getBalance(currency: string): Promise<PayoutBalance>;
  validateBeneficiary(beneficiaryReference: string): Promise<boolean>;
  createTransfer(request: {
    idempotencyKey: string;
    payoutId: string;
    beneficiaryReference: string;
    money: PayoutMoney;
    description: string;
  }): Promise<PayoutTransferResult>;
  getTransfer(externalRef: string): Promise<PayoutTransferResult>;
}
