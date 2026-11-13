'use strict';
// Lector del HTML de deportes.aytoburgos.es/deporteson (sin dependencias).

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

// Quita etiquetas; los <br> pasan a salto de línea.
const text = (html) =>
  decode(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();

const toInt = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : null);

function parseTitle(html) {
  const m = html.match(/<label[^>]*class="panel-heading"[^>]*>([\s\S]*?)<\/label>/);
  return m ? text(m[1]) : '';
}

function parseTeams(html) {
  const sel = html.match(/<select[^>]*id="selequipo"[^>]*>([\s\S]*?)<\/select>/);
  if (!sel) return [];
  const out = [];
  for (const m of sel[1].matchAll(/<option value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)) {
    out.push({ id: m[1], name: text(m[2]) });
  }
  return out;
}

function isoDate(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(d || '');
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2]}-${m[1]}`;
}

// Jornadas y partidos (resul.php o deporte.php)
function parseRounds(html) {
  const rounds = [];
  const re =
    /<div class="panel-heading">\s*([^<]*?)\s*<\/div>\s*<div class="panel-body table-wrap">([\s\S]*?)<\/table>/g;
  for (const p of html.matchAll(re)) {
    const name = text(p[1]);
    const tbody = p[2].match(/<tbody>([\s\S]*?)<\/tbody>/);
    const matches = [];
    if (tbody) {
      for (const r of tbody[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const raw = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
        if (raw.length < 5) continue;
        const c = raw.map(text);
        const hg = toInt(c[1]);
        const ag = toInt(c[2]);
        const [d = '', t = ''] = (c[4] || '').split('\n');
        const idm = (raw[6] || '').match(/detallesPartido\(\s*'?(\d+)/);
        matches.push({
          id: idm ? idm[1] : null,
          home: c[0],
          away: c[3],
          hg,
          ag,
          played: hg !== null && ag !== null,
          note: !(hg !== null && ag !== null) && (c[1] || c[2]) ? `${c[1]} ${c[2]}`.trim() : '',
          date: isoDate(d),
          time: /^\d{1,2}:\d{2}$/.test(t) ? t : '',
          venue: ((c[5] || '').split('\n')[0] || '').trim(),
        });
      }
    }
    rounds.push({ name, matches });
  }
  return rounds;
}

// Clasificación oficial: busca una tabla con columnas de puntos y partidos.
function parseStandings(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
  for (const t of tables) {
    let headers = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
    if (!headers.length) {
      const first = t.match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
      if (first) headers = [...first[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => text(m[1]));
    }
    const idx = (re) => headers.findIndex((h) => re.test(h));
    const iPts = idx(/^(pts?\.?|puntos)$/i);
    const iPj = idx(/^(pj|j|jug\.?|partidos)$/i);
    if (iPts < 0 || iPj < 0) continue;
    let iTeam = idx(/equipo|club/i);
    const map = {
      pj: iPj,
      g: idx(/^(pg|g|gan\.?|ganados)$/i),
      e: idx(/^(pe|e|emp\.?|empatados)$/i),
      p: idx(/^(pp|p|per\.?|perdidos)$/i),
      gf: idx(/^(gf|f|g\.?\s?f\.?)$/i),
      gc: idx(/^(gc|c|g\.?\s?c\.?)$/i),
      pts: iPts,
    };
    const rows = [];
    const body = t.match(/<tbody>([\s\S]*?)<\/tbody>/);
    for (const r of (body ? body[1] : t).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const c = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
      if (c.length < 3) continue;
      if (iTeam < 0) iTeam = c.findIndex((v) => v && !/^[\d.,+-]+$/.test(v));
      const num = (k) => (map[k] >= 0 ? parseInt(c[map[k]], 10) || 0 : 0);
      const row = { team: c[iTeam], pj: num('pj'), g: num('g'), e: num('e'), p: num('p'), gf: num('gf'), gc: num('gc'), pts: num('pts') };
      row.dg = row.gf - row.gc;
      if (row.team) rows.push(row);
    }
    if (rows.length) return rows;
  }
  return null;
}

// Clasificación calculada a partir de los resultados (3 / 1 / 0).
function computeStandings(rounds, teams) {
  const T = new Map();
  const get = (n) => {
    if (!T.has(n)) T.set(n, { team: n, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, dg: 0, pts: 0 });
    return T.get(n);
  };
  teams.forEach((t) => get(t.name));
  for (const r of rounds)
    for (const m of r.matches) {
      get(m.home);
      get(m.away);
      if (!m.played) continue;
      const h = get(m.home);
      const a = get(m.away);
      h.pj++; a.pj++;
      h.gf += m.hg; h.gc += m.ag;
      a.gf += m.ag; a.gc += m.hg;
      if (m.hg > m.ag) { h.g++; a.p++; h.pts += 3; }
      else if (m.hg < m.ag) { a.g++; h.p++; a.pts += 3; }
      else { h.e++; a.e++; h.pts++; a.pts++; }
    }
  const rows = [...T.values()];
  rows.forEach((r) => (r.dg = r.gf - r.gc));
  rows.sort((x, y) => y.pts - x.pts || y.dg - x.dg || y.gf - x.gf || x.team.localeCompare(y.team, 'es'));
  return rows;
}

module.exports = { parseTitle, parseTeams, parseRounds, parseStandings, computeStandings };
