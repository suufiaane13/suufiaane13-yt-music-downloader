@echo off
setlocal EnableExtensions
echo ==========================================
echo   YT Music Downloader - Package + Setup
echo ==========================================
echo.

cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo [1/5] Build Tauri + installateur NSIS...
call npm run tauri build
if errorlevel 1 (
    echo ERREUR: build Tauri echoue
    if /i not "%NOPAUSE%"=="1" pause
    exit /b 1
)

echo [2/5] Preparation du dossier release-app...
set "DEST=%~dp0release-app"
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"
if errorlevel 1 (
    echo ERREUR: impossible de creer %DEST%
    if /i not "%NOPAUSE%"=="1" pause
    exit /b 1
)

set "EXE=src-tauri\target\release\yt-music-downloader.exe"
if defined CARGO_TARGET_DIR if exist "%CARGO_TARGET_DIR%\release\yt-music-downloader.exe" (
    set "EXE=%CARGO_TARGET_DIR%\release\yt-music-downloader.exe"
)
if not exist "%EXE%" (
    echo ERREUR: exe introuvable
    if /i not "%NOPAUSE%"=="1" pause
    exit /b 1
)

echo [3/5] Copie portable (exe + bin)...
echo     Source exe : %EXE%
copy /Y "%EXE%" "%DEST%\" >nul
xcopy "src-tauri\bin" "%DEST%\bin\" /e /i /y /q >nul
(
echo @echo off
echo setlocal
echo cd /d "%%~dp0"
echo start "" "yt-music-downloader.exe"
echo exit
) > "%DEST%\Lancer-YT-Music-Downloader.bat"

echo [4/5] Copie de l installateur NSIS...
set "BUNDLE_DIR=src-tauri\target\release\bundle\nsis"
if defined CARGO_TARGET_DIR set "BUNDLE_DIR=%CARGO_TARGET_DIR%\release\bundle\nsis"
set "SETUP="
for %%F in ("%BUNDLE_DIR%\*-setup.exe") do set "SETUP=%%~fF"
if not defined SETUP (
    echo ATTENTION: aucun *-setup.exe trouve dans %BUNDLE_DIR%
) else (
    copy /Y "%SETUP%" "%DEST%\YT-Music-Downloader-Setup.exe" >nul
    echo     Setup : %DEST%\YT-Music-Downloader-Setup.exe
)

echo [5/5] Termine.
echo.
echo Portable : %DEST%\yt-music-downloader.exe
echo Setup    : %DEST%\YT-Music-Downloader-Setup.exe
echo.
if /i not "%NOPAUSE%"=="1" pause
exit /b 0
