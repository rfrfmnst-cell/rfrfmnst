import {
  ActorType,
  AIDecisionKind,
  prisma,
  Prisma,
  RfqChannel,
  RFQStatus,
} from '@rafraf/db';
import { triageRfqIntake } from '@rafraf/shared/ai/intake-triage';
import { verifyTurnstileToken } from '@rafraf/shared/security/turnstile';
import { headers } from 'next/headers';
import { ADMIN_DASHBOARD_URL } from '../../lib/admin-public-url';
import { summarizeChatTriageDecision } from '../../lib/chat-decision-summary';
import {
  CustomerIdentityVerificationRequired,
  requireVerifiedPublicIntakeCustomer,
} from '../../lib/public-intake-identity';
import {
  LEGACY_EVIDENCE_UPLOAD_ERROR,
  legacyEvidencePayloadHasDataUri,
} from '../../lib/legacy-intake-security';
import { notifyOps } from '../../lib/notify';
import { publicIntakeText } from '../../lib/public-intake-input';
import {
  PublicIntakeRateLimitError,
  reservePublicIntake,
} from '../../lib/public-intake-rate-limit';
import { opaqueRequestSubject, requestIpSubject } from '../../lib/request-subject';
import { normalizeSaudiPhone } from '../../lib/saudi-phone';
import { getSessionCustomerId } from '../../lib/session';
import { reserveCustomerTurnstileSiteverify } from '../../lib/turnstile-quota';

export interface RfqFormState {
  ok?: boolean;
  code?: string;
  error?: string;
  verificationRequired?: boolean;
  /** echoed inputs so the form can repopulate after a server-side error
   *  (React 19 resets uncontrolled fields after every form action) */
  values?: Record<string, string>;
}


/** إنشاء RFQ مع إعادة توليد الكود عند تصادم unique (P2002) — حتى 3 محاولات. */
async function createRfqWithRetry(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  data: Omit<Parameters<typeof prisma.rFQ.create>[0]['data'], 'code'>,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await tx.rFQ.create({
        data: { ...data, code: rfqCode() } as Parameters<
          typeof prisma.rFQ.create
        >[0]['data'],
      });
    } catch (e) {
      const isUnique =
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        e.code === 'P2002';
      if (!isUnique || attempt >= 2) throw e;
    }
  }
}

function rfqCode(): string {
  // RFQ-YYMM + 5 random digits, e.g. RFQ-2607-48213
  const d = new Date();
  const ym = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `RFQ-${ym}-${rand}`;
}

class RfqRateLimitError extends Error {}

