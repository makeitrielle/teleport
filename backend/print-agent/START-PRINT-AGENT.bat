@echo off
cd /d "%~dp0.."
if exist node.exe (node.exe print-agent\index.js) else (node print-agent\index.js)
pause
