; ============================================================================
; side-business-desktop NSIS 安装脚本
; 约束: 禁止C盘安装, 支持UAC降级, 安装目录可自定义(默认D盘)
; 产出: side-business-installer-1.0.0.exe
; ============================================================================

; --- 基本配置 ---
!define PRODUCT_NAME "接稿业务管理系统"
!define PRODUCT_NAME_EN "side-business-system"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "side-business-team"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\side-business-installer-${PRODUCT_VERSION}.exe"
InstallDir "D:\${PRODUCT_NAME_EN}"
InstallDirRegKey HKLM "Software\${PRODUCT_NAME_EN}" "InstallLocation"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show
SetCompressor /SOLID lzma
SetCompressorDictSize 64

; --- MUI 2 界面 ---
!include "MUI2.nsh"

!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择安装目录$\n$\n所需空间: ~150MB"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "安装目录"

; 安装页面序列
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; 卸载页面
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

; --- 初始化: UAC降级 + C盘拦截 ---
Function .onInit
  ; 检测管理员权限
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "admin"
    ; 非管理员 -> 降级到 LOCALAPPDATA
    StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCT_NAME_EN}"
    SetShellVarContext current
    MessageBox MB_ICONINFORMATION "未获得管理员权限，将以当前用户身份安装到:$\n$INSTDIR"
  ${Else}
    ; 管理员 -> 默认 D 盘
    StrCpy $INSTDIR "D:\${PRODUCT_NAME_EN}"
    SetShellVarContext all
  ${EndIf}
FunctionEnd

; --- 目录校验: 拦截C盘 ---
Function .onVerifyInstDir
  ; 拒绝 C 盘根目录
  ${If} $INSTDIR == "C:"
    MessageBox MB_ICONSTOP "错误: 不允许安装到 C 盘根目录。请选择 D 盘或其他非系统盘。"
    Abort
  ${EndIf}

  ; 拒绝 C 盘子目录
  StrCpy $0 $INSTDIR 2
  ${If} $0 == "C:"
    MessageBox MB_ICONSTOP "错误: 禁止在 C 盘建立文件。请选择其他盘（如 D:\）。"
    Abort
  ${EndIf}

  ; 拒绝可移动磁盘 (检测 A: B: 盘符)
  StrCpy $0 $INSTDIR 2
  ${If} $0 == "A:"
  ${OrIf} $0 == "B:"
    MessageBox MB_ICONSTOP "错误: 不支持安装到可移动磁盘。"
    Abort
  ${EndIf}
FunctionEnd

; --- 检测已有安装（升级/修复） ---
Function checkPreviousInstall
  ; 1. 读 HKLM 注册表
  ReadRegStr $R0 HKLM "Software\${PRODUCT_NAME_EN}" "Version"
  ReadRegStr $R1 HKLM "Software\${PRODUCT_NAME_EN}" "InstallLocation"

  ; 2. 如果 HKLM 找不到，尝试 HKCU
  ${If} $R0 == ""
    ReadRegStr $R0 HKCU "Software\${PRODUCT_NAME_EN}" "Version"
    ReadRegStr $R1 HKCU "Software\${PRODUCT_NAME_EN}" "InstallLocation"
  ${EndIf}

  ; 3. 无旧版本 -> 全新安装
  ${If} $R0 == ""
    Return
  ${EndIf}

  ; 4. 版本比较 (字符串比较)
  ${If} $R0 == "${PRODUCT_VERSION}"
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "已安装相同版本 ${PRODUCT_VERSION}。$\n$\n要修复安装（覆盖程序文件）吗？" \
      IDYES repair IDNO quit
  ${Else}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "检测到已安装版本 $R0。$\n$\n要升级到 ${PRODUCT_VERSION} 吗？$\n$\n（用户数据将被保留）" \
      IDYES upgrade IDNO quit
  ${EndIf}
  Goto done

  upgrade:
    ; 尝试优雅关闭旧进程
    StrCpy $INSTDIR $R1
    Goto done

  repair:
    StrCpy $INSTDIR $R1
    Goto done

  quit:
    Quit

  done:
FunctionEnd

; --- 主程序 (必需) ---
Section "主程序 (必需)" SecMain
  SectionIn RO

  Call checkPreviousInstall

  ; 创建安装目录
  CreateDirectory "$INSTDIR"

  ; 写入测试 — 验证目录权限
  ClearErrors
  FileOpen $0 "$INSTDIR\test_write.tmp" w
  IfErrors 0 +3
    MessageBox MB_ICONSTOP "错误: 目标目录不可写。请选择其他目录或以管理员身份运行。"
    Abort
  FileClose $0
  Delete "$INSTDIR\test_write.tmp"

  SetOutPath "$INSTDIR"

  ; 安装主程序 EXE
  File "..\payload\side-business.exe"

  ; 安装 OCR 语言包
  SetOutPath "$INSTDIR\tessdata"
  File /nonfatal "..\payload\tessdata\chi_sim.traineddata"

  ; 安装字体
  SetOutPath "$INSTDIR\fonts"
  File /nonfatal "..\payload\fonts\NotoSansSC-Regular.ttf"

SectionEnd

; --- 快捷方式 ---
Section "创建快捷方式" SecShortcuts
  ; 桌面快捷方式
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\side-business.exe"

  ; 开始菜单组
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\side-business.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\卸载.lnk" "$INSTDIR\uninstall.exe"
SectionEnd

; --- 注册表 ---
Section "写入注册表" SecRegistry
  ; Uninstall 注册信息
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "DisplayName"     "${PRODUCT_NAME}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "Publisher"       "${PRODUCT_PUBLISHER}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "DisplayIcon"     "$INSTDIR\side-business.exe"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "NoModify"        1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "NoRepair"        1

  ; 自有版本信息 (供升级检测)
  WriteRegStr   HKLM "Software\${PRODUCT_NAME_EN}" "Version"         "${PRODUCT_VERSION}"
  WriteRegStr   HKLM "Software\${PRODUCT_NAME_EN}" "InstallLocation" "$INSTDIR"

  ; 写入安装日期
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}" "InstallDate"     "$2$1$0"
SectionEnd

; --- 完成页面 — 以当前用户身份启动（不继承管理员权限） ---
Function .onInstSuccess
  ; ExecShell 以登录用户身份启动，不继承管理员权限
  ExecShell "" "$INSTDIR\side-business.exe"
FunctionEnd

; ============================================================================
; 卸载段
; ============================================================================
Section "Uninstall"
  ; 1. 查找并停止运行中的进程
  FindWindow $0 "" "${PRODUCT_NAME}"
  ${If} $0 != 0
    SendMessage $0 ${WM_CLOSE} 0 0
    Sleep 3000
  ${EndIf}

  ; 2. 询问是否保留用户数据
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否保留用户数据（数据库和配置）？$\n$\n保存在: $APPDATA\side-business-system\" \
    IDYES keepData

  ; 删除用户数据
  RMDir /r "$APPDATA\side-business-system"

  keepData:

  ; 3. 删除安装目录文件
  Delete "$INSTDIR\side-business.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\tessdata"
  RMDir /r "$INSTDIR\fonts"
  RMDir "$INSTDIR"

  ; 4. 删除快捷方式
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"

  ; 5. 删除注册表
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME_EN}"
  DeleteRegKey HKLM "Software\${PRODUCT_NAME_EN}"
  DeleteRegKey HKCU "Software\${PRODUCT_NAME_EN}"
SectionEnd

; --- 卸载初始化 ---
Function un.onInit
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "确定要卸载 ${PRODUCT_NAME} 吗？" \
    IDYES +2
  Abort
FunctionEnd
