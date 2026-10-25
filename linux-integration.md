# Linux integration

Linux support is **real**, not a future idea: the application code is cross-platform and
the build produces a native Linux executable. This document covers the differences from
Windows and the few optional dependencies.

Windows remains the primary target (the `.exe` is what VRChat users run).

---

## What is different on Linux

| | Windows | Linux |
|---|---|---|
| Executable | `vrchat-local-video-player.exe` (repo root) | `vrchat-local-video-player-linux` (repo root) |
| File picker | Windows Forms via PowerShell | `zenity` → `kdialog` → manual path prompt |
| Clipboard | `clip.exe` | `wl-copy` → `xclip` → `xsel` |
| Killing the tunnel | `taskkill /T /F` | process group `SIGKILL` |
| Cloudflared binary | `vendor/cloudflared.exe` | `vendor/cloudflared` |
| Tunnel URL / VRChat behaviour | identical | identical |

Everything else — the HTTP server, `Range` support, the Quick Tunnel, the random URL
token, the bitrate check, the shutdown watchdog — is the same code.

---

## Just use the prebuilt binary

The repository root already contains `vrchat-local-video-player-linux`: a self-contained
ELF executable with the application and `cloudflared` inside. No Node.js required.

```bash
chmod +x vrchat-local-video-player-linux
./vrchat-local-video-player-linux
```

If you prefer building it yourself, or you want to change something, keep reading.

---

## Requirements

- **Linux x64** (also ARM64: the setup script downloads the matching `cloudflared`).
- **Node.js 22+** — only to build. The produced binary does not need Node.
- Optional: a graphical file picker and a clipboard tool.

```bash
node -v    # v22 or newer
npm -v
```

### Optional packages

```bash
# File picker dialog (recommended)
sudo apt install zenity

# Alternative picker (KDE)
sudo apt install kdialog

# Clipboard (Wayland)
sudo apt install wl-clipboard

# Clipboard (X11)
sudo apt install xclip
```

None of them are mandatory: without a picker the app asks for the path in the terminal,
and without a clipboard tool it just prints the URL.

---

## Build

```bash
git clone <this repo>          # or copy the folder
cd vrchat-localvideoplayer

npm install
npm run setup:cloudflared      # downloads vendor/cloudflared + verifies SHA-256
npm run build:exe:linux        # produces vrchat-local-video-player-linux
```

The Linux build must run **on Linux** (WSL counts). The script refuses to cross-compile
so you always get a binary that matches the local `cloudflared`.

> **Important when the repo is shared with Windows:** running `npm install` inside WSL
> on the same folder replaces the Windows `node_modules` with Linux binaries and breaks
> the Windows build. Build the Linux binary from a copy:
>
> ```bash
> rsync -a --exclude node_modules --exclude dist --exclude vendor \
>   --exclude '*.exe' ../vrchat-localvideoplayer/ ../vlvp-linux-build/
> cd ../vlvp-linux-build && npm install && npm run setup:cloudflared && npm run build:exe:linux
> ```

Optional sanity check before building:

```bash
npm run lint
npm run typecheck
npm test
```

---

## Run

```bash
./vrchat-local-video-player-linux
```

Or with the file already chosen:

```bash
./vrchat-local-video-player-linux --file "$HOME/Videos/movie.mp4"
```

Press `Ctrl+C` (or type `q` and press Enter) to stop everything. Closing the terminal
window also works: a watchdog process kills the tunnel if the main process dies.

If you want a double-clickable launcher, add a desktop entry:

```ini
# ~/.local/share/applications/vrchat-local-video-player.desktop
[Desktop Entry]
Type=Application
Name=VRChat Local Video Player
Exec=/home/YOU/vrchat-localvideoplayer/vrchat-local-video-player-linux
Terminal=true
Categories=Utility;
```

---

## WSL

WSL works, with two caveats:

1. **Build on Linux, run on Linux.** If you want to use the app from inside WSL, build it
   inside WSL (`npm run build:exe:linux`) and run `dist/vrchat-local-video-player`.
2. **The URL is reachable from Windows.** A Quick Tunnel is a public HTTPS endpoint, so
   VRChat running on Windows can play a video served by a process inside WSL, as long as
   WSL has outbound internet access.

Networking note: WSL2 has its own virtual network. Outbound traffic works out of the box,
so the tunnel works; no Windows firewall rule or port forwarding is needed.

---

## Known gaps

- No `.deb`, AppImage or Flatpak package yet (planned).
- The binary is unsigned, so some distributions mark it as "untrusted" until you
  `chmod +x` it.
- The clipboard integration depends on the session type (Wayland vs X11) and may be
  unavailable in a headless shell.
- `zenity` is not installed by default on every distribution; without it the app falls
  back to the terminal prompt.
- There is no graphical UI: the Linux build is a console application, exactly like the
  Windows one.

---

## Roadmap

- `.deb` / AppImage packaging and a `.desktop` entry.
- systemd user service for "keep the tunnel alive while VRChat is running".
- Wayland-native clipboard handling.
- Stable URL through a named Cloudflare Tunnel (requires your own domain).
- Optional hardware-accelerated transcoding to keep the bitrate under control.
