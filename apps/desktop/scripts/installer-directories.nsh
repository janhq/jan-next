!include "LogicLib.nsh"

Var janFinalDirectory
Var janNewDirectory
Var janOldDirectory
Var janOldMoved
Var janNewMoved
Var janDirectoryError
Var janDirectorySource
Var janDirectoryDestination
Var janRestoreError
Var janDirectoryLogDirectory
Var janRecoveryStopped

; MoveFileEx preserves the destination and exposes the Windows error before rollback changes it.
; Open files inside a directory can make its rename return access denied (5).
!macro janDirectoryOperation SOURCE DESTINATION RESULT PHASE
  Push $0
  Push $1
  Push $2
  StrCpy $0 0
  ${Do}
    ${If} "${DESTINATION}" == ""
      System::Call 'kernel32::RemoveDirectoryW(w "${SOURCE}") i.r1 ?e'
    ${Else}
      System::Call 'kernel32::MoveFileExW(w "${SOURCE}", w "${DESTINATION}", i 0) i.r1 ?e'
    ${EndIf}
    Pop ${RESULT}
    ${If} "${DESTINATION}" == ""
      ${If} ${RESULT} == 2
      ${OrIf} ${RESULT} == 3
        StrCpy $1 1
      ${EndIf}
    ${EndIf}
    ${If} $1 != 0
      StrCpy ${RESULT} 0
      ${ExitDo}
    ${EndIf}
    ClearErrors
    FileOpen $2 "$PLUGINSDIR\directory-operations.log" a
    ${IfNot} ${Errors}
      FileSeek $2 0 END
      FileWrite $2 "${PHASE}: Windows error: ${RESULT}$\r$\n"
      FileClose $2
    ${EndIf}
    ${If} ${RESULT} != 5
    ${AndIf} ${RESULT} != 32
    ${AndIf} ${RESULT} != 33
      ${ExitDo}
    ${EndIf}
    IntOp $0 $0 + 1
    ${If} $0 >= 10
      ${ExitDo}
    ${EndIf}
    IntOp $1 $0 * 250
    Sleep $1
  ${Loop}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro janReportDirectoryFailure
  ${If} $janRestoreError != 0
    StrCpy $janRecoveryStopped "1"
  ${EndIf}
  !ifmacrodef customInstallerDirectoryFailed
    !insertmacro customInstallerDirectoryFailed
  !else
    DetailPrint "Directory operation failed ($janDirectoryError): $janDirectorySource -> $janDirectoryDestination; restore error: $janRestoreError"
  !endif
!macroend

!macro janExtractPayload FILE
  !ifmacrodef customInstallerExtract
    !insertmacro customInstallerExtract "${FILE}"
  !else
    nsExec::ExecToStack '"$PLUGINSDIR\jan-7za.exe" x -y -bd -bb0 "-o$INSTDIR" "${FILE}"'
    Pop $R0
    Pop $R1
  !endif
  ${If} $R0 != 0
    DetailPrint $R1
    Call janRollbackDirectories
    !ifmacrodef customInstallerExtractFailed
      !insertmacro customInstallerExtractFailed "${FILE}"
    !else
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)" /SD IDOK
    !endif
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro janStageApplication
  !ifdef JAN_INSTALLER_LOG_DIR
    ; electron-builder defines the cache name after including our function bodies, before this section expands.
    StrCpy $janDirectoryLogDirectory "${JAN_INSTALLER_LOG_DIR}"
  !endif
  StrCpy $janFinalDirectory $INSTDIR
  System::Call 'ole32::CoCreateGuid(g .r0) i .r1'
  ${If} $1 != 0
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $janNewDirectory "$INSTDIR.new-$0"
  StrCpy $janOldDirectory "$INSTDIR.old-$0"
  StrCpy $janOldMoved ""
  StrCpy $janNewMoved ""
  StrCpy $janDirectoryError 0
  StrCpy $janRestoreError 0
  StrCpy $janRecoveryStopped ""
  ClearErrors
  CreateDirectory $janNewDirectory
  ${If} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
  File /oname=$PLUGINSDIR\jan-7za.exe "${JAN_SEVENZIP_PATH}"
  StrCpy $INSTDIR $janNewDirectory
  SetOutPath $INSTDIR
  !insertmacro installApplicationFiles
  !ifdef JAN_SEVENZIP_LICENSE_DIR
    File /oname=7zip-installer-LICENSE.txt "${JAN_SEVENZIP_LICENSE_DIR}\LICENSE.txt"
    File /oname=7zip-installer-COPYING.txt "${JAN_SEVENZIP_LICENSE_DIR}\COPYING"
  !endif
  !ifdef UNINSTALLER_ICON
    File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
  !endif
  StrCpy $INSTDIR $janFinalDirectory
  SetOutPath $PLUGINSDIR
