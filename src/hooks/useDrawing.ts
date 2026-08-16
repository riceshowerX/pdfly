/**
 * useDrawing：覆盖层绘制交互（pointer events → EditorElement）。
 * 支持：高亮/矩形/椭圆/箭头/线条的拖拽绘制，签名/自由线条的手写采集（光栅化为 PNG dataURL）。
 * 所有几何均为 PDF 点（左下原点）；屏幕换算经 geometry.ts。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { clampRectToPage, normalizeRect, rectFromPoints, screenToPtX, screenToPtY } from '../core/geometry';
import { useEditorStore } from '../store/useEditorStore';
import { uid } from '../core/utils';
import type { EditorElement, Point, Rect, Tool } from '../core/types';

export interface DraftShape {
  rect?: Rect;
  points?: Point[];
  // 线条/箭头：拖拽起终点（PDF 点，左下原点），用于预览真实方向
  startPt?: Point;
  endPt?: Point;
}

export interface DrawingHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

const DRAWING_TOOLS: Tool[] = ['highlight', 'rect', 'ellipse', 'arrow', 'line', 'signature'];

export function isDrawingTool(tool: Tool): boolean {
  return DRAWING_TOOLS.includes(tool);
}

/** 指针事件 → PDF 点（相对页面左上角换算）。 */
function eventToPt(e: React.PointerEvent, pageHeightPt: number, scale: number): Point {
  const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const px = e.clientX - bounds.left;
  const py = e.clientY - bounds.top;
  return { x: screenToPtX(px, scale), y: screenToPtY(py, pageHeightPt, scale) };
}

/** 点集合包围盒（含内边距，PDF 点）。 */
export function pointsBBox(pts: Point[], padPt: number): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX - padPt, y: minY - padPt, width: maxX - minX + padPt * 2, height: maxY - minY + padPt * 2 };
}

/** 自由手写点 → PNG dataURL（PDF 点 → canvas 像素，Y 轴翻转校正）。 */
export function rasterizePoints(pts: Point[], scale: number): string {
  if (pts.length < 2) return '';
  const bbox = pointsBBox(pts, 6);
  if (bbox.width <= 0 || bbox.height <= 0) return '';
  const factor = Math.max(2, scale * 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(bbox.width * factor));
  canvas.height = Math.max(1, Math.ceil(bbox.height * factor));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  // PDF（左下原点）→ canvas（左上原点）
  ctx.setTransform(factor, 0, 0, -factor, -bbox.x * factor, (bbox.y + bbox.height) * factor);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  return canvas.toDataURL('image/png');
}

/** 根据工具生成默认样式元素。line/arrow 额外记录拖拽真实起终点（PDF 点）。 */
function buildShapeElement(tool: Tool, pageIndex: number, rect: Rect, startPt?: Point, endPt?: Point): EditorElement {
  const base = { id: uid('el'), pageIndex, createdAt: Date.now() };
  switch (tool) {
    case 'highlight':
      return { ...base, type: 'highlight', ...rect, color: '#fde047', opacity: 0.35 };
    case 'rect':
      return { ...base, type: 'rect', ...rect, color: '#334155', strokeWidth: 2 };
    case 'ellipse':
      return { ...base, type: 'ellipse', ...rect, color: '#334155', strokeWidth: 2 };
    case 'arrow':
      return { ...base, type: 'arrow', ...rect, startPt, endPt, color: '#334155', strokeWidth: 2 };
    case 'line':
      return { ...base, type: 'line', ...rect, startPt, endPt, color: '#334155', strokeWidth: 2 };
    default:
      return { ...base, type: 'rect', ...rect, color: '#334155', strokeWidth: 2 };
  }
}

export function useDrawing(
  pageIndex: number,
  pageWidthPt: number,
  pageHeightPt: number,
  scale: number,
): { draft: DraftShape | null; drawing: boolean; handlers: DrawingHandlers; clear: () => void } {
  const tool = useEditorStore((s) => s.tool);
  const addElement = useEditorStore((s) => s.addElement);
  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [drawing, setDrawing] = useState(false);
  const startRef = useRef<Point | null>(null);
  const pointsRef = useRef<Point[]>([]);

  const canDraw = isDrawingTool(tool);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!canDraw) return;
      e.preventDefault();
      const pt = eventToPt(e, pageHeightPt, scale);
      startRef.current = pt;
      pointsRef.current = [pt];
      setDrawing(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [canDraw, pageHeightPt, scale],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawing || !startRef.current) return;
      const pt = eventToPt(e, pageHeightPt, scale);
      if (tool === 'signature') {
        pointsRef.current.push(pt);
        setDraft({ points: [...pointsRef.current] });
      } else {
        const s = startRef.current;
        if (s) setDraft({ rect: normalizeRect(rectFromPoints(s, pt)), startPt: s, endPt: pt });
      }
    },
    [drawing, tool, pageHeightPt, scale],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drawing || !startRef.current) return;
      const end = eventToPt(e, pageHeightPt, scale);
      const start = startRef.current;
      startRef.current = null;
      setDrawing(false);
      setDraft(null);

      if (tool === 'signature') {
        pointsRef.current.push(end);
        const pts = pointsRef.current;
        pointsRef.current = [];
        if (pts.length < 2) return;
        const dataUrl = rasterizePoints(pts, scale);
        const bbox = pointsBBox(pts, 6);
        if (bbox.width > 2 && bbox.height > 2 && dataUrl) {
          const el: EditorElement = {
            id: uid('el'),
            type: 'signature',
            pageIndex,
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height,
            imageDataUrl: dataUrl,
            opacity: 1,
            createdAt: Date.now(),
          };
          addElement(el);
        }
        return;
      }

      const raw = normalizeRect(rectFromPoints(start, end));
      if (raw.width < 1 && raw.height < 1) return;
      const rect = clampRectToPage(raw, pageWidthPt, pageHeightPt);
      // 线条/箭头记录拖拽真实方向（PDF 点），保证屏幕预览与导出方向一致
      addElement(buildShapeElement(tool, pageIndex, rect, start, end));
    },
    [drawing, tool, pageIndex, pageWidthPt, pageHeightPt, scale, addElement],
  );

  const clear = useCallback(() => {
    startRef.current = null;
    pointsRef.current = [];
    setDraft(null);
    setDrawing(false);
  }, []);

  const handlers = useMemo<DrawingHandlers>(
    () => ({ onPointerDown, onPointerMove, onPointerUp }),
    [onPointerDown, onPointerMove, onPointerUp],
  );

  return { draft, drawing, handlers, clear };
}
