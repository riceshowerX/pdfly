# QA 测试报告 — 功能完整的 PDF 编辑器

| 项目信息 | 内容 |
| --- | --- |
| 测试执行人 | 严过关（QA 工程师） |
| 执行日期 | 2026-02（本轮回归） |
| 测试框架 | Vitest 2.1.9 + jsdom 25 |
| 被测版本 | src/ 全部实现（React + TypeScript + zustand + pdf-lib + pdfjs-dist） |

---

## 1. 结论摘要

- **测试结果**：40 通过 / 0 失败 / 4 个测试文件全部通过（初始 19 通过 / 7 失败）
- **构建结果**：`npm run build` 通过（tsc 无类型错误 + vite build 成功，1828 模块）
- **智能路由判定**：**NoOne**（Round 2 回归全绿，无待工程师修复项）
- **修复归属**：源码 Bug ×1（QA 直接修复）、测试代码 Bug ×3（QA 修正）、环境问题 ×4（QA 处理）

---

## 2. 测试矩阵

| 测试文件 | 用例数 | 结果 | 覆盖范围（对应 PRD AC） |
| --- | --- | --- | --- |
| tests/core/history.test.ts | 6 | ✅ 全过 | CommandStack push/undo/redo、redo 截断、步数上限（AC-E6）、clear |
| tests/core/editor.test.ts | 13 | ✅ 全过 | 几何换算、页范围解析、store 命令撤销/重做（AC-E6）、页面重排/插入/删除元素迁移（AC-E4） |
| tests/core/convert.test.ts | 10 | ✅ 全过 | PDF→图片参数/倍率、ZIP 打包（AC-C4）、图片→PDF 合并/页数/尺寸/取消（AC-I2/I4/I5）、canvasToBlob 格式（AC-C1） |
| tests/core/pdf-kernel.test.ts | 11 | ✅ 全过 | PdfExporter 页面操作/叠加导出/文本替换/字体缺失（AC-E2/E3/E4/E8）、createPdfFromImages（AC-I2/I6）、PdfDocument 加载（AC-E1） |
| **合计** | **40** | **40 通过 / 0 失败** | 通过率 **100%** |

补充测试 +4（见 §5）。

---

## 3. 失败原因分析与修复说明（初始 7 个失败）

### 3.1 源码 Bug（1 个）→ QA 直接修复

| 失败用例 | 期望 vs 实际 | 根因 | 修复 |
| --- | --- | --- | --- |
| editor.test.ts › add / remove / undo / redo ≥20 步语义 | 期望 `['a','b']`，实际 `['b','a']` | `useEditorStore.ts` 的 `remove-element` undo 分支把被删元素 **append 到数组末尾**，丢失原索引，导致撤销后元素顺序（z-order/绘制顺序）改变 | `removedElementsMap` 由 `WeakMap<Command, EditorElement>` 改为 `WeakMap<Command, { element, index }>`；do 时记录原索引，undo 时 `splice(原索引, 0, element)` 原位恢复 |

依据：PRD **AC-E6**（撤销/重做可正确回退/重放最近操作序列）；元素数组顺序即绘制层级，撤销删除必须恢复原位置。

### 3.2 测试代码 Bug（3 个）→ QA 修正测试

| 失败用例 | 原因 | 修改理由（引用依据） |
| --- | --- | --- |
| history.test.ts › 步数上限：超出 limit 后丢弃最旧命令 | 原断言「撤销 25 次后 `canUndo` 为 true / 剩余可撤销 19 步」与产品预期不符 | 按产品预期（team-lead 裁决 + PRD **AC-E6**）：`limit=20` 保留最近 20 条 → 可撤销 **20 次**；撤销耗尽后 `canUndo=false`；随后可重做 20 次。修正断言：可撤销 n=20、耗尽后 `canUndo=false`、可重做 m=20 |
| editor.test.ts › parsePageRange 混合用例 | `expect(parsePageRange('2-1', 5)).toThrow()` 未包函数，异常在 expect 之前抛出，测试直接崩 | `toThrow()` 断言必须接收函数；改为 `expect(() => parsePageRange('2-1', 5)).toThrow()`。实现本身正确抛 `PAGE_OUT_OF_RANGE` |
| convert.test.ts › convert：取消抛 CONVERT_CANCELLED | 在 `convert()` 之前调用 `requestCancel()`，但 convert 入口重置 `cancelRequested=false`，导致正常返回 Blob | `requestCancel` 语义是取消**进行中的转换**（PRD **AC-C5 / AC-I5**）；每次转换是全新会话。改为在 `onProgress` 回调（done===1）中触发取消，第二项检查时抛 `CONVERT_CANCELLED` |

