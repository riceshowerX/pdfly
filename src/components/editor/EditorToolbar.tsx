/**
 * EditorToolbar：编辑器工具栏。
 * - 工具切换（选择/文本/高亮/批注/形状/图片/签名）；
 * - 撤销/重做、页面操作（插入空白页/删除当前页）；
 * - 属性面板（选中元素的颜色/字号/线宽/透明度）；
 * - 签名对话框（手写绘制 + 图片导入）；
 * - 导出编辑后 PDF。
 * 移动端通过 variant='bottom' 渲染紧凑底部操作栏。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Circle,
  FileDown,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Minus,
  MousePointer,
  PenLine,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  ArrowUpRight,
  Plus,
  Eraser,
} from 'lucide-react';
import { useEditorStore } from '../../store/useEditorStore';
import { toastError, toastSuccess, useUiStore } from '../../store/useUiStore';
import { PdfExporter, loadEmbeddedFontBytes } from '../../core/pdf/PdfExporter';
import { PdfEditorError } from '../../core/types';
import { decodeImageFile } from '../../core/convert/ImageToPdf';
import { uid } from '../../core/utils';
import { Button, ColorInput, IconButton, Input, Modal } from '../common/ui';
import type { EditorElement, Tool } from '../../core/types';

const TOOLS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: 'select', label: '选择', icon: <MousePointer size={17} /> },
  { tool: 'text', label: '文本', icon: <Type size={17} /> },
  { tool: 'highlight', label: '高亮', icon: <Highlighter size={17} /> },
  { tool: 'note', label: '批注', icon: <StickyNote size={17} /> },
  { tool: 'rect', label: '矩形', icon: <Square size={17} /> },
  { tool: 'ellipse', label: '椭圆', icon: <Circle size={17} /> },
  { tool: 'arrow', label: '箭头', icon: <ArrowUpRight size={17} /> },
  { tool: 'line', label: '线条', icon: <Minus size={17} /> },
  { tool: 'signature', label: '签名', icon: <PenLine size={17} /> },
  { tool: 'image', label: '图片', icon: <ImageIcon size={17} /> },
  { tool: 'pan', label: '抓手', icon: <Hand size={17} /> },
];

const MOBILE_TOOLS: Tool[] = ['select', 'text', 'highlight', 'note', 'rect', 'signature'];

// ---------- 签名对话框 ----------

function SignatureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = 520 * dpr;
    canvas.height = 200 * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 520, 200);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    setHasInk(false);
  }, [open]);

  const pos = (e: ReactPointerEvent): { x: number; y: number } => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: ReactPointerEvent) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawingRef.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !drawingRef.current) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  };

  const onUp = () => {
    drawingRef.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setHasInk(false);
  };

  const importImage = async (file: File) => {
    try {
      const { dataUrl, width, height } = await decodeImageFile(file);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(480 / img.width, 180 / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (520 - w) / 2, (200 - h) / 2, w, h);
        setHasInk(true);
      };
      img.src = dataUrl;
      void width;
      void height;
    } catch {
      toastError('图片导入失败，请使用 PNG/JPG 格式');
    }
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const store = useEditorStore.getState();
    const pageIndex = store.currentPage;
    const page = store.doc?.pages[pageIndex];
    if (!page) return;
    const maxW = Math.min(240, page.widthPt * 0.7);
    const maxH = Math.min(120, page.heightPt * 0.3);
    const aspect = 520 / 200;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    const el: EditorElement = {
      id: uid('el'),
      type: 'signature',
      pageIndex,
      x: (page.widthPt - w) / 2,
      y: (page.heightPt - h) / 3,
      width: w,
      height: h,
      imageDataUrl: dataUrl,
      opacity: 1,
      createdAt: Date.now(),
    };
    store.addElement(el);
    onClose();
    toastSuccess('签名已添加');
  };

  return (
    <Modal open={open} title="添加签名" onClose={onClose} width="md">
      <div className="flex flex-col gap-3">
        <canvas
          ref={canvasRef}
          className="h-52 w-full touch-none rounded-lg border border-ink-200 bg-white"
          style={{ cursor: 'crosshair' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={clear}>
            <Eraser size={14} /> 清除
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <ImageIcon size={14} /> 导入图片
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/bmp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importImage(f);
              e.target.value = '';
            }}
          />
          <div className="flex-1" />
          <Button size="sm" onClick={save} disabled={!hasInk}>
            添加到页面
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- 属性面板 ----------

/** 数值输入：blur/Enter 时提交单条命令（避免每次按键都 push 一条历史，L7）。 */
function CommitNumberInput({
  value,
  min,
  max,
  step,
  onCommit,
  className,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (v: number) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Number(draft) || value));
    onCommit(next);
    setDraft(null);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
      className={className}
    />
  );
}

