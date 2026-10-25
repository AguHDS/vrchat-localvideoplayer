# VRChat Local Video Player

Play videos from your local PC inside a VRChat video player. The app serves the video from your local and publishes it through a
temporary cloudflare tunnel. No account or domain required.

Streaming performance depends on your upload speed. The required upload bandwidth increases with the number of viewers and the video's bitrate. Streaming to a few players works fine, but it may depend on the video's bitrate.

**Players must have "Allow untrusted URLs" option enabled**

## Download

- **Windows:** [`vrchat-local-video-player.exe`](https://github.com/AguHDS/vrchat-localvideoplayer/releases/download/v1.0.1/vrchat-local-video-player.exe)
- **Linux:** [`vrchat-local-video-player-linux`](https://github.com/AguHDS/vrchat-localvideoplayer/releases/download/v1.0.1/vrchat-local-video-player-linux)

## How to use

1. Pick a video
2. Wait a few seconds until the public URL appears in the console (should be already copied to your clipboard)
3. Put the URL into the world's video player
4. When the movie is over, close the console (tunnel dies and the URL stops working)

---

## Smartscreen warning

The binary isn't signed, so if Windows shows "Windows protected your PC", click **More info and Run anyway**, or 
right-click the file -> **Properties -> Unblock**.

---

## Limitations

- Private instances only (public instances need the world owner to allow the domain)
- Quick Tunnels have no uptime guarantee; Cloudflare documents them for testing and development, so a session can be interrupted
- One file at a time
- Quest requires HTTPS (satisfied) and Allow Untrusted URLs enabled on the Android client

---

## Performance

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

---

## Security

- The local server binds to `127.0.0.1` only, not reachable from your LAN
- Only the selected file is served. Every other path returns `404`
- Anyone with the URL can watch the video while the app is running, close the app when you're done

---

