/**
 * ImageToPdfPanel：图片 → PDF 转换面板。
 * 多选/拖拽上传图片（PNG/JPG/GIF/BMP）→ 缩略图列表（拖拽排序/旋转/删除）→ 版式设置（页面尺寸/边距/缩放）→ 生成 PDF → 预览/下载。
 * 损坏图片隔离报错，不中断其他图片。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileDown, ImagePlus, Play, RotateCw, Trash2, Upload, XCircle, FileText } from 'lucide-react';
import { decodeImageFile, ImageToPdfConverter } from '../../core/convert/ImageToPdf';
import { getFileAccess } from '../../core/fileAccess';
import { useConvertStore } from '../../store/useConvertStore';
import { toastError, toastSuccess } from '../../store/useUiStore';
import { PdfEditorError, type ImageItem, type ImagePdfOptions } from '../../core/types';
import { uid } from '../../core/utils';
import { Button, EmptyState, Input, Progress, Select } from '../common/ui';

// ---------- 可排序图片项 ----------

function SortableImage({ item, onRotate, onRemove }: { item: ImageItem; onRotate: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex w-28 flex-none flex-col items-center gap-1 rounded-lg border p-1.5 ${
        item.error ? 'border-red-200 bg-red-50' : 'border-ink-200 bg-white'
      }`}
    >
      <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded bg-ink-50">
        {item.error ? (
          <div className="flex flex-col items-center gap-1 p-1 text-center text-[10px] text-red-500">
            <XCircle size={16} />
            <span className="break-all">{item.error}</span>
          </div>
        ) : (
          <img
            src={item.dataUrl}
            alt={item.name}
            draggable={false}
            className="max-h-24 max-w-full object-contain"
            style={{ transform: `rotate(${item.rotation}deg)` }}
          />
        )}
      </div>
      <span className="w-full truncate text-center text-[10px] text-ink-500">{item.name}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onRotate} className="rounded p-1 text-ink-400 hover:bg-ink-100" aria-label="旋转">
          <RotateCw size={13} />
        </button>
        <button type="button" onClick={onRemove} className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-500" aria-label="删除">
          <Trash2 size={13} />
        </button>
        <span className="cursor-grab rounded p-1 text-ink-300 active:cursor-grabbing" {...attributes} {...listeners} aria-label="拖拽排序">
          ⋮⋮
        </span>
      </div>
    </div>
  );
}

// ---------- 面板 ----------

export function ImageToPdfPanel() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useConvertStore((s) => (taskId ? s.tasks[taskId] : undefined));
  const converterRef = useRef<ImageToPdfConverter | null>(null);

  const [pageSize, setPageSize] = useState<'a4' | 'letter' | 'custom'>('a4');
  const [widthPt, setWidthPt] = useState(595.28);
  const [heightPt, setHeightPt] = useState(841.89);
  const [marginPt, setMarginPt] = useState(40);
  const [fit, setFit] = useState<'contain' | 'cover' | 'stretch'>('contain');
  const [scale, setScale] = useState(1);

  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputName, setOutputName] = useState('images.pdf');

  // 卸载时释放生成的 blob URL（M5：防泄漏）
  useEffect(() => {
    const url = outputUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [outputUrl]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const addFiles = useCallback(async (files: File[]) => {
    const accepted = files.filter((f) => /\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name) || /^image\//.test(f.type));
    const rejected = files.length - accepted.length;
    if (rejected > 0) toastError(`${rejected} 个文件不是支持的图片格式（PNG/JPG/GIF/BMP）`);
    const next: ImageItem[] = [];
    for (const f of accepted) {
      try {
        const { dataUrl, width, height } = await decodeImageFile(f);
        next.push({ id: uid('img'), name: f.name, dataUrl, width, height, rotation: 0 });
      } catch (err) {
        next.push({
          id: uid('img'),
          name: f.name,
          dataUrl: '',
          width: 0,
          height: 0,
          rotation: 0,
          error: err instanceof PdfEditorError ? err.message : '无法解码该图片',
        });
      }
    }
    setItems((prev) => [...prev, ...next]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => void addFiles(accepted),
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/gif': ['.gif'],
      'image/bmp': ['.bmp'],
      'image/webp': ['.webp'],
    },
    multiple: true,
  });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === active.id);
      const to = prev.findIndex((i) => i.id === over.id);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const rotateItem = (id: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, rotation: (i.rotation + 90) % 360 } : i)));

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const options: ImagePdfOptions = { pageSize, widthPt, heightPt, marginPt, fit, scale };

  const running = task?.status === 'running';

  const generate = async () => {
    if (items.length === 0) return;
    const valid = items.filter((i) => !i.error);
    if (valid.length === 0) {
      toastError('没有可用的图片');
      return;
    }
    const id = useConvertStore.getState().startTask({ kind: 'image-to-pdf', total: valid.length });
    setTaskId(id);
    const converter = new ImageToPdfConverter();
    converterRef.current = converter;
    try {
      const blob = await converter.convert(items, options, (done, total) => {
        useConvertStore.getState().updateProgress(id, done, 0);
        void total;
      });
      const url = URL.createObjectURL(blob);
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      setOutputUrl(url);
      setOutputName('images.pdf');
      useConvertStore.getState().setStatus(id, 'done');
      toastSuccess('PDF 生成完成');
    } catch (err) {
      if (err instanceof PdfEditorError && err.errCode === 'CONVERT_CANCELLED') {
        useConvertStore.getState().setStatus(id, 'cancelled');
      } else {
        useConvertStore.getState().setStatus(id, 'error', err instanceof Error ? err.message : '生成失败');
      }
    }
  };

  const cancel = () => {
    if (taskId) useConvertStore.getState().cancelTask(taskId);
    converterRef.current?.requestCancel();
  };

  const download = async () => {
    if (!outputUrl) return;
    try {
      const access = getFileAccess();
      const res = await fetch(outputUrl);
      if (!res.ok) throw new Error('获取文件失败');
      const bytes = await res.arrayBuffer();
      await access.saveFile(bytes, outputName);
      toastSuccess('已下载');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '下载失败');
    }
  };

  const progress = task && task.total > 0 ? (task.done / task.total) * 100 : 0;

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_320px]">
      {/* 图片列表 */}
      <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-ink-800">图片列表（{items.length}）</h2>

        {items.length === 0 ? (
          <div
            {...getRootProps()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
              isDragActive ? 'border-primary-400 bg-primary-50' : 'border-ink-200 hover:border-primary-300'
            }`}
          >
            <input {...getInputProps()} />
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-500">
              <ImagePlus size={28} />
            </div>
            <p className="text-sm font-medium text-ink-700">拖拽图片到此处，或点击选择</p>
            <p className="mt-1 text-xs text-ink-400">支持 PNG / JPG / GIF / BMP，可多选</p>
          </div>
        ) : (
          <>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
                <div className="flex flex-wrap gap-3">
                  {items.map((item) => (
                    <SortableImage
                      key={item.id}
                      item={item}
                      onRotate={() => rotateItem(item.id)}
                      onRemove={() => removeItem(item.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={() => (document.getElementById('img-upload') as HTMLInputElement | null)?.click()}>
                <Upload size={14} /> 继续添加
              </Button>
              <input
                id="img-upload"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  void addFiles(files);
                  e.target.value = '';
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* 设置面板 */}
      <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-ink-800">版式设置</h2>
        <div className="space-y-3">
          <Select label="页面尺寸" value={pageSize} onChange={(e) => setPageSize(e.target.value as 'a4' | 'letter' | 'custom')}>
            <option value="a4">A4（210×297mm）</option>
            <option value="letter">Letter（216×279mm）</option>
            <option value="custom">自定义</option>
          </Select>
          {pageSize === 'custom' ? (
            <div className="grid grid-cols-2 gap-2">
              <Input label="宽度 pt" type="number" min={100} value={widthPt} onChange={(e) => setWidthPt(Math.max(100, Number(e.target.value) || 595.28))} />
              <Input label="高度 pt" type="number" min={100} value={heightPt} onChange={(e) => setHeightPt(Math.max(100, Number(e.target.value) || 841.89))} />
            </div>
          ) : null}
          <Input label="页边距 pt（0–200）" type="number" min={0} max={200} value={marginPt} onChange={(e) => setMarginPt(Math.max(0, Number(e.target.value) || 0))} />
          <Select label="图片适配" value={fit} onChange={(e) => setFit(e.target.value as 'contain' | 'cover' | 'stretch')}>
            <option value="contain">包含（完整显示，留白）</option>
            <option value="cover">铺满（裁切溢出）</option>
            <option value="stretch">拉伸（填满页面）</option>
          </Select>
          <Input label="缩放比例（0.1–4）" type="number" min={0.1} max={4} step={0.1} value={scale} onChange={(e) => setScale(Math.max(0.1, Number(e.target.value) || 1))} />

          <Button className="w-full" onClick={() => void generate()} disabled={running || items.length === 0}>
            <Play size={16} /> {running ? '生成中…' : '生成 PDF'}
          </Button>
          {running ? (
            <Button variant="secondary" className="w-full" onClick={cancel}>
              <XCircle size={16} /> 取消
            </Button>
          ) : null}

          {running ? <Progress value={progress} label="生成进度" /> : null}
          {task?.status === 'cancelled' ? <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">已取消生成。</div> : null}
          {task?.status === 'error' ? <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{task.error}</div> : null}

          {outputUrl ? (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-primary-100 bg-primary-50 p-3">
              <div className="flex items-center gap-2 text-xs text-primary-700">
                <FileText size={14} /> 已生成 {outputName}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => window.open(outputUrl, '_blank')}>
                  预览
                </Button>
                <Button size="sm" onClick={() => void download()}>
                  <FileDown size={14} /> 下载
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
