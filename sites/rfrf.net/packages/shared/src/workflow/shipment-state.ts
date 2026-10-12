/**
 * آلة حالة الشحنة — خريطة انتقالات صريحة فوق `ShipmentStatus` في schema.prisma.
 *
 * الحالات ليست مخترعة هنا: هي تعداد قاعدة البيانات حرفياً. المسار يعكس شحنة
 * تعبر الجمارك اختيارياً حسب مصدرها، ويحتمل في كل مرحلة بعد الاستلام أن
 * تُفقد — لأن الفقد حدث خارجي لا مرحلة يخطّط لها أحد.
 */
export type ShipmentState =
  | 'PENDING'
  | 'LABEL_CREATED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'CUSTOMS'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'RETURNED'
  | 'LOST';

/** ما إن تدخل الشحنة عهدة الناقل حتى يصير الفقد نتيجة ممكنة في أي مرحلة. */
const IN_CARRIER_CUSTODY_EXITS: readonly ShipmentState[] = ['LOST'];

export const SHIPMENT_TRANSITIONS: Readonly<
  Record<ShipmentState, readonly ShipmentState[]>
> = Object.freeze({
  PENDING: ['LABEL_CREATED'],
  LABEL_CREATED: ['PICKED_UP'],
  PICKED_UP: ['IN_TRANSIT', ...IN_CARRIER_CUSTODY_EXITS],
  // الجمارك فرع للمصدر المستورد وحده، لا محطة إلزامية على كل شحنة.
  IN_TRANSIT: [
    'CUSTOMS',
    'OUT_FOR_DELIVERY',
    'RETURNED',
    ...IN_CARRIER_CUSTODY_EXITS,
  ],
  CUSTOMS: ['OUT_FOR_DELIVERY', 'RETURNED', ...IN_CARRIER_CUSTODY_EXITS],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED', ...IN_CARRIER_CUSTODY_EXITS],
  // الإرجاع بعد التسليم وارد ضمن نافذة الشكوى؛ لذلك DELIVERED ليست نهائية.
  DELIVERED: ['RETURNED'],
  RETURNED: [],
  LOST: [],
});

export const TERMINAL_SHIPMENT_STATES: readonly ShipmentState[] = Object.freeze([
  'RETURNED',
  'LOST',
]);

export function isTerminalShipmentState(state: ShipmentState): boolean {
  return SHIPMENT_TRANSITIONS[state].length === 0;
}

export function canTransitionShipment(
  from: ShipmentState,
  to: ShipmentState,
): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

export class ShipmentTransitionError extends Error {
  readonly from: ShipmentState;
  readonly to: ShipmentState;

  constructor(from: ShipmentState, to: ShipmentState) {
    super(`shipment transition ${from} → ${to} is not allowed`);
    this.name = 'ShipmentTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertShipmentTransition(
  from: ShipmentState,
  to: ShipmentState,
): void {
  if (!canTransitionShipment(from, to)) {
    throw new ShipmentTransitionError(from, to);
  }
}
