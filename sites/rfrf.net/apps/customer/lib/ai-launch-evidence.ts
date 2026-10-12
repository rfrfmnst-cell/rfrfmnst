import { createHash } from 'node:crypto';
import { ActorType, type Prisma, prisma } from '@rafraf/db';
import {
  chatModelId,
  generativeAiApiKey,
  hostedProviderApiKey,
  hostedProviderBaseUrl,
  openAiCompatibleApiKey,
  openAiCompatibleBaseUrl,
  resolveChatProvider,
  vertexLocation,
  vertexProject,
  type ChatModelProvider,
} from '@rafraf/shared/ai/model-provider';

export const CHAT_STREAM_EVIDENCE_ACTION =
  'integration.ai.chat_stream_verified';
export const CHAT_STREAM_CONTRACT_VERSION = 'chat-stream-v1';
export const CHAT_STREAM_EVIDENCE_TTL_MS = 60 * 60 * 1_000;
export const CHAT_STREAM_PROBE_PATTERN = /^sha256-v1:[0-9a-f]{64}$/;

const CLOCK_SKEW_MS = 5 * 60 * 1_000;
const RELEASE_PATTERN = /^[0-9a-f]{7,64}$/i;
const FINGERPRINT_PATTERN = /^sha256-v1:[0-9a-f]{32}$/;

export interface ChatStreamConfiguration {
  requestedProvider: ChatModelProvider;
  requestedModel: string;
  configFingerprint: string;
}

export interface ChatStreamEvidence {
  contractVersion: string;
  environment: string;
  requestedProvider: string;
  requestedModel: string;
  builtProvider: string;
  builtModel: string;
  runtimeProvider: string;
  runtimeModel: string;
  finishReason: string;
  uiFinishReason: string;
  textDeltaCount: number;
  textChars: number;
  hadError: boolean;
  aborted: boolean;
  toolError: boolean;
  configFingerprint: string;
  probeHash: string;
  branchId: string;
  release: string;
  observedAt: number;
}

export type ChatStreamEvidenceInput = Omit<
  ChatStreamEvidence,
  'contractVersion' | 'environment' | 'branchId' | 'release' | 'observedAt'
>;

function clean(value: string | undefined): string {
  return value?.trim() ?? '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deploymentEnvironment(env: NodeJS.ProcessEnv): string | null {
  const environment = clean(env.VERCEL_ENV).toLowerCase();
  return environment === 'preview' || environment === 'production'
    ? environment
    : null;
}

function secretVersion(value: string): string {
  return `sha256-v1:${sha256(value).slice(0, 16)}`;
}

/**
 * Builds a non-secret identity for the exact provider configuration used by
 * chat. Credential material is reduced to a version hash before it enters the
 * fingerprint and is never returned or persisted.
 */
export function chatStreamConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): ChatStreamConfiguration | null {
  let requestedProvider: ChatModelProvider | null;
  try {
    requestedProvider = resolveChatProvider(env);
  } catch {
    return null;
  }
  if (!requestedProvider) return null;

  const requestedModel = chatModelId(env, requestedProvider);
  const hosted =
    requestedProvider === 'huggingface' || requestedProvider === 'anthropic'
      ? requestedProvider
      : null;
  const target = hosted
    ? {
        endpoint: hostedProviderBaseUrl(hosted),
        project: '',
        location: '',
        credentialVersion: secretVersion(
          hostedProviderApiKey(env, hosted) ?? '',
        ),
      }
    : requestedProvider === 'vertex'
      ? {
          endpoint: 'google-vertex',
          project: vertexProject(env) ?? '',
          location: vertexLocation(env),
          credentialVersion: secretVersion(
            clean(env.GOOGLE_CLOUD_CREDENTIALS) ||
              clean(env.GOOGLE_APPLICATION_CREDENTIALS),
          ),
        }
      : requestedProvider === 'google-generative-ai'
        ? {
            endpoint: 'https://generativelanguage.googleapis.com',
            project: '',
            location: '',
            credentialVersion: secretVersion(generativeAiApiKey(env) ?? ''),
          }
        : {
            endpoint: openAiCompatibleBaseUrl(env) ?? '',
            project: '',
            location: '',
            credentialVersion: secretVersion(
              openAiCompatibleApiKey(env) ?? 'unkeyed-local-endpoint',
            ),
          };
  const fingerprintPayload = JSON.stringify({
    contractVersion: CHAT_STREAM_CONTRACT_VERSION,
    requestedProvider,
    requestedModel,
    ...target,
  });

  return {
    requestedProvider,
    requestedModel,
    configFingerprint: `sha256-v1:${sha256(fingerprintPayload).slice(0, 32)}`,
  };
}

