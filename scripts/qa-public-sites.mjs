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
    try {
      const current = new URL(check.url);
      const target = new URL(response.location, current);
      return target.origin === current.origin &&
        target.pathname === '/login' &&
        !target.username && !target.password
        ? null : 'وجهة تحويل الدخول غير متوقعة';
    } catch {
      return 'عنوان تحويل الدخول غير صالح';
    }
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

async function checkPublicPage(check) {
  const started = Date.now();
  try {
    const response = await fetch(check.url, { method: check.method || 'GET', body: check.method === 'POST' ? JSON.stringify(check.body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { ...(check.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), Accept: 'text/html,application/json', 'Cache-Control': 'no-cache' } });
    const body = await response.text();
    const error = assessResponse(check, { status: response.status, body, contentType: response.headers.get('content-type') ?? '', location: response.headers.get('location') });
    return { name: check.name, url: check.url, ok: !error, status: response.status, durationMs: Date.now() - started, error };
  } catch (error) {
    return { name: check.name, url: check.url, ok: false, durationMs: Date.now() - started, error: error.name === 'TimeoutError' ? 'انتهت مهلة الاتصال' : 'تعذر الاتصال الآمن بالموقع' };
  }
}

/**
 * Diagnose shared access failures without turning failed checks into passes.
 * A cross-domain 403 pattern is a clue to review edge/WAF logs, not proof
 * that production is healthy or that GitHub runners should be whitelisted.
 */
export function diagnoseReview(checks) {
  if (checks.length === 0) return {
    code: 'no_checks',
    message: 'لم تُنفذ أي فحوص؛ نتيجة المراقبة غير صالحة.',
  };
  const failed = checks.filter((check) => !check.ok);
  if (failed.length === 0) return {
    code: 'healthy',
    message: 'اجتازت جميع المسارات الفحوص المحددة.',
  };
  const denied = checks.filter((check) => check.status === 403);
  const origins = new Set(denied.map((check) => new URL(check.url).origin));
  if (denied.length === checks.length && origins.size > 1) return {
    code: 'possible_shared_access_block',
    message: 'أعادت جميع المسارات عبر عدة نطاقات HTTP 403. يُرجّح حظر مشترك من الاستضافة أو حماية الشبكة لطلبات GitHub Actions؛ راجع سجلات WAF وعناوين IP قبل استنتاج تعطل التطبيقات. بقيت حالة الفحص فاشلة.',
  };
  if (denied.length > 0) return {
    code: 'some_access_denied',
    message: 'بعض المسارات أعادت HTTP 403؛ راجع الصلاحيات وحماية الاستضافة لكل مسار مع الإبقاء على حالة الفشل.',
  };
  return {
    code: 'public_check_failures',
    message: 'فشلت مسارات عامة لأسباب غير 403؛ راجع التفاصيل أدناه قبل تعديل إعدادات الإنتاج.',
  };
}

export async function runPublicReview() {
  const checks = [];
  for (let offset = 0; offset < PUBLIC_CHECKS.length; offset += 3) checks.push(...await Promise.all(PUBLIC_CHECKS.slice(offset, offset + 3).map(checkPublicPage)));
  const report = { checkedAtUtc: new Date().toISOString(), passed: checks.length > 0 && checks.every((check) => check.ok), diagnosis: diagnoseReview(checks), checks, limits: ['فحوص صفحات عامة وطلب تحقق VIN بقيمة اختبار ثابتة؛ بلا تسجيل دخول أو كتابة بيانات مستخدمين', 'لا تشمل الفحص المرئي أو الدفع أو حفظ المخزون', 'لا تنشر إصلاحات تلقائية ولا ترسل إشعارًا إلى ChatGPT'] };
  const directory = resolve(process.env.QA_REPORT_DIRECTORY || 'outputs/hourly-review');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const localTime = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(report.checkedAtUtc));
  const markdown = `# مراجعة رفرف الآلية\n\n${localTime}\n\n${report.passed ? 'اجتازت الفحوص المحددة.' : 'توجد مشكلات تحتاج مراجعة.'}\n\n${report.diagnosis.message}\n\n| الصفحة | النتيجة | التفاصيل |\n| --- | --- | --- |\n${checks.map((check) => `| [${check.name}](${check.url}) | ${check.ok ? 'ناجح' : 'فشل'} | ${check.error || 'المحتوى والحالة مطابقان'} |`).join('\n')}\n\n${report.limits.join('؛ ')}.\n`;
  await writeFile(resolve(directory, 'report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(JSON.stringify({ passed: report.passed, checkedAtUtc: report.checkedAtUtc, diagnosis: report.diagnosis, checks: checks.map(({ name, ok, status, error }) => ({ name, ok, status, error })) }, null, 2));
  return report;
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runPublicReview();
  process.exitCode = report.passed ? 0 : 1;
}
