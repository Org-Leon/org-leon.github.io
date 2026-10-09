// ---------- Fehler melden (Fehlerberichte) ----------
// Nutzer melden Fehler, Verbesserungen und Fragen aus der App heraus; jede
// Meldung landet als Vorgang mit Nummer in Supabase (supabase/fehlerberichte.sql)
// und wird von Admins unter Konto → Verwaltung → Fehlerberichte bearbeitet.
//
// Aufbau wie ein üblicher Fehlerbericht: Art, Kurzbeschreibung, Schritte zum
// Nachstellen, erwartetes und tatsächliches Verhalten, Auswirkung, Häufigkeit,
// Umgebung (Version, Browser, Gerät, Ansicht …) und ein Protokoll der letzten
// Fehlermeldungen und Klicks. Was mitgeht, sieht der Nutzer vor dem Senden.
//
// Datenschutz: Das Protokoll enthält keine Inhalte — nur Fehlertexte (bereinigt:
// E-Mail-Adressen, Schlüssel, lange Nummern und Adressen entfernt), die IDs
// angeklickter Bedienelemente und Ansichtswechsel. Das Bildschirmfoto ist
// freiwillig und standardmäßig nicht angehakt. Ohne Netz wird die Meldung auf
// dem Gerät vorgemerkt (offline-store.js, bei Geräteschutz verschlüsselt).
import { domToJpeg } from 'modern-screenshot';
import { fehlerberichtSenden, fehlerberichteLaden, fehlerberichtBild, fehlerberichtAktualisieren } from './supabase.js';
import { saveFehlerbericht, listFehlerberichte, deleteFehlerbericht } from './offline-store.js';

const MAX_PROTOKOLL = 60;
const MAX_BILD_ZEICHEN = 1400000; // Grenze der Tabelle: 1.500.000
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ARTEN = { fehler: 'Fehler', verbesserung: 'Verbesserung', frage: 'Frage' };
export const SCHWERE = { kritisch: 'Kritisch', hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig' };
export const HAEUFIGKEIT = { immer: 'Jedes Mal', manchmal: 'Manchmal', einmal: 'Einmal', unbekannt: 'Weiß nicht' };
export const STATUS = { neu: 'Neu', bestaetigt: 'Bestätigt', in_arbeit: 'In Arbeit', erledigt: 'Erledigt', abgelehnt: 'Abgelehnt', duplikat: 'Duplikat' };
export const PRIORITAET = { p1: 'P1 – sofort', p2: 'P2 – bald', p3: 'P3 – normal', p4: 'P4 – irgendwann' };
const OFFEN = new Set(['neu', 'bestaetigt', 'in_arbeit']);

// ---- Protokoll: läuft ab dem Start der App mit ----
const protokoll = [];
let beiFehler = null; // vom Modul gesetzt: Hinweis "Fehler melden?" anbieten

// Persönliches und Geheimes aus Texten entfernen
export function bereinigen(text, max = 500) {
  return String(text ?? '')
    .replace(/https?:\/\/[^\s)'"]*\/([^/\s?)#'"]+)(?:[?#][^\s)'":]*)?/g, '$1')     // Adressen -> nur Dateiname
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<E-Mail>')
    .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+/g, '<Token>')
    .replace(/(access_token|refresh_token|apikey|token|key)=[^&\s]+/gi, '$1=<entfernt>')
    .replace(/\b(DE|AT)?[ \d]{9,}\b/g, ' <Nummer>')                                // Ohrmarken, Telefon, Betriebsnummern
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
function merken(art, text) {
  protokoll.push({ t: new Date().toISOString(), art, text: bereinigen(text) });
  if (protokoll.length > MAX_PROTOKOLL) protokoll.splice(0, protokoll.length - MAX_PROTOKOLL);
}
// Bedienelement beschreiben, ohne seinen Text (kann Betriebsnamen enthalten)
function beschreiben(el) {
  if (el.id) return '#' + el.id;
  for (const a of ['data-view', 'data-ko-tab', 'data-km-tab', 'data-account-tab', 'data-w-akt', 'data-ko-akt', 'data-tool', 'name']) {
    if (el.hasAttribute(a)) return `${el.tagName.toLowerCase()}[${a}=${String(el.getAttribute(a)).slice(0, 40)}]`;
  }
  const mitId = el.parentElement && el.parentElement.closest('[id]');
  return `${el.tagName.toLowerCase()}${el.classList[0] ? '.' + el.classList[0] : ''}${mitId ? ' in #' + mitId.id : ''}`;
}

