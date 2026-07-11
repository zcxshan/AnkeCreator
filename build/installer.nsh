; ============================================================
; NSIS 自定义安装 / 卸载脚本
;
; 触发条件：package.json -> build.nsis.include
;
; 关联配置：package.json -> build.nsis.deleteAppDataOnUninstall = false
;           （必须为 false，本脚本才能接管清理逻辑）
; ============================================================

!ifndef ANKE_INSTALLER_NSH_INCLUDED
!define ANKE_INSTALLER_NSH_INCLUDED

!macro customInstall
  ; #11：覆盖安装/更新时，提示用户数据保留（仅 GUI 安装/非静默）
  ${IfNot} ${Silent}
    ; 升级时（新版覆盖旧版）会先自动卸载旧版，再装新版。
    ; customInstall 在「装新版」阶段触发 → 此时 data 目录已就位（被保留）
    ; 这里只做一条友好提示
    MessageBox MB_OK|MB_ICONINFORMATION "正在安装/更新 安科作者助手。$\r$\n$\r$\n💡 您的所有数据（作品、世界观、人物、图片、骰子音效）将保留在原位置。$\r$\n$\r$\n主路径：$INSTDIR\data"
  ${EndIf}
!macroend

!macro customUninstall
  ; 静默卸载（无人值守场景）跳过所有询问，按"保留数据"处理
  ${IfNot} ${Silent}
    ; #10：第一步 —— 提醒用户先导出重要数据
    ;   选「否」→ 取消整个卸载流程，让用户先去应用内导出
    ;   选「是」→ 继续第二步：是否同时清空数据
    MessageBox MB_YESNO|MB_ICONQUESTION "卸载前提醒：$\r$\n$\r$\n请先在应用中导出您的重要作品！$\r$\n（设置 → 清空所有本地数据前的「导出」按钮 / 单作品右键 → 整作品另存为）$\r$\n$\r$\n是否已导出重要数据？$\r$\n（选「否」可取消卸载）" IDYES anke_uninst_confirm_delete IDNO anke_uninst_cancel

    anke_uninst_cancel:
      ; 取消整个卸载流程
      Abort

    anke_uninst_confirm_delete:
      ; #8：第二步 —— 询问是否同时清空个人数据
      ;   默认「否」（MB_DEFBUTTON2）—— 倾向于保护用户数据
      MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION "是否同时删除所有个人数据？$\r$\n$\r$\n将清理：作品、世界观、人物、图片、骰子音效、NGA 登录 Cookie 等$\r$\n选「否」→ 数据保留在安装路径，下次重装自动恢复" IDYES anke_uninst_delete_data IDNO anke_uninst_keep_data

    anke_uninst_delete_data:
      ; 1) 主清理：递归删除安装路径下的 data 目录
      ;    （v3.2+ 扁平化后 data 目录包含 AnkeCreatorData/ + stories/ + templates/ + images/ + sounds/）
      RMDir /r "$INSTDIR\data"
      ; 2) 兜底：仍清理 $APPDATA 和 $LOCALAPPDATA 下的 appId 和 productName 目录
      ;    兼容 v3.2 之前未迁移到新位置的老用户数据
      RMDir /r "$APPDATA\${APP_ID}"
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
      RMDir /r "$LOCALAPPDATA\${APP_ID}"
      RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"
      ; 提示用户清理结果
      MessageBox MB_OK|MB_ICONINFORMATION "已清理个人数据。$\r$\n$\r$\n如需重装应用，所有数据均已清除。"
      Goto anke_uninst_done

    anke_uninst_keep_data:
      ; 保留数据，提示用户数据保留路径
      MessageBox MB_OK|MB_ICONINFORMATION "已保留个人数据。$\r$\n$\r$\n主路径：$INSTDIR\data$\r$\n（v3.2+ 扁平化后，所有数据都在此目录下）"
      Goto anke_uninst_done

    anke_uninst_done:
  ${EndIf}
!macroend

!endif
