@echo off
title YT Music Downloader - Dev
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
echo Lancement Tauri en mode developpement...
call npm run tauri:dev
if errorlevel 1 pause
