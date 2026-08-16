/**
 * PageOverlay：单页覆盖层。
 * - 渲染 pdf.js canvas 底图；
 * - 叠加渲染编辑元素（文本/高亮/批注/形状/图片/签名），所见即所得；
 * - 处理绘制工具指针交互（经 useDrawing）、选择/拖拽移动、文本编辑气泡（替换原文/新增文本/编辑文本）。
 * 所有几何为 PDF 点；屏幕换算经 geometry.ts。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { containsPoint, ptRectToScreen, screenToPtX, screenToPtY } from '../../core/geometry';
import { uid } from '../../core/utils';
import { useEditorStore } from '../../store/useEditorStore';
import { usePdf } from '../../hooks/usePdf';
import { useDrawing, isDrawingTool, type DraftShape } from '../../hooks/useDrawing';
import type { EditorElement, Point, Rect, TextStyle } from '../../core/types';
import type { PdfTextItem } from '../../core/pdf/PdfDocument';
import { Button, Input, TextArea } from '../common/ui';

// ---------- 文本命中 ----------

function hitTextItem(items: PdfTextItem[], pt: Point): PdfTextItem | null {
  for (const it of items) {
    if (!it.str.trim()) continue;
    const rect: Rect = {
      x: it.x,
      y: it.y - it.height * 0.8,
      width: it.width,
      height: it.height * 1.2,
    };
    if (containsPoint(rect, pt)) return it;
  }
  return null;
}

// ---------- 元素视图 ----------

function ElementView({ el, scale, pageHeightPt }: { el: EditorElement; scale: number; pageHeightPt: number }) {
  const selection = useEditorStore((s) => s.selection);
  const selected = selection.elementId === el.id;
  const rect = ptRectToScreen(el, pageHeightPt, scale);

  const baseStyle: CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
  const dataId = { 'data-element-id': el.id };

  let node: ReactNode = null;
  switch (el.type) {
    case 'text': {
      const fontSizePx = (el.fontSize ?? 12) * scale;
      node = (
        <div
          style={{
            ...baseStyle,
            fontSize: fontSizePx,
            lineHeight: 1.25,
            color: el.color ?? '#1f2937',
            fontFamily: el.fontFamily === 'serif' ? 'Georgia, serif' : 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
          }}
          {...dataId}
        >
          {el.text}
        </div>
      );
      break;
    }
    case 'highlight':
      node = (
        <div
          style={{ ...baseStyle, backgroundColor: el.color ?? '#fde047', opacity: el.opacity ?? 0.35 }}
          {...dataId}
        />
      );
      break;
    case 'note':
      node = (
        <div style={baseStyle} {...dataId} className="flex items-start gap-1.5">
          <span
            className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ backgroundColor: el.color ?? '#f59e0b' }}
          >
            i
          </span>
          <span className="text-xs leading-tight" style={{ color: '#1f2937' }}>
            {el.noteText}
          </span>
        </div>
      );
      break;
    case 'rect':
      node = (
        <div
          style={{
            ...baseStyle,
            border: `${Math.max(1, (el.strokeWidth ?? 1) * scale)}px solid ${el.color ?? '#334155'}`,
            backgroundColor: el.fillColor ? `${el.fillColor}${el.opacity !== undefined ? Math.round((el.opacity ?? 1) * 255).toString(16).padStart(2, '0') : ''}` : undefined,
            borderRadius: 2,
          }}
          {...dataId}
        />
      );
      break;
    case 'ellipse':
      node = (
        <div
          style={{
            ...baseStyle,
            border: `${Math.max(1, (el.strokeWidth ?? 1) * scale)}px solid ${el.color ?? '#334155'}`,
            borderRadius: '50%',
            backgroundColor: el.fillColor ?? undefined,
          }}
          {...dataId}
        />
      );
      break;
    case 'line':
    case 'arrow': {
      // 起终点（PDF 点 → 屏幕点）；旧数据回退为矩形对角线。方向与导出层共用同一语义（H3）
      const startPt = el.startPt ?? { x: el.x, y: el.y };
      const endPt = el.endPt ?? { x: el.x + el.width, y: el.y + el.height };
      const s = ptRectToScreen({ x: startPt.x, y: startPt.y, width: 0, height: 0 }, pageHeightPt, scale);
      const e = ptRectToScreen({ x: endPt.x, y: endPt.y, width: 0, height: 0 }, pageHeightPt, scale);
      const left = Math.min(s.x, e.x);
      const top = Math.min(s.y, e.y);
      const w = Math.max(1, Math.abs(e.x - s.x));
      const h = Math.max(1, Math.abs(e.y - s.y));
      const len = Math.hypot(e.x - s.x, e.y - s.y);
      const ang = Math.atan2(e.y - s.y, e.x - s.x);
      const headLen = Math.min(12 * scale, Math.max(6 * scale, len * 0.18));
      const spread = Math.PI / 7;
      const p1 = {
        x: e.x - headLen * Math.cos(ang - spread),
        y: e.y - headLen * Math.sin(ang - spread),
      };
      const p2 = {
        x: e.x - headLen * Math.cos(ang + spread),
        y: e.y - headLen * Math.sin(ang + spread),
      };
      node = (
        <svg style={{ ...baseStyle, left, top, width: w, height: h, overflow: 'visible' }} {...dataId}>
          <line
            x1={s.x - left}
            y1={s.y - top}
            x2={e.x - left}
            y2={e.y - top}
            stroke={el.color ?? '#334155'}
            strokeWidth={Math.max(1, (el.strokeWidth ?? 1.5) * scale)}
          />
          {el.type === 'arrow' ? (
            <polygon
              points={`${e.x - left},${e.y - top} ${p1.x - left},${p1.y - top} ${p2.x - left},${p2.y - top}`}
              fill={el.color ?? '#334155'}
            />
          ) : null}
        </svg>
      );
      break;
    }
    case 'image':
    case 'signature':
      node = (
        <img
          src={el.imageDataUrl}
          alt={el.type === 'signature' ? '签名' : '图片'}
          draggable={false}
          style={baseStyle}
          {...dataId}
          className="select-none"
        />
      );
      break;
    default:
      node = null;
  }

  return (
    <div className="absolute" style={{ pointerEvents: 'none' }}>
      {node}
      {selected ? (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-primary-500"
          style={{ left: rect.x - 2, top: rect.y - 2, width: rect.width + 4, height: rect.height + 4 }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

// ---------- 绘制草稿预览 ----------

function DraftPreview({ draft, tool, scale, pageHeightPt }: { draft: DraftShape; tool: string; scale: number; pageHeightPt: number }) {
  if (draft.rect) {
    const rect = ptRectToScreen(draft.rect, pageHeightPt, scale);
    const common = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
    if (tool === 'highlight') {
      return <div style={{ ...common, position: 'absolute', backgroundColor: '#fde047', opacity: 0.35 }} />;
    }
    if (tool === 'ellipse') {
      return <div style={{ ...common, position: 'absolute', border: '2px solid #334155', borderRadius: '50%' }} />;
    }
    if (tool === 'line' || tool === 'arrow') {
      // 线条/箭头按拖拽真实方向预览（start/end → 屏幕点）
      const s =
        draft.startPt && draft.endPt
          ? ptRectToScreen({ x: draft.startPt.x, y: draft.startPt.y, width: 0, height: 0 }, pageHeightPt, scale)
          : { x: rect.x, y: rect.y };
      const e =
        draft.startPt && draft.endPt
          ? ptRectToScreen({ x: draft.endPt.x, y: draft.endPt.y, width: 0, height: 0 }, pageHeightPt, scale)
          : { x: rect.x + rect.width, y: rect.y + rect.height };
      const left = Math.min(s.x, e.x);
      const top = Math.min(s.y, e.y);
      return (
        <svg style={{ position: 'absolute', left, top, overflow: 'visible' }} width={Math.max(1, Math.abs(e.x - s.x))} height={Math.max(1, Math.abs(e.y - s.y))}>
          <line x1={s.x - left} y1={s.y - top} x2={e.x - left} y2={e.y - top} stroke="#334155" strokeWidth={2} />
        </svg>
      );
    }
    return <div style={{ ...common, position: 'absolute', border: '2px solid #334155' }} />;
  }
  if (draft.points && draft.points.length > 1) {
    const pts = draft.points.map((p) => ptRectToScreen({ x: p.x, y: p.y, width: 0, height: 0 }, pageHeightPt, scale));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x - minX},${p.y - minY}`).join(' ');
    return (
      <svg style={{ position: 'absolute', left: minX, top: minY, overflow: 'visible' }} width={maxX - minX} height={maxY - minY}>
        <path d={d} fill="none" stroke="#111827" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

// ---------- 文本气泡 ----------

interface BubbleState {
  mode: 'replace' | 'new' | 'edit';
  elementId?: string;
  rectPt: Rect;
  initialText: string;
}

const DEFAULT_TEXT_STYLE: TextStyle = { fontSize: 14, fontFamily: 'sans', color: '#111827' };

// ---------- 页面组件 ----------

export interface PageOverlayProps {
  /** 页面在文档中的位置索引（元素归属/过滤用）。 */
  pageIndex: number;
  /** 原始页号（pdf.js 渲染底图/文本层用）；-1 表示插入的空白页。 */
  originalIndex: number;
  widthPt: number;
  heightPt: number;
  scale: number;
}

