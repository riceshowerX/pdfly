/**
 * PdfExporter：pdf-lib 封装。
 * 职责：
 *  1. 页面操作（插入/删除/重排）通过 copyPages 保留原文内容流（未编辑文本保持可搜索/可选中）；
 *  2. 叠加导出：按坐标绘制文本/高亮/批注/形状/图片/签名；文本替换先用背景色矩形遮盖原文；
 *  3. 图片转 PDF：多图合并（页面尺寸/边距/缩放/旋转）。
 */
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { computeImageFit, pageSizeToPt } from '../geometry';
import { dataUrlToUint8Array, isCjkText, isJpegDataUrl, baseName } from '../utils';
import { PdfEditorError } from '../types';
import { getFileAccess } from '../fileAccess';
import type { EditorElement, ExportConfig, ImageItem, ImagePdfOptions, PdfDocumentState, Point } from '../types';

/** 构建期下载的中文字体（OFL 协议 Noto Sans SC 子集）。不存在时返回空对象（Helvetica 回退）。 */
const fontCandidates = import.meta.glob('../../assets/fonts/*.{ttf,otf}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 模块级字体字节缓存：首次成功加载后复用，避免每次导出重复 fetch 8MB 字体。 */
let cachedFontBytes: Uint8Array | null = null;

/** 读取捆绑的中文字体字节；无字体或读取失败返回 null。 */
export async function loadEmbeddedFontBytes(): Promise<Uint8Array | null> {
  if (cachedFontBytes) return cachedFontBytes;
  const url = Object.values(fontCandidates)[0];
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    cachedFontBytes = new Uint8Array(buf);
    return cachedFontBytes;
  } catch {
    return null;
  }
}

/** 十六进制颜色 → pdf-lib RGB。 */
function rgbFromHex(hex: string | undefined): RGB {
  const raw = (hex ?? '#000000').replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return rgb(0, 0, 0);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** 生成导出文件名（xx-edited.pdf）。 */
export function withEditedSuffix(fileName: string): string {
  return `${baseName(fileName)}-edited.pdf`;
}

/** 线条/箭头起终点（PDF 点，左下原点）。优先使用用户拖拽真实方向；旧数据回退为 (x,y)→(x+w,y+h)。 */
export function resolveLinePoints(el: EditorElement): { start: Point; end: Point } {
  if (el.startPt && el.endPt) {
    return { start: el.startPt, end: el.endPt };
  }
  return { start: { x: el.x, y: el.y }, end: { x: el.x + el.width, y: el.y + el.height } };
}

/**
 * 计算 pdf-lib drawImage 旋转后的「视觉包围盒」（PDF 点，左下原点）。
 * pdf-lib 内容流为 translate(x,y) → rotate(θ) → scale(w,h)，旋转矩阵 [cosθ, sinθ, -sinθ, cosθ]，
 * 旋转锚点为绘制矩形左下角（translate 点）。由此推导各旋转角下的视觉盒：
 *   0°  = [x, x+w]×[y, y+h]
 *   90° = [x-h, x]×[y, y+w]
 *   180°= [x-w, x]×[y-h, y]
 *   270°= [x, x+h]×[y-w, y]
 */
export function rotatedImageVisualBox(
  width: number,
  height: number,
  x: number,
  y: number,
  rotation: number,
): { x: number; y: number; width: number; height: number } {
  const rot = ((rotation % 360) + 360) % 360;
  const w = width;
  const h = height;
  let left: number;
  let bottom: number;
  let right: number;
  let top: number;
  if (rot === 90) {
    left = x - h;
    bottom = y;
    right = x;
    top = y + w;
  } else if (rot === 180) {
    left = x - w;
    bottom = y - h;
    right = x;
    top = y;
  } else if (rot === 270) {
    left = x;
    bottom = y - w;
    right = x + h;
    top = y;
  } else {
    left = x;
    bottom = y;
    right = x + w;
    top = y + h;
  }
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

/**
 * 计算旋转图片在页面内的绘制参数。
 * 用「未旋转」宽高计算 fit（保持宽高比，避免非方形图旋转扭曲），drawImage 传未旋转宽高 + rotate。
 * x/y 按「视觉包围盒中心 = 页面中心」反推（pdf-lib 旋转锚点为绘制矩形左下角，R2 修正）：
 *   0°: x=(pw-w)/2, y=(ph-h)/2；90°: x=(pw+h)/2, y=(ph-w)/2
 *   180°: x=(pw+w)/2, y=(ph+h)/2；270°: x=(pw-h)/2, y=(ph+w)/2
 */
export function computeRotatedImagePlacement(
  fit: 'contain' | 'cover' | 'stretch',
  srcW: number,
  srcH: number,
  pageW: number,
  pageH: number,
  marginPt: number,
  extraScale: number,
  rotation: number,
): { width: number; height: number; x: number; y: number } {
  const rot = ((rotation % 360) + 360) % 360;
  const boxW = Math.max(1, pageW - marginPt * 2);
  const boxH = Math.max(1, pageH - marginPt * 2);
  const fitSize = computeImageFit(fit, srcW, srcH, boxW, boxH, extraScale);
  const w = fitSize.width;
  const h = fitSize.height;
  let x: number;
  let y: number;
  if (rot === 90) {
    x = (pageW + h) / 2;
    y = (pageH - w) / 2;
  } else if (rot === 180) {
    x = (pageW + w) / 2;
    y = (pageH + h) / 2;
  } else if (rot === 270) {
    x = (pageW - h) / 2;
    y = (pageH + w) / 2;
  } else {
    x = (pageW - w) / 2;
    y = (pageH - h) / 2;
  }
  return { width: w, height: h, x, y };
}

/** 单个字符估算宽度（fontSize 倍数）：CJK 全角 1.0，其余半角 0.5。 */
function charWidthUnits(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  ) {
    return 1;
  }
  return 0.5;
}

/** 估算文本宽度（PDF 点）。 */
function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += charWidthUnits(ch);
  return units * fontSize;
}

