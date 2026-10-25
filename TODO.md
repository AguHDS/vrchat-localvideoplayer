**6.3 — Prueba local sin internet**

```powershell
.\vrchat-local-video-player.exe --file "C:\Videos\pelicula.mp4" --no-tunnel
```

Copiá la URL local que imprime y probala en otra terminal:

```powershell
curl.exe -I "http://127.0.0.1:PUERTO/v/TOKEN/video.mp4"
curl.exe -r 0-1023 -o parcial.bin "http://127.0.0.1:PUERTO/v/TOKEN/video.mp4"
```

Esperado: `HTTP/1.1 200 OK`, `Accept-Ranges: bytes` y el segundo comando devuelve
`206 Partial Content` con 1024 bytes.

Cerrá la app con `Ctrl+C` o con `q` + Enter.

**6.4 — Prueba real con túnel**

```powershell
.\vrchat-local-video-player.exe --file "C:\Videos\pelicula.mp4"
```

Esperá la URL pública (5–15 s) y abrila el link en el navegador: tiene que reproducir el
video. Después cerrá la consola y verificá que la URL ya no sirve nada.

---

## Paso 7 (opcional) — Probar el binario de Linux

El binario de Linux ya viene compilado en la raíz del repo. Para probarlo desde WSL:

```bash
cd /mnt/c/Users/Usuario/Desktop/Ag\ Studio\ Projects/vrchat-localvideoplayer
chmod +x vrchat-local-video-player-linux
./vrchat-local-video-player-linux --version
```

> `chmod` sobre un archivo en `/mnt/c` funciona, pero el permiso de ejecución puede
> quedar en "no". Si te dice "Permission denied", copiá el binario a tu home de WSL:
>
> ```bash
> cp vrchat-local-video-player-linux ~/
> chmod +x ~/vrchat-local-video-player-linux
> ~/vrchat-local-video-player-linux --version
> ```

