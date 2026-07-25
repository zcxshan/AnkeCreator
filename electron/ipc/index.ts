// ============================================================
// IPC 统一注册入口
//
// 拆分原则：每个域一个文件，main.ts 只调用 registerIpcHandlers()
// ============================================================

import { BrowserWindow, ipcMain, shell } from 'electron'
import { registerStoryIpc } from './story'
import { registerCharacterIpc } from './character'
import { registerRelationIpc } from './relation'
import { registerWorldIpc } from './world'
import { registerTemplateIpc } from './template'
import { registerOutlineIpc } from './outline'
import { registerStructureIpc } from './structure'
import { registerSystemIpc } from './system'
import { registerImageIpc } from '../imageUploader'
import { registerNgaIpc } from '../ngaCrawler'
import { registerGululuIpc } from '../gululuCrawler'
import { registerDataIpc } from '../dataManager'
import { registerSearchAnkeIpc } from '../searchAnke'
import { registerWheelIpc } from './wheel'


/** 注册所有 IPC handler
 *
 * @param getWindow 获取当前主窗口的 getter（用于窗口控制 + dialog）
 */
export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  registerStoryIpc(getWindow)
  registerCharacterIpc()
  registerRelationIpc()
  registerWorldIpc()
  registerTemplateIpc()
  registerOutlineIpc()
  registerStructureIpc()
  registerSystemIpc(getWindow)
  registerImageIpc(getWindow)
  registerNgaIpc()
  registerGululuIpc(getWindow)
  registerDataIpc(getWindow)
  registerSearchAnkeIpc()
  registerWheelIpc(getWindow)
  // 在系统浏览器打开外链
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
}
