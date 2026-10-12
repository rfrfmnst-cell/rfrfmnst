'use client';

import {
  MessagePartPrimitive,
  useMessagePartText,
  useSmooth,
} from '@assistant-ui/react';
import { ltrRuns } from './bidi-runs';

export function BidiText({ text }: { text: string }) {
  return ltrRuns(text).map((run, index) =>
    run.ltr ? (
      <bdi key={index} dir="ltr">
        {run.text}
      </bdi>
    ) : (
      run.text
    ),
  );
}

// The default text part with part numbers kept in reading order.
export function AssistantText() {
  const { text, status } = useSmooth(useMessagePartText(), true);
  return (
    <p style={{ whiteSpace: 'pre-line' }}>
      <span data-status={status.type}>
        <BidiText text={text} />
      </span>
      <MessagePartPrimitive.InProgress>
        <span style={{ fontFamily: 'revert' }}> ●</span>
      </MessagePartPrimitive.InProgress>
    </p>
  );
}
