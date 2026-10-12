import { describe, it, expect } from '@jest/globals';
import { apiDocsEnabled, buildOpenApiConfig, API_DOCS_PATH } from './swagger';

describe('بوابة وثائق OpenAPI', () => {
  it('مفتوحة في التطوير والاختبار', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(
      true,
    );
    expect(apiDocsEnabled({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
    expect(apiDocsEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('مغلقة في الإنتاج ما لم يُطلب فتحها صراحةً', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(
      apiDocsEnabled({
        NODE_ENV: 'production',
        API_DOCS_ENABLED: 'false',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    // لا تُقبل قيمة مبهمة: الفتح قرار صريح بكلمة واحدة.
    expect(
      apiDocsEnabled({
        NODE_ENV: 'production',
        API_DOCS_ENABLED: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      apiDocsEnabled({
        NODE_ENV: 'production',
        API_DOCS_ENABLED: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});

describe('وثيقة OpenAPI', () => {
  const doc = buildOpenApiConfig();

  it('تحمل العنوان والإصدار ومصادقة الحامل', () => {
    expect(doc.info.title).toBe('Rafraf API');
    expect(doc.info.version).toBe('0.1.0');
    expect(doc.components?.securitySchemes).toHaveProperty('access-token');
  });

  it('تنصّ على قاعدة العمل 2 في الوصف', () => {
    expect(doc.info.description).toMatch(/قاعدة العمل رقم 2/);
  });

  it('تُخدم على مسار ثابت', () => {
    expect(API_DOCS_PATH).toBe('docs');
  });
});