function PropsPanel() {
  const selection = useEditorStore((s) => s.selection);
  const elements = useEditorStore((s) => s.elements);
  const updateElement = useEditorStore((s) => s.updateElement);
  const el = elements.find((e) => e.id === selection.elementId);

  if (!el) {
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-ink-400">
        <span>选择元素后可编辑颜色 / 字号 / 线宽 / 透明度</span>
      </div>
    );
  }

  const isText = el.type === 'text';
  const isHighlight = el.type === 'highlight';
  const isShape = el.type === 'rect' || el.type === 'ellipse' || el.type === 'arrow' || el.type === 'line';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
      {isText ? (
        <>
          <ColorInput label="颜色" value={el.color ?? '#111827'} onChange={(c) => updateElement(el.id, { color: c })} />
          <label className="flex items-center gap-1.5 text-xs text-ink-500">
            字号
            <CommitNumberInput
              key={`${el.id}-fontSize`}
              ariaLabel="字号"
              min={6}
              max={96}
              value={el.fontSize ?? 14}
              onCommit={(v) => updateElement(el.id, { fontSize: v })}
              className="h-8 w-16 rounded-lg border border-ink-200 px-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-500">
            字体
            <select
              value={el.fontFamily ?? 'sans'}
              onChange={(e) => updateElement(el.id, { fontFamily: e.target.value as EditorElement['fontFamily'] })}
              className="h-8 rounded-lg border border-ink-200 px-2 text-sm"
            >
              <option value="sans">无衬线</option>
              <option value="serif">衬线</option>
              <option value="noto">中文(Noto)</option>
            </select>
          </label>
        </>
      ) : null}
      {isHighlight ? (
        <>
          <ColorInput label="颜色" value={el.color ?? '#fde047'} onChange={(c) => updateElement(el.id, { color: c })} />
          <label className="flex items-center gap-1.5 text-xs text-ink-500">
            透明度
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={el.opacity ?? 0.35}
              onChange={(e) => updateElement(el.id, { opacity: Number(e.target.value) })}
              className="w-24"
            />
          </label>
        </>
      ) : null}
      {isShape ? (
        <>
          <ColorInput label="颜色" value={el.color ?? '#334155'} onChange={(c) => updateElement(el.id, { color: c })} />
          {el.type === 'rect' || el.type === 'ellipse' ? (
            <ColorInput label="填充" value={el.fillColor ?? '#ffffff'} onChange={(c) => updateElement(el.id, { fillColor: c })} />
          ) : null}
          <label className="flex items-center gap-1.5 text-xs text-ink-500">
            线宽
            <CommitNumberInput
              key={`${el.id}-strokeWidth`}
              ariaLabel="线宽"
              min={0.5}
              max={12}
              step={0.5}
              value={el.strokeWidth ?? 1}
              onCommit={(v) => updateElement(el.id, { strokeWidth: v })}
              className="h-8 w-16 rounded-lg border border-ink-200 px-2 text-sm"
            />
          </label>
        </>
      ) : null}
      {el.type === 'note' ? (
        <>
          <ColorInput label="颜色" value={el.color ?? '#f59e0b'} onChange={(c) => updateElement(el.id, { color: c })} />
          <span className="max-w-[220px] truncate text-xs text-ink-400">{el.noteText}</span>
        </>
      ) : null}
    </div>
  );
}

// ---------- 工具栏 ----------

export interface EditorToolbarProps {
  variant?: 'top' | 'bottom';
}

