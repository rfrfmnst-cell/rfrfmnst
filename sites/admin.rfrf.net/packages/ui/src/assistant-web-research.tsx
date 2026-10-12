'use client';

import { webResearchDisplay } from './assistant-web-research-display';
import { BidiText } from './assistant-text';

const stateLabels = {
  results: 'مصادر أولية من الإنترنت',
  read: 'معلومات من المصدر',
  empty: 'لم تظهر نتائج لهذا البحث. هذا لا يعني أن القطعة غير متوفرة.',
  unavailable:
    'تعذر الوصول إلى البحث أو المصدر الآن. قد يمنع الموقع الجلب الآلي؛ يمكنك المحاولة لاحقاً.',
  needs_details:
    'راجع وصف القطعة وبيانات السيارة، وأكد الرقم المستنتج من الصورة قبل البحث. إذا استمر تعذر البحث، يمكنك بدء محادثة جديدة بوصف مستقل بالعربية أو رقم OEM مؤكد. أبقِ رقم الهيكل وبيانات الاتصال خارج وصف القطعة.',
  limit:
    'اكتمل حد البحث وقراءة المصادر لهذا الرد. يمكنك طلب بحث جديد في رسالة أخرى.',
  disabled: 'البحث في الإنترنت غير متاح الآن.',
};

export function WebResearchCard({ result }: { result: unknown }) {
  const display = webResearchDisplay(result);
  if (!display) return <p role="status">تعذر قراءة نتيجة البحث.</p>;
  return (
    <div className="rf-web-research" role="status">
      <p>{stateLabels[display.state]}</p>
      {display.sources.map((source) => (
        <article key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            <BidiText text={source.title} />
          </a>
          <p>
            <BidiText text={source.excerpt} />
          </p>
          <small>
            <bdi dir="ltr">{new URL(source.url).hostname}</bdi>
            {' · جُلب في '}
            <time dateTime={source.retrievedAt}>
              {new Date(source.retrievedAt).toLocaleString('ar-SA', {
                timeZone: 'UTC',
              })}{' '}
              UTC
            </time>
          </small>
        </article>
      ))}
      <p role="note">
        معلومات غير متحققة. التوافق والتوفر والأصالة والتكلفة الواصلة تحتاج
        مراجعة قبل إصدار عرض رفرف.
      </p>
    </div>
  );
}
