; ---------------------------------------------------------------------------
; 辅助式安装向导的自定义部分（electron-builder 在 `include` 处包含本文件）
;
; 目标：用户能选安装目录、能选要不要建桌面/开始菜单快捷方式。
; 安装目录靠 electron-builder 原生页（oneClick:false + allowToChangeInstallationDirectory）
; 快捷方式勾选框 electron-builder 没有内置，只能自己加一页。
;
; 注意：本文件被 include 的时机很早（MUI2 还没加载），
; 所以函数定义必须写在 customPageAfterChangeDir 宏里 —— 那里才在 MUI 之后。
; ---------------------------------------------------------------------------

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; 卸载器那一趟也会 include 本文件，但页面宏只在安装器分支展开，
; 变量会变成"声明未用"（warning 6001，electron-builder 视为错误），所以整体圈起来。
!ifndef BUILD_UNINSTALLER

Var OptDesktopShortcut      ; "1" / "0"，只有页面返回值，静默安装时为默认值
Var OptStartMenuShortcut
Var OptDesktopCheckbox      ; 控件句柄
Var OptStartMenuCheckbox

; 强制「仅为当前用户安装」，跳过安装模式页。
; 原因：自动更新走的是无 UAC 的静默安装，必须落在同一个 per-user 目录；
; 一旦允许按机器安装，后续静默升级拿不到管理员权限就会失败。
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; 静默安装（/S，包含自动更新）不执行任何页面，变量会保持空值，
; 这里给个安全默认：两个快捷方式都创建（与旧的 oneClick 行为一致）。
!macro customInit
  StrCpy $OptDesktopShortcut "1"
  StrCpy $OptStartMenuShortcut "1"
!macroend

; 插在「选择安装位置」之后、「开始安装」之前
!macro customPageAfterChangeDir

  Page custom SnkOptionsPageCreate SnkOptionsPageLeave

  Function SnkOptionsPageCreate
    !insertmacro MUI_HEADER_TEXT "安装选项" "选择安装完成后要创建的快捷方式。"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0u 0u 100% 14u "创建桌面快捷方式(&D)"
    Pop $OptDesktopCheckbox
    ${If} $OptDesktopShortcut == "0"
      ${NSD_Uncheck} $OptDesktopCheckbox
    ${Else}
      ${NSD_Check} $OptDesktopCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 0u 20u 100% 14u "创建开始菜单快捷方式(&S)"
    Pop $OptStartMenuCheckbox
    ${If} $OptStartMenuShortcut == "0"
      ${NSD_Uncheck} $OptStartMenuCheckbox
    ${Else}
      ${NSD_Check} $OptStartMenuCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function SnkOptionsPageLeave
    ${NSD_GetState} $OptDesktopCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $OptDesktopShortcut "1"
    ${Else}
      StrCpy $OptDesktopShortcut "0"
    ${EndIf}

    ${NSD_GetState} $OptStartMenuCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $OptStartMenuShortcut "1"
    ${Else}
      StrCpy $OptStartMenuShortcut "0"
    ${EndIf}
  FunctionEnd

!macroend

; 快捷方式是 electron-builder 在 customInstall 之前就建好的，
; 所以这里做的是「按用户选择删掉不要的那个」，而不是自己创建。
; 卸载器仍按 createDesktopShortcut/createStartMenuShortcut 配置清理，不会留残壳。
!macro customInstall
  ${If} $OptDesktopShortcut == "0"
    Delete "$newDesktopLink"
    System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
  ${If} $OptStartMenuShortcut == "0"
    Delete "$newStartMenuLink"
    System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER
