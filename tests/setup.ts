import '@testing-library/jest-dom/vitest';

// 环境兼容：jsdom 的 Blob 实现缺少 arrayBuffer()（Node 原生 Blob 才有）。
// 源码契约返回标准 Blob（浏览器端 API 完整），此处仅为测试环境补齐能力。
// 使用 FileReader 实现读取（对普通 Blob 与 JSZip 生成的 Blob 均验证可用），不影响被测代码。
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Blob.prototype as any).arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('Blob 读取失败'));
      reader.readAsArrayBuffer(this);
    });
  };
}

// 环境兼容：jsdom 未实现 HTMLCanvasElement.getContext（未安装 canvas npm 包），
// 调用会打印 "Not implemented" 告警并返回 null。此处覆盖为静默返回 null，
// 与原生行为一致但避免告警噪音；canvasToBlob 等轻量路径会回退到原 canvas。
// 真实渲染类测试不依赖本 stub（jsdom 本就不支持 canvas 绘制）。
if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as { getContext?: (...args: unknown[]) => unknown };
  proto.getContext = function getContext() {
    return null;
  };
}
