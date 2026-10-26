import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC_CHECKS = [
  { name: 'واجهة العميل', url: 'https://rfrf.net/', kind: 'html', markers: ['علامات المركبات', '0500894003'] },
  { name: 'هوية تطبيق العميل', url: 'https://rfrf.net/api/liveness', kind: 'identity', service: 'rafraf-customer' },
  { name: 'اختيار علامة المركبة', url: 'https://rfrf.net/companies', kind: 'html', markers: ['اختر علامة مركبتك', 'نوع المركبة', 'الفئة'] },
  { name: 'دخول العميل', url: 'https://rfrf.net/login', kind: 'html', markers: ['تسجيل الدخول'] },
  { name: 'تسجيل المورد', url: 'https://supplier.rfrf.net/login?mode=register', kind: 'html', markers: ['جرّب رفرف لمدة 3 أشهر', 'الخطط المدفوعة أو المغادرة'] },
  { name: 'حماية استيراد المورد', url: 'https://supplier.rfrf.net/catalog/import', kind: 'guest-guard' },
  { name: 'هوية بوابة المورد', url: 'https://supplier.rfrf.net/api/liveness', kind: 'identity', service: 'rafraf-supplier' },
  { name: 'دخول الإدارة', url: 'https://admin.rfrf.net/login', kind: 'html', markers: ['دخول'] },
  { name: 'حماية لوحة العميل', url: 'https://rfrf.net/account', kind: 'guest-guard' },
  { name: 'تحقق بيانات المركبة برقم الهيكل', url: 'https://rfrf.net/api/vehicle/vin', kind: 'vin-lookup', method: 'POST', body: { vin: '1HGCM82633A004352' } },
  { name: 'رسالة تعذر دخول المورد', url: 'https://supplier.rfrf.net/login?mode=phone&err=not_allowed', kind: 'html', markers: ['تواصل مع دعم رفرف', 'إنشاء حساب مورد'] },
];

export function assessResponse(check, response) {
  if (check.kind === 'guest-guard') {
    if (![302, 303, 307, 308].includes(response.status) || !response.location) return 'مسار محمي لا يحوّل الضيف إلى الدخول';
    const target = new URL(response.location, check.url);
    return target.origin === new URL(check.url).origin && target.pathname === '/login' ? null : 'وجهة تحويل الدخول غير متوقعة';
  }
  if (response.status !== 200) return `HTTP ${response.status}`;
  if (check.kind === 'vin-lookup') {
    try { const result = JSON.parse(response.body); return ['decoded', 'partial'].includes(result.status) && result.source === 'NHTSA vPIC' && result.vehicle?.make && result.vehicle?.model ? null : 'لم يُرجع تحقق VIN بيانات مركبة موثقة'; } catch { return 'استجابة تحقق VIN غير صالحة'; }
  }
  if (check.kind === 'identity') {
    try {
      const data = JSON.parse(response.body);
      return data.service === check.service && data.status === 'alive' ? null : 'هوية التطبيق لا تطابق النطاق';
    } catch { return 'استجابة الصحة ليست JSON صالحًا'; }
  }
  if (!response.contentType.includes('text/html')) return 'نوع الصفحة ليس HTML';
  return check.markers.every((marker) => response.body.includes(marker)) ? null : 'المحتوى المتوقع غير ظاهر';
}

export async function checkPublicPage(check) {
  const started = Date.now();
  let response;
  let body;
  try {
    response = await fetch(check.url, { method: check.method || 'GET', body: check.method === 'POST' ? JSON.stringify(check.body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { ...(check.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), Accept: 'text/html,application/json', 'Cache-Control': 'no-cache' } });
    body = await response.text();
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    if (!isTimeout && !(error instanceof TypeError)) throw error;
    return { name: check.name, url: check.url, ok: false, durationMs: Date.now() - started, error: isTimeout ? 'انتهت مهلة الاتصال' : 'تعذر الاتصال الآمن بالموقع' };
  }
  const error = assessResponse(check, { status: response.status, body, contentType: response.headers.get('content-type') ?? '', location: response.headers.get('location') });
  return { name: check.name, url: check.url, ok: !error, status: response.status, durationMs: Date.now() - started, error };
}

export async function runPublicReview() {
  const checks = [];
  for (let offset = 0; offset < PUBLIC_CHECKS.length; offset += 3) checks.push(...await Promise.all(PUBLIC_CHECKS.slice(offset, offset + 3).map(checkPublicPage)));
  const report = { checkedAtUtc: new Date().toISOString(), passed: checks.every((check) => check.ok), checks, limits: ['فحوص صفحات عامة وطلب تحقق VIN بقيمة اختبار ثابتة؛ بلا تسجيل دخول أو كتابة بيانات مستخدمين', 'لا تشمل الفحص المرئي أو الدفع أو حفظ المخزون', 'لا تنشر إصلاحات تلقائية ولا ترسل إشعارًا إلى ChatGPT'] };
  const directory = resolve(process.env.QA_REPORT_DIRECTORY || 'outputs/hourly-review');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const localTime = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(report.checkedAtUtc));
  const markdown = `# مراجعة رفرف الآلية\n\n${localTime}\n\n${report.passed ? 'اجتازت الفحوص المحددة.' : 'توجد مشكلات تحتاج مراجعة.'}\n\n| الصفحة | النتيجة | التفاصيل |\n| --- | --- | --- |\n${checks.map((check) => `| [${check.name}](${check.url}) | ${check.ok ? 'ناجح' : 'فشل'} | ${check.error || 'المحتوى والحالة مطابقان'} |`).join('\n')}\n\n${report.limits.join('؛ ')}.\n`;
  await writeFile(resolve(directory, 'report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(JSON.stringify({ passed: report.passed, checkedAtUtc: report.checkedAtUtc, checks: checks.map(({ name, ok, status, error }) => ({ name, ok, status, error })) }, null, 2));
  return report;
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runPublicReview();
  process.exitCode = report.passed ? 0 : 1;
}
