import { useEffect, useState } from 'react';

const STORAGE_KEY = 'egv-biblioteka-dark-mode';

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored != null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem(STORAGE_KEY, String(dark));
  }, [dark]);

  return [dark, setDark] as const;
}
