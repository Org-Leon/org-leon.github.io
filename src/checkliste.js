// ---------- Checkliste je Termin (zum Selbstschreiben) ----------
// Jeder Termin hat eine eigene Liste von Punkten, die der Nutzer selbst
// schreibt, abhakt und löscht. Sie liegt am Haupt-Auftrag des Termins
// (ev.checkliste = [{ id, text, erledigt }]) und reist damit beim Abgleich mit.
// Dazu eine persönliche Vorlage im Profil (kontoProfil.checkliste = [Text, …]):
// "Als Vorlage speichern" merkt sich die Punkte der aktuellen Liste,
// "Meine Vorlage einfügen" ergänzt sie in einem anderen Termin.
//
// Die Liste erscheint an mehreren Stellen (Dashboard-Baustein, Kontrollmappe,
// Betriebsseite) — überall dasselbe HTML aus checklisteHtml(). Bedient wird sie
// über EINE Ereignis-Delegation am Dokument; nach einer Änderung zeichnet das
// Modul alle sichtbaren Kopien dieses Termins selbst neu (der Eingabefokus
// bleibt erhalten) und meldet die Änderung über hooks.geaendert().

const MAX_PUNKTE = 60;
const MAX_TEXT = 200;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const neueId = () => 'cl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Gespeicherte Liste bereinigen (auch Daten von anderen Geräten)
export function checklisteBereinigen(liste) {
  if (!Array.isArray(liste)) return [];
  return liste.filter(p => p && typeof p.text === 'string' && p.text.trim()).slice(0, MAX_PUNKTE)
    .map(p => ({ id: typeof p.id === 'string' ? p.id : neueId(), text: p.text.trim().slice(0, MAX_TEXT), erledigt: !!p.erledigt }));
}
export function vorlageBereinigen(liste) {
  if (!Array.isArray(liste)) return [];
  return [...new Set(liste.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, MAX_TEXT)))].slice(0, MAX_PUNKTE);
}
export function checklisteStand(ev) {
  const liste = (ev && ev.checkliste) || [];
  return { gesamt: liste.length, erledigt: liste.filter(p => p.erledigt).length };
}

let hooks = null;

// ev: Haupt-Auftrag des Termins. Liefert das HTML der Liste (überall gleich).
export function checklisteHtml(ev) {
  const liste = ev.checkliste || [];
  const { gesamt, erledigt } = checklisteStand(ev);
  const vorlage = hooks ? hooks.vorlage() : [];
  const fehlend = vorlage.filter(t => !liste.some(p => p.text === t));
  const punkte = liste.map(p => `<li class="cl-punkt${p.erledigt ? ' is-erledigt' : ''}">
      <label><input type="checkbox" data-cl-akt="haken" data-cl-id="${esc(p.id)}"${p.erledigt ? ' checked' : ''}><span>${esc(p.text)}</span></label>
      <button type="button" class="cl-weg" data-cl-akt="weg" data-cl-id="${esc(p.id)}" title="Punkt löschen" aria-label="Punkt löschen: ${esc(p.text)}"><span class="material-symbols-rounded icon" aria-hidden="true">close</span></button>
    </li>`).join('');
  return `<div class="cl" data-cl-termin="${esc(ev.id)}">
    ${gesamt ? `<div class="cl-kopf"><span class="cl-stand">${erledigt} von ${gesamt} erledigt</span><span class="cl-balken" aria-hidden="true"><span style="width:${Math.round(erledigt / gesamt * 100)}%"></span></span></div>` : ''}
    ${gesamt ? `<ul class="cl-liste">${punkte}</ul>` : '<p class="cl-leer">Noch keine Punkte — schreib dir auf, woran du bei diesem Termin denken willst.</p>'}
    <div class="cl-neu">
      <input type="text" class="cl-eingabe" maxlength="${MAX_TEXT}" placeholder="Neuer Punkt …" aria-label="Neuer Punkt für die Checkliste" enterkeyhint="done"${gesamt >= MAX_PUNKTE ? ' disabled' : ''}>
      <button type="button" class="ko-icon-btn" data-cl-akt="neu" title="Punkt hinzufügen" aria-label="Punkt hinzufügen"><span class="material-symbols-rounded icon" aria-hidden="true">add</span></button>
    </div>
    <div class="cl-fuss">
      ${fehlend.length ? `<button type="button" class="ko-link-btn" data-cl-akt="vorlage-laden">Meine Vorlage einfügen (${fehlend.length})</button>` : ''}
      ${gesamt ? '<button type="button" class="ko-link-btn" data-cl-akt="vorlage-speichern">Als Vorlage speichern</button>' : ''}
    </div>
  </div>`;
}

