'use server';

import { SupplierStatus } from '@rafraf/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminPermission } from '../../lib/require-admin-session';
import {
  reviewSupplierStatus,
  reviewApprovedSupplierRisk,
  SupplierReviewValidationError,
  type SupplierReviewOutcome,
} from '../../lib/supplier-review';

const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function parseSupplierStatus(value: FormDataEntryValue | null) {
  const status = String(value ?? '');
  return (Object.values(SupplierStatus) as string[]).includes(status)
    ? (status as SupplierStatus)
    : null;
}

function resultQuery(result: SupplierReviewOutcome): string {
  switch (result.outcome) {
    case 'APPLIED':
      return `result=applied&status=${result.status}`;
    case 'REPLAYED':
      return `result=replayed&status=${result.status}`;
    case 'CONFLICT':
      return `error=conflict&status=${result.status}`;
    case 'INVALID_TRANSITION':
      return `error=transition&status=${result.status}`;
    case 'DOCUMENT_REQUIRED':
      return `error=document_required&status=${result.status}`;
    case 'RISK_REVIEW_REQUIRED':
      return `error=risk_review_required&status=${result.status}`;
    case 'NOT_FOUND':
      return 'error=not_found';
  }
}

async function applySupplierReviewAction(
  formData: FormData,
  targetStatus: SupplierStatus,
): Promise<never> {
  const admin = await requireAdminPermission('SUPPLIER_WRITE');
  const supplierId = String(formData.get('supplierId') ?? '');
  const expectedStatus = parseSupplierStatus(formData.get('expectedStatus'));
  const reason = String(formData.get('reason') ?? '');
  const documentId = String(formData.get('documentId') ?? '');

  if (!SUPPLIER_ID_PATTERN.test(supplierId) || !expectedStatus) {
    redirect('/suppliers?error=invalid_request');
  }

  let query: string;
  try {
    const result = await reviewSupplierStatus({
      supplierId,
      actorId: admin.userId,
      expectedStatus,
      targetStatus,
      reason,
      documentId: documentId || null,
      riskLevel: String(formData.get('riskLevel') ?? ''),
    });
    query = resultQuery(result);
  } catch (error) {
    if (error instanceof SupplierReviewValidationError) {
      query = `error=${error.code.toLowerCase()}`;
    } else {
      throw error;
    }
  }

  revalidatePath('/suppliers');
  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath('/');
  redirect(`/suppliers/${supplierId}?${query}`);
}

/** ينقل طلب التسجيل من PENDING إلى طابور المراجعة. */
export async function startSupplierReview(formData: FormData): Promise<never> {
  return applySupplierReviewAction(formData, SupplierStatus.UNDER_REVIEW);
}

/** يعتمد المورد بعد اكتمال المراجعة. */
export async function approveSupplier(formData: FormData): Promise<never> {
  return applySupplierReviewAction(formData, SupplierStatus.APPROVED);
}

/** اعتماد مقيّد؛ السبب التشغيلي مطلوب ويُسجّل في audit. */
export async function limitSupplier(formData: FormData): Promise<never> {
  return applySupplierReviewAction(formData, SupplierStatus.LIMITED);
}

/** يرفض طلب المورد؛ السبب التشغيلي مطلوب ويُسجّل في audit. */
export async function rejectSupplier(formData: FormData): Promise<never> {
  return applySupplierReviewAction(formData, SupplierStatus.REJECTED);
}

export async function reviewSupplierRisk(formData: FormData): Promise<never> {
  const admin = await requireAdminPermission('SUPPLIER_WRITE');
  await requireAdminPermission('RISK_REVIEW');
  const supplierId = String(formData.get('supplierId') ?? '');
  if (!SUPPLIER_ID_PATTERN.test(supplierId))
    redirect('/suppliers?error=invalid_request');
  const result = await reviewApprovedSupplierRisk({
    supplierId,
    actorId: admin.userId,
    riskLevel: String(formData.get('riskLevel') ?? ''),
    expectedAssessmentId:
      String(formData.get('expectedAssessmentId') ?? '') || null,
  });
  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath('/suppliers');
  revalidatePath('/exceptions');
  redirect(`/suppliers/${supplierId}?${resultQuery(result)}`);
}
