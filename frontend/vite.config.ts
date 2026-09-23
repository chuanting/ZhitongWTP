import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 部署在 /<仓库名>/ 子路径下，需要对应的 base；
// 本地和服务器部署走根路径。由 VITE_BASE 环境变量控制。
export default defineConfig(({ mode }) => {
  // loadEnv 会把 VITE_ 前缀的变量读进来，无需 @types/node
  const env = loadEnv(mode, '.', 'VITE_')
  return {
  base: env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: { '/api': { target: 'http://127.0.0.1:8010', changeOrigin: true } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
  }
})