### 3.3 环境问题（3 个）→ QA 处理

| 失败用例 | 原因 | 处理方式 |
| --- | --- | --- |
| convert.test.ts › packZip 仅打包成功项且命名有序 | jsdom 的 `Blob.prototype.arrayBuffer` 为 `undefined`（Node 原生 Blob 才有）；`zipBlob.arrayBuffer()` 报 `not a function` | `tests/setup.ts` 添加 polyfill：用 `FileReader.readAsArrayBuffer` 实现（已实测对普通 Blob 与 JSZip 生成的 Blob 均可用）。源码契约返回标准 Blob 属正确设计，不改源码 |
| convert.test.ts › 多图合并，页数正确，损坏图片隔离 | 同上（`blob.arrayBuffer()`） | 同上 |
| convert.test.ts › 支持自定义页面尺寸 | 同上（`blob.arrayBuffer()`） | 同上 |

---

## 4. 附加环境/配置问题（回归中发现）

| 问题 | 根因 | 处理方式 |
| --- | --- | --- |
| pdf-kernel.test.ts 套件转换失败：`Failed to resolve import "pdfjs-dist/build/pdf.worker.min.mjs?url"` | `vitest.config.ts` 中 `pdfjs-dist` 前缀 alias 与源码 `PdfDocument.ts` 的 worker `?url` 动态导入冲突，前缀匹配把路径重写为不存在的文件 | `vitest.config.ts` 的 `resolve.alias` 改为**数组 + 正则**：`/^pdfjs-dist\/build\/pdf\.worker\.min\.mjs(\?url)?$/` → `node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs`，置于 `pdfjs-dist` 别名之前。legacy 构建同样提供 worker 文件；测试环境 `ensureWorker` 不执行（无 Worker），运行时无影响。**仅改测试配置，产品构建配置（vite.config.ts）未动** |
| jsdom 无 canvas 2D 实现（未安装 canvas npm 包），触发 `Not implemented` 告警 | jsdom 的 `HTMLCanvasElement.getContext` 未实现 | `tests/setup.ts` 覆盖 `getContext` 静默返回 null（与 jsdom 原生行为一致，仅消除告警噪音）；`canvasToBlob` 等轻量路径回退到原 canvas |

---

## 5. 补充的关键路径测试（+4）

| 用例 | 覆盖 AC | 价值 |
| --- | --- | --- |
| canvasToBlob：PNG 输出 type 与魔数正确（`89 50 4E 47 0D 0A 1A 0A`） | **AC-C1** | 验证 PDF→图片链路输出确为 PNG 格式，可正常打开 |
| canvasToBlob：JPG 输出 type 正确 | **AC-C1** | 验证 JPG 格式输出 |
| canvasToBlob：toBlob 失败抛 EXPORT_FAILED | **AC-G4** | 验证编码失败的错误路径有明确错误码 |
| AC-E8：编辑（重排+叠加元素）后导出，PDF 可重新打开且页数/页序/尺寸正确 | **AC-E8** | 组合场景端到端验证「导出 PDF 可被阅读器打开、内容与预览一致」（重排 + 叠加元素同时生效） |

图片转 PDF 页数与图片数一致（AC-I2）已有覆盖：convert.test.ts 多图合并（2 有效图 → 2 页）+ pdf-kernel.test.ts createPdfFromImages（2 页，A4 尺寸），未重复添加。

---

## 6. 智能路由判定记录

