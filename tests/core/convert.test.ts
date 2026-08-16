/**
 * 转换单测：页范围解析、渲染倍率计算、PDF→图片 ZIP 打包、图片→PDF 生成。
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { computeRenderScale, canvasToBlob, PdfToImageConverter, assertCanvasSizeWithinLimit } from '../../src/core/convert/PdfToImage';
import { ImageToPdfConverter } from '../../src/core/convert/ImageToPdf';
import { parsePageRange } from '../../src/core/utils';
import type { ConvertResult, ImageItem, PdfToImageOptions } from '../../src/core/types';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeOptions(overrides: Partial<PdfToImageOptions> = {}): PdfToImageOptions {
  return { format: 'png', dpi: 150, pageRange: 'all', background: 'white', ...overrides };
}

describe('PDF→图片 参数计算', () => {
  it('computeRenderScale：DPI 换算与额外倍率', () => {
    expect(computeRenderScale(makeOptions({ dpi: 72 }), 200, 300)).toBeCloseTo(1, 5);
    expect(computeRenderScale(makeOptions({ dpi: 150 }), 200, 300)).toBeCloseTo(150 / 72, 5);
    expect(computeRenderScale(makeOptions({ dpi: 150, scale: 2 }), 200, 300)).toBeCloseTo((150 / 72) * 2, 5);
  });

  it('computeRenderScale：目标像素宽优先', () => {
    expect(computeRenderScale(makeOptions({ dpi: 72, targetWidth: 400 }), 200, 300)).toBeCloseTo(2, 5);
    expect(computeRenderScale(makeOptions({ dpi: 72, targetHeight: 600 }), 200, 300)).toBeCloseTo(2, 5);
  });

  it('parsePageRange：与 utils 一致', () => {
    expect(parsePageRange('all', 4)).toEqual([0, 1, 2, 3]);
    expect(parsePageRange('1,3', 4)).toEqual([0, 2]);
  });

  it('M7：canvas 面积超限抛 EXPORT_FAILED，正常尺寸放行', () => {
    expect(() => assertCanvasSizeWithinLimit(200, 300, 2)).not.toThrow();
    // 单边超 16384px
    expect(() => assertCanvasSizeWithinLimit(200, 300, 100)).toThrowError(/输出尺寸过大/);
    // 面积超约 2.2 亿（如 600 DPI × 倍率 4 渲染 A4）
    const scale = (600 / 72) * 4;
    expect(() => assertCanvasSizeWithinLimit(595.28, 841.89, scale)).toThrowError(/输出尺寸过大/);
  });
});

describe('PDF→图片 Blob 编码（AC-C1 格式校验）', () => {
  it('canvasToBlob：PNG 输出 type 与魔数正确', async () => {
    const pngBytes = Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0));
    const fakeCanvas = {
      width: 200,
      height: 300,
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([pngBytes], { type: 'image/png' })),
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const blob = await canvasToBlob(fakeCanvas, 'png', 'transparent');
    expect(blob.type).toBe('image/png');
    // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
    const head = new Uint8Array(await blob.arrayBuffer()).subarray(0, 8);
    expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('canvasToBlob：JPG 输出 type 正确', async () => {
    const fakeCanvas = {
      width: 10,
      height: 10,
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })),
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const blob = await canvasToBlob(fakeCanvas, 'jpg', 'white');
    expect(blob.type).toBe('image/jpeg');
  });

  it('canvasToBlob：toBlob 失败抛 EXPORT_FAILED', async () => {
    const fakeCanvas = {
      width: 10,
      height: 10,
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    await expect(canvasToBlob(fakeCanvas, 'png', 'transparent')).rejects.toMatchObject({ errCode: 'EXPORT_FAILED' });
  });
});

describe('PDF→图片 ZIP 打包', () => {
  it('packZip 仅打包成功项且命名有序', async () => {
    const results: ConvertResult[] = [
      { pageIndex: 0, name: 'page-001.png', blob: new Blob(['a'], { type: 'image/png' }), url: '', status: 'ok' },
      { pageIndex: 1, name: 'page-002.png', blob: new Blob(), url: '', status: 'error', error: 'x' },
      { pageIndex: 2, name: 'page-003.png', blob: new Blob(['c'], { type: 'image/png' }), url: '', status: 'ok' },
    ];
    const zipBlob = await PdfToImageConverter.packZip(results);
    expect(zipBlob.size).toBeGreaterThan(0);
    // 解压验证条目（JSZip 同步解析）
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toEqual(['page-001.png', 'page-003.png']);
  });
});

describe('图片→PDF', () => {
  it('convert：多图合并，页数正确，损坏图片隔离', async () => {
    const items: ImageItem[] = [
      { id: 'a', name: 'a.png', dataUrl: `data:image/png;base64,${PNG_1PX}`, width: 1, height: 1, rotation: 0 },
      { id: 'b', name: 'b.png', dataUrl: `data:image/png;base64,${PNG_1PX}`, width: 1, height: 1, rotation: 90 },
      { id: 'c', name: 'bad.png', dataUrl: '', width: 0, height: 0, rotation: 0, error: '损坏' },
    ];
    const converter = new ImageToPdfConverter();
    const progress: number[] = [];
    const blob = await converter.convert(items, { pageSize: 'letter', marginPt: 50, fit: 'contain', scale: 1 }, (done) => {
      progress.push(done);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(progress).toEqual([1, 2]);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(612, 0);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(792, 0);
  });

  it('convert：支持自定义页面尺寸', async () => {
    const items: ImageItem[] = [
      { id: 'a', name: 'a.png', dataUrl: `data:image/png;base64,${PNG_1PX}`, width: 1, height: 1, rotation: 0 },
    ];
    const converter = new ImageToPdfConverter();
    const blob = await converter.convert(items, { pageSize: 'custom', widthPt: 400, heightPt: 500, marginPt: 20, fit: 'stretch', scale: 1 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getWidth()).toBe(400);
    expect(doc.getPage(0).getHeight()).toBe(500);
  });

  it('convert：取消抛 CONVERT_CANCELLED', async () => {
    const items: ImageItem[] = [
      { id: 'a', name: 'a.png', dataUrl: `data:image/png;base64,${PNG_1PX}`, width: 1, height: 1, rotation: 0 },
      { id: 'b', name: 'b.png', dataUrl: `data:image/png;base64,${PNG_1PX}`, width: 1, height: 1, rotation: 0 },
    ];
    const converter = new ImageToPdfConverter();
    // 取消应在「转换过程中」触发：convert 入口会重置取消标志（每次转换是全新会话），
    // requestCancel 的语义是取消正在进行的转换（PRD AC-C5/AC-I5）。
    await expect(
      converter.convert(items, { pageSize: 'a4', marginPt: 40, fit: 'contain', scale: 1 }, (done) => {
        if (done === 1) converter.requestCancel();
      }),
    ).rejects.toMatchObject({ errCode: 'CONVERT_CANCELLED' });
  });
});
