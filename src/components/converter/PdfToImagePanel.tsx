/**
 * PdfToImagePanel：PDF → 图片转换面板。
 * 加载 PDF → 设置（格式/DPI/尺寸/页范围/背景）→ 转换（进度/取消）→ 结果网格 → 单张下载 / ZIP 打包。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Download, FileImage, FileText, FolderOpen, Package, Play, XCircle, RefreshCw } from 'lucide-react';
import { PdfDocument } from '../../core/pdf/PdfDocument';
import { PdfToImageConverter, computeRenderScale } from '../../core/convert/PdfToImage';
import { getFileAccess } from '../../core/fileAccess';
import { useConvertStore } from '../../store/useConvertStore';
import { toastError, toastSuccess } from '../../store/useUiStore';
import { PdfEditorError, type ConvertResult, type PdfDocumentState, type PdfToImageOptions, type QualityPreset } from '../../core/types';
import { parsePageRange, baseName } from '../../core/utils';
import { Button, EmptyState, Input, Progress, Select, Spinner } from '../common/ui';

const DPI_PRESETS: { key: QualityPreset; label: string; dpi: number }[] = [
  { key: 'screen', label: '屏幕 96', dpi: 96 },
  { key: 'print', label: '打印 150', dpi: 150 },
  { key: 'hd', label: '高清 300', dpi: 300 },
];

export function PdfToImagePanel() {
  const [docState, setDocState] = useState<PdfDocumentState | null>(null);
  const docRef = useRef<PdfDocument | null>(null);
  const converterRef = useRef<PdfToImageConverter | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useConvertStore((s) => (taskId ? s.tasks[taskId] : undefined));

  // 释放任务的所有结果 blob URL 并移除任务（M4：防泄漏）
  const cleanupTask = useCallback((id: string | null) => {
    if (!id) return;
    const store = useConvertStore.getState();
    const t = store.tasks[id];
    if (!t) return;
    for (const r of t.results) {
      if (r.url) URL.revokeObjectURL(r.url);
    }
    store.removeTask(id);
  }, []);

  // 组件卸载 / 任务切换时统一释放当前任务的 blob URL
  useEffect(() => {
    const id = taskId;
    return () => {
      if (!id) return;
      const store = useConvertStore.getState();
      const t = store.tasks[id];
      if (!t) return;
      for (const r of t.results) {
        if (r.url) URL.revokeObjectURL(r.url);
      }
      store.removeTask(id);
    };
  }, [taskId]);

  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [dpi, setDpi] = useState(150);
  const [scale, setScale] = useState(1);
  const [targetWidth, setTargetWidth] = useState<number>(0);
  const [targetHeight, setTargetHeight] = useState<number>(0);
  const [pageRange, setPageRange] = useState('all');
  const [background, setBackground] = useState<'white' | 'transparent'>('white');

  const loadDoc = useCallback(async (handle: { name: string; size: number; type: string; read(): Promise<ArrayBuffer> }) => {
    const d = new PdfDocument();
    try {
      const state = await d.load(handle as Parameters<PdfDocument['load']>[0]);
      docRef.current?.dispose();
      docRef.current = d;
      setDocState(state);
      toastSuccess(`已加载 ${state.fileName}（${state.pageCount} 页）`);
    } catch (err) {
      d.dispose();
      toastError(err instanceof PdfEditorError ? err.message : '加载 PDF 失败');
    }
  }, []);

  const openPdf = useCallback(async () => {
    const access = getFileAccess();
    const handle = await access.openPdf();
    if (handle) await loadDoc(handle);
  }, [loadDoc]);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (file) {
        await loadDoc({
          name: file.name,
          size: file.size,
          type: file.type || 'application/pdf',
          read: () => file.arrayBuffer(),
        });
      }
    },
    [loadDoc],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
  });

  const options: PdfToImageOptions = {
    format,
    dpi,
    scale,
    targetWidth: targetWidth > 0 ? targetWidth : undefined,
    targetHeight: targetHeight > 0 ? targetHeight : undefined,
    pageRange,
    background,
  };

  const running = task?.status === 'running';

  const startConvert = async () => {
    if (!docRef.current || !docState) return;
    let total: number;
    try {
      total = parsePageRange(pageRange, docState.pageCount).length;
    } catch (err) {
      toastError(err instanceof Error ? err.message : '页范围无效');
      return;
    }
    // 新任务开始前清理旧任务（先 revoke 再 removeTask，M4）
    cleanupTask(taskId);
    const id = useConvertStore.getState().startTask({ kind: 'pdf-to-image', total });
    setTaskId(id);
    const converter = new PdfToImageConverter();
    converterRef.current = converter;
    try {
      const results = await converter.convert(docRef.current, options, (done) => {
        useConvertStore.getState().updateProgress(id, done, 0);
      });
      for (const r of results) useConvertStore.getState().addResult(id, r);
      const failed = results.filter((r) => r.status === 'error').length;
      useConvertStore.getState().setStatus(id, failed === results.length ? 'error' : 'done');
      if (failed > 0 && failed < results.length) toastError(`${failed} 页转换失败，可单独重试`);
      else if (failed === 0) toastSuccess('转换完成');
    } catch (err) {
      if (err instanceof PdfEditorError && err.errCode === 'CONVERT_CANCELLED') {
        useConvertStore.getState().setStatus(id, 'cancelled');
      } else {
        useConvertStore.getState().setStatus(id, 'error', err instanceof Error ? err.message : '转换失败');
      }
    }
  };

  const cancel = () => {
    if (taskId) useConvertStore.getState().cancelTask(taskId);
    converterRef.current?.requestCancel();
  };

  const downloadOne = async (r: ConvertResult) => {
    if (r.status !== 'ok') return;
    try {
      const access = getFileAccess();
      const bytes = await r.blob.arrayBuffer();
      await access.saveFile(bytes, r.name);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '下载失败');
    }
  };

  const downloadZip = async () => {
    if (!task) return;
    const ok = task.results.filter((r) => r.status === 'ok');
    if (ok.length === 0) return;
    try {
      const zipBlob = await PdfToImageConverter.packZip(ok);
      const access = getFileAccess();
      await access.saveFile(await zipBlob.arrayBuffer(), `${baseName(docState?.fileName ?? 'pdf')}-images.zip`);
      toastSuccess('ZIP 已下载');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'ZIP 打包下载失败');
    }
  };

  const retryFailed = async () => {
    if (!docRef.current || !task) return;
    const failed = task.results.filter((r) => r.status === 'error');
    if (failed.length === 0) return;
    cleanupTask(taskId);
    const id = useConvertStore.getState().startTask({ kind: 'pdf-to-image', total: failed.length });
    setTaskId(id);
    const converter = new PdfToImageConverter();
    converterRef.current = converter;
    try {
      const ranges = failed.map((r) => r.pageIndex + 1).join(',');
      const results = await converter.convert(docRef.current, { ...options, pageRange: ranges }, (done) => {
        useConvertStore.getState().updateProgress(id, done, 0);
      });
      for (const r of results) useConvertStore.getState().addResult(id, r);
      const errCount = results.filter((r) => r.status === 'error').length;
      useConvertStore.getState().setStatus(id, errCount === results.length ? 'error' : 'done');
    } catch (err) {
      useConvertStore.getState().setStatus(id, 'error', err instanceof Error ? err.message : '重试失败');
    }
  };

  // ---------- 未加载文档 ----------
  if (!docState) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="w-full max-w-xl">
          <div
            {...getRootProps()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
              isDragActive ? 'border-primary-400 bg-primary-50' : 'border-ink-200 bg-white hover:border-primary-300'
            }`}
          >
            <input {...getInputProps()} />
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-500">
              <FileText size={32} />
            </div>
            <h2 className="text-lg font-semibold text-ink-800">拖拽 PDF 文件到此处</h2>
            <p className="mt-1 text-sm text-ink-400">将每一页转换为 PNG / JPG 图片</p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button onClick={openPdf}>
                <FolderOpen size={16} /> 选择 PDF 文件
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 已加载：设置 + 转换 + 结果 ----------
  const progress = task && task.total > 0 ? (task.done / task.total) * 100 : 0;

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 p-4 lg:grid-cols-[320px_1fr]">
      {/* 设置面板 */}
      <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-800">转换设置</h2>
          <span className="text-xs text-ink-400">{docState.fileName} · {docState.pageCount} 页</span>
        </div>

        <div className="space-y-3">
          <Select label="输出格式" value={format} onChange={(e) => setFormat(e.target.value as 'png' | 'jpg')}>
            <option value="png">PNG（无损，支持透明）</option>
            <option value="jpg">JPG（有损，白色背景）</option>
          </Select>

          <div>
            <span className="mb-1 block text-xs font-medium text-ink-500">DPI 预设</span>
            <div className="flex flex-wrap gap-1.5">
              {DPI_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setDpi(p.dpi)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    dpi === p.dpi ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <Input label="DPI（72–600）" type="number" min={72} max={600} value={dpi} onChange={(e) => setDpi(Math.max(72, Number(e.target.value) || 72))} />
          <Input label="额外倍率（0.5–4）" type="number" min={0.5} max={4} step={0.1} value={scale} onChange={(e) => setScale(Math.max(0.5, Number(e.target.value) || 1))} />

          <div className="grid grid-cols-2 gap-2">
            <Input label="目标宽 px（0=自动）" type="number" min={0} value={targetWidth} onChange={(e) => setTargetWidth(Math.max(0, Number(e.target.value) || 0))} />
            <Input label="目标高 px（0=自动）" type="number" min={0} value={targetHeight} onChange={(e) => setTargetHeight(Math.max(0, Number(e.target.value) || 0))} />
          </div>

          <Input label="页范围（如 all / 1-5,7）" value={pageRange} onChange={(e) => setPageRange(e.target.value)} hint={`共 ${docState.pageCount} 页`} />

          <Select label="背景" value={background} onChange={(e) => setBackground(e.target.value as 'white' | 'transparent')}>
            <option value="white">白色</option>
            <option value="transparent">透明（PNG）</option>
          </Select>

          <Button className="w-full" onClick={() => void startConvert()} disabled={running}>
            <Play size={16} /> {running ? '转换中…' : '开始转换'}
          </Button>
          {running ? (
            <Button variant="secondary" className="w-full" onClick={cancel}>
              <XCircle size={16} /> 取消
            </Button>
          ) : null}
        </div>
      </div>

      {/* 结果区 */}
      <div className="min-h-[320px] rounded-xl border border-ink-200 bg-white p-4 shadow-card">
        {task ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink-800">转换结果</h2>
              {task.status === 'running' ? (
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <Spinner size={14} /> {task.done} / {task.total}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void downloadZip()} disabled={task.results.filter((r) => r.status === 'ok').length === 0}>
                    <Package size={14} /> 打包 ZIP
                  </Button>
                  {task.results.some((r) => r.status === 'error') ? (
                    <Button size="sm" variant="secondary" onClick={() => void retryFailed()}>
                      <RefreshCw size={14} /> 重试失败
                    </Button>
                  ) : null}
                </div>
              )}
            </div>

            {task.status === 'running' ? <Progress value={progress} label="转换进度" className="mb-4" /> : null}
            {task.status === 'cancelled' ? (
              <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">已取消转换，可重新开始。</div>
            ) : null}
            {task.error ? <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{task.error}</div> : null}

            {task.results.length === 0 ? (
              <EmptyState icon={<FileImage size={28} />} title="暂无结果" description="点击「开始转换」生成图片预览" />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {task.results.map((r) => (
                  <div key={r.pageIndex} className="group overflow-hidden rounded-lg border border-ink-200">
                    <div className="flex h-36 items-center justify-center bg-ink-50">
                      {r.status === 'ok' ? (
                        <img src={r.url} alt={r.name} className="max-h-36 max-w-full object-contain" />
                      ) : (
                        <div className="flex flex-col items-center gap-1 p-2 text-center text-xs text-red-500">
                          <XCircle size={20} />
                          <span className="break-all">{r.error}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-ink-100 px-2 py-1.5">
                      <span className="truncate font-mono text-[11px] text-ink-500">{r.name}</span>
                      {r.status === 'ok' ? (
                        <button
                          type="button"
                          onClick={() => void downloadOne(r)}
                          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-primary-600"
                          aria-label="下载"
                        >
                          <Download size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <EmptyState icon={<FileImage size={28} />} title="等待转换" description="设置参数后点击「开始转换」" />
        )}
      </div>
    </div>
  );
}
