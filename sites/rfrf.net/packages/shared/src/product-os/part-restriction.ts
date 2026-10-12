export interface PartRestrictionFacts {
  isRestricted: boolean;
  sensitivity: string;
  category: { isRestricted: boolean; sensitivity: string };
}

/**
 * الحظر موروث من القطعة أو فئتها، ومن العلم الصريح أو حساسية RESTRICTED.
 * تكرار المصدرين مقصود لأن البيانات القديمة قد تكون ملأت واحداً دون الآخر.
 */
export function isPartCommerceRestricted(
  part: PartRestrictionFacts | null | undefined,
): boolean {
  return (
    !part ||
    part.isRestricted ||
    part.sensitivity === 'RESTRICTED' ||
    part.category.isRestricted ||
    part.category.sensitivity === 'RESTRICTED'
  );
}
