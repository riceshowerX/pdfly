/**
 * PdfToImageConverter：PDF → 图片转换器。
 * 支持：单页/全部页面转 PNG/JPG、DPI/分辨率/尺寸自定义、页范围、进度回调、取消、ZIP 批量打包。
 */
import JSZip from 'jszip';
import { PdfEditorError } from '../types';
import { padNumber, parsePageRange } from '../utils';
import { PdfDocument } from '../pdf/PdfDocument';
import type { ConvertResult, PdfToImageOptions } from '../types';

/** canvas 面积上限：单边 16384px、总面积约 2.2 亿像素（浏览器 canvas 安全上限）。 */
export const MAX_CANVAS_DIMENSION = 16384;
export const MAX_CANVAS_AREA = 220_000_000;

/** 校验目标渲染尺寸是否超出浏览器 canvas 上限；超出抛 EXPORT_FAILED 并提示降低 DPI/倍率。 */
export function assertCanvasSizeWithinLimit(pageWidthPt: number, pageHeightPt: number, scale: number): void {
  const w = Math.ceil(pageWidthPt * scale);
  const h = Math.ceil(pageHeightPt * scale);
  if (w > MAX_CANVAS_DIMENSION || h > MAX_CANVAS_DIMENSION || w * h > MAX_CANVAS_AREA) {
    throw new PdfEditorError(
      'EXPORT_FAILED',
      `输出尺寸过大（${w}×${h}px），超出浏览器可渲染上限。请降低 DPI 或额外倍率后重试。`,
    );
  }
}

/** 由配置计算渲染倍率（1pt → px）。 */
export function computeRenderScale(
  options: PdfToImageOptions,
  pageWidthPt: number,
  pageHeightPt: number,
): number {
  if (options.targetWidth && options.targetWidth > 0) {
    return options.targetWidth / (pageWidthPt || 1);
  }
  if (options.targetHeight && options.targetHeight > 0) {
    return options.targetHeight / (pageHeightPt || 1);
  }
  const dpiScale = (options.dpi || 72) / 72;
  const extra = options.scale && options.scale > 0 ? options.scale : 1;
  return dpiScale * extra;
}

/** canvas → Blob（JPG 强制白底）。 */
export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: 'png' | 'jpg',
  background: 'white' | 'transparent',
  quality = 0.92,
): Promise<Blob> {
  let source = canvas;
  if (format === 'jpg' || background === 'white') {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0);
      source = out;
    }
  }
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, mime, quality));
  if (!blob) {
    throw new PdfEditorError('EXPORT_FAILED', '图片编码失败');
  }
  return blob;
}

export class PdfToImageConverter {
  private cancelRequested = false;
  private currentDoc: PdfDocument | null = null;

  /** 请求取消：置标志并立即中断当前渲染页（而非仅页间协作取消）。 */
  requestCancel(): void {
    this.cancelRequested = true;
    this.currentDoc?.cancelRender();
  }

  /** 转换入口。doc 为已加载的 PdfDocument；onProgress 回调 (done, total)。 */
  async convert(
    doc: PdfDocument,
    options: PdfToImageOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ConvertResult[]> {
    this.cancelRequested = false;
    this.currentDoc = doc;
    const total = doc.pageCount;
    const indices = parsePageRange(options.pageRange, total);
    const results: ConvertResult[] = [];

    for (let k = 0; k < indices.length; k += 1) {
      if (this.cancelRequested) {
        throw new PdfEditorError('CONVERT_CANCELLED', '转换已取消');
      }
      const idx = indices[k];
      const name = `page-${padNumber(idx + 1, 3)}.${options.format}`;
      try {
        // 页尺寸用于计算目标分辨率
        const wPt = doc.pageWidthPt(idx);
        const hPt = doc.pageHeightPt(idx);
        const scale = computeRenderScale(options, wPt, hPt);
        // 面积上限校验：高 DPI×倍率 组合可能超出浏览器 canvas 上限
        assertCanvasSizeWithinLimit(wPt, hPt, scale);
        const canvas = await doc.renderPage(idx, scale);
        const blob = await canvasToBlob(canvas, options.format, options.background);
        results.push({
          pageIndex: idx,
          name,
          blob,
          url: URL.createObjectURL(blob),
          status: 'ok',
        });
      } catch (err) {
        if (this.cancelRequested) {
          throw new PdfEditorError('CONVERT_CANCELLED', '转换已取消');
        }
        const message = err instanceof Error ? err.message : '未知错误';
        results.push({
          pageIndex: idx,
          name,
          blob: new Blob(),
          url: '',
          status: 'error',
          error: message,
        });
      }
      onProgress?.(results.length, indices.length);
    }
    return results;
  }

  /** 将转换结果打包为 ZIP Blob（仅打包成功项，命名有序）。 */
  static async packZip(results: ConvertResult[], zipName = 'pdf-images.zip'): Promise<Blob> {
    const zip = new JSZip();
    for (const r of results) {
      if (r.status === 'ok') {
        zip.file(r.name, r.blob);
      }
    }
    return zip.generateAsync({ type: 'blob' });
  }
}
