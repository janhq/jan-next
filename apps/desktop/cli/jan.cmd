@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\..\..\Jan Alpha.exe" --expose-internals "%~dp0..\..\..\app.asar\jan\node_modules\@janhq\jan-desktop-host\lib\cli.js" %*
exit /b %errorlevel%
