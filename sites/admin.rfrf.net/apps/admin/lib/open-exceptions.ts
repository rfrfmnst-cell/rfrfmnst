import { ActorType, prisma, QuoteStatus, RiskLevel } from '@rafraf/db';

const TERMINAL_ACTIONS = [
  'risk.exception.local_override',
  'risk.exception.rollback',
];
const REVIEWABLE_LEVELS: RiskLevel[] = [RiskLevel.HIGH, RiskLevel.BLOCKED];
const QUERY_CHUNK_SIZE = 400;

type OpenRiskRow = {
  id: string;
  entityId: string;
  riskLevel: RiskLevel;
  createdAt: Date;
};

function chunk<T>(items: T[], size = QUERY_CHUNK_SIZE): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

/**
 * Returns the authoritative open quote-risk queue used by /exceptions and the
 * persistent Product OS shortcut.
 *
 * We resolve the latest assessment timestamp per quote across ALL risk levels,
 * fetch every row at that timestamp, choose one row deterministically, and only
 * then filter to HIGH/BLOCKED. This prevents an older HIGH result—or a HIGH row
 * tied on timestamp with a later deterministic LOW/MEDIUM row—from resurfacing.
 *
 * Deliberately uncapped: silently truncating groups would under-report risk as
 * assessment history grows. Follow-up `IN` / `OR` reads are chunked to keep SQL
 * parameter counts bounded.
 */
export async function getOpenQuoteRiskAssessments(
  client: typeof prisma = prisma,
) {
  const latestGroups = await client.riskAssessment.groupBy({
    by: ['entityId'],
    where: { entityType: 'quote' },
    _max: { createdAt: true },
  });

  const latestKeys = latestGroups.flatMap((group) =>
    group._max.createdAt
      ? [{ entityId: group.entityId, createdAt: group._max.createdAt }]
      : [],
  );

  const latestRows: OpenRiskRow[] = [];
  for (const latestKeyChunk of chunk(latestKeys)) {
    const rows = await client.riskAssessment.findMany({
      where: {
        entityType: 'quote',
        OR: latestKeyChunk,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        entityId: true,
        riskLevel: true,
        createdAt: true,
      },
    });
    latestRows.push(...rows);
  }

  // Keep one authoritative row per quote before applying the risk-level filter.
  const latestRiskByQuote = new Map<string, OpenRiskRow>();
  for (const risk of latestRows) {
    if (!latestRiskByQuote.has(risk.entityId)) {
      latestRiskByQuote.set(risk.entityId, risk);
    }
  }
  const latestReviewableRisks = [...latestRiskByQuote.values()].filter((risk) =>
    REVIEWABLE_LEVELS.includes(risk.riskLevel),
  );

  if (latestReviewableRisks.length === 0) {
    return { openRisks: [], resolvedCount: 0 };
  }

  const decisions: Array<{ entityId: string; action: string }> = [];
  for (const riskIdChunk of chunk(
    latestReviewableRisks.map((risk) => risk.id),
  )) {
    const rows = await client.auditLog.findMany({
      where: {
        entityType: 'risk_assessment',
        entityId: { in: riskIdChunk },
        actorType: ActorType.ADMIN,
        action: { in: TERMINAL_ACTIONS },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { entityId: true, action: true },
    });
    decisions.push(...rows);
  }

  const latestDecisionByRisk = new Map<string, string>();
  for (const decision of decisions) {
    if (!latestDecisionByRisk.has(decision.entityId)) {
      latestDecisionByRisk.set(decision.entityId, decision.action);
    }
  }

  const decisionOpenRisks = latestReviewableRisks.filter(
    (risk) =>
      latestDecisionByRisk.get(risk.id) !== 'risk.exception.local_override',
  );

  const liveQuoteIds = new Set<string>();
  for (const quoteIdChunk of chunk(
    decisionOpenRisks.map((risk) => risk.entityId),
  )) {
    const rows = await client.quote.findMany({
      where: {
        id: { in: quoteIdChunk },
        status: { not: QuoteStatus.REJECTED },
      },
      select: { id: true },
    });
    for (const quote of rows) liveQuoteIds.add(quote.id);
  }

  const openRisks = decisionOpenRisks.filter((risk) =>
    liveQuoteIds.has(risk.entityId),
  );

  return {
    openRisks,
    resolvedCount: latestReviewableRisks.length - openRisks.length,
  };
}
