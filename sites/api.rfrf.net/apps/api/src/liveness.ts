/**
 * نقطة حياة الـAPI.
 *
 * كانت الأسطح الثلاثة تُبلغ عن إصدارها على `/api/liveness` بينما يسكت الـAPI،
 * فلم يكن يُعرف من الخارج أي إصدار يعمل عليه — وهو ما أخفى انقسام الأسطول:
 * العميل على نشرة والمورد والإدارة على أخرى، بلا سبيل لقياس الرابع.
 *
 * الشكل مطابق لـ`apps/customer/app/api/liveness/route.ts` حرفاً بحرف حتى
 * يقرأ الأربعة بأمر واحد. والفرق الوحيد مصدر الـSHA: التطبيقات الثلاثة تتلقّى
 * `VERCEL_GIT_COMMIT_SHA` والـapi يتلقّى `RAFRAF_RELEASE_SHA` — كلاهما مضبوط
 * أصلاً في `docker-compose.yml`، فلا إعداد جديد.
 */
export interface LivenessPayload {
  service: 'rafraf-api';
  status: 'alive';
  release: string | null;
}

/**
 * يردّ أول ١٢ خانة من SHA صالح، و`null` لِما عداه.
 *
 * `null` مقصود لا سلسلة فارغة: القيمة الافتراضية في compose هي `0000000`،
 * وإظهارها كأنها إصدار حقيقي أسوأ من الإقرار بأنها مجهولة.
 */
export function releaseIdentity(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const release = env.RAFRAF_RELEASE_SHA?.trim() ?? '';
  if (!/^[0-9a-f]{7,64}$/i.test(release)) return null;
  if (/^0+$/.test(release)) return null;
  return release.slice(0, 12);
}

export function livenessPayload(
  env: NodeJS.ProcessEnv = process.env,
): LivenessPayload {
  return {
    service: 'rafraf-api',
    status: 'alive',
    release: releaseIdentity(env),
  };
}
