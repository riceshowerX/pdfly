import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type AppInfo, type DesktopFileInfo, type PdfApi, type SaveFileResult } from '../shared/ipc';

/**
 * 通过 contextBridge 将安全的 IPC 封装暴露为 window.pdfApi。
 * 渲染层只允许调用白名单方法，无法直接访问 Node/Electron 能力。
 */
const api: PdfApi = {
  openPdf: (): Promise<DesktopFileInfo | null> => ipcRenderer.invoke(IpcChannels.openPdf),
  openImages: (multiple: boolean): Promise<DesktopFileInfo[]> => ipcRenderer.invoke(IpcChannels.openImages, multiple),
  readFile: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke(IpcChannels.readFile, path),
  saveFile: (bytes: ArrayBuffer | Uint8Array, suggestedName: string): Promise<SaveFileResult> =>
    ipcRenderer.invoke(IpcChannels.saveFile, bytes, suggestedName),
  writeFile: (path: string, bytes: ArrayBuffer | Uint8Array): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.writeFile, path, bytes),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannels.getAppInfo),
};

contextBridge.exposeInMainWorld('pdfApi', api);
