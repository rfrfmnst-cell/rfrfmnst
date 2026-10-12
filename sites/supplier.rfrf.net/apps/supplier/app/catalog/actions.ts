'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSessionSupplierId } from '../../lib/session';
import {
  parseCatalogItemInput,
  safeCatalogEntityId,
  safeCatalogMutationToken,
} from './catalog-policy';
import {
  type CatalogMutationResult,
  persistCatalogItemActiveState,
  persistCatalogItemUpdate,
  persistNewCatalogItem,
} from './catalog-mutation-service';

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '');
}

function parseForm(formData: FormData) {
  return parseCatalogItemInput({
    partNumber: formString(formData, 'partNumber'),
    brand: formString(formData, 'brand'),
    condition: formString(formData, 'condition'),
    quantity: formString(formData, 'quantity'),
    price: formString(formData, 'price'),
    currency: formString(formData, 'currency'),
    warrantyMonths: formString(formData, 'warrantyMonths'),
    leadTimeDays: formString(formData, 'leadTimeDays'),
    warehouseId: formString(formData, 'warehouseId'),
  });
}

function finish(result: CatalogMutationResult, success: string): never {
  if (!result.ok) redirect(`/catalog?err=${result.reason}`);
  revalidatePath('/catalog');
  revalidatePath('/catalog/import');
  revalidatePath('/');
  redirect(`/catalog?ok=${success}`);
}

export async function createSupplierCatalogItem(
  formData: FormData,
): Promise<void> {
  const parsed = parseForm(formData);
  const token = safeCatalogMutationToken(formString(formData, 'mutationToken'));
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');
  if (!parsed.ok || !token) redirect('/catalog?err=invalid');

  let result: CatalogMutationResult;
  try {
    result = await persistNewCatalogItem({
      supplierId,
      token,
      input: parsed.value,
    });
  } catch {
    console.error('supplier catalog create failed');
    result = { ok: false, reason: 'save' };
  }
  finish(result, 'created');
}

export async function updateSupplierCatalogItem(
  formData: FormData,
): Promise<void> {
  const parsed = parseForm(formData);
  const itemId = safeCatalogEntityId(formString(formData, 'itemId'));
  const token = safeCatalogMutationToken(formString(formData, 'mutationToken'));
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');
  if (!parsed.ok || !itemId || !token) redirect('/catalog?err=invalid');

  let result: CatalogMutationResult;
  try {
    result = await persistCatalogItemUpdate({
      supplierId,
      itemId,
      token,
      input: parsed.value,
    });
  } catch {
    console.error('supplier catalog update failed');
    result = { ok: false, reason: 'save' };
  }
  finish(result, 'updated');
}

export async function setSupplierCatalogItemActive(
  formData: FormData,
): Promise<void> {
  const itemId = safeCatalogEntityId(formString(formData, 'itemId'));
  const token = safeCatalogMutationToken(formString(formData, 'mutationToken'));
  const nextActiveRaw = formString(formData, 'nextActive');
  const nextActive =
    nextActiveRaw === 'true' ? true : nextActiveRaw === 'false' ? false : null;
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');
  if (!itemId || !token || nextActive == null) {
    redirect('/catalog?err=invalid');
  }

  let result: CatalogMutationResult;
  try {
    result = await persistCatalogItemActiveState({
      supplierId,
      itemId,
      token,
      nextActive,
    });
  } catch {
    console.error('supplier catalog activation failed');
    result = { ok: false, reason: 'save' };
  }
  finish(result, nextActive ? 'activated' : 'deactivated');
}
