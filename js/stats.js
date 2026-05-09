// =========================================================
// ChronoFlow Stats Page
// KPI cards, weekly focus chart, Energy Insight (Phase 9)
// =========================================================

const ENERGY_BUCKETS = [
  { label: '6–9 AM',   start:  6, end:  9 },
  { label: '9–12 PM',  start:  9, end: 12 },
  { label: '12–3 PM',  start: 12, end: 15 },
  { label: '3–6 PM',   start: 15, end: 18 },
  { label: '6–9 PM',   start: 18, end: 21 },
  { label: '9 PM+',    start: 21, end: 27 },
];

const Stats = {

  async init() {
    await AppState.init();
    this.renderKPIs();
    this.renderWeeklyChart();
    this.renderEnergyInsight();
    this.renderRecentSessions();
  },

  // ---- KPI cards -------------------------------------------------------
  renderKPIs() {
    const today    = new Date().toISOString().split('T')[0];
    const tasks    = AppState.get('tasks') || [];
    const sessions = AppState.get('focusSessions') || [];

    // Fix 7: use completedAt instead of updatedAt
    const tasksDone = tasks.filter(t =>
      t.isCompleted && t.completedAt && t.completedAt.startsWith(today)
    ).length;

    const focusToday = sessions
      .filter(s => s.startTime && s.startTime.startsWith(today))
      .reduce((sum, s) => sum + (s.actualMinutes || 0), 0);

    const total     = tasks.length;
    const completed = tasks.filter(t => t.isCompleted).length;
    const rate      = total > 0 ? Math.round((completed / total) * 100) : 0;

    const streak = this._calcStreak(sessions);

    _set('statTasksDone',  tasksDone);
    _set('statFocusTime',  focusToday);
    _set('statStreak',     streak);
    _set('statCompletion', rate + '%');
  },

  // Fix 6: streak — don't penalise if no session yet today
  _calcStreak(sessions) {
    if (!sessions.length) return 0;
    const days = new Set(
      sessions.filter(s => s.startTime).map(s => s.startTime.split('T')[0])
    );
    const today = new Date().toISOString().split('T')[0];
    let streak = 0;
    let d = new Date();
    // If today has no session yet, start counting from yesterday
    if (!days.has(today)) d.setDate(d.getDate() - 1);
    while (true) {
      const key = d.toISOString().split('T')[0];
      if (days.has(key)) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  },

  // ---- Weekly focus bar chart ------------------------------------------
  renderWeeklyChart() {
    const el = document.getElementById('weeklyChart');
    if (!el) return;
    const sessions = AppState.get('focusSessions') || [];
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    const minutesByDay = days.map(day =>
      sessions.filter(s => s.startTime && s.startTime.startsWith(day))
               .reduce((sum, s) => sum + (s.actualMinutes || 0), 0)
    );
    const max = Math.max(...minutesByDay, 1);
    const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    el.innerHTML = minutesByDay.map((mins, i) => {
      const date    = new Date(days[i] + 'T12:00:00');
      const dayName = DAY_LABELS[date.getDay()];
      const pct     = Math.round((mins / max) * 100);
      const isToday = days[i] === new Date().toISOString().split('T')[0];
      return `
        <div class="weekly-col">
          <div class="weekly-bar-wrap">
            <div class="weekly-bar${isToday ? ' weekly-bar--today' : ''}"
                 style="height:${pct}%" title="${mins} min"></div>
          </div>
          <div class="weekly-label">${dayName}</div>
          <div class="weekly-value">${mins || '–'}</div>
        </div>`;
    }).join('');
  },

  // ---- Energy Insight (Phase 9) ----------------------------------------
  renderEnergyInsight() {
    const sessions = AppState.get('focusSessions') || [];
    const chartEl  = document.getElementById('energyChart');
    const sentEl   = document.getElementById('energySentence');
    const hintEl   = document.getElementById('energyInsightHint');
    if (!chartEl || !sentEl) return;

    const bucketData = ENERGY_BUCKETS.map(() => ({ totalDelta: 0, count: 0 }));
    for (const session of sessions) {
      if (!session.startTime) continue;
      const hour         = new Date(session.startTime).getHours();
      const adjustedHour = hour < 6 ? hour + 24 : hour;
      for (let i = 0; i < ENERGY_BUCKETS.length; i++) {
        const { start, end } = ENERGY_BUCKETS[i];
        if (adjustedHour >= start && adjustedHour < end) {
          bucketData[i].totalDelta += (session.progressDelta || 0);
          bucketData[i].count++;
          break;
        }
      }
    }

    const averages      = bucketData.map(b => b.count > 0 ? Math.round(b.totalDelta / b.count) : 0);
    const totalSessions = bucketData.reduce((s, b) => s + b.count, 0);

    if (totalSessions === 0) {
      chartEl.innerHTML  = '<p class="empty-state">No session data yet. Complete some focus sessions to see your energy pattern.</p>';
      sentEl.textContent = '';
      if (hintEl) hintEl.textContent = 'based on all focus sessions';
      return;
    }

    const peakIdx   = averages.indexOf(Math.max(...averages));
    const peakLabel = ENERGY_BUCKETS[peakIdx].label;
    const peakAvg   = averages[peakIdx];
    const maxAvg    = Math.max(...averages, 1);
    if (hintEl) hintEl.textContent = `based on ${totalSessions} session${totalSessions !== 1 ? 's' : ''}`;

    chartEl.innerHTML = ENERGY_BUCKETS.map((bucket, i) => {
      const avg    = averages[i];
      const count  = bucketData[i].count;
      const pct    = Math.round((avg / maxAvg) * 100);
      const isPeak = i === peakIdx;
      const tip    = count > 0 ? `Avg progress: ${avg}% over ${count} session${count !== 1 ? 's' : ''}` : 'No sessions';
      return `
        <div class="energy-col">
          <div class="energy-avg-label">${avg > 0 ? avg + '%' : ''}</div>
          <div class="energy-bar-wrap">
            <div class="energy-bar${isPeak ? ' energy-bar--peak' : ''}"
                 style="height:${pct || 2}%" title="${tip}"
                 role="img" aria-label="${bucket.label}: ${tip}"></div>
          </div>
          <div class="energy-label">${bucket.label}</div>
          <div class="energy-count">${count > 0 ? count + ' session' + (count !== 1 ? 's' : '') : '–'}</div>
        </div>`;
    }).join('');

    const adjective = peakAvg >= 60 ? 'excellent' :
                      peakAvg >= 40 ? 'strong' :
                      peakAvg >= 20 ? 'moderate' : 'low';
    sentEl.textContent =
      `⚡ Your peak performance window is ${peakLabel} — ` +
      `you make ${adjective} progress during this time (avg ${peakAvg}% per session). ` +
      _peakTip(peakIdx);
  },

  // ---- Recent sessions -------------------------------------------------
  renderRecentSessions() {
    const el = document.getElementById('recentSessions');
    if (!el) return;
    const sessions = (AppState.get('focusSessions') || [])
      .slice().sort((a, b) => new Date(b.startTime) - new Date(a.startTime)).slice(0, 10);
    if (!sessions.length) {
      el.innerHTML = '<div class="empty-state">No focus sessions recorded yet.</div>';
      return;
    }
    el.innerHTML = sessions.map(s => {
      const date  = s.startTime ? new Date(s.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
      const time  = s.startTime ? new Date(s.startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
      const delta = s.progressDelta != null ? `+${s.progressDelta}%` : '';
      return `
        <div class="session-row">
          <div class="session-title">${Utils.escapeHtml(s.taskTitle || 'Untitled')}</div>
          <div class="session-meta">
            <span>${date} ${time}</span>
            <span>${s.actualMinutes || 0} min</span>
            ${delta ? `<span class="tag tag-cyan">${delta}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }
};

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _peakTip(idx) {
  const tips = [
    'Schedule your hardest tasks before 9 AM while your mind is fresh.',
    'Late-morning focus is powerful — block 9–12 for deep work.',
    'Post-lunch can work for you — avoid meetings in this window.',
    'Your mid-afternoon window is productive — protect it from distractions.',
    'Evening sessions suit you — wind down after 9 PM to protect sleep.',
    'You're a night owl — protect your sleep buffer after intense late sessions.',
  ];
  return tips[idx] ?? '';
}