// hooks: {
//   termin(id)          Haupt-Auftrag des Termins (Objekt, wird direkt geändert) oder null
//   vorlage()           persönliche Vorlage (Liste von Texten)
//   vorlageSetzen(l)    Vorlage speichern
//   geaendert(ev)       nach jeder Änderung: speichern/abgleichen, Zähler auffrischen
//   toast(text)
// }
export function checklisteEinrichten(h) {
  hooks = h;

  // alle sichtbaren Kopien der Liste dieses Termins neu zeichnen
  function neuZeichnen(ev, fokus) {
    document.querySelectorAll('.cl[data-cl-termin]').forEach(el => {
      if (el.dataset.clTermin !== ev.id) return;
      const hatteFokus = fokus && el === fokus;
      const neu = document.createElement('div');
      neu.innerHTML = checklisteHtml(ev);
      const ersatz = neu.firstElementChild;
      el.replaceWith(ersatz);
      if (hatteFokus) ersatz.querySelector('.cl-eingabe')?.focus();
    });
  }
  function aendern(box, fn, { fokus = false } = {}) {
    const ev = hooks.termin(box.dataset.clTermin);
    if (!ev) return;
    ev.checkliste = checklisteBereinigen(ev.checkliste);
    if (fn(ev) === false) return;
    neuZeichnen(ev, fokus ? box : null);
    hooks.geaendert(ev);
  }
  function hinzufuegen(box) {
    const eingabe = box.querySelector('.cl-eingabe');
    const text = (eingabe.value || '').trim().slice(0, MAX_TEXT);
    if (!text) { eingabe.focus(); return; }
    aendern(box, (ev) => {
      if (ev.checkliste.length >= MAX_PUNKTE) { hooks.toast(`Mehr als ${MAX_PUNKTE} Punkte passen nicht in eine Checkliste.`); return false; }
      ev.checkliste.push({ id: neueId(), text, erledigt: false });
    }, { fokus: true });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cl-akt]');
    if (!btn || btn.dataset.clAkt === 'haken') return;
    const box = btn.closest('.cl');
    if (!box) return;
    const akt = btn.dataset.clAkt;
    if (akt === 'neu') hinzufuegen(box);
    else if (akt === 'weg') aendern(box, (ev) => { ev.checkliste = ev.checkliste.filter(p => p.id !== btn.dataset.clId); });
    else if (akt === 'vorlage-laden') {
      aendern(box, (ev) => {
        const neu = hooks.vorlage().filter(t => !ev.checkliste.some(p => p.text === t)).slice(0, MAX_PUNKTE - ev.checkliste.length);
        if (!neu.length) return false;
        ev.checkliste.push(...neu.map(text => ({ id: neueId(), text, erledigt: false })));
      });
    } else if (akt === 'vorlage-speichern') {
      const ev = hooks.termin(box.dataset.clTermin);
      if (!ev) return;
      const vorher = hooks.vorlage().length;
      const texte = vorlageBereinigen((ev.checkliste || []).map(p => p.text));
      if (vorher && !confirm(`Deine bisherige Vorlage (${vorher} ${vorher === 1 ? 'Punkt' : 'Punkte'}) durch diese Liste ersetzen?`)) return;
      hooks.vorlageSetzen(texte);
      hooks.toast(`Vorlage gespeichert (${texte.length} ${texte.length === 1 ? 'Punkt' : 'Punkte'}).`);
      neuZeichnen(ev, null);
    }
  });
  document.addEventListener('change', (e) => {
    const haken = e.target.closest && e.target.closest('input[data-cl-akt="haken"]');
    if (!haken) return;
    const box = haken.closest('.cl');
    aendern(box, (ev) => { const p = ev.checkliste.find(x => x.id === haken.dataset.clId); if (!p) return false; p.erledigt = haken.checked; });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList || !e.target.classList.contains('cl-eingabe')) return;
    e.preventDefault();
    hinzufuegen(e.target.closest('.cl'));
  });
}
