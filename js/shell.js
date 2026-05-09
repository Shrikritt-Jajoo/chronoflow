// =========================================================
// ChronoFlow shell.js — compatibility shim
// All HTML pages load js/shell.js; this file re-exports
// everything from app-shell.js so renaming is unnecessary.
// app-shell.js must be loaded before this file OR this file
// can stand alone — it contains the full AppShell impl.
// =========================================================

// If app-shell.js was already loaded, AppShell is defined — done.
// Otherwise define it inline (copy of app-shell.js) so pages
// that only load shell.js still work.
if (typeof AppShell === 'undefined') {
  const AppShell = {
    navTimeout: null,
    navVisible: true,

    init() {
      this.initTheme();
      this.initNav();
      this.initLogo();
    },

    initTheme() {
      const root = document.documentElement;
      const saved = localStorage.getItem('chronoflow-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = saved || (prefersDark ? 'dark' : 'light');
      root.setAttribute('data-theme', theme);
      this.updateThemeIcon(theme);
    },

    toggleTheme() {
      const root = document.documentElement;
      const current = root.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('chronoflow-theme', next);
      this.updateThemeIcon(next);
    },

    updateThemeIcon(theme) {
      const btn = document.querySelector('[data-theme-toggle]');
      if (!btn) return;
      btn.innerHTML = theme === 'dark'
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    },

    initNav() {
      const nav = document.querySelector('.nav-shell');
      if (!nav) return;
      const isHome = document.body.classList.contains('home-body') ||
                     document.body.dataset.page === 'home';
      if (!isHome) {
        nav.classList.remove('hidden');
        return;
      }
      this.showNav();
      document.addEventListener('mousemove',  () => this.showNav());
      document.addEventListener('keydown',    () => this.showNav());
      document.addEventListener('touchstart', () => this.showNav(), { passive: true });
      document.addEventListener('scroll',     () => this.showNav(), { passive: true });
    },

    showNav() {
      const nav = document.querySelector('.nav-shell');
      if (!nav) return;
      nav.classList.remove('hidden');
      this.navVisible = true;
      clearTimeout(this.navTimeout);
      const isHome = document.body.classList.contains('home-body') ||
                     document.body.dataset.page === 'home';
      if (!isHome) return;
      this.navTimeout = setTimeout(() => {
        nav.classList.add('hidden');
        this.navVisible = false;
      }, 3000);
    },

    initLogo() {
      const logos = document.querySelectorAll('.nav-logo svg');
      logos.forEach((svg, idx) => {
        const gid = `logoGrad-${idx}-${Math.random().toString(36).slice(2, 7)}`;
        svg.innerHTML = `
          <defs>
            <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#74f0d3"/>
              <stop offset="100%" stop-color="#8ca6ff"/>
            </linearGradient>
          </defs>
          <circle cx="18" cy="18" r="14" fill="none" stroke="url(#${gid})" stroke-width="2"/>
          <circle cx="18" cy="18" r="3" fill="url(#${gid})"/>
          <line x1="18" y1="18" x2="24" y2="12" stroke="url(#${gid})" stroke-width="2" stroke-linecap="round"/>
          <line x1="18" y1="18" x2="18" y2="10" stroke="url(#${gid})" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>`;
      });
    },

    toast(message, type = 'info', duration = 3000) {
      let container = document.querySelector('.toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
      }
      const icons = { info: '&#8505;', success: '&#10003;', error: '&#10007;', warning: '&#9888;' };
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${Utils.escapeHtml(message)}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 350);
      }, duration);
    },

    confirm(message, onConfirm) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header"><span class="panel-title">Confirm</span></div>
          <div class="modal-body"><p>${Utils.escapeHtml(message)}</p></div>
          <div class="modal-footer">
            <button class="btn btn-ghost" id="cfCancel">Cancel</button>
            <button class="btn btn-danger" id="cfOk">Confirm</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#cfOk').addEventListener('click', () => { onConfirm(); overlay.remove(); });
      overlay.querySelector('#cfCancel').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    }
  };

  // Make globally available
  window.AppShell = AppShell;
}
