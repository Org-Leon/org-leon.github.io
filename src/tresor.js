// ---------- Geräteschutz: Verschlüsselung der Daten auf dem Gerät ----------
// Die Offline-Daten (Arbeitsstand, Sicherungen, wartende Uploads, Fotomappe,
// zwischengespeicherte Dokumente) liegen verschlüsselt im Browser. Nur Krypto,
// kein UI und kein Speicher — das machen offline-store.js und geraeteschutz.js.
//
// Schlüssel:
//   Datenschlüssel  zufällig (AES-GCM, 256 Bit), verschlüsselt damit alle Daten.
//                   Liegt nie im Klartext auf dem Gerät, nur nach dem Entsperren
//                   im Arbeitsspeicher (bis die App geschlossen wird).
//   Passwort        Konto-Passwort -> PBKDF2-SHA-256 (600.000 Runden, OWASP) ->
//                   Schlüssel, der den Datenschlüssel einpackt. Das Passwort
//                   selbst wird nirgends gespeichert.
//   Fingerabdruck   optional: WebAuthn-Erweiterung "prf" liefert nach Entsperren
//                   per Fingerabdruck/Gesicht/Geräte-PIN ein festes Geheimnis ->
//                   HKDF -> zweiter Einpack-Schlüssel. Nur auf Geräten, die das
//                   können (Windows Hello, Android, iOS 18+ …).
// Jeder verschlüsselte Datensatz ist an die Nutzer-ID gebunden (AES-GCM
// "additional data"), lässt sich also nicht einem anderen Konto unterschieben.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_RUNDEN = 600000;
const HKDF_INFO = enc.encode('FeldFolio Geraeteschutz v1');

export const zufall = (n) => crypto.getRandomValues(new Uint8Array(n));
const bytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

export function zuBase64(b) { let s = ''; bytes(b).forEach(x => { s += String.fromCharCode(x); }); return btoa(s); }
export function ausBase64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

export class TresorGesperrt extends Error {
  constructor() { super('Die Daten auf diesem Gerät sind gesperrt.'); this.name = 'TresorGesperrt'; }
}

async function einpackSchluesselAusPasswort(passwort, salt, runden) {
  const basis = await crypto.subtle.importKey('raw', enc.encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: runden },
    basis, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function einpackSchluesselAusPrf(prf, salt) {
  const basis = await crypto.subtle.importKey('raw', bytes(prf), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(salt), info: HKDF_INFO },
    basis, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Datenschlüssel: neu erzeugen / ein- und auspacken
export function neuerDatenschluessel() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function einpacken(einpack, schluessel) {
  const iv = zufall(12);
  const roh = await crypto.subtle.exportKey('raw', schluessel);
  return { iv, ct: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, einpack, roh)) };
}
async function auspacken(einpack, paket) {
  // falscher Schlüssel -> OperationError (AES-GCM prüft die Echtheit)
  const roh = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(paket.iv) }, einpack, bytes(paket.ct));
  // exportierbar, damit er sich nach einem Passwortwechsel neu einpacken lässt
  return crypto.subtle.importKey('raw', roh, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

// Tresor-Beschreibung (liegt im Klartext neben den Daten, enthält nichts Geheimes)
export async function tresorAnlegen(passwort) {
  const schluessel = await neuerDatenschluessel();
  const salt = zufall(16);
  const pw = await einpacken(await einpackSchluesselAusPasswort(passwort, salt, PBKDF2_RUNDEN), schluessel);
  return { schluessel, tresor: { v: 1, aktiv: true, salt, runden: PBKDF2_RUNDEN, pw } };
}
// null bei falschem Passwort
export async function mitPasswortOeffnen(tresor, passwort) {
  try { return await auspacken(await einpackSchluesselAusPasswort(passwort, tresor.salt, tresor.runden), tresor.pw); } catch { return null; }
}
// Passwort gewechselt: Datenschlüssel mit dem neuen Passwort neu einpacken
export async function passwortSetzen(tresor, schluessel, passwort) {
  const salt = zufall(16);
  const pw = await einpacken(await einpackSchluesselAusPasswort(passwort, salt, PBKDF2_RUNDEN), schluessel);
  return { ...tresor, salt, runden: PBKDF2_RUNDEN, pw };
}

// ---- Fingerabdruck / Gesicht (WebAuthn mit PRF) ----
export function biometrieMoeglich() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext;
}
async function prfAbfragen(credId, prfSalt) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: zufall(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: bytes(credId) }],
    extensions: { prf: { eval: { first: bytes(prfSalt) } } }
  } });
  const erg = cred && cred.getClientExtensionResults().prf;
  if (!erg || !erg.results || !erg.results.first) throw new Error('Dieses Gerät liefert keinen Schlüssel für die Entsperrung.');
  return new Uint8Array(erg.results.first);
}
// Neue Anmeldeinformation nur zum Entsperren dieses Geräts (kein Login beim Server)
export async function biometrieEinrichten(tresor, schluessel, { name, anzeige }) {
  const prfSalt = zufall(32);
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'FeldFolio', id: location.hostname },
    user: { id: zufall(16), name, displayName: anzeige },
    challenge: zufall(32), timeout: 60000,
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    extensions: { prf: { eval: { first: prfSalt } } }
  } });
  const ext = cred.getClientExtensionResults().prf;
  if (!ext || ext.enabled === false) throw new Error('Dieses Gerät unterstützt das Entsperren per Fingerabdruck oder Gesicht für Web-Apps nicht.');
  const credId = new Uint8Array(cred.rawId);
  // manche Geräte liefern den Wert schon beim Anlegen, sonst einmal abfragen
  const prf = ext.results && ext.results.first ? new Uint8Array(ext.results.first) : await prfAbfragen(credId, prfSalt);
  const salt = zufall(16);
  const paket = await einpacken(await einpackSchluesselAusPrf(prf, salt), schluessel);
  return { ...tresor, bio: { credId, prfSalt, salt, ...paket } };
}
export async function mitBiometrieOeffnen(tresor) {
  const prf = await prfAbfragen(tresor.bio.credId, tresor.bio.prfSalt);
  try { return await auspacken(await einpackSchluesselAusPrf(prf, tresor.bio.salt), tresor.bio); } catch { return null; }
}

// ---- Daten ver- und entschlüsseln ----
async function verschluesseln(schluessel, userId, daten) {
  const iv = zufall(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(userId) }, schluessel, daten);
  return { iv, ct: new Uint8Array(ct) };
}
function entschluesseln(schluessel, userId, paket) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(paket.iv), additionalData: enc.encode(userId) }, schluessel, bytes(paket.ct));
}
export const jsonVerschluesseln = (s, userId, wert) => verschluesseln(s, userId, enc.encode(JSON.stringify(wert)));
export async function jsonEntschluesseln(s, userId, paket) { return JSON.parse(dec.decode(await entschluesseln(s, userId, paket))); }
export async function blobVerschluesseln(s, userId, blob) {
  return { ...(await verschluesseln(s, userId, await blob.arrayBuffer())), type: blob.type || '' };
}
export async function blobEntschluesseln(s, userId, paket) {
  return new Blob([await entschluesseln(s, userId, paket)], { type: paket.type || '' });
}
