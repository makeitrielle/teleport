@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-AUTOSTART.ps1"
if errorlevel 1 echo Right-click this file and select Run as administrator.
pause
