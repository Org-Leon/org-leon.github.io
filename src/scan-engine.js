// Bildverarbeitung des Dokumentenscanners (angelehnt an Adobe Scan):
// Kamerawahl, Blatt-Erkennung, ruhiger Live-Rahmen, Entzerrung und
// Dokument-Filter. Nutzt OpenCV.js (globales `cv`, von main.js per
// ensureScanLibs() nachgeladen) — hier nur reine Funktionen ohne DOM-
// Zustand, damit sie sich gezielt testen lassen (window.__ffTestScan).

// ---------- Kamerawahl ----------
// facingMode:'environment' überlässt dem Browser die Wahl — auf Handys mit
// mehreren Rückkameras (z. B. Galaxy S20) landet man damit oft beim
// Ultraweitwinkel (Fixfokus, verzerrt, unscharf aus der Nähe). Die
// Hauptkamera wird deshalb über die Gerätebeschriftung bestimmt:
//   Android/Chrome: "camera2 0, facing back" (0 = Hauptkamera), "camera2 2,
//                   facing back" (Weitwinkel/Tele haben höhere Nummern)
//   iOS/Safari:     "Back Camera"/"Rückkamera" = Hauptkamera, daneben
//                   "Back Ultra Wide Camera", "Rückseitige Telekamera" …
const SCAN_BACK_LABEL = /back|rück|rueck|rear|environment|hinten/i;
const SCAN_SECONDARY_LABEL = /ultra|weitwinkel|wide|tele|zoom|makro|macro|depth|tiefe|infrarot|infrared/i;

export function rankBackCameras(devices) {
  const cams = devices.filter(d => d.kind === 'videoinput');
  const back = cams.filter(d => SCAN_BACK_LABEL.test(d.label || ''));
  // Ohne Beschriftung (noch keine Kamera-Berechtigung) oder ohne erkennbare
  // Rückkamera (Desktop-Webcam): alle Kameras in Originalreihenfolge.
  const pool = back.length ? back : cams;
  const score = (d) => {
    const label = (d.label || '').trim();
    let s = 0;
    if (SCAN_SECONDARY_LABEL.test(label)) s -= 100;
    if (/^(back camera|rückkamera|rear camera)$/i.test(label)) s += 50;
    const num = /camera2?\s*(\d+)/i.exec(label);
    if (num) s -= Number(num[1]);
    return s;
  };
  return pool
    .map((d, i) => ({ d, i, s: score(d) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(x => x.d);
}

// ---------- Hilfen ----------
// Zeichnet Video/Bild/Canvas verkleinert (längste Seite <= maxSide) in ein
// neues Canvas — Blatt-Erkennung läuft bewusst auf wenigen hundert Pixeln.
export function drawScaled(source, maxSide, target) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  // target: vorhandenes Canvas wiederverwenden (Live-Erkennung, ~9×/s).
  const canvas = target || document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function rotateCanvas(canvas, quarterTurns) {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (!turns) return canvas;
  const out = document.createElement('canvas');
  const swap = turns % 2 === 1;
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(turns * Math.PI / 2);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Ecken in feste Reihenfolge oben-links, oben-rechts, unten-rechts, unten-links.
export function orderQuad(points) {
  const bySum = [...points].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...points].sort((a, b) => (a.x - a.y) - (b.x - b.y));
  const tl = bySum[0], br = bySum[3];
  const tr = byDiff[3], bl = byDiff[0];
  // Bei stark gedrehten Blättern können Summen-/Differenz-Sortierung
  // denselben Punkt liefern — dann über den Winkel um den Mittelpunkt sortieren.
  if (new Set([tl, tr, br, bl]).size < 4) {
    const cx = points.reduce((s, p) => s + p.x, 0) / 4;
    const cy = points.reduce((s, p) => s + p.y, 0) / 4;
    const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    // atan2-Reihenfolge beginnt links (−π) → im Uhrzeigersinn: tl, tr, br, bl
    const start = sorted.reduce((best, p, i) => ((p.x + p.y) < (sorted[best].x + sorted[best].y) ? i : best), 0);
    return [0, 1, 2, 3].map(k => sorted[(start + k) % 4]);
  }
  return [tl, tr, br, bl];
}

function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

function quadAnglesOk(q) {
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4], c = q[i], n = q[(i + 1) % 4];
    const v1 = { x: p.x - c.x, y: p.y - c.y }, v2 = { x: n.x - c.x, y: n.y - c.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    const deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    if (deg < 40 || deg > 140) return false;
  }
  return true;
}

export function defaultQuad() {
  return [{ x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 }];
}

// ---------- Blatt-Erkennung ----------
// Sucht das größte plausible Viereck (Blatt) im Bild. Zwei Wege, das größere
// gültige Ergebnis gewinnt:
//   1. Kanten: Weichzeichnen, Text/Linien per morphologischem Schließen
//      "wegwischen", Canny mit automatischen Schwellen (Median).
//   2. Helligkeit: Otsu-Schwelle — helles Papier auf dunklerem Grund.
// Rückgabe: 4 Ecken normiert auf 0..1 (tl, tr, br, bl) oder null.
// ---- Bild <-> OpenCV-Matrix ----
// OpenCV läuft in einem eigenen Rahmen (scan-sandbox.html, siehe ensureScanLibs
// in main.js). cv.imread()/cv.imshow() prüfen "canvas instanceof HTMLCanvasElement"
// — das schlägt für eine Zeichenfläche aus DIESEM Fenster fehl. Daher hier
// dieselbe Umwandlung ohne diese Prüfung.
function matVonCanvas(cv, canvas) {
  const ctx = canvas.getContext('2d');
  return cv.matFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}
function matAufCanvas(cv, mat, canvas) {
  const img = new cv.Mat();
  try {
    const depth = mat.type() % 8;
    const scale = depth <= cv.CV_8S ? 1 : depth <= cv.CV_32S ? 1 / 256 : 255;
    const shift = depth === cv.CV_8S || depth === cv.CV_16S ? 128 : 0;
    mat.convertTo(img, cv.CV_8U, scale, shift);
    const typ = img.type();
    if (typ === cv.CV_8UC1) cv.cvtColor(img, img, cv.COLOR_GRAY2RGBA);
    else if (typ === cv.CV_8UC3) cv.cvtColor(img, img, cv.COLOR_RGB2RGBA);
    else if (typ !== cv.CV_8UC4) throw new Error('Bildformat wird nicht unterstützt.');
    canvas.width = img.cols;
    canvas.height = img.rows;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.cols, img.rows), 0, 0);
  } finally {
    img.delete();
  }
}

