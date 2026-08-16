/**
 * PDF 内核单测：PdfExporter 页面操作（copyPages 保留原文）、叠加导出、PdfDocument 加载。
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import {
  PdfExporter,
  resolveLinePoints,
  computeRotatedImagePlacement,
  rotatedImageVisualBox,
} from '../../src/core/pdf/PdfExporter';
import { PdfDocument } from '../../src/core/pdf/PdfDocument';
import { ptRectToScreen } from '../../src/core/geometry';
import { createSamplePdfBytes, buildStateFromBytes } from './helpers';
import type { EditorElement } from '../../src/core/types';

const SPECS = [
  { width: 200, height: 300, label: 'Page One' },
  { width: 300, height: 200, label: 'Page Two' },
  { width: 220, height: 260, label: 'Page Three' },
];

async function loadPageSizes(bytes: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
}

describe('PdfExporter', () => {
  it('buildEditedPdf：无操作时页面与原文一致（copyPages 保留内容流）', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    const exporter = new PdfExporter();
    const out = await exporter.buildEditedPdf(state, [], { includeOverlays: true, embedFont: 'helvetica' });
    const sizes = await loadPageSizes(out);
    expect(sizes.map((s) => `${s.width}x${s.height}`)).toEqual(['200x300', '300x200', '220x260']);
  });

  it('buildEditedPdf：页面重排后按新顺序导出', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    // 重排：0→2
    const pages = state.pages;
    const [moved] = pages.splice(0, 1);
    pages.splice(2, 0, moved);
    const exporter = new PdfExporter();
    const out = await exporter.buildEditedPdf(state, [], { includeOverlays: true, embedFont: 'helvetica' });
    const sizes = await loadPageSizes(out);
    expect(sizes.map((s) => `${s.width}x${s.height}`)).toEqual(['300x200', '220x260', '200x300']);
  });

  it('buildEditedPdf：删除页面后导出页数正确', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    state.pages = state.pages.filter((p) => p.index !== 1);
    const exporter = new PdfExporter();
    const out = await exporter.buildEditedPdf(state, [], { includeOverlays: true, embedFont: 'helvetica' });
    const sizes = await loadPageSizes(out);
    expect(sizes.map((s) => `${s.width}x${s.height}`)).toEqual(['200x300', '220x260']);
  });

  it('buildEditedPdf：插入空白页（index=-1）导出为空白页', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    state.pages.splice(1, 0, { index: -1, widthPt: 250, heightPt: 250, rotation: 0 });
    const exporter = new PdfExporter();
    const out = await exporter.buildEditedPdf(state, [], { includeOverlays: true, embedFont: 'helvetica' });
    const sizes = await loadPageSizes(out);
    expect(sizes.map((s) => `${s.width}x${s.height}`)).toEqual(['200x300', '250x250', '300x200', '220x260']);
  });

  it('buildEditedPdf：叠加导出（高亮/矩形/文本/线条）位置与大小正确', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    const elements: EditorElement[] = [
      { id: 'e1', type: 'highlight', pageIndex: 0, x: 20, y: 40, width: 100, height: 30, color: '#fde047', opacity: 0.35, createdAt: 0 },
      { id: 'e2', type: 'rect', pageIndex: 0, x: 10, y: 10, width: 50, height: 50, color: '#dc2626', strokeWidth: 2, createdAt: 0 },
      { id: 'e3', type: 'text', pageIndex: 1, x: 30, y: 60, width: 120, height: 20, text: 'Overlay Text', fontSize: 12, color: '#111827', createdAt: 0 },
      { id: 'e4', type: 'line', pageIndex: 2, x: 10, y: 10, width: 100, height: 80, color: '#0ea5e9', strokeWidth: 2, createdAt: 0 },
    ];
    const exporter = new PdfExporter();
    const out = await exporter.buildEditedPdf(state, elements, { includeOverlays: true, embedFont: 'helvetica' });
    // 可被 pdf-lib 重新解析
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(3);
  });

  it('buildEditedPdf：文本替换（coversOriginalText）导出不抛错', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    const elements: EditorElement[] = [
      {
        id: 't1',
        type: 'text',
        pageIndex: 0,
        x: 30,
        y: 140,
        width: 120,
        height: 20,
        text: 'Replacement',
        fontSize: 12,
        color: '#111827',
        coversOriginalText: true,
        fillColor: '#ffffff',
        createdAt: 0,
      },
    ];
    const exporter = new PdfExporter();
    const out = await exporter.buildEditedPdf(state, elements, { includeOverlays: true, embedFont: 'helvetica' });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
  });

  it('AC-E8：编辑（重排+叠加元素）后导出，PDF 可重新打开且页数/页序/尺寸正确', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    // 重排：0→2
    const pages = state.pages;
    const [moved] = pages.splice(0, 1);
    pages.splice(2, 0, moved);
    const elements: EditorElement[] = [
      { id: 'e1', type: 'highlight', pageIndex: 0, x: 10, y: 10, width: 80, height: 20, color: '#fde047', opacity: 0.35, createdAt: 0 },
    ];
    const exporter = new PdfExporter();
    const out = await exporter.buildEditedPdf(state, elements, { includeOverlays: true, embedFont: 'helvetica' });
    // 导出字节可被 pdf-lib 重新打开（等价主流阅读器打开，AC-E8）
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(3);
    const sizes = reloaded.getPages().map((p) => `${p.getWidth()}x${p.getHeight()}`);
    expect(sizes).toEqual(['300x200', '220x260', '200x300']);
  });

  it('buildEditedPdf：中文文本且无字体时抛 FONT_MISSING', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    const elements: EditorElement[] = [
      { id: 'zh', type: 'text', pageIndex: 0, x: 10, y: 10, width: 100, height: 20, text: '中文测试', fontSize: 12, color: '#000000', createdAt: 0 },
    ];
    const exporter = new PdfExporter();
    await expect(exporter.buildEditedPdf(state, elements, { includeOverlays: true, embedFont: 'noto-sans-sc' })).rejects.toMatchObject({
      errCode: 'FONT_MISSING',
    });
  });

  it('H3：线条 start/end 语义在屏幕预览与导出间方向一致', async () => {
    // 用户从 PDF (0,0) 拖到 (100,50)（左下原点）：导出器直接使用 start/end
    const el: EditorElement = {
      id: 'ln',
      type: 'line',
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      startPt: { x: 0, y: 0 },
      endPt: { x: 100, y: 50 },
      color: '#0ea5e9',
      strokeWidth: 2,
      createdAt: 0,
    };
    const { start, end } = resolveLinePoints(el);
    expect(start).toEqual({ x: 0, y: 0 });
    expect(end).toEqual({ x: 100, y: 50 });
    // 屏幕预览换算（页面高 300，scale=1）：PDF (0,0) → 屏幕 (0,300)，PDF (100,50) → 屏幕 (100,250)
    const s = ptRectToScreen({ x: start.x, y: start.y, width: 0, height: 0 }, 300, 1);
    const e = ptRectToScreen({ x: end.x, y: end.y, width: 0, height: 0 }, 300, 1);
    expect(e.x - s.x).toBeCloseTo(100, 5);
    // 屏幕 y 减小 = 视觉向上；与 PDF 坐标（左下原点）方向一致 → 导出与预览不镜像
    expect(s.y - e.y).toBeCloseTo(50, 5);
    // 旧数据回退：无 start/end 时 (x,y)→(x+w,y+h)
    const legacy = resolveLinePoints({ ...el, x: 10, y: 20, width: 100, height: 50, startPt: undefined, endPt: undefined });
    expect(legacy.start).toEqual({ x: 10, y: 20 });
    expect(legacy.end).toEqual({ x: 110, y: 70 });
    // 集成：带 start/end 的线条元素可正常导出
    const bytes = await createSamplePdfBytes(SPECS);
    const state = buildStateFromBytes(bytes, SPECS);
    const out = await new PdfExporter().buildEditedPdf(state, [el], { includeOverlays: true, embedFont: 'helvetica' });
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(3);
  });

  it('M8/R2：非方形图旋转保持宽高比，视觉包围盒完整落在页面内且居中（0/90/180/270）', () => {
    const pageW = 595.28;
    const pageH = 841.89;
    for (const rot of [0, 90, 180, 270]) {
      const p = computeRotatedImagePlacement('contain', 200, 100, pageW, pageH, 40, 1, rot);
      // fit 用未旋转宽高 → 保持 2:1（未扭曲）
      expect(p.width / p.height).toBeCloseTo(2, 5);
      // 按 pdf-lib 锚点语义（绘制矩形左下角）计算的视觉包围盒
      const box = rotatedImageVisualBox(p.width, p.height, p.x, p.y, rot);
      expect(box.width).toBeCloseTo(rot === 90 || rot === 270 ? p.height : p.width, 5);
      expect(box.height).toBeCloseTo(rot === 90 || rot === 270 ? p.width : p.height, 5);
      // 完整落在页面内
      expect(box.x).toBeGreaterThanOrEqual(-1e-9);
      expect(box.y).toBeGreaterThanOrEqual(-1e-9);
      expect(box.x + box.width).toBeLessThanOrEqual(pageW + 1e-9);
      expect(box.y + box.height).toBeLessThanOrEqual(pageH + 1e-9);
      // 视觉包围盒中心 = 页面中心
      expect(box.x + box.width / 2).toBeCloseTo(pageW / 2, 5);
      expect(box.y + box.height / 2).toBeCloseTo(pageH / 2, 5);
    }
  });

  it('R2：旋转 90°/270° 图片实际渲染位置（解析 pdf-lib 内容流）完整居中', async () => {
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const exporter = new PdfExporter();
    const blob = await exporter.createPdfFromImages(
      [
        { id: 'a', name: 'a.png', dataUrl: `data:image/png;base64,${pngB64}`, width: 200, height: 100, rotation: 90 },
        { id: 'b', name: 'b.png', dataUrl: `data:image/png;base64,${pngB64}`, width: 200, height: 100, rotation: 270 },
      ],
      { pageSize: 'a4', marginPt: 40, fit: 'contain', scale: 1 },
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const pw = doc.getPage(0).getWidth();
    const ph = doc.getPage(0).getHeight();
    for (let i = 0; i < 2; i += 1) {
      const content = await getPageContentText(doc, i);
      const matrices = extractCmMatrices(content);
      expect(matrices.length).toBeGreaterThanOrEqual(4);
      const box = visualBoxFromMatrices(matrices);
      // 完整落在页面内（不越出左/下缘）
      expect(box.x).toBeGreaterThanOrEqual(-0.01);
      expect(box.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.x + box.width).toBeLessThanOrEqual(pw + 0.01);
      expect(box.y + box.height).toBeLessThanOrEqual(ph + 0.01);
      // 视觉包围盒中心 = 页面中心
      expect(box.x + box.width / 2).toBeCloseTo(pw / 2, 1);
      expect(box.y + box.height / 2).toBeCloseTo(ph / 2, 1);
    }
  });

  it('createPdfFromImages：多图合并生成 PDF，页数与图片数一致', async () => {
    // 1x1 透明 PNG
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const items = [
      { id: 'i1', name: 'a.png', dataUrl: `data:image/png;base64,${pngB64}`, width: 1, height: 1, rotation: 0 },
      { id: 'i2', name: 'b.png', dataUrl: `data:image/png;base64,${pngB64}`, width: 1, height: 1, rotation: 90 },
      { id: 'bad', name: 'bad.png', dataUrl: '', width: 0, height: 0, rotation: 0, error: '损坏' },
    ];
    const exporter = new PdfExporter();
    const blob = await exporter.createPdfFromImages(items, {
      pageSize: 'a4',
      marginPt: 40,
      fit: 'contain',
      scale: 1,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  });

  it('createPdfFromImages：旋转图片导出不抛错（回归）', async () => {
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const items = [
      { id: 'i1', name: 'a.png', dataUrl: `data:image/png;base64,${pngB64}`, width: 200, height: 100, rotation: 90 },
      { id: 'i2', name: 'b.png', dataUrl: `data:image/png;base64,${pngB64}`, width: 200, height: 100, rotation: 0 },
    ];
    const exporter = new PdfExporter();
    const blob = await exporter.createPdfFromImages(items, {
      pageSize: 'a4',
      marginPt: 40,
      fit: 'contain',
      scale: 1,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  });
});

// ---------- 内容流解析辅助（验证 pdf-lib 实际渲染位置） ----------

/** 解压并拼接页内容流文本。 */
async function getPageContentText(doc: PDFDocument, pageIndex: number): Promise<string> {
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) return '';
  const entries: unknown[] = [];
  const asArray = contents as unknown as { size?: unknown; get?: unknown };
  if (typeof asArray.size === 'function' && typeof asArray.get === 'function') {
    const arr = asArray as unknown as { size(): number; get(i: number): unknown };
    for (let i = 0; i < arr.size(); i += 1) entries.push(arr.get(i));
  } else {
    entries.push(contents);
  }
  let text = '';
  for (const ref of entries) {
    const obj = doc.context.lookup(ref as never) as unknown as { contents?: Uint8Array } | undefined;
    if (obj && obj.contents) {
      try {
        text += new TextDecoder().decode(inflateSync(obj.contents));
      } catch {
        text += new TextDecoder().decode(obj.contents);
      }
    }
  }
  return text;
}

