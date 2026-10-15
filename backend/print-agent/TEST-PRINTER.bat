@echo off
cd /d "%~dp0.."
if exist node.exe (node.exe print-agent\TEST-PRINTER.js) else (node print-agent\TEST-PRINTER.js)
pause