| 轮次 | 动作 | 结果 | 路由 |
| --- | --- | --- | --- |
| Round 1 | 运行 `npm test`，收集 7 个失败 | 判定：源码 Bug ×1、测试 Bug ×3、环境 ×3 | 源码 Bug 直接修复；测试 Bug QA 修正；环境 QA 处理 |
| Round 1 回归 | 重跑测试 | 发现 pdf-kernel 套件转换失败（环境/配置问题）→ 修复 vitest.config.ts + setup.ts | QA 处理 |
| Round 2 | 重跑 `npm test` + `npm run build` | **40/40 通过，build 通过（tsc 无类型错误）** | **NoOne**（无待工程师修复项） |

---

## 7. 遗留问题 / 说明

1. **真实 canvas 渲染未在 jsdom 覆盖**：jsdom 无 canvas 绘制能力（未安装 canvas npm 包），PDF→图片的 `renderPage → canvas` 真实渲染端到端路径无法在单测执行；已通过 `computeRenderScale`（参数计算）+ `canvasToBlob`（编码输出）单测覆盖转换链路两端关键环节。建议在浏览器 / Electron e2e 阶段补充真实渲染冒烟。
2. **中文字体依赖构建期脚本**：Noto Sans SC 由 `npm run fetch:font` 下载并打包；测试环境无字体时 `FONT_MISSING` 行为已验证（预期设计，UI 层提示）。
3. **测试环境 worker 导入**：正则 alias 使 worker `?url` 导入在测试环境解析为模块而非 URL（`m.default` 为 undefined），但 `ensureWorker` 在无 Worker 环境不执行，运行时无影响；产品构建（vite build）已确认 worker 正确本地化打包（`dist-web/assets/pdf.worker.min-*.mjs`）。
4. **改动文件清单**：
   - 源码：`src/store/useEditorStore.ts`（remove-element undo 原位恢复）
   - 测试：`tests/core/history.test.ts`、`tests/core/editor.test.ts`、`tests/core/convert.test.ts`、`tests/core/pdf-kernel.test.ts`
   - 测试基础设施：`tests/setup.ts`（Blob polyfill + canvas getContext 静默）、`vitest.config.ts`（worker alias 正则）

---

## 8. 最终通过率

- **单元/集成测试**：40 / 40 = **100%**
- **构建**：`npm run build` 通过（tsc 两配置无类型错误 + vite build 成功）
- **P0 验收标准覆盖**：AC-E1/E2/E3/E4/E6/E8、AC-C1/C4、AC-I2/I4/I5/I6 均有对应测试；AC-G4 错误路径有覆盖

---

## 9. 31 项代码审查问题修复 — 回归验证（QA 独立复核）

> 复核人：严过关（QA 工程师）｜方式：信任但验证（独立读源码 + 实测内容流矩阵，非仅重跑测试）

### 9.1 执行结果

- `npm test`：**47 / 47 通过**（history 7、editor 15、convert 11、pdf-kernel 14）
- `npm run build`：通过（tsc 两配置无类型错误 + vite build，1828 模块）
- 既有测试抽查：4 个测试文件与上一轮对比，**仅新增 7 条用例**（C1/M3/C4/M7/H3/M8/旋转回归），**无任何原断言被修改** —— 与工程师声明「全部原断言直接通过」一致 ✅

### 9.2 逐项复核结论

