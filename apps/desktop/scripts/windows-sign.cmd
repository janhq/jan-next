@echo off
setlocal DisableDelayedExpansion
set "signTool=%JAN_DESKTOP_WINDOWS_SIGNTOOL%"
set "certificateFile=%JAN_DESKTOP_WINDOWS_CER_FILE%"
set "tokenPin=%JAN_DESKTOP_WINDOWS_TOKEN_PIN%"
set "keyContainer=%JAN_DESKTOP_WINDOWS_KEY_CONTAINER%"
set "targetFile=%JAN_DESKTOP_WINDOWS_SIGN_TARGET%"
set "appendSignature="
if "%JAN_DESKTOP_WINDOWS_SIGN_APPEND%"=="1" set "appendSignature=/as"
set "JAN_DESKTOP_WINDOWS_SIGNTOOL="
set "JAN_DESKTOP_WINDOWS_CER_FILE="
set "JAN_DESKTOP_WINDOWS_TOKEN_PIN="
set "JAN_DESKTOP_WINDOWS_KEY_CONTAINER="
set "JAN_DESKTOP_WINDOWS_SIGN_TARGET="
set "JAN_DESKTOP_WINDOWS_SIGN_APPEND="
set "signTool=" & set "certificateFile=" & set "tokenPin=" & set "keyContainer=" & set "targetFile=" & set "appendSignature=" & "%signTool%" sign /v /fd sha256 /f "%certificateFile%" /kc "[{{%tokenPin%}}]=%keyContainer%" /csp "eToken Base Cryptographic Provider" %appendSignature% "%targetFile%"
exit /b %errorlevel%
