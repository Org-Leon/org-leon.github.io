// ---------- Zeiterfassung: Fahrt-, Kontroll- und Bürozeit ----------
// Erfasst Arbeitszeit dort, wo die Arbeit ohnehin passiert, statt in einem
// eigenen Formular:
//   - Tipp auf "Route" bei einem Termin  -> Frage "Fahrtzeit starten?"
//   - Betriebsseite / Kontrollmappe       -> "Kontrollzeit starten"; läuft gerade
//                                            die Fahrt, heißt der Knopf "Angekommen"
//   - es läuft immer nur EINE Zeit: eine neue zu starten beendet die laufende
//   - Kopfzeile zeigt die laufende Zeit; Dashboard-Baustein und Reiter "Zeiten"
//     (Wochenliste, nachtragen, ändern, löschen, Monat als Excel)
//
// Daten: kontoProfil.zeiten = [{ id, art, start, ende|null, betrieb?, terminId?, notiz? }]
// (ISO-Zeitpunkte) — Teil des Profils, wird also mit dem Konto abgeglichen: eine
// am Handy gestartete Zeit läuft auch am Laptop weiter. Reine Eigen-Erfassung
// des angemeldeten Nutzers; ende === null heißt "läuft".
import * as XLSX from 'xlsx';

export const ZEIT_ARTEN = {
  fahrt: { label: 'Fahrt', zeit: 'Fahrtzeit', icon: 'directions_car' },
  kontrolle: { label: 'Kontrolle', zeit: 'Kontrollzeit', icon: 'fact_check' },
  buero: { label: 'Büro', zeit: 'Bürozeit', icon: 'edit_note' }
};
const MAX_EINTRAEGE = 4000;
const LANG_MS = 12 * 3600000; // läuft länger als 12 Stunden: vermutlich vergessen
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const neueId = () => 'ze-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const zwei = (n) => String(n).padStart(2, '0');
const istZeit = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

