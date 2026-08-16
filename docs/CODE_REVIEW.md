# 代码审查报告 — 功能完整的 PDF 编辑器

| 项目信息 | 内容 |
| --- | --- |
| 审查人 | 严过关（QA 工程师） |
| 审查日期 | 2026-02（本轮全面代码审查） |
| 审查方式 | 只读静态审查（未修改源码） |
| 审查范围 | src/ 全部 32 个文件 + electron/ 壳 + scripts/ + 构建配置 |
| 基线验证 | `npm test` 40/40 通过；`npm run build`（tsc strict + vite）通过 |

---

## 1. 综述

### 1.1 审查范围

| 模块 | 文件 |
| --- | --- |
| core 内核 | types.ts、utils.ts、geometry.ts、history.ts、fileAccess.ts、pdf/PdfDocument.ts、pdf/PdfExporter.ts、convert/PdfToImage.ts、convert/ImageToPdf.ts |
| zustand 状态 | store/useEditorStore.ts、store/useConvertStore.ts、store/useUiStore.ts |
| hooks | hooks/usePdf.ts、hooks/useDrawing.ts |
| 组件 | editor/EditorCanvas.tsx、editor/PageOverlay.tsx、editor/EditorToolbar.tsx、converter/PdfToImagePanel.tsx、converter/ImageToPdfPanel.tsx、common/ui.tsx |
| 页面 | pages/HomePage.tsx、pages/EditorPage.tsx、pages/ConvertPages.tsx、pages/HelpPage.tsx（另含 App.tsx、main.tsx） |
| 桌面壳 | electron/main/index.ts、electron/preload/index.ts、electron/shared/ipc.ts |
| 脚本/配置 | scripts/fetch-font.mjs、vite.config.ts、electron.vite.config.ts、vitest.config.ts |

### 1.2 问题统计

- **问题总数：25**
- 按严重程度：**高 3 / 中 11 / 低 11**
- 按维度分布：
  - 逻辑错误 5（含坐标系统一致性 2）
  - 潜在 Bug / 资源泄漏 8
  - 错误处理 4
  - 边界条件 3
  - 数据一致性 3
  - 性能隐患 2
  - 代码质量 / 死代码 5（含安全 1，归入潜在 Bug）

### 1.3 关键结论

1. 项目整体工程质量良好：坐标换算收敛在 geometry.ts、命令栈设计清晰、平台抽象（FileAccess/IPC）干净、测试覆盖了核心内核与撤销/重做语义。
2. **发现 3 个高严重度问题**，其中 2 个直接破坏核心功能正确性（页面重排/删除后画布底图错页；线条/箭头导出方向与屏幕预览相反），1 个为 React key 冲突（多空白页）。
3. 已确认此前修复的 PageOverlay.tsx selector 无限循环问题**修复正确**（稳定引用 selector + useMemo），无复发。

---

## 2. 问题清单

### 2.1 高严重度（3）

