@echo off
REM Radar BadBen23 - ejecucion en tu PC (alternativa a GitHub)
cd /d "%~dp0"
where python >nul 2>nul || (echo Instala Python 3 desde https://www.python.org/downloads/ marcando "Add to PATH" & pause & exit /b 1)
python -m pip install -q -r requirements.txt
if "%SITE_PASSWORD%"=="" set /p SITE_PASSWORD=Contrasena de la web: 
if "%GEMINI_API_KEY%"=="" set /p GEMINI_API_KEY=Clave Gemini (Enter para saltar la IA): 
python run.py todo
echo.
echo Abriendo la web en http://localhost:8765 (cierra esta ventana para pararla)
start "" http://localhost:8765
python -m http.server 8765 --directory site
