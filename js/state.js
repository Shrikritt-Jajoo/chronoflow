// =========================================================
// ChronoFlow State Manager — In-memory cache + event bus
// =========================================================
const AppState = {
  _data: {
    settings: {}, goals: [], tasks: [], subtasks: [],
    slots: [], scheduleBlocks: [], focusSessions: [],
    gmailConfig: {}, aiConfig: {}
  },
  _listeners: new Map(),

  async init() {
    const stores = ['settings','goals','tasks','subtasks','slots','scheduleBlocks','focusSessions'];
    for (const s of stores) { this._data[s] = await DB.getAll(s); }
    const g = await DB.get('gmailConfig', 'main');
    this._data.gmailConfig = g || {};
    const a = await DB.get('aiConfig', 'main');
    this._data.aiConfig = a || {};
  },

  get(key) { return this._data[key]; },

  async set(key, value) { this._data[key] = value; this._emit(key, value); },

  async add(store, item) {
    await DB.put(store, item);
    this._data[store].push(item);
    this._emit(store, this._data[store]);
  },

  async update(store, id, changes) {
    const idx = this._data[store].findIndex(i => i.id === id);
    if (idx === -1) return;
    const updated = { ...this._data[store][idx], ...changes, updatedAt: new Date().toISOString() };
    await DB.put(store, updated);
    this._data[store][idx] = updated;
    this._emit(store, this._data[store]);
    return updated;
  },

  async remove(store, id) {
    await DB.delete(store, id);
    this._data[store] = this._data[store].filter(i => i.id !== id);
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
    for (const cb of this._listeners.get(event)) { try { cb(data); } catch (e) { console.error(e); } }
  }
};
