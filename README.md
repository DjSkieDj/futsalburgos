# Futsal Burgos · competición 003018

PWA instalable y adaptable a móvil para la competición municipal Fútbol-Sala Infantil Masculino, Segunda, Grupo 2. La interfaz no incluye datos deportivos fabricados. Los datos persistidos se extraen de la página municipal configurada.

## Fuente e integración

Fuente configurada: <https://deportes.aytoburgos.es/deporteson/deporte.php?competi=003018&tipc=&c=0>.

El servidor solicita HTML y extrae tablas de la página usando sus encabezados/contenido para identificar resultados, clasificación y calendario. Solo presenta secciones que logra reconocer; si el HTML cambia, la conexión falla o no hay tablas reconocibles, guarda el error, conserva la última captura válida y lo muestra en la web. Los equipos se derivan de filas oficiales de clasificación, resultados y calendario. Las estadísticas se limitan a un recuento derivado, porque no se confirmó que la fuente publique estadísticas individuales.

**Limitación comprobada durante el desarrollo:** no fue posible recuperar el HTML de la fuente en esta sesión: el lector web indicó que la URL no era accesible y la solicitud desde el entorno falló en la negociación TLS. La pestaña municipal visible en Chrome mostró el título “Web de Deportes” y una ruta `resul.php`, pero sus datos no pudieron leerse por un fallo de la interfaz de inspección. Por ello no hay resultados reales verificados todavía y el extractor queda preparado para reconocer las tablas al desplegarse. No se simuló contenido.

## Ejecutar

Requiere Node.js 20 o posterior; no requiere paquetes externos.

```sh
npm start
```

Abrir `http://localhost:3000`. El servidor sincroniza al iniciar y luego cada 60 minutos. El botón **Actualizar** fuerza una sincronización. El endpoint `POST /api/sync` también la fuerza; `GET /api/data` devuelve el estado actual.

## Variables

| Variable | Predeterminado | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `SOURCE_URL` | URL oficial arriba | Página oficial a consultar |
| `SYNC_INTERVAL_MINUTES` | `60` (mínimo 5) | Frecuencia de sincronización |
| `DATA_DIR` | `./data` | Carpeta persistente para `competition.json` |

El almacenamiento es un JSON en disco; el hosting debe ofrecer volumen persistente para conservar la última sincronización. El servicio necesita permitir conexiones HTTPS salientes al dominio municipal.

## Publicación en Internet

1. Un adulto titular crea una cuenta de hosting y, si quiere una dirección propia, compra/configura el dominio. No se necesitan credenciales dentro de este proyecto.
2. Publicar este directorio en un hosting que ejecute Node.js (20+) y permita almacenamiento persistente y tarea de larga duración. Configurar `npm start`, `PORT` según el proveedor y un volumen para `DATA_DIR`.
3. Añadir el dominio en el panel del hosting, apuntar sus registros DNS según las instrucciones del proveedor y activar HTTPS.
4. Revisar `/api/data` y la página de inicio después del primer intento. Resolver el error de fuente, si aparece, antes de anunciar que la sincronización automática está operativa.

Como alternativa, un adulto puede desplegarlo en un VPS con Node.js y proxy HTTPS. Los proveedores gratuitos que duermen servicios o borran el disco local no garantizan las actualizaciones ni conservan los datos. No se ha creado una cuenta, comprado un dominio ni publicado la aplicación desde este proyecto.

La identidad visual es independiente; antes de publicarla conviene comprobar las condiciones de reutilización de datos de la competición con el Ayuntamiento.
