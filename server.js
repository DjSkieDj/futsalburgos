const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'competition.json');
const SOURCE_URL = process.env.SOURCE_URL || 'https://deportes.aytoburgos.es/deporteson/deporte.php?competi=003018&tipc=&c=0';
const INTERVAL_MINUTES = Math.max(5, Number(process.env.SYNC_INTERVAL_MINUTES || 60));
const PORT = Number(process.env.PORT || 3000);
const empty = () => ({ competition: { code:'003018', name:'Fútbol-Sala Infantil Masculino · Segunda · Grupo 2', location:'Burgos' }, sourceUrl:SOURCE_URL, lastAttempt:null, lastSuccess:null, lastError:null, lastChange:null, status:'pending', results:[], standings:[], fixtures:[], teams:[], stats:[], sourceSections:[], hash:null });
let state = empty();
try { state = { ...state, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch {}
let syncing = false;

function decode(s='') { return s.replace(/<br\s*\/?\s*>/gi,' · ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/\s+/g,' ').trim(); }
function parseTables(html) {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(([,body]) => {
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([,r]) => [...r.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([,c])=>decode(c))).filter(r=>r.length);
    return rows;
  }).filter(t=>t.length);
}
function classifyTables(tables) {
  const out = {results:[],standings:[],fixtures:[],teams:[],stats:[],sourceSections:[]};
  const signatures = new Set();
  for (const rows of tables) {
    const all = rows.flat().join(' ').toLocaleLowerCase('es');
    const headers = rows.slice(0,3).flat().join(' ').toLocaleLowerCase('es');
    let section = null;
    if (/clasific|posici|puntos/.test(all) && /equipo|jugad/.test(all)) section='standings';
    else if (/resultado|marcador/.test(all) && /jornada|fecha|equipo/.test(all)) section='results';
    else if (/calendario|próxim|proxim|jornada/.test(all) && /fecha|equipo|hora/.test(all)) section='fixtures';
    if (!section) continue;
    const dataRows = rows.filter(r=>r.length>=2 && !r.join(' ').toLocaleLowerCase('es').includes('equipo local equipo visitante'));
    const fingerprint = section+':'+dataRows.map(r=>r.join('|')).join(';'); if (signatures.has(fingerprint)) continue; signatures.add(fingerprint);
    const isHeader = r => /equipo|jugad|puntos|fecha|jornada|clasific|resultado|local|visitante/.test(r.join(' ').toLocaleLowerCase('es')) && !/\d+\s*[-–:]\s*\d+/.test(r.join(' '));
    const cleanRows = dataRows.filter(r=>!isHeader(r));
    if (section==='standings') out.standings.push(...cleanRows.map(r=>({raw:r,team:r.find(c=>/[a-záéíóúñ]/i.test(c))||r[0]})));
    if (section==='results') out.results.push(...cleanRows.map(r=>({raw:r})));
    if (section==='fixtures') out.fixtures.push(...cleanRows.map(r=>({raw:r})));
  }
  const names = new Set([...out.standings.map(x=>x.team)]);
  for (const row of [...out.results,...out.fixtures]) for (const cell of row.raw) if (/^[\p{L}\d][\p{L}\d .,'’()/-]{3,}$/u.test(cell) && !/jornada|fecha|resultado|clasificación/i.test(cell)) names.add(cell);
  out.teams=[...names].map(name=>({name}));
  out.stats = out.standings.length ? [{label:'Equipos con clasificación',value:String(out.standings.length)}] : [];
  return out;
}
function save() { fs.mkdirSync(DATA_DIR,{recursive:true}); fs.writeFileSync(DATA_FILE,JSON.stringify(state,null,2)); }
async function sync() {
  if (syncing) return {ok:false,error:'Ya hay una sincronización en curso.'};
  syncing=true; state.lastAttempt=new Date().toISOString();
  try {
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),20000);
    let response; try { response=await fetch(SOURCE_URL,{signal:controller.signal,headers:{'User-Agent':'BurgosFutsalPWA/1.0 (+public sports schedule viewer)','Accept':'text/html,application/xhtml+xml'}}); } finally { clearTimeout(timer); }
    if(!response.ok) throw new Error(`La fuente respondió HTTP ${response.status}.`);
    const html=await response.text();
    if(!/<html|<table/i.test(html)) throw new Error('La fuente no devolvió HTML con estructura reconocible.');
    const parsed=classifyTables(parseTables(html));
    const sections=[['results',parsed.results],['standings',parsed.standings],['fixtures',parsed.fixtures]];
    const found=sections.filter(([,x])=>x.length).map(([x])=>x);
    if(!found.length) throw new Error('Se obtuvo la página, pero no se reconocieron tablas de resultados, clasificación ni calendario. La estructura requiere adaptar el extractor.');
    const nextHash=crypto.createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
    const changed=state.hash!==nextHash; Object.assign(state,parsed,{hash:nextHash,status:'ok',lastSuccess:new Date().toISOString(),lastError:null,sourceSections:found});
    if(changed) state.lastChange=state.lastSuccess;
    save(); return {ok:true,changed,sections:found};
  } catch(e) {
    state.status='error'; state.lastError=`${e.name==='AbortError'?'Tiempo de espera agotado':e.message}`; save(); return {ok:false,error:state.lastError};
  } finally { syncing=false; }
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/data'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(state));}
  if(url.pathname==='/api/sync'&&req.method==='POST'){const result=await sync();res.writeHead(result.ok?200:502,{'Content-Type':'application/json'});return res.end(JSON.stringify(result));}
  let file=path.join(ROOT,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,''));
  if(!file.startsWith(ROOT)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404);return res.end('No encontrado');}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);});
}).listen(PORT,()=>console.log(`Burgos Futsal PWA: http://localhost:${PORT}`));
setTimeout(()=>sync(),1500); setInterval(()=>sync(),INTERVAL_MINUTES*60000);
