import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { orderPaymentIntakeLockKey } from '../../shared/src/payments/payment-intake-lock.ts';

const projectId = process.env.EXPECTED_NEON_PROJECT_ID?.trim() ?? '';
const branchId = process.env.EXPECTED_NEON_BRANCH_ID?.trim() ?? '';
const releaseSha = process.env.RELEASE_SHA?.trim() ?? '';
const output = process.env.DATABASE_BEHAVIOR_OUTPUT?.trim() ?? '';
if (
  !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(projectId) ||
  !/^br-[a-z0-9][a-z0-9-]{2,63}$/u.test(branchId) ||
  !/^[0-9a-f]{40}$/u.test(releaseSha) ||
  !output ||
  /[\r\n\0]/u.test(output)
)
  throw new Error('Financial rehearsal inputs are invalid');

const owner = new PrismaClient();
const contender = new PrismaClient();
const suffix = `${process.pid}-${Date.now()}`;
const ids = {
  scenario: `financial-rehearsal-${suffix}`,
  tenant: `customer-rehearsal-${suffix}`,
  user: `user-rehearsal-${suffix}`,
  rfq: `rfq-rehearsal-${suffix}`,
  item: `item-rehearsal-${suffix}`,
  quote: `quote-rehearsal-${suffix}`,
  order: `order-rehearsal-${suffix}`,
  payment: `payment-rehearsal-${suffix}`,
};
const locks = [
  `order-financial-resolution:${ids.order}`,
  orderPaymentIntakeLockKey(ids.order),
];

async function acquireFinancialScope(tx) {
  for (const lock of locks)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
}
async function reservePayment(client, paymentId) {
  return client.$transaction(
    async (tx) => {
      await acquireFinancialScope(tx);
      const existing = await tx.payment.findFirst({
        where: {
          orderId: ids.order,
          status: {
            in: ['PENDING', 'AUTHORIZED', 'CAPTURED', 'HELD', 'RELEASED'],
          },
        },
        select: { id: true },
      });
      if (existing) return 'REPLAYED';
      await tx.payment.create({
        data: {
          id: paymentId,
          orderId: ids.order,
          provider: 'REHEARSAL',
          status: 'PENDING',
          amount: '100.00',
          currency: 'SAR',
          externalRef: paymentId,
        },
      });
      return 'CREATED';
    },
    { timeout: 10_000 },
  );
}

let cleanupVerified = false;
let evidence;
try {
  const [identity] =
    await owner.$queryRaw`SELECT current_setting('neon.project_id', true) AS project_id, current_setting('neon.branch_id', true) AS branch_id`;
  if (identity?.project_id !== projectId || identity?.branch_id !== branchId)
    throw new Error(
      'Financial rehearsal target is not the exact disposable Neon branch',
    );
  const customerRole = await owner.role.findUniqueOrThrow({
    where: { name: 'CUSTOMER' },
  });
  await owner.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: ids.user,
        phone: `+9665${String(Date.now()).slice(-8)}`,
        fullName: 'Rehearsal',
        roleId: customerRole.id,
      },
    });
    await tx.customer.create({
      data: { id: ids.tenant, userId: ids.user, fullName: 'Rehearsal tenant' },
    });
    await tx.rFQ.create({
      data: { id: ids.rfq, code: `RFQ-${suffix}`, customerId: ids.tenant },
    });
    await tx.rFQItem.create({
      data: { id: ids.item, rfqId: ids.rfq, freeTextAr: 'بروفة مالية معزولة' },
    });
    await tx.quote.create({
      data: {
        id: ids.quote,
        code: `Q-${suffix}`,
        rfqItemId: ids.item,
        sourceType: 'LOCAL',
        finalPrice: '100.00',
        currency: 'SAR',
        status: 'SELECTED',
      },
    });
    await tx.order.create({
      data: {
        id: ids.order,
        code: `ORD-${suffix}`,
        customerId: ids.tenant,
        rfqId: ids.rfq,
        quoteId: ids.quote,
        status: 'AWAITING_PAYMENT',
        totalAmount: '100.00',
        currency: 'SAR',
      },
    });
  });

  let inserted;
  let releaseFirst;
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const release = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = owner
    .$transaction(
      async (tx) => {
        await acquireFinancialScope(tx);
        const existing = await tx.payment.findFirst({
          where: {
            orderId: ids.order,
            status: {
              in: ['PENDING', 'AUTHORIZED', 'CAPTURED', 'HELD', 'RELEASED'],
            },
          },
        });
        if (existing) return 'REPLAYED';
        await tx.payment.create({
          data: {
            id: ids.payment,
            orderId: ids.order,
            provider: 'REHEARSAL',
            status: 'PENDING',
            amount: '100.00',
            currency: 'SAR',
            externalRef: ids.payment,
          },
        });
        inserted = true;
        signalStarted();
        await release;
        return 'CREATED';
      },
      { timeout: 10_000 },
    )
    .catch((error) => {
      signalStarted();
      throw error;
    });
  await started;
  if (!inserted) await first;
  const second = reservePayment(contender, `${ids.payment}-contender`);
  setTimeout(() => releaseFirst(), 100);
  const settled = await Promise.allSettled([first, second]);
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  const outcomes = settled.map((result) => result.value);
  if (
    !inserted ||
    outcomes.filter((value) => value === 'CREATED').length !== 1 ||
    outcomes.filter((value) => value === 'REPLAYED').length !== 1
  )
    throw new Error(
      'Competing financial intake did not produce one winner and one replay',
    );
  const retry = await reservePayment(contender, `${ids.payment}-retry`);
  const activePaymentCount = await owner.payment.count({
    where: {
      orderId: ids.order,
      status: { in: ['PENDING', 'AUTHORIZED', 'CAPTURED', 'HELD', 'RELEASED'] },
    },
  });
  const ledgerConflictCount = await owner.escrowLedgerEntry.count({
    where: { orderId: ids.order },
  });
  if (
    retry !== 'REPLAYED' ||
    activePaymentCount !== 1 ||
    ledgerConflictCount !== 0
  )
    throw new Error('Financial idempotency or ledger invariant failed');
  evidence = {
    schemaVersion: 'rafraf-financial-rehearsal-v2',
    generatedAt: new Date().toISOString(),
    releaseSha,
    projectId,
    branchId,
    conflictCount: 0,
    scenarioId: ids.scenario,
    tenantId: ids.tenant,
    lockNamespaces: locks,
    competingAttempts: 2,
    winnerCount: 1,
    activePaymentCount,
    idempotentReplayCount: 2,
    ledgerConflictCount,
  };
} finally {
  await owner.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { orderId: ids.order } });
    await tx.order.deleteMany({ where: { id: ids.order } });
    await tx.quote.deleteMany({ where: { id: ids.quote } });
    await tx.rFQItem.deleteMany({ where: { id: ids.item } });
    await tx.rFQ.deleteMany({ where: { id: ids.rfq } });
    await tx.customer.deleteMany({ where: { id: ids.tenant } });
    await tx.user.deleteMany({ where: { id: ids.user } });
  });
  cleanupVerified = (await owner.user.count({ where: { id: ids.user } })) === 0;
  await Promise.all([owner.$disconnect(), contender.$disconnect()]);
}
if (!cleanupVerified)
  throw new Error('Financial rehearsal cleanup left persistent fixture rows');
await writeFile(
  output,
  `${JSON.stringify({ ...evidence, cleanupVerified })}\n`,
  { mode: 0o600 },
);
process.stdout.write(
  'Tenant-scoped payment intake contention, idempotency, ledger, and cleanup verified.\n',
);
