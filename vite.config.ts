import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

export default defineConfig({
  // Electron 生产模式用 loadFile 加载 dist/index.html（file:// 协议），
  // base 设为 './' 让所有资源用相对路径解析（避免 /xxx 解析到文件系统根）。
  // dev 模式下 Vite 会忽略此值，BASE_URL 仍为 '/'，由 dev server 正常映射。
  base: './',
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
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
