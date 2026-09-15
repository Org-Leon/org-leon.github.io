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
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Behält denselben Datensatz je Nutzer (Primärschlüssel user_id) — "Cloud
// speichern" ersetzt also immer den vorherigen Stand, kein Verlauf/mehrere
// Projekte in diesem ersten Ausbauschritt.
export async function saveState(data) {
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht angemeldet.');
  const { error } = await supabase
    .from(STATE_TABLE)
    .upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function loadState() {
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
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET)
    .createSignedUrl(path, 3600, downloadName ? { download: downloadName } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function deletePhoto(path) {
  if (!supabase) return;
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
