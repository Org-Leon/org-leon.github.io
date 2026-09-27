// ---------- FeldFolio Plus: Lokaler Speicher für den Offline-Betrieb ----------
// Im Stall gibt es oft keinen Empfang — der komplette Arbeitsstand liegt
// deshalb zusätzlich lokal in IndexedDB (localStorage wäre mit ~5 MB für
// hochgeladene Shapefile-Ebenen zu klein) und wird nachsynchronisiert,
// sobald wieder Netz da ist (siehe persistLocalState()/syncWithCloud() in
// main.js).
//
// Je Nutzer ein Datensatz:
//   full        aktueller lokaler Stand (dieselbe Blob-Form wie in der Cloud)
//   base        Stand beim letzten erfolgreichen Abgleich mit der Cloud —
//               Grundlage, um echte Konflikte (dasselbe auf zwei Geräten
//               geändert) von bloß parallel offenen Geräten zu unterscheiden
//   dirtyKeys   Workspaces (Betriebe), die seit dem letzten Abgleich lokal
//               geändert wurden
//   sharedDirty Termine/Betriebsliste seit dem letzten Abgleich geändert
//   zuordnung   zuletzt gewählter Betrieb/Termin — nach einem Neustart der
//               App (z.B. weil das Handy den Tab geschlossen hat) geht es
//               beim selben Betrieb weiter statt bei "kein Betrieb"
//   user        { id, email } — für den Start ohne Netz, wenn die
//               Supabase-Session sich nicht erneuern lässt
// Dazu eine Liste von Sicherungen: bei einem Konflikt wird die jeweils
// verworfene Fassung aufbewahrt statt still überschrieben.

const DB_NAME = 'feldfolio-offline';
const DB_VERSION = 1;
const STATE_STORE = 'state';
const BACKUP_STORE = 'backups';
const META_KEY = '__meta__';
const MAX_BACKUPS_PER_USER = 10;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB nicht verfügbar')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
        if (!db.objectStoreNames.contains(BACKUP_STORE)) {
          const store = db.createObjectStore(BACKUP_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('userId', 'userId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Ein fehlgeschlagener Öffnungsversuch soll beim nächsten Aufruf neu
    // probiert werden können, statt die App dauerhaft ohne Speicher zu lassen.
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB-Transaktion abgebrochen'));
  }));
}

function requestResult(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readLocalState(userId) {
  if (!userId) return null;
  return run(STATE_STORE, 'readonly', store => requestResult(store.get(userId))).then(r => r || null);
}

export async function writeLocalState(userId, record) {
  if (!userId) return;
  await run(STATE_STORE, 'readwrite', store => requestResult(store.put({ ...record, savedAt: new Date().toISOString() }, userId)));
}

export async function deleteLocalState(userId) {
  if (!userId) return;
  await run(STATE_STORE, 'readwrite', store => requestResult(store.delete(userId)));
}

// Zuletzt angemeldeter Nutzer — damit die App auch ohne Netz (und ohne
// erneuerbare Supabase-Session) wieder beim eigenen Stand startet.
export async function readLastUser() {
  return run(STATE_STORE, 'readonly', store => requestResult(store.get(META_KEY)))
    .then(meta => (meta && meta.lastUser) || null)
    .catch(() => null);
}

export async function writeLastUser(user) {
  await run(STATE_STORE, 'readwrite', store => requestResult(store.put({ lastUser: user || null }, META_KEY)));
}

export async function addBackup(userId, reason, full) {
  if (!userId || !full) return;
  await run(BACKUP_STORE, 'readwrite', async store => {
    await requestResult(store.add({ userId, reason, full, createdAt: new Date().toISOString() }));
    const keys = await requestResult(store.index('userId').getAllKeys(userId));
    // Älteste zuerst (autoIncrement) — nur die letzten Sicherungen behalten.
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_BACKUPS_PER_USER))) {
      await requestResult(store.delete(key));
    }
  });
}

export async function listBackups(userId) {
  if (!userId) return [];
  return run(BACKUP_STORE, 'readonly', store => requestResult(store.index('userId').getAll(userId)));
}