export async function submitRfqUseCase(
  _prev: RfqFormState,
  formData: FormData,
): Promise<RfqFormState> {
  const values = {
    fullName: publicIntakeText(formData.get('fullName'), 100),
    phone: publicIntakeText(formData.get('phone'), 24),
    make: publicIntakeText(formData.get('make'), 60),
    model: publicIntakeText(formData.get('model'), 80),
    year: publicIntakeText(formData.get('year'), 4),
    partText: publicIntakeText(formData.get('partText'), 240),
    oemNumber: publicIntakeText(formData.get('oemNumber'), 32),
    vin: publicIntakeText(formData.get('vin'), 17),
    notes: publicIntakeText(formData.get('notes'), 500),
  };
  try {
    const legacyEvidencePayload = String(formData.get('images') ?? '');
    if (legacyEvidencePayloadHasDataUri(legacyEvidencePayload)) {
      return { error: LEGACY_EVIDENCE_UPLOAD_ERROR, values };
    }

    const { fullName, make, model, partText, oemNumber, vin, notes } = values;
    const phone = normalizeSaudiPhone(values.phone);
    const yearRaw = values.year;

    if (!fullName) return { error: 'الاسم مطلوب.', values };
    if (!phone)
      return { error: 'أدخل جوالاً سعودياً صحيحاً (05xxxxxxxx).', values };
    if (!partText) return { error: 'صف القطعة المطلوبة.', values };
    const year = yearRaw ? Number(yearRaw) : undefined;
    if (yearRaw && (!Number.isInteger(year) || year! < 1980 || year! > 2027))
      return { error: 'سنة الصنع غير صحيحة.', values };

    const triage = triageRfqIntake({
      fullName,
      phone,
      make,
      model,
      year,
      partText,
      oemNumber,
      vin,
      notes,
      imagesCount: 0,
      channel: 'WEB',
    });
    const initialStatus =
      triage.recommendedStatus === 'NEED_MORE_INFO'
        ? RFQStatus.NEED_MORE_INFO
        : RFQStatus.FITMENT_REVIEW;

    if (triage.riskFlags.includes('invalid_vin_format')) {
      return { error: 'رقم الهيكل VIN يجب أن يكون 17 خانة صحيحة.', values };
    }

    const requestHeaders = await headers();
    const ipSubject = requestIpSubject(requestHeaders);
    const humanProof = await verifyTurnstileToken({
      token: formData.get('turnstileToken'),
      expectedAction: 'public_intake',
      reserveSiteverify: () => reserveCustomerTurnstileSiteverify(ipSubject),
    });
    if (!humanProof.ok) {
      console.error('[intake:public] Turnstile verification rejected', {
        code: humanProof.reason,
      });
      return {
        error: 'تعذّر التحقق من أن الطلب بشري. حدّث الصفحة وحاول مجددًا.',
        values,
      };
    }
    const phoneSubject = opaqueRequestSubject('customer-phone', phone);
    if (!ipSubject || !phoneSubject) {
      throw new Error('PUBLIC_INTAKE_SUBJECT_UNAVAILABLE');
    }
    const sessionCustomerId = await getSessionCustomerId();
    if (!sessionCustomerId) {
      throw new CustomerIdentityVerificationRequired();
    }
    await requireVerifiedPublicIntakeCustomer(prisma, sessionCustomerId, phone);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      await reservePublicIntake(tx, { ipSubject, phoneSubject });

      const customer = await requireVerifiedPublicIntakeCustomer(
        tx,
        sessionCustomerId,
        phone,
      );
      const recentCount = await tx.rFQ.count({
        where: {
          customerId: customer.id,
          createdAt: { gte: hourAgo },
        },
      });
      if (recentCount >= 5) throw new RfqRateLimitError();

      const duplicate = await tx.rFQ.findFirst({
        where: {
          customerId: customer.id,
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
          status: { not: RFQStatus.CANCELLED },
          items: { some: { freeTextAr: partText } },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) return { code: duplicate.code, created: false };

      let vehicleId: string | undefined;
      if (make && model && year) {
        // أعد استخدام مركبة العميل نفسها بدل تكرارها مع كل طلب
        const existing = await tx.customerVehicle.findFirst({
          where: { customerId: customer.id, make, model, year },
        });
        const vehicle =
          existing ??
          (await tx.customerVehicle.create({
            data: {
              customerId: customer.id,
              make,
              model,
              year,
              vin: triage.normalized.vehicle.vin || null,
            },
          }));
        if (existing && triage.normalized.vehicle.vin && !existing.vin) {
          await tx.customerVehicle.update({
            where: { id: existing.id },
            data: { vin: triage.normalized.vehicle.vin },
          });
        }
        vehicleId = vehicle.id;
      }

      const rfq = await createRfqWithRetry(tx, {
        customerId: customer.id,
        vehicleId,
        status: initialStatus,
        channel: RfqChannel.WEB,
        notes: notes || null,
        items: {
          create: {
            freeTextAr: partText,
            oemNumber: triage.normalized.item.oemNumber || null,
            quantity: 1,
            humanReviewRequired: triage.humanReviewRequired,
          },
        },
      });

      await tx.aIDecision.create({
        data: {
          kind: AIDecisionKind.UNDERSTAND_REQUEST,
          entityType: 'rfq',
          entityId: rfq.id,
          input: {
            source: 'customer_chat_or_form',
            fields: {
              hasName: Boolean(fullName),
              hasPhone: Boolean(phone),
              hasVehicle: Boolean(make && model && year),
              hasPartText: Boolean(partText),
              hasOemNumber: Boolean(oemNumber),
              hasVehicleIdentifier: Boolean(vin),
              imagesCount: 0,
            },
          } as Prisma.InputJsonValue,
          output: summarizeChatTriageDecision(
            triage,
            0,
          ) as Prisma.InputJsonValue,
          model: 'rafraf-intake-triage-rules@2026-07-12',
          confidence: triage.confidence,
          humanReviewRequired: triage.humanReviewRequired,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: ActorType.AI,
          action: 'ai.intake.triaged',
          entityType: 'rfq',
          entityId: rfq.id,
          // Opaque HMAC subject only; raw client addresses are never stored.
          ip: ipSubject,
          after: {
            status: initialStatus,
            confidence: triage.confidence,
            missingFields: triage.missingFields,
            riskFlags: triage.riskFlags,
            humanReviewRequired: triage.humanReviewRequired,
          } as Prisma.InputJsonValue,
        },
      });
      return { code: rfq.code, created: true };
    });

    // إشعار المشغّل فوراً (fallback: يسقط بصمت بلا env أو جلسة واتساب)
    if (result.created) {
      await notifyOps(
        `🔔 طلب جديد في رفرف\n${result.code}\n${fullName} — ${phone}\n${make ? `${make} ${model} ${values.year}` : 'بلا مركبة'}\nالقطعة: ${partText.slice(0, 80)}${ADMIN_DASHBOARD_URL ? `\n\nاللوحة: ${ADMIN_DASHBOARD_URL}` : ''}`,
      );
    }

    return { ok: true, code: result.code };
  } catch (e) {
    if (e instanceof PublicIntakeRateLimitError)
      return {
        error: 'وصلتنا طلبات كثيرة الآن. حاول بعد ساعة.',
        values,
      };
    if (e instanceof RfqRateLimitError)
      return {
        error: 'وصلتنا عدة طلبات على هذا الجوال. حاول بعد ساعة.',
        values,
      };
    if (e instanceof CustomerIdentityVerificationRequired)
      return {
        error: 'وثّق الجوال نفسه برمز التحقق لإكمال الطلب بأمان.',
        verificationRequired: true,
        values,
      };
    console.error('submitRfq failed:', e);
    return { error: 'تعذّر إرسال الطلب. حاول مرة أخرى.', values };
  }
}

