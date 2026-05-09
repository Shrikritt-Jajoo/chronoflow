// =========================================================
// ChronoFlow Settings Page
// Appearance, planning rules, Gmail, AI, data management
// =========================================================
const Settings = {
  currentSection: 'appearance',

  async init() {
    await AppState.init();
    this.renderAll();
    this.bindNavEvents();
  },

  renderAll() {
    this.renderAppearance();
    this.renderPlanningRules();
    this.renderGmail();
    this.renderAI();
    this.renderData();
  },

  renderAppearance() {
    const el = document.getElementById('appearanceSettings');
    if (!el) return;
    const bg = Backgrounds.config;
    el.innerHTML = `
      <div class="form-group">
        <label>Background Style</label>
        <div class="seg-control">
          ${['orbital','eclipse','hybrid'].map(m=>`<button class="seg-btn${bg.mode===m?' active':''}" data-bgmode="${m}">${m.charAt(0).toUpperCase()+m.slice(1)}</button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Intensity <span id="intensityVal">${Math.round(bg.intensity*100)}%</span></label>
        <input type="range" id="bgIntensity" min="0" max="100" value="${Math.round(bg.intensity*100)}">
      </div>
      <div class="form-group">
        <label>Animation Speed <span id="speedVal">${Math.round(bg.speed*100)}%</span></label>
        <input type="range" id="bgSpeed" min="0" max="100" value="${Math.round(bg.speed*100)}">
      </div>
      <div class="toggle-row">
        <div><div class="toggle-label">Show grid lines</div></div>
        <input type="checkbox" id="bgGrid" ${bg.grid?'checked':''}>
      </div>`;

    el.querySelectorAll('[data-bgmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        Backgrounds.setMode(btn.dataset.bgmode);
        el.querySelectorAll('[data-bgmode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    el.querySelector('#bgIntensity').addEventListener('input', e => {
      const v = e.target.value / 100;
      Backgrounds.setIntensity(v);
      el.querySelector('#intensityVal').textContent = e.target.value + '%';
    });
    el.querySelector('#bgSpeed').addEventListener('input', e => {
      const v = e.target.value / 100;
      Backgrounds.setSpeed(v);
      el.querySelector('#speedVal').textContent = e.target.value + '%';
    });
    el.querySelector('#bgGrid').addEventListener('change', e => {
      Backgrounds.config.grid = e.target.checked;
      Backgrounds.saveConfig();
    });
  },

  renderPlanningRules() {
    const el = document.getElementById('planningSettings');
    if (!el) return;
    const s = AppState.get('settings') || {};
    el.innerHTML = `
      <div class="form-group">
        <label>Default task duration (minutes)</label>
        <input type="number" id="defaultDuration" value="${s.defaultDuration||30}" min="5" max="240">
      </div>
      <div class="form-group">
        <label>Buffer between blocks (minutes)</label>
        <input type="number" id="bufferMinutes" value="${s.bufferMinutes||10}" min="0" max="60">
      </div>
      <div class="toggle-row">
        <div><div class="toggle-label">Auto-reschedule unfinished tasks</div><div class="toggle-hint">Carry forward incomplete tasks to next day</div></div>
        <input type="checkbox" id="autoReschedule" ${s.autoReschedule!==false?'checked':''}>
      </div>
      <div class="form-actions"><button class="btn btn-primary" id="savePlanningBtn">Save Rules</button></div>`;
    el.querySelector('#savePlanningBtn').addEventListener('click', async () => {
      await DB.put('settings', {
        key: 'main',
        defaultDuration: parseInt(el.querySelector('#defaultDuration').value)||30,
        bufferMinutes: parseInt(el.querySelector('#bufferMinutes').value)||10,
        autoReschedule: el.querySelector('#autoReschedule').checked
      });
      AppShell.toast('Planning rules saved', 'success');
    });
  },

  renderGmail() {
    const el = document.getElementById('gmailSettings');
    if (!el) return;
    const cfg = AppState.get('gmailConfig') || {};
    el.innerHTML = `
      <p style="color:var(--color-text-muted);font-size:var(--text-sm);margin-bottom:1.5rem">Gmail integration lets the app send your daily plan to yourself. OAuth requires running on localhost.</p>
      <div class="form-group">
        <label>Google OAuth Client ID</label>
        <input type="text" id="gmailClientId" value="${Utils.escapeHtml(cfg.clientId||'')}" placeholder="paste your client_id here">
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="saveGmailBtn">Save Client ID</button>
        <button class="btn btn-primary" id="connectGmailBtn">Connect Gmail</button>
        <button class="btn btn-ghost" id="testEmailBtn">Send Test</button>
      </div>`;
    el.querySelector('#saveGmailBtn').addEventListener('click', async () => {
      const clientId = el.querySelector('#gmailClientId').value.trim();
      await DB.put('gmailConfig', { key: 'main', clientId });
      AppShell.toast('Client ID saved', 'success');
    });
    el.querySelector('#connectGmailBtn').addEventListener('click', async () => {
      await GmailConnector.init();
      if (GmailConnector.tokenClient) GmailConnector.tokenClient.requestAccessToken();
      else AppShell.toast('Save a Client ID first', 'error');
    });
    el.querySelector('#testEmailBtn').addEventListener('click', () => GmailConnector.sendTestEmail());
  },

  renderAI() {
    const el = document.getElementById('aiSettings');
    if (!el) return;
    const cfg = AppState.get('aiConfig') || {};
    el.innerHTML = `
      <p style="color:var(--color-text-muted);font-size:var(--text-sm);margin-bottom:1.5rem">AI features are optional. Your API key is stored locally in the browser only.</p>
      <div class="form-group">
        <label>Gemini API Key</label>
        <input type="password" id="aiKey" value="${Utils.escapeHtml(cfg.geminiKey||'')}" placeholder="AIza...">
      </div>
      <div class="form-actions"><button class="btn btn-primary" id="saveAiBtn">Save Key</button></div>`;
    el.querySelector('#saveAiBtn').addEventListener('click', async () => {
      const geminiKey = el.querySelector('#aiKey').value.trim();
      await DB.put('aiConfig', { key: 'main', geminiKey });
      AppShell.toast('API key saved', 'success');
    });
  },

  renderData() {
    const el = document.getElementById('dataSettings');
    if (!el) return;
    el.innerHTML = `
      <p style="color:var(--color-text-muted);font-size:var(--text-sm);margin-bottom:1.5rem">All data is stored locally in IndexedDB in this browser.</p>
      <div class="form-actions">
        <button class="btn btn-secondary" id="exportBtn">Export JSON</button>
        <button class="btn btn-danger" id="clearBtn">Clear All Data</button>
      </div>`;
    el.querySelector('#exportBtn').addEventListener('click', async () => {
      const data = {};
      for (const store of ['tasks','slots','scheduleBlocks','focusSessions','settings']) {
        data[store] = await DB.getAll(store);
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `chronoflow-export-${Date.now()}.json`;
      a.click(); URL.revokeObjectURL(url);
    });
    el.querySelector('#clearBtn').addEventListener('click', () => {
      AppShell.confirm('This will permanently delete ALL your data. Are you sure?', async () => {
        for (const store of ['tasks','slots','scheduleBlocks','focusSessions','settings','gmailConfig','aiConfig']) {
          await DB.clear(store);
        }
        await AppState.init();
        AppShell.toast('All data cleared', 'success');
      });
    });
  },

  bindNavEvents() {
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.section;
        document.querySelectorAll('.settings-section').forEach(s => {
          s.style.display = (s.id === target + 'Section') ? '' : 'none';
        });
      });
    });
  }
};