| # | 文件:行号 | 维度 | 问题描述 | 修改建议 |
| --- | --- | --- | --- | --- |
| H1 | components/editor/PageOverlay.tsx:266,286（配合 EditorCanvas.tsx:169 传入 `pageIndex={i}`） | 逻辑错误 | **页面重排/删除后画布底图与文本层渲染错页**。`pages.map((p,i) => <PageOverlay pageIndex={i}/>)` 传入的是**当前位置** i，而 `renderPage(pageIndex)`/`getTextLayer(pageIndex)` 内部按 `pdf.getPage(index+1)` 解释为**原始页号**。重排或删除后 `pages[i].index !== i`，底图/文本命中全部错位（元素覆盖层按位置正确，会画在错误的底图上）。 | PageOverlay 增加 `originalIndex` prop（取 `p.index`）用于 renderPage/getTextLayer；位置 `i` 仅用于元素归属。 |
| H2 | components/editor/EditorCanvas.tsx:169 | 逻辑错误 | **空白页 React key 冲突**。`key={p.index}` 对插入的空白页（index 均为 -1）重复，插入 2 张以上空白页时 React 复用同一组件实例，导致渲染/状态错乱（草稿、气泡状态串页）。 | key 改为 `${p.index}-${i}`（与 Thumb 的 key 一致）。 |
| H3 | components/editor/PageOverlay.tsx:122-137（ElementView） + core/pdf/PdfExporter.ts:251-284 | 逻辑错误/坐标一致性 | **线条/箭头屏幕渲染与导出垂直镜像**。ElementView 中 SVG 起点为屏幕矩形左上角（对应 PDF 高 y 端），终点为右下（对应 PDF 低 y 端）；而导出器以 `(el.x, el.y)→(el.x+w, el.y+h)`（PDF 左下→右上）绘制。用户从左上拖到右下画的箭头，导出的 PDF 中指向右上——方向相反（箭头头部位置也不一致）。 | 元素需保存方向信息（如带符号的 width/height 或 start/end 点），ElementView 与导出器使用同一 start/end 语义；建议在渲染层与导出层共用同一换算函数。 |

### 2.2 中严重度（11）

