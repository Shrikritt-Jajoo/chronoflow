// =========================================================
// ChronoFlow app.js
// Dual persistence: JSON file via server (preferred)
//                   IndexedDB fallback (no server / file://)
// =========================================================

// ---- Config ------------------------------------------------------------
const DB_NAME    = 'chronoflow-db';
const DB_VERSION = 2;
const STORES = ['tasks','slots','scheduleBlocks','focusSessions',
                'settings','gmailConfig','aiConfig','goals','subtasks',
                'registeredAiJobs'];

// Singleton key stores (key-based, not id-based)
const KP_KEY_STORES = new Set(['settings','gmailConfig','aiConfig']);

// ---- Server detection --------------------------------------------------
// Resolved once at boot. Other modules read ChronoFlow.serverMode.
const ChronoFlow = {
  serverMode: false,   // true = server running, use JSON API
  _ready: null,        // Promise resolved after ping

  async detect() {
    if (this._ready) return this._ready;
    this._ready = fetch('/api/ping', { method: 'GET', cache: 'no-store' })
      .then(r => r.ok)
      .catch(() => false)
      .then(ok => { this.serverMode = ok; return ok; });
    return this._ready;
  }
};

// ---- Write debounce cache (server mode only) ---------------------------
// Batches rapid sequential writes into one fetch per store.
const _writeCache = {};   // store -> latest array value
const _writeTimers = {};  // store -> setTimeout id
const WRITE_DEBOUNCE_MS = 100;

function _scheduleWrite(store, value) {
  _writeCache[store] = value;
  clearTimeout(_writeTimers[store]);
  _writeTimers[store] = setTimeout(() => _flushWrite(store), WRITE_DEBOUNCE_MS);
}

