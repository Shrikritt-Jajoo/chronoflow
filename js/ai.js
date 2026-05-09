// =========================================================
// ChronoFlow ai.js — AI Infrastructure
// Conversation engine, phase controller, snapshot integration
// Gemini API via direct fetch (no SDK needed)
// =========================================================

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

const PHASE1_SIGNAL = '"phase":"understood"';
const PHASE2_SIGNAL = '"phase":"plan_approved"';

const AI = {
  _session: null,

  async startSession(jobId, opts = {}) {
    if (this._session) this._session._cleanup();

    const jobs = AppState.get('registeredAiJobs') || [];
    const job  = jobs.find(j => j.jobId === jobId);
    if (!job) throw new Error(`AI job "${jobId}" not registered.`);

    const cfg = AppState.get('aiConfig') || {};
    if (!cfg.geminiKey) {
      AppShell.toast('Add your Gemini API key in Settings → AI', 'error', 6000);
      throw new Error('No Gemini API key configured.');
    }

    const session = new AISession(job, cfg, opts);
    this._session = session;
    return session;
  },

  async readFile(path) {
    if (!ChronoFlow.serverMode) return null;
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return j.content ?? null;
    } catch { return null; }
  },

  async writeFile(path, content) {
    if (!ChronoFlow.serverMode) return false;
    try {
      const r = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content })
      });
      return r.ok;
    } catch { return false; }
  },

  syntaxCheck(code) {
    try { new Function(code); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
};

class AISession {
  constructor(job, cfg, opts) {
    this.job      = job;
    this.cfg      = cfg;
    this.opts     = opts;
    this.history  = [];
    this.phase    = 1;
    this.snapName = null;
    this.accepted = false;
    this._active  = true;
  }

  async chat(userMsg) {
    this._assertActive();
    this.history.push({ role: 'user', parts: [{ text: userMsg }] });
    const systemPrompt = this._buildSystemPrompt();
    const text = await this._callGemini(systemPrompt, this.history);
    this.history.push({ role: 'model', parts: [{ text }] });

    let phaseAdvanced = false;
    let summary = null;
    if (this.phase === 1 && text.includes(PHASE1_SIGNAL)) {
      const parsed = _safeParseJSON(text);
      if (parsed?.phase === 'understood') {
        summary = parsed.summary || null;
        this.phase = 2;
        phaseAdvanced = true;
        this.opts.onPhaseChange?.({ phase: 2, summary });
      }
    }

    this.opts.onMessage?.({ role: 'model', text, phase: this.phase });
    return { text, phaseAdvanced, summary };
  }

  async getPlan() {
    this._assertActive();
    if (this.phase !== 2) throw new Error('Not in plan phase.');

    const planPrompt = [
      'Based on our conversation, write a numbered implementation plan.',
      'Return ONLY valid JSON: { "phase": "plan", "steps": ["step 1", "step 2", ...] }',
      'Steps must be plain English, one sentence each, understandable by a non-technical user.',
      'Maximum 10 steps. Be specific about what will change.'
    ].join('\n');

    this.history.push({ role: 'user', parts: [{ text: planPrompt }] });
    const text = await this._callGemini(this._buildSystemPrompt(), this.history);
    this.history.push({ role: 'model', parts: [{ text }] });

    const parsed = _safeParseJSON(text);
    const steps  = parsed?.steps ?? [text];
    return { steps, raw: text };
  }

  async approvePlan(approvedSteps) {
    this._assertActive();
    const ts = Date.now();
    this.snapName = `pre-${this.job.jobId}-${ts}`;
    await takeSnapshot(this.snapName);

    this.phase = 3;
    this.opts.onPhaseChange?.({ phase: 3, approvedSteps });

    const msg = [
      'Plan approved. Proceed with these steps only:',
      approvedSteps.map((s, i) => `${i+1}. ${s}`).join('\n'),
      '',
      'For each step return a separate JSON result object as defined in your system prompt.',
      'Signal the start of phase 3 with: { "phase": "plan_approved" }'
    ].join('\n');
    this.history.push({ role: 'user', parts: [{ text: msg }] });
  }

  async executeStep(extraContext = {}) {
    this._assertActive();
    if (this.phase !== 3) throw new Error('Not in execute phase.');

    if (Object.keys(extraContext).length > 0) {
      const ctxMsg = `Context for this step:\n${JSON.stringify(extraContext, null, 2)}`;
      this.history.push({ role: 'user', parts: [{ text: ctxMsg }] });
    }

    const text = await this._callGemini(this._buildSystemPrompt(), this.history);
    this.history.push({ role: 'model', parts: [{ text }] });

    const parsed = _safeParseJSON(text) ?? { raw: text };
    return parsed;
  }

  markAccepted() { this.accepted = true; }

  async end(userLabel = null) {
    this._active = false;
    if (this.snapName) {
      if (!this.accepted) {
        await deleteSnapshot(this.snapName);
      } else {
        const finalName = userLabel
          ? userLabel.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 64)
          : `post-${this.job.jobId}-${Date.now()}`;
        try {
          await fetch(
            `/api/versions?name=${encodeURIComponent(this.snapName)}&newName=${encodeURIComponent(finalName)}`,
            { method: 'PATCH' }
          );
        } catch {}
      }
    }
    if (AI._session === this) AI._session = null;
  }

  _assertActive() {
    if (!this._active) throw new Error('Session has ended.');
  }

  _cleanup() {
    this._active = false;
    AI._session = null;
  }

  _buildSystemPrompt() {
    const agentsNote = [
      'You are an AI assistant embedded in ChronoFlow, a personal productivity app.',
      'You must follow AGENTS.md rules at all times.',
      '',
      `Current job: ${this.job.label}`,
      '',
      '=== PHASE RULES ===',
      'Phase 1 (UNDERSTAND): Ask clarifying questions. When you fully understand the user\'s intent,',
      'respond with ONLY: { "phase": "understood", "summary": "one sentence summary" }',
      '',
      'Phase 2 (PLAN): When asked, return implementation plan as:',
      '{ "phase": "plan", "steps": ["plain English step", ...] }',
      '',
      'Phase 3 (EXECUTE): Execute the approved plan step by step.',
      'For CSS token changes return: { "type": "css-tokens", "tokens": { "--var": "value" }, "plainEnglish": "..." }',
      'For file changes return: { "type": "file", "path": "js/foo.js", "content": "FULL file content", "isNew": bool, "plainEnglish": "..." }',
      'For data changes return: { "type": "data", "store": "tasks", "items": [...], "plainEnglish": "..." }',
      'For new AI job registration return: { "type": "register-job", "job": { ...RegisteredAiJob schema... }, "plainEnglish": "..." }',
      '',
      '=== JOB SYSTEM PROMPT ===',
      this.job.systemPrompt
    ].join('\n');
    return agentsNote;
  }

  async _callGemini(systemPrompt, history) {
    const model   = this.cfg.model || DEFAULT_MODEL;
    const apiKey  = this.cfg.geminiKey;
    const url     = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: history,
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Gemini API error ${r.status}: ${err}`);
    }

    const data = await r.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }
}

// ---- Utilities ---------------------------------------------------------

/**
 * MEDIUM-5 + LOW-5 fix: robustly strip markdown fences and leading prose.
 * Old approach used startsWith('```') which fails if there is leading
 * whitespace or prose before the fence. New approach:
 * 1. Use a regex replace to strip everything up to and including any
 *    opening fence, regardless of leading content.
 * 2. Strip the closing fence.
 * 3. Then use first-brace / last-brace extraction as before — but now
 *    operating on clean JSON-only content so stray braces in prose
 *    can't trick it.
 */
function _safeParseJSON(text) {
  if (!text) return null;
  let clean = text
    .replace(/^[\s\S]*?```[a-z]*\n?/, '')  // strip everything up to+including opening fence
    .replace(/\n?```[\s\S]*$/, '')          // strip closing fence and anything after
    .trim();
  // If no fence was present, clean === trimmed original — that's fine.
  if (clean === text.trim()) clean = text.trim();
  const first = clean.search(/[{[]/);
  const last  = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
  if (first === -1 || last === -1) return null;
  try {
    return JSON.parse(clean.slice(first, last + 1));
  } catch {
    return null;
  }
}

const AIJobRunner = {

  async gatherInputs(sources) {
    const result = {};
    for (const src of sources) {
      try {
        result[src] = AppState.get(src) ?? await DB.getAll(src);
      } catch {
        result[src] = [];
      }
    }
    result.today    = new Date().toISOString().split('T')[0];
    result.settings = AppState.get('settings') ?? {};
    return result;
  },

  async apply(result) {
    try {
      switch (result.type) {

        case 'css-tokens': {
          const lines = Object.entries(result.tokens)
            .map(([k, v]) => `  ${k}: ${v};`);
          const existing = await AI.readFile('css/user-theme.css') || ':root {\n}';
          const merged = _mergeTokensIntoCSS(existing, result.tokens);
          return await AI.writeFile('css/user-theme.css', merged);
        }

        case 'file': {
          if (result.path.endsWith('.js')) {
            const check = AI.syntaxCheck(result.content);
            if (!check.ok) {
              AppShell.toast(`Syntax error in ${result.path}: ${check.error}`, 'error', 8000);
              return false;
            }
          }
          return await AI.writeFile(result.path, result.content);
        }

        case 'data': {
          const items = Array.isArray(result.items) ? result.items : [result.items];
          for (const item of items) {
            // MEDIUM-3 fix: ensure item has an id field matching the store keyPath.
            // Auto-assign a uid if missing so IDB never throws DataError.
            if (!item.id) item.id = Utils.uid(result.store);
            await AppState.add(result.store, item);
          }
          return true;
        }

        case 'register-job': {
          const jobs = AppState.get('registeredAiJobs') || [];
          const existing = jobs.findIndex(j => j.jobId === result.job.jobId);
          if (existing >= 0) {
            await AppState.update('registeredAiJobs', result.job.id || result.job.jobId, result.job);
          } else {
            await AppState.add('registeredAiJobs', { ...result.job, id: result.job.jobId });
          }
          AppShell.toast(`AI job "${result.job.label}" registered.`, 'success');
          return true;
        }

        default:
          console.warn('[AI] Unknown result type:', result.type);
          return false;
      }
    } catch (e) {
      AppShell.toast('Failed to apply change: ' + e.message, 'error');
      return false;
    }
  }
};

function _mergeTokensIntoCSS(existingCSS, newTokens) {
  let css = existingCSS;
  for (const [token, value] of Object.entries(newTokens)) {
    const pattern = new RegExp(`(${_escapeRE(token)}\\s*:\\s*)[^;]+;`);
    if (pattern.test(css)) {
      css = css.replace(pattern, `$1${value};`);
    } else {
      css = css.replace(/}\s*$/, `  ${token}: ${value};\n}`);
    }
  }
  return css;
}

function _escapeRE(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
