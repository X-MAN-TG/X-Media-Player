/**
 * theme.js — X Stream & Play
 * Dark / Light mode toggle with CSS variables, smooth transition,
 * and localStorage persistence. Default: dark.
 */

export function initTheme() {
  const toggle  = document.getElementById('themeToggle');
  const root    = document.documentElement;

  // Load saved preference or default to dark
  const saved = localStorage.getItem('xstream_theme') || 'dark';
  _applyTheme(saved);

  toggle.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    _applyTheme(next);
    localStorage.setItem('xstream_theme', next);
  });
}

function _applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
