'use strict';
// Lee las páginas del Ayuntamiento de Burgos y escribe docs/data.json (+ docs/status.json).
//   node scripts/scrape.js
// Variables opcionales: COMPETI (003018), TIPC (2), SOURCE_BASE.
const fs = require('fs');
const path = require('path');
const P = require('./parse');

const BASE = process.env.SOURCE_BASE || 'https://deportes.aytoburgos.es/deporteson/';
const COMPETI = process.env.COMPETI || '003018';
const TIPC = process.env.TIPC || '2';
const QS = `competi=${COMPETI}&tipc=${TIPC}&c=`;
const UA = 'LigaFSBurgosScraper/1.0 (GitHub Actions; consulta horaria de una liga infantil)';
const OUT = path.join(__dirname, '..', 'docs', 'data.json');
const STATUS = path.join(__dirname, '..', 'docs', 'status.json');

async function get(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return new TextDecoder('utf-8').decode(await res.arrayBuffer());
}

async function scrape() {
  const warnings = [];
  const [resul, deporte, clasif] = await Promise.allSettled([
    get(`${BASE}resul.php?${QS}`),
    get(`${BASE}deporte.php?${QS}`),
    // La clasificación oficial parece cargarse por POST; si falla, se calcula con los resultados.
    get(`${BASE}clasificacion.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `competi=${COMPETI}&param=&nocache=${Date.now()}`,
    }),
  ]);

  const main = resul.status === 'fulfilled' ? resul.value : deporte.status === 'fulfilled' ? deporte.value : null;
  if (!main) throw new Error(`No se pudo leer ninguna página de origen: ${resul.reason}`);
  if (resul.status !== 'fulfilled') warnings.push('resul.php no disponible: jornadas tomadas de deporte.php');

  const rounds = P.parseRounds(main);
  if (!rounds.length) throw new Error('El HTML de origen no contiene jornadas (¿ha cambiado el formato?)');
  const teams = P.parseTeams(main);
  if (!teams.length) warnings.push('No se encontró la lista de equipos');

  let official = null;
  for (const r of [clasif, deporte]) {
    if (r.status === 'fulfilled') {
      official = P.parseStandings(r.value);
      if (official) break;
    }
  }
  return {
    competition: { id: COMPETI, name: P.parseTitle(main) },
    teams,
    rounds,
    standings: official || P.computeStandings(rounds, teams),
    standingsSource: official ? 'oficial' : 'calculada',
    source: 'live',
    warnings,
  };
}

function readPrev() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; }
}

(async () => {
  const now = new Date().toISOString();
  const data = await scrape();
  const prev = readPrev();
  const strip = ({ updatedAt, ...rest }) => JSON.stringify(rest);
  const changed = !prev || strip(prev) !== strip(data);

  // updatedAt solo cambia cuando cambian los datos: así el repo solo recibe commits cuando hay novedades.
  data.updatedAt = changed ? now : prev.updatedAt;
  if (changed) fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  // status.json no se versiona (.gitignore): solo informa de cuándo se comprobó por última vez.
  fs.writeFileSync(STATUS, JSON.stringify({ checkedAt: now }) + '\n');

  const played = data.rounds.reduce((n, r) => n + r.matches.filter((m) => m.played).length, 0);
  const total = data.rounds.reduce((n, r) => n + r.matches.length, 0);
  console.log(`${changed ? 'CAMBIOS' : 'Sin cambios'} · ${data.teams.length} equipos · ${data.rounds.length} jornadas · ${played}/${total} partidos jugados · clasificación ${data.standingsSource}`);
  data.warnings.forEach((w) => console.warn('AVISO:', w));
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
