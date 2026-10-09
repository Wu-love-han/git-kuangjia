@echo off
rem Graph framework starter (visible console, for debugging).
rem Delegates to the hidden VBS launcher; ASCII-only so cmd.exe renders it right.
setlocal
cd /d "%~dp0"
wscript "start-graph.vbs"
endlocal
