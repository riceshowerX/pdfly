/**
 * usePdf：PDF 文档加载与渲染 hook。
 * 持有全局活跃 PdfDocument 单例；加载后写入 useEditorStore。
 */
import { useCallback } from 'react';
import { PdfDocument } from '../core/pdf/PdfDocument';
import { useEditorStore } from '../store/useEditorStore';
import { PdfEditorError } from '../core/types';
import type { FileHandle } from '../core/types';

let activeDoc: PdfDocument | null = null;

/** 获取当前活跃的 PdfDocument（组件渲染使用）。 */
export function getActivePdfDoc(): PdfDocument | null {
  return activeDoc;
}

export function usePdf(): {
  loadPdf: (handle: FileHandle) => Promise<PdfDocument>;
  renderPage: (index: number, scale: number) => Promise<HTMLCanvasElement>;
  renderThumbnail: (index: number, width?: number) => Promise<string>;
  getTextLayer: (index: number) => ReturnType<PdfDocument['getTextLayer']>;
  dispose: () => void;
} {
  const loadPdf = useCallback(async (handle: FileHandle): Promise<PdfDocument> => {
    const doc = new PdfDocument();
    try {
      const state = await doc.load(handle);
      activeDoc?.dispose();
      activeDoc = doc;
      useEditorStore.getState().setDoc(state);
      return doc;
    } catch (err) {
      doc.dispose();
      if (err instanceof PdfEditorError) throw err;
      throw new PdfEditorError('LOAD_FAILED', 'PDF 加载失败');
    }
  }, []);

  const renderPage = useCallback(async (index: number, scale: number): Promise<HTMLCanvasElement> => {
    if (!activeDoc) throw new PdfEditorError('LOAD_FAILED', '文档尚未加载');
    return activeDoc.renderPage(index, scale);
  }, []);

  const renderThumbnail = useCallback(async (index: number, width = 160): Promise<string> => {
    if (!activeDoc) throw new PdfEditorError('LOAD_FAILED', '文档尚未加载');
    return activeDoc.renderThumbnail(index, width);
  }, []);

  const getTextLayer = useCallback((index: number) => {
    if (!activeDoc) return Promise.resolve([]);
    return activeDoc.getTextLayer(index);
  }, []);

  const dispose = useCallback(() => {
    activeDoc?.dispose();
    activeDoc = null;
  }, []);

  return { loadPdf, renderPage, renderThumbnail, getTextLayer, dispose };
}

/** 仅供测试：设置/获取活跃文档。 */
export function setActivePdfDocForTest(doc: PdfDocument | null): void {
  activeDoc = doc;
}
