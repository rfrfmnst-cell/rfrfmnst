import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** المسار الذي تُخدم عليه وثيقة OpenAPI وواجهتها. */
export const API_DOCS_PATH = 'docs';

/**
 * وثائق OpenAPI مغلقة افتراضياً في الإنتاج.
 *
 * الوثيقة تصف سطح الـAPI كاملاً — المسارات والحقول وأشكال الأخطاء — وهي
 * معلومة استطلاعية مجانية لمن يبحث عن ثغرة. في التطوير والاختبار تُفتح لأنها
 * أداة العمل اليومية؛ وفي الإنتاج تحتاج قراراً صريحاً عبر `API_DOCS_ENABLED`،
 * على نهج «الرفض الآمن» المتّبع في بقية المنصة.
 */
export function apiDocsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return env.API_DOCS_ENABLED === 'true';
}

export function buildOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle('Rafraf API')
    .setDescription(
      'واجهة منصة رفرف لتوريد قطع غيار السيارات ومقارنتها. ' +
        'قاعدة العمل رقم 2 مُلزِمة: لا يُعاد للعميل سعر مورد ولا هامش ولا رسوم ' +
        'ولا احتياطي مخاطرة — التفاصيل الداخلية للأدمن وحده.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('health', 'فحوص الجاهزية')
    .addTag('rfq', 'طلبات التسعير')
    .addTag('quotes', 'العروض والمقارنة')
    .addTag('orders', 'الطلبات والتتبّع')
    .addTag('suppliers', 'الموردون والمخزون')
    .build();
}

/** يركّب Swagger على التطبيق ويعيد ما إذا كان قد رُكّب فعلاً. */
export function setupSwagger(app: INestApplication): boolean {
  if (!apiDocsEnabled()) return false;

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: `${API_DOCS_PATH}/json`,
    swaggerOptions: { persistAuthorization: true },
  });
  return true;
}
