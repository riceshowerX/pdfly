/**
 * 生成一个简单 PDF 的工具（pdf-lib 纯字节，测试用）。
 */
import { PDFDocument, rgb } from 'pdf-lib';
import type { PdfDocumentState, PdfPageInfo } from '../../src/core/types';

export interface SamplePageSpec {
  width: number;
  height: number;
  label: string;
}

export async function createSamplePdfBytes(specs: SamplePageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const s of specs) {
    const page = doc.addPage([s.width, s.height]);
    page.drawText(s.label, { x: 30, y: s.height / 2, size: 16, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 10, y: 10, width: 60, height: 40, borderColor: rgb(0.2, 0.2, 0.8), borderWidth: 2 });
  }
  return doc.save();
}

export function buildStateFromBytes(bytes: Uint8Array, specs: SamplePageSpec[]): PdfDocumentState {
  const pages: PdfPageInfo[] = specs.map((s, i) => ({
    index: i,
    widthPt: s.width,
    heightPt: s.height,
    rotation: 0,
  }));
  return {
    id: 'test-doc',
    fileName: 'sample.pdf',
    originalBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    pageCount: pages.length,
    pages,
    loadedAt: 0,
  };
}
