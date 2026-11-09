// The application shell owns one subscription for a saved system-theme preference.
let systemThemeMedia = null;
let systemThemeListener = null;

export function applyThemePreference(theme) {
  if (systemThemeListener) systemThemeMedia.removeEventListener('change', systemThemeListener);
  systemThemeMedia = null;
  systemThemeListener = null;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  document.documentElement.setAttribute('data-theme', theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);
  if (theme === 'system') {
    systemThemeMedia = media;
    systemThemeListener = event => document.documentElement.setAttribute('data-theme', event.matches ? 'dark' : 'light');
    media.addEventListener('change', systemThemeListener);
  }
}
