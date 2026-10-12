import { describe, it, expect } from '@jest/globals';
import { livenessPayload, releaseIdentity } from './liveness';

const env = (value?: string) =>
  ({
    ...(value === undefined ? {} : { RAFRAF_RELEASE_SHA: value }),
  }) as NodeJS.ProcessEnv;

describe('هوية إصدار الـAPI', () => {
  it('تقصّ SHA الصالح إلى اثنتي عشرة خانة', () => {
    expect(
      releaseIdentity(env('6c9a75bdeadbeef1234567890abcdef123456789')),
    ).toBe('6c9a75bdeadb');
    expect(releaseIdentity(env('  6c9a75bdeadb  '))).toBe('6c9a75bdeadb');
  });

  it('تردّ null لِما ليس SHA', () => {
    expect(releaseIdentity(env())).toBeNull();
    expect(releaseIdentity(env(''))).toBeNull();
    expect(releaseIdentity(env('غير-صالح'))).toBeNull();
    expect(releaseIdentity(env('abc'))).toBeNull(); // أقصر من سبع خانات
  });

  it('تردّ null للقيمة الافتراضية في compose', () => {
    // `${RELEASE_SHA:-0000000}` — إظهارها كإصدار حقيقي أسوأ من الإقرار بالجهل.
    expect(releaseIdentity(env('0000000'))).toBeNull();
    expect(releaseIdentity(env('0000000000000000'))).toBeNull();
  });
});

describe('حمولة نقطة الحياة', () => {
  it('تطابق شكل الأسطح الثلاثة', () => {
    expect(
      livenessPayload(env('6c9a75bdeadbeef1234567890abcdef123456789')),
    ).toEqual({
      service: 'rafraf-api',
      status: 'alive',
      release: '6c9a75bdeadb',
    });
  });

  it('تبقى حيّة ولو جُهل الإصدار', () => {
    expect(livenessPayload(env())).toEqual({
      service: 'rafraf-api',
      status: 'alive',
      release: null,
    });
  });
});
