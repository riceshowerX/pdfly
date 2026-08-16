/**
 * 通用工具：文件/Blob/下载/文件名/防抖/页范围解析等。
 * 平台无关，供 core 与 UI 共用。
 */
import { saveAs } from 'file-saver';
import { PdfEditorError } from './types';

let uidCounter = 0;

/** 生成会话内唯一 id。 */
export function uid(prefix = 'id'): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 数字零填充。 */
export function padNumber(n: number, width = 3): string {
  return String(n).padStart(width, '0');
}

/** 去除文件扩展名得到基础名。 */
export function baseName(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

/** 提取小写扩展名（含点），无扩展名返回 ''。 */
export function extName(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/** 是否为 PDF 字节（校验 %PDF- 魔数）。 */
export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  return head === '%PDF-';
}

/** 字符串是否包含 CJK（中日韩）字符。 */
export function isCjkText(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

/** File → ArrayBuffer。 */
export function fileToArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/** ArrayBuffer → Blob。 */
export function arrayBufferToBlob(bytes: ArrayBuffer, type = 'application/octet-stream'): Blob {
  return new Blob([bytes], { type });
}

/** Uint8Array → Blob。 */
export function uint8ArrayToBlob(bytes: Uint8Array, type = 'application/octet-stream'): Blob {
  return new Blob([bytes as unknown as BlobPart], { type });
}

/** dataURL → Uint8Array。 */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new PdfEditorError('UNSUPPORTED_IMAGE', '无效的图片数据');
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/** dataURL 是否为 JPEG。 */
export function isJpegDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg');
}

/** 字节 → dataURL（PNG）。 */
export function bytesToPngDataUrl(bytes: Uint8Array): Promise<string> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/** Blob → dataURL。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Blob 转 dataURL 失败'));
    reader.readAsDataURL(blob);
  });
}

/** 触发浏览器下载（Web 端 file-saver）。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  saveAs(blob, fileName);
}

/** 从 ArrayBuffer 下载。 */
export function downloadBytes(bytes: ArrayBuffer, fileName: string, type = 'application/octet-stream'): void {
  downloadBlob(arrayBufferToBlob(bytes, type), fileName);
}

/** 格式化字节数。 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 防抖。 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}

/**
 * 解析页范围字符串为 0-based 页索引数组。
 * 支持 'all'、'1-5,7'、'3'；索引越界会被忽略；格式非法抛 PdfEditorError。
 */
export function parsePageRange(range: string, total: number): number[] {
  if (total <= 0) return [];
  const trimmed = range.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    return Array.from({ length: total }, (_, i) => i);
  }
  const result = new Set<number>();
  const parts = trimmed.split(',');
  for (const part of parts) {
    const seg = part.trim();
    if (!seg) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(seg);
    if (!m) {
      throw new PdfEditorError('PAGE_OUT_OF_RANGE', `无法识别的页范围：${part}`);
    }
    const start = parseInt(m[1], 10);
    const endRaw = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || endRaw < 1 || start > endRaw) {
      throw new PdfEditorError('PAGE_OUT_OF_RANGE', `页范围非法：${part}`);
    }
    // 越界索引忽略（与原语义一致）；范围 end 钳制到文档页数，避免超大范围（如 1-99999999）空转卡死
    if (start > total) continue;
    const end = Math.min(endRaw, total);
    for (let p = start; p <= end; p += 1) {
      result.add(p - 1);
    }
  }
  if (result.size === 0) {
    throw new PdfEditorError('PAGE_OUT_OF_RANGE', '页范围超出文档页数');
  }
  return [...result].sort((a, b) => a - b);
}

/** 文件大小是否触发 Web 端大文件提示（>100MB）。 */
export function isLargeFile(size: number): boolean {
  return size > 100 * 1024 * 1024;
}
