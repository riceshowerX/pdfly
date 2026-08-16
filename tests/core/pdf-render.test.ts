/**
 * R1 回归测试：PdfDocument 多页并发渲染互不干扰。
 * jsdom 无真实 canvas/worker，故 mock pdfjs-dist 提供可控渲染任务：
 * - 不同页并发 renderPage 互不取消（编辑器 currentPage±1 同时挂载）；
 * - 同页重渲染仅取消该页旧任务（缩放/翻页时「最新胜出」）；
 * - cancelRender/dispose 取消全部页任务。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfDocument } from '../../src/core/pdf/PdfDocument';

// 可控渲染任务集合（vi.hoisted 供 mock 工厂与测试共享）
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

function makeHandle(): Parameters<PdfDocument['load']>[0] {
  return {
    name: 'sample.pdf',
    size: 8,
    type: 'application/pdf',
    read: async () => new TextEncoder().encode('%PDF-1.7').buffer as ArrayBuffer,
    save: async () => undefined,
  };
}

/** 刷新微任务/宏任务，确保异步 renderPage 推进到任务创建。 */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('PdfDocument R1 并发渲染', () => {
  beforeEach(() => {
    h.calls.length = 0;
    // jsdom 无 canvas 2D 实现：注入假 ctx 使 renderPage 走到 page.render
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (...args: unknown[]) => unknown };
    proto.getContext = () => ({});
  });

  it('不同页并发渲染互不取消（编辑器 currentPage±1 同时挂载）', async () => {
    const doc = new PdfDocument();
    await doc.load(makeHandle());
    const p0 = doc.renderPage(0, 1);
    const p1 = doc.renderPage(1, 1);
    await flush();
    // 两页任务都创建且均未被对方取消
    expect(h.calls.length).toBe(2);
    expect(h.calls.map((c) => c.pageIndex)).toEqual([0, 1]);
    expect(h.calls[0].cancelled).toBe(false);
    expect(h.calls[1].cancelled).toBe(false);
    // 各自完成后均成功返回 canvas
    h.calls[0].resolve();
    h.calls[1].resolve();
    const [c0, c1] = await Promise.all([p0, p1]);
    expect(c0.width).toBeGreaterThan(0);
    expect(c1.width).toBeGreaterThan(0);
    doc.dispose();
  });

  it('同页重渲染仅取消该页旧任务（最新胜出）', async () => {
    const doc = new PdfDocument();
    await doc.load(makeHandle());
    // 立即挂接 catch，避免旧任务被取消后产生 unhandled rejection
    const pOld = doc.renderPage(0, 1).catch((err: unknown) => err);
    const pNew = doc.renderPage(0, 2);
    await flush();
    expect(h.calls.length).toBe(2);
    expect(h.calls[0].pageIndex).toBe(0);
    expect(h.calls[0].cancelled).toBe(true); // 同页旧任务被取消
    expect(h.calls[1].cancelled).toBe(false);
    h.calls[1].resolve();
    const c = await pNew;
    expect(c.width).toBeGreaterThan(0);
    const oldErr = await pOld;
    expect(oldErr).toMatchObject({ errCode: 'CONVERT_CANCELLED' });
    doc.dispose();
  });

  it('cancelRender 取消全部页任务', async () => {
    const doc = new PdfDocument();
    await doc.load(makeHandle());
    const p0 = doc.renderPage(0, 1).catch((err: unknown) => err);
    const p1 = doc.renderPage(1, 1).catch((err: unknown) => err);
    await flush();
    doc.cancelRender();
    expect(h.calls[0].cancelled).toBe(true);
    expect(h.calls[1].cancelled).toBe(true);
    expect(await p0).toMatchObject({ errCode: 'CONVERT_CANCELLED' });
    expect(await p1).toMatchObject({ errCode: 'CONVERT_CANCELLED' });
    doc.dispose();
  });

  it('编辑器 currentPage±1 三页并发渲染全部成功（贴近真实调用模式，乱序完成不互相取消）', async () => {
    const doc = new PdfDocument();
    await doc.load(makeHandle());
    // 编辑器可见窗口：currentPage=1 → 页 0/1/2 同时挂载，各自 effect 顺序发起 renderPage
    const renders = [doc.renderPage(0, 1), doc.renderPage(1, 1), doc.renderPage(2, 1)];
    await flush();
    expect(h.calls.length).toBe(3);
    expect(h.calls.map((c) => c.pageIndex)).toEqual([0, 1, 2]);
    expect(h.calls.every((c) => !c.cancelled)).toBe(true);
    // 乱序完成：页 1 先完成、页 0 次之、页 2 最后——任何一页完成都不应取消其他页任务
    h.calls[1].resolve();
    await flush();
    expect(h.calls[0].cancelled).toBe(false);
    expect(h.calls[2].cancelled).toBe(false);
    h.calls[0].resolve();
    await flush();
    expect(h.calls[2].cancelled).toBe(false);
    h.calls[2].resolve();
    const canvases = await Promise.all(renders);
    expect(canvases.map((c) => c.width)).toEqual([200, 200, 200]);
    doc.dispose();
  });

  it('渲染完成后同页重渲染只新建一个任务（Map 残留清理，不误取消新任务）', async () => {
    const doc = new PdfDocument();
    await doc.load(makeHandle());
    const first = doc.renderPage(0, 1);
    await flush();
    h.calls[0].resolve();
    await first;
    expect(h.calls[0].cancelled).toBe(false);
    // 首次渲染完成后，同页再次渲染：应仅新增一个任务且不被取消
    const second = doc.renderPage(0, 2);
    await flush();
    expect(h.calls.length).toBe(2);
    expect(h.calls[1].pageIndex).toBe(0);
    expect(h.calls[1].cancelled).toBe(false);
    h.calls[1].resolve();
    const c = await second;
    expect(c.width).toBe(400); // scale=2 → 200*2
    doc.dispose();
  });
});