| # | 文件:行号 | 维度 | 问题描述 | 修改建议 |
| --- | --- | --- | --- | --- |
| M1 | electron/main/index.ts:157-186 | 潜在 Bug（安全） | **IPC 任意路径读写且无 sender 校验**。`readFile/writeFile` 直接接受渲染层传入的任意路径；所有 handle 未校验 `event.senderFrame.url` 是否为本应用 origin。渲染层一旦被注入脚本（XSS）即可任意读/覆盖用户文件。 | 校验 `event.senderFrame.url` 与本地 file:// 或 dev URL 一致；对 `writeFile` 限制为「对话框所选路径」或仅允许保存目录内路径。 |
| M2 | pages/EditorPage.tsx:89-91 + hooks/usePdf.ts:62-65 | 数据一致性 | **离开编辑器页面后 store doc 残留**。卸载时 `dispose()` 销毁了 PdfDocument 单例（activeDoc=null）但未清理 `useEditorStore.doc`；从「首页/转换页」返回 /editor 时，store 仍有旧 doc，PageOverlay 的 renderPage 抛 LOAD_FAILED 被吞，画布白屏且无法重新加载。 | dispose 时同时 `useEditorStore.getState().reset()`；或在 EditorPage 挂载时检测 activeDoc 为空则 reset。 |
| M3 | store/useEditorStore.ts:169 | 数据一致性 | **page-delete 撤销恢复丢失 z-order**。undo 时 `[...shiftAfterInsert(elements), ...restored]` 把被删页元素追加到数组末尾，元素绘制层级（数组顺序即层级）与删除前不一致。 | 撤销删除页时应按被删元素的原 pageIndex 分组并原位插回（参考 remove-element 已实现的 index 记录方案）。 |
| M4 | components/converter/PdfToImagePanel.tsx:86-120,127-142 + store/useConvertStore.ts:74-79 | 潜在 Bug（资源泄漏） | **转换结果 Blob URL 不释放**。每页 `URL.createObjectURL(blob)` 存入 task.results，组件卸载/任务切换从不 revoke，`removeTask` 无人调用——批量转换（如 300 页）会永久占用内存。 | 组件卸载 useEffect 中统一 revoke 当前任务所有结果 url；removeTask 时回收。 |
| M5 | components/converter/ImageToPdfPanel.tsx:160-163 | 潜在 Bug（资源泄漏） | **outputUrl 卸载未 revoke**。`URL.createObjectURL(blob)` 仅在生成新结果时 revoke 旧值，组件卸载时泄漏。 | 增加卸载清理 useEffect revoke outputUrl。 |
| M6 | components/converter/PdfToImagePanel.tsx:229-234、ImageToPdfPanel.tsx:259-269 | 边界条件 | **数值输入未钳制负值**。`Number(e.target.value) || 默认值` 对负数直接透传：负 DPI → 负渲染倍率；负 margin/负自定义页面尺寸/负 scale → pdf-lib 生成非法页面或 drawImage 负尺寸异常。 | 对 min 字段做 `Math.max(min, value)` 钳制（含 0/负值）。 |
| M7 | core/convert/PdfToImage.ts:12-26 + core/pdf/PdfDocument.ts:112-138 | 边界条件/性能 | **canvas 面积无上限**。600 DPI × 倍率 4 渲染 A4 可达 ~19842×28064px（约 5.5 亿像素），超过浏览器 canvas 面积限制（约 2.68 亿）导致渲染失败/内存崩溃，无任何提示。 | 在 computeRenderScale 增加面积上限校验（如 ≤ 4096×4096 或面积 ≤ 2 亿），超出抛可诊断错误并提示用户降低 DPI/倍率。 |
| M8 | core/pdf/PdfExporter.ts:331-346 | 逻辑错误 | **旋转图片宽高交换 + drawImage rotate 双重处理致非方形图扭曲**。fit 按旋转后尺寸（iw=height, ih=width）计算盒子，再对原图 drawImage(rotate:90°)——pdf-lib 先非等比拉伸填满盒子再绕中心旋转，2:1 等非方形图旋转 90°/270° 时内容被拉伸变形（现有测试仅用 1×1 方形图，未覆盖）。 | 用未旋转宽高计算 fit 后再 rotate；或手动构造旋转后的变换矩阵绘制，确保等比。需补充非方形图旋转回归测试。 |
| M9 | components/editor/EditorCanvas.tsx:37-51 | 潜在 Bug（竞态） | **缩略图懒加载竞态**。IntersectionObserver 触发的 `renderThumbnail(page.index)` 无取消/陈旧校验，页面删除或重排后回调 `setThumbnail(position, url)` 可能把缩略图写到错误位置。 | 记录请求时的 doc.id+position，回调时校验当前 store 对应页 index 未变再写入。 |
| M10 | components/editor/EditorToolbar.tsx:50 + hooks/useDrawing.ts:24 | 代码质量/死功能 | **pan（抓手）工具无实现**。工具列表包含「抓手」，但 useDrawing/PageOverlay/EditorCanvas 均未处理 pan，点击后无任何效果（与 select 行为一致），误导用户。 | 实现 pan（拖拽平移画布）或从工具栏移除。 |
| M11 | store/useEditorStore.ts:313-325 + store/useUiStore.ts:21 | 数据一致性 | **confirmBeforeDelete 设置未生效**。设置项默认 true，但删除页按钮直接 `deletePage()` 无确认对话框，与设置语义矛盾。 | 在 deletePage 前检查 settings.confirmBeforeDelete 并弹出确认；或移除该设置项。 |

### 2.3 低严重度（11）

