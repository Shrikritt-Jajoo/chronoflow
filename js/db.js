// =========================================================
// ChronoFlow DB — IndexedDB wrapper
// Exposes the same DB facade expected by app.js / state.js
// when running without the Rust server (file:// / CDN mode).
// In server mode, app.js overrides window.DB after its own
// server-detection logic — this file is the safe fallback.
// =========================================================

// Only define if app.js hasn't already defined DB
if (typeof DB === 'undefined') {
  const _DB_NAME    = 'chronoflow-db';
  const _DB_VERSION = 2;
  const _STORES = [
    'tasks','slots','scheduleBlocks','focusSessions',
    'settings','gmailConfig','aiConfig','goals','subtasks',
    'registeredAiJobs'
  ];
  const _KP_KEY_STORES = new Set(['settings','gmailConfig','aiConfig']);

  const _idb = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(_DB_NAME, _DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const store of _STORES) {
            if (!db.objectStoreNames.contains(store)) {
              const kp = _KP_KEY_STORES.has(store) ? 'key' : 'id';
              db.createObjectStore(store, { keyPath: kp });
            }
          }
        };
        req.onsuccess = () => { this._db = req.result; resolve(this._db); };
        req.onerror   = () => reject(req.error);
      });
    },
    async put(store, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve(value);
        tx.onerror    = () => reject(tx.error);
      });
    },
    async get(store, key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      });
    },
    async getAll(store) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror   = () => reject(req.error);
      });
    },
    async delete(store, key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    },
    async clear(store) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    }
  };

  // eslint-disable-next-line no-unused-vars
  var DB = {
    put:    (store, value) => _idb.put(store, value),
    get:    (store, key)   => _idb.get(store, key),
    getAll: (store)        => _idb.getAll(store),
    delete: (store, key)   => _idb.delete(store, key),
    clear:  (store)        => _idb.clear(store)
  };
}
