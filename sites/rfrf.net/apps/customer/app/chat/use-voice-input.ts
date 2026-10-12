'use client';

import { useEffect, useRef, useState } from 'react';
import {
  browserVoiceDependencies,
  EMPTY_VOICE_SNAPSHOT,
  VoiceInputSession,
} from './voice-input-session';

export function useVoiceInput() {
  const [state, setState] = useState({ ...EMPTY_VOICE_SNAPSHOT });
  const session = useRef<VoiceInputSession | null>(null);
  useEffect(() => {
    const capture = new VoiceInputSession(browserVoiceDependencies(), setState);
    session.current = capture;
    return () => {
      capture.dispose();
      session.current = null;
    };
  }, []);
  return {
    ...state,
    start: () => session.current?.start(),
    stop: () => session.current?.stop(),
    reset: () => session.current?.reset(),
    setTranscript: (text: string) => session.current?.setTranscript(text),
  };
}