| # | 文件:行号 | 维度 | 问题描述 | 修改建议 |
| --- | --- | --- | --- | --- |
| L1 | core/pdf/PdfExporter.ts:55-61 | 代码质量 | `withEditedSuffix` 两个分支完全相同（死分支），`lower` 变量冗余。 | 合并为单行返回。 |
| L2 | core/fileAccess.ts:127-129、store/useConvertStore.ts:74-79、hooks/usePdf.ts:56-60 | 代码质量 | 未使用导出/方法：`saveToPath`（仅接口实现，无调用）、`removeTask`（无调用）、`usePdf.pageSize`（无调用）。 | 删除或补全调用方。 |
| L3 | core/fileAccess.ts:24-37 | 潜在 Bug | Web 端文件选择器取消时 `onchange` 不触发，`pickFiles` 的 Promise 永不 resolve，`openPdf` 悬挂（用户点取消后无响应也无提示）。 | File API 无取消事件，可加「取消文件选择」兜底（如 focus 检测 + 超时提示）。 |
| L4 | core/convert/ImageToPdf.ts:13-34 | 潜在 Bug（资源泄漏） | `decodeImageFile` 中若 `ctx.drawImage`/`toDataURL` 抛错，`bitmap.close()` 被跳过（ImageBitmap 泄漏）。 | try/finally 保证 close。 |
| L5 | core/pdf/PdfDocument.ts:126-127 | 性能隐患 | `renderTask` 单槽：快速缩放/翻页时旧渲染任务无法取消（仅记录最后一个），并发渲染浪费资源、内存峰值高。 | 渲染前 cancel 旧任务或维护任务集合。 |
| L6 | core/pdf/PdfDocument.ts:178-185 | 错误处理 | `renderThumbnail` catch 后静默吞错，缩略图永久空白且无可诊断信息。 | console.warn + 返回占位标记。 |
| L7 | components/editor/EditorToolbar.tsx:243-303（PropsPanel） | 数据一致性/性能 | 属性面板每次输入（字号/颜色/透明度）都 `stack.push` 一条命令，撤销粒度细碎（输入"24"产生 2 条历史）。 | 输入类属性改为 blur/commit 时单条命令。 |
| L8 | core/convert/PdfToImage.ts:75-108 | 潜在 Bug | 取消为「页间协作取消」：`requestCancel()` 仅置标志，正在渲染的当前页不中断（renderTask.cancel 只在 dispose 调用），大页面取消响应慢。 | requestCancel 时同时调用 doc 内部 renderTask.cancel()（需暴露 cancel 接口）。 |
| L9 | components/converter/PdfToImagePanel.tsx:127-132、ImageToPdfPanel.tsx:180-187 | 错误处理 | `downloadOne`/`download` 无 try/catch，`saveFile`/`arrayBuffer` 失败产生未处理 Promise 拒绝。 | 包裹 try/catch + toastError。 |
| L10 | components/common/ui.tsx:167-203 | 代码质量 | Modal 无焦点陷阱、无 body 滚动锁定、无 aria 焦点管理（键盘可达性不足）。 | 增加焦点循环与滚动锁定。 |
| L11 | core/pdf/PdfExporter.ts:178-191 | 边界条件 | text 元素导出无 maxWidth/换行，长文本溢出元素矩形（note 有 maxWidth 但 pdf-lib 是截断不换行）。 | 按可用宽度做手动换行或提示用户。 |

---

## 3. 高风险模块专题分析

### 3.1 PdfExporter.ts（copyPages + 叠加绘制 + 字体嵌入）
- copyPages 按 `state.pages[].index` 引用原始页，页面操作（插入/删除/重排）逻辑正确，测试已覆盖。
- **线条/箭头坐标镜像（H3）**：导出以 PDF 左下→右上语义绘制，与屏幕渲染相反，属坐标一致性缺陷，需统一。
- 中文字体嵌入有明确降级路径：字体缺失时 Latin 走 Helvetica/Times，CJK 抛 FONT_MISSING 由 UI 提示——设计合理；但 `embedFont='noto-sans-sc'` 时**拉丁文本也全部使用 Noto 字体**，忽略 fontFamily='serif' 选择（低优先级，产品可接受）。
- 遮盖矩形与文本绘制顺序正确（先 drawRectangle 再 drawText）。

### 3.2 ImageToPdf.ts / PdfExporter.createPdfFromImages
- 图片解码失败隔离良好（单图 error 不影响其他）。
- GIF 取第一帧为**明确设计**（HelpPage FAQ 已声明），非缺陷。
- **旋转图片扭曲（M8）**：宽高交换 + rotate 双重处理，非方形图 90°/270° 失真，需验证修复。
- 超大图片无尺寸上限，解码/编码大 canvas 有内存风险（与 M7 同源）。

