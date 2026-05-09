// =========================================================
// ChronoFlow Focus Mode — Timer, progress, wake lock
// =========================================================
const FocusMode = {
  active: false,
  timerId: null,
  startTime: null,
  plannedMinutes: 25,
  currentTaskId: null,
  elapsedSeconds: 0,

  async start(taskId) {
    // Fix 8: guard against double-start
    if (this.active) {
      AppShell.toast('A focus session is already running', 'warning');
      return;
    }
    const task = AppState.get('tasks').find(t => t.id === taskId);
    if (!task) { AppShell.toast('Task not found', 'error'); return; }
    this.currentTaskId  = taskId;
    this.plannedMinutes = task.remainingMinutes || 25;
    this.elapsedSeconds = 0;
    this.active         = true;
    this.startTime      = Date.now();
    const overlay = document.getElementById('focusOverlay');
    if (overlay) overlay.classList.add('active');
    this.renderFocusUI(task);
    this.startTimer();
  },

  renderFocusUI(task) {
    const titleEl    = document.getElementById('focusTaskTitle');
    const progressEl = document.getElementById('focusProgressBar');
    const nextStepEl = document.getElementById('focusNextStep');
    if (titleEl)    titleEl.textContent    = task.title;
    if (nextStepEl) nextStepEl.textContent = task.nextStep || 'Focus on this task';
    if (progressEl) {
      const fill = progressEl.querySelector('.progress-fill');
      if (fill) fill.style.width = (task.progressPercent || 0) + '%';
    }
    // Fix 8: wire up abandon button
    const abandonBtn = document.getElementById('focusAbandonBtn');
    if (abandonBtn) {
      abandonBtn.onclick = () => {
        AppShell.confirm('Abandon this session? Your time will still be logged.', () => this.end());
      };
    }
    this.updateTimerDisplay();
  },

  startTimer() {
    this.timerId = setInterval(() => { this.elapsedSeconds++; this.updateTimerDisplay(); }, 1000);
  },

  updateTimerDisplay() {
    const timerEl = document.getElementById('focusTimer');
    if (!timerEl) return;
    const remaining = Math.max(0, this.plannedMinutes * 60 - this.elapsedSeconds);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    timerEl.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  },

  pause()  { if (this.timerId) { clearInterval(this.timerId); this.timerId = null; } },
  resume() { if (this.active && !this.timerId) this.startTimer(); },

  async end() {
    this.pause();
    this.active = false;
    const overlay = document.getElementById('focusOverlay');
    if (overlay) overlay.classList.remove('active');
    const task = AppState.get('tasks').find(t => t.id === this.currentTaskId);
    if (!task) return;
    this.showProgressPrompt(task, Math.ceil(this.elapsedSeconds / 60));
  },

  showProgressPrompt(task, actualMinutes) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    const currentPct = task.progressPercent || 0;
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span class="panel-title">Session Complete</span></div>
        <div class="modal-body">
          <p style="margin-bottom:1rem;font-weight:600">${Utils.escapeHtml(task.title)}</p>
          <p style="margin-bottom:1.5rem;color:var(--color-text-muted)">You worked for <strong>${actualMinutes} min</strong>. How much of this task is now complete?</p>
          <div class="form-group">
            <label>Progress (${currentPct}% &rarr; ?%)</label>
            <input type="range" id="progressSlider"
                   min="${currentPct}" max="100" value="${currentPct}"
                   style="width:100%">
            <div style="text-align:center;margin-top:.5rem;color:var(--color-accent-cyan)" id="progressValue">${currentPct}%</div>
          </div>
          <div class="form-group">
            <label>Next step (optional)</label>
            <input type="text" id="nextStepInput" value="${Utils.escapeHtml(task.nextStep || '')}" placeholder="What's left to do?">
          </div>
        </div>
        <div class="modal-footer">
          <!-- Fix 4: skip still logs the session, rename for clarity -->
          <button class="btn btn-ghost" id="skipProgress">Skip Progress Update</button>
          <button class="btn btn-primary" id="saveProgress">Save Progress</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const slider  = modal.querySelector('#progressSlider');
    const display = modal.querySelector('#progressValue');
    slider.addEventListener('input', () => { display.textContent = slider.value + '%'; });

    const saveSession = async (pct, nextStep) => {
      // Fix 10: clamp delta ≥ 0
      const progressDelta = Math.max(0, pct - currentPct);
      const isCompleted   = pct >= 100;
      const now           = new Date().toISOString();
      await AppState.update('tasks', task.id, {
        progressPercent: pct,
        isCompleted,
        // Fix 7: write completedAt only when crossing 100%
        ...(isCompleted && !task.completedAt ? { completedAt: now } : {}),
        nextStep,
        remainingMinutes: Math.max(0, Math.ceil((task.estimatedMinutes || 30) * (1 - pct / 100)))
      });
      // Fix 3: use AppState.add so in-memory cache stays current
      await AppState.add('focusSessions', {
        id: Utils.uid('session'),
        taskId: task.id,
        taskTitle: task.title,
        startTime: new Date(Date.now() - this.elapsedSeconds * 1000).toISOString(),
        endTime: now,
        plannedMinutes: this.plannedMinutes,
        actualMinutes,
        progressDelta
      });
    };

    modal.querySelector('#saveProgress').addEventListener('click', async () => {
      const pct     = parseInt(slider.value);
      const nextStep = modal.querySelector('#nextStepInput').value.trim();
      await saveSession(pct, nextStep);
      AppShell.toast('Progress saved!', 'success');
      modal.remove();
    });

    // Fix 4: skip still saves a session with delta=0 and current pct unchanged
    modal.querySelector('#skipProgress').addEventListener('click', async () => {
      await saveSession(currentPct, task.nextStep || '');
      modal.remove();
    });

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }
};
