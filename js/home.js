// =========================================================
// ChronoFlow Home Page
// Clock tick, metrics, nav auto-hide
// =========================================================
(function () {
  // Fix 2: use correct IDs from index.html
  const timeEl  = document.getElementById('clockTime');
  const dateEl  = document.getElementById('clockDate');
  const greetEl = document.getElementById('clockGreeting');

  function updateClock() {
    const now = new Date();
    if (timeEl)  timeEl.textContent  = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
    if (dateEl)  dateEl.textContent  = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    if (greetEl) {
      const h = now.getHours();
      greetEl.textContent = h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  // Metrics from AppState
  async function updateMetrics() {
    try {
      await AppState.init();
      const tasks = AppState.get('tasks') || [];
      const slots = AppState.get('slots') || [];
      const pending = tasks.filter(t => !t.isCompleted);
      const minutes = pending.reduce((s, t) => s + (t.remainingMinutes || t.estimatedMinutes || 0), 0);
      const el = id => document.getElementById(id);
      if (el('pendingCount'))   el('pendingCount').textContent   = String(pending.length);
      if (el('plannedMinutes')) el('plannedMinutes').textContent = String(minutes);
      // Fix 4: filter to future slots only before picking the next one
      const now2 = Date.now();
      const next = slots
        .filter(s => new Date(s.start).getTime() > now2)
        .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
      if (el('nextBlock')) el('nextBlock').textContent = next
        ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(next.start)) + ' • ' + next.label
        : 'None yet';
    } catch (e) { console.warn('Metrics unavailable', e); }
  }
  updateMetrics();

  // Fix 3: remove .visible from HTML — add it here after delay for entrance animation
  const actionsEl = document.querySelector('.home-actions');
  if (actionsEl) actionsEl.classList.remove('visible');
  setTimeout(() => {
    actionsEl?.classList.add('visible');
  }, 800);
})();
