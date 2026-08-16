/**
 * PdfDocument：pdf.js 封装。
 * 职责：加载 PDF、渲染页面 canvas、提取文本层、生成缩略图、释放资源。
 * 坐标：所有输出均为 PDF 点（左下原点）；屏幕换算由调用方经 geometry.ts 完成。
 */
import * as pdfjsLib from 'pdfjs-dist';
import { PdfEditorError } from '../types';
import { isPdfBytes, uid } from '../utils';
import type { FileHandle, PdfDocumentState, PdfPageInfo } from '../types';

const { getDocument, GlobalWorkerOptions } = pdfjsLib;

/** 单个文本命中项（PDF 坐标，左下原点；y 为基线）。 */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

let workerReady = false;

/**
 * 本地化 pdf.js worker（禁止 CDN）。
 * 使用 Vite 的 ?url 静态资源导入；在无 Worker 环境（Node 测试）下回退到主线程 fake worker。
 */
function ensureWorker(): void {
  if (workerReady || typeof Worker === 'undefined') return;
  workerReady = true; // 乐观置位，避免并发重复加载
  void import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    .then((m) => {
      GlobalWorkerOptions.workerSrc = (m as { default: string }).default;
    })
    .catch(() => {
      // 主线程 fake worker 回退；重置标志允许下次加载重试
      workerReady = false;
      console.warn('[pdfly] pdf.js worker 加载失败，回退主线程渲染');
    });
}

export class PdfDocument {
  private pdf: pdfjsLib.PDFDocumentProxy | null = null;
  // 按页索引管理渲染任务：多页（编辑器 currentPage±1 同时挂载）并发渲染互不干扰，
  // 同页重渲染（缩放/翻页）时仅取消该页旧任务。
  private renderTasks = new Map<number, pdfjsLib.RenderTask>();
  private thumbnailUrls: string[] = [];

  get pageCount(): number {
    return this.pdf?.numPages ?? 0;
  }

  /** 指定页宽度（PDF 点，含旋转）。 */
  pageWidthPt(index: number): number {
    const state = this.lastState;
    return state && state.pages[index] ? state.pages[index].widthPt : 595.28;
  }

  /** 指定页高度（PDF 点，含旋转）。 */
  pageHeightPt(index: number): number {
    const state = this.lastState;
    return state && state.pages[index] ? state.pages[index].heightPt : 841.89;
  }

  private lastState: PdfDocumentState | null = null;

  /** 加载 PDF 并构建文档状态。 */
  async load(handle: FileHandle): Promise<PdfDocumentState> {
    ensureWorker();
    const bytes = await handle.read();
    const data = new Uint8Array(bytes);
    if (!isPdfBytes(data)) {
      throw new PdfEditorError('FILE_NOT_PDF', `"${handle.name}" 不是有效的 PDF 文件`);
    }
    try {
      this.pdf = await getDocument({ data }).promise;
    } catch {
      throw new PdfEditorError('CORRUPT_FILE', `PDF 文件已损坏或无法解析："${handle.name}"`);
    }

    const pageCount = this.pdf.numPages;
    const pages: PdfPageInfo[] = [];
    for (let i = 0; i < pageCount; i += 1) {
      const page = await this.pdf.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        index: i,
        widthPt: viewport.width,
        heightPt: viewport.height,
        rotation: viewport.rotation,
      });
    }

    const state: PdfDocumentState = {
      id: uid('doc'),
      fileName: handle.name,
      originalBytes: bytes,
      pageCount,
      pages,
      loadedAt: Date.now(),
    };
    this.lastState = state;
    return state;
  }

  private requirePdf(): pdfjsLib.PDFDocumentProxy {
    if (!this.pdf) {
      throw new PdfEditorError('LOAD_FAILED', '文档尚未加载');
    }
    return this.pdf;
  }

  /** 取消指定页的渲染任务（如有）。 */
  private cancelPageRender(index: number): void {
    const task = this.renderTasks.get(index);
    if (task) {
      try {
        task.cancel();
      } catch {
        // 忽略取消异常（任务可能已完成）
      }
      this.renderTasks.delete(index);
    }
  }

  /** 取消进行中的全部渲染任务（翻页/缩放/转换取消/卸载时调用）。 */
  cancelRender(): void {
    for (const key of [...this.renderTasks.keys()]) {
      this.cancelPageRender(key);
    }
  }

  /** 渲染指定页到 canvas（scale 为 1pt → px 倍率）。 */
  async renderPage(index: number, scale: number): Promise<HTMLCanvasElement> {
    const pdf = this.requirePdf();
    if (index < 0 || index >= pdf.numPages) {
      throw new PdfEditorError('PAGE_OUT_OF_RANGE', `页码 ${index + 1} 超出范围`);
    }
    // 仅取消「同页」旧渲染任务（快速缩放/翻页时避免同页并发浪费资源）；
    // 不同页（编辑器多页同时挂载）互不干扰，避免整批取消导致其余页 canvas 空白（R1）
    this.cancelPageRender(index);
    const page = await pdf.getPage(index + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new PdfEditorError('LOAD_FAILED', '无法创建画布上下文');
    }
    // getPage 等待期间可能已有同页任务加入，再取消一次保证「同页最新渲染胜出」
    this.cancelPageRender(index);
    const task = page.render({ canvasContext: ctx, viewport });
    this.renderTasks.set(index, task);
    try {
      await task.promise;
    } catch (err) {
      if ((err as Error)?.name === 'RenderingCancelledException') {
        throw new PdfEditorError('CONVERT_CANCELLED', '渲染已取消');
      }
      throw new PdfEditorError('CORRUPT_FILE', '页面渲染失败');
    } finally {
      if (this.renderTasks.get(index) === task) this.renderTasks.delete(index);
    }
    return canvas;
  }

  /** 提取页面文本层（用于文本命中/编辑）。 */
  async getTextLayer(index: number): Promise<PdfTextItem[]> {
    const pdf = this.requirePdf();
    const page = await pdf.getPage(index + 1);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const transform = it.transform;
      const fontSize = Math.hypot(transform[2], transform[3]) || 1;
      items.push({
        str: it.str,
        x: transform[4],
        y: transform[5],
        width: it.width,
        height: it.height ?? fontSize,
        fontSize,
      });
    }
    return items;
  }

  /** 渲染缩略图 dataURL（PNG）。 */
  async renderThumbnail(index: number, width = 160): Promise<string> {
    const pdf = this.requirePdf();
    const page = await pdf.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = base.width > 0 ? width / base.width : 1;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new PdfEditorError('LOAD_FAILED', '无法创建画布上下文');
    }
    const task = page.render({ canvasContext: ctx, viewport });
    try {
      await task.promise;
    } catch (err) {
      // 缩略图失败不阻断主流程，但给出诊断信息并返回空标记（调用方显示占位）
      console.warn('[pdfly] 缩略图渲染失败', err);
      return '';
    }
    const url = canvas.toDataURL('image/png');
    this.thumbnailUrls.push(url);
    return url;
  }

  /** 释放文档资源与缩略图 URL。 */
  dispose(): void {
    this.cancelRender();
    for (const url of this.thumbnailUrls) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    this.thumbnailUrls = [];
    if (this.pdf) {
      void this.pdf.destroy().catch(() => {
        // 忽略销毁异常
      });
      this.pdf = null;
    }
  }
}
