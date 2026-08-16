/**
 * 坐标换算工具：屏幕像素（CSS px，原点左上）↔ PDF 点（1/72 inch，原点左下）。
 * 全链路几何运算只使用 PDF 点，屏幕换算必须经由本模块。
 */
import type { Point, Rect } from './types';

/** 标准页面尺寸（PDF 点）。 */
export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

export type PageSizeKey = keyof typeof PAGE_SIZES;

/** 由页面尺寸预设键返回宽高（PDF 点）。 */
export function pageSizeToPt(size: PageSizeKey): { width: number; height: number } {
  return { ...PAGE_SIZES[size] };
}

/** PDF 点横坐标 → 屏幕横坐标（px）。 */
export function ptToScreenX(xPt: number, scale: number): number {
  return xPt * scale;
}

/** PDF 点纵坐标（左下原点）→ 屏幕纵坐标（左上原点，相对页面左上角）。 */
export function ptToScreenY(yPt: number, pageHeightPt: number, scale: number): number {
  return (pageHeightPt - yPt) * scale;
}

/** 屏幕横坐标（px）→ PDF 点横坐标。 */
export function screenToPtX(px: number, scale: number): number {
  return px / scale;
}

/** 屏幕纵坐标（px，相对页面左上角）→ PDF 点纵坐标（左下原点）。 */
export function screenToPtY(py: number, pageHeightPt: number, scale: number): number {
  return pageHeightPt - py / scale;
}

/** PDF 矩形 → 屏幕矩形（左上原点）。 */
export function ptRectToScreen(rect: Rect, pageHeightPt: number, scale: number): Rect {
  return {
    x: ptToScreenX(rect.x, scale),
    y: ptToScreenY(rect.y + rect.height, pageHeightPt, scale),
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/** 屏幕矩形（左上原点）→ PDF 矩形（左下原点）。 */
export function screenRectToPt(rect: Rect, pageHeightPt: number, scale: number): Rect {
  return {
    x: screenToPtX(rect.x, scale),
    y: screenToPtY(rect.y + rect.height, pageHeightPt, scale),
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** 将任意两点（任意拖拽方向）规整为左上原点矩形。 */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** 修正矩形：负宽/负高归一化。 */
export function normalizeRect(r: Rect): Rect {
  const x = r.width < 0 ? r.x + r.width : r.x;
  const y = r.height < 0 ? r.y + r.height : r.y;
  return { x, y, width: Math.abs(r.width), height: Math.abs(r.height) };
}

/** 将矩形裁剪到页面内。 */
export function clampRectToPage(rect: Rect, pageWidthPt: number, pageHeightPt: number): Rect {
  const x = Math.max(0, Math.min(rect.x, pageWidthPt));
  const y = Math.max(0, Math.min(rect.y, pageHeightPt));
  const right = Math.max(0, Math.min(rect.x + rect.width, pageWidthPt));
  const top = Math.max(0, Math.min(rect.y + rect.height, pageHeightPt));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, top - y) };
}

/** 点是否落在矩形内（含边界）。 */
export function containsPoint(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

/** 矩形是否与另一个矩形相交。 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** contain 适配：在 box 内完整容纳 src，保持宽高比。 */
export function fitContain(srcW: number, srcH: number, boxW: number, boxH: number): { width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) return { width: 0, height: 0 };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  return { width: srcW * scale, height: srcH * scale };
}

/** cover 适配：铺满 box 并裁剪溢出，保持宽高比。 */
export function fitCover(srcW: number, srcH: number, boxW: number, boxH: number): { width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) return { width: 0, height: 0 };
  const scale = Math.max(boxW / srcW, boxH / srcH);
  return { width: srcW * scale, height: srcH * scale };
}

/** 计算图片在页面内的绘制尺寸（含 fit 策略与额外缩放）。 */
export function computeImageFit(
  fit: 'contain' | 'cover' | 'stretch',
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
  extraScale: number,
): { width: number; height: number } {
  if (fit === 'stretch') {
    return { width: boxW * extraScale, height: boxH * extraScale };
  }
  const base = fit === 'contain' ? fitContain(srcW, srcH, boxW, boxH) : fitCover(srcW, srcH, boxW, boxH);
  return { width: base.width * extraScale, height: base.height * extraScale };
}

/** 计算页面渲染缩放，使页面适配容器（等比）。 */
export function zoomFitScale(pageWidthPt: number, pageHeightPt: number, containerW: number, containerH: number): number {
  if (pageWidthPt <= 0 || pageHeightPt <= 0) return 1;
  const scaleX = containerW / pageWidthPt;
  const scaleY = containerH / pageHeightPt;
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(scale, 4);
}

/** 缩放值夹取。 */
export function clampZoom(zoom: number, min = 0.25, max = 4): number {
  return Math.max(min, Math.min(max, zoom));
}

/** 将角度转为弧度。 */
export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}
