const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cheerio = require('cheerio');

// Permitir certificados SSL intermedios incompletos habituales en servidores municipales
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const COMPETI_ID = '003018';
const URL_RESULTADOS = `https://deportes.aytoburgos.es/deporteson/resul.php?competi=${COMPETI_ID}&tipc=&c=0`;
const URL_CLASIF_1 = `https://deportes.aytoburgos.es/deporteson/clasif.php?competi=${COMPETI_ID}&tipc=&c=0`;
const URL_CLASIF_2 = `https://deportes.aytoburgos.es/deporteson/clasi.php?competi=${COMPETI_ID}&tipc=&c=0`;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function decodificarBuffer(buffer, contentType = '') {
  const ct = contentType.toLowerCase();
  const preferIso = ct.includes('iso-8859-1') || ct.includes('windows-1252');
  let html = new TextDecoder(preferIso ? 'iso-8859-1' : 'utf-8').decode(buffer);
  if (!preferIso && html.includes('\uFFFD')) {
    html = new TextDecoder('iso-8859-1').decode(buffer);
  }
  return html;
}

async function descargarHtml(url) {
  const errores = [];

  // Intento 1: fetch nativo de Node.js con cabeceras de navegador
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const html = decodificarBuffer(buf, res.headers.get('content-type') || '');
    if (html && html.length > 300) {
      return html;
    }
    throw new Error('Respuesta HTML vacía o demasiado corta');
  } catch (e) {
    errores.push(`fetch directo: ${e.message}`);
  }

  // Intento 2: curl del sistema (evita incompatibilidades TLS de Node con servidores Apache antiguos)
  try {
    const rawBuf = execFileSync('curl', [
      '-k', '-s', '-L',
      '--max-time', '25',
      '-A', USER_AGENT,
      '-H', 'Accept-Language: es-ES,es;q=0.9',
      url
    ], { maxBuffer: 10 * 1024 * 1024 });
    const html = decodificarBuffer(rawBuf);
    if (html && html.length > 300 && /<table|<html/i.test(html)) {
      return html;
    }
    throw new Error('curl devolvió contenido no válido');
  } catch (e) {
    errores.push(`curl: ${e.message}`);
  }

  // Intento 3: Proxy público de respaldo por si el servidor municipal bloquea IPs de GitHub Actions
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];
  for (const proxyUrl of proxies) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(proxyUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT }
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const html = decodificarBuffer(buf, res.headers.get('content-type') || '');
      if (html && html.length > 300 && /<table|<html/i.test(html)) {
        return html;
      }
    } catch (e) {
      errores.push(`proxy (${proxyUrl.split('/')[2]}): ${e.message}`);
    }
  }

  throw new Error(`No se pudo descargar ${url}. Detalles: ${errores.join(' | ')}`);
}

