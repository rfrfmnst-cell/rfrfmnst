'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export type RafrafTheme = 'dark' | 'light';

function readTheme(): RafrafTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<RafrafTheme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    setTheme(readTheme());
    setReady(true);
    return () => observer.disconnect();
  }, []);

  function toggleTheme() {
    const nextTheme: RafrafTheme = readTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', nextTheme === 'dark' ? '#07101F' : '#FBF8F2');
    try {
      window.localStorage.setItem('rafraf-theme', nextTheme);
    } catch {
      // The theme still applies to this page when storage is unavailable.
    }
    setTheme(nextTheme);
  }

  const isDark = theme === 'dark';
  const label = isDark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن';

  return (
    <button
      type="button"
      className="rafraf-theme-toggle"
      onClick={toggleTheme}
      disabled={!ready}
      aria-label={label}
      aria-pressed={isDark}
      aria-busy={!ready}
      title={label}
    >
      {isDark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
      <span>{isDark ? 'فاتح' : 'داكن'}</span>
    </button>
  );
}
