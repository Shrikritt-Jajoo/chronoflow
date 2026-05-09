// =========================================================
// ChronoFlow Settings Page
// Appearance, planning rules, Gmail, AI (job list +
// conversation drawer + version history), data management
// =========================================================
const Settings = {
  currentSection: 'appearance',
  _activeSession: null,
  _pendingResult: null,
  _approvedSteps: [],

  async init() {
    await AppState.init();
    this.renderAll();
    this.bindNavEvents();
    this._bindDrawer();
  },

  renderAll() {
    this.renderAppearance();
    this.renderPlanningRules();
    this.renderGmail();
    this.renderAI();
    this.renderData();
  },

  // ---- Appearance -------------------------------------------------------
  renderAppearance() {
    const el = document.getElementById('appearanceSettings');
    if (!el) return;
    const bg = Backgrounds.config;
    el.innerHTML = `
      <div class="form-group">
        <label>Background Style</label>
        <div class="seg-control">
          ${['orbital','eclipse','hybrid'].map(m => `
            <button class="seg-btn${bg.mode === m ? ' active' : ''}" data-bgmode="${m}">
              ${m.charAt(0).toUpperCase() + m.slice(1)}
            </button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Intensity <span id="intensityVal">${Math.round(bg.intensity * 100)}%</span></label>
        <input type="range" id="bgIntensity" min="0" max="100" value="${Math.round(bg.intensity * 100)}">
      </div>
      <div class="form-group">
        <label>Animation Speed <span id="speedVal">${Math.round(bg.speed * 100)}%</span></label>
        <input type="range" id="bgSpeed" min="0" max="100" value="${Math.round(bg.speed * 100)}">
      </div>
      <div class="toggle-row">
        <div><div class="toggle-label">Show grid lines</div></div>
        <input type="checkbox" id="bgGrid" ${bg.grid ? 'checked' : ''}>
      </div>`;
    el.querySelectorAll('[data-bgmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        Backgrounds.setMode(btn.dataset.bgmode);
        el.querySelectorAll('[data-bgmode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    el.querySelector('#bgIntensity').addEventListener('input', e => {
      Backgrounds.setIntensity(e.target.value / 100);
      el.querySelector('#intensityVal').textContent = e.target.value + '%';
    });
    el.querySelector('#bgSpeed').addEventListener('input', e => {
      Backgrounds.setSpeed(e.target.value / 100);
      el.querySelector('#speedVal').textContent = e.target.value + '%';
    });
    el.querySelector('#bgGrid').addEventListener('change', e => {
      Backgrounds.config.grid = e.target.checked;
      Backgrounds.saveConfig();
    });
  },

  // ---- Planning Rules ---------------------------------------------------
  renderPlanningRules() {
    const el = document.getElementById('planningSettings');
    if (!el) return;
    const s = AppState.get('settings') || {};
    el.innerHTML = `
      <div class="form-group">
        <label>Default task duration (minutes)</label>
        <input type="number" id="defaultDuration" value="${s.defaultDuration || 30}" min="5" max="240">
      </div>
      <div class="form-group">
        <label>Buffer between blocks (minutes)</label>
        <input type="number" id="bufferMinutes" value="${s.bufferMinutes || 10}" min="0" max="60">
      </div>
      <div class="toggle-row">
        <div>
          <div class="toggle-label">Auto-reschedule unfinished tasks</div>
          <div class="toggle-hint">Carry forward incomplete tasks to next day</div>
        </div>
        <input type="checkbox" id="autoReschedule" ${s.autoReschedule !== false ? 'checked' : ''}>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="savePlanningBtn">Save Rules</button>
      </div>`;
    el.querySelector('#savePlanningBtn').addEventListener('click', async () => {
      await DB.put('settings', {
        key: 'main',
        defaultDuration: parseInt(el.querySelector('#defaultDuration').value) || 30,
        bufferMinutes:   parseInt(el.querySelector('#bufferMinutes').value)   || 10,
        autoReschedule:  el.querySelector('#autoReschedule').checked
      });
      AppShell.toast('Planning rules saved', 'success');
    });
  },

  // ---- Gmail ------------------------------------------------------------
  renderGmail() {
    const el = document.getElementById('gmailSettings');
    if (!el) return;
    const cfg = AppState.get('gmailConfig') || {};
    el.innerHTML = `
      <p class="settings-hint">Gmail integration lets the app send your daily plan to yourself.
         OAuth requires running on localhost.</p>
      <div class="form-group">
        <label>Google OAuth Client ID</label>
        <input type="text" id="gmailClientId" value="${Utils.escapeHtml(cfg.clientId || '')}"
               placeholder="paste your client_id here">
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="saveGmailBtn">Save Client ID</button>
        <button class="btn btn-primary"   id="connectGmailBtn">Connect Gmail</button>
        <button class="btn btn-ghost"     id="testEmailBtn">Send Test</button>
      </div>`;
    el.querySelector('#saveGmailBtn').addEventListener('click', async () => {
      await DB.put('gmailConfig', { key: 'main', clientId: el.querySelector('#gmailClientId').value.trim() });
      AppShell.toast('Client ID saved', 'success');
    });
    el.querySelector('#connectGmailBtn').addEventListener('click', async () => {
      await GmailConnector.init();
      if (GmailConnector.tokenClient) GmailConnector.tokenClient.requestAccessToken();
      else AppShell.toast('Save a Client ID first', 'error');
    });
    el.querySelector('#testEmailBtn').addEventListener('click', () => GmailConnector.sendTestEmail());
  },

  // ---- AI ---------------------------------------------------------------
  renderAI() {
    const el = document.getElementById('aiSettings');
    if (!el) return;
    const cfg  = AppState.get('aiConfig') || {};
    const jobs = AppState.get('registeredAiJobs') || [];
    const hasKey    = !!(cfg.geminiKey);
    const serverMode = ChronoFlow.serverMode;
    el.innerHTML = `
      <p class="settings-hint">Your API key is stored locally and never sent anywhere except Google's servers.</p>
      <div class="form-group">
        <label>Gemini API Key</label>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <input type="password" id="aiKey" value="${Utils.escapeHtml(cfg.geminiKey || '')}"
                 placeholder="AIza…" style="flex:1">
          <button class="btn btn-primary" id="saveAiBtn">Save</button>
        </div>
      </div>
      <div class="form-group">
        <label>Model</label>
        <select id="aiModel">
          ${['gemini-2.0-flash','gemini-2.0-flash-lite','gemini-1.5-pro'].map(m =>
            `<option value="${m}" ${(cfg.model || 'gemini-2.0-flash') === m ? 'selected' : ''}>${m}</option>`
          ).join('')}
        </select>
      </div>
      <div class="panel-title" style="margin-top:2rem;margin-bottom:1rem">AI Jobs</div>
      ${!hasKey ? `<p class="settings-hint" style="color:var(--color-warning)">Save a Gemini API key above to enable AI jobs.</p>` : ''}
      <div class="ai-job-list" id="aiJobList">
        ${jobs.map(job => `
          <div class="ai-job-card" data-job-id="${Utils.escapeHtml(job.jobId)}">
            <div class="ai-job-info">
              <div class="ai-job-label">${Utils.escapeHtml(job.label)}</div>
              <div class="ai-job-meta">
                <span class="tag tag-cyan">${Utils.escapeHtml(job.trigger)}</span>
                <span class="tag">${Utils.escapeHtml(job.addedBy)}</span>
              </div>
            </div>
            <button class="btn btn-primary ai-job-run-btn" data-job-id="${Utils.escapeHtml(job.jobId)}"
                    ${!hasKey ? 'disabled' : ''}>Run</button>
          </div>`).join('') || '<p class="settings-hint">No jobs registered yet.</p>'}
      </div>
      <div class="panel-title" style="margin-top:2.5rem;margin-bottom:1rem">Version History
        ${!serverMode ? '<span class="tag" style="margin-left:0.5rem;opacity:0.5">server only</span>' : ''}
      </div>
      <div class="ai-versions-list" id="aiVersionsList">
        <p class="settings-hint" id="versionsLoading">Loading…</p>
      </div>`;
    el.querySelector('#saveAiBtn').addEventListener('click', async () => {
      const geminiKey = el.querySelector('#aiKey').value.trim();
      const model     = el.querySelector('#aiModel').value;
      await DB.put('aiConfig', { key: 'main', geminiKey, model });
      await AppState.set('aiConfig', { key: 'main', geminiKey, model });
      AppShell.toast('AI config saved', 'success');
      this.renderAI();
    });
    el.querySelector('#aiModel').addEventListener('change', async e => {
      const current = AppState.get('aiConfig') || {};
      const updated = { ...current, model: e.target.value };
      await DB.put('aiConfig', updated);
      await AppState.set('aiConfig', updated);
    });
    el.querySelectorAll('.ai-job-run-btn').forEach(btn => {
      btn.addEventListener('click', () => this._startJob(btn.dataset.jobId));
    });
    this._renderVersions();
  },

  async _renderVersions() {
    const el = document.getElementById('aiVersionsList');
    if (!el) return;
    if (!ChronoFlow.serverMode) {
      el.innerHTML = '<p class="settings-hint">Start the server to view version history.</p>';
      return;
    }
    try {
      const versions = await listVersions();
      if (!versions.length) {
        el.innerHTML = '<p class="settings-hint">No saved versions yet. Versions are created automatically before AI edits.</p>';
        return;
      }
      el.innerHTML = versions.map(v => `
        <div class="ai-version-row">
          <div class="ai-version-info">
            <div class="ai-version-name">${Utils.escapeHtml(v.name)}</div>
            <div class="ai-version-date">${new Date(v.savedAt).toLocaleString()}</div>
          </div>
          <button class="btn btn-ghost ai-version-restore" data-version="${Utils.escapeHtml(v.name)}">Restore</button>
        </div>`).join('');
      el.querySelectorAll('.ai-version-restore').forEach(btn => {
        btn.addEventListener('click', () => {
          AppShell.confirm(
            `Restore version "${btn.dataset.version}"? Current state will be saved first.`,
            async () => {
              await takeSnapshot('pre-restore-' + Date.now());
              const ok = await restoreVersion(btn.dataset.version);
              if (!ok) AppShell.toast('Restore failed', 'error');
            }
          );
        });
      });
    } catch {
      el.innerHTML = '<p class="settings-hint" style="color:var(--color-danger)">Could not load versions.</p>';
    }
  },

  // ---- Data -------------------------------------------------------------
  renderData() {
    const el = document.getElementById('dataSettings');
    if (!el) return;
    const mode = ChronoFlow.serverMode ? 'data.json (server)' : 'IndexedDB (browser)';
    el.innerHTML = `
      <p class="settings-hint">Data is stored in <strong>${mode}</strong>.</p>
      <div class="form-actions">
        <button class="btn btn-secondary" id="exportBtn">Export JSON</button>
        <button class="btn btn-danger"    id="clearBtn">Clear All Data</button>
      </div>`;
    el.querySelector('#exportBtn').addEventListener('click', async () => {
      const stores = ['tasks','slots','scheduleBlocks','focusSessions','settings'];
      const data   = {};
      for (const s of stores) data[s] = await DB.getAll(s);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: `chronoflow-${Date.now()}.json` });
      a.click(); URL.revokeObjectURL(url);
    });
    el.querySelector('#clearBtn').addEventListener('click', () => {
      AppShell.confirm('This will permanently delete ALL your data. Are you sure?', async () => {
        for (const s of ['tasks','slots','scheduleBlocks','focusSessions','settings','gmailConfig','aiConfig'])
          await DB.clear(s);
        await AppState.init();
        AppShell.toast('All data cleared', 'success');
      });
    });
  },

  // ---- Nav — Fix 2+6: use class toggling, no inline style.display ------
  bindNavEvents() {
    const items    = document.querySelectorAll('.settings-nav-item');
    const sections = document.querySelectorAll('.settings-section');
    items.forEach(btn => {
      btn.addEventListener('click', () => {
        items.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sections.forEach(s => {
          const isTarget = s.id === btn.dataset.section + 'Section';
          s.classList.toggle('hidden', !isTarget);
        });
      });
    });
  },

  // ================================================================
  // AI Conversation Drawer
  // ================================================================
  _bindDrawer() {
    document.getElementById('aiDrawerClose')?.addEventListener('click',    () => this._closeDrawer());
    document.getElementById('aiDrawerBackdrop')?.addEventListener('click', () => this._closeDrawer());
    document.getElementById('aiChatForm')?.addEventListener('submit', e => {
      e.preventDefault(); this._sendChat();
    });
    document.getElementById('aiPlanApprove')?.addEventListener('click', () => this._approvePlan());
    document.getElementById('aiPlanCancel')?.addEventListener('click',  () => this._cancelSession());
    document.getElementById('aiResultAccept')?.addEventListener('click', () => this._applyResult());
    document.getElementById('aiResultReject')?.addEventListener('click', () => this._rejectResult());
  },

  _openDrawer(title) {
    document.getElementById('aiDrawerTitle').textContent = title;
    document.getElementById('aiDrawer').setAttribute('aria-hidden', 'false');
    document.getElementById('aiDrawer').classList.add('open');
    document.getElementById('aiDrawerBackdrop').classList.add('visible');
    document.getElementById('aiDrawerMessages').innerHTML = '';
    document.getElementById('aiPlanPanel').style.display   = 'none';
    document.getElementById('aiResultPanel').style.display = 'none';
    document.getElementById('aiChatForm').style.display    = '';
    this._setPhaseLabel('Phase 1 — Understanding');
  },

  _closeDrawer() {
    document.getElementById('aiDrawer').setAttribute('aria-hidden', 'true');
    document.getElementById('aiDrawer').classList.remove('open');
    document.getElementById('aiDrawerBackdrop').classList.remove('visible');
    if (this._activeSession) { this._activeSession.end(); this._activeSession = null; }
  },

  _setPhaseLabel(text) {
    const el = document.getElementById('aiDrawerPhase');
    if (el) el.textContent = text;
  },

  _appendMessage(role, text) {
    const wrap = document.getElementById('aiDrawerMessages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = `ai-message ai-message-${role}`;
    div.textContent = text;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  },

  _appendThinking() {
    const wrap = document.getElementById('aiDrawerMessages');
    const div  = document.createElement('div');
    div.className = 'ai-message ai-message-model ai-thinking';
    div.id = 'aiThinking';
    div.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
    return div;
  },

  _removeThinking() { document.getElementById('aiThinking')?.remove(); },

  async _startJob(jobId) {
    const jobs = AppState.get('registeredAiJobs') || [];
    const job  = jobs.find(j => j.jobId === jobId);
    if (!job) return;
    this._openDrawer(job.label);
    this._appendMessage('system', `Starting "${job.label}"… Ask me anything or describe what you want.`);
    try {
      const session = await AI.startSession(jobId, {
        onPhaseChange: ({ phase, summary }) => {
          if (phase === 2) {
            this._setPhaseLabel('Phase 2 — Plan');
            if (summary) this._appendMessage('model', `✓ Understood: ${summary}`);
            // Fix 9: show transition message before hiding chat
            this._appendMessage('system', '✓ Ready to plan. Review the steps below.');
            this._showPlanUI();
          }
          if (phase === 3) this._setPhaseLabel('Phase 3 — Executing');
        },
        onError: err => {
          this._removeThinking();
          AppShell.toast('AI error: ' + err.message, 'error');
        }
      });
      this._activeSession = session;
    } catch { this._closeDrawer(); }
  },

  async _sendChat() {
    const input = document.getElementById('aiChatInput');
    const msg   = input?.value.trim();
    if (!msg || !this._activeSession) return;
    input.value = '';
    this._appendMessage('user', msg);
    const thinking = this._appendThinking();
    document.getElementById('aiSendBtn').disabled = true;
    try {
      const { text, phaseAdvanced } = await this._activeSession.chat(msg);
      this._removeThinking();
      if (!phaseAdvanced) this._appendMessage('model', text);
    } catch (e) {
      this._removeThinking();
      AppShell.toast('AI error: ' + e.message, 'error');
    } finally {
      document.getElementById('aiSendBtn').disabled = false;
      input.focus();
    }
  },

  async _showPlanUI() {
    document.getElementById('aiChatForm').style.display = 'none';
    document.getElementById('aiPlanPanel').style.display = '';
    const stepsEl = document.getElementById('aiPlanSteps');
    stepsEl.innerHTML = '<p class="settings-hint">Generating plan…</p>';
    try {
      const { steps } = await this._activeSession.getPlan();
      this._approvedSteps = [...steps];
      stepsEl.innerHTML = steps.map((s, i) => `
        <div class="ai-plan-step" data-index="${i}">
          <input type="checkbox" id="step-${i}" checked>
          <label for="step-${i}">${Utils.escapeHtml(s)}</label>
        </div>`).join('');
    } catch (e) {
      stepsEl.innerHTML = `<p class="settings-hint" style="color:var(--color-danger)">Could not generate plan: ${e.message}</p>`;
    }
  },

  async _approvePlan() {
    const checkboxes = document.querySelectorAll('#aiPlanSteps input[type=checkbox]');
    const steps = Array.from(checkboxes).filter(c => c.checked).map(c => c.nextElementSibling.textContent);
    if (!steps.length) { AppShell.toast('Select at least one step', 'error'); return; }
    document.getElementById('aiPlanPanel').style.display = 'none';
    this._appendMessage('system', `Plan approved with ${steps.length} step(s). Executing…`);
    await this._activeSession.approvePlan(steps);
    await this._executeNextStep();
  },

  async _executeNextStep() {
    this._appendThinking();
    try {
      const result = await this._activeSession.executeStep();
      this._removeThinking();
      if (!result || (!result.type && !result.plainEnglish)) {
        this._appendMessage('model', JSON.stringify(result));
        this._showSessionEndUI();
        return;
      }
      this._pendingResult = result;
      document.getElementById('aiResultDescription').textContent =
        result.plainEnglish || `Apply change of type: ${result.type}`;
      document.getElementById('aiResultPanel').style.display = '';
    } catch (e) {
      this._removeThinking();
      AppShell.toast('Execution error: ' + e.message, 'error');
      this._showSessionEndUI();
    }
  },

  async _applyResult() {
    const result = this._pendingResult;
    if (!result) return;
    document.getElementById('aiResultPanel').style.display = 'none';
    this._pendingResult = null;
    const ok = await AIJobRunner.apply(result);
    if (ok) {
      this._activeSession.markAccepted();
      this._appendMessage('system', `✓ Applied: ${result.plainEnglish || result.type}`);
    } else {
      this._appendMessage('system', '✗ Could not apply this change.');
    }
    await this._executeNextStep();
  },

  async _rejectResult() {
    document.getElementById('aiResultPanel').style.display = 'none';
    this._appendMessage('system', 'Skipped.');
    this._pendingResult = null;
    await this._executeNextStep();
  },

  async _cancelSession() {
    document.getElementById('aiPlanPanel').style.display   = 'none';
    document.getElementById('aiResultPanel').style.display = 'none';
    document.getElementById('aiChatForm').style.display    = '';
    if (this._activeSession) { await this._activeSession.end(); this._activeSession = null; }
    this._appendMessage('system', 'Session cancelled. No changes were made.');
  },

  _showSessionEndUI() {
    document.getElementById('aiChatForm').style.display = 'none';
    const wrap = document.getElementById('aiDrawerMessages');
    const div  = document.createElement('div');
    div.className = 'ai-message ai-message-system';
    div.innerHTML = `Session complete. <button class="btn btn-ghost" id="aiSessionDoneBtn" style="margin-left:0.5rem">Close</button>`;
    wrap.appendChild(div);
    document.getElementById('aiSessionDoneBtn')?.addEventListener('click', () => this._closeDrawer());
    if (this._activeSession) { this._activeSession.end(); this._activeSession = null; }
  }
};
