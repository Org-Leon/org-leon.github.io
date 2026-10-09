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
//
// Geräteschutz (tresor.js, geraeteschutz.js): Ist er für den Nutzer an, liegen
// Arbeitsstand, Sicherungen, Uploads und Fotomappe verschlüsselt hier
// ({ verschluesselt: { iv, ct } } statt der Daten). Lesen/Schreiben geht dann
// nur mit entsperrtem Schlüssel, sonst TresorGesperrt. Klartext-Datensätze
// (aus der Zeit vor dem Einschalten) bleiben lesbar und werden beim
// Einschalten umgeschrieben (datenUmschluesseln).
import { TresorGesperrt, jsonVerschluesseln, jsonEntschluesseln, blobVerschluesseln, blobEntschluesseln, zuBase64, ausBase64 } from './tresor.js';

const DB_NAME = 'feldfolio-offline';
const DB_VERSION = 3;
const STATE_STORE = 'state';
const BACKUP_STORE = 'backups';
// Fotos/Dateien, die noch hochgeladen werden müssen (inkl. Datei als Blob) —
// überleben so ein Neuladen des Tabs (z. B. wenn Android den Browser beim
// Öffnen der Kamera beendet) und fehlenden Empfang.
const UPLOAD_STORE = 'uploads';
// Entwürfe der Fotomappe (mehrere Fotos -> eine PDF), noch nicht hochgeladen.
const FOTOMAPPE_STORE = 'fotomappe';
// Fehlerberichte, die ohne Netz geschrieben wurden (fehlerbericht.js) — gehen
// raus, sobald wieder Verbindung da ist.
const FEHLER_STORE = 'fehlerberichte';
const META_KEY = '__meta__';
const TRESOR_PREFIX = '__tresor__:'; // Tresor-Beschreibung je Nutzer (nichts Geheimes)
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
        [UPLOAD_STORE, FOTOMAPPE_STORE, FEHLER_STORE].forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            store.createIndex('userId', 'userId');
          }
        });
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

// ---- Geräteschutz: Tresor-Beschreibung und entsperrter Schlüssel ----
let offen = null; // { userId, schluessel } — nur im Arbeitsspeicher
const tresorCache = new Map();
export async function tresorLesen(userId) {
  if (!userId) return null;
  if (!tresorCache.has(userId)) {
    tresorCache.set(userId, await run(STATE_STORE, 'readonly', store => requestResult(store.get(TRESOR_PREFIX + userId))).then(r => r || null));
  }
  return tresorCache.get(userId);
}
export async function tresorSchreiben(userId, tresor) {
  if (!userId) return;
  await run(STATE_STORE, 'readwrite', store => requestResult(tresor ? store.put(tresor, TRESOR_PREFIX + userId) : store.delete(TRESOR_PREFIX + userId)));
  tresorCache.set(userId, tresor || null);
}
export function schluesselSetzen(userId, schluessel) { offen = schluessel ? { userId, schluessel } : null; }
export function schluesselFuer(userId) { return offen && offen.userId === userId ? offen.schluessel : null; }
// Schlüssel zum Schreiben: null = unverschlüsselt speichern (Schutz aus)
async function schreibSchluessel(userId) {
  const t = await tresorLesen(userId);
  if (!t || !t.aktiv) return null;
  const s = schluesselFuer(userId);
  if (!s) throw new TresorGesperrt();
  return s;
}
function leseSchluessel(userId) {
  const s = schluesselFuer(userId);
  if (!s) throw new TresorGesperrt();
  return s;
}

export async function readLocalState(userId) {
  if (!userId) return null;
  const r = await run(STATE_STORE, 'readonly', store => requestResult(store.get(userId)));
  if (!r) return null;
  if (r.verschluesselt) return jsonEntschluesseln(leseSchluessel(userId), userId, r.verschluesselt);
  return r;
}
// Liegt ein Stand vor? (ohne ihn zu entschlüsseln — für den Start ohne Netz)
export async function hatLocalState(userId) {
  if (!userId) return false;
  return run(STATE_STORE, 'readonly', store => requestResult(store.getKey(userId))).then(k => k !== undefined).catch(() => false);
}

export async function writeLocalState(userId, record) {
  if (!userId) return;
  const s = await schreibSchluessel(userId);
  const daten = { ...record, savedAt: new Date().toISOString() };
  const wert = s ? { verschluesselt: await jsonVerschluesseln(s, userId, daten), savedAt: daten.savedAt } : daten;
  await run(STATE_STORE, 'readwrite', store => requestResult(store.put(wert, userId)));
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
  const s = await schreibSchluessel(userId);
  const daten = s ? { verschluesselt: await jsonVerschluesseln(s, userId, full) } : { full };
  await run(BACKUP_STORE, 'readwrite', async store => {
    await requestResult(store.add({ userId, reason, ...daten, createdAt: new Date().toISOString() }));
    const keys = await requestResult(store.index('userId').getAllKeys(userId));
    // Älteste zuerst (autoIncrement) — nur die letzten Sicherungen behalten.
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_BACKUPS_PER_USER))) {
      await requestResult(store.delete(key));
    }
  });
}

