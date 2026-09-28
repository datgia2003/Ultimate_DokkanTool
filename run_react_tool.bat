@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0.runtime\temp" mkdir "%~dp0.runtime\temp"
if not exist "%~dp0.runtime\cache" mkdir "%~dp0.runtime\cache"
set "TEMP=%~dp0.runtime\temp"
set "TMP=%~dp0.runtime\temp"
set "TMPDIR=%~dp0.runtime\temp"
set "XDG_CACHE_HOME=%~dp0.runtime\cache"
set "PYTHONPYCACHEPREFIX=%~dp0.runtime\pycache"
set "npm_config_cache=%~dp0.runtime\npm-cache"
echo Starting Dokkan React API...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8765,5174 -State Listen -ErrorAction SilentlyContinue) { Write-Host 'Port 8765 hoac 5174 da duoc su dung. Hay dong ban tool React cu truoc khi chay lai.'; exit 1 }"
if errorlevel 1 (
    pause
    exit /b 1
)
where python >nul 2>nul
if errorlevel 1 (
    echo Python chua duoc cai dat hoac chua co trong PATH.
    pause
    exit /b 1
)
python -c "import cricodecs" >nul 2>nul
if errorlevel 1 (
    echo CriCodecs chua duoc cai dat. Dang cai cricodecs==1.2.0...
    python -m pip install -r "%~dp0requirements-react.txt"
    if errorlevel 1 (
        echo Cai Python dependencies that bai. Khong the khoi dong API.
        pause
        exit /b 1
    )
    python -c "import cricodecs"
    if errorlevel 1 (
        echo Khong the import CriCodecs sau khi cai dat.
        pause
        exit /b 1
    )
)
where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js/npm chua duoc cai dat hoac chua co trong PATH.
    pause
    exit /b 1
)
cd /d "%~dp0web-ui"
if not exist "node_modules\vite\bin\vite.js" (
    echo Installing React dependencies for first run...
    call npm ci
    if errorlevel 1 (
        echo npm ci failed. React UI cannot start.
        pause
        exit /b 1
    )
)
cd /d "%~dp0"
start "Dokkan React API" /min python -X utf8 react_api.py --port 8765
rem react_api.py already starts the animation asset server on port 8585.
echo Starting React UI...
cd /d "%~dp0web-ui"
call npm run dev -- --open http://127.0.0.1:5174/
pause
