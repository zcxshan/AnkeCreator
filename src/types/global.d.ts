// 渲染层可见的 preload 桥接类型。
// 说明：preload.ts 属于 electron 编译项目，渲染层无法直接引用其 global 声明；
// 这里声明 Window 上的桥接对象，保证渲染层类型检查可以通过。
// 桥接对象的具体方法仍由 preload.ts / IPC 实现约束，后续可逐步替换为精确接口。

export {}

interface ElectronBridge {
  [key: string]: any
}

declare global {
  interface Window {
    electronAPI: ElectronBridge
    dbAPI: ElectronBridge
    appAPI: ElectronBridge
    dataAPI: ElectronBridge
    wheelAPI: ElectronBridge
    windowAPI: ElectronBridge
  }
}
