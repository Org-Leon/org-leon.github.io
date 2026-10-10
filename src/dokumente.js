// Dateiexplorer der Kontrolle (Reiter "Dokumente"): alle Fotos und Dokumente
// aller Termine an einer Stelle — Ordner nach Betrieb und Termin, Suche,
// Filter, Sortierung, Liste oder Kacheln.
//
// Reines Darstellungsmodul: main.js liefert die Dateien (dokumenteSammeln) und
// die Aktionen (ansehen, umbenennen, löschen, herunterladen, …) als Hooks.
//
// Datei: { id, name, type, size, betrieb, terminId, terminDatum (ms), terminText,
//          herkunft ('Termin' | 'Protokoll'), status ('ok' | 'wartet' | 'fehler'),
//          aenderbar (umbenennen/löschen möglich), … }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ANSICHT_KEY = 'feldfolio-dokumente-ansicht';
const istBild = (d) => (d.type || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(d.name || '');
const istPdf = (d) => d.type === 'application/pdf' || /\.pdf$/i.test(d.name || '');
const typVon = (d) => (istBild(d) ? 'foto' : istPdf(d) ? 'pdf' : 'sonst');
const TYP_ICON = { foto: 'photo_camera', pdf: 'picture_as_pdf', sonst: 'description' };
const TYP_TEXT = { foto: 'Foto', pdf: 'PDF', sonst: 'Datei' };
const datum = (ms) => (ms ? new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
export function groesseText(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' KB';
  return (n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';
}

const SORTIERUNG = {
  neu: { text: 'Neueste zuerst', fn: (a, b) => (b.terminDatum || 0) - (a.terminDatum || 0) || a.name.localeCompare(b.name, 'de') },
  alt: { text: 'Älteste zuerst', fn: (a, b) => (a.terminDatum || 0) - (b.terminDatum || 0) || a.name.localeCompare(b.name, 'de') },
  name: { text: 'Name A–Z', fn: (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }) },
  gross: { text: 'Größte zuerst', fn: (a, b) => (b.size || 0) - (a.size || 0) },
  betrieb: { text: 'Betrieb A–Z', fn: (a, b) => a.betrieb.localeCompare(b.betrieb, 'de') || (b.terminDatum || 0) - (a.terminDatum || 0) }
};

export function createDokumentExplorer(root, hooks) {
  const zustand = { betrieb: null, termin: null, suche: '', typ: 'alle', sort: 'neu', ansicht: 'liste' };
  try {
    const g = JSON.parse(localStorage.getItem(ANSICHT_KEY) || '{}');
    if (g.ansicht === 'kacheln') zustand.ansicht = 'kacheln';
    if (SORTIERUNG[g.sort]) zustand.sort = g.sort;
  } catch { /* ohne Speicher */ }
  const merken = () => { try { localStorage.setItem(ANSICHT_KEY, JSON.stringify({ ansicht: zustand.ansicht, sort: zustand.sort })); } catch { /* */ } };
  let dateien = [];
  let sichtbar = [];
  const vorschau = new Map();   // id -> URL (Vorschaubilder werden erst geladen, wenn sichtbar)
  let beobachter = null;

  const imOrdner = (d) => (!zustand.betrieb || d.betrieb === zustand.betrieb) && (!zustand.termin || d.terminId === zustand.termin);
  function gefiltert() {
    const q = zustand.suche.trim().toLocaleLowerCase('de-DE');
    return dateien.filter(d => imOrdner(d)
      && (zustand.typ === 'alle' || typVon(d) === zustand.typ)
      && (!q || `${d.name} ${d.betrieb} ${d.terminText}`.toLocaleLowerCase('de-DE').includes(q)))
      .sort(SORTIERUNG[zustand.sort].fn);
  }
  // Ordnerstruktur: Betrieb -> Termine (neueste zuerst)
  function ordner() {
    const m = new Map();
    dateien.forEach(d => {
      const b = m.get(d.betrieb) || { name: d.betrieb, n: 0, termine: new Map() };
      b.n++;
      const t = b.termine.get(d.terminId) || { id: d.terminId, text: d.terminText, datum: d.terminDatum, n: 0 };
      t.n++;
      b.termine.set(d.terminId, t);
      m.set(d.betrieb, b);
    });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map(b => ({ ...b, termine: [...b.termine.values()].sort((x, y) => (y.datum || 0) - (x.datum || 0)) }));
  }

  const statusHtml = (d) => (d.status === 'wartet' ? '<span class="dx-status">wartet auf Upload</span>'
    : d.status === 'fehler' ? '<span class="dx-status is-fehler">Upload fehlgeschlagen</span>' : '')
    + (d.herkunft === 'Protokoll' ? '<span class="dx-status is-info">Protokoll-Anlage</span>' : '');
  const aktionenHtml = (d) => `<span class="dx-aktionen">
      ${d.aenderbar ? `<button type="button" class="dx-icon-btn" data-dx-akt="umbenennen" title="Umbenennen" aria-label="${esc(d.name)} umbenennen"><span class="material-symbols-rounded icon" aria-hidden="true">edit</span></button>` : ''}
      <button type="button" class="dx-icon-btn" data-dx-akt="laden" title="Herunterladen" aria-label="${esc(d.name)} herunterladen"><span class="material-symbols-rounded icon" aria-hidden="true">download</span></button>
      <button type="button" class="dx-icon-btn" data-dx-akt="termin" title="Zum Termin" aria-label="Zum Termin von ${esc(d.name)}"><span class="material-symbols-rounded icon" aria-hidden="true">event_upcoming</span></button>
      ${d.aenderbar ? `<button type="button" class="dx-icon-btn is-warn" data-dx-akt="loeschen" title="Löschen" aria-label="${esc(d.name)} löschen"><span class="material-symbols-rounded icon" aria-hidden="true">delete</span></button>` : ''}
    </span>`;

  function render() {
    const alle = ordner();
    // gewählter Ordner existiert nicht mehr (letzte Datei gelöscht) -> eine Ebene hoch
    if (zustand.betrieb && !alle.some(b => b.name === zustand.betrieb)) { zustand.betrieb = null; zustand.termin = null; }
    const aktB = alle.find(b => b.name === zustand.betrieb) || null;
    if (zustand.termin && !(aktB && aktB.termine.some(t => t.id === zustand.termin))) zustand.termin = null;
    const aktT = aktB && aktB.termine.find(t => t.id === zustand.termin) || null;
    sichtbar = gefiltert();
    const summe = sichtbar.reduce((s, d) => s + (d.size || 0), 0);
    const sucht = !!zustand.suche.trim();

    const baum = `<button type="button" class="dx-baum-zeile${!zustand.betrieb ? ' is-aktiv' : ''}" data-dx-ordner="">
        <span class="material-symbols-rounded icon" aria-hidden="true">folder_open</span><span class="dx-baum-name">Alle Dokumente</span><span class="dx-zahl">${dateien.length}</span></button>`
      + alle.map(b => `<button type="button" class="dx-baum-zeile is-betrieb${zustand.betrieb === b.name && !zustand.termin ? ' is-aktiv' : ''}" data-dx-ordner="${esc(b.name)}">
          <span class="material-symbols-rounded icon" aria-hidden="true">${zustand.betrieb === b.name ? 'folder_open' : 'folder'}</span><span class="dx-baum-name">${esc(b.name)}</span><span class="dx-zahl">${b.n}</span></button>`
        + (zustand.betrieb === b.name ? b.termine.map(t => `<button type="button" class="dx-baum-zeile is-termin${zustand.termin === t.id ? ' is-aktiv' : ''}" data-dx-ordner="${esc(b.name)}" data-dx-termin="${esc(t.id)}">
            <span class="material-symbols-rounded icon" aria-hidden="true">${zustand.termin === t.id ? 'folder_open' : 'folder'}</span><span class="dx-baum-name">${esc(t.text)}</span><span class="dx-zahl">${t.n}</span></button>`).join('') : '')).join('');

    // Ordnerkacheln der aktuellen Ebene (nicht während einer Suche und nicht im Termin)
    const kacheln = sucht || aktT ? [] : aktB
      ? aktB.termine.map(t => ({ name: t.text, n: t.n, betrieb: aktB.name, termin: t.id }))
      : alle.map(b => ({ name: b.name, n: b.n, betrieb: b.name, termin: '' }));
    const ordnerHtml = kacheln.length ? `<div class="dx-ordner" aria-label="Ordner">${kacheln.map(k => `<button type="button" class="dx-ordner-kachel" data-dx-ordner="${esc(k.betrieb)}"${k.termin ? ` data-dx-termin="${esc(k.termin)}"` : ''}>
        <span class="material-symbols-rounded icon" aria-hidden="true">folder</span><span class="dx-ordner-name">${esc(k.name)}</span><span class="dx-ordner-zahl">${k.n} ${k.n === 1 ? 'Datei' : 'Dateien'}</span></button>`).join('')}</div>` : '';

    const leer = !dateien.length
      ? '<div class="ko-empty"><span class="material-symbols-rounded icon" aria-hidden="true">folder_open</span><p><strong>Noch keine Dokumente</strong><br>Fotos, Scans und Dateien fügst du in der Kontrollmappe eines Termins hinzu — sie erscheinen dann hier.</p></div>'
      : '<div class="ko-empty ko-empty-small"><span class="material-symbols-rounded icon" aria-hidden="true">search</span><p>Keine Dokumente für diese Auswahl.</p></div>';
    const listeHtml = !sichtbar.length ? leer : zustand.ansicht === 'kacheln'
      ? `<div class="dx-kacheln">${sichtbar.map((d, i) => `<div class="dx-kachel" data-dx-i="${i}">
          <button type="button" class="dx-kachel-bild" data-dx-akt="ansehen" title="${esc(d.name)} — ansehen" aria-label="${esc(d.name)} ansehen">
            ${typVon(d) === 'foto' ? `<img alt="" data-dx-bild="${esc(d.id)}"${vorschau.get(d.id) ? ` src="${esc(vorschau.get(d.id))}"` : ''}>` : ''}<span class="material-symbols-rounded icon" aria-hidden="true">${TYP_ICON[typVon(d)]}</span></button>
          <div class="dx-kachel-text"><span class="dx-name" title="${esc(d.name)}">${esc(d.name)}</span><span class="dx-sub">${esc(d.betrieb)} · ${datum(d.terminDatum)}</span>${statusHtml(d)}</div>
          ${aktionenHtml(d)}</div>`).join('')}</div>`
      : `<div class="dx-tabelle-wrap"><table class="dx-tabelle"><thead><tr><th>Name</th><th class="dx-sp-typ">Art</th><th class="dx-sp-betrieb">Betrieb</th><th class="dx-sp-termin">Termin</th><th class="dx-sp-gr">Größe</th><th></th></tr></thead><tbody>
          ${sichtbar.map((d, i) => `<tr data-dx-i="${i}">
            <td><button type="button" class="dx-datei" data-dx-akt="ansehen" title="${esc(d.name)} — ansehen"><span class="material-symbols-rounded icon" aria-hidden="true">${TYP_ICON[typVon(d)]}</span><span class="dx-name">${esc(d.name)}</span></button>${statusHtml(d)}</td>
            <td class="dx-sp-typ">${TYP_TEXT[typVon(d)]}</td><td class="dx-sp-betrieb">${esc(d.betrieb)}</td><td class="dx-sp-termin">${datum(d.terminDatum)}</td><td class="dx-sp-gr">${groesseText(d.size)}</td>
            <td class="dx-sp-akt">${aktionenHtml(d)}</td></tr>`).join('')}
        </tbody></table></div>`;

    root.innerHTML = `<div class="dx">
      <div class="dx-kopf">
        <nav class="dx-pfad" aria-label="Ordnerpfad">
          <button type="button" data-dx-ordner=""${!aktB ? ' aria-current="page"' : ''}><span class="material-symbols-rounded icon" aria-hidden="true">folder_open</span>Alle Dokumente</button>
          ${aktB ? `<span class="material-symbols-rounded icon dx-pfad-sep" aria-hidden="true">chevron_right</span><button type="button" data-dx-ordner="${esc(aktB.name)}"${!aktT ? ' aria-current="page"' : ''}>${esc(aktB.name)}</button>` : ''}
          ${aktT ? `<span class="material-symbols-rounded icon dx-pfad-sep" aria-hidden="true">chevron_right</span><button type="button" aria-current="page" data-dx-ordner="${esc(aktB.name)}" data-dx-termin="${esc(aktT.id)}">${esc(aktT.text)}</button>` : ''}
        </nav>
        <div class="dx-werkzeug">
          <label class="dx-suche"><span class="material-symbols-rounded icon" aria-hidden="true">search</span><input type="search" id="dx-suche" placeholder="Dokument, Betrieb oder Termin suchen …" value="${esc(zustand.suche)}" aria-label="Dokumente durchsuchen"></label>
          <div class="ff-seg dx-typ" role="radiogroup" aria-label="Art">${[['alle', 'Alle'], ['foto', 'Fotos'], ['pdf', 'PDF'], ['sonst', 'Sonstige']].map(([k, t]) => `<button type="button" role="radio" data-dx-typ="${k}" aria-checked="${zustand.typ === k}">${t}</button>`).join('')}</div>
          <select id="dx-sort" class="dx-select" aria-label="Sortierung">${Object.entries(SORTIERUNG).map(([k, v]) => `<option value="${k}"${zustand.sort === k ? ' selected' : ''}>${v.text}</option>`).join('')}</select>
          <div class="ff-seg" role="radiogroup" aria-label="Darstellung">
            <button type="button" role="radio" data-dx-ansicht="liste" aria-checked="${zustand.ansicht === 'liste'}" title="Liste" aria-label="Liste"><span class="material-symbols-rounded icon" aria-hidden="true">view_list</span></button>
            <button type="button" role="radio" data-dx-ansicht="kacheln" aria-checked="${zustand.ansicht === 'kacheln'}" title="Kacheln" aria-label="Kacheln"><span class="material-symbols-rounded icon" aria-hidden="true">grid_view</span></button>
          </div>
        </div>
      </div>
      <div class="dx-koerper">
        <aside class="dx-baum" aria-label="Ordner">${baum}</aside>
        <section class="dx-inhalt">
          ${ordnerHtml}
          <div class="dx-info">
            <span id="dx-anzahl">${sichtbar.length} ${sichtbar.length === 1 ? 'Dokument' : 'Dokumente'}${summe ? ' · ' + groesseText(summe) : ''}</span>
            <span class="dx-info-akt">
              ${aktT && hooks.hinzufuegen ? `<label class="betrieb-btn"><span class="material-symbols-rounded icon" aria-hidden="true">add</span>Datei hinzufügen<input type="file" id="dx-datei" multiple hidden></label>` : ''}
              ${sichtbar.length ? `<button type="button" class="betrieb-btn" id="dx-zip"><span class="material-symbols-rounded icon" aria-hidden="true">folder_zip</span>Als ZIP herunterladen</button>` : ''}
            </span>
          </div>
          <p class="dx-meldung" id="dx-meldung" hidden></p>
          ${listeHtml}
        </section>
      </div>
    </div>`;
    vorschauLaden();
  }

  // Vorschaubilder erst holen, wenn die Kachel im Bild ist (jede braucht eine eigene Adresse vom Server)
  function vorschauLaden() {
    if (beobachter) beobachter.disconnect();
    const bilder = [...root.querySelectorAll('img[data-dx-bild]:not([src])')];
    if (!bilder.length || !hooks.vorschau) return;
    const lade = async (img) => {
      const d = sichtbar.find(x => x.id === img.dataset.dxBild);
      if (!d) return;
      try {
        const url = await hooks.vorschau(d);
        if (url) { vorschau.set(d.id, url); if (img.isConnected) img.src = url; }
      } catch { /* ohne Vorschau: Symbol bleibt */ }
    };
    if (!('IntersectionObserver' in window)) { bilder.forEach(lade); return; }
    // beobachtet wird die Kachel: das Bild selbst ist ohne Quelle unsichtbar und würde nie gemeldet
    beobachter = new IntersectionObserver((eintraege) => eintraege.forEach(e => {
      if (!e.isIntersecting) return;
      beobachter.unobserve(e.target);
      const img = e.target.querySelector('img[data-dx-bild]');
      if (img) lade(img);
    }), { root: null, rootMargin: '200px' });
    bilder.forEach(b => beobachter.observe(b.parentElement));
  }

  function melde(text) {
    const el = root.querySelector('#dx-meldung');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  root.addEventListener('click', async (e) => {
    const ord = e.target.closest('[data-dx-ordner]');
    if (ord) { zustand.betrieb = ord.dataset.dxOrdner || null; zustand.termin = ord.dataset.dxTermin || null; return render(); }
    const typ = e.target.closest('[data-dx-typ]');
    if (typ) { zustand.typ = typ.dataset.dxTyp; return render(); }
    const ans = e.target.closest('[data-dx-ansicht]');
    if (ans) { zustand.ansicht = ans.dataset.dxAnsicht; merken(); return render(); }
    if (e.target.closest('#dx-zip')) {
      const name = [zustand.betrieb, zustand.termin && (sichtbar[0] || {}).terminText].filter(Boolean).join(' ') || 'Dokumente';
      return hooks.zip(sichtbar.slice(), name, melde);
    }
    const akt = e.target.closest('[data-dx-akt]');
    if (!akt) return;
    const i = Number(akt.closest('[data-dx-i]').dataset.dxI);
    const d = sichtbar[i];
    if (!d) return;
    if (akt.dataset.dxAkt === 'ansehen') return hooks.ansehen(sichtbar.slice(), i);
    if (akt.dataset.dxAkt === 'umbenennen') return hooks.umbenennen(d);
    if (akt.dataset.dxAkt === 'loeschen') return hooks.loeschen(d);
    if (akt.dataset.dxAkt === 'termin') return hooks.zumTermin(d);
    if (akt.dataset.dxAkt === 'laden') return hooks.herunterladen(d, melde);
  });
  let sucheTimer = null;
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'dx-suche') return;
    zustand.suche = e.target.value;
    clearTimeout(sucheTimer);
    // nur Inhalt neu zeichnen, Fokus und Cursor im Suchfeld behalten
    sucheTimer = setTimeout(() => {
      const pos = e.target.selectionStart;
      render();
      const feld = root.querySelector('#dx-suche');
      if (feld) { feld.focus(); try { feld.setSelectionRange(pos, pos); } catch { /* */ } }
    }, 180);
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'dx-sort') { zustand.sort = e.target.value; merken(); return render(); }
    if (e.target.id === 'dx-datei' && zustand.termin) {
      const files = [...e.target.files];
      e.target.value = '';
      if (files.length) hooks.hinzufuegen(zustand.termin, files);
    }
  });

  return {
    // Dateien setzen und neu zeichnen
    zeige(liste) { dateien = liste; render(); },
    // In einen Ordner springen (z. B. aus der Kontrollmappe)
    oeffne(betrieb, termin) { zustand.betrieb = betrieb || null; zustand.termin = termin || null; zustand.suche = ''; zustand.typ = 'alle'; render(); },
    zustand
  };
}
