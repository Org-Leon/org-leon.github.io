// ---------- Kulturen: Zuordnung zum Intact-Kulturkatalog ----------
// Die Schlagliste des externen Programms (Intact) kennt nur die Kulturen aus
// ihrem Katalog. Kulturarten aus den Shape-Dateien (je Bundesland anders
// benannt, z.B. "Winterweichweizen", "Winter-Emmer/ -Einkorn", "111150") werden
// hier auf einen Katalogeintrag abgebildet. Reine Logik ohne Oberfläche.
//
// Ergebnis je Kultur: { name, kuerzel, k, sicherheit, quelle }
//   sicherheit: 'gleich'    – Name stimmt (bereinigt) überein
//               'regel'     – eindeutige Regel (z.B. Winterweichweizen -> Winterweizen)
//               'aehnlich'  – nur ähnlich, bitte prüfen
//               'unbekannt' – keine Zuordnung gefunden
//               'manuell'   – vom Kontrolleur festgelegt

// Katalog wie im externen Programm ("Name Kürzel"), Schlüssel k = dessen ID.
// Platzhalter ("---") und der Testeintrag sind weggelassen.
const KATALOG_ROH = [
  ['0dac945d-4063-4a3f-930c-be98a8d7f931', 'Ackerbohnen AB'], ['01f3c9a7-b59e-43a8-a90d-f65ba0ff7962', 'Ackerfutter - GPS GPS'],
  ['3ad6b076-3ded-407a-bce8-915fb34d1524', 'Ackergras GR'], ['8a203fba-360a-40cb-9503-28a75175654c', 'Amaranth AM'],
  ['672c2a64-bbab-4257-a724-a4b2654d9789', 'Äpfel ÄP'], ['04fc6952-a9ba-4fc0-b595-822640962031', 'Aprikosen APR'],
  ['a8ffc4a1-3fa1-4378-883f-a90368f6e205', 'Aronia AR'], ['d9b7311a-64f3-47f8-98ee-e1bd650f792d', 'Artischocke ART'],
  ['7d0e1e1d-f6eb-4a36-b215-c58768d55a8c', 'Baumschule BS'], ['e7b0739e-ef89-4722-a62c-20c76eb03cb3', 'Beerenobst BO'],
  ['19d1c99b-9c74-4d2f-a410-3a356ddbdc96', 'Biotop BIO'], ['981ac25e-240e-45ca-a133-5dc6ebbe700b', 'Birnen BI'],
  ['01e774b2-9ee4-4c90-a8d1-d02aa0a7c03e', 'Buchweizen BW'], ['2cbfea6f-1522-475b-b3e6-c9bb76762791', 'Chia CHI'],
  ['de892a0a-3458-4d2f-96b0-d567e4bba793', 'Dinkel DI'], ['b4b1901e-d048-498d-a8eb-74cb287b43a1', 'Einkorn EK'],
  ['86612c6c-fec8-4c51-8183-4420817b6389', 'Energiepflanzen EP'], ['c2300577-cf34-4ffb-8dc4-f89f3fde5204', 'Erbsen ER'],
  ['8c71c632-5fa7-44aa-996b-79c562bd5dd6', 'Erbsen-Ackerbohnengemenge GEA'], ['7b7e8c6e-2793-44ba-bfb3-3c7068dd9a04', 'Erdbeeren EB'],
  ['4a472f0c-5f35-40cf-a583-3971bbc723d5', 'Esparsette ESP'], ['2d4d879b-3226-476b-aec5-159f0c9d69c7', 'Färberdistel FD'],
  ['95db2e0c-0d15-4c92-b0ad-758304ea0db7', 'Fenchel FE'], ['d76e00c9-f477-45c7-8842-e25aa402425b', 'Freiwillige Flächenstilllegung ÖD'],
  ['fb7196c9-ecf8-42e1-b04b-d37d5e7afaf7', 'Futterrüben FR'], ['0b286519-e547-4cb7-b2bc-769817ce1025', 'Gartenbau unter Glas GAG'],
  ['7a22eff4-426d-41a1-908a-8a7b780f396e', 'Gartenbau, Freiland GAF'], ['7c8ff134-2dc3-41e1-9b2f-a04d779624b0', 'Gemüse FG'],
  ['c73b7fbb-4dec-403b-8925-1db1fe228ab4', 'Gemüsekohl KRT'], ['a6ef60ca-9ba6-4f40-835a-d9e9461e4bd9', 'Getreide sonstige GE'],
  ['1540c3fe-5287-4229-83d5-56961c44f8bf', 'Getreide-Körnerleguminosen-Gemenge GK'], ['9219be3f-2677-4987-bdc6-d16178cb6dc2', 'Grünbrache BR'],
  ['184bbfac-7c99-4f7c-a698-a133253b26f8', 'Grünland GRÜ'], ['c1938292-3c3d-43c5-87a6-0c36d5d1056c', 'Grünland mit Streuobst GRÜS'],
  ['4ee8fc40-db79-4ceb-93ec-3f6ee9dd3439', 'Gurken GU'], ['9377ebab-59bf-4caa-8ac4-fa849a4da64c', 'Hanf HAN'],
  ['7f8db445-66a0-4541-b00c-5dd3c95cee8e', 'Haselnüsse HN'], ['5c7cd214-409b-47ce-a199-0df27608c5c9', 'Hausgarten HGA'],
  ['9113221d-f266-409e-ae7c-025e3153dead', 'Heidelbeeren HEI'], ['736e6d04-1dfb-4a68-8545-33ed4e2d7681', 'Heil-, Duft- und Gewürzpflanzen GUA'],
  ['30fc7bae-519a-4a8c-80a5-735c85f503d8', 'Himbeeren HIM'], ['a65f6d04-e627-497d-8c7a-da15515c3173', 'Hirse HI'],
  ['da8fb864-5a83-4d69-8403-cc45754ba277', 'Holunder HOL'], ['8787cf44-e936-4ad1-9f60-13ee3ba5dbe5', 'Hopfen HO'],
  ['7225495b-5bb0-4e24-bdc0-ea1bf80c5b4b', 'Johannisbeeren JOB'], ['f40a1fab-f807-4426-b426-0a8a5b913288', 'Kartoffeln KA'],
  ['b52cf583-c97f-486e-96e3-d75ce745e5ef', 'Kern- und Steinobst KUS'], ['c87e46d7-b84e-41d3-8e99-9149c57bea09', 'Kichererbsen KER'],
  ['df7c7171-9e9e-434b-b3a0-1d38c8aa57c3', 'Klee KL'], ['199d8fe7-901e-4948-950d-63fa3de56088', 'Kleegras, Klee-/Luzernegrasgemisch KG'],
  ['3d611f4b-629b-4901-87f5-f1fcfd3c0b64', 'Kohl-, Steckrüben STRÜ'], ['eb671dd2-4f1e-4ef1-a8a8-58b281f9aa60', 'Körnermais KM'],
  ['072ad9f5-5311-465b-9c2e-c5005853f8d5', 'Küchenkräuter KR'], ['b150bf0e-f1b0-42f0-bca2-845a5f43264f', 'Kürbis KÜ'],
  ['e76f280b-850b-4591-87c8-2aeaa1a4ab29', 'Lein / Flachs LEF'], ['4f70b67c-5812-4697-b2f2-67777b861567', 'Leindotter LD'],
  ['2efc39a9-c044-410c-b529-a6a3b985534a', 'Linsen LI'], ['b61deb84-066d-4132-9f10-c14f254a0cc8', 'Luzerne LU'],
  ['f617dec8-d7c0-4993-8832-06312e24759e', 'Mähweide MÄW'], ['8cf1bb8c-833f-4b68-b338-343f04e7cb3c', 'Mähweide mit Streuobst MÄWS'],
  ['260d3d9d-ee91-4891-9aba-539ce61b69fa', 'Mais-Sonnenblumen-Gemenge MSO'], ['51f25e70-601e-4e54-b062-bd27d80076fd', 'Maronen MAR'],
  ['f77d7192-feab-42f4-b2ec-b14f96e760c0', 'Melone ME'], ['9e61bc07-6fd3-44b1-9289-a7bfff312340', 'Mirabellen, Renekloden MIR'],
  ['1fe80afc-3ca0-4466-902c-1eca7128bf55', 'Miscanthus MIS'], ['741757d7-4f0f-44dd-8547-bf2023849679', 'Mohn Mohn'],
  ['1e0f39f3-6fef-40cf-acbf-f2b80577b120', 'Möhren, Karotten MO'], ['886b52ce-e8eb-4b9e-a873-1a1e4fee897b', 'Öllein LE'],
  ['7b2608ff-8bfc-4d03-8055-8c2c20591916', 'Ölrettich ÖL'], ['b3ba3ecf-28b0-4811-a324-5d06198f3709', 'Phacelia PH'],
  ['5650dcbb-369e-4514-b817-a6fdaac1a835', 'Quinoa QUI'], ['dbb1909a-2324-4055-bbe3-0ea42e3be942', 'Quitten QU'],
  ['a56c6872-9a3f-4054-a427-da6536eff527', 'Rebland, bestockt WT'], ['f13d2a4b-596d-4054-a172-2af70f1cd0a5', 'Rebland, unbestockt RL'],
  ['ee03d257-c05c-4a3a-adbf-fcae6cf9afd3', 'Reis im Trockenanbau RT'], ['f3349142-f56a-44a8-9475-197d979a998e', 'Rhabarber RH'],
  ['d8d7e62c-3280-42c2-8362-0f6fe49715d1', 'Rosen ROS'], ['6de2d0e9-3d01-4ebc-ad09-293ec6f47b32', 'Rote Bete RBE'],
  ['54f9f58b-1b45-4173-a6fa-ed18e53f90a0', 'Rübsen RÜ'], ['fc770626-9055-4c3d-a894-d41eeedda244', 'Salate SA'],
  ['c9371e6a-1bbc-4b3e-836b-7bbcd669bea7', 'Samenvermehrung Gras SVG'], ['cc65a897-de72-4f7e-89e1-3f18879e2413', 'Samenvermehrung Klee SVK'],
  ['5aa2dbe7-a514-4fb1-8a49-6d39e53b145a', 'Samenvermehrung Luzerne SVL'], ['38dd7548-120f-487a-be86-a4e42290692f', 'Sanddorn SD'],
  ['2f5c9986-8414-48f6-a5e9-7ab1930674a5', 'Sauerkirschen SAK'], ['e9743f4e-caf4-4691-be7e-0576b7b3a276', 'Sellerie SEL'],
  ['92a49228-37a0-4b1e-9016-836b913331b4', 'Senf SENF'], ['6ff282e6-14d5-493a-afed-b44100eb9bb6', 'Serradella SER'],
  ['16ab0ef3-663e-4dd5-b3c0-6adb5188528e', 'Silomais SM'], ['cdbd863b-e9ef-457f-80c4-1121044b1910', 'Sojabohnen SO'],
  ['9c96b6f7-2798-4dce-8410-d68d9cb074a0', 'Sommereinkorn SEK'], ['726c7987-6673-4f36-9d3f-4b31cdb78fa7', 'Sommeremmer SEM'],
  ['329a1037-e95a-43c4-9db1-d71d32dbc858', 'Sommeremmer, Sommereinkorn SE'], ['4bc16cbe-c9d9-48fb-ac43-81b45f367bd2', 'Sommergerste SG'],
  ['9e0c67ba-8a76-4576-b5e6-31b5e79208a2', 'Sommerhafer SHA'], ['60731226-0c31-4d26-89d9-8bc87cfff875', 'Sommerhartweizen SDU'],
  ['7cfb4ed8-0b93-4dba-92f7-e53e6ec393d3', 'Sommermenggetreide mit Weizen SMGW'], ['26992fbc-9585-4ad0-bfba-26d6e1f88171', 'Sommermenggetreide ohne Weizen SMG'],
  ['5b337abf-7d4e-493c-a503-a9cc27cc84d4', 'Sommerraps SRA'], ['b61b7a2d-329e-4265-a4d2-57e580dee8b4', 'Sommerroggen SRO'],
  ['f0cea86f-641a-43e3-a3f8-608f1d7c8a6c', 'Sommertriticale TRS'], ['d14ccde7-ccbe-4d5e-876a-f08c4d185192', 'Sommerweizen SW'],
  ['6e223de3-a2cf-4309-86f8-65794ac79b7e', 'Sommerwicken SWI'], ['43815456-d74b-4213-8192-f5e32576dd59', 'Sonnenblumen SB'],
  ['7b80f67f-1250-4ad8-ab6e-dc872b132acd', 'Sonstige Dauerkulturen SDK'], ['c298350a-18a4-4ad8-9b66-0dd7264eb59d', 'Sonstige Körnerleguminosen SKL'],
  ['ce05c2d6-a3b3-4107-be38-6f81c11c3da0', 'Sonstiges Obst SOB'], ['5b3397df-9795-4f34-a7c1-9bf0bc6371ec', 'Spargel SP'],
  ['e40412c5-a486-4a7d-a204-8fed51d38034', 'Stachelbeeren ST'], ['117a6901-ce06-4fb7-8f96-fb4b9f66f3bf', 'Stärkekartoffeln SKA'],
  ['acf5cc29-ed11-4487-b735-3d0cf2da1c0f', 'Streunutzung STR'], ['086ba434-132a-44fe-8b5d-919a9e7d7c99', 'Streuobst STO'],
  ['2050cd31-afc3-4586-bff1-1cfbfef8810d', 'Sudangras GRS'], ['77a7c370-0be4-4b2c-801a-4ee74c7179ba', 'Süßkartoffel SK'],
  ['b6c4e5e6-5c96-4a6c-863c-02957072380b', 'Süßkirschen SÜK'], ['e1cc4641-0cd4-48c6-89ca-9c3d4e458a75', 'Süßlupinen SLU'],
  ['a30b2d5f-32ec-454b-8bf2-b93c4a35f409', 'Tafeltrauben TT'], ['fdc4abfe-e186-4a6f-9a9d-d576bade4472', 'Teichflächen TF'],
  ['91370b1d-61c3-4fd3-b6f1-67c81ed3cd7d', 'Tomaten TO'], ['2d777cd1-5fdc-4d4e-a0c1-970115a56d86', 'Topinambur TOP'],
  ['f959aedc-29bc-4725-a14c-c97c9a101825', 'Unbefestigte Mieten DG DIV'], ['dd4b5d4b-d91f-48fd-8310-7670213365c7', 'Unbekannt UNB'],
  ['398f5888-7103-46a9-a20e-60698ec8fdbc', 'Walnüsse WA'], ['b57977ee-a079-449e-8f4b-885ba8f27e45', 'Wechselgrünland WGRÜ'],
  ['84afe342-a13b-4b94-a3be-75517279ddbf', 'Weide mit Streuobst WEIST'], ['275001b3-10ae-4a6b-86db-ec1f66e4a45e', 'Weide WEI'],
  ['ecc41179-357a-4062-99ba-33acb2db169f', 'Weide, Almen WEIA'], ['d54ee7d3-f89d-44e0-b6cc-c01ddb00c797', 'Weide, Hutung WEIH'],
  ['bc8e34a6-ed2c-4ba6-8d11-aba096b32a28', 'Weide, Schafe WEIS'], ['3e79a188-92ee-4b06-b65d-733c37dea2c5', 'Weihnachtsbäume WB'],
  ['4ce3bf5e-2661-4695-b990-bc1b48267dae', 'Wiese mit Streuobst WIES'], ['cb6bbbeb-de96-4302-8742-5a965f01ade6', 'Wiese WIE'],
  ['651f227d-eb78-4f27-8580-0f137c1d8471', 'Winter/Sommer-Wicken WI'], ['4d5ff213-8e22-49c8-afec-97cd7b471285', 'Wintereinkorn WEK'],
  ['ada76309-2a6b-4794-b72d-a29bd121ad3a', 'Winteremmer WEM'], ['10a8a357-7517-4e08-bb83-06268c4d6963', 'Winteremmer, Wintereinkorn WE'],
  ['dc5eac1d-a65f-4674-a149-09708da5e84c', 'Wintergerste WG'], ['ed4664f6-23f5-4824-bcb8-61d650d54da5', 'Winterhafer WHA'],
  ['e14a1d48-f1e4-4243-b941-f6e13dcb43c1', 'Winterhartweizen WDU'], ['44cc92a2-8029-431b-9bad-d9cd9c343216', 'Wintermenggetreide mit Weizen WMGW'],
  ['9338e3fb-2ef6-40a2-a294-b938ef60121d', 'Wintermenggetreide ohne Weizen WMG'], ['d58e545e-5c78-41a8-b58f-a8fbd867fcd4', 'Winterraps WRA'],
  ['44ec9a25-c9e2-4c4d-b77c-0c2c1b9d6253', 'Winterroggen WRO'], ['5447992a-eee1-4af2-8f44-a83696e78f3f', 'Wintertriticale WTR'],
  ['5163933d-5d14-43c1-b1be-4524d39b6d5e', 'Winterweizen WW'], ['baa691b0-ae8b-4100-ad35-1f27b2fc64ab', 'Winterwicken WWI'],
  ['49fea2ca-2b47-4173-92c7-9d30fc3d5029', 'Zierpflanzen Glashaus ZIEG'], ['ba94a3fb-f7b7-4022-b8a4-321c8cd35663', 'Zierpflanzen ZIE'],
  ['632cf3e2-b834-44b0-88ca-b142f905eb8d', 'Zucchini ZUC'], ['b2da3923-06b3-4ffc-bbde-7ea276e277c9', 'Zuckermais ZM'],
  ['e4840eb4-7a12-4620-b7a8-7e7cbdb61aaf', 'Zuckermelone ZME'], ['a447e126-fa4f-4804-972f-2bf161099397', 'Zuckerrüben ZR'],
  ['f15cb3a7-95a4-46c6-9c3c-3578c3c8e8fb', 'Zwetschgen ZWE'], ['d40c6e6d-65d1-450f-a2b1-742382053e1a', 'Zwiebeln, Lauchgewächse LA']
];
// "Name Kürzel": das Kürzel ist das letzte Wort.
export const INTACT_KULTUREN = KATALOG_ROH.map(([k, v]) => {
  const i = v.lastIndexOf(' ');
  return { k, v, name: v.slice(0, i), kuerzel: v.slice(i + 1) };
});
const NACH_NAME = new Map(INTACT_KULTUREN.map(e => [e.name, e]));
export const kulturEintrag = (name) => NACH_NAME.get(name) || null;

