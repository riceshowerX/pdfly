#!/usr/bin/env node
/**
 * 构建期下载 Noto Sans SC 子集（OFL 协议）用于中文导出嵌入。
 * - 已存在且大小合理则跳过；
 * - 多镜像重试（jsDelivr / GitHub raw）；
 * - 网络不可用时静默降级（退出码 0，不阻塞 npm install），导出中文时 UI 会提示字体缺失。
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.join(__dirname, '..', 'src', 'assets', 'fonts');
const targetFile = path.join(targetDir, 'NotoSansSC-Regular.otf');

const SOURCES = [
  'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
  'https://gcore.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
  'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function tryFetch(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  try {
    if (await exists(targetFile)) {
      console.log('[fetch-font] 字体已存在，跳过下载：' + targetFile);
      return;
    }
    await mkdir(targetDir, { recursive: true });
    for (const url of SOURCES) {
      console.log('[fetch-font] 尝试下载：' + url);
      const buf = await tryFetch(url);
      if (buf && buf.length > 100_000) {
        await writeFile(targetFile, buf);
        console.log(`[fetch-font] 下载成功：${targetFile}（${(buf.length / 1024 / 1024).toFixed(2)} MB）`);
        return;
      }
    }
    console.warn('[fetch-font] 所有镜像均不可用。将使用 Helvetica 回退；导出中文时应用会提示字体缺失。');
  } catch (err) {
    console.warn('[fetch-font] 字体下载失败（不影响安装）：' + (err instanceof Error ? err.message : String(err)));
  }
}

void main();
