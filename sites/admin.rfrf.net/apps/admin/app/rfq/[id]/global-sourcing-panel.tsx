import type { AdminRfqItem } from '../../../lib/admin-rfq-detail';
import { storedCandidateView } from '../../../lib/global-sourcing/candidate-view';
import type { GlobalDiscoveryProviderStatus } from '../../../lib/global-sourcing/provider-registry';
import { groupGlobalSourcingRuns } from '../../../lib/global-sourcing/run-history';
import { GlobalSourcingForm } from './global-sourcing-form';

export function GlobalSourcingPanel({
  canWriteQuotes,
  defaultQuery,
  item,
  providers,
  rfqId,
}: {
  canWriteQuotes: boolean;
  defaultQuery: string;
  item: AdminRfqItem | undefined;
  providers: GlobalDiscoveryProviderStatus[];
  rfqId: string;
}) {
  const providerRuns = groupGlobalSourcingRuns(item?.sourcingRuns ?? []);
  const configuredProviders = providers.filter(
    (provider) => provider.configured,
  );

  return (
    <section className="card-block">
      <div className="block-head">
        <div>
          <h2>استكشاف عالمي من الإدارة</h2>
          <p className="hint">
            المصادر هنا للبحث الإداري فقط، وليست مورداً مسجلاً أو قناة شراء.
            النتائج لا تظهر للعميل ولا تتحول تلقائياً إلى عرض.
          </p>
        </div>
        <span
          className={`status ${configuredProviders.length ? 's-QUOTES_READY' : 's-DRAFT'}`}
        >
          {configuredProviders.length
            ? `${configuredProviders.length} موصل مكتمل الإعداد`
            : 'لا يوجد موصل مفعّل'}
        </span>
      </div>
      {item && canWriteQuotes ? (
        <GlobalSourcingForm
          rfqId={rfqId}
          rfqItemId={item.id}
          defaultQuery={defaultQuery}
          providers={providers}
        />
      ) : item ? (
        <p className="hint">
          عرض فقط؛ تشغيل الاستكشاف العالمي يحتاج QUOTE_WRITE.
        </p>
      ) : null}

      {providerRuns.map(({ providerKey, latestRun, lastSuccessfulRun }) => {
        const provider = providers.find((entry) => entry.key === providerKey);
        const resultRun =
          latestRun.status === 'DONE' ? latestRun : lastSuccessfulRun;
        return (
          <div key={providerKey} style={{ marginTop: '1.25rem' }}>
            <div className="block-head">
              <h2>آخر بحث {provider?.label ?? 'المصدر العالمي'}</h2>
              <span className="mono">
                {latestRun.status === 'DONE'
                  ? 'مكتمل'
                  : latestRun.status === 'FAILED'
                    ? 'فشل آمن'
                    : 'قيد التنفيذ'}
              </span>
            </div>
            <p className="hint">
              وقت آخر بحث:{' '}
              <time dateTime={latestRun.startedAt.toISOString()}>
                {latestRun.startedAt.toLocaleString('ar-SA', {
                  timeZone: 'Asia/Riyadh',
                })}
              </time>
            </p>
            {resultRun && resultRun.id !== latestRun.id ? (
              <p className="selected-note" role="status">
                نتائج سابقة محفوظة من بحث ناجح بتاريخ{' '}
                <time dateTime={resultRun.startedAt.toISOString()}>
                  {resultRun.startedAt.toLocaleString('ar-SA', {
                    timeZone: 'Asia/Riyadh',
                  })}
                </time>
                . لم ينجح البحث الأحدث بعد؛ أعد التحقق من السعر والتوفر قبل
                الاعتماد.
              </p>
            ) : null}
            {resultRun?.candidates.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>الإدراج العالمي</th>
                      <th>المصدر</th>
                      <th>سعر إدراج خام</th>
                      <th>التوافق / المخزون</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultRun.candidates.map((candidate) => {
                      const view = storedCandidateView(candidate.notes);
                      return (
                        <tr key={candidate.id}>
                          <td>
                            <strong>
                              {view.title ?? candidate.partRef ?? 'إدراج خارجي'}
                            </strong>
                            <div className="hint mono">
                              {candidate.partRef ?? '—'}
                            </div>
                            {view.itemWebUrl ? (
                              <a
                                className="back"
                                href={view.itemWebUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                فتح الإدراج للإدارة فقط
                              </a>
                            ) : null}
                          </td>
                          <td>
                            {candidate.sourceRegistry?.name ??
                              provider?.label ??
                              'مصدر عالمي'}
                            {view.buyingOptions.length ? (
                              <div className="hint mono">
                                {view.buyingOptions.join(' · ')}
                              </div>
                            ) : null}
                          </td>
                          <td className="mono">
                            {candidate.rawPrice != null
                              ? `${Number(candidate.rawPrice).toFixed(2)} ${
                                  candidate.currency ?? ''
                                }`
                              : '—'}
                            <div className="hint">
                              ليس تكلفة شراء نهائية أو سعراً واصلاً
                            </div>
                          </td>
                          <td>
                            {view.supplierOffer ? (
                              <>
                                مخزون معلن: {candidate.availability ?? '—'}
                                <div className="hint">
                                  {view.supplierOffer.partNumber}
                                  {view.supplierOffer.manufacturer
                                    ? ` · ${view.supplierOffer.manufacturer}`
                                    : ''}
                                  {view.supplierOffer.deliveryEstimate
                                    ? ` · توريد ${view.supplierOffer.deliveryEstimate}`
                                    : ''}
                                  {view.supplierOffer.minimumLot
                                    ? ` · حد أدنى ${view.supplierOffer.minimumLot}`
                                    : ''}
                                </div>
                                {view.supplierOffer.returnable === false ? (
                                  <div className="hint" role="note">
                                    <strong>
                                      غير قابل للإرجاع لدى المورد.
                                    </strong>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              'غير موثق'
                            )}
                            {view.condition?.toUpperCase() === 'USED' ? (
                              <div className="hint" role="note">
                                <strong>قطعة مستعملة.</strong>
                              </div>
                            ) : null}
                            <div className="hint">
                              لا توافق آلي؛ يلزم التحقق من التوفر والتكلفة
                              الواصلة قبل التحويل إلى عرض.
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint">
                لم يحفظ التشغيل نتائج قابلة للمراجعة، أو لم يكتمل بعد.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
