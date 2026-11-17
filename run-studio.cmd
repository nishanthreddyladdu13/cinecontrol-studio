@echo off
setlocal
pushd "%~dp0backend" || exit /b 1
if exist ".venv\Scripts\python.exe" goto dependencies
py -3.12 -m venv .venv
if errorlevel 1 goto failed
:dependencies
".venv\Scripts\python.exe" -c "import dotenv,fastapi,httpx,pydantic,uvicorn,imageio_ffmpeg" >nul 2>&1
if not errorlevel 1 goto ready
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
:ready
if not exist ".env" copy ".env.example" ".env" >nul
echo CineControl Studio runs at http://127.0.0.1:8000
echo Keep this window open. Press Ctrl+C to stop.
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 goto failed
popd
exit /b 0
:failed
echo CineControl could not start. Confirm Python 3.12 is installed with the Windows launcher, then review the error above.
pause
popd
exit /b 1
