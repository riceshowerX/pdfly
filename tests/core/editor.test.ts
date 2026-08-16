/**
 * 编辑器单测：几何换算、页面操作的元素迁移、命令应用（撤销/重做语义）、replace-text。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  containsPoint,
  fitContain,
  fitCover,
  computeImageFit,
  ptToScreenX,
  ptToScreenY,
  screenToPtX,
  screenToPtY,
  normalizeRect,
  rectFromPoints,
  zoomFitScale,
} from '../../src/core/geometry';
import { parsePageRange } from '../../src/core/utils';
import { shiftAfterDelete, shiftAfterInsert, remapAfterReorder } from '../../src/store/useEditorStore';
import { useEditorStore } from '../../src/store/useEditorStore';
import type { EditorElement, PdfDocumentState } from '../../src/core/types';

function el(id: string, pageIndex: number): EditorElement {
  return { id, type: 'rect', pageIndex, x: 0, y: 0, width: 10, height: 10, createdAt: 0 };
}

function makeDoc(pageCount = 3): PdfDocumentState {
  return {
    id: 'd',
    fileName: 't.pdf',
    originalBytes: new ArrayBuffer(0),
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({ index: i, widthPt: 200, heightPt: 300, rotation: 0 })),
    loadedAt: 0,
  };
}

beforeEach(() => {
  useEditorStore.getState().reset();
});

describe('geometry', () => {
  it('PDF 点 ↔ 屏幕像素双向换算（左下 vs 左上原点）', () => {
    const pageHeightPt = 300;
    const scale = 2;
    // 页面左下角 (0,0) → 屏幕 (0, 600)
    expect(ptToScreenX(0, scale)).toBe(0);
    expect(ptToScreenY(0, pageHeightPt, scale)).toBe(600);
    // 页面左上角 (0,300) → 屏幕 (0,0)
    expect(ptToScreenY(300, pageHeightPt, scale)).toBe(0);
    // 反向
    expect(screenToPtX(120, scale)).toBe(60);
    expect(screenToPtY(300, pageHeightPt, scale)).toBe(150);
  });

  it('rectFromPoints / normalizeRect 处理任意拖拽方向', () => {
    const r = rectFromPoints({ x: 30, y: 50 }, { x: 10, y: 20 });
    expect(r).toEqual({ x: 10, y: 20, width: 20, height: 30 });
    const n = normalizeRect({ x: 30, y: 50, width: -20, height: -30 });
    expect(n).toEqual({ x: 10, y: 20, width: 20, height: 30 });
  });

  it('containsPoint 边界判定', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    expect(containsPoint(r, { x: 5, y: 5 })).toBe(true);
    expect(containsPoint(r, { x: 10, y: 10 })).toBe(true);
    expect(containsPoint(r, { x: 11, y: 5 })).toBe(false);
  });

  it('fitContain / fitCover / computeImageFit', () => {
    expect(fitContain(100, 50, 200, 200)).toEqual({ width: 200, height: 100 });
    expect(fitCover(100, 50, 200, 200)).toEqual({ width: 400, height: 200 });
    expect(computeImageFit('contain', 100, 50, 200, 100, 1)).toEqual({ width: 200, height: 100 });
    expect(computeImageFit('stretch', 100, 50, 200, 100, 1)).toEqual({ width: 200, height: 100 });
    expect(computeImageFit('contain', 100, 50, 200, 100, 2)).toEqual({ width: 400, height: 200 });
  });

  it('zoomFitScale 等比适配容器', () => {
    expect(zoomFitScale(200, 300, 200, 300)).toBeCloseTo(1, 5);
    expect(zoomFitScale(200, 300, 400, 300)).toBeCloseTo(1, 5);
    expect(zoomFitScale(200, 300, 200, 600)).toBeCloseTo(1, 5);
  });
});

describe('utils.parsePageRange', () => {
  it('all / 单页 / 范围 / 混合', () => {
    expect(parsePageRange('all', 5)).toEqual([0, 1, 2, 3, 4]);
    expect(parsePageRange('3', 5)).toEqual([2]);
    expect(parsePageRange('1-3', 5)).toEqual([0, 1, 2]);
    expect(parsePageRange('1-2,5', 5)).toEqual([0, 1, 4]);
    // toThrow 必须接收函数；直接调用会在 expect 之前抛出，导致测试无法验证「抛出」行为
    expect(() => parsePageRange('2-1', 5)).toThrow();
    expect(() => parsePageRange('abc', 5)).toThrow();
  });

  it('C1：超大范围快速返回（不空转）', () => {
    expect(parsePageRange('1-99999999', 5)).toEqual([0, 1, 2, 3, 4]);
    expect(parsePageRange('1-99999999,7', 5)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('editor store 命令', () => {
  it('add / remove / undo / redo ≥20 步语义', () => {
    const store = useEditorStore.getState();
    store.setDoc(makeDoc());
    store.addElement(el('a', 0));
    store.addElement(el('b', 0));
    expect(useEditorStore.getState().elements.map((e) => e.id)).toEqual(['a', 'b']);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().elements.map((e) => e.id)).toEqual(['a']);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().elements).toHaveLength(0);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().elements.map((e) => e.id)).toEqual(['a']);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().elements.map((e) => e.id)).toEqual(['a', 'b']);

    useEditorStore.getState().removeElement('a');
    expect(useEditorStore.getState().elements.map((e) => e.id)).toEqual(['b']);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('update-element 撤销恢复 before', () => {
    const store = useEditorStore.getState();
    store.setDoc(makeDoc());
    store.addElement(el('a', 0));
    store.updateElement('a', { x: 100 });
    expect(useEditorStore.getState().elements[0].x).toBe(100);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().elements[0].x).toBe(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().elements[0].x).toBe(100);
  });

  it('replace-text 创建覆盖文本元素，撤销移除，重做恢复', () => {
    const store = useEditorStore.getState();
    store.setDoc(makeDoc());
    store.replaceText(0, { x: 10, y: 20, width: 80, height: 16 }, 'old', '新内容', {
      fontSize: 12,
      fontFamily: 'sans',
      color: '#111827',
    });
    let els = useEditorStore.getState().elements;
    expect(els).toHaveLength(1);
    expect(els[0].type).toBe('text');
    expect(els[0].text).toBe('新内容');
    expect(els[0].coversOriginalText).toBe(true);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().elements).toHaveLength(0);
    useEditorStore.getState().redo();
    els = useEditorStore.getState().elements;
    expect(els).toHaveLength(1);
    expect(els[0].text).toBe('新内容');
  });

  it('页面重排：doc.pages 与元素 pageIndex 同步迁移', () => {
    const store = useEditorStore.getState();
    store.setDoc(makeDoc(3));
    store.addElement(el('p0', 0));
    store.addElement(el('p2', 2));
    store.reorderPages(0, 2);
    const s = useEditorStore.getState();
    expect(s.doc!.pages.map((p) => p.index)).toEqual([1, 2, 0]);
    expect(s.elements.find((e) => e.id === 'p0')!.pageIndex).toBe(2);
    expect(s.elements.find((e) => e.id === 'p2')!.pageIndex).toBe(1);
    // 撤销恢复
    useEditorStore.getState().undo();
    const s2 = useEditorStore.getState();
    expect(s2.doc!.pages.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(s2.elements.find((e) => e.id === 'p0')!.pageIndex).toBe(0);
  });

  it('页面插入：元素后移；删除：元素移除并可撤销恢复', () => {
    const store = useEditorStore.getState();
    store.setDoc(makeDoc(2));
    store.addElement(el('on1', 1));
    store.insertBlankPage(1);
    let s = useEditorStore.getState();
    expect(s.doc!.pages).toHaveLength(3);
    expect(s.doc!.pages[1].index).toBe(-1);
    expect(s.elements.find((e) => e.id === 'on1')!.pageIndex).toBe(2);

    useEditorStore.getState().undo();
    s = useEditorStore.getState();
    expect(s.doc!.pages).toHaveLength(2);
    expect(s.elements.find((e) => e.id === 'on1')!.pageIndex).toBe(1);

    // 删除第 0 页
    store.setDoc(makeDoc(2));
    store.addElement(el('on0', 0));
    store.addElement(el('on1b', 1));
    expect(store.deletePage(0)).toBe(true);
    s = useEditorStore.getState();
    expect(s.doc!.pages).toHaveLength(1);
    expect(s.elements.map((e) => e.id)).toEqual(['on1b']);
    expect(s.elements[0].pageIndex).toBe(0);
    useEditorStore.getState().undo();
    s = useEditorStore.getState();
    expect(s.doc!.pages).toHaveLength(2);
    expect(s.elements.map((e) => e.id).sort()).toEqual(['on0', 'on1b']);
    expect(s.elements.find((e) => e.id === 'on0')!.pageIndex).toBe(0);
  });

  it('删除唯一页被拒绝', () => {
    const store = useEditorStore.getState();
    store.setDoc(makeDoc(1));
    expect(store.deletePage(0)).toBe(false);
    expect(useEditorStore.getState().doc!.pages).toHaveLength(1);
  });

  it('M3：删除页撤销后元素按原 z-order 原位恢复', () => {
    const store = useEditorStore.getState();
    store.setDoc(makeDoc(3));
    store.addElement(el('p0a', 0));
    store.addElement(el('p1', 1));
    store.addElement(el('p0b', 0));
    store.addElement(el('p2', 2));
    store.deletePage(0);
    expect(useEditorStore.getState().elements.map((e) => e.id)).toEqual(['p1', 'p2']);
    useEditorStore.getState().undo();
    const s = useEditorStore.getState();
    // 被删页元素按原数组索引原位插回，保持绘制层级（z-order）不变
    expect(s.elements.map((e) => e.id)).toEqual(['p0a', 'p1', 'p0b', 'p2']);
    expect(s.elements.find((e) => e.id === 'p0a')!.pageIndex).toBe(0);
    expect(s.elements.find((e) => e.id === 'p0b')!.pageIndex).toBe(0);
    expect(s.elements.find((e) => e.id === 'p1')!.pageIndex).toBe(1);
    expect(s.elements.find((e) => e.id === 'p2')!.pageIndex).toBe(2);
  });
});

describe('页面迁移纯函数', () => {
  it('shiftAfterInsert / shiftAfterDelete / remapAfterReorder', () => {
    const els = [el('a', 0), el('b', 2), el('c', 3)];
    expect(shiftAfterInsert(els, 1).map((e) => e.pageIndex)).toEqual([0, 3, 4]);
    const del = shiftAfterDelete(els, 2);
    expect(del.kept.map((e) => e.pageIndex)).toEqual([0, 2]);
    expect(del.removed.map((e) => e.id)).toEqual(['b']);
    expect(remapAfterReorder(els, 3, 0).map((e) => e.pageIndex)).toEqual([1, 3, 0]);
    expect(remapAfterReorder(els, 0, 3).map((e) => e.pageIndex)).toEqual([3, 1, 2]);
  });
});
