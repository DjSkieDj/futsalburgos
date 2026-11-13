'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../scripts/parse');

const row = (l, gl, gv, v, f, lugar, acta = '') =>
  `<tr><td class="textoDcha">${l}</td><td class="textoCentrado">${gl}</td><td class="textoCentrado">${gv}</td><td class="textoIzq">${v}</td><td>${f}</td><td>${lugar}</td><td>${acta}</td></tr>`;
const panel = (name, rows) =>
  `<div class="panel panel-default"><div class="panel-heading">${name}</div><div class="panel-body table-wrap"><table><thead><tr><th>Local</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;

const HTML = `
<label for="selcampeonato" class="panel-heading">FS. INFANTIL (003018)</label>
<select id="selequipo"><option value="">Seleccione equipo</option><option value="1" >AAA B</option><option value="2" >BBB</option><option value="3" >CCC A</option></select>
<div id="divPrincipal">
${panel('Jornada 1', row('AAA B', '3', '1', 'BBB', '07/11/26<br>09:00', 'SAN AMARO<br>', '<a onclick="detallesPartido(\'64175\')">Acta</a>'))}
${panel('Jornada 2', row('BBB', '', '', 'CCC A', '14/11/26<br>', '<br>') + row('CCC A', '2', '2', 'AAA B', '14/11/26<br>10:00', 'LAVADEROS<br>'))}
</div>`;

test('lee título y equipos', () => {
  assert.match(P.parseTitle(HTML), /003018/);
  assert.deepEqual(P.parseTeams(HTML).map((t) => t.name), ['AAA B', 'BBB', 'CCC A']);
});

test('lee jornadas, marcadores, fechas y huecos', () => {
  const r = P.parseRounds(HTML);
  assert.equal(r.length, 2);
  const m = r[0].matches[0];
  assert.deepEqual([m.home, m.away, m.hg, m.ag, m.played, m.date, m.time, m.venue, m.id], ['AAA B', 'BBB', 3, 1, true, '2026-11-07', '09:00', 'SAN AMARO', '64175']);
  const pending = r[1].matches[0];
  assert.equal(pending.played, false);
  assert.equal(pending.time, '');
  assert.equal(pending.date, '2026-11-14');
});

test('calcula la clasificación (3-1-0, desempate por diferencia y goles)', () => {
  const s = P.computeStandings(P.parseRounds(HTML), P.parseTeams(HTML));
  assert.deepEqual(s.map((x) => [x.team, x.pts, x.dg]), [['AAA B', 4, 2], ['CCC A', 1, 0], ['BBB', 0, -2]]);
});

test('lee una clasificación oficial con cabeceras', () => {
  const t = `<table><thead><tr><th>Pos</th><th>Equipo</th><th>Pts</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th></tr></thead>
  <tbody><tr><td>1</td><td>AAA B</td><td>7</td><td>3</td><td>2</td><td>1</td><td>0</td><td>9</td><td>4</td></tr></tbody></table>`;
  const s = P.parseStandings(t);
  assert.deepEqual(s[0], { team: 'AAA B', pj: 3, g: 2, e: 1, p: 0, gf: 9, gc: 4, pts: 7, dg: 5 });
});

test('sin tablas devuelve null / vacío sin romper', () => {
  assert.equal(P.parseStandings('<html></html>'), null);
  assert.deepEqual(P.parseRounds('<html></html>'), []);
});
