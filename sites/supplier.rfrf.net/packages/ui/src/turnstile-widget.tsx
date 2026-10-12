'use client';

import { useEffect, useRef, useState } from 'react';
import { humanVerificationMessage } from './human-verification-state';

const TURNSTILE_SCRIPT_ID = 'rafraf-turnstile-api';
const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_ALWAYS_PASS_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_RATE_LIMIT_SITE_KEY = 'rafraf-rate-limit-fallback-v1';
const TURNSTILE_RATE_LIMIT_TOKEN = 'rafraf-rate-limit-token-v1';
const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: 'auto';
      size: 'flexible';
      callback(token: string): void;
      'expired-callback'(): void;
      'error-callback'(): void;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const onReady = () => (window.turnstile ? resolve() : reject());
    const existing = document.getElementById(
      TURNSTILE_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onReady, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.head.append(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  action,
  responseFieldName = 'turnstileToken',
  className,
  onTokenChange,
}: {
  siteKey: string;
  action: string;
  responseFieldName?: string;
  className?: string;
  onTokenChange?: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onTokenChange);
  const [token, setToken] = useState('');
  const [failed, setFailed] = useState(false);
  const verificationMessage = humanVerificationMessage(siteKey, failed);

  useEffect(() => {
    callbackRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;
    const clearToken = () => {
      if (cancelled) return;
      setToken('');
      callbackRef.current?.('');
    };
    if (!siteKey || !containerRef.current) {
      setFailed(true);
      clearToken();
      return;
    }
    // Production continuity mode: the server still performs the durable
    // database-backed per-IP/global reservation before every protected flow.
    // This sentinel never represents a CAPTCHA pass and causes no third-party
    // script to load.
    if (siteKey === TURNSTILE_RATE_LIMIT_SITE_KEY) {
      setFailed(false);
      setToken(TURNSTILE_RATE_LIMIT_TOKEN);
      callbackRef.current?.(TURNSTILE_RATE_LIMIT_TOKEN);
      return;
    }
    // Cloudflare documents this pair specifically for automated non-production
    // environments. Avoid loading the external widget there so browser-driven
    // acceptance tests remain deterministic; the server still validates the
    // dummy token with Cloudflare's matching test secret.
    if (siteKey === TURNSTILE_ALWAYS_PASS_TEST_SITE_KEY) {
      setFailed(false);
      setToken(TURNSTILE_DUMMY_TOKEN);
      callbackRef.current?.(TURNSTILE_DUMMY_TOKEN);
      return;
    }
    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile || !containerRef.current) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          size: 'flexible',
          callback: (value) => {
            if (cancelled) return;
            setFailed(false);
            setToken(value);
            callbackRef.current?.(value);
          },
          'expired-callback': clearToken,
          'error-callback': () => {
            setFailed(true);
            clearToken();
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          clearToken();
        }
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, siteKey]);

  return (
    <div className={className}>
      <div ref={containerRef} />
      <input type="hidden" name={responseFieldName} value={token} />
      <span aria-live="polite">{verificationMessage}</span>
    </div>
  );
}
