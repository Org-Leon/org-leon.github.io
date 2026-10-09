// ---------- Geräteschutz: Sperrbildschirm, Einrichten, Einstellungen ----------
// Standard an, abschaltbar (Konto & Einstellungen → Sicherheit). Ist er an,
//   - sind die Offline-Daten verschlüsselt (tresor.js, offline-store.js),
//   - fragt die App beim Start nach dem Konto-Passwort (oder Fingerabdruck/
//     Gesicht, falls eingerichtet) — auch ohne Netz, geprüft wird lokal,
//   - sperrt sie sich nach einer einstellbaren Zeit ohne Bedienung.
// Die Sperre nach Inaktivität blendet die App aus; der Schlüssel bleibt bis zum
// Schließen der App im Arbeitsspeicher, damit Abgleich und Uploads weiterlaufen.
// Eingerichtet wird mit dem Passwort beim Anmelden; wer schon angemeldet war,
// wird einmal gefragt (das Passwort wird dann online geprüft).
import { tresorAnlegen, mitPasswortOeffnen, passwortSetzen, biometrieMoeglich, biometrieEinrichten, mitBiometrieOeffnen } from './tresor.js';
import { tresorLesen, tresorSchreiben, schluesselSetzen, schluesselFuer, datenUmschluesseln, alleDatenLoeschen } from './offline-store.js';

const SPERRE_STANDARD_MIN = 15;
const FEHLVERSUCHE_BIS_PAUSE = 5;
const PAUSE_SEK = 30;