async function _flushWrite(store) {
  const value = _writeCache[store];
  if (value === undefined) return;
  delete _writeCache[store];
  try {
    await fetch(`/api/data?store=${encodeURIComponent(store)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
  } catch (e) {
    console.warn(`[ChronoFlow] Write failed for store "${store}":`, e);
  }
}

// Flush all pending writes immediately (call before version snapshot)
async function flushAllWrites() {
  const pending = Object.keys(_writeTimers);
  for (const store of pending) {
    clearTimeout(_writeTimers[store]);
    delete _writeTimers[store];
    await _flushWrite(store);
  }
}

// ---- In-memory JSON store (server mode) --------------------------------
// Mirrors what is in data.json so reads are instant.
const _memStore = {};

async function _serverGetAll(store) {
  if (_memStore[store]) return _memStore[store];
  try {
    const r = await fetch(`/api/data?store=${encodeURIComponent(store)}`, { cache: 'no-store' });
    const data = await r.json();
    _memStore[store] = Array.isArray(data) ? data : (data ? [data] : []);
  } catch { _memStore[store] = []; }
  return _memStore[store];
}

async function _serverGet(store, key) {
  const all = await _serverGetAll(store);
  const kp  = KP_KEY_STORES.has(store) ? 'key' : 'id';
  return all.find(i => i[kp] === key) || undefined;
}

async function _serverPut(store, item) {
  const all = await _serverGetAll(store);
  const kp  = KP_KEY_STORES.has(store) ? 'key' : 'id';
  const idx = all.findIndex(i => i[kp] === item[kp]);
  if (idx >= 0) all[idx] = item; else all.push(item);
  _memStore[store] = all;
  _scheduleWrite(store, all);
  return item;
}

async function _serverDelete(store, key) {
  const all = await _serverGetAll(store);
  const kp  = KP_KEY_STORES.has(store) ? 'key' : 'id';
  _memStore[store] = all.filter(i => i[kp] !== key);
  _scheduleWrite(store, _memStore[store]);
}

async function _serverClear(store) {
  _memStore[store] = [];
  _scheduleWrite(store, []);
}

// ---- IndexedDB wrapper (fallback mode) ---------------------------------
const _idb = {
  _db: null,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) {
            const kp = KP_KEY_STORES.has(store) ? 'key' : 'id';
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

// ---- Unified DB facade -------------------------------------------------
// All other modules use DB.get / DB.put / DB.getAll / DB.delete / DB.clear.
// The implementation is swapped transparently based on server detection.
const DB = {
  async put(store, value) {
    return ChronoFlow.serverMode
      ? _serverPut(store, value)
      : _idb.put(store, value);
  },

  async get(store, key) {
    return ChronoFlow.serverMode
      ? _serverGet(store, key)
      : _idb.get(store, key);
  },

  async getAll(store) {
    return ChronoFlow.serverMode
      ? _serverGetAll(store)
      : _idb.getAll(store);
  },

  async delete(store, key) {
    return ChronoFlow.serverMode
      ? _serverDelete(store, key)
      : _idb.delete(store, key);
  },

  async clear(store) {
    return ChronoFlow.serverMode
      ? _serverClear(store)
      : _idb.clear(store);
  }
};

// ---- Server-only helpers exposed globally ------------------------------

/**
 * Take a named version snapshot of the current app state.
 * No-op when running without server.
 */
async function takeSnapshot(name) {
  if (!ChronoFlow.serverMode) return null;
  await flushAllWrites();
  const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 64);
  try {
    const r = await fetch(`/api/versions/snapshot?name=${encodeURIComponent(safeName)}`, { method: 'POST' });
    return r.ok ? safeName : null;
  } catch { return null; }
}

/**
 * Delete a snapshot by name (used when user cancels a change session).
 */
async function deleteSnapshot(name) {
  if (!ChronoFlow.serverMode) return;
  try {
    await fetch(`/api/versions?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  } catch {}
}

/**
 * List all saved versions from the server.
 */
async function listVersions() {
  if (!ChronoFlow.serverMode) return [];
  try {
    const r = await fetch('/api/versions', { cache: 'no-store' });
    return r.ok ? r.json() : [];
  } catch { return []; }
}

/**
 * Restore a version by name. Reloads the page after restore.
 */
async function restoreVersion(name) {
  if (!ChronoFlow.serverMode) return false;
  try {
    const r = await fetch(`/api/versions/restore?name=${encodeURIComponent(name)}`, { method: 'POST' });
    if (r.ok) { window.location.reload(); return true; }
    return false;
  } catch { return false; }
}

// ---- Page init router --------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Detect server (sets ChronoFlow.serverMode)
  const hasServer = await ChronoFlow.detect();

  // 2. Show server-mode indicator (subtle, non-intrusive)
  if (hasServer) {
    console.info('[ChronoFlow] Server mode — data persisted to data.json');
  } else {
    console.info('[ChronoFlow] Standalone mode — data persisted to IndexedDB');
    // Show a banner on pages that need server features
    _maybeShowServerBanner();
  }

  // 3. Init shell + background
  AppShell.init();
  Backgrounds.init('bgCanvas');

  // 4. Route to page module
  const page = document.body.dataset.page;
  if (page === 'planner')  await Planner.init();
  if (page === 'focus')    await AppState.init();
  if (page === 'stats')    await Stats?.init?.();
  if (page === 'settings') await Settings.init();
  // home page runs its own IIFE in home.js
});

// ---- Server banner (shown on pages with server-only features) ----------
function _maybeShowServerBanner() {
  const page = document.body?.dataset?.page;
  const serverPages = ['settings']; // versions UI lives here
  if (!serverPages.includes(page)) return;

  const banner = document.createElement('div');
  banner.style.cssText = [
    'position:fixed', 'bottom:1rem', 'left:50%', 'transform:translateX(-50%)',
    'background:rgba(10,14,26,0.95)', 'border:1px solid rgba(140,166,255,0.2)',
    'color:var(--color-text-muted,#8892b0)', 'font-size:0.75rem',
    'padding:0.5rem 1rem', 'border-radius:8px', 'z-index:9999',
    'pointer-events:none', 'backdrop-filter:blur(8px)'
  ].join(';');
  banner.textContent = 'Start the server to enable file editing and version history.';
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 6000);
}
