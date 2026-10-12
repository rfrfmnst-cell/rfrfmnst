'use server';

import {
  ActorType,
  Prisma,
  QuoteSourceType,
  RFQStatus,
  SourcingRunStatus,
  prisma,
} from '@rafraf/db';
import {
  GLOBAL_SOURCING_MAX_RESULTS,
  GlobalSourcingContractError,
  isVinLikeSearchQuery,
  normalizeGlobalSourcingSearchRequest,
} from '@rafraf/shared/global-sourcing';
import { isPartCommerceRestricted } from '@rafraf/shared/product-os/part-restriction';
import { evaluateFitmentGate } from '@rafraf/shared/workflow/fitment-gate';
import { canTransitionRfq } from '@rafraf/shared/workflow/rfq-state';
import { revalidatePath } from 'next/cache';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import { AbcpDiscoveryError } from '../../../lib/global-sourcing/abcp';
import { ApmDiscoveryError } from '../../../lib/global-sourcing/apm';
import { EbayBrowseDiscoveryError } from '../../../lib/global-sourcing/ebay-browse';
import { globalDiscoveryProviderRuntime } from '../../../lib/global-sourcing/provider-registry';

const GLOBAL_SOURCING_COOLDOWN_MS = 60_000;

class GlobalSourcingPolicyError extends Error {
  constructor(readonly code: 'PART_RESTRICTED') {
    super(code);
    this.name = 'GlobalSourcingPolicyError';
  }
}

export interface GlobalSourcingActionState {
  error?: string;
  success?: string;
  persistedCount?: number;
}

type StartSourcingRunResult =
  | { ok: false; errorCode: string }
  | { ok: true; runId: string; sourceRegistryId: string };

function startSourcingRunError(errorCode: string): StartSourcingRunResult {
  return { ok: false, errorCode };
}

function safeRunNotes(input: {
  providerKey: string;
  metadata: Record<string, string>;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  resultCount?: number;
  errorCode?: string;
}): string {
  return JSON.stringify({
    providerKey: input.providerKey,
    capability: 'SEARCH',
    ...input.metadata,
    status: input.status,
    ...(input.resultCount === undefined
      ? {}
      : { resultCount: input.resultCount }),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  });
}

function publicError(code: string): string {
  if (code === 'SOURCE_COOLDOWN') {
    return 'تم تنفيذ بحث لهذا العنصر قبل أقل من دقيقة. انتظر قليلاً ثم أعد المحاولة.';
  }
  if (code === 'SOURCE_DISABLED') {
    return 'هذا المصدر العالمي معطّل من سجل المصادر في لوحة الإدارة.';
  }
  if (code === 'EBAY_QUERY_TOO_LONG' || code === 'QUERY_TOO_LONG') {
    return 'بحث eBay يقبل حتى 100 حرف. استخدم رقم OEM أو وصفاً أقصر.';
  }
  if (
    code === 'QUERY_REQUIRED' ||
    code === 'QUERY_TOO_SHORT' ||
    code === 'QUERY_WILDCARD_FORBIDDEN'
  ) {
    return 'اكتب رقم OEM أو وصفاً واضحاً من 3 إلى 100 حرف، من دون علامة *.';
  }
  if (code === 'EBAY_RATE_LIMITED') {
    return 'بلغ موصل eBay حد الطلبات مؤقتاً. حاول لاحقاً.';
  }
  if (code === 'EBAY_TIMEOUT' || code === 'EBAY_UNAVAILABLE') {
    return 'تعذّر الوصول إلى eBay خلال المهلة. لم يُنشأ أي عرض أو طلب شراء.';
  }
  if (code === 'APM_CODE_INVALID') {
    return 'بحث APM يحتاج رقم OEM أو رقم قطعة صحيحاً، حتى 64 حرفاً ومن دون مسافات أو رموز غير مسموحة.';
  }
  if (code === 'APM_RATE_LIMITED') {
    return 'بلغ موصل APM حد الطلبات مؤقتاً. حاول لاحقاً.';
  }
  if (code === 'APM_TIMEOUT' || code === 'APM_UNAVAILABLE') {
    return 'تعذّر الوصول إلى APM خلال المهلة. لم يُنشأ أي عرض أو طلب شراء.';
  }
  if (code === 'ABCP_CODE_INVALID') {
    return 'بحث ABCP يحتاج رقم OEM أو رقم قطعة صحيحاً، حتى 64 حرفاً ومن دون مسافات أو رموز غير مسموحة.';
  }
  if (code === 'ABCP_AUTH_FAILED' || code === 'ABCP_ACCESS_BLOCKED') {
    return 'رفض تجار ABCP الدخول أو لم يفعّلوا الوصول عبر API لحساب رفرف.';
  }
  if (code === 'ABCP_RATE_LIMITED') {
    return 'بلغ تجار ABCP حد الطلبات مؤقتاً. حاول لاحقاً.';
  }
  if (code === 'ABCP_TIMEOUT' || code === 'ABCP_UNAVAILABLE') {
    return 'تعذّر الوصول إلى تجار ABCP خلال المهلة. لم يُنشأ أي عرض أو طلب شراء.';
  }
  if (code === 'RFQ_CLOSED') {
    return 'لا يمكن بدء بحث عالمي لطلب مغلق أو محوّل إلى أمر شراء.';
  }
  if (code === 'RFQ_STATE_NOT_SOURCEABLE') {
    return 'لا يمكن بدء البحث العالمي من حالة الطلب الحالية. راجع مرحلة الطلب في لوحة العمليات.';
  }
  if (code === 'PART_RESTRICTED') {
    return 'هذه القطعة أو فئتها محظورة من التوريد التجاري ولا يمكن إرسالها إلى مصدر خارجي.';
  }
  if (code === 'FITMENT_REVIEW_REQUIRED') {
    return 'أكمل ربط القطعة ومراجعة التوافق قبل بدء البحث العالمي. لم يُرسل أي طلب إلى مصدر خارجي.';
  }
  if (code === 'VIN_FORBIDDEN') {
    return 'لا يُرسل رقم الهيكل إلى مصدر خارجي. استخدم رقم OEM أو اسم القطعة.';
  }
  if (code === 'RFQ_ITEM_INVALID') return 'عنصر الطلب غير صالح.';
  return 'تعذّر تنفيذ البحث العالمي. لم يُنشأ أي عرض أو طلب شراء.';
}

