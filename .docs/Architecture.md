This project uses alayered modular monolith with functional dependency injection at the few points where it pays off.

---

## Shape of code (file structure may be outdated)

```
src/
  cli.ts - Entry point: argument parsing, signals, stdin commands
  commands.ts - Pure: text -> command
  app.ts - Application layer: orchestrates the whole session
  logger.ts - Cross-cutting: leveled logging
  errors.ts - Cross-cutting: AppError with an optional hint

  lifecycle/ - Cross-cutting: process lifetime
    cleanup.ts - Ordered, idempotent teardown
    watchdog.ts - Detached helper that kills the tunnel if the app dies
    temp-files.ts - Registry of temporary folders + orphan sweeping

  platform/ - Adapters to the operating system
    picker.ts - Native file dialog (PowerShell/WinForms, zenity, kdialog)
    clipboard.ts - clip.exe / wl-copy / xclip / xsel
    cloudflared-binary.ts - Extracts the embedded cloudflared, or finds vendor/
    process-tree.ts - Kill a process and its children
    sea.ts - Detects Single Executable Application mode

  server/ - local HTTP server
    http-server.ts - node:http, Range support, one route per generation
    range.ts - Pure: Range header parsing
    session.ts - Tokens, path format, session registry

  tunnel/ - Cloudflare integration
    cloudflare-quick.ts - Spawns cloudflared, extracts the public URL
    parse-tunnel-url.ts - Pure: extract and validate the tunnel URL

  video/ - The domain of this app
    playlist-manager.ts - The list of selected videos and its generations
    playlist.ts - FFmpeg: build one normalized MP4 out of several videos
    probe.ts - FFprobe / MP4 parsing: duration, codecs, faststart
    validate.ts - Validation of a video file

  util/format.ts - Pure: bytes and duration formatting
```

## Layering rule to follow: 

- **Pure / domain modules**: files like `commands.ts`, `range.ts`, `parse-tunnel-url.ts`, `format.ts`, `playlist-manager.ts`, `session.ts` know nothing about the operating system. They take data and return data. They are trivially unit tested.
- **Adapters**: files like `platform/*`, `server/http-server.ts`, `tunnel/*`, `video/probe.ts`, `video/playlist.ts` are the only modules that touch the OS: spawning processes, opening sockets, reading files.
- **`app.ts` is the only module that knows the complete flow.** It's a composition root: it creates the logger, the playlist manager, the HTTP server and the tunnel, and decides the order in which things happen and the order in which they are torn down.
- **`cli.ts` doesn't contains business logic.** It parses arguments, translates console input into commands and translates signals into "stop". It does not know what a playlist is.

This is a property of hexagonal architecture, and it's used here. What is missing is only the formal boundary (interfaces implemented by adapters and injected into use cases).

## How testability is achieved without ports

Instead of defining interfaces, the project uses function-level injection, which is cheaper when there is only one implementation:

Tests that need real behaviour (HTTP, files) use the real adapters with temporary folders. Tests that need to avoid FFmpeg use the injected builder.

### The rule of thumb used here

Introduce a port when a second implementation is plausible, not when a layer diagram says so.

---

## The concepts worth knowing

- **Generation.** Every time the user selects a new list of videos, a generation is created: a new token, a new file so therefore a new URL. The previous generations stay alive so the viewers that are already connected are not interrupted. `SessionRegistry` holds all of them and the HTTP server matches the request path against every one of them.

- **CleanupManager.** Tasks are registered in creation order and executed in reverse, so the tunnel is killed before the server is closed and the server is closed before the files are deleted. It's idempotent and never throws.

- **Temporary file registry.** Every temporary folder stores the PID of its owner in a `.owner-pid` file. On startup the app sweeps the temporary folder and deletes the folders whose owner is gone, so a crash does not leave the disk full.