export function detectDocumentQuad(canvas) {
  const cv = window.cv;
  const W = canvas.width, H = canvas.height;
  const minArea = W * H * 0.12;
  const maxArea = W * H * 0.985;
  const mats = [];
  const track = (m) => { mats.push(m); return m; };
  let best = null;

  const consider = (contours) => {
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < minArea) { c.delete(); continue; }
      const hull = new cv.Mat();
      cv.convexHull(c, hull, false, true);
      const peri = cv.arcLength(hull, true);
      let quad = null;
      // Abgerundete/leicht gewellte Ecken: Toleranz schrittweise erhöhen, bis
      // genau vier Ecken übrig bleiben.
      for (const eps of [0.02, 0.03, 0.045, 0.06, 0.08]) {
        const approx = new cv.Mat();
        cv.approxPolyDP(hull, approx, eps * peri, true);
        if (approx.rows === 4) {
          const d = approx.data32S;
          quad = [0, 1, 2, 3].map(k => ({ x: d[k * 2], y: d[k * 2 + 1] }));
        }
        approx.delete();
        if (quad) break;
      }
      hull.delete();
      c.delete();
      if (!quad) continue;
      const ordered = orderQuad(quad);
      const a = quadArea(ordered);
      if (a < minArea || a > maxArea || !quadAnglesOk(ordered)) continue;
      if (!best || a > best.area) best = { quad: ordered, area: a };
    }
  };

  try {
    const src = track(matVonCanvas(cv, canvas));
    const gray = track(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    // 1. Kanten
    const closed = track(new cv.Mat());
    const closeKernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
    cv.morphologyEx(gray, closed, cv.MORPH_CLOSE, closeKernel);
    const hist = new Uint32Array(256);
    const data = closed.data;
    for (let i = 0; i < data.length; i++) hist[data[i]]++;
    let acc = 0, median = 127;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= data.length / 2) { median = v; break; } }
    const edges = track(new cv.Mat());
    cv.Canny(closed, edges, Math.max(10, 0.66 * median), Math.min(255, 1.33 * median));
    const dilKernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.dilate(edges, edges, dilKernel);
    const contoursA = track(new cv.MatVector());
    const hierA = track(new cv.Mat());
    cv.findContours(edges, contoursA, hierA, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    consider(contoursA);

    // 2. Helligkeit
    const bin = track(new cv.Mat());
    cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, closeKernel);
    const contoursB = track(new cv.MatVector());
    const hierB = track(new cv.Mat());
    cv.findContours(bin, contoursB, hierB, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    consider(contoursB);
  } finally {
    mats.forEach(m => { try { m.delete(); } catch {} });
  }
  return best ? best.quad.map(p => ({ x: p.x / W, y: p.y / H })) : null;
}

