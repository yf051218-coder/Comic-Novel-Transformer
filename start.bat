@echo off
set "ROOT=%~dp0"

echo Checking environment...
where python >nul 2>nul || (echo Python not found! Please install Python 3.11+ && pause && exit /b 1)

if not exist "%ROOT%backend\static\index.html" (
    echo Frontend not built. Run: cd frontend ^&^& npm install ^&^& npm run build
    pause
    exit /b 1
)

echo Installing backend dependencies...
pip install -r "%ROOT%backend\requirements.txt" >nul 2>nul

echo.
echo Starting LoreVista...
start "LoreVista" cmd /k "cd /d "%ROOT%backend" && python main.py"

timeout /t 3 /nobreak >nul
start "" http://localhost:8000
