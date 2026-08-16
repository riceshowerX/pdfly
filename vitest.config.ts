import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

function r(p: string): string {
  return fileURLToPath(new URL(p, import.meta.url));
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: r('src') },
      // 精确匹配 worker 的 ?url 动态导入（正则可匹配带 query 的完整 id）。
      // legacy 构建同样提供 worker 文件；测试环境 ensureWorker 不执行（无 Worker）。
      { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs(\?url)?$/, replacement: r('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs') },
      // 测试环境（Node/jsdom）使用 legacy 构建以支持主线程 fake worker
      { find: 'pdfjs-dist', replacement: r('node_modules/pdfjs-dist/legacy/build/pdf.mjs') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
  },
});
