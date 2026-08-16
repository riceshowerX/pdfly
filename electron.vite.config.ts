import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/** 将项目内相对路径转为绝对路径（ESM 环境下的 __dirname 等价物）。 */
function r(p: string): string {
  return fileURLToPath(new URL(p, import.meta.url));
}

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: r('electron/main/index.ts'),
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: r('electron/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: r('index.html'),
      },
    },
    resolve: {
      alias: {
        '@': r('src'),
      },
    },
    plugins: [react()],
  },
});
