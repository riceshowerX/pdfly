import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { IpcChannels, type AppInfo, type DesktopFileInfo, type SaveFileResult } from '../shared/ipc';

/** electron-vite 开发模式下会注入 ELECTRON_RENDERER_URL 环境变量。 */
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL'];

/** 将 Uint8Array / ArrayBuffer 统一为可写 Buffer。 */
function toBuffer(bytes: ArrayBuffer | Uint8Array): Buffer {
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Buffer.from(new Uint8Array(bytes));
}

/** 将 Buffer 转为可结构化克隆的 ArrayBuffer。 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** IPC 调用是否来自本应用渲染层（file:// 生产或 dev server origin）。 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  if (rendererDevUrl) {
    try {
      const senderOrigin = new URL(url).origin;
      const devOrigin = new URL(rendererDevUrl).origin;
      if (senderOrigin === devOrigin) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** 拒绝非本应用渲染层发起的 IPC 调用（纵深防御，M1）。 */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error('IPC 调用来源不受信任');
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 375,
    minHeight: 600,
    title: 'PDF 编辑器',
    backgroundColor: '#f8fafc',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  if (rendererDevUrl) {
    void win.loadURL(rendererDevUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 外部链接一律交给系统浏览器，避免在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: '文件',
      submenu: [
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 PDF 编辑器',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: '关于',
              message: 'PDF 编辑器',
              detail: '本地优先的 PDF 编辑器：PDF 编辑、PDF 转图片、图片转 PDF。\n所有文件处理均在本地完成，零上传。',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  const getWindow = (): BrowserWindow | null =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

  ipcMain.handle(IpcChannels.openPdf, async (event): Promise<DesktopFileInfo | null> => {
    assertTrustedSender(event);
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '打开 PDF 文件',
          properties: ['openFile'],
          filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
        })
      : await dialog.showOpenDialog({
          title: '打开 PDF 文件',
          properties: ['openFile'],
          filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
        });
    if (result.canceled || result.filePaths.length === 0) return null;
    const p = result.filePaths[0];
    const st = await stat(p);
    return { name: path.basename(p), size: st.size, path: p, type: 'application/pdf' };
  });

  ipcMain.handle(IpcChannels.openImages, async (event, multiple: boolean): Promise<DesktopFileInfo[]> => {
    assertTrustedSender(event);
    const win = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: '选择图片',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return [];
    const out: DesktopFileInfo[] = [];
    for (const p of result.filePaths) {
      const st = await stat(p);
      out.push({ name: path.basename(p), size: st.size, path: p, type: '' });
    }
    return out;
  });

  ipcMain.handle(IpcChannels.readFile, async (event, p: string): Promise<ArrayBuffer> => {
    assertTrustedSender(event);
    const buf = await readFile(p);
    return toArrayBuffer(buf);
  });

  ipcMain.handle(
    IpcChannels.saveFile,
    async (event, bytes: ArrayBuffer | Uint8Array, suggestedName: string): Promise<SaveFileResult> => {
      assertTrustedSender(event);
      const win = getWindow();
      const defaultName = suggestedName || 'untitled.pdf';
      const filters =
        defaultName.toLowerCase().endsWith('.pdf')
          ? [{ name: 'PDF 文件', extensions: ['pdf'] }]
          : defaultName.toLowerCase().endsWith('.zip')
            ? [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
            : [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }];
      const result = win
        ? await dialog.showSaveDialog(win, { title: '保存文件', defaultPath: defaultName, filters })
        : await dialog.showSaveDialog({ title: '保存文件', defaultPath: defaultName, filters });
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }
      await writeFile(result.filePath, toBuffer(bytes));
      return { canceled: false, path: result.filePath };
    },
  );

  ipcMain.handle(IpcChannels.writeFile, async (event, p: string, bytes: ArrayBuffer | Uint8Array): Promise<void> => {
    assertTrustedSender(event);
    await writeFile(p, toBuffer(bytes));
  });

  ipcMain.handle(IpcChannels.getAppInfo, async (event): Promise<AppInfo> => {
    assertTrustedSender(event);
    return {
      platform: process.platform,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
    };
  });
}

app.whenReady().then(() => {
  buildMenu();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
