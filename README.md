# Liga FS Infantil · Burgos (Grupo 2)

Web moderna (PWA) con partidos, resultados y clasificación. Al abrirla, pide `/api/data`, que lee en ese momento
`resul.php` y `deporte.php` de deportes.aytoburgos.es (competición 003018) y devuelve JSON.

## Ejecutar en local
    node server.js        # http://localhost:3000   (Node 18+, sin dependencias)

## Publicar
- **Vercel**: importa la carpeta; `public/` se sirve como web y `api/data.js` como función. Sin configuración extra.
- Otra competición: variables de entorno `COMPETI` y `TIPC` (por defecto 003018 y 2).

## Notas
- Caché de 5 min en servidor (y 60 s en CDN) para no sobrecargar la web municipal.
- La clasificación se lee de la web oficial si se encuentra la tabla; si no, se calcula con los resultados (3-1-0).
- Si el origen falla, se muestran los últimos datos guardados (`data/snapshot.json`).
- `lib/parse.js` es el único archivo que depende del HTML original.
