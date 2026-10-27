import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Independent of the hourly page monitor: deployment acceptance must cover
// all four applications and must not confuse a running broker with a provider
// whose credentials have actually been configured.
export const RELEASE_TARGETS = [
  { name: 'العميل', url: 'https://rfrf.net/api/liveness', service: 'rafraf-customer', kind: 'application' },
  { name: 'الموردون', url: 'https://supplier.rfrf.net/api/liveness', service: 'rafraf-supplier', kind: 'application' },
  { name: 'الإدارة', url: 'https://admin.rfrf.net/api/liveness', service: 'rafraf-admin', kind: 'application' },
  { name: 'API', url: 'https://api.rfrf.net/api/liveness', service: 'rafraf-api', kind: 'application' },
  { name: 'Tap', url: 'https://gfxnwfjjpxmzvnylushd.supabase.co/functions/v1/rafraf-tap/health', service: 'rafraf-tap', kind: 'integration',
    bindings: { secretPresent: ['TAP_SECRET_KEY'], merchantPresent: ['TAP_MERCHANT_ID'], modeValid: ['TAP_MODE'] },
    validations: ['secretModeMatches', 'merchantFormatValid'] },
  { name: 'OTO', url: 'https://gfxnwfjjpxmzvnylushd.supabase.co/functions/v1/rafraf-oto/health', service: 'rafraf-oto', kind: 'integration',
    bindings: { tokenPresent: ['OTO_REFRESH_TOKEN'], enabled: ['OTO_ENABLED'], automaticShipmentDisabled: ['OTO_AUTO_CREATE_SHIPMENT', 'SHIPMENT_AUTO_CREATE'] },
    validations: ['configured'] },
];

export function expectedRelease(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value) || /^0+$/.test(value))
    throw new Error('EXPECTED_RELEASE_SHA must be the full nonzero Git commit SHA');
  return value.toLowerCase();
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function assessReleaseTarget(target, httpStatus, payload, expected = null) {
  const result = { name: target.name, url: target.url, kind: target.kind, httpStatus,
    passed: false, issue: null, release: null, missingSettings: [], invalidChecks: [] };
  if (httpStatus !== 200) return { ...result, issue: `HTTP_${httpStatus}` };
  const data = record(payload);
  if (data.service !== target.service) return { ...result, issue: 'APPLICATION_IDENTITY_MISMATCH' };
  if (target.kind === 'application') {
    if (data.status !== 'alive') return { ...result, issue: 'APPLICATION_NOT_ALIVE' };
    if (typeof data.release !== 'string' || !/^[0-9a-f]{7,40}$/i.test(data.release) || /^0+$/.test(data.release))
      return { ...result, issue: 'RELEASE_IDENTITY_MISSING' };
    result.release = data.release.toLowerCase();
    // Current liveness endpoints publish the first 12 characters. A shorter
    // prefix is not enough evidence for an expected release check.
    if (expected && (result.release.length < 12 || !expected.startsWith(result.release)))
      return { ...result, issue: 'RELEASE_MISMATCH' };
  } else {
    if (data.ok !== true) return { ...result, issue: 'BROKER_NOT_HEALTHY' };
    const config = record(data.configuration);
    result.missingSettings = Object.entries(target.bindings)
      .filter(([flag]) => config[flag] !== true).flatMap(([, names]) => names);
    result.invalidChecks = target.validations.filter(flag => config[flag] !== true);
    if (result.missingSettings.length || result.invalidChecks.length)
      return { ...result, issue: 'INTEGRATION_CONFIGURATION_INCOMPLETE' };
  }
  return { ...result, passed: true };
}

export function connectionIssue(error) {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (item.name === 'TimeoutError' || item.name === 'AbortError' ||
        ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(item.code)) return 'CONNECTION_TIMEOUT';
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(item.code)) return 'DNS_LOOKUP_FAILED';
    if (['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(item.code)) return 'TLS_VERIFICATION_FAILED';
    if (item.code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
    pending.push(item.cause, ...(Array.isArray(item.errors) ? item.errors : []));
  }
  return 'CONNECTION_FAILED';
}

async function boundedJson(response) {
  if (!response.body) throw Error('JSON_RESPONSE_INVALID');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw Error('JSON_RESPONSE_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Error('JSON_RESPONSE_INVALID'); }
}

export async function checkReleaseTarget(target, { send = fetch, release = null } = {}) {
  let response;
  try {
    response = await send(target.url, { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  } catch (error) {
    return { ...assessReleaseTarget(target, null, null), issue: connectionIssue(error) };
  }
  if (response.status !== 200) {
    try { await response.body?.cancel(); } catch { /* Preserve the observed HTTP result. */ }
    return assessReleaseTarget(target, response.status, null, release);
  }
  let payload;
  try { payload = await boundedJson(response); }
  catch (error) { return { ...assessReleaseTarget(target, 200, null), issue: error.message }; }
  return assessReleaseTarget(target, response.status, payload, release);
}

export async function runReleaseReview({ send = fetch, release = null, directory = 'outputs/release-review' } = {}) {
  release = expectedRelease(release ?? undefined);
  const checks = await Promise.all(RELEASE_TARGETS.map(target => checkReleaseTarget(target, { send, release })));
  const report = { checkedAtUtc: new Date().toISOString(), expectedRelease: release,
    passed: checks.every(item => item.passed), checks,
    limits: ['قراءات GET عامة فقط؛ لا تسجيل دخول أو تعديل بيانات أو دفع أو شحن',
      'هوية الإصدار معلنة من التطبيق؛ ليست مقارنة تجزئة لجميع ملفات الاستضافة',
      'اكتمال إعداد المزود لا يثبت نجاح المصادقة أو المعاملة الفعلية',
      'صحة بيانات العملاء والموردين تتطلب وصول قاعدة البيانات المخول واختبارات ملكية مستقلة'] };
  await mkdir(resolve(directory), { recursive: true });
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const rows = checks.map(item => `| ${item.name} | ${item.passed ? 'ناجح' : 'غير جاهز'} | ${item.issue ?? 'الفحص المحدد ناجح'} | ${item.missingSettings.join(', ') || '—'} |`);
  await writeFile(resolve(directory, 'report.md'), `# تحقق نشر رفرف وتكاملاته\n\n${report.checkedAtUtc}\n\n` +
    `| الخدمة | النتيجة | السبب | إعدادات غائبة أو غير مفعلة |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n` +
    report.limits.join('\n\n') + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runReleaseReview({ release: process.env.EXPECTED_RELEASE_SHA,
    directory: process.env.QA_RELEASE_DIRECTORY || 'outputs/release-review' });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
