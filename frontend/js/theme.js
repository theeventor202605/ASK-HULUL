/**
 * HULUL - theme preference (Settings > Appearance). Mirrors the existing `lang` pattern in
 * state.js/i18n.js exactly: stored in localStorage only (per-browser, not synced server-side),
 * applied via a data-theme attribute on <html> that css/styles.css keys its theme override
 * blocks off of.
 */
window.HULUL_THEMES = [
  { id: 'indigo', name: 'Indigo', swatch: '#4f46e5' },
  { id: 'ocean', name: 'Ocean', swatch: '#2563eb' },
  { id: 'emerald', name: 'Emerald', swatch: '#059669' },
  { id: 'sunset', name: 'Sunset', swatch: '#ea580c' },
  { id: 'light', name: 'Light', swatch: '#0d9488' }
];

function setTheme(themeId) {
  if (!window.HULUL_THEMES.some(function (th) { return th.id === themeId; })) themeId = 'light';
  HululState.theme = themeId;
  localStorage.setItem('hulul_theme', themeId);
  document.documentElement.setAttribute('data-theme', themeId);
}
