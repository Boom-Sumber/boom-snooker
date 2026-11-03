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
!include "FileFunc.nsh"     ; GetParameters / GetOptions（FileFunc 自带 include guard，重复包含无害）

; 卸载器那一趟也会 include 本文件，但页面宏只在安装器分支展开，
; 变量会变成"声明未用"（warning 6001，electron-builder 视为错误），所以整体圈起来。
!ifndef BUILD_UNINSTALLER

Var OptDesktopShortcut      ; "1" / "0"，只有页面返回值，静默安装时为默认值
Var OptStartMenuShortcut
Var OptDesktopCheckbox      ; 控件句柄
Var OptStartMenuCheckbox
Var SnkIsUpdate             ; "1" = 本次由应用内更新拉起

; 强制「仅为当前用户安装」，跳过安装模式页。
; 原因：自动更新走的是无 UAC 的静默安装，必须落在同一个 per-user 目录；
; 一旦允许按机器安装，后续静默升级拿不到管理员权限就会失败。
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; 静默安装（/S）不执行任何页面，变量会保持空值，
; 这里给个安全默认：两个快捷方式都创建（与旧的 oneClick 行为一致）。
;
; 应用内更新（electron-updater）会带 `--updated` 参数。凡是带这个参数的，
; 一律当场转静默：不问安装目录、不问快捷方式、不放完成页，
; 装完由 `--force-run` 直接拉起新版本（见 electron-builder 的 installSection.nsh）。
;
; 为什么不能只靠调用方传 /S：正在运行的是「旧版本」的代码，它可能没传 /S
; （0.1.2 及更早就是 quitAndInstall(false, true)）。把判断放在安装器里，
; 升级链路的第一次就能生效，不用等用户先升到新版本。
!macro customInit
  StrCpy $OptDesktopShortcut "1"
  StrCpy $OptStartMenuShortcut "1"
  StrCpy $SnkIsUpdate "0"

  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    StrCpy $SnkIsUpdate "1"
    SetSilent silent
  ${EndIf}
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
