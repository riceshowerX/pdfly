/**
 * ImageToPdfConverter：图片 → PDF 转换器。
 * 支持：PNG/JPG/GIF/BMP 统一解码为 PNG dataURL、拖拽排序后的顺序、页面尺寸/边距/缩放/旋转、进度与取消。
 */
import { PdfEditorError } from '../types';
import { PdfExporter } from '../pdf/PdfExporter';
import type { ImageItem, ImagePdfOptions } from '../types';

/**
 * 浏览器端解码图片文件 → { dataUrl, width, height }。
 * GIF/BMP 统一经 canvas 转为 PNG dataURL；损坏文件抛 PdfEditorError(UNSUPPORTED_IMAGE)。
 * 使用 try/finally 保证 ImageBitmap 资源始终释放（防止 drawImage/toDataURL 抛错时泄漏）。
 */
export async function decodeImageFile(file: File | Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  let bitmap: { width: number; height: number; close?: () => void } | null = null;
  try {
    bitmap =
      typeof createImageBitmap === 'function' ? await createImageBitmap(file) : await loadViaImageElement(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法创建画布');
    }
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return { dataUrl, width: bitmap.width, height: bitmap.height };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    throw new PdfEditorError('UNSUPPORTED_IMAGE', `图片解码失败：${msg}`);
  } finally {
    if (bitmap && typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

/** createImageBitmap 不可用时的回退：Image 元素加载。 */
function loadViaImageElement(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法解码'));
    };
    img.src = url;
  });
}

export class ImageToPdfConverter {
  private cancelRequested = false;

  requestCancel(): void {
    this.cancelRequested = true;
  }

  /** 转换入口：按 items 顺序生成 PDF；onProgress 回调 (done, total, failed)。 */
  async convert(
    items: ImageItem[],
    options: ImagePdfOptions,
    onProgress?: (done: number, total: number, failed: number) => void,
  ): Promise<Blob> {
    this.cancelRequested = false;
    const exporter = new PdfExporter();
    const valid = items.filter((it) => !it.error && it.dataUrl);
    const total = valid.length;
    const usable: ImageItem[] = [];
    let done = 0;
    for (const item of valid) {
      if (this.cancelRequested) {
        throw new PdfEditorError('CONVERT_CANCELLED', '生成已取消');
      }
      usable.push(item);
      done += 1;
      onProgress?.(done, total, 0);
    }
    // 每张图一页；损坏项在导出器内被跳过（不影响其他图片）
    return exporter.createPdfFromImages(usable, options);
  }
}
