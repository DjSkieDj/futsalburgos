const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Evita fallos por certificados SSL intermedios incompletos en webs municipales
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const URL_RESULTADOS = 'https://deportes.aytoburgos.es/deporteson/resul.php?competi=003018&tipc=&c=0';
const URL_CLASIFICACION_BASE = 'https://deportes.aytoburgos.es/deporteson/clasi.php?competi=003018&tipc=&c=0';

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
  let actual = $(tabla);
  for (let nivel = 0; nivel < 4; nivel++) {
    let prev = actual.prev();
    while (prev.length) {
      const txt = limpiarTexto(prev.text());
      if (txt && /jornada\s*\d+/i.test(txt) && txt.length < 60) {
        return txt;
      }
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
  console.log('1. Descargando resultados desde:', URL_RESULTADOS);
  const resHtml = await fetchHtml(URL_RESULTADOS);
  const $res = cheerio.load(resHtml);

  // Detectar enlace real al botón de Clasificación
  let urlClasificacion = URL_CLASIFICACION_BASE;
  $res('a, button, input').each((_, el) => {
    const texto = limpiarTexto($res(el).text() \vert{}\vert{}$res(el).attr('value'));
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

  $res('table').each((i, tabla) => {
    const tituloJornada = buscarTituloJornada($res, tabla, i + 1);
    const partidos = [];

    $res(tabla).find('tr').each((_, fila) => {
      const celdas = $res(fila).find('td');
      if (celdas.length === 0) return;

      // CASO 1: Partido jugado (7 columnas: Local | GL | GV | Visitante | Fecha | Lugar | Acta)
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
      // CASO 2: Jornada futura sin columnas de goles (5 columnas: Local | Visitante | Fecha | Lugar | Acta)
      else if (celdas.length === 5 || celdas.length === 4) {
        const local = limpiarTexto($res(celdas[0]).text());
        const visitante = limpiarTexto($res(celdas[1]).text());
        const fecha = limpiarTexto($res(celdas[2]).text());
        const lugar = limpiarTexto($res(celdas[3]).text());
        const actaHref = celdas.length === 5 ? ($res(celdas[4]).find('a').attr('href') || null) : null;

        if (local && visitante && !/^local$/i.test(local)) {
          equiposSet.add(local);
          equiposSet.add(visitante);

          partidos.push({
            local,
            golesLocal: null,
            golesVisitante: null,
            visitante,
            fecha,
            lugar,
            acta: actaHref ? new URL(actaHref, URL_RESULTADOS).href : null
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

  console.log(`   -> ${jornadas.length} jornadas extraídas. Equipos detectados:`, Array.from(equiposSet));

  // 2. Extraer Clasificación Oficial comprobando qué tabla contiene realmente a los equipos de la liga
  let clasificacion = [];
  const posiblesUrlsClasif = Array.from(new Set([
    urlClasificacion,
    'https://deportes.aytoburgos.es/deporteson/clasi.php?competi=003018&tipc=&c=0',
    'https://deportes.aytoburgos.es/deporteson/clasif.php?competi=003018&tipc=&c=0',
    'https://deportes.aytoburgos.es/deporteson/clasificacion.php?competi=003018&tipc=&c=0'
  ]));

  for (const urlC of posiblesUrlsClasif) {
    try {
      console.log('2. Probando clasificación en:', urlC);
      const clasifHtml = await fetchHtml(urlC);
      const $clasif = cheerio.load(clasifHtml);

      $clasif('table').each((_, tabla) => {
        if (clasificacion.length > 0) return;

        const textoTabla = limpiarTexto($clasif(tabla).text()).toUpperCase();
        // Verificar que la tabla contiene al menos un equipo real de esta competición
        const contieneEquipoReal = Array.from(equiposSet).some(eq => textoTabla.includes(eq.toUpperCase()));
        if (!contieneEquipoReal) return;

        const filasTemp = [];
        $clasif(tabla).find('tr').each((__, fila) => {
          const cols = $clasif(fila).find('td');
          if (cols.length < 5) return;

          const valores = [];
          cols.each((___, c) => valores.push(limpiarTexto($clasif(c).text())));

          const colEquipoIdx = valores.findIndex(v =>
            Array.from(equiposSet).some(eq => eq.toUpperCase() === v.toUpperCase()) ||
            (v.length > 3 && isNaN(Number(v)) && !/^equipo$/i.test(v))
          );

          if (colEquipoIdx !== -1) {
            const equipo = valores[colEquipoIdx];
            const posicion = (colEquipoIdx > 0 && !isNaN(Number(valores[0])))
              ? Number(valores[0])
              : filasTemp.length + 1;

            const nums = valores.slice(colEquipoIdx + 1).map(v => Number(v)).filter(n => !isNaN(n));
            if (nums.length >= 7) {
              let puntos, jugados, ganados, empatados, perdidos, golesFavor, golesContra;
              // En Ayuntamiento de Burgos suele ser: Puntos, PJ, PG, PE, PP, GF, GC (o PJ...Puntos)
              if (nums[0] >= nums[1] && nums[1] === nums[2] + nums[3] + nums[4]) {
                [puntos, jugados, ganados, empatados, perdidos, golesFavor, golesContra] = nums;
              } else {
                [jugados, ganados, empatados, perdidos, golesFavor, golesContra, puntos] = nums;
              }

              filasTemp.push({
                posicion,
                equipo,
                puntos: puntos ?? 0,
                jugados: jugados ?? 0,
                ganados: ganados ?? 0,
                empatados: empatados ?? 0,
                perdidos: perdidos ?? 0,
                golesFavor: golesFavor ?? 0,
                golesContra: golesContra ?? 0
              });
            }
          }
        });

        if (filasTemp.length > 0) {
          clasificacion = filasTemp;
        }
      });

      if (clasificacion.length > 0) {
        console.log(`   -> Clasificación oficial obtenida (${clasificacion.length} equipos) desde ${urlC}`);
        break;
      }
    } catch (e) {
      console.warn(`   -> Fallo en ${urlC}: ${e.message}`);
    }
  }

  // Respaldo: Si la web oficial no devuelve tabla de clasificación, calcularla desde los partidos
  if (clasificacion.length === 0 && equiposSet.size > 0) {
    console.log('   -> Calculando clasificación automáticamente desde los resultados...');
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

  // Guardar en public/datos.json (para Vercel/Netlify)
  const outputPublic = path.join(__dirname, 'public', 'datos.json');
  fs.mkdirSync(path.dirname(outputPublic), { recursive: true });
  fs.writeFileSync(outputPublic, JSON.stringify(salida, null, 2), 'utf-8');

  // Si existe index.html en la raíz (GitHub Pages), guardar también datos.json en la raíz
  if (fs.existsSync(path.join(__dirname, 'index.html'))) {
    fs.writeFileSync(path.join(__dirname, 'datos.json'), JSON.stringify
