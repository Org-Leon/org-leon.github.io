// Baut die modernisierten Formular-Entwürfe (Probenahmeprotokoll FB.09.06.01,
// Cross Check FB.09.06.10) im FeldFolio-Design. Läuft im Browser mit der
// globalen pdf-lib (gleiche CDN-Version wie die App), gestartet über
// scripts/build-vorlagen-entwurf.mjs.
//
// Kompatibilität zur App (exportProbenprotokollPdf in src/main.js):
//  - exakt dieselben AcroForm-Feldnamen/-typen und Radio-Werte wie die
//    Originalvorlagen (inkl. "Auswahl 2" mit Leerzeichen, "PLZ  Ort" usw.),
//  - Unterschriftsbereiche genau an den Koordinaten, an denen die App die
//    Unterschriften einzeichnet (PROBENPROTOKOLL_SIGNATURE_BOXES,
//    CROSSCHECK_SIGNATURE_BOX) — die Entwürfe sind damit ohne Codeänderung
//    gegen die Originale austauschbar.
/* global PDFLib */
(function () {
  const { PDFDocument, StandardFonts, rgb, PDFName } = PDFLib;

  // Markenfarben wie im Gesamtbericht (src/gesamtbericht.js, BRAND).
  const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = {
    green: hex('#607E60'),
    greenDark: hex('#4C6349'),
    greenLight: hex('#87AA63'),
    tint: hex('#EEF3E8'),
    tintLight: hex('#F6F8F2'),
    coral: hex('#EB5C4E'),
    text: hex('#2B3328'),
    muted: hex('#6B7566'),
    line: hex('#D5DDCB'),
    white: hex('#FFFFFF')
  };
  const TEXT_DA = '0.169 0.2 0.157 rg'; // C.text für die Feldinhalte

  // Apfel aus der FeldFolio-/ÖkoP-Wortmarke (index.html #brand-logo).
  const APPLE = [
    ['#88AB64', 'M383.11,111.39c0,0-0.01,0.01-0.01,0.01C383.11,111.39,383.11,111.39,383.11,111.39c0.04-18.29-4.47-34.02-17.89-47c-18.25-17.65-46.16-20.66-67.08-6.07C298.14,58.31,332.44,118.37,383.11,111.39z'],
    ['#88AB64', 'M395.21,108.85c9.59,2.78,17.23,4.370,27.37,3.42c17.82-1.68,32.9-13.13,40.73-28.95C446.68,76.91,407.62,72.5,395.21,108.85z'],
    ['#617E61', 'M298.14,58.31c0,0,34.3,60.05,84.97,53.07C363.19,128.3,298.14,118.85,298.14,58.31z'],
    ['#617E61', 'M440.73,74.6c-11.29-1.2-20.84,1.14-29,5.26c-1.61,2.24-6.4,6.72-10.82,14.81c-0.85,1.58-1.59,3.08-2.22,4.49c-1.27,2.84-2.45,6.04-3.44,9.62c12.44-36.27,51.45-31.86,68.08-25.46C457.1,79.42,452.17,76.45,440.73,74.6z'],
    ['#6E5845', 'M412.07,79.33c-1.65,2.97-12.12,11.3-17.12,30.51c-2.41,9.28-2.65,16.46-2.38,26.03c-2.22,0.74-4.73,1.09-6.93,0.46c-5.910-11.29-0.94-30.77,4.03-41.89c0.85-1.91,1.91-3.74,2.95-5.55c1.46-2.53,3-5.02,4.61-7.45c1.51-2.29,3.08-4.55,4.84-6.66c1.2-1.43,2.53-2.83,4.3-3.54c1.26-0.5,2.68-0.72,4-0.32c2.7,0.82,3.35,3.74,2.66,6.19C412.79,77.87,412.46,78.62,412.07,79.33z'],
    ['#EB5D4F', 'M388.15,260.8c0.01,0,79.1-11.71,85.77-105.59c0,0.01,0,0.02,0,0.03c0,0,0,0,0,0c-2.18-6.03-5.25-11.65-9.35-16.62c-12.75-15.44-34.34-22.23-52.76-12.92c-2.64,1.33-5.03,3.53-7.63,4.98c-3,1.67-5.48,3.07-8.4,4.05c-2.22,0.74-4.67,1.86-7.16,1.87c-7.55,0.01-13.48-5.68-19.61-9.03c-13.68-7.47-27.230-7.59-40.93,0.31c-30.25,17.44-32.76,63.65-18.21,96.34c10.88,24.44,30.88,47.23,60.08,43.42C376.47,266.8,382.81,264.84,388.15,260.8L388.15,260.8z'],
    ['#C0453A', 'M388.14,260.8c0.01,0,79.1-11.71,85.77-105.59c1.82,4.64,2.92,13.08,3.32,15.75c0.66,4.46,0.11,13.67,0,18.19c-0.2,7.56-1.37,15.06-3.67,22.26c-5.62,17.65-15.33,37.03-31.01,47.75c-7.38,5.05-15.98,8.39-24.94,9c-4.82,0.33-9.63-0.11-14.34-1.22c-2.66-0.63-5.24-1.43-7.77-2.46C393.87,263.83,389.55,261.58,388.14,260.8z']
  ];

  const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;

  // Zeichen-/Feld-Helfer. t = Abstand von der Oberkante (Layout von oben
  // nach unten), y = PDF-Koordinate von unten.
  function makeSheet(doc, page, fonts) {
    const form = doc.getForm();
    const y = (t) => H - t;
    const s = {
      form, page, fonts,
      text(str, x, t, { size = 8, bold = false, color = C.text } = {}) {
        page.drawText(str, { x, y: y(t), size, font: bold ? fonts.bold : fonts.reg, color });
      },
      width(str, size, bold = false) { return (bold ? fonts.bold : fonts.reg).widthOfTextAtSize(str, size); },
      wrap(str, size, maxW, bold = false) {
        const words = str.split(' ');
        const lines = [];
        let cur = '';
        words.forEach(w => {
          const next = cur ? cur + ' ' + w : w;
          if (cur && s.width(next, size, bold) > maxW) { lines.push(cur); cur = w; } else cur = next;
        });
        if (cur) lines.push(cur);
        return lines;
      },
      para(str, x, t, maxW, { size = 7.8, lead = 9.6, color = C.muted, bold = false } = {}) {
        const lines = s.wrap(str, size, maxW, bold);
        lines.forEach((l, i) => s.text(l, x, t + i * lead, { size, color, bold }));
        return t + (lines.length - 1) * lead;
      },
      line(x1, t1, x2, t2, { color = C.line, width = 0.7 } = {}) {
        page.drawLine({ start: { x: x1, y: y(t1) }, end: { x: x2, y: y(t2) }, thickness: width, color });
      },
      // Abgerundetes Rechteck: x/t = linke obere Ecke.
      round(x, t, w, h, r, { fill, stroke, width = 0.7 } = {}) {
        const p = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
        page.drawSvgPath(p, { x, y: y(t), color: fill, borderColor: stroke, borderWidth: stroke ? width : 0 });
      },
      apple(x, t, height) {
        const sc = height / 219;
        APPLE.forEach(([col, d]) => page.drawSvgPath(d, { x: x - 292 * sc, y: y(t) + 54 * sc, scale: sc, color: hex(col) }));
      },
      // Abschnittstitel: grüner Punkt + Titel in Versalien + feine Linie.
      section(title, t, { x = M, w = CW } = {}) {
        page.drawCircle({ x: x + 2.5, y: y(t) + 2.6, size: 2.5, color: C.green });
        const label = title.toUpperCase();
        s.text(label, x + 9, t, { size: 7.4, bold: true, color: C.greenDark });
        const end = x + 9 + s.width(label, 7.4, true) + 6;
        if (end < x + w) s.line(end, t - 2.6, x + w, t - 2.6, { color: C.line, width: 0.6 });
      },
      // Eingabefeld als weiche Box mit Beschriftung innen oben links.
      field(name, x, t, w, h, label, { multiline = false, size = 9, sub = '' } = {}) {
        s.round(x, t, w, h, 5, { fill: C.tintLight, stroke: C.line, width: 0.6 });
        if (label) {
          s.text(label, x + 7, t + 8.6, { size: 6.6, color: C.muted, bold: true });
          if (sub) s.text(sub, x + 7 + s.width(label, 6.6, true) + 4, t + 8.6, { size: 6.2, color: C.muted });
        }
        const top = label ? 11 : 3;
        s.textField(name, x + 5, t + top, w - 10, h - top - 3, { multiline, size });
      },
      textField(name, x, t, w, h, { multiline = false, size = 9 } = {}) {
        const tf = form.createTextField(name);
        if (multiline) tf.enableMultiline();
        tf.addToPage(page, { x, y: y(t + h), width: w, height: h, borderWidth: 0, backgroundColor: undefined, textColor: C.text });
        tf.acroField.setDefaultAppearance(`/Helv ${size} Tf ${TEXT_DA}`);
        return tf;
      },
      // Feld als Schreiblinie (für kurze Ergänzungen hinter Ankreuzfeldern).
      lineField(name, x, t, w, { size = 8.5 } = {}) {
        s.line(x, t + 10, x + w, t + 10, { color: C.line, width: 0.8 });
        s.textField(name, x, t - 1, w, 11, { size });
      },
      checkbox(name, x, t, size = 9) {
        const cb = form.createCheckBox(name);
        cb.addToPage(page, { x, y: y(t + size), width: size, height: size, borderWidth: 0.9, borderColor: C.green, backgroundColor: C.white, textColor: C.greenDark });
        return cb;
      },
      // Nicht ausfüllbares Kästchen (Teil für die angefragte Stelle).
      box(x, t, size = 9) {
        s.round(x, t, size, size, 1.5, { fill: C.white, stroke: C.green, width: 0.9 });
      },
      radio(group, value, x, t, size = 10) {
        group.addOptionToPage(value, page, { x, y: y(t + size), width: size, height: size, borderWidth: 0.9, borderColor: C.green, backgroundColor: C.white, textColor: C.greenDark });
      }
    };
    return s;
  }

  // Kopf: Farbband, Apfel, Firmenname, Titel, Untertitel, Info-Box rechts.
  function header(s, { title, subtitle, info }) {
    s.page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: C.green });
    s.page.drawRectangle({ x: W - 90, y: H - 5, width: 90, height: 5, color: C.coral });
    s.apple(M, 20, 36);
    s.text('ÖkoP Zertifizierungs GmbH', M + 38, 28, { size: 7.6, bold: true, color: C.green });
    s.text(title, M + 38, 47, { size: 18, bold: true });
    s.text(subtitle, M + 38, 59, { size: 7.4, color: C.muted });
    const bw = 176, bx = W - M - bw;
    s.round(bx, 15, bw, 48, 7, { fill: C.tint });
    info.forEach((l, i) => s.text(l, bx + 9, 26 + i * 9.4, { size: 6.7, color: i === 0 ? C.greenDark : C.muted, bold: i === 0 }));
    s.line(M, 70, W - M, 70, { color: C.line, width: 0.8 });
  }
  function footer(s, left) {
    s.line(M, 814, W - M, 814, { color: C.line, width: 0.6 });
    s.text(left, M, 825, { size: 6.4, color: C.muted });
    const r = 'Seite 1 von 1';
    s.text(r, W - M - s.width(r, 6.4), 825, { size: 6.4, color: C.muted });
  }

  async function newDoc(title) {
    const doc = await PDFDocument.create();
    doc.setTitle(title);
    doc.setAuthor('ÖkoP Zertifizierungs GmbH');
    doc.setCreator('FeldFolio – Vorlagen-Entwurf');
    const page = doc.addPage([W, H]);
    const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
    return { doc, page, fonts, s: makeSheet(doc, page, fonts) };
  }
  // /Helv in die Formular-Ressourcen, damit die Feld-DAs ("/Helv 9 Tf") und
  // das /Helv, das die App beim Cross Check setzt, eine Schrift finden.
  function finishForm(doc, fonts) {
    const acro = doc.catalog.getOrCreateAcroForm();
    let dr = acro.dict.lookup(PDFName.of('DR'));
    if (!dr) { dr = doc.context.obj({}); acro.dict.set(PDFName.of('DR'), dr); }
    let fontDict = dr.lookup(PDFName.of('Font'));
    if (!fontDict) { fontDict = doc.context.obj({}); dr.set(PDFName.of('Font'), fontDict); }
    fontDict.set(PDFName.of('Helv'), fonts.reg.ref);
    acro.dict.set(PDFName.of('DA'), doc.context.obj(`/Helv 9 Tf ${TEXT_DA}`));
  }

  // ---------------- Probenahmeprotokoll (FB.09.06.01) ----------------
  async function buildProbenahme() {
    const { doc, page, fonts, s } = await newDoc('Probenahmeprotokoll FB.09.06.01 (Entwurf)');
    const colGap = 12, colW = (CW - colGap) / 2, x2 = M + colW + colGap;
    header(s, {
      title: 'Probenahmeprotokoll',
      subtitle: 'Protokoll über die Entnahme einer Probe sowie Probenahmebegleitpapier · Auftraggeber: ÖkoP Zertifizierungs GmbH',
      info: ['FB.09.06.01 · Ausgabe 7', 'gültig ab 01.01.2026 · ersetzt Ausgabe 6', 'Verteiler: ZB/KSL/QMB/FQS/DAkkS', 'Freigabe: AW']
    });

    // Probe & Kunde
    s.section('Probe & Kunde', 84);
    const rowH = 23, rows = [90, 117, 144, 171];
    s.field('Nr Analysenproben', M, rows[0], colW, rowH, 'Nr. Analysenprobe(n)');
    s.field('Nr der Gegenproben', x2, rows[0], colW, rowH, 'Nr. der Gegenprobe(n)');
    s.field('Name des Unternehmens', M, rows[1], colW, rowH, 'Kunde');
    s.field('Straße Hausnummer', x2, rows[1], colW, rowH, 'Straße, Hausnummer');
    s.field('Kundennummer', M, rows[2], colW, rowH, 'Kundennummer');
    s.field('PLZ  Ort', x2, rows[2], colW, rowH, 'PLZ, Ort');
    s.field('Bundesland', M, rows[3], colW, rowH, 'Bundesland');
    s.field('Probe', x2, rows[3], colW, rowH, 'Beprobtes Produkt');

    // Herkunft
    s.section('Herkunft der Probe', 208);
    const herkunft = s.form.createRadioGroup('Group10');
    const herkunftCol = (x, value, title, sub, fields) => {
      s.round(x, 214, colW, 128, 7, { stroke: C.line, width: 0.7 });
      s.radio(herkunft, value, x + 9, 222, 10);
      s.text(title, x + 25, 230, { size: 8.8, bold: true });
      s.text(sub, x + 25, 239.5, { size: 6.6, color: C.muted });
      fields.forEach(([name, label], i) => s.field(name, x + 7, 246 + i * 23.5, colW - 14, 21, label, { size: 8.5 }));
    };
    herkunftCol(M, 'Auswahl1', 'Eigene Produktion', 'inkl. Verarbeitung eigenerzeugter Erzeugnisse', [
      ['Produktionsmenge', 'Datum Produktion/Ernte/Abfüllung'], ['Charge', 'Chargennummer/MHD'],
      ['Menge', 'Menge der Charge/Ernte'], ['Lagermenge', 'Menge davon noch lagernd am Betrieb']
    ]);
    herkunftCol(x2, 'Auswahl 2', 'Zukaufs- und Handelsware', 'inkl. Verarbeitung mit zugekaufter Ware', [
      ['Lieferant', 'Lieferant'], ['Lieferdatum', 'Lieferdatum'],
      ['Liefermenge', 'Liefermenge'], ['Lagermenge Lieferung', 'Menge davon noch lagernd am Betrieb']
    ]);

    // Anlagen
    s.section('Anlagen zum beprobten Produkt', 356);
    const c3 = CW / 3;
    const anlage = (name, label, x, t) => { s.checkbox(name, x, t); s.text(label, x + 14, t + 7.5, { size: 8 }); };
    anlage('Anlage1', 'Rezeptur/Mischprotokoll', M, 363);
    anlage('Anlage2', 'Etikett/Foto der Charge', M + c3, 363);
    anlage('Anlage3', 'Zukaufsbeleg', M + 2 * c3, 363);
    anlage('Anlage4', 'Flurkarte / Skizze', M, 377);
    anlage('Anlage5', 'Sonstiges:', M + c3, 377);
    s.lineField('Anlage sonst', M + c3 + 56, 377, c3 * 2 - 60);

    // Probenahmeort
    s.section('Probenahmeort', 400);
    const ort = (cb, label, textName, x, t, w) => {
      s.checkbox(cb, x, t); s.text(label, x + 14, t + 7.5, { size: 8 });
      const lx = x + 14 + 78;
      s.lineField(textName, lx, t, x + w - lx);
    };
    ort('Probeort1', 'Lagerbezeichnung', 'Ort Lager', M, 407, colW);
    ort('Probeort2', 'Produktionsstätte', 'Ort Produktion', M, 422, colW);
    ort('Probeort3', 'Feldstücksname', 'Feldstück', M, 437, colW);
    ort('Probeort4', 'Bienenstandorte', 'Ort Bienen', x2, 407, colW);
    ort('Probeort5', 'Sonstiges', 'sonstiger Ort', x2, 422, colW);

    // Probenahme
    s.section('Probenahme', 460);
    s.field('DatumZeitpunkt und Ort der Probenahme', M, 466, 150, rowH, 'Datum');
    s.field('UhrzeitZeitpunkt und Ort der Probenahme', M + 158, 466, 96, rowH, 'Uhrzeit');
    s.field('Probenmenge', x2, 466, colW, rowH, 'Probenmenge');
    s.field('Analyse (Wirkstoff)', M, 493, CW, rowH, 'Ggf. zu analysierender Wirkstoff');
    s.text('Grund der Probenahme:', M, 530, { size: 8, bold: true });
    const grund = s.form.createRadioGroup('Group9');
    const grundOpt = (value, label, x) => { s.radio(grund, value, x, 522, 10); s.text(label, x + 14, 530, { size: 8 }); };
    grundOpt('Auswahl1', 'Routine', M + 100);
    grundOpt('Auswahl2', 'Verdacht', M + 160);
    grundOpt('Auswahl3', 'Sonstiges:', M + 224);
    s.lineField('Grund sonst', M + 280, 521, CW - 280);
    s.checkbox('Abdift', M, 537);
    s.text('Bei Abdrift: Flurkarte und genaue Erläuterung der gezogenen Proben, ggf. mit Skizze', M + 14, 544.5, { size: 8 });

    // Anmerkungen
    s.section('Anmerkungen zur Probenahme', 562);
    s.field('Erläuterung zur Probenahme Flurstücksname u nummer bzw Gebäudebezeichnung LagerChargennummer', M, 568, CW, 72, '', { multiline: true, size: 9 });

    // Probenehmer — Unterschrift genau im Bereich der App (x 380–555, y 148–178).
    s.text('PROBENEHMER (NAME IN DRUCKSCHRIFT)', M, 652, { size: 6.6, bold: true, color: C.muted });
    s.round(M, 656, 330, 38, 6, { fill: C.tintLight, stroke: C.line, width: 0.6 });
    s.textField('Probenehmer Name', M + 7, 668, 316, 20, { size: 10 });
    s.text('UNTERSCHRIFT DES PROBENEHMERS', 376, 652, { size: 6.6, bold: true, color: C.muted });
    s.round(376, 656, W - M - 376, 42, 6, { stroke: C.green, width: 0.8 });
    s.line(382, H - 150, W - M - 6, H - 150, { color: C.line, width: 0.6 });

    // Erklärung des Betriebsleiters
    s.section('Erklärung des Betriebsleiters', 712);
    const erkl = [
      ['Der Beauftragung eines akkreditierten Labors als Unterauftragnehmer der Kontrollstelle wird zugestimmt', 'Der Beauftragung eines akkreditierten Labors als Unterauftragnehmer der Kontrollstelle wird zugestimmt.'],
      ['Über die Bedeutung der Gegenprobe und Lagerung der Gegenproben wurde ich informiert', 'Über die Bedeutung der Gegenprobe und Lagerung der Gegenprobe(n) wurde ich informiert.'],
      ['Die Annahme und Verwahrung wurde abgelehnt', 'Die Annahme und Verwahrung wurde abgelehnt.'],
      ['Die genannten Angaben werden bestätigt', 'Die genannten Angaben werden bestätigt.']
    ];
    erkl.forEach(([name, label], i) => { s.checkbox(name, M, 717 + i * 11, 8); s.text(label, M + 13, 723.5 + i * 11, { size: 7.8 }); });

    // Ort, Datum + Unterschrift Betriebsinhaber (App: x 240–460, y 54–88).
    s.textField('Text1', M, H - 76, 196, 18, { size: 9.5 });
    s.line(M, H - 54, M + 196, H - 54, { color: C.greenDark, width: 0.8 });
    s.line(240, H - 54, W - M, H - 54, { color: C.greenDark, width: 0.8 });
    s.text('Ort, Datum', M, H - 44, { size: 7, bold: true, color: C.muted });
    s.text('Unterschrift des Betriebsinhabers oder seines Stellvertreters', 240, H - 44, { size: 7, bold: true, color: C.muted });

    footer(s, 'ÖkoP Zertifizierungs GmbH · Probenahmeprotokoll · FB.09.06.01 · Ausgabe 7');
    finishForm(doc, fonts);
    return doc.saveAsBase64();
  }

  // ---------------- Cross Check (FB.09.06.10) ----------------
  async function buildCrossCheck() {
    const { doc, page, fonts, s } = await newDoc('Cross Check FB.09.06.10 (Entwurf)');
    const colGap = 12, colW = (CW - colGap) / 2, x2 = M + colW + colGap;
    header(s, {
      title: 'Cross Check',
      subtitle: 'Anfrage an eine andere Kontrollstelle zur Prüfung einer Lieferung',
      info: ['ÖkoP Zertifizierungs GmbH · DE-ÖKO-037', 'Europaring 4 · 94315 Straubing', 'biokontrollstelle@oekop.de', 'FB.09.06.10 · Ausgabe 7 · gültig ab 21.02.2025']
    });

    // Anfrage
    s.section('Anfrage an die Kontrollstelle', 84);
    s.field('Kontrollstelle', M, 90, 250, 24, 'Kontrollstelle');
    s.field('Codenummer', M + 258, 90, 110, 24, 'Codenummer');
    const bx = M + 376, bw = W - M - bx;
    s.round(bx, 90, bw, 24, 5, { fill: C.tint });
    s.text('Bearbeitungsnummer', bx + 7, 98.6, { size: 6.6, bold: true, color: C.greenDark });
    s.text('wird von der Kontrollstelle eingetragen', bx + 7, 109, { size: 6, color: C.muted });
    s.para('Bitte prüfen Sie, ob die Lieferung gemäß Ihrer Beleg-Prüfung auch entsprechend den unten genannten Angaben stattgefunden hat, und teilen Sie uns das Ergebnis der Prüfung bitte mit.', M, 127, CW, { size: 7.8, color: C.text });

    // Unternehmen / Empfänger bzw. Lieferant
    s.section('ÖkoP-kontrolliertes Unternehmen', 152, { w: colW });
    s.field('Name', M, 158, colW, 22, 'Name', { size: 8.5 });
    s.field('Anschrift', M, 184, colW, 34, 'Adresse', { multiline: true, size: 8.5 });
    page.drawCircle({ x: x2 + 2.5, y: H - 152 + 2.6, size: 2.5, color: C.green });
    s.text('ANGABEN ZUM', x2 + 9, 152, { size: 7.4, bold: true, color: C.greenDark });
    const g1 = s.form.createRadioGroup('Group1');
    s.radio(g1, 'Auswahl1', x2 + 70, 144, 9.5); s.text('Empfänger', x2 + 83, 152, { size: 7.8, bold: true });
    s.radio(g1, 'Auswahl2', x2 + 138, 144, 9.5); s.text('bzw. Lieferanten', x2 + 151, 152, { size: 7.8, bold: true });
    s.field('Name_2', x2, 158, colW, 22, 'Name', { size: 8.5 });
    s.field('Anschrift_2', x2, 184, colW, 34, 'Adresse', { multiline: true, size: 8.5 });

    // Lieferung
    s.section('Angaben zur Lieferung', 232);
    const lw = (CW - 3 * 8) / 4;
    [['ProduktRow1', 'Produkt'], ['Lieferdatum  LieferzeitraumRow1', 'Lieferdatum / -zeitraum'], ['MengeRow1', 'Menge'],
     ['Nummer und Datum Lieferschein  RechnungRow1', 'Nr. + Datum Lieferschein/Rechnung']]
      .forEach(([name, label], i) => s.field(name, M + i * (lw + 8), 238, lw, 64, label, { multiline: true }));
    s.text('Anlagen:', M, 320, { size: 8, bold: true });
    const anl = (name, label, x) => { s.checkbox(name, x, 312.5, 9); s.text(label, x + 13, 320, { size: 8 }); };
    anl('Lieferschein', 'Lieferschein', M + 46);
    anl('Rechnung', 'Rechnung', M + 118);
    anl('Gutschrift', 'Gutschrift', M + 186);
    anl('Sonstige', 'sonstiges:', M + 254);
    s.lineField('sonstiges', M + 314, 311, CW - 314);

    // Zentrale Fragestellung
    s.section('Zentrale Fragestellung', 342);
    const g2 = s.form.createRadioGroup('Group2');
    s.radio(g2, 'Auswahl1', M, 348, 10);
    s.text('Lieferantenprüfung:', M + 15, 356, { size: 8.2, bold: true });
    s.text('Bitte prüfen Sie, ob die Lieferung von Ihrem Kunden stammen kann und als Warenausgang verbucht ist.', M + 15, 366, { size: 7.8 });
    s.radio(g2, 'Auswahl2', M, 373, 10);
    s.text('Empfängerprüfung:', M + 15, 381, { size: 8.2, bold: true });
    s.text('Bitte überprüfen Sie, ob im genannten Zeitraum …', M + 15, 391, { size: 7.8 });
    s.checkbox('Check Box2', M + 26, 396, 8.5); s.text('die Lieferung verbucht wurde.', M + 39, 403, { size: 7.8 });
    s.checkbox('Check Box3', M + 26, 408, 8.5); s.text('noch weitere Lieferungen dieses Produktes in Empfang genommen wurden.', M + 39, 415, { size: 7.8 });

    // Weitergehende Fragestellung
    s.section('Weitergehende Fragestellung', 434);
    s.field('weitergehende Fragestellung', M, 440, CW, 50, '', { multiline: true });

    // Mit der Bitte um
    s.section('Mit der Bitte um', 506);
    const g3 = s.form.createRadioGroup('Group3');
    s.radio(g3, 'Auswahl1', M, 512, 10);
    s.text('zeitnahe Beleg-Prüfung', M + 15, 520, { size: 8.2, bold: true });
    s.para('(begründete Zweifel, z. B. an der Öko-Qualität der Lieferung. Kurzfristige Rücksendung der Ergebnisse erforderlich an: biokontrollstelle@oekop.de).', M + 15 + s.width('zeitnahe Beleg-Prüfung ', 8.2, true), 520, CW - 120, { size: 7.8, color: C.text, lead: 9.4 });
    s.radio(g3, 'Auswahl2', M, 541, 10);
    s.text('Routineprüfung', M + 15, 549, { size: 8.2, bold: true });
    s.para('im Rahmen einer Jahres- oder Stichprobenkontrolle. Bitte Ergebnisse nur dann an biokontrollstelle@oekop.de zurücksenden, falls der Bio-Status nicht zweifelsfrei bestätigt werden kann.', M + 15 + s.width('Routineprüfung ', 8.2, true), 549, CW - 90, { size: 7.8, color: C.text, lead: 9.4 });

    // Datum + Unterschrift (App: Unterschrift x 172–372, y 211–237).
    s.textField('Datum', M + 6, H - 230, 118, 17, { size: 9 });
    s.line(M, H - 209, 392, H - 209, { color: C.greenDark, width: 0.8 });
    s.text('Datum, Unterschrift Kontrolleur / Kontrollstelle', M, H - 199, { size: 7, bold: true, color: C.muted });

    // Ergebnis der Prüfung (füllt die angefragte Kontrollstelle aus).
    s.round(M, 660, CW, 146, 9, { fill: C.tintLight, stroke: C.line, width: 0.7 });
    s.page.drawRectangle({ x: M, y: H - 806, width: 4, height: 146, color: C.green });
    s.text('Ergebnis der Prüfung', M + 14, 676, { size: 9.5, bold: true });
    s.text('wird von der angefragten Kontrollstelle ausgefüllt', M + 14 + s.width('Ergebnis der Prüfung', 9.5, true) + 8, 676, { size: 6.8, color: C.muted });
    s.box(M + 14, 684); s.text('Ja, die Angaben können bestätigt werden.', M + 28, 691.5, { size: 8 });
    s.box(M + 14, 698); s.text('Nein, die Angaben können nicht bestätigt werden. Bitte um Erläuterung:', M + 28, 705.5, { size: 8 });
    [724, 741, 758].forEach(t => s.line(M + 28, t, W - M - 14, t, { color: C.line, width: 0.7 }));
    s.line(M + 14, 786, 392, 786, { color: C.greenDark, width: 0.8 });
    s.text('Datum, Unterschrift Kontrolleur / Kontrollstelle', M + 14, 796, { size: 7, bold: true, color: C.muted });

    footer(s, 'ÖkoP Zertifizierungs GmbH · Cross Check · FB.09.06.10 · Ausgabe 7 · Verteiler: ZB/KSL/QMB/FQS/DAkkS · Freigabe: AW');
    finishForm(doc, fonts);
    return doc.saveAsBase64();
  }

  window.__buildVorlagenEntwurf = async () => ({
    probenahme: await buildProbenahme(),
    crosscheck: await buildCrossCheck()
  });
})();
