/**
 * اختبارات آلات الحالة الستّ التي يفرضها CLAUDE.md:
 * RFQ · Order · Payment · Shipment · Supplier · Compliance.
 *
 * أهمّ ما هنا ليس مسار النجاح بل ثلاثة ضمانات بنيوية:
 *  1. تطابق الخريطة مع تعداد `schema.prisma` حرفياً — يُقرأ المخطط من القرص،
 *     فلا تنحرف الخريطة عن قاعدة البيانات بصمت عند إضافة حالة جديدة.
 *  2. رفض الانتقالات غير المشروعة — وهي الثغرة الحقيقية: قبل هذه الخرائط كان
 *     `updateRfqStatus` يقبل أي عضو صالح في التعداد، فيمرّ CANCELLED → DRAFT.
 *  3. لا حالة معزولة ولا حالة حيّة بلا مخرج نهائي.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  RFQ_TRANSITIONS,
  assertRfqTransition,
  canTransitionRfq,
  isTerminalRfqState,
  RfqTransitionError,
  type RfqState,
} from './rfq-state';
import {
  ORDER_TRANSITIONS,
  assertOrderTransition,
  canTransitionOrder,
  holdsEscrowMoney,
  OrderTransitionError,
  type OrderState,
} from './order-state';
import {
  SHIPMENT_TRANSITIONS,
  assertShipmentTransition,
  canTransitionShipment,
  ShipmentTransitionError,
} from './shipment-state';
import {
  SUPPLIER_TRANSITIONS,
  assertSupplierTransition,
  canSupplierReceiveRfqs,
  canTransitionSupplier,
  SupplierTransitionError,
} from './supplier-state';
import {
  CERTIFICATE_TRANSITIONS,
  COMPLIANCE_REVIEW_TRANSITIONS,
  assertCertificateTransition,
  assertComplianceReviewTransition,
  complianceClearsShipping,
  ComplianceTransitionError,
} from './compliance-state';
import {
  PAYMENT_TRANSITIONS,
  type PaymentState,
} from '../payments/payment-state';

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    try {
      statSync(join(dir, 'pnpm-workspace.yaml'));
      return dir;
    } catch {
      dir = resolve(dir, '..');
    }
  }
  throw new Error('repo root (pnpm-workspace.yaml) not found');
}

const SCHEMA = readFileSync(
  join(repoRoot(), 'packages/db/prisma/schema.prisma'),
  'utf8',
);

/** يستخرج أعضاء تعداد Prisma بالاسم، مصدرَ الحقيقة الوحيد للحالات. */
function prismaEnum(name: string): string[] {
  const match = SCHEMA.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!match) throw new Error(`enum ${name} not found in schema.prisma`);
  return match[1]!
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
}

interface Machine {
  label: string;
  enumName: string;
  map: Readonly<Record<string, readonly string[]>>;
  start: string;
  /**
   * آلة بلا حالة نهائية عن قصد. الشهادة وحدها كذلك: مستند يُجدَّد بلا نهاية،
   * فانتهاء صلاحيته يعيده إلى الطلب لا إلى قبر. الوسم صريح حتى لا يمرّ غياب
   * المخرج النهائي في آلة أخرى بوصفه سهواً.
   */
  cyclicByDesign?: true;
}

const MACHINES: Machine[] = [
  { label: 'RFQ', enumName: 'RFQStatus', map: RFQ_TRANSITIONS, start: 'DRAFT' },
  {
    label: 'Order',
    enumName: 'OrderStatus',
    map: ORDER_TRANSITIONS,
    start: 'CREATED',
  },
  {
    label: 'Payment',
    enumName: 'PaymentStatus',
    map: PAYMENT_TRANSITIONS,
    start: 'PENDING',
  },
  {
    label: 'Shipment',
    enumName: 'ShipmentStatus',
    map: SHIPMENT_TRANSITIONS,
    start: 'PENDING',
  },
  {
    label: 'Supplier',
    enumName: 'SupplierStatus',
    map: SUPPLIER_TRANSITIONS,
    start: 'PENDING',
  },
  {
    label: 'ComplianceReview',
    enumName: 'ComplianceReviewStatus',
    map: COMPLIANCE_REVIEW_TRANSITIONS,
    start: 'NOT_REQUIRED',
  },
  {
    label: 'Certificate',
    enumName: 'CertificateStatus',
    map: CERTIFICATE_TRANSITIONS,
    start: 'NOT_REQUIRED',
    cyclicByDesign: true,
  },
];

