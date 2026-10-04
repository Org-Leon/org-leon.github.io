// Gesamtübersicht als PDF im Markendesign (ÖkoP/FeldFolio, Light Mode).
// Nur Layout-Bausteine auf Basis von jsPDF/jspdf-autotable (window.jspdf,
// per <script> geladen) — Daten und Kartenbilder liefert main.js
// (exportKombiniertesPDF). A4 quer, Maße in mm.

// Markenfarben von ökop.de (Grün #87AA63/#607E60, Koralle #EB5C4E) plus
// abgeleitete helle Flächen- und Textfarben für den Druck.
export const BRAND = {
  green: '#607E60',
  greenLight: '#87AA63',
  tint: '#EEF3E8',
  tintLight: '#F6F8F2',
  coral: '#EB5C4E',
  text: '#2B3328',
  muted: '#6B7566',
  line: '#D5DDCB',
  white: '#FFFFFF'
};

// Farbreihe für Kulturarten — Grün- und Erdtöne aus der Markenwelt, gut
// unterscheidbar, auch im Graustufendruck unterschiedlich hell.
export const CULTURE_COLORS = [
  '#607E60', '#87AA63', '#E8A33D', '#EB5C4E', '#4F8A8B', '#8C6D4F',
  '#B5C98F', '#D98E73', '#6E8F4E', '#A4B494', '#C9B458', '#7F9CA8'
];

