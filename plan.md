# VRChat Local Video Player — Plan de proyecto

> Reproducir un video local de tu PC dentro de un reproductor de video de VRChat
> usando una URL HTTPS pública temporal, sin pagar ningún hosting.

- **Estado**: implementado y verificado (v1.0.0)
- **Stack**: TypeScript + Node.js (sin dependencias de runtime más allá de `commander`)
- **Objetivo principal**: Windows 10/11. Soporte real en Linux (ver `linux-integration.md`).

---

## 1. Objetivo y alcance

### Qué hace

1. El usuario abre `vrchat-local-video-player.exe`.
2. Aparece un selector nativo de archivos (o se pasa `--file "<ruta>"`).
3. La app levanta un servidor HTTP en `127.0.0.1` que sirve **únicamente** ese video
   con soporte de `Range` (búsquedas y reproducción progresiva).
4. Levanta un **Cloudflare Quick Tunnel** y publica una URL HTTPS
   `https://<algo>.trycloudflare.com/v/<token>/video.mp4`.
5. Imprime la URL (y la copia al portapapeles) para pegarla en el reproductor de VRChat.
6. Al cerrar la consola: se corta el servidor, se mata el túnel, se borran los
   temporales y no queda ningún proceso en segundo plano.

### Qué NO hace (fuera de alcance v1)

- No usa la API de VRChat, no pide credenciales, no modifica el cliente.
- No resuelve dominios de la allowlist de VRChat (no se intenta eludir nada).
- No sirve archivos compartidos de una carpeta: solo el archivo elegido.
- No soporta instancias públicas de mundos ajenos (ver limitaciones).

---

## 2. Decisiones tomadas

| Decisión | Valor | Motivo |
|---|---|---|
| Túnel | Cloudflare Quick Tunnel | Gratis, sin cuenta, HTTPS, soporta `Range` |
| Descarga del binario | Release oficial + verificación SHA-256 | Sin instaladores ni PATH |
| Interfaz | Consola + selector nativo | Simple, portable, sin GUI pesada |
| Alcance VRChat | Instancias privadas | Es lo único que funciona con dominios no allowlisted |
| HTTP | `node:http` a mano | Control total de `Range`, sin framework |
| Empaquetado | Node SEA + `postject` | Un solo `.exe`, sin Node instalado |
| Distribución de `cloudflared` | Embebido como asset del SEA | El `.exe` es autocontenido |
| SO | Windows (principal) + Linux (soporte real) | Pedido explícito |
| README | Inglés | Pedido explícito |
| Cierre | Señales + watchdog + `taskkill /T` | "Cerrar la consola = todo cerrado" |

---

## 3. Investigación: qué dice VRChat

Fuentes oficiales (verificadas contra la documentación vigente):

