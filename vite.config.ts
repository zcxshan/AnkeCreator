import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { buildCsp } from './electron/securityPolicy'

/**
 * 生产构建把 CSP 写进 index.html。
 * Electron 的 webRequest 不拦截 file://，因此 meta 是唯一可靠的注入点；
 * 开发模式不注入，避免破坏 Vite HMR 的内联脚本。
 */
function cspPlugin() {
  return {
    name: 'anke-csp-meta',
    apply: 'build' as const,
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp() },
          injectTo: 'head-prepend' as const,
        },
      ]
    },
  }
}

export default defineConfig({
  // Electron 生产模式用 loadFile 加载 dist/index.html（file:// 协议），
  // base 设为 './' 让所有资源用相对路径解析（避免 /xxx 解析到文件系统根）。
  // dev 模式下 Vite 会忽略此值，BASE_URL 仍为 '/'，由 dev server 正常映射。
  base: './',
  plugins: [
    react(),
    cspPlugin(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) {
          args.startup(['.', '--no-sandbox', '--remote-debugging-port=9222'])
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@electron': path.resolve(__dirname, 'electron'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
