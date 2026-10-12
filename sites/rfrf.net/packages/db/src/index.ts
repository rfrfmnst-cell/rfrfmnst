import { PrismaClient } from '@prisma/client';

export {
  RFQStatus,
  OrderStatus,
  QuoteSourceType,
  PartSensitivity,
  RiskLevel,
  SupplierStatus,
  CandidateStatus,
  SasoScheme,
  FitmentSource,
  RoleName,
  PartNumberType,
  PartCondition,
  InventoryRowStatus,
  RfqChannel,
  EvidenceType,
  SourcingRunStatus,
  QuoteStatus,
  RecommendationLabel,
  PaymentStatus,
  PaymentRefundStatus,
  EscrowEntryType,
  PayoutStatus,
  ShipmentStatus,
  CertificateStatus,
  ComplianceReviewStatus,
  DisputeStatus,
  ActorType,
  AIDecisionKind,
  ChatMessageRole,
  ChatThreadStatus,
  AIChatRunStatus,
  AdminMfaVerificationStatus,
  Prisma,
} from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