/** كل ما يمكن بلوغه من نقطة البدء عبر الخريطة. */
function reachableFrom(
  map: Readonly<Record<string, readonly string[]>>,
  start: string,
): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of map[queue.shift()!] ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe.each(MACHINES)('$label state machine', (machine: Machine) => {
  const states = Object.keys(machine.map);

  it('يطابق تعداد schema.prisma حالةً بحالة', () => {
    expect([...states].sort()).toEqual(
      [...prismaEnum(machine.enumName)].sort(),
    );
  });

  it('لا يشير إلى حالة خارج التعداد', () => {
    const known = new Set(states);
    for (const [from, targets] of Object.entries(machine.map)) {
      for (const to of targets) {
        expect(known.has(to)).toBe(true);
        expect(`${from}→${to}`).not.toBe(`${from}→${from}`); // لا انتقال لذاته
      }
    }
  });

  it('كل حالة قابلة للبلوغ من نقطة البدء', () => {
    const reachable = reachableFrom(machine.map, machine.start);
    expect([...states].filter((s) => !reachable.has(s))).toEqual([]);
  });

  it('كل حالة حيّة تصل إلى حالة نهائية، إلا ما كان دورياً بقصد', () => {
    const stuck = states.filter((state) => {
      const reachable = reachableFrom(machine.map, state);
      return ![...reachable].some((s) => machine.map[s]!.length === 0);
    });
    if (machine.cyclicByDesign) {
      // نؤكّد الدوريّة بدل تجاهل الفحص: لو أُضيفت حالة نهائية لاحقاً فقد تغيّر
      // النموذج، ويجب أن يُراجَع الوسم بدل أن يمرّ الاختبار صامتاً.
      expect(stuck).toEqual(states);
      return;
    }
    expect(stuck).toEqual([]);
  });

  it('الخريطة مجمّدة فلا تُعدّل وقت التشغيل', () => {
    expect(Object.isFrozen(machine.map)).toBe(true);
  });

  it('لا يوجد هدف مكرّر في أي قائمة انتقال', () => {
    for (const [, targets] of Object.entries(machine.map)) {
      expect(targets.length).toBe(new Set(targets).size);
    }
  });
});

describe('العدد الذي تنصّ عليه CLAUDE.md', () => {
  it('RFQ تسع حالات و Order عشرون', () => {
    expect(Object.keys(RFQ_TRANSITIONS)).toHaveLength(9);
    expect(Object.keys(ORDER_TRANSITIONS)).toHaveLength(20);
  });
});

