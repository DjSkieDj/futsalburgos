'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./parse');

const BASE = process.env.SOURCE_BASE || 'https://deportes.aytoburgos.es/deporteson/';
const COMPETI = process.env.COMPETI || '003018';
const TIPC = process.env.TIPC || '2';
const QS = `competi=${COMPETI}&tipc=${TIPC}&c=`;
const TTL_MS = 5 * 60 * 1000;
const SNAPSHOT = path.join(__dirname, '..', 'data', 'snapshot.json');
const UA = 'LigaFSBurgosApp/1.0 (consulta personal de liga infantil; cache 5 min)';

let cache = { at: 0, data: null };

async function get(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return new TextDecoder('utf-8').decode(await res.arrayBuffer());
}

async function loadLive() {
  const warnings = [];
  const [resul, deporte, clasif] = await Promise.allSettled([
    get(`${BASE}resul.php?${QS}`),
    get(`${BASE}deporte.php?${QS}`),
    get(`${BASE}clasificacion.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `competi=${COMPETI}&param=&nocache=${Date.now()}`,
    }),
  ]);

  const main = resul.status === 'fulfilled' ? resul.value : deporte.status === 'fulfilled' ? deporte.value : null;
  if (!main) throw new Error('No se pudo leer ninguna de las páginas de origen');
  if (resul.status !== 'fulfilled') warnings.push('resul.php no disponible: se usan las jornadas de deporte.php');

  const rounds = P.parseRounds(main);
  if (!rounds.length) throw new Error('El HTML de origen no contiene jornadas (¿cambió el formato?)');
  const teams = P.parseTeams(main);

  // Clasificación oficial si se puede leer; si no, se calcula con los resultados.
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
    warnings,
  };
}

function snapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  } catch {
    return null;
  }
}

async function getData({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < TTL_MS) return { ...cache.data, cached: true };
  try {
    const d = await loadLive();
    cache = { at: Date.now(), data: { ...d, source: 'live', updatedAt: new Date().toISOString() } };
    return cache.data;
  } catch (err) {
    const snap = snapshot();
    if (cache.data) return { ...cache.data, source: 'stale', warnings: [`Origen no disponible (${err.message}); datos de la última lectura`] };
    if (snap) return { ...snap, source: 'snapshot', warnings: [`Origen no disponible (${err.message}); se muestran datos guardados`] };
    throw err;
  }
}

module.exports = { getData, loadLive };
