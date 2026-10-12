export function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  return `قبل ${Math.floor(hours / 24)} ي`;
}

export function pct(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

export function money(value: number): string {
  return new Intl.NumberFormat('ar-SA', {
    maximumFractionDigits: 0,
  }).format(value);
}
