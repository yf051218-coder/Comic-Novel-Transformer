@echo off
set "ROOT=%~dp0"

echo ========================================
echo   LoreVista - Build EXE
echo ========================================
echo.

echo [1/4] Installing PyInstaller...
pip install pyinstaller >nul 2>nul

echo [2/4] Building frontend...
cd /d "%ROOT%frontend"
call npm run build
if errorlevel 1 (
    echo Frontend build failed!
    pause
    exit /b 1
)

echo [3/4] Copying dist to backend/static...
if exist "%ROOT%backend\static" rmdir /s /q "%ROOT%backend\static"
xcopy /e /i /y "%ROOT%frontend\dist" "%ROOT%backend\static" >nul

echo [4/4] Running PyInstaller...
cd /d "%ROOT%backend"

pyinstaller ^
    --onefile ^
    --console ^
    --name LoreVista ^
    --add-data "static;static" ^
    --add-data ".env;." ^
    --add-data "services;services" ^
    --hidden-import=uvicorn.logging ^
    --hidden-import=uvicorn.loops ^
    --hidden-import=uvicorn.loops.auto ^
    --hidden-import=uvicorn.protocols ^
    --hidden-import=uvicorn.protocols.http ^
    --hidden-import=uvicorn.protocols.http.auto ^
    --hidden-import=uvicorn.protocols.websockets ^
    --hidden-import=uvicorn.protocols.websockets.auto ^
    --hidden-import=uvicorn.lifespan ^
    --hidden-import=uvicorn.lifespan.on ^
    --hidden-import=sqlalchemy ^
    --hidden-import=sqlalchemy.ext ^
    --hidden-import=pydantic ^
    --hidden-import=pydantic.deprecated.decorator ^
    --hidden-import=dotenv ^
    --hidden-import=PIL ^
    --hidden-import=PIL.Image ^
    --collect-all=sse_starlette ^
    --clean ^
    main.py

if errorlevel 1 (
    echo.
    echo Build failed! See errors above.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   SUCCESS - EXE created at:
echo   %ROOT%backend\dist\LoreVista.exe
echo ========================================
echo.
echo Distribute: copy LoreVista.exe to any folder and run.
echo First run creates data/ and manga_outputs/ next to EXE.
echo.
pause
