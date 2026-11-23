@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Owner.ps1" -ShareClass
if errorlevel 1 pause
