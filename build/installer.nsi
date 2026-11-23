; Kontakte – eigener NSIS-Installer (baut ohne Wine)
Unicode true
!include "MUI2.nsh"
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APP "Kontakte"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\de.ortie.kontakte"
Name "${APP} ${VERSION}"
OutFile "..\dist\Kontakte-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Ortie"
VIAddVersionKey "LegalCopyright" "Ortie"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Kontakte jetzt starten"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"

Function .onInit
  ; laufende App beenden, sonst sind Dateien gesperrt
  nsExec::Exec 'taskkill /IM "${APP}.exe" /F'
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  CreateShortCut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${APP}.exe"
  CreateShortCut "$DESKTOP\${APP}.lnk" "$INSTDIR\${APP}.exe"
  ; .vcf mit Kontakte öffnen
  WriteRegStr HKCU "Software\Classes\.vcf\OpenWithProgids" "Kontakte.vcf" ""
  WriteRegStr HKCU "Software\Classes\Kontakte.vcf" "" "vCard-Kontakt"
  WriteRegStr HKCU "Software\Classes\Kontakte.vcf\DefaultIcon" "" "$INSTDIR\${APP}.exe,0"
  WriteRegStr HKCU "Software\Classes\Kontakte.vcf\shell\open\command" "" '"$INSTDIR\${APP}.exe" "%1"'
  ; Eintrag in "Apps & Features"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Ortie"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${APP}.exe,0"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Deinstallieren.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; Kontaktdaten in %APPDATA%\Kontakte bleiben erhalten
  nsExec::Exec 'taskkill /IM "${APP}.exe" /F'
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Classes\Kontakte.vcf"
  DeleteRegValue HKCU "Software\Classes\.vcf\OpenWithProgids" "Kontakte.vcf"
  DeleteRegKey HKCU "Software\${APP}"
  DeleteRegKey HKCU "${UNKEY}"
SectionEnd