describe('RFQ — رفض الانتقالات غير المشروعة', () => {
  it('لا يعيد طلباً ملغى إلى الحياة', () => {
    expect(canTransitionRfq('CANCELLED', 'DRAFT')).toBe(false);
    expect(() => assertRfqTransition('CANCELLED', 'DRAFT')).toThrow(
      RfqTransitionError,
    );
  });

  it('لا يقفز من المسودة إلى تحويل الطلب', () => {
    expect(canTransitionRfq('DRAFT', 'CONVERTED_TO_ORDER')).toBe(false);
  });

  it('لا يعرض عروضاً قبل بوابة التوافق', () => {
    expect(canTransitionRfq('FITMENT_REVIEW', 'QUOTES_READY')).toBe(false);
  });

  it('لا يخرج من حالة نهائية إطلاقاً', () => {
    for (const terminal of ['CONVERTED_TO_ORDER', 'CANCELLED'] as RfqState[]) {
      expect(isTerminalRfqState(terminal)).toBe(true);
      expect(RFQ_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('يقبل المسار الطبيعي كاملاً', () => {
    const path: RfqState[] = [
      'DRAFT',
      'FITMENT_REVIEW',
      'SOURCING_LOCAL',
      'SOURCING_GLOBAL',
      'QUOTES_READY',
      'CUSTOMER_SELECTED',
      'CONVERTED_TO_ORDER',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertRfqTransition(path[i]!, path[i + 1]!)).not.toThrow();
    }
  });

  it('يسمح بالإلغاء من كل حالة حيّة', () => {
    for (const state of Object.keys(RFQ_TRANSITIONS) as RfqState[]) {
      if (isTerminalRfqState(state)) continue;
      expect(canTransitionRfq(state, 'CANCELLED')).toBe(true);
    }
  });
});

describe('Order — المال لا يُنسى', () => {
  it('لا إلغاء بعد احتجاز الضمان، بل ردّ', () => {
    expect(canTransitionOrder('ESCROW_HELD', 'CANCELLED')).toBe(false);
    expect(canTransitionOrder('ESCROW_HELD', 'REFUNDED')).toBe(true);
    expect(() => assertOrderTransition('ESCROW_HELD', 'CANCELLED')).toThrow(
      OrderTransitionError,
    );
  });

  it('لا يُصرف للمورد إلا بعد إغلاق نافذة الشكوى', () => {
    for (const state of Object.keys(ORDER_TRANSITIONS) as OrderState[]) {
      if (state === 'CLOSED') continue;
      expect(canTransitionOrder(state, 'PAYOUT_RELEASED')).toBe(false);
    }
    expect(canTransitionOrder('CLOSED', 'PAYOUT_RELEASED')).toBe(true);
  });

  it('يعرف أي الحالات ما زال فيها مال محتجز', () => {
    expect(holdsEscrowMoney('ESCROW_HELD')).toBe(true);
    expect(holdsEscrowMoney('IN_TRANSIT')).toBe(true);
    expect(holdsEscrowMoney('CREATED')).toBe(false);
    expect(holdsEscrowMoney('REFUNDED')).toBe(false);
    expect(holdsEscrowMoney('PAYOUT_RELEASED')).toBe(false);
  });
});

describe('Payment — لا التقاط بعد تسوية', () => {
  it('يرفض إحياء دفعة مسوّاة', () => {
    for (const settled of [
      'RELEASED',
      'REFUNDED',
      'FAILED',
      'CANCELLED',
    ] as PaymentState[]) {
      expect(PAYMENT_TRANSITIONS[settled]).toEqual([]);
    }
  });

  it('لا يحتجز مبلغاً لم يُحصّل', () => {
    expect(PAYMENT_TRANSITIONS.PENDING).not.toContain('HELD');
    expect(PAYMENT_TRANSITIONS.AUTHORIZED).not.toContain('HELD');
    expect(PAYMENT_TRANSITIONS.CAPTURED).toContain('HELD');
  });
});

describe('Shipment — الفقد والإرجاع', () => {
  it('لا تُسلَّم شحنة لم تخرج للتوصيل', () => {
    expect(canTransitionShipment('PENDING', 'DELIVERED')).toBe(false);
    expect(() => assertShipmentTransition('PENDING', 'DELIVERED')).toThrow(
      ShipmentTransitionError,
    );
    expect(canTransitionShipment('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
  });

  it('لا تُفقد شحنة قبل دخولها عهدة الناقل', () => {
    expect(canTransitionShipment('PENDING', 'LOST')).toBe(false);
    expect(canTransitionShipment('LABEL_CREATED', 'LOST')).toBe(false);
    expect(canTransitionShipment('PICKED_UP', 'LOST')).toBe(true);
  });

  it('يسمح بالإرجاع بعد التسليم ضمن نافذة الشكوى', () => {
    expect(canTransitionShipment('DELIVERED', 'RETURNED')).toBe(true);
  });
});

describe('Supplier — التقييد والإيقاف ليسا نهايةً', () => {
  it('يعيد المورد الموقوف إلى العمل بشروط', () => {
    expect(canTransitionSupplier('SUSPENDED', 'APPROVED')).toBe(true);
    expect(canTransitionSupplier('SUSPENDED', 'LIMITED')).toBe(true);
  });

  it('لا يحيي مورداً مرفوضاً — العودة بتسجيل جديد', () => {
    expect(SUPPLIER_TRANSITIONS.REJECTED).toEqual([]);
    expect(() => assertSupplierTransition('REJECTED', 'APPROVED')).toThrow(
      SupplierTransitionError,
    );
  });

  it('لا يعتمد مورداً دون مراجعة', () => {
    expect(canTransitionSupplier('PENDING', 'APPROVED')).toBe(false);
  });

  it('يستقبل الطلبات عند الاعتماد الكامل فقط حتى يوجد نطاق حقيقي للتقييد', () => {
    expect(canSupplierReceiveRfqs('APPROVED')).toBe(true);
    for (const blocked of [
      'PENDING',
      'UNDER_REVIEW',
      'LIMITED',
      'SUSPENDED',
      'REJECTED',
    ] as const) {
      expect(canSupplierReceiveRfqs(blocked)).toBe(false);
    }
  });
});

describe('Compliance — مراجعة تُحسم وشهادة تنتهي', () => {
  it('لا يوافق على مراجعة لم تُفتح', () => {
    expect(() =>
      assertComplianceReviewTransition('PENDING', 'APPROVED'),
    ).toThrow(ComplianceTransitionError);
    expect(() =>
      assertComplianceReviewTransition('UNDER_REVIEW', 'APPROVED'),
    ).not.toThrow();
  });

  it('قرار المراجعة نهائي على السجل نفسه', () => {
    expect(COMPLIANCE_REVIEW_TRANSITIONS.APPROVED).toEqual([]);
    expect(COMPLIANCE_REVIEW_TRANSITIONS.REJECTED).toEqual([]);
  });

  it('الشهادة تُجدَّد بعد الانتهاء أو الرفض', () => {
    expect(() =>
      assertCertificateTransition('EXPIRED', 'PENDING'),
    ).not.toThrow();
    expect(() =>
      assertCertificateTransition('REJECTED', 'PENDING'),
    ).not.toThrow();
    expect(() => assertCertificateTransition('EXPIRED', 'APPROVED')).toThrow(
      ComplianceTransitionError,
    );
  });

  it('يفسح الشحن عند الموافقة أو عند انتفاء الحاجة فقط', () => {
    expect(complianceClearsShipping('APPROVED')).toBe(true);
    expect(complianceClearsShipping('NOT_REQUIRED')).toBe(true);
    for (const blocked of ['PENDING', 'UNDER_REVIEW', 'REJECTED'] as const) {
      expect(complianceClearsShipping(blocked)).toBe(false);
    }
  });
});