### 3.3 PdfToImage.ts
- 取消语义为页间协作取消，未中断当前渲染页（L8），可接受但对慢页响应不佳。
- **canvas 面积无上限（M7）**是主要风险：高 DPI×倍率组合可触发浏览器 canvas 上限，无诊断提示。
- 结果 blob URL 生命周期由 UI 层负责，但 UI 未释放（M4）。

### 3.4 useEditorStore.ts（撤销/重做栈与元素快照）
- CommandStack 设计清晰，命令 do/undo 通过注入的 applyCommandToState 落到状态，测试覆盖了 ≥20 步、redo 截断、页面迁移。
- **page-delete 撤销 z-order 丢失（M3）**：被删页元素追加到数组末尾而非原位插回。
- replace-text 用 WeakMap 记录创建元素 id，redo/undo 幂等，正确。

### 3.5 useDrawing.ts
- 指针捕获、笔画采集、rasterize 均正确；签名分辨率依赖缩放（zoom 低时模糊，可接受）。
- 触摸场景依赖容器 `touchAction: 'none'`（PageOverlay 已按绘制工具设置），实现正确。
- 与 useDrawing 无关的 **pan 工具无实现（M10）**。

### 3.6 PageOverlay.tsx
- 已修复的 selector 无限循环问题**修复正确**（稳定引用 + useMemo），无复发。
- **底图/文本层使用位置索引而非原始索引（H1）**是本文件最严重问题。
- 拖拽移动只在 pointerup 提交一条 update-element 命令，撤销粒度好；`dragRef` 与 elements 同步有兜底（元素不存在时 no-op）。

### 3.7 EditorToolbar.tsx
- 签名绘制/图片导入路径均有错误处理；导出 busy 防重入。
- 导出固定 `embedFont:'noto-sans-sc'`，字体缺失时走 FONT_MISSING toast，错误信息可诊断。
- 属性面板每次输入 push 命令（L7）、删除页无确认（M11）。

### 3.8 electron/main（IPC 安全）
- contextIsolation + nodeIntegration:false 基础安全到位；但 **IPC 任意路径读写 + 无 sender 校验（M1）**是本项目最值得加固的点（纵深防御）。

### 3.9 fileAccess.ts
- Web/桌面双分支清晰，blob URL 生命周期由调用方负责——但调用方（转换面板）未释放（M4/M5）。

### 3.10 utils.ts / geometry.ts
- 除零防护总体到位：`fitContain/fitCover` 对 srcW/srcH≤0 返回 0；`zoomFitScale` 对非有限值返回 1；`clampZoom` 限制 0.25–4。
- 未发现 scale=0 除零路径（screenToPtX 由调用方保证 scale>0）；`rgbFromHex` 对非法颜色有兜底。

---

## 4. 处理优先级建议

### 高优先（先修，直接影响功能正确性/安全）
1. **H1** — 页面重排/删除后画布底图错页（核心功能，任一编辑操作后即触发）
2. **H3** — 线条/箭头导出方向与预览相反（数据正确性）
3. **H2** — 空白页 key 冲突（插入 2+ 空白页即触发）
4. **M1** — Electron IPC 任意路径读写（安全加固）

### 中优先（影响体验/资源/一致性）
5. **M7** canvas 面积上限校验 → **M8** 旋转图片扭曲 → **M3** 撤销删除页 z-order → **M2** 编辑器残留 doc → **M4/M5** blob URL 释放 → **M9** 缩略图竞态 → **M6** 输入钳制 → **M11** 删除确认 → **M10** pan 工具

### 低优先（清理/健壮性，可随迭代处理）
L1–L11（死代码清理、错误处理补齐、Modal 可访问性、长文本换行等）

---

## 5. 代码质量亮点

