import type { MetadataRoute } from 'next';
import {
  CUSTOMER_SITE_ORIGIN,
  PRIVATE_CRAWLER_PATHS,
} from '../lib/customer-public-site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: PRIVATE_CRAWLER_PATHS,
    },
    sitemap: `${CUSTOMER_SITE_ORIGIN}/sitemap.xml`,
    host: CUSTOMER_SITE_ORIGIN,
  };
}
