// ---------- FeldFolio Plus: Supabase-Anbindung ----------
// Dünner Wrapper um @supabase/supabase-js — hält die Authentifizierung
// (E-Mail/Passwort) und das Speichern/Laden des kompletten Arbeitsstands als
// ein JSON-Blob pro Nutzer (Tabelle "feldfolio_state", siehe Migrations-SQL
// im Plan). Läuft absichtlich ohne Fehler, wenn keine Zugangsdaten gesetzt
// sind (z.B. auf anderen Branches oder lokal ohne .env) — der Rest der App
// bleibt dann unverändert nutzbar, nur der Cloud-Bereich zeigt einen Hinweis.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const STATE_TABLE = 'feldfolio_state';
const PHOTO_BUCKET = 'feldfolio-photos';

export async function signUp(email, password) {
  // Dev-only Testhaken (Konto-Tests ohne echten Server), wie __ffTestUploadPhotoOverride.
  if (import.meta.env.DEV && window.__ffTestAuth && window.__ffTestAuth.signUp) return window.__ffTestAuth.signUp(email, password);
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  if (import.meta.env.DEV && window.__ffTestAuth && window.__ffTestAuth.signIn) return window.__ffTestAuth.signIn(email, password);
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (import.meta.env.DEV && window.__ffTestAuth && window.__ffTestAuth.signOut) return window.__ffTestAuth.signOut();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Ohne Netz schlagen Uploads/Signed URLs ohnehin fehl — mit einer klaren
// Meldung statt eines kryptischen "Failed to fetch".
function assertOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Keine Internetverbindung — Fotos und Dateien lassen sich nur online hochladen bzw. öffnen.');
  }
}

// Behält denselben Datensatz je Nutzer (Primärschlüssel user_id) — "Cloud
// speichern" ersetzt also immer den vorherigen Stand, kein Verlauf/mehrere
// Projekte in diesem ersten Ausbauschritt. Liefert den neuen updated_at-
// Zeitstempel zurück (Grundlage des Offline-Abgleichs in main.js).
export async function saveState(data) {
  if (import.meta.env.DEV && window.__ffTestCloud) return window.__ffTestCloud.save(data);
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht angemeldet.');
  const updatedAt = new Date().toISOString();
  const { error } = await supabase
    .from(STATE_TABLE)
    .upsert({ user_id: user.id, data, updated_at: updatedAt });
  if (error) throw error;
  return updatedAt;
}

// Sofort-Abgleich zwischen den Geräten eines Nutzers: Nach jedem Speichern
// sendet ein Gerät über einen Realtime-Broadcast-Kanal nur ein kurzes
// "es gibt Neues" (keine Daten) — die anderen Geräte holen dann sofort ab
// statt auf den nächsten 30-s-Takt zu warten. Broadcast braucht keine
// Datenbank-Einrichtung. Ohne Supabase (Tests, lokal) -> null.
export function oeffneSyncKanal(userId, onPing) {
  if (!supabase || !userId) return null;
  const kanal = supabase.channel('ff-sync-' + userId, { config: { broadcast: { self: false } } });
  kanal.on('broadcast', { event: 'geaendert' }, (msg) => onPing(msg && msg.payload));
  kanal.subscribe();
  return {
    senden: (payload = {}) => { kanal.send({ type: 'broadcast', event: 'geaendert', payload }).catch(() => {}); },
    schliessen: () => { supabase.removeChannel(kanal); }
  };
}

