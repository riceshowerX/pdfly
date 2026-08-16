/**
 * EditorCanvas：编辑工作区中央画布。
 * - 左侧缩略图栏（md+ 显示，支持拖拽重排，懒加载）；
 * - 中央滚动画布：渲染当前页 ±1 的 PageOverlay，所见即所得；
 * - 缩放控制（放大/缩小/适应宽度）；
 * - 移动端提供上一页/下一页浮动导航。
 */
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { usePdf } from '../../hooks/usePdf';
import { IconButton } from '../common/ui';
import { PageOverlay } from './PageOverlay';
import type { PdfPageInfo } from '../../core/types';

// ---------- 缩略图 ----------

function Thumb({ page, position, active, onSelect }: { page: PdfPageInfo; position: number; active: boolean; onSelect: () => void }) {
  const setThumbnail = useEditorStore((s) => s.setThumbnail);
  const { renderThumbnail } = usePdf();
  const boxRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | undefined>(page.thumbnailUrl);
  // 空白页（index=-1）无原始来源，使用位置作为排序 id 保证唯一
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: position });

  useEffect(() => {
    setUrl(page.thumbnailUrl);
  }, [page.thumbnailUrl]);

  useEffect(() => {
    if (page.index < 0) return; // 空白页不渲染缩略图
    const el = boxRef.current;
    if (!el) return;
    let disposed = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting) && !page.thumbnailUrl) {
          io.disconnect();
          // 记录请求时的 doc.id + 原始页号 + 位置，回调时校验防竞态
          const docId = useEditorStore.getState().doc?.id;
          const reqPageIndex = page.index;
          const reqPosition = position;
          void renderThumbnail(reqPageIndex, 140)
            .then((u) => {
              if (disposed) return;
              // 竞态校验：当前 store 对应位置的页原始 index 未变才写入，避免重排/删除后错位
              const curDoc = useEditorStore.getState().doc;
              if (curDoc && curDoc.id === docId && curDoc.pages[reqPosition]?.index === reqPageIndex) {
                setUrl(u);
                setThumbnail(reqPosition, u);
              }
            })
            .catch(() => {
              // 缩略图渲染失败：保留占位，不阻断
            });
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => {
      disposed = true;
      io.disconnect();
    };
  }, [page.index, page.thumbnailUrl, renderThumbnail, setThumbnail, position]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex w-full cursor-grab flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors active:cursor-grabbing ${
        active ? 'border-primary-500 bg-primary-50' : 'border-transparent hover:bg-ink-100'
      }`}
      onClick={onSelect}
    >
      <div ref={boxRef} className="flex max-h-24 w-full items-center justify-center overflow-hidden rounded bg-white shadow-sm">
        {page.index < 0 ? (
          <div className="flex h-20 w-14 items-center justify-center rounded border border-dashed border-ink-200 text-[9px] text-ink-300">
            空白页
          </div>
        ) : url ? (
          <img src={url} alt={`第 ${position + 1} 页`} className="max-h-24 max-w-full object-contain" draggable={false} />
        ) : (
          <div className="h-20 w-14 bg-ink-100" />
        )}
      </div>
      <span className="text-[10px] font-medium text-ink-500">{position + 1}</span>
      <button
        type="button"
        className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded bg-ink-800/70 text-[10px] text-white group-hover:flex"
        style={{ touchAction: 'none' }}
        {...attributes}
        {...listeners}
        aria-label="拖拽排序"
      >
        ⋮⋮
      </button>
    </div>
  );
}

// ---------- 画布 ----------

export function EditorCanvas() {
  const doc = useEditorStore((s) => s.doc);
  const currentPage = useEditorStore((s) => s.currentPage);
  const zoom = useEditorStore((s) => s.zoom);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const setZoom = useEditorStore((s) => s.setZoom);
  const reorderPages = useEditorStore((s) => s.reorderPages);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const pages = doc?.pages ?? [];

  // 可视页窗口：当前页 ±1
  const visible = new Set<number>();
  if (pages.length > 0) {
    for (let i = Math.max(0, currentPage - 1); i <= Math.min(pages.length - 1, currentPage + 1); i += 1) {
      visible.add(i);
    }
  }

  // 适应宽度：监听容器宽度
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || pages.length === 0) return;
    const cur = pages[currentPage];
    if (!cur) return;
    const compute = () => {
      const w = el.clientWidth - 48;
      const s = Math.min(w / cur.widthPt, 2.5);
      setFitScale(Math.max(0.25, s));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentPage, pages, doc?.id]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = Number(active.id);
    const to = Number(over.id);
    if (from >= 0 && to >= 0 && from !== to) reorderPages(from, to);
  };

  if (!doc) return null;

  const curPageInfo = pages[currentPage];

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* 缩略图栏（md+） */}
      <aside className="hidden w-36 flex-none flex-col overflow-y-auto border-r border-ink-200 bg-ink-50/80 p-2 scrollbar-thin md:flex">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((_, i) => i)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1">
              {pages.map((p, i) => (
                <Thumb key={`${p.index}-${i}`} page={p} position={i} active={i === currentPage} onSelect={() => setCurrentPage(i)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </aside>

      {/* 中央画布 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={viewportRef} className="flex-1 overflow-auto scrollbar-thin">
          <div className="flex min-h-full flex-col items-center gap-6 px-6 py-6">
            {pages.map((p, i) =>
              visible.has(i) ? (
                <PageOverlay
                  key={`${p.index}-${i}`}
                  pageIndex={i}
                  originalIndex={p.index}
                  widthPt={p.widthPt}
                  heightPt={p.heightPt}
                  scale={zoom}
                />
              ) : null,
            )}
          </div>
        </div>

        {/* 缩放控制 */}
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-ink-200 bg-white/95 px-2 py-1 shadow-card">
          <IconButton label="缩小" onClick={() => setZoom(zoom * 0.8)}>
            <ZoomOut size={16} />
          </IconButton>
          <span className="w-12 text-center font-mono text-xs text-ink-600">{Math.round(zoom * 100)}%</span>
          <IconButton label="放大" onClick={() => setZoom(zoom * 1.25)}>
            <ZoomIn size={16} />
          </IconButton>
          <span className="mx-0.5 h-4 w-px bg-ink-200" />
          <IconButton label="适应宽度" onClick={() => setZoom(fitScale)}>
            <Maximize size={16} />
          </IconButton>
        </div>

        {/* 移动端翻页 */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 md:hidden">
          <IconButton label="上一页" onClick={() => setCurrentPage(currentPage - 1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <span className="rounded-full bg-white/95 px-2 py-1 text-xs font-medium text-ink-600 shadow-card">
            {currentPage + 1} / {pages.length}
          </span>
          <IconButton label="下一页" onClick={() => setCurrentPage(currentPage + 1)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
