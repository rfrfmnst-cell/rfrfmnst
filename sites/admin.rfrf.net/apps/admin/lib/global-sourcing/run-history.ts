import type { Prisma } from '@rafraf/db';
import {
  GLOBAL_DISCOVERY_PROVIDER_KEYS,
  type GlobalDiscoveryProviderKey,
} from './provider-registry.ts';

export const GLOBAL_SOURCING_HISTORY_CANDIDATE_LIMIT = 20;

interface StoredSourcingRun {
  id: string;
  notes: string | null;
  status: string;
  startedAt: Date;
}

export interface GlobalSourcingRunGroup<Run extends StoredSourcingRun> {
  providerKey: GlobalDiscoveryProviderKey;
  latestRun: Run;
  lastSuccessfulRun: Run | null;
}

function canonicalSearchPrefix(
  providerKey: GlobalDiscoveryProviderKey,
): string {
  // safeRunNotes writes these two fields first, followed by server metadata.
  return `{"providerKey":"${providerKey}","capability":"SEARCH",`;
}

/** Accept only canonical SEARCH notes; arbitrary metadata never identifies a provider. */
export function globalSourcingRunProviderKey(
  notes: unknown,
): GlobalDiscoveryProviderKey | null {
  if (typeof notes !== 'string') return null;
  const providerKey = GLOBAL_DISCOVERY_PROVIDER_KEYS.find((key) =>
    notes.startsWith(canonicalSearchPrefix(key)),
  );
  if (!providerKey) return null;
  try {
    const parsed: unknown = JSON.parse(notes);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return record.providerKey === providerKey && record.capability === 'SEARCH'
      ? providerKey
      : null;
  } catch {
    return null;
  }
}

function newestRunFirst(a: StoredSourcingRun, b: StoredSourcingRun): number {
  const dateOrder = b.startedAt.getTime() - a.startedAt.getTime();
  if (dateOrder) return dateOrder;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** Latest status remains authoritative even when an older DONE run is retained. */
export function groupGlobalSourcingRuns<Run extends StoredSourcingRun>(
  runs: readonly Run[],
): GlobalSourcingRunGroup<Run>[] {
  const ordered = [...runs].sort(newestRunFirst);
  return GLOBAL_DISCOVERY_PROVIDER_KEYS.flatMap((providerKey) => {
    const matching = ordered.filter(
      (run) => globalSourcingRunProviderKey(run.notes) === providerKey,
    );
    const latestRun = matching[0];
    if (!latestRun) return [];
    return [
      {
        providerKey,
        latestRun,
        lastSuccessfulRun:
          matching.find((run) => run.status === 'DONE') ?? null,
      },
    ];
  });
}

const RUN_INCLUDE = {
  candidates: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    take: GLOBAL_SOURCING_HISTORY_CANDIDATE_LIMIT,
    include: { sourceRegistry: true },
  },
} satisfies Prisma.SourcingRunInclude;

export type GlobalSourcingHistoryRun = Prisma.SourcingRunGetPayload<{
  include: typeof RUN_INCLUDE;
}>;

export function globalSourcingRunQuery(
  rfqItemId: string,
  providerKey: GlobalDiscoveryProviderKey,
  successfulOnly = false,
) {
  return {
    where: {
      rfqItemId,
      // Prisma PostgreSQL startsWith uses LIKE, where _, % and \\ are special.
      notes: {
        startsWith: canonicalSearchPrefix(providerKey).replace(
          /[\\%_]/gu,
          '\\$&',
        ),
      },
      ...(successfulOnly ? { status: 'DONE' as const } : {}),
    },
    orderBy: [{ startedAt: 'desc' as const }, { id: 'desc' as const }],
    include: RUN_INCLUDE,
  } satisfies Prisma.SourcingRunFindFirstArgs;
}

type FindHistoryRun = (
  query: ReturnType<typeof globalSourcingRunQuery>,
) => Promise<GlobalSourcingHistoryRun | null>;

/** Two bounded reads per provider avoid paging through another provider's history. */
export async function loadGlobalSourcingRunsForItem(
  rfqItemId: string,
  findFirst: FindHistoryRun,
): Promise<GlobalSourcingHistoryRun[]> {
  const results = await Promise.all(
    GLOBAL_DISCOVERY_PROVIDER_KEYS.flatMap((providerKey) =>
      [false, true].map(async (successfulOnly) => {
        const run = await findFirst(
          globalSourcingRunQuery(rfqItemId, providerKey, successfulOnly),
        );
        if (
          !run ||
          run.rfqItemId !== rfqItemId ||
          globalSourcingRunProviderKey(run.notes) !== providerKey ||
          (successfulOnly && run.status !== 'DONE')
        ) {
          return null;
        }
        return {
          ...run,
          candidates: run.candidates.slice(
            0,
            GLOBAL_SOURCING_HISTORY_CANDIDATE_LIMIT,
          ),
        };
      }),
    ),
  );
  const uniqueRuns = new Map<string, GlobalSourcingHistoryRun>();
  for (const run of results) {
    if (run) uniqueRuns.set(run.id, run);
  }
  return [...uniqueRuns.values()].sort(newestRunFirst);
}
