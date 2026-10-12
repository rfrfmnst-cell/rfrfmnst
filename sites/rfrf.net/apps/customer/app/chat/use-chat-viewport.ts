'use client';

import { useEffect, useRef } from 'react';

/** Keep the chat in the visible area when a mobile keyboard resizes it. */
export function useChatViewport() {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;

    function resize() {
      if (!shell || !viewport) return;
      // Preserve native pinch zoom rather than resizing the layout around it.
      if (viewport.scale !== 1) {
        shell.style.removeProperty('--rf-chat-viewport-height');
        return;
      }
      const height = Math.min(viewport.height, window.innerHeight);
      if (height > 0) {
        shell.style.setProperty('--rf-chat-viewport-height', `${height}px`);
      }
    }

    resize();
    viewport.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      window.removeEventListener('resize', resize);
      shell.style.removeProperty('--rf-chat-viewport-height');
    };
  }, []);

  return shellRef;
}
