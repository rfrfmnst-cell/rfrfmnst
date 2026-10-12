import { prisma } from '@rafraf/db';

type Progress = { label: string; nextStep: string };
const REVIEW: Progress = {
  label: 'قيد المراجعة',
  nextStep: 'تابع طلبك أو تواصل مع فريق العمليات إذا احتجت توضيحاً.',
};
const RFQ_PROGRESS: Record<string, Progress> = {
  DRAFT: {
    label: 'مسودة الطلب',
    nextStep: 'أكمل بيانات القطعة والمركبة ثم راجع الطلب ووافق على إرساله.',
  },
  NEED_MORE_INFO: {
    label: 'نحتاج معلومات إضافية',
    nextStep: 'أكمل معلومات القطعة أو المركبة المطلوبة في المحادثة.',
  },
  FITMENT_REVIEW: {
    label: 'مراجعة توافق القطعة',
    nextStep: 'انتظر مراجعة التوافق؛ لا يوجد توافق معتمد من هذه الحالة وحدها.',
  },
  SOURCING_LOCAL: {
    label: 'البحث لدى الموردين المحليين',
    nextStep: 'انتظر العروض المؤهلة أو اطلب تحديث العروض في المحادثة.',
  },
  SOURCING_GLOBAL: {
    label: 'البحث عن خيارات توريد عالمية',
    nextStep: 'نتائج البحث تخضع للمراجعة قبل أن تصبح عروضاً قابلة للاختيار.',
  },
  QUOTES_READY: {
    label: 'متابعة عروض الطلب',
    nextStep:
      'اعرض العروض المؤهلة الحالية؛ لا تعتمد عرضاً إلا بعد مراجعة سعره النهائي وتفاصيله.',
  },
  CUSTOMER_SELECTED: {
    label: 'معالجة اختيار العرض',
    nextStep: 'انتظر اكتمال إنشاء الطلب؛ لا ترسل موافقة مكررة.',
  },
  CANCELLED: {
    label: 'طلب التسعير ملغى',
    nextStep: 'يمكنك بدء طلب جديد عند الحاجة.',
  },
};
const ORDER_PROGRESS: Record<string, Progress> = {
  CREATED: {
    label: 'الطلب مسجل',
    nextStep: 'افتح صفحة متابعة الطلب لمعرفة الخطوة المطلوبة.',
  },
  AWAITING_CUSTOMER_CONFIRMATION: {
    label: 'بانتظار تأكيدك',
    nextStep: 'راجع الطلب في صفحة المتابعة قبل تأكيده.',
  },
  AWAITING_PAYMENT: {
    label: 'الطلب بانتظار خطوة الدفع',
    nextStep:
      'راجع صفحة المتابعة لمعرفة خيار الدفع المتاح؛ هذه الحالة لا تثبت نجاح الدفع.',
  },
  PAID: {
    label: 'الدفع مسجل',
    nextStep: 'تابع الطلب حتى يكتمل تأكيد التوريد.',
  },
  ESCROW_HELD: {
    label: 'جارٍ تأكيد التوريد',
    nextStep: 'تابع الطلب حتى يؤكد المورد التنفيذ.',
  },
  AWAITING_SUPPLIER_CONFIRMATION: {
    label: 'بانتظار تأكيد المورد',
    nextStep: 'سيظهر تأكيد التنفيذ في صفحة متابعة الطلب.',
  },
  SUPPLIER_ACCEPTED: {
    label: 'المورد أكد الطلب',
    nextStep: 'تابع تجهيز القطعة ومراجعة التوافق.',
  },
  FITMENT_VERIFIED: {
    label: 'تم التحقق من التوافق',
    nextStep: 'تابع تجهيز الشحنة في صفحة الطلب.',
  },
  READY_TO_SHIP: {
    label: 'جاهز للشحن',
    nextStep: 'انتظر تسليم الشحنة للناقل؛ الجاهزية لا تعني أنها شُحنت.',
  },
  SHIPPED: {
    label: 'تم شحن الطلب',
    nextStep: 'تابع تحديثات الناقل في صفحة الطلب.',
  },
  IN_TRANSIT: {
    label: 'الشحنة في الطريق',
    nextStep:
      'تابع تحديثات الناقل؛ لا يوجد موعد وصول مضمون من هذه الحالة وحدها.',
  },
  CUSTOMS_REVIEW: {
    label: 'الشحنة قيد المراجعة الجمركية',
    nextStep: 'تابع تحديث فريق العمليات والناقل.',
  },
  OUT_FOR_DELIVERY: {
    label: 'خرجت الشحنة للتسليم',
    nextStep: 'تابع الناقل واستعد لاستلام الشحنة.',
  },
  DELIVERED: {
    label: 'التسليم مسجل',
    nextStep: 'افحص القطعة وأكد الاستلام أو افتح ملاحظة من صفحة الطلب.',
  },
  COMPLAINT_WINDOW: {
    label: 'فترة مراجعة الاستلام',
    nextStep: 'افحص القطعة وسجل أي اعتراض من صفحة الطلب.',
  },
  CLOSED: {
    label: 'الطلب مكتمل',
    nextStep: 'يمكنك الرجوع إلى تفاصيل الطلب أو التواصل مع الدعم.',
  },
  PAYOUT_RELEASED: {
    label: 'الطلب مكتمل',
    nextStep: 'يمكنك الرجوع إلى تفاصيل الطلب أو التواصل مع الدعم.',
  },
  CANCELLED: {
    label: 'الطلب ملغى',
    nextStep: 'راجع تفاصيل الطلب لمعرفة الخطوات المتاحة.',
  },
  REFUNDED: {
    label: 'الاسترداد مسجل',
    nextStep: 'راجع تفاصيل الاسترداد في صفحة الطلب.',
  },
  DISPUTED: {
    label: 'الاعتراض قيد المعالجة',
    nextStep: 'تابع رد فريق العمليات في صفحة الطلب.',
  },
};

/** No model-supplied RFQ/order identifier and no supplier/provider internals. */
export async function getOwnedRequestStatus(
  customerId: string,
  threadId: string,
  client: typeof prisma = prisma,
) {
  if (!customerId || !threadId) throw new Error('RFQ_NOT_FOUND');
  const thread = await client.chatThread.findFirst({
    where: { id: threadId, customerId },
    select: {
      rfq: {
        select: {
          customerId: true,
          code: true,
          status: true,
          orders: {
            where: { customerId },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { code: true, status: true },
          },
        },
      },
    },
  });
  if (!thread) throw new Error('RFQ_NOT_FOUND');
  if (!thread.rfq) return { workflow: RFQ_PROGRESS.DRAFT };
  if (thread.rfq.customerId !== customerId) throw new Error('RFQ_NOT_FOUND');
  const order = thread.rfq.orders[0];
  return {
    rfqCode: thread.rfq.code,
    ...(order ? { orderCode: order.code } : {}),
    workflow: order
      ? (ORDER_PROGRESS[order.status] ?? REVIEW)
      : (RFQ_PROGRESS[thread.rfq.status] ?? REVIEW),
  };
}
