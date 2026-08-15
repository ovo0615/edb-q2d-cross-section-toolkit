// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 固定專屬埠並開 strictPort：預設 5173/8000 很常被其他專案佔用，
// 若讓 Vite 自動遞增而啟動腳本仍開固定埠，就會開到別人的網站。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8010', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8010', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