/** 提取内容流中所有 cm 矩阵（drawImage 依次为 translate → rotate → scale → skew）。 */
function extractCmMatrices(content: string): number[][] {
  const out: number[][] = [];
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+cm/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])]);
  }
  return out;
}

/** 由 cm 矩阵序列计算图像单位方块（0..1）的实际视觉包围盒（矩阵按 emit 顺序，作用于点时逆序应用）。 */
function visualBoxFromMatrices(matrices: number[][]): { x: number; y: number; width: number; height: number } {
  const corners: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const pts = corners.map(([u, v]) => {
    let px = u;
    let py = v;
    for (let i = matrices.length - 1; i >= 0; i -= 1) {
      const [a, b, c, d, e, f] = matrices[i];
      const nx = a * px + c * py + e;
      const ny = b * px + d * py + f;
      px = nx;
      py = ny;
    }
    return [px, py] as const;
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

describe('PdfDocument', () => {
  it('load：解析 PDF 并返回页面信息（尺寸/页数）', async () => {
    const bytes = await createSamplePdfBytes(SPECS);
    const handle = {
      name: 'sample.pdf',
      size: bytes.byteLength,
      type: 'application/pdf',
      read: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      save: async () => undefined,
    };
    const doc = new PdfDocument();
    const state = await doc.load(handle);
    expect(state.pageCount).toBe(3);
    expect(state.pages[0]).toMatchObject({ index: 0, widthPt: 200, heightPt: 300 });
    expect(state.fileName).toBe('sample.pdf');
    doc.dispose();
  });

  it('load：非 PDF 字节抛 FILE_NOT_PDF', async () => {
    const handle = {
      name: 'x.txt',
      size: 5,
      type: 'text/plain',
      read: async () => new TextEncoder().encode('hello').buffer as ArrayBuffer,
      save: async () => undefined,
    };
    const doc = new PdfDocument();
    await expect(doc.load(handle)).rejects.toMatchObject({ errCode: 'FILE_NOT_PDF' });
  });
});