export function formatHa(n, digits = 2) {
  return (Number.isFinite(n) ? n : 0).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
// Einzelflächen mit Größe aus der Shapedatei: bis zu vier Nachkommastellen
// (auf den Quadratmeter genau, wie im Antrag), mindestens zwei. Summen,
// Kennzahlen und aus der Geometrie berechnete Größen bleiben bei formatHa().
export function formatHaExact(n) {
  return (Number.isFinite(n) ? n : 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
// Dasselbe mit Dezimalpunkt (Tabellen-Exporte, bisher toFixed(2)).
export function haExactFixed(n) {
  return Number(n).toFixed(4).replace(/0{1,2}$/, '');
}
export function formatPct(part, total) {
  if (!total) return '0 %';
  return (part / total * 100).toLocaleString('de-DE', { maximumFractionDigits: part / total < 0.1 ? 1 : 0 }) + ' %';
}

export class BerichtPdf {
  constructor({ betrieb, datum, logo }) {
    this.doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    this.W = this.doc.internal.pageSize.getWidth();
    this.H = this.doc.internal.pageSize.getHeight();
    this.M = 14;
    this.betrieb = betrieb;
    this.datum = datum;
    this.logo = logo; // { dataUrl, aspectRatio } mit transparentem Hintergrund, oder null
    this.sections = []; // { title, page } fürs Inhaltsverzeichnis
    this.mapPages = new Set(); // Kartenseiten: Wasserzeichen in der Infospalte statt mittig
    this.contentTop = 32;
    this.contentBottom = this.H - 16;
  }

  // ---- Grundelemente ----
  setText(color, size, bold = false) {
    this.doc.setTextColor(color);
    this.doc.setFontSize(size);
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal');
  }
  fitText(text, maxW) {
    const s = String(text);
    if (this.doc.getTextWidth(s) <= maxW) return s;
    let t = s;
    while (t.length > 1 && this.doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  withOpacity(opacity, fn) {
    const d = this.doc;
    const ok = typeof d.setGState === 'function' && typeof d.GState === 'function';
    if (ok) d.setGState(new d.GState({ opacity }));
    try { fn(); } finally { if (ok) d.setGState(new d.GState({ opacity: 1 })); }
  }

  // ---- Seiten ----
  cover({ title, subtitle, highlights }) {
    const d = this.doc, M = this.M, W = this.W, H = this.H;
    // Rechte, helle Spalte "Auf einen Blick"
    const panelX = W * 0.63;
    d.setFillColor(BRAND.tint);
    d.rect(panelX, 0, W - panelX, H, 'F');
    d.setFillColor(BRAND.green);
    d.rect(0, 0, W, 4, 'F');

    if (this.logo) {
      const w = 92, h = w / this.logo.aspectRatio;
      d.addImage(this.logo.dataUrl, 'PNG', M, 20, w, h);
    }
    this.setText(BRAND.green, 30, true);
    d.text(title, M, 70);
    d.setDrawColor(BRAND.coral);
    d.setLineWidth(1.2);
    d.line(M, 75, M + 26, 75);
    this.setText(BRAND.muted, 11);
    d.text(subtitle, M, 83);

    this.setText(BRAND.muted, 8.5, true);
    d.text('BETRIEB', M, 100);
    this.setText(BRAND.text, 15, true);
    d.text(this.fitText(this.betrieb, panelX - M * 2), M, 107);
    this.setText(BRAND.muted, 8.5, true);
    d.text('STAND', M, 117);
    this.setText(BRAND.text, 12);
    d.text(this.datum, M, 123.5);
    this.coverTocY = 138; // Inhaltsverzeichnis folgt in finalize()

    // Auf einen Blick
    let y = 26;
    this.setText(BRAND.green, 13, true);
    d.text('Auf einen Blick', panelX + 12, y);
    y += 12;
    highlights.forEach(hl => {
      this.setText(BRAND.text, 22, true);
      d.text(hl.value, panelX + 12, y + 7);
      this.setText(BRAND.muted, 9);
      d.text(hl.label, panelX + 12, y + 13);
      y += 24;
    });

    d.setFillColor(BRAND.green);
    d.rect(0, H - 11, W, 11, 'F');
    this.setText(BRAND.white, 8.5);
    d.text('Erstellt mit FeldFolio', M, H - 4.2);
  }

  addPage(title, subtitle, { section } = {}) {
    this.doc.addPage('a4', 'landscape');
    const page = this.doc.internal.getNumberOfPages();
    if (section) this.sections.push({ title: section, page });
    this.drawHeader(title, subtitle);
    return this.contentTop;
  }

  drawHeader(title, subtitle) {
    const d = this.doc, M = this.M, W = this.W;
    d.setFillColor(BRAND.green);
    d.rect(0, 0, W, 3, 'F');
    let maxTitleW = W - M * 2;
    if (this.logo) {
      const h = 8, w = h * this.logo.aspectRatio;
      d.addImage(this.logo.dataUrl, 'PNG', W - M - w, 9, w, h);
      maxTitleW -= w + 8;
    }
    this.setText(BRAND.green, 16, true);
    d.text(this.fitText(title, maxTitleW), M, 15);
    if (subtitle) {
      this.setText(BRAND.muted, 9);
      d.text(this.fitText(subtitle, maxTitleW), M, 21);
    }
    d.setDrawColor(BRAND.line);
    d.setLineWidth(0.3);
    d.line(M, 25.5, W - M, 25.5);
    d.setDrawColor(BRAND.coral);
    d.setLineWidth(0.9);
    d.line(M, 25.5, M + 18, 25.5);
  }

  // Kennzahl-Kacheln; die erste (wichtigste) grün hervorgehoben.
  kpiTiles(y, tiles, { h = 25 } = {}) {
    const d = this.doc, M = this.M;
    const gap = 4;
    const w = (this.W - M * 2 - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((t, i) => {
      const x = M + i * (w + gap);
      const primary = i === 0;
      d.setFillColor(primary ? BRAND.green : BRAND.tint);
      d.roundedRect(x, y, w, h, 2.5, 2.5, 'F');
      this.setText(primary ? BRAND.white : BRAND.muted, 7.5, true);
      d.text(t.label.toUpperCase(), x + 5, y + 7);
      this.setText(primary ? BRAND.white : BRAND.text, t.value.length > 9 ? 15 : 19, true);
      d.text(t.value, x + 5, y + 17);
      if (t.unit) {
        const vw = d.getTextWidth(t.value);
        this.setText(primary ? BRAND.white : BRAND.muted, 9);
        d.text(t.unit, x + 5 + vw + 1.5, y + 17);
      }
      if (t.sub) {
        this.setText(primary ? '#E3ECD9' : BRAND.muted, 7.5);
        d.text(this.fitText(t.sub, w - 10), x + 5, y + 22);
      }
    });
    return y + h;
  }

  // Durchgehender Balken, anteilig nach Kulturen eingefärbt.
  stackedBar(x, y, w, h, items, total) {
    const d = this.doc;
    d.setFillColor(BRAND.tint);
    d.rect(x, y, w, h, 'F');
    let cx = x;
    items.forEach(it => {
      const sw = total ? (it.value / total) * w : 0;
      if (sw <= 0) return;
      d.setFillColor(it.color);
      d.rect(cx, y, sw, h, 'F');
      cx += sw;
    });
    return y + h;
  }

  // Liste mit horizontalen Balken: Name · Balken · Wert · Anteil.
  barList(x, y, w, items, total, { rowH = 7.2, valueFmt = (v) => `${formatHa(v)} ha` } = {}) {
    const d = this.doc;
    const labelW = w * 0.34;
    const valueW = 38;
    const barX = x + labelW + 3;
    const barW = w - labelW - valueW - 6;
    const max = Math.max(...items.map(i => i.value), 0.0001);
    items.forEach((it, i) => {
      const cy = y + i * rowH;
      d.setFillColor(it.color);
      d.rect(x, cy - 2.6, 2.6, 2.6, 'F');
      this.setText(BRAND.text, 9);
      d.text(this.fitText(it.label, labelW - 5), x + 4.5, cy);
      d.setFillColor(BRAND.tintLight);
      d.roundedRect(barX, cy - 3.2, barW, 3.8, 1.2, 1.2, 'F');
      const bw = Math.max(0.8, (it.value / max) * barW);
      d.setFillColor(it.color);
      d.roundedRect(barX, cy - 3.2, bw, 3.8, 1.2, 1.2, 'F');
      this.setText(BRAND.text, 9, true);
      d.text(valueFmt(it.value), x + w - 14, cy, { align: 'right' });
      this.setText(BRAND.muted, 8);
      d.text(formatPct(it.value, total), x + w, cy, { align: 'right' });
    });
    return y + items.length * rowH;
  }

  // Heller Kasten mit Überschrift und Zeilen (Beschriftung/Wert, optional
  // Farbfeld) — rechte Infospalte der Kartenseiten und Nebenpanels.
  infoPanel(x, y, w, title, rows, { minH = 0 } = {}) {
    const d = this.doc;
    const rowsH = rows.reduce((s, r) => s + (r.value != null ? 11 : 6.5), 0);
    const h = Math.max(minH, 14 + rowsH);
    d.setFillColor(BRAND.tint);
    d.roundedRect(x, y, w, h, 2.5, 2.5, 'F');
    this.setText(BRAND.green, 11, true);
    d.text(this.fitText(title, w - 10), x + 5, y + 8);
    let cy = y + 15;
    rows.forEach(r => {
      if (r.value != null) {
        this.setText(BRAND.muted, 7.5, true);
        d.text(String(r.label).toUpperCase(), x + 5, cy);
        this.setText(BRAND.text, 10.5, !!r.bold);
        d.text(this.fitText(r.value, w - 10), x + 5, cy + 5);
        cy += 11;
      } else {
        // Legendenzeile: Farbfeld + Text
        if (r.color) {
          d.setFillColor(r.color);
          if (r.round) d.circle(x + 6.3, cy - 1.2, 1.4, 'F');
          else d.rect(x + 5, cy - 2.6, 2.8, 2.8, 'F');
        }
        this.setText(BRAND.text, 9);
        d.text(this.fitText(r.label, w - 14), x + (r.color ? 10 : 5), cy);
        cy += 6.5;
      }
    });
    return y + h;
  }

  // Kartenbild eingepasst, mit feinem Rahmen. Ohne Bild: Platzhalter.
  image(canvas, x, y, maxW, maxH) {
    const d = this.doc;
    if (!canvas) {
      d.setFillColor(BRAND.tintLight);
      d.rect(x, y, maxW, maxH, 'F');
      this.setText(BRAND.muted, 10);
      d.text('Kartenbild konnte nicht erstellt werden.', x + maxW / 2, y + maxH / 2, { align: 'center' });
      return { w: maxW, h: maxH };
    }
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
    const w = canvas.width * scale, h = canvas.height * scale;
    d.addImage(canvas.toDataURL('image/jpeg', 0.86), 'JPEG', x, y, w, h);
    d.setDrawColor(BRAND.line);
    d.setLineWidth(0.3);
    d.rect(x, y, w, h, 'S');
    return { w, h };
  }

  // Kartenseite: Bild links, Infospalte rechts.
  mapPage(title, subtitle, canvas, panelTitle, panelRows, { section } = {}) {
    const top = this.addPage(title, subtitle, { section });
    this.mapPages.add(this.doc.internal.getNumberOfPages());
    const panelW = 66;
    const imgMaxW = this.W - this.M * 2 - panelW - 6;
    this.image(canvas, this.M, top, imgMaxW, this.contentBottom - top);
    this.infoPanel(this.W - this.M - panelW, top, panelW, panelTitle, panelRows);
  }

  // Tabelle im Markendesign; bricht automatisch auf Folgeseiten um (mit
  // Kopfzeile "… (Fortsetzung)").
  table({ title, subtitle, startY, head, body, foot, columnStyles, section, didDrawCell, didParseCell }) {
    let y = startY;
    if (y == null) y = this.addPage(title, subtitle, { section });
    const bericht = this;
    this.doc.autoTable({
      head, body, foot,
      startY: y,
      margin: { top: this.contentTop, bottom: 18, left: this.M, right: this.M },
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 9, textColor: BRAND.text, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineWidth: 0 },
      headStyles: { fillColor: BRAND.green, textColor: BRAND.white, fontStyle: 'bold', fontSize: 8.5, lineWidth: 0 },
      footStyles: { fillColor: BRAND.tint, textColor: BRAND.text, fontStyle: 'bold', lineWidth: 0 },
      alternateRowStyles: { fillColor: BRAND.tintLight },
      columnStyles: columnStyles || {},
      showFoot: 'lastPage',
      didParseCell,
      didDrawCell,
      didDrawPage: (data) => {
        if (data.pageNumber > 1) bericht.drawHeader(`${title} (Fortsetzung)`, subtitle);
      }
    });
    return this.doc.lastAutoTable.finalY;
  }

  sectionHeading(text, x, y) {
    this.setText(BRAND.green, 11.5, true);
    this.doc.text(text, x, y);
    return y + 6;
  }

  note(text, x, y, maxW) {
    this.setText(BRAND.muted, 8);
    const lines = this.doc.splitTextToSize(text, maxW);
    this.doc.text(lines, x, y);
    return y + lines.length * 3.6;
  }

  // Inhaltsverzeichnis aufs Deckblatt, Fußzeilen mit Seitenzahl und das
  // Logo als dezentes Wasserzeichen auf jeder Seite.
  finalize() {
    const d = this.doc, M = this.M, W = this.W, H = this.H;
    const n = d.internal.getNumberOfPages();

    d.setPage(1);
    if (this.sections.length) {
      let y = this.coverTocY;
      this.setText(BRAND.muted, 8.5, true);
      d.text('INHALT', M, y);
      y += 6.5;
      const tocW = W * 0.63 - M * 2;
      this.sections.forEach(s => {
        this.setText(BRAND.text, 10.5);
        d.text(s.title, M, y);
        const tw = d.getTextWidth(s.title);
        this.setText(BRAND.green, 10.5, true);
        d.text(String(s.page), M + tocW, y, { align: 'right' });
        d.setDrawColor(BRAND.line);
        d.setLineWidth(0.25);
        d.setLineDashPattern([0.6, 1.2], 0);
        d.line(M + tw + 2, y - 0.8, M + tocW - 8, y - 0.8);
        d.setLineDashPattern([], 0);
        y += 7;
      });
    }

    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      if (this.logo) {
        if (this.mapPages.has(i)) {
          // Kartenseite: das Luftbild füllt die Mitte — Wasserzeichen unten
          // in der freien Infospalte.
          const w = 58, h = w / this.logo.aspectRatio;
          this.withOpacity(0.12, () => {
            d.addImage(this.logo.dataUrl, 'PNG', W - M - w - 4, this.contentBottom - h - 4, w, h);
          });
        } else {
          const w = 150, h = w / this.logo.aspectRatio;
          this.withOpacity(i === 1 ? 0.035 : 0.06, () => {
            d.addImage(this.logo.dataUrl, 'PNG', (W - w) / 2, (H - h) / 2 + 6, w, h);
          });
        }
      }
      if (i === 1) continue;
      d.setDrawColor(BRAND.line);
      d.setLineWidth(0.3);
      d.line(M, H - 11, W - M, H - 11);
      this.setText(BRAND.muted, 7.5);
      d.text(this.fitText(`FeldFolio · Gesamtübersicht · ${this.betrieb} · ${this.datum}`, W - M * 2 - 40), M, H - 6.5);
      d.text(`Seite ${i} von ${n}`, W - M, H - 6.5, { align: 'right' });
    }
  }
}
