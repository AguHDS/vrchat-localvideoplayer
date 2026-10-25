# VRChat Local Video Player

Play a video file from your own PC inside a VRChat video player.
The app serves the video you pick from your local and publishes it through a
temporary cloudflare quick tunnel. Works with both linux and windows.

**Players must have "Allow untrusted URLs" option enabled**

## How to use

1. Open `vrchat-local-video-player.exe` (windows) or `vrchat-local-video-player-linux` (linux)
2. Pick a video
3. Wait a few seconds until the public URL appears in the console (should be already copied to your clipboard)
4. Put the URL into the world's video player
5. When the movie is over, close the console (the tunnel dies and the URL stops working)

---

## Smartscreen warning

The binary isn't signed, so if Windows shows "Windows protected your PC", click **More info -> Run anyway**, or 
right-click the file -> **Properties -> Unblock**.

---

## Limitations

- Private instances only (public instances need the world owner to allow the domain)
- Quick Tunnels have no uptime guarantee; Cloudflare documents them for testing and development, so a session can be interrupted
- One file at a time
- Quest requires HTTPS (satisfied) and Allow Untrusted URLs enabled on the Android client

---

## Command line options

```
-f, --file <path>     Serve this file (skips the picker)
    --no-picker       Never open the file picker
    --no-tunnel       Local only, no public URL (testing)
-p, --port <number>   Local HTTP port (random by default)
-v, --verbose         Debug logs + raw cloudflared output
-q, --quiet           Only the URL and errors
    --log-file <path> Also write the session log to a file
    --viewers <n>     Expected viewers, used for the bitrate warning (default 3)
    --max-upload-mbps <n>  your upload speed in Mbps, used for the warning (default 60)
-h, --help            Show help
    --version         Show version
```

Examples:

```powershell
vrchat-local-video-player.exe --file "D:\Movies\movie.mp4"
vrchat-local-video-player.exe --file "D:\Movies\movie.mp4" --verbose --log-file run.log
```

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

- The local server binds to `127.0.0.1` only — it is not reachable from your LAN
- Only the selected file is served. Every other path returns `404`
- The URL contains a random 192-bit token, so it cannot be guessed
- Anyone with the URL can watch the video while the app is running, close the app when you're done

---

## Development notes (not necessary)

The repository already contains the two ready-to-use binaries, so you don't need to rebuild, but in case you want:

```powershell
npm install
npm run setup:cloudflared
npm run build:exe or npm run build:exe:linux
```

If you ever want to rebuild the Linux binary (for example, after changing the code), do it in a separate copy you're avoiding breaking windows node_modules:

```bash
source ~/.nvm/nvm.sh && nvm use 22
rsync -a --exclude node_modules --exclude dist --exclude vendor --exclude '*.exe' \
  "/mnt/c/Users/Usuario/Desktop/Ag/Visual Studio Projects/vrchat-localvideoplayer/" \
  ~/vlvp-linux-build/
cd ~/vlvp-linux-build
npm install
npm run setup:cloudflared
npm run build:exe:linux
# copy it again the repo
cp vrchat-local-video-player-linux "/mnt/c/Users/Usuario/Desktop/Ag/Visual Studio Projects/vrchat-localvideoplayer/"