import {
  detectEvidenceImage,
  EVIDENCE_MAX_BYTES,
  type EvidenceMimeType,
} from '@rafraf/shared/evidence-image';
import { prisma } from '@rafraf/db';
import { requireAdminPermission } from '../../../../lib/require-admin-session';
import { resolvePrivateEvidence } from '../../../../lib/private-evidence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EVIDENCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LEGACY_DATA_URI = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/;

function imageResponse(bytes: Uint8Array, expectedType?: EvidenceMimeType) {
  const detected = detectEvidenceImage(bytes);
  if (!detected || (expectedType && detected.contentType !== expectedType)) {
    return null;
  }
  return new Response(bytes, {
    headers: {
      'Content-Type': detected.contentType,
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function decodeLegacyDataUri(value: string): {
  bytes: Uint8Array;
  contentType: EvidenceMimeType;
} | null {
  const match = LEGACY_DATA_URI.exec(value);
  if (!match || !match[1] || !match[2] || match[2].length % 4 !== 0) return null;
  if (match[2].length > Math.ceil(EVIDENCE_MAX_BYTES / 3) * 4) return null;
  const bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
  return bytes.length <= EVIDENCE_MAX_BYTES
    ? { bytes, contentType: match[1] as EvidenceMimeType }
    : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ evidenceId: string }> },
) {
  try {
    await requireAdminPermission('OPERATIONS_READ');
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { evidenceId } = await params;
  if (!EVIDENCE_ID_PATTERN.test(evidenceId)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const evidence = await prisma.rFQEvidence.findUnique({
    where: { id: evidenceId },
    select: { type: true, storageKey: true, fileUrl: true },
  });
  if (!evidence || evidence.type !== 'IMAGE') {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  if (evidence.storageKey) {
    try {
      const resolved = await resolvePrivateEvidence(evidence.storageKey);
      if (resolved.kind === 'signed-url') {
        return new Response(null, {
          status: 307,
          headers: {
            Location: resolved.url,
            'Cache-Control': 'private, no-store, max-age=0',
            'Referrer-Policy': 'no-referrer',
          },
        });
      }
      return imageResponse(resolved.bytes) ?? Response.json(
        { error: 'not_found' },
        { status: 404 },
      );
    } catch {
      return Response.json({ error: 'storage_unavailable' }, { status: 503 });
    }
  }

  const legacy = evidence.fileUrl
    ? decodeLegacyDataUri(evidence.fileUrl)
    : null;
  return legacy
    ? imageResponse(legacy.bytes, legacy.contentType) ?? Response.json(
        { error: 'not_found' },
        { status: 404 },
      )
    : Response.json({ error: 'not_found' }, { status: 404 });
}