export function protokollStarten() {
  window.addEventListener('error', (e) => {
    if (!e.message && e.target && e.target !== window) return; // Ladefehler von Bildern/Kacheln: kein Programmfehler
    const ort = e.filename ? ` (${bereinigen(e.filename)}:${e.lineno}:${e.colno})` : '';
    merken('fehler', (e.message || 'Fehler') + ort + (e.error && e.error.stack ? ' | ' + e.error.stack : ''));
    if (beiFehler) beiFehler((e.error && e.error.message) || e.message || 'Fehler');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    merken('fehler', 'Unbehandelt: ' + (r && (r.message || r.toString()) || 'unbekannt') + (r && r.stack ? ' | ' + r.stack : ''));
    if (beiFehler) beiFehler(r && r.message ? r.message : 'Fehler');
  });
  ['error', 'warn'].forEach(stufe => {
    const original = console[stufe];
    console[stufe] = (...args) => {
      try { merken(stufe === 'error' ? 'konsole' : 'warnung', args.map(a => (a instanceof Error ? a.message : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch { return String(a); } })() : String(a))).join(' ')); } catch { /* nie stören */ }
      return original.apply(console, args);
    };
  });
  document.addEventListener('securitypolicyviolation', (e) => merken('fehler', `Sicherheitsregel blockiert: ${e.violatedDirective} ${bereinigen(e.blockedURI, 120)}`));
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('button, a, [role="tab"], [data-view], input, select, summary');
    if (el && !el.closest('#fb-overlay')) merken('klick', beschreiben(el));
  }, { capture: true, passive: true });
  const ansicht = () => merken('ansicht', document.body.dataset.view || 'viewer');
  new MutationObserver(ansicht).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  window.addEventListener('online', () => merken('netz', 'online'));
  window.addEventListener('offline', () => merken('netz', 'offline'));
}

