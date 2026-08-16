/**
 * R1 组件级回归测试：EditorCanvas 挂载 currentPage±1 多页时，全部可见页均渲染成功。
 * 验证完整链路：PageOverlay effect → usePdf.renderPage → PdfDocument 多页并发渲染互不取消。
 * 取舍说明：jsdom 无真实 canvas 绘制能力，「可见内容」无法断言，此处以
 * 「每个可见页的 canvas 均被写入渲染结果尺寸（canvas.width > 0）」作为代理断言；
 * 真实视觉冒烟建议在浏览器/Electron e2e 阶段补充。
 */
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfDocument } from '../src/core/pdf/PdfDocument';
import { setActivePdfDocForTest } from '../src/hooks/usePdf';
import { useEditorStore } from '../src/store/useEditorStore';
import { EditorCanvas } from '../src/components/editor/EditorCanvas';
import type { PdfDocumentState } from '../src/core/types';

// 可控渲染任务（与 pdf-render.test.ts 同构，供组件链路驱动）
const h = vi.hoisted(() => {
  interface TaskEntry {
    pageIndex: number;
    cancelled: boolean;
    resolve: () => void;
    reject: (err: unknown) => void;
    cancel: () => void;
  }
  const calls: TaskEntry[] = [];
  const makePage = (pageIndex: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 300 * scale, rotation: 0 }),
    getTextContent: () => Promise.resolve({ items: [] }),
    render: () => {
      let resolve!: () => void;
      let reject!: (err: unknown) => void;
      const entry: TaskEntry = {
        pageIndex,
        cancelled: false,
        resolve: () => resolve(),
        reject: (err: unknown) => reject(err),
        cancel: () => {
          if (entry.cancelled) return;
          entry.cancelled = true;
          const err = new Error('Rendering cancelled') as Error & { name: string };
          err.name = 'RenderingCancelledException';
          reject(err);
        },
      };
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      calls.push(entry);
      return { promise, cancel: entry.cancel };
    },
  });
  const pages = [makePage(0), makePage(1), makePage(2)];
  return {
    calls,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: (n: number) => Promise.resolve(pages[n - 1]),
        destroy: () => Promise.resolve(),
      }),
    }),
  };
});

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: h.getDocument,
}));

function makeDoc(): PdfDocumentState {
  return {
    id: 'doc-test',
    fileName: 't.pdf',
    originalBytes: new ArrayBuffer(0),
    pageCount: 3,
    pages: Array.from({ length: 3 }, (_, i) => ({ index: i, widthPt: 200, heightPt: 300, rotation: 0 })),
    loadedAt: 0,
  };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('R1 组件级：EditorCanvas 多页并发渲染', () => {
  beforeEach(() => {
    h.calls.length = 0;
    // jsdom 无 canvas 2D：renderPage 需要非空 ctx；PageOverlay 的 drawImage 为 no-op（jsdom 不支持绘制）
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (...args: unknown[]) => unknown };
    proto.getContext = () => ({ drawImage: () => undefined });
    // ResizeObserver（EditorCanvas fit 宽度）/ IntersectionObserver（缩略图懒加载）在 jsdom 缺失
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    vi.stubGlobal('IntersectionObserver', IO);
    // 重置编辑器 store 与活跃文档
    useEditorStore.getState().reset();
    setActivePdfDocForTest(null);
  });

  it('currentPage=1 时可见页 0/1/2 全部渲染成功（互不取消，canvas 均写入结果尺寸）', async () => {
    const doc = new PdfDocument();
    await doc.load({
      name: 't.pdf',
      size: 8,
      type: 'application/pdf',
      read: async () => new TextEncoder().encode('%PDF-1.7').buffer as ArrayBuffer,
      save: async () => undefined,
    });
    setActivePdfDocForTest(doc);
    useEditorStore.getState().setDoc(makeDoc());
    useEditorStore.getState().setCurrentPage(1); // 可见窗口 = 页 0/1/2

    render(<EditorCanvas />);
    await flush();
    // 三个可见页均发起渲染任务，且互不取消
    expect(h.calls.length).toBe(3);
    expect(h.calls.map((c) => c.pageIndex).sort()).toEqual([0, 1, 2]);
    expect(h.calls.every((c) => !c.cancelled)).toBe(true);

    // 乱序完成
    act(() => h.calls[1].resolve());
    await flush();
    act(() => h.calls[0].resolve());
    act(() => h.calls[2].resolve());

    await waitFor(() => {
      const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
      expect(canvases.length).toBe(3);
      // 每个可见页 canvas 均被写入渲染结果（width=200，scale=1）
      const widths = Array.from(canvases).map((c) => c.width);
      expect(widths).toEqual([200, 200, 200]);
    });
    doc.dispose();
  });
});
