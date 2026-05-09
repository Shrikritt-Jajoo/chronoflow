// =========================================================
// ChronoFlow Focus Mode
// Matches focus.html DOM exactly:
//   focusTimerDisplay, focusProgressFill, focusTaskSelect,
//   focusStartBtn, focusPauseBtn, focusResetBtn,
//   .focus-mode-btn[data-mode], postSessionOverlay,
//   [data-post="done|progress"], wakeLockBtn, wakeLockStatus
// =========================================================
const FocusMode = {
  active: false, paused: false,
  timerId: null, totalSeconds: 25 * 60, elapsedSeconds: 0,
  currentTaskId: null,
  _wakeLock: null,

  init() {
    this._els = {
      display:   document.getElementById('focusTimerDisplay'),
      fill:      document.getElementById('focusProgressFill'),
      select:    document.getElementById('focusTaskSelect'),
      startBtn:  document.getElementById('focusStartBtn'),
      pauseBtn:  document.getElementById('focusPauseBtn'),
      resetBtn:  document.getElementById('focusResetBtn'),
      overlay:   document.getElementById('postSessionOverlay'),
      modeBtns:  document.querySelectorAll('.focus-mode-btn'),
    };
    this._bindEvents();
    this._populateTasks();
    this._updateDisplay();
  },

  async _populateTasks() {
    await AppState.init();
    const tasks  = (AppState.get('tasks') || []).filter(t => !t.isCompleted);
    const select = this._els.select;
    if (!select) return;
    // Clear existing options except the placeholder
    while (select.options.length > 1) select.remove(1);
    tasks.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      select.appendChild(opt);
    });
    // Auto-select task from URL ?task=id
    const urlTask = new URLSearchParams(location.search).get('task');
    if (urlTask) select.value = urlTask;
  },

  _bindEvents() {
    this._els.startBtn?.addEventListener('click', () => this.start());
    this._els.pauseBtn?.addEventListener('click', () => this.togglePause());
    this._els.resetBtn?.addEventListener('click', () => this.reset());

    this._els.modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.active) return;
        this._els.modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const val = btn.dataset.mode;
        if (val === 'custom') {
          const mins = parseInt(prompt('Enter minutes:'), 10);
          if (mins > 0) { this.totalSeconds = mins * 60; }
          else return;
        } else {
          this.totalSeconds = parseInt(val, 10) * 60;
        }
        this.elapsedSeconds = 0;
        this._updateDisplay();
      });
    });

    // Post-session modal buttons
    this._els.overlay?.querySelectorAll('[data-post]').forEach(btn => {
      btn.addEventListener('click', () => this._handlePostSession(btn.dataset.post));
    });

    document.getElementById('wakeLockBtn')?.addEventListener('click', () => this._toggleWakeLock());
  },

  start() {
    if (this.active) return;
    this.currentTaskId = this._els.select?.value || null;
    this.active  = true;
    this.paused  = false;
    if (this._els.startBtn) this._els.startBtn.disabled = true;
    if (this._els.pauseBtn) this._els.pauseBtn.disabled = false;
    this.timerId = setInterval(() => this._tick(), 1000);
  },

  togglePause() {
    if (!this.active) return;
    if (!this.paused) {
      clearInterval(this.timerId); this.timerId = null;
      this.paused = true;
      if (this._els.pauseBtn) this._els.pauseBtn.textContent = 'Resume';
    } else {
      this.timerId = setInterval(() => this._tick(), 1000);
      this.paused  = false;
      if (this._els.pauseBtn) this._els.pauseBtn.textContent = 'Pause';
    }
  },

  reset() {
    clearInterval(this.timerId); this.timerId = null;
    this.active  = false;
    this.paused  = false;
    this.elapsedSeconds = 0;
    if (this._els.startBtn) { this._els.startBtn.disabled = false; }
    if (this._els.pauseBtn) { this._els.pauseBtn.disabled = true; this._els.pauseBtn.textContent = 'Pause'; }
    this._updateDisplay();
  },

  _tick() {
    this.elapsedSeconds++;
    this._updateDisplay();
    if (this.elapsedSeconds >= this.totalSeconds) {
      clearInterval(this.timerId); this.timerId = null;
      this.active = false;
      if (this._els.startBtn) this._els.startBtn.disabled = false;
      if (this._els.pauseBtn) { this._els.pauseBtn.disabled = true; this._els.pauseBtn.textContent = 'Pause'; }
      this._showPostModal();
    }
  },

  _updateDisplay() {
    const remaining = Math.max(0, this.totalSeconds - this.elapsedSeconds);
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    if (this._els.display)
      this._els.display.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    // Progress fill shrinks as time runs (starts full, empties)
    const pct = this.totalSeconds > 0 ? (remaining / this.totalSeconds) * 100 : 0;
    if (this._els.fill) this._els.fill.style.width = pct + '%';
  },

  _showPostModal() {
    if (this._els.overlay) this._els.overlay.style.display = 'flex';
  },

  async _handlePostSession(action) {
    if (this._els.overlay) this._els.overlay.style.display = 'none';
    const taskId = this.currentTaskId;
    const actualMinutes = Math.ceil(this.elapsedSeconds / 60) || 1;
    const now = new Date().toISOString();

    if (taskId) {
      const task = (AppState.get('tasks') || []).find(t => t.id === taskId);
      if (task) {
        const isCompleted   = action === 'done';
        const progressDelta = isCompleted ? Math.max(0, 100 - (task.progressPercent || 0)) : 0;
        await AppState.update('tasks', taskId, {
          isCompleted,
          progressPercent: isCompleted ? 100 : task.progressPercent,
          ...(isCompleted && !task.completedAt ? { completedAt: now } : {}),
          remainingMinutes: isCompleted ? 0 : Math.max(0,
            (task.remainingMinutes || task.estimatedMinutes || 0) - actualMinutes)
        });
        await AppState.add('focusSessions', {
          id: Utils.uid('session'),
          taskId,
          taskTitle: task.title,
          startTime: new Date(Date.now() - actualMinutes * 60000).toISOString(),
          endTime: now,
          plannedMinutes: Math.round(this.totalSeconds / 60),
          actualMinutes,
          progressDelta
        });
      }
    } else {
      // No task selected — still log a bare session
      await AppState.add('focusSessions', {
        id: Utils.uid('session'),
        taskId: null, taskTitle: 'Untracked session',
        startTime: new Date(Date.now() - actualMinutes * 60000).toISOString(),
        endTime: now,
        plannedMinutes: Math.round(this.totalSeconds / 60),
        actualMinutes, progressDelta: 0
      });
    }

    AppShell.toast(action === 'done' ? 'Task marked done!' : 'Progress saved!', 'success');
    this.elapsedSeconds = 0;
    this._updateDisplay();
  },

  async _toggleWakeLock() {
    const btn    = document.getElementById('wakeLockBtn');
    const status = document.getElementById('wakeLockStatus');
    if (this._wakeLock) {
      await this._wakeLock.release();
      this._wakeLock = null;
      if (btn)    btn.textContent    = 'Keep Screen On';
      if (status) status.textContent = '';
    } else {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        if (btn)    btn.textContent    = 'Screen Lock: ON';
        if (status) status.textContent = '\uD83D\uDD12 Active';
      } catch { AppShell.toast('Wake lock unavailable', 'warning'); }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => FocusMode.init());
