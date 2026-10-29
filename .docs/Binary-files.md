# Binary files compilation

If you do changes to the code, follow this doc to rebuild.

### Compile Windows binary (using windows)

- npm run setup:cloudflared (in case you need it)
- npm run lint
- npm run typecheck
- npm run build:exe

### Recompile Linux binary (using windows)

This procedure is for rebuilding the Linux executable from Windows using Ubuntu on WSL2.
It builds in a separate copy to avoid conflicts between Windows and Linux node_modules.
The generated executable is copied back to the project folder on Windows.
For native Linux users, a different procedure is required, without WINDOWS_PROJECT.}

Must use Ubuntu/WSL2. Use this:
```bash
set -e

source ~/.nvm/nvm.sh
nvm use 24

WINDOWS_PROJECT="/mnt/c/Users/Usuario/Desktop/Ag/Visual Studio Projects/vrchat-localvideoplayer"
LINUX_BUILD="$HOME/projects/vlvp-linux-build-playlist"

test -f "$WINDOWS_PROJECT/package.json"
test -d "$HOME/projects"

mkdir -p "$LINUX_BUILD"

rsync -a \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='vendor' \
  --exclude='*.exe' \
  "$WINDOWS_PROJECT/" "$LINUX_BUILD/"

cd "$LINUX_BUILD"

npm install
npm run setup:cloudflared
npm run lint
npm run typecheck
npm run build:exe:linux

test -f vrchat-local-video-player-linux
ls -lh vrchat-local-video-player-linux

cp vrchat-local-video-player-linux "$WINDOWS_PROJECT/"
chmod +x "$WINDOWS_PROJECT/vrchat-local-video-player-linux"

echo "All done"
```

### Compile Linux binary (using linux)

- npm run setup:cloudflared (in case you need it)
- npm run lint
- npm run typecheck
- npm run build:exe:linux