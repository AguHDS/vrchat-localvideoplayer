# VRChat Local Video Player

Play videos from your local PC inside a VRChat video player and watch them with other people. The app serves videos from your local PC and publishes it through a cloudflare tunnel. 

When selecting multiple videos, they are processed as a playlist within a single temporary video. For playlist to work, you need to have installed `ffmpeg` and `ffprobe` in `PATH`. The console will guide you through the installation if you don't have it.

**Notes:**
- The video/playlist may take a while to load the first time if it's too long
- Players must have "Allow untrusted URLs" option enabled
- No cloudflare account or domain is required

## Download

- **Windows:** [`vrchat-local-video-player.exe`](https://github.com/AguHDS/vrchat-localvideoplayer/releases/download/v1.2.0/vrchat-local-video-player.exe)
- **Linux:** [`vrchat-local-video-player-linux`](https://github.com/AguHDS/vrchat-localvideoplayer/releases/download/v1.2.0/vrchat-local-video-player-linux)

## How to use

1. Pick a video, or select several videos to play them consecutively as one playlist (for a playlist, wait while FFmpeg prepares one combined MP4)
2. Wait a few seconds until the public URL for VRChat appears in the console (normally it will be copied to your clipboard)
3. Put the URL into the right world's video player input

When you're done streaming, close the console. The tunnel dies and the URL stops working.

---

## Smartscreen warning

The binary isn't signed, so if Windows shows "Windows protected your PC", click **More info and Run anyway**, or 
right-click the file -> **Properties -> Unblock**.

---

## Limitations

- Private instances only (public instances need the world owner to allow the domain)
- Quick Tunnels have no uptime guarantee; Cloudflare documents them for testing and development, so a session can be interrupted
- Playlists require FFmpeg and temporarily use disk space while preparing the combined MP4 (releases used space once the app is closed)

---

## Performance

Streaming performance depends on your upload speed. The required upload bandwidth increases with the number of viewers and the video's bitrate. Streaming to a few players works fine, but it may depend on the video's bitrate.

Every viewer downloads their own copy from your upload, so the required bandwidth is `viewers × video bitrate`.
With a 60 Mbps upload, three viewers are fine at 8–12 Mbps per video (1080p). 4K at high bitrate isn't.

**Use fast start.** If the MP4 index (`moov`) is stored at the end of the file, players have to download the tail before they can 
start or seek. The app detects this and warns you. Fix it without re-encoding, do this:

```bash
ffmpeg -i input.mp4 -c copy -movflags +faststart output.mp4
```

**If you need to lower the bitrate**, re-encode with a cap (the app prints a ready to
paste command with the right numbers for your upload speed and viewer count):

```bash
ffmpeg -i input.mp4 -c:v libx264 -preset slow -crf 22 -maxrate 10M -bufsize 20M \
  -c:a aac -b:a 128k -movflags +faststart output.mp4
```

File size does not matter: videos are streamed, never loaded into memory.

**Playlists** are normalized to one seekable MP4 using H.264 video, AAC stereo audio, 30 FPS and faststart. The temporary file is deleted when the application exits. Mixed MP4/WebM files, resolutions and videos without audio are supported.

Install FFmpeg on Windows with:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Install FFmpeg in Ubuntu/WSL2 with:

```bash
sudo apt update && sudo apt install -y ffmpeg
```

Restart the terminal after installing it so the new `PATH` is loaded.

---

## Security

- The local server binds to `127.0.0.1` only, not reachable from your LAN
- Only the selected file or prepared playlist is served. Every other path returns `404`
- Anyone with the URL can watch the video while the app is running, close the app when you're done