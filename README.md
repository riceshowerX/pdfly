# Pdfly

> 本地优先的 PDF 编辑器 —— 编辑、转换、一站式完成。文件全程在本机处理，零上传、零留存。

**Pdfly** 是一个 Web + 桌面（Electron）双端的完整 PDF 工具，覆盖三大核心场景：在线编辑、PDF 转图片、图片转 PDF。所有解析、渲染与转换均通过本地库完成，不依赖任何服务器，可完全离线使用。

---

## 特性

### 1. PDF 在线编辑
- 文本编辑（替换原文，导出保留可搜索文本）
- 批注与多色高亮
- 插入图片、形状、手写签名
- 页面插入 / 删除 / 拖拽重排
- 撤销 / 重做（≥20 步）与实时预览

### 2. PDF 转图片
- 单页 / 全部页面转 PNG、JPG
- 自定义 DPI（72–600）、分辨率与目标尺寸
- 页范围选择，进度显示与随时取消
- 单张下载或 ZIP 批量打包

### 3. 图片转 PDF
- 支持 PNG / JPG / GIF / BMP 多格式
- 多图合并，拖拽排序、旋转、删除
- 自定义页面尺寸、页边距与缩放比例
- 损坏图片自动隔离，不影响其他图片

### 隐私与安全
- 全部处理在本地完成，文件零上传、零留存
- 依赖与资源本地打包，无运行时 CDN
- 桌面端可完全断网使用

---

## 快速开始

环境要求：Node v22+

```bash
npm install          # 安装依赖（postinstall 自动下载中文字体）
npm run dev          # Web 端开发（http://localhost:5173）
npm run dev:electron # 桌面端开发（electron-vite，HMR）
```

### 构建与测试

```bash
npm run build        # 类型检查（tsc strict）+ Web 生产构建（dist-web/）
npm run build:win    # 桌面端打包（nsis + portable，输出 release/）
npm test             # Vitest 单元测试（54/54）
```

### 中文字体

中文导出需嵌入 Noto Sans SC（OFL 协议，约 8MB）：

```bash
npm run fetch:font   # 手动下载（内置 jsDelivr / gcore / GitHub 多镜像重试）
```

已存在 `src/assets/fonts/NotoSansSC-Regular.otf` 时自动跳过；网络不可用时自动降级 Helvetica，并在 UI 中明确提示中文导出受限。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vite 5 + React 18 + TypeScript（strict）+ Tailwind CSS |
| 桌面壳 | Electron 33 + electron-vite（`electron/` 仅 3 个文件，Web 源码零改动复用） |
| PDF 内核 | pdf.js（解析/渲染/文本层）+ pdf-lib（页面操作/叠加导出/图片转 PDF） |
| 状态 | zustand（editor / convert / ui 三个 store） |
| 交互 | @dnd-kit（页面与图片拖拽排序）、react-dropzone |
| 测试 | Vitest（core 内核单测 + 组件级渲染测试） |

设计约束：不使用 MUI / jsPDF；pdf.js worker 本地打包（禁止 CDN）；坐标统一为 PDF 点（1/72in，左下原点），屏幕换算收敛于 `src/core/geometry.ts`。

---

## 目录结构

```
pdfly/
├── electron/                 # 桌面壳（main / preload / shared-ipc）
├── src/
│   ├── core/                 # 平台无关处理内核
│   │   ├── pdf/              #   PdfDocument（pdf.js）、PdfExporter（pdf-lib）
│   │   ├── convert/          #   PdfToImage、ImageToPdf
│   │   ├── geometry.ts       #   坐标换算（屏幕 ↔ PDF 点）
│   │   ├── history.ts        #   CommandStack（撤销/重做）
│   │   ├── fileAccess.ts     #   FileAccess 平台抽象（Web / Electron）
│   │   └── types.ts / utils.ts
│   ├── store/                # zustand：editor / convert / ui
│   ├── hooks/                # usePdf / useDrawing
│   ├── components/           # common/ui.tsx（轻量组件）、editor/、converter/
│   ├── pages/                # Home / Editor / Convert / Help
│   └── assets/fonts/         # NotoSansSC-Regular.otf（OFL，构建期下载）
├── docs/                     # PRD / 架构 / 任务 / 审查 / 测试 / 用户指南
├── tests/                    # Vitest 单测（core + 组件）
└── scripts/fetch-font.mjs    # 中文字体下载脚本
```

---

## 关键实现约定

- **导出保真**：`copyPages` 复制原页内容流 → 未编辑文本保持可搜索/可选中；文本替换区域用背景色遮盖原文 + 嵌入字体绘制新文本（中文 Noto Sans SC / 拉丁 Helvetica 回退）；高亮用 opacity 矩形近似。
- **坐标系统**：全链路 PDF 点（1/72in，左下原点），屏幕换算统一走 `src/core/geometry.ts`。
- **文件访问**：任何文件读写必须经 `FileAccess` 接口（Web: File API + FileSaver；桌面: IPC + dialog + fs），组件不直接触碰 `window.pdfApi`。
- **错误处理**：core 层抛 `PdfEditorError`（带错误码），UI 层统一 Toast + 重试入口。
- **渲染性能**：画布仅渲染当前页 ±1；缩略图 IntersectionObserver 懒加载；渲染任务按页隔离取消（多页并发互不干扰）。

---

## 桌面端（Electron）

- `electron/` 仅 3 个文件：`main/index.ts`（窗口/菜单/对话框/fs/IPC）、`preload/index.ts`（contextBridge 暴露 `window.pdfApi`）、`shared/ipc.ts`（通道常量与类型）。
- 渲染层复用 Web 源码，通过 `FileAccess.isDesktop` 自动切换文件接入方式。
- IPC 已做 sender 校验（`assertTrustedSender`），仅接受本应用 origin 的调用。

---

## 文档

- `docs/USER_GUIDE.md` — 用户使用说明与帮助文档
- `docs/PRD.md` — 产品需求与验收标准（AC 清单）
- `docs/ARCHITECTURE.md` — 架构设计与任务分解
- `docs/CODE_REVIEW.md` / `docs/QA_REPORT.md` — 代码审查与测试报告

---

## 开源

- **License**：[MIT](./LICENSE) © 2026 Rice Shower
- **隐私声明**：所有处理均在本地完成，文件零上传；Web 端依赖与资源本地打包，无运行时 CDN。
- **贡献**：欢迎提交 Issue 与 Pull Request。开发请遵循 `docs/ARCHITECTURE.md` 的分层与坐标约定；核心内核修改需附带 Vitest 单测。

---

## 致谢

- [pdf.js](https://github.com/mozilla/pdf.js) — PDF 解析与渲染
- [pdf-lib](https://github.com/Hopding/pdf-lib) — PDF 创建、页面操作与导出
- [Noto Sans SC](https://github.com/notofonts/noto-cjk) — 中文字体（OFL 协议）