export async function loadState() {
  if (import.meta.env.DEV && window.__ffTestCloud) return window.__ffTestCloud.load();
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht angemeldet.');
  const { data, error } = await supabase
    .from(STATE_TABLE)
    .select('data, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data; // null, falls noch nie gespeichert wurde
}

// crypto.randomUUID() ist nur in "sicheren Kontexten" verfügbar (HTTPS oder
// localhost) — ruft man die App über die lokale Netzwerk-IP per HTTP auf
// (z.B. vom Handy aus, siehe vite.config.js host:true), fehlt die Funktion
// und der Foto-Upload bricht mit "crypto.randomUUID is not a function" ab.
// crypto.getRandomValues() bleibt dagegen immer verfügbar, daher hier ein
// eigener RFC4122-v4-Fallback statt der Bequemlichkeitsfunktion.
function randomUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Pfad bewusst flach unter der user_id abgelegt (keine Kennung von Fläche/
// Baum enthalten) — welches Foto zu welcher Fläche gehört, ergibt sich
// allein daraus, dass der zurückgegebene Pfad im photos-Array dieser Fläche
// steht (siehe main.js). Die Storage-RLS-Policy prüft nur den user_id-Ordner.
export async function uploadPhoto(file) {
  // Dev-only Testhaken (z.B. für den Dokumentenscanner-Regressionstest):
  // erlaubt, den Cloud-Upload ohne echten Login zu stubben, analog zu
  // window.__ffTestMap/__ffTestTk in main.js — im Produktions-Build per
  // Dead-Code-Elimination entfernt.
  if (import.meta.env.DEV && window.__ffTestUploadPhotoOverride) {
    return window.__ffTestUploadPhotoOverride(file);
  }
  assertOnline();
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht angemeldet.');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${user.id}/${randomUuid()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg'
  });
  if (error) throw error;
  return path;
}

// Bucket ist privat — Anzeige läuft über zeitlich begrenzte Signed URLs statt
// dauerhafter öffentlicher Links (Datenschutz-Vorgabe). downloadName (optional)
// setzt den Content-Disposition-Dateinamen, den der Browser beim Herunterladen/
// "Speichern unter" verwendet — z.B. das Jahr_Betrieb_Art-Namensschema, auch
// wenn der Storage-Pfad selbst weiterhin eine UUID ist.
export async function getPhotoUrl(path, downloadName) {
  // Dev-only Testhaken analog __ffTestUploadPhotoOverride (Dokumentenviewer-Tests).
  if (import.meta.env.DEV && window.__ffTestPhotoUrlOverride) {
    return window.__ffTestPhotoUrlOverride(path, downloadName);
  }
  if (!supabase) return null;
  assertOnline();
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET)
    .createSignedUrl(path, 3600, downloadName ? { download: downloadName } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function deletePhoto(path) {
  if (!supabase) return;
  assertOnline();
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) throw error;
}

const ACCESS_REQUESTS_TABLE = 'access_requests';
const ACCESS_ALLOWLIST_TABLE = 'access_allowlist';

// Funktioniert bewusst auch ohne Login — die Registrierung selbst ist ja noch
// gesperrt, wenn eine Anfrage nötig ist (siehe RLS-Policy "anyone can submit
// a request").
export async function requestAccess({ email, name, message }) {
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { error } = await supabase
    .from(ACCESS_REQUESTS_TABLE)
    .insert({ email: email.trim().toLowerCase(), name: name || null, message: message || null });
  if (error) throw error;
}

// RLS lässt SELECT nur für @oekop.de-Sessions zu (siehe Migrations-SQL) —
// für alle anderen kommt hier einfach eine leere Liste zurück statt eines
// Fehlers, das Admin-UI zeigt sich dann ohnehin gar nicht erst an.
export async function listPendingAccessRequests() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(ACCESS_REQUESTS_TABLE)
    .select('id, email, name, message, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function approveAccessRequest(id, email) {
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { error: allowError } = await supabase
    .from(ACCESS_ALLOWLIST_TABLE)
    .upsert({ email: email.trim().toLowerCase() });
  if (allowError) throw allowError;
  const { error: statusError } = await supabase
    .from(ACCESS_REQUESTS_TABLE)
    .update({ status: 'approved' })
    .eq('id', id);
  if (statusError) throw statusError;
}

export async function declineAccessRequest(id) {
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { error } = await supabase
    .from(ACCESS_REQUESTS_TABLE)
    .update({ status: 'declined' })
    .eq('id', id);
  if (error) throw error;
}