| 复核项 | 结论 | 独立验证证据 |
| --- | --- | --- |
| H1 originalIndex | **PASS** | PageOverlay 新增 `originalIndex` prop：`renderPage/getTextLayer(originalIndex)`（原始页号）、元素过滤仍用 `pageIndex`（位置）；`isBlankPage = originalIndex < 0`；EditorCanvas 传 `key={p.index-i}`、`pageIndex={i}`、`originalIndex={p.index}`。重排/删除后底图与元素对齐关系正确 |
| H3 startPt/endPt | **PASS** | useDrawing 在 onPointerMove/Up 记录拖拽真实起终点；ElementView/DraftPreview 按 start→end 换算屏幕点并据实际方向算箭头头；PdfExporter `resolveLinePoints` + 箭头角度与屏幕一致；新增 H3 测试验证「PDF(0,0)→(100,50)」在屏幕/导出不镜像 |
| M8 旋转图片 | **部分 PASS（有遗留）** | 扭曲已修复（fit 用未旋转宽高，等比）。但**居中公式与 pdf-lib 旋转锚点不匹配**：实测内容流（pdf-lib 1.17.1）`translate(x,y) → rotate → scale(w,h)`，旋转锚点为盒子左下角；2:1 图旋转 90° 时视觉包围盒 x∈[x-h, x]，代码按 `x=(pageW-visualW)/2` 计算导致 **x∈[-88.75,168.75] 越出页面左缘**（270° 则向下越界）。新 M8 测试仅断言函数自身数学（宽高比），未验证实际渲染位置 |
| M3 删除页 z-order | **PASS** | `removedPageElementsMap` 记录 `{element, index}[]`；undo 先迁移保留元素再按原索引升序 splice 原位插回；新增 M3 测试验证精确数组顺序 `['p0a','p1','p0b','p2']` |
| C4 命令栈索引一致 | **PASS** | `push` 先 `onApply(do)` 成功再入栈；`undo` 先应用成功再 index-1；`redo` 抛错回滚 index；新增 C4 测试覆盖 undo/push 失败路径 |
| M7 canvas 面积上限 | **PASS** | `assertCanvasSizeWithinLimit`（单边 16384 / 面积 2.2 亿）在 convert 循环内逐页校验，超限按页标记 error（不中断其他页）；新增 M7 测试 |
| M1 IPC sender 校验 | **PASS** | `assertTrustedSender` 校验 `event.senderFrame.url`（file:// 或 dev origin），6 个 handler 全部接入；仍保留「渲染层可读写任意路径」的纵深防御局限（未做路径白名单），建议后续加强 |
| M2/M4/M5 卸载清理 | **PASS** | EditorPage 卸载 `dispose()+reset()`；转换页使用**独立 PdfDocument 实例**（非 usePdf 单例），不受 M2 reset 影响；M4：`cleanupTask` + 卸载 effect revoke 全部结果 URL 并 `removeTask`（含 retryFailed 前置清理）；M5：outputUrl 卸载/变更 revoke |
| 其他 20 项（H2/M6/M9/M10/M11/L1-L11 等） | **PASS** | 均已逐一确认根因修复：H2 key 唯一化、M6 输入钳制、M9 缩略图竞态校验（docId+position+index）、M10 pan 实现（滚动父容器平移）、M11 删除确认（读 settings）、L7 CommitNumberInput（blur/Enter 提交）、L8 即时取消（requestCancel→cancelRender）、L11 文本按宽换行等 |

### 9.3 新发现问题（本轮引入 / 遗留）

| # | 严重度 | 位置 | 问题 | 建议 |
| --- | --- | --- | --- | --- |
| R1 | **高** | src/core/pdf/PdfDocument.ts:131（renderPage 开头 `cancelRender()`） | **多页并发渲染回归**：编辑器同时挂载 currentPage±1 共 2–3 个 PageOverlay，各 effect 顺序调用 renderPage，后一个 `cancelRender()` 取消前一个 → **只有最后一个可见页渲染成功，其余页 canvas 空白** + console.warn 刷屏（core 层单测无法覆盖组件行为，47/47 通过但缺陷存在）。 | 改为维护渲染任务集合（Map<pageIndex, RenderTask>）按页取消，或仅在下一次「同页重渲染/卸载」时取消；不要在 renderPage 开头无差别取消。 |
| R2 | 中 | src/core/pdf/PdfExporter.ts:77-99（computeRotatedImagePlacement） | **旋转图片未居中（部分修复）**：90°/270° 非方形图不扭曲但越出页面边缘（pdf-lib 旋转锚点=左下角，居中需按锚点语义换算）。 | 按锚点语义修正 x/y（90°: x=pageW/2+h/2, y=pageH/2-w/2；270° 对称）；并补充「渲染实际位置」回归测试（用非 1×1 图 + 解析内容流/渲染断言居中）。 |

### 9.4 结论

- **31 项修复中 29 项为正确根因修复**，既有测试未被弱化。
- **2 项存在问题**：R1（高，L5 修复引入的多页渲染回归）需工程师修复后回归；R2（中，M8 居中残留）建议与 R1 同批处理。
- **测试通过率**：47/47 = 100%（build 通过）——但 R1/R2 属组件/渲染层行为，现有 core 单测无法覆盖，**不建议判定 IS_PASS: YES 直接放行**，建议先修 R1。

