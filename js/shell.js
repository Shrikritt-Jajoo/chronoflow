// =========================================================
// ChronoFlow Shell Bootstrap
// app-shell.js defines AppShell; this file just initialises it.
// FATAL-4 fix: AppShell.init() was never called on any page.
// LOW-2  fix: removed duplicate inline AppShell copy.
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  if (typeof AppShell !== 'undefined') {
    AppShell.init();
  } else {
    console.error('[ChronoFlow] AppShell not defined — ensure app-shell.js loads before shell.js');
  }
});
