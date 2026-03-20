@echo off
TITLE Video Uploader System
SET "ROOT_DIR=C:\auto-vid-post"
SET "BRAVE_PATH=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"

echo ======================================================
echo           VIDEO UPLOADER - SMART LAUNCHER
echo ======================================================

echo [1/4] Pulling latest updates from Lovable...
cd /d "%ROOT_DIR%"
git pull origin main

echo [2/4] Checking Dependencies...
IF NOT EXIST "node_modules" (
    echo [!] Missing frontend packages. Installing now...
    call npm install
) ELSE (
    echo [OK] Frontend packages found.
)

cd server
IF NOT EXIST "node_modules" (
    echo [!] Missing server packages. Installing now...
    call npm install
    call npx playwright install chromium
) ELSE (
    echo [OK] Server packages found.
)
cd ..

echo [3/4] Launching services...
:: Start Backend
start "Uploader_SERVER" cmd /k "cd server && npm start"

:: Start Frontend (LOCKED TO PORT 8081)
start "Uploader_FRONTEND" cmd /k "npm run dev -- --port 8081 --strictPort"

echo [4/4] Waiting 10 seconds for services to compile...
timeout /t 10 /nobreak

echo Opening Brave Browser...
if exist "%BRAVE_PATH%" (
    start "" "%BRAVE_PATH%" http://localhost:8081
) else (
    start http://localhost:8081
)
exit