function externalErrorCode(error: unknown): {
  code: string;
  retryable: boolean;
} {
  if (error instanceof EbayBrowseDiscoveryError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (
    error instanceof ApmDiscoveryError ||
    error instanceof AbcpDiscoveryError
  ) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof GlobalSourcingPolicyError) {
    return { code: error.code, retryable: false };
  }
  return { code: 'GLOBAL_DISCOVERY_FAILED', retryable: false };
}

export async function discoverGlobalCandidates(
  _previous: GlobalSourcingActionState,
  formData: FormData,
): Promise<GlobalSourcingActionState> {
  void _previous;
  const admin = await requireAdminPermission('QUOTE_WRITE');
  const rfqId = String(formData.get('rfqId') ?? '').trim();
  const rfqItemId = String(formData.get('rfqItemId') ?? '').trim();
  const runtime = globalDiscoveryProviderRuntime(formData.get('providerKey'));
  if (!runtime) {
    return { error: 'المصدر العالمي المحدد غير معتمد.' };
  }

  let query: string;
  try {
    query = normalizeGlobalSourcingSearchRequest({
      query: formData.get('query'),
      limit: GLOBAL_SOURCING_MAX_RESULTS,
    }).query;
  } catch (error) {
    const code =
      error instanceof GlobalSourcingContractError
        ? error.code
        : 'QUERY_REQUIRED';
    return { error: publicError(code) };
  }
  const queryError = runtime.queryError(query);
  if (queryError) return { error: publicError(queryError) };

  const provider = runtime.provider;
  if (!runtime.status.configured || !provider) {
    return {
      error: `موصل ${runtime.status.label} غير مفعّل أو إعداداته ناقصة. راجع متغيرات الخادم في readiness.`,
    };
  }

  const providerKey = runtime.status.key;
  const sourceName = runtime.status.sourceName;

  const started = await prisma
    .$transaction(async (tx): Promise<StartSourcingRunResult> => {
      const lockKey = `admin:global-sourcing:${rfqItemId}:${providerKey}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const item = await tx.rFQItem.findUnique({
        where: { id: rfqItemId },
        select: {
          rfqId: true,
          partId: true,
          fitmentConfidence: true,
          humanReviewRequired: true,
          part: {
            select: {
              isRestricted: true,
              sensitivity: true,
              category: {
                select: { isRestricted: true, sensitivity: true },
              },
            },
          },
          rfq: {
            select: {
              status: true,
              vehicle: { select: { vin: true } },
            },
          },
        },
      });
      if (!item || item.rfqId !== rfqId) {
        return { ok: false, errorCode: 'RFQ_ITEM_INVALID' };
      }
      if (isPartCommerceRestricted(item.part)) {
        return { ok: false, errorCode: 'PART_RESTRICTED' };
      }
      if (!evaluateFitmentGate(item).ready) {
        return { ok: false, errorCode: 'FITMENT_REVIEW_REQUIRED' };
      }
      if (
        item.rfq.status === RFQStatus.CANCELLED ||
        item.rfq.status === RFQStatus.CONVERTED_TO_ORDER
      ) {
        return { ok: false, errorCode: 'RFQ_CLOSED' };
      }
      if (
        item.rfq.status !== RFQStatus.SOURCING_GLOBAL &&
        !canTransitionRfq(item.rfq.status, RFQStatus.SOURCING_GLOBAL)
      ) {
        return { ok: false, errorCode: 'RFQ_STATE_NOT_SOURCEABLE' };
      }

      if (isVinLikeSearchQuery(query)) {
        return { ok: false, errorCode: 'VIN_FORBIDDEN' };
      }

      const recent = await tx.sourcingRun.findFirst({
        where: {
          rfqItemId,
          startedAt: {
            gt: new Date(Date.now() - GLOBAL_SOURCING_COOLDOWN_MS),
          },
          notes: { startsWith: `{"providerKey":"${providerKey}"` },
        },
        select: { id: true },
        orderBy: { startedAt: 'desc' },
      });
      if (recent) return { ok: false, errorCode: 'SOURCE_COOLDOWN' };

      const registryLock = `admin:global-source-registry:${providerKey}:${sourceName}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${registryLock}))`;
      let source = await tx.sourceRegistry.findFirst({
        where: { name: sourceName, type: QuoteSourceType.GLOBAL },
        select: { id: true, isActive: true },
        orderBy: { id: 'asc' },
      });
      if (source && !source.isActive) {
        return { ok: false, errorCode: 'SOURCE_DISABLED' };
      }
      source ??= await tx.sourceRegistry.create({
        data: {
          name: sourceName,
          type: QuoteSourceType.GLOBAL,
          country: runtime.sourceCountry,
          url: runtime.sourceUrl,
          notes: runtime.sourceNotes,
        },
        select: { id: true, isActive: true },
      });

      const run = await tx.sourcingRun.create({
        data: {
          rfqItemId,
          startedBy: admin.userId,
          status: SourcingRunStatus.RUNNING,
          notes: safeRunNotes({
            providerKey,
            metadata: runtime.runMetadata,
            status: 'RUNNING',
          }),
        },
        select: { id: true },
      });
      if (item.rfq.status !== RFQStatus.SOURCING_GLOBAL) {
        const updated = await tx.rFQ.updateMany({
          where: { id: rfqId, status: item.rfq.status },
          data: { status: RFQStatus.SOURCING_GLOBAL },
        });
        if (updated.count !== 1) {
          throw new Error('RFQ_STATUS_CHANGED');
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.userId,
          actorType: ActorType.ADMIN,
          action: 'global_sourcing.discovery.started',
          entityType: 'sourcing_run',
          entityId: run.id,
          after: {
            providerKey,
            capability: 'SEARCH',
            ...runtime.runMetadata,
            resultLimit: GLOBAL_SOURCING_MAX_RESULTS,
          },
        },
      });
      return { ok: true, runId: run.id, sourceRegistryId: source.id };
    })
    .catch(() => {
      console.error('[global-sourcing] failed to start sourcing run', {
        code: 'RUN_START_FAILED',
      });
      return startSourcingRunError('RUN_START_FAILED');
    });

  if (!started.ok) {
    return { error: publicError(started.errorCode) };
  }

  try {
    const result = await provider.search({
      query,
      limit: GLOBAL_SOURCING_MAX_RESULTS,
    });
    if (
      result.providerKey !== providerKey ||
      result.capability !== 'SEARCH' ||
      result.candidates.length > GLOBAL_SOURCING_MAX_RESULTS
    ) {
      throw runtime.invalidResponse();
    }

    await prisma.$transaction(async (tx) => {
      const lockKey = `admin:global-sourcing-persist:${started.runId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const run = await tx.sourcingRun.findUnique({
        where: { id: started.runId },
        select: {
          status: true,
          rfqItem: {
            select: {
              part: {
                select: {
                  isRestricted: true,
                  sensitivity: true,
                  category: {
                    select: { isRestricted: true, sensitivity: true },
                  },
                },
              },
              rfq: { select: { status: true } },
            },
          },
        },
      });
      if (
        !run ||
        run.status !== SourcingRunStatus.RUNNING ||
        run.rfqItem.rfq.status === RFQStatus.CANCELLED ||
        run.rfqItem.rfq.status === RFQStatus.CONVERTED_TO_ORDER
      ) {
        throw new Error('SOURCING_RUN_NOT_RUNNING');
      }
      if (isPartCommerceRestricted(run.rfqItem.part)) {
        throw new GlobalSourcingPolicyError('PART_RESTRICTED');
      }

      if (result.candidates.length) {
        await tx.sourcingCandidate.createMany({
          data: result.candidates.map((candidate) => ({
            sourcingRunId: started.runId,
            sourceType: QuoteSourceType.GLOBAL,
            sourceRegistryId: started.sourceRegistryId,
            partRef: candidate.externalId,
            rawPrice: new Prisma.Decimal(candidate.rawPrice),
            currency: candidate.currency,
            availability: candidate.availability,
            fitmentConfidence: null,
            notes: JSON.stringify({
              providerKey: candidate.provenance.providerKey,
              title: candidate.provenance.title,
              itemWebUrl: candidate.provenance.itemWebUrl,
              listingMarketplaceId: candidate.provenance.listingMarketplaceId,
              itemLocationCountry: candidate.provenance.itemLocationCountry,
              condition: candidate.provenance.condition,
              buyingOptions: candidate.provenance.buyingOptions,
              fitmentEvidence: candidate.provenance.fitmentEvidence,
              supplierOffer: candidate.provenance.supplierOffer ?? null,
              discoveredAt: candidate.provenance.discoveredAt,
              discoveryOnly: true,
            }),
          })),
        });
      }
      await tx.sourcingRun.update({
        where: { id: started.runId },
        data: {
          status: SourcingRunStatus.DONE,
          finishedAt: new Date(),
          notes: safeRunNotes({
            providerKey,
            metadata: runtime.runMetadata,
            status: 'DONE',
            resultCount: result.candidates.length,
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.userId,
          actorType: ActorType.ADMIN,
          action: 'global_sourcing.discovery.completed',
          entityType: 'sourcing_run',
          entityId: started.runId,
          after: {
            providerKey,
            capability: 'SEARCH',
            ...runtime.runMetadata,
            persistedCount: result.candidates.length,
          },
        },
      });
    });

    revalidatePath(`/rfq/${rfqId}`);
    revalidatePath('/');
    return {
      success: `اكتمل الاستكشاف وحُفظت ${result.candidates.length} نتيجة خام للمراجعة الإدارية.`,
      persistedCount: result.candidates.length,
    };
  } catch (error) {
    const failure = externalErrorCode(error);
    console.error('[global-sourcing] provider discovery failed', {
      providerKey,
      code: failure.code,
      retryable: failure.retryable,
    });
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.sourcingRun.updateMany({
          where: {
            id: started.runId,
            status: SourcingRunStatus.RUNNING,
          },
          data: {
            status: SourcingRunStatus.FAILED,
            finishedAt: new Date(),
            notes: safeRunNotes({
              providerKey,
              metadata: runtime.runMetadata,
              status: 'FAILED',
              errorCode: failure.code,
            }),
          },
        });
        if (updated.count === 1) {
          await tx.auditLog.create({
            data: {
              actorId: admin.userId,
              actorType: ActorType.ADMIN,
              action: 'global_sourcing.discovery.failed',
              entityType: 'sourcing_run',
              entityId: started.runId,
              after: {
                providerKey,
                errorCode: failure.code,
                retryable: failure.retryable,
              },
            },
          });
        }
      });
    } catch {
      console.error('[global-sourcing] failed to close sourcing run', {
        code: 'RUN_CLOSE_FAILED',
      });
    }
    revalidatePath(`/rfq/${rfqId}`);
    return { error: publicError(failure.code) };
  }
}