function limpiarTexto(str) {
  return (str || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function buscarTituloJornada($, tabla, numeroFallback) {
  // Recorre hermanos anteriores directos y de contenedores padres (ej. div.table-responsive)
  let nodo = $(tabla);
  for (let nivel = 0; nivel < 5; nivel++) {
    let hermano = nodo.prev();
    while (hermano.length) {
      const txt = limpiarTexto(hermano.text());
      if (txt && /jornada\s*\d+/i.test(txt) && txt.length <= 60) {
        return txt;
      }
      const encontrado = hermano.find('h1, h2, h3, h4, h5, p, span, strong, b, div').filter((_, el) => {
        const t = limpiarTexto($(el).text());
        return /^jornada\s*\d+$/i.test(t);
      }).last();
      if (encontrado.length) {
        return limpiarTexto(encontrado.text());
      }
      hermano = hermano.prev();
    }
    nodo = nodo.parent();
    if (!nodo.length || nodo.is('body')) break;
  }
  return `Jornada ${numeroFallback}`;
}

function parsearTablaPartidos($, tabla, urlBase) {
  const filas = $(tabla).find('tr');
  if (filas.length < 2) return [];

  // Analizar fila de cabecera (<th> o primera fila <tr>) para saber la posición exacta de cada columna
  const celdasCabecera = filas.first().find('th, td');
  const cabeceras = [];
  celdasCabecera.each((_, el) => {
    cabeceras.push(limpiarTexto($(el).text()).toLowerCase());
  });

  const idxLocal = cabeceras.findIndex(h => h.includes('local'));
  const idxVisitante = cabeceras.findIndex(h => h.includes('visitante'));
  const idxFecha = cabeceras.findIndex(h => h.includes('fecha') || h.includes('hora'));
  const idxLugar = cabeceras.findIndex(h => h.includes('lugar') || h.includes('campo') || h.includes('pista'));
  const idxActa = cabeceras.findIndex(h => h.includes('acta'));

  const partidos = [];

  filas.each((rowIdx, fila) => {
    const celdas = $(fila).find('td');
    if (celdas.length === 0) return; // Fila de <th>

    const textos = [];
    celdas.each((_, c) => textos.push(limpiarTexto($(c).text())));

    // Saltar fila de cabecera si estaba hecha con <td>
    if (rowIdx === 0 && (idxLocal !== -1 || /^local$/i.test(textos[0]))) {
      return;
    }

    let local = '';
    let visitante = '';
    let golesLocal = null;
    let golesVisitante = null;
    let fecha = '';
    let lugar = '';
    let acta = null;

    if (idxLocal !== -1 && idxVisitante !== -1 && idxVisitante > idxLocal) {
      // Extracción guiada por las cabeceras exactas de esta tabla (funciona con 5, 6 o 7 columnas)
      local = textos[idxLocal] || '';
      visitante = textos[idxVisitante] || '';

      // Buscar goles en las columnas situadas entre Local y Visitante
      const colsEntre = textos.slice(idxLocal + 1, idxVisitante);
      if (colsEntre.length >= 2) {
        if (colsEntre[0] !== '' && !isNaN(Number(colsEntre[0]))) golesLocal = Number(colsEntre[0]);
        if (colsEntre[1] !== '' && !isNaN(Number(colsEntre[1]))) golesVisitante = Number(colsEntre[1]);
      } else if (colsEntre.length === 1) {
        const m = colsEntre[0].match(/^(\d+)\s*[-:]\s*(\d+)$/);
        if (m) {
          golesLocal = Number(m[1]);
          golesVisitante = Number(m[2]);
        }
      }

      if (idxFecha !== -1 && textos[idxFecha]) fecha = textos[idxFecha];
      if (idxLugar !== -1 && textos[idxLugar]) lugar = textos[idxLugar];
      if (idxActa !== -1 && celdas[idxActa]) {
        const href = $(celdas[idxActa]).find('a').attr('href');
        if (href) acta = new URL(href, urlBase).href;
      }
    } else {
      // Respaldo si no hay cabecera explícita
      if (celdas.length >= 6) {
        local = textos[0];
        if (textos[1] !== '' && !isNaN(Number(textos[1]))) golesLocal = Number(textos[1]);
        if (textos[2] !== '' && !isNaN(Number(textos[2]))) golesVisitante = Number(textos[2]);
        visitante = textos[3];
        fecha = textos[4] || '';
        lugar = textos[5] || '';
        if (celdas[6]) {
          const href = $(celdas[6]).find('a').attr('href');
          if (href) acta = new URL(href, urlBase).href;
        }
      } else if (celdas.length >= 4) {
        // Jornada futura sin columnas de goles: Local | Visitante | Fecha | Lugar | [Acta]
        local = textos[0];
        visitante = textos[1];
        fecha = textos[2] || '';
        lugar = textos[3] || '';
        if (celdas[4]) {
          const href = $(celdas[4]).find('a').attr('href');
          if (href) acta = new URL(href, urlBase).href;
        }
      }
    }

    if (local && visitante && !/^local$/i.test(local) && !/^visitante$/i.test(visitante)) {
      partidos.push({
        local,
        golesLocal,
        golesVisitante,
        visitante,
        fecha,
        lugar,
        acta
      });
    }
  });

  return partidos;
}

function calcularClasificacionDesdeJornadas(jornadas, equipos) {
  const mapa = {};
  equipos.forEach(eq => {
    mapa[eq] = {
      equipo: eq,
      puntos: 0,
      jugados: 0,
      ganados: 0,
      empatados: 0,
      perdidos: 0,
      golesFavor: 0,
      golesContra: 0
    };
  });

  jornadas.forEach(j => {
    j.partidos.forEach(p => {
      if (p.golesLocal !== null && p.golesVisitante !== null) {
        if (!mapa[p.local]) mapa[p.local] = { equipo: p.local, puntos: 0, jugados: 0, ganados: 0, empatados: 0, perdidos: 0, golesFavor: 0, golesContra: 0 };
        if (!mapa[p.visitante]) mapa[p.visitante] = { equipo: p.visitante, puntos: 0, jugados: 0, ganados: 0, empatados: 0, perdidos: 0, golesFavor: 0, golesContra: 0 };

        const loc = mapa[p.local];
        const vis = mapa[p.visitante];

        loc.jugados += 1;
        vis.jugados += 1;
        loc.golesFavor += p.golesLocal;
        loc.golesContra += p.golesVisitante;
        vis.golesFavor += p.golesVisitante;
        vis.golesContra += p.golesLocal;

        if (p.golesLocal > p.golesVisitante) {
          loc.ganados += 1;
          loc.puntos += 3;
          vis.perdidos += 1;
        } else if (p.golesLocal < p.golesVisitante) {
          vis.ganados += 1;
          vis.puntos += 3;
          loc.perdidos += 1;
        } else {
          loc.empatados += 1;
          vis.empatados += 1;
          loc.puntos += 1;
          vis.puntos += 1;
        }
      }
    });
  });

  return Object.values(mapa)
    .sort((a, b) => {
      if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      const dgA = a.golesFavor - a.golesContra;
      const dgB = b.golesFavor - b.golesContra;
      if (dgB !== dgA) return dgB - dgA;
      if (b.golesFavor !== a.golesFavor) return b.golesFavor - a.golesFavor;
      return a.equipo.localeCompare(b.equipo, 'es');
    })
    .map((item, idx) => ({ posicion: idx + 1, ...item }));
}

async function extraerTodo() {
  console.log('=== Iniciando sincronización con deportes.aytoburgos.es ===');
  const htmlResultados = await descargarHtml(URL_RESULTADOS);
  const $res = cheerio.load(htmlResultados);

  // Detectar URL real del botón Clasificación dentro de resul.php
  let urlClasifDetectada = null;
  $res('a, button, input').each((_, el) => {
    const txt = limpiarTexto($res(el).text() || $res(el).attr('value'));
    if (/clasificaci[oó]n/i.test(txt)) {
      const href = $res(el).attr('href');
      const onclick = $res(el).attr('onclick') || '';
      if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
        urlClasifDetectada = new URL(href, URL_RESULTADOS).href;
      } else {
        const m = onclick.match(/['"]([^'"]*clas[^'"]*)['"]/i);
        if (m && m[1]) urlClasifDetectada = new URL(m[1], URL_RESULTADOS).href;
      }
    }
  });

  const jornadas = [];
  const equiposSet = new Set();

  $res('table').each((i, tabla) => {
    const partidos = parsearTablaPartidos($res, tabla, URL_RESULTADOS);
    if (partidos.length > 0) {
      const titulo = buscarTituloJornada($res, tabla, jornadas.length + 1);
      partidos.forEach(p => {
        equiposSet.add(p.local);
        equiposSet.add(p.visitante);
      });
      jornadas.push({
        jornada: titulo,
        partidos
      });
    }
  });

  console.log(`Jornadas extraídas: ${jornadas.length} | Equipos detectados: ${equiposSet.size}`);

  if (jornadas.length === 0) {
    throw new Error('No se encontraron tablas de jornadas en el HTML descargado.');
  }

  // Intentar descargar clasificación oficial
  let clasificacion = [];
  let origenClasificacion = 'oficial';
  const urlsClasif = Array.from(new Set([
    urlClasifDetectada,
    URL_CLASIF_1,
    URL_CLASIF_2
  ].filter(Boolean)));

  for (const urlC of urlsClasif) {
    try {
      console.log('Consultando clasificación oficial en:', urlC);
      const htmlClasif = await descargarHtml(urlC);
      const $c = cheerio.load(htmlClasif);

      $c('table').each((_, tabla) => {
        if (clasificacion.length > 0) return;

        const textoTabla = limpiarTexto($c(tabla).text()).toUpperCase();
        const tieneEquipos = Array.from(equiposSet).some(eq => textoTabla.includes(eq.toUpperCase()));
        if (!tieneEquipos) return;

        const filas = $c(tabla).find('tr');
        const headerCells = filas.first().find('th, td');
        const headers = [];
        headerCells.each((__, el) => headers.push(limpiarTexto($c(el).text()).toLowerCase()));

        const idxPos = headers.findIndex(h => h === 'pos' || h === '#' || h.includes('ord') || h.includes('puesto'));
        const idxEq = headers.findIndex(h => h.includes('equipo') || h.includes('club'));
        const idxPts = headers.findIndex(h => h.includes('pt') || h.includes('pun'));
        const idxPJ = headers.findIndex(h => h === 'pj' || h.includes('jug'));
        const idxPG = headers.findIndex(h => h === 'pg' || h.includes('gan'));
        const idxPE = headers.findIndex(h => h === 'pe' || h.includes('emp'));
        const idxPP = headers.findIndex(h => h === 'pp' || h.includes('per'));
        const idxGF = headers.findIndex(h => h === 'gf' || h.includes('favor'));
        const idxGC = headers.findIndex(h => h === 'gc' || h.includes('contra'));

        const temp = [];
        filas.each((rIdx, fila) => {
          const cols = $c(fila).find('td');
          if (cols.length < 5) return;
          const vals = [];
          cols.each((__, c) => vals.push(limpiarTexto($c(c).text())));

          if (rIdx === 0 && (idxEq !== -1 || vals.some(v => /^equipo$/i.test(v)))) return;

          let equipo = '';
          let puntos = NaN;
          let posicion = temp.length + 1;
          let jugados = 0, ganados = 0, empatados = 0, perdidos = 0, golesFavor = 0, golesContra = 0;

          if (idxEq !== -1 && idxPts !== -1) {
            equipo = vals[idxEq] || '';
            puntos = Number(vals[idxPts]);
            if (idxPos !== -1 && !isNaN(Number(vals[idxPos]))) posicion = Number(vals[idxPos]);
            if (idxPJ !== -1) jugados = Number(vals[idxPJ]) || 0;
            if (idxPG !== -1) ganados = Number(vals[idxPG]) || 0;
            if (idxPE !== -1) empatados = Number(vals[idxPE]) || 0;
            if (idxPP !== -1) perdidos = Number(vals[idxPP]) || 0;
            if (idxGF !== -1) golesFavor = Number(vals[idxGF]) || 0;
            if (idxGC !== -1) golesContra = Number(vals[idxGC]) || 0;
          } else {
            const colEq = vals.findIndex(v =>
              Array.from(equiposSet).some(eq => eq.toUpperCase() === v.toUpperCase()) ||
              (v.length > 3 && isNaN(Number(v)) && !/^equipo$/i.test(v))
            );
            if (colEq !== -1) {
              equipo = vals[colEq];
              if (colEq > 0 && !isNaN(Number(vals[0]))) posicion = Number(vals[0]);
              const nums = vals.slice(colEq + 1).map(v => Number(v)).filter(n => !isNaN(n));
              if (nums.length >= 7) {
                if (nums[0] >= nums[1] && nums[1] === nums[2] + nums[3] + nums[4]) {
                  [puntos, jugados, ganados, empatados, perdidos, golesFavor, golesContra] = nums;
                } else {
                  [jugados, ganados, empatados, perdidos, golesFavor, golesContra, puntos] = nums;
                }
              }
            }
          }

          if (equipo && !isNaN(puntos) && !/^equipo$/i.test(equipo)) {
            equiposSet.add(equipo);
            temp.push({
              posicion,
              equipo,
              puntos,
              jugados,
              ganados,
              empatados,
              perdidos,
              golesFavor,
              golesContra
            });
          }
        });

        if (temp.length > 0) {
          clasificacion = temp;
        }
      });

      if (clasificacion.length > 0) {
        console.log(`Clasificación oficial obtenida (${clasificacion.length} equipos) desde ${urlC}`);
        break;
      }
    } catch (e) {
      console.warn(`Aviso al consultar ${urlC}: ${e.message}`);
    }
  }

  if (clasificacion.length === 0) {
    console.log('Calculando clasificación a partir de los resultados oficiales jugados...');
    clasificacion = calcularClasificacionDesdeJornadas(jornadas, Array.from(equiposSet));
    origenClasificacion = 'calculada';
  }

  const tituloCompeticion = limpiarTexto($res('h2, h3, .titulo').first().text()) ||
    'FS. INFANTIL MASC GRUPO 2 - FÚTBOL-SALA, INFANTIL MASCULINO, SEGUNDA, GRUPO 2 (003018)';

  const salida = {
    ultimaActualizacion: new Date().toISOString(),
    competicion: tituloCompeticion,
    fuenteOficial: URL_RESULTADOS,
    origenClasificacion,
    equipos: Array.from(equiposSet).sort((a, b) => a.localeCompare(b, 'es')),
    clasificacion,
    jornadas
  };

  const jsonStr = JSON.stringify(salida, null, 2);

  // Guardar en raíz (para GitHub Pages) y en public/ (por si se usa Vercel/Netlify con subcarpeta)
  fs.writeFileSync(path.join(__dirname, 'datos.json'), jsonStr, 'utf-8');
  if (fs.existsSync(path.join(__dirname, 'public'))) {
    fs.writeFileSync(path.join(__dirname, 'public', 'datos.json'), jsonStr, 'utf-8');
  }

  console.log('¡Archivo datos.json actualizado con éxito!');
}

extraerTodo().catch(err => {
  console.error('ERROR EN SCRAPER:', err.message);
  process.exit(1);
});
