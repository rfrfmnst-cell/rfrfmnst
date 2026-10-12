import { VOICE_MAX_TEXT } from './voice-input-session';

/** Preserve the typed draft; voice review never submits a chat message. */
export function appendVoiceTranscript(
  current: string,
  transcript: string,
): string {
  const combined = [current.trim(), transcript.trim()]
    .filter(Boolean)
    .join('\n');
  if (combined.length > VOICE_MAX_TEXT) {
    throw new Error(
      'النص أطول من الحد المسموح. اختصر التسجيل أو النص المكتوب أولاً.',
    );
  }
  return combined;
}
