/**
 * EditorPage：PDF 在线编辑工作区。
 * - 未加载文档时展示拖拽/选择上传区；
 * - 已加载时：顶部工具栏 + 中央画布 + 移动端底部操作栏；
 * - 键盘快捷键（Ctrl+Z / Ctrl+Y / Delete）；
 * - 签名对话框宿主。
 */
import { useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileText, FolderOpen } from 'lucide-react';
import { getFileAccess } from '../core/fileAccess';
import { useEditorStore } from '../store/useEditorStore';
import { usePdf } from '../hooks/usePdf';
import { toastError } from '../store/useUiStore';
import { PdfEditorError } from '../core/types';
import { Button, EmptyState } from '../components/common/ui';
import { EditorCanvas } from '../components/editor/EditorCanvas';
import { EditorToolbar, SignatureModalHost } from '../components/editor/EditorToolbar';

export function EditorPage() {
  const doc = useEditorStore((s) => s.doc);
  const { loadPdf, dispose } = usePdf();

  const openPdf = useCallback(async () => {
    const access = getFileAccess();
    try {
      const handle = await access.openPdf();
      if (handle) await loadPdf(handle);
    } catch (err) {
      toastError(err instanceof PdfEditorError ? err.message : '打开 PDF 失败');
    }
  }, [loadPdf]);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      try {
        // 拖拽进入的文件在 Web 与 Electron 渲染层均为 File 对象，直接包装为句柄
        const handle = {
          name: file.name,
          size: file.size,
          type: file.type || 'application/pdf',
          read: () => file.arrayBuffer(),
          save: () => Promise.resolve(),
        };
        await loadPdf(handle);
      } catch (err) {
        toastError(err instanceof PdfEditorError ? err.message : '加载 PDF 失败');
      }
    },
    [loadPdf],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
  });

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = useEditorStore.getState();
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.key === 'Delete') {
        if (store.selection.elementId) {
          e.preventDefault();
          store.removeElement(store.selection.elementId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 卸载时释放文档并重置编辑器 store，避免返回编辑器时残留旧 doc 导致白屏（M2）
  useEffect(() => {
    return () => {
      dispose();
      useEditorStore.getState().reset();
    };
  }, [dispose]);

  if (!doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4">
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
            <p className="mt-1 text-sm text-ink-400">或点击选择文件 · 全程本地处理，文件零上传</p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button size="md" onClick={openPdf}>
                <FolderOpen size={16} /> 选择 PDF 文件
              </Button>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-white p-4 text-xs text-ink-500 shadow-card">
            <p className="font-medium text-ink-700">编辑能力</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>文本编辑 / 批注 / 多色高亮</li>
              <li>插入图片、形状、手写签名</li>
              <li>页面插入 / 删除 / 拖拽重排，撤销 / 重做</li>
              <li>导出保留原文（未编辑文本保持可搜索）</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hidden md:block">
        <EditorToolbar variant="top" />
      </div>
      <EditorCanvas />
      {/* 移动端底部操作栏 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <EditorToolbar variant="bottom" />
      </div>
      <SignatureModalHost />
    </div>
  );
}