/** 将单行文本按最大宽度拆分为多行（保持字符完整，不做单词截断）。 */
function wrapTextLine(line: string, fontSize: number, maxWidth: number): string[] {
  if (maxWidth <= 0) return [line];
  if (estimateTextWidth(line, fontSize) <= maxWidth) return [line];
  const out: string[] = [];
  let cur = '';
  let curWidth = 0;
  for (const ch of line) {
    const w = charWidthUnits(ch) * fontSize;
    if (cur && curWidth + w > maxWidth) {
      out.push(cur);
      cur = '';
      curWidth = 0;
    }
    cur += ch;
    curWidth += w;
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [line];
}

/** 解析图片转 PDF 的页面尺寸。 */
export function resolveImagePdfPageSize(options: ImagePdfOptions): { width: number; height: number } {
  if (options.pageSize === 'custom') {
    return { width: options.widthPt ?? 595.28, height: options.heightPt ?? 841.89 };
  }
  return pageSizeToPt(options.pageSize === 'a4' ? 'a4' : 'letter');
}

export class PdfExporter {
  /**
   * 构建编辑后的 PDF 字节（纯函数，便于单测）。
   * 页面操作：按 state.pages 当前顺序 copyPages；空白页（index=-1）新建空白页。
   */
  async buildEditedPdf(
    state: PdfDocumentState,
    elements: EditorElement[],
    config: ExportConfig,
  ): Promise<Uint8Array> {
    let srcDoc: PDFDocument;
    try {
      srcDoc = await PDFDocument.load(state.originalBytes, { ignoreEncryption: true });
    } catch {
      throw new PdfEditorError('CORRUPT_FILE', '无法解析原始 PDF，导出失败');
    }
    const outDoc = await PDFDocument.create();

    // 1) 页面操作：copyPages 保留原文内容流
    for (const pageInfo of state.pages) {
      if (pageInfo.index >= 0) {
        const [copied] = await outDoc.copyPages(srcDoc, [pageInfo.index]);
        outDoc.addPage(copied);
      } else {
        outDoc.addPage([pageInfo.widthPt || 595.28, pageInfo.heightPt || 841.89]);
      }
    }

    // 2) 字体准备：中文嵌入 Noto Sans SC，拉丁回退 Helvetica / Times
    let notoFont: PDFFont | null = null;
    if (config.embedFont === 'noto-sans-sc') {
      const bytes = await loadEmbeddedFontBytes();
      if (bytes) {
        try {
          notoFont = await outDoc.embedFont(bytes, { subset: true });
        } catch {
          notoFont = null;
        }
      }
    }
    const helvetica = await outDoc.embedFont(StandardFonts.Helvetica);
    const times = await outDoc.embedFont(StandardFonts.TimesRoman);

    // 3) 叠加绘制
    if (config.includeOverlays) {
      for (let i = 0; i < outDoc.getPageCount(); i += 1) {
        const page = outDoc.getPage(i);
        const els = elements.filter((e) => e.pageIndex === i);
        for (const el of els) {
          await this.drawElement(outDoc, page, el, notoFont, helvetica, times);
        }
      }
    }

    try {
      return await outDoc.save({ useObjectStreams: true });
    } catch {
      throw new PdfEditorError('EXPORT_FAILED', 'PDF 保存失败');
    }
  }

  /** 导出并保存编辑后的 PDF（经 FileAccess 抽象）。 */
  async saveEdited(state: PdfDocumentState, elements: EditorElement[], config: ExportConfig): Promise<void> {
    const bytes = await this.buildEditedPdf(state, elements, config);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const name = withEditedSuffix(state.fileName);
    await getFileAccess().saveFile(buffer, name);
  }

  /** 单元素叠加绘制。 */
  private async drawElement(
    doc: PDFDocument,
    page: PDFPage,
    el: EditorElement,
    notoFont: PDFFont | null,
    helvetica: PDFFont,
    times: PDFFont,
  ): Promise<void> {
    switch (el.type) {
      case 'text': {
        const text = el.text ?? '';
        const fontSize = el.fontSize ?? 12;
        const color = rgbFromHex(el.color ?? '#1f2937');
        // 中文使用嵌入的 Noto Sans SC；拉丁字符回退 Helvetica / Times
        const latinFont = el.fontFamily === 'serif' ? times : helvetica;
        const font = notoFont ?? latinFont;

        // 文本替换：先以背景色矩形遮盖原文
        if (el.coversOriginalText) {
          page.drawRectangle({
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            color: rgbFromHex(el.fillColor ?? '#ffffff'),
          });
        }
        if (!text) return;

        // 中文字体缺失时给出明确错误（UI 层提示）
        if (isCjkText(text) && !notoFont) {
          throw new PdfEditorError(
            'FONT_MISSING',
            '导出中文需要字体资源（Noto Sans SC）。请联网后运行 npm run fetch:font，或改用拉丁文本。',
          );
        }

        // 按可用宽度手动换行：中文 1 单位、ASCII 0.5 单位 × fontSize 估算宽度，逐行拆分不超 el.width
        const lines: string[] = [];
        const maxTextWidth = Math.max(1, el.width);
        for (const rawLine of text.split('\n')) {
          lines.push(...wrapTextLine(rawLine, fontSize, maxTextWidth));
        }
        const lineHeight = fontSize * 1.25;
        let cursorY = el.y + el.height - fontSize;
        for (const line of lines) {
          if (cursorY < el.y) break;
          page.drawText(line, {
            x: el.x,
            y: cursorY,
            size: fontSize,
            font,
            color,
          });
          cursorY -= lineHeight;
        }
        break;
      }
      case 'highlight': {
        page.drawRectangle({
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          color: rgbFromHex(el.color ?? '#fde047'),
          opacity: el.opacity ?? 0.35,
        });
        break;
      }
      case 'note': {
        const color = rgbFromHex(el.color ?? '#f59e0b');
        page.drawRectangle({ x: el.x, y: el.y, width: 14, height: 14, color });
        page.drawText('i', { x: el.x + 4.5, y: el.y + 2, size: 9, color: rgb(1, 1, 1), font: helvetica });
        const noteText = el.noteText ?? '';
        if (noteText) {
          if (isCjkText(noteText) && !notoFont) {
            throw new PdfEditorError('FONT_MISSING', '导出中文批注需要字体资源（Noto Sans SC）。');
          }
          page.drawText(noteText, {
            x: el.x + 18,
            y: el.y,
            size: 9,
            color: rgb(0.13, 0.13, 0.13),
            font: notoFont ?? helvetica,
            maxWidth: Math.max(20, el.width - 18),
          });
        }
        break;
      }
      case 'rect': {
        page.drawRectangle({
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          borderColor: rgbFromHex(el.color ?? '#334155'),
          borderWidth: el.strokeWidth ?? 1,
          color: el.fillColor ? rgbFromHex(el.fillColor) : undefined,
          opacity: el.opacity ?? 1,
        });
        break;
      }
      case 'ellipse': {
        page.drawEllipse({
          x: el.x + el.width / 2,
          y: el.y + el.height / 2,
          xScale: el.width / 2,
          yScale: el.height / 2,
          borderColor: rgbFromHex(el.color ?? '#334155'),
          borderWidth: el.strokeWidth ?? 1,
          color: el.fillColor ? rgbFromHex(el.fillColor) : undefined,
          opacity: el.opacity ?? 1,
        });
        break;
      }
      case 'line': {
        const { start, end } = resolveLinePoints(el);
        page.drawLine({
          start,
          end,
          thickness: el.strokeWidth ?? 1,
          color: rgbFromHex(el.color ?? '#334155'),
        });
        break;
      }
      case 'arrow': {
        const { start, end } = resolveLinePoints(el);
        const color = rgbFromHex(el.color ?? '#334155');
        const thickness = el.strokeWidth ?? 1.5;
        page.drawLine({ start, end, thickness, color });
        // 箭头头部（两条短线，方向与 start→end 一致）
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          const ang = Math.atan2(dy, dx);
          const headLen = Math.min(12, Math.max(6, len * 0.18));
          const spread = Math.PI / 7;
          const p1 = {
            x: end.x - headLen * Math.cos(ang - spread),
            y: end.y - headLen * Math.sin(ang - spread),
          };
          const p2 = {
            x: end.x - headLen * Math.cos(ang + spread),
            y: end.y - headLen * Math.sin(ang + spread),
          };
          page.drawLine({ start: end, end: p1, thickness, color });
          page.drawLine({ start: end, end: p2, thickness, color });
        }
        break;
      }
      case 'image':
      case 'signature': {
        if (!el.imageDataUrl) break;
        let img: PDFImage;
        try {
          if (isJpegDataUrl(el.imageDataUrl)) {
            img = await doc.embedJpg(dataUrlToUint8Array(el.imageDataUrl));
          } else {
            img = await doc.embedPng(dataUrlToUint8Array(el.imageDataUrl));
          }
        } catch {
          throw new PdfEditorError('UNSUPPORTED_IMAGE', '图片数据无法嵌入 PDF');
        }
        page.drawImage(img, {
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          rotate: el.rotation ? degrees(el.rotation) : undefined,
        });
        break;
      }
      default:
        break;
    }
  }

  /** 图片转 PDF：生成合并 PDF Blob。 */
  async createPdfFromImages(items: ImageItem[], options: ImagePdfOptions): Promise<Blob> {
    const doc = await PDFDocument.create();
    const { width: pw, height: ph } = resolveImagePdfPageSize(options);
    for (const item of items) {
      if (item.error || !item.dataUrl) continue;
      let img: PDFImage;
      try {
        if (isJpegDataUrl(item.dataUrl)) {
          img = await doc.embedJpg(dataUrlToUint8Array(item.dataUrl));
        } else {
          img = await doc.embedPng(dataUrlToUint8Array(item.dataUrl));
        }
      } catch {
        continue; // 损坏图片隔离：不影响其他图片
      }
      const page = doc.addPage([pw, ph]);
      // 用「未旋转」宽高计算 fit（保持宽高比），再按旋转后视觉尺寸居中，避免非方形图扭曲
      const placement = computeRotatedImagePlacement(
        options.fit,
        item.width,
        item.height,
        pw,
        ph,
        options.marginPt,
        options.scale,
        item.rotation,
      );
      page.drawImage(img, {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotate: item.rotation ? degrees(item.rotation) : undefined,
      });
    }
    const bytes = await doc.save();
    return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  }
}