// hooks: {
//   user()          angemeldeter Nutzer { id, email } oder null
//   istAdmin()      Admin der Kontrollstelle?
//   appZustand()    Zustand der App für die Umgebung (Ansicht, Sync, …), ohne Inhalte
//   bildAnsehen(blob, name)   Bild im Dokumentenviewer zeigen
//   toast(text)
//   hinweisAktiv()  Hinweis bei Programmfehlern anbieten? (in Tests aus)
//   adminZahlAktualisieren()  Zähler offener Vorgänge im Konto-Menü auffrischen
// }
export function fehlerberichtEinrichten(hooks) {
  const $ = (id) => document.getElementById(id);
  const ov = $('fb-overlay');
  let bild = null;          // data-URL des Bildschirmfotos (Vorschau)
  let bildAusDatei = false;
  let umgebung = null;
  let sendet = false;

  // ---- Umgebung ----
  async function umgebungSammeln() {
    const nav = navigator;
    const ua = nav.userAgentData;
    let details = null;
    try { details = ua && await ua.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList']); } catch { /* */ }
    let speicher = null;
    try { const e = await nav.storage.estimate(); speicher = `${Math.round(e.usage / 1e6)} MB von ${Math.round(e.quota / 1e6)} MB`; } catch { /* */ }
    const browser = details && details.fullVersionList
      ? details.fullVersionList.filter(b => !/Not.?A.?Brand/i.test(b.brand)).map(b => `${b.brand} ${b.version}`).join(', ')
      : (nav.userAgent.match(/(Firefox|Edg|OPR|Chrome|Version)\/[\d.]+/g) || []).join(' ');
    const abfrage = [...new URLSearchParams(location.search).keys()];
    return {
      version: typeof __FF_VERSION__ !== 'undefined' ? __FF_VERSION__ : '?',
      commit: typeof __FF_COMMIT__ !== 'undefined' ? __FF_COMMIT__ : '',
      build: typeof __FF_BUILD__ !== 'undefined' ? __FF_BUILD__ : '',
      zeit: new Date().toISOString(),
      zeitzone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      browser,
      userAgent: nav.userAgent,
      system: [ua ? ua.platform : nav.platform, details && details.platformVersion].filter(Boolean).join(' '),
      geraet: details && details.model ? details.model : (ua && ua.mobile ? 'Mobilgerät' : ''),
      sprache: nav.language,
      bildschirm: `${screen.width}×${screen.height}, Faktor ${window.devicePixelRatio}`,
      fenster: `${window.innerWidth}×${window.innerHeight}`,
      touch: nav.maxTouchPoints || 0,
      arbeitsspeicherGB: nav.deviceMemory || null,
      online: nav.onLine,
      installiert: window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
      serviceWorker: !!(nav.serviceWorker && nav.serviceWorker.controller),
      speicher,
      seite: location.pathname + (abfrage.length ? ' ?' + abfrage.join('&') : ''),
      ...hooks.appZustand()
    };
  }

  // ---- Bildschirmfoto der aktuellen Ansicht (ohne dieses Fenster) ----
  const PLATZHALTER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  async function bildschirmfoto() {
    const breite = window.innerWidth;
    const optionen = (qualitaet, faktor) => ({
      width: breite, height: window.innerHeight, scale: faktor, quality: qualitaet,
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
      timeout: 8000,
      // nur Sichtbares abbilden: ausgeblendete Ansichten und Fenster gar nicht erst kopieren (spart viel Zeit)
      filter: (n) => !(n.nodeType === 1 && (n.hidden || n.id === 'fb-overlay' || n.id === 'fb-hinweis' || n.id === 'gs-overlay'
        || n.tagName === 'SCRIPT' || n.tagName === 'TEMPLATE' || (n.getClientRects && !n.getClientRects().length && getComputedStyle(n).display === 'none'))),
      // fremde Server (Kartenkacheln, CDN-Grafiken) nicht abfragen: Sicherheitsregeln
      fetchFn: async (url) => {
        try { const u = new URL(url, location.href); return (u.origin === location.origin || u.protocol === 'data:' || u.protocol === 'blob:') ? false : PLATZHALTER; } catch { return PLATZHALTER; }
      },
      fetch: { placeholderImage: PLATZHALTER }
    });
    let faktor = Math.min(1, 1400 / breite);
    let url = await domToJpeg(document.body, optionen(0.72, faktor));
    for (let i = 0; i < 3 && url.length > MAX_BILD_ZEICHEN; i++) { faktor *= 0.7; url = await domToJpeg(document.body, optionen(0.6, faktor)); }
    return url.length > MAX_BILD_ZEICHEN ? null : url;
  }
  // eigenes Bild (z. B. Bildschirmfoto des Geräts) verkleinern und als JPEG
  async function bildAusDateiLesen(datei) {
    const bmp = await createImageBitmap(datei);
    const f = Math.min(1, 1400 / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let q = 0.75, url = c.toDataURL('image/jpeg', q);
    while (url.length > MAX_BILD_ZEICHEN && q > 0.3) { q -= 0.15; url = c.toDataURL('image/jpeg', q); }
    return url.length > MAX_BILD_ZEICHEN ? null : url;
  }
  function bildZeigen() {
    $('fb-bild-vorschau').hidden = !bild;
    if (bild) $('fb-bild-vorschau').src = bild;
    $('fb-bild-an').disabled = !bild;
    if (!bild) $('fb-bild-an').checked = false;
  }

  // ---- Dialog ----
  function artAnzeigen() {
    const art = ov.querySelector('input[name="fb-art"]:checked').value;
    ov.querySelectorAll('.fb-nur-fehler').forEach(el => { el.hidden = art !== 'fehler'; });
    $('fb-schwere-feld').hidden = art === 'frage';
    $('fb-schritte-label').textContent = art === 'fehler' ? 'Was hast du gemacht? (Schritte zum Nachstellen)' : art === 'verbesserung' ? 'Was soll besser werden — und wofür brauchst du es?' : 'Deine Frage';
    $('fb-titel-kopf').textContent = { fehler: 'Fehler melden', verbesserung: 'Verbesserung vorschlagen', frage: 'Frage stellen' }[art];
  }
  function technikZeigen() {
    if (!umgebung) return;
    const zeilen = Object.entries(umgebung).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    $('fb-technik-text').textContent = zeilen.join('\n') + '\n\nProtokoll (' + protokoll.length + ' Einträge):\n'
      + protokoll.map(p => `${p.t.slice(11, 19)} ${p.art.padEnd(8)} ${p.text}`).join('\n');
  }
  function status(text, art = '') {
    $('fb-status').textContent = text;
    $('fb-status').classList.toggle('modal-error', art === 'error');
    $('fb-status').classList.toggle('is-ok', art === 'ok');
  }
  function reiter(name) {
    ov.querySelectorAll('[data-fb-reiter]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.fbReiter === name)));
    $('fb-form').hidden = name !== 'neu';
    $('fb-meine').hidden = name !== 'meine';
    if (name === 'meine') meineZeigen();
  }

  async function oeffnen({ art = 'fehler', tatsaechlich = '' } = {}) {
    if (!hooks.user()) { hooks.toast('Zum Melden bitte anmelden.'); return; }
    $('fb-form').reset();
    ov.querySelector(`input[name="fb-art"][value="${art}"]`).checked = true;
    $('fb-tatsaechlich').value = tatsaechlich;
    bild = null; bildAusDatei = false; umgebung = null;
    bildZeigen();
    $('fb-bild-status').textContent = 'Bildschirmfoto wird vorbereitet …';
    status('');
    artAnzeigen();
    reiter('neu');
    // erst das Foto vom unveränderten Bildschirm, dann das Fenster zeigen
    const foto = bildschirmfoto().catch(() => null);
    ov.hidden = false;
    $('fb-titel').focus();
    umgebung = await umgebungSammeln();
    technikZeigen();
    const url = await foto;
    if (!bildAusDatei) {
      bild = url;
      bildZeigen();
      $('fb-bild-status').textContent = url ? '' : 'Ein Bildschirmfoto ließ sich hier nicht erstellen — du kannst ein eigenes Bild wählen.';
    }
    warteschlangeSenden();
  }
  function schliessen() { ov.hidden = true; }

  ov.addEventListener('change', (e) => { if (e.target.name === 'fb-art') artAnzeigen(); });
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('#fb-schliessen, #fb-abbrechen')) schliessen();
    const r = e.target.closest('[data-fb-reiter]');
    if (r) reiter(r.dataset.fbReiter);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) schliessen(); });
  $('fb-bild-vorschau').addEventListener('click', () => { if (bild) fetch(bild).then(r => r.blob()).then(b => hooks.bildAnsehen(b, 'Bildschirmfoto.jpg')).catch(() => {}); });
  $('fb-bild-datei').addEventListener('change', async (e) => {
    const datei = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!datei) return;
    try {
      const url = await bildAusDateiLesen(datei);
      if (!url) { $('fb-bild-status').textContent = 'Das Bild ist zu groß.'; return; }
      bild = url; bildAusDatei = true;
      bildZeigen();
      $('fb-bild-an').checked = true;
      $('fb-bild-status').textContent = 'Eigenes Bild gewählt.';
    } catch { $('fb-bild-status').textContent = 'Das Bild ließ sich nicht lesen.'; }
  });

  $('fb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sendet) return;
    const user = hooks.user();
    if (!user) { status('Zum Melden bitte anmelden.', 'error'); return; }
    const titel = $('fb-titel').value.trim();
    if (titel.length < 3) { status('Bitte kurz beschreiben, worum es geht (mindestens 3 Zeichen).', 'error'); $('fb-titel').focus(); return; }
    const art = ov.querySelector('input[name="fb-art"]:checked').value;
    const zeile = {
      client_id: crypto.randomUUID(),
      art,
      titel: titel.slice(0, 200),
      schritte: $('fb-schritte').value.trim().slice(0, 5000),
      erwartet: art === 'fehler' ? $('fb-erwartet').value.trim().slice(0, 3000) : '',
      tatsaechlich: art === 'fehler' ? $('fb-tatsaechlich').value.trim().slice(0, 5000) : '',
      schwere: art === 'frage' ? 'niedrig' : $('fb-schwere').value,
      haeufigkeit: art === 'fehler' ? $('fb-haeufigkeit').value : 'unbekannt',
      umgebung: umgebung || await umgebungSammeln(),
      protokoll: protokoll.slice(-MAX_PROTOKOLL),
      screenshot: $('fb-bild-an').checked && bild ? bild : null
    };
    sendet = true;
    $('fb-senden').disabled = true;
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
      const { nummer } = await fehlerberichtSenden(zeile);
      status(nummer ? `Danke! Gemeldet als #${nummer}.` : 'Danke! Deine Meldung ist angekommen.', 'ok');
      hooks.toast(nummer ? `Meldung #${nummer} gesendet — danke!` : 'Meldung gesendet — danke!');
      setTimeout(schliessen, 1200);
    } catch (err) {
      if (err.offline || !navigator.onLine || /fetch|network|netz/i.test(String(err.message))) {
        await saveFehlerbericht({ id: zeile.client_id, userId: user.id, zeile, erstellt: Date.now() });
        status('Ohne Internet gespeichert — wird automatisch gesendet, sobald wieder Verbindung da ist.', 'ok');
        hooks.toast('Meldung gespeichert — wird gesendet, sobald Internet da ist.');
        setTimeout(schliessen, 1500);
      } else {
        status(err.message || 'Senden hat nicht geklappt.', 'error');
      }
    } finally {
      sendet = false;
      $('fb-senden').disabled = false;
    }
  });

  // ---- Ohne Netz vorgemerkte Meldungen nachsenden ----
  let nachsenden = null;
  function warteschlangeSenden() {
    const user = hooks.user();
    if (!user || !navigator.onLine || nachsenden) return nachsenden;
    nachsenden = (async () => {
      let liste = [];
      try { liste = await listFehlerberichte(user.id); } catch { return 0; }
      let n = 0;
      for (const r of liste) {
        try { await fehlerberichtSenden(r.zeile); await deleteFehlerbericht(r.id); n += 1; } catch { break; }
      }
      if (n) hooks.toast(n === 1 ? 'Vorgemerkte Meldung gesendet.' : `${n} vorgemerkte Meldungen gesendet.`);
      return n;
    })().finally(() => { nachsenden = null; });
    return nachsenden;
  }
  window.addEventListener('online', () => warteschlangeSenden());

  // ---- Meine Meldungen ----
  async function meineZeigen() {
    const el = $('fb-meine-liste');
    const user = hooks.user();
    if (!user) return;
    el.innerHTML = '<p class="modal-hint">Lädt …</p>';
    let wartend = [];
    try { wartend = await listFehlerberichte(user.id); } catch { /* gesperrt o. ä. */ }
    let liste = [];
    let fehler = '';
    try { liste = (await fehlerberichteLaden()).filter(r => !r.email || r.email === String(user.email).toLowerCase()); } catch (err) { fehler = navigator.onLine ? (err.message || 'Laden fehlgeschlagen.') : 'Ohne Internet lassen sich deine Meldungen nicht abrufen.'; }
    const zeilen = [
      ...wartend.map(r => `<div class="fb-zeile"><span class="fb-nr">–</span><span class="fb-zeile-titel">${esc(r.zeile.titel)}</span><span class="fb-chip is-wartet">wartet auf Internet</span></div>`),
      ...liste.map(r => `<div class="fb-zeile"><span class="fb-nr">#${esc(r.nummer)}</span><span class="fb-zeile-titel">${esc(r.titel)}<small>${esc(ARTEN[r.art] || r.art)} · ${esc(new Date(r.erstellt_am).toLocaleDateString('de-DE'))}</small></span><span class="fb-chip is-${esc(r.status)}">${esc(STATUS[r.status] || r.status)}</span></div>`)
    ];
    el.innerHTML = (fehler ? `<p class="modal-hint modal-error">${esc(fehler)}</p>` : '')
      + (zeilen.length ? zeilen.join('') : (fehler ? '' : '<p class="modal-hint">Du hast noch nichts gemeldet.</p>'));
  }

  // ---- Hinweis bei Programmfehlern ----
  let letzterHinweis = 0;
  beiFehler = (meldung) => {
    if (!hooks.hinweisAktiv() || !hooks.user() || !ov.hidden || Date.now() - letzterHinweis < 10 * 60000) return;
    letzterHinweis = Date.now();
    const h = $('fb-hinweis');
    h.dataset.meldung = bereinigen(meldung, 300);
    h.hidden = false;
    clearTimeout(h._t);
    h._t = setTimeout(() => { h.hidden = true; }, 20000);
  };
  $('fb-hinweis').addEventListener('click', (e) => {
    const h = $('fb-hinweis');
    if (e.target.closest('#fb-hinweis-melden')) { h.hidden = true; oeffnen({ art: 'fehler', tatsaechlich: 'Fehlermeldung: ' + (h.dataset.meldung || '') }); }
    else if (e.target.closest('#fb-hinweis-zu')) h.hidden = true;
  });

  // ---- Verwaltung (Admins): alle Meldungen bearbeiten ----
  let adminListe = [];
  const datum = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const auswahl = (name, werte, aktuell, leer) => `<select data-fb-feld="${name}">${leer ? `<option value="">${leer}</option>` : ''}${Object.entries(werte).map(([k, v]) => `<option value="${k}"${k === aktuell ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  function umgebungTabelle(u) {
    return `<table class="fb-tabelle">${Object.entries(u || {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('')}</table>`;
  }
  function vorgangHtml(r) {
    const abschnitt = (titel, text) => text ? `<h5>${titel}</h5><p class="fb-text-block">${esc(text)}</p>` : '';
    return `<details class="fb-vorgang" data-fb-id="${esc(r.id)}">
      <summary><span class="fb-nr">#${esc(r.nummer)}</span><span class="fb-zeile-titel">${esc(r.titel)}<small>${esc(ARTEN[r.art])} · ${esc(SCHWERE[r.schwere])}${r.art === 'fehler' ? ' · ' + esc(HAEUFIGKEIT[r.haeufigkeit]) : ''} · ${esc(datum(r.erstellt_am))} · ${esc(r.email || '')}</small></span>
        ${r.prioritaet ? `<span class="fb-chip is-prio">${esc(r.prioritaet.toUpperCase())}</span>` : ''}<span class="fb-chip is-${esc(r.status)}">${esc(STATUS[r.status])}</span></summary>
      <div class="fb-vorgang-inhalt">
        ${abschnitt(r.art === 'fehler' ? 'Schritte zum Nachstellen' : 'Beschreibung', r.schritte)}
        ${abschnitt('Erwartet', r.erwartet)}
        ${abschnitt('Tatsächlich', r.tatsaechlich)}
        ${r.hat_bild ? '<button type="button" class="betrieb-btn" data-fb-akt="bild"><span class="material-symbols-rounded icon" aria-hidden="true">image</span>Bildschirmfoto ansehen</button>' : ''}
        <details class="fb-technik"><summary>Umgebung</summary>${umgebungTabelle(r.umgebung)}</details>
        <details class="fb-technik"><summary>Protokoll (${(r.protokoll || []).length})</summary><pre>${esc((r.protokoll || []).map(p => `${String(p.t).slice(11, 19)} ${String(p.art).padEnd(8)} ${p.text}`).join('\n'))}</pre></details>
        <div class="fb-bearbeiten">
          <label>Status ${auswahl('status', STATUS, r.status)}</label>
          <label>Priorität ${auswahl('prioritaet', PRIORITAET, r.prioritaet, '–')}</label>
          <label class="fb-duplikat"${r.status === 'duplikat' ? '' : ' hidden'}>Duplikat von # <input type="number" min="1" data-fb-feld="duplikat_von" value="${esc(r.duplikat_von || '')}"></label>
        </div>
        <label class="account-label">Interne Notiz</label>
        <textarea class="account-input fb-text" rows="2" maxlength="5000" data-fb-feld="notiz">${esc(r.notiz || '')}</textarea>
        <div class="account-actions account-actions-start">
          <button type="button" class="betrieb-btn primary" data-fb-akt="speichern">Speichern</button>
          <button type="button" class="betrieb-btn" data-fb-akt="kopieren"><span class="material-symbols-rounded icon" aria-hidden="true">content_copy</span>Als Markdown kopieren</button>
          <span class="modal-hint" data-fb-meldung></span>
        </div>
      </div></details>`;
  }
  async function adminZeigen() {
    const el = $('fb-admin-liste');
    $('fb-admin-fehler').hidden = true;
    try { adminListe = await fehlerberichteLaden(); } catch (err) {
      $('fb-admin-fehler').textContent = err.message || 'Fehlerberichte konnten nicht geladen werden.';
      $('fb-admin-fehler').hidden = false;
      return;
    }
    const offen = $('fb-admin-filter').value === 'offen';
    const liste = adminListe.filter(r => !offen || OFFEN.has(r.status));
    el.innerHTML = liste.length ? liste.map(vorgangHtml).join('') : `<p class="modal-hint">${offen ? 'Keine offenen Meldungen.' : 'Noch keine Meldungen.'}</p>`;
  }
  $('fb-admin-refresh').addEventListener('click', adminZeigen);
  $('fb-admin-filter').addEventListener('change', adminZeigen);
  $('fb-admin-liste').addEventListener('change', (e) => {
    if (e.target.dataset.fbFeld === 'status') e.target.closest('.fb-vorgang').querySelector('.fb-duplikat').hidden = e.target.value !== 'duplikat';
  });
  $('fb-admin-liste').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fb-akt]');
    if (!btn) return;
    const box = btn.closest('.fb-vorgang');
    const r = adminListe.find(x => x.id === box.dataset.fbId);
    if (!r) return;
    const meldung = box.querySelector('[data-fb-meldung]');
    if (btn.dataset.fbAkt === 'bild') {
      try {
        const url = await fehlerberichtBild(r.id);
        if (url) hooks.bildAnsehen(await (await fetch(url)).blob(), `Meldung ${r.nummer}.jpg`);
      } catch (err) { meldung.textContent = err.message || 'Bild konnte nicht geladen werden.'; }
    } else if (btn.dataset.fbAkt === 'speichern') {
      const feld = (n) => box.querySelector(`[data-fb-feld="${n}"]`).value;
      const felder = { status: feld('status'), prioritaet: feld('prioritaet') || null, notiz: feld('notiz').trim() || null,
        duplikat_von: feld('status') === 'duplikat' && feld('duplikat_von') ? Number(feld('duplikat_von')) : null };
      btn.disabled = true;
      try {
        await fehlerberichtAktualisieren(r.id, felder);
        Object.assign(r, felder);
        // Vorgang neu zeichnen (Status und Priorität im Kopf), aufgeklappt lassen
        const neu = document.createElement('div');
        neu.innerHTML = vorgangHtml(r);
        const ersatz = neu.firstElementChild;
        ersatz.open = true;
        box.replaceWith(ersatz);
        ersatz.querySelector('[data-fb-meldung]').textContent = 'Gespeichert.';
        hooks.adminZahlAktualisieren();
      } catch (err) { meldung.textContent = err.message || 'Speichern hat nicht geklappt.'; } finally { btn.disabled = false; }
    } else if (btn.dataset.fbAkt === 'kopieren') {
      try { await navigator.clipboard.writeText(alsMarkdown([r])); meldung.textContent = 'Kopiert.'; } catch { meldung.textContent = 'Kopieren nicht möglich.'; }
    }
  });
  $('fb-admin-export').addEventListener('click', () => {
    const offen = $('fb-admin-filter').value === 'offen';
    const liste = adminListe.filter(r => !offen || OFFEN.has(r.status));
    if (!liste.length) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([alsMarkdown(liste)], { type: 'text/markdown' }));
    a.download = `fehlerberichte-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  return {
    oeffnen,
    warteschlangeSenden,
    adminZeigen,
    offeneAnzahl: async () => (await fehlerberichteLaden()).filter(r => r.status === 'neu').length
  };
}

// Vorgänge als Markdown (Aufbau wie ein Issue — zum Weitergeben oder Abarbeiten)
export function alsMarkdown(liste) {
  const text = (t) => (t ? String(t) : '–');
  return liste.map(r => {
    const u = r.umgebung || {};
    const umgebung = Object.entries(u).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `| ${k} | ${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/\|/g, '\\|')} |`).join('\n');
    const prot = (r.protokoll || []).map(p => `${String(p.t).slice(0, 19).replace('T', ' ')} ${String(p.art).padEnd(8)} ${p.text}`).join('\n');
    return `## #${r.nummer} ${r.titel}

