import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/** 将项目内相对路径转为绝对路径（ESM 环境下的 __dirname 等价物）。 */
function r(p: string): string {
  return fileURLToPath(new URL(p, import.meta.url));
}

export default defineConfig({
  // 相对 base，保证 Electron 以 file:// 协议加载构建产物时资源路径正确
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': r('src'),
    },
  },
  build: {
    outDir: 'dist-web',
    // 沙箱环境禁止批量删除，改为构建前脚本手动清理（见 scripts/clean-dist.mjs），此处不自动清空
    emptyOutDir: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    host: true,
  },
});
