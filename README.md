# Liga FS Infantil · Burgos (Grupo 2)

Web con partidos, resultados y clasificación de la liga **FS Infantil Masculino · Segunda · Grupo 2** (competición `003018`).
Un workflow de GitHub Actions lee **cada hora** la web del Ayuntamiento de Burgos y publica la web en GitHub Pages.

```
.github/workflows/scrape.yml   cron horario: tests → scraping → commit si hay cambios → despliegue en Pages
scripts/scrape.js              descarga resul.php, deporte.php y clasificacion.php y escribe docs/data.json
scripts/parse.js               único archivo que depende del HTML del Ayuntamiento
tests/parse.test.js            tests del lector
docs/                          la web (index.html, PWA) + data.json (los datos)
```

## Puesta en marcha (una sola vez)

1. Crea un repositorio en GitHub (**público**, para usar Pages gratis) y sube este contenido:
   ```bash
   git init -b main && git add . && git commit -m "Liga FS Burgos"
   git remote add origin https://github.com/USUARIO/REPO.git && git push -u origin main
   ```
2. **Settings → Pages → Build and deployment → Source: _GitHub Actions_**.
3. **Actions → "Actualizar liga y publicar web" → Run workflow** (primera ejecución manual).
4. La web queda en `https://USUARIO.github.io/REPO/` y se redespliega cada hora.

Si el commit automático falla por permisos: **Settings → Actions → General → Workflow permissions → Read and write**.

## Cómo funciona
- `data.json` solo se guarda en el repo cuando cambian los datos (no hay 24 commits al día). Su campo `updatedAt` es la fecha del último cambio.
- `status.json` (no versionado) se genera en cada ejecución e indica cuándo se comprobó por última vez; la web lo muestra como «Comprobado a las HH:MM».
- Si la web del Ayuntamiento falla o cambia de formato, el scraper termina con error: **no se despliega nada y se conserva la última versión buena**. GitHub te avisa por correo del workflow fallido.
- La clasificación se lee de la web oficial si se encuentra la tabla; si no, se **calcula con los resultados** (3-1-0) y la web lo indica.

## Local
```bash
npm test                 # tests del lector
npm run scrape           # actualiza docs/data.json (Node 18+, sin dependencias)
npm run serve            # http://localhost:3000
```
Otra competición: variables `COMPETI` y `TIPC` (por defecto `003018` y `2`).

## Avisos
- GitHub puede retrasar el cron unos minutos. En repos sin actividad durante 60 días, GitHub desactiva los workflows programados (se reactivan en la pestaña Actions).
- Solo se hacen 3 peticiones por hora a la web municipal, con un `User-Agent` identificable.
