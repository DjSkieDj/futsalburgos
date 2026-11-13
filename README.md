# Web Autoactualizable - FS. Infantil Masculino Grupo 2 (Ayto. Burgos)

Web deportiva moderna y autoactualizable con resultados, clasificación, próximas jornadas y equipos de la competición **FS. Infantil Masculino Grupo 2 (003018)** de `deportes.aytoburgos.es`.

## Archivos incluidos (en la raíz del proyecto)

- `index.html`: Interfaz web completa (compatible directamente con **GitHub Pages**, **Vercel** y **Netlify**). Incluye botón **"Sincronizar ahora"** para actualizar en vivo desde el navegador.
- `datos.json`: Archivo de datos actualizado automáticamente por el robot.
- `scraper.js`: Extractor con triple sistema de descarga (Node `fetch`, `curl` con soporte SSL heredado y proxy de respaldo) y detección inteligente de columnas para jornadas jugadas, jornadas futuras y clasificación.
- `package.json`: Dependencia `cheerio`.
- `.github/workflows/actualizar.yml`: Automatización sin acciones externas (`actions/checkout` eliminado para compatibilidad con restricciones de cuenta). Se ejecuta **cada hora los lunes** y **cada 2 horas el resto de la semana**.

## Instalación rápida en GitHub

1. **Sube los archivos de la raíz** (`index.html`, `datos.json`, `scraper.js`, `package.json`, `vercel.json`, `netlify.toml`, `README.md`) a tu repositorio de GitHub.
2. **Crea el flujo automático en GitHub** (si tu navegador oculta la carpeta `.github` al arrastrar):
   - En tu repositorio pulsa **Add file > Create new file**.
   - Escribe como nombre `.github/workflows/actualizar.yml`.
   - Copia y pega el contenido de `.github/workflows/actualizar.yml` de este ZIP y pulsa **Commit changes**.
3. **Activa permisos de escritura**:
   - Ve a **Settings > Actions > General** > *Workflow permissions* -> marca **Read and write permissions** y pulsa **Save**.
4. **Publica la web (GitHub Pages o Vercel)**:
   - En GitHub ve a **Settings > Pages**, selecciona la rama `main` y carpeta `/ (root)` y pulsa **Save**.