// ---------- Ruhiger Live-Rahmen ----------
// Glättet die Einzelerkennungen: kleine Abweichungen werden weich
// nachgeführt (kein Zittern), Sprünge (anderes Viereck, z. B. Tischkante)
// erst übernommen, wenn sie sich über mehrere Bilder bestätigen. Kurze
// Aussetzer lassen den Rahmen stehen statt ihn flackern zu lassen.
export function quadDistance(a, b) {
  return (dist(a[0], b[0]) + dist(a[1], b[1]) + dist(a[2], b[2]) + dist(a[3], b[3])) / 4;
}

export class QuadTracker {
  constructor({ smoothing = 0.4, jitter = 0.012, jump = 0.07, confirmJump = 3, holdMisses = 5 } = {}) {
    Object.assign(this, { smoothing, jitter, jump, confirmJump, holdMisses });
    this.reset();
  }
  reset() {
    this.quad = null;
    this.candidate = null;
    this.candidateHits = 0;
    this.misses = 0;
    this.stableSince = 0;
  }
  update(detected, now) {
    if (!detected) {
      this.misses++;
      if (this.misses > this.holdMisses) { this.quad = null; this.stableSince = 0; this.candidate = null; }
      return this.quad;
    }
    this.misses = 0;
    if (this.quad && quadDistance(this.quad, detected) < this.jump) {
      const d = quadDistance(this.quad, detected);
      const k = this.smoothing;
      this.quad = this.quad.map((p, i) => ({ x: p.x + (detected[i].x - p.x) * k, y: p.y + (detected[i].y - p.y) * k }));
      if (d > this.jitter * 2.5) this.stableSince = now; // deutliche Bewegung: Ruhe-Zähler neu
      this.candidate = null;
      this.candidateHits = 0;
      return this.quad;
    }
    // Neues/anderes Viereck: erst nach Bestätigung übernehmen.
    if (this.candidate && quadDistance(this.candidate, detected) < this.jump) this.candidateHits++;
    else { this.candidate = detected; this.candidateHits = 1; }
    const needed = this.quad ? this.confirmJump : 2;
    if (this.candidateHits >= needed) {
      this.quad = detected;
      this.stableSince = now;
      this.candidate = null;
      this.candidateHits = 0;
    }
    return this.quad;
  }
  stableFor(now) {
    return this.quad ? now - this.stableSince : 0;
  }
}

// ---------- Entzerrung ----------
// Schneidet das Viereck (Pixelkoordinaten im Quellbild) aus und entzerrt es
// auf ein Rechteck in Dokumentgröße. Liegt das Seitenverhältnis nahe an A4,
// wird exakt auf A4 gerundet (Rundungsfehler der Ecken ergäben sonst leicht
// schiefe Proportionen). Längste Seite höchstens maxLongSide (2480 px ≈ A4
// mit 210 dpi) — scharf genug für Text, PDF bleibt handlich.
export const A4_RATIO = Math.SQRT2;

export function targetSizeForQuad(quad, maxLongSide = 2480) {
  const [tl, tr, br, bl] = quad;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const portrait = h >= w;
  const ratio = portrait ? h / w : w / h;
  let snapped = false;
  if (Math.abs(ratio - A4_RATIO) / A4_RATIO < 0.07) {
    snapped = true;
    if (portrait) h = w * A4_RATIO; else w = h * A4_RATIO;
  }
  const scale = Math.min(1, maxLongSide / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale), a4: snapped };
}

