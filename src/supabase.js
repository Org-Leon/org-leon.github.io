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

// Pfad bewusst flach unter der user_id abgelegt (keine Kennung von Fläche/
// Baum enthalten) — welches Foto zu welcher Fläche gehört, ergibt sich
// allein daraus, dass der zurückgegebene Pfad im photos-Array dieser Fläche
// steht (siehe main.js). Die Storage-RLS-Policy prüft nur den user_id-Ordner.
export async function uploadPhoto(file) {
  if (!supabase) throw new Error('Cloud-Konto ist nicht konfiguriert.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht angemeldet.');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg'
  });
  if (error) throw error;
  return path;
}

// Bucket ist privat — Anzeige läuft über zeitlich begrenzte Signed URLs statt
// dauerhafter öffentlicher Links (Datenschutz-Vorgabe).
export async function getPhotoUrl(path) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
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
