; ============================================================================
; JieGao Business Manager - NSIS Installer
; Default install: D:\
; ============================================================================

Unicode true
!include "MUI2.nsh"

!define PRODUCT_NAME "JieGao Business Manager"
!define PRODUCT_NAME_EN "side-business-system"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "side-business-team"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\JieGao-Setup-${PRODUCT_VERSION}.exe"
InstallDir "D:\${PRODUCT_NAME_EN}"
RequestExecutionLevel admin
ShowInstDetails show
SetCompressor /SOLID lzma

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"


Section "Install"
  SetOutPath "$INSTDIR"

  File "..\payload\side-business.exe"
  File "..\payload\activation_hashes.enc"

  CreateDirectory "$INSTDIR\logs"
  CreateDirectory "$INSTDIR\data"

  CreateShortCut "$DESKTOP\JieGao Business Manager.lnk" "$INSTDIR\side-business.exe"
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\side-business.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" "$INSTDIR\uninst.exe"

  WriteUninstaller "$INSTDIR\uninst.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "UninstallString" "$INSTDIR\uninst.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\side-business.exe"
  Delete "$INSTDIR\activation_hashes.enc"
  Delete "$INSTDIR\uninst.exe"
  RMDir /r "$INSTDIR\logs"
  RMDir /r "$INSTDIR\data"

  MessageBox MB_YESNO "Keep user data (database and config)?" IDYES keepData
  RMDir /r "$APPDATA\side-business-system"
keepData:

  Delete "$DESKTOP\JieGao Business Manager.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}"
SectionEnd
