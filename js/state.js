// =========================================================
// ChronoFlow State Manager — In-memory cache + event bus
// =========================================================

const DEFAULT_AI_JOBS = [
  {
    id: 'goal-decomposition', jobId: 'goal-decomposition',
    label: 'Goal Decomposition', trigger: 'planner-sidebar',
    systemPrompt: [
      'You are ChronoFlow\'s Goal Decomposition assistant.',
      'Your task: given a user\'s stated goal and their existing task list, break the goal into',
      '3-7 concrete, actionable subtasks that can each be completed in one focused sitting (45-90 min).',
      'Each subtask must have: title, estimatedMinutes (30-90), priority (1-5), energyNeed (1-5),',
      'context (focus|study|admin|errand|creative|meeting), and nextStep.',
      'Return a JSON array of task objects matching the Task schema in AGENTS.md.',
      'In phase 3 return: { "type": "data", "store": "tasks", "items": [...], "plainEnglish": "Added N tasks for goal: ..." }'
    ].join('\n'),
    userMessageTemplate: 'My goal: {goal}\n\nExisting tasks:\n{tasks}',
    inputSources: ['tasks', 'goals', 'settings'],
    outputSchema: { type: 'data', store: 'tasks', items: [] },
    acceptRejectPerItem: true, lockedFiles: [], addedBy: 'system',
    addedAt: new Date().toISOString()
  },
  {
    id: 'task-critique', jobId: 'task-critique',
    label: 'Task Critique', trigger: 'planner-sidebar',
    systemPrompt: [
      'You are ChronoFlow\'s Task Critique assistant.',
      'Review the user\'s task list. For each vague, oversized, or unclear task suggest:',
      '  1. A clearer title',
      '  2. A concrete nextStep',
      '  3. A better estimatedMinutes if the original seems wrong',
      'Only flag tasks that genuinely need improvement — do not rewrite tasks that are already clear.',
      'In phase 3 return: { "type": "data", "store": "tasks", "items": [...updated tasks...], "plainEnglish": "Improved N tasks" }',
      'Each returned item must include the original task id.'
    ].join('\n'),
    userMessageTemplate: 'My tasks:\n{tasks}',
    inputSources: ['tasks', 'settings'],
    outputSchema: { type: 'data', store: 'tasks', items: [] },
    acceptRejectPerItem: true, lockedFiles: [], addedBy: 'system',
    addedAt: new Date().toISOString()
  },
  {
    id: 'daily-email', jobId: 'daily-email',
    label: 'Daily Email Summary', trigger: 'home',
    systemPrompt: [
      'You are ChronoFlow\'s Daily Email assistant.',
      'Write a concise, friendly end-of-day email (plain text, max 300 words) covering:',
      '  - What was planned today (from scheduleBlocks)',
      '  - What was completed (completed tasks / focus sessions)',
      '  - What carries forward to tomorrow',
      '  - One motivational or reflective sentence',
      'In phase 3 return: { "type": "email", "subject": "Your ChronoFlow Daily Summary", "body": "...", "plainEnglish": "Daily summary email ready" }'
    ].join('\n'),
    userMessageTemplate: 'Schedule: {scheduleBlocks}\nSessions: {focusSessions}\nTasks: {tasks}',
    inputSources: ['tasks', 'scheduleBlocks', 'focusSessions', 'settings'],
    outputSchema: { type: 'email', subject: '', body: '' },
    acceptRejectPerItem: false, lockedFiles: [], addedBy: 'system',
    addedAt: new Date().toISOString()
  },
  {
    id: 'backlog-cleanup', jobId: 'backlog-cleanup',
    label: 'Backlog Cleanup', trigger: 'planner-sidebar',
    systemPrompt: [
      'You are ChronoFlow\'s Backlog Cleanup assistant.',
      'Analyse the task list and identify:',
      '  - Duplicate or very similar tasks (suggest merging)',
      '  - Tasks with no progress for over 7 days (suggest archiving or rewriting)',
      '  - Overly broad tasks (suggest splitting)',
      'Present findings one at a time during the conversation phase.',
      'In phase 3 return: { "type": "data", "store": "tasks", "items": [...], "plainEnglish": "Cleaned N tasks" }',
      'For tasks to delete, include { ...task, _delete: true } in items.'
    ].join('\n'),
    userMessageTemplate: 'My backlog (all tasks):\n{tasks}\nToday: {today}',
    inputSources: ['tasks', 'subtasks', 'settings'],
    outputSchema: { type: 'data', store: 'tasks', items: [] },
    acceptRejectPerItem: true, lockedFiles: [], addedBy: 'system',
    addedAt: new Date().toISOString()
  },
  {
    id: 'weekly-review', jobId: 'weekly-review',
    label: 'Weekly Review', trigger: 'stats',
    systemPrompt: [
      'You are ChronoFlow\'s Weekly Review assistant.',
      'Analyse the last 7 days of focus sessions, schedule blocks, and completed tasks.',
      'Produce a weekly review covering:',
      '  - Total focused hours vs planned',
      '  - Top 3 productive patterns observed',
      '  - Top 2 friction points',
      '  - 3 specific, actionable suggestions for next week',
      'Write in a warm, direct coaching tone. Max 400 words.',
      'In phase 3 return: { "type": "weekly-review", "markdown": "...", "plainEnglish": "Weekly review ready" }'
    ].join('\n'),
    userMessageTemplate: 'Sessions this week:\n{focusSessions}\nSchedule:\n{scheduleBlocks}\nTasks:\n{tasks}',
    inputSources: ['tasks', 'scheduleBlocks', 'focusSessions', 'settings'],
    outputSchema: { type: 'weekly-review', markdown: '' },
    acceptRejectPerItem: false, lockedFiles: [], addedBy: 'system',
    addedAt: new Date().toISOString()
  }
];