---

## 10. R1/R2 修复 — 最终回归（QA 独立复核）

> 复核人：严过关（QA 工程师）｜方式：独立读源码 + 实测 pdf-lib 内容流矩阵 + 新增组件级回归测试

### 10.1 执行结果

- `npm test`：**54 / 54 通过**（6 个测试文件；本轮 QA 新增 3 条：pdf-render +2、editor-render 组件级 +1）
- `npm run build`：通过（tsc 两配置无类型错误 + vite build，1828 模块）

### 10.2 R1（多页并发渲染）复核 — **PASS**

**实现**：`renderTasks` 由单槽改为 `Map<页索引, RenderTask>`（PdfDocument.ts:47）；`renderPage` 仅 `cancelPageRender(index)` 取消**同页**旧任务（142、153 行两次取消，覆盖 `await getPage` 窗口内新加入的同页任务，「同页最新胜出」）；`cancelRender()` 遍历取消全部页（dispose/转换取消用）；finally 仅当仍是该页当前任务时删除（164 行）。

**独立验证**：
- 不同页（0/1/2）并发 → 各自独立 Map 条目，互不取消，全部完成 ✅
- 同页重渲染（缩放）→ 仅取消该页旧任务，新任务胜出 ✅
- dispose/requestCancel → 全取消 ✅
- 遗留取舍：PageOverlay 卸载时未主动取消该页任务（渲染完成即回收，仅浪费少量后台渲染时间，非功能缺陷）。

**新增测试**：
- `tests/core/pdf-render.test.ts`：3 页并发（乱序完成互不取消）+ 完成后同页重渲染只新建一个任务（Map 残留清理）。
- `tests/editor-render.test.tsx`（**组件级**）：挂载 `EditorCanvas`（currentPage=1 → 可见页 0/1/2），mock pdfjs + ResizeObserver/IntersectionObserver，驱动完整链路「PageOverlay effect → usePdf → PdfDocument」，断言 3 个可见页 canvas 均写入渲染结果尺寸（`canvas.width === 200`）且任务互不取消。取舍：jsdom 无真实 canvas 绘制，「可见内容」以 canvas 尺寸写入作为代理断言；真实视觉冒烟建议浏览器/e2e 补充。

### 10.3 R2（旋转图片居中）复核 — **PASS**

**实现**：新增 `rotatedImageVisualBox`（PdfExporter.ts:81-117）按 pdf-lib 内容流语义（`translate→rotate→scale`，旋转锚点=绘制矩形左下角）推导四向视觉盒：0°=[x,x+w]×[y,y+h]、90°=[x-h,x]×[y,y+w]、180°=[x-w,x]×[y-h,y]、270°=[x,x+h]×[y-w,y]；`computeRotatedImagePlacement` 按「视觉盒中心=页面中心」反推 x/y（126-158 行，含 180° 顺带修正）。

**独立验证**（实测内容流，与上轮探针同法）：
- 2:1 图（200×100）旋转 90°、A4、margin 40 → `x=(595.28+257.5)/2=426.39, y=(841.89-515)/2=163.445` → 视觉盒 [168.89,426.39]×[163.445,678.445]，中心=(297.64, 420.945)=页面中心，**完整落在页内不越界** ✅（上轮旧实现视觉盒 x∈[-88.75,168.75] 越出左缘）。
- 90°/270° 已通过**内容流解析测试**（zlib inflate + 提取 cm 矩阵 + 逆序矩阵作用于单位方块，断言视觉盒页内且居中）——非仅测函数自洽，验证的是 pdf-lib 实际渲染位置。

### 10.4 结论

- R1、R2 均为**正确根因修复**，且新增测试能捕获上一轮缺陷（旧实现下 pdf-render 并发用例与内容流解析用例会失败）。
- 最终测试通过率：**54/54 = 100%**；build 通过。
- **遗留（低优先，非阻断）**：Electron IPC 路径白名单（渲染层仍可读写任意路径，sender 校验已到位）；编辑器卸载页未主动取消后台渲染（资源极少量浪费）；真实 canvas 视觉冒烟待浏览器/e2e。
- **判定：IS_PASS: YES（R1/R2 修复验收通过）**。