export function warpDocument(sourceCanvas, quadPx, maxLongSide = 2480) {
  const cv = window.cv;
  const size = targetSizeForQuad(quadPx, maxLongSide);
  const src = matVonCanvas(cv, sourceCanvas);
  const dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, quadPx.flatMap(p => [p.x, p.y]));
  // Ecken minimal nach außen abbilden (≈0,6 %): die erkannte Kante liegt
  // oft ein, zwei Pixel auf dem Tisch — sonst bliebe ein dunkler Saum am
  // Seitenrand (bei S/W als gestrichelte Linie sichtbar).
  const m = Math.round(Math.max(size.width, size.height) * 0.006);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [-m, -m, size.width + m, -m, size.width + m, size.height + m, -m, size.height + m]);
  const M = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(size.width, size.height), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    const out = document.createElement('canvas');
    matAufCanvas(cv, dst, out);
    out.dataset.a4 = size.a4 ? '1' : '';
    return out;
  } finally {
    [src, dst, from, to, M].forEach(m => m.delete());
  }
}

// ---------- Filter ----------
// "Dokument" wie bei Adobe Scan: Beleuchtung/Schatten herausrechnen
// (Hintergrund je Farbkanal schätzen — Schrift per Dilatation entfernen,
// großer Median — und das Bild dadurch teilen, Papier wird gleichmäßig
// weiß), danach Kontrast anheben und leicht nachschärfen. Farbige Stempel/
// Markierungen bleiben erhalten.
export const SCAN_FILTERS = [
  { key: 'document', label: 'Dokument' },
  { key: 'color', label: 'Foto' },
  { key: 'gray', label: 'Graustufen' },
  { key: 'bw', label: 'S/W' }
];

function normalizeIllumination(cv, rgb) {
  const channels = new cv.MatVector();
  cv.split(rgb, channels);
  const out = new cv.MatVector();
  const small = new cv.Size(Math.max(1, Math.round(rgb.cols / 4)), Math.max(1, Math.round(rgb.rows / 4)));
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  for (let i = 0; i < channels.size(); i++) {
    const ch = channels.get(i);
    const bgSmall = new cv.Mat();
    cv.resize(ch, bgSmall, small, 0, 0, cv.INTER_AREA);
    cv.dilate(bgSmall, bgSmall, kernel);
    cv.medianBlur(bgSmall, bgSmall, 21);
    const bg = new cv.Mat();
    cv.resize(bgSmall, bg, new cv.Size(rgb.cols, rgb.rows), 0, 0, cv.INTER_LINEAR);
    const norm = new cv.Mat();
    cv.divide(ch, bg, norm, 255);
    // Kontrast: Papier bleibt weiß, Schrift wird kräftiger.
    cv.convertScaleAbs(norm, norm, 1.25, -48);
    out.push_back(norm);
    [ch, bgSmall, bg, norm].forEach(m => m.delete());
  }
  const merged = new cv.Mat();
  cv.merge(out, merged);
  channels.delete();
  out.delete();
  kernel.delete();
  return merged;
}

function sharpen(cv, mat) {
  const blur = new cv.Mat();
  cv.GaussianBlur(mat, blur, new cv.Size(0, 0), 1.2);
  cv.addWeighted(mat, 1.6, blur, -0.6, 0, mat);
  blur.delete();
}

export function applyScanFilter(canvas, mode) {
  if (mode === 'color') return canvas;
  const cv = window.cv;
  const src = matVonCanvas(cv, canvas);
  const rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const doc = normalizeIllumination(cv, rgb);
  let result = doc;
  if (mode === 'gray' || mode === 'bw') {
    const gray = new cv.Mat();
    cv.cvtColor(doc, gray, cv.COLOR_RGB2GRAY);
    if (mode === 'bw') cv.threshold(gray, gray, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    result = gray;
  }
  if (mode !== 'bw') sharpen(cv, result);
  const out = document.createElement('canvas');
  matAufCanvas(cv, result, out);
  out.dataset.a4 = canvas.dataset.a4 || '';
  [src, rgb, doc].forEach(m => m.delete());
  if (result !== doc) result.delete();
  return out;
}
