; ============================================================
; NSIS 自定义安装 / 卸载脚本
;
; 触发条件:package.json -> build.nsis.include
;
; 关联配置:package.json -> build.nsis.deleteAppDataOnUninstall = false
;           (必须为 false,本脚本才能接管清理逻辑)
; ============================================================

!ifndef ANKE_INSTALLER_NSH_INCLUDED
!define ANKE_INSTALLER_NSH_INCLUDED

!include "LogicLib.nsh"

; ============================================================
; v35:customRemoveFiles 宏
; ------------------------------------------------------------
; 触发时机: 卸载或重新安装时,即将删除 $INSTDIR 下的文件前
; (见 electron-builder NSIS 模板 uninstaller.nsh:145-170)
;
; 核心策略: 遍历 $INSTDIR 下所有文件和子目录,
;           跳过 data 目录,删除其他所有内容。
; 原因:
;   v33 采用"什么都不做"策略导致卸载后残留大量文件。
;   v35 恢复正常卸载功能,但保留 data 目录(用户数据)。
;   更新(覆盖安装)时 data 目录自然保留。
; ============================================================
!macro customRemoveFiles
  DetailPrint "[v35] customRemoveFiles: 删除 $INSTDIR 下除 data 外的所有内容"
  ; 保存寄存器
  Push $0  ; 目录路径
  Push $1  ; FindFirst handle
  Push $2  ; 当前项名
  StrCpy $0 "$INSTDIR"
  FindFirst $1 $2 "$0\*.*"
  ; 用 LogicLib 避免显式 label 冲突
  ${DoUntil} $2 == ""
    ${If} $2 != "."
    ${AndIf} $2 != ".."
    ${AndIf} $2 != "data"
      ; 判断是目录还是文件："\*.*" 通配符匹配目录内容
      ${If} ${FileExists} "$0\$2\*.*"
        RMDir /r "$0\$2"
      ${Else}
        Delete "$0\$2"
      ${EndIf}
    ${EndIf}
    FindNext $1 $2
  ${Loop}
  FindClose $1
  ; 恢复寄存器
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customInstall
  ; v33: 不需要恢复 data(因为没有移动过)
  ; 友好提示(覆盖安装/更新)
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONINFORMATION "正在安装/更新 安科作者助手。$\r$\n$\r$\n💡 您的所有数据(作品、世界观、人物、图片、骰子音效)将保留在原位置。$\r$\n$\r$\n主路径:$INSTDIR\data"
  ${EndIf}
!macroend

!macro customUninstall
  ; v32:卸载/升级时不删除 data 目录
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONINFORMATION "卸载安科作者助手。$\r$\n$\r$\n💡 您的所有数据(作品、世界观、人物、图片、骰子音效)将保留在原位置。$\r$\n$\r$\n主路径:$INSTDIR\data$\r$\n$\r$\n如需彻底删除数据,请手动删除该目录。"
  ${EndIf}
!macroend

!endif
