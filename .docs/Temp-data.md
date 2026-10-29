# Temporary data

The app writes temporary data only in the operating system temporary folder. Nothing is written inside the repository or next to the executable.

## Where the temporary files live

Windows: `W+R, type %TEMP%` (`C:\Users\<user>\AppData\Local\Temp`)
Linux & WSL2: `/tmp` - `/tmp/vrchat-local-video-player-7nFUA0`

## Cleanup rules

- Closing the application normally removes both folders
- If the process is killed or the machine loses power, the folder can survive. Every temporary folder stores the PID of
  the process that created it in a `.owner-pid` file
- On the next start the application scans the temporary folder and deletes every folder whose owner process no longer
  exists, so leftovers do not accumulate
- Folders without an owner marker are only removed when they are more than one hour old, to avoid touching a folder that
  belongs to an older version of the app that is still running

## Disk usage

- The cloudflared folder is about 54 MB and exists only while the application runs
- The playlist folder is about as large as the generated MP4 (usually smaller than the sum of the source videos)
- Selecting a new playlist while the app is running rebuilds it: a new playlist folder is created and the previous one is kept alive so its URL keeps working. Every folder (old and new) is deleted when the application closes
- Everything is removed when the application closes, so the temporary folder does not fill up over time
