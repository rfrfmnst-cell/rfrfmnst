const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '');
  return VIN_PATTERN.test(normalized) ? normalized : undefined;
}

export function extractVin(text: string): string | undefined {
  const candidates = text.toUpperCase().match(/[A-Z0-9][A-Z0-9\s-]{15,24}[A-Z0-9]/g);
  return candidates?.map(normalizeVin).find(Boolean);
}
