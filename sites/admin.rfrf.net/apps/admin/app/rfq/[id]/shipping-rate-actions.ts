'use server';

import {
  OtoFulfillmentError,
  configuredOtoFulfillment,
} from '../../../lib/shipping/oto';
import {
  OtoRateQuotaExceededError,
  OtoRateQuotaUnavailableError,
  reserveOtoRateQuotaForAdmin,
} from '../../../lib/shipping/oto-rate-quota';
import { GCC_SOURCE_COUNTRY_CODES } from '@rafraf/shared/product-os/sourcing-market';
import { requireAdminPermission } from '../../../lib/require-admin-session';

const CITY_MAX_LENGTH = 100;
// قائمة الخليج الوحيدة في المنصة؛ الشحن يشمل السعودية معها.
const GCC_COUNTRIES = new Set<string>(['SA', ...GCC_SOURCE_COUNTRY_CODES]);

export interface ShippingRateView {
  deliveryOptionId: number;
  deliveryCompanyName: string;
  deliveryOptionName: string | null;
  serviceType: string | null;
  pickupDropoff: string | null;
  price: number;
  currency: string;
  averageDeliveryTime: string | null;
  maxFreeWeightKg: number | null;
  returnFee: number | null;
  maxOrderValue: number | null;
  maxCodValue: number | null;
  codCharge: number | null;
}

export interface ShippingRateActionState {
  error?: string;
  success?: string;
  rates?: ShippingRateView[];
}

function normalizedCity(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const city = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return city.length >= 2 && city.length <= CITY_MAX_LENGTH ? city : null;
}

function normalizedCountry(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const country = value.trim().toUpperCase();
  return GCC_COUNTRIES.has(country) ? country : null;
}

function normalizedWeight(value: FormDataEntryValue | null): number | null {
  const weight = typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(weight) && weight > 0 && weight <= 99_999
    ? weight
    : null;
}

function publicError(error: unknown): string {
  if (error instanceof OtoRateQuotaExceededError) {
    return error.dimension === 'admin'
      ? 'بلغ حسابك حد مقارنات أسعار OTO لهذه الدقيقة. أعد المحاولة بعد قليل.'
      : 'بلغت خدمة مقارنة أسعار OTO حدها لهذه الدقيقة. أعد المحاولة بعد قليل.';
  }
  if (error instanceof OtoRateQuotaUnavailableError) {
    return 'تعذر التحقق من حصة طلبات OTO بأمان. لم يتم الاتصال بالمزود ولم تُنشأ أي شحنة.';
  }
  if (error instanceof OtoFulfillmentError) {
    if (error.code === 'OTO_REQUEST_INVALID') {
      return 'أدخل مدينتي الاستلام والتسليم ووزناً صحيحاً.';
    }
    if (error.code === 'OTO_AUTH_FAILED') {
      return 'تعذر التحقق من اعتماد OTO. راجع إعدادات الخادم.';
    }
    if (error.code === 'OTO_RATE_LIMITED') {
      return 'بلغ OTO حد الطلبات مؤقتاً. أعد المحاولة لاحقاً.';
    }
    if (error.code === 'OTO_TIMEOUT' || error.code === 'OTO_UNAVAILABLE') {
      return 'تعذر الوصول إلى OTO خلال المهلة. لم تُنشأ أي شحنة.';
    }
  }
  return 'تعذر جلب خيارات الشحن. لم تُنشأ أي شحنة.';
}

/**
 * A read-only comparison. The customer address is never loaded or forwarded;
 * an operator supplies city-level estimate inputs explicitly.
 */
export async function compareShippingRates(
  _previous: ShippingRateActionState,
  formData: FormData,
): Promise<ShippingRateActionState> {
  void _previous;
  const principal = await requireAdminPermission('OPERATIONS_READ');
  const originCity = normalizedCity(formData.get('originCity'));
  const destinationCity = normalizedCity(formData.get('destinationCity'));
  const originCountry = normalizedCountry(formData.get('originCountry'));
  const destinationCountry = normalizedCountry(
    formData.get('destinationCountry'),
  );
  const weightKg = normalizedWeight(formData.get('weightKg'));
  if (
    !originCity ||
    !destinationCity ||
    !originCountry ||
    !destinationCountry ||
    weightKg === null
  ) {
    return { error: 'أدخل مدينتي الاستلام والتسليم ووزناً صحيحاً.' };
  }

  const adapter = configuredOtoFulfillment();
  if (!adapter) {
    return {
      error: 'موصل OTO غير مفعّل أو إعداداته ناقصة. راجع صفحة التكاملات.',
    };
  }
  try {
    await reserveOtoRateQuotaForAdmin(principal.userId);
    const rates = await adapter.getRates({
      originCity,
      destinationCity,
      originCountry,
      destinationCountry,
      weightKg,
      currency: 'SAR',
    });
    return {
      success: rates.length
        ? `تمت مقارنة ${rates.length} خيار شحن. لا توجد شحنة أو بوليصة منشأة.`
        : 'لم يعد OTO خيارات متاحة لهذه البيانات. لم تُنشأ أي شحنة.',
      rates,
    };
  } catch (error) {
    const code =
      error instanceof OtoFulfillmentError ||
      error instanceof OtoRateQuotaExceededError ||
      error instanceof OtoRateQuotaUnavailableError
        ? error.code
        : 'UNKNOWN';
    console.error('[shipping-rate] OTO comparison failed', { code });
    return { error: publicError(error) };
  }
}
