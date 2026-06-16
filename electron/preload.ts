import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  selectImage: () => ipcRenderer.invoke('image:select'),
  saveImage: (dataUrl: string) => ipcRenderer.invoke('image:save', dataUrl),
  platform: process.platform,
})

export interface ElectronAPI {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  selectImage: () => Promise<string | null>
  saveImage: (dataUrl: string) => Promise<string | null>
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
