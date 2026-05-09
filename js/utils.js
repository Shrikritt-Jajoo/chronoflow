// =========================================================
// ChronoFlow Utilities
// =========================================================
const Utils = {
  uid(prefix = 'item') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  },
  now() { return new Date(); },
  todayStart() {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  },
  todayEnd() {
    const d = new Date(); d.setHours(23, 59, 59, 999); return d;
  },
  formatTime(date) {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
  },
  formatDate(date) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  },
  formatDateShort(date) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  },
  formatDateTime(date) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  },
  formatDuration(minutes) {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  },
  hoursUntil(date) {
    if (!date) return Infinity;
    return (new Date(date).getTime() - Date.now()) / 3600000;
  },
  clamp(val, min, max) { return Math.max(min, Math.min(max, val)); },
  debounce(fn, ms = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },
  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  deepClone(obj) { return JSON.parse(JSON.stringify(obj)); },
  generateId() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`; }
};
