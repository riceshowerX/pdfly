/**
 * ConvertPages：转换功能页面装配（PDF 转图片 / 图片转 PDF）。
 */
import { PdfToImagePanel } from '../components/converter/PdfToImagePanel';
import { ImageToPdfPanel } from '../components/converter/ImageToPdfPanel';

export function PdfToImagePage() {
  return <PdfToImagePanel />;
}

export function ImageToPdfPage() {
  return <ImageToPdfPanel />;
}