export async function listBackups(userId) {
  if (!userId) return [];
  const liste = await run(BACKUP_STORE, 'readonly', store => requestResult(store.index('userId').getAll(userId)));
  return Promise.all(liste.map(async b => {
    if (!b.verschluesselt) return b;
    const { verschluesselt, ...rest } = b;
    return { ...rest, full: await jsonEntschluesseln(leseSchluessel(userId), userId, verschluesselt) };
  }));
}

// ---- Upload-Warteschlange / Fotomappe ----
// Datensätze mit { id, userId, ..., blob }; je Nutzer abrufbar. Verschlüsselt
// bleiben nur id und userId lesbar (für Index und Löschen).
async function putItem(storeName, rec) {
  const s = await schreibSchluessel(rec.userId);
  let wert = rec;
  if (s) {
    const { id, userId, blob, ...meta } = rec;
    wert = { id, userId, verschluesselt: await jsonVerschluesseln(s, userId, meta), blobV: blob ? await blobVerschluesseln(s, userId, blob) : null };
  }
  return run(storeName, 'readwrite', store => requestResult(store.put(wert)));
}
async function listItems(storeName, userId) {
  if (!userId) return [];
  const liste = await run(storeName, 'readonly', store => requestResult(store.index('userId').getAll(userId)));
  return Promise.all(liste.map(async r => {
    if (!r.verschluesselt) return r;
    const s = leseSchluessel(userId);
    const meta = await jsonEntschluesseln(s, userId, r.verschluesselt);
    return { ...meta, id: r.id, userId: r.userId, ...(r.blobV ? { blob: await blobEntschluesseln(s, userId, r.blobV) } : {}) };
  }));
}
function deleteItem(storeName, id) {
  return run(storeName, 'readwrite', store => requestResult(store.delete(id)));
}
export const saveQueuedUpload = (rec) => putItem(UPLOAD_STORE, rec);
export const listQueuedUploads = (userId) => listItems(UPLOAD_STORE, userId);
export const deleteQueuedUpload = (id) => deleteItem(UPLOAD_STORE, id);
export const saveFotomappeFoto = (rec) => putItem(FOTOMAPPE_STORE, rec);
export const listFotomappeFotos = (userId) => listItems(FOTOMAPPE_STORE, userId);
export const deleteFotomappeFoto = (id) => deleteItem(FOTOMAPPE_STORE, id);
export const saveFehlerbericht = (rec) => putItem(FEHLER_STORE, rec);
export const listFehlerberichte = (userId) => listItems(FEHLER_STORE, userId);
export const deleteFehlerbericht = (id) => deleteItem(FEHLER_STORE, id);

// Nach dem Ein- oder Ausschalten des Geräteschutzes: alle Daten des Nutzers
// einmal lesen und im jetzt gültigen Modus neu schreiben (braucht den Schlüssel,
// falls noch Verschlüsseltes dabei ist).
export async function datenUmschluesseln(userId) {
  if (!userId) return;
  const stand = await readLocalState(userId);
  if (stand) { delete stand.savedAt; await writeLocalState(userId, stand); }
  const s = await schreibSchluessel(userId);
  for (const b of await listBackups(userId)) {
    const { full, ...rest } = b;
    const daten = s ? { verschluesselt: await jsonVerschluesseln(s, userId, full) } : { full };
    await run(BACKUP_STORE, 'readwrite', store => requestResult(store.put({ ...rest, ...daten })));
  }
  for (const name of [UPLOAD_STORE, FOTOMAPPE_STORE, FEHLER_STORE]) {
    for (const r of await listItems(name, userId)) await putItem(name, r);
  }
}

// Alles dieses Nutzers vom Gerät entfernen (Abmelden mit Löschen, Gerätedaten
// verwerfen): Stand, Sicherungen, Uploads, Fotomappe, Tresor.
export async function alleDatenLoeschen(userId) {
  if (!userId) return;
  await deleteLocalState(userId);
  for (const name of [BACKUP_STORE, UPLOAD_STORE, FOTOMAPPE_STORE, FEHLER_STORE]) {
    await run(name, 'readwrite', async store => {
      const keys = await requestResult(store.index('userId').getAllKeys(userId));
      for (const k of keys) await requestResult(store.delete(k));
    });
  }
  await tresorSchreiben(userId, null);
  if (offen && offen.userId === userId) offen = null;
}

// ---- Zwischengespeicherte Dokumente (Cache API, main.js loadDocBlob) ----
// Bei aktivem Geräteschutz verschlüsselt ablegen; Schlüssel/IV in Kopfzeilen.
// null = nicht ablegen bzw. nicht lesbar (gesperrt, anderes Konto).
export async function cacheVerpacken(userId, blob, type) {
  let s;
  try { s = await schreibSchluessel(userId); } catch { return null; }
  if (!s) return new Response(blob, { headers: { 'Content-Type': type || blob.type || 'application/octet-stream' } });
  const p = await blobVerschluesseln(s, userId, blob);
  return new Response(p.ct, { headers: { 'Content-Type': 'application/octet-stream', 'X-FF-IV': zuBase64(p.iv), 'X-FF-Typ': type || p.type } });
}
export async function cacheAuspacken(userId, res) {
  const iv = res.headers.get('X-FF-IV');
  if (!iv) return res.blob();
  const s = schluesselFuer(userId);
  if (!s) return null;
  try {
    return await blobEntschluesseln(s, userId, { iv: ausBase64(iv), ct: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('X-FF-Typ') || '' });
  } catch { return null; }
}