export function EditorToolbar({ variant = 'top' }: EditorToolbarProps) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const doc = useEditorStore((s) => s.doc);
  const elements = useEditorStore((s) => s.elements);
  const selection = useEditorStore((s) => s.selection);
  const removeElement = useEditorStore((s) => s.removeElement);
  const insertBlankPage = useEditorStore((s) => s.insertBlankPage);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const stack = useEditorStore((s) => s.stack);
  const openModal = useUiStore((s) => s.openModal);
  const [fontOk, setFontOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 订阅 elements 等状态以获得撤销/重做可用性刷新
  void elements;
  void selection;

  useEffect(() => {
    let alive = true;
    void loadEmbeddedFontBytes().then((b) => {
      if (alive) setFontOk(!!b);
    });
    return () => {
      alive = false;
    };
  }, []);

  const insertImage = async (file: File) => {
    const store = useEditorStore.getState();
    const pageIndex = store.currentPage;
    const page = store.doc?.pages[pageIndex];
    if (!page) return;
    try {
      const { dataUrl, width, height } = await decodeImageFile(file);
      const maxW = page.widthPt * 0.8;
      const maxH = page.heightPt * 0.8;
      const scale = Math.min(maxW / width, maxH / height, 1);
      const w = Math.min(width * scale, maxW);
      const h = height * scale * (w / (width * scale || 1));
      const el: EditorElement = {
        id: uid('el'),
        type: 'image',
        pageIndex,
        x: (page.widthPt - w) / 2,
        y: (page.heightPt - h) / 2,
        width: w,
        height: h,
        imageDataUrl: dataUrl,
        opacity: 1,
        createdAt: Date.now(),
      };
      store.addElement(el);
      toastSuccess('图片已插入');
    } catch (err) {
      toastError(err instanceof PdfEditorError ? err.message : '图片插入失败');
    }
  };

  const exportPdf = async () => {
    const store = useEditorStore.getState();
    if (!store.doc) return;
    setBusy(true);
    try {
      await new PdfExporter().saveEdited(store.doc, store.elements, {
        includeOverlays: true,
        embedFont: 'noto-sans-sc',
      });
      toastSuccess('导出成功，已保存编辑后的 PDF');
    } catch (err) {
      if (err instanceof PdfEditorError && err.errCode === 'FONT_MISSING') {
        toastError('导出中文需要字体资源：请联网后运行 npm run fetch:font 后重启应用');
      } else {
        toastError(err instanceof Error ? err.message : '导出失败');
      }
    } finally {
      setBusy(false);
    }
  };

  // 删除当前页：遵循 settings.confirmBeforeDelete 设置（M11）
  const handleDeletePage = () => {
    const store = useEditorStore.getState();
    const index = store.currentPage;
    const confirmBeforeDelete = useUiStore.getState().settings.confirmBeforeDelete;
    if (confirmBeforeDelete && !window.confirm('确定删除当前页吗？删除后可通过撤销恢复。')) return;
    store.deletePage(index);
  };

  const canUndo = stack.canUndo;
  const canRedo = stack.canRedo;
  const tools = variant === 'bottom' ? TOOLS.filter((t) => MOBILE_TOOLS.includes(t.tool)) : TOOLS;

  return (
    <div className={variant === 'bottom' ? 'contents' : 'flex flex-col gap-1 border-b border-ink-200 bg-white/95 px-2 py-1.5'}>
      {/* 工具行 */}
      <div className="flex flex-wrap items-center gap-0.5">
        {tools.map(({ tool: t, label, icon }) => (
          <IconButton key={t} label={label} active={tool === t} onClick={() => setTool(t)}>
            {icon}
          </IconButton>
        ))}
        <span className="mx-1 h-5 w-px bg-ink-200" />
        <IconButton label="撤销" onClick={undo} className={canUndo ? '' : 'opacity-35'}>
          <Undo2 size={17} />
        </IconButton>
        <IconButton label="重做" onClick={redo} className={canRedo ? '' : 'opacity-35'}>
          <Redo2 size={17} />
        </IconButton>
        {variant === 'top' ? (
          <>
            <span className="mx-1 h-5 w-px bg-ink-200" />
            <IconButton label="插入空白页" onClick={() => insertBlankPage()}>
              <Plus size={17} />
            </IconButton>
            <IconButton label="删除当前页" onClick={handleDeletePage}>
              <Trash2 size={17} />
            </IconButton>
            <IconButton label="插入图片" onClick={() => imageInputRef.current?.click()}>
              <ImageIcon size={17} />
            </IconButton>
            <IconButton label="手写签名" onClick={() => openModal({ type: 'signature' })}>
              <PenLine size={17} />
            </IconButton>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void insertImage(f);
                e.target.value = '';
              }}
            />
          </>
        ) : null}
        <div className="flex-1" />
        {fontOk === false ? (
          <span className="hidden rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700 sm:inline">
            中文字体未加载，中文导出受限
          </span>
        ) : null}
        <Button size="sm" onClick={() => void exportPdf()} disabled={busy || !doc} className="ml-1">
          <FileDown size={15} /> {busy ? '导出中…' : '导出'}
        </Button>
      </div>
      {/* 属性面板（顶部工具栏） */}
      {variant === 'top' ? (
        <div className="flex items-center border-t border-ink-100 px-1 py-1">
          <PropsPanel />
          {selection.elementId ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-red-500 hover:bg-red-50"
              onClick={() => selection.elementId && removeElement(selection.elementId)}
            >
              <Trash2 size={14} /> 删除
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SignatureModalHost() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  return <SignatureDialog open={modal?.type === 'signature'} onClose={closeModal} />;
}