export function kulturNorm(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s*-\s*/g, '-').replace(/[^a-z0-9/,-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const NORM_KATALOG = new Map(INTACT_KULTUREN.map(e => [kulturNorm(e.name), e]));

// Regeln: [Muster auf bereinigtem Text, Zielname | Funktion(text) -> Zielname, Sicherheit]
// Reihenfolge zählt (z.B. Buchweizen vor Weizen, Leindotter vor Lein).
const saison = (t) => (/winter/.test(t) ? 'winter' : /sommer/.test(t) ? 'sommer' : '');
const nachSaison = (winter, sommer, ohne = null) => (t) => {
  const s = saison(t);
  return s === 'winter' ? [winter, 'regel'] : s === 'sommer' ? [sommer, 'regel'] : ohne || [winter, 'aehnlich'];
};
const REGELN = [
  [/samenvermehrung|^vermehrung/, (t) => [/luzerne/.test(t) ? 'Samenvermehrung Luzerne' : /klee/.test(t) ? 'Samenvermehrung Klee' : 'Samenvermehrung Gras', 'regel']],
  [/buchweizen/, 'Buchweizen'],
  [/zuckermais/, 'Zuckermais'],
  [/mais.*sonnenblume|sonnenblume.*mais/, 'Mais-Sonnenblumen-Gemenge'],
  [/silomais|silage ?mais|mais.*silage|gemenge mit silomais/, 'Silomais'],
  [/koernermais|ccm|maiskolben|corn-cob/, 'Koernermais'],
  [/hartweizen|durum/, nachSaison('Winterhartweizen', 'Sommerhartweizen')],
  [/menggetreide|mischgetreide/, (t) => { const w = /ohne weizen/.test(t) ? 'ohne' : /mit weizen/.test(t) ? 'mit' : ''; const s = saison(t) === 'sommer' ? 'Sommer' : 'Winter';
    return [`${s}menggetreide ${w || 'ohne'} Weizen`, w && saison(t) ? 'regel' : 'aehnlich']; }],
  [/getreide.*leguminos|leguminos.*getreide|stuetzfrucht|gemenge.*getreide/, 'Getreide-Koernerleguminosen-Gemenge'],
  [/emmer|einkorn/, (t) => { const e = /emmer/.test(t), k = /einkorn/.test(t), s = saison(t) === 'sommer' ? 'Sommer' : 'Winter', sicher = saison(t) ? 'regel' : 'aehnlich';
    return [e && k ? `${s}emmer, ${s}einkorn` : e ? `${s}emmer` : `${s}einkorn`, sicher]; }],
  [/dinkel/, 'Dinkel'],
  [/weizen/, nachSaison('Winterweizen', 'Sommerweizen')],
  [/roggen/, nachSaison('Winterroggen', 'Sommerroggen')],
  [/gerste/, nachSaison('Wintergerste', 'Sommergerste')],
  [/hafer/, nachSaison('Winterhafer', 'Sommerhafer', ['Sommerhafer', 'aehnlich'])],
  [/triticale/, nachSaison('Wintertriticale', 'Sommertriticale')],
  [/sudangras|sorghum-sudan/, 'Sudangras'],
  [/hirse|sorghum/, 'Hirse'],
  [/amarant/, 'Amaranth'], [/quinoa/, 'Quinoa'], [/chia/, 'Chia'], [/reis/, 'Reis im Trockenanbau'],
  [/^mais$|^mais /, ['Koernermais', 'aehnlich']],
  [/leindotter/, 'Leindotter'], [/oellein|lein ?samen/, 'Oellein'], [/faserlein|flachs|^lein\b/, 'Lein / Flachs'],
  [/winterraps/, 'Winterraps'], [/sommerraps/, 'Sommerraps'], [/raps/, ['Winterraps', 'aehnlich']], [/ruebsen/, 'Ruebsen'],
  [/sonnenblume/, 'Sonnenblumen'], [/faerberdistel|saflor/, 'Faerberdistel'], [/hanf/, 'Hanf'], [/mohn/, 'Mohn'],
  [/oelrettich/, 'Oelrettich'], [/senf/, 'Senf'], [/phacelia/, 'Phacelia'], [/miscanthus/, 'Miscanthus'],
  [/silphie|energiepflanz|energiegras/, 'Energiepflanzen'],
  [/erbse.*bohne|bohne.*erbse/, 'Erbsen-Ackerbohnengemenge'],
  [/ackerbohne|puffbohne|pferdebohne/, 'Ackerbohnen'],
  [/kichererbse/, 'Kichererbsen'], [/erbse/, 'Erbsen'], [/linse/, 'Linsen'], [/soja/, 'Sojabohnen'], [/lupine/, 'Suesslupinen'],
  [/wicke/, (t) => [saison(t) === 'winter' && !/sommer/.test(t) ? 'Winterwicken' : saison(t) === 'sommer' && !/winter/.test(t) ? 'Sommerwicken' : 'Winter/Sommer-Wicken', 'regel']],
  [/koernerleguminos|huelsenfrucht/, ['Sonstige Koernerleguminosen', 'aehnlich']],
  [/kleegras|klee-?gras|luzernegras|klee-?\/?luzernegras/, 'Kleegras, Klee-/Luzernegrasgemisch'],
  [/klee.*luzerne|luzerne.*klee/, ['Klee', 'aehnlich']],
  [/leguminos.*gras|gras.*leguminos/, ['Kleegras, Klee-/Luzernegrasgemisch', 'aehnlich']],
  [/kleinkoernige?n? leguminos|mischkultur.*leguminos/, ['Klee', 'aehnlich']],
  [/luzerne/, 'Luzerne'], [/esparsette/, 'Esparsette'], [/serradella/, 'Serradella'], [/klee/, 'Klee'],
  [/ganzpflanzen|gps/, 'Ackerfutter - GPS'],
  [/wechselgruenland/, 'Wechselgruenland'],
  [/ackergras|feldgras|weidelgras|gras auf ackerland|grasanbau/, 'Ackergras'],
  [/streuobst.*wiese|wiese.*streuobst|streuobstwiese/, 'Wiese mit Streuobst'],
  [/streuobst.*maehweide|maehweide.*streuobst/, 'Maehweide mit Streuobst'],
  [/streuobst.*weide|weide.*streuobst/, 'Weide mit Streuobst'],
  [/streuobst.*gruenland|gruenland.*streuobst/, 'Gruenland mit Streuobst'],
  [/streuobst/, 'Streuobst'],
  [/maehweide/, 'Maehweide'], [/hutung/, 'Weide, Hutung'], [/almen?\b|alpe/, 'Weide, Almen'],
  [/schafweide|weide.*schaf|wanderschaf/, 'Weide, Schafe'], [/\bweiden?\b/, 'Weide'],
  [/streuwiese|streunutzung/, 'Streunutzung'], [/wiese/, 'Wiese'],
  [/altgras/, ['Gruenland', 'aehnlich']], [/dauergruenland|gruenland/, 'Gruenland'],
  [/stilllegung/, 'Freiwillige Flaechenstilllegung'], [/gruenbrache/, 'Gruenbrache'],
  [/bluehstreifen|bluehflaeche|bluehfl|bracheflaeche|brache/, ['Gruenbrache', 'aehnlich']],
  [/zuckerruebe/, 'Zuckerrueben'], [/futterruebe|runkel/, 'Futterrueben'], [/kohlruebe|steckruebe/, 'Kohl-, Steckrueben'],
  [/rote bete|rote ruebe/, 'Rote Bete'],
  [/staerkekartoffel/, 'Staerkekartoffeln'], [/suesskartoffel/, 'Suesskartoffel'], [/kartoffel/, 'Kartoffeln'], [/topinambur/, 'Topinambur'],
  [/zuckermelone/, 'Zuckermelone'], [/melone/, 'Melone'],
  [/kuerbis/, (t) => [/zucchini/.test(t) && !/riesen|hokkaido|garten/.test(t) ? 'Zucchini' : 'Kuerbis', /zucchini/.test(t) ? 'aehnlich' : 'regel']],
  [/zucchini/, 'Zucchini'], [/gurke/, 'Gurken'], [/tomate/, 'Tomaten'], [/salat/, 'Salate'], [/moehre|karotte/, 'Moehren, Karotten'],
  [/zwiebel|lauch|porree|knoblauch|schalotte/, 'Zwiebeln, Lauchgewaechse'], [/sellerie/, 'Sellerie'], [/fenchel/, 'Fenchel'],
  [/spargel/, 'Spargel'], [/rhabarber/, 'Rhabarber'], [/artischocke/, 'Artischocke'],
  [/rosenkohl|kohl|brokkoli|blumenkohl|wirsing/, 'Gemuesekohl'],
  [/erdbeer/, 'Erdbeeren'], [/kuechenkraeuter/, 'Kuechenkraeuter'], [/heil|duft|gewuerz|arznei/, 'Heil-, Duft- und Gewuerzpflanzen'],
  [/unter glas|gewaechshaus/, ['Gartenbau unter Glas', 'aehnlich']], [/gemuese/, 'Gemuese'],
  [/aepfel|apfel/, 'Aepfel'], [/birne/, 'Birnen'], [/aprikose/, 'Aprikosen'], [/sauerkirsch/, 'Sauerkirschen'], [/suesskirsch|kirsche/, 'Suesskirschen'],
  [/zwetsch|pflaume/, 'Zwetschgen'], [/mirabelle|reneklode/, 'Mirabellen, Renekloden'], [/quitte/, 'Quitten'], [/walnuss/, 'Walnuesse'],
  [/haselnuss/, 'Haselnuesse'], [/marone|esskastanie/, 'Maronen'], [/holunder/, 'Holunder'], [/aronia/, 'Aronia'], [/sanddorn/, 'Sanddorn'],
  [/johannisbeer/, 'Johannisbeeren'], [/stachelbeer/, 'Stachelbeeren'], [/himbeer/, 'Himbeeren'], [/heidelbeer/, 'Heidelbeeren'],
  [/beerenobst/, 'Beerenobst'], [/kern.*steinobst|kernobst|steinobst/, 'Kern- und Steinobst'], [/obst/, ['Sonstiges Obst', 'aehnlich']],
  [/tafeltraube/, 'Tafeltrauben'], [/rebland.*unbestockt|unbestockt/, 'Rebland, unbestockt'], [/reb|weinbau|weinberg/, 'Rebland, bestockt'],
  [/hopfen/, 'Hopfen'], [/baumschule/, 'Baumschule'], [/weihnachtsbaum|christbaum/, 'Weihnachtsbaeume'],
  [/zierpflanze/, (t) => [/glas/.test(t) ? 'Zierpflanzen Glashaus' : 'Zierpflanzen', 'regel']], [/^rosen/, 'Rosen'],
  [/teich/, 'Teichflaechen'], [/hausgarten|nutzgarten/, 'Hausgarten'], [/miete|lagerung/, ['Unbefestigte Mieten DG', 'aehnlich']],
  [/dauerkultur/, ['Sonstige Dauerkulturen', 'aehnlich']],
  [/hecke|baumreihe|feldgehoelz|feldrain|landschaftselement|biotop|tuempel|soll\b|steinriegel|trockenmauer|einzelbaum|knick/, ['Biotop', 'aehnlich']]
];
// Zielnamen der Regeln sind ohne Umlaute geschrieben; der Vergleich läuft bereinigt (ä -> ae …)
const zielEintrag = (ziel) => NORM_KATALOG.get(kulturNorm(ziel));

// Landschaftselemente (keine Kultur im eigentlichen Sinn, gehören zum Schlag)
export const LANDSCHAFTSELEMENT_RE = /hecke|baumreihe|geh(ö|oe)lz|feldrain|landschaftselement|t(ü|ue)mpel|s(ö|oe)lle|feuchtgebiet|steinriegel|lesestein|trockenmauer|natursteinmauer|einzelbaum|knick/i;
// FLIK-Art eines Landschaftselements (z. B. Thüringen "DETHLIHK…"): Hecken/Knicks,
// Baumreihen, Feldgehölze, Feuchtgebiete, Einzelbäume, Tümpel/Sölle, Feldraine,
// Trocken-/Natursteinmauern, Steinriegel, Lesesteinwälle
export const LANDSCHAFTSELEMENT_FLIK_RE = /^DE[A-Z]{2}LI(HK|BR|FG|FS|EB|TS|FR|TM|TR|SR|LS)/;

// Ordnet einen Kulturnamen (Klartext) einem Katalogeintrag zu.
// gemerkt: { [Originaltext]: Katalogname } — frühere Entscheidungen des Kontrolleurs
export function kulturZuordnen(text, gemerkt = {}) {
  const roh = String(text || '').trim();
  const leer = { name: '', kuerzel: '', k: '', sicherheit: 'unbekannt', quelle: roh };
  if (!roh) return leer;
  if (gemerkt[roh] && kulturEintrag(gemerkt[roh])) return { ...kulturEintrag(gemerkt[roh]), sicherheit: 'manuell', quelle: roh };
  const ohneCode = roh.replace(/^\d+\s*[:-]\s*/, '');
  const t = kulturNorm(ohneCode);
  // Katalogname oder "Name Kürzel" genau so geschrieben
  const genau = NORM_KATALOG.get(t) || INTACT_KULTUREN.find(e => kulturNorm(e.v) === t);
  if (genau) return { ...genau, sicherheit: 'gleich', quelle: roh };
  // ohne Zusätze wie "mit Untersaat", Klammern
  const kurz = kulturNorm(ohneCode.replace(/\([^)]*\)?/g, ' ').replace(/\bmit untersaat\b/gi, ' ').replace(/\b(ökologisch|oekologisch|konventionell)\b/gi, ' '));
  if (NORM_KATALOG.get(kurz)) return { ...NORM_KATALOG.get(kurz), sicherheit: 'gleich', quelle: roh };
  // Regeln zuerst ohne Klammerzusätze ("Wiesen (einschl. Streuobstwiesen)" ist eine Wiese), dann mit
  for (const text of [kurz, t]) {
    for (const [re, ziel] of REGELN) {
      if (!re.test(text)) continue;
      const [name, sich] = typeof ziel === 'function' ? ziel(text) : Array.isArray(ziel) ? ziel : [ziel, 'regel'];
      const e = zielEintrag(name);
      if (e) return { ...e, sicherheit: sich, quelle: roh };
    }
  }
  return leer;
}

// Kategorien des externen Programms (Auswahl "Kategorie", gleiche Schreibweise)
export const INTACT_KATEGORIEN = ['Amaranth', 'Äpfel', 'Aprikosen', 'Artischocke', 'Baumschulgehölze', 'Beerenobst', 'Biotop', 'Birnen',
  'Buchweizen', 'Chia', 'Dauerkulturen', 'Energiepflanzen', 'Färberdistel', 'Futter-, Streuaufwuchs', 'Futterrüben', 'Gemüse', 'Getreide',
  'Getreidegemenge', 'GPS', 'Grün- und Raufutter', 'Grün-, Raufutter, Streuobst', 'Grünbrache', 'Hanf', 'Heil-, Duft- und Gewürzpflanzen',
  'Hirse', 'Holunder', 'Hopfen', 'Kartoffeln', 'Kern- und Steinobst', 'Kohl- und Steckrüben', 'Körnerleguminosen', 'Kräuter', 'Kürbis',
  'Leguminosen-Getreide-Gemenge', 'Lein', 'Leindotter', 'Mais', 'Mais-Sonnenblumengemenge', 'Melone', 'Mohn', 'Möhren', 'Nüsse', 'Obst',
  'Ölrettich', 'Phacelia', 'Quinoa', 'Quitten', 'Raps', 'Rebland', 'Reis', 'Rhabarber', 'Rübsen', 'Saatgut', 'Sanddorn', 'Sauerkirschen',
  'Senf', 'Serradella', 'Sojabohnen', 'Sonnenblumen', 'Spargel', 'Streuobst', 'Sudangras', 'Süßkartoffel', 'Süßkirschen', 'Tafeltrauben',
  'Topinambur', 'Walnüsse', 'Weihnachtsbäume', 'Weintrauben', 'Zierpflanzen', 'Zuckerrüben', 'Zwetschgen'];
// Kategorie je Kultur des Katalogs. Wo eine Kategorie genauso heißt wie die
// Kultur, ist sie eindeutig; Getreide/Futter/Gemüse/Obst nach Gruppen.
// Bewusst ohne Kategorie (Kontrolleur wählt): Teichflächen, Unbefestigte Mieten, Unbekannt.
const KATEGORIE_JE_KULTUR = {
  Ackerbohnen: 'Körnerleguminosen', 'Ackerfutter - GPS': 'GPS', Ackergras: 'Grün- und Raufutter', Amaranth: 'Amaranth', Äpfel: 'Äpfel',
  Aprikosen: 'Aprikosen', Aronia: 'Beerenobst', Artischocke: 'Artischocke', Baumschule: 'Baumschulgehölze', Beerenobst: 'Beerenobst',
  Biotop: 'Biotop', Birnen: 'Birnen', Buchweizen: 'Buchweizen', Chia: 'Chia', Dinkel: 'Getreide', Einkorn: 'Getreide',
  Energiepflanzen: 'Energiepflanzen', Erbsen: 'Körnerleguminosen', 'Erbsen-Ackerbohnengemenge': 'Körnerleguminosen', Erdbeeren: 'Beerenobst',
  Esparsette: 'Grün- und Raufutter', Färberdistel: 'Färberdistel', Fenchel: 'Gemüse', 'Freiwillige Flächenstilllegung': 'Grünbrache',
  Futterrüben: 'Futterrüben', 'Gartenbau unter Glas': 'Gemüse', 'Gartenbau, Freiland': 'Gemüse', Gemüse: 'Gemüse', Gemüsekohl: 'Gemüse',
  'Getreide sonstige': 'Getreide', 'Getreide-Körnerleguminosen-Gemenge': 'Leguminosen-Getreide-Gemenge', Grünbrache: 'Grünbrache',
  Grünland: 'Grün- und Raufutter', 'Grünland mit Streuobst': 'Grün-, Raufutter, Streuobst', Gurken: 'Gemüse', Hanf: 'Hanf', Haselnüsse: 'Nüsse',
  Hausgarten: 'Gemüse', Heidelbeeren: 'Beerenobst', 'Heil-, Duft- und Gewürzpflanzen': 'Heil-, Duft- und Gewürzpflanzen', Himbeeren: 'Beerenobst',
  Hirse: 'Hirse', Holunder: 'Holunder', Hopfen: 'Hopfen', Johannisbeeren: 'Beerenobst', Kartoffeln: 'Kartoffeln', 'Kern- und Steinobst': 'Kern- und Steinobst',
  Kichererbsen: 'Körnerleguminosen', Klee: 'Grün- und Raufutter', 'Kleegras, Klee-/Luzernegrasgemisch': 'Grün- und Raufutter',
  'Kohl-, Steckrüben': 'Kohl- und Steckrüben', Körnermais: 'Mais', Küchenkräuter: 'Kräuter', Kürbis: 'Kürbis', 'Lein / Flachs': 'Lein',
  Leindotter: 'Leindotter', Linsen: 'Körnerleguminosen', Luzerne: 'Grün- und Raufutter', Mähweide: 'Grün- und Raufutter',
  'Mähweide mit Streuobst': 'Grün-, Raufutter, Streuobst', 'Mais-Sonnenblumen-Gemenge': 'Mais-Sonnenblumengemenge', Maronen: 'Nüsse',
  Melone: 'Melone', 'Mirabellen, Renekloden': 'Kern- und Steinobst', Miscanthus: 'Energiepflanzen', Mohn: 'Mohn', 'Möhren, Karotten': 'Möhren',
  Öllein: 'Lein', Ölrettich: 'Ölrettich', Phacelia: 'Phacelia', Quinoa: 'Quinoa', Quitten: 'Quitten', 'Rebland, bestockt': 'Rebland',
  'Rebland, unbestockt': 'Rebland', 'Reis im Trockenanbau': 'Reis', Rhabarber: 'Rhabarber', Rosen: 'Zierpflanzen', 'Rote Bete': 'Gemüse',
  Rübsen: 'Rübsen', Salate: 'Gemüse', 'Samenvermehrung Gras': 'Saatgut', 'Samenvermehrung Klee': 'Saatgut', 'Samenvermehrung Luzerne': 'Saatgut',
  Sanddorn: 'Sanddorn', Sauerkirschen: 'Sauerkirschen', Sellerie: 'Gemüse', Senf: 'Senf', Serradella: 'Serradella', Silomais: 'Mais',
  Sojabohnen: 'Sojabohnen', Sommereinkorn: 'Getreide', Sommeremmer: 'Getreide', 'Sommeremmer, Sommereinkorn': 'Getreide', Sommergerste: 'Getreide',
  Sommerhafer: 'Getreide', Sommerhartweizen: 'Getreide', 'Sommermenggetreide mit Weizen': 'Getreidegemenge', 'Sommermenggetreide ohne Weizen': 'Getreidegemenge',
  Sommerraps: 'Raps', Sommerroggen: 'Getreide', Sommertriticale: 'Getreide', Sommerweizen: 'Getreide', Sommerwicken: 'Körnerleguminosen',
  Sonnenblumen: 'Sonnenblumen', 'Sonstige Dauerkulturen': 'Dauerkulturen', 'Sonstige Körnerleguminosen': 'Körnerleguminosen', 'Sonstiges Obst': 'Obst',
  Spargel: 'Spargel', Stachelbeeren: 'Beerenobst', Stärkekartoffeln: 'Kartoffeln', Streunutzung: 'Futter-, Streuaufwuchs', Streuobst: 'Streuobst',
  Sudangras: 'Sudangras', Süßkartoffel: 'Süßkartoffel', Süßkirschen: 'Süßkirschen', Süßlupinen: 'Körnerleguminosen', Tafeltrauben: 'Tafeltrauben',
  Tomaten: 'Gemüse', Topinambur: 'Topinambur', Walnüsse: 'Walnüsse', Wechselgrünland: 'Grün- und Raufutter', 'Weide mit Streuobst': 'Grün-, Raufutter, Streuobst',
  Weide: 'Grün- und Raufutter', 'Weide, Almen': 'Grün- und Raufutter', 'Weide, Hutung': 'Grün- und Raufutter', 'Weide, Schafe': 'Grün- und Raufutter',
  Weihnachtsbäume: 'Weihnachtsbäume', 'Wiese mit Streuobst': 'Grün-, Raufutter, Streuobst', Wiese: 'Grün- und Raufutter',
  'Winter/Sommer-Wicken': 'Körnerleguminosen', Wintereinkorn: 'Getreide', Winteremmer: 'Getreide', 'Winteremmer, Wintereinkorn': 'Getreide',
  Wintergerste: 'Getreide', Winterhafer: 'Getreide', Winterhartweizen: 'Getreide', 'Wintermenggetreide mit Weizen': 'Getreidegemenge',
  'Wintermenggetreide ohne Weizen': 'Getreidegemenge', Winterraps: 'Raps', Winterroggen: 'Getreide', Wintertriticale: 'Getreide', Winterweizen: 'Getreide',
  Winterwicken: 'Körnerleguminosen', 'Zierpflanzen Glashaus': 'Zierpflanzen', Zierpflanzen: 'Zierpflanzen', Zucchini: 'Gemüse', Zuckermais: 'Mais',
  Zuckermelone: 'Melone', Zuckerrüben: 'Zuckerrüben', Zwetschgen: 'Zwetschgen', 'Zwiebeln, Lauchgewächse': 'Gemüse'
};
// Kategorie (Spalte "Kategorie") zu einem Katalognamen: zuerst festgelegt bzw. aus der
// Liste gelernt (gelernt), sonst die Tabelle oben; unbekannt -> null.
export function kategorieFuer(kulturName, gelernt = new Map()) {
  if (!kulturName) return null;
  if (gelernt.has(kulturName)) return gelernt.get(kulturName);
  return KATEGORIE_JE_KULTUR[kulturName] || null;
}