function object(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readChatStreamEvidence(input: {
  after: Prisma.JsonValue | null;
  createdAt: Date;
}): ChatStreamEvidence | null {
  const after = object(input.after);
  const strings = [
    'contractVersion',
    'environment',
    'requestedProvider',
    'requestedModel',
    'builtProvider',
    'builtModel',
    'runtimeProvider',
    'runtimeModel',
    'finishReason',
    'uiFinishReason',
    'configFingerprint',
    'probeHash',
    'branchId',
    'release',
  ] as const;
  if (
    strings.some((key) => typeof after[key] !== 'string') ||
    !Number.isInteger(after.textDeltaCount) ||
    !Number.isInteger(after.textChars) ||
    typeof after.hadError !== 'boolean' ||
    typeof after.aborted !== 'boolean' ||
    typeof after.toolError !== 'boolean'
  ) {
    return null;
  }

  return {
    contractVersion: after.contractVersion as string,
    environment: after.environment as string,
    requestedProvider: after.requestedProvider as string,
    requestedModel: after.requestedModel as string,
    builtProvider: after.builtProvider as string,
    builtModel: after.builtModel as string,
    runtimeProvider: after.runtimeProvider as string,
    runtimeModel: after.runtimeModel as string,
    finishReason: after.finishReason as string,
    uiFinishReason: after.uiFinishReason as string,
    textDeltaCount: after.textDeltaCount as number,
    textChars: after.textChars as number,
    hadError: after.hadError as boolean,
    aborted: after.aborted as boolean,
    toolError: after.toolError as boolean,
    configFingerprint: after.configFingerprint as string,
    probeHash: after.probeHash as string,
    branchId: after.branchId as string,
    release: after.release as string,
    observedAt: input.createdAt.getTime(),
  };
}

export function isChatStreamEvidenceCurrent(
  env: NodeJS.ProcessEnv,
  evidence: ChatStreamEvidence | null,
  now = Date.now(),
  expectedProbeHash?: string,
): boolean {
  const configuration = chatStreamConfiguration(env);
  const environment = deploymentEnvironment(env);
  const branchId = clean(env.NEON_BRANCH_ID);
  const release = clean(env.VERCEL_GIT_COMMIT_SHA);
  return Boolean(
    configuration &&
    evidence &&
    environment &&
    branchId &&
    evidence.contractVersion === CHAT_STREAM_CONTRACT_VERSION &&
    evidence.environment === environment &&
    evidence.requestedProvider === configuration.requestedProvider &&
    evidence.requestedModel === configuration.requestedModel &&
    evidence.configFingerprint === configuration.configFingerprint &&
    FINGERPRINT_PATTERN.test(evidence.configFingerprint) &&
    CHAT_STREAM_PROBE_PATTERN.test(evidence.probeHash) &&
    (!expectedProbeHash || evidence.probeHash === expectedProbeHash) &&
    evidence.builtProvider.length > 0 &&
    evidence.builtModel === evidence.requestedModel &&
    evidence.runtimeProvider === evidence.builtProvider &&
    evidence.runtimeModel === evidence.builtModel &&
    evidence.finishReason === 'stop' &&
    evidence.uiFinishReason === 'stop' &&
    Number.isInteger(evidence.textDeltaCount) &&
    evidence.textDeltaCount >= 1 &&
    Number.isInteger(evidence.textChars) &&
    evidence.textChars >= evidence.textDeltaCount &&
    !evidence.hadError &&
    !evidence.aborted &&
    !evidence.toolError &&
    evidence.branchId === branchId &&
    RELEASE_PATTERN.test(release) &&
    evidence.release === release &&
    Number.isFinite(evidence.observedAt) &&
    evidence.observedAt <= now + CLOCK_SKEW_MS &&
    now - evidence.observedAt <= CHAT_STREAM_EVIDENCE_TTL_MS,
  );
}

/** Persists PII-free evidence only after a successful stored UI stream. */
export async function recordChatStreamEvidence(
  input: ChatStreamEvidenceInput,
  client: typeof prisma = prisma,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const configuration = chatStreamConfiguration(env);
  const environment = deploymentEnvironment(env);
  const release = clean(env.VERCEL_GIT_COMMIT_SHA);
  const expectedBranch = clean(env.NEON_BRANCH_ID);
  if (
    !configuration ||
    !environment ||
    !RELEASE_PATTERN.test(release) ||
    !expectedBranch ||
    input.requestedProvider !== configuration.requestedProvider ||
    input.requestedModel !== configuration.requestedModel ||
    input.configFingerprint !== configuration.configFingerprint ||
    !CHAT_STREAM_PROBE_PATTERN.test(input.probeHash) ||
    input.builtModel !== input.requestedModel ||
    !input.builtProvider ||
    input.runtimeProvider !== input.builtProvider ||
    input.runtimeModel !== input.builtModel ||
    input.finishReason !== 'stop' ||
    input.uiFinishReason !== 'stop' ||
    !Number.isInteger(input.textDeltaCount) ||
    input.textDeltaCount < 1 ||
    !Number.isInteger(input.textChars) ||
    input.textChars < input.textDeltaCount ||
    input.hadError ||
    input.aborted ||
    input.toolError
  ) {
    return false;
  }

  try {
    const rows = await client.$queryRaw<Array<{ branchId: string | null }>>`
      SELECT current_setting('neon.branch_id', true) AS "branchId"
    `;
    const actualBranch = rows[0]?.branchId ?? '';
    if (actualBranch !== expectedBranch) return false;

    await client.auditLog.create({
      data: {
        actorType: ActorType.SYSTEM,
        action: CHAT_STREAM_EVIDENCE_ACTION,
        entityType: 'ai_runtime',
        entityId: release,
        after: {
          contractVersion: CHAT_STREAM_CONTRACT_VERSION,
          environment,
          requestedProvider: input.requestedProvider,
          requestedModel: input.requestedModel,
          builtProvider: input.builtProvider,
          builtModel: input.builtModel,
          runtimeProvider: input.runtimeProvider,
          runtimeModel: input.runtimeModel,
          finishReason: input.finishReason,
          uiFinishReason: input.uiFinishReason,
          textDeltaCount: input.textDeltaCount,
          textChars: input.textChars,
          hadError: false,
          aborted: false,
          toolError: false,
          configFingerprint: input.configFingerprint,
          probeHash: input.probeHash,
          branchId: actualBranch,
          release,
        },
      },
    });
    return true;
  } catch {
    console.error('[chat] launch evidence write failed', {
      code: 'AI_EVIDENCE_WRITE_FAILED',
    });
    return false;
  }
}

/** One-way, PII-free binding between a synthetic probe message and its evidence. */
export function chatStreamProbeHash(
  threadId: string,
  messageId: string,
): string {
  return `sha256-v1:${sha256(`${threadId}:${messageId}`)}`;
}
