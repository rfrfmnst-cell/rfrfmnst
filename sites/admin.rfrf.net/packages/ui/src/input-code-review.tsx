'use client';

import { ltrRuns } from './bidi-runs';
import { useAuiState } from '@assistant-ui/react';

/** Readable code review without changing editable text or submitted bytes. */
export function InputCodeReview({ text }: { text: string }) {
  if (text.length > 4000) {
    return (
      <div className="rf-input-code-review" role="note">
        النص طويل؛ اختصره قبل مراجعة الأرقام وإرساله.
      </div>
    );
  }
  const codes = [
    ...new Set(
      ltrRuns(text)
        .filter((run) => run.ltr)
        .map((run) => run.text),
    ),
  ];
  if (!codes.length) return null;
  return (
    <div
      className="rf-input-code-review"
      role="group"
      aria-label="الأرقام بالترتيب المكتوب"
    >
      <small>الأرقام بالترتيب المكتوب</small>
      {codes.map((code) => (
        <bdi key={code} dir="ltr">
          {code}
        </bdi>
      ))}
    </div>
  );
}

export function ComposerCodeReview() {
  const text = useAuiState((state) => state.composer.text);
  return <InputCodeReview text={text} />;
}
