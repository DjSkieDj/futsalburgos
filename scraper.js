const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const URL_RESULTADOS = 'https://deportes.aytoburgos.es/deporteson/resul.php?competi=003018&tipc=&c=0';
const URL_CLASIFICACION_FALLBACK = 'https://deportes.aytoburgos.es/deporteson/clasi.php?competi=003018&tipc=&c=0';

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9'
    }
  });
  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al descargar ${url}`);
  }
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || '';
  const charset = contentType.toLowerCase().includes('iso-8859-1') ? 'iso-8859-1' : 'utf-8';
  let html = new TextDecoder(charset).decode(buffer);
  if (charset === 'utf-8' && html.includes('\uFFFD')) {
    html = new TextDecoder('iso-8859-1').decode(buffer);
  }
  return html;
}

function limpiarTexto(str) {
  return (str || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function buscarTituloJornada($, tabla, indiceFallback) {
  // 1. Buscar en elementos anteriores directos o en contenedores padres (ej. div.table-responsive)
  let actual = $(tabla);
  for (let nivel = 0; nivel < 4; nivel++) {
    let prev = actual.prev();
    while (prev.length) {
      const txt = limpiarTexto(prev.text());
      if (txt && /jornada\s*\d+/i.test(txt) && txt.length < 60) {
        return txt;
      }
      // También revisar encabezados dentro del hermano anterior
      const subHeader = prev.find('h1, h2, h3, h4, h5, p, span, strong, b').filter((_, el) => {
        const t = limpiarTexto($(el).text());
        return /^jornada\s*\d+/i.test(t);
      }).first();
      if (subHeader.length) {
        return limpiarTexto(subHeader.text());
      }
      prev = prev.prev();
    }
    actual = actual.parent();
    if (!actual.length || actual.is('body')) break;
  }
  return `Jornada ${indiceFallback}`;
}

function calcularClasificacionDesdeJornadas(jornadas, equipos) {
  const stats = {};
  equipos.forEach(eq => {
    stats[eq] = { equipo: eq, puntos: 0, jugados: 0, ganados: 0, empatados: 0, perdidos: 0, golesFavor: 0, golesContra: 0 };
  });

  jornadas.forEach(j => {
    j.partidos.forEach(p => {
      if (p.golesLocal !== null && p.golesVisitante !== null) {
        if (!stats[p.local]) stats[p.local] = { equipo: p.local, puntos: 0, jugados: 0, ganados: 0, empatados: 0, perdidos: 0, golesFavor: 0, golesContra: 0 };
        if (!stats[p.visitante]) stats[p.visitante] = { equipo: p.visitante, puntos: 0, jugados: 0, ganados: 0, empatados: 0, perdidos: 0, golesFavor: 0, golesContra: 0 };

        const loc = stats[p.local];
        const vis = stats[p.visitante];

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

  return Object.values(stats)
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

async function extraerDatos() {
  console.log('1. Descargando página de resultados desde:', URL_RESULTADOS);
  const resHtml = await fetchHtml(URL_RESULTADOS);
  const $res = cheerio.load(resHtml);

  // Detectar dinámicamente la URL exacta del botón "Clasificación" dentro de la web oficial
  let urlClasificacion = URL_CLASIFICACION_FALLBACK;
  $res('a, button, input').each((_, el) => {
    const texto = limpiarTexto($res(el).text() || $res(el).attr('value'));
    if (/clasificaci[oó]n/i.test(texto)) {
      const href = $res(el).attr('href');
      const onclick = $res(el).attr('onclick') || '';
      if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
        urlClasificacion = new URL(href, URL_RESULTADOS).href;
      } else {
        const match = onclick.match(/['"]([^'"]*clas[^'"]*)['"]/i);
        if (match && match[1]) {
          urlClasificacion = new URL(match[1], URL_RESULTADOS).href;
        }
      }
    }
  });

  const jornadas = [];
  const equiposSet = new Set();

  // Extraer todas las tablas de jornadas (tanto pasadas como futuras)
  $res('table').each((i, tabla) => {
    const tituloJornada = buscarTituloJornada($res, tabla, i + 1);
    const partidos = [];

    $res(tabla).find('tr').each((_, fila) => {
      const celdas = $res(fila).find('td');
      if (celdas.length === 0) return; // Ignorar filas que solo tienen <th>

      // Caso A: Fila estándar con 6 o 7 columnas (Local | GL | GV | Visitante | Fecha | Lugar | [Acta])
      if (celdas.length >= 6) {
        const local = limpiarTexto($res(celdas[0]).text());
        const gLocalRaw = limpiarTexto($res(celdas[1]).text());
        const gVisRaw = limpiarTexto($res(celdas[2]).text());
        const visitante = limpiarTexto($res(celdas[3]).text());
        const fecha = limpiarTexto($res(celdas[4]).text());
        const lugar = limpiarTexto($res(celdas[5]).text());
        const actaHref = celdas.length >= 7 ? ($res(celdas[6]).find('a').attr('href') || null) : null;

        if (local && visitante && !/^local$/i.test(local)) {
          equiposSet.add(local);
          equiposSet.add(visitante);

          const golesLocal = (gLocalRaw !== '' && !isNaN(Number(gLocalRaw))) ? Number(gLocalRaw) : null;
          const golesVisitante = (gVisRaw !== '' && !isNaN(Number(gVisRaw))) ? Number(gVisRaw) : null;

          partidos.push({
            local,
            golesLocal,
            golesVisitante,
            visitante,
            fecha,
            lugar,
            acta: actaHref ? new URL(actaHref, URL_RESULTADOS).href : null
          });
        }
      }
      // Caso B: Jornadas futuras donde las 2 celdas de goles están unidas con colspan="2" (5 columnas en total)
      else if (celdas.length === 5) {
        const local = limpiarTexto($res(celdas[0]).text());
        const marcadorRaw = limpiarTexto($res(celdas[1]).text());
        const visitante = limpiarTexto($res(celdas[2]).text());
        const fecha = limpiarTexto($res(celdas[3]).text());
        const lugar = limpiarTexto($res(celdas[4]).text());

        if (local && visitante && !/^local$/i.test(local)) {
          equiposSet.add(local);
          equiposSet.add(visitante);

          let golesLocal = null;
          let golesVisitante = null;
          const m = marcadorRaw.match(/^(\d+)\s*[-:]\s*(\d+)$/);
          if (m) {
            golesLocal = Number(m[1]);
            golesVisitante = Number(m[2]);
          }

          partidos.push({
            local,
            golesLocal,
            golesVisitante,
            visitante,
            fecha,
            lugar,
            acta: null
          });
        }
      }
    });

    if (partidos.length > 0) {
      jornadas.push({
        jornada: tituloJornada,
        partidos
      });
    }
  });

  console.log(`   -> Encontradas ${jornadas.length} jornadas y ${equiposSet.size} equipos.`);

  // 2. Extraer Clasificación Oficial
  let clasificacion = [];
  const posiblesUrlsClasif = Array.from(new Set([
    urlClasificacion,
    'https://deportes.aytoburgos.es/deporteson/clasi.php?competi=003018&tipc=&c=0',
    'https://deportes.aytoburgos.es/deporteson/clasif.php?competi=003018&tipc=&c=0',
    'https://deportes.aytoburgos.es/deporteson/clasificacion.php?competi=003018&tipc=&c=0'
  ]));

  for (const urlC of posiblesUrlsClasif) {
    try {
      console.log('2. Intentando descargar clasificación desde:', urlC);
      const clasifHtml = await fetchHtml(urlC);
      const $clasif = cheerio.load(clasifHtml);

      $clasif('table').each((_, tabla) => {
        if (clasificacion.length > 0) return;

        // Detectar índices de columnas leyendo la cabecera (<th> o primera fila)
        const headerCells = $clasif(tabla).find('tr').first().find('th, td');
        const headers = [];
        headerCells.each((idx, el) => {
          headers.push(limpiarTexto($clasif(el).text()).toLowerCase());
        });

        const idxEquipo = headers.findIndex(h => h.includes('equipo') || h.includes('club'));
        const idxPuntos = headers.findIndex(h => h.includes('pt') || h.includes('pun'));
        const idxPJ = headers.findIndex(h => h === 'pj' || h.includes('jug'));
        const idxPG = headers.findIndex(h => h === 'pg' || h.includes('gan'));
        const idxPE = headers.findIndex(h => h === 'pe' || h.includes('emp'));
        const idxPP = headers.findIndex(h => h === 'pp' || h.includes('per'));
        const idxGF = headers.findIndex(h => h === 'gf' || h.includes('favor'));
        const idxGC = headers.findIndex(h => h === 'gc' || h.includes('contra'));
        const idxPos = headers.findIndex(h => h === 'pos' || h === '#' || h.includes('puesto') || h === 'ord');

        const filasTemp = [];
        $clasif(tabla).find('tr').each((rowIdx, fila) => {
          if (rowIdx === 0 && (idxEquipo !== -1 || idxPuntos !== -1)) return;
          const cols = $clasif(fila).find('td');
          if (cols.length < 5) return;

          const valores = [];
          cols.each((__, c) => valores.push(limpiarTexto($clasif(c).text())));

          let equipo = '';
          let puntos = NaN;
          let posicion = filasTemp.length + 1;
          let jugados = 0, ganados = 0, empatados = 0, perdidos = 0, golesFavor = 0, golesContra = 0;

          if (idxEquipo !== -1 && idxPuntos !== -1) {
            equipo = valores[idxEquipo] || '';
            puntos = Number(valores[idxPuntos]);
            if (idxPos !== -1 && !isNaN(Number(valores[idxPos]))) posicion = Number(valores[idxPos]);
            if (idxPJ !== -1) jugados = Number(valores[idxPJ]) || 0;
            if (idxPG !== -1) ganados = Number(valores[idxPG]) || 0;
            if (idxPE !== -1) empatados = Number(valores[idxPE]) || 0;
            if (idxPP !== -1) perdidos = Number(valores[idxPP]) || 0;
            if (idxGF !== -1) golesFavor = Number(valores[idxGF]) || 0;
            if (idxGC !== -1) golesContra = Number(valores[idxGC]) || 0;
          } else {
            // Heurística si no hay cabecera explícita: buscar la columna con texto de nombre de equipo
            const colTextoIdx = valores.findIndex(v => v.length > 2 && isNaN(Number(v)));
            if (colTextoIdx !== -1) {
              equipo = valores[colTextoIdx];
              if (colTextoIdx > 0 && !isNaN(Number(valores[0]))) {
                posicion = Number(valores[0]);
              }
              const nums = valores.slice(colTextoIdx + 1).map(v => Number(v)).filter(n => !isNaN(n));
              if (nums.length >= 7) {
                // Formato típico español: PJ, PG, PE, PP, GF, GC, Puntos (o Puntos primero)
                if (nums[0] <= nums[6] && nums[6] >= nums[1] * 2) {
                  [jugados, ganados, empatados, perdidos, golesFavor, golesContra, puntos] = nums;
                } else {
                  [puntos, jugados, ganados, empatados, perdidos, golesFavor, golesContra] = nums;
                }
              }
            }
          }

          if (equipo && !isNaN(puntos) && !/^equipo$/i.test(equipo)) {
            equiposSet.add(equipo);
            filasTemp.push({
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

        if (filasTemp.length > 0) {
          clasificacion = filasTemp;
        }
      });

      if (clasificacion.length > 0) {
        console.log(`   -> Clasificación oficial extraída (${clasificacion.length} equipos) desde ${urlC}`);
        break;
      }
    } catch (e) {
      console.warn(`   -> No disponible en ${urlC}: ${e.message}`);
    }
  }

  // Respaldo: Si la web oficial aún no publicó la tabla de clasificación, calcularla desde los resultados
  if (clasificacion.length === 0 && equiposSet.size > 0) {
    console.log('   -> Calculando clasificación automáticamente a partir de los resultados jugados...');
    clasificacion = calcularClasificacionDesdeJornadas(jornadas, Array.from(equiposSet));
  }

  const tituloCompeticion = limpiarTexto($res('h2, h3, .titulo').first().text()) ||
    'FS. INFANTIL MASC GRUPO 2 - FÚTBOL-SALA, INFANTIL MASCULINO, SEGUNDA, GRUPO 2 (003018)';

  const salida = {
    ultimaActualizacion: new Date().toISOString(),
    competicion: tituloCompeticion,
    fuenteOficial: URL_RESULTADOS,
    equipos: Array.from(equiposSet).sort((a, b) => a.localeCompare(b, 'es')),
    clasificacion,
    jornadas
  };

  const outputPath = path.join(__dirname, 'public', 'datos.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(salida, null, 2), 'utf-8');
  console.log('¡Archivo public/datos.json generado con éxito!');
}

extraerDatos().catch(err => {
  console.error('Error fatal en scraper.js:', err);
  process.exit(1);
});