// ---------- Konto: Passwort, Abmelden überall, Konto löschen ----------

// Verständliche deutsche Meldungen statt der englischen Supabase-Texte.
export function authErrorMessage(err, fallback = 'Das hat nicht geklappt.') {
  const msg = String((err && (err.message || err.error_description)) || err || '');
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort stimmen nicht.';
  if (/email not confirmed/i.test(msg)) return 'Die E-Mail-Adresse ist noch nicht bestätigt — bitte den Link in der Bestätigungs-Mail öffnen.';
  if (/user already registered|already been registered/i.test(msg)) return 'Für diese E-Mail-Adresse gibt es bereits ein Konto — bitte anmelden.';
  if (/password should be at least|weak password|password is too short/i.test(msg)) return 'Das Passwort ist zu kurz oder zu einfach (mindestens 8 Zeichen).';
  if (/same password|different from the old/i.test(msg)) return 'Das neue Passwort muss sich vom bisherigen unterscheiden.';
  if (/rate limit|too many requests|security purposes/i.test(msg)) return 'Zu viele Versuche — bitte kurz warten und es dann erneut probieren.';
  if (/unable to validate email|invalid email|email address .* is invalid/i.test(msg)) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Keine Verbindung zum Server — bitte Internet prüfen.';
  if (/could not find the function|function .* does not exist|PGRST202/i.test(msg)) return 'Diese Funktion ist auf dem Server noch nicht eingerichtet (siehe supabase/konto-loeschen.sql).';
  return msg || fallback;
}

// Link zum Zurücksetzen per E-Mail. Die Adresse der App muss in Supabase
// unter Authentication → URL Configuration → Redirect URLs erlaubt sein.
export async function requestPasswordReset(email) {
  if (import.meta.env.DEV && window.__ffTestAuth && window.__ffTestAuth.requestPasswordReset) return window.__ffTestAuth.requestPasswordReset(email);
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  if (import.meta.env.DEV && window.__ffTestAuth && window.__ffTestAuth.updatePassword) return window.__ffTestAuth.updatePassword(newPassword);
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  assertOnline();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// Prüft das aktuelle Passwort (vor dem Ändern bzw. Konto löschen).
export async function verifyPassword(email, password) {
  if (import.meta.env.DEV && window.__ffTestAuth && window.__ffTestAuth.verifyPassword) return window.__ffTestAuth.verifyPassword(email, password);
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  assertOnline();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// Beendet die Anmeldung auf allen Geräten (alle Refresh-Tokens ungültig).
export async function signOutEverywhere() {
  if (import.meta.env.DEV && window.__ffTestAuth && window.__ffTestAuth.signOutEverywhere) return window.__ffTestAuth.signOutEverywhere();
  if (!supabase) return;
  assertOnline();
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) throw error;
}

// "Passwort vergessen"-Link geöffnet -> App soll "Neues Passwort" zeigen.
export function onPasswordRecovery(callback) {
  if (!supabase) return;
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') callback(session);
  });
}

// Konto löschen: zuerst alle eigenen Dateien im Speicher (Storage-API —
// Zeilen in storage.objects direkt zu löschen ließe die Dateien liegen),
// dann per RPC Arbeitsstand + Nutzer (Server-Funktion, siehe
// supabase/konto-loeschen.sql).
export async function deleteMyAccount() {
  if (import.meta.env.DEV && window.__ffTestAuth && window.__ffTestAuth.deleteMyAccount) return window.__ffTestAuth.deleteMyAccount();
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  assertOnline();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht angemeldet.');
  for (;;) {
    const { data: files, error } = await supabase.storage.from(PHOTO_BUCKET).list(user.id, { limit: 100 });
    if (error) throw error;
    if (!files || !files.length) break;
    const { error: rmError } = await supabase.storage.from(PHOTO_BUCKET).remove(files.map(f => `${user.id}/${f.name}`));
    if (rmError) throw rmError;
    if (files.length < 100) break;
  }
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
  await supabase.auth.signOut().catch(() => {});
}
