# PDF 编辑器（pdf-editor）

本地优先、双端可用（Web + 桌面 Electron）的 PDF 编辑器，覆盖三大核心场景：

1. **编辑 PDF**：文本编辑（替换原文）、批注、多色高亮、插入图片/形状/手写签名、页面插入/删除/拖拽重排、撤销/重做、实时预览、导出（保留原文可搜索）。
2. **PDF 转图片**：单页/全部页面转 PNG/JPG，自定义 DPI、分辨率/尺寸、页范围；进度/取消、单张下载、ZIP 批量打包。
3. **图片转 PDF**：PNG/JPG/GIF/BMP 多图合并，拖拽排序/旋转/删除，自定义页面尺寸/边距/缩放，进度与错误隔离。

**隐私**：所有处理均在本地完成，文件零上传、零留存；桌面端可完全断网使用。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vite 5 + React 18 + TypeScript（strict）+ Tailwind CSS |
| 桌面壳 | Electron 33 + electron-vite（`electron/` 仅 3 个文件，Web 源码零改动复用） |
| PDF 内核 | pdf.js（渲染/文本层）+ pdf-lib（copyPages 页面操作/叠加导出/图片转 PDF） |
| 状态 | zustand（editor / convert / ui 三个 store） |
| 拖拽 | @dnd-kit（页面缩略图、图片列表排序） |
| 打包 | jszip（ZIP）、file-saver（Web 下载） |
| 测试 | Vitest（core 内核单测） |

设计约束：不使用 MUI / jsPDF；pdf.js worker 本地打包（禁止 CDN）；坐标统一为 PDF 点（1/72in，左下原点），屏幕换算收敛在 `src/core/geometry.ts`。

---

## 目录结构

```
pdf-editor/
├── electron/                 # 桌面壳（main / preload / shared-ipc）
├── src/
│   ├── core/                 # 平台无关处理内核
│   │   ├── pdf/              #   PdfDocument（pdf.js）、PdfExporter（pdf-lib）
│   │   ├── convert/          #   PdfToImage、ImageToPdf
│   │   ├── geometry.ts       #   坐标换算（屏幕 ↔ PDF 点）
│   │   ├── history.ts        #   CommandStack（撤销/重做）
│   │   ├── fileAccess.ts     #   FileAccess 平台抽象（Web / Electron）
│   │   ├── types.ts / utils.ts
│   ├── store/                # zustand：useEditorStore / useConvertStore / useUiStore
│   ├── hooks/                # usePdf / useDrawing
│   ├── components/           # common/ui.tsx（轻量组件）、editor/、converter/
│   ├── pages/                # Home / Editor / Convert / Help
│   └── assets/fonts/         # NotoSansSC-Regular.otf（OFL，构建期下载）
├── docs/                     # PRD / 架构 / 任务 / 图表 / 用户指南
├── tests/                    # Vitest 单测（core）
└── scripts/fetch-font.mjs    # 中文字体下载脚本
```

---

## 快速开始

环境要求：Node v22+（开发环境为 v22.22.2）。

```bash
npm install          # 安装依赖（postinstall 自动尝试下载中文字体）
npm run dev          # Web 端开发（http://localhost:5173）
npm run dev:electron # 桌面端开发（electron-vite，HMR）
```

### 构建

```bash
npm run build        # 类型检查（tsc）+ Web 构建（dist-web/）
npm run build:web    # 仅 Web 构建
npm run build:win    # 桌面端构建 + electron-builder 打包（release/，nsis + portable）
```

### 测试

```bash
npm test             # Vitest 单测（core 内核）
npm run test:watch
```

### 中文字体

中文导出需要嵌入 Noto Sans SC 子集（OFL 协议，约 8MB）：

```bash
npm run fetch:font   # 手动下载（自动多镜像重试）
```

- 已存在 `src/assets/fonts/NotoSansSC-Regular.otf` 时跳过；
- 网络不可用时自动降级为 Helvetica：拉丁文本正常导出，含中文文本导出时 UI 会明确提示字体缺失，不阻塞其他功能。

> 注：如默认源不可达，可设置镜像重试（脚本内置 jsDelivr / GitHub raw / gcore 三个源）。

### 依赖镜像

如 npm 官方源缓慢或被拦截，可使用国内镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

Electron 二进制镜像已在 `.npmrc` 中配置：`electron_mirror=https://npmmirror.com/mirrors/electron/`。

---

## 关键实现约定

- **导出保真（Q3）**：`copyPages` 复制原页内容流 → 未编辑文本保持可搜索/可选中；被替换文本区域用背景色矩形遮盖原文 + 嵌入字体绘制新文本（中文 Noto Sans SC / 拉丁 Helvetica 回退）；高亮用 opacity 矩形近似。
- **坐标系统**：全链路 PDF 点（1/72in，左下原点）；屏幕换算统一走 `src/core/geometry.ts`。
- **文件访问**：任何文件读写必须经 `FileAccess` 接口（Web: File API + FileSaver；桌面: IPC + dialog + fs），组件不直接触碰 `window.pdfApi`。
- **错误处理**：core 层抛 `PdfEditorError`（带错误码），UI 层统一 Toast + 重试入口。
- **取消语义**：转换任务每页循环检查 `cancelRequested`；pdf.js `renderTask.cancel()` 捕获转为 `cancelled`。
- **性能**：>50 页缩略图懒加载（IntersectionObserver）；画布仅渲染当前页 ±1；>100MB Web 端提示风险但允许尝试。

---

## 桌面端（Electron）说明

- `electron/` 仅 3 个文件：`main/index.ts`（窗口/菜单/对话框/fs/IPC）、`preload/index.ts`（contextBridge 暴露 `window.pdfApi`）、`shared/ipc.ts`（通道常量与类型）。
- 渲染层复用 Web 源码，通过 `FileAccess.isDesktop` 自动切换文件接入方式。
- 断网可用（AC-G3）：所有依赖本地打包、无运行时 CDN。

---

## 验收映射

- AC-E1~E8（编辑）、AC-C1~C6（转图）、AC-I1~I6（图片转 PDF）、AC-G1~G5（响应式/离线/错误/帮助）详见 `docs/PRD.md` 与 `docs/USER_GUIDE.md`。

---

## 开源

- **License**：[MIT](./LICENSE) © 2026 Rice Shower
- **隐私声明**：本项目所有 PDF 解析、渲染、编辑与转换均在本地完成，无任何服务器端处理、文件零上传。Web 端所有依赖与资源本地打包，无运行时 CDN。
- **贡献**：欢迎提交 Issue 与 Pull Request。开发请遵循 `docs/ARCHITECTURE.md` 中的分层与坐标约定，核心内核修改需附带 Vitest 单测。

---

## 致谢

- [pdf.js](https://github.com/mozilla/pdf.js) — PDF 解析与渲染
- [pdf-lib](https://github.com/Hopding/pdf-lib) — PDF 创建、页面操作与导出
- [Noto Sans SC](https://github.com/notofonts/noto-cjk) — 中文字体（OFL 协议）
