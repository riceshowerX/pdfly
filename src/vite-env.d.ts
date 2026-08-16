/// <reference types="vite/client" />

/** Vite 资源导入 */
declare module '*.ttf' {
  const src: string;
  export default src;
}
declare module '*.otf' {
  const src: string;
  export default src;
}
declare module '*.woff2' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}

/** pdf.js worker 的 ?url 资源导入 */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const src: string;
  export default src;
}

/** 桌面端 preload 通过 contextBridge 暴露的 API（Web 端不存在）。 */
interface Window {
  pdfApi?: import('../electron/shared/ipc').PdfApi;
}
