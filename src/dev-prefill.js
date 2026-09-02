// Nur für die lokale Entwicklung: befüllt die Jahr-A/Jahr-B-Datei-Inputs im
// Jahresvergleich automatisch mit den Test-Shapefiles aus test-shapes/, damit
// man beim Testen nicht bei jedem Reload manuell zwei Zips auswählen muss.
// test-shapes/ ist gitignored und existiert nur lokal — läuft daher nur unter
// `import.meta.env.DEV` (siehe main.js) und wird nie in den Build gebündelt.

const TEST_FILES = {
  a: 'test-shapes/2025_Wellge Landwirtschaft GbR_Shapes.zip',
  b: 'test-shapes/2026_Wellge Landwirtschaft GbR_Shapes.zip'
};

async function fetchAsFile(path) {
  const url = encodeURI('/' + path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
  const blob = await res.blob();
  const name = path.split('/').pop();
  return new File([blob], name, { type: blob.type || 'application/zip' });
}

function setInputFile(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function prefillCompareInputs() {
  const inputA = document.getElementById('compare-file-a');
  const inputB = document.getElementById('compare-file-b');
  if (!inputA || !inputB) return;

  try {
    const [fileA, fileB] = await Promise.all([
      fetchAsFile(TEST_FILES.a),
      fetchAsFile(TEST_FILES.b)
    ]);
    setInputFile(inputA, fileA);
    setInputFile(inputB, fileB);
    console.info('[dev-prefill] Jahresvergleich mit Testdaten aus test-shapes/ vorbefüllt.');
  } catch (err) {
    console.warn('[dev-prefill] Konnte Testdaten aus test-shapes/ nicht laden:', err.message);
  }
}
