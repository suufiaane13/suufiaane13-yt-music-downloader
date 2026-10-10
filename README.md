# YT Music Downloader

App desktop Tauri 2 + React pour rechercher, télécharger (MP3/MP4) et lire des médias YouTube.

## Dev

- `start-dev.bat` ou `npm run tauri:dev` (Vite via `beforeDevCommand` = `npm run vite`)
- Frontend seul : `npm run vite` sur http://localhost:1420

## Package

- `build-release.bat` → build + installateur NSIS Tauri + portable dans `release-app/`
- Setup : `release-app/YT-Music-Downloader-Setup.exe` (FR, per-user, WebView2)
- Portable : `release-app/yt-music-downloader.exe` + `bin/`

## Perf téléchargements

- Paramètres → profil **Rapide** (M4A, idéal playlists longues), **Équilibré** ou **Qualité**
- Archive `.ytmd-archive.txt` + réessai auto (ON par défaut)
- `deno.exe` est emballé dans `bin/` (runtime JS pour yt-dlp / YouTube)

## Tests

- UI (mocks Tauri) : `npm run test:e2e`
- Smoke yt-dlp/ffmpeg : `node scripts/smoke-download.mjs`
- Rust : `cd src-tauri && cargo test --lib`
