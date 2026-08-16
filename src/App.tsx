/**
 * App：应用壳。
 * HashRouter 路由（兼容静态托管与 Electron file://）+ 顶栏导航 + Toasts 宿主。
 */
import { HashRouter, Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { FileText, FileImage, HelpCircle, Home, Images } from 'lucide-react';
import { Toasts } from './components/common/ui';
import { HomePage } from './pages/HomePage';
import { EditorPage } from './pages/EditorPage';
import { ImageToPdfPage, PdfToImagePage } from './pages/ConvertPages';
import { HelpPage } from './pages/HelpPage';

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-primary-50 text-primary-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-800'
  }`;

function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-1 px-3 md:gap-2 md:px-4">
        <Link to="/" className="mr-1 flex items-center gap-2 md:mr-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
            <FileText size={17} />
          </span>
          <span className="hidden text-base font-bold text-ink-900 sm:block">PDF 编辑器</span>
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none md:gap-1">
          <NavLink to="/" end className={navLinkClass}>
            <Home size={16} />
            <span className="hidden sm:inline">首页</span>
          </NavLink>
          <NavLink to="/editor" className={navLinkClass}>
            <FileText size={16} />
            <span className="hidden sm:inline">编辑 PDF</span>
          </NavLink>
          <NavLink to="/convert/pdf-to-image" className={navLinkClass}>
            <FileImage size={16} />
            <span className="hidden sm:inline">PDF 转图片</span>
          </NavLink>
          <NavLink to="/convert/image-to-pdf" className={navLinkClass}>
            <Images size={16} />
            <span className="hidden sm:inline">图片转 PDF</span>
          </NavLink>
          <NavLink to="/help" className={navLinkClass}>
            <HelpCircle size={16} />
            <span className="hidden sm:inline">帮助</span>
          </NavLink>
        </nav>

        <span className="hidden rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 lg:block">
          本地处理 · 零上传
        </span>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="flex h-full min-h-0 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/editor" element={<EditorPage />} />
            <Route path="/convert/pdf-to-image" element={<PdfToImagePage />} />
            <Route path="/convert/image-to-pdf" element={<ImageToPdfPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Toasts />
      </div>
    </HashRouter>
  );
}