1. **坐标系统收敛良好**：全链路仅用 PDF 点（左下原点），屏幕换算统一经 `geometry.ts`，组件内无手写换算；测试覆盖了双向换算与任意拖拽方向归一化。
2. **命令栈设计清晰**：CommandStack 纯类、onApply 注入、redo 截断/步数上限有单测保障；页面迁移纯函数（shiftAfterInsert/Delete、remapAfterReorder）独立可测。
3. **平台抽象干净**：FileAccess / PdfApi 双实现（Web + Electron），渲染层不直接触碰 FileReader/Node，便于测试与维护；fetch-font 多镜像重试 + 静默降级不阻塞安装。
4. **错误路径设计用心**：业务错误统一 `PdfEditorError` + ErrorCode，UI 捕获后 toast + 明确重试入口（FONT_MISSING、CONVERT_CANCELLED 等均有可诊断信息）；转换面板损坏图片隔离、失败可单独重试。

---

## 6. 修复记录

本轮为**只读审查**，未修改任何源码（符合任务约束「除非发现可明确修复且风险极低的缺陷，否则只输出报告」）。

以下问题可视为低风险一行修复，后续可直接落地（均已在上文给出建议）：
- H2（EditorCanvas.tsx:169 key 改为 `${p.index}-${i}`）
- L1（PdfExporter.ts withEditedSuffix 合并分支）
- L4（ImageToPdf.ts 用 try/finally 保证 bitmap.close()）
- L9（下载路径包 try/catch）

其中 H2 与 H1 同文件同区域，建议与 H1（新增 originalIndex prop）一并修改，避免两次触碰渲染组件。

---

*审查结论：整体架构与工程质量优秀，测试覆盖核心内核；3 个高严重度问题均集中在「页面操作后坐标/身份不一致」与「导出方向」两处，修复路径明确，建议按优先级 4 步推进。*

---

## 7. 主理人交叉复核补充（team-lead 独立审查确认）

以下问题在 QA 逐行审查之外，由主理人独立复核代码时确认，建议并入处理队列（问题总数由 25 增至 **31**）：

| # | 文件:行号 | 严重度 | 问题描述 | 修改建议 |
| --- | --- | --- | --- | --- |
| C1 | core/utils.ts:155 | 中 | **parsePageRange 超大范围空转**。`1-99999999`（且文档仅 10 页）时循环执行约 1 亿次空转（`p <= total` 检查在循环体内，超页后不 break），页面卡死数秒至数分钟。页范围是自由文本输入，可被误输入/恶意输入触发。 | `end = Math.min(end, total)`；循环内 `if (p > total) break;` |
| C2 | core/pdf/PdfDocument.ts:32-39 | 低 | **pdf.js worker 加载失败不重试**。`workerReady` 在发起 import 前即置 true，失败后永不重试，长期降级为主线程渲染（性能受损，无告警）。 | catch 中重置 `workerReady = false` 并 console.warn。 |
| C3 | components/editor/PageOverlay.tsx:283 | 低 | **getTextLayer promise 无 catch**。文档卸载/销毁后（activeDoc 置空）`getTextLayer` reject，产生 unhandledrejection，无提示。 | `.then(...).catch(() => {})` 或 `.catch(console.warn)`。 |
| C4 | core/history.ts:59-72 | 低 | **CommandStack onApply 抛错时索引与状态不一致**。undo/redo 先移动 index 再调用 onApply，若 onApply 抛异常（如元素已被外部清空），index 已移动但状态未回退，后续撤销错乱。 | onApply 包裹 try/finally 或先应用成功再移动 index。 |
| C5 | core/pdf/PdfExporter.ts:32-43 | 低 | **导出重复 fetch 中文字体**。每次 buildEditedPdf 都 fetch 8MB 字体文件，多次导出重复网络/IO。 | 模块级缓存字体字节（首次成功后复用）。 |
| C6 | hooks/useDrawing.ts:183-185 | 低 | **onPointerLeave 为空实现**（死代码），注释与行为不符。 | 删除或实现绘制中指针离开的 draft 保留逻辑。 |
