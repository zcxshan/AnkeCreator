; ============================================================
; NSIS 自定义安装 / 卸载脚本
;
; 作用：卸载时弹出确认对话框，让用户选择是否一并清理个人数据
;
; 触发条件：package.json -> build.nsis.include
;
; 卸载行为（仅 Windows + 仅非静默卸载时生效）：
;   1. 显示 MessageBox（默认 Yes / MB_DEFBUTTON1）
;      「是否同时删除所有个人数据（作品、世界观、人物、图片）？」
;      「点「否」可保留数据，下次重装自动恢复」
;   2. 选 Yes → 递归删除安装路径下的 data\ 目录（含 AnkeCreatorData + images），
;               兜底清理 $APPDATA 和 $LOCALAPPDATA 下的 appId/productName 目录
;               （兼容老版本未迁移的用户数据）
;   3. 选 No  → 保留所有数据，下次重装自动恢复
;
; 数据存储位置（v3.0+）：
;   主位置：$INSTDIR\data\AnkeCreatorData\  +  $INSTDIR\data\images\
;   旧位置：$APPDATA\com.shanshian.ankecreator\AnkeCreatorData\（v3.0 前）
;
; 关联配置：package.json -> build.nsis.deleteAppDataOnUninstall = false
;           （必须为 false，本脚本才能接管清理逻辑）
; ============================================================

!ifndef ANKE_INSTALLER_NSH_INCLUDED
!define ANKE_INSTALLER_NSH_INCLUDED

!macro customInstall
  ; 安装阶段暂无自定义逻辑
!macroend

!macro customUninstall
  ; 静默卸载（无人值守场景）跳过询问，按"不删除个人数据"处理
  ${IfNot} ${Silent}
    ; 默认 Yes（MB_DEFBUTTON1）— 用户通常期望卸载即清干净
    ; 同时显示问号图标
    MessageBox MB_YESNO|MB_DEFBUTTON1|MB_ICONQUESTION "是否同时删除所有个人数据？$\r$\n$\r$\n将清理：作品、世界观、人物、图片、NGA 登录 Cookie 等$\r$\n如点「否」，数据将保留在安装路径，下次重装自动恢复" IDYES anke_uninst_delete_data IDNO anke_uninst_keep_data

    anke_uninst_delete_data:
      ; 1) 主清理：递归删除安装路径下的 data 目录
      ;    （含 AnkeCreatorData/ + images/ + 迁移标记文件）
      RMDir /r "$INSTDIR\data"
      ; 2) 兜底：仍清理 $APPDATA 和 $LOCALAPPDATA 下的 appId 和 productName 目录
      ;    兼容 v3.0 之前未迁移到新位置的老用户数据
      RMDir /r "$APPDATA\${APP_ID}"
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
      RMDir /r "$LOCALAPPDATA\${APP_ID}"
      RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"
      ; 提示用户清理结果（避免被卸载器主静默弹窗覆盖）
      MessageBox MB_OK|MB_ICONINFORMATION "已清理个人数据。$\r$\n$\r$\n如需重装应用，所有数据均已清除。"
      Goto anke_uninst_done

    anke_uninst_keep_data:
      ; 不删除数据，提示用户数据保留路径
      MessageBox MB_OK|MB_ICONINFORMATION "已保留个人数据。$\r$\n$\r$\n主路径：$INSTDIR\data$\r$\n（如有 v3.0 之前的旧数据：$APPDATA\${APP_ID}）"
      Goto anke_uninst_done

    anke_uninst_done:
  ${EndIf}
!macroend

!endif
