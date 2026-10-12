export type ShippingCapability =
  'RATES' | 'CREATE_SHIPMENT' | 'TRACK' | 'AWB' | 'WEBHOOK';

export type ProviderShipmentStatus =
  | 'PENDING'
  | 'LABEL_CREATED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'CUSTOMS'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'RETURNED'
  | 'LOST'
  | 'UNKNOWN';

export interface ShippingParcel {
  weightKg: number;
  packageCount: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface ShippingParty {
  name: string;
  phone: string;
  email?: string;
  address: string;
  district?: string;
  city: string;
  country: string;
  postcode?: string;
}

export interface CreateShipmentRequest {
  /** Stable server-owned key; retries must resolve to the same provider order. */
  idempotencyKey: string;
  orderCode: string;
  deliveryOptionId: number;
  money: { amount: string; currency: string };
  parcel: ShippingParcel;
  sender: ShippingParty;
  recipient: ShippingParty;
  items: ReadonlyArray<{
    name: string;
    sku: string;
    quantity: number;
    unitPrice: string;
  }>;
}

export interface ShipmentOperationResult {
  provider: string;
  orderCode: string;
  externalOrderId: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  status: ProviderShipmentStatus;
}

export interface ShippingWebhookResult extends ShipmentOperationResult {
  verified: boolean;
  occurredAt: Date | null;
  errorCode: string | null;
}

export interface ShippingProvider {
  readonly name: string;
  readonly capabilities: readonly ShippingCapability[];
  createShipment(
    request: CreateShipmentRequest,
  ): Promise<ShipmentOperationResult>;
  getShipment(orderCode: string): Promise<ShipmentOperationResult>;
  getLabel(orderCode: string): Promise<string>;
  parseWebhook(rawBody: string, headers: Headers): ShippingWebhookResult;
}