**Art:** ${ARTEN[r.art] || r.art} · **Auswirkung:** ${SCHWERE[r.schwere] || r.schwere}${r.art === 'fehler' ? ` · **Häufigkeit:** ${HAEUFIGKEIT[r.haeufigkeit] || r.haeufigkeit}` : ''} · **Status:** ${STATUS[r.status] || r.status}${r.prioritaet ? ` · **Priorität:** ${PRIORITAET[r.prioritaet]}` : ''}${r.duplikat_von ? ` · **Duplikat von:** #${r.duplikat_von}` : ''}
**Gemeldet:** ${new Date(r.erstellt_am).toLocaleString('de-DE')}${r.email ? ` von ${r.email}` : ''}${r.hat_bild ? ' · Bildschirmfoto in der App' : ''}

### ${r.art === 'fehler' ? 'Schritte zum Nachstellen' : 'Beschreibung'}
${text(r.schritte)}
${r.art === 'fehler' ? `
### Erwartet
${text(r.erwartet)}

### Tatsächlich
${text(r.tatsaechlich)}
` : ''}
### Umgebung
| Angabe | Wert |
|---|---|
${umgebung}

### Protokoll
\`\`\`
${prot || '–'}
\`\`\`
${r.notiz ? `\n### Interne Notiz\n${r.notiz}\n` : ''}`;
  }).join('\n---\n\n');
}