// Gespeicherte Liste bereinigen (auch Daten von anderen Geräten); höchstens eine läuft
export function zeitenBereinigen(liste) {
  if (!Array.isArray(liste)) return [];
  const out = liste.filter(e => e && ZEIT_ARTEN[e.art] && istZeit(e.start) && (e.ende == null || (istZeit(e.ende) && Date.parse(e.ende) >= Date.parse(e.start))))
    .map(e => ({
      id: typeof e.id === 'string' ? e.id : neueId(), art: e.art, start: new Date(e.start).toISOString(), ende: e.ende == null ? null : new Date(e.ende).toISOString(),
      ...(typeof e.betrieb === 'string' && e.betrieb.trim() ? { betrieb: e.betrieb.trim().slice(0, 200) } : {}),
      ...(typeof e.terminId === 'string' && e.terminId ? { terminId: e.terminId.slice(0, 100) } : {}),
      ...(typeof e.notiz === 'string' && e.notiz.trim() ? { notiz: e.notiz.trim().slice(0, 300) } : {})
    }))
    .sort((a, b) => a.start.localeCompare(b.start)).slice(-MAX_EINTRAEGE);
  const laufende = out.filter(e => !e.ende);
  laufende.slice(0, -1).forEach(e => { e.ende = e.start; }); // nur die jüngste darf laufen
  return out;
}
export const dauerMs = (e, jetzt = Date.now()) => Math.max(0, (e.ende ? Date.parse(e.ende) : jetzt) - Date.parse(e.start));
// 1:05 h
export function dauerText(ms) {
  const min = Math.round(ms / 60000);
  return `${Math.floor(min / 60)}:${zwei(min % 60)} h`;
}
// laufende Uhr: 0:12:05
function uhrText(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${zwei(Math.floor(s / 60) % 60)}:${zwei(s % 60)}`;
}
const tagStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusTage = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const montag = (d) => plusTage(tagStart(d), -((d.getDay() + 6) % 7));
const uhrzeit = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
function kalenderwoche(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

// hooks: {
//   liste()            kontoProfil.zeiten (Array, wird direkt geändert)
//   speichern()        nach jeder Änderung: lokal sichern und abgleichen
//   termin(id)         Termin (kunde, date) oder null
//   aktiverBetrieb()   Name des gewählten Betriebs oder ''
//   betriebe()         bekannte Betriebsnamen (Vorschläge beim Nachtragen)
//   zeigeZeiten()      Reiter "Zeiten" öffnen
//   toast(text)
// }
export function zeiterfassungEinrichten(hooks) {
  const $ = (id) => document.getElementById(id);
  let wocheVersatz = 0;     // gezeigte Woche im Reiter "Zeiten", relativ zur aktuellen
  let seite = null;         // Wurzel des Reiters "Zeiten" (solange er gezeichnet ist)
  let bearbeiteId = null;   // Eintrag im Dialog (null = neu)
  let frage = null;         // offene Frage "Fahrtzeit starten?" { betrieb, terminId }
  let ticker = null;

  const liste = () => hooks.liste();
  const laufend = () => { const l = liste(); for (let i = l.length - 1; i >= 0; i--) if (!l[i].ende) return l[i]; return null; };
  const artText = (e) => ZEIT_ARTEN[e.art].label + (e.betrieb ? ' · ' + e.betrieb : '');

  // ---- Starten / Stoppen ----
  function starten(art, { betrieb = '', terminId = '' } = {}) {
    const jetzt = new Date().toISOString();
    const alt = laufend();
    if (alt) alt.ende = jetzt;
    liste().push({ id: neueId(), art, start: jetzt, ende: null, ...(betrieb ? { betrieb } : {}), ...(terminId ? { terminId } : {}) });
    geaendert();
    hooks.toast(`${ZEIT_ARTEN[art].zeit} läuft${betrieb ? ' — ' + betrieb : ''}.`);
  }
  function stoppen() {
    const e = laufend();
    if (!e) return null;
    e.ende = new Date().toISOString();
    geaendert();
    hooks.toast(`${ZEIT_ARTEN[e.art].zeit} gestoppt: ${dauerText(dauerMs(e))}.`);
    return e;
  }
  function geaendert() {
    const l = liste();
    const sauber = zeitenBereinigen(l);
    l.splice(0, l.length, ...sauber);
    hooks.speichern();
    aktualisieren();
  }

  // ---- Bausteine der Oberfläche ----
  // Knopf auf Betriebsseite und in der Kontrollmappe
  function knopfInnen(betrieb, terminId) {
    const l = laufend();
    if (l && l.art === 'kontrolle' && (l.betrieb || '') === betrieb) {
      return `<button type="button" class="betrieb-btn ze-laeuft" data-ze-akt="stopp" title="Kontrollzeit stoppen"><span class="material-symbols-rounded icon" aria-hidden="true">stop</span>Kontrolle läuft · <span data-ze-uhr>${uhrText(dauerMs(l))}</span></button>`;
    }
    const angekommen = l && l.art === 'fahrt';
    return `<button type="button" class="betrieb-btn" data-ze-akt="start" data-ze-art="kontrolle" title="${angekommen ? 'Beendet die Fahrtzeit und startet die Kontrollzeit' : 'Kontrollzeit für diesen Betrieb starten'}"><span class="material-symbols-rounded icon" aria-hidden="true">timer</span>${angekommen ? 'Angekommen · Kontrollzeit starten' : 'Kontrollzeit starten'}</button>`;
  }
  const knopfHtml = (betrieb, terminId = '') => `<span class="ze-platz" data-ze-betrieb="${esc(betrieb)}" data-ze-termin="${esc(terminId)}">${knopfInnen(betrieb, terminId)}</span>`;

  // Summen eines Zeitraums [von, bis) je Art
  function summen(von, bis) {
    const s = { fahrt: 0, kontrolle: 0, buero: 0, gesamt: 0 };
    liste().forEach(e => { const t = Date.parse(e.start); if (t >= von && t < bis) { const d = dauerMs(e); s[e.art] += d; s.gesamt += d; } });
    return s;
  }
  const summenChips = (s) => Object.entries(ZEIT_ARTEN).map(([k, a]) => `<span class="ze-summe"><span class="material-symbols-rounded icon" aria-hidden="true">${a.icon}</span>${a.label} <b>${dauerText(s[k])}</b></span>`).join('')
    + `<span class="ze-summe is-gesamt">Gesamt <b>${dauerText(s.gesamt)}</b></span>`;

  function laufendHtml() {
    const l = laufend();
    if (!l) return '';
    const lang = dauerMs(l) > LANG_MS;
    return `<div class="ze-jetzt${lang ? ' is-lang' : ''}">
        <span class="material-symbols-rounded icon" aria-hidden="true">${ZEIT_ARTEN[l.art].icon}</span>
        <span class="ze-jetzt-text"><b>${esc(artText(l))}</b><small>seit ${esc(uhrzeit(l.start))} Uhr${lang ? ' — läuft schon über 12 Stunden, bitte das Ende prüfen' : ''}</small></span>
        <span class="ze-uhr" data-ze-uhr>${uhrText(dauerMs(l))}</span>
        <button type="button" class="betrieb-btn primary" data-ze-akt="stopp"><span class="material-symbols-rounded icon" aria-hidden="true">stop</span>Stoppen</button>
      </div>`;
  }
  function startKnoepfe() {
    const betrieb = hooks.aktiverBetrieb();
    return `<div class="ze-start" data-ze-betrieb="${esc(betrieb)}">
        ${Object.entries(ZEIT_ARTEN).map(([k, a]) => `<button type="button" class="ze-start-btn" data-ze-akt="start" data-ze-art="${k}"><span class="material-symbols-rounded icon" aria-hidden="true">${a.icon}</span>${a.label}${k !== 'buero' && betrieb ? `<small>${esc(betrieb)}</small>` : ''}</button>`).join('')}
      </div>`;
  }
  // Dashboard-Baustein
  function bausteinInnen() {
    const heute = tagStart(new Date());
    const s = summen(heute.getTime(), plusTage(heute, 1).getTime());
    const wo = montag(new Date());
    const w = summen(wo.getTime(), plusTage(wo, 7).getTime());
    return `${laufendHtml() || '<p class="ze-ruhe">Gerade läuft keine Zeit.</p>'}
      ${laufend() ? '' : startKnoepfe()}
      <div class="ze-summen"><span class="ze-summen-titel">Heute</span>${summenChips(s)}</div>
      <div class="ze-summen"><span class="ze-summen-titel">Diese Woche</span><span class="ze-summe is-gesamt"><b>${dauerText(w.gesamt)}</b></span></div>`;
  }
  const bausteinHtml = () => `<div class="ze-baustein">${bausteinInnen()}</div>`;

  // ---- Reiter "Zeiten" ----
  function seiteInnen() {
    const start = plusTage(montag(new Date()), wocheVersatz * 7);
    const ende = plusTage(start, 7);
    const kurz = (d) => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const s = summen(start.getTime(), ende.getTime());
    const inWoche = liste().filter(e => { const t = Date.parse(e.start); return t >= start.getTime() && t < ende.getTime(); });
    const tage = [];
    for (let i = 0; i < 7; i++) {
      const tag = plusTage(start, i);
      const eintraege = inWoche.filter(e => tagStart(new Date(e.start)).getTime() === tag.getTime());
      if (!eintraege.length) continue;
      const summe = eintraege.reduce((n, e) => n + dauerMs(e), 0);
      tage.push(`<section class="ze-tag">
          <h4><span>${esc(tag.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' }))}</span><b>${dauerText(summe)}</b></h4>
          ${eintraege.map(e => `<div class="ze-zeile${e.ende ? '' : ' is-laeuft'}" data-ze-id="${esc(e.id)}">
              <span class="material-symbols-rounded icon" aria-hidden="true">${ZEIT_ARTEN[e.art].icon}</span>
              <span class="ze-zeile-zeit">${esc(uhrzeit(e.start))}–${e.ende ? esc(uhrzeit(e.ende)) : 'läuft'}</span>
              <span class="ze-zeile-text"><b>${esc(artText(e))}</b>${e.notiz ? `<small>${esc(e.notiz)}</small>` : ''}</span>
              <span class="ze-zeile-dauer"${e.ende ? '' : ' data-ze-uhr-kurz'}>${dauerText(dauerMs(e))}</span>
              <button type="button" class="ko-icon-btn" data-ze-akt="bearbeiten" title="Ändern" aria-label="Eintrag ändern"><span class="material-symbols-rounded icon" aria-hidden="true">edit</span></button>
            </div>`).join('')}
        </section>`);
    }
    return `<section class="ko-card ze-karte">
        <div class="ko-card-head"><h3><span class="material-symbols-rounded icon" aria-hidden="true">timer</span>Jetzt</h3></div>
        ${laufendHtml() || '<p class="ze-ruhe">Gerade läuft keine Zeit. Starte sie hier — oder dort, wo du arbeitest: „Route“ bei einem Termin, „Kontrollzeit starten“ auf der Betriebsseite.</p>'}
        ${laufend() ? '' : startKnoepfe()}
      </section>
      <div class="ze-woche">
        <button type="button" class="ko-icon-btn" data-ze-akt="woche-zurueck" title="Vorherige Woche" aria-label="Vorherige Woche"><span class="material-symbols-rounded icon" aria-hidden="true">chevron_left</span></button>
        <span class="ze-woche-text" id="ze-woche-text"><b>KW ${kalenderwoche(start)}</b> · ${kurz(start)}–${kurz(plusTage(start, 6))}</span>
        <button type="button" class="ko-icon-btn" data-ze-akt="woche-vor" title="Nächste Woche" aria-label="Nächste Woche"><span class="material-symbols-rounded icon" aria-hidden="true">chevron_right</span></button>
        ${wocheVersatz ? '<button type="button" class="ko-link-btn" data-ze-akt="woche-heute">Diese Woche</button>' : ''}
        <span class="ze-woche-akt">
          <button type="button" class="betrieb-btn" data-ze-akt="nachtragen"><span class="material-symbols-rounded icon" aria-hidden="true">add</span>Nachtragen</button>
          <button type="button" class="betrieb-btn" data-ze-akt="excel"><span class="material-symbols-rounded icon" aria-hidden="true">table_view</span>Monat als Excel</button>
        </span>
      </div>
      <div class="ze-summen ze-summen-woche" id="ze-summen-woche">${summenChips(s)}</div>
      ${tage.length ? tage.join('') : '<div class="ko-empty ko-empty-small"><span class="material-symbols-rounded icon" aria-hidden="true">timer</span><p>In dieser Woche ist noch keine Zeit erfasst.</p></div>'}`;
  }
  function seiteZeichnen(root) {
    seite = root;
    root.innerHTML = `<div class="ze-seite">${seiteInnen()}</div>`;
    tickerPruefen();
  }

  // ---- Kopfzeile, Frage nach der Fahrtzeit, Uhr ----
  function chipZeichnen() {
    const chip = $('ze-chip');
    const l = laufend();
    chip.hidden = !l;
    if (!l) return;
    chip.title = `${artText(l)} läuft seit ${uhrzeit(l.start)} Uhr — zur Zeiterfassung`;
    chip.innerHTML = `<span class="material-symbols-rounded icon" aria-hidden="true">${ZEIT_ARTEN[l.art].icon}</span><span class="ze-chip-text">${esc(ZEIT_ARTEN[l.art].label)}</span><span data-ze-uhr>${uhrText(dauerMs(l))}</span>`;
  }
  function frageZeigen(betrieb, terminId) {
    const l = laufend();
    if (l && l.art === 'fahrt' && (l.betrieb || '') === betrieb) return; // läuft schon
    frage = { betrieb, terminId };
    $('ze-frage-text').textContent = betrieb ? `Fahrt zu ${betrieb}` : 'Fahrt';
    const box = $('ze-frage');
    box.hidden = false;
    clearTimeout(box._t);
    box._t = setTimeout(() => { box.hidden = true; }, 25000);
  }
  function tick() {
    const l = laufend();
    if (!l) { tickerPruefen(); return; }
    const ms = dauerMs(l);
    document.querySelectorAll('[data-ze-uhr]').forEach(el => { el.textContent = uhrText(ms); });
    document.querySelectorAll('[data-ze-uhr-kurz]').forEach(el => { el.textContent = dauerText(ms); });
  }
  function tickerPruefen() {
    const noetig = !!laufend();
    if (noetig && !ticker) ticker = setInterval(tick, 1000);
    else if (!noetig && ticker) { clearInterval(ticker); ticker = null; }
  }
  // alles neu zeichnen, was Zeiten zeigt
  function aktualisieren() {
    chipZeichnen();
    document.querySelectorAll('.ze-baustein').forEach(el => { el.innerHTML = bausteinInnen(); });
    document.querySelectorAll('.ze-platz').forEach(el => { el.innerHTML = knopfInnen(el.dataset.zeBetrieb || '', el.dataset.zeTermin || ''); });
    if (seite && seite.isConnected && !seite.closest('[hidden]')) seite.innerHTML = `<div class="ze-seite">${seiteInnen()}</div>`;
    tickerPruefen();
  }

  // ---- Dialog: nachtragen / ändern ----
  const dlg = $('ze-dialog');
  const datumWert = (d) => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
  const zeitWert = (d) => `${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
  function dialogOeffnen(e) {
    bearbeiteId = e ? e.id : null;
    const start = e ? new Date(e.start) : new Date();
    $('ze-d-titel').textContent = e ? 'Zeit ändern' : 'Zeit nachtragen';
    $('ze-d-art').value = e ? e.art : 'kontrolle';
    $('ze-d-datum').value = datumWert(start);
    $('ze-d-von').value = e ? zeitWert(start) : '';
    $('ze-d-bis').value = e && e.ende ? zeitWert(new Date(e.ende)) : '';
    $('ze-d-betrieb').value = e ? (e.betrieb || '') : hooks.aktiverBetrieb();
    $('ze-d-notiz').value = e ? (e.notiz || '') : '';
    $('ze-d-betriebe').innerHTML = hooks.betriebe().map(n => `<option value="${esc(n)}">`).join('');
    $('ze-d-loeschen').hidden = !e;
    $('ze-d-bis-hinweis').hidden = !(e && !e.ende);
    $('ze-d-fehler').hidden = true;
    dlg.hidden = false;
    $('ze-d-von').focus();
  }
  function dialogFehler(text) { $('ze-d-fehler').textContent = text; $('ze-d-fehler').hidden = false; }
  function dialogSpeichern() {
    const datum = $('ze-d-datum').value, von = $('ze-d-von').value, bis = $('ze-d-bis').value;
    if (!datum || !von) { dialogFehler('Bitte Datum und Beginn angeben.'); return; }
    const start = new Date(`${datum}T${von}`);
    if (Number.isNaN(start.getTime())) { dialogFehler('Datum oder Beginn ist ungültig.'); return; }
    const alt = bearbeiteId ? liste().find(x => x.id === bearbeiteId) : null;
    let ende = null;
    if (bis) {
      ende = new Date(`${datum}T${bis}`);
      if (ende <= start) ende = plusTage(ende, 1); // über Mitternacht
      if (ende - start > 24 * 3600000) { dialogFehler('Ein Eintrag kann höchstens 24 Stunden dauern.'); return; }
    } else if (!(alt && !alt.ende)) { dialogFehler('Bitte das Ende angeben.'); return; }
    if (start.getTime() > Date.now() + 60000) { dialogFehler('Der Beginn liegt in der Zukunft.'); return; }
    const felder = { art: $('ze-d-art').value, start: start.toISOString(), ende: ende ? ende.toISOString() : null, betrieb: $('ze-d-betrieb').value.trim(), notiz: $('ze-d-notiz').value.trim() };
    if (alt) Object.assign(alt, felder); else liste().push({ id: neueId(), ...felder });
    dlg.hidden = true;
    geaendert();
  }
  $('ze-d-speichern').addEventListener('click', dialogSpeichern);
  $('ze-d-abbrechen').addEventListener('click', () => { dlg.hidden = true; });
  $('ze-d-loeschen').addEventListener('click', () => {
    if (!bearbeiteId || !confirm('Diesen Zeiteintrag löschen?')) return;
    const l = liste();
    const i = l.findIndex(x => x.id === bearbeiteId);
    if (i >= 0) l.splice(i, 1);
    dlg.hidden = true;
    geaendert();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.hidden) dlg.hidden = true; });

  // ---- Monat als Excel ----
  function excel() {
    const basis = plusTage(montag(new Date()), wocheVersatz * 7 + 3); // Donnerstag bestimmt den Monat der Woche
    const von = new Date(basis.getFullYear(), basis.getMonth(), 1), bis = new Date(basis.getFullYear(), basis.getMonth() + 1, 1);
    const zeilen = liste().filter(e => e.ende && Date.parse(e.start) >= von.getTime() && Date.parse(e.start) < bis.getTime());
    if (!zeilen.length) { hooks.toast('In diesem Monat gibt es keine abgeschlossenen Zeiten.'); return; }
    const stunden = (ms) => Math.round(ms / 36000) / 100;
    const daten = [['Datum', 'Art', 'Von', 'Bis', 'Dauer (h)', 'Betrieb', 'Notiz'],
      ...zeilen.map(e => [new Date(e.start).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }), ZEIT_ARTEN[e.art].label, uhrzeit(e.start), uhrzeit(e.ende), stunden(dauerMs(e)), e.betrieb || '', e.notiz || ''])];
    daten.push([], ...Object.entries(ZEIT_ARTEN).map(([k, a]) => ['', 'Summe ' + a.label, '', '', stunden(zeilen.filter(e => e.art === k).reduce((n, e) => n + dauerMs(e), 0)), '', '']),
      ['', 'Summe gesamt', '', '', stunden(zeilen.reduce((n, e) => n + dauerMs(e), 0)), '', '']);
    const ws = XLSX.utils.aoa_to_sheet(daten);
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 7 }, { wch: 7 }, { wch: 10 }, { wch: 32 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Zeiten');
    XLSX.writeFile(wb, `Zeiterfassung_${von.getFullYear()}-${zwei(von.getMonth() + 1)}.xlsx`);
  }

  // ---- Bedienung (eine Delegation fürs ganze Dokument) ----
  document.addEventListener('click', (e) => {
    const route = e.target.closest && e.target.closest('[data-ze-route]');
    if (route) { // der Link öffnet die Route selbst — hier nur die Frage dazu
      const t = hooks.termin(route.dataset.zeRoute);
      frageZeigen(t ? t.kunde : (route.dataset.zeBetriebName || ''), t ? route.dataset.zeRoute : '');
      return;
    }
    const btn = e.target.closest && e.target.closest('[data-ze-akt]');
    if (!btn) return;
    const akt = btn.dataset.zeAkt;
    if (akt === 'start') {
      const ort = btn.closest('[data-ze-betrieb]');
      const art = btn.dataset.zeArt;
      starten(art, art === 'buero' ? {} : { betrieb: ort ? ort.dataset.zeBetrieb : '', terminId: ort ? (ort.dataset.zeTermin || '') : '' });
    } else if (akt === 'stopp') stoppen();
    else if (akt === 'woche-vor' || akt === 'woche-zurueck' || akt === 'woche-heute') { wocheVersatz = akt === 'woche-heute' ? 0 : wocheVersatz + (akt === 'woche-vor' ? 1 : -1); aktualisieren(); }
    else if (akt === 'nachtragen') dialogOeffnen(null);
    else if (akt === 'bearbeiten') { const z = btn.closest('[data-ze-id]'); const eintrag = z && liste().find(x => x.id === z.dataset.zeId); if (eintrag) dialogOeffnen(eintrag); }
    else if (akt === 'excel') excel();
    else if (akt === 'frage-ja') { $('ze-frage').hidden = true; if (frage) starten('fahrt', frage); frage = null; }
    else if (akt === 'frage-nein') { $('ze-frage').hidden = true; frage = null; }
  });
  $('ze-chip').addEventListener('click', () => hooks.zeigeZeiten());

  return { laufend, starten, stoppen, knopfHtml, bausteinHtml, seiteZeichnen, aktualisieren };
}
