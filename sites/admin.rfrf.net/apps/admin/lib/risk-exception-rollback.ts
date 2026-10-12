import type {
  Prisma,
  RecommendationLabel,
} from '@rafraf/db';

export interface RankingSnapshotEntry {
  id: string;
  decisionScore: number | null;
  labels: RecommendationLabel[];
}

export class RankingRollbackConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankingRollbackConflict';
  }
}

export function parseRankingSnapshot(
  value: unknown,
  validLabels: readonly RecommendationLabel[],
): RankingSnapshotEntry[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const valid = new Set<string>(validLabels);
  const parsed: RankingSnapshotEntry[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;

    const row = entry as Record<string, unknown>;
    if (!Array.isArray(row.labels)) return null;
    if (
      !row.labels.every(
        (label) => typeof label === 'string' && valid.has(label),
      )
    ) {
      return null;
    }

    const labels = row.labels as RecommendationLabel[];
    if (
      typeof row.id !== 'string' ||
      row.id.trim().length === 0 ||
      seen.has(row.id) ||
      new Set(labels).size !== labels.length ||
      (row.decisionScore !== null &&
        (typeof row.decisionScore !== 'number' ||
          !Number.isFinite(row.decisionScore) ||
          row.decisionScore < 0 ||
          row.decisionScore > 1))
    ) {
      return null;
    }

    seen.add(row.id);
    parsed.push({
      id: row.id,
      decisionScore: row.decisionScore as number | null,
      labels,
    });
  }

  return parsed;
}

export async function restoreRankingSnapshotInTransaction(
  tx: Pick<Prisma.TransactionClient, 'quote' | 'recommendationResult'>,
  input: {
    rfqItemId: string;
    snapshots: readonly RankingSnapshotEntry[];
    createdRecommendationResultId: string;
  },
): Promise<void> {
  if (
    !input.rfqItemId ||
    !input.createdRecommendationResultId ||
    input.snapshots.length === 0
  ) {
    throw new RankingRollbackConflict('invalid ranking rollback input');
  }

  for (const snapshot of input.snapshots) {
    const restored = await tx.quote.updateMany({
      where: {
        id: snapshot.id,
        rfqItemId: input.rfqItemId,
      },
      data: {
        decisionScore: snapshot.decisionScore,
        labels: { set: snapshot.labels },
      },
    });

    if (restored.count !== 1) {
      throw new RankingRollbackConflict('ranking quote changed');
    }
  }

  const recommendationDeleted = await tx.recommendationResult.deleteMany({
    where: {
      id: input.createdRecommendationResultId,
      rfqItemId: input.rfqItemId,
    },
  });

  if (recommendationDeleted.count !== 1) {
    throw new RankingRollbackConflict('recommendation changed');
  }
}
