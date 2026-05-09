// =========================================================
// ChronoFlow ai.js — AI Infrastructure
// Conversation engine, phase controller, snapshot integration
// Gemini API via direct fetch (no SDK needed)
// =========================================================

// ---- Config ------------------------------------------------------------
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

// Phase signal the AI must include to advance from phase 1 → 2
const PHASE1_SIGNAL = '"phase":"understood"';
// Phase signal to advance from phase 2 → 3
const PHASE2_SIGNAL = '"phase":"plan_approved"';

// ---- AI Session --------------------------------------------------------
// One session per user-initiated change. Manages conversation history,
// phase state, snapshot lifecycle, and file read/write.

const AI = {

  // ---- Internal state --------------------------------------------------
  _session: null,

  // ---- Public: start a session ----------------------------------------
  /**
   * Begin a new AI session for a registered job.
   * @param {string} jobId  - matches registeredAiJobs[].jobId
   * @param {object} [opts] - { onMessage, onPhaseChange, onError }
   * @returns {AISession}
   */
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

  // ---- Public: one-shot helpers (no session state) --------------------

  /** Read a project file from the server. Returns content string or null. */
  async readFile(path) {
    if (!ChronoFlow.serverMode) return null;
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return j.content ?? null;
    } catch { return null; }
  },

  /** Write a project file via server. Returns true on success. */
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

  /** Basic JS syntax check via Function constructor. */
  syntaxCheck(code) {
    try { new Function(code); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
};

// ---- AISession class ---------------------------------------------------
class AISession {
  constructor(job, cfg, opts) {
    this.job      = job;
    this.cfg      = cfg;
    this.opts     = opts;           // { onMessage, onPhaseChange, onError }
    this.history  = [];             // Gemini contents array
    this.phase    = 1;              // 1=understand, 2=plan, 3=execute
    this.snapName = null;           // set when snapshot is taken
    this.accepted = false;          // true if user accepted at least one change
    this._active  = true;
  }

  // ---- Phase 1: conversational understanding -------------------------
  /**
   * Send a user message and get AI response.
   * AI signals phase advance by including the phase signal JSON in response.
   * @param {string} userMsg
   * @returns {{ text: string, phaseAdvanced: bool, summary: string|null }}
   */
  async chat(userMsg) {
    this._assertActive();

    this.history.push({ role: 'user', parts: [{ text: userMsg }] });

    const systemPrompt = this._buildSystemPrompt();
    const text = await this._callGemini(systemPrompt, this.history);

    this.history.push({ role: 'model', parts: [{ text }] });

    // Check for phase 1 → 2 advance signal
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

  // ---- Phase 2: implementation plan ----------------------------------
  /**
   * Request the implementation plan.
   * AI returns array of plain-English steps.
   * @returns {{ steps: string[], raw: string }}
   */
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
    const steps  = parsed?.steps ?? [text]; // fallback: treat as single step
    return { steps, raw: text };
  }

  /**
   * User approves the plan (possibly with removed steps).
   * Takes a snapshot, advances to phase 3.
   * @param {string[]} approvedSteps - subset of steps user kept
   */
  async approvePlan(approvedSteps) {
    this._assertActive();
    // Take snapshot before any writes
    const ts = Date.now();
    this.snapName = `pre-${this.job.jobId}-${ts}`;
    await takeSnapshot(this.snapName);

    this.phase = 3;
    this.opts.onPhaseChange?.({ phase: 3, approvedSteps });

    // Inform AI which steps were approved
    const msg = [
      'Plan approved. Proceed with these steps only:',
      approvedSteps.map((s, i) => `${i+1}. ${s}`).join('\n'),
      '',
      'For each step return a separate JSON result object as defined in your system prompt.',
      'Signal the start of phase 3 with: { "phase": "plan_approved" }'
    ].join('\n');
    this.history.push({ role: 'user', parts: [{ text: msg }] });
  }

  // ---- Phase 3: execute -----------------------------------------------
  /**
   * Execute next step — get AI result for one step.
   * @param {object} [extraContext] - additional data to inject (file contents, store data)
   * @returns {{ type: string, payload: object, plainEnglish: string }}
   */
  async executeStep(extraContext = {}) {
    this._assertActive();
    if (this.phase !== 3) throw new Error('Not in execute phase.');

    // Inject any extra context
    if (Object.keys(extraContext).length > 0) {
      const ctxMsg = `Context for this step:\n${JSON.stringify(extraContext, null, 2)}`;
      this.history.push({ role: 'user', parts: [{ text: ctxMsg }] });
    }

    const text = await this._callGemini(this._buildSystemPrompt(), this.history);
    this.history.push({ role: 'model', parts: [{ text }] });

    const parsed = _safeParseJSON(text) ?? { raw: text };
    return parsed;
  }

  // ---- Accept / reject -----------------------------------------------
  /** Call when user accepts at least one suggestion. */
  markAccepted() { this.accepted = true; }

  // ---- Session end ----------------------------------------------------
  /**
   * End session cleanly.
   * If nothing was accepted, silently deletes the snapshot.
   * If something was accepted, renames snapshot to post-{jobId}-{ts}.
   */
  async end(userLabel = null) {
    this._active = false;
    if (this.snapName) {
      if (!this.accepted) {
        // User cancelled or rejected everything — no record needed
        await deleteSnapshot(this.snapName);
      } else {
        // Keep snapshot, rename to meaningful name
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

  // ---- Internal helpers -----------------------------------------------
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
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192
      }
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
 * Safely parse JSON from AI response.
 * Handles markdown code fences (```json ... ```) Gemini sometimes wraps output in.
 */
function _safeParseJSON(text) {
  if (!text) return null;
  // Strip markdown fences
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  // Find first { or [ and last } or ]
  const first = clean.search(/[{[]/);
  const last  = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
  if (first === -1 || last === -1) return null;
  try {
    return JSON.parse(clean.slice(first, last + 1));
  } catch {
    return null;
  }
}

// ---- AIJobRunner -------------------------------------------------------
// Thin wrapper that loads input data for built-in jobs and feeds it to a session.

const AIJobRunner = {

  /**
   * Collect input data for a job based on its inputSources.
   * @param {string[]} sources - e.g. ['tasks', 'slots', 'focusSessions']
   * @returns {object} - keyed by source name
   */
  async gatherInputs(sources) {
    const result = {};
    for (const src of sources) {
      try {
        result[src] = AppState.get(src) ?? await DB.getAll(src);
      } catch {
        result[src] = [];
      }
    }
    // Always include today's date and settings
    result.today   = new Date().toISOString().split('T')[0];
    result.settings = AppState.get('settings') ?? {};
    return result;
  },

  /**
   * Apply an accepted AI result to the app.
   * Handles css-tokens, file, data, register-job types.
   * @param {object} result - parsed AI result object
   * @returns {boolean} success
   */
  async apply(result) {
    try {
      switch (result.type) {

        case 'css-tokens': {
          // Build user-theme.css content from accepted token overrides
          const lines = Object.entries(result.tokens)
            .map(([k, v]) => `  ${k}: ${v};`);
          const existing = await AI.readFile('css/user-theme.css') || ':root {\n}';
          // Merge: parse existing vars, override/add new ones
          const merged = _mergeTokensIntoCSS(existing, result.tokens);
          return await AI.writeFile('css/user-theme.css', merged);
        }

        case 'file': {
          // JS syntax check before writing
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
            await AppState.add(result.store, item);
          }
          return true;
        }

        case 'register-job': {
          const jobs = AppState.get('registeredAiJobs') || [];
          const existing = jobs.findIndex(j => j.jobId === result.job.jobId);
          if (existing >= 0) {
            await AppState.update('registeredAiJobs', result.job.jobId, result.job);
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

// ---- CSS token merge helper --------------------------------------------
function _mergeTokensIntoCSS(existingCSS, newTokens) {
  let css = existingCSS;
  for (const [token, value] of Object.entries(newTokens)) {
    const pattern = new RegExp(`(${_escapeRE(token)}\\s*:\\s*)[^;]+;`);
    if (pattern.test(css)) {
      css = css.replace(pattern, `$1${value};`);
    } else {
      // Insert before closing brace of :root
      css = css.replace(/}\s*$/, `  ${token}: ${value};\n}`);
    }
  }
  return css;
}

function _escapeRE(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
