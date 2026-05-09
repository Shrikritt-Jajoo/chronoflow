// =========================================================
// ChronoFlow Gmail Connector
// OAuth + Gmail API — send daily plan to self
// Note: OAuth requires localhost or verified origin
// =========================================================
const GmailConnector = {
  tokenClient: null,
  accessToken: null,

  async init() {
    const config = await DB.get('gmailConfig', 'main');
    if (!config?.clientId) return;
    if (!window.google?.accounts?.oauth2) await this.loadGIS();
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose',
      callback: (tokenResponse) => {
        this.accessToken = tokenResponse.access_token;
        this.saveToken(tokenResponse);
        AppShell.toast('Gmail connected', 'success');
      }
    });
  },

  loadGIS() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true; script.defer = true;
      script.onload = resolve; script.onerror = reject;
      document.head.appendChild(script);
    });
  },

  async saveToken(tokenResponse) {
    const config = await DB.get('gmailConfig', 'main') || { key: 'main' };
    config.accessToken = tokenResponse.access_token;
    config.expiresAt   = Date.now() + tokenResponse.expires_in * 1000;
    await DB.put('gmailConfig', config);
  },

  async getValidToken() {
    const config = await DB.get('gmailConfig', 'main');
    if (!config?.accessToken) return null;
    if (config.expiresAt && Date.now() > config.expiresAt - 60000) {
      if (this.tokenClient) this.tokenClient.requestAccessToken({ prompt: 'none' });
      return null;
    }
    return config.accessToken;
  },

  async sendTestEmail() {
    const token = await this.getValidToken();
    if (!token) { AppShell.toast('Not connected — set Client ID in Settings first.', 'error'); return; }
    try {
      await this.sendMessage(token, this.createMimeMessage({ to: 'me', subject: 'ChronoFlow Test', body: 'This is a test email from ChronoFlow. Your daily planning assistant is ready!' }));
      AppShell.toast('Test email sent!', 'success');
    } catch (err) {
      AppShell.toast('Failed: ' + (err.message || 'Unknown error'), 'error');
      console.error(err);
    }
  },

  async sendDailyPlan() {
    const token = await this.getValidToken();
    if (!token) return;
    const tasks  = AppState.get('tasks').filter(t => !t.isCompleted);
    const blocks = AppState.get('scheduleBlocks');
    let body = `Your ChronoFlow Plan for ${Utils.formatDate(new Date())}\n\n`;
    body += 'SCHEDULED BLOCKS:\n';
    for (const b of blocks) body += `- ${Utils.formatTime(new Date(b.start))}: ${b.title} (${b.minutes}m)\n`;
    body += '\nREMAINING TASKS:\n';
    for (const t of tasks) body += `- ${t.title} (${t.remainingMinutes || t.estimatedMinutes}m remaining)\n`;
    await this.sendMessage(token, this.createMimeMessage({ to: 'me', subject: `ChronoFlow Plan - ${Utils.formatDateShort(new Date())}`, body }));
    AppShell.toast('Daily plan sent!', 'success');
  },

  createMimeMessage({ to, subject, body }) {
    const raw = ['To: ', to, '\nSubject: ', subject, '\n\n', body].join('');
    return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  },

  async sendMessage(token, rawMessage) {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: rawMessage })
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'Gmail API error'); }
    return res.json();
  }
};
