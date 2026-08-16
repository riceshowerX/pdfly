/**
 * FileAccess 平台抽象：Web（File API + FileSaver）与 Electron（IPC + dialog + fs）双实现。
 * 任何文件读写必须经本模块接口，组件禁止直接调用 window.pdfApi 或 FileReader。
 */
import { saveAs } from 'file-saver';
import type { PdfApi } from '../../electron/shared/ipc';
import { fileToArrayBuffer, isLargeFile } from './utils';
import type { FileAccess, FileHandle } from './types';

// ---------- 工具：Web 文件选择 ----------

let inputEl: HTMLInputElement | null = null;

function getInputElement(): HTMLInputElement {
  if (!inputEl) {
    inputEl = document.createElement('input');
    inputEl.type = 'file';
    inputEl.style.display = 'none';
    document.body.appendChild(inputEl);
  }
  return inputEl;
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = getInputElement();
    input.accept = accept;
    input.multiple = multiple;
    input.value = '';
    let settled = false;
    let focusTimer: number | null = null;
    let hardTimer: number | null = null;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };
    const cleanup = () => {
      input.onchange = null;
      window.removeEventListener('focus', onFocus);
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      if (hardTimer !== null) window.clearTimeout(hardTimer);
    };
    const onFocus = () => {
      // 文件选择器关闭后窗口重新聚焦：给 onchange 一个短窗口，超时视为用户取消
      if (settled) return;
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => finish([]), 800);
    };
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      finish(files);
    };
    window.addEventListener('focus', onFocus);
    // 兜底：长时间无任何交互（覆盖不触发 focus 事件的浏览器/移动端）
    hardTimer = window.setTimeout(() => finish([]), 600_000);
    input.click();
  });
}

// ---------- Web 实现 ----------

export class WebFileHandle implements FileHandle {
  constructor(
    public readonly name: string,
    public readonly size: number,
    public readonly type: string,
    private readonly file: File,
  ) {}

  async read(): Promise<ArrayBuffer> {
    return fileToArrayBuffer(this.file);
  }

  async save(bytes: ArrayBuffer, suggestedName: string): Promise<void> {
    const blob = new Blob([bytes], { type: this.type || 'application/octet-stream' });
    saveAs(blob, suggestedName || this.name);
  }
}

export class WebFileAccess implements FileAccess {
  readonly isDesktop = false;

  async openPdf(): Promise<FileHandle | null> {
    const files = await pickFiles('application/pdf,.pdf', false);
    if (files.length === 0) return null;
    const file = files[0];
    if (isLargeFile(file.size)) {
      // 大文件仅提示风险，允许尝试（Q7）
      console.warn(`[pdf-editor] 大文件（${file.size} 字节），Web 端可能影响性能`);
    }
    return new WebFileHandle(file.name, file.size, file.type || 'application/pdf', file);
  }

  async openImages(multiple: boolean): Promise<FileHandle[]> {
    const files = await pickFiles('image/png,image/jpeg,image/gif,image/bmp,.png,.jpg,.jpeg,.gif,.bmp,.webp', multiple);
    return files.map((f) => new WebFileHandle(f.name, f.size, f.type, f));
  }

  async saveFile(bytes: ArrayBuffer, name: string): Promise<void> {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    saveAs(blob, name);
  }
}

// ---------- Electron 实现 ----------

export class ElectronFileHandle implements FileHandle {
  constructor(
    public readonly name: string,
    public readonly size: number,
    public readonly type: string,
    private readonly path: string,
    private readonly api: PdfApi,
  ) {}

  async read(): Promise<ArrayBuffer> {
    return this.api.readFile(this.path);
  }

  async save(bytes: ArrayBuffer, suggestedName: string): Promise<void> {
    const result = await this.api.saveFile(bytes, suggestedName || this.name);
    if (result.canceled) {
      console.info('[pdf-editor] 用户取消保存');
    }
  }
}

export class ElectronFileAccess implements FileAccess {
  readonly isDesktop = true;

  constructor(private readonly api: PdfApi) {}

  async openPdf(): Promise<FileHandle | null> {
    const info = await this.api.openPdf();
    if (!info) return null;
    return new ElectronFileHandle(info.name, info.size, info.type || 'application/pdf', info.path, this.api);
  }

  async openImages(multiple: boolean): Promise<FileHandle[]> {
    const infos = await this.api.openImages(multiple);
    return infos.map((info) => new ElectronFileHandle(info.name, info.size, info.type, info.path, this.api));
  }

  async saveFile(bytes: ArrayBuffer, name: string): Promise<void> {
    await this.api.saveFile(bytes, name);
  }
}

// ---------- 工厂 ----------

let cachedAccess: FileAccess | null = null;

function detectPdfApi(): PdfApi | null {
  const w = window as unknown as { pdfApi?: PdfApi };
  return w.pdfApi ?? null;
}

/** 按平台返回正确的 FileAccess 实现（首次调用后缓存）。 */
export function getFileAccess(): FileAccess {
  if (cachedAccess) return cachedAccess;
  const api = detectPdfApi();
  cachedAccess = api ? new ElectronFileAccess(api) : new WebFileAccess();
  return cachedAccess;
}

/** 供测试重置缓存。 */
export function resetFileAccessForTest(): void {
  cachedAccess = null;
}
