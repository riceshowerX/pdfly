/**
 * IPC 通道常量与类型（main / preload / 渲染层共享）。
 * 本文件为纯类型 + 常量模块，不 import 任何 electron 运行时模块，
 * 因此可被 Web 端构建安全引用。
 */

export const IpcChannels = {
  openPdf: 'pdf:open-pdf',
  openImages: 'pdf:open-images',
  readFile: 'pdf:read-file',
  saveFile: 'pdf:save-file',
  writeFile: 'pdf:write-file',
  getAppInfo: 'app:get-info',
} as const;

/** 桌面端文件对话框返回的本地文件描述。 */
export interface DesktopFileInfo {
  name: string;
  size: number;
  path: string;
  type: string;
}

/** 保存文件对话框结果。 */
export interface SaveFileResult {
  canceled: boolean;
  path?: string;
}

/** 应用运行时信息（用于 UI 展示与诊断）。 */
export interface AppInfo {
  platform: string;
  versions: Record<string, string | undefined>;
}

/** preload 通过 contextBridge 暴露到 window.pdfApi 的接口。 */
export interface PdfApi {
  openPdf(): Promise<DesktopFileInfo | null>;
  openImages(multiple: boolean): Promise<DesktopFileInfo[]>;
  readFile(path: string): Promise<ArrayBuffer>;
  saveFile(bytes: ArrayBuffer | Uint8Array, suggestedName: string): Promise<SaveFileResult>;
  writeFile(path: string, bytes: ArrayBuffer | Uint8Array): Promise<void>;
  getAppInfo(): Promise<AppInfo>;
}
