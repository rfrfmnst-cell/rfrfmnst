import { canSupplierReceiveRfqs } from '@rafraf/shared';
import { redirect } from 'next/navigation';
import { getSessionSupplierId } from '../../lib/session';
import { loadSupplierAccount } from '../supplier-dashboard-read-model';
import {
  loadSupplierQuotesReadModel,
  type SupplierQuotesSearchParams,
} from './quotes-read-model';
import { SupplierQuotesView } from './quotes-view';

export const dynamic = 'force-dynamic';

export default async function SupplierQuotesPage({
  searchParams,
}: {
  searchParams: Promise<SupplierQuotesSearchParams>;
}) {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');

  const supplier = await loadSupplierAccount(supplierId);
  if (!supplier) redirect('/login');
  if (!canSupplierReceiveRfqs(supplier.status)) redirect('/');

  const params = await searchParams;
  const data = await loadSupplierQuotesReadModel({
    params,
    supplierId: supplier.id,
  });

  return (
    <SupplierQuotesView data={data} supplierName={supplier.businessName} />
  );
}