- [Video Players](https://creators.vrchat.com/worlds/udon/video-players/)
- [Video Player Allowlist](https://creators.vrchat.com/worlds/udon/video-players/www-whitelist/)
- [External URLs](https://creators.vrchat.com/worlds/udon/external-urls/)
- [Udon Video Sync Player](https://creators.vrchat.com/worlds/examples/udon-example-scene/udon-video-sync-player/)
- [Terms of Service](https://hello.vrchat.com/legal) · [Community Guidelines](https://www.vrchat.com/community-guidelines) · [Creator Guidelines](https://hello.vrchat.com/creator-guidelines)

### Hallazgos que definen la solución

1. **"Your Own Host" está contemplado oficialmente.** La doc de Video Players lista
   explícitamente usar tu propio host, con enlace directo a `.mp4`/`.webm`, y aclara que
   los usuarios deben activar **Allow Untrusted URLs**.
2. **El dominio no allowlisted funciona con la opción del usuario.** La allowlist dice:
   *"Videos in your world only play if their domain is on the allowlist below, or if the
   viewer has enabled 'Allow Untrusted URLs' in their settings."*
3. **Android/Quest exige HTTPS.** *"VRChat on Android does not play video if the host is
   not using HTTPS."* → el túnel debe ser HTTPS siempre (Cloudflare lo es).
4. **Instancias públicas son más estrictas.** En Public/Group Public, el dominio debe
   estar además en el "Video Player Allowed Domains" del mundo. Como el mundo no es
   nuestro, no se puede agregar → alcance: **instancias privadas**.
5. **Cuidado con el master de la instancia.** La doc advierte que el player de ejemplo
   del SDK no contempla que el master tenga deshabilitado Allow Untrusted URLs →
   **todos** los participantes, incluido el master, deben activarlo.
6. **Límite de frecuencia**: un usuario no puede pedir una nueva URL de video cada menos
   de 5 segundos. Con un solo reproductor no hay problema.
7. **Cualquier mundo no sirve.** Algunos mundos filtran dominios, usan resolvers propios o
   no exponen un input de URL. La documentación oficial garantiza el comportamiento del
   cliente, no el de cada mundo.

### Política y riesgo de ban

- No hay ninguna regla que prohíba servir tu propio archivo por un túnel: es el
  escenario "Your Own Host" de la documentación.
- Lo que sí puede generar un problema: contenido sin derechos, material sensible,
   disruptsión, o ignorar las reglas del mundo/instancia.
- **No hay garantía** de que VRChat no modifique el comportamiento del allowlist.
- Mitigaciones aplicadas: solo instancias privadas, token aleatorio por sesión, un único
  archivo, cierre automático, nada de suplantar dominios allowlisted.

---

## 4. Riesgos técnicos

### Ancho de banda

Cada espectador descarga **su propia copia** desde tu subida (no es multicast).

| Bitrate por video | 2 espectadores | 3 espectadores |
|---:|---:|---:|
| 8 Mbps | 16 Mbps | 24 Mbps |
| 12 Mbps | 36 Mbps | 48 Mbps |
| 15 Mbps | 30 Mbps | 45 Mbps |
| 20 Mbps | 40 Mbps | 60 Mbps |

Con 60,65 Mbps de subida el techo son ~20 Mbps por video con 3 espectadores. Recomendado:
**8–12 Mbps** (1080p) para dejar margen.

### Latencia y geografía

- El video es un archivo, no un live stream: la latencia RTT no se acumula.
- Argentina→EE.UU. ~150–250 ms afecta el arranque y las búsquedas, no el streaming.
- El riesgo real de "ver tarde" es la saturación de la subida, no la distancia.
- Los reproductores sincronizados usan el tiempo del servidor de VRChat para corregir.

### Videos de 1 GB o más

- **Sin impacto en memoria**: se transmite con `fs.createReadStream`, uso constante.
- **Sin límite de tamaño**: los offsets son `Number` (seguros hasta 2^53).
- Lo único que pesa es el tiempo de descarga completa (1 GB @ 12 Mbps ≈ 11,6 min), que
  nadie hace porque el player pide rangos.
- Importante: **`faststart`** (el átomo `moov` antes de `mdat`). La app lo detecta y avisa.

### Cloudflare Quick Tunnel

| Limitación oficial | Impacto |
|---|---|
| Sin garantía de uptime | La sesión puede cortarse |
| 200 requests concurrentes | Con 3 spectators, sobra |
| El hostname cambia en cada arranque | La URL es nueva por sesión |
| Marcado "testing and development" | Cloudflare puede cortarlo |
| Sin SSE | No afecta |

No hay cuota de datos publicada. Se puede abrir/cerrar tantas veces como se quiera: cada
arranque da una URL nueva y las viejas mueren al cerrar. La app detecta la muerte del
túnel, lo informa y corta el servidor para no compartir una URL muerta.

Alternativas descartadas: `ngrok` free tiene 1 GB/mes (insuficiente para 1 GB × 3) y un
tunnel nombrado de Cloudflare exige dominio de pago.

### CGNAT

**No hace falta comprobarlo** con esta arquitectura: el túnel es saliente. Solo sería
relevante para port forwarding con IP pública, que no es el modo usado.

---

## 5. Arquitectura

```text
VRChat (PC / Quest)
      │  HTTPS + Range (Allow Untrusted URLs)
      ▼
Cloudflare Edge  ──►  trycloudflare.com (URL temporal)
      │
      ▼
cloudflared (proceso hijo)
      │  HTTP sobre loopback
      ▼
Servidor Node (127.0.0.1:PUERTO)
      │  fs.createReadStream
      ▼
Un único archivo .mp4 / .webm
```

### Modelo de seguridad

- El servidor escucha **solo** en `127.0.0.1` (inalcanzable desde la LAN).
- Ruta única y aleatoria por sesión: `/v/<token 192 bits>/video.mp4`.
- Todo lo demás responde `404`. No hay listado de directorios ni rutas del sistema.
- `Cache-Control: private, no-store` para que la CDN no guarde el archivo.
- Sin cabeceras de autenticación: el reproductor de VRChat no puede mandarlas. La
  aleatoriedad de la ruta es la única barrera, y por eso hay que compartir la URL solo
  con quien debe verla.

---

## 6. Estructura del proyecto

```text
plan.md                      Este documento
README.md                    Guía de uso (inglés)
linux-integration.md         Guía de Linux
package.json                 Scripts y dependencias
tsconfig.json                TypeScript estricto
eslint.config.js             ESLint plano (ESLint 9)
src/
  cli.ts                     Entry point, flags, señales, watchdog
  app.ts                     Orquestación (archivo → servidor → túnel → URL)
  logger.ts                  Logging con niveles, color y archivo opcional
  errors.ts                  AppError con "hint" accionable
  server/
    http-server.ts           Servidor HTTP con Range
    range.ts                 Parser de Range (RFC 9110)
    session.ts               Token, rutas permitidas, comparación constante
  tunnel/
    cloudflare-quick.ts      Arranque y ciclo de vida del túnel
    parse-tunnel-url.ts      Extracción y validación de la URL
  platform/
    picker.ts                Selector: Windows (PowerShell) / Linux (zenity, kdialog) / prompt
    clipboard.ts             Portapapeles (clip.exe, wl-copy, xclip, xsel)
    process-tree.ts          Matar árboles de procesos (Windows / Linux)
    cloudflared-binary.ts    Resolver/extraer el binario de cloudflared
    sea.ts                   Detección de Single Executable Application
  video/
    validate.ts              Validación del archivo (extensión, tamaño)
    probe.ts                 Detección de faststart en MP4
  lifecycle/
    cleanup.ts               Limpieza idempotente
    watchdog.ts              Watchdog: si muere la app, muere el túnel
  util/format.ts             Formateo de tamaños
tests/                       42 tests (vitest)
scripts/
  cloudflared-version.mjs    Versión + checksums + nombres por plataforma
  setup-cloudflared.mjs      Descarga oficial + verificación SHA-256
  build-exe.mjs              Build SEA (Windows / Linux)
  build-exe-linux.mjs        Wrapper del build para Linux
vendor/                      cloudflared + manifest (gitignored)
dist/                        Build intermedio por SO (gitignored)
vrchat-local-video-player.exe        Entregable Windows (141 MB)
vrchat-local-video-player-linux      Entregable Linux (158 MB)
```

### Reglas de aislamiento entre SO

Los dos builds **nunca se pisan**:

| | Windows | Linux |
|---|---|---|
| Ejecutable | `vrchat-local-video-player.exe` | `vrchat-local-video-player-linux` |
| Bundle | `dist/main.win.cjs` | `dist/main.linux.cjs` |
| Blob SEA | `dist/sea-prep.win.blob` | `dist/sea-prep.linux.blob` |
| Config SEA | `dist/sea-config.win.json` | `dist/sea-config.linux.json` |
| Meta cloudflared | `dist/cloudflared-meta.win.json` | `dist/cloudflared-meta.linux.json` |
| Binario | `vendor/cloudflared.exe` | `vendor/cloudflared` |
| Manifest | `vendor/cloudflared.json` (se regenera por plataforma) | idem |

---

## 7. Fases de implementación (estado)

| Fase | Estado | Notas |
|---|---|---|
| 1. Scaffold + dependencias | ✅ | TypeScript, vitest, ESLint, esbuild, postject |
| 2. Validación de video | ✅ | Extensión, tamaño, detección de faststart |
| 3. Servidor HTTP con Range | ✅ | 200/206/416, HEAD, 404, 405, path traversal bloqueado |
| 4. Túnel Cloudflare | ✅ | Verificado contra la red real (200 + 206) |
| 5. Ciclo de vida y cierre | ✅ | Señales + watchdog (verificado con cierre forzado) |
| 6. Empaquetado Windows | ✅ | SEA + postject, 141 MB, sin Node requerido |
| 7. Pruebas automatizadas | ✅ | 42 tests en verde |
| 8. Validación real en VRChat | ⏳ | Requiere VRChat + Allow Untrusted URLs (guía en README) |
| 9. Build/documentación Linux | ✅ | `linux-integration.md` + binario Linux precompilado |
| 10. Aislamiento de builds por SO | ✅ | Intermedios y meta por plataforma, sin pisarse |
| 11. Estimación de bitrate/duración | ✅ | Parser MP4 (`mvhd`/`stsd`) + `ffprobe` opcional |
| 12. Binario Linux compilado en WSL | ✅ | ELF x64 de 158 MB, verificado E2E desde WSL |
| 13. Traslado del repo a disco local | ⏳ | Guía en `pendiente-hacer-manual.md` |

### Feature: control de bitrate

La app mide el video al arrancar y avisa si tu subida no alcanza:

- **Duración y bitrate**: con `ffprobe` (si está instalado) o parseando el MP4 a mano
  (`moov > mvhd` para la duración, `stsd` para los códecs).
- **Cálculo**: `bitrate × espectadores` vs. tu subida (`--max-upload-mbps`, default 60;
  `--viewers`, default 3).
- **Aviso de códec**: H.264 (`avc1`) y VP8/VP9 son válidos; HEVC (`hvc1`/`hev1`) y AV1
  (`av01`) probablemente no funcionen en los reproductores de VRChat.
- **Comando listo**: cuando falta ancho de banda se imprime el `ffmpeg` exacto para
  recodificar con `-maxrate` calculado a partir de tu subida y la cantidad de gente.

---

## 8. Implementación paso a paso (guía del usuario)

Esta es la secuencia para dejar todo andando desde cero.

### Paso 0 — Requisitos

- Windows 10/11 (o Linux, ver `linux-integration.md`).
- Node.js 22 o superior **solo para compilar** (el `.exe` final no lo necesita).
- ~400 MB libres (Node + dependencias + binario de cloudflared).
- Un archivo `.mp4` o `.webm`.

```powershell
node -v     # debe imprimir v22.x o superior
npm -v
```

### Paso 1 — Instalar dependencias

```powershell
npm install
```

### Paso 2 — Descargar y verificar cloudflared

```powershell
npm run setup:cloudflared
```

Salida esperada:

```text
OK: cloudflared descargado y verificado.
  archivo:   ...\vendor\cloudflared.exe
  versión:   2026.10.3
  sha256:    76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2
```

El script es idempotente: si el archivo ya está y el checksum coincide, no vuelve a
descargar.

### Paso 3 — Prueba local sin internet ni túnel

```powershell
npm run dev -- --file "C:\Videos\pelicula.mp4" --no-tunnel
```

Copia la URL local que imprime y probala:

```powershell
curl.exe -I "http://127.0.0.1:PUERTO/v/TOKEN/video.mp4"
curl.exe -r 0-1023 -o parcial.bin "http://127.0.0.1:PUERTO/v/TOKEN/video.mp4"
```

Esperado: `HTTP/1.1 200 OK`, `Accept-Ranges: bytes`, y el segundo comando devuelve
`206 Partial Content` con 1024 bytes exactos.

### Paso 4 — Checks de calidad

```powershell
npm run lint
npm run typecheck
npm test
```

### Paso 5 — Generar el ejecutable

```powershell
npm run build:exe
```

Debe terminar con:

```text
Listo.
  ejecutable: ...\vrchat-local-video-player.exe
  tamaño:     141.3 MB
  versión:    1.0.0
```

### Paso 6 — Primera ejecución real

1. Doble clic en `vrchat-local-video-player.exe`.
2. Elegí el video en el selector.
3. Esperá a que imprima la URL (5–15 s).
4. La URL queda copiada en el portapapeles.

### Paso 7 — Probar en VRChat

1. Entrá a una instancia **privada** (Invite / Friends / Group).
2. **Todos** los participantes activan `Settings > Allow Untrusted URLs`.
   Incluido el master de la instancia.
3. Pegá la URL en el campo de URL del reproductor de video del mundo.
4. Verificá reproducción, búsqueda y llegada tarde de alguien.

### Paso 8 — Verificar el cierre limpio

Cerrá la consola (o `Ctrl+C`, o escribí `q` + Enter) y comprobá:

```powershell
tasklist | findstr cloudflared
```

Sin resultados = todo cerrado. La URL pública debe devolver error `530` (ya no sirve el
archivo).

### Paso 9 (opcional) — Linux

```bash
npm install
npm run setup:cloudflared
npm run build:exe:linux
./dist/vrchat-local-video-player --file ~/Videos/pelicula.mp4
```

Detalle en `linux-integration.md`.

### Troubleshooting rápido

| Síntoma | Causa | Solución |
|---|---|---|
| 403 en VRChat | Allow Untrusted URLs apagado | Activarlo en cada participante |
| 404 en VRChat | URL vieja o app cerrada | Pegar la URL nueva del último arranque |
| "Error inesperado" en el player | Codec no soportado | Recodificar a H.264/AAC (`.mp4`) |
| Buffering | Subida saturada | Bajar el bitrate a 8–12 Mbps |
| 429 de Cloudflare | >200 requests simultáneos | Cerrar y reabrir la app |
| El túnel no arranca | Proxy/firewall | Reintentar; si el error persiste, revisar salida a internet |
| SmartScreen bloquea el `.exe` | Binario sin firmar | Propiedades → Desbloquear → Ejecutar |
| No aparece el selector | Sin escritorio interactivo | Usar `--file "<ruta>"` |

---

## 9. Verificación realizada

- **Unitario** (42 tests): parser de `Range` (cerrado, abierto, sufijo, inválido,
  multi-rango), servidor HTTP (200/206/416/404/405/HEAD), validación de video y
  faststart, token y rutas, parser de la URL del túnel, formato de tamaños y duración,
  parser de MP4 (`mvhd`/`hdlr`/`stsd`), códecs soportados y muerte de árboles de procesos.
- **Integración real** (contra la red pública, desde Windows **y** desde WSL con el
  binario Linux):
  - Quick Tunnel levanta y entrega URL `https://*.trycloudflare.com`.
  - `HEAD` → `200`, `Content-Type: video/mp4`, `Accept-Ranges: bytes`.
  - `GET` con `Range: bytes=0-1023` → `206` + `Content-Range` correcto.
  - Ruta adivinada → `404`.
- **Ciclo de vida** (verificado en ambos binarios):
  - Cierre con `q` → exit code 0, sin `cloudflared` vivo.
  - `SIGINT` en Linux → proceso terminado, sin `cloudflared` vivo.
  - Cierre forzado (simula la X de la consola) → el watchdog mata el túnel en <2 s.
  - Tras cerrar, la URL pública responde `530` (ya no sirve el archivo).

Pendiente de validación manual: reproducción real dentro de VRChat (requiere el cliente
y la opción activada) y medición de bitrate con 3 espectadores.

---

## 10. Criterios de aceptación

- [x] La app entrega una URL HTTPS pública para un video local.
- [x] La URL soporta `Range` (reproducción progresiva y búsqueda).
- [x] Solo se sirve el archivo seleccionado.
- [x] El `.exe` corre sin Node instalado y trae `cloudflared` incluido.
- [x] Al cerrar la consola no queda ningún proceso en segundo plano.
- [x] Errores visibles en consola con causa y solución.
- [x] 42 tests automatizados en verde, lint y typecheck limpios.
- [x] Build de Linux documentado y binario Linux precompilado en la raíz.
- [x] Los dos binarios conviven en el mismo repo sin pisarse.
- [x] Aviso de bitrate con comando de ffmpeg listo para usar.
- [ ] Verificado dentro de VRChat con Allow Untrusted URLs (requiere el cliente).

---

## 11. Limitaciones conocidas

1. **No es "cualquier mundo".** Depende de que el mundo acepte URLs arbitrarias y de las
   reglas de la instancia.
2. **Instancias públicas** requieren que el dueño del mundo agregue el dominio a su
   allowlist, y con Quick Tunnel el hostname cambia en cada arranque.
3. **Sin SLA.** Cloudflare Quick Tunnel es "testing and development".
4. **La URL es pública para quien la tenga.** El token aleatorio es una barrera, no una
   autorización; no la pegues en lugares públicos.
5. **Quest**: requiere HTTPS (OK) y que el participante tenga Allow Untrusted URLs
   activado en su cliente Android.
6. **Un solo archivo a la vez** por sesión.

---

## 12. Trabajo futuro

- `linux-integration.md`: empaquetado `.deb`/AppImage, entrada `.desktop`, autostart,
  clipboard en Wayland, tunnel nombrado con dominio propio.
- Soporte de playlist / múltiples archivos.
- Transcodificación opcional con ffmpeg (bitrate objetivo por cantidad de espectadores).
- Fingerprinting de clientes para estimar cuántos espectadores hay.
- Tunnel nombrado de Cloudflare (URL estable) como opción avanzada de pago.
