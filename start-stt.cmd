@echo off
REM ---------------------------------------------------------------------------
REM Local Whisper speech-to-text for the DSH desktop pet -- MANUAL fallback.
REM
REM You normally do NOT need this. The `pet-stt` host plugin in your dsh profile
REM (cordis.patch.yml) starts this service with DSH and stops it on unload, so
REM click-to-record just works. This script is for running the service by hand:
REM without DSH, to pre-download the model, or to watch its live log.
REM
REM The service records on this machine only; nothing leaves it.
REM
REM First run downloads the model (~500 MB for `small`). If huggingface.co is
REM unreachable the script automatically falls back to hf-mirror.com.
REM
REM Usage:  start-stt.cmd            (defaults to the `small` model)
REM         start-stt.cmd --model base
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [stt] Python was not found on PATH. Install Python 3.10+ and retry.
  pause
  exit /b 1
)

echo [stt] starting local Whisper on http://127.0.0.1:8756 ...
echo [stt] keep this window open while using voice input.
python "%~dp0local-stt-server.py" %*
echo.
echo [stt] server exited.
pause