// hooks: {
//   verifyPassword(email, pw)  Passwort online prüfen (wirft bei falschem Passwort)
//   abmelden()                 wie "Abmelden" ohne Löschen
//   dokCacheLoeschen()         zwischengespeicherte Dokumente verwerfen
//   istWiederherstellung()     läuft gerade "Passwort vergessen" per Mail-Link?
//   kontoSchliessen()          Konto-Fenster schließen
//   aktiv()                    false = Geräteschutz für diesen Lauf aus (Tests)
// }
export function geraeteschutzEinrichten(hooks) {
  const $ = (id) => document.getElementById(id);
  const ov = $('gs-overlay');
  let aktuell = null;        // { id, email } des angemeldeten Nutzers
  let schutzAn = false;      // Tresor aktiv für aktuell
  let offenerDialog = null;  // laufender Sperrbildschirm
  let letzteAktivitaet = Date.now();
  let fehlversuche = 0;

  const eingeschaltet = () => hooks.aktiv();

  // ---- Sperrbildschirm (auch zum Einrichten) ----
  // modus: 'sperre' | 'altesPasswort' | 'einrichten'
  // Ergebnis: 'offen' | 'eingerichtet' | 'ohneSchutz' | 'verworfen' | 'abgemeldet'
  function sperrbildschirm(modus, user) {
    if (offenerDialog) return offenerDialog.promise;
    let fertig;
    const promise = new Promise(r => { fertig = r; });
    offenerDialog = { promise, modus };
    const texte = {
      sperre: ['FeldFolio ist gesperrt', 'Gib dein Konto-Passwort ein, um weiterzuarbeiten. Das geht auch ohne Internet.', 'Entsperren'],
      altesPasswort: ['Passwort wurde geändert', 'Die Daten auf diesem Gerät sind noch mit deinem bisherigen Passwort geschützt. Gib es einmal ein — danach gilt hier das neue.', 'Entsperren'],
      einrichten: ['Daten auf diesem Gerät schützen', 'FeldFolio speichert deine Kontrolldaten auch offline auf diesem Gerät. Mit deinem Konto-Passwort werden sie verschlüsselt, und die App sperrt sich, wenn du sie eine Weile nicht benutzt. Ausschalten kannst du das unter Konto & Einstellungen → Sicherheit.', 'Schützen']
    }[modus];
    $('gs-titel').textContent = texte[0];
    $('gs-text').textContent = texte[1];
    $('gs-ok-text').textContent = texte[2];
    $('gs-email').textContent = user.email || '';
    ov.querySelector('.gs-unsichtbar').value = user.email || ''; // für Passwort-Manager
    $('gs-passwort').value = '';
    fehler('');
    const sperren = modus !== 'einrichten';
    $('gs-ohne').hidden = sperren;
    $('gs-abmelden').hidden = !sperren;
    $('gs-vergessen').hidden = !sperren;
    $('gs-vergessen').open = sperren && hooks.istWiederherstellung();
    tresorLesen(user.id).then(t => { $('gs-bio').hidden = !(sperren && t && t.bio && biometrieMoeglich()); }).catch(() => {});
    ov.hidden = false;
    document.body.classList.add('ist-gesperrt');
    setTimeout(() => $('gs-passwort').focus(), 0);

    const schliessen = (erg) => {
      ov.hidden = true;
      document.body.classList.remove('ist-gesperrt');
      ov.onsubmit = ov.onclick = null;
      offenerDialog = null;
      letzteAktivitaet = Date.now();
      fertig(erg);
    };

    ov.onsubmit = async (e) => {
      e.preventDefault();
      if ($('gs-ok').disabled) return;
      const pw = $('gs-passwort').value;
      if (!pw) { fehler('Bitte das Passwort eingeben.'); return; }
      beschaeftigt(true);
      try {
        if (modus === 'einrichten') {
          if (!navigator.onLine) { fehler('Zum Einrichten ist einmal Internet nötig — dein Passwort wird dabei geprüft.'); return; }
          try { await hooks.verifyPassword(user.email, pw); } catch { fehler('Das Passwort stimmt nicht.'); return; }
          await anlegen(user, pw);
          schliessen('eingerichtet');
          return;
        }
        const t = await tresorLesen(user.id);
        const k = t && await mitPasswortOeffnen(t, pw);
        if (!k) { falsch(); return; }
        schluesselSetzen(user.id, k);
        fehlversuche = 0;
        schliessen('offen');
      } finally { beschaeftigt(false); }
    };
    ov.onclick = async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.id === 'gs-bio') {
        fehler('');
        try {
          const k = await mitBiometrieOeffnen(await tresorLesen(user.id));
          if (!k) { fehler('Entsperren hat nicht geklappt — bitte das Passwort verwenden.'); return; }
          schluesselSetzen(user.id, k);
          fehlversuche = 0;
          schliessen('offen');
        } catch (err) { fehler(err && err.name === 'NotAllowedError' ? 'Abgebrochen.' : (err.message || 'Entsperren hat nicht geklappt.')); }
      } else if (btn.id === 'gs-ohne') {
        await tresorSchreiben(user.id, { v: 1, aktiv: false });
        schutzAn = false;
        schliessen('ohneSchutz');
      } else if (btn.id === 'gs-verwerfen') {
        if (!confirm('Alle Daten dieses Kontos auf diesem Gerät löschen?\n\nWas schon mit der Cloud abgeglichen ist, lädt die App nach der Anmeldung neu. Änderungen, die noch nicht abgeglichen waren, gehen verloren.')) return;
        await alleDatenLoeschen(user.id);
        await hooks.dokCacheLoeschen();
        schutzAn = false;
        schliessen('verworfen');
      } else if (btn.id === 'gs-abmelden') {
        schliessen('abgemeldet');
        await hooks.abmelden();
      }
    };
    return promise;
  }
  function fehler(text) { $('gs-fehler').textContent = text; $('gs-fehler').hidden = !text; }
  function beschaeftigt(an) { $('gs-ok').disabled = an; $('gs-ok').classList.toggle('is-busy', an); }
  function falsch() {
    fehlversuche += 1;
    $('gs-passwort').select();
    if (fehlversuche < FEHLVERSUCHE_BIS_PAUSE) { fehler('Das Passwort stimmt nicht.'); return; }
    // nach mehreren Fehlversuchen kurz warten (bremst Durchprobieren am Gerät)
    let rest = PAUSE_SEK;
    const ok = $('gs-ok');
    ok.disabled = true;
    const tick = () => {
      if (rest <= 0) { ok.disabled = false; fehler('Das Passwort stimmt nicht.'); fehlversuche = FEHLVERSUCHE_BIS_PAUSE - 2; return; }
      fehler(`Zu viele Fehlversuche — bitte ${rest} Sekunden warten.`);
      rest -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }

  async function anlegen(user, pw) {
    const { schluessel, tresor } = await tresorAnlegen(pw);
    tresor.sperreMin = SPERRE_STANDARD_MIN;
    await tresorSchreiben(user.id, tresor);
    schluesselSetzen(user.id, schluessel);
    await datenUmschluesseln(user.id);  // was bisher im Klartext lag, jetzt verschlüsselt
    await hooks.dokCacheLoeschen();      // Dokumente lädt die App bei Bedarf neu (dann verschlüsselt)
    schutzAn = true;
  }

  // ---- Sperre nach Inaktivität ----
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => document.addEventListener(t, () => { letzteAktivitaet = Date.now(); }, { capture: true, passive: true }));
  async function inaktivPruefen() {
    if (!aktuell || !schutzAn || offenerDialog || !schluesselFuer(aktuell.id)) return;
    const t = await tresorLesen(aktuell.id).catch(() => null);
    const min = t && t.aktiv ? (t.sperreMin ?? SPERRE_STANDARD_MIN) : 0;
    if (min > 0 && Date.now() - letzteAktivitaet > min * 60000) api.sperren();
  }
  setInterval(inaktivPruefen, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) inaktivPruefen(); });

  // ---- Einstellungen (Konto → Sicherheit) ----
  let bestaetigen = null; // laufende Rückfrage { art: 'an'|'aus' }
  function meldung(text, art = '') {
    const el = $('gs-meldung');
    el.textContent = text;
    el.classList.toggle('modal-error', art === 'error');
  }
  async function einstellungenZeigen() {
    if (!aktuell) return;
    const t = await tresorLesen(aktuell.id).catch(() => null);
    const an = !!(t && t.aktiv);
    $('gs-aktiv').checked = bestaetigen ? bestaetigen.art === 'an' : an;
    $('gs-optionen').hidden = !an;
    $('gs-bestaetigen').hidden = !bestaetigen;
    $('gs-sperre').value = String(an ? (t.sperreMin ?? SPERRE_STANDARD_MIN) : SPERRE_STANDARD_MIN);
    const bioGeht = biometrieMoeglich();
    $('gs-bio-an').hidden = !an || !bioGeht || !!t.bio;
    $('gs-bio-aus').hidden = !an || !t.bio;
    $('gs-status').textContent = an
      ? `Geschützt: Die Daten auf diesem Gerät sind verschlüsselt. Entsperren mit deinem Passwort${t.bio ? ' oder Fingerabdruck/Gesicht' : ''}.`
      : 'Nicht geschützt: Wer dieses Gerät benutzt, kann deine gespeicherten Kontrolldaten sehen.';
    $('gs-status').classList.toggle('is-warn', !an);
  }
  $('gs-aktiv').addEventListener('change', async () => {
    const t = aktuell && await tresorLesen(aktuell.id).catch(() => null);
    const warAn = !!(t && t.aktiv);
    if ($('gs-aktiv').checked === warAn) { bestaetigen = null; einstellungenZeigen(); return; } // zurückgeschaltet
    bestaetigen = { art: warAn ? 'aus' : 'an' };
    $('gs-bestaetigen-label').textContent = warAn ? 'Zum Ausschalten dein Passwort eingeben' : 'Zum Einschalten dein Konto-Passwort eingeben';
    $('gs-bestaetigen-pw').value = '';
    $('gs-bestaetigen').hidden = false;
    meldung('');
    $('gs-bestaetigen-pw').focus();
  });
  $('gs-bestaetigen-abbrechen').addEventListener('click', () => { bestaetigen = null; meldung(''); einstellungenZeigen(); });
  $('gs-bestaetigen-ok').addEventListener('click', async () => {
    if (!bestaetigen || !aktuell) return;
    const pw = $('gs-bestaetigen-pw').value;
    if (!pw) { meldung('Bitte das Passwort eingeben.', 'error'); return; }
    const btn = $('gs-bestaetigen-ok');
    btn.disabled = true;
    try {
      if (bestaetigen.art === 'aus') {
        const t = await tresorLesen(aktuell.id);
        if (!(await mitPasswortOeffnen(t, pw))) { meldung('Das Passwort stimmt nicht.', 'error'); return; }
        await tresorSchreiben(aktuell.id, { v: 1, aktiv: false });
        await datenUmschluesseln(aktuell.id); // entschlüsselt (Schlüssel ist noch da)
        await hooks.dokCacheLoeschen();
        schluesselSetzen(null);
        schutzAn = false;
        meldung('Geräteschutz ausgeschaltet.');
      } else {
        if (!navigator.onLine) { meldung('Zum Einschalten ist einmal Internet nötig — dein Passwort wird dabei geprüft.', 'error'); return; }
        try { await hooks.verifyPassword(aktuell.email, pw); } catch { meldung('Das Passwort stimmt nicht.', 'error'); return; }
        await anlegen(aktuell, pw);
        meldung('Geräteschutz eingeschaltet.');
      }
      bestaetigen = null;
    } catch (err) {
      meldung(err.message || 'Das hat nicht geklappt.', 'error');
    } finally {
      btn.disabled = false;
      einstellungenZeigen();
    }
  });
  $('gs-sperre').addEventListener('change', async () => {
    const t = aktuell && await tresorLesen(aktuell.id);
    if (!t || !t.aktiv) return;
    await tresorSchreiben(aktuell.id, { ...t, sperreMin: Number($('gs-sperre').value) });
    meldung('Gespeichert.');
  });
  $('gs-bio-an').addEventListener('click', async () => {
    const t = aktuell && await tresorLesen(aktuell.id);
    const k = aktuell && schluesselFuer(aktuell.id);
    if (!t || !k) return;
    meldung('Bitte am Gerät bestätigen …');
    try {
      await tresorSchreiben(aktuell.id, await biometrieEinrichten(t, k, { name: aktuell.email, anzeige: 'FeldFolio – dieses Gerät entsperren' }));
      meldung('Eingerichtet: Du kannst jetzt auch mit Fingerabdruck oder Gesicht entsperren.');
    } catch (err) {
      meldung(err && err.name === 'NotAllowedError' ? 'Abgebrochen.' : (err.message || 'Einrichten hat nicht geklappt.'), 'error');
    }
    einstellungenZeigen();
  });
  $('gs-bio-aus').addEventListener('click', async () => {
    const t = aktuell && await tresorLesen(aktuell.id);
    if (!t) return;
    const { bio, ...rest } = t;
    await tresorSchreiben(aktuell.id, rest);
    meldung('Entfernt. Den Eintrag „FeldFolio“ in der Passwort- bzw. Passkey-Verwaltung des Geräts kannst du zusätzlich löschen.');
    einstellungenZeigen();
  });
  $('gs-jetzt').addEventListener('click', () => { hooks.kontoSchliessen(); api.sperren(); });

  const api = {
    istAktiv: () => !!(aktuell && schutzAn),
    einstellungenZeigen,

    // Anmeldung mit Passwort: entsperren oder (Standard an) einrichten.
    // 'abgemeldet', wenn sich der Nutzer am Sperrbildschirm abgemeldet hat.
    async nachAnmeldung(user, pw) {
      aktuell = { id: user.id, email: user.email };
      if (!eingeschaltet()) return 'weiter';
      const t = await tresorLesen(user.id);
      if (!t) { await anlegen(user, pw); return 'weiter'; }
      if (!t.aktiv) { schutzAn = false; return 'weiter'; }
      schutzAn = true;
      const schon = schluesselFuer(user.id);
      const k = schon || await mitPasswortOeffnen(t, pw);
      if (k) {
        schluesselSetzen(user.id, k);
        // Passwort zwischendurch anderswo geändert, Gerät war aber entsperrt
        if (schon && !(await mitPasswortOeffnen(t, pw))) await tresorSchreiben(user.id, await passwortSetzen(t, k, pw));
        return 'weiter';
      }
      // Konto-Passwort wurde anderswo geändert: einmal das alte, dann neu einpacken
      const erg = await sperrbildschirm('altesPasswort', user);
      if (erg === 'offen') await tresorSchreiben(user.id, await passwortSetzen(await tresorLesen(user.id), schluesselFuer(user.id), pw));
      else if (erg === 'verworfen') await anlegen(user, pw);
      return erg === 'abgemeldet' ? 'abgemeldet' : 'weiter';
    },

    // Vor dem Laden des lokalen Stands (Start mit gespeicherter Anmeldung oder ohne Netz)
    async vorStart(user, { offline = false } = {}) {
      aktuell = { id: user.id, email: user.email };
      if (!eingeschaltet()) return 'weiter';
      const t = await tresorLesen(user.id).catch(() => null);
      if (t && !t.aktiv) { schutzAn = false; return 'weiter'; }
      if (t) {
        schutzAn = true;
        if (schluesselFuer(user.id)) return 'weiter';
        const erg = await sperrbildschirm('sperre', user);
        return erg === 'abgemeldet' ? 'abgemeldet' : 'weiter';
      }
      // noch nicht eingerichtet (z. B. schon vor dem Update angemeldet): einmal fragen
      schutzAn = false;
      if (hooks.istWiederherstellung() || !navigator.onLine || offline) return 'weiter';
      await sperrbildschirm('einrichten', user);
      return 'weiter';
    },

    // Passwort geändert (Einstellungen oder "Passwort vergessen"): neu einpacken
    async passwortGeaendert(user, pw) {
      if (!eingeschaltet() || !user) return;
      const t = await tresorLesen(user.id);
      if (!t) { await anlegen(user, pw); return; }
      const k = schluesselFuer(user.id);
      if (t.aktiv && k) await tresorSchreiben(user.id, await passwortSetzen(t, k, pw));
    },

    sperren() {
      if (!aktuell || !schutzAn || offenerDialog) return;
      sperrbildschirm('sperre', aktuell);
    },

    // Abmelden: Schlüssel aus dem Speicher, Sperrbildschirm zu
    vergessen() {
      schluesselSetzen(null);
      aktuell = null;
      schutzAn = false;
      if (offenerDialog) { ov.hidden = true; document.body.classList.remove('ist-gesperrt'); offenerDialog = null; }
    }
  };
  return api;
}
