/**
 * HelpPage：内置帮助中心（三步上手引导 + 三大功能说明 + 常见问题）。
 */
import { FileText, FileImage, Images } from 'lucide-react';

const SECTIONS = [
  {
    icon: FileText,
    title: '一、编辑 PDF',
    steps: [
      '进入「编辑 PDF」，拖拽或选择本地 PDF 文件。',
      '从工具栏选择工具：文本编辑（点击原文可替换）、高亮、批注、矩形/椭圆/箭头/线条、图片、手写签名。',
      '左侧缩略图可点击跳页、拖拽重排；顶部可插入空白页、删除当前页。',
      '随时用「撤销 / 重做」回退；点击「导出」保存编辑后的 PDF（未编辑文本保持可搜索）。',
    ],
    tips: [
      '文本编辑：选择「文本」工具后点击原文，弹出输入框输入新内容并点击「替换」；导出时原文区域会被遮盖并绘制新文本。',
      '选中元素后可在顶部属性面板调整颜色、字号、线宽、透明度。',
      '高亮支持自定义颜色与透明度。',
    ],
  },
  {
    icon: FileImage,
    title: '二、PDF 转图片',
    steps: [
      '进入「PDF 转图片」，加载 PDF 文件。',
      '选择输出格式（PNG/JPG）、DPI 预设、额外倍率或目标像素尺寸，可自定义页范围（如 1-5,7）。',
      '点击「开始转换」，进度条实时显示；可随时「取消」。',
      '转换完成后网格预览，可单张下载或「打包 ZIP」下载全部。',
    ],
    tips: ['JPG 为白底有损格式；PNG 支持透明背景。', 'DPI 越高输出越清晰，文件越大；高清 300 适合印刷。'],
  },
  {
    icon: Images,
    title: '三、图片转 PDF',
    steps: [
      '进入「图片转 PDF」，拖拽或选择多张图片（PNG/JPG/GIF/BMP）。',
      '列表可拖拽排序、旋转、删除；损坏文件会标错且不影响其他图片。',
      '设置页面尺寸（A4/Letter/自定义）、页边距、图片适配方式与缩放比例。',
      '点击「生成 PDF」，完成后可预览或下载。',
    ],
    tips: ['「包含」模式完整显示图片并居中留白；「铺满」模式裁切溢出；「拉伸」模式填满页面。'],
  },
];

const FAQS = [
  { q: '文件会上传到服务器吗？', a: '不会。所有处理均在本机完成，无任何网络请求。' },
  { q: '编辑后的 PDF 原文还能选中/搜索吗？', a: '可以。导出采用复制原页内容流的方式，未编辑的文本保持矢量可搜索；被替换的文本区域会以背景色遮盖并绘制新文本。' },
  { q: '导出中文提示「需要字体资源」怎么办？', a: '中文导出需要捆绑 Noto Sans SC 字体。请联网后在项目目录运行 npm run fetch:font 后重启应用；或使用英文/数字文本（拉丁字符无需字体资源）。' },
  { q: '支持哪些图片格式转 PDF？', a: 'PNG / JPG / GIF / BMP / WebP。GIF 取第一帧。' },
];

export function HelpPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:py-10">
      <h1 className="mb-1 text-2xl font-bold text-ink-900">帮助中心</h1>
      <p className="mb-8 text-sm text-ink-500">三步上手，快速完成编辑与转换。</p>

      <div className="space-y-6">
        {SECTIONS.map((s) => (
          <section key={s.title} className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink-800">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                <s.icon size={18} />
              </span>
              {s.title}
            </h2>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-600">
              {s.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <div className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
              {s.tips.map((tip, i) => (
                <p key={i} className="py-0.5">
                  💡 {tip}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-8 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
        <h2 className="mb-3 text-base font-semibold text-ink-800">常见问题</h2>
        <div className="space-y-3">
          {FAQS.map((f) => (
            <div key={f.q}>
              <p className="text-sm font-medium text-ink-700">Q：{f.q}</p>
              <p className="mt-0.5 text-sm text-ink-500">A：{f.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
