/**
 * 全部领域类型定义。
 * 坐标与几何统一使用 PDF 点（point，1/72 inch），原点左下（与 PDF 坐标一致）。
 * 屏幕 ↔ PDF 的换算统一收敛在 core/geometry.ts，禁止在组件内手写换算。
 */

// ---------- 坐标与几何 ----------

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------- 错误 ----------

export type ErrorCode =
  | 'FILE_NOT_PDF'
  | 'CORRUPT_FILE'
  | 'LOAD_FAILED'
  | 'SAVE_FAILED'
  | 'EXPORT_FAILED'
  | 'CONVERT_CANCELLED'
  | 'UNSUPPORTED_IMAGE'
  | 'FONT_MISSING'
  | 'PAGE_OUT_OF_RANGE';

/** 统一业务错误：core 层抛出，UI 层捕获后 Toast + 重试入口。 */
export class PdfEditorError extends Error {
  constructor(
    public readonly errCode: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PdfEditorError';
  }
}

// ---------- 文件平台抽象 ----------

export interface FileHandle {
  name: string;
  size: number;
  type: string; // MIME，未知为 ''
  read(): Promise<ArrayBuffer>; // 读取完整字节
  save(bytes: ArrayBuffer, suggestedName: string): Promise<void>; // 覆盖保存（桌面端写回原路径）
}

export interface FileAccess {
  readonly isDesktop: boolean;
  openPdf(): Promise<FileHandle | null>;
  openImages(multiple: boolean): Promise<FileHandle[]>;
  saveFile(bytes: ArrayBuffer, name: string): Promise<void>; // 新建/另存（Web: FileSaver；桌面: IPC 对话框+fs）
}

// ---------- PDF 文档状态 ----------

export interface PdfPageInfo {
  index: number; // 原始页序号（-1 表示插入的空白页）
  widthPt: number; // 页面宽度（PDF 点）
  heightPt: number;
  rotation: number; // 0/90/180/270
  thumbnailUrl?: string; // 懒加载缩略图
}

export interface PdfDocumentState {
  id: string; // 会话 id
  fileName: string;
  originalBytes: ArrayBuffer; // 原始文件字节（导出/重置用）
  pageCount: number;
  pages: PdfPageInfo[]; // 当前文档顺序（含插入空白页）
  loadedAt: number;
}

// ---------- 编辑元素（覆盖层） ----------

export type ElementType =
  | 'text'
  | 'highlight'
  | 'note'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'image'
  | 'signature';

export interface EditorElement {
  id: string;
  type: ElementType;
  pageIndex: number;
  x: number;
  y: number; // PDF 点坐标（左下原点）
  width: number;
  height: number;
  rotation?: number; // 元素旋转（度）
  // 线条/箭头：用户拖拽的真实起终点（PDF 点，左下原点）。
  // 屏幕预览与导出共用该语义保证方向一致；旧数据缺省时回退为 (x,y)→(x+w,y+h)。
  startPt?: Point;
  endPt?: Point;
  // 文本/文字类
  text?: string;
  fontSize?: number;
  fontFamily?: 'sans' | 'serif' | 'noto'; // 导出字体映射
  color?: string; // 十六进制
  // 图形类
  fillColor?: string;
  strokeWidth?: number;
  opacity?: number; // 0–1（高亮用 0.3–0.5）
  // 文本替换
  coversOriginalText?: boolean; // 导出时先用背景色矩形遮盖原文（E2 文本编辑）
  // 图片/签名
  imageDataUrl?: string; // PNG/JPEG dataURL（签名/图片元素）
  // 批注
  noteText?: string;
  createdAt: number;
}

export type Tool =
  | 'select'
  | 'text'
  | 'highlight'
  | 'note'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'image'
  | 'signature'
  | 'pan';

export interface SelectionState {
  elementId: string | null;
  pageIndex: number | null;
}

// ---------- 命令（撤销/重做） ----------

export type Command =
  | { kind: 'add-element'; element: EditorElement }
  | { kind: 'remove-element'; elementId: string; pageIndex: number }
  | { kind: 'update-element'; elementId: string; before: EditorElement; after: EditorElement }
  | { kind: 'replace-text'; pageIndex: number; rect: Rect; oldText: string; newText: string; style: TextStyle }
  | { kind: 'page-insert'; index: number; page: PdfPageInfo }
  | { kind: 'page-delete'; index: number; page: PdfPageInfo }
  | { kind: 'page-reorder'; fromIndex: number; toIndex: number };

// ---------- 文本样式 ----------

export interface TextStyle {
  fontSize: number;
  fontFamily: string;
  color: string;
  opacity?: number;
}

// ---------- 转换任务 ----------

export type ConvertFormat = 'png' | 'jpg';
export type QualityPreset = 'screen' | 'print' | 'hd'; // 96/150/300 DPI 快捷模板

export interface PdfToImageOptions {
  format: ConvertFormat;
  dpi: number; // 72/150/300
  scale?: number; // 额外倍率（可与 DPI 叠加）
  targetWidth?: number; // 可选：直接指定目标像素宽
  targetHeight?: number;
  pageRange: string; // 'all' | '1-5,7'
  background: 'white' | 'transparent';
}

export interface ImagePdfOptions {
  pageSize: 'a4' | 'letter' | 'custom';
  widthPt?: number; // custom 时必填
  heightPt?: number;
  marginPt: number; // 页边距（PDF 点）
  fit: 'contain' | 'cover' | 'stretch';
  scale: number; // 0.1–4 额外缩放
}

export type TaskStatus = 'idle' | 'running' | 'cancelled' | 'done' | 'error';

export interface ConvertResult {
  pageIndex: number;
  name: string; // 如 page-001.png
  blob: Blob;
  url: string; // 预览 objectURL
  status: 'ok' | 'error';
  error?: string;
}

export interface ConvertTask {
  id: string;
  kind: 'pdf-to-image' | 'image-to-pdf';
  status: TaskStatus;
  total: number;
  done: number;
  failed: number;
  cancelRequested: boolean;
  results: ConvertResult[];
  outputName?: string; // 生成文件名（image-to-pdf 产物）
  error?: string;
}

// ---------- 图片转 PDF 输入项 ----------

export interface ImageItem {
  id: string;
  name: string;
  dataUrl: string; // 解码后统一为 PNG/JPEG dataURL
  width: number; // 自然像素宽（旋转前）
  height: number; // 自然像素高（旋转前）
  rotation: number; // 0/90/180/270
  error?: string; // 解码失败标记
}

// ---------- 导出配置 ----------

export interface ExportConfig {
  includeOverlays: boolean; // 是否绘制叠加层（false = 仅页面操作）
  embedFont: 'helvetica' | 'noto-sans-sc' | 'none'; // 文本元素导出字体
  compressImages?: boolean; // P2
}

// ---------- 通用 UI ----------

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  duration?: number; // ms，默认 3200
}

export interface AppSettings {
  compactThumbnails: boolean;
  confirmBeforeDelete: boolean;
}

export interface ModalState {
  type: 'signature';
  payload?: { pageIndex?: number };
}