!macroend

Function .onGUIEnd
  Call janCleanupDirectories
FunctionEnd

Function janCleanupDirectories
  ${If} $janRecoveryStopped == "1"
    Return
  ${EndIf}
  ${If} $janFinalDirectory != ""
    Call janRollbackDirectories
  ${EndIf}
FunctionEnd

; Only directories created or renamed by this installer are removed during rollback.
Function janRollbackDirectories
  SetOutPath $PLUGINSDIR
  ${If} $janNewMoved == "1"
    RMDir /r "\\?\$janFinalDirectory"
    StrCpy $janNewMoved ""
  ${EndIf}
  ${If} $janOldMoved == "1"
    !insertmacro janDirectoryOperation "$janOldDirectory" "$janFinalDirectory" $janRestoreError "restore"
    ${If} $janRestoreError != 0
      ; Leave the complete backup in place if another process prevents restoration.
      DetailPrint $janOldDirectory
      RMDir /r "\\?\$janNewDirectory"
      Return
    ${EndIf}
    StrCpy $janOldMoved ""
  ${EndIf}
  ${If} $janNewDirectory != ""
    RMDir /r "\\?\$janNewDirectory"
  ${EndIf}
  StrCpy $INSTDIR $janFinalDirectory
FunctionEnd

Function janPromoteDirectories
  !ifmacrodef InstallerPublishStage
    !insertmacro InstallerPublishStage 2
  !endif
  ; SetOutPath opens a directory handle; release it before either rename.
  SetOutPath $PLUGINSDIR
  ClearErrors
  ${If} ${FileExists} "$janFinalDirectory\*.*"
    StrCpy $janDirectorySource $janFinalDirectory
    StrCpy $janDirectoryDestination $janOldDirectory
    !insertmacro janDirectoryOperation "$janDirectorySource" "$janDirectoryDestination" $janDirectoryError "backup"
    ${If} $janDirectoryError != 0
      Call janRollbackDirectories
      !insertmacro janReportDirectoryFailure
      SetErrors
      Return
    ${EndIf}
    StrCpy $janOldMoved "1"
  ${Else}
    ; NSIS can create the destination before the install section starts.
    StrCpy $janDirectorySource $janFinalDirectory
    StrCpy $janDirectoryDestination ""
    !insertmacro janDirectoryOperation "$janDirectorySource" "" $janDirectoryError "remove-empty"
    ${If} $janDirectoryError != 0
      Call janRollbackDirectories
      !insertmacro janReportDirectoryFailure
      SetErrors
      Return
    ${EndIf}
  ${EndIf}
  ClearErrors
  StrCpy $janDirectorySource $janNewDirectory
  StrCpy $janDirectoryDestination $janFinalDirectory
  !insertmacro janDirectoryOperation "$janDirectorySource" "$janDirectoryDestination" $janDirectoryError "promote"
  ${If} $janDirectoryError != 0
    Call janRollbackDirectories
    !insertmacro janReportDirectoryFailure
    SetErrors
    Return
  ${EndIf}
  StrCpy $janNewMoved "1"
  SetOutPath $janFinalDirectory
  !ifmacrodef InstallerPublishStage
    !insertmacro InstallerPublishStage 3
  !endif
  ClearErrors
FunctionEnd

!macro janFinishDirectories
  StrCpy $janNewMoved ""
  ${If} $janOldMoved == "1"
    RMDir /r "\\?\$janOldDirectory"
    StrCpy $janOldMoved ""
  ${EndIf}
!macroend
