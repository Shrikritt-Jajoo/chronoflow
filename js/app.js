// =========================================================
// ChronoFlow app.js — IndexedDB layer + page router init
// =========================================================

// --- IndexedDB wrapper ---
const DB_NAME    = 'chronoflow-db';
const DB_VERSION = 2;
const STORES = ['tasks','slots','scheduleBlocks','focusSessions','settings','gmailConfig','aiConfig','goals','subtasks'];

const DB = {
  _db: null,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) {
            const kp = (store === 'settings' || store === 'gmailConfig' || store === 'aiConfig') ? 'key' : 'id';
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

// --- Page init router ---
document.addEventListener('DOMContentLoaded', async () => {
  // Always init shell + background
  AppShell.init();
  Backgrounds.init('bgCanvas');

  const page = document.body.dataset.page;
  if (page === 'planner')  await Planner.init();
  if (page === 'focus')    { await AppState.init(); /* focus.html handles its own init via FocusMode */ }
  if (page === 'stats')    await Stats?.init?.();
  if (page === 'settings') await Settings.init();
  // home page runs its own IIFE in home.js
});