export function PageOverlay({ pageIndex, originalIndex, widthPt, heightPt, scale }: PageOverlayProps) {
  const tool = useEditorStore((s) => s.tool);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  // 注意：selector 必须返回稳定引用，禁止在 selector 内 filter/map 新建数组，
  // 否则 useSyncExternalStore 判定快照持续变化 → 无限重渲染（Maximum update depth exceeded）。
  const allElements = useEditorStore((s) => s.elements);
  const elements = useMemo(() => allElements.filter((e) => e.pageIndex === pageIndex), [allElements, pageIndex]);
  const addElement = useEditorStore((s) => s.addElement);
  const updateElement = useEditorStore((s) => s.updateElement);
  const replaceText = useEditorStore((s) => s.replaceText);
  const removeElement = useEditorStore((s) => s.removeElement);
  const { renderPage, getTextLayer } = usePdf();
  // 空白页（originalIndex=-1）无原始来源：仅渲染白色画布，不请求 pdf.js
  const isBlankPage = originalIndex < 0;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textItemsRef = useRef<PdfTextItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { draft, drawing, handlers, clear } = useDrawing(pageIndex, widthPt, heightPt, scale);
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [bubbleText, setBubbleText] = useState('');
  const dragRef = useRef<{ id: string; startPt: Point; orig: Rect; lastPt: Point } | null>(null);
  const [dragVersion, forceRender] = useReducer((x: number) => x + 1, 0);

  // ---------- pan 工具：拖拽平移滚动画布 ----------

  const panRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; scrollParent: HTMLElement } | null>(null);

  const onPanPointerDown = useCallback((e: ReactPointerEvent) => {
    let node = containerRef.current?.parentElement ?? null;
    let scrollParent: HTMLElement | null = null;
    while (node) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
        scrollParent = node;
        break;
      }
      node = node.parentElement;
    }
    if (!scrollParent) return;
    e.preventDefault();
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: scrollParent.scrollLeft,
      scrollTop: scrollParent.scrollTop,
      scrollParent,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPanPointerMove = useCallback((e: ReactPointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    p.scrollParent.scrollLeft = p.scrollLeft - (e.clientX - p.startX);
    p.scrollParent.scrollTop = p.scrollTop - (e.clientY - p.startY);
  }, []);

  const onPanPointerUp = useCallback(() => {
    panRef.current = null;
  }, []);

  const pageW = widthPt * scale;
  const pageH = heightPt * scale;

  // 渲染底图（使用原始页号 originalIndex；空白页不渲染）
  useEffect(() => {
    if (isBlankPage) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPage(originalIndex, scale)
      .then((c) => {
        if (cancelled) return;
        canvas.width = c.width;
        canvas.height = c.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(c, 0, 0);
      })
      .catch((err) => {
        if (!cancelled) console.warn('[pdfly] 页面渲染失败', err);
      });
    return () => {
      cancelled = true;
    };
  }, [originalIndex, scale, renderPage, isBlankPage]);

  // 加载文本层（命中检测）；promise 加 catch 防止卸载/销毁后 unhandledrejection（C3）
  useEffect(() => {
    if (isBlankPage) return;
    let cancelled = false;
    getTextLayer(originalIndex)
      .then((items) => {
        if (!cancelled) textItemsRef.current = items;
      })
      .catch((err) => {
        if (!cancelled) console.warn('[pdfly] 文本层加载失败', err);
      });
    return () => {
      cancelled = true;
    };
  }, [originalIndex, getTextLayer, isBlankPage]);

  const eventToPt = useCallback(
    (e: ReactPointerEvent | ReactMouseEvent): Point => {
      const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return {
        x: screenToPtX(e.clientX - bounds.left, scale),
        y: screenToPtY(e.clientY - bounds.top, heightPt, scale),
      };
    },
    [scale, heightPt],
  );

  const openBubble = useCallback((next: BubbleState) => {
    setBubble(next);
    setBubbleText(next.initialText);
  }, []);

  // ---------- select 模式：命中 + 拖拽移动 ----------

  const hitTopElement = useCallback(
    (pt: Point): EditorElement | null => {
      for (let i = elements.length - 1; i >= 0; i -= 1) {
        const el = elements[i];
        if (containsPoint({ x: el.x, y: el.y, width: el.width, height: el.height }, pt)) return el;
      }
      return null;
    },
    [elements],
  );

  const onSelectPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (tool !== 'select') return;
      const pt = eventToPt(e);
      const el = hitTopElement(pt);
      if (el) {
        e.stopPropagation();
        select(el.id, pageIndex);
        dragRef.current = { id: el.id, startPt: pt, orig: { x: el.x, y: el.y, width: el.width, height: el.height }, lastPt: pt };
        forceRender();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } else {
        select(null, null);
      }
    },
    [tool, eventToPt, hitTopElement, select, pageIndex],
  );

  const onSelectPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current) return;
      const pt = eventToPt(e);
      dragRef.current.lastPt = pt;
      forceRender();
    },
    [eventToPt],
  );

  const onSelectPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const pt = eventToPt(e);
      const dx = pt.x - d.startPt.x;
      const dy = pt.y - d.startPt.y;
      const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      if (moved) {
        updateElement(d.id, { x: d.orig.x + dx, y: d.orig.y + dy });
      }
      dragRef.current = null;
      forceRender();
    },
    [eventToPt, updateElement],
  );

  // 拖拽移动的临时覆盖渲染
  const visibleElements = useMemo(() => {
    const d = dragRef.current;
    if (!d) return elements;
    return elements.map((el) => {
      if (el.id !== d.id) return el;
      const dx = d.lastPt.x - d.startPt.x;
      const dy = d.lastPt.y - d.startPt.y;
      return { ...el, x: d.orig.x + dx, y: d.orig.y + dy };
    });
  }, [elements, dragVersion]);

  // ---------- text 模式：点击文本/空白 ----------

  const onTextClick = useCallback(
    (e: ReactMouseEvent) => {
      if (tool !== 'text') return;
      const pt = eventToPt(e);
      const item = hitTextItem(textItemsRef.current, pt);
      if (item) {
        const rect: Rect = { x: item.x, y: item.y - item.height, width: Math.max(item.width, 60), height: item.height * 1.6 };
        openBubble({ mode: 'replace', rectPt: rect, initialText: item.str });
      } else {
        const rect: Rect = { x: pt.x, y: pt.y - 8, width: 180, height: 24 };
        openBubble({ mode: 'new', rectPt: rect, initialText: '' });
      }
    },
    [tool, eventToPt, openBubble],
  );

  const onTextDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (tool !== 'text' && tool !== 'select') return;
      const pt = eventToPt(e);
      const el = hitTopElement(pt);
      if (el && el.type === 'text') {
        openBubble({ mode: 'edit', elementId: el.id, rectPt: { x: el.x, y: el.y, width: el.width, height: el.height }, initialText: el.text ?? '' });
      }
    },
    [tool, eventToPt, hitTopElement, openBubble],
  );

  const saveBubble = useCallback(() => {
    if (!bubble) return;
    const text = bubbleText.trim();
    if (bubble.mode === 'replace') {
      if (!text) {
        setBubble(null);
        return;
      }
      replaceText(pageIndex, bubble.rectPt, bubble.initialText, text, DEFAULT_TEXT_STYLE);
    } else if (bubble.mode === 'new') {
      if (!text) {
        setBubble(null);
        return;
      }
      addElement({
        id: uid('el'),
        type: 'text',
        pageIndex,
        x: bubble.rectPt.x,
        y: bubble.rectPt.y,
        width: bubble.rectPt.width,
        height: Math.max(24, bubble.rectPt.height),
        text,
        fontSize: DEFAULT_TEXT_STYLE.fontSize,
        fontFamily: 'sans',
        color: DEFAULT_TEXT_STYLE.color,
        createdAt: Date.now(),
      });
    } else if (bubble.mode === 'edit' && bubble.elementId) {
      updateElement(bubble.elementId, { text: text || ' ' });
    }
    setBubble(null);
  }, [bubble, bubbleText, pageIndex, replaceText, addElement, updateElement]);

  const bubbleScreenRect = bubble ? ptRectToScreen(bubble.rectPt, heightPt, scale) : null;

  return (
    <div
      ref={containerRef}
      className="relative mx-auto bg-white shadow-card"
      style={{
        width: pageW,
        height: pageH,
        touchAction: tool === 'pan' || tool === 'signature' || isDrawingTool(tool) ? 'none' : 'auto',
        cursor: tool === 'pan' ? 'grab' : undefined,
      }}
      onPointerDown={(e) => {
        if (tool === 'pan') onPanPointerDown(e);
        else if (tool === 'select') onSelectPointerDown(e);
        else handlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        if (tool === 'pan') onPanPointerMove(e);
        else if (dragRef.current) onSelectPointerMove(e);
        else handlers.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        if (tool === 'pan') onPanPointerUp();
        else if (dragRef.current) onSelectPointerUp(e);
        else handlers.onPointerUp(e);
      }}
      onClick={onTextClick}
      onDoubleClick={onTextDoubleClick}
    >
      {/* 底图 */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* 覆盖元素 */}
      <div className="absolute inset-0">
        {visibleElements.map((el) => (
          <ElementView key={el.id} el={el} scale={scale} pageHeightPt={heightPt} />
        ))}
      </div>
      {/* 绘制草稿 */}
      {drawing && draft ? <DraftPreview draft={draft} tool={tool} scale={scale} pageHeightPt={heightPt} /> : null}
      {/* 文本气泡 */}
      {bubble && bubbleScreenRect ? (
        <div
          className="absolute z-20 rounded-lg border border-ink-200 bg-white p-2 shadow-pop"
          style={{ left: bubbleScreenRect.x, top: bubbleScreenRect.y + bubbleScreenRect.height + 6, width: Math.max(200, bubbleScreenRect.width) }}
        >
          {bubble.mode === 'edit' || bubble.mode === 'new' ? (
            <TextArea
              value={bubbleText}
              onChange={(e) => setBubbleText(e.target.value)}
              placeholder="输入文本…"
              autoFocus
              className="min-h-[64px]"
            />
          ) : (
            <Input
              value={bubbleText}
              onChange={(e) => setBubbleText(e.target.value)}
              placeholder="替换为…"
              autoFocus
            />
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setBubble(null)}>
              取消
            </Button>
            <Button size="sm" onClick={saveBubble} disabled={!bubbleText.trim()}>
              {bubble.mode === 'replace' ? '替换' : '保存'}
            </Button>
          </div>
        </div>
      ) : null}
      {/* 删除选中（键盘快捷提示） */}
      {selection.elementId && selection.pageIndex === pageIndex ? (
        <button
          type="button"
          className="absolute -right-3 -top-3 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs text-white shadow"
          onClick={() => {
            if (selection.elementId) removeElement(selection.elementId);
          }}
          aria-label="删除元素"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
