import type { Prisma } from '@rafraf/db';

/**
 * One fail-closed supplier opportunity boundary shared by the dashboard and
 * the paginated quotes workspace. A missing part/category is not sourceable.
 */
export const SUPPLIER_ELIGIBLE_RFQ_ITEM_WHERE = {
  partId: { not: null },
  part: {
    is: {
      isRestricted: false,
      sensitivity: { not: 'RESTRICTED' },
      category: {
        is: {
          isRestricted: false,
          sensitivity: { not: 'RESTRICTED' },
        },
      },
    },
  },
  fitmentConfidence: { gte: 0.85 },
  humanReviewRequired: false,
} satisfies Prisma.RFQItemWhereInput;
