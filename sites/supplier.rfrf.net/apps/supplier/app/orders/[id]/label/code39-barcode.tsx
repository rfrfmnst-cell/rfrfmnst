const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

const NARROW = 2;
const WIDE = 6;
const GAP = 2;
const QUIET = 20;
const BAR_HEIGHT = 72;

function normalize(value: string): string {
  const cleaned = value
    .toUpperCase()
    .split('')
    .filter((character) => character !== '*' && CODE39[character])
    .join('');
  return cleaned || 'RAFRAF';
}

export function Code39Barcode({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const payload = normalize(value);
  const encoded = `*${payload}*`;
  const bars: Array<{ x: number; width: number; key: string }> = [];
  let x = QUIET;

  for (const [characterIndex, character] of [...encoded].entries()) {
    const pattern = CODE39[character];
    if (!pattern) continue;

    for (const [elementIndex, size] of [...pattern].entries()) {
      const width = size === 'w' ? WIDE : NARROW;
      if (elementIndex % 2 === 0) {
        bars.push({
          x,
          width,
          key: `${characterIndex}-${elementIndex}`,
        });
      }
      x += width;
    }

    if (characterIndex < encoded.length - 1) x += GAP;
  }

  const totalWidth = x + QUIET;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${totalWidth} ${BAR_HEIGHT}`}
      role="img"
      aria-label={`Code 39 barcode: ${payload}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <title>{`Code 39: ${payload}`}</title>
      <rect width={totalWidth} height={BAR_HEIGHT} fill="#fff" />
      {bars.map((bar) => (
        <rect
          key={bar.key}
          x={bar.x}
          y={0}
          width={bar.width}
          height={BAR_HEIGHT}
          fill="#111827"
        />
      ))}
    </svg>
  );
}
