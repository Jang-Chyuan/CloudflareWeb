// Browser-native, account-isolated cache. Supabase remains the source of truth.
const DATABASE = 'dogtracker-telemetry';
const RETENTION = 15 * 86400000;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const rows = db.createObjectStore('packets', { keyPath: ['owner', 'id'] });
      rows.createIndex('ownerTime', ['owner', 'received_at']);
      db.createObjectStore('accounts', { keyPath: 'owner' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['packets', 'accounts'], mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      tx.onerror = () => {}; // onabort reports failed writes, including quota errors.
      operation(tx, result => { value = result; });
    });
  } finally { db.close(); }
}

export function readCachedTelemetry(owner, start, end) {
  return transaction('readonly', (tx, done) => {
    const account = tx.objectStore('accounts').get(owner);
    const request = tx.objectStore('packets').index('ownerTime')
      .getAll(IDBKeyRange.bound([owner, start], [owner, end], false, true));
    request.onsuccess = () => {
      const allowed = account.result?.masters ?? [];
      done({ masters: allowed, rows: request.result.filter(row => allowed.includes(row.master_id))
        .map(({ owner: ignored, ...row }) => row) });
    };
  });
}

// Update permissions and remove revoked/expired records atomically.
export function updateCachedMasters(owner, masters, now = Date.now()) {
  return transaction('readwrite', tx => {
    tx.objectStore('accounts').put({ owner, masters });
    const request = tx.objectStore('packets').index('ownerTime')
      .openCursor(IDBKeyRange.bound([owner, -Infinity], [owner, Infinity]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!masters.includes(cursor.value.master_id) || cursor.value.received_at < now - RETENTION) cursor.delete();
      cursor.continue();
    };
  });
}

export function saveCachedTelemetry(owner, rows, now = Date.now()) {
  return transaction('readwrite', tx => {
    const request = tx.objectStore('accounts').get(owner);
    request.onsuccess = () => {
      const masters = request.result?.masters ?? [];
      const store = tx.objectStore('packets');
      for (const row of rows) {
        if (masters.includes(row.master_id) && row.received_at >= now - RETENTION) store.put({ ...row, owner });
      }
    };
  });
}
