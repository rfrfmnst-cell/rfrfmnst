import { describe, it, expect } from '@jest/globals';
import {
  API_SECURITY_HEADERS,
  DEFAULT_ALLOWED_ORIGINS,
  allowedOrigins,
  securityHeadersMiddleware,
} from './security';

describe('ترويسات حماية الـAPI', () => {
  it('تضع المجموعة كاملة على الاستجابة ثم تُمرّر', () => {
    const set = new Map<string, string>();
    let passed = false;
    securityHeadersMiddleware()(
      {},
      { setHeader: (key, value) => void set.set(key, value) },
      () => void (passed = true),
    );

    expect(passed).toBe(true);
    expect([...set.keys()].sort()).toEqual(
      API_SECURITY_HEADERS.map((header) => header.key).sort(),
    );
    expect(set.get('Strict-Transport-Security')).toMatch(
      /max-age=31536000.*includeSubDomains/,
    );
    // `preload` قرار يصعب التراجع عنه؛ يُتخذ منفصلاً لا ضمناً.
    expect(set.get('Strict-Transport-Security')).not.toMatch(/preload/);
    expect(set.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(set.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('سياسة أصول الـAPI', () => {
  it('تقتصر على أصول رفرف حين لا يُضبط شيء', () => {
    expect(allowedOrigins({} as NodeJS.ProcessEnv)).toEqual([
      ...DEFAULT_ALLOWED_ORIGINS,
    ]);
    // لا نجمة: `*` كان يرد فعلاً من الإنتاج على كل الطرق.
    expect(allowedOrigins({} as NodeJS.ProcessEnv)).not.toContain('*');
  });

  it('تحترم الضبط الصريح وتتجاهل الفراغ', () => {
    expect(
      allowedOrigins({
        API_ALLOWED_ORIGINS: 'https://a.example, https://b.example ,',
      } as NodeJS.ProcessEnv),
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('لا يفتحها ضبط فارغ بل يعيدها إلى أصول رفرف', () => {
    expect(
      allowedOrigins({ API_ALLOWED_ORIGINS: '   ' } as NodeJS.ProcessEnv),
    ).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
  });
});
