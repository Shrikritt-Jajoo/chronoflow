// =========================================================
// ChronoFlow Home Page
// Clock tick, metrics, entrance animation
// HIGH-7 fix: all DOM access and AppState reads moved inside
// DOMContentLoaded so they never race with AppShell.init().
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
  // ---- Clock -----------------------------------------------------------
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

  // ---- Entrance animation ----------------------------------------------
  const actionsEl = document.querySelector('.home-actions');
  if (actionsEl) actionsEl.classList.remove('visible');
  setTimeout(() => actionsEl?.classList.add('visible'), 800);

  // ---- Metrics ---------------------------------------------------------
  // HIGH-7 fix: await AppState.init() here, after DOMContentLoaded, so
  // IDB is fully loaded before we read tasks/slots. AppShell.init() is
  // also triggered by DOMContentLoaded in shell.js — both listeners run
  // in registration order, so shell runs first (registered earlier by
  // the script tag order), then this block runs. Either way, AppState
  // is not touched until the DOM is ready.
  try {
    await AppState.init();
    const tasks   = AppState.get('tasks') || [];
    const slots   = AppState.get('slots') || [];
    const pending = tasks.filter(t => !t.isCompleted);
    const minutes = pending.reduce((s, t) => s + (t.remainingMinutes || t.estimatedMinutes || 0), 0);

    const _el = id => document.getElementById(id);
    if (_el('pendingCount'))   _el('pendingCount').textContent   = String(pending.length);
    if (_el('plannedMinutes')) _el('plannedMinutes').textContent = String(minutes);

    const now2 = Date.now();
    const next = slots
      .filter(s => new Date(s.start).getTime() > now2)
      .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
    if (_el('nextBlock')) _el('nextBlock').textContent = next
      ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(next.start)) + ' • ' + next.label
      : 'None yet';
  } catch (e) {
    console.warn('[ChronoFlow] Home metrics unavailable:', e);
  }
});
