import type { MetadataRoute } from 'next';
import {
  CUSTOMER_SITE_ORIGIN,
  PUBLIC_INDEXABLE_PATHS,
} from '../lib/customer-public-site';

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_INDEXABLE_PATHS.map((path) => ({
    url: `${CUSTOMER_SITE_ORIGIN}${path}`,
  }));
}
