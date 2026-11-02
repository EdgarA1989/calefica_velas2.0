(function () {
  'use strict';
  const key = 'calefica-theme';
  const root = document.documentElement;
  let theme = 'light', animating = false;
  try { if (localStorage.getItem(key) === 'dark') theme = 'dark'; } catch { /* Preferencia solo en memoria si Storage no está disponible. */ }
  function apply(value) {
    theme = value === 'dark' ? 'dark' : 'light';
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
      button.title = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    });
  }
  apply(theme);
  document.addEventListener('DOMContentLoaded', () => {
    // Mismo dibujo CSS y estructura de la vela de index.html.
    const candles = `<span class="theme-candles" aria-hidden="true">
      <span class="theme-candle theme-candle--big"><span class="theme-wick"></span>
        <span class="theme-eyes"><span></span><span></span></span><span class="theme-mouth"></span>
        <span class="theme-smoke theme-smoke--one"></span><span class="theme-smoke theme-smoke--two"></span>
      </span><span class="theme-candle theme-candle--small"><span class="theme-light-wave"></span>
        <span class="theme-flame"></span><span class="theme-wick"></span>
        <span class="theme-eyes"><span></span><span></span></span>
      </span></span>`;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.innerHTML = candles;
      button.addEventListener('click', () => {
        if (animating) return;
        animating = true;
        const next = theme === 'dark' ? 'light' : 'dark';
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const animation = next === 'dark' ? 'is-blowing' : 'is-lighting';
        if (!reduced) button.classList.add(animation);
        window.setTimeout(() => {
          apply(next);
          try { localStorage.setItem(key, next); } catch { /* El cambio de tema sigue funcionando. */ }
        }, reduced ? 0 : next === 'dark' ? 650 : 120);
        window.setTimeout(() => { button.classList.remove(animation); animating = false; }, reduced ? 0 : 1050);
      });
    });
    apply(theme);
  });
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(event.newValue); });
})();