const AppState = {
  _data: {
    settings: {}, goals: [], tasks: [], subtasks: [],
    slots: [], scheduleBlocks: [], focusSessions: [],
    gmailConfig: {}, aiConfig: {}, registeredAiJobs: []
  },
  _listeners: new Map(),

  async init() {
    const arrayStores = [
      'goals', 'tasks', 'subtasks',
      'slots', 'scheduleBlocks', 'focusSessions', 'registeredAiJobs'
    ];
    for (const s of arrayStores) {
      const all = await DB.getAll(s);
      this._data[s] = Array.isArray(all) ? all : (all ? [all] : []);
    }

    // Singleton stores
    const sett = await DB.get('settings', 'main');
    this._data.settings = sett || {};

    const g = await DB.get('gmailConfig', 'main');
    this._data.gmailConfig = g || {};

    const a = await DB.get('aiConfig', 'main');
    this._data.aiConfig = a || {};

    // Seed default AI jobs if none registered yet
    if (this._data.registeredAiJobs.length === 0) {
      for (const job of DEFAULT_AI_JOBS) {
        await DB.put('registeredAiJobs', job);
      }
      this._data.registeredAiJobs = [...DEFAULT_AI_JOBS];
    }
  },

  get(key) { return this._data[key]; },

  async set(key, value) {
    this._data[key] = value;
    this._emit(key, value);
  },

  async add(store, item) {
    await DB.put(store, item);
    if (!Array.isArray(this._data[store])) this._data[store] = [];
    this._data[store].push(item);
    this._emit(store, this._data[store]);
  },

  // FATAL-2 fix: always use 'id' as keyPath for all stores.
  // registeredAiJobs keyPath is 'id' in DB — jobId is just an alias field.
  async update(store, id, changes) {
    const arr = this._data[store];
    if (!Array.isArray(arr)) return;
    const idx = arr.findIndex(i => i['id'] === id);
    if (idx === -1) return;
    const updated = { ...arr[idx], ...changes, updatedAt: new Date().toISOString() };
    await DB.put(store, updated);
    arr[idx] = updated;
    this._emit(store, arr);
    return updated;
  },

  // FATAL-3 fix: DB.delete uses 'id' keyPath, not 'jobId'.
  async remove(store, id) {
    await DB.delete(store, id);
    this._data[store] = (this._data[store] || []).filter(i => i['id'] !== id);
    this._emit(store, this._data[store]);
  },

  on(event, callback) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(callback);
    return () => this.off(event, callback);
  },

  off(event, callback) {
    if (!this._listeners.has(event)) return;
    this._listeners.set(event, this._listeners.get(event).filter(cb => cb !== callback));
  },

  _emit(event, data) {
    if (!this._listeners.has(event)) return;
    for (const cb of this._listeners.get(event)) {
      try { cb(data); } catch (e) { console.error(e); }
    }
  }
};
