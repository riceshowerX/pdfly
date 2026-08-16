/**
 * HomePage：首页三功能入口卡片 + 隐私说明。
 */
import { Link } from 'react-router-dom';
import { FileText, FileImage, Images, ShieldCheck } from 'lucide-react';

const FEATURES = [
  {
    to: '/editor',
    title: '编辑 PDF',
    desc: '文本编辑、批注、高亮、形状、图片、签名；页面插入/删除/拖拽重排；撤销/重做与实时预览。',
    icon: FileText,
    color: 'bg-primary-50 text-primary-600',
  },
  {
    to: '/convert/pdf-to-image',
    title: 'PDF 转图片',
    desc: '单页或全部页面转 PNG / JPG；自定义 DPI、分辨率与尺寸；预览、单张下载或 ZIP 打包。',
    icon: FileImage,
    color: 'bg-emerald-50 text-emerald-600',
  },
  {
    to: '/convert/image-to-pdf',
    title: '图片转 PDF',
    desc: '多张图片（PNG/JPG/GIF/BMP）合并为一个 PDF；拖拽排序、旋转；自定义页面尺寸/边距/缩放。',
    icon: Images,
    color: 'bg-amber-50 text-amber-600',
  },
];

export function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:py-14">
      <div className="mb-8 text-center md:mb-12">
        <h1 className="text-2xl font-bold text-ink-900 md:text-4xl">本地优先的 PDF 编辑器</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-ink-500 md:text-base">
          编辑、转换一站式完成。所有文件在浏览器/本机处理，<span className="font-medium text-primary-600">零上传、零留存</span>，离线可用。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Link
            key={f.to}
            to={f.to}
            className="group flex flex-col rounded-2xl border border-ink-200 bg-white p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-pop"
          >
            <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${f.color}`}>
              <f.icon size={24} />
            </div>
            <h2 className="text-base font-semibold text-ink-800 group-hover:text-primary-700">{f.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-500">{f.desc}</p>
            <span className="mt-4 text-sm font-medium text-primary-600">进入 →</span>
          </Link>
        ))}
      </div>

      <div className="mt-8 flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-4 text-sm text-ink-500 shadow-card">
        <ShieldCheck size={20} className="mt-0.5 flex-none text-green-500" />
        <p>
          <span className="font-medium text-ink-700">隐私安全：</span>
          本应用的所有 PDF 解析、渲染、编辑与转换均在本地完成，文件内容不会上传到任何服务器。
          桌面端可完全断网使用；Web 端所有处理库与资源均已本地打包。
        </p>
      </div>
    </div>
  );
}
