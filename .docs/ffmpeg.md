# Installation for ffmpeg (required for playlist)

You need ffmpeg to select multiple videos at the same time (playlist). Playlists are normalized to one seekable MP4 using H.264 video, AAC stereo audio, 30 FPS and faststart. The temporary file is deleted when the application exits. Mixed MP4/WebM files, resolutions and videos without audio are supported.

Install FFmpeg on Windows with:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Install FFmpeg in Ubuntu/WSL2 with:

```bash
sudo apt update && sudo apt install -y ffmpeg
```

Restart the terminal after installing it so the new `PATH` is loaded.